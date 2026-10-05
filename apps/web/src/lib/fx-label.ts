/**
 * Whose exchange rate a row is, worded the same way on every screen.
 *
 * The person pricing a quotation sees "USD→KWD 0.30918 · ExchangeRate-API ·
 * 05 Oct 00:02 UTC" beside the option before sending it, and the reference
 * page names the provider, or the person who typed a manual rate. Kept apart
 * from the pages so the wording is one function a test can hold, rather than
 * three JSX fragments that drift.
 */

import { formatDate, formatDateTime, trimDecimal } from './format'

/** What the label needs from `getTranslations('fxFeed')`. */
export interface FxTranslate {
  (key: string, values?: Record<string, string>): string
  has(key: string): boolean
}

/** A provider's name, "Entered by hand", or the raw source where we have no word for it. */
export function fxSourceName(source: string | null | undefined, t: FxTranslate): string | null {
  if (!source) return null
  return t.has(`sources.${source}`) ? t(`sources.${source}`) : source
}

/**
 * One converted rate, for the quotation screen.
 *
 * Dated by the day the rate is for, not the moment the row was written. Run
 * 6 priced in October on the demo's January rate and the label read "Demo
 * data · 05 Oct, 09:46 UTC", the morning the row was seeded, while the
 * customer's footnote said 01 Jan 2026. The time is added, in UTC, only when
 * the row was written on that same day, which is a feed fetching that day's
 * rates: the providers publish on UTC days, so it matches their own page.
 */
export function fxRateLabel(
  rate: {
    readonly from: string
    readonly to: string
    readonly rate: string
    readonly source: string | null
    readonly effectiveOn?: string | null
    readonly takenAt: string | null
  },
  t: FxTranslate,
  locale: 'en' | 'ar',
): string {
  const parts = [`${rate.from}→${rate.to} ${trimDecimal(rate.rate) ?? rate.rate}`]
  const name = fxSourceName(rate.source, t)
  if (name) parts.push(name)
  const day =
    rate.effectiveOn && /^\d{4}-\d{2}-\d{2}$/.test(rate.effectiveOn) ? rate.effectiveOn : null
  if (day) {
    const sameDay = rate.takenAt?.slice(0, 10) === day
    parts.push(
      sameDay
        ? `${formatDateTime(rate.takenAt, locale, 'UTC')} UTC`
        : formatDate(`${day}T12:00:00Z`, locale, 'UTC'),
    )
  } else if (rate.takenAt) {
    // A quotation priced before the snapshot kept the rate's day.
    parts.push(`${formatDateTime(rate.takenAt, locale, 'UTC')} UTC`)
  }
  return parts.join(' · ')
}
