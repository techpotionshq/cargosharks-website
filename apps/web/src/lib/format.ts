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

export const TIME_ZONE = 'Asia/Kuwait'

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
    // Compact notation and three-decimal currencies do not mix legibly.
    ...(compact && Math.abs(value.amount) >= 10_000 ? { maximumFractionDigits: 1 } : {}),
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

export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale)).format(value)
}

export function formatDate(date: Date | null | undefined, locale: Locale): string {
  if (!date) return '—'
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: TIME_ZONE,
  }).format(date)
}

export function formatDateTime(date: Date | null | undefined, locale: Locale): string {
  if (!date) return '—'
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: TIME_ZONE,
  }).format(date)
}

export function formatDay(date: Date | null | undefined, locale: Locale): string {
  if (!date) return '—'
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: '2-digit',
    month: 'short',
    timeZone: TIME_ZONE,
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
  date: Date | null | undefined,
  locale: Locale,
  now = Date.now(),
): string {
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
