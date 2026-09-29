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
  billPartyRoleEnum,
  customsStatusEnum,
  clockKindEnum,
  dayBasisEnum,
  directionEnum,
  enquiryStatusEnum,
  jobStatusEnum,
  modeEnum,
  localeEnum,
  quoteStatusEnum,
  severityEnum,
} from './enums'
import { branches, principals } from './identity'
import { assets } from './files'
import {
  commodities,
  containerTypes,
  countries,
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
    dimensions:
      jsonb('dimensions').$type<
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
    /**
     * The customer-facing covering note, drafted by a model and edited by a
     * coordinator before the quote is sent — one column per language.
     *
     * Editable prose, so it lives here rather than in `priced_snapshot`: that
     * JSONB is the frozen pricing decision (see above), and a note a person
     * rewrites has no business inside a record whose whole point is that it does
     * not change. Both nullable — a quote has none until somebody drafts one,
     * and the model writes only prose; every figure stays owned by `rating.ts`
     * and the totals above.
     */
    coverNoteEn: text('cover_note_en'),
    coverNoteAr: text('cover_note_ar'),
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
    /**
     * The master this house sails under — 0012.
     *
     * Null for FCL and for any job that is its own master, which is why
     * nothing about existing work has to know consolidation exists. The
     * foreign key and the branch-match trigger are declared in the migration;
     * stated here it would make `jobs` and `consolidations` import each other.
     */
    consolidationId: ref('consolidation_id'),
    /**
     * The combined-transport boxes on the bill of lading.
     *
     * `origin_id` and `destination_id` are ports, and a port is where the
     * carrier's liability starts and stops — but a house bill issued for a
     * door-to-door movement names the inland place it was received at and the
     * place it is to be delivered, and those are the boxes a bank reads
     * against the letter of credit. Free text, printed as given, for the same
     * reason `job_parties.address` is one block: "Jebel Ali Free Zone, Gate 4"
     * is not a row in `locations` and should not have to become one.
     */
    placeOfReceipt: text('place_of_receipt'),
    placeOfDelivery: text('place_of_delivery'),
    /**
     * Telex release — the originals were handed back and the bill is void as
     * a document of title.
     *
     * A fact about the *bill*, recorded on the job because the job carries the
     * bill's number. Once set, the bill prints no original pages, every page
     * is stamped SURRENDERED with this date, and the delivery order stops
     * demanding an original nobody holds. Set once and never cleared: the
     * originals cannot be un-collected any more than they can be un-issued.
     */
    houseBillSurrenderedAt: tsz('house_bill_surrendered_at'),
    houseBillSurrenderedById: ref('house_bill_surrendered_by_id').references(() => principals.id),
    closedAt: tsz('closed_at'),
    cancelledAt: tsz('cancelled_at'),
    cancelledReason: text('cancelled_reason'),
    ...timestamps,
  },
  (t) => [
    index('jobs_board_idx').on(t.branchId, t.status, t.eta),
    index('jobs_customer_idx').on(t.customerId, t.status),
    index('jobs_owner_idx').on(t.ownerId, t.status),
    index('jobs_consolidation_idx').on(t.consolidationId),
  ],
)

/**
 * Who prints on the bill of lading — 0010.
 *
 * Linked to a customer or partner where one applies, and *copied* regardless.
 * A bill issued in March must still print in November exactly as it was
 * issued; a customer who moves office in June would otherwise silently rewrite
 * the history of every document they appear on. A document records what was
 * said, not what is currently true.
 */
