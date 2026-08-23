/**
 * Tenancy and identity — Architecture §6.1, §8.
 *
 * Authorization lives here, in our tables, and never inside the auth library.
 * `principal_branch_roles` is why: FR-ID-02 requires a user to hold a
 * *different role in each branch*, and no hosted auth provider models that.
 * Keeping it ours also keeps Better Auth replaceable in days (§8).
 */

import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { pk, quantity, ref, timestamps, tsz } from './columns'
import { pgTable, systemTable } from './table'
import { localeEnum, principalTypeEnum, supportScopeEnum } from './enums'
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
    /**
     * The same shape for house bills, and nullable where the invoice series is
     * not: a branch that issues no house bills should not have to invent a
     * prefix, and where this is null the number is typed by hand (0010).
     */
    houseBillSeries: text('house_bill_series'),
    houseBillSeriesNext: integer('house_bill_series_next').notNull().default(1),
    /**
     * Control accounts, per legal entity — the counter-accounts every journal
     * line needs and no charge type can supply (0011). All nullable and all
     * checked at export time, so a branch that never exports is not blocked
     * from existing by a chart of accounts nobody has supplied yet.
     */
    arAccountCode: text('ar_account_code'),
    apAccountCode: text('ap_account_code'),
    taxAccountCode: text('tax_account_code'),
    /**
     * Tax we were charged, as against tax we charged (0014).
     *
     * A separate account because the two are separate lines on a return:
     * output tax is a liability, input tax is a receivable from the authority,
     * and a chart that nets them into one balance cannot produce the return.
     * Nullable — a Kuwait entity buying from a Kuwait agent never sees any, and
     * the export only demands it of a bill that actually carries tax.
     */
    inputTaxAccountCode: text('input_tax_account_code'),
    bankAccountCode: text('bank_account_code'),
    fxVarianceAccountCode: text('fx_variance_account_code'),
    roundingAccountCode: text('rounding_account_code'),
    /**
     * FR-FN-05 — below this, an invoice needs a Branch Manager (0014).
     *
     * Per entity rather than global: a Dubai freight desk and a Kuwait customs
     * brokerage do not run on the same margin, and one number for both means
     * either an approval queue nobody can clear or a floor that never fires.
     * Null means no floor is being enforced yet, which is where every
     * deployment starts.
     */
    marginFloorPercent: quantity('margin_floor_percent'),
    letterheadAssetId: ref('letterhead_asset_id').references(() => assets.id),
    /**
     * Standard trading conditions, printed on the quotation — FR-EQ-08.
     *
     * Per legal entity rather than one deployment-wide text, for the same
     * reason `invoice_series` is: a Kuwait forwarder and a Dubai one trade
     * under different law and file with different authorities, and a single
     * paragraph covering both is a paragraph that is wrong somewhere.
     *
     * Columns rather than a template in code, because FR-AD-03 puts wording an
     * administrator can change without a release in the database — the same
     * argument as `notification_templates`. Both nullable: a branch that has
     * not supplied its conditions yet prints a quotation without them rather
     * than being unable to issue one.
     */
    tradingConditionsEn: text('trading_conditions_en'),
    tradingConditionsAr: text('trading_conditions_ar'),
    /**
     * What a quotation from this entity does not cover — FR-EQ-08.
     *
     * One exclusion per line, and a list rather than prose because that is how
     * it prints: "duties, taxes and customs examination charges are excluded"
     * buried in a paragraph is a term the customer was deemed to have read,
     * and the same sentence in a box beside the charges is one they did read.
     * It is the line that decides who pays when the container is pulled.
     *
     * Per entity for the same reason the conditions above are: a Kuwait
     * customs brokerage and a Dubai freight desk exclude different things.
     * Inclusions are not stored beside it — they are the charges actually on
     * the quotation, derived rather than typed, so they cannot disagree with
     * the table above them.
     */
    defaultExclusionsEn: text('default_exclusions_en'),
    defaultExclusionsAr: text('default_exclusions_ar'),
    /**
     * The reverse side of the house bill of lading.
     *
     * The face of the bill says the merchant "agrees to all its terms whether
     * printed, stamped or written", and for that sentence to mean anything the
     * terms have to be printed somewhere. They are printed here — on the back
     * of every sheet, originals and copies alike — and they are rows rather
     * than code for the reason `trading_conditions_en` is: which clauses a
     * forwarder trades under is a legal decision that changes without a
     * release, and a FIATA member prints the FBL conditions where a
     * non-member cannot. Null prints no back page; the face is unchanged.
     */
    billOfLadingTermsEn: text('bill_of_lading_terms_en'),
    billOfLadingTermsAr: text('bill_of_lading_terms_ar'),
    calendarId: ref('calendar_id').notNull(),
    timeZone: text('time_zone').notNull().default('Asia/Kuwait'),
    /**
     * Who a notification from this entity comes from — FR-NT-01.
     *
     * Per legal entity, for the same reason `invoice_series`, the letterhead
     * and the trading conditions are: five entities sending from one address
     * is the same mistake as five entities numbering from one series, and it
     * is the more visible one because the customer reads it.
     *
     * Null falls back to the deployment's own `from` — the `smtp` integration
     * row, or `MAIL_FROM` beneath it. A branch that has not been given its own
     * address sends from the operator's rather than failing to send.
     */
    mailFrom: text('mail_from'),
    /*
      Quiet hours — FR-NT-07, in this branch's local time.

      Constants in the notification dispatcher until now, which made "we do not
      write to customers between nine at night and seven in the morning" a
      statement about the deployment rather than about the office. It is an
      office fact: a Kuwait desk and a Dubai desk keep different hours, and the
      dispatcher already resolves the branch's `time_zone` to apply it — so
      everything was per-branch except the two numbers.

      Hours rather than minutes because that is the granularity of the decision
      being made, and `from = to` is disallowed by the check constraint in
      `0028` rather than silently meaning either "always" or "never".
    */
    quietHoursEnabled: boolean('quiet_hours_enabled').notNull().default(true),
    quietHoursFromHour: integer('quiet_hours_from_hour').notNull().default(21),
    quietHoursToHour: integer('quiet_hours_to_hour').notNull().default(7),
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
    /**
     * False where the grant has been revoked — FR-ID-08.
     *
     * A retirement flag rather than a deleted row, because `app_user` holds no
     * DELETE anywhere in this schema (§5.5): the audit trail must not be
     * editable by the application that wrote it. Revocation takes effect on
     * the principal's *next request*, since session resolution re-reads this
     * every time instead of trusting a claim baked into a token.
     */
    isActive: boolean('is_active').notNull().default(true),
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
 * A customer's grant of support access — the vendor side of a support
 * contract, made explicit in the customer's own database.
 *
 * Four properties, and each is there because the alternative is what people
 * actually do under pressure at 2am:
 *
 * - **Granted, not assumed.** The row is written by one of the *operator's*
 *   administrators, not by us. Without one, a support principal sees nothing —
 *   the policies in `0008` are conditioned on an active grant, and their
 *   absence is the same `else false` every other policy falls through to.
 * - **Time-boxed.** `expires_at` is required, and enforced in the policy
 *   rather than by a job that has to run. An expired grant stops working at
 *   the moment it expires, whatever else is broken.
 * - **Revocable.** `revoked_at` takes effect on the next statement, and the
 *   row stays — §5.5 applies to us as much as to anyone.
 * - **Attributable.** `reason` is not optional. A grant with no ticket behind
 *   it is the thing an auditor asks about, so there is nowhere to put "misc".
 *
 * `scope` is `read` unless someone deliberately made it `write`. Read access
 * needs no policy exception to stay read-only: `0008` creates support policies
 * `for select` only, so a write simply finds no policy that admits it.
 */
