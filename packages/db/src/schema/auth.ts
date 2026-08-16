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

import { boolean, text } from 'drizzle-orm/pg-core'
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
})

export type AuthUser = typeof authUser.$inferSelect
export type AuthSession = typeof authSession.$inferSelect
