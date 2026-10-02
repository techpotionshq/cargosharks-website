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
 * until it lifts. The lock message concedes that the address has an account —
 * see the long note in `signIn` for why that is conceded, and why only after
 * five failures. The throttle messages describe the caller, not the account,
 * and count every request the same whether or not the address is ours.
 */

import { APIError, createAuthMiddleware, isAPIError } from 'better-auth/api'
import { clientAddressFrom } from './client-address'
import { clearSignInFailures, readLockout, recordSignInFailure } from './lockout'
import { clearSignInAttempts, recordResetRequest, recordSignInAttempt } from './throttle'

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
  readonly context?: { returned?: unknown }
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
    // Every attempt, before anything else looks at it — the budget bounds the
    // rate of the whole conversation, including addresses that are nobody's.
    const throttle = recordSignInAttempt(addressOf(ctx))
    if (!throttle.allowed) {
      refuse('TOO_MANY_REQUESTS', AUTH_REFUSAL.signInThrottled, throttle.minutesRemaining)
    }

    const email = emailOf(ctx)
    const lock = email ? await readLockout(email) : null
    if (lock?.locked) refuse('FORBIDDEN', AUTH_REFUSAL.accountLocked, lock.minutesRemaining)
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
  if (ctx.path !== '/sign-in/email') return
  const email = emailOf(ctx)
  if (!email) return

  const returned = ctx.context?.returned
  try {
    if (isAPIError(returned)) {
      if (returned.statusCode === 401) await recordSignInFailure(email)
      return
    }
    await clearSignInFailures(email)
    clearSignInAttempts(addressOf(ctx))
  } catch (error) {
    // Logged rather than thrown: this runs on the path back to the person, and
    // a database hiccup here should not turn "wrong password" into a 500. A
    // lockout that has quietly stopped counting is still a control that
    // reports itself as present and is not, which is why it is logged.
    console.error({ error }, 'sign-in outcome could not be recorded')
  }
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
