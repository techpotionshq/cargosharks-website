/**
 * Which language a job document is issued in, and which is offered beside it.
 *
 * Issued copies are versioned per language (`pdf/store.ts` locks and numbers
 * on job, kind and locale), so an Arabic packing list is its own document with
 * its own history, not a rendering of the English one. The button used to post
 * `en` whatever the screen was in, and an Arabic coordinator issuing for an
 * Arabic customer handed over English papers, which is what the Arabic portal
 * then served (N5). The reader's language is the default, and the other is one
 * click away rather than gone.
 */

import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/request'

export function issueLocales(reader: string | undefined): {
  readonly primary: Locale
  readonly other: Locale
} {
  const primary = isLocale(reader) ? reader : DEFAULT_LOCALE
  return { primary, other: primary === 'ar' ? 'en' : 'ar' }
}
