/**
 * Whose exchange rate a row is, worded the same way on every screen.
 *
 * The person pricing a quotation sees "USD→KWD 0.30918 · ExchangeRate-API ·
 * 05 Oct 00:02 UTC" beside the option before sending it, and the reference
 * page names the provider, or the person who typed a manual rate. Kept apart
 * from the pages so the wording is one function a test can hold, rather than
 * three JSX fragments that drift.
 */

import { formatDate, formatDateTime, formatFxRate } from './format'

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
 * customer's footnote said 01 Jan 2026. The time is added only when the row
 * was written on that same (UTC) day, which is a feed fetching that day's
 * rates.
 *
 * The time is in the reader's zone and says which zone it is. It was printed
 * in UTC here while the feed card in Settings printed Kuwait time with no
 * zone, so one fetch read "11:12 UTC" on one screen and "14:12" on another
 * (live run 6, N7). The rate is shown at reading precision (`formatFxRate`).
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
  timeZone: string = 'UTC',
): string {
  const parts = [`${rate.from}→${rate.to} ${formatFxRate(rate.rate) ?? rate.rate}`]
  const at = (when: string) => `${formatDateTime(when, locale, timeZone)} ${zoneName(timeZone)}`
  const name = fxSourceName(rate.source, t)
  if (name) parts.push(name)
  const day =
    rate.effectiveOn && /^\d{4}-\d{2}-\d{2}$/.test(rate.effectiveOn) ? rate.effectiveOn : null
  if (day) {
    const sameDay = rate.takenAt?.slice(0, 10) === day
    parts.push(sameDay ? at(rate.takenAt!) : formatDate(`${day}T12:00:00Z`, locale, 'UTC'))
  } else if (rate.takenAt) {
    // A quotation priced before the snapshot kept the rate's day.
    parts.push(at(rate.takenAt))
  }
  return parts.join(' · ')
}

/**
 * The zone a time is in, as a reader recognises it: "UTC", or the offset
 * ("GMT+3") for any other. Exported so the feed card in Settings labels its
 * fetch time the same way.
 */
export function zoneName(timeZone: string): string {
  if (timeZone === 'UTC' || timeZone === 'Etc/UTC') return 'UTC'
  try {
    const part = new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'short' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')
    return part?.value ?? timeZone
  } catch {
    return timeZone
  }
}
