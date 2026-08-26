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
import { TIME_ZONE_COOKIE, resolveTimeZone } from '@/lib/time'
import { getSession } from '@/lib/session'
import { eq } from 'drizzle-orm'
import { principals, withActor } from '@qabandi/db'

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

/**
 * The reader's time zone — stored twice, on purpose.
 *
 * The cookie is what `i18n/request.ts` can read without a query, and it is the
 * only half the public tracking page has. The column is the durable one: a
 * preference that lives only in a cookie is lost on a new machine, and the
 * person most likely to sign in from somewhere else is the one whose zone is
 * not the default.
 *
 * The write is scoped to the principal's own row, which `principals_scope`
 * already permits — its first clause is `id = app.principal_id()`, and with no
 * `with check` Postgres applies the same expression to the updated row. No new
 * policy, and no way to set anybody else's zone.
 *
 * A signed-out reader still gets the cookie. That is the tracking page, which
 * has no principal to store anything against and still has to show an ETA in a
 * zone the reader recognises.
 */
export async function setTimeZonePreference(formData: FormData): Promise<void> {
  const timeZone = resolveTimeZone(String(formData.get('timeZone') ?? ''))

  const store = await cookies()
  store.set(TIME_ZONE_COOKIE, timeZone, {
    maxAge: MAX_AGE,
    sameSite: 'lax',
    path: '/',
    httpOnly: false,
  })

  const session = await getSession()
  if (session) {
    await withActor(session.actor, async (tx) => {
      await tx
        .update(principals)
        .set({ timezone: timeZone })
        .where(eq(principals.id, session.principal.id))
    })
  }

  revalidatePath('/', 'layout')
}