export const supportGrants = pgTable(
  'support_grants',
  {
    id: pk(),
    /** The support principal this grant admits — one engineer, not a role. */
    principalId: ref('principal_id')
      .notNull()
      .references(() => principals.id),
    /** The operator's administrator who granted it. Never a support principal. */
    grantedById: ref('granted_by_id')
      .notNull()
      .references(() => principals.id),
    /**
     * The branches opened. Empty means every branch, which is why the
     * interface should make choosing one the easy path.
     */
    branchIds: uuid('branch_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    scope: supportScopeEnum('scope').notNull().default('read'),
    /** The ticket, incident or request. Required — see above. */
    reason: text('reason').notNull(),
    expiresAt: tsz('expires_at').notNull(),
    revokedAt: tsz('revoked_at'),
    revokedById: ref('revoked_by_id').references(() => principals.id),
    ...timestamps,
  },
  (t) => [
    index('support_grants_active_idx').on(t.principalId, t.expiresAt),
    index('support_grants_granted_by_idx').on(t.grantedById),
  ],
)

/**
 * What was looked at, and when — the read half of the audit trail.
 *
 * `0003`'s trigger records writes, which is the right design for a system
 * whose risk is unauthorised *change*. Support inverts that: the engineer is
 * read-only, so a trail of writes records nothing at all, and "we never
 * touched anything" is precisely the claim that needs evidence rather than
 * assertion.
 *
 * One row per transaction opened under a grant, written by `withActor`. That
 * is a coarser record than per-row read logging — which needs `pgaudit` and is
 * unavailable on several managed instances — but it answers the question the
 * customer actually asks: *who from your side opened our data, when, and under
 * which ticket.*
 *
 * Insert-only, on the same terms as `audit_log`: `0008` revokes UPDATE and
 * DELETE from `app_user`.
 */
export const supportAccessLog = systemTable(
  'Insert-only access trail. A trigger on it would recurse, as with audit_log.',
)(
  'support_access_log',
  {
    id: pk(),
    grantId: ref('grant_id')
      .notNull()
      .references(() => supportGrants.id),
    principalId: ref('principal_id')
      .notNull()
      .references(() => principals.id),
    /** What the engineer was doing — the route or job that opened the actor. */
    action: text('action'),
    ip: text('ip'),
    at: tsz('at')
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index('support_access_log_grant_idx').on(t.grantId, t.at)],
)
