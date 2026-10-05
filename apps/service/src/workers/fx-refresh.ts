/**
 * Daily FX refresh — FR-RT-06, §7.2.
 *
 * Writes a dated row into `fx_rates` for every currency this operator trades
 * in. Nothing reads the feed at quote time: a charge line stores the rate it
 * was struck at and the moment it was taken, so the feed's whole job is to
 * make sure a fresh rate is *available*, never to answer a question while
 * somebody is waiting.
 *
 * That separation is what makes a slow or rate-limited provider a monitoring
 * problem rather than an outage.
 *
 * ## Nothing here is configured
 *
 * Both halves of "what to fetch" are derived rather than set. The bases are
 * the distinct `base_currency` of the active branches; the quotes are the
 * currencies marked `is_tracked`. There is no setting for either, because
 * every value a setting could hold is already a fact the database knows, and
 * the two were not merely redundant — they disagreed.
 *
 * `FX_BASE_CURRENCY` was a single deployment-wide currency, defaulting to
 * KWD. A Dubai entity invoicing in AED therefore had *no rates fetched at
 * all*, silently, on a deployment that looked correctly configured — and the
 * fault could only be seen by comparing an environment variable against a
 * column nobody thought to compare it to.
 *
 * ## Safe to run all day
 *
 * The schedule runs this several times a day (`queue.ts`), so a provider that
 * was down at 08:00 is caught at 11:00. That only works if a repeat run is
 * harmless, and it is in three ways:
 *
 *   - A base whose rows for today already exist is not fetched at all.
 *   - A pair that already has a feed row for the provider's date is skipped,
 *     *whichever feed wrote it*. `fx_rates_unique` includes `source`, so the
 *     key alone would let a `currency-api` row at 08:00 and an `er-api` row
 *     at 11:00 both stand for one day. The first rate seen for a day wins —
 *     an invoice raised at 09:00 and reconciled against a rate that moved at
 *     16:00 is the discrepancy this table exists to prevent.
 *   - The insert is still `on conflict do nothing`, for two runs racing.
 *
 * A hand-entered rate is never overwritten: it is another `source`, and
 * every reader prefers it on its day (`fx-feed.ts` in `packages/db`).
 *
 * ## Refused rather than written
 *
 * A rate that moved more than 10% from the last feed rate for its pair (1%
 * for a pair pegged to the dollar on both sides) is logged and not written.
 * The resilient driver has already cross-checked two providers and the Gulf
 * pegs before this sees it; this is the last check, against our own history.
 */

import { and, eq, inArray, lt, gte, sql } from 'drizzle-orm'
import { D, FX_FEED_SOURCES, MOVE_BASELINE_DAYS, moveProblem, todayIn } from '@qabandi/core'
import {
  branches,
  currencies,
  fxFeedStatus,
  fxRates,
  systemActor,
  withActor,
  type FxFeedStatus,
} from '@qabandi/db'
import { fxSource } from '../adapters/index'
import type { FxLog } from '../adapters/fx'
import type { FxQuote, FxRefusal } from '../ports/index'

export interface FxRefreshResult {
  readonly source: string
  readonly written: number
  readonly skipped: string[]
  /** The base currencies asked about — one per distinct branch base. */
  readonly bases: string[]
  /** Bases whose rows for today were already there, so nobody was asked. */
  readonly current?: string[]
  /** Pairs a provider or the move guard declined, each with its reason. */
  readonly refused?: FxRefusal[]
  /** Bases the source could not answer for at all, with the error. */
  readonly failed?: { base: string; error: string }[]
  /** The days the written rates are for, as the providers dated them. */
  readonly effectiveOn?: string[]
  /** Set when the newest feed rate for a tracked pair is past the limit. */
  readonly stale?: Pick<FxFeedStatus, 'ageDays' | 'stalePairs'>
}

export interface FxRefreshOptions {
  readonly log?: FxLog
  /** Injected by tests; the deployment's business day otherwise. */
  readonly today?: string
}

const quiet: FxLog = { info: () => {}, warn: () => {}, error: () => {} }

