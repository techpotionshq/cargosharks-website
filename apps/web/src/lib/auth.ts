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

/**
 * The signing secret, refused rather than defaulted.
 *
 * Better Auth *warns* when `secret` is undefined and carries on with a
 * built-in default. In a fleet of per-customer deployments that is the
 * worst-shaped failure available: every deployment that shipped without the
 * variable set would share one publicly-known signing key, so a session cookie
 * minted anywhere would be accepted everywhere, and the only trace of it is a
 * log line in the middle of a build.
 *
 * The placeholder is refused too. `.env.example` ships
 * `replace-me-with-32-bytes-of-base64`, and a value copied verbatim out of a
 * committed file is not a secret — it is the default with extra steps.
 *
 * Development is exempt so a fresh clone still runs; production is not, and
 * refusing to boot is the correct outcome. A deployment that will not start is
 * an incident someone fixes in ten minutes. One that starts with forgeable
 * sessions is an incident nobody notices.
 */
function signingSecret(): string | undefined {
  const secret = process.env.BETTER_AUTH_SECRET

  /*
    Runtime, not build time.

    `next build` runs with `NODE_ENV=production` and evaluates this module
    while collecting routes, long before any secret is needed — so checking
    `NODE_ENV` alone makes the build itself require production credentials,
    which is both wrong and the sort of thing that gets the check deleted
    rather than fixed. `NEXT_PHASE` is what distinguishes the two.
  */
  const building = process.env.NEXT_PHASE === 'phase-production-build'

  if (process.env.NODE_ENV === 'production' && !building) {
    if (!secret || secret.includes('replace-me')) {
      throw new Error(
        'BETTER_AUTH_SECRET is unset or still the .env.example placeholder. ' +
          'Refusing to start: Better Auth would fall back to a shared default ' +
          'signing key, and a session minted against one deployment would be ' +
          'accepted by every other. Generate one per tenant: ' +
          '`openssl rand -base64 32`.',
      )
    }
  }

  return secret
}

export const auth = betterAuth({
  secret: signingSecret(),
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
    minPasswordLength: 12,
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

  plugins: [twoFactor({ issuer: 'Al-Qabandi & Partners' })],
})
