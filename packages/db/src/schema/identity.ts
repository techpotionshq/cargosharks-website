/**
 * Tenancy and identity — Architecture §6.1, §8.
 *
 * Authorization lives here, in our tables, and never inside the auth library.
 * `principal_branch_roles` is why: FR-ID-02 requires a user to hold a
 * *different role in each branch*, and no hosted auth provider models that.
 * Keeping it ours also keeps Better Auth replaceable in days (§8).
 */

import { boolean, index, integer, jsonb, text, unique, uniqueIndex } from 'drizzle-orm/pg-core'
import { pk, ref, timestamps, tsz } from './columns'
import { pgTable, systemTable } from './table'
import { localeEnum, principalTypeEnum } from './enums'
import { assets } from './files'

/**
 * A branch is the tenancy boundary and the legal entity — FR-ID-01.
 *
 * Five offices, each with its own registration, invoice series, base currency
 * and working calendar. Everything branch-scoped hangs off `branch_id`, and
 * RLS reads it (§5.3).
 */
export const branches = pgTable(
  'branches',
  {
    id: pk(),
    code: text('code').notNull().unique(),
    legalNameEn: text('legal_name_en').notNull(),
    legalNameAr: text('legal_name_ar').notNull(),
    country: text('country').notNull(),
    baseCurrency: text('base_currency').notNull(),
    taxRegistration: text('tax_registration'),
    /** Prefix and counter for FR-FN numbering; each entity numbers its own. */
    invoiceSeries: text('invoice_series').notNull(),
    invoiceSeriesNext: integer('invoice_series_next').notNull().default(1),
    letterheadAssetId: ref('letterhead_asset_id').references(() => assets.id),
    calendarId: ref('calendar_id').notNull(),
    timeZone: text('time_zone').notNull().default('Asia/Kuwait'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [index('branches_active_idx').on(t.isActive)],
)

/**
 * Everyone who can act: staff, customer contacts, agent contacts, and the
 * system itself.
 *
 * One table rather than three because RLS switches on `type` (§5.3) and a
 * single audit trail should not need a union to answer "who did this".
 * SYSTEM_ACTOR is a row here too — background work is an auditable principal,
 * not an absence of one.
 */
export const principals = pgTable(
  'principals',
  {
    id: pk(),
    type: principalTypeEnum('type').notNull(),
    /** Better Auth's user id. Null for the system principal. */
    authUserId: text('auth_user_id').unique(),
    email: text('email').notNull(),
    nameEn: text('name_en').notNull(),
    nameAr: text('name_ar'),
    locale: localeEnum('locale').notNull().default('en'),
    phone: text('phone'),
    /** Set for customer_contact; drives the portal RLS branch of the policy. */
    customerId: ref('customer_id'),
    /** Set for agent_contact; drives the partner branch of the policy. */
    partnerId: ref('partner_id'),
    /** Deactivated, never deleted — FR-ID-09, §5.5. */
    isActive: boolean('is_active').notNull().default(true),
    deactivatedAt: tsz('deactivated_at'),
    lastSeenAt: tsz('last_seen_at'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('principals_email_idx').on(t.email),
    index('principals_customer_idx').on(t.customerId),
    index('principals_partner_idx').on(t.partnerId),
  ],
)

export const roles = pgTable('roles', {
  id: pk(),
  key: text('key').notNull().unique(),
  nameEn: text('name_en').notNull(),
  nameAr: text('name_ar').notNull(),
  /** Administrator and Finance must hold 2FA — FR-ID-06, checked at sign-in. */
  requiresTwoFactor: boolean('requires_two_factor').notNull().default(false),
  isSystem: boolean('is_system').notNull().default(false),
  ...timestamps,
})

/**
 * The permission matrix — FR-ID-03, editable without a release.
 *
 * A row per (role, permission). `allowed` is explicit rather than implied by
 * the row's existence, so revoking a permission leaves an auditable trail
 * instead of a missing row.
 */
export const rolePermissions = pgTable(
  'role_permissions',
  {
    id: pk(),
    roleId: ref('role_id')
      .notNull()
      .references(() => roles.id),
    /** Matches `permissionKeys()` in core/states.ts — `job.close`, and so on. */
    permissionKey: text('permission_key').notNull(),
    allowed: boolean('allowed').notNull().default(true),
    ...timestamps,
  },
  (t) => [unique('role_permissions_unique').on(t.roleId, t.permissionKey)],
)

/**
 * The FR-ID-02 composite: a role *per branch*, not one global role.
 *
 * A coordinator in Kuwait who is read-only in Dubai is two rows, and the
 * branch list this produces is exactly what `withActor` stamps into
 * `app.branch_ids` for RLS to read.
 */
export const principalBranchRoles = pgTable(
  'principal_branch_roles',
  {
    id: pk(),
    principalId: ref('principal_id')
      .notNull()
      .references(() => principals.id),
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id),
    roleId: ref('role_id')
      .notNull()
      .references(() => roles.id),
    ...timestamps,
  },
  (t) => [
    unique('principal_branch_role_unique').on(t.principalId, t.branchId),
    index('principal_branch_roles_branch_idx').on(t.branchId),
  ],
)

/**
 * Read-only, scoped API keys for the public API — FR-AD-05.
 *
 * Written directly rather than by importing Better Auth's api-key plugin (§8):
 * prefix, hash, scope, revoke. About a hundred lines, and the authorization
 * logic is ours to reason about.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: pk(),
    /** Shown in the UI and carried in the token, so a key is identifiable. */
    prefix: text('prefix').notNull().unique(),
    /** Argon2id of the secret half. The secret is shown once, at creation. */
    secretHash: text('secret_hash').notNull(),
    name: text('name').notNull(),
    customerId: ref('customer_id'),
    branchId: ref('branch_id').references(() => branches.id),
    /** Permission keys this key may exercise. Read-only scopes in R1. */
    scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
    createdById: ref('created_by_id').references(() => principals.id),
    lastUsedAt: tsz('last_used_at'),
    expiresAt: tsz('expires_at'),
    /** Revoked, never deleted — revocation has to remain visible. */
    revokedAt: tsz('revoked_at'),
    revokedById: ref('revoked_by_id').references(() => principals.id),
    ...timestamps,
  },
  (t) => [index('api_keys_customer_idx').on(t.customerId)],
)

/**
 * Rate-limit counters for the unauthenticated tracking page — FR-CP-05.
 *
 * Public tracking is unauthenticated by design, so it needs a second
 * identifier and a throttle: an enumeration control, not a session (§8).
 */
export const rateLimitBuckets = systemTable(
  'Throttle counters. Not business data; no audit value.',
)('rate_limit_buckets', {
  key: text('key').primaryKey(),
  count: integer('count').notNull().default(0),
  windowStartedAt: tsz('window_started_at').notNull().defaultNow(),
})

export type Branch = typeof branches.$inferSelect
export type Principal = typeof principals.$inferSelect
export type Role = typeof roles.$inferSelect
export type RolePermission = typeof rolePermissions.$inferSelect
export type PrincipalBranchRole = typeof principalBranchRoles.$inferSelect
export type ApiKey = typeof apiKeys.$inferSelect
