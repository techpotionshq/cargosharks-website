/**
 * Locale resolution — Architecture §11.
 *
 * Bilingual from the first commit, not from R1.3. The locale comes from the
 * signed-in principal's `locale` column, falling back to a cookie for the
 * unauthenticated tracking page, and finally to English.
 *
 * SRS §10.2 argues that retrofitting RTL produces a worse result. The
 * corollary this file exists to protect: R1.3 must be a *translation and
 * review* gate, not a rebuild.
 */

import { getRequestConfig } from 'next-intl/server'
import { cookies } from 'next/headers'

export const LOCALES = ['en', 'ar'] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'en'
export const LOCALE_COOKIE = 'qabandi_locale'

export function isLocale(value: string | undefined): value is Locale {
  return value === 'en' || value === 'ar'
}

/** Arabic is right-to-left; everything else here is not. */
export function directionOf(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'ar' ? 'rtl' : 'ltr'
}

export default getRequestConfig(async () => {
  const store = await cookies()
  const cookieLocale = store.get(LOCALE_COOKIE)?.value
  const locale: Locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    timeZone: 'Asia/Kuwait',
    formats: {
      dateTime: {
        short: { day: '2-digit', month: 'short', year: 'numeric' },
        withTime: { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' },
      },
    },
  }
})
