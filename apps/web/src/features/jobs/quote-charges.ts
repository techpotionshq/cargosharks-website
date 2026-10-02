import 'server-only'

/**
 * A booked quotation's money, carried onto the job — D13.
 *
 * Booking an accepted quotation wrote the job and its milestones and nothing
 * else, so the shipment showed revenue and cost of zero, never reached the
 * unbilled register (which reads only `charge_lines`), and every charge the
 * customer had already agreed had to be typed again before it could be billed.
 *
 * ## What travels
 *
 * - **Revenue**: every `quote_lines` row, as it was offered: charge type,
 *   basis, quantity, rate, amount and currency, with the customer as the
 *   counterparty. Billing the job therefore produces an invoice equal to the
 *   quotation.
 * - **Cost**: the buy side, where the quotation records it line by line
 *   (`priced_snapshot.lineCosts`, written when a quotation is priced off a buy
 *   card). Quotations priced since D13 also record the card's own currency,
 *   rate and conversion, and the partner the card belongs to, so the accrual
 *   sits in the currency the supplier will invoice in and its base amount is
 *   exactly the cost the quotation totalled. Older ones carry the base
 *   currency figures, which is what they recorded. A manual quotation records
 *   a total cost and no lines, so no cost travels from it: a single line with
 *   no charge and no partner would be an accrual nobody can match.
 *
 * ## Once
 *
 * Each line carries `source_kind`/`source_id` back to what it came from. The
 * quotation itself can be booked only once (`claimQuote`, under `for update`),
 * and this also refuses to write twice onto the same job, so a retry inside
 * the same transaction is harmless.
 *
 * Decimal throughout: amounts are stored strings from the quotation, and the
 * only arithmetic, a conversion to base for a line not already in it, is
 * `Decimal` rounded to the base currency's minor units (three for KWD).
 */

import { and, eq, inArray } from 'drizzle-orm'
import { BASES, dec, type Basis } from '@qabandi/core'
import {
  branches,
  chargeLines,
  chargeTypes,
  currencies,
  latestFxRate,
  quoteLines,
  quotes,
  rateCards,
  type Tx,
} from '@qabandi/db'

export const QUOTE_REVENUE_SOURCE = 'quote_line'
export const QUOTE_COST_SOURCE = 'quote_cost'

export type CarryOutcome =
  | { readonly ok: true; readonly revenue: number; readonly cost: number }
  | { readonly ok: false; readonly reason: 'no_fx'; readonly currency: string }

