/**
 * The job spine — Architecture §6.3.
 *
 * The snapshot rule lives here, and it is the single most consequential
 * decision in the schema: `quotes.priced_snapshot` stores the resolved rate
 * lines, divisors, accessorials, FX rate and margin exactly as they stood at
 * pricing time. `rate_card_version_id` is kept for lineage and is *never* read
 * to reprice. A rate change tomorrow cannot rewrite what was quoted yesterday.
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
import { amount, pk, quantity, ref, timestamps, tsz } from './columns'
import { pgTable } from './table'
import {
  customsStatusEnum,
  clockKindEnum,
  dayBasisEnum,
  directionEnum,
  enquiryStatusEnum,
  jobStatusEnum,
  modeEnum,
  quoteStatusEnum,
  severityEnum,
} from './enums'
import { branches, principals } from './identity'
import { assets } from './files'
import {
  commodities,
  containerTypes,
  currencies,
  documentTypes,
  exceptionCodes,
  locations,
} from './reference'
import { customers, partners, rateCards } from './commercial'

/**
 * Enquiries — FR-EQ.
 *
 * `sla_started_at` and `sla_due_at` are both stored: the due date is computed
 * once, through the branch's working calendar (`core/clocks.ts`), and then
 * compared cheaply by the escalation job every fifteen minutes rather than
 * recomputed per row.
 */
export const enquiries = pgTable(
  'enquiries',
  {
    id: pk(),
    reference: text('reference').notNull().unique(),
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id),
    customerId: ref('customer_id').references(() => customers.id),
    /** Set where the enquiry arrived from an unknown sender — FR-EQ-02. */
    contactEmail: text('contact_email'),
    contactName: text('contact_name'),
    ownerId: ref('owner_id').references(() => principals.id),
    status: enquiryStatusEnum('status').notNull().default('new'),
    /** email, portal, whatsapp, phone, walk_in. */
    channel: text('channel').notNull().default('email'),
    mode: modeEnum('mode'),
    tradeDirection: directionEnum('trade_direction'),
    originId: ref('origin_id').references(() => locations.id),
    destinationId: ref('destination_id').references(() => locations.id),
    commodityId: ref('commodity_id').references(() => commodities.id),
    incoterm: text('incoterm'),
    readyOn: date('ready_on'),
    grossWeightKg: quantity('gross_weight_kg'),
    volumeCbm: quantity('volume_cbm'),
    pieces: integer('pieces'),
    /** Per-piece dimensions, where the customer supplied them. */
    dimensions: jsonb('dimensions').$type<
      { lengthCm: string; widthCm: string; heightCm: string; pieces?: number }[]
    >(),
    isDangerous: boolean('is_dangerous').notNull().default(false),
    notes: text('notes'),
    slaStartedAt: tsz('sla_started_at'),
    slaDueAt: tsz('sla_due_at'),
    firstRespondedAt: tsz('first_responded_at'),
    escalatedAt: tsz('escalated_at'),
    closedAt: tsz('closed_at'),
    lostReason: text('lost_reason'),
    ...timestamps,
  },
  (t) => [
    index('enquiries_board_idx').on(t.branchId, t.status, t.slaDueAt),
    index('enquiries_owner_idx').on(t.ownerId, t.status),
    index('enquiries_customer_idx').on(t.customerId),
  ],
)

/**
 * Quotes — FR-RT-08, SRS §7 rule one.
 *
 * A quote is never edited. A revision is a new row with the next `version`,
 * and the previous one moves to `superseded`.
 */
