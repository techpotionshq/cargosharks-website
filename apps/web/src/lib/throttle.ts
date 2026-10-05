import 'server-only'
import { afterFailure, afterSuccess, lockoutState, type LockoutCounters } from '@qabandi/core'

/**
 * The per-address sign-in throttle — the other half of FR-ID-05.
 *
 * `core/lockout.ts` protects an *account* from being guessed at. This protects
 * the *form* from being used as an oracle: without it, an attacker who never
 * guesses a password at all can still walk a list of addresses through it as
 * fast as the server answers, and account lockout says nothing about that
 * because no account is ever reached.
 *
 * The two are deliberately different mechanisms rather than one generalised
 * one, because they fail in opposite directions and cover each other:
 *
 *   lockout    precise, persistent, per account. Blind to an attacker who
 *              spreads one attempt across ten thousand addresses.
 *   throttle   coarse, in memory, per address. Blind to an attacker with a
 *              botnet, which is what the lockout is for.
 *
 * ## Why memory and not a table
 *
 * Because `rate_limit_buckets` was a table, and `0035` dropped it: it was
 * declared for exactly this, never written to, and the service throttles with
 * `@fastify/rate-limit` in memory instead. Re-adding it would mean a row per
 * address a stranger chooses to send, written by an endpoint that requires no
 * credential — an unauthenticated party deciding how much of the customer's
 * disk to use.
 *
 * The honest cost is stated rather than hidden: this counter is per process
 * and it resets on deploy. `apps/web` runs as one container today
 * (`compose.prod.yaml`), so today that is the whole application. If it is ever
 * scaled to two, the budget doubles rather than disappears, and the lockout —
 * which *is* persistent, and shared, because it is a column — still holds. A
 * throttle that degrades to "twice as generous" under a change nobody
 * remembered to think about is an acceptable failure. One that degrades to
 * "off" is not, and that is why the durable half lives in the database.
 */

/**
 * The most keys one budget tracks at once.
 *
 * A hard ceiling, because the keys arrive from unauthenticated requests and
 * IPv6 hands an attacker effectively unlimited ones. Without a cap this map is
 * a memory-exhaustion primitive pointed at our own process — the throttle
 * becoming the denial of service it exists to prevent.
 *
 * Ten thousand is far above any real freight operator's staff and far below
 * anything that troubles a Node heap: each entry is a short string and two
 * numbers, so a full table is a few megabytes.
 */
const MAX_TRACKED = 10_000

interface Window {
  count: number
  /** When the current window opened. */
  since: number
}

export interface ThrottleVerdict {
  readonly allowed: boolean
  /** Whole minutes until the window resets. Zero when allowed. */
  readonly minutesRemaining: number
}

/**
 * One budget: `limit` attempts per key per `windowMs`.
 *
 * A factory since the sign-in budget stopped being the only one. The reset
 * form and public tracking need the same mechanism with different numbers
 * and different keys (A1, A10), and three hand-copied maps is three places for
 * the eviction rule to be forgotten.
 */
export interface Throttle {
  /**
   * Record an attempt against `key` and say whether to serve it.
   *
   * A null key — no address the deployment can vouch for
   * (`lib/client-address.ts`) — is allowed through rather than blocked.
   * Failing closed on a missing header would mean one proxy misconfiguration
   * locking every operator out of the product at once, and there is a
   * persistent control behind every budget that matters.
   */
  hit(key: string | null, now?: number): ThrottleVerdict
  /** Whether `key` has already spent its budget, without spending any. */
  peek(key: string | null, now?: number): ThrottleVerdict
  /** Give `key` its whole budget back. */
  clear(key: string | null): void
  /** Test seam. */
  reset(): void
}

