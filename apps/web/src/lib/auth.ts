import 'server-only'

/**
 * Better Auth — core surface only (§8).
 *
 * Enabled: email/password and TOTP. That is the whole of it.
 *
 * Explicitly not enabled: the SSO, SCIM, OIDC-provider, MCP, Stripe and
 * api-key plugins. Release One needs none of them and they carry the whole of
 * the library's 2026 advisory history. FR-AD-05's API keys are written
 * directly instead — prefix, hash, scope, revoke, about a hundred lines —
 * rather than importing a plugin whose authorization logic has been wrong
 * before.
 *
 * The one core-adjacent advisory, pre-account hijacking via magic link and
 * email OTP, has no entry point here: FR-ID-07 makes the product
 * invitation-only, and there is no open registration and no magic-link flow.
 *
 * After handover, subscribing to Better Auth security advisories is a named
 * obligation in the runbook (NFR-18, §13). Self-hosting auth trades a
 * subscription fee for a patching duty.
 */

import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { twoFactor } from 'better-auth/plugins'
import {
  db,
  authAccount,
  authSession,
  authTwoFactor,
  authUser,
  authVerification,
} from '@qabandi/db'
import { getBrand } from '@/lib/brand'

/**
 * Stated once, so the policy and the message a person reads cannot drift.
 *
 * Twelve rather than eight. This is a system holding a freight company's
 * commercial rates and its customers' invoices, and the accounts are held by a
 * small named staff who set a password rarely — the cost of four more
 * characters falls almost entirely on an attacker.
 */
export const MIN_PASSWORD_LENGTH = 12

/**
 * The signing secret.
 *
 * Passed straight through, and validated at **start-up** rather than here —
 * see `requireProductionConfig` in `instrumentation.ts`.
 *
 * This used to throw at module evaluation, and that was the wrong place by
 * one layer. The check was right: Better Auth only *warns* when `secret` is
 * undefined and falls back to a shared default signing key, so a session
 * minted against any deployment would be accepted by every other.
 *
 * But a module-scope throw happens before React renders anything, so no error
 * boundary can catch it — `global-error.tsx` included. The result was a bare
 * `Internal Server Error` on every request with the real cause visible only in
 * a stack trace naming a chunk file. It claimed to refuse to start and
 * actually refused to *serve*, one request at a time, unpresentably.
 *
 * Validating in `register()` refuses to start for real: the process fails at
 * boot with a legible message, and a deployment that is misconfigured never
 * takes traffic at all.
 */

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,

  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: authUser,
      session: authSession,
      account: authAccount,
      verification: authVerification,
      twoFactor: authTwoFactor,
    },
  }),

  emailAndPassword: {
    enabled: true,
    // FR-ID-07: invitation only. An open sign-up form is the entry point the
    // pre-account-hijacking advisory needs, and there is no reason to have one
    // for an internal freight platform.
    disableSignUp: true,
    minPasswordLength: MIN_PASSWORD_LENGTH,

    /**
     * One hour.
     *
     * The default is a day, which is a long time for a link that grants an
     * account, sitting in a mailbox that may itself be on a shared machine at
     * a freight desk. An hour is comfortably longer than the gap between
     * asking and reading, and short enough that a forwarded or archived
     * message is not a live credential a week later.
     */
    resetPasswordTokenExpiresIn: 60 * 60,

    /**
     * The reset email, sent by the service.
     *
     * `apps/web` never sends mail (§3) — it hands the message across one
     * process boundary to the only process holding SMTP credentials. The same
     * division that keeps Chromium out of the request path keeps a mailbox
     * password out of the environment of every server component.
     *
     * ## Failing here does not fail the request
     *
     * Better Auth answers the caller regardless of what this callback does,
     * and that is correct: the reply to "reset my password" must be identical
     * whether or not the address exists, or the form becomes an
     * account-enumeration oracle (FR-ID-04). So a mail failure is logged and
     * swallowed rather than surfaced — the person sees "if that address is
     * registered, a link is on its way", which is the honest sentence in both
     * cases.
     *
     * A deployment with no `SERVICE_URL` therefore cannot reset passwords, and
     * it says so in the log rather than appearing to work.
     */
    sendResetPassword: async ({ user, url }) => {
      const serviceUrl = process.env.SERVICE_URL
      const secret = process.env.INTERNAL_API_SECRET

      if (!serviceUrl || !secret) {
        console.error(
          'password reset requested but SERVICE_URL / INTERNAL_API_SECRET are not set — ' +
            'no email can be sent',
        )
        return
      }

      try {
        const response = await fetch(
          `${serviceUrl.replace(/\/$/, '')}/internal/mail/password-reset`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
            body: JSON.stringify({ email: user.email, url }),
            signal: AbortSignal.timeout(20_000),
          },
        )

        if (!response.ok) {
          console.error(`password reset mail refused: ${response.status} ${response.statusText}`)
        }
      } catch (error) {
        console.error({ error }, 'password reset mail could not be sent')
      }
    },
  },

  session: {
    // Database-backed and opaque, never a stateless JWT: FR-ID-08 requires
    // revocation to take effect on the next request, and FR-MD-03 requires a
    // revoked portal contact to be blocked at sign-in at once.
    expiresIn: 60 * 60 * 12,
    updateAge: 60 * 60,
    cookieCache: { enabled: false },
  },

  advanced: {
    cookiePrefix: 'qabandi',
    useSecureCookies: process.env.NODE_ENV === 'production',
  },

  /**
   * The issuer is the label in the person's authenticator app.
   *
   * It is not decoration and it is not a setting: it is baked into the
   * `otpauth://` URI of the enrolment QR, and an authenticator copies it once
   * at scan time and never looks again. So changing it here renames the entry
   * for people who enrol *afterwards* and does nothing at all for anyone
   * already enrolled — their app keeps showing whatever it was told the day
   * they scanned. Getting it wrong is therefore wrong permanently for that
   * population; the only remedy is asking each of them to re-enrol.
   *
   * Which is exactly why it must come from the brand rather than be typed. A
   * whitelabel deployment whose staff see another company's name beside their
   * six digits is the one place a hard-coded operator name cannot be corrected
   * by a re-skin.
   *
   * `getBrand()` at module scope is fine: it returns a value resolved once per
   * process, and React's `cache` wrapper calls straight through when there is
   * no request to memoise against.
   */
  plugins: [twoFactor({ issuer: getBrand().identity.nameEn })],
})
