import 'server-only'

/**
 * The sign-in lockout, the sign-in throttle and the reset throttle, enforced
 * inside Better Auth — FR-ID-05, A1.
 *
 * ## Why here and not in the server action
 *
 * They used to live in `signIn` (`features/auth/actions.ts`), and that is one
 * caller of the endpoint, not the endpoint. `app/api/auth/[...all]/route.ts`
 * hands Better Auth's whole router to the internet, so a script posting to
 * `/api/auth/sign-in/email` was never counted and never refused: a locked
 * account still got a session for the right password, and the only limit left
 * was the library's own in-memory limiter. `/request-password-reset` had no
 * limit at all.
 *
 * Better Auth runs `hooks.before` and `hooks.after` for every dispatch, from
 * the HTTP router and from `auth.api.*` alike (`dispatchAuthEndpoint`), so a
 * control written as a hook holds for the form, the raw route and anything
 * added later. The server action now only translates what these refuse.
 *
 * ## What the refusals say
 *
 * A thrown `APIError` with a `code` the action recognises and the minutes
 * until it lifts. None of them depends on whether the address has an account:
 * the lock is computed in memory for every address typed (`lib/throttle.ts`),
 * so an unknown address is "locked" at the same fifth failure as a real one.
 * The stored lock only ever agrees with it, or outlives it across a restart.
 * The throttle messages describe the caller, not the account.
 *
 * ## Successful sign-ins spend nothing (R11)
 *
 * The address budget counts failures only, and Better Auth's own per-address
 * limiter is switched off for this one path (`auth.ts`). Forty colleagues
 * behind one office address, or one Cloudflare edge, signing in at nine are
 * forty successes, and none of them is refused.
 *
 * The TOTP step after it is held to the same terms: failures only per
 * address, five wrong codes lock that one user (`lib/throttle.ts`), and the
 * library's three-per-ten-seconds rule is off for `/two-factor/verify-totp`.
 */

import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from 'better-auth/api'
import { clientAddressFrom } from './client-address'
import { clearSignInFailures, readLockout, recordSignInFailure } from './lockout'
import {
  checkSignInAddress,
  checkTwoFactorAddress,
  clearSignInFailuresInMemory,
  clearTwoFactorFailures,
  readEmailLock,
  readTwoFactorLock,
  recordResetRequest,
  recordSignInFailureInMemory,
  recordTwoFactorFailureInMemory,
} from './throttle'

/** The codes the forms translate. Stated once so the two sides cannot drift. */
export const AUTH_REFUSAL = {
  signInThrottled: 'SIGN_IN_THROTTLED',
  accountLocked: 'ACCOUNT_LOCKED',
  resetThrottled: 'RESET_THROTTLED',
} as const

/** The slice of a hook context these read. Narrow, so the tests can build one. */
export interface GuardContext {
  readonly path?: string
  readonly body?: unknown
  readonly headers?: { get(name: string): string | null }
  readonly request?: { headers: { get(name: string): string | null } }
  readonly context?: {
    returned?: unknown
    secret?: string
    createAuthCookie?: (name: string) => { name: string }
    internalAdapter?: {
      findVerificationValue(identifier: string): Promise<{ value: string } | null | undefined>
    }
  }
  readonly getSignedCookie?: (name: string, secret: string) => Promise<string | null | false>
}

/** The TOTP check, the one two-factor path these hooks govern. */
export const TWO_FACTOR_VERIFY_PATH = '/two-factor/verify-totp'

/**
 * Whose six digits these are.
 *
 * Read the way the two-factor plugin reads it (`verifyTwoFactor`): the
 * signed-in session during enrolment, otherwise the signed `two_factor`
 * challenge cookie the password step set, which names a verification row
 * holding the user id. Nothing in the body names an account, by design, so
 * this is the only honest source. Null when neither resolves — a stale or
 * forged cookie — and then only the address is counted.
 */
async function twoFactorUserOf(ctx: GuardContext): Promise<string | null> {
  try {
    const session = await getSessionFromCtx(ctx as never)
    if (session?.user?.id) return session.user.id
  } catch {
    // No session is the ordinary case at sign-in; fall through to the cookie.
  }
  try {
    const auth = ctx.context
    if (!auth?.createAuthCookie || !auth.secret || !auth.internalAdapter || !ctx.getSignedCookie) {
      return null
    }
    const token = await ctx.getSignedCookie(auth.createAuthCookie('two_factor').name, auth.secret)
    if (!token) return null
    const row = await auth.internalAdapter.findVerificationValue(token)
    return row?.value ?? null
  } catch {
    return null
  }
}

/** The user a successful verification answered with — the challenge is spent by then. */
function userOfResponse(returned: unknown): string | null {
  const user = (returned as { user?: { id?: unknown } } | null)?.user
  return typeof user?.id === 'string' ? user.id : null
}

function emailOf(ctx: GuardContext): string | null {
  const body = ctx.body as { email?: unknown } | undefined
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  return email || null
}

function addressOf(ctx: GuardContext): string | null {
  const headers = ctx.headers ?? ctx.request?.headers
  return headers ? clientAddressFrom(headers) : null
}

function refuse(
  status: 'TOO_MANY_REQUESTS' | 'FORBIDDEN',
  code: string,
  minutesRemaining: number,
): never {
  // `message` is English because it is an API body; the forms translate the
  // code, and nobody reads this sentence through the interface.
  throw new APIError(status, {
    code,
    message: code === AUTH_REFUSAL.accountLocked ? 'Account locked' : 'Too many attempts',
    minutesRemaining,
  })
}

/**
 * Before the endpoint runs: spend the budgets, and refuse a locked account
 * before its password is compared.
 */
