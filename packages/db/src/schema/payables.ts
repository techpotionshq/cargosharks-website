/**
 * The other side of the ledger — supplier invoices, matching, and the agent
 * current account (0014).
 *
 * `invoices.customer_id` is `not null` and always was: that table is
 * receivables and nothing else. Costs existed as `charge_lines` carrying a
 * `counterparty_partner_id`, which gives job P&L and gives the accounting
 * export a payable to credit — but there was nothing to match the carrier's
 * actual bill against what the job accrued, and nothing that could tell you an
 * agent had billed 460 for something quoted at 400 until somebody noticed in a
 * spreadsheet, after the customer had already been invoiced at 400.
 *
 * Three decisions carry this file.
 *
 * **A supplier invoice is a document, not a charge line.** It is raised in
 * another building, carries their number, their date and their tax treatment,
 * and arrives as a PDF. Modelling it as more charge lines would have made the
 * accrual and the bill indistinguishable, which is precisely the distinction
 * FR-FN-09 is about.
 *
 * **Matching is its own table, many-to-many.** One ocean freight accrual is
 * routinely billed across two invoices, and one invoice line routinely covers
 * three jobs' worth of accrual. A foreign key in either direction would model
 * a shape the business does not have.
 *
 * **A settlement is a document too.** Netting a payable against a receivable
 * changes what both sides owe, and "we agreed 3,600 against your March
 * statement" has to be a row somebody can point at a year later — not a
 * calculation the screen re-derives and which quietly changes when a late
 * invoice lands in the period.
 */

import { boolean, date, index, integer, text, unique } from 'drizzle-orm/pg-core'
import { amount, pk, quantity, rate, ref, timestamps, tsz } from './columns'
import { pgTable } from './table'
import {
  settlementDirectionEnum,
  settlementLineKindEnum,
  settlementStatusEnum,
  supplierInvoiceStatusEnum,
} from './enums'
import { branches, principals } from './identity'
import { chargeTypes, currencies } from './reference'
import { partners } from './commercial'
import { assets } from './files'
import { jobs } from './jobs'

/**
 * What a supplier has asked us for — FR-FN-09.
 *
 * `reference` is *their* number, and the unique index is on it together with
 * the partner. Capturing the same agent invoice twice is the single most
 * common data error on this screen — two people open the same email — and it
 * pays twice if nothing stops it.
 */
export const supplierInvoices = pgTable(
  'supplier_invoices',
  {
    id: pk(),
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id),
    partnerId: ref('partner_id')
      .notNull()
      .references(() => partners.id),
    /** Their invoice number, exactly as printed. Never generated here. */
    reference: text('reference').notNull(),
    status: supplierInvoiceStatusEnum('status').notNull().default('received'),
    currency: text('currency')
      .notNull()
      .references(() => currencies.code),
    subtotal: amount('subtotal').notNull().default('0'),
    taxAmount: amount('tax_amount').notNull().default('0'),
    total: amount('total').notNull().default('0'),
    amountPaid: amount('amount_paid').notNull().default('0'),
    /**
     * The rate to base, taken when the bill was captured.
     *
     * On the row rather than looked up later, for the same reason charge lines
     * carry one (FR-RT-06): a payable revalued at today's rate disagrees with
     * the journal that posted it, and the disagreement surfaces months later
     * as a payables balance nobody can reconcile.
     */
    fxRate: rate('fx_rate').notNull().default('1'),
    fxRateAt: tsz('fx_rate_at').notNull().defaultNow(),
    /** The date on their document — the accounting event. */
    invoiceDate: date('invoice_date').notNull(),
    dueOn: date('due_on'),
    receivedAt: tsz('received_at').notNull().defaultNow(),
    /** Their PDF. The argument is won by producing the document. */
    assetId: ref('asset_id').references(() => assets.id),
    /**
     * Approval is what makes a bill payable, and it is deliberately a separate
     * act from capturing it.
     *
     * Anyone in operations can enter what arrived; releasing it for payment is
     * finance's, and it is the gate the variance report exists to inform. A
     * bill approved while a line is outside tolerance records who decided that
     * was acceptable.
     */
    approvedById: ref('approved_by_id').references(() => principals.id),
    approvedAt: tsz('approved_at'),
    /**
     * Who captured it, where a person did (U5). Read to open the next
     * "Capture bill" on the branch this person last entered a bill for —
     * someone in Kuwait and Dubai who only ever keys Kuwait's bills should
     * not pick the branch every time. Null for bills from before it was
     * kept, and for any the system raised itself.
     */
    recordedById: ref('recorded_by_id').references(() => principals.id),
    /**
     * Approving a bill that is outside tolerance is a decision, recorded as one.
     *
     * Not folded into `notes`, which is free text somebody may already have
     * used, and not into `disputeReason`, which means the opposite thing. "Who
     * decided the 60 KWD overcharge was acceptable, and what did they say" is
     * the question this feature exists to answer six months later.
     */
    varianceAcceptedAt: tsz('variance_accepted_at'),
    varianceAcceptedReason: text('variance_accepted_reason'),
    disputedAt: tsz('disputed_at'),
    disputeReason: text('dispute_reason'),
    /** Set where a set-off consumed this bill rather than a payment. */
    settlementId: ref('settlement_id'),
    /** The posted export that carried its variance into the ledger. */
    accountingExportId: ref('accounting_export_id'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [
    unique('supplier_invoices_reference_unique').on(t.partnerId, t.reference),
    index('supplier_invoices_partner_idx').on(t.partnerId, t.status),
    index('supplier_invoices_ageing_idx').on(t.branchId, t.status, t.dueOn),
    index('supplier_invoices_recorded_by_idx').on(t.recordedById, t.createdAt),
    index('supplier_invoices_unposted_idx').on(t.branchId, t.accountingExportId),
  ],
)

/**
 * Their lines, as they wrote them.
 *
 * `charge_type_id` is nullable and the description is theirs, because a
 * supplier invoice arrives describing charges in the supplier's vocabulary —
 * "ORIGIN DOC FEE", "B/L RELEASE" — and forcing a mapping at capture time
 * would mean either refusing to record what arrived or inventing a charge type
 * for every phrasing in the region. The mapping happens when the line is
 * matched, which is when somebody is looking at it anyway.
 *
 * `job_id` is likewise optional: an agent's monthly invoice covers thirty
 * shipments, and which line belongs to which job is exactly what the matching
 * screen works out.
 */
export const supplierInvoiceLines = pgTable(
  'supplier_invoice_lines',
  {
    id: pk(),
    supplierInvoiceId: ref('supplier_invoice_id')
      .notNull()
      .references(() => supplierInvoices.id),
    /** Carried, not derived — as on `consol_charge_lines`, so RLS does not recurse. */
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id),
    jobId: ref('job_id').references(() => jobs.id),
    chargeTypeId: ref('charge_type_id').references(() => chargeTypes.id),
    /** Their words, not ours. */
    description: text('description').notNull(),
    quantity: quantity('quantity').notNull().default('1'),
    unitPrice: amount('unit_price').notNull(),
    amount: amount('amount').notNull(),
    taxAmount: amount('tax_amount').notNull().default('0'),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index('supplier_invoice_lines_invoice_idx').on(t.supplierInvoiceId, t.sortOrder),
    index('supplier_invoice_lines_job_idx').on(t.jobId),
  ],
)

