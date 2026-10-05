import 'server-only'
import { and, desc, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  branches,
  enquiries,
  locations,
  partnerContacts,
  partnerCoverage,
  partners,
  rateCards,
  rateRequests,
  ratesOnto,
  withActor,
  type Actor,
} from '@qabandi/db'
import type {
  CoveringAgent,
  RateRequestsView,
  RateRequestView,
  RenewalView,
} from '@/lib/pilot/types'
import { convertToBase, D, todayIn } from '@qabandi/core'
import { named } from '@/lib/named'
import { usePilotFixtures } from '@/lib/pilot/source'
import { pilotCoveringAgents, pilotRateRequests, pilotRenewals } from '@/lib/pilot/fixtures'

/**
 * Every rate request on an enquiry, and what came back — FR-RT-10.
 *
 * The comparison the coordinator ranks agents on. Each reply's headline figure
 * is converted to the branch's base currency so USD, KWD and AED quotes sort
 * against each other; a pair with no FX rate on file is shown but marked
 * incomparable rather than ranked at a made-up number. The authority for the
 * figure is always the reply's own lines in `response`; this only ranks.
 */
/**
 * `locale` names the partner in the reader's language (F27). The fixtures carry
 * their agents in English only, as partners do on a real database today.
 */
export async function getEnquiryRateRequests(
  actor: Actor,
  enquiryId: string,
  locale: 'en' | 'ar' = 'en',
): Promise<RateRequestsView | null> {
  if (usePilotFixtures()) return pilotRateRequests(enquiryId)
  if (!enquiryId) return null

  return withActor(actor, async (tx) => {
    const [enquiry] = await tx
      .select({ branchId: enquiries.branchId, readyOn: enquiries.readyOn })
      .from(enquiries)
      .where(eq(enquiries.id, enquiryId))
      .limit(1)
    if (!enquiry) return null

    const [branch] = await tx
      .select({ baseCurrency: branches.baseCurrency })
      .from(branches)
      .where(eq(branches.id, enquiry.branchId))
      .limit(1)
    const baseCurrency = branch?.baseCurrency ?? 'KWD'

    const rows = await tx
      .select({
        id: rateRequests.id,
        partnerId: rateRequests.partnerId,
        partnerName: named(locale, partners.legalNameEn, partners.legalNameAr),
        status: rateRequests.status,
        sentAt: rateRequests.sentAt,
        respondedAt: rateRequests.respondedAt,
        quotedTotal: rateRequests.quotedTotal,
        quotedCurrency: rateRequests.quotedCurrency,
        response: rateRequests.response,
        declinedReason: rateRequests.declinedReason,
        rateCardId: rateRequests.rateCardId,
      })
      .from(rateRequests)
      .innerJoin(partners, eq(rateRequests.partnerId, partners.id))
      .where(and(eq(rateRequests.enquiryId, enquiryId), ne(rateRequests.status, 'superseded')))
      .orderBy(desc(rateRequests.createdAt))

    // The FX rates needed to bring every quoted currency onto the base.
    const currencies = [
      ...new Set(
        rows
          .map((r) => r.quotedCurrency)
          .filter((c): c is string => Boolean(c) && c !== baseCurrency),
      ),
    ]
    /*
      The rates "Price it" would use: the same query (`ratesOnto`), on the
      same day — the enquiry's readiness date, or today. A comparison that
      ranked at one rate and a quotation priced at another is the
      disagreement this used to allow.
    */
    const { rates: fx, places } = await ratesOnto(
      tx,
      currencies,
      baseCurrency,
      enquiry.readyOn ?? todayIn(),
    )

    const requests: RateRequestView[] = rows.map((row) => {
      const response = (row.response ?? {}) as {
        ok?: boolean
        rows?: unknown[]
        declined?: boolean
        laneMismatch?: string
        unpriced?: number
        partial?: number
      }
      const lineCount = Array.isArray(response.rows) ? response.rows.length : 0
      /*
        The lines that make the total partial, not every unpriced one (R1): a
        percent line (insurance at 0.3%) is unpriced on every reply alike and
        left none of them comparable. Older replies carry only `unpriced`.
      */
      const unpricedLines =
        typeof response.partial === 'number'
          ? response.partial
          : typeof response.unpriced === 'number'
            ? response.unpriced
            : 0

      const normalizedTotal = convertToBase(
        row.quotedTotal,
        row.quotedCurrency,
        baseCurrency,
        row.quotedCurrency ? fx.get(row.quotedCurrency)?.rate : null,
        places,
      )

      /*
        A reply that priced another lane than the one asked about is shown,
        with the mismatch, and never offered as this enquiry's buy rate (S14):
        accepted, it wrote a card for a lane nobody asked to cover.
      */
      const canPromote =
        row.status === 'parsed' &&
        response.ok === true &&
        response.declined !== true &&
        !response.laneMismatch &&
        row.rateCardId === null &&
        lineCount > 0

      return {
        id: row.id,
        partnerId: row.partnerId,
        partnerName: row.partnerName,
        status: row.status,
        sentAt: row.sentAt,
        respondedAt: row.respondedAt,
        quotedTotal: row.quotedTotal,
        quotedCurrency: row.quotedCurrency,
        normalizedTotal,
        comparable: normalizedTotal !== null,
        isCheapest: false,
        lineCount,
        unpricedLines,
        laneMismatch: response.laneMismatch ?? null,
        declinedReason: row.declinedReason,
        canPromote,
        rateCardId: row.rateCardId,
      }
    })

    /*
      Cheapest among the answered, non-declined, comparable replies — and only
      the whole ones. A reply with lines its total could not price (a
      per-container charge on an FCL enquiry with no container count) carries a
      partial figure; ranked, it won "Cheapest" on its flat fees alone (F69).
      It is shown, marked partial, and left out, as a reply with no FX rate is.
    */
    const ranked = requests.filter(
      (r) =>
        r.comparable &&
        r.unpricedLines === 0 &&
        r.laneMismatch === null &&
        r.status !== 'declined' &&
        r.normalizedTotal !== null,
    )
    if (ranked.length > 0) {
      // Compared as decimals: two totals a fils apart are not equal floats.
      const cheapest = ranked.reduce((a, b) =>
        new D(a.normalizedTotal!).lte(new D(b.normalizedTotal!)) ? a : b,
      )
      const flagged = requests.map((r) => (r.id === cheapest.id ? { ...r, isCheapest: true } : r))
      requests.length = 0
      requests.push(...flagged)
    }

    return { baseCurrency, requests, ...replyCounts(requests) }
  })
}

