import 'server-only'

/**
 * Reading and writing the lockout counters — FR-ID-05.
 *
 * The policy is `lockout.ts` in `core` and none of it is repeated here. This
 * file does the two things `core` refuses to do: touch the database, and know
 * what a clock says.
 *
 * ## Why these run as the system principal
 *
 * For the same reason the session lookup does, and the reasoning in
 * `lib/session.ts` applies unchanged: this *is* the code that decides whether
 * a principal gets established, so there is no principal to run it as.
 *
 * `auth_user` is one of the `auth_*` tables, which sit outside row-level
 * security and outside the audit trigger by design — `0003` skips them so the
 * log never copies a credential, and `0004` writes no policy for them. So the
 * actor here buys no scoping. It is used anyway, because `withActor` is the
 * only way into the database in this repository and a second way in is how the
 * first one stops being true.
 *
 * ## No database, no lock
 *
 * All three guard on `usePilotFixtures()` and do nothing without a database.
 * The guard is here rather than at the call site on purpose: `check-fixtures`
 * reads one file at a time, and more to the point a read that is only safe
 * because of what its caller remembered is one bad refactor from a 500 on the
 * sign-in screen — the one page that has to work before any other can.
 *
 * Doing nothing is the right no-op in both directions. The pilot has no
 * `auth_user` to lock, and its sign-in does not reach a password check anyway
 * (`lib/pilot/demo.ts`), so there is nothing to protect and nothing to count.
 *
 * ## What is not recorded
 *
 * The address that was tried, when it belongs to nobody. An unknown address
 * writes nothing and reads nothing — see `signIn` in `actions.ts`, which is
 * careful to spend the same work on it either way.
 */

import { eq, sql } from 'drizzle-orm'
import { afterFailure, afterSuccess, lockoutState, type LockoutState } from '@qabandi/core'
import { authUser, systemActor, withActor } from '@qabandi/db'
import { usePilotFixtures } from '@/lib/pilot/source'

/**
 * The lock standing against an address, if any.
 *
 * Returns `null` for an address with no account, which the caller must treat
 * exactly as it treats an account that is not locked. Anything else — a
 * different message, a different code path, a measurably different response
 * time — turns the lockout into the account-enumeration oracle that FR-ID-04
 * and the single `errorInvalid` message exist to prevent.
 */
export async function readLockout(email: string, now = new Date()): Promise<LockoutState | null> {
  if (usePilotFixtures()) return null

  return withActor(systemActor(), async (tx) => {
    const [row] = await tx
      .select({
        failedCount: authUser.failedSignInCount,
        lastFailedAt: authUser.lastFailedSignInAt,
        lockedUntil: authUser.lockedUntil,
      })
      .from(authUser)
      .where(eq(authUser.email, email))
      .limit(1)

    if (!row) return null
    return lockoutState(row, now)
  })
}

/**
 * Count one failure against the address, and lock it if that was the fifth.
 *
 * Read and write in one transaction, so two attempts arriving together cannot
 * both read four and both write five. `for update` is what makes that true
 * rather than merely likely: without it the second transaction reads the row
 * as it was before the first committed, and the fifth failure that should
 * close the account instead overwrites the count with the same number.
 *
 * A parallel brute-force is precisely the traffic this is counting, so the
 * race is not hypothetical — it is the attack.
 */
export async function recordSignInFailure(email: string, now = new Date()): Promise<void> {
  if (usePilotFixtures()) return

  await withActor(systemActor(), async (tx) => {
    const [row] = await tx
      .select({
        id: authUser.id,
        failedCount: authUser.failedSignInCount,
        lastFailedAt: authUser.lastFailedSignInAt,
        lockedUntil: authUser.lockedUntil,
      })
      .from(authUser)
      .where(eq(authUser.email, email))
      .limit(1)
      .for('update')

    // No account. Nothing to count, and nothing written that would later
    // distinguish this address from one that has never been tried.
    if (!row) return

    const next = afterFailure(row, now)

    await tx
      .update(authUser)
      .set({
        failedSignInCount: next.failedCount,
        lastFailedSignInAt: next.lastFailedAt,
        lockedUntil: next.lockedUntil,
        // `updated_at` is maintained by a trigger on every audited table, and
        // `auth_user` is not one of them (`0003` excludes `auth_*`). So it is
        // set by hand here, or it silently stops tracking.
        updatedAt: sql`now()`,
      })
      .where(eq(authUser.id, row.id))
  })
}

/**
 * Clear the run after a correct password.
 *
 * Unconditional rather than "only if there is something to clear": the extra
 * statement costs nothing next to the round trip already spent authenticating,
 * and a conditional here would be one more branch whose wrong arm leaves an
 * account permanently one mistake from a lock.
 */
export async function clearSignInFailures(email: string): Promise<void> {
  if (usePilotFixtures()) return

  const cleared = afterSuccess()

  await withActor(systemActor(), async (tx) => {
    await tx
      .update(authUser)
      .set({
        failedSignInCount: cleared.failedCount,
        lastFailedSignInAt: cleared.lastFailedAt,
        lockedUntil: cleared.lockedUntil,
        updatedAt: sql`now()`,
      })
      .where(eq(authUser.email, email))
  })
}
