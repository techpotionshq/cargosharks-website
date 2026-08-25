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

/** Attempts allowed from one address per window. */
const LIMIT = 10

/** The window, in milliseconds. Fifteen minutes. */
const WINDOW_MS = 15 * 60 * 1000

/**
 * The most addresses tracked at once.
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

/*
  Module scope, so it survives between requests within the process.

  A `Map` rather than an LRU library: insertion order is guaranteed by the
  language, which is all the eviction below needs, and a dependency taken for
  one eviction rule is a dependency to patch forever.
*/
const windows = new Map<string, Window>()

export interface ThrottleVerdict {
  readonly allowed: boolean
  /** Whole minutes until the window resets. Zero when allowed. */
  readonly minutesRemaining: number
}

/**
 * Record an attempt from `address` and say whether to serve it.
 *
 * Called *before* the password is checked, and counts every attempt rather
 * than only the failures. Counting failures alone would let an attacker who
 * has one valid credential recover the budget between guesses at other
 * accounts, and the point here is to bound the rate of the whole conversation.
 *
 * A null address — no `x-forwarded-for`, which on a correctly configured
 * deployment means a request that did not come through the proxy — is allowed
 * through to the lockout rather than blocked. Failing closed on a missing
 * header would mean one proxy misconfiguration locking every operator out of
 * the product at once, and there is a persistent control behind this one.
 */
export function recordSignInAttempt(address: string | null, now = Date.now()): ThrottleVerdict {
  if (!address) return { allowed: true, minutesRemaining: 0 }

  const existing = windows.get(address)

  if (!existing || now - existing.since >= WINDOW_MS) {
    evictIfFull()
    // Re-inserted rather than mutated, so this address moves to the end of the
    // map's insertion order and the eviction below stays approximately
    // least-recently-started.
    windows.delete(address)
    windows.set(address, { count: 1, since: now })
    return { allowed: true, minutesRemaining: 0 }
  }

  existing.count += 1

  if (existing.count > LIMIT) {
    return {
      allowed: false,
      minutesRemaining: Math.ceil((existing.since + WINDOW_MS - now) / 60_000),
    }
  }

  return { allowed: true, minutesRemaining: 0 }
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
  if (address) windows.delete(address)
}

/**
 * Drop the oldest window when the table is full.
 *
 * Approximate on purpose. The exact victim does not matter — what matters is
 * that the map cannot grow without bound, and that eviction costs O(1) rather
 * than a scan on every request, which would itself be the load an attacker
 * wanted.
 */
function evictIfFull(): void {
  if (windows.size < MAX_TRACKED) return
  const oldest = windows.keys().next()
  if (!oldest.done) windows.delete(oldest.value)
}

/** Test seam. Not exported from any barrel; nothing in the product calls it. */
export function __resetThrottle(): void {
  windows.clear()
}
