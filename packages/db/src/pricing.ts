/**
 * Pricing an enquiry off a rate card, and writing the draft quotation it
 * produces — FR-EQ-05, FR-RT-01…06.
 *
 * This was the core of the web ledger's `priceEnquiry` action. It moved here the
 * day auto-draft became a second caller: the service drafts a quotation for an
 * enquiry whose buy rate has just been awarded, with no coordinator clicking
 * "Price it", and the quote it writes — the margin rule, the frozen snapshot,
 * the numbering — must be the quote the button writes. This is the sell side of
 * the ledger; one copy of it, not two.
 *
 * ## Where the sell price comes from, in order
 *
 * 1. A **sell card** covering the lane. Its rates are the price; nothing is
 *    added, because somebody already decided what this customer pays.
 * 2. Failing that, a **buy card** plus the house margin on
 *    `customer_branch_terms` — configuration, not a number invented here.
 * 3. Failing both, a refusal. An uncovered lane is an agent RFQ, not a guess.
 *
 * Nothing is recomputed afterwards: the whole decision is frozen into
 * `quotes.priced_snapshot`, which is what makes a later invoice reconcile to the
 * booking and stops a rate-card edit rewriting history. A revision is a new row.
 */

import { sql } from 'drizzle-orm'
import {
  applyMargin,
  chargeableWeight,
  currencyLookup,
  dayIn,
  dec,
  fxRate,
  priceLines,
  selectBreak,
  summariseMargin,
  toScale,
  todayIn,
  type Basis,
  type ChargeContext,
  type MarginRule,
  type PriceInput,
  type PricedLine,
  type PricingOptions,
  type RateLine,
} from '@qabandi/core'
import { chargeableRuleFor } from './chargeable'
import { findCoveringRateCard, type CoveringRateCard, type CoveringRateLine } from './rate-cards'
import type { Tx } from './actor'

/** What pricing can answer with — the caller turns each into a sentence. */
export type PricingRefusal =
  'not_found' | 'no_mode' | 'no_container_count' | 'no_cover' | 'no_margin' | 'cannot_price'

export type PriceOutcome =
  { readonly reference: string } | { readonly error: PricingRefusal; readonly detail?: string }

export interface PriceEnquiryHooks {
  /** Called before superseding an existing quotation — the `quote.revise` gate. */
  readonly assertRevise?: () => void
}

/** How long an instant quotation stands. Beyond this it expires by itself. */
const VALIDITY_DAYS = 14

/**
 * Price an enquiry and write the draft quotation it produces.
 *
 * Returns a refusal rather than throwing when there is no cover: "no rate card
 * covers this lane" is an answer a coordinator acts on by raising an RFQ, not a
 * fault. The caller owns the actor (RLS scopes the enquiry to the branch) and
 * who prepared it; everything else — the card lookup, the arithmetic, the
 * snapshot, the numbering — is decided here.
 */
