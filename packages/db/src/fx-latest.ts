/**
 * The rate a foreign-currency cost is taken at when nobody typed one.
 *
 * The cost and payables forms defaulted "rate to base" to 1 and the actions
 * trusted it, so a USD 2,900 cost was booked as KWD 2,900 while `fx_rates`
 * held 0.307. A typed rate still wins — the rate a cost was taken at belongs to
 * the cost (FR-RT-06) — and this answers only the blank.
 *
 * The latest rate on or before today, in either direction: feeds publish one
 * direction and the other is arithmetic, and a cost entered on a Friday must
 * not fail because the feed does not publish at the weekend. The same rule
 * `credit.ts` applies to exposure. Null when there is nothing on file, so the
 * caller refuses with a sentence rather than inventing 1.
 *
 * "Today" is the deployment's business day (`todayIn`), not the UTC date, so a
 * rate published for the 1st applies from midnight in Kuwait.
 */

import { and, eq, lte, sql } from 'drizzle-orm'
import { dec, todayIn } from '@qabandi/core'
import type { Tx } from './actor'
import { fxRates } from './schema/reference'
import { fxRateOrder } from './fx-feed'

export async function latestFxRate(tx: Tx, from: string, to: string): Promise<string | null> {
  if (from === to) return '1'
  const today = todayIn()

  const [direct] = await tx
    .select({ rate: fxRates.rate })
    .from(fxRates)
    .where(
      and(
        eq(fxRates.fromCurrency, from),
        eq(fxRates.toCurrency, to),
        lte(fxRates.effectiveOn, today),
      ),
    )
    // Newest day; on the same day a hand-entered rate beats the feed (`fx-feed.ts`).
    .orderBy(...fxRateOrder())
    .limit(1)
  if (direct) return direct.rate

  const [inverse] = await tx
    .select({ rate: fxRates.rate })
    .from(fxRates)
    .where(
      and(
        eq(fxRates.fromCurrency, to),
        eq(fxRates.toCurrency, from),
        lte(fxRates.effectiveOn, today),
        // A hand-entered zero would divide by zero below.
        sql`${fxRates.rate} <> 0`,
      ),
    )
    // Newest day; on the same day a hand-entered rate beats the feed (`fx-feed.ts`).
    .orderBy(...fxRateOrder())
    .limit(1)
  if (!inverse) return null

  // Eight places, which is what `fx_rate` (numeric(19,8)) stores.
  return dec(1).dividedBy(dec(inverse.rate)).toDecimalPlaces(8).toFixed()
}
