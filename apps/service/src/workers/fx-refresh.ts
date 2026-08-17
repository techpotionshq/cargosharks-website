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

import { inArray } from 'drizzle-orm'
import { currencies, fxRates, systemActor, withActor } from '@qabandi/db'
import { adapters } from '../adapters/index'
import { config } from '../config'

export interface FxRefreshResult {
  readonly source: string
  readonly written: number
  readonly skipped: string[]
}

export async function runFxRefresh(): Promise<FxRefreshResult> {
  const source = adapters().fx

  /*
    The manual source is not a failure and not worth a round trip.

    A deployment that has bought no feed still runs this schedule; answering
    "nothing to do" keeps the worker's shape identical in both configurations
    rather than making the caller ask which mode it is in.
  */
  if (source.key === 'manual') {
    return { source: 'manual', written: 0, skipped: [] }
  }

  const base = config.FX_BASE_CURRENCY.toUpperCase()
  const wanted = config.FX_QUOTE_CURRENCIES.split(',')
    .map((code) => code.trim().toUpperCase())
    .filter((code) => code !== '' && code !== base)

  const quotes = await source.fetch(base, wanted)

  return withActor(systemActor(), async (tx) => {
    /*
      Only currencies this deployment actually has.

      `fx_rates.from_currency` and `to_currency` are real foreign keys into
      `currencies`, so a feed that answers with a currency the operator has
      never configured would fail the whole insert — one unknown code losing
      every good rate in the batch. Filtering here keeps a broad feed from
      being a fragile one.
    */
    const known = new Set(
      (
        await tx
          .select({ code: currencies.code })
          .from(currencies)
          .where(inArray(currencies.code, [base, ...wanted]))
      ).map((row) => row.code),
    )

    if (!known.has(base)) {
      throw new Error(
        `FX_BASE_CURRENCY=${base} is not in the currencies table — seed it before ` +
          'enabling the feed, or the rates have nothing to hang off.',
      )
    }

    const usable = quotes.filter((quote) => known.has(quote.to))
    const skipped = quotes.filter((quote) => !known.has(quote.to)).map((quote) => quote.to)

    if (usable.length === 0) return { source: source.key, written: 0, skipped }

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
