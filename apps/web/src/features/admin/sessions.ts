import 'server-only'

/**
 * Ending a person's sessions when they are suspended — run 5, O4.
 *
 * Suspension already blocked the next request: the session lookup re-reads
 * `principals.is_active` every time (`lib/session.ts`). But it left the
 * session rows standing, so turning "Can sign in" back on revived every
 * cookie the person had, on every machine, for the rest of its twelve hours.
 * A suspension is often the response to a lost laptop or a leaver; the cookie
 * on that laptop must not come back to life the day the account is restored
 * for its rightful owner.
 *
 * Deleted rather than marked: `auth_session` sits outside the "nothing is
 * deleted" rule by design (`0039` grants `delete` on it to `app_user`, which is
 * how sign-out and password reset revoke), because a session row is a bearer
 * credential, not a business record. Who suspended whom is in the audit log on
 * `principals`.
 *
 * Not a server action, and kept out of `form-actions.ts` for that reason:
 * everything a `'use server'` module exports is callable from the browser.
 */

import { eq, inArray } from 'drizzle-orm'
import { authSession, principals, type Tx } from '@qabandi/db'

/** Delete every session belonging to this principal's login. Same transaction as the suspension. */
export async function endSessionsOf(tx: Tx, principalId: string): Promise<void> {
  await tx
    .delete(authSession)
    .where(
      inArray(
        authSession.userId,
        tx
          .select({ id: principals.authUserId })
          .from(principals)
          .where(eq(principals.id, principalId)),
      ),
    )
}
