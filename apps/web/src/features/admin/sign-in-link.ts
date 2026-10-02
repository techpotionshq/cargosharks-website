import 'server-only'

/**
 * Send somebody the link that sets their password — A7.
 *
 * An invitation used to write a `principals` row and nothing else: no
 * `auth_user`, no email, so the person invited could never sign in, and the
 * dialog said "Send invitation" about a message nobody sent. The login is now
 * created with the principal (`saveUser`, `inviteCustomerContact`), and this
 * sends the first password through the reset flow that already exists —
 * Better Auth's `resetPassword` creates the credential when there is none, so
 * there is no second, invitation-shaped way to set a password to maintain.
 *
 * The administrator still never types a colleague's password: the link goes to
 * the mailbox, and only its owner can follow it.
 *
 * ## The outcome is told, not assumed
 *
 * The public reset form must say the same sentence whatever happened (FR-ID-04).
 * An administrator must not: "sent" when the mail service is not configured is
 * the same lie the old button told. `resetMailOutcome` carries back what
 * `sendResetPassword` actually did.
 */

import { auth, resetMailOutcome, type ResetMailOutcome } from '@/lib/auth'
import { AUTH_REFUSAL, refusalOf } from '@/lib/auth-guard'

export type SignInLinkOutcome = ResetMailOutcome | 'throttled' | 'no_login'

export async function sendSignInLink(email: string): Promise<SignInLinkOutcome> {
  const outcomes: ResetMailOutcome[] = []
  try {
    await resetMailOutcome.run(outcomes, () =>
      auth.api.requestPasswordReset({ body: { email, redirectTo: '/reset-password' } }),
    )
  } catch (error) {
    // The per-address reset budget applies to administrators too: three links
    // an hour to one mailbox is generous for a person and a ceiling for a bug.
    if (refusalOf(error)?.code === AUTH_REFUSAL.resetThrottled) return 'throttled'
    console.error({ error }, 'sign-in link could not be issued')
    return 'unreachable'
  }
  // Better Auth found no `auth_user` for the address and, by design, says
  // nothing about it; no outcome was reported because no mail was attempted.
  return outcomes[0] ?? 'no_login'
}