export const quotes = pgTable(
  'quotes',
  {
    id: pk(),
    reference: text('reference').notNull().unique(),
    enquiryId: ref('enquiry_id')
      .notNull()
      .references(() => enquiries.id),
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id),
    version: integer('version').notNull().default(1),
    status: quoteStatusEnum('status').notNull().default('draft'),
    currency: text('currency')
      .notNull()
      .references(() => currencies.code),
    totalSell: amount('total_sell'),
    totalCost: amount('total_cost'),
    validUntil: date('valid_until'),
    /**
     * The whole pricing decision, frozen. Resolved lines, chargeable weight
     * and the divisor used, accessorials, the FX rate and its timestamp, and
     * the margin rule applied.
     *
     * This is what makes a June invoice reconcile to a March booking
     * (FR-RT-06) and what stops a rate card edit rewriting history.
     */
    pricedSnapshot: jsonb('priced_snapshot').$type<Record<string, unknown>>(),
    /** Lineage only. Reporting reads it; pricing never does. */
    rateCardVersionId: ref('rate_card_version_id').references(() => rateCards.id),
    supersededById: ref('superseded_by_id'),
    preparedById: ref('prepared_by_id').references(() => principals.id),
    sentAt: tsz('sent_at'),
    decidedAt: tsz('decided_at'),
    ...timestamps,
  },
  (t) => [
    unique('quotes_version_unique').on(t.enquiryId, t.version),
    index('quotes_status_idx').on(t.branchId, t.status),
  ],
)

export const quoteLines = pgTable(
  'quote_lines',
  {
    id: pk(),
    quoteId: ref('quote_id')
      .notNull()
      .references(() => quotes.id),
    chargeTypeId: ref('charge_type_id').notNull(),
    description: text('description'),
    basis: text('basis').notNull(),
    quantity: quantity('quantity').notNull().default('1'),
    rate: amount('rate').notNull(),
    amount: amount('amount').notNull(),
    currency: text('currency')
      .notNull()
      .references(() => currencies.code),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [index('quote_lines_quote_idx').on(t.quoteId, t.sortOrder)],
)

/**
 * Jobs — the operational record, branch-scoped, and the row the RLS example in
 * §5.3 is written against.
 */
export const jobs = pgTable(
  'jobs',
  {
    id: pk(),
    reference: text('reference').notNull().unique(),
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id),
    customerId: ref('customer_id')
      .notNull()
      .references(() => customers.id),
    quoteId: ref('quote_id').references(() => quotes.id),
    status: jobStatusEnum('status').notNull().default('draft'),
    mode: modeEnum('mode').notNull(),
    tradeDirection: directionEnum('trade_direction').notNull(),
    ownerId: ref('owner_id').references(() => principals.id),
    originId: ref('origin_id').references(() => locations.id),
    destinationId: ref('destination_id').references(() => locations.id),
    commodityId: ref('commodity_id').references(() => commodities.id),
    incoterm: text('incoterm'),
    /** Master and house bill, or the air waybill pair. */
    masterBillNumber: text('master_bill_number'),
    houseBillNumber: text('house_bill_number'),
    bookingNumber: text('booking_number'),
    vesselName: text('vessel_name'),
    voyageNumber: text('voyage_number'),
    flightNumber: text('flight_number'),
    etd: tsz('etd'),
    eta: tsz('eta'),
    atd: tsz('atd'),
    ata: tsz('ata'),
    grossWeightKg: quantity('gross_weight_kg'),
    chargeableWeightKg: quantity('chargeable_weight_kg'),
    volumeCbm: quantity('volume_cbm'),
    pieces: integer('pieces'),
    customerReference: text('customer_reference'),
    closedAt: tsz('closed_at'),
    cancelledAt: tsz('cancelled_at'),
    cancelledReason: text('cancelled_reason'),
    ...timestamps,
  },
  (t) => [
    index('jobs_board_idx').on(t.branchId, t.status, t.eta),
    index('jobs_customer_idx').on(t.customerId, t.status),
    index('jobs_owner_idx').on(t.ownerId, t.status),
  ],
)

