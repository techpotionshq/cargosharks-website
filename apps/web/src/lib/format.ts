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

import { D, fromDb, toScale } from '@qabandi/core'
import { DEFAULT_TIME_ZONE } from '@/lib/time'

type Locale = 'en' | 'ar'

function intlLocale(locale: Locale): string {
  // `-u-nu-latn` forces Western digits; `ar-KW` alone would give Eastern ones.
  return locale === 'ar' ? 'ar-KW-u-nu-latn' : 'en-GB'
}

/**
 * `amount` takes the decimal string the database hands back, and should.
 *
 * It used to take only a `number`, so every call site wrote
 * `Number(row.total)` first — a float conversion on the way to the screen,
 * harmless at today's figures and exactly the habit the money rule forbids.
 * `Intl.NumberFormat` formats a numeric *string* at full precision (it is
 * specified to, since ES2023), so the string goes straight through and the
 * `number` form stays for amounts that are genuinely computed for display.
 */
export function formatMoney(
  value: { amount: number | string; currency: string } | null | undefined,
  locale: Locale,
  options: { compact?: boolean; showCurrency?: boolean } = {},
): string {
  if (!value) return '—'
  const { formatter } = moneyFormat(value, locale, options)
  if (locale !== 'ar') return formatter.format(moneyOperand(value.amount))
  /*
    A Latin symbol in an Arabic figure is isolated left-to-right.

    ICU writes "‏1,850.00 US$" for Arabic, and in a right-to-left line the
    bidi algorithm reorders the Latin letters and the dollar sign around each
    other: rate requests, renewals, bills and settlements all read "$US
    1,850.00". `Money` already isolates its currency span (`dir="auto"`); this
    is the same isolation for the string form, so every inline figure and
    every sentence a figure is interpolated into gets it without a call site
    having to remember. An Arabic symbol (د.ك.) needs nothing and gets nothing.
  */
  return formatter
    .formatToParts(moneyOperand(value.amount))
    .map((part) =>
      part.type === 'currency' && /[A-Za-z]/.test(part.value)
        ? `${LTR_ISOLATE}${part.value}${POP_ISOLATE}`
        : part.value,
    )
    .join('')
}

const LTR_ISOLATE = '\u2066'
const POP_ISOLATE = '\u2069'

/** A string goes to `Intl` as a string, so it is never a float on the way. */
function moneyOperand(amount: number | string): number | Intl.StringNumericLiteral {
  return typeof amount === 'string' ? (amount as Intl.StringNumericLiteral) : amount
}

/**
 * The one `Intl.NumberFormat` behind both `formatMoney` and
 * `formatMoneyParts`, so the text and the table cell cannot drift apart.
 */
function moneyFormat(
  value: { amount: number | string; currency: string },
  locale: Locale,
  options: { compact?: boolean; showCurrency?: boolean },
): { formatter: Intl.NumberFormat; compacted: boolean } {
  const { compact = false, showCurrency = true } = options
  // Only the size test needs a number; the formatted figure never passes
  // through one.
  const magnitude = Math.abs(Number(value.amount))
  const compacted = compact && magnitude >= 10_000

  /*
    The currency's own places, also when the code is not printed.

    `style: 'decimal'` ignores `currency`, so `showCurrency: false` fell back
    to decimal defaults — zero to three places. A dinar figure lost its last
    zero ("1,145.69" beside "110.495" in one column) and a dollar figure gained
    a third place ("1,595,486.978 USD"). CLDR knows each currency's places; ask
    it rather than keep a table.
  */
  const places = new Intl.NumberFormat('en', {
    style: 'currency',
    currency: value.currency,
  }).resolvedOptions().maximumFractionDigits

  const formatter = new Intl.NumberFormat(intlLocale(locale), {
    style: showCurrency ? 'currency' : 'decimal',
    currency: value.currency,
    ...(showCurrency ? {} : { minimumFractionDigits: places, maximumFractionDigits: places }),
    notation: compacted ? 'compact' : 'standard',
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
    ...(compacted ? { minimumFractionDigits: 0, maximumFractionDigits: 1 } : {}),
  })
  return { formatter, compacted }
}

/** The widest minor unit a column of money has to line up against (KWD). */
const ALIGN_PLACES = 3
const FIGURE_SPACE = '\u2007'
const PUNCTUATION_SPACE = '\u2008'
// Bidi marks ICU puts around an Arabic figure. The cell isolates the figure
// itself, so left in they only shift it by a mark's width.
const BIDI_MARKS = /[\u061c\u200e\u200f]/g

/**
 * The same figure as `formatMoney`, in the pieces a table column needs.
 *
 * A column of money reads against its decimal point, and mixed currencies
 * broke that: "AED 5,502.00" above "KWD 980.250" ends one digit short, so
 * every figure in the dirham row sat a place to the left of the dinar row.
 * The code comes back on its own (a cell draws it muted, at the start), the
 * figure without it, and `pad` is the blank a short minor unit needs to end
 * where a three-place one does: a figure space per missing digit — the width
 * of a tabular digit — and a punctuation space for a missing decimal point.
 * Compact figures are not padded; they are not read against a column.
 *
 * `formatMoney` keeps its single string for every non-table use.
 */
