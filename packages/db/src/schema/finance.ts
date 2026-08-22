/**
 * Charges, invoices and payments — Architecture §6.3, FR-FN.
 *
 * One invoice model plus per-branch configuration rows covers five legal
 * entities with different tax treatments and numbering rules (§7). The
 * entity-specific parts — series, tax registration, letterhead, base currency
 * — are columns on `branches`, not five code paths.
 */

import { boolean, date, index, integer, jsonb, text, unique } from 'drizzle-orm/pg-core'
import { amount, pk, quantity, rate, ref, timestamps, tsz } from './columns'
import { pgTable } from './table'
import {
  accountingExportStatusEnum,
  basisEnum,
  chargeDirectionEnum,
  invoiceStatusEnum,
  localeEnum,
  taxTreatmentEnum,
} from './enums'
import { branches, principals } from './identity'
import { chargeTypes, currencies } from './reference'
import { customers, partners } from './commercial'
import { jobs } from './jobs'

/**
 * Every cost-bearing and revenue-bearing event on a job — SRS §4.2's third
 * commitment, "every cost-bearing event writes a line".
 *
 * The FX rate and the moment it was taken are on the row (FR-RT-06). Nothing
 * looks a rate up later, which is the only way a USD-priced quote invoiced in
 * KWD still reconciles months afterwards.
 */
export const chargeLines = pgTable(
  'charge_lines',
  {
    id: pk(),
    jobId: ref('job_id')
      .notNull()
      .references(() => jobs.id),
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id),
    direction: chargeDirectionEnum('direction').notNull(),
    chargeTypeId: ref('charge_type_id')
      .notNull()
      .references(() => chargeTypes.id),
    description: text('description'),
    basis: basisEnum('basis').notNull(),
    quantity: quantity('quantity').notNull().default('1'),
    rate: amount('rate').notNull(),
    amount: amount('amount').notNull(),
    currency: text('currency')
      .notNull()
      .references(() => currencies.code),
    fxRate: rate('fx_rate').notNull().default('1'),
    fxRateAt: tsz('fx_rate_at').notNull().defaultNow(),
    /** The same amount in the branch's base currency, at the rate above. */
    amountBase: amount('amount_base').notNull(),
    baseCurrency: text('base_currency')
      .notNull()
      .references(() => currencies.code),
    /** The partner a cost is owed to, or the customer a revenue is due from. */
    counterpartyPartnerId: ref('counterparty_partner_id').references(() => partners.id),
    counterpartyCustomerId: ref('counterparty_customer_id').references(() => customers.id),
    /** Set once the line is billed; a billed line is never edited. */
    invoiceId: ref('invoice_id'),
    /** Set where a nightly accrual wrote this line, so re-runs update it. */
    sourceKind: text('source_kind'),
    sourceId: ref('source_id'),
    isAccrual: boolean('is_accrual').notNull().default(false),
    /** The posted export that carried this cost into the ledger (0011). */
    accountingExportId: ref('accounting_export_id'),
    approvedById: ref('approved_by_id').references(() => principals.id),
    approvedAt: tsz('approved_at'),
    ...timestamps,
  },
  (t) => [
    index('charge_lines_job_idx').on(t.jobId, t.direction),
    index('charge_lines_unbilled_idx').on(t.branchId, t.invoiceId, t.direction),
    index('charge_lines_source_idx').on(t.sourceKind, t.sourceId),
  ],
)

/**
 * Invoices — FR-ID-01 numbering per entity, FR-FN tax treatment.
 *
 * `series_no` comes from the branch's own counter, allocated inside the
 * issuing transaction. `language` decides which of the bilingual name columns
 * the PDF renders and which direction the template runs (§11).
 */