export function createThrottle(limit: number, windowMs: number): Throttle {
  /*
    Module scope via the closure, so it survives between requests within the
    process.

    A `Map` rather than an LRU library: insertion order is guaranteed by the
    language, which is all the eviction below needs, and a dependency taken for
    one eviction rule is a dependency to patch forever.
  */
  const windows = new Map<string, Window>()

  const remaining = (window: Window, now: number) =>
    Math.max(1, Math.ceil((window.since + windowMs - now) / 60_000))

  /**
   * Drop the oldest window when the table is full.
   *
   * Approximate on purpose. The exact victim does not matter — what matters is
   * that the map cannot grow without bound, and that eviction costs O(1)
   * rather than a scan on every request, which would itself be the load an
   * attacker wanted.
   */
  const evictIfFull = () => {
    if (windows.size < MAX_TRACKED) return
    const oldest = windows.keys().next()
    if (!oldest.done) windows.delete(oldest.value)
  }

  return {
    hit(key, now = Date.now()) {
      if (!key) return { allowed: true, minutesRemaining: 0 }

      const existing = windows.get(key)

      if (!existing || now - existing.since >= windowMs) {
        evictIfFull()
        // Re-inserted rather than mutated, so this key moves to the end of the
        // map's insertion order and the eviction above stays approximately
        // least-recently-started.
        windows.delete(key)
        windows.set(key, { count: 1, since: now })
        return { allowed: true, minutesRemaining: 0 }
      }

      existing.count += 1

      if (existing.count > limit) {
        return { allowed: false, minutesRemaining: remaining(existing, now) }
      }

      return { allowed: true, minutesRemaining: 0 }
    },

    peek(key, now = Date.now()) {
      if (!key) return { allowed: true, minutesRemaining: 0 }
      const existing = windows.get(key)
      if (!existing || now - existing.since >= windowMs || existing.count < limit) {
        return { allowed: true, minutesRemaining: 0 }
      }
      return { allowed: false, minutesRemaining: remaining(existing, now) }
    },

    clear(key) {
      if (key) windows.delete(key)
    },

    reset() {
      windows.clear()
    },
  }
}

/**
 * The sign-in budget per address: fifty *failed* attempts per fifteen minutes.
 *
 * ## Why failures, and why so many
 *
 * This used to be ten attempts of any kind, and Better Auth's own limiter
 * (three per ten seconds) sat in front of it. Run 5 put forty people behind one
 * address and thirty-seven of them were told "Too many requests" (R11). The
 * address is a poor key for a person: an office is one NAT address, and until
 * `CF-Connecting-IP` was read (`lib/client-address.ts`) the whole company was
 * one Cloudflare edge address. A budget that every successful sign-in spends
 * is a budget the morning rush exhausts.
 *
 * So a correct password spends nothing, and only a 401 — "no such user" or
 * "wrong password", which Better Auth answers identically — counts. That still
 * bounds the attack this exists for: walking a list of addresses through the
 * form, where every probe of an unknown address is a failure. And it is never
 * cleared by a success, so an attacker holding one valid credential cannot
 * sign in between guesses to buy the budget back.
 *
 * Fifty is generous on purpose. A shared office of fifty mistyping once each
 * before nine is ordinary; fifty guesses a quarter-hour from one address,
 * spread over accounts that each lock at five (`signInFailuresByEmail`), is
 * not a useful attack.
 *
 * Read with `peek` before the password check and spent with `hit` after a
 * failure, so a burst of simultaneous wrong attempts can overrun it by the
 * size of the burst. That is bounded by concurrency, and the per-account lock
 * behind it is the precise control.
 */
const signInFailuresByAddress = createThrottle(50, 15 * 60 * 1000)

/**
 * The per-account half: the `core` lockout policy, run in memory for *every*
 * address typed into the form, whether or not it has an account.
 *
 * The persistent lock (`lib/lockout.ts`) only exists for real accounts, so on
 * its own "this account is locked" confirmed that the address had one. Running
 * the same arithmetic here for any address — five failures, a fifteen-minute
 * lock, thirty minutes of quiet forgives the run — means an unknown address
 * locks at the same attempt, for the same time, with the same answer. The
 * response no longer depends on whether we hold an account, and the stored
 * lock stays behind it as the control that survives a restart and is shared
 * between processes.
 */
