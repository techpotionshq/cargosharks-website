/**
 * Whose exchange rate a row is, worded the same way on every screen.
 *
 * The person pricing a quotation sees "USD→KWD 0.30918 · ExchangeRate-API ·
 * 05 Oct 00:02 UTC" beside the option before sending it, and the reference
 * page names the provider, or the person who typed a manual rate. Kept apart
 * from the pages so the wording is one function a test can hold, rather than
 * three JSX fragments that drift.
 */

import { formatDateTime, trimDecimal } from './format'

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
 * The time is in UTC and says so: the providers publish on UTC days, so the
 * label matches the provider's own page when somebody checks it.
 */
export function fxRateLabel(
  rate: {
    readonly from: string
    readonly to: string
    readonly rate: string
    readonly source: string | null
    readonly takenAt: string | null
  },
  t: FxTranslate,
  locale: 'en' | 'ar',
): string {
  const parts = [`${rate.from}→${rate.to} ${trimDecimal(rate.rate) ?? rate.rate}`]
  const name = fxSourceName(rate.source, t)
  if (name) parts.push(name)
  if (rate.takenAt) parts.push(`${formatDateTime(rate.takenAt, locale, 'UTC')} UTC`)
  return parts.join(' · ')
}