/**
 * What we accrued, against what they billed — the match itself.
 *
 * Many-to-many because both directions genuinely happen: a master freight
 * accrual split across two invoices, and one invoice line covering several
 * jobs' accruals.
 *
 * There is no ceiling on the charge-line side, and that absence is the design.
 * `core/matching.ts` explains it at length: a match that exceeded the accrual
 * is the event this whole feature exists to detect, and a constraint refusing
 * it would make the system unable to represent the thing it is for. The
 * ceiling that *is* enforced — never more than the supplier line was billed —
 * lives in the mutation, inside the transaction that reads the position.
 */
export const supplierInvoiceMatches = pgTable(
  'supplier_invoice_matches',
  {
    id: pk(),
    supplierInvoiceLineId: ref('supplier_invoice_line_id')
      .notNull()
      .references(() => supplierInvoiceLines.id),
    /** No `.references()`: `charge_lines` is declared in `finance.ts`, and the
     * constraint is added in the migration to keep the import graph acyclic. */
    chargeLineId: ref('charge_line_id').notNull(),
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id),
    /**
     * How much of the supplier line this match claims, in the invoice's
     * currency. Not the charge line's amount — the two disagreeing is the
     * whole point, and storing the accrual here would lose the disagreement.
     */
    amount: amount('amount').notNull(),
    matchedById: ref('matched_by_id').references(() => principals.id),
    matchedAt: tsz('matched_at').notNull().defaultNow(),
    /**
     * Retracted rather than deleted — §5.5, and it is not a technicality here.
     *
     * A match is an assertion that two rows correspond, and the first instinct
     * is that retracting a wrong assertion is not the same as deleting a
     * document. It is not, but the row is still evidence: "this bill was
     * matched to that accrual, and then somebody unmatched it" is exactly the
     * history you want when a variance is being argued about three months
     * later, and a deleted row cannot tell you who changed their mind.
     *
     * Every read filters on `retracted_at is null`. `app_user` holds no DELETE
     * on this table any more than on any other.
     */
    retractedAt: tsz('retracted_at'),
    retractedById: ref('retracted_by_id').references(() => principals.id),
    ...timestamps,
  },
  (t) => [
    unique('supplier_invoice_matches_unique').on(t.supplierInvoiceLineId, t.chargeLineId),
    index('supplier_invoice_matches_charge_idx').on(t.chargeLineId),
  ],
)