export async function priceEnquiryToQuote(
  tx: Tx,
  enquiryId: string,
  preparedById: string,
  hooks: PriceEnquiryHooks = {},
): Promise<PriceOutcome> {
  const [enquiry] = await tx
    .execute(
      sql`
      select e.id, e.branch_id as "branchId", e.customer_id as "customerId",
             e.mode::text as mode, e.origin_id as "originId",
             e.destination_id as "destinationId", e.ready_on::text as "readyOn",
             e.gross_weight_kg::text as "grossWeightKg",
             e.volume_cbm::text as "volumeCbm", e.pieces,
             e.container_count as "containerCount",
             b.base_currency as "baseCurrency",
             b.default_exclusions_en as "exclusionsEn",
             b.default_exclusions_ar as "exclusionsAr",
             t.default_margin_kind::text as "marginKind",
             t.default_margin_value::text as "marginValue"
        from enquiries e
        join branches b on b.id = e.branch_id
        left join customer_branch_terms t
               on t.customer_id = e.customer_id and t.branch_id = e.branch_id
       where e.id = ${enquiryId}
       limit 1
    `,
    )
    .then((r) => r.rows as unknown as EnquiryRow[])

  if (!enquiry) return { error: 'not_found' }
  if (!enquiry.mode) return { error: 'no_mode' }
  /*
    A FCL lane is priced per container, and only the enquiry's own container
    count says how many. It used to fall back to `pieces` — packages — so 200
    cartons in two boxes were quoted as 200 × 40HC (F39). Refused instead: a
    refusal a coordinator answers by entering the count beats a price that is
    wrong by two orders of magnitude, and the auto-draft sweep skips it the same
    way it skips a lane with no cover.
  */
  if (enquiry.mode === 'sea_fcl' && enquiry.containerCount === null) {
    return { error: 'no_container_count' }
  }

  // Cover is asked for on the readiness date, not today — a shipment ready in
  // six weeks is priced against the card that will be live then.
  const on = enquiry.readyOn ?? todayIn()

  const lane = {
    mode: enquiry.mode,
    originId: enquiry.originId,
    destinationId: enquiry.destinationId,
    on,
    customerId: enquiry.customerId,
  }

  const sellCard = await findCoveringRateCard(tx, { ...lane, direction: 'sell' })
  const buyCard = await findCoveringRateCard(tx, { ...lane, direction: 'buy' })

  if (!sellCard && !buyCard) return { error: 'no_cover' }

  const rule = await chargeableRuleFor(tx, enquiry.mode, enquiry.branchId)
  const derived =
    rule && (enquiry.grossWeightKg || enquiry.volumeCbm)
      ? chargeableWeight(
          { grossWeightKg: enquiry.grossWeightKg ?? 0, volumeCbm: enquiry.volumeCbm ?? 0 },
          rule,
        )
      : null
  const chargeableKg = derived ? derived.chargeableKg.toString() : null

  const ctx = contextFor(enquiry.mode, enquiry, chargeableKg)

  const currencies = await tx
    .execute(sql`select code, minor_units as "minorUnits" from currencies`)
    .then((r) => r.rows as unknown as { code: string; minorUnits: number }[])
  const lookup = currencyLookup(currencies)

  // The newest rate on or before the pricing date, never a later one (FR-RT-06).
  const rates = await tx
    .execute(
      sql`
        select distinct on (from_currency)
               from_currency as "from", to_currency as "to", rate::text as rate,
               effective_on::text as "effectiveOn"
          from fx_rates
         where to_currency = ${enquiry.baseCurrency}
           and effective_on <= ${on}::date
         order by from_currency, effective_on desc
      `,
    )
    .then((r) => r.rows as unknown as { from: string; to: string; rate: string }[])

  const pricedAt = new Date()
  const opts: PricingOptions = {
    baseCurrency: enquiry.baseCurrency,
    fxRates: rates.map((r) => fxRate(r.from, r.to, dec(r.rate), pricedAt)),
    currencies: lookup,
    pricedAt,
  }

  let priced: PricedLine[]
  let cost: PricedLine[] = []
  let marginRule: MarginRule | null = null

  try {
    cost = buyCard ? priceLines(inputsFor(buyCard, 'cost', chargeableKg, ctx), opts) : []

    if (sellCard) {
      priced = [...cost, ...priceLines(inputsFor(sellCard, 'revenue', chargeableKg, ctx), opts)]
    } else {
      marginRule = houseMargin(enquiry, opts.baseCurrency)
      if (!marginRule) return { error: 'no_margin' }
      priced = [
        ...cost,
        ...cost.map((line) => ({
          ...line,
          direction: 'revenue' as const,
          amount: applyMargin(line.amount, marginRule!),
          amountInBase: applyMargin(line.amountInBase, marginRule!),
        })),
      ]
    }
  } catch (error) {
    return { error: 'cannot_price', detail: (error as Error).message }
  }

  const revenue = priced.filter((line) => line.direction === 'revenue')
  if (revenue.length === 0) return { error: 'no_cover' }

  const totals = summariseMargin(priced, opts.baseCurrency)
  /*
    The totals are in the entity's base currency — `summariseMargin` adds each
    line's `amountInBase` — so that is the currency the quotation carries.
    This used to take the first sell line's currency instead: a USD card priced
    for a KWD branch stored KWD totals labelled USD, to three decimals, on the
    register, the comparison page and the quotation. Lines keep their own
    currency; quoting a customer in the card's currency is a separate choice.
  */
  const sellCurrency = opts.baseCurrency

  const validUntil = new Date(pricedAt)
  validUntil.setUTCDate(validUntil.getUTCDate() + VALIDITY_DAYS)

  const reference = await writeQuote(
    tx,
    {
      enquiryId,
      branchId: enquiry.branchId,
      preparedById,
      currency: sellCurrency,
      totalSell: toScale(totals.revenue, lookup),
      totalCost: toScale(totals.cost, lookup),
      validUntil: dayIn(validUntil),
      snapshot: {
        pricedAt: pricedAt.toISOString(),
        marginPct: totals.grossPercent ? Number(totals.grossPercent.toFixed(2)) : 0,
        source: sellCard ? 'sell_card' : 'buy_card_plus_margin',
        sellCardId: sellCard?.id ?? null,
        buyCardId: buyCard?.id ?? null,
        marginRule: marginRule
          ? { kind: marginRule.kind, value: marginRule.value.toString() }
          : null,
        chargeableKg,
        chargeableBasis: derived?.basis ?? null,
        divisorCm3PerKg: rule?.divisorCm3PerKg?.toString() ?? null,
        baseCurrency: opts.baseCurrency,
        fx: opts.fxRates.map((r) => ({ from: r.from, to: r.to, rate: r.rate.toString() })),
        inclusions: revenue.map((line) => nameFor(line.chargeTypeKey, sellCard ?? buyCard!)),
        /*
          The buy side line by line, in the quotation's currency and converted
          the way the sell lines are, so the internal comparison can put a buy
          rate beside each sell rate instead of only a buy total (F41). Keyed by
          charge type because that is what joins a buy line to its sell line;
          a sell charge with no buy counterpart simply has no entry. Empty when
          no buy card covered the lane. Quotations priced before this have no
          `lineCosts` at all, and the comparison shows their buy rate as unknown.
        */
        lineCosts: cost.map((line) => ({
          chargeTypeKey: line.chargeTypeKey,
          basis: line.basis,
          quantity: line.quantity.toString(),
          rate: line.rate.times(line.fx.rate).toDecimalPlaces(6).toString(),
          amount: toScale(line.amountInBase, lookup),
          currency: line.amountInBase.currency,
        })),
        exclusions: splitLines(enquiry.exclusionsEn),
        exclusionsAr: splitLines(enquiry.exclusionsAr),
      },
      /*
        Lines in the quotation's currency, like its total.

        They were written in the card's currency (USD) under a quotation in the
        base currency (KWD), and the quotation PDF formats every amount in the
        quotation's currency — so a customer was sent "KWD 1,856.000" per
        container for a 1,856 USD rate, five lines summing to 5,281 above a
        total of 1,629.955. Converted at the rate each line was priced at; that
        rate and the card's own currency stay in `priced_snapshot`.
      */
      lines: revenue.map((line, index) => ({
        chargeTypeId: chargeTypeIdFor(line.chargeTypeKey, sellCard ?? buyCard!),
        basis: line.basis,
        quantity: line.quantity.toString(),
        rate: line.rate.times(line.fx.rate).toDecimalPlaces(6).toString(),
        amount: toScale(line.amountInBase, lookup),
        currency: line.amountInBase.currency,
        sortOrder: index,
      })),
    },
    hooks.assertRevise ?? (() => {}),
  )

  return { reference }
}

