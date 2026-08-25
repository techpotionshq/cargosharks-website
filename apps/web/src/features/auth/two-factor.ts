'use server'

/**
 * Two-factor enrolment and the sign-in challenge — FR-ID-06.
 *
 * ## What was here before
 *
 * The flag, and nothing behind it. `roles.requires_two_factor` was seeded true
 * for Administrator and Finance, `getSession()` computed `requiresTwoFactor`
 * on every request, the users screen drew an icon for it — and no code path
 * ever read the result. The sign-in page told operators that "two-factor
 * authentication is required for Administrator and Finance roles" and there
 * was no way to enrol and nothing that would have stopped them without it.
 *
 * Worse, it could not have worked if something had tried. `auth_two_factor`
 * was missing `verified`, `failed_verification_count` and `locked_until`,
 * which the installed Better Auth writes on enable and reads on verify, so the
 * first person to scan a code would have met an undefined-column error.
 * Migration `0038` adds them.
 *
 * ## The two doors
 *
 * They are different states and the difference matters:
 *
 *   challenge  the account already has TOTP. Better Auth answered sign-in with
 *              `twoFactorRedirect` and a short-lived cookie *instead of* a
 *              session. Nothing is signed in yet.
 *   enrolment  the password was accepted and a real session exists, but the
 *              principal's role demands TOTP and the account has none. The
 *              shells send them here and will not let them past.
 *
 * Enrolment therefore runs with a session and the challenge runs without one,
 * which is why the challenge cannot be a screen inside any shell.
 *
 * ## Why the session is not trusted to say "enrolled"
 *
 * `requiresTwoFactor` is recomputed per request from `roles`, and whether the
 * account *has* TOTP is read from `auth_user.two_factor_enabled` at the same
 * moment. Neither is cached in the cookie. A role gaining the requirement on
 * Tuesday takes effect on Tuesday, for sessions opened on Monday — which is
 * what the comment on `auth_two_factor` claimed all along and what nothing
 * previously delivered.
 */

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import QRCode from 'qrcode'
import { auth } from '@/lib/auth'
import { applySetCookie } from './cookies'

export interface ChallengeState {
  readonly error?: string
}

/**
 * Finish a sign-in with the six digits — the challenge door.
 *
 * The temporary cookie Better Auth set during sign-in is what identifies the
 * half-authenticated caller, so the request headers are forwarded rather than
 * a user id being passed in. There is deliberately nothing in the form that
 * names an account: a code alone must not be enough to say *whose*.
 */
export async function verifyChallenge(
  _previous: ChallengeState,
  formData: FormData,
): Promise<ChallengeState> {
  const t = await getTranslations('twoFactor')
  const code = digits(formData.get('code'))

  if (!code) return { error: t('errorMissing') }

  let response: Response
  try {
    response = await auth.api.verifyTOTP({
      body: { code },
      headers: await headers(),
      asResponse: true,
    })
  } catch {
    /*
      One message for a wrong code, an expired window, a code already spent and
      a challenge cookie that has gone stale.

      The library also locks the second factor after repeated failures
      (`failed_verification_count`, `locked_until` — its own counters, separate
      from the password lockout in `core/lockout.ts`). Reporting that state
      separately would tell an attacker holding a stolen password exactly how
      many guesses they have left.
    */
    return { error: t('errorInvalid') }
  }

  if (!response.ok) return { error: t('errorInvalid') }

  await carryCookies(response)
  redirect('/dashboard')
}

export interface EnrolState {
  /** The `otpauth://` URI, once a secret has been issued. */
  readonly totpUri?: string
  /** That URI as an inline SVG, ready to render. */
  readonly qr?: string
  /** Shown once, never retrievable again. */
  readonly backupCodes?: readonly string[]
  readonly error?: string
}

/**
 * Step one of enrolment: prove the password, receive a secret.
 *
 * The password is asked for again even though a session already exists. It is
 * the standard step-up and it is worth the friction — an unattended desk is
 * exactly how somebody would otherwise bind *their* authenticator to somebody
 * else's account, and from then on the second factor is the attacker's.
 */
export async function beginEnrolment(
  _previous: EnrolState,
  formData: FormData,
): Promise<EnrolState> {
  const t = await getTranslations('twoFactor')
  const password = String(formData.get('password') ?? '')

  if (!password) return { error: t('errorPasswordMissing') }

  let result: { totpURI: string; backupCodes: string[] }
  try {
    result = await auth.api.enableTwoFactor({
      body: { password },
      headers: await headers(),
    })
  } catch {
    return { error: t('errorPasswordWrong') }
  }

  /*
    The QR is rendered here, on the server, and handed over as finished markup.

    Not as a data-URI image: the content-security policy in `proxy.ts` admits
    `data:` under `img-src` today, and an enrolment screen that silently breaks
    the first time somebody tightens that is a bad trade for no benefit. Inline
    SVG is governed by nothing and scales without a second request.

    `margin: 0` because the card supplies the quiet zone as padding — the
    library's default four modules of white would sit inside a white box and
    look like a rendering fault.
  */
  const qr = await QRCode.toString(result.totpURI, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 0,
    width: 220,
  })

  return { totpUri: result.totpURI, qr, backupCodes: result.backupCodes }
}

/**
 * Step two: prove the authenticator actually works.
 *
 * Better Auth flips `two_factor_enabled` here rather than in `enableTwoFactor`,
 * and that ordering is the safety property. An account marked as enrolled on
 * the strength of a QR code nobody scanned is an account whose owner is locked
 * out at their next sign-in by a factor they do not have.
 */
export async function completeEnrolment(
  _previous: ChallengeState,
  formData: FormData,
): Promise<ChallengeState> {
  const t = await getTranslations('twoFactor')
  const code = digits(formData.get('code'))

  if (!code) return { error: t('errorMissing') }

  let response: Response
  try {
    response = await auth.api.verifyTOTP({
      body: { code },
      headers: await headers(),
      asResponse: true,
    })
  } catch {
    return { error: t('errorInvalid') }
  }

  if (!response.ok) return { error: t('errorInvalid') }

  /*
    Verifying rotates the session — the library issues a new one and deletes
    the old — so the fresh cookie has to be carried across or the operator is
    signed out by the act of securing their account.
  */
  await carryCookies(response)
  redirect('/dashboard')
}

/**
 * Six digits, with whatever an authenticator app put between them removed.
 *
 * Every one of them shows the code as `123 456`, and people copy what they
 * see. Refusing the space teaches an operator that the field is fussy rather
 * than that the code was wrong.
 */
function digits(raw: FormDataEntryValue | null): string | null {
  const cleaned = String(raw ?? '').replaceAll(/\D/g, '')
  return cleaned.length === 6 ? cleaned : null
}

/** Forward Better Auth's `Set-Cookie` headers onto the real navigation. */
async function carryCookies(response: Response): Promise<void> {
  const store = await cookies()
  for (const header of response.headers.getSetCookie()) applySetCookie(store, header)
}