export const jobParties = pgTable(
  'job_parties',
  {
    id: pk(),
    jobId: ref('job_id')
      .notNull()
      .references(() => jobs.id),
    role: billPartyRoleEnum('role').notNull(),
    customerId: ref('customer_id').references(() => customers.id),
    partnerId: ref('partner_id').references(() => partners.id),
    nameEn: text('name_en').notNull(),
    nameAr: text('name_ar'),
    /**
     * One block, newlines preserved, printed as given. Not line_1/line_2/city:
     * a Kuwaiti plot number, an Indian PIN block and a European door number do
     * not agree on how many parts an address has, and the structured version
     * gets worked around by overflowing the last field.
     */
    address: text('address'),
    city: text('city'),
    country: text('country').references(() => countries.code),
    contactName: text('contact_name'),
    phone: text('phone'),
    email: text('email'),
    taxId: text('tax_id'),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [index('job_parties_job_idx').on(t.jobId, t.role, t.sortOrder)],
)

/**
 * What is in the shipment, in the shipper's words — 0010.
 *
 * `commodities.hs_code` classifies cargo for customs; this describes it for a
 * carrier, and the two are not the same sentence. A carrier prints what it is
 * given — the phrase of art is "said to contain" — so nothing here is resolved
 * through a lookup that would improve it.
 */
export const jobCargo = pgTable(
  'job_cargo',
  {
    id: pk(),
    jobId: ref('job_id')
      .notNull()
      .references(() => jobs.id),
    lineNo: integer('line_no').notNull().default(1),
    /** Verbatim. Newlines preserved — marks are laid out, not written. */
    marksAndNumbers: text('marks_and_numbers'),
    packageCount: integer('package_count'),
    /** "CARTONS", "PALLETS", "DRUMS" — free text, printed as given. */
    packageType: text('package_type'),
    descriptionEn: text('description_en').notNull(),
    descriptionAr: text('description_ar'),
    /** Classification, for the customs pack. Distinct from the description. */
    hsCode: text('hs_code'),
    grossWeightKg: quantity('gross_weight_kg'),
    netWeightKg: quantity('net_weight_kg'),
    volumeCbm: quantity('volume_cbm'),
    /** Known at stuffing, not at booking, and never for an air line. */
    equipmentId: ref('equipment_id'),
    ...timestamps,
  },
  (t) => [uniqueIndex('job_cargo_line_unique').on(t.jobId, t.lineNo)],
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
    /**
     * What we told the customer to expect, kept beside `duty_amount`, which is
     * what was actually assessed (0013).
     *
     * Both, deliberately. The gap between them is the only honest measure of
     * whether the estimate is worth quoting, and a single column would be
     * overwritten by the truth so the question could never be asked again.
     */
    customsValue: amount('customs_value'),
    customsValueCurrency: text('customs_value_currency').references(() => currencies.code),
    estimatedDutyAmount: amount('estimated_duty_amount'),
    estimatedAt: tsz('estimated_at'),
    /** The HS lines, rates and values behind the estimate, so a disputed
     * number can be explained without recomputing it against a tariff that
     * has since moved. */
    estimateBasis: jsonb('estimate_basis').$type<Record<string, unknown>>(),
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
    /**
     * When the operator was told this clock was about to start charging.
     *
     * The accrual beside it bills demurrage the night *after* it is incurred,
     * which is accounting. This column exists for the other direction: the
     * days before expiry are the only ones anybody can act on, and a container
     * moved on day four costs nothing. Set once — `escalated_at` on enquiries
     * is the same idea for the same reason, that a warning which repeats every
     * night is a warning that gets filtered out of an inbox.
     */
    warnedAt: tsz('warned_at'),
    ...timestamps,
  },
  (t) => [
    index('free_time_clocks_open_idx').on(t.endsOn, t.kind),
    index('free_time_clocks_job_idx').on(t.jobId),
    // The warning worker's whole query: open, unwarned, oldest first.
    index('free_time_clocks_unwarned_idx').on(t.warnedAt, t.endsOn),
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
    /**
     * The template key that produced this file, null for an upload (0010).
     *
     * `documents` could say what type a file was and who released it, but not
     * whether the system produced it or a coordinator uploaded a scan — and
     * that decides whether regeneration is offered at all.
     */
    generatedFrom: text('generated_from'),
    locale: localeEnum('locale').notNull().default('en'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [
    index('documents_job_idx').on(t.jobId, t.documentTypeId, t.version),
    index('documents_released_idx').on(t.releasedAt),
  ],
)

/**
 * Proof of delivery — the artefact that settles "we never received it".
 *
 * Everything else on a job records what *we* did. This records what the
 * consignee did, and it is the only row in the schema whose primary audience
 * is a dispute six months later. Three things make it evidence rather than a
 * note, and all three are columns because a convention would be forgotten on
 * the delivery that matters:
 *
 * **A name, typed by the person who signed.** Not the consignee on the
 * waybill — the individual at the door. "Received by the consignee" settles
 * nothing; "received by M. Haddad, civil ID ending 4471" settles it.
 *
 * **A signature and photographs, stored as assets.** The bytes live in object
 * storage behind `FileStore` like every other file; what makes them evidence
 * is that they are pinned to a delivery instant that a trigger stamps.
 *
 * **Where the device was.** Nullable, deliberately — a driver may refuse
 * location permission and the delivery still happened. A null coordinate is an
 * honest "not captured"; a zero would be the Gulf of Guinea.
 *
 * `superseded_by_id` rather than an update, because a corrected POD and the
 * one that was corrected are both facts, and the second is the one somebody
 * will ask about (§5.5).
 */
export const proofOfDelivery = pgTable(
  'proof_of_delivery',
  {
    id: pk(),
    jobId: ref('job_id')
      .notNull()
      .references(() => jobs.id),
    /**
     * Which part of the shipment was handed over.
     *
     * Null means all of it, which is the common case. A part delivery names
     * the container so three PODs on one job do not have to be told apart by
     * their timestamps.
     */
    equipmentId: ref('equipment_id').references(() => equipment.id),
    /** When the cargo changed hands, not when the form was submitted. */
    deliveredAt: tsz('delivered_at').notNull(),
    receivedByName: text('received_by_name').notNull(),
    /** Civil ID, passport or company stamp reference — free text, as given. */
    receivedByIdNumber: text('received_by_id_number'),
    signatureAssetId: ref('signature_asset_id').references(() => assets.id),
    latitude: quantity('latitude'),
    longitude: quantity('longitude'),
    /** Metres. A 2,000 m fix on a delivery is a fix worth distrusting. */
    accuracyMetres: quantity('accuracy_metres'),
    /**
     * Delivered short, damaged or refused.
     *
     * A POD with an exception is still a POD — the cargo moved and somebody
     * signed. Recording the exception here rather than refusing the capture is
     * what stops a driver abandoning the form and reporting it by WhatsApp.
     */
    hasException: boolean('has_exception').notNull().default(false),
    exceptionNotes: text('exception_notes'),
    notes: text('notes'),
    capturedById: ref('captured_by_id').references(() => principals.id),
    /**
     * A POD is for the customer by default — it is the thing they ask for.
     *
     * The flag exists because `job_milestones` and `exceptions` carry one and
     * the RLS shape reads it; a POD held back is the rare case where the
     * exception notes name a third party.
     */
    customerVisible: boolean('customer_visible').notNull().default(true),
    supersededById: ref('superseded_by_id'),
    ...timestamps,
  },
  (t) => [
    index('proof_of_delivery_job_idx').on(t.jobId, t.deliveredAt),
    index('proof_of_delivery_open_idx').on(t.supersededById),
  ],
)

/**
 * The photographs on a delivery — cargo at the door, damage, the signed paper.
 *
 * Its own table rather than an array column on the POD, because each one has a
 * caption a driver typed and an order somebody chose, and because a photograph
 * added an hour later is an insert rather than a rewrite of the row that
 * carries the signature.
 */
export const podPhotos = pgTable(
  'pod_photos',
  {
    id: pk(),
    podId: ref('pod_id')
      .notNull()
      .references(() => proofOfDelivery.id),
    assetId: ref('asset_id')
      .notNull()
      .references(() => assets.id),
    caption: text('caption'),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [index('pod_photos_pod_idx').on(t.podId, t.sortOrder)],
)