const signInFailuresByEmail = createFailureLock()

/**
 * The `core` lockout policy kept in memory under any key — five failures lock
 * for fifteen minutes, thirty quiet minutes forgive the run.
 *
 * A factory because two things lock this way: an email at the password step,
 * and a user at the two-factor step. Same ceiling and eviction rule as
 * `createThrottle`, for the same reason: the keys are whatever strangers send.
 */
function createFailureLock() {
  const runs = new Map<string, LockoutCounters>()
  return {
    read(key: string | null, now: number): ThrottleVerdict {
      const counters = key ? runs.get(key) : undefined
      if (!counters) return { allowed: true, minutesRemaining: 0 }
      const state = lockoutState(counters, new Date(now))
      return { allowed: !state.locked, minutesRemaining: state.minutesRemaining }
    },
    fail(key: string | null, now: number): void {
      if (!key) return
      const previous = runs.get(key) ?? afterSuccess()
      if (!runs.has(key) && runs.size >= MAX_TRACKED) {
        const oldest = runs.keys().next()
        if (!oldest.done) runs.delete(oldest.value)
      }
      runs.delete(key)
      runs.set(key, afterFailure(previous, new Date(now)))
    },
    clear(key: string | null): void {
      if (key) runs.delete(key)
    },
    reset(): void {
      runs.clear()
    },
  }
}

/** Is sign-in from this address still within its failure budget? Spends nothing. */
export function checkSignInAddress(address: string | null, now = Date.now()): ThrottleVerdict {
  return signInFailuresByAddress.peek(address, now)
}

/** The in-memory lock standing against an email address, known or not. */
export function readEmailLock(email: string | null, now = Date.now()): ThrottleVerdict {
  return signInFailuresByEmail.read(email, now)
}

/** Count one wrong password against the address and the email. */
export function recordSignInFailureInMemory(
  address: string | null,
  email: string | null,
  now = Date.now(),
): void {
  signInFailuresByAddress.hit(address, now)
  signInFailuresByEmail.fail(email, now)
}

/**
 * Forget an email's run after its correct password.
 *
 * The address budget is deliberately left alone — see
 * `signInFailuresByAddress`.
 */
export function clearSignInFailuresInMemory(email: string | null): void {
  signInFailuresByEmail.clear(email)
}

/**
 * The two-factor step, on the same terms as the password step — R11's twin.
 *
 * Better Auth limits `/two-factor/*` to three requests per ten seconds per
 * address. Every finance and admin user arrives from one Cloudflare edge
 * address at launch and confirms their six digits at about the same time, so
 * the fourth colleague in ten seconds was refused with a correct code. That
 * library rule is off for `/two-factor/verify-totp` (`auth-guard.ts`), and
 * these take its place:
 *
 *   per address  fifty *wrong* codes a quarter-hour. A correct code spends
 *                nothing, so an office confirming together is never refused.
 *   per user     the `core` lockout: five wrong codes lock that user for
 *                fifteen minutes, and nobody else. Six digits are a million
 *                guesses; five per quarter-hour is about forty years.
 *
 * The user is known at this step — the password was right — so there is no
 * enumeration to hide; the refusal is the same "locked, try again in N
 * minutes" the password step gives. The library's own persistent lock on the
 * factor (ten failures, `auth_two_factor.locked_until`) stays behind this as
 * the control that survives a restart.
 */
const twoFactorFailuresByAddress = createThrottle(50, 15 * 60 * 1000)
const twoFactorFailuresByUser = createFailureLock()

/** Is this address still within its wrong-code budget? Spends nothing. */
export function checkTwoFactorAddress(address: string | null, now = Date.now()): ThrottleVerdict {
  return twoFactorFailuresByAddress.peek(address, now)
}

