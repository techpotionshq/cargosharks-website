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
import { db, authAccount, authSession, authTwoFactor, authUser, authVerification } from '@qabandi/db'

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
