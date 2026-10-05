/**
 * What a feed's exchange rate has to survive before it is written — FR-RT-06.
 *
 * A free rates API is somebody else's cron job. It is usually right, and when
 * it is wrong it is wrong silently: a rate that is a decimal place out, a
 * currency code that moved, a stale mirror. Nothing downstream would notice,
 * because a charge line copies the rate onto itself at pricing time and an
 * invoice built on it reconciles wrong months later. So every check that can
 * catch a wrong number before it lands lives here, as arithmetic on decimals
 * with no I/O, and the service adapter and the worker both call it.
 *
 * ## Why the pegs are constants and not rows
 *
 * "Configuration is rows, not code" is the house rule, and this is a stated
 * exception. These are not settings an administrator tunes; they are the
 * published monetary policy of six central banks, unchanged for decades, used
 * here as a sanity bound with a 1% band. A row would invite somebody to widen
 * the band to make a refused rate go away, which is the one thing a guard must
 * not make easy. If a peg ever moves, the feed refuses the currency loudly and
 * the fix is a reviewed one-line change here, which is the right amount of
 * friction for a change of that size.
 */

import type { Decimal } from 'decimal.js'
import { D } from './money'

/**
 * Units of each currency per one US dollar, as the central bank fixes it.
 *
 * KWD is deliberately absent: it is pegged to an undisclosed basket, not to
 * the dollar, so it gets a band (`KWD_USD_BAND`) instead of a point.
 */
export const USD_PEGS: Readonly<Record<string, string>> = {
  AED: '3.6725',
  SAR: '3.75',
  QAR: '3.64',
  BHD: '0.376',
  OMR: '0.3845',
  JOD: '0.709',
}

/** How far a pegged currency may sit from its peg before it is refused. */
export const PEG_TOLERANCE = '0.01'

/**
 * US dollars per one Kuwaiti dinar that the feed may report.
 *
 * The basket has kept KWD between roughly 3.2 and 3.6 USD for twenty years; a
 * band of 3.0 to 3.5 is wide enough for any plausible move and narrow enough
 * to catch an inverted rate (0.31) or a misplaced decimal (32.4).
 */
export const KWD_USD_BAND = { min: '3.0', max: '3.5' } as const

/** How far two providers may disagree on a pair before neither is believed. */
export const PROVIDER_TOLERANCE = '0.01'

/** How far a rate may move from the last stored one for that pair. */
export const MOVE_TOLERANCE = { normal: '0.10', pegged: '0.01' } as const

/**
 * Past this many days the last stored rate is no baseline for the move guard.
 *
 * Without a horizon a genuine devaluation would be refused for ever: the
 * baseline only advances when a new rate is accepted, and the guard refuses
 * every new rate. A week of refusals, each logged, is enough for somebody to
 * look; after that the cross-check and the pegs still stand guard.
 */
export const MOVE_BASELINE_DAYS = 7

/** Past this many days the newest feed rate is stale. Weekends exist. */
export const STALE_AFTER_DAYS = 3

/**
 * The `source` values the automatic feeds write.
 *
 * `manual` is a person and `seed-demo` is a demo dataset; neither is a feed,
 * and counting either as one would let a hand-typed rate hide a feed that has
 * stopped. `http` is the configurable single-URL driver that predates these.
 */
export const FX_FEED_SOURCES = ['er-api', 'currency-api', 'http'] as const

/** Whether a currency is the dollar or fixed to it. */
export function isUsdBloc(code: string): boolean {
  return code === 'USD' || code in USD_PEGS
}

/**
 * Whether a pair should only ever move by a fraction of a percent.
 *
 * Both sides fixed to the dollar means the cross rate is fixed too: AED/SAR
 * has not moved since 1997. KWD/USD is not such a pair.
 */
export function isPeggedPair(a: string, b: string): boolean {
  return a !== b && isUsdBloc(a) && isUsdBloc(b)
}

/**
 * A provider's rate as a decimal, or null if it is not a usable rate.
 *
 * Takes the text the provider sent where it can, so the digits arrive exactly
 * as published rather than via a binary float. Refuses anything that is not a
 * finite number above zero: a zero would divide by zero in the reciprocal, a
 * negative is nonsense, and `Infinity` or `NaN` is a parsing accident.
 */
export function parseRate(value: unknown): Decimal | null {
  let text: string
  if (typeof value === 'string') text = value.trim()
  else if (typeof value === 'number') text = String(value)
  else return null
  if (!/^[+]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) return null
  try {
    const rate = new D(text)
    return rate.isFinite() && rate.gt(0) ? rate : null
  } catch {
    return null
  }
}

/** Relative difference of `b` from `a`, as a decimal fraction. */
function relative(a: Decimal, b: Decimal): Decimal {
  return b.minus(a).abs().dividedBy(a)
}

export interface Divergence {
  readonly code: string
  readonly primary: string
  readonly fallback: string
  /** As a percentage, two places. For the log line, never for arithmetic. */
  readonly percent: string
}

