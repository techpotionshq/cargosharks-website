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
 * The mail is worded as an invitation unless the person already has a
 * password (D11): the reset wording told a newly invited contact their
 * "current password still works".
 *
 * ## The outcome is told, not assumed
 *
 * The public reset form must say the same sentence whatever happened (FR-ID-04).
 * An administrator must not: "sent" when the mail service is not configured is
 * the same lie the old button told. `resetMailOutcome` carries back what
 * `sendResetPassword` actually did.
 */

import {
  auth,
  resetMailIntent,
  resetMailOutcome,
  type ResetMailIntent,
  type ResetMailOutcome,
  type ResetMailReport,
} from '@/lib/auth'
import { AUTH_REFUSAL, refusalOf } from '@/lib/auth-guard'
import { succeed, type ActionState, type Translate } from '@/lib/form-state'

export type SignInLinkOutcome = ResetMailOutcome | 'throttled' | 'no_login'

export interface SignInLinkResult {
  readonly outcome: SignInLinkOutcome
  /**
   * The set-password link itself, for the administrator to pass on by hand.
   *
   * Only when mail is set to log only, so nothing was delivered and the link
   * would otherwise exist nowhere a person can reach, and only for an
   * invitation. A reset goes to somebody who already has a password, and
   * handing their link to an administrator would let the administrator sign
   * in as them; an invitation is to an account the administrator has just
   * made and nobody has used. Every caller is behind `admin.users.write`.
   */
  readonly handOver: string | null
}

/**
 * `intent` words the mail: an invitation for somebody who has never had a
 * password, a reset otherwise. The link is the same either way.
 */
export async function sendSignInLink(
  email: string,
  intent: ResetMailIntent = 'invitation',
): Promise<SignInLinkResult> {
  const reports: ResetMailReport[] = []
  try {
    await resetMailIntent.run(intent, () =>
      resetMailOutcome.run(reports, () =>
        auth.api.requestPasswordReset({ body: { email, redirectTo: '/reset-password' } }),
      ),
    )
  } catch (error) {
    // The per-address reset budget applies to administrators too: three links
    // an hour to one mailbox is generous for a person and a ceiling for a bug.
    if (refusalOf(error)?.code === AUTH_REFUSAL.resetThrottled) {
      return { outcome: 'throttled', handOver: null }
    }
    console.error({ error }, 'sign-in link could not be issued')
    return { outcome: 'unreachable', handOver: null }
  }
  const report = reports[0]
  // Better Auth found no `auth_user` for the address and, by design, says
  // nothing about it; no outcome was reported because no mail was attempted.
  if (!report) return { outcome: 'no_login', handOver: null }
  return {
    outcome: report.outcome,
    handOver: report.outcome === 'logged' && intent === 'invitation' ? report.url : null,
  }
}

/**
 * Saved, and said so honestly when the invitation did not go.
 *
 * The person exists either way, so this is a success that closes the dialog.
 * Its confirmation says no email went and where the next step is, the "send
 * sign-in link" beside them, which reports why and, on a deployment set to log
 * mail only, hands the administrator the link to pass on.
 */
export function invitedNotice(
  tv: Translate,
  email: string,
  mailed: SignInLinkResult | null,
): ActionState {
  if (!mailed || mailed.outcome === 'sent') return succeed(email)
  return { ...succeed(email), message: tv('invitedNoMail', { email }) }
}