/** Money out — the mirror of `payments`, and deliberately a separate table. */
export const supplierPayments = pgTable(
  'supplier_payments',
  {
    id: pk(),
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id),
    partnerId: ref('partner_id')
      .notNull()
      .references(() => partners.id),
    amount: amount('amount').notNull(),
    currency: text('currency')
      .notNull()
      .references(() => currencies.code),
    fxRate: rate('fx_rate').notNull().default('1'),
    fxRateAt: tsz('fx_rate_at').notNull().defaultNow(),
    paidOn: date('paid_on').notNull(),
    method: text('method').notNull(),
    reference: text('reference'),
    recordedById: ref('recorded_by_id').references(() => principals.id),
    accountingExportId: ref('accounting_export_id'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [
    index('supplier_payments_partner_idx').on(t.partnerId, t.paidOn),
    index('supplier_payments_export_idx').on(t.accountingExportId),
  ],
)

/** Allocation of a payment across their invoices — part payments are the norm. */
export const supplierPaymentAllocations = pgTable(
  'supplier_payment_allocations',
  {
    id: pk(),
    supplierPaymentId: ref('supplier_payment_id')
      .notNull()
      .references(() => supplierPayments.id),
    supplierInvoiceId: ref('supplier_invoice_id')
      .notNull()
      .references(() => supplierInvoices.id),
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id),
    amount: amount('amount').notNull(),
    ...timestamps,
  },
  (t) => [
    unique('supplier_payment_allocations_unique').on(t.supplierPaymentId, t.supplierInvoiceId),
  ],
)

/**
 * A month's set-off with an agent — the current account, made a document.
 *
 * We run a current account with Jebel Ali and with Nhava Sheva: our payable to
 * them netted against our receivable from them, settled monthly. Held as two
 * independent ledgers that reconciliation is a spreadsheet emailed back and
 * forth, and it is where the disagreements live.
 *
 * The totals are *stored*, not derived. A statement is a thing both sides
 * agreed to on a date, and a screen that re-derives it from live tables shows
 * a different figure the moment a late invoice is captured into the period —
 * which is how a settlement both parties signed becomes unreproducible.
 */
export const partnerSettlements = pgTable(
  'partner_settlements',
  {
    id: pk(),
    reference: text('reference').notNull().unique(),
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id),
    partnerId: ref('partner_id')
      .notNull()
      .references(() => partners.id),
    status: settlementStatusEnum('status').notNull().default('draft'),
    /**
     * One currency, by agreement.
     *
     * `core/netting.ts` refuses a mixed set-off, and the refusal is not
     * fussiness: netting a USD payable against a KWD receivable at a rate
     * chosen on the day is a currency trade, and both parties have to agree
     * the rate before it is one.
     */
    currency: text('currency')
      .notNull()
      .references(() => currencies.code),
    periodFrom: date('period_from').notNull(),
    periodTo: date('period_to').notNull(),
    receivableTotal: amount('receivable_total').notNull().default('0'),
    payableTotal: amount('payable_total').notNull().default('0'),
    /** What the set-off extinguished on both sides — the smaller of the two. */
    offsetAmount: amount('offset_amount').notNull().default('0'),
    /** What is left to move, always positive; the direction is its own column. */
    residualAmount: amount('residual_amount').notNull().default('0'),
    residualDirection: settlementDirectionEnum('residual_direction').notNull().default('square'),
    fxRate: rate('fx_rate').notNull().default('1'),
    fxRateAt: tsz('fx_rate_at').notNull().defaultNow(),
    /** Both sides have seen it and agree. The point of no return for the figures. */
    agreedAt: tsz('agreed_at'),
    agreedById: ref('agreed_by_id').references(() => principals.id),
    /** The residual has moved. */
    settledAt: tsz('settled_at'),
    settledById: ref('settled_by_id').references(() => principals.id),
    voidedAt: tsz('voided_at'),
    voidReason: text('void_reason'),
    statementAssetId: ref('statement_asset_id').references(() => assets.id),
    accountingExportId: ref('accounting_export_id'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [
    index('partner_settlements_partner_idx').on(t.partnerId, t.status, t.periodTo),
    index('partner_settlements_unposted_idx').on(t.branchId, t.accountingExportId),
  ],
)

/**
 * Which documents the set-off consumed.
 *
 * Without these rows a settlement is a number, and the first question anybody
 * asks about a number is which invoices it covered. They are also what stops
 * the same invoice appearing in two consecutive settlements: it is claimed
 * here, and the next period's statement excludes what is already claimed.
 */
export const partnerSettlementLines = pgTable(
  'partner_settlement_lines',
  {
    id: pk(),
    settlementId: ref('settlement_id')
      .notNull()
      .references(() => partnerSettlements.id),
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id),
    kind: settlementLineKindEnum('kind').notNull(),
    /** Exactly one of these is set; the check constraint is in the migration. */
    invoiceId: ref('invoice_id'),
    supplierInvoiceId: ref('supplier_invoice_id').references(() => supplierInvoices.id),
    /** How much of that document the set-off claimed. */
    amount: amount('amount').notNull(),
    /** False where the set-off cleared only part of it. */
    isFull: boolean('is_full').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index('partner_settlement_lines_settlement_idx').on(t.settlementId, t.kind),
    unique('partner_settlement_lines_invoice_unique').on(t.settlementId, t.invoiceId),
    unique('partner_settlement_lines_bill_unique').on(t.settlementId, t.supplierInvoiceId),
  ],
)
