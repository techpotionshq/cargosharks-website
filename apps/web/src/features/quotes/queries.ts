/**
 * Quote reads — Moment 2 and Moment 2b.
 *
 * The comparison view is the only screen in the product that shows buy, sell
 * and margin on the same row (`FR-EQ-07`). It is internal by construction: the
 * customer portal and the tracking page never call into this slice, and the
 * quotation PDF renders from the sell side alone.
 *
 * Prices are read from `priced_snapshot` — the resolved lines, divisors,
 * accessorials and FX rate exactly as they stood at pricing time (§6.3). The
 * rate card is never re-read to reprice: a rate change tomorrow must not
 * rewrite what was quoted yesterday, and that is why a June invoice reconciles
 * to a March booking.
 */

import 'server-only'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  branches,
  chargeTypes,
  enquiries,
  customers,
  locations,
  partners,
  principals,
  quoteLines,
  quotes,
  rateCards,
  withActor,
  type Actor,
} from '@qabandi/db'
import type { Mode, QuoteComparison, QuoteFxView, QuoteOptionView } from '@/lib/pilot/types'
import { usePilotFixtures } from '@/lib/pilot/source'
import { pilotQuote } from '@/lib/pilot/fixtures'

const origin = alias(locations, 'origin')
const destination = alias(locations, 'destination')

/**
 * A snapshot field as a string, or nothing.
 *
 * `String(undefined)` is `"undefined"`, and a blank string is not a value — a
 * carrier of `""` renders as an empty line where a name should be, which is
 * the same class of lie as a dash.
 */
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/**
 * The buy rate of each charge, from the snapshot's `lineCosts`.
 *
 * Pricing records the buy side line by line (F41), already in the quotation's
 * currency like the sell lines, keyed by charge type — the join between a buy
 * line and its sell line. A quotation priced before that has no `lineCosts`,
 * and a sell charge the buy card did not carry has no entry: both read as
 * `undefined` here and the page shows the buy rate as unknown, never as zero.
 */
function buyRates(snapshot: Record<string, unknown>): Map<string, number> {
  const rates = new Map<string, number>()
  if (!Array.isArray(snapshot.lineCosts)) return rates
  for (const entry of snapshot.lineCosts as unknown[]) {
    if (!entry || typeof entry !== 'object') continue
    const { chargeTypeKey, rate } = entry as Record<string, unknown>
    if (typeof chargeTypeKey !== 'string' || typeof rate !== 'string') continue
    // The first line of a charge wins, as the sell side's order does.
    if (!rates.has(chargeTypeKey)) rates.set(chargeTypeKey, Number(rate))
  }
  return rates
}

/**
 * The rates a quotation was converted at, from its snapshot.
 *
 * `converted` is what pricing records now: only the rates a line used, each
 * with its source and moment. A quotation priced before that has `fx` with
 * rates alone, which still says which rate it was, and not whose.
 */
function convertedAt(snapshot: Record<string, unknown>): QuoteFxView[] {
  const list = Array.isArray(snapshot.converted)
    ? (snapshot.converted as unknown[])
    : Array.isArray(snapshot.lineCosts) && Array.isArray(snapshot.fx)
      ? (snapshot.fx as unknown[]).filter((entry) =>
          (snapshot.lineCosts as unknown[]).some(
            (cost) =>
              !!cost &&
              !!entry &&
              (cost as Record<string, unknown>).cardCurrency ===
                (entry as Record<string, unknown>).from,
          ),
        )
      : []
  return list.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const r = entry as Record<string, unknown>
    const from = text(r.from)
    const to = text(r.to)
    const rate = text(r.rate)
    if (!from || !to || !rate || from === to) return []
    return [
      {
        from,
        to,
        rate,
        source: text(r.source),
        effectiveOn: text(r.effectiveOn),
        takenAt: text(r.takenAt),
      },
    ]
  })
}

/**
 * The priced options for an enquiry, ranked.
 *
 * `enquiryId` is optional so the demo can open the comparison directly; in the
 * product it is always reached from the enquiry.
 *
 * `undefined` means the enquiry does not exist or this actor cannot see it —
 * nothing else. An enquiry with no quote yet comes back with `options: []`,
 * because this is the page that prices it: answering "not found" for a
 * quoteless enquiry made every new one unreachable, and with it the only
 * "Price it" button it has.
 *
 * `locale` names the customer, the lane and the card's partner in the reader's
 * language. Defaulted to English so a caller that does not pass one renders
 * as it did before rather than failing to compile.
 */