export async function guardBefore(ctx: GuardContext): Promise<void> {
  if (ctx.path === '/sign-in/email') {
    // The address's failure budget first: a caller who has spent it learns
    // nothing about any account, not even whether it is locked.
    const throttle = checkSignInAddress(addressOf(ctx))
    if (!throttle.allowed) {
      refuse('TOO_MANY_REQUESTS', AUTH_REFUSAL.signInThrottled, throttle.minutesRemaining)
    }

    // Then the account. The in-memory lock runs for every address typed, so
    // an unknown one is refused at the same attempt and in the same words as
    // a real one; the stored lock behind it is what survives a restart.
    const email = emailOf(ctx)
    const memory = readEmailLock(email)
    if (!memory.allowed) refuse('FORBIDDEN', AUTH_REFUSAL.accountLocked, memory.minutesRemaining)
    const lock = email ? await readLockout(email) : null
    if (lock?.locked) refuse('FORBIDDEN', AUTH_REFUSAL.accountLocked, lock.minutesRemaining)
    return
  }

  if (ctx.path === TWO_FACTOR_VERIFY_PATH) {
    const throttle = checkTwoFactorAddress(addressOf(ctx))
    if (!throttle.allowed) {
      refuse('TOO_MANY_REQUESTS', AUTH_REFUSAL.signInThrottled, throttle.minutesRemaining)
    }
    const lock = readTwoFactorLock(await twoFactorUserOf(ctx))
    if (!lock.allowed) refuse('FORBIDDEN', AUTH_REFUSAL.accountLocked, lock.minutesRemaining)
    return
  }

  if (ctx.path === '/request-password-reset') {
    const verdict = recordResetRequest(addressOf(ctx), emailOf(ctx))
    if (!verdict.allowed) {
      refuse('TOO_MANY_REQUESTS', AUTH_REFUSAL.resetThrottled, verdict.minutesRemaining)
    }
  }
}

/**
 * After the endpoint ran: count a wrong password, clear the run on a right one.
 *
 * Only a 401 counts. That is what Better Auth answers for "no such user" and
 * "wrong password" alike; anything else — a malformed body, a disabled
 * account — is not a guess at a password and must not move anyone towards a
 * lock. A two-factor hand-off is a success here, because the password *was*
 * right: the second factor keeps its own counters, and holding a password
 * lockout open against somebody who has just proved the password would let a
 * stranger who knows only the address lock out an account that is defended by
 * something they do not have.
 */
export async function recordAfter(ctx: GuardContext): Promise<void> {
  if (ctx.path === TWO_FACTOR_VERIFY_PATH) return recordTwoFactorAfter(ctx)
  if (ctx.path !== '/sign-in/email') return
  const email = emailOf(ctx)
  if (!email) return

  const returned = ctx.context?.returned
  try {
    if (isAPIError(returned)) {
      if (returned.statusCode === 401) {
        recordSignInFailureInMemory(addressOf(ctx), email)
        await recordSignInFailure(email)
      }
      return
    }
    // The address budget is not refunded: it counts failures only, so a
    // success never spent it, and refunding it would let a caller holding one
    // good password reset the budget between guesses at other accounts.
    clearSignInFailuresInMemory(email)
    await clearSignInFailures(email)
  } catch (error) {
    // Logged rather than thrown: this runs on the path back to the person, and
    // a database hiccup here should not turn "wrong password" into a 500. A
    // lockout that has quietly stopped counting is still a control that
    // reports itself as present and is not, which is why it is logged.
    console.error({ error }, 'sign-in outcome could not be recorded')
  }
}

/**
 * After a TOTP check: a 401 is a wrong code (or a dead challenge) and counts
 * against the address and the user; anything that is not an error clears the
 * user's run. A refusal these hooks raised is a 403 or 429 and counts nothing,
 * so a locked user's further tries do not extend their own lock.
 */
async function recordTwoFactorAfter(ctx: GuardContext): Promise<void> {
  const returned = ctx.context?.returned
  if (isAPIError(returned)) {
    if (returned.statusCode === 401) {
      recordTwoFactorFailureInMemory(addressOf(ctx), await twoFactorUserOf(ctx))
    }
    return
  }
  clearTwoFactorFailures(userOfResponse(returned))
}

/**
 * Better Auth's `rateLimit`, as `auth.ts` passes it: the library's limiter
 * with its sign-in rule switched off, because the hooks here govern that path
 * (R11, see the note in `auth.ts`). Exported so the load test runs the same
 * setting the application does.
 */
export const AUTH_RATE_LIMIT = {
  customRules: {
    '/sign-in/email': false as const,
    // The two-factor plugin's own rule is 3 per 10 s per address for every
    // `/two-factor/*` path; custom rules are applied after plugin rules, so
    // this switches it off for the TOTP check alone. Backup codes, enrolment
    // and the rest keep the library's rule.
    [TWO_FACTOR_VERIFY_PATH]: false as const,
  },
}

/** The pair, as `betterAuth({ hooks })` takes them. */
export const authHooks = {
  before: createAuthMiddleware(async (ctx) => {
    await guardBefore(ctx as unknown as GuardContext)
  }),
  after: createAuthMiddleware(async (ctx) => {
    await recordAfter(ctx as unknown as GuardContext)
  }),
}

/** Read a refusal back out of a thrown error or a JSON body. */
export function refusalOf(value: unknown): { code: string; minutesRemaining: number } | null {
  const body = isAPIError(value) ? value.body : value
  if (!body || typeof body !== 'object') return null
  const { code, minutesRemaining } = body as { code?: unknown; minutesRemaining?: unknown }
  if (typeof code !== 'string' || !Object.values(AUTH_REFUSAL).includes(code as never)) return null
  return { code, minutesRemaining: typeof minutesRemaining === 'number' ? minutesRemaining : 15 }
}
