'use server'

/**
 * Sign in and sign out — `FR-ID-05…08`.
 *
 * The form previously posted straight at `/api/auth/sign-in/email`. Better Auth
 * speaks JSON there and answers in JSON, so a browser form post landed the
 * operator on a page of raw JSON on success and a bare 401 body on failure —
 * with no cookie set on the navigation and no way to show "wrong password".
 *
 * Going through a server action instead means the response is handled on the
 * server, the `Set-Cookie` it returns is forwarded onto the real navigation,
 * and a failure comes back as a message the form can render in the operator's
 * own language.
 */

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { auth, MIN_PASSWORD_LENGTH } from '@/lib/auth'
import { useDemoLogin, usePilotFixtures } from '@/lib/pilot/source'
import { demoPasswordMatches, demoPersonaByEmail, startDemoSession } from '@/lib/pilot/demo'
import { AUTH_REFUSAL, refusalOf } from '@/lib/auth-guard'
import { applySetCookie } from './cookies'
import { demoReadOnlyMessage } from '@/lib/pilot/read-only'

export interface SignInState {
  readonly error?: string
  readonly email?: string
}

export async function signIn(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const t = await getTranslations('signIn')
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase()
  const password = String(formData.get('password') ?? '')

  if (!email || !password) return { error: t('errorMissing'), email }

  /*
    The public demo's three personas — `QABANDI_DEMO_LOGIN=1`, off by default
    and impossible to reach without the pilot fixtures as well (`useDemoLogin`
    in `lib/pilot/source.ts`).

    Placed before Better Auth rather than beside it because on that deployment
    there is no database and therefore no `auth_user` to authenticate against;
    a demo address would otherwise take a round trip through a library that
    cannot answer. Anything that is *not* one of the three addresses falls
    straight through to the real path below, unchanged — including the failure
    message, which stays the same one for "no such user" and "wrong password"
    so the form is not an enumeration oracle here either.
  */
  if (useDemoLogin()) {
    const persona = demoPersonaByEmail(email)
    if (persona && demoPasswordMatches(password)) {
      await startDemoSession(persona)
      // Not `/dashboard`. Which shell a persona belongs to is the entire point
      // of having three of them; `homeFor()` states the same mapping for every
      // other entry point.
      redirect(persona.home)
    }
  }

  /*
    Fixture mode has no `auth_user` to check anything else against. Better
    Auth would throw on the missing connection and the visitor would see an
    error page instead of a sentence beside the form.
  */
  const demo = await demoReadOnlyMessage()
  if (demo) return { error: demo, email }

  /*
    The throttle and the account lock — FR-ID-05, A1.

    Both are enforced inside Better Auth now (`lib/auth-guard.ts`), so they
    hold for a script posting to `/api/auth/sign-in/email` exactly as they hold
    for this form. What is left here is translating the refusal into the
    operator's language.

    ## Why the lock message is not an oracle

    Everything else in this file works to make an unknown address
    indistinguishable from a wrong password. The lock message used to break
    that, because only a real account could be locked. The guard now runs the
    same lock in memory for every address typed (`lib/throttle.ts`), so an
    unknown address is locked at the same fifth failure, for the same fifteen
    minutes, in the same words (R11).

    The lock is still told rather than disguised as "wrong email or password".
    Refusing a correct password with no explanation is indistinguishable from
    the product being broken; it generates a support call, and the fix
    somebody reaches for under that pressure is to turn the lockout off.
  */
  let response: Response
  try {
    // `asResponse` gives back the real Response, headers included, which is the
    // only way to get the session cookie out of Better Auth from server code.
    // The request's headers go with it so the guard sees the caller's address.
    response = await auth.api.signInEmail({
      body: { email, password },
      headers: await headers(),
      asResponse: true,
    })
  } catch (error) {
    // Deliberately one message for "no such user" and "wrong password":
    // distinguishing them turns the form into an account-enumeration oracle
    // (FR-ID-04). The failure was already counted by the guard.
    return { error: refusalMessage(t, refusalOf(error)) ?? t('errorInvalid'), email }
  }

  if (!response.ok) {
    return {
      error: refusalMessage(t, refusalOf(await jsonOf(response))) ?? t('errorInvalid'),
      email,
    }
  }

  const store = await cookies()
  // `getSetCookie` is the one accessor that keeps multiple Set-Cookie headers
  // separate; `get('set-cookie')` folds them into one comma-joined string and
  // silently corrupts any cookie whose attributes contain a comma.
  for (const header of response.headers.getSetCookie()) applySetCookie(store, header)

  /*
    The account has TOTP, so nothing is signed in yet — FR-ID-06.

    Better Auth answers a 2FA account with `twoFactorRedirect: true` and a
    short-lived challenge cookie *instead of* a session, and both are already
    carried across above. Reading the body is the only way to tell that apart
    from an ordinary success: the status is 200 either way, and treating it as
    one would send the operator to a dashboard their cookie cannot open, which
    bounces them back to sign-in in a loop that looks exactly like a broken
    password.

    Guarded so a body that is not JSON — a proxy error page, a future version
    that answers differently — falls through to the normal path rather than
    throwing on the success route.
  */
  if (await isTwoFactorChallenge(response)) redirect('/two-factor')

  redirect('/dashboard')
}