/**
 * Which partners are on a job.
 *
 * This is the join the agent branch of the RLS policy reads (§5.3): an agent
 * contact sees a job only where their partner appears here.
 *
 * `branch_id` is denormalised deliberately, and it is the one place in the
 * schema where that is not a performance decision. The policy on `jobs`
 * queries this table; if this table's own policy queried `jobs` back,
 * PostgreSQL would refuse both as infinitely recursive. Carrying the branch
 * here lets each policy stand alone.
 */
export const jobPartners = pgTable(
  'job_partners',
  {
    id: pk(),
    jobId: ref('job_id')
      .notNull()
      .references(() => jobs.id),
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id),
    partnerId: ref('partner_id')
      .notNull()
      .references(() => partners.id),
    /** origin_agent, destination_agent, carrier, haulier, broker. */
    role: text('role').notNull(),
    reference: text('reference'),
    ...timestamps,
  },
  (t) => [
    unique('job_partners_unique').on(t.jobId, t.partnerId, t.role),
    index('job_partners_partner_idx').on(t.partnerId),
  ],
)

/**
 * Milestones instantiated from `milestone_templates` at job creation — §7.3.
 *
 * Three dates, deliberately: `planned` is what was promised, `revised` is what
 * is now expected, `actual` is what happened. Overwriting planned with revised
 * destroys the only evidence of slippage, which is the number the customer
 * cares about.
 */