// --- the pieces `priceEnquiry` was built from --------------------------------

interface EnquiryRow {
  readonly id: string
  readonly branchId: string
  readonly customerId: string | null
  readonly mode: string | null
  readonly originId: string | null
  readonly destinationId: string | null
  readonly readyOn: string | null
  readonly grossWeightKg: string | null
  readonly volumeCbm: string | null
  readonly pieces: number | null
  readonly containerCount: number | null
  readonly baseCurrency: string
  readonly exclusionsEn: string | null
  readonly exclusionsAr: string | null
  readonly marginKind: string | null
  readonly marginValue: string | null
}

/**
 * What the six bases are calculated against, from the enquiry's own figures.
 *
 * `containers` is the enquiry's container count on a FCL lane — never `pieces`,
 * which counts packages (F39). The caller has already refused a FCL enquiry
 * without one; the `?? 1` is only for the type. Other modes keep one container,
 * as they always have: a per-container line on an LCL or air card is a flat fee.
 */
function contextFor(
  mode: string,
  cargo: {
    grossWeightKg: string | null
    volumeCbm: string | null
    pieces: number | null
    containerCount: number | null
  },
  chargeableKg: string | null,
): ChargeContext {
  const pieces = cargo.pieces ?? 1
  return {
    kg: chargeableKg ?? cargo.grossWeightKg ?? 0,
    units: pieces,
    containers: mode === 'sea_fcl' ? (cargo.containerCount ?? 1) : 1,
    days: 1,
  }
}

/**
 * A rate card line becomes a `RateLine` the engine can calculate, and the
 * context that line is calculated against — a weight break changes both. See the
 * `selectBreak` note the web original carried: it may bill more kilograms than
 * the consignment weighs where the higher declaration is the lower total.
 */
function rateLineFor(
  line: CoveringRateLine,
  ctx: ChargeContext,
  chargeableKg: string | null,
): { line: RateLine; ctx: ChargeContext } {
  const base: RateLine = {
    basis: line.basis as Basis,
    rate: dec(line.rate),
    currency: line.currency,
    minimum: line.minimum === null ? null : dec(line.minimum),
    maximum: line.maximum === null ? null : dec(line.maximum),
  }

  if (line.basis !== 'per_kg' || !line.weightBreaks?.length || chargeableKg === null) {
    return { line: base, ctx }
  }

  const selection = selectBreak(
    dec(chargeableKg),
    line.weightBreaks.map((b) => ({
      fromKg: dec(b.fromKg),
      ratePerKg: dec(b.ratePerKg),
      ...(b.minimumCharge === undefined ? {} : { minimumCharge: dec(b.minimumCharge) }),
    })),
    line.currency,
  )
  if (!selection) return { line: base, ctx }

  return {
    line: {
      ...base,
      rate: selection.appliedBreak.ratePerKg,
      minimum: selection.appliedBreak.minimumCharge ?? base.minimum,
    },
    ctx: { ...ctx, kg: selection.billedKg },
  }
}

