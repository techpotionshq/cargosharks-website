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
import { AUTH_REFUSAL, refusalOf } from '@/lib/auth-guard'
import { applySetCookie } from './cookies'
import { demoReadOnlyMessage } from '@/lib/pilot/read-only'

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
  const demo = await demoReadOnlyMessage()
  if (demo) return { error: demo }
  const t = await getTranslations('twoFactor')

  /*
    A backup code, or the six digits — A6.

    The page has always said "enter one of your backup codes" beneath this
    field, and the field could not take one: it stripped every non-digit and
    required exactly six, while Better Auth's codes look like `aB3x9-Q7kLm`.
    A person who lost their phone was locked out with the recovery path
    printed in front of them. The shape decides which endpoint to ask; the
    library spends the backup code, so each one works once.
  */
  const backup = backupCode(formData.get('code'))
  const code = backup ? null : digits(formData.get('code'))

  if (!backup && !code) return { error: t('errorMissingOrBackup') }

  let response: Response
  try {
    response = backup
      ? await auth.api.verifyBackupCode({
          body: { code: backup },
          headers: await headers(),
          asResponse: true,
        })
      : await auth.api.verifyTOTP({
          body: { code: code! },
          headers: await headers(),
          asResponse: true,
        })
  } catch (error) {
    // A lock or throttle the guard raised has its own sentence (below).
    const refused = await refusalSentence(error)
    if (refused) return { error: refused }
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

  if (!response.ok) {
    return { error: (await refusalSentence(await jsonOf(response))) ?? t('errorInvalid') }
  }

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
  const demo = await demoReadOnlyMessage()
  if (demo) return { error: demo }
  const t = await getTranslations('twoFactor')
  const password = String(formData.get('password') ?? '')

  if (!password) return { error: t('errorPasswordMissing') }

  let result: { totpURI: string; backupCodes: string[] }
  try {
    result = await auth.api.enableTwoFactor({
      body: { password },
      headers: await headers(),
    })
  } catch (error) {
    /*
      The operator sees one message; the reason is written down.

      `enableTwoFactor` fails the same way for a wrong password and for
      everything that is not one — a session the call cannot see, a plugin that
      is not registered, a write the database refused. Showing them apart would
      tell whoever is guessing which half they got right, so the message stays
      as it is. Keeping them apart *in the log* costs nothing and is the whole
      difference between a diagnosis and a shrug: a seeded end-to-end run spent
      its entire job timing out on an enrolment that never began, and the only
      account of why had been discarded here.
    */
    console.error({ error }, 'two-factor enrolment could not begin')
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
  const demo = await demoReadOnlyMessage()
  if (demo) return { error: demo }
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
  } catch (error) {
    return { error: (await refusalSentence(error)) ?? t('errorInvalid') }
  }

  if (!response.ok) {
    return { error: (await refusalSentence(await jsonOf(response))) ?? t('errorInvalid') }
  }

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

/**
 * A backup code in Better Auth's shape — ten letters and digits, shown as
 * `aB3x9-Q7kLm` — or null.
 *
 * Case is kept, because the codes are case-sensitive. Spaces are dropped and
 * the dash is optional on the way in and restored on the way out, since a
 * code copied from a printout or typed from a phone arrives every way. Ten
 * characters cannot be mistaken for six digits, which is what lets one field
 * take both.
 */
function backupCode(raw: FormDataEntryValue | null): string | null {
  const compact = String(raw ?? '').replaceAll(/\s/g, '')
  const match = /^([A-Za-z0-9]{5})-?([A-Za-z0-9]{5})$/.exec(compact)
  return match ? `${match[1]}-${match[2]}` : null
}

/** Forward Better Auth's `Set-Cookie` headers onto the real navigation. */
async function carryCookies(response: Response): Promise<void> {
  const store = await cookies()
  for (const header of response.headers.getSetCookie()) applySetCookie(store, header)
}

/**
 * The sentence for a lock or throttle the guard raised on the TOTP check, or
 * null for anything else.
 *
 * Five wrong codes lock that user for fifteen minutes (`lib/throttle.ts`).
 * Said in the words the password step uses for its lock, so a person meets one
 * sentence for one situation whichever step tripped it. Telling them is safe
 * here: whoever reached this step already had the password, and "wrong code"
 * on a correct code for fifteen minutes reads as a broken authenticator, which
 * is a support call and a reason to switch the factor off.
 */
async function refusalSentence(value: unknown): Promise<string | null> {
  const refusal = refusalOf(value)
  if (!refusal) return null
  const t = await getTranslations('signIn')
  const minutes = refusal.minutesRemaining
  if (refusal.code === AUTH_REFUSAL.accountLocked) return t('errorLocked', { minutes })
  if (refusal.code === AUTH_REFUSAL.signInThrottled) return t('errorThrottled', { minutes })
  return null
}

/** A response's JSON body, or null for one that is not JSON. Cloned, so the body survives. */
async function jsonOf(response: Response): Promise<unknown> {
  try {
    return await response.clone().json()
  } catch {
    return null
  }
}
