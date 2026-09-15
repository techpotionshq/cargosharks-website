/**
 * Better Auth's own tables — core surface only (§8).
 *
 * Credentials, sessions and TOTP live here and nothing else does. Authorization
 * is in `identity.ts`; `principals.auth_user_id` is the single join between the
 * two, which is what keeps the auth library replaceable in days.
 *
 * Sessions are database-backed and opaque, never stateless JWTs: FR-ID-08
 * requires revocation to take effect on the *next* request, and FR-MD-03
 * requires a revoked portal contact to be blocked at sign-in immediately.
 * A JWT with a fifteen-minute life cannot satisfy either.
 *
 * Explicitly not present: SSO, SCIM, OIDC-provider, MCP, Stripe and api-key
 * plugin tables. Release One needs none of them and they carry the whole of
 * the library's 2026 advisory history.
 */

import { boolean, integer, text } from 'drizzle-orm/pg-core'
import { timestamps, tsz } from './columns'
import { systemTable } from './table'

const authTable = systemTable(
  'Owned by Better Auth. Not branch-scoped: scoping happens on principals, ' +
    'and an audit trigger over credential rows would copy secrets into the log.',
)

export const authUser = authTable('auth_user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  /** Mirrors `principals.is_active` so a deactivated user cannot sign in. */
  banned: boolean('banned').notNull().default(false),
  banReason: text('ban_reason'),
  banExpires: tsz('ban_expires'),
  twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),

  /*
    Sign-in lockout — FR-ID-05. The policy is `lockout.ts` in `core`; these
    three columns are the only state it needs.

    Here rather than in a table of their own, and that is the whole design
    decision. A throttle keyed on whatever address was typed grows a row for
    every address an attacker invents, from an endpoint that requires no
    credential — `rate_limit_buckets` was dropped in `0035` for being exactly
    that shape with nobody reading it. Counters hung on the account can only
    exist for accounts that exist, so the table is bounded by the staff list.

    The unknown-address case is covered instead by the per-address throttle in
    `apps/web/src/lib/throttle.ts`, which holds no rows at all. Locking only
    real accounts would otherwise answer the question the sign-in form works
    hard not to answer (FR-ID-04): whether an address is one of ours.

    Not `banned` / `ban_expires`, which sit two fields up and would appear to
    fit. Those mirror `principals.is_active` — an administrator's decision
    about a person. Overloading them would mean a lock lifting at 09:15 also
    quietly reinstating somebody who was suspended in March.
  */
  failedSignInCount: integer('failed_sign_in_count').notNull().default(0),
  lastFailedSignInAt: tsz('last_failed_sign_in_at'),
  lockedUntil: tsz('locked_until'),

  ...timestamps,
})

export const authSession = authTable('auth_session', {
  id: text('id').primaryKey(),
  /** Opaque. Looked up per request inside the same transaction as the RLS set-up. */
  token: text('token').notNull().unique(),
  userId: text('user_id')
    .notNull()
    .references(() => authUser.id),
  expiresAt: tsz('expires_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  ...timestamps,
})

export const authAccount = authTable('auth_account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => authUser.id),
  /** Credentials provider only — hashed. No OAuth tokens in Release One. */
  password: text('password'),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: tsz('access_token_expires_at'),
  refreshTokenExpiresAt: tsz('refresh_token_expires_at'),
  scope: text('scope'),
  ...timestamps,
})

export const authVerification = authTable('auth_verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: tsz('expires_at').notNull(),
  ...timestamps,
})

/**
 * TOTP secrets and backup codes — FR-ID-05…06.
 *
 * Mandatory 2FA for Administrator and Finance is checked at session
 * establishment, not only at enrolment, so a session predating the policy does
 * not survive it.
 */
export const authTwoFactor = authTable('auth_two_factor', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => authUser.id),
  secret: text('secret').notNull(),
  backupCodes: text('backup_codes').notNull(),

  /*
    Three columns the library writes and this table did not have.

    They are not new requirements — they are the plugin's own schema, and their
    absence is why enrolment could never have succeeded: Better Auth's enable
    and verify handlers write `verified` and read it back, so the first operator
    to scan a QR code would have met an undefined-column error. Nothing caught
    it because nothing ever ran the flow. FR-ID-06 named mandatory two-factor
    for Administrator and Finance, `roles.requires_two_factor` carried the flag,
    the settings screen displayed it — and no code path enforced it or enrolled
    anybody, so the gap stayed theoretical and the schema drifted underneath it.

    `verified` defaults to true, which reads backwards and is the library's
    choice rather than ours: a row is only created at the moment a secret is
    issued, and the enable handler immediately writes `false` when verification
    is required. The default matters only for rows written by something other
    than the plugin, of which there are none.

    `failed_verification_count` and `locked_until` are the plugin's own lockout
    on the six digits — separate from, and complementary to, the password
    lockout in `core/lockout.ts`. Guessing a TOTP code and guessing a password
    are different attacks against the same account and each needs its own
    counter.
  */
  verified: boolean('verified').notNull().default(true),
  failedVerificationCount: integer('failed_verification_count').notNull().default(0),
  lockedUntil: tsz('locked_until'),
})
