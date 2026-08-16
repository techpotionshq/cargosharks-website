/**
 * Reader preferences — language and appearance.
 *
 * Both are cookies rather than URL segments. Language is a property of the
 * *principal* (`principals.locale`), not of the route: an operator who works
 * in Arabic should not have a different URL from the colleague sitting beside
 * them, and the public tracking page has no principal to read (§11). Keeping
 * it out of the path also means a customer can forward a tracking link without
 * forcing their language on whoever opens it.
 */

'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { isLocale, LOCALE_COOKIE, type Locale } from '@/i18n/request'
import { THEME_COOKIE, type ThemeChoice } from '@/lib/theme'

/** A year: a language choice is not a session-scoped decision. */
const MAX_AGE = 60 * 60 * 24 * 365

export async function setLocalePreference(formData: FormData): Promise<void> {
  const requested = String(formData.get('locale') ?? '')
  const locale: Locale = isLocale(requested) ? requested : 'en'
  const store = await cookies()
  store.set(LOCALE_COOKIE, locale, {
    maxAge: MAX_AGE,
    sameSite: 'lax',
    path: '/',
    httpOnly: false,
  })
  revalidatePath('/', 'layout')
}

export async function setThemePreference(formData: FormData): Promise<void> {
  const requested = String(formData.get('theme') ?? 'system')
  const theme: ThemeChoice = requested === 'light' || requested === 'dark' ? requested : 'system'
  const store = await cookies()

  if (theme === 'system') {
    // Removing the cookie is what returns the page to `prefers-color-scheme`.
    store.delete(THEME_COOKIE)
  } else {
    store.set(THEME_COOKIE, theme, {
      maxAge: MAX_AGE,
      sameSite: 'lax',
      path: '/',
      httpOnly: false,
    })
  }
  revalidatePath('/', 'layout')
}