/**
 * The panel's "N awaiting, N answered", from the statuses on the list.
 *
 * "Answered" is every request the agent has replied to, whatever became of the
 * reply: responded, parsed, accepted — and declined, because "no allocation
 * this month" is an answer and the coordinator is no longer waiting on it. It
 * counted only responded and parsed, so the moment a reply was accepted the
 * summary read "0 awaiting, 0 answered" above the accepted row (F65), and a
 * decline was never counted at all. `expired` is neither: the window closed
 * with nothing usable, so nobody is waiting and nobody answered. Exported so
 * the pilot fixture's figures are tested against the same rule.
 */
export function replyCounts(requests: readonly Pick<RateRequestView, 'status'>[]): {
  awaiting: number
  answered: number
} {
  return {
    awaiting: requests.filter((r) => r.status === 'sent').length,
    answered: requests.filter((r) => ANSWERED.has(r.status)).length,
  }
}

const ANSWERED: ReadonlySet<RateRequestView['status']> = new Set<RateRequestView['status']>([
  'responded',
  'parsed',
  'accepted',
  'declined',
])

/**
 * The agents that cover this enquiry's lane — the request-rates picker.
 *
 * Coverage is matched at the port where an agent declared a port, and at the
 * country where they declared a country (an overseas agent who quotes "anywhere
 * in China → Kuwait" rather than one port). An agent already asked for this
 * enquiry is returned flagged rather than hidden, so the picker can grey them
 * out instead of silently dropping a name a coordinator expected to see.
 */
