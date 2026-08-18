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

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { auth, MIN_PASSWORD_LENGTH } from '@/lib/auth'

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
    return { error: t('errorInvalid'), email }
  }

  if (!response.ok) return { error: t('errorInvalid'), email }

  const store = await cookies()
  // `getSetCookie` is the one accessor that keeps multiple Set-Cookie headers
  // separate; `get('set-cookie')` folds them into one comma-joined string and
  // silently corrupts any cookie whose attributes contain a comma.
  for (const header of response.headers.getSetCookie()) applySetCookie(store, header)

  redirect('/dashboard')
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

/**
 * Copy one `Set-Cookie` header into Next's cookie store.
 *
 * Parsed rather than passed through because Next owns the outgoing headers on
 * a server action; the attributes that matter for a session cookie are carried
 * across and the rest are Better Auth's defaults anyway.
 */
function applySetCookie(store: Awaited<ReturnType<typeof cookies>>, header: string): void {
  const [pair, ...attributes] = header.split(';')
  const index = pair?.indexOf('=') ?? -1
  if (!pair || index < 0) return

  const name = pair.slice(0, index).trim()
  const value = decodeURIComponent(pair.slice(index + 1).trim())

  const options: Parameters<typeof store.set>[2] = { path: '/' }
  for (const attribute of attributes) {
    const [rawKey, rawValue] = attribute.split('=')
    const key = rawKey?.trim().toLowerCase()
    const attributeValue = rawValue?.trim()
    if (key === 'path' && attributeValue) options.path = attributeValue
    else if (key === 'max-age' && attributeValue) options.maxAge = Number(attributeValue)
    else if (key === 'domain' && attributeValue) options.domain = attributeValue
    else if (key === 'samesite' && attributeValue)
      options.sameSite = attributeValue.toLowerCase() as 'lax' | 'strict' | 'none'
    else if (key === 'httponly') options.httpOnly = true
    else if (key === 'secure') options.secure = true
  }

  store.set(name, value, options)
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