export async function getQuoteComparison(
  actor: Actor,
  enquiryId?: string,
  locale: 'en' | 'ar' = 'en',
): Promise<QuoteComparison | undefined> {
  if (usePilotFixtures()) return pilotQuote(enquiryId, Date.now(), locale)
  if (!enquiryId) return undefined

  return withActor(actor, async (tx) => {
    const [header] = await tx
      .select({
        enquiryReference: enquiries.reference,
        mode: enquiries.mode,
        containerCount: enquiries.containerCount,
        incoterm: enquiries.incoterm,
        firstRespondedAt: enquiries.firstRespondedAt,
        status: enquiries.status,
        branchId: enquiries.branchId,
        baseCurrency: branches.baseCurrency,
        hasAccepted: sql<boolean>`exists (
          select 1 from quotes a where a.enquiry_id = "enquiries"."id" and a.status = 'accepted'
        )`,
        customerName: customers.legalNameEn,
        customerNameAr: customers.legalNameAr,
        preparedBy: principals.nameEn,
        preparedByAr: principals.nameAr,
        originName: origin.nameEn,
        originNameAr: origin.nameAr,
        destinationName: destination.nameEn,
        destinationNameAr: destination.nameAr,
      })
      .from(enquiries)
      .innerJoin(branches, eq(branches.id, enquiries.branchId))
      .leftJoin(customers, eq(customers.id, enquiries.customerId))
      .leftJoin(principals, eq(principals.id, enquiries.ownerId))
      // The lane the enquiry actually names. It used to be a hard-coded dash
      // here while the register two clicks away resolved it from the same two
      // columns — the same shipment, described on one screen and blank on the
      // next.
      .leftJoin(origin, eq(origin.id, enquiries.originId))
      .leftJoin(destination, eq(destination.id, enquiries.destinationId))
      .where(eq(enquiries.id, enquiryId))
      .limit(1)

    if (!header) return undefined

    /*
      The Arabic name where there is one. Partners mostly have none yet, and
      an empty string is as unset as a null, hence `||` rather than `??`.
    */
    const named = (en: string | null, ar: string | null) => (locale === 'ar' && ar) || en
    const originName = named(header.originName, header.originNameAr)
    const destinationName = named(header.destinationName, header.destinationNameAr)

    const optionRows = await tx
      .select({
        id: quotes.id,
        currency: quotes.currency,
        totalSell: quotes.totalSell,
        totalCost: quotes.totalCost,
        validUntil: quotes.validUntil,
        pricedSnapshot: quotes.pricedSnapshot,
        /*
          Who the price came from, where anybody knows.

          A quotation priced off a rate card carries no carrier in its
          snapshot — the card prices a lane, not a sailing — but the card
          itself belongs to a partner, and on a buy card that partner is the
          carrier or the agent whose rate this is. It is lineage, which is
          exactly what `rate_card_version_id` is kept for.
        */
        cardPartner: partners.legalNameEn,
        cardPartnerAr: partners.legalNameAr,
        rateCardVersionId: quotes.rateCardVersionId,
      })
      .from(quotes)
      .leftJoin(rateCards, eq(rateCards.id, quotes.rateCardVersionId))
      .leftJoin(partners, eq(partners.id, rateCards.partnerId))
      // Superseded revisions are history, not options (§7 rule one).
      .where(and(eq(quotes.enquiryId, enquiryId), isNull(quotes.supersededById)))
      .orderBy(desc(quotes.createdAt))
      .limit(5)

    // No quote yet is the normal state of a new enquiry, not a missing one —
    // returning nothing here made every unpriced enquiry's page a 404.

    /*
      Only the lines of the options on screen. Unfiltered, this read every quote
      line the actor could see — every quotation in their branches — on every
      page load, and threw all but a handful away below. Skipped outright when
      there is nothing to price yet: `inArray` over an empty list is no query
      worth sending.
    */
    const optionIds = optionRows.map((row) => row.id)
    const lineRows =
      optionIds.length === 0
        ? []
        : await tx
            .select({
              quoteId: quoteLines.quoteId,
              description: quoteLines.description,
              basis: quoteLines.basis,
              quantity: quoteLines.quantity,
              rate: quoteLines.rate,
              amount: quoteLines.amount,
              currency: quoteLines.currency,
              code: chargeTypes.key,
              nameEn: chargeTypes.nameEn,
              nameAr: chargeTypes.nameAr,
            })
            .from(quoteLines)
            .innerJoin(chargeTypes, eq(chargeTypes.id, quoteLines.chargeTypeId))
            .where(inArray(quoteLines.quoteId, optionIds))
            .orderBy(asc(quoteLines.sortOrder))

    /** The cheapest sell is recommended unless a snapshot says otherwise. */
    const cheapest = optionRows.reduce<(typeof optionRows)[number] | undefined>(
      (best, row) =>
        !best || Number(row.totalSell ?? 0) < Number(best.totalSell ?? 0) ? row : best,
      undefined,
    )

    const options = optionRows.map((row): QuoteOptionView => {
      const sell = Number(row.totalSell ?? 0)
      const cost = Number(row.totalCost ?? 0)
      const snapshot = (row.pricedSnapshot ?? {}) as Record<string, unknown>
      const buyRateOf = buyRates(snapshot)
      return {
        id: row.id,
        carrier: text(snapshot.carrier) ?? named(row.cardPartner, row.cardPartnerAr),
        service: text(snapshot.service),
        transitDays: typeof snapshot.transitDays === 'number' ? snapshot.transitDays : null,
        buy: { amount: cost, currency: row.currency },
        sell: { amount: sell, currency: row.currency },
        marginPct: sell === 0 ? 0 : Math.round(((sell - cost) / sell) * 1000) / 10,
        validUntil: row.validUntil ? new Date(row.validUntil) : new Date(),
        isRecommended: row.id === cheapest?.id,
        fx: convertedAt(snapshot),
        lines: lineRows
          .filter((line) => line.quoteId === row.id)
          .map((line) => ({
            chargeCode: line.code,
            nameEn: line.nameEn,
            nameAr: line.nameAr,
            basis: line.basis,
            quantity: Number(line.quantity),
            buyRate: buyRateOf.get(line.code) ?? null,
            sellRate: Number(line.rate),
            amount: { amount: Number(line.amount), currency: line.currency },
          })),
      }
    })

    return {
      enquiryReference: header.enquiryReference,
      // Null rather than a dash: the page says "Not recorded" in words.
      customerName: named(header.customerName, header.customerNameAr),
      // The arrow turns round in Arabic: an RTL line sets the origin on the right.
      lane:
        originName && destinationName
          ? `${originName} ${locale === 'ar' ? '←' : '→'} ${destinationName}`
          : null,
      // Not defaulted: a WhatsApp or emailed enquiry has no mode until it is
      // read, and "Sea FCL" in its place states a fact nobody recorded.
      mode: header.mode as Mode | null,
      containerCount: header.containerCount,
      containerType: null,
      incoterm: header.incoterm,
      preparedBy: named(header.preparedBy, header.preparedByAr),
      pricedAt: new Date(),
      /*
        Neither number is measured on the live path yet.

        `manualTurnaroundHours` is the client's own figure for how long this
        used to take by hand (Pilot §5 item 7) and has no column to come from;
        `pricingMs` is the engine's own clock, which `priceEnquiry` does not
        yet record on the quote. Null rather than zero, so the strip says
        nothing instead of claiming the enquiry was priced instantaneously and
        that doing it by hand took no time at all.
      */
      manualTurnaroundHours: null,
      pricingMs: null,
      hasResponded: header.firstRespondedAt !== null,
      isClosed: ['won', 'lost', 'cancelled', 'expired'].includes(header.status),
      // The raw status too: "start rating" is only a move from `assigned`,
      // and `isClosed` cannot answer which of the open states it is in.
      status: header.status,
      branchId: header.branchId,
      baseCurrency: header.baseCurrency,
      hasAccepted: header.hasAccepted,
      pricedFrom: optionRows.every((row) => row.rateCardVersionId)
        ? ('rate_card' as const)
        : optionRows.some((row) => row.rateCardVersionId)
          ? ('mixed' as const)
          : ('manual' as const),
      options,
    }
  })
}
