/**
 * Commercial master data and rate cards — Architecture §6.2.
 *
 * Two shapes carry most of the difficulty here:
 *
 *   - A customer is one record at group level (FR-MD-01) with per-branch terms
 *     beneath it, rather than five customer records that drift apart.
 *   - Rate card validity is a `daterange`, so the database itself refuses two
 *     overlapping versions for a lane. "The valid rate" cannot be ambiguous.
 */

import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  text,
  unique,
} from 'drizzle-orm/pg-core'
import { amount, pk, quantity, ref, timestamps, tsz } from './columns'
import { pgTable } from './table'
import {
  basisEnum,
  directionEnum,
  marginKindEnum,
  modeEnum,
  partnerTypeEnum,
  rateDirectionEnum,
} from './enums'
import { branches, principals } from './identity'
import { assets } from './files'
import { chargeTypes, currencies, documentTypes, locations } from './reference'

/**
 * The customer, at group level — FR-MD-01.
 *
 * Group-shared scoping (§5.3): visible across branches, because the same
 * trading company deals with Kuwait and Dubai and should not be entered twice.
 */
export const customers = pgTable(
  'customers',
  {
    id: pk(),
    code: text('code').notNull().unique(),
    legalNameEn: text('legal_name_en').notNull(),
    legalNameAr: text('legal_name_ar'),
    registration: text('registration'),
    taxRegistration: text('tax_registration'),
    countryCode: text('country_code'),
    /** The branch that owns the relationship; terms still sit per branch. */
    primaryBranchId: ref('primary_branch_id').references(() => branches.id),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [index('customers_name_idx').on(t.legalNameEn)],
)

/**
 * Per-branch commercial terms beneath one customer record.
 *
 * Payment terms, credit limit, free time and default Incoterm differ per
 * branch even for the same group — that is the point of splitting them out.
 */
export const customerBranchTerms = pgTable(
  'customer_branch_terms',
  {
    id: pk(),
    customerId: ref('customer_id')
      .notNull()
      .references(() => customers.id),
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id),
    paymentTermsDays: integer('payment_terms_days').notNull().default(30),
    creditLimit: amount('credit_limit'),
    creditCurrency: text('credit_currency').references(() => currencies.code),
    freeTimeDays: integer('free_time_days'),
    defaultIncoterm: text('default_incoterm'),
    /** House margin for instant quotes — FR-EQ-05. */
    defaultMarginKind: marginKindEnum('default_margin_kind'),
    defaultMarginValue: quantity('default_margin_value'),
    isOnHold: boolean('is_on_hold').notNull().default(false),
    ...timestamps,
  },
  (t) => [unique('customer_branch_terms_unique').on(t.customerId, t.branchId)],
)

