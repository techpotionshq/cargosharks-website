/**
 * Automatic rate award — FR-RT-10, the far end of the fan-out.
 *
 * Auto-fanout asks the agents; this awards the winner. Once an enquiry's replies
 * are in and its chosen strategy says it is time, the cheapest reply — priced to
 * the branch's base currency so a USD and a KWD quote sort honestly — becomes a
 * buy rate card through the very same `promoteRateReply` a coordinator's Accept
 * click runs. It is the first automated step that commits money, so the setting
 * is not a switch but a *strategy*:
 *
 *   first  award the moment one comparable reply parses — fastest, least likely
 *          to be the cheapest.
 *   all    wait until no agent is still outstanding, then take the cheapest.
 *   wait   wait `waitHours` from the first RFQ, then take the cheapest of what
 *          came back — a deadline a silent agent cannot stall.
 *
 * An enquiry with an accepted reply is done, which is the loop-breaker: the
 * award sets one reply `accepted`, and the next sweep passes the enquiry by.
 */

import { and, eq, isNull, sql } from 'drizzle-orm'
import {
  branches,
  fxRates,
  promoteRateReply,
  rateRequests,
  systemActor,
  withActor,
  SYSTEM_PRINCIPAL_ID,
  type Tx,
} from '@qabandi/db'
import { integration, type LiveIntegration } from '../settings'

const STRATEGIES = ['first', 'all', 'wait'] as const
type Strategy = (typeof STRATEGIES)[number]

/** How many enquiries one sweep awards — a backlog drains steadily. */
const ENQUIRY_BATCH = 50
/** The wait window when the setting supplies none. */
const DEFAULT_WAIT_HOURS = 24
const HOUR_MS = 3_600_000

export interface AutoPromoteResult {
  readonly enabled: boolean
  /** The strategy in force, or null when off. */
  readonly strategy: Strategy | null
  /** Enquiries a buy card was awarded on. */
  readonly promoted: number
  /** Enquiries considered whose reply could not be promoted (refused, or no comparable). */
  readonly skipped: number
}

const EMPTY: AutoPromoteResult = { enabled: false, strategy: null, promoted: 0, skipped: 0 }

export interface AutoPromoteDeps {
  /** The resolved gate, injected in tests (the settings snapshot is cached). */
  readonly source?: LiveIntegration
}

export async function autoPromoteRateReplies(
  deps: AutoPromoteDeps = {},
): Promise<AutoPromoteResult> {
  const source = deps.source ?? (await integration('rateAutoPromote'))
  const strategy = source.driver as Strategy
  if (!STRATEGIES.includes(strategy)) return EMPTY

  const waitHours = Math.max(source.number('waitHours', DEFAULT_WAIT_HOURS), 0)
  const actor = systemActor()

  const candidates = await withActor(actor, (tx) => loadCandidates(tx, strategy, waitHours))

  let promoted = 0
  let skipped = 0

  for (const candidate of candidates) {
    // Per enquiry, so one lane's failure is not the sweep's, and the readiness
    // check and the award share the transaction — a reply cannot be promoted
    // twice by two overlapping sweeps.
    try {
      const outcome = await withActor(actor, async (tx) => {
        if (!(await ready(tx, candidate.enquiryId, strategy, waitHours))) return 'waiting'
        const cheapestId = await cheapestReply(tx, candidate.enquiryId, candidate.branchId)
        if (!cheapestId) return 'none'
        const result = await promoteRateReply(tx, cheapestId, SYSTEM_PRINCIPAL_ID)
        return result.ok ? 'awarded' : 'refused'
      })

      if (outcome === 'awarded') promoted += 1
      else if (outcome === 'refused' || outcome === 'none') skipped += 1
    } catch {
      skipped += 1
    }
  }

  return { enabled: true, strategy, promoted, skipped }
}

/**
 * Enquiries with a promotable parsed reply and nothing awarded yet.
 *
 * A reply the sweep cannot award stays a candidate, and with no order the same
 * fifty came back every sweep: past fifty of them, nothing behind was ever
 * awarded. Two guards. The strategy's readiness is asked here as well as per
 * enquiry, so a reply still inside its window or still waiting on an agent
 * does not hold a place in the batch; and the newest reply comes first, so a
 * backlog of refusals cannot hold a fresh award back. `ready()` still decides
 * inside the award's transaction — this only chooses who is looked at.
 */
