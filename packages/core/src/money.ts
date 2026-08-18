/**
 * Currency-aware decimal arithmetic — Architecture §11.
 *
 * The only place in the system where money arithmetic happens. Amounts are
 * `numeric(19,6)` in the database and `Decimal` here; never a JS `number`,
 * never a float. FX rates are `numeric(19,8)`.
 *
 * Rounding is per currency and happens at the line, not globally (NFR-02):
 * KWD carries three minor units, AED/QAR/USD carry two. A single global
 * `toFixed(2)` would silently corrupt every KWD total in the system.
 */

import { Decimal } from 'decimal.js'
import { CurrencyMismatchError, UnknownCurrencyError } from './errors'

/**
 * A local Decimal constructor. Cloned rather than configured globally so that
 * importing this module cannot change arithmetic anywhere else in the process.
 *
 * 34 significant digits covers numeric(19,6) multiplied by numeric(19,8)
 * without intermediate loss; rounding to the currency's minor units happens
 * explicitly, at the end, via `round`.
 */
export const D = Decimal.clone({
  precision: 34,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -30,
  toExpPos: 30,
})

export type Numeric = Decimal | string | number

/** ISO 4217 code. Not an enum — the currencies table is admin-editable. */
export type CurrencyCode = string

export type RoundingMode = 'half_up' | 'half_even' | 'up' | 'down'

const ROUNDING: Record<RoundingMode, Decimal.Rounding> = {
  half_up: Decimal.ROUND_HALF_UP,
  half_even: Decimal.ROUND_HALF_EVEN,
  up: Decimal.ROUND_CEIL,
  down: Decimal.ROUND_FLOOR,
}

/**
 * Mirrors a row of the `currencies` table. Core never reads the table; the
 * caller passes the specification in, which keeps this module free of I/O and
 * makes "add a currency" an admin action rather than a release (FR-AD-03).
 */
export interface CurrencySpec {
  readonly code: CurrencyCode
  /** Decimal places. KWD 3, USD/AED/QAR/SAR 2, JPY 0. */
  readonly minorUnits: number
  readonly rounding?: RoundingMode
}

export interface Money {
  readonly amount: Decimal
  readonly currency: CurrencyCode
}

/**
 * The Gulf set plus the trade currencies Release One quotes in. This is a
 * development seed and a test fixture — at runtime the `currencies` table is
 * the authority, because FR-AD-03 says an administrator adds one without a
 * code change.
 */
export const SEED_CURRENCIES: readonly CurrencySpec[] = [
  { code: 'KWD', minorUnits: 3 },
  { code: 'BHD', minorUnits: 3 },
  { code: 'OMR', minorUnits: 3 },
  { code: 'USD', minorUnits: 2 },
  { code: 'EUR', minorUnits: 2 },
  { code: 'GBP', minorUnits: 2 },
  { code: 'AED', minorUnits: 2 },
  { code: 'QAR', minorUnits: 2 },
  { code: 'SAR', minorUnits: 2 },
  { code: 'INR', minorUnits: 2 },
  { code: 'CNY', minorUnits: 2 },
  { code: 'JPY', minorUnits: 0 },
]

export type CurrencyLookup = (code: CurrencyCode) => CurrencySpec | undefined

/** Builds a lookup from rows — seed rows in tests, table rows at runtime. */
export function currencyLookup(specs: Iterable<CurrencySpec>): CurrencyLookup {
  const byCode = new Map<CurrencyCode, CurrencySpec>()
  for (const spec of specs) byCode.set(spec.code, spec)
  return (code) => byCode.get(code)
}

export const seedCurrencyLookup: CurrencyLookup = currencyLookup(SEED_CURRENCIES)

// --- construction ----------------------------------------------------------

export function dec(value: Numeric): Decimal {
  return value instanceof Decimal ? new D(value.toString()) : new D(value)
}

export function money(amount: Numeric, currency: CurrencyCode): Money {
  return { amount: dec(amount), currency }
}

export function zero(currency: CurrencyCode): Money {
  return { amount: new D(0), currency }
}

/**
 * Parses the shape `numeric` comes back as over the wire. `node-postgres`
 * returns numeric as a string precisely so precision survives the trip, and
 * this is the only sanctioned way back into `Money`.
 */
export function fromDb(amount: string | null | undefined, currency: CurrencyCode): Money {
  return { amount: new D(amount ?? 0), currency }
}

/** The string form to hand back to `numeric` — never `Number(...)`. */
export function toDb(m: Money): string {
  return m.amount.toFixed()
}

// --- arithmetic ------------------------------------------------------------

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency)
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b)
  return { amount: a.amount.plus(b.amount), currency: a.currency }
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b)
  return { amount: a.amount.minus(b.amount), currency: a.currency }
}

export function multiply(m: Money, factor: Numeric): Money {
  return { amount: m.amount.times(dec(factor)), currency: m.currency }
}

export function divide(m: Money, divisor: Numeric): Money {
  return { amount: m.amount.dividedBy(dec(divisor)), currency: m.currency }
}