/** Days before `day`, as `YYYY-MM-DD`. */
function daysBefore(day: string, n: number): string {
  const at = new Date(`${day}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() - n)
  return at.toISOString().slice(0, 10)
}

export async function runFxRefresh(options: FxRefreshOptions = {}): Promise<FxRefreshResult> {
  const log = options.log ?? quiet
  const today = options.today ?? todayIn()
  const source = await fxSource(log)

  /*
    The manual source is not a failure and not worth a round trip.

    A deployment that has bought no feed still runs this schedule; answering
    "nothing to do" keeps the worker's shape identical in both configurations
    rather than making the caller ask which mode it is in.
  */
  if (source.key === 'manual') {
    return { source: 'manual', written: 0, skipped: [], bases: [] }
  }

  /*
    What to fetch, read entirely from rows that already exist.

    The bases are the distinct base currencies of the active branches — a
    branch is a legal entity that invoices in one currency (FR-ID-01), so the
    set of currencies this operator needs rates *into* is exactly that column.
    The quotes are `currencies.is_tracked`, which is the list of currencies the
    operator trades in with the metered ones ticked.

    Neither is a setting, and neither should be. A second answer to a question
    a column already answers is free to disagree with it, and both did.
  */
  const { bases, wanted } = await withActor(systemActor(), async (tx) => {
    const entities = await tx
      .selectDistinct({ code: branches.baseCurrency })
      .from(branches)
      .where(eq(branches.isActive, true))

    const tracked = await tx
      .select({ code: currencies.code, isTracked: currencies.isTracked })
      .from(currencies)
      .where(eq(currencies.isActive, true))

    const known = new Set(tracked.map((row) => row.code.toUpperCase()))

    return {
      /*
        Only bases that are currency rows. `branches.base_currency` is not a
        foreign key, so a typo there would otherwise be asked of the feed and
        written into `fx_rates`, which *is* a foreign key — one bad branch
        failing every good rate in the batch.
      */
      bases: entities
        .map((row) => row.code.toUpperCase())
        .filter((code) => known.has(code))
        .sort(),
      wanted: tracked.filter((row) => row.isTracked).map((row) => row.code.toUpperCase()),
    }
  })

  if (bases.length === 0 || wanted.length === 0) {
    return { source: source.key, written: 0, skipped: [], bases }
  }

  /*
    Which sources count as "the feed" for first-seen-wins. The resilient driver
    names both its providers; any other driver is judged by what it returns.
    The older single-URL `http` is in the list too, so switching driver in the
    middle of a day does not write a second rate for that day.
  */
  const family = new Set<string>([...FX_FEED_SOURCES, ...(source.sources ?? [])])

  /*
    A base is current when every tracked pair into it already has a feed row
    for today. Asking a provider for rates we will then discard is a call
    against somebody's free tier for nothing, five times a day.
  */
  const current = await withActor(systemActor(), async (tx) => {
    const rows = await tx
      .select({ from: fxRates.fromCurrency, to: fxRates.toCurrency })
      .from(fxRates)
      .where(and(eq(fxRates.effectiveOn, today), inArray(fxRates.source, [...family])))
    const have = new Set(rows.map((r) => `${r.from}|${r.to}`))
    return bases.filter((base) =>
      wanted.filter((code) => code !== base).every((code) => have.has(`${code}|${base}`)),
    )
  })

  /*
    One call per base, outside any transaction.

    Two entities on different currencies is the normal shape of this product,
    not an edge case — Kuwait invoices in KWD and Dubai in AED — so the feed is
    asked once for each. Sequentially rather than in parallel: these are
    rate-limited endpoints, and two bases is two calls.

    Outside the transaction because each can wait out a timeout against
    somebody else's gateway, and holding a pooled connection across it lets one
    slow provider take a connection out of a pool of ten every morning.

    One base failing does not lose the others: Dubai's rates are no less
    correct because the KWD request timed out.
  */
  const usable: FxQuote[] = []
  const skipped: string[] = []
  const refused: FxRefusal[] = []
  const failed: { base: string; error: string }[] = []

  for (const base of bases) {
    if (current.includes(base)) continue
    const quotes = wanted.filter((code) => code !== base)
    try {
      const answer = source.fetchReport
        ? await source.fetchReport(base, quotes)
        : { quotes: await source.fetch(base, quotes), refused: [] }
      refused.push(...answer.refused)
      const known = new Set([base, ...wanted])
      for (const quote of answer.quotes) {
        if (known.has(quote.to)) usable.push(quote)
        else skipped.push(quote.to)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failed.push({ base, error: message })
      log.error({ base, err: message }, 'fx refresh: no rates for this base')
    }
  }

  for (const quote of usable) family.add(quote.source)

  /*
    Two checks against what is already stored, in one read.

    First seen wins: a pair that has a feed row for the quote's own date is
    dropped, whichever provider wrote it. Then the move guard: the newest feed
    rate for the pair in the week before is the baseline, and a quote that
    moved past the limit from it is refused and logged rather than written.
    Hand-entered rows are no baseline — an administrator may have typed a
    bank's rate for one deal — and nor is anything older than a week, or a
    real devaluation would be refused for ever (`MOVE_BASELINE_DAYS`).
  */
  const accepted = await withActor(systemActor(), async (tx) => {
    if (usable.length === 0) return []
    const days = [...new Set(usable.map((q) => q.effectiveOn))].sort()
    const earliest = daysBefore(days[0]!, MOVE_BASELINE_DAYS)
    const history = await tx
      .select({
        from: fxRates.fromCurrency,
        to: fxRates.toCurrency,
        rate: fxRates.rate,
        effectiveOn: fxRates.effectiveOn,
        source: fxRates.source,
      })
      .from(fxRates)
      .where(
        and(
          inArray(fxRates.source, [...family]),
          gte(fxRates.effectiveOn, earliest),
          lt(fxRates.effectiveOn, sql`(${days.at(-1)!}::date + 1)`),
        ),
      )

    const out: FxQuote[] = []
    for (const quote of usable) {
      const same = history.find(
        (r) => r.from === quote.from && r.to === quote.to && r.effectiveOn === quote.effectiveOn,
      )
      if (same) continue

      const floor = daysBefore(quote.effectiveOn, MOVE_BASELINE_DAYS)
      const previous = history
        .filter(
          (r) =>
            r.from === quote.from &&
            r.to === quote.to &&
            r.effectiveOn < quote.effectiveOn &&
            r.effectiveOn >= floor,
        )
        .sort((a, b) => (a.effectiveOn < b.effectiveOn ? 1 : -1))[0]
      const problem = moveProblem(
        quote.from,
        quote.to,
        new D(quote.rate),
        previous ? new D(previous.rate) : null,
      )
      if (problem) {
        refused.push({ pair: `${quote.from}→${quote.to}`, reason: problem })
        log.error({ pair: `${quote.from}→${quote.to}`, reason: problem }, 'fx: rate refused')
        continue
      }
      out.push(quote)
    }
    return out
  })

  /*
    Each rate is stored both ways.

    A feed answers from the base outwards — "1 KWD = 3.24 USD" — and that was
    the only row written. But every reader asks the other question: pricing,
    the rate-reply comparison and the auto-promote sweep all look for
    `to_currency = base` ("1 USD = ? KWD"), because a USD card is converted
    *into* the entity's currency. With only the outward row they found nothing,
    and a USD rate card refused to price on any deployment that switched the
    feed on — while the tests, which insert the inward row by hand, passed.

    The inward rate is the exact reciprocal in decimal arithmetic, rounded to
    the column's fourteen places — eight kept only six significant figures of
    a weak currency's reciprocal; never a JS number. The outward row stays,
    for `credit.ts`, which reads either direction.

    A quote the feed gave directly beats a reciprocal of the same pair. With
    two branch bases — KWD and AED — the KWD feed's reciprocal for AED→KWD and
    the AED feed's own AED→KWD quote share one unique key, and under `ON
    CONFLICT DO NOTHING` whichever came first won; the bases are fetched in
    sorted order, so that was the derived one. Reciprocals are dropped where
    the batch holds the direct quote, and inserted after the direct quotes in
    any case.
  */
  const pairKey = (r: { fromCurrency: string; toCurrency: string; effectiveOn: string }) =>
    `${r.fromCurrency}|${r.toCurrency}|${r.effectiveOn}`

  const direct = accepted.map((quote) => ({
    fromCurrency: quote.from,
    toCurrency: quote.to,
    rate: quote.rate,
    source: quote.source,
    effectiveOn: quote.effectiveOn,
  }))
  const quoted = new Set(direct.map(pairKey))
  const reciprocal = direct.flatMap((outward) => {
    const rate = new D(outward.rate)
    if (rate.lte(0)) return []
    const inward = {
      ...outward,
      fromCurrency: outward.toCurrency,
      toCurrency: outward.fromCurrency,
      rate: new D(1).div(rate).toDecimalPlaces(14).toFixed(14),
    }
    return quoted.has(pairKey(inward)) ? [] : [inward]
  })

  const written = await withActor(systemActor(), async (tx) => {
    if (direct.length === 0) return 0
    /*
      `written` is what was inserted, counted from the rows that came back. It
      reported the number of quotes, while twice as many rows were written on
      a first run and none at all on a same-day re-run.

      A reciprocal whose pair already has a feed row that day (written by an
      earlier run from the other base) is dropped by the same first-seen rule.
    */
    const directRows = await tx
      .insert(fxRates)
      .values(direct)
      .onConflictDoNothing()
      .returning({ id: fxRates.id })

    const days = [...new Set(reciprocal.map((r) => r.effectiveOn))]
    const existing =
      reciprocal.length === 0
        ? []
        : await tx
            .select({
              fromCurrency: fxRates.fromCurrency,
              toCurrency: fxRates.toCurrency,
              effectiveOn: fxRates.effectiveOn,
            })
            .from(fxRates)
            .where(and(inArray(fxRates.effectiveOn, days), inArray(fxRates.source, [...family])))
    const taken = new Set(existing.map(pairKey))
    const fresh = reciprocal.filter((r) => !taken.has(pairKey(r)))
    const inwardRows =
      fresh.length > 0
        ? await tx.insert(fxRates).values(fresh).onConflictDoNothing().returning({ id: fxRates.id })
        : []
    return directRows.length + inwardRows.length
  })

  /*
    Staleness, measured after writing so a run that just caught up says so.

    Error level, because nothing else will: a feed that stopped looks exactly
    like a feed that is working until a quotation goes out at last week's
    rate. The screens show the same warning (`fxFeedStatus`).
  */
  const status = await withActor(systemActor(), (tx) => fxFeedStatus(tx, today))
  if (status.stale) {
    log.error(
      { ageDays: status.ageDays, stalePairs: status.stalePairs },
      'fx: the newest automatic rate is more than three days old',
    )
  }

  return {
    source: source.key,
    written,
    skipped,
    bases,
    current,
    refused,
    failed,
    effectiveOn: [...new Set(accepted.map((q) => q.effectiveOn))].sort(),
    ...(status.stale ? { stale: { ageDays: status.ageDays, stalePairs: status.stalePairs } } : {}),
  }
}