/** The lock standing against this user's second factor. */
export function readTwoFactorLock(userId: string | null, now = Date.now()): ThrottleVerdict {
  return twoFactorFailuresByUser.read(userId, now)
}

/** Count one wrong code against the address and the user. */
export function recordTwoFactorFailureInMemory(
  address: string | null,
  userId: string | null,
  now = Date.now(),
): void {
  twoFactorFailuresByAddress.hit(address, now)
  twoFactorFailuresByUser.fail(userId, now)
}

/** Forget the user's run after a correct code. The address budget is not refunded. */
export function clearTwoFactorFailures(userId: string | null): void {
  twoFactorFailuresByUser.clear(userId)
}

/**
 * The password-reset budgets — A1.
 *
 * Two of them, because the form is abused two ways. Per address bounds one
 * caller walking a list of mailboxes; per email bounds many callers flooding
 * one person's inbox with reset mail, which is a nuisance to them and a
 * reputation cost to the sending domain. Neither says anything about whether
 * the address has an account: both count every request the same.
 */
const resetByAddress = createThrottle(10, 15 * 60 * 1000)
const resetByEmail = createThrottle(3, 60 * 60 * 1000)

export function recordResetRequest(
  address: string | null,
  email: string | null,
  now = Date.now(),
): ThrottleVerdict {
  const byAddress = resetByAddress.hit(address, now)
  const byEmail = resetByEmail.hit(email, now)
  if (!byAddress.allowed) return byAddress
  return byEmail
}

/**
 * The public tracking budgets — A10, FR-CP-05.
 *
 * `/track` needs no session, references are sequential, and the verifier can
 * be a shared LCL container number — so somebody holding one container could
 * walk the references and read every co-loaded customer's route and
 * milestones. `features/tracking/queries.ts` said a limit sat in front of it
 * in the service; the page never went through the service, so nothing did.
 *
 * Three budgets, each closing one way in:
 *
 *   per address    every lookup, 30 a quarter-hour. Far above a customer
 *                  checking their shipments, far below a walk.
 *   per verifier   misses only, 10 a quarter-hour. One container number tried
 *                  against reference after reference, from however many
 *                  addresses — the attack the report describes.
 *   per reference  misses only, 10 a quarter-hour. One reference tried against
 *                  guessed verifiers.
 *
 * Misses rather than lookups for the last two, so a customer refreshing their
 * own shipment all afternoon never spends them.
 */
const trackByAddress = createThrottle(30, 15 * 60 * 1000)
const trackMissByVerifier = createThrottle(10, 15 * 60 * 1000)
const trackMissByReference = createThrottle(10, 15 * 60 * 1000)

/** Spend a lookup, and say whether to run it. Call before the query. */
export function recordTrackingLookup(
  address: string | null,
  reference: string,
  verifier: string,
  now = Date.now(),
): ThrottleVerdict {
  const byAddress = trackByAddress.hit(address, now)
  if (!byAddress.allowed) return byAddress
  const byVerifier = trackMissByVerifier.peek(verifier, now)
  if (!byVerifier.allowed) return byVerifier
  return trackMissByReference.peek(reference, now)
}

/** Count a lookup that matched nothing against its verifier and its reference. */
export function recordTrackingMiss(reference: string, verifier: string, now = Date.now()): void {
  trackMissByVerifier.hit(verifier, now)
  trackMissByReference.hit(reference, now)
}

/** Test seam. Not exported from any barrel; nothing in the product calls it. */
export function __resetThrottle(): void {
  signInFailuresByAddress.reset()
  signInFailuresByEmail.reset()
  twoFactorFailuresByAddress.reset()
  twoFactorFailuresByUser.reset()
  resetByAddress.reset()
  resetByEmail.reset()
  trackByAddress.reset()
  trackMissByVerifier.reset()
  trackMissByReference.reset()
}