interface LineCost {
  readonly chargeTypeKey?: unknown
  readonly chargeTypeId?: unknown
  readonly partnerId?: unknown
  readonly basis?: unknown
  readonly quantity?: unknown
  readonly rate?: unknown
  readonly amount?: unknown
  readonly currency?: unknown
  readonly cardCurrency?: unknown
  readonly cardRate?: unknown
  readonly cardAmount?: unknown
  readonly fxRate?: unknown
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null

const basisOf = (value: unknown): Basis =>
  typeof value === 'string' && (BASES as readonly string[]).includes(value)
    ? (value as Basis)
    : 'flat'

export async function carryQuoteCharges(
  tx: Tx,
  booking: {
    readonly quoteId: string
    readonly jobId: string
    readonly branchId: string
    readonly customerId: string
  },
): Promise<CarryOutcome> {
  const [already] = await tx
    .select({ id: chargeLines.id })
    .from(chargeLines)
    .where(
      and(
        eq(chargeLines.jobId, booking.jobId),
        inArray(chargeLines.sourceKind, [QUOTE_REVENUE_SOURCE, QUOTE_COST_SOURCE]),
      ),
    )
    .limit(1)
  if (already) return { ok: true, revenue: 0, cost: 0 }

  const [branch] = await tx
    .select({ baseCurrency: branches.baseCurrency })
    .from(branches)
    .where(eq(branches.id, booking.branchId))
    .limit(1)
  const [quote] = await tx
    .select({ snapshot: quotes.pricedSnapshot })
    .from(quotes)
    .where(eq(quotes.id, booking.quoteId))
    .limit(1)
  if (!branch || !quote) return { ok: true, revenue: 0, cost: 0 }

  const base = branch.baseCurrency
  const minor = new Map(
    (
      await tx.select({ code: currencies.code, minorUnits: currencies.minorUnits }).from(currencies)
    ).map((row) => [row.code, row.minorUnits]),
  )
  const snapshot = (quote.snapshot ?? {}) as Record<string, unknown>
  const pricedAt = text(snapshot.pricedAt) ? new Date(snapshot.pricedAt as string) : new Date()
  const fxAt = Number.isNaN(pricedAt.getTime()) ? new Date() : pricedAt

  /*
    The rate a line in another currency is converted at: the one the
    quotation was priced with where it recorded one, else the latest on file,
    which is what a hand-typed cost line takes too.
  */
  const snapshotFx = Array.isArray(snapshot.fx) ? (snapshot.fx as Record<string, unknown>[]) : []
  async function rateToBase(currency: string): Promise<string | null> {
    if (currency === base) return '1'
    const frozen = snapshotFx.find((r) => r.from === currency && r.to === base)
    return text(frozen?.rate) ?? (await latestFxRate(tx, currency, base))
  }
  const toBase = (amount: string, fx: string) =>
    dec(amount)
      .times(dec(fx))
      .toDecimalPlaces(minor.get(base) ?? 2)
      .toFixed(minor.get(base) ?? 2)

  // --- revenue: the quotation's own lines -----------------------------------
  const offered = await tx
    .select({
      id: quoteLines.id,
      chargeTypeId: quoteLines.chargeTypeId,
      description: quoteLines.description,
      basis: quoteLines.basis,
      quantity: quoteLines.quantity,
      rate: quoteLines.rate,
      amount: quoteLines.amount,
      currency: quoteLines.currency,
    })
    .from(quoteLines)
    .where(eq(quoteLines.quoteId, booking.quoteId))
    .orderBy(quoteLines.sortOrder, quoteLines.createdAt)

  const revenueRows = []
  for (const line of offered) {
    const fx = await rateToBase(line.currency)
    if (fx === null) return { ok: false, reason: 'no_fx', currency: line.currency }
    revenueRows.push({
      jobId: booking.jobId,
      branchId: booking.branchId,
      direction: 'revenue' as const,
      chargeTypeId: line.chargeTypeId,
      description: line.description,
      basis: basisOf(line.basis),
      quantity: line.quantity,
      rate: line.rate,
      amount: line.amount,
      currency: line.currency,
      fxRate: fx,
      fxRateAt: fxAt,
      amountBase: line.currency === base ? line.amount : toBase(line.amount, fx),
      baseCurrency: base,
      counterpartyCustomerId: booking.customerId,
      sourceKind: QUOTE_REVENUE_SOURCE,
      sourceId: line.id,
    })
  }

  // --- cost: the buy side, where the quotation recorded it ------------------
  const recorded = Array.isArray(snapshot.lineCosts) ? (snapshot.lineCosts as LineCost[]) : []
  const costRows = []
  if (recorded.length > 0) {
    // The partner the buy card belongs to, for quotations priced before the
    // snapshot named it.
    const buyCardId = text(snapshot.buyCardId)
    const [card] = buyCardId
      ? await tx
          .select({ partnerId: rateCards.partnerId })
          .from(rateCards)
          .where(eq(rateCards.id, buyCardId))
          .limit(1)
      : []
    const keys = recorded.map((entry) => text(entry.chargeTypeKey)).filter((k) => k !== null)
    const byKey = new Map(
      keys.length
        ? (
            await tx
              .select({ id: chargeTypes.id, key: chargeTypes.key })
              .from(chargeTypes)
              .where(inArray(chargeTypes.key, keys))
          ).map((row) => [row.key, row.id])
        : [],
    )

    for (const entry of recorded) {
      const chargeTypeId =
        text(entry.chargeTypeId) ?? byKey.get(text(entry.chargeTypeKey) ?? '') ?? null
      const amountBase = text(entry.amount)
      if (!chargeTypeId || !amountBase) continue

      const cardCurrency = text(entry.cardCurrency)
      const cardAmount = text(entry.cardAmount)
      const cardRate = text(entry.cardRate)
      const recordedFx = text(entry.fxRate)
      const inCard = cardCurrency && cardAmount && cardRate && recordedFx

      let currency: string
      let rate: string
      let amount: string
      let fx: string
      if (inCard) {
        currency = cardCurrency
        rate = cardRate
        amount = cardAmount
        fx = cardCurrency === base ? '1' : recordedFx
      } else {
        currency = text(entry.currency) ?? base
        rate = text(entry.rate) ?? amountBase
        amount = amountBase
        const found = await rateToBase(currency)
        if (found === null) return { ok: false, reason: 'no_fx', currency }
        fx = found
      }

      costRows.push({
        jobId: booking.jobId,
        branchId: booking.branchId,
        direction: 'cost' as const,
        chargeTypeId,
        description: null,
        basis: basisOf(entry.basis),
        quantity: text(entry.quantity) ?? '1',
        rate,
        amount,
        currency,
        fxRate: fx,
        fxRateAt: fxAt,
        // The base amount the quotation totalled, not a re-conversion of it,
        // so the job's cost equals the quotation's cost to the fil.
        amountBase: inCard || currency === base ? amountBase : toBase(amount, fx),
        baseCurrency: base,
        counterpartyPartnerId: text(entry.partnerId) ?? card?.partnerId ?? null,
        sourceKind: QUOTE_COST_SOURCE,
        sourceId: booking.quoteId,
      })
    }
  }

  if (revenueRows.length) await tx.insert(chargeLines).values(revenueRows)
  if (costRows.length) await tx.insert(chargeLines).values(costRows)
  return { ok: true, revenue: revenueRows.length, cost: costRows.length }
}