export function formatMoneyParts(
  value: { amount: number | string; currency: string } | null | undefined,
  locale: Locale,
  options: { compact?: boolean; showCurrency?: boolean } = {},
): { currency: string | null; amount: string; pad: string } | null {
  if (!value) return null
  const { formatter, compacted } = moneyFormat(value, locale, options)
  const parts = formatter.formatToParts(moneyOperand(value.amount))
  const currency = parts.find((part) => part.type === 'currency')?.value ?? null
  // The space that joined code and figure goes with the code, or a negative
  // figure reads "- 1,500.000".
  const amount = parts
    .filter(
      (part) =>
        part.type !== 'currency' &&
        !(part.type === 'literal' && part.value.replace(BIDI_MARKS, '').trim() === ''),
    )
    .map((part) => part.value)
    .join('')
    .replace(BIDI_MARKS, '')
    .trim()
  const fraction = parts.find((part) => part.type === 'fraction')?.value.length ?? 0
  const pad = compacted
    ? ''
    : (fraction === 0 ? PUNCTUATION_SPACE : '') +
      FIGURE_SPACE.repeat(Math.max(0, ALIGN_PLACES - fraction))
  return { currency, amount, pad }
}

/**
 * How a currency is written beside a figure in the reader's language — "KWD"
 * in English, "د.ك." in Arabic — for a value and its unit set apart (a metric
 * tile, an option card). These printed the ISO code, so an Arabic tile said
 * KWD above a table that said د.ك. for the same money. Read off the same
 * formatter as `formatMoney`, so the two cannot disagree.
 */
export function currencyLabel(currency: string, locale: Locale): string {
  return formatMoneyParts({ amount: 0, currency }, locale)?.currency ?? currency
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
 * An exchange rate for reading, not for arithmetic.
 *
 * A feed stores the reciprocal of what it fetched to the column's full
 * scale, so AED→KWD printed as 0.08418840691961 beside USD→KWD 0.3091796
 * (live run 6, N7). Six significant digits for a rate below one (so a small
 * rate such as IDR→KWD keeps its figures) and six decimal places above it,
 * trailing zeros trimmed. Rounded as Decimal, never through a JS number; the
 * stored rate is untouched and is what pricing multiplies by.
 */
export function formatFxRate(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null
  try {
    const rate = new D(value)
    const shown = rate.abs().lt(1) ? rate.toSignificantDigits(6) : rate.toDecimalPlaces(6)
    return trimDecimal(shown.toFixed())
  } catch {
    return trimDecimal(value)
  }
}

/**
 * A stored amount, put back into an editable field at its currency's places —
 * QA P3.
 *
 * Edit dialogs were handed the column as stored, so a per-diem the operator
 * typed as 25 came back as "25.000000", and a USD balance as "4350.000" (a
 * hand-written `toFixed(3)`, KWD's places on a dollar figure). Rounded with
 * the money engine at the currency's minor units, as Decimal, never through a
 * float. A currency the seed does not know falls back to `trimDecimal`.
 */
export function amountInput(
  value: string | null | undefined,
  currency: string | null | undefined,
): string | undefined {
  if (value === null || value === undefined || value === '') return undefined
  if (!currency) return trimDecimal(value) ?? undefined
  try {
    return toScale(fromDb(value, currency))
  } catch {
    return trimDecimal(value) ?? undefined
  }
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

/**
 * A weight or a volume as a person reads it — R13, live run 5.
 *
 * The columns are `numeric(19,6)`, so the cargo table printed
 * "48000.000000 · 110.000000". Kilograms to at most two places, because a
 * weighbridge reading has no more and "48,000" is how a booking states it;
 * cubic metres always to three, because that is the trade's precision for a
 * W/M and an LCL rate is struck on it. The decimal string goes straight to
 * `Intl.NumberFormat`, which formats a string at full precision, so no float
 * stands in between. Western digits in both languages, as everywhere here.
 */
export function formatMeasure(
  value: string | number | null | undefined,
  unit: 'kg' | 'cbm',
  locale: Locale,
): string {
  if (value === null || value === undefined || value === '') return '—'
  const places = unit === 'kg' ? { min: 0, max: 2 } : { min: 3, max: 3 }
  const formatter = new Intl.NumberFormat(intlLocale(locale), {
    minimumFractionDigits: places.min,
    maximumFractionDigits: places.max,
  })
  // Typed for a number; formats a decimal string exactly (ES2023).
  return formatter.format(value as unknown as number)
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

/**
 * A lane, in the reader's language and in the reader's direction.
 *
 * The arrow is chosen by locale because it is not a mirrored character.
 * Under RTL the two names reorder — origin on the right, destination on the
 * left — while U+2192 kept pointing right, back at the origin: every Arabic
 * lane read as travelling backwards. `←` in Arabic points at the destination,
 * which is what the slice queries already do (`ledger`, `network`); this is the
 * same rule for the string a page builds itself. The drawn `Lane` component
 * is still preferred wherever markup is allowed.
 */
export function formatLane(
  originName: string,
  destinationName: string,
  locale: Locale = 'en',
): string {
  return `${originName} ${locale === 'ar' ? '←' : '→'} ${destinationName}`
}
