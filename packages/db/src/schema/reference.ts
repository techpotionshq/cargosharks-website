/**
 * Reference data — Architecture §7, FR-AD-03.
 *
 * "Anything the SRS requires to be editable without a code change is a row,
 * not a class." This file is that rule made concrete, and it is the reason the
 * engines are single implementations: eighteen accessorial types are eighteen
 * rows against six functions; four milestone flows are four sets of rows
 * against one template engine; nine events across three channels and two
 * languages are template rows against one dispatcher.
 *
 * Scoping shape: read by everyone, written by administrators (§5.3).
 */

import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { amount, pk, quantity, rate, ref, timestamps, tsz } from './columns'
import { pgTable } from './table'
import {
  basisEnum,
  channelEnum,
  clockKindEnum,
  dayBasisEnum,
  directionEnum,
  localeEnum,
  modeEnum,
  severityEnum,
} from './enums'
import { branches } from './identity'

/**
 * Currencies and their minor units — NFR-02.
 *
 * KWD carries three decimals, USD and the pegged Gulf currencies two. Rounding
 * reads `minor_units` from here, per line; core never hard-codes a scale.
 */
export const currencies = pgTable('currencies', {
  code: text('code').primaryKey(),
  nameEn: text('name_en').notNull(),
  nameAr: text('name_ar').notNull(),
  minorUnits: integer('minor_units').notNull(),
  symbol: text('symbol'),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
})

/**
 * FX rates — the `FxRateSource` port's landing table (§10).
 *
 * Ingested daily, overridable by hand. Nothing reprices from here: a charge
 * line copies the rate onto itself at pricing time (FR-RT-06). This table is
 * the source, not the record.
 */
export const fxRates = pgTable(
  'fx_rates',
  {
    id: pk(),
    fromCurrency: text('from_currency')
      .notNull()
      .references(() => currencies.code),
    toCurrency: text('to_currency')
      .notNull()
      .references(() => currencies.code),
    rate: rate('rate').notNull(),
    /** Which feed, or the principal who overrode it. */
    source: text('source').notNull().default('manual'),
    effectiveOn: date('effective_on').notNull(),
    takenAt: tsz('taken_at').notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    unique('fx_rates_unique').on(t.fromCurrency, t.toCurrency, t.effectiveOn, t.source),
    index('fx_rates_lookup_idx').on(t.fromCurrency, t.toCurrency, t.effectiveOn),
  ],
)

export const countries = pgTable('countries', {
  code: text('code').primaryKey(),
  nameEn: text('name_en').notNull(),
  nameAr: text('name_ar').notNull(),
  defaultCurrency: text('default_currency'),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
})

/**
 * Ports, airports, terminals, depots, customer premises — group-shared (§5.3).
 * UN/LOCODE where one exists; free entry where it does not, because a customer
 * warehouse in Shuwaikh has no code and still has to be a delivery point.
 */