export const jobMilestones = pgTable(
  'job_milestones',
  {
    id: pk(),
    jobId: ref('job_id')
      .notNull()
      .references(() => jobs.id),
    code: text('code').notNull(),
    nameEn: text('name_en').notNull(),
    nameAr: text('name_ar').notNull(),
    seq: integer('seq').notNull(),
    plannedAt: tsz('planned_at'),
    revisedAt: tsz('revised_at'),
    actualAt: tsz('actual_at'),
    ownerRole: text('owner_role'),
    customerVisible: boolean('customer_visible').notNull().default(true),
    completedById: ref('completed_by_id').references(() => principals.id),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [
    unique('job_milestones_unique').on(t.jobId, t.code),
    index('job_milestones_job_idx').on(t.jobId, t.seq),
    index('job_milestones_due_idx').on(t.actualAt, t.plannedAt),
  ],
)

/** Customs — FR-CS. Manual reference capture in R1; the Single Window is R2. */
export const customsStages = pgTable(
  'customs_stages',
  {
    id: pk(),
    jobId: ref('job_id')
      .notNull()
      .references(() => jobs.id),
    status: customsStatusEnum('status').notNull().default('not_started'),
    declarationType: text('declaration_type'),
    declarationNo: text('declaration_no'),
    filedAt: tsz('filed_at'),
    dutyAmount: amount('duty_amount'),
    dutyCurrency: text('duty_currency').references(() => currencies.code),
    inspectionRequired: boolean('inspection_required').notNull().default(false),
    inspectionAt: tsz('inspection_at'),
    releasedAt: tsz('released_at'),
    brokerPartnerId: ref('broker_partner_id').references(() => partners.id),
    slaDueAt: tsz('sla_due_at'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('customs_stages_job_idx').on(t.jobId),
    index('customs_stages_status_idx').on(t.status, t.slaDueAt),
  ],
)

export const equipment = pgTable(
  'equipment',
  {
    id: pk(),
    jobId: ref('job_id')
      .notNull()
      .references(() => jobs.id),
    containerNo: text('container_no'),
    containerType: text('container_type').references(() => containerTypes.code),
    sealNo: text('seal_no'),
    tareWeightKg: quantity('tare_weight_kg'),
    grossWeightKg: quantity('gross_weight_kg'),
    /** The events the free-time clocks start and stop from. */
    dischargedAt: tsz('discharged_at'),
    gateOutAt: tsz('gate_out_at'),
    gateInAt: tsz('gate_in_at'),
    emptyReturnedAt: tsz('empty_returned_at'),
    temperatureC: quantity('temperature_c'),
    ...timestamps,
  },
  (t) => [
    index('equipment_job_idx').on(t.jobId),
    index('equipment_container_idx').on(t.containerNo),
  ],
)

/**
 * A running clock per equipment per kind — FR-JB-08, PP-07.
 *
 * The nightly job re-accrues each open clock through `core/clocks.ts` and
 * writes a `charge_line` when chargeable days appear. `charge_line_id` points
 * at the line so a re-run updates rather than duplicates.
 */
export const freeTimeClocks = pgTable(
  'free_time_clocks',
  {
    id: pk(),
    jobId: ref('job_id')
      .notNull()
      .references(() => jobs.id),
    equipmentId: ref('equipment_id').references(() => equipment.id),
    kind: clockKindEnum('kind').notNull(),
    freeDays: integer('free_days').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on'),
    perDiem: amount('per_diem').notNull(),
    currency: text('currency')
      .notNull()
      .references(() => currencies.code),
    dayBasis: dayBasisEnum('day_basis').notNull().default('calendar'),
    tiers: jsonb('tiers').$type<{ fromDay: number; perDiem: string }[]>(),
    /** Who the days are owed to — the carrier, or the terminal. */
    counterpartyId: ref('counterparty_id').references(() => partners.id),
    accruedDays: integer('accrued_days').notNull().default(0),
    accruedAmount: amount('accrued_amount'),
    lastAccruedAt: tsz('last_accrued_at'),
    chargeLineId: ref('charge_line_id'),
    ...timestamps,
  },
  (t) => [
    index('free_time_clocks_open_idx').on(t.endsOn, t.kind),
    index('free_time_clocks_job_idx').on(t.jobId),
  ],
)

/** The exceptions register — codes are rows, severity and ageing are config. */
export const exceptions = pgTable(
  'exceptions',
  {
    id: pk(),
    jobId: ref('job_id')
      .notNull()
      .references(() => jobs.id),
    exceptionCodeId: ref('exception_code_id')
      .notNull()
      .references(() => exceptionCodes.id),
    severity: severityEnum('severity').notNull().default('medium'),
    ownerId: ref('owner_id').references(() => principals.id),
    description: text('description'),
    openedAt: tsz('opened_at').notNull().defaultNow(),
    dueAt: tsz('due_at'),
    closedAt: tsz('closed_at'),
    resolution: text('resolution'),
    customerVisible: boolean('customer_visible').notNull().default(false),
    costImpact: amount('cost_impact'),
    costCurrency: text('cost_currency').references(() => currencies.code),
    ...timestamps,
  },
  (t) => [
    index('exceptions_open_idx').on(t.closedAt, t.severity, t.dueAt),
    index('exceptions_job_idx').on(t.jobId),
  ],
)

/**
 * Documents on a job — versioned, never overwritten.
 *
 * `released_at` is the gate for customer visibility: a draft bill of lading
 * sitting on the job is not the same as one released to the customer, and
 * conflating them is how a draft reaches a customer's inbox.
 */
export const documents = pgTable(
  'documents',
  {
    id: pk(),
    jobId: ref('job_id')
      .notNull()
      .references(() => jobs.id),
    documentTypeId: ref('document_type_id')
      .notNull()
      .references(() => documentTypes.id),
    assetId: ref('asset_id')
      .notNull()
      .references(() => assets.id),
    version: integer('version').notNull().default(1),
    supersededById: ref('superseded_by_id'),
    releasedAt: tsz('released_at'),
    releasedById: ref('released_by_id').references(() => principals.id),
    authorId: ref('author_id').references(() => principals.id),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [
    index('documents_job_idx').on(t.jobId, t.documentTypeId, t.version),
    index('documents_released_idx').on(t.releasedAt),
  ],
)

export type Enquiry = typeof enquiries.$inferSelect
export type Quote = typeof quotes.$inferSelect
export type Job = typeof jobs.$inferSelect
export type JobMilestone = typeof jobMilestones.$inferSelect
export type FreeTimeClock = typeof freeTimeClocks.$inferSelect