/**
 * Two providers' answers for one base, reconciled.
 *
 * Where both quote a currency and agree within `PROVIDER_TOLERANCE`, the
 * primary's figure is used — it is the one whose terms require attribution and
 * whose date is the most precise. Where they disagree by more, neither is
 * believed and the pair is refused for the day: one of them is wrong and this
 * code cannot know which. Where only one quotes it, that one is used.
 */
export function crossCheck(
  primary: ReadonlyMap<string, Decimal>,
  fallback: ReadonlyMap<string, Decimal>,
  codes: readonly string[],
): {
  readonly agreed: Map<string, { rate: Decimal; from: 'primary' | 'fallback' }>
  readonly diverged: Divergence[]
} {
  const agreed = new Map<string, { rate: Decimal; from: 'primary' | 'fallback' }>()
  const diverged: Divergence[] = []
  const tolerance = new D(PROVIDER_TOLERANCE)

  for (const code of codes) {
    const p = primary.get(code)
    const f = fallback.get(code)
    if (p && f) {
      const diff = relative(p, f)
      if (diff.lte(tolerance)) agreed.set(code, { rate: p, from: 'primary' })
      else
        diverged.push({
          code,
          primary: p.toString(),
          fallback: f.toString(),
          percent: diff.times(100).toFixed(2),
        })
    } else if (p) agreed.set(code, { rate: p, from: 'primary' })
    else if (f) agreed.set(code, { rate: f, from: 'fallback' })
  }
  return { agreed, diverged }
}

/**
 * Which currencies in one base's batch fail the Middle East pegs, and why.
 *
 * `rates` is "units of each currency per one unit of `base`", the shape every
 * provider answers in. The dollar's value is derived from the batch — X per
 * USD is rate(X) / rate(USD) — so no second request is needed and the check
 * works whatever the base is.
 *
 * The answer `'*'` means the base itself failed, and every rate in the batch
 * is suspect: if a feed says one dirham buys the wrong number of dollars, its
 * dirham-based quotes for everything else are built on the same mistake.
 */
export function checkPegs(base: string, rates: ReadonlyMap<string, Decimal>): Map<string, string> {
  const refused = new Map<string, string>()
  const usd = base === 'USD' ? new D(1) : rates.get('USD')
  const rateOf = (code: string) => (code === base ? new D(1) : rates.get(code))

  const offPeg = (code: string): string | null => {
    const peg = USD_PEGS[code]
    const rate = rateOf(code)
    if (!peg || !rate || !usd) return null
    const perUsd = rate.dividedBy(usd)
    const diff = relative(new D(peg), perUsd)
    return diff.gt(new D(PEG_TOLERANCE))
      ? `${code} at ${perUsd.toSignificantDigits(8).toString()} per USD, peg ${peg}`
      : null
  }

  const outOfBand = (): string | null => {
    const kwd = rateOf('KWD')
    if (!kwd || !usd) return null
    const usdPerKwd = usd.dividedBy(kwd)
    return usdPerKwd.lt(KWD_USD_BAND.min) || usdPerKwd.gt(KWD_USD_BAND.max)
      ? `KWD at ${usdPerKwd.toSignificantDigits(8).toString()} USD, outside ${KWD_USD_BAND.min}–${KWD_USD_BAND.max}`
      : null
  }

  // Without the dollar nothing in the bloc can be verified, so nothing in it
  // is accepted. Refusing is recoverable; an unverified peg is not.
  if (!usd) {
    for (const code of rates.keys()) {
      if (code in USD_PEGS || code === 'KWD') refused.set(code, 'no USD rate to verify the peg')
    }
    if (base in USD_PEGS || base === 'KWD') refused.set('*', 'no USD rate to verify the peg')
    return refused
  }

  const baseProblem = base in USD_PEGS ? offPeg(base) : base === 'KWD' ? outOfBand() : null
  if (baseProblem) {
    refused.set('*', baseProblem)
    return refused
  }

  for (const code of rates.keys()) {
    const problem = code in USD_PEGS ? offPeg(code) : code === 'KWD' ? outOfBand() : null
    if (problem) refused.set(code, problem)
  }
  return refused
}

/**
 * Whether a new rate moved too far from the last stored one for the pair.
 *
 * Null when it is acceptable, or a sentence for the log when it is not. The
 * limit is 10%, or 1% for a pair fixed to the dollar on both sides; no
 * baseline (a first run, or a pair newly tracked) accepts anything that
 * passed the other checks.
 */
export function moveProblem(
  from: string,
  to: string,
  next: Decimal,
  previous: Decimal | null,
): string | null {
  if (!previous || previous.lte(0)) return null
  const limit = new D(isPeggedPair(from, to) ? MOVE_TOLERANCE.pegged : MOVE_TOLERANCE.normal)
  const diff = relative(previous, next)
  return diff.gt(limit)
    ? `${from}→${to} moved ${diff.times(100).toFixed(2)}% (${previous.toString()} → ${next.toString()}), limit ${limit.times(100).toString()}%`
    : null
}

