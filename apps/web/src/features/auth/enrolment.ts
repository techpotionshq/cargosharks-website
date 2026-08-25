import 'server-only'

/**
 * "Does this person still owe us a second factor?" — FR-ID-06.
 *
 * One predicate, used by the two internal shells and by the enrolment page
 * itself, so the guard and the screen it guards cannot disagree. A copy in
 * each shell is how one of them ends up checking a slightly different thing
 * and quietly admitting an unenrolled administrator.
 *
 * ## Two facts, read at two different times
 *
 * `requiresTwoFactor` is the *role's* demand and is recomputed on every
 * request by `getSession()` from `roles.requires_two_factor`. Whether the
 * account has actually enrolled is a property of `auth_user`, read here.
 *
 * Neither is cached in the cookie, and that is the point. A role that gains
 * the requirement on Tuesday takes effect on Tuesday — including for sessions
 * opened on Monday, which is what the comment on `auth_two_factor` promised
 * from the beginning: "checked at session establishment, not only at
 * enrolment, so a session predating the policy does not survive it."
 */

import { eq } from 'drizzle-orm'
import { authUser, principals, systemActor, withActor } from '@qabandi/db'
import { usePilotFixtures } from '@/lib/pilot/source'
import type { Session } from '@/lib/session'

/**
 * True when the shells must divert this principal to `/two-factor/enrol`.
 *
 * The cheap half is tested first and deliberately: `requiresTwoFactor` is
 * already on the session, so an operations coordinator — whose role does not
 * demand a second factor — costs no query at all. Only the populations that
 * owe one pay for the lookup, which is a handful of administrators and the
 * finance desk.
 */
export async function needsTwoFactorEnrolment(session: Session): Promise<boolean> {
  if (!session.requiresTwoFactor) return false

  /*
    No database, no enrolment to check, and nothing to divert to.

    The pilot's principal is a fixture with no `auth_user` row (`lib/session.ts`),
    so a lookup here would find nothing and — read naively — would conclude that
    the one account in a fixture deployment has not enrolled, and redirect it to
    a screen that cannot work without Better Auth. Every screen in
    `QABANDI_PILOT_FIXTURES=1` would become the enrolment form.
  */
  if (usePilotFixtures()) return false

  return withActor(systemActor(), async (tx) => {
    const [row] = await tx
      .select({ enabled: authUser.twoFactorEnabled })
      .from(principals)
      .innerJoin(authUser, eq(authUser.id, principals.authUserId))
      .where(eq(principals.id, session.principal.id))
      .limit(1)

    /*
      No row means a principal with no `auth_user` behind it — a record created
      by a seed or an import that never had a credential attached.

      Answered `false`: such an account cannot sign in at all, so it can never
      be the caller here, and guessing `true` would only add a redirect for a
      state that is already impossible. Erring the other way would turn a
      data-quality problem in one row into a lockout.
    */
    return row ? !row.enabled : false
  })
}