export const locations = pgTable(
  'locations',
  {
    id: pk(),
    unlocode: text('unlocode'),
    nameEn: text('name_en').notNull(),
    nameAr: text('name_ar'),
    countryCode: text('country_code')
      .notNull()
      .references(() => countries.code),
    kind: text('kind').notNull(),
    latitude: quantity('latitude'),
    longitude: quantity('longitude'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('locations_unlocode_idx').on(t.unlocode),
    index('locations_country_idx').on(t.countryCode, t.kind),
  ],
)

export const commodities = pgTable('commodities', {
  id: pk(),
  code: text('code').notNull().unique(),
  nameEn: text('name_en').notNull(),
  nameAr: text('name_ar'),
  hsCode: text('hs_code'),
  isDangerous: boolean('is_dangerous').notNull().default(false),
  requiresTemperatureControl: boolean('requires_temperature_control').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
})

export const incoterms = pgTable('incoterms', {
  code: text('code').primaryKey(),
  nameEn: text('name_en').notNull(),
  nameAr: text('name_ar').notNull(),
  year: integer('year').notNull().default(2020),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
})

export const containerTypes = pgTable('container_types', {
  code: text('code').primaryKey(),
  nameEn: text('name_en').notNull(),
  nameAr: text('name_ar'),
  teu: quantity('teu').notNull(),
  isReefer: boolean('is_reefer').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
})

/**
 * The accessorial catalogue — FR-RT-05.
 *
 * Terminal handling, documentation, fuel, security, clearance, delivery order,
 * haulage, DG, out-of-gauge, reefer, inspection, legalisation, permit,
 * insurance, demurrage, detention, storage: eighteen rows, each naming one of
 * the six bases in `core/rating.ts`. A nineteenth in 2027 is an admin screen
 * entry, not a release.
 */
export const chargeTypes = pgTable(
  'charge_types',
  {
    id: pk(),
    key: text('key').notNull().unique(),
    nameEn: text('name_en').notNull(),
    nameAr: text('name_ar').notNull(),
    defaultBasis: basisEnum('default_basis').notNull(),
    defaultCurrency: text('default_currency').references(() => currencies.code),
    /** Groups the line on quotes and invoices: freight, origin, destination… */
    category: text('category').notNull(),
    /** Whether a customer ever sees this line, or it is cost-side only. */
    isCustomerVisible: boolean('is_customer_visible').notNull().default(true),
    isTaxable: boolean('is_taxable').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    /**
     * Where this charge lands in the customer's chart of accounts (0011).
     *
     * Reference data rather than code because every accounting system in the
     * Gulf numbers its accounts differently and not one of those differences
     * should require a deployment. Null means unmapped, and an export names
     * the charge type rather than guessing an account.
     */
    revenueAccountCode: text('revenue_account_code'),
    costAccountCode: text('cost_account_code'),
    ...timestamps,
  },
  (t) => [index('charge_types_category_idx').on(t.category, t.sortOrder)],
)

/**
 * Import duty by HS prefix — the rows behind `core/duty.ts` (0013).
 *
 * A tariff is a tree: chapter (2 digits), heading (4), subheading (6), then
 * the national line. Rates are published at whatever depth the exception
 * needs, so the lookup is "the longest prefix of this code that has a row",
 * never an equality match. The GCC common external tariff is 5% on most goods
 * with exemptions published at chapter level; the tobacco and alcohol rates
 * are national lines. One table holds both because the prefix rule does.
 *
 * Dated rather than edited: an estimate produced in January must still be
 * reproducible in June after the tariff moved in March.
 */
export const dutyRates = pgTable(
  'duty_rates',
  {
    id: pk(),
    country: text('country')
      .notNull()
      .references(() => countries.code),
    hsPrefix: text('hs_prefix').notNull(),
    ratePercent: amount('rate_percent').notNull(),
    descriptionEn: text('description_en').notNull(),
    descriptionAr: text('description_ar'),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    notes: text('notes'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index('duty_rates_lookup_idx').on(t.country, t.hsPrefix, t.effectiveFrom),
    uniqueIndex('duty_rates_unique_period').on(t.country, t.hsPrefix, t.effectiveFrom),
  ],
)

/**
 * Volumetric divisors, round-up increments and minimums per mode — the rows
 * behind `core/chargeable.ts`.
 *
 * Stored as a divisor in cm³ per kilogram, the way the industry states it: air
 * 6000, courier 5000, sea LCL 1000. A pre-computed kg-per-cbm factor cannot
 * express 166.666… without an error the round-up then amplifies.
 */
export const chargeableRules = pgTable(
  'chargeable_rules',
  {
    id: pk(),
    mode: modeEnum('mode').notNull(),
    /** Null for FCL, which is billed per container. */
    divisorCm3PerKg: quantity('divisor_cm3_per_kg'),
    roundUpToKg: quantity('round_up_to_kg').notNull(),
    minimumKg: quantity('minimum_kg').notNull().default('0'),
    branchId: ref('branch_id').references(() => branches.id),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  /*
    `nulls not distinct` — the seed writes no branch, so `branch_id` is NULL on
    every seeded row. Under the default NULLS DISTINCT those rows never collide
    and `on conflict do nothing` never fires, so each `pnpm db:seed` appended a
    fresh copy (0006_seed_idempotency).
  */
  (t) => [unique('chargeable_rules_unique').on(t.mode, t.branchId).nullsNotDistinct()],
)

/**
 * Milestone templates — §7.3, FR-JB-01…05.
 *
 * Sea import, sea export, air and land are four sets of rows against one
 * engine. Job creation instantiates the matching set into `job_milestones`.
 */
export const milestoneTemplates = pgTable(
  'milestone_templates',
  {
    id: pk(),
    mode: modeEnum('mode').notNull(),
    direction: directionEnum('direction').notNull(),
    serviceType: text('service_type'),
    seq: integer('seq').notNull(),
    code: text('code').notNull(),
    nameEn: text('name_en').notNull(),
    nameAr: text('name_ar').notNull(),
    /** Which role is accountable — drives the ops board and escalation. */
    ownerRole: text('owner_role'),
    customerVisible: boolean('customer_visible').notNull().default(true),
    /** Offset in days from the previous milestone, for the planned date. */
    plannedOffsetDays: integer('planned_offset_days'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    // `service_type` is NULL on every seeded template — see 0006. Without
    // `nulls not distinct` a re-seed multiplied the milestone set, and a job
    // was booked with five copies of every step.
    unique('milestone_templates_unique')
      .on(t.mode, t.direction, t.serviceType, t.code)
      .nullsNotDistinct(),
    index('milestone_templates_lookup_idx').on(t.mode, t.direction, t.seq),
  ],
)

/** Exception codes — the catalogue behind the exceptions register. */
export const exceptionCodes = pgTable('exception_codes', {
  id: pk(),
  code: text('code').notNull().unique(),
  nameEn: text('name_en').notNull(),
  nameAr: text('name_ar').notNull(),
  defaultSeverity: severityEnum('default_severity').notNull().default('medium'),
  defaultOwnerRole: text('default_owner_role'),
  customerVisibleByDefault: boolean('customer_visible_by_default').notNull().default(false),
  /** Working hours before the exception escalates — NFR-03. */
  slaHours: integer('sla_hours'),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
})

/** Document types — bill of lading, packing list, certificate of origin… */
export const documentTypes = pgTable('document_types', {
  id: pk(),
  code: text('code').notNull().unique(),
  nameEn: text('name_en').notNull(),
  nameAr: text('name_ar').notNull(),
  category: text('category').notNull(),
  isCustomerVisible: boolean('is_customer_visible').notNull().default(true),
  isRequiredForClearance: boolean('is_required_for_clearance').notNull().default(false),
  /** Days before expiry that a compliance warning fires — FR-MD-05. */
  expiryWarningDays: jsonb('expiry_warning_days').$type<number[]>().default([60, 30, 7]),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
})

/**
 * Notification templates — FR-NT-01…03, keyed by event × channel × language ×
 * branch. Nine events over three channels in two languages is fifty-four rows
 * and one dispatcher, not fifty-four handlers.
 */
export const notificationTemplates = pgTable(
  'notification_templates',
  {
    id: pk(),
    eventKey: text('event_key').notNull(),
    channel: channelEnum('channel').notNull(),
    locale: localeEnum('locale').notNull(),
    /** Null is the default template; a row with a branch overrides it. */
    branchId: ref('branch_id').references(() => branches.id),
    subject: text('subject'),
    body: text('body').notNull(),
    /** WhatsApp templates need pre-approval; this is the approved name. */
    providerTemplateName: text('provider_template_name'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  // `branch_id` is NULL for the default template of an event — see 0006.
  (t) => [
    unique('notification_templates_unique')
      .on(t.eventKey, t.channel, t.locale, t.branchId)
      .nullsNotDistinct(),
  ],
)

/**
 * Free-time configuration — the three rows behind one clock (§7.2).
 *
 * Demurrage, detention and storage differ only in what starts them, who they
 * are owed to and what they cost per day.
 */
export const freeTimeRules = pgTable(
  'free_time_rules',
  {
    id: pk(),
    kind: clockKindEnum('kind').notNull(),
    branchId: ref('branch_id').references(() => branches.id),
    mode: modeEnum('mode'),
    containerType: text('container_type').references(() => containerTypes.code),
    /** Null applies to all counterparties; a partner id narrows it. */
    partnerId: ref('partner_id'),
    freeDays: integer('free_days').notNull(),
    perDiem: amount('per_diem').notNull(),
    currency: text('currency')
      .notNull()
      .references(() => currencies.code),
    dayBasis: dayBasisEnum('day_basis').notNull().default('calendar'),
    /** Escalation bands: `[{ fromDay, perDiem }]`, read by `core/clocks.ts`. */
    tiers: jsonb('tiers').$type<{ fromDay: number; perDiem: string }[]>(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [index('free_time_rules_lookup_idx').on(t.kind, t.branchId, t.mode)],
)

/**
 * Working calendars — NFR-03, one per branch.
 *
 * Kuwait, Qatar and the UAE share neither a weekend nor a holiday list, so
 * every SLA, ageing and free-time calculation resolves the branch's calendar
 * first. `weekend` is an array of weekday numbers, 0 = Sunday.
 */
export const workingCalendars = pgTable('working_calendars', {
  id: pk(),
  key: text('key').notNull().unique(),
  nameEn: text('name_en').notNull(),
  nameAr: text('name_ar').notNull(),
  timeZone: text('time_zone').notNull(),
  weekend: jsonb('weekend').$type<number[]>().notNull().default([5, 6]),
  /** Minutes from local midnight — 480 is 08:00. */
  dayStartMinute: integer('day_start_minute').notNull().default(480),
  dayEndMinute: integer('day_end_minute').notNull().default(1020),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
})

export const calendarHolidays = pgTable(
  'calendar_holidays',
  {
    id: pk(),
    calendarId: ref('calendar_id')
      .notNull()
      .references(() => workingCalendars.id),
    onDate: date('on_date').notNull(),
    nameEn: text('name_en').notNull(),
    nameAr: text('name_ar'),
    ...timestamps,
  },
  (t) => [unique('calendar_holidays_unique').on(t.calendarId, t.onDate)],
)

export type Currency = typeof currencies.$inferSelect
export type ChargeType = typeof chargeTypes.$inferSelect
export type MilestoneTemplate = typeof milestoneTemplates.$inferSelect
export type WorkingCalendarRow = typeof workingCalendars.$inferSelect
export type FreeTimeRule = typeof freeTimeRules.$inferSelect

export type DutyRate = typeof dutyRates.$inferSelect
