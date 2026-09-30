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
 * ## Idempotent by the unique key, not by checking first
 *
 * `fx_rates_unique` is `(from, to, effective_on, source)`. Running twice in a
 * day writes the same row twice and the second is discarded, so a retry after
 * a partial failure is safe and needs no bookkeeping. The rate for a day is
 * therefore the first one seen that day — deliberately, because an invoice
 * raised at 09:00 and reconciled against a rate that moved at 16:00 is the
 * discrepancy this table exists to prevent.
 */

import { eq } from 'drizzle-orm'
import { D } from '@qabandi/core'
import { branches, currencies, fxRates, systemActor, withActor } from '@qabandi/db'
import { fxSource } from '../adapters/index'

export interface FxRefreshResult {
  readonly source: string
  readonly written: number
  readonly skipped: string[]
  /** The base currencies asked about — one per distinct branch base. */
  readonly bases: string[]
}

export async function runFxRefresh(): Promise<FxRefreshResult> {
  const source = await fxSource()

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
    One call per base, outside any transaction.

    Two entities on different currencies is the normal shape of this product,
    not an edge case — Kuwait invoices in KWD and Dubai in AED — so the feed is
    asked once for each. Sequentially rather than in parallel: these are
    metered, rate-limited endpoints, and two bases is two calls a day.

    Outside the transaction because each is a fifteen-second timeout against
    somebody else's gateway, and holding a pooled connection across it lets one
    slow provider take a connection out of a pool of ten every morning.
  */
  const usable: { from: string; to: string; rate: string; source: string; effectiveOn: string }[] =
    []
  const skipped: string[] = []

  for (const base of bases) {
    const quotes = await source.fetch(
      base,
      wanted.filter((code) => code !== base),
    )

    const known = new Set([base, ...wanted])
    for (const quote of quotes) {
      if (known.has(quote.to)) usable.push(quote)
      else skipped.push(quote.to)
    }
  }

  if (usable.length === 0) return { source: source.key, written: 0, skipped, bases }

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
    the column's eight places; never a JS number. The outward row stays, for
    `credit.ts`, which reads either direction.
  */
  const rows = usable.flatMap((quote) => {
    const outward = {
      fromCurrency: quote.from,
      toCurrency: quote.to,
      rate: quote.rate,
      source: quote.source,
      effectiveOn: quote.effectiveOn,
    }
    const rate = new D(quote.rate)
    if (rate.lte(0)) return [outward]
    const inward = { ...outward, fromCurrency: quote.to, toCurrency: quote.from }
    return [outward, { ...inward, rate: new D(1).div(rate).toDecimalPlaces(8).toFixed(8) }]
  })

  return withActor(systemActor(), async (tx) => {
    await tx.insert(fxRates).values(rows).onConflictDoNothing()

    return { source: source.key, written: usable.length, skipped, bases }
  })
}
