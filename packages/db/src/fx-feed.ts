/**
 * How a reader chooses among `fx_rates` rows, and whether the feed is current.
 *
 * ## One order, everywhere
 *
 * `fx_rates_unique` is `(from, to, effective_on, source)`, so one pair can
 * hold several rows for one day: a feed's (`er-api`, `currency-api`, `http`)
 * and a person's (`manual`). Every reader takes the newest day on or before
 * the date it prices at, and then has to break the tie — and each reader broke
 * it differently or not at all. `pricing.ts` used `distinct on` with no
 * tie-break, which returns whichever row the scan met first; `fx-latest.ts`
 * took the latest `taken_at`, so a feed retry at 10:00 would quietly undo a
 * rate an administrator typed at 09:00.
 *
 * The rule now, in every reader: newest day first; on the same day a
 * hand-entered rate beats any feed; then the latest taken. A person who typed
 * a rate for today meant it — usually a bank's rate for a specific deal — and
 * a machine must not overrule them by running later.
 */

import { desc, sql, type SQL } from 'drizzle-orm'
import {
  FX_FEED_SOURCES,
  fxStaleness,
  quoteConversionDate,
  todayIn,
  type FxStaleness,
} from '@qabandi/core'
import type { Tx } from './actor'
import { fxRates } from './schema/reference'

/** For a Drizzle `.orderBy(...)` on `fx_rates`. */
export function fxRateOrder(): SQL[] {
  return [
    desc(fxRates.effectiveOn),
    sql`(${fxRates.source} = 'manual') desc`,
    desc(fxRates.takenAt),
  ]
}

/**
 * The same order for hand-written SQL over `fx_rates` with no alias, after
 * whatever `distinct on` columns lead the clause.
 */
export const FX_RATE_ORDER_SQL = sql.raw(
  `effective_on desc, (source = 'manual') desc, taken_at desc`,
)

/** The feed sources as a SQL list, for `source in (...)`. */
const FEED_SOURCES = sql.raw(FX_FEED_SOURCES.map((s) => `'${s}'`).join(', '))

export interface FxFeedStatus extends FxStaleness {
  /** When the newest feed row was written — "fetched at". */
  readonly lastFetchedAt: Date | null
  /** Which provider wrote that row. */
  readonly lastSource: string | null
}

/**
 * The feed's health: the newest feed rate per tracked pair, and its age.
 *
 * The pairs are the ones pricing reads — each tracked currency *into* each
 * active branch base — so "stale" means exactly "a quotation will be priced
 * at an old feed rate, or at a hand-typed one". Hand-entered rows do not
 * count: they keep working, but they are not evidence the feed is alive.
 */
export async function fxFeedStatus(tx: Tx, today: string = todayIn()): Promise<FxFeedStatus> {
  const result = await tx.execute(sql`
    with bases as (
      select distinct b.base_currency as base
        from branches b
        join currencies c on c.code = b.base_currency
       where b.is_active
    ),
    pairs as (
      select c.code as "from", bases.base as "to"
        from currencies c cross join bases
       where c.is_tracked and c.is_active and c.code <> bases.base
    )
    select p."from", p."to",
           (select max(f.effective_on)::text from fx_rates f
             where f.from_currency = p."from" and f.to_currency = p."to"
               and f.source in (${FEED_SOURCES}) and f.effective_on <= ${today}::date) as newest
      from pairs p
     order by p."from", p."to"
  `)
  const pairs = result.rows as unknown as { from: string; to: string; newest: string | null }[]

  const [last] = (
    await tx.execute(sql`
      select taken_at as "takenAt", source from fx_rates
       where source in (${FEED_SOURCES})
       order by taken_at desc limit 1
    `)
  ).rows as unknown as { takenAt: Date | string; source: string }[]

  return {
    ...fxStaleness(pairs, today),
    lastFetchedAt: last ? new Date(last.takenAt) : null,
    lastSource: last?.source ?? null,
  }
}

/**
 * The day an invoice's lines were converted at, or null if none were.
 *
 * An invoice's lines are in the invoice's own currency — `createInvoice`
 * refuses mixed currencies — so the conversion, where there was one, happened
 * earlier: a quotation priced off a USD card was converted into KWD, booked,
 * and its revenue lines billed here. The quotation's snapshot records that,
 * and `quoteConversionDate` reads it. The newest such day across the quoted
 * lines on this invoice is the one the footnote names.
 *
 * Callers run this under the system actor, and only for an invoice the
 * reader has already been shown: a customer may not read our charge lines or
 * the quotation's snapshot (it holds our costs), but the footnote on their own
 * invoice must not depend on that. What leaves is a single date, never a row.
 */
export async function invoiceConversionDate(tx: Tx, invoiceId: string): Promise<string | null> {
  const result = await tx.execute(sql`
    select distinct q.priced_snapshot as snapshot, q.currency
      from charge_lines c
      join quote_lines ql on c.source_kind = 'quote_line' and ql.id = c.source_id
      join quotes q on q.id = ql.quote_id
     where c.invoice_id = ${invoiceId}
  `)
  const days = (result.rows as unknown as { snapshot: unknown; currency: string }[])
    .map((row) => quoteConversionDate(row.snapshot, row.currency))
    .filter((day): day is string => day !== null)
    .sort()
  return days.at(-1) ?? null
}

/** One rate onto a base, with whose rate it was and when it was taken. */
export interface RateOnto {
  readonly from: string
  readonly to: string
  readonly rate: string
  readonly effectiveOn: string
  readonly source: string
  readonly takenAt: Date
}

/**
 * The rate each currency converts onto `base` at, on `on` — the one query.
 *
 * Pricing, the rate-reply comparison and the auto-award sweep all ask this,
 * and they used to ask it three ways: pricing bounded the date by the
 * enquiry's readiness day, the other two took the newest row of any date, so
 * a rate dated next month could rank replies by one figure while "Price it"
 * quoted another. One function now, with the shared order (`fxRateOrder`):
 * newest day on or before `on`, a hand-entered rate over the feed's that day.
 *
 * `places` is the base currency's minor units, for rounding a converted total
 * exactly as an amount in that currency is rounded — three for KWD.
 */
export async function ratesOnto(
  tx: Tx,
  froms: readonly string[],
  base: string,
  on: string = todayIn(),
): Promise<{ rates: Map<string, RateOnto>; places: number }> {
  const wanted = [...new Set(froms.filter((code) => code && code !== base))]
  const [currency] = (
    await tx.execute(sql`select minor_units as "minorUnits" from currencies where code = ${base}`)
  ).rows as unknown as { minorUnits: number }[]
  const places = currency?.minorUnits ?? 2
  if (wanted.length === 0) return { rates: new Map(), places }

  const rows = (
    await tx.execute(sql`
      select distinct on (from_currency)
             from_currency as "from", to_currency as "to", rate::text as rate,
             effective_on::text as "effectiveOn", source, taken_at as "takenAt"
        from fx_rates
       where to_currency = ${base}
         and from_currency in (${sql.join(
           wanted.map((code) => sql`${code}`),
           sql`, `,
         )})
         and effective_on <= ${on}::date
       order by from_currency, ${FX_RATE_ORDER_SQL}
    `)
  ).rows as unknown as (Omit<RateOnto, 'takenAt'> & { takenAt: Date | string })[]

  return {
    rates: new Map(rows.map((r) => [r.from, { ...r, takenAt: new Date(r.takenAt) }])),
    places,
  }
}