async function loadCandidates(
  tx: Tx,
  strategy: Strategy,
  waitHours: number,
): Promise<{ enquiryId: string; branchId: string }[]> {
  const readiness =
    strategy === 'all'
      ? sql`and not exists (
              select 1 from rate_requests s
               where s.enquiry_id = r.enquiry_id and s.status = 'sent'
            )`
      : strategy === 'wait'
        ? sql`and (select min(w.created_at) from rate_requests w where w.enquiry_id = r.enquiry_id)
                <= now() - ${waitHours} * interval '1 hour'`
        : sql``
  const result = await tx.execute(sql`
    select r.enquiry_id as "enquiryId", r.branch_id as "branchId"
      from rate_requests r
     where r.status = 'parsed'
       and r.enquiry_id is not null
       and r.rate_card_id is null
       and not exists (
         select 1 from rate_requests a
          where a.enquiry_id = r.enquiry_id and a.status = 'accepted'
       )
       ${readiness}
     group by r.enquiry_id, r.branch_id
     order by max(r.created_at) desc
     limit ${ENQUIRY_BATCH}
  `)
  return result.rows as { enquiryId: string; branchId: string }[]
}

/** Whether the enquiry's chosen strategy says it is time to award. */
async function ready(
  tx: Tx,
  enquiryId: string,
  strategy: Strategy,
  waitHours: number,
): Promise<boolean> {
  if (strategy === 'first') return true

  if (strategy === 'all') {
    const [pending] = await tx
      .select({ n: sql<number>`count(*)` })
      .from(rateRequests)
      .where(and(eq(rateRequests.enquiryId, enquiryId), eq(rateRequests.status, 'sent')))
    return Number(pending?.n ?? 0) === 0
  }

  // 'wait' — the earliest RFQ is older than the window.
  const [earliest] = await tx
    .select({ at: sql<Date | null>`min(${rateRequests.createdAt})` })
    .from(rateRequests)
    .where(eq(rateRequests.enquiryId, enquiryId))
  if (!earliest?.at) return false
  return new Date(earliest.at).getTime() <= Date.now() - waitHours * HOUR_MS
}

/**
 * The id of the cheapest promotable reply, priced to the branch's base currency.
 *
 * One reply is trivially the cheapest and needs no rate. With several, the ones
 * that can be brought onto the base are ranked and the lowest wins; a set where
 * none can be compared (no FX on file) is left for a person rather than awarded
 * on a currency nobody converted.
 */
async function cheapestReply(tx: Tx, enquiryId: string, branchId: string): Promise<string | null> {
  const [branch] = await tx
    .select({ base: branches.baseCurrency })
    .from(branches)
    .where(eq(branches.id, branchId))
    .limit(1)
  const base = branch?.base ?? 'KWD'

  const rows = await tx
    .select({
      id: rateRequests.id,
      quotedTotal: rateRequests.quotedTotal,
      quotedCurrency: rateRequests.quotedCurrency,
      response: rateRequests.response,
    })
    .from(rateRequests)
    .where(
      and(
        eq(rateRequests.enquiryId, enquiryId),
        eq(rateRequests.status, 'parsed'),
        isNull(rateRequests.rateCardId),
      ),
    )
    .orderBy(rateRequests.createdAt)

  const promotable = rows.filter((r) => {
    const response = (r.response ?? {}) as { ok?: boolean; rows?: unknown[] }
    return response.ok === true && Array.isArray(response.rows) && response.rows.length > 0
  })

  if (promotable.length === 0) return null
  if (promotable.length === 1) return promotable[0]!.id

  const currencies = [
    ...new Set(
      promotable.map((r) => r.quotedCurrency).filter((c): c is string => Boolean(c) && c !== base),
    ),
  ]
  const fx = await latestRates(tx, currencies, base)

  let bestId: string | null = null
  let bestValue = Infinity
  for (const r of promotable) {
    const normalised = normalise(r.quotedTotal, r.quotedCurrency, base, fx)
    if (normalised === null) continue
    const value = Number(normalised)
    if (Number.isFinite(value) && value < bestValue) {
      bestValue = value
      bestId = r.id
    }
  }
  return bestId
}

/** The most recent rate for each currency onto the base, as a string map. */
async function latestRates(
  tx: Tx,
  froms: readonly string[],
  base: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (froms.length === 0) return map

  const rows = await tx
    .select({
      fromCurrency: fxRates.fromCurrency,
      rate: fxRates.rate,
      effectiveOn: fxRates.effectiveOn,
    })
    .from(fxRates)
    .where(and(inCurrencies(froms), eq(fxRates.toCurrency, base)))
    .orderBy(sql`${fxRates.effectiveOn} desc`)

  for (const row of rows) {
    if (!map.has(row.fromCurrency)) map.set(row.fromCurrency, row.rate)
  }
  return map
}

const inCurrencies = (froms: readonly string[]) =>
  sql`${fxRates.fromCurrency} in (${sql.join(
    froms.map((c) => sql`${c}`),
    sql`, `,
  )})`

/** A quoted total on the base currency, or null when it cannot be brought there. */
function normalise(
  total: string | null,
  currency: string | null,
  base: string,
  fx: ReadonlyMap<string, string>,
): string | null {
  if (!total || !currency) return null
  if (currency === base) return total
  const rate = fx.get(currency)
  if (!rate) return null
  const converted = Number(total) * Number(rate)
  return Number.isFinite(converted) ? converted.toFixed(3) : null
}