export const customerContacts = pgTable(
  'customer_contacts',
  {
    id: pk(),
    customerId: ref('customer_id')
      .notNull()
      .references(() => customers.id),
    /** Set once the contact is invited to the portal — FR-MD-03. */
    principalId: ref('principal_id').references(() => principals.id),
    nameEn: text('name_en').notNull(),
    nameAr: text('name_ar'),
    email: text('email'),
    phone: text('phone'),
    role: text('role'),
    isPrimary: boolean('is_primary').notNull().default(false),
    /** Which notification events this contact receives — FR-NT-04 opt-outs. */
    notificationOptOuts: jsonb('notification_opt_outs').$type<string[]>().default([]),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [index('customer_contacts_customer_idx').on(t.customerId)],
)

/**
 * Overseas agents, hauliers, carriers, brokers, terminals.
 *
 * Kept separate from customers even where one company is both. They carry
 * different data, different compliance obligations and different portal
 * visibility, and merging them costs more than the duplication saves.
 */
export const partners = pgTable(
  'partners',
  {
    id: pk(),
    code: text('code').notNull().unique(),
    type: partnerTypeEnum('type').notNull(),
    legalNameEn: text('legal_name_en').notNull(),
    legalNameAr: text('legal_name_ar'),
    countryCode: text('country_code'),
    currency: text('currency').references(() => currencies.code),
    paymentTermsDays: integer('payment_terms_days'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [index('partners_type_idx').on(t.type, t.countryCode)],
)

export const partnerContacts = pgTable(
  'partner_contacts',
  {
    id: pk(),
    partnerId: ref('partner_id')
      .notNull()
      .references(() => partners.id),
    principalId: ref('principal_id').references(() => principals.id),
    nameEn: text('name_en').notNull(),
    nameAr: text('name_ar'),
    email: text('email'),
    phone: text('phone'),
    role: text('role'),
    isPrimary: boolean('is_primary').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [index('partner_contacts_partner_idx').on(t.partnerId)],
)

/**
 * Which lanes a partner covers — drives RFQ routing (FR-RT-10).
 *
 * The lookup budget is two seconds, and this index plus PostgreSQL 18's
 * B-tree skip scan is how it is met without caching infrastructure: queries
 * that leave `mode` unconstrained still use the index (§12).
 */
export const partnerCoverage = pgTable(
  'partner_coverage',
  {
    id: pk(),
    partnerId: ref('partner_id')
      .notNull()
      .references(() => partners.id),
    mode: modeEnum('mode').notNull(),
    originId: ref('origin_id').references(() => locations.id),
    destinationId: ref('destination_id').references(() => locations.id),
    /** Country-level cover where the partner does not name specific ports. */
    originCountry: text('origin_country'),
    destinationCountry: text('destination_country'),
    transitDays: integer('transit_days'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index('partner_coverage_lane_idx').on(t.mode, t.originId, t.destinationId),
    index('partner_coverage_partner_idx').on(t.partnerId),
  ],
)

/**
 * Partner compliance documents with expiry — FR-MD-05.
 *
 * A nightly job warns at 60, 30 and 7 days. The warning thresholds are a
 * column on `document_types`, not a constant in the worker.
 */
export const partnerCompliance = pgTable(
  'partner_compliance',
  {
    id: pk(),
    partnerId: ref('partner_id')
      .notNull()
      .references(() => partners.id),
    documentTypeId: ref('document_type_id')
      .notNull()
      .references(() => documentTypes.id),
    assetId: ref('asset_id').references(() => assets.id),
    reference: text('reference'),
    issuedOn: date('issued_on'),
    expiresOn: date('expires_on'),
    /** Superseded rather than overwritten when a renewal arrives (§5.5). */
    supersededById: ref('superseded_by_id'),
    ...timestamps,
  },
  (t) => [index('partner_compliance_expiry_idx').on(t.expiresOn, t.partnerId)],
)

/**
 * Rate cards — FR-RT-01, FR-RT-08.
 *
 * `validity` is a `daterange`, added in `0003_constraints.sql` together with
 *
 *     unique (direction, partner_id, customer_id, mode, origin_id,
 *             destination_id, validity without overlaps)
 *
 * Drizzle has no range type, so the column and the temporal constraint are
 * declared in SQL and the column is mapped here as text for reads. Two
 * overlapping cards for one lane make "the valid rate" ambiguous — a pricing
 * bug that surfaces as a wrong quote weeks later. The constraint makes it
 * unrepresentable rather than merely unlikely.
 */
export const rateCards = pgTable(
  'rate_cards',
  {
    id: pk(),
    direction: rateDirectionEnum('direction').notNull(),
    partnerId: ref('partner_id').references(() => partners.id),
    customerId: ref('customer_id').references(() => customers.id),
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id),
    mode: modeEnum('mode').notNull(),
    tradeDirection: directionEnum('trade_direction'),
    originId: ref('origin_id').references(() => locations.id),
    destinationId: ref('destination_id').references(() => locations.id),
    /** `[from,to)` — read-only here; written by the SQL below. */
    validity: text('validity').notNull(),
    validFrom: date('valid_from').notNull(),
    /** Null is open-ended; the range carries the authoritative bound. */
    validTo: date('valid_to'),
    currency: text('currency')
      .notNull()
      .references(() => currencies.code),
    version: integer('version').notNull().default(1),
    /** Editing creates a new version and points the old one here — FR-RT-08. */
    supersededById: ref('superseded_by_id'),
    notes: text('notes'),
    createdById: ref('created_by_id').references(() => principals.id),
    ...timestamps,
  },
  (t) => [
    // Composite lane index; §12's two-second coverage budget depends on it.
    index('rate_cards_lane_idx').on(t.mode, t.originId, t.destinationId, t.direction),
    index('rate_cards_partner_idx').on(t.partnerId),
    index('rate_cards_customer_idx').on(t.customerId),
  ],
)

export const rateCardLines = pgTable(
  'rate_card_lines',
  {
    id: pk(),
    rateCardId: ref('rate_card_id')
      .notNull()
      .references(() => rateCards.id),
    chargeTypeId: ref('charge_type_id')
      .notNull()
      .references(() => chargeTypes.id),
    basis: basisEnum('basis').notNull(),
    rate: amount('rate').notNull(),
    currency: text('currency')
      .notNull()
      .references(() => currencies.code),
    minimum: amount('minimum'),
    maximum: amount('maximum'),
    /** Container type or commodity the line is restricted to, where it is. */
    containerType: text('container_type'),
    /** `[{ fromKg, ratePerKg, minimumCharge }]` — read by `selectBreak`. */
    weightBreaks: jsonb('weight_breaks').$type<
      { fromKg: string; ratePerKg: string; minimumCharge?: string }[]
    >(),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [index('rate_card_lines_card_idx').on(t.rateCardId, t.sortOrder)],
)

/** Rate requests sent to partners, and what came back — FR-RT-10. */
export const rateRequests = pgTable(
  'rate_requests',
  {
    id: pk(),
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id),
    enquiryId: ref('enquiry_id'),
    partnerId: ref('partner_id')
      .notNull()
      .references(() => partners.id),
    sentAt: tsz('sent_at'),
    respondedAt: tsz('responded_at'),
    /** The quoted lines as received, before they become a rate card. */
    response: jsonb('response').$type<Record<string, unknown>>(),
    declinedReason: text('declined_reason'),
    ...timestamps,
  },
  (t) => [index('rate_requests_enquiry_idx').on(t.enquiryId)],
)

export type Customer = typeof customers.$inferSelect
export type Partner = typeof partners.$inferSelect
export type RateCard = typeof rateCards.$inferSelect
export type RateCardLine = typeof rateCardLines.$inferSelect
