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
import { useDemoLogin } from '@/lib/pilot/source'
import { demoPasswordMatches, demoPersonaByEmail, startDemoSession } from '@/lib/pilot/demo'
import { clearSignInAttempts, recordSignInAttempt } from '@/lib/throttle'
import { clearSignInFailures, readLockout, recordSignInFailure } from './lockout'
import { applySetCookie } from './cookies'

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
    The per-address budget, spent before anything else looks at the request —
    FR-ID-05, `lib/throttle.ts`.

    First, and counting every attempt rather than only the failures, because
    what it bounds is the rate of the whole conversation. An attacker walking a
    list of addresses to see which ones exist never causes a single failed
    password check against a real account, so the lockout below would never
    see them.

    The message is safe to be specific about: it describes the caller, not the
    account, and reveals nothing about whether the address was one of ours.
  */
  const address = await clientAddress()
  const throttle = recordSignInAttempt(address)
  if (!throttle.allowed) {
    return { error: t('errorThrottled', { minutes: throttle.minutesRemaining }), email }
  }

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
    The account lock — FR-ID-05, policy in `core/lockout.ts`.

    Checked *before* the password, which is the entire point: after five
    failures the sixth guess must cost an attacker a refusal rather than a
    comparison. Skipped under the pilot fixtures, where there is no database
    and therefore no `auth_user` to read.

    ## The oracle this one does concede, and why

    Everything else in this file works to make an unknown address
    indistinguishable from a wrong password. This message breaks that: only a
    real account can be locked, so being told about a lock confirms the address
    exists.

    It is conceded deliberately, for a price an attacker has to pay in full.
    Reaching the message costs five failed attempts against that one address,
    and the per-address budget spent above allows ten in fifteen minutes — so
    enumerating a list is slow, loud, and self-limiting.

    The alternative is worse in a way that is easy to underrate: refusing a
    correct password with "wrong email or password" and no further explanation.
    That is indistinguishable from the product being broken. It generates a
    support call, and the fix somebody reaches for under that pressure is to
    turn the lockout off.
  */
  const lock = await readLockout(email)
  if (lock?.locked) {
    return { error: t('errorLocked', { minutes: lock.minutesRemaining }), email }
  }

  let response: Response
  try {
    // `asResponse` gives back the real Response, headers included, which is the
    // only way to get the session cookie out of Better Auth from server code.
    response = await auth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    })
  } catch {
    // Better Auth throws APIError for bad credentials. Deliberately one
    // message for "no such user" and "wrong password": distinguishing them
    // turns the form into an account-enumeration oracle (FR-ID-04).
    await countFailure(email)
    return { error: t('errorInvalid'), email }
  }

  if (!response.ok) {
    await countFailure(email)
    return { error: t('errorInvalid'), email }
  }

  /*
    Cleared on the way through, not afterwards.

    `redirect()` below throws to unwind, so anything placed after it never
    runs — an operator would sign in successfully and stay one mistake from a
    lock, permanently, and nothing would ever say so.

    Cleared on a two-factor hand-off as well as on a completed sign-in, because
    the password *was* right. The second factor keeps its own counters
    (`auth_two_factor.failed_verification_count`), and holding a password
    lockout open against somebody who has just proved the password would let a
    stranger who knows only the address lock out an account that is, by this
    point, demonstrably defended by something they do not have.
  */
  await clearSignInFailures(email)
  clearSignInAttempts(address)

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

/** Did Better Auth ask for the second factor rather than open a session? */
async function isTwoFactorChallenge(response: Response): Promise<boolean> {
  try {
    // Cloned: the body is a stream and reading it here must not consume the
    // one the caller may still need.
    const body: unknown = await response.clone().json()
    return typeof body === 'object' && body !== null && 'twoFactorRedirect' in body
      ? Boolean((body as { twoFactorRedirect?: unknown }).twoFactorRedirect)
      : false
  } catch {
    return false
  }
}

/**
 * Count a failure, and never let counting one break the sign-in form.
 *
 * Wrapped because this runs on the path that is already failing. If the
 * database is unreachable, the operator should get "wrong email or password"
 * — which is true, and which they can act on — rather than an unhandled
 * exception on the one screen that has to work before anything else does.
 *
 * A no-op under the pilot fixtures — `lockout.ts` guards that itself.
 */
async function countFailure(email: string): Promise<void> {
  try {
    await recordSignInFailure(email)
  } catch (error) {
    // Logged rather than swallowed silently: a lockout that has quietly
    // stopped counting is a control that reports itself as present and is not.
    console.error({ error }, 'sign-in failure could not be recorded')
  }
}

/**
 * The caller's address, as the proxy reported it.
 *
 * The same first-hop reading as `clientIp` in `lib/session.ts`. It is only as
 * trustworthy as the proxy in front of the application, which is why nothing
 * that matters rests on it alone — the durable half of FR-ID-05 is the account
 * lock, and that is keyed on the address that was typed, not the one that
 * connected.
 */
async function clientAddress(): Promise<string | null> {
  const store = await headers()
  return store.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
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

  try {
    await auth.api.requestPasswordReset({
      body: { email, redirectTo: '/reset-password' },
    })
  } catch {
    /*
      Swallowed on purpose.

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