/**
 * A response's JSON body, or null for one that is not JSON.
 *
 * Cloned: the body is a stream and reading it here must not consume the one
 * the caller may still need. Guarded so a body that is not JSON — a proxy
 * error page, a future version that answers differently — reads as nothing
 * rather than throwing on the sign-in path.
 */
async function jsonOf(response: Response): Promise<unknown> {
  try {
    return await response.clone().json()
  } catch {
    return null
  }
}

/** Did Better Auth ask for the second factor rather than open a session? */
async function isTwoFactorChallenge(response: Response): Promise<boolean> {
  const body = await jsonOf(response)
  return typeof body === 'object' && body !== null && 'twoFactorRedirect' in body
    ? Boolean((body as { twoFactorRedirect?: unknown }).twoFactorRedirect)
    : false
}

/**
 * The sentence for a refusal the guard raised, or null for anything else.
 *
 * Both are safe to be specific about: the throttle describes the caller, and
 * the lock is answered alike for addresses with and without an account (see
 * `signIn` above).
 */
function refusalMessage(
  t: (key: string, values?: Record<string, string | number>) => string,
  refusal: ReturnType<typeof refusalOf>,
): string | null {
  if (!refusal) return null
  const minutes = refusal.minutesRemaining
  if (refusal.code === AUTH_REFUSAL.accountLocked) return t('errorLocked', { minutes })
  if (refusal.code === AUTH_REFUSAL.signInThrottled) return t('errorThrottled', { minutes })
  return null
}

/**
 * `useSecureCookies` renames the cookies rather than only adding an attribute:
 * in production every one of them is `__Secure-qabandi.…`. Matching on the bare
 * prefix cleared nothing on a deployed environment, so signing out left a live
 * session cookie in the browser and the next request signed the operator
 * straight back in. Both spellings are stripped; see `SESSION_COOKIE_NAMES` in
 * `lib/session.ts`, which reads the same pair.
 */
const SECURE_PREFIX = '__Secure-'
const COOKIE_PREFIXES = ['qabandi.', `${SECURE_PREFIX}qabandi.`] as const

export async function signOut(): Promise<void> {
  /*
    End the session row, not only the cookie — A5.

    Clearing the cookie alone left `auth_session` live for the rest of its
    twelve hours, so a token copied off a shared freight-desk machine (or out
    of a proxy log) kept working after its owner had signed out. Better Auth's
    `signOut` deletes the row the cookie names; the request's headers carry
    that cookie to it.

    Not awaited into a failure: an expired or already-revoked session makes it
    throw, and the person pressing "sign out" must still end up signed out.
    The pilot fixtures have no session table to revoke.
  */
  if (!usePilotFixtures()) {
    try {
      await auth.api.signOut({ headers: await headers() })
    } catch (error) {
      console.error({ error }, 'sign-out could not revoke the session row')
    }
  }

  const store = await cookies()
  for (const cookie of store.getAll()) {
    if (!COOKIE_PREFIXES.some((prefix) => cookie.name.startsWith(prefix))) continue

    /**
     * `delete(name)` expires the cookie with no attributes, and a browser
     * *rejects* a `__Secure-`-prefixed cookie that arrives without `Secure` —
     * so the bare form would leave the very cookies this is meant to clear.
     * `path` has to be stated for the same reason: deletion matches on
     * name/domain/path, and Better Auth sets these at the root.
     */
    store.delete({
      name: cookie.name,
      path: '/',
      secure: cookie.name.startsWith(SECURE_PREFIX),
    })
  }
  redirect('/sign-in')
}