/** Whole days from `earlier` to `later`, both `YYYY-MM-DD`. */
export function daysBetween(earlier: string, later: string): number {
  const a = Date.UTC(+earlier.slice(0, 4), +earlier.slice(5, 7) - 1, +earlier.slice(8, 10))
  const b = Date.UTC(+later.slice(0, 4), +later.slice(5, 7) - 1, +later.slice(8, 10))
  return Math.round((b - a) / 86_400_000)
}

export interface FxPairAge {
  readonly from: string
  readonly to: string
  /** The newest feed rate's `effective_on`, or null if the feed never wrote one. */
  readonly newest: string | null
}

export interface FxStaleness {
  /** Whether any tracked pair's newest feed rate is older than the limit. */
  readonly stale: boolean
  /** Age in days of the stalest pair; null when no pair has ever had a feed rate. */
  readonly ageDays: number | null
  /** The newest date across all pairs, for "fetched on". */
  readonly newest: string | null
  readonly stalePairs: readonly string[]
}

/**
 * Whether the feed has stopped, decided from the newest feed row per pair.
 *
 * A pair the feed has never written counts as stale: a tracked currency with
 * no automatic rate at all is a feed that is not covering it. The caller only
 * asks when a feed driver is selected, so a manual deployment never sees this.
 */
export function fxStaleness(
  pairs: readonly FxPairAge[],
  today: string,
  limit: number = STALE_AFTER_DAYS,
): FxStaleness {
  let ageDays: number | null = null
  let newest: string | null = null
  const stalePairs: string[] = []
  for (const pair of pairs) {
    const age = pair.newest ? daysBetween(pair.newest, today) : null
    if (pair.newest && (!newest || pair.newest > newest)) newest = pair.newest
    if (age === null || age > limit) stalePairs.push(`${pair.from}→${pair.to}`)
    if (age !== null && (ageDays === null || age > ageDays)) ageDays = age
  }
  return { stale: stalePairs.length > 0, ageDays, newest, stalePairs }
}

/**
 * The day a quotation's lines were converted at, or null if none were.
 *
 * Read from `priced_snapshot`, which records the rates pricing used. A
 * conversion happened when a line was priced off a card in another currency;
 * the date is the newest `effectiveOn` of the rates used, so the footnote
 * names the rate's day rather than the day somebody pressed the button.
 *
 * Quotations priced before `converted` was recorded fall back to `lineCosts`
 * (a card currency other than the quotation's) and the pricing date, which is
 * what such a quotation was in fact converted on.
 */
export function quoteConversionDate(snapshot: unknown, currency: string): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const s = snapshot as Record<string, unknown>

  if (Array.isArray(s.converted)) {
    const days = (s.converted as unknown[])
      .map((entry) =>
        entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null,
      )
      .filter((entry) => entry !== null && entry.from !== currency)
      .map((entry) => (typeof entry!.effectiveOn === 'string' ? entry!.effectiveOn : null))
      .filter((day): day is string => day !== null && /^\d{4}-\d{2}-\d{2}$/.test(day))
      .sort()
    return days.at(-1) ?? null
  }

  const converted =
    Array.isArray(s.lineCosts) &&
    (s.lineCosts as unknown[]).some(
      (entry) =>
        !!entry &&
        typeof entry === 'object' &&
        typeof (entry as Record<string, unknown>).cardCurrency === 'string' &&
        (entry as Record<string, unknown>).cardCurrency !== currency,
    )
  if (!converted || typeof s.pricedAt !== 'string') return null
  return /^\d{4}-\d{2}-\d{2}/.test(s.pricedAt) ? s.pricedAt.slice(0, 10) : null
}

/**
 * A quoted total brought onto the base currency, or null when it cannot be.
 *
 * Decimal throughout and rounded half-up to the base's minor units, the way
 * an amount in that currency is rounded everywhere else: a reply of USD
 * 1,850.00 at 0.30917960428721 is KWD 571.982, to the fils. The comparison
 * used to multiply two JS numbers and `toFixed(3)` the product, which is
 * the global-float habit §11 forbids, and it ranked replies by a figure that
 * could differ in the last place from the one "Price it" then quoted.
 *
 * The same currency needs no rate. A missing or unusable rate is null, never
 * a guess — the screen shows that reply as not comparable.
 */
export function convertToBase(
  total: string | null | undefined,
  currency: string | null | undefined,
  base: string,
  rate: string | null | undefined,
  places: number,
): string | null {
  if (!total || !currency) return null
  let amount: Decimal
  try {
    amount = new D(total)
  } catch {
    return null
  }
  if (!amount.isFinite()) return null
  if (currency === base) return amount.toDecimalPlaces(places).toFixed(places)
  const r = parseRate(rate)
  if (!r) return null
  return amount.times(r).toDecimalPlaces(places).toFixed(places)
}
