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
import { currencies, fxRates, systemActor, withActor } from '@qabandi/db'
import { fxSource } from '../adapters/index'
import { integration } from '../settings'

export interface FxRefreshResult {
  readonly source: string
  readonly written: number
  readonly skipped: string[]
}

export async function runFxRefresh(): Promise<FxRefreshResult> {
  const settings = await integration('fx')
  const source = await fxSource()

  /*
    The manual source is not a failure and not worth a round trip.

    A deployment that has bought no feed still runs this schedule; answering
    "nothing to do" keeps the worker's shape identical in both configurations
    rather than making the caller ask which mode it is in.
  */
  if (source.key === 'manual') {
    return { source: 'manual', written: 0, skipped: [] }
  }

  const base = (settings.text('base') ?? 'KWD').toUpperCase()

  /*
    Which currencies to fetch is a column on `currencies`, not a list.

    `FX_QUOTE_CURRENCIES` was a comma-separated string in the environment — a
    second answer to a question this table already answered, free to disagree
    with it, and it did: a currency an administrator added here was invisible
    to the feed until somebody edited a deployment variable. The old code then
    intersected the two anyway, which is the tell that only one of them was
    ever the real list.

    Reading it from the table also removes the failure that intersection
    existed for. `fx_rates.from_currency` and `to_currency` are real foreign
    keys, so a code that is not a row cannot be asked for in the first place.
  */
  const { wanted, hasBase } = await withActor(systemActor(), async (tx) => {
    const rows = await tx
      .select({ code: currencies.code, tracked: currencies.isTracked })
      .from(currencies)
      .where(eq(currencies.isActive, true))

    return {
      wanted: rows
        .filter((row) => row.tracked)
        .map((row) => row.code.toUpperCase())
        .filter((code) => code !== base),
      hasBase: rows.some((row) => row.code.toUpperCase() === base),
    }
  })

  if (!hasBase) {
    throw new Error(
      `The FX base currency ${base} is not an active row in the currencies table — ` +
        'add it before enabling the feed, or the rates have nothing to hang off.',
    )
  }

  if (wanted.length === 0) return { source: source.key, written: 0, skipped: [] }

  /*
    Fetched outside the transaction, and that is not a detail.

    This is a fifteen-second timeout against somebody else's gateway. Holding a
    pooled connection open across it would let one slow provider take a
    connection out of a pool of ten for the duration, every morning — a
    database problem caused by a currency API, which is the hardest kind of
    incident to attribute.
  */
  const quotes = await source.fetch(base, wanted)

  const known = new Set([base, ...wanted])
  const usable = quotes.filter((quote) => known.has(quote.to))
  const skipped = quotes.filter((quote) => !known.has(quote.to)).map((quote) => quote.to)

  if (usable.length === 0) return { source: source.key, written: 0, skipped }

  return withActor(systemActor(), async (tx) => {
    await tx
      .insert(fxRates)
      .values(
        usable.map((quote) => ({
          fromCurrency: quote.from,
          toCurrency: quote.to,
          rate: quote.rate,
          source: quote.source,
          effectiveOn: quote.effectiveOn,
        })),
      )
      .onConflictDoNothing()

    return { source: source.key, written: usable.length, skipped }
  })
}