/** `locale` names the agents in the reader's language (F27). */
export async function listCoveringAgents(
  actor: Actor,
  enquiryId: string,
  locale: 'en' | 'ar' = 'en',
): Promise<CoveringAgent[]> {
  if (usePilotFixtures()) return pilotCoveringAgents()
  if (!enquiryId) return []

  return withActor(actor, async (tx) => {
    const [enquiry] = await tx
      .select({
        mode: enquiries.mode,
        originId: enquiries.originId,
        destinationId: enquiries.destinationId,
      })
      .from(enquiries)
      .where(eq(enquiries.id, enquiryId))
      .limit(1)
    if (!enquiry || !enquiry.mode || !enquiry.originId || !enquiry.destinationId) return []

    const origin = await countryOf(tx, enquiry.originId)
    const destination = await countryOf(tx, enquiry.destinationId)

    const covering = await tx
      .selectDistinct({
        partnerId: partnerCoverage.partnerId,
        name: named(locale, partners.legalNameEn, partners.legalNameAr),
        type: partners.type,
        transitDays: partnerCoverage.transitDays,
      })
      .from(partnerCoverage)
      .innerJoin(partners, eq(partnerCoverage.partnerId, partners.id))
      .where(
        and(
          eq(partnerCoverage.mode, enquiry.mode),
          eq(partnerCoverage.isActive, true),
          or(
            eq(partnerCoverage.originId, enquiry.originId),
            origin ? eq(partnerCoverage.originCountry, origin) : sql`false`,
          ),
          or(
            eq(partnerCoverage.destinationId, enquiry.destinationId),
            destination ? eq(partnerCoverage.destinationCountry, destination) : sql`false`,
          ),
        ),
      )

    if (covering.length === 0) return []

    const partnerIds = covering.map((c) => c.partnerId)

    // Which of them have a usable contact, and which are already on this enquiry.
    const withEmail = new Set(
      (
        await tx
          .selectDistinct({ partnerId: partnerContacts.partnerId })
          .from(partnerContacts)
          .where(
            and(
              inArray(partnerContacts.partnerId, partnerIds),
              eq(partnerContacts.isActive, true),
              sql`${partnerContacts.email} is not null`,
            ),
          )
      ).map((r) => r.partnerId),
    )

    const already = new Set(
      (
        await tx
          .selectDistinct({ partnerId: rateRequests.partnerId })
          .from(rateRequests)
          .where(
            and(
              eq(rateRequests.enquiryId, enquiryId),
              inArray(rateRequests.partnerId, partnerIds),
              ne(rateRequests.status, 'superseded'),
            ),
          )
      ).map((r) => r.partnerId),
    )

    return covering.map((c) => ({
      partnerId: c.partnerId,
      name: c.name,
      type: c.type,
      transitDays: c.transitDays,
      hasEmail: withEmail.has(c.partnerId),
      alreadyRequested: already.has(c.partnerId),
    }))
  })
}

/**
 * Rate-card renewals the expiry sweep has in flight — FR-RT-11.
 *
 * These are the RFQs no coordinator sent: opened by the nightly sweep against a
 * card nearing expiry, sourced from the card rather than an enquiry, and shown
 * on the Rates screen because that is where a renewal belongs. A parsed reply is
 * one accept from a successor card. Superseded and long-accepted rows drop off;
 * what stays is what still wants a person's eye.
 */
/** `locale` names the partner in the reader's language (F27). */
export async function getRenewals(
  actor: Actor,
  locale: 'en' | 'ar' = 'en',
): Promise<RenewalView[]> {
  if (usePilotFixtures()) return pilotRenewals()

  return withActor(actor, async (tx) => {
    const origin = alias(locations, 'renewal_origin')
    const destination = alias(locations, 'renewal_destination')

    const rows = await tx
      .select({
        id: rateRequests.id,
        partnerName: named(locale, partners.legalNameEn, partners.legalNameAr),
        mode: rateCards.mode,
        originCode: origin.unlocode,
        destinationCode: destination.unlocode,
        oldValidTo: rateCards.validTo,
        status: rateRequests.status,
        quotedTotal: rateRequests.quotedTotal,
        quotedCurrency: rateRequests.quotedCurrency,
        response: rateRequests.response,
        declinedReason: rateRequests.declinedReason,
        rateCardId: rateRequests.rateCardId,
      })
      .from(rateRequests)
      .innerJoin(partners, eq(rateRequests.partnerId, partners.id))
      .innerJoin(rateCards, eq(rateRequests.sourceRateCardId, rateCards.id))
      .leftJoin(origin, eq(rateCards.originId, origin.id))
      .leftJoin(destination, eq(rateCards.destinationId, destination.id))
      .where(and(isNotNull(rateRequests.sourceRateCardId), ne(rateRequests.status, 'superseded')))
      .orderBy(desc(rateRequests.createdAt))
      .limit(100)

    return rows.map((row): RenewalView => {
      const response = (row.response ?? {}) as {
        ok?: boolean
        declined?: boolean
        rows?: unknown[]
      }
      const lineCount = Array.isArray(response.rows) ? response.rows.length : 0
      return {
        id: row.id,
        partnerName: row.partnerName,
        lane: `${row.originCode ?? '—'} → ${row.destinationCode ?? '—'}`,
        mode: row.mode,
        status: row.status as RenewalView['status'],
        oldValidTo: row.oldValidTo,
        quotedTotal: row.quotedTotal,
        quotedCurrency: row.quotedCurrency,
        lineCount,
        declinedReason: row.declinedReason,
        canPromote:
          row.status === 'parsed' &&
          response.ok === true &&
          response.declined !== true &&
          row.rateCardId === null &&
          lineCount > 0,
      }
    })
  })
}

/** The country a location sits in, for country-level coverage matching. */
async function countryOf(
  tx: Parameters<Parameters<typeof withActor>[1]>[0],
  locationId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ country: locations.countryCode })
    .from(locations)
    .where(eq(locations.id, locationId))
    .limit(1)
  return row?.country ?? null
}