// --- password reset ----------------------------------------------------------

export interface ResetRequestState {
  readonly done?: boolean
  readonly error?: string
  readonly email?: string
}

/**
 * Ask for a reset link — FR-ID-05.
 *
 * ## The answer is the same either way
 *
 * Whether the address belongs to an account or to nobody, this returns
 * `done: true` and the page says the same sentence. Distinguishing them would
 * turn the form into an account-enumeration oracle, which is the same reason
 * `signIn` above has one message for "no such user" and "wrong password"
 * (FR-ID-04). It matters more here, because this form needs no password to
 * probe with.
 *
 * The email is sent by `sendResetPassword` in `lib/auth.ts`, which hands it to
 * the service. A failure there is logged and does not reach this state, for
 * the same reason.
 */
export async function requestPasswordReset(
  _previous: ResetRequestState,
  formData: FormData,
): Promise<ResetRequestState> {
  const t = await getTranslations('forgotPassword')
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase()

  if (!email) return { error: t('errorMissing') }

  const demo = await demoReadOnlyMessage()
  if (demo) return { error: demo, email }

  try {
    await auth.api.requestPasswordReset({
      body: { email, redirectTo: '/reset-password' },
      headers: await headers(),
    })
  } catch (error) {
    /*
      The reset budget — A1, `lib/auth-guard.ts`. Safe to say out loud: it is
      spent per caller and per typed address, whether or not the address has
      an account, so the refusal tells nobody anything about the account.
    */
    const refusal = refusalOf(error)
    if (refusal?.code === AUTH_REFUSAL.resetThrottled) {
      return { error: t('errorThrottled', { minutes: refusal.minutesRemaining }), email }
    }
    /*
      Anything else is swallowed on purpose.

      Better Auth throws for an unknown address on some paths and not others,
      and the difference is exactly what must not be observable. Anything that
      is a genuine fault — a database that is down, a mail relay that refused
      — is already logged where it happened.
    */
  }

  return { done: true, email }
}

export interface ResetState {
  readonly error?: string
}

/**
 * Set the new password against the token from the link.
 *
 * The length rule is checked here as well as by Better Auth so the operator
 * gets a sentence in their own language rather than a generic API error — and
 * the two numbers come from the same place, `minPasswordLength` in
 * `lib/auth.ts`, so they cannot drift apart.
 */
export async function resetPassword(
  _previous: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const t = await getTranslations('resetPassword')
  const token = String(formData.get('token') ?? '')
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirm') ?? '')

  if (!token) return { error: t('errorNoToken') }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: t('errorTooShort', { length: MIN_PASSWORD_LENGTH }) }
  }
  if (password !== confirm) return { error: t('errorMismatch') }

  const demo = await demoReadOnlyMessage()
  if (demo) return { error: demo }

  try {
    await auth.api.resetPassword({ body: { newPassword: password, token } })
  } catch {
    // A token that is expired, already used, or invented. One message for all
    // three: which of them it is tells an attacker something and tells the
    // operator nothing they can act on differently.
    return { error: t('errorBadToken') }
  }

  /*
    Straight to sign-in rather than signing them in here.

    Resetting a password is the act that should end every other session — a
    person resetting a password may be doing it because someone else has it.
    Better Auth revokes the account's sessions on reset, and issuing a fresh
    one from this handler would quietly reintroduce the thing that was just
    revoked.
  */
  redirect('/sign-in?reset=1')
}
