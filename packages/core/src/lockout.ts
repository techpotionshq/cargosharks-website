/**
 * Sign-in lockout — FR-ID-05, and the half of it that was never built.
 *
 * The password rule was enforced from the start (`MIN_PASSWORD_LENGTH`, twelve
 * characters) and the guessing rule was not, which is the wrong way round: a
 * twelve-character password is only expensive to guess if guessing is
 * expensive. Nothing in the product limited attempts, so an address and a
 * wordlist could be run at it at whatever rate the server would answer. The
 * privacy notice said so in writing — "account lockout after repeated failed
 * sign-ins is specified and not built" — and this is the engine that closes it.
 *
 * ## Why the policy is here and not in the action
 *
 * It is arithmetic over four numbers and a clock, and it has exactly the
 * properties that make a thing belong in `core`: no I/O, no framework, every
 * "now" handed in. That means the decisions below — when a lock starts, how
 * long it lasts, when a stale run of failures is forgiven — are provable in
 * milliseconds against no infrastructure, rather than reachable only by
 * failing to sign in five times against a live database.
 *
 * The caller is `features/auth/actions.ts`. It owns reading and writing the
 * counters; this file owns what they mean.
 *
 * ## The three numbers, and why these three
 *
 * Five attempts, fifteen minutes, thirty minutes of quiet.
 *
 * Five is chosen against the population rather than against a benchmark. These
 * accounts belong to a small named staff who type a password they know; the
 * honest-mistake distribution is one or two failures, near-never five. NIST
 * SP 800-63B suggests no more than 100 before a limit, which is written for
 * consumer services where a lockout is a support call the provider pays for.
 * Here the support call is internal and cheap, and the attacker is the more
 * expensive party to serve.
 *
 * Fifteen minutes rather than "until an administrator clears it", and this is
 * the load-bearing choice. A lock that only a human can lift turns any address
 * an attacker knows into a way to take a named person off the system for the
 * rest of the day — the denial of service arrives dressed as the control that
 * was meant to prevent one. Freight moves on a clock; a finance manager locked
 * out at 09:00 on a Sunday because somebody guessed at them is a worse outcome
 * than the guessing. So it expires on its own, and the counter survives it.
 *
 * Thirty minutes of quiet forgives the run. Without it the counter is a
 * lifetime total and every account eventually locks itself through ordinary
 * mistyping spread over months.
 *
 * ## What this deliberately does not do
 *
 * It does not distinguish an unknown address from a known one, and the caller
 * must not either. Locking only real accounts makes the lockout an
 * account-enumeration oracle — the very thing `signIn` already takes care to
 * avoid by returning one message for "no such user" and "wrong password"
 * (FR-ID-04). A per-address throttle covers the unknown case instead; see
 * `apps/web/src/lib/throttle.ts`.
 */

/** Failures before the account is locked. */
export const LOCKOUT_THRESHOLD = 5

/** How long a lock lasts, in milliseconds. Fifteen minutes. */
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000

/**
 * Quiet time after which a run of failures is forgiven, in milliseconds.
 * Thirty minutes — twice the lock, so a lock that expires unobserved does not
 * leave the account one mistake from the next one.
 */
export const LOCKOUT_WINDOW_MS = 30 * 60 * 1000

/**
 * The stored counters. Nullable throughout because an account that has never
 * failed carries no history, which is the common case and should cost no row
 * space to represent.
 */
export interface LockoutCounters {
  readonly failedCount: number
  readonly lastFailedAt: Date | null
  readonly lockedUntil: Date | null
}

export interface LockoutState {
  /** Refuse the attempt without checking the password. */
  readonly locked: boolean
  /** When the lock lifts. Null when not locked. */
  readonly until: Date | null
  /** Whole minutes remaining, rounded up — what the operator is told. */
  readonly minutesRemaining: number
}

/**
 * Is this account locked right now?
 *
 * Reads `lockedUntil` and nothing else. The counter is not consulted, so a
 * threshold that is lowered later does not retroactively lock accounts that
 * are sitting on four old failures.
 */
export function lockoutState(counters: LockoutCounters, now: Date): LockoutState {
  const until = counters.lockedUntil
  if (!until || until.getTime() <= now.getTime()) {
    return { locked: false, until: null, minutesRemaining: 0 }
  }

  return {
    locked: true,
    until,
    // Rounded *up*, so "1 minute" never means "any moment now, or 59 seconds".
    // Telling someone to come back in a minute and refusing them again is how
    // a control earns a reputation for being broken.
    minutesRemaining: Math.ceil((until.getTime() - now.getTime()) / 60_000),
  }
}

/**
 * The counters after a failed attempt.
 *
 * Pure: hand it what is stored and the clock, and it returns what to store.
 * The caller writes the result and does not decide anything.
 */
export function afterFailure(counters: LockoutCounters, now: Date): LockoutCounters {
  /*
    A run that has gone quiet starts again from one.

    Without this the count is a lifetime total: an operator who mistypes twice
    in March and twice in July arrives at their fifth honest mistake in
    November and is locked out by a control that was aiming at somebody else.
  */
  const continuing =
    counters.lastFailedAt !== null &&
    now.getTime() - counters.lastFailedAt.getTime() < LOCKOUT_WINDOW_MS

  const failedCount = continuing ? counters.failedCount + 1 : 1

  return {
    failedCount,
    lastFailedAt: now,
    lockedUntil:
      failedCount >= LOCKOUT_THRESHOLD ? new Date(now.getTime() + LOCKOUT_DURATION_MS) : null,
  }
}

/**
 * The counters after a successful sign-in: cleared.
 *
 * Returned as a value rather than applied, so the caller writes it in the same
 * statement it writes everything else and there is no window in which a
 * correct password has been accepted and the account is still one failure from
 * a lock.
 */
export function afterSuccess(): LockoutCounters {
  return { failedCount: 0, lastFailedAt: null, lockedUntil: null }
}
