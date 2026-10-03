/**
 * Locale resolution — Architecture §11.
 *
 * Bilingual from the first commit, not from R1.3. The locale comes from the
 * reader's explicit choice (the switch's cookie), then the signed-in
 * principal's `locale` column, and finally English (`resolveRequestLocale`).
 *
 * SRS §10.2 argues that retrofitting RTL produces a worse result. The
 * corollary this file exists to protect: R1.3 must be a *translation and
 * review* gate, not a rebuild.
 */

import { getRequestConfig } from 'next-intl/server'
import { cookies } from 'next/headers'
import { getSession } from '@/lib/session'
import { TIME_ZONE_COOKIE, resolveTimeZone } from '@/lib/time'

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

/**
 * The zone every `next-intl` date is rendered in.
 *
 * The signed-in principal's column first, the cookie second, Kuwait last. That
 * order is what makes the setting follow a person rather than a browser: the
 * cookie is written when they choose, but a colleague signing in from the
 * warehouse machine for the first time has no cookie and should still read
 * their own zone.
 *
 * Wrapped, because this runs for *every* request including the public tracking
 * page, and a request-config that throws takes down the whole application
 * rather than one screen. A database that cannot answer costs the reader their
 * preferred zone, not the page.
 */
async function requestTimeZone(cookieValue: string | undefined): Promise<string> {
  try {
    const session = await getSession()
    if (session) return session.principal.timezone
  } catch {
    // Fall through to the cookie.
  }
  return resolveTimeZone(cookieValue)
}

/**
 * The language a request renders in.
 *
 * An explicit choice first: the cookie is written only by the language switch,
 * so a reader who picked English on an Arabic account keeps English. Then the
 * signed-in principal's saved `locale`, which is what makes the setting follow
 * the person: an account created in Arabic used to open in English on every
 * machine that had not yet been switched by hand (NEW-5). English last.
 *
 * Exported for its test, and wrapped like the zone: a session read that throws
 * costs the reader their saved language, never the page.
 */
export async function resolveRequestLocale(
  cookieValue: string | undefined,
  readSession: () => Promise<{ principal: { locale: string } } | null> = getSession,
): Promise<Locale> {
  if (isLocale(cookieValue)) return cookieValue
  try {
    const session = await readSession()
    const saved = session?.principal.locale
    if (isLocale(saved)) return saved
  } catch {
    // Fall through to the default.
  }
  return DEFAULT_LOCALE
}

export default getRequestConfig(async () => {
  const store = await cookies()
  const locale = await resolveRequestLocale(store.get(LOCALE_COOKIE)?.value)

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    timeZone: await requestTimeZone(store.get(TIME_ZONE_COOKIE)?.value),
    formats: {
      dateTime: {
        short: { day: '2-digit', month: 'short', year: 'numeric' },
        withTime: {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        },
      },
    },
  }
})
