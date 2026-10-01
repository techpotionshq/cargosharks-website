import 'server-only'

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
 * The sign-in budget: ten attempts per address per fifteen minutes.
 *
 * Spent *before* the password is checked, and counting every attempt rather
 * than only the failures. Counting failures alone would let an attacker who
 * has one valid credential recover the budget between guesses at other
 * accounts, and the point here is to bound the rate of the whole conversation.
 */
const signIn = createThrottle(10, 15 * 60 * 1000)

export function recordSignInAttempt(address: string | null, now = Date.now()): ThrottleVerdict {
  return signIn.hit(address, now)
}

/**
 * Clear an address's budget after a successful sign-in.
 *
 * An office behind one NAT address is the case this exists for: ten people
 * sharing a public IP would otherwise spend a shared budget on ordinary
 * Sunday-morning sign-ins and lock the eleventh out of a working product.
 * Success is the signal that the traffic is people rather than a script.
 */
export function clearSignInAttempts(address: string | null): void {
  signIn.clear(address)
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

/** Test seam. Not exported from any barrel; nothing in the product calls it. */
export function __resetThrottle(): void {
  signIn.reset()
  resetByAddress.reset()
  resetByEmail.reset()
}