export const invoices = pgTable(
  'invoices',
  {
    id: pk(),
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id),
    customerId: ref('customer_id')
      .notNull()
      .references(() => customers.id),
    /** Null until issued — a draft has no number to reuse or leave a gap. */
    seriesNo: text('series_no'),
    status: invoiceStatusEnum('status').notNull().default('draft'),
    currency: text('currency')
      .notNull()
      .references(() => currencies.code),
    subtotal: amount('subtotal').notNull().default('0'),
    taxAmount: amount('tax_amount').notNull().default('0'),
    total: amount('total').notNull().default('0'),
    amountPaid: amount('amount_paid').notNull().default('0'),
    taxTreatment: taxTreatmentEnum('tax_treatment').notNull().default('out_of_scope'),
    taxRatePercent: quantity('tax_rate_percent').notNull().default('0'),
    language: localeEnum('language').notNull().default('en'),
    issuedAt: tsz('issued_at'),
    dueOn: date('due_on'),
    /** A credit note points at the invoice it reverses (§5.5). */
    creditsInvoiceId: ref('credits_invoice_id'),
    isCreditNote: boolean('is_credit_note').notNull().default(false),
    pdfAssetId: ref('pdf_asset_id'),
    issuedById: ref('issued_by_id').references(() => principals.id),
    /**
     * The posted export that carried this invoice into the ledger (0011).
     *
     * This column *is* the rule that a period cannot post twice. A check
     * inside the export routine would be a read-then-write across two
     * statements, and two people exporting January at the same moment would
     * both pass it. Set once, cleared only by voiding the export — which is a
     * deliberate act by somebody holding `finance.export`.
     */
    accountingExportId: ref('accounting_export_id'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [
    unique('invoices_series_unique').on(t.branchId, t.seriesNo),
    index('invoices_customer_idx').on(t.customerId, t.status),
    index('invoices_ageing_idx').on(t.branchId, t.status, t.dueOn),
  ],
)

/**
 * Invoice lines are their own table, not a view over `charge_lines`.
 *
 * They look similar and are not the same concept: a charge line is what the
 * job cost or earned, an invoice line is what the customer was told. They
 * diverge the moment two charges are billed as one line, or a description is
 * reworded for the customer. §4 says such pairs stay separate until a third
 * case proves the pattern.
 */
export const invoiceLines = pgTable(
  'invoice_lines',
  {
    id: pk(),
    invoiceId: ref('invoice_id')
      .notNull()
      .references(() => invoices.id),
    chargeTypeId: ref('charge_type_id').references(() => chargeTypes.id),
    descriptionEn: text('description_en').notNull(),
    descriptionAr: text('description_ar'),
    quantity: quantity('quantity').notNull().default('1'),
    unitPrice: amount('unit_price').notNull(),
    amount: amount('amount').notNull(),
    taxAmount: amount('tax_amount').notNull().default('0'),
    isTaxable: boolean('is_taxable').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [index('invoice_lines_invoice_idx').on(t.invoiceId, t.sortOrder)],
)

export const payments = pgTable(
  'payments',
  {
    id: pk(),
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id),
    customerId: ref('customer_id')
      .notNull()
      .references(() => customers.id),
    amount: amount('amount').notNull(),
    currency: text('currency')
      .notNull()
      .references(() => currencies.code),
    fxRate: rate('fx_rate').notNull().default('1'),
    fxRateAt: tsz('fx_rate_at').notNull().defaultNow(),
    receivedOn: date('received_on').notNull(),
    method: text('method').notNull(),
    reference: text('reference'),
    recordedById: ref('recorded_by_id').references(() => principals.id),
    /** As on invoices — a journal that posts sales and not receipts leaves
     * receivables growing forever (0011). */
    accountingExportId: ref('accounting_export_id'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [
    index('payments_customer_idx').on(t.customerId, t.receivedOn),
    index('payments_export_idx').on(t.accountingExportId),
  ],
)

/** Allocation of a payment across invoices — partial payments are the norm. */
export const paymentAllocations = pgTable(
  'payment_allocations',
  {
    id: pk(),
    paymentId: ref('payment_id')
      .notNull()
      .references(() => payments.id),
    invoiceId: ref('invoice_id')
      .notNull()
      .references(() => invoices.id),
    amount: amount('amount').notNull(),
    ...timestamps,
  },
  (t) => [unique('payment_allocations_unique').on(t.paymentId, t.invoiceId)],
)

/**
 * Accounting exports — FR-FN.
 *
 * R1 writes a file; the shape depends on which package the client uses, which
 * is open question 3 in §14. The row records what was exported and when, so a
 * re-export is provably identical rather than a second posting.
 */
export const accountingExports = pgTable(
  'accounting_exports',
  {
    id: pk(),
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id),
    format: text('format').notNull(),
    periodFrom: date('period_from').notNull(),
    periodTo: date('period_to').notNull(),
    assetId: ref('asset_id'),
    rowCount: integer('row_count').notNull().default(0),
    /**
     * What the file said it covered.
     *
     * The live link is `invoices.accounting_export_id` — that is what enforces
     * the rule and what a void clears. This stays as the snapshot: a record of
     * what the generated file *claimed*, which survives the void and is what
     * an auditor holding the CSV is actually asking about.
     */
    includedInvoiceIds: jsonb('included_invoice_ids').$type<string[]>().default([]),
    includedPaymentIds: jsonb('included_payment_ids').$type<string[]>().notNull().default([]),
    status: accountingExportStatusEnum('status').notNull().default('draft'),
    postedAt: tsz('posted_at'),
    postedById: ref('posted_by_id').references(() => principals.id),
    voidedAt: tsz('voided_at'),
    voidedById: ref('voided_by_id').references(() => principals.id),
    voidReason: text('void_reason'),
    /** Checksum of the generated bytes, so "is this the file?" has an answer. */
    checksum: text('checksum'),
    exportedById: ref('exported_by_id').references(() => principals.id),
    ...timestamps,
  },
  (t) => [index('accounting_exports_period_idx').on(t.branchId, t.periodFrom)],
)