export function negate(m: Money): Money {
  return { amount: m.amount.negated(), currency: m.currency }
}

export function abs(m: Money): Money {
  return { amount: m.amount.abs(), currency: m.currency }
}

/** `percent` is expressed as a percentage: 12.5 means 12.5%, not 0.125. */
export function percentOf(m: Money, percent: Numeric): Money {
  return { amount: m.amount.times(dec(percent)).dividedBy(100), currency: m.currency }
}

/**
 * Sums a homogeneous list. `currency` is required for the empty case, because
 * a zero with no currency is the seed of every mixed-currency bug.
 */
export function sum(items: readonly Money[], currency: CurrencyCode): Money {
  return items.reduce<Money>((acc, item) => add(acc, item), zero(currency))
}

export function isZero(m: Money): boolean {
  return m.amount.isZero()
}

export function isNegative(m: Money): boolean {
  return m.amount.isNegative()
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b)
  return a.amount.comparedTo(b.amount) as -1 | 0 | 1
}

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amount.equals(b.amount)
}

export function max(a: Money, b: Money): Money {
  return compare(a, b) >= 0 ? a : b
}

export function min(a: Money, b: Money): Money {
  return compare(a, b) <= 0 ? a : b
}

/** Applies a minimum charge if one is configured — FR-RT-05. */
export function applyMinimum(m: Money, minimum: Money | null | undefined): Money {
  if (!minimum) return m
  return max(m, minimum)
}

// --- rounding --------------------------------------------------------------

/**
 * Rounds to the currency's minor units. Called at the line, once — see NFR-02.
 * Rounding a running total instead of each line is the difference between an
 * invoice that reconciles and one that is out by fils.
 */
export function round(m: Money, spec: CurrencySpec): Money {
  if (spec.code !== m.currency) throw new CurrencyMismatchError(m.currency, spec.code)
  const mode = ROUNDING[spec.rounding ?? 'half_up']
  return { amount: m.amount.toDecimalPlaces(spec.minorUnits, mode), currency: m.currency }
}

export function roundWith(m: Money, lookup: CurrencyLookup): Money {
  const spec = lookup(m.currency)
  if (!spec) throw new UnknownCurrencyError(m.currency)
  return round(m, spec)
}

// --- conversion ------------------------------------------------------------

/**
 * An FX rate as it is stored on a charge line — FR-RT-06.
 *
 * The rate and the moment it was taken travel together and are written onto
 * the row, never looked up again. That is what lets a USD-priced quote from
 * March reconcile against a KWD invoice raised in June.
 */
export interface FxRate {
  readonly from: CurrencyCode
  readonly to: CurrencyCode
  /** Units of `to` per one unit of `from`. numeric(19,8). */
  readonly rate: Decimal
  readonly takenAt: Date
}

export function fxRate(from: CurrencyCode, to: CurrencyCode, rate: Numeric, takenAt: Date): FxRate {
  return { from, to, rate: dec(rate), takenAt }
}

export function convert(m: Money, rate: FxRate): Money {
  if (m.currency !== rate.from) throw new CurrencyMismatchError(m.currency, rate.from)
  return { amount: m.amount.times(rate.rate), currency: rate.to }
}

/** Same currency in and out: the identity rate, so charge lines stay uniform. */
export function identityRate(currency: CurrencyCode, takenAt: Date): FxRate {
  return { from: currency, to: currency, rate: new D(1), takenAt }
}

// --- formatting ------------------------------------------------------------

/**
 * The bare amount at the currency's own precision — no symbol, no grouping.
 *
 * For the places that pair a figure with a currency code carried separately,
 * which is every notification template: they read `{{total}} {{currency}}`,
 * and `formatMoney` would put the code in twice.
 *
 * Neither `toDb` nor `toString` will do, and the reason is the trailing zeros.
 * `toDb` calls `toFixed()` with no argument, so a balance of exactly 380 KWD
 * comes out as `380` — right for a `numeric` column, wrong in a letter to a
 * customer, who is comparing it against an invoice that reads `380.000`. A
 * figure that has quietly dropped its fils looks like a different number.
 *
 * The other direction is just as wrong: `numeric(19,6)` hands back
 * `500.000000` for a KWD invoice, which is three decimals of precision the
 * currency does not have.
 */
export function toScale(m: Money, lookup: CurrencyLookup = seedCurrencyLookup): string {
  const spec = lookup(m.currency)
  if (!spec) throw new UnknownCurrencyError(m.currency)
  return round(m, spec).amount.toFixed(spec.minorUnits)
}

/**
 * Presentation only. The web layer formats through `next-intl`; this exists
 * for logs, PDFs generated outside a request, and test assertions.
 */
export function formatMoney(m: Money, spec: CurrencySpec, locale: 'en' | 'ar' = 'en'): string {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-KW' : 'en-KW', {
    style: 'currency',
    currency: m.currency,
    minimumFractionDigits: spec.minorUnits,
    maximumFractionDigits: spec.minorUnits,
  }).format(m.amount.toNumber())
}

export { Decimal }