const inputsFor = (
  card: CoveringRateCard,
  direction: 'cost' | 'revenue',
  chargeableKg: string | null,
  ctx: ChargeContext,
): PriceInput[] =>
  card.lines.map((cardLine) => {
    const resolved = rateLineFor(cardLine, ctx, chargeableKg)
    return {
      chargeTypeKey: cardLine.chargeTypeKey,
      direction,
      line: resolved.line,
      ctx: resolved.ctx,
    }
  })

/** The customer's house margin, where they have one — FR-EQ-05. */
function houseMargin(row: EnquiryRow, baseCurrency: string): MarginRule | null {
  if (!row.marginKind || !row.marginValue) return null
  const value = dec(row.marginValue)
  return row.marginKind === 'percent'
    ? { kind: 'percent', value }
    : row.marginKind === 'absolute'
      ? { kind: 'absolute', value, currency: baseCurrency }
      : { kind: 'target_sell', value, currency: baseCurrency }
}

/** One exclusion per line, blank lines dropped. */
function splitLines(value: string | null): string[] {
  return (value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

const lineFor = (key: string, card: CoveringRateCard): CoveringRateLine | undefined =>
  card.lines.find((line) => line.chargeTypeKey === key)

const nameFor = (key: string, card: CoveringRateCard): string =>
  lineFor(key, card)?.chargeNameEn ?? key

const chargeTypeIdFor = (key: string, card: CoveringRateCard): string =>
  lineFor(key, card)!.chargeTypeId

interface QuoteWrite {
  readonly enquiryId: string
  readonly branchId: string
  readonly preparedById: string
  readonly currency: string
  readonly totalSell: string
  readonly totalCost: string
  readonly validUntil: string
  readonly snapshot: Record<string, unknown>
  readonly lines: readonly {
    chargeTypeId: string
    basis: string
    quantity: string
    rate: string
    amount: string
    currency: string
    sortOrder: number
  }[]
}

/**
 * Write the quotation and its lines, superseding the previous version — the same
 * numbering and versioning `createQuote` performs, because it is the same act.
 */
async function writeQuote(tx: Tx, write: QuoteWrite, assertRevise: () => void): Promise<string> {
  const [latest] = await tx
    .execute(
      sql`
    select id, version, reference from quotes
     where enquiry_id = ${write.enquiryId}
     order by version desc limit 1
  `,
    )
    .then((r) => r.rows as { id: string; version: number; reference: string }[])

  if (latest) assertRevise()

  const version = (latest?.version ?? 0) + 1
  const seqRow = await tx.execute(sql`select nextval('quote_reference_seq')::text as seq`)
  const seq = (seqRow.rows[0] as { seq: string }).seq
  const year = new Date().getUTCFullYear()
  const stem = latest?.reference?.replace(/-v\d+$/, '') ?? `QUO-${year}-${seq.padStart(5, '0')}`

  const inserted = await tx
    .execute(
      sql`
    insert into quotes (reference, enquiry_id, branch_id, version, status, currency,
                        total_sell, total_cost, valid_until, priced_snapshot,
                        rate_card_version_id, prepared_by_id)
    values (${version === 1 ? stem : `${stem}-v${version}`}, ${write.enquiryId},
            ${write.branchId}, ${version}, 'draft', ${write.currency},
            ${write.totalSell}, ${write.totalCost}, ${write.validUntil}::date,
            ${JSON.stringify(write.snapshot)}::jsonb,
            ${(write.snapshot.sellCardId as string | null) ?? null}, ${write.preparedById})
    returning id, reference
  `,
    )
    .then((r) => r.rows[0] as { id: string; reference: string })

  for (const line of write.lines) {
    await tx.execute(sql`
      insert into quote_lines (quote_id, charge_type_id, basis, quantity, rate,
                               amount, currency, sort_order)
      values (${inserted.id}, ${line.chargeTypeId}, ${line.basis}, ${line.quantity},
              ${line.rate}, ${line.amount}, ${line.currency}, ${line.sortOrder})
    `)
  }

  if (latest) {
    await tx.execute(sql`
      update quotes set status = 'superseded', updated_at = now() where id = ${latest.id}
    `)
  }

  // The enquiry has been answered — a priced quotation is a first reply.
  await tx.execute(sql`
    update enquiries
       set status = case when status in ('new', 'assigned') then 'quoted'::enquiry_status
                         else status end,
           first_responded_at = coalesce(first_responded_at, now()),
           updated_at = now()
     where id = ${write.enquiryId}
  `)

  return inserted.reference
}
