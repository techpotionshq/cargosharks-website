/**
 * Formatting — money, dates, durations.
 *
 * All of it locale-aware and all of it in the branch's time zone, because a
 * shipment that arrived at 23:40 in Kuwait must not read as the next day
 * because the server is in UTC (§11).
 *
 * Money is the case with a real trap. KWD has **three** decimal places, not
 * two: 1.5 KWD is `1.500`, and a quotation that prints `1.50` looks wrong to
 * everyone in the room. `Intl.NumberFormat` knows this per currency, so the
 * minor units are never hard-coded here — asking the platform is the whole
 * reason this file is four functions rather than a table.
 *
 * Numerals stay Western in both languages (`latn`). A container number read
 * against a printed document in Eastern Arabic numerals is how transcription
 * errors happen, and mixing the two systems within one screen is worse than
 * either alone.
 */

/**
 * Kept as the name the rest of the app already imports, and now one value
 * rather than two: `lib/time.ts` owns the default because the *arithmetic*
 * needed it first, and a second copy here is how the two halves drift apart.
 *
 * The formatters below take a zone rather than reading this. Every call site
 * now passes one — pages and panels ask `getTimeZone()`, which `next-intl`
 * resolves per request from the principal's column — so this is the fallback
 * for a caller with no request behind it (a test, a script) rather than the
 * value most dates are rendered in.
 */
export const TIME_ZONE = DEFAULT_TIME_ZONE

import { DEFAULT_TIME_ZONE } from '@/lib/time'

type Locale = 'en' | 'ar'

function intlLocale(locale: Locale): string {
  // `-u-nu-latn` forces Western digits; `ar-KW` alone would give Eastern ones.
  return locale === 'ar' ? 'ar-KW-u-nu-latn' : 'en-GB'
}

export function formatMoney(
  value: { amount: number; currency: string } | null | undefined,
  locale: Locale,
  options: { compact?: boolean; showCurrency?: boolean } = {},
): string {
  if (!value) return '—'
  const { compact = false, showCurrency = true } = options

  return new Intl.NumberFormat(intlLocale(locale), {
    style: showCurrency ? 'currency' : 'decimal',
    currency: value.currency,
    notation: compact && Math.abs(value.amount) >= 10_000 ? 'compact' : 'standard',
    /*
      Compact notation and three-decimal currencies do not mix legibly.

      Both bounds, and the minimum is the load-bearing half. KWD's CLDR default
      is three fraction digits, so naming only the maximum leaves ICU to
      reconcile a minimum of 3 against a maximum of 1 — and it does that by
      clamping the minimum *down to the maximum* rather than to zero. Every
      compacted dinar figure then carried a forced tenth: `KWD 25.0k` where the
      dashboard wants `KWD 25k`. Saying `minimumFractionDigits: 0` outright is
      the whole fix, and it makes the output the same under any ICU build
      instead of depending on how one resolves the conflict.
    */
    ...(compact && Math.abs(value.amount) >= 10_000
      ? { minimumFractionDigits: 0, maximumFractionDigits: 1 }
      : {}),
  }).format(value.amount)
}

/**
 * A `numeric(19,6)` column comes back as `"25000.000000"`.
 *
 * That is the right storage — money needs the scale, and §6 fixes it at six
 * places — but it is the wrong thing to put back into an editable field: the
 * operator typed `25000` and should see `25000`. Trims the trailing zeros
 * without touching the digits that matter, and leaves a genuine `0.50` alone.
 */
export function trimDecimal(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null
  if (!value.includes('.')) return value
  const trimmed = value.replace(/\.?0+$/, '')
  return trimmed === '' || trimmed === '-' ? '0' : trimmed
}

/**
 * Anything date-shaped, as a `Date` — or null.
 *
 * Every formatter below takes this rather than a bare `Date`, and the reason
 * is a real bug rather than defensive habit. A `timestamptz` read through the
 * query builder arrives as a `Date`; the same column read through a raw
 * `tx.execute` arrives as an **ISO string**, and this codebase now does both.
 * `Intl.DateTimeFormat.format` throws `RangeError: Invalid time value` on a
 * string, which took down the quotation page the first time it rendered.
 *
 * TypeScript could not catch it: the raw read's row is a cast, so the type
 * said `Date` and the runtime disagreed. Coercing here fixes every call site
 * at once and means no future raw query has to remember.
 *
 * An unparseable value returns null and formats as an em-dash rather than as
 * "Invalid Date" — a dash reads as "not recorded", which is what it is.
 */
function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale)).format(value)
}

export function formatDate(
  value: Date | string | number | null | undefined,
  locale: Locale,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  const date = toDate(value)
  if (!date) return '—'
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(date)
}

export function formatDateTime(
  value: Date | string | number | null | undefined,
  locale: Locale,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  const date = toDate(value)
  if (!date) return '—'
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(date)
}

export function formatDay(
  value: Date | string | number | null | undefined,
  locale: Locale,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  const date = toDate(value)
  if (!date) return '—'
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: '2-digit',
    month: 'short',
    timeZone,
  }).format(date)
}

/**
 * The clock alone — "09:15".
 *
 * For an event feed, where the date sits on its own line underneath and
 * repeating it on every row would bury the thing being scanned. Always
 * 24-hour, in both languages: a shipping schedule that says "7:00" without
 * saying which one has caused a missed sailing somewhere.
 */
export function formatTime(
  value: Date | string | number | null | undefined,
  locale: Locale,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  const date = toDate(value)
  if (!date) return '—'
  return new Intl.DateTimeFormat(intlLocale(locale), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(date)
}

/**
 * "in 3 hours", "2 days ago".
 *
 * The SLA column is the reason this exists: an operations manager scanning the
 * queue needs to know *how long is left*, and a timestamp makes them do the
 * arithmetic. `Intl.RelativeTimeFormat` gets the plural rules right in Arabic,
 * which has six of them and which no hand-rolled version survives.
 */
export function formatRelative(
  value: Date | string | number | null | undefined,
  locale: Locale,
  now = Date.now(),
): string {
  const date = toDate(value)
  if (!date) return '—'
  const diffMs = date.getTime() - now
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: 'auto' })

  const minutes = Math.round(diffMs / 60_000)
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute')

  const hoursValue = Math.round(diffMs / 3_600_000)
  if (Math.abs(hoursValue) < 48) return rtf.format(hoursValue, 'hour')

  return rtf.format(Math.round(diffMs / 86_400_000), 'day')
}

/** Percent with one decimal, which is the precision a margin is discussed at. */
export function formatPercent(value: number | null | undefined, locale: Locale): string {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value / 100)
}

/** A lane, in the reader's language and in the reader's direction. */
export function formatLane(originName: string, destinationName: string): string {
  // U+2192 renders correctly under RTL because the surrounding text direction
  // carries it; an ASCII "->" does not.
  return `${originName} → ${destinationName}`
}
