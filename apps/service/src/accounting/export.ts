/**
 * The accounting export — reading the period, building the journal, posting it.
 *
 * The engine that decides what a journal line *is* lives in
 * `@qabandi/core/accounting` and touches no database, which is where the
 * arithmetic is tested. This is the half that knows where the rows are and
 * what happens to them afterwards, and it has exactly three jobs:
 *
 *   select   what falls in the period and has not been posted already
 *   store    the file, so the row can point at bytes rather than describe them
 *   mark     the sources, so the next export cannot pick them up again
 *
 * ## Draft and posted are genuinely different operations
 *
 * A finance manager generates January three or four times before they believe
 * it. A draft therefore builds and stores the file and marks *nothing* — run
 * it twenty times and the twenty-first still sees every invoice. Posting is
 * the deliberate act that consumes them, and it is the only one that needs
 * `finance.export`.
 *
 * ## The order of writes
 *
 * Store the file, then insert the export row, then mark the sources — all
 * three inside one transaction for the last two. If the marking fails, the
 * export row rolls back with it and nothing is half-posted. An orphaned object
 * in the bucket is the acceptable failure here; a period marked as posted
 * against an export row that does not exist is not.
 */

import { createHash } from 'node:crypto'
import { and, asc, between, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  SEED_CURRENCIES,
  buildJournal,
  dec,
  toJournalCsv,
  unmappedChargeTypes,
  type AccountMapping,
  type CostInput,
  type CurrencySpec,
  type InvoiceInput,
  type Journal,
  type PaymentInput,
  type SettlementInput,
  type SupplierInvoiceInput,
  type SupplierPaymentInput,
} from '@qabandi/core'
import {
  accountingExports,
  assets,
  branches,
  chargeLines,
  chargeTypes,
  customers,
  invoiceLines,
  invoices,
  jobs,
  partnerSettlements,
  partners,
  paymentAllocations,
  payments,
  supplierInvoiceLines,
  supplierInvoices,
  supplierPaymentAllocations,
  supplierPayments,
  withActor,
  type Actor,
} from '@qabandi/db'
import { fileStore } from '../adapters/index'

export class ExportError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ExportError'
    this.code = code
  }
}

export interface ExportRequest {
  readonly branchId: string
  /** ISO dates, inclusive both ends. A period is a month in practice. */
  readonly from: string
  readonly to: string
  readonly format?: string
  /** False builds a preview; true consumes the period. */
  readonly post?: boolean
}

export interface ExportResult {
  readonly exportId: string
  readonly status: 'draft' | 'posted'
  readonly rowCount: number
  readonly totalDebit: string
  readonly totalCredit: string
  readonly invoiceCount: number
  readonly costCount: number
  readonly paymentCount: number
  readonly supplierInvoiceCount: number
  readonly supplierPaymentCount: number
  readonly settlementCount: number
  readonly csv: string
  readonly filename: string
  readonly assetId: string | null
  readonly checksum: string
}

const spec = (code: string): CurrencySpec =>
  SEED_CURRENCIES.find((c) => c.code === code) ?? { code, minorUnits: 2 }

/**
 * Everything unposted in the window, assembled into the engine's input.
 *
 * `isNull(accountingExportId)` on all three is what makes a second export of
 * the same period return an empty journal rather than a duplicate one. It is
 * a filter, not a check: there is no moment between reading and writing where
 * a second caller could slip through, because the marking `update` carries the
 * same condition.
 */
async function collect(actor: Actor, request: ExportRequest) {
  return withActor(actor, async (tx) => {
    const [branch] = await tx
      .select({
        code: branches.code,
        baseCurrency: branches.baseCurrency,
        ar: branches.arAccountCode,
        ap: branches.apAccountCode,
        tax: branches.taxAccountCode,
        inputTax: branches.inputTaxAccountCode,
        bank: branches.bankAccountCode,
        fx: branches.fxVarianceAccountCode,
        rounding: branches.roundingAccountCode,
      })
      .from(branches)
      .where(eq(branches.id, request.branchId))
      .limit(1)

    if (!branch) throw new ExportError('branch_not_found', 'No such branch, or it is not visible')

    const mappings = (await tx
      .select({
        chargeTypeId: chargeTypes.id,
        key: chargeTypes.key,
        nameEn: chargeTypes.nameEn,
        revenueAccountCode: chargeTypes.revenueAccountCode,
        costAccountCode: chargeTypes.costAccountCode,
      })
      .from(chargeTypes)) as AccountMapping[]

    /*
      Issued invoices only, by issue date rather than creation date.

      A draft raised in March and issued in April belongs to April: the issue
      is the accounting event, and it is the moment the statutory number was
      allocated. Credit notes come through the same query — they are invoices
      with the flag set, and the engine reverses them without a second path.
    */
    const invoiceRows = await tx
      .select({
        id: invoices.id,
        seriesNo: invoices.seriesNo,
        issuedAt: invoices.issuedAt,
        currency: invoices.currency,
        isCreditNote: invoices.isCreditNote,
        customerName: customers.legalNameEn,
      })
      .from(invoices)
      .innerJoin(customers, eq(customers.id, invoices.customerId))
      .where(
        and(
          eq(invoices.branchId, request.branchId),
          isNull(invoices.accountingExportId),
          inArray(invoices.status, ['issued', 'part_paid', 'paid', 'credited']),
          sql`${invoices.issuedAt}::date between ${request.from}::date and ${request.to}::date`,
        ),
      )
      .orderBy(asc(invoices.issuedAt))

    const invoiceIds = invoiceRows.map((i) => i.id)
    const lineRows =
      invoiceIds.length > 0
        ? await tx
            .select({
              invoiceId: invoiceLines.invoiceId,
              chargeTypeId: invoiceLines.chargeTypeId,
              descriptionEn: invoiceLines.descriptionEn,
              amount: invoiceLines.amount,
              taxAmount: invoiceLines.taxAmount,
            })
            .from(invoiceLines)
            .where(inArray(invoiceLines.invoiceId, invoiceIds))
            .orderBy(asc(invoiceLines.sortOrder))
        : []

    /*
      The invoice's rate to base.

      An invoice has no `fx_rate` column — the rate lives on the charge lines
      behind it, captured at pricing time (FR-RT-06). Where the invoice is in
      the base currency this is 1 and the query is skipped; where it is not,
      the rate on any of its lines is the rate the whole document was priced
      at, because a single invoice is never split across two rates.
    */
    const rateRows =
      invoiceIds.length > 0
        ? await tx
            .select({ invoiceId: chargeLines.invoiceId, fxRate: chargeLines.fxRate })
            .from(chargeLines)
            .where(inArray(chargeLines.invoiceId, invoiceIds))
        : []

    const rateByInvoice = new Map(
      rateRows
        .filter((r) => r.invoiceId !== null)
        .map((r) => [r.invoiceId as string, r.fxRate ?? '1']),
    )

    const invoiceInputs: InvoiceInput[] = invoiceRows.map((row) => ({
      id: row.id,
      seriesNo: row.seriesNo ?? row.id.slice(0, 8),
      issuedAt: row.issuedAt ?? new Date(request.from),
      customerName: row.customerName,
      currency: row.currency,
      fxRate: row.currency === branch.baseCurrency ? '1' : (rateByInvoice.get(row.id) ?? '1'),
      isCreditNote: row.isCreditNote,
      lines: lineRows
        .filter((l) => l.invoiceId === row.id)
        .map((l) => ({
          chargeTypeId: l.chargeTypeId,
          description: l.descriptionEn,
          amount: l.amount,
          taxAmount: l.taxAmount,
        })),
    }))

    const costRows = await tx
      .select({
        id: chargeLines.id,
        jobReference: jobs.reference,
        chargeTypeId: chargeLines.chargeTypeId,
        createdAt: chargeLines.createdAt,
        description: chargeLines.description,
        currency: chargeLines.currency,
        amount: chargeLines.amount,
        fxRate: chargeLines.fxRate,
        counterpartyName: partners.legalNameEn,
        chargeTypeName: chargeTypes.nameEn,
      })
      .from(chargeLines)
      .innerJoin(jobs, eq(jobs.id, chargeLines.jobId))
      .innerJoin(chargeTypes, eq(chargeTypes.id, chargeLines.chargeTypeId))
      .leftJoin(partners, eq(partners.id, chargeLines.counterpartyPartnerId))
      .where(
        and(
          eq(chargeLines.branchId, request.branchId),
          eq(chargeLines.direction, 'cost'),
          isNull(chargeLines.accountingExportId),
          sql`${chargeLines.createdAt}::date between ${request.from}::date and ${request.to}::date`,
        ),
      )
      .orderBy(asc(chargeLines.createdAt))

    const costInputs: CostInput[] = costRows.map((row) => ({
      id: row.id,
      jobReference: row.jobReference,
      chargeTypeId: row.chargeTypeId,
      incurredOn: row.createdAt,
      description: row.description ?? row.chargeTypeName,
      currency: row.currency,
      amount: row.amount,
      fxRate: row.fxRate,
      counterpartyName: row.counterpartyName ?? 'Unallocated supplier',
    }))

    const paymentRows = await tx
      .select({
        id: payments.id,
        receivedOn: payments.receivedOn,
        currency: payments.currency,
        amount: payments.amount,
        fxRate: payments.fxRate,
        method: payments.method,
        reference: payments.reference,
        customerName: customers.legalNameEn,
      })
      .from(payments)
      .innerJoin(customers, eq(customers.id, payments.customerId))
      .where(
        and(
          eq(payments.branchId, request.branchId),
          isNull(payments.accountingExportId),
          between(payments.receivedOn, request.from, request.to),
        ),
      )
      .orderBy(asc(payments.receivedOn))

    const paymentIds = paymentRows.map((p) => p.id)
    const allocationRows =
      paymentIds.length > 0
        ? await tx
            .select({
              paymentId: paymentAllocations.paymentId,
              amount: paymentAllocations.amount,
              seriesNo: invoices.seriesNo,
              invoiceCurrency: invoices.currency,
            })
            .from(paymentAllocations)
            .innerJoin(invoices, eq(invoices.id, paymentAllocations.invoiceId))
            .where(inArray(paymentAllocations.paymentId, paymentIds))
        : []

    const paymentInputs: PaymentInput[] = paymentRows.map((row) => ({
      id: row.id,
      receivedOn: new Date(row.receivedOn),
      customerName: row.customerName,
      currency: row.currency,
      amount: row.amount,
      fxRate: row.fxRate,
      method: row.method,
      reference: row.reference,
      allocations: allocationRows
        .filter((a) => a.paymentId === row.id)
        .map((a) => ({
          invoiceSeriesNo: a.seriesNo ?? '—',
          /*
            The allocation is recorded in the invoice's currency. Converting it
            to base at the *invoice's* rate is what makes the FX variance fall
            out of the journal — see the receipt entry in core.
          */
          /*
            Decimal, not `Number` — this string lands in the customer's ledger.
            Multiplying two floats and stringifying the result is how an
            allocation of 123.45 at a rate of 1.0 posts as
            `123.45000000000002`, which an accounting package either rejects on
            import or accepts and never reconciles.
          */
          baseAmount:
            a.invoiceCurrency === branch.baseCurrency
              ? a.amount
              : dec(a.amount)
                  .times(dec(rateByInvoice.get(row.id) ?? 1))
                  .toFixed(),
        })),
    }))

    /*
      Approved supplier bills in the window, by *their* invoice date.

      Their date rather than our capture date, for the same reason an invoice
      posts by its issue date: the accounting event happened when they raised
      it, and a bill entered three weeks late belongs to the month it was
      dated, not the month somebody opened the email.

      Only approved ones. A bill nobody has looked at is not a liability the
      period should carry — the accrual behind it already is, and posting the
      unreviewed variance on top would put an argument into the ledger before
      it has been had.
    */
    const supplierRows = await tx
      .select({
        id: supplierInvoices.id,
        reference: supplierInvoices.reference,
        invoiceDate: supplierInvoices.invoiceDate,
        currency: supplierInvoices.currency,
        fxRate: supplierInvoices.fxRate,
        partnerName: partners.legalNameEn,
      })
      .from(supplierInvoices)
      .innerJoin(partners, eq(partners.id, supplierInvoices.partnerId))
      .where(
        and(
          eq(supplierInvoices.branchId, request.branchId),
          isNull(supplierInvoices.accountingExportId),
          inArray(supplierInvoices.status, ['approved', 'part_paid', 'paid']),
          between(supplierInvoices.invoiceDate, request.from, request.to),
        ),
      )
      .orderBy(asc(supplierInvoices.invoiceDate))

    const supplierIds = supplierRows.map((s) => s.id)
    const supplierLineRows =
      supplierIds.length > 0
        ? await tx
            .select({
              supplierInvoiceId: supplierInvoiceLines.supplierInvoiceId,
              chargeTypeId: supplierInvoiceLines.chargeTypeId,
              description: supplierInvoiceLines.description,
              amount: supplierInvoiceLines.amount,
              taxAmount: supplierInvoiceLines.taxAmount,
              /*
                The accrual behind the line, in *base* currency.

                Summed here rather than joined, because a line can carry
                several matches and joining would multiply the row. The
                conversion back into the bill's currency happens below and is
                the interesting step — see the comment there.
              */
              accruedBase: sql<string>`coalesce((
                select sum(cl.amount_base)
                  from supplier_invoice_matches m
                  join charge_lines cl on cl.id = m.charge_line_id
                 where m.supplier_invoice_line_id = "supplier_invoice_lines"."id"
                   and m.retracted_at is null
              ), 0)::text`,
            })
            .from(supplierInvoiceLines)
            .where(inArray(supplierInvoiceLines.supplierInvoiceId, supplierIds))
            .orderBy(asc(supplierInvoiceLines.sortOrder))
        : []

    const supplierInvoiceInputs: SupplierInvoiceInput[] = supplierRows.map((row) => ({
      id: row.id,
      reference: row.reference,
      invoiceDate: new Date(row.invoiceDate),
      partnerName: row.partnerName,
      currency: row.currency,
      fxRate: row.fxRate,
      lines: supplierLineRows
        .filter((l) => l.supplierInvoiceId === row.id)
        .map((l) => ({
          chargeTypeId: l.chargeTypeId,
          description: l.description,
          amount: l.amount,
          billed: l.amount,
          taxAmount: l.taxAmount,
          /*
            The accrual, divided back through the bill's own rate.

            `core/accounting.ts` multiplies both figures by that rate, so
            handing it `accrued_base / rate` makes the posted variance come out
            as `billed_base − accrued_base` exactly — the difference between
            what the accrual put in the ledger and what the bill is worth.

            Converting the other way round — accrual at its own rate, bill at
            its own — would leave the two legs of the entry disagreeing by the
            FX movement between the two dates, and the journal would not
            balance.
          */
          accrued: dec(l.accruedBase).div(dec(row.fxRate)).toFixed(),
        })),
    }))

    const supplierPaymentRows = await tx
      .select({
        id: supplierPayments.id,
        paidOn: supplierPayments.paidOn,
        currency: supplierPayments.currency,
        amount: supplierPayments.amount,
        fxRate: supplierPayments.fxRate,
        method: supplierPayments.method,
        reference: supplierPayments.reference,
        partnerName: partners.legalNameEn,
      })
      .from(supplierPayments)
      .innerJoin(partners, eq(partners.id, supplierPayments.partnerId))
      .where(
        and(
          eq(supplierPayments.branchId, request.branchId),
          isNull(supplierPayments.accountingExportId),
          between(supplierPayments.paidOn, request.from, request.to),
        ),
      )
      .orderBy(asc(supplierPayments.paidOn))

    const supplierPaymentIds = supplierPaymentRows.map((p) => p.id)
    const supplierAllocationRows =
      supplierPaymentIds.length > 0
        ? await tx
            .select({
              supplierPaymentId: supplierPaymentAllocations.supplierPaymentId,
              amount: supplierPaymentAllocations.amount,
              reference: supplierInvoices.reference,
              billCurrency: supplierInvoices.currency,
              billRate: supplierInvoices.fxRate,
            })
            .from(supplierPaymentAllocations)
            .innerJoin(
              supplierInvoices,
              eq(supplierInvoices.id, supplierPaymentAllocations.supplierInvoiceId),
            )
            .where(inArray(supplierPaymentAllocations.supplierPaymentId, supplierPaymentIds))
        : []

    const supplierPaymentInputs: SupplierPaymentInput[] = supplierPaymentRows.map((row) => ({
      id: row.id,
      paidOn: new Date(row.paidOn),
      partnerName: row.partnerName,
      currency: row.currency,
      amount: row.amount,
      fxRate: row.fxRate,
      method: row.method,
      reference: row.reference,
      allocations: supplierAllocationRows
        .filter((a) => a.supplierPaymentId === row.id)
        .map((a) => ({
          supplierReference: a.reference,
          /*
            At the rate the *bill* posted at, not the payment's — this is what
            makes realised FX fall out of the entry. `Decimal`, never
            `Number`: multiplying two floats and stringifying is how an
            allocation of 123.45 posts as 123.45000000000002.
          */
          baseAmount:
            a.billCurrency === branch.baseCurrency
              ? a.amount
              : dec(a.amount).times(dec(a.billRate)).toFixed(),
        })),
    }))

    /*
      Agreed set-offs. `agreed` and not merely drafted: up to that point the
      figures still move as documents land in the period, and posting a draft
      would put a number in the ledger that the agent has not seen.
    */
    const settlementRows = await tx
      .select({
        id: partnerSettlements.id,
        reference: partnerSettlements.reference,
        agreedAt: partnerSettlements.agreedAt,
        currency: partnerSettlements.currency,
        fxRate: partnerSettlements.fxRate,
        offsetAmount: partnerSettlements.offsetAmount,
        partnerName: partners.legalNameEn,
      })
      .from(partnerSettlements)
      .innerJoin(partners, eq(partners.id, partnerSettlements.partnerId))
      .where(
        and(
          eq(partnerSettlements.branchId, request.branchId),
          isNull(partnerSettlements.accountingExportId),
          inArray(partnerSettlements.status, ['agreed', 'settled']),
          sql`${partnerSettlements.agreedAt}::date between ${request.from}::date and ${request.to}::date`,
        ),
      )
      .orderBy(asc(partnerSettlements.agreedAt))

    const settlementInputs: SettlementInput[] = settlementRows.map((row) => ({
      id: row.id,
      reference: row.reference,
      settledOn: row.agreedAt ?? new Date(request.from),
      partnerName: row.partnerName,
      currency: row.currency,
      fxRate: row.fxRate,
      offset: row.offsetAmount,
    }))

    return {
      branch,
      mappings,
      invoiceInputs,
      costInputs,
      paymentInputs,
      supplierInvoiceInputs,
      supplierPaymentInputs,
      settlementInputs,
    }
  })
}

export async function buildAccountingExport(
  actor: Actor,
  request: ExportRequest,
): Promise<ExportResult> {
  if (request.to < request.from) {
    throw new ExportError('period_reversed', 'The period ends before it starts')
  }

  const {
    branch,
    mappings,
    invoiceInputs,
    costInputs,
    paymentInputs,
    supplierInvoiceInputs,
    supplierPaymentInputs,
    settlementInputs,
  } = await collect(actor, request)

  /*
    The pre-flight, run before the engine throws on the first bad row.

    `buildJournal` refuses an unmapped charge type by design, and its message
    names one. A finance manager mapping a chart of accounts wants the whole
    list at once — otherwise closing a month is twelve rounds of fix-one,
    re-run.
  */
  const unmapped = unmappedChargeTypes({
    mappings,
    invoices: invoiceInputs,
    costs: costInputs,
    supplierInvoices: supplierInvoiceInputs,
  })

  if (unmapped.length > 0) {
    throw new ExportError(
      'unmapped_charge_types',
      `These charge types have no account against them: ${unmapped
        .map((m) => m.nameEn)
        .join(', ')}. Map them under Reference → Charge types and run the export again.`,
    )
  }

  const journal: Journal = buildJournal(
    {
      branchCode: branch.code,
      baseCurrency: branch.baseCurrency,
      controls: {
        receivables: branch.ar,
        payables: branch.ap,
        tax: branch.tax,
        inputTax: branch.inputTax,
        bank: branch.bank,
        fxVariance: branch.fx,
        rounding: branch.rounding,
      },
      mappings,
      invoices: invoiceInputs,
      costs: costInputs,
      payments: paymentInputs,
      supplierInvoices: supplierInvoiceInputs,
      supplierPayments: supplierPaymentInputs,
      settlements: settlementInputs,
    },
    spec(branch.baseCurrency),
  )

  const csv = toJournalCsv(journal, branch.baseCurrency)
  const bytes = Buffer.from(csv, 'utf8')
  const checksum = createHash('sha256').update(bytes).digest('hex')
  const filename = `journal-${branch.code}-${request.from}-to-${request.to}.csv`

  /*
    Stored for a draft as well as a posted export.

    A preview somebody downloaded and circulated is a file that exists in the
    world; being able to say which one it was is worth the object.
  */
  const storageKey = `accounting/${branch.code}/${request.from}-${request.to}-${checksum.slice(0, 12)}.csv`
  const stored = await (await fileStore()).put(storageKey, bytes, 'text/csv; charset=utf-8')

  return withActor(actor, async (tx) => {
    /*
      One asset per distinct file, and a draft may be built many times.

      The storage key carries the checksum, so re-running an unchanged period
      produces the same key — which is the point, the bytes are the same
      object. `assets.storage_key` is unique, though, so a plain insert made
      the second preview of an unmodified January fail on a constraint
      violation, in the one operation this module documents as safe to run
      twenty times. The row is reused instead, and both export rows point at
      it.
    */
    const [created] = await tx
      .insert(assets)
      .values({
        branchId: request.branchId,
        storageKey: stored.storageKey,
        fileName: filename,
        contentType: 'text/csv; charset=utf-8',
        byteSize: bytes.byteLength,
        checksum,
        uploadedById: actor.principalId,
        meta: { kind: 'accounting_export', from: request.from, to: request.to },
      })
      .onConflictDoNothing({ target: assets.storageKey })
      .returning({ id: assets.id })

    const [asset] = created
      ? [created]
      : await tx
          .select({ id: assets.id })
          .from(assets)
          .where(eq(assets.storageKey, stored.storageKey))
          .limit(1)

    if (!asset) {
      // The key is taken by a row in another branch, which means two branches
      // share a code — a configuration fault, not an export failure.
      throw new ExportError('asset_conflict', 'That export file belongs to another branch')
    }

    const posting = request.post === true
    const [row] = await tx
      .insert(accountingExports)
      .values({
        branchId: request.branchId,
        format: request.format ?? 'journal_csv',
        periodFrom: request.from,
        periodTo: request.to,
        assetId: asset!.id,
        rowCount: journal.lines.length,
        includedInvoiceIds: journal.invoiceIds as string[],
        includedPaymentIds: journal.paymentIds as string[],
        status: posting ? 'posted' : 'draft',
        postedAt: posting ? new Date() : null,
        postedById: posting ? actor.principalId : null,
        checksum,
        exportedById: actor.principalId,
      })
      .returning({ id: accountingExports.id })

    if (posting) {
      /*
        The same `is null` condition as the read, repeated in the write.

        Two people posting January at the same instant both selected the same
        invoices; only one of these updates matches a row, and the other marks
        nothing. Without the condition the second would silently re-point the
        invoices at its own export and the first month would post twice.
      */
      const exportId = row!.id
      if (journal.invoiceIds.length > 0) {
        await tx
          .update(invoices)
          .set({ accountingExportId: exportId, updatedAt: new Date() })
          .where(
            and(
              inArray(invoices.id, journal.invoiceIds as string[]),
              isNull(invoices.accountingExportId),
            ),
          )
      }
      if (costInputs.length > 0) {
        await tx
          .update(chargeLines)
          .set({ accountingExportId: exportId, updatedAt: new Date() })
          .where(
            and(
              inArray(
                chargeLines.id,
                costInputs.map((c) => c.id),
              ),
              isNull(chargeLines.accountingExportId),
            ),
          )
      }
      if (journal.paymentIds.length > 0) {
        await tx
          .update(payments)
          .set({ accountingExportId: exportId, updatedAt: new Date() })
          .where(
            and(
              inArray(payments.id, journal.paymentIds as string[]),
              isNull(payments.accountingExportId),
            ),
          )
      }
      /*
        The payables side is marked even where it posted nothing.

        A supplier bill that agrees with its accrual to the fils produces an
        empty entry — see `core/accounting.ts` — and it still belongs to this
        period. Leaving it unmarked would mean every subsequent export
        re-examines it for ever, and the day somebody unmatches a line the
        variance would post into whichever month happened to be open.
      */
      if (journal.supplierInvoiceIds.length > 0) {
        await tx
          .update(supplierInvoices)
          .set({ accountingExportId: exportId, updatedAt: new Date() })
          .where(
            and(
              inArray(supplierInvoices.id, journal.supplierInvoiceIds as string[]),
              isNull(supplierInvoices.accountingExportId),
            ),
          )
      }
      if (journal.supplierPaymentIds.length > 0) {
        await tx
          .update(supplierPayments)
          .set({ accountingExportId: exportId, updatedAt: new Date() })
          .where(
            and(
              inArray(supplierPayments.id, journal.supplierPaymentIds as string[]),
              isNull(supplierPayments.accountingExportId),
            ),
          )
      }
      if (journal.settlementIds.length > 0) {
        await tx
          .update(partnerSettlements)
          .set({ accountingExportId: exportId, updatedAt: new Date() })
          .where(
            and(
              inArray(partnerSettlements.id, journal.settlementIds as string[]),
              isNull(partnerSettlements.accountingExportId),
            ),
          )
      }
    }

    return {
      exportId: row!.id,
      status: posting ? ('posted' as const) : ('draft' as const),
      rowCount: journal.lines.length,
      totalDebit: journal.totalDebit.amount.toString(),
      totalCredit: journal.totalCredit.amount.toString(),
      invoiceCount: invoiceInputs.length,
      costCount: costInputs.length,
      paymentCount: paymentInputs.length,
      supplierInvoiceCount: supplierInvoiceInputs.length,
      supplierPaymentCount: supplierPaymentInputs.length,
      settlementCount: settlementInputs.length,
      csv,
      filename,
      assetId: asset!.id,
      checksum,
    }
  })
}

/**
 * Voiding — the only way a period becomes exportable again.
 *
 * Clears the marks it set and nothing else. The row stays, the file stays, and
 * the reason is required, because "why was March posted twice" is answered by
 * this row or by nobody.
 */
export async function voidAccountingExport(
  actor: Actor,
  exportId: string,
  reason: string,
): Promise<{ released: number }> {
  if (reason.trim() === '') {
    throw new ExportError('void_needs_reason', 'A void needs a reason')
  }

  return withActor(actor, async (tx) => {
    const [current] = await tx
      .select({ status: accountingExports.status })
      .from(accountingExports)
      .where(eq(accountingExports.id, exportId))
      .limit(1)

    if (!current) throw new ExportError('not_found', 'No such export, or it is not visible')
    if (current.status === 'void') {
      throw new ExportError('already_void', 'That export has already been voided')
    }

    const releasedInvoices = await tx
      .update(invoices)
      .set({ accountingExportId: null, updatedAt: new Date() })
      .where(eq(invoices.accountingExportId, exportId))
      .returning({ id: invoices.id })

    const releasedCosts = await tx
      .update(chargeLines)
      .set({ accountingExportId: null, updatedAt: new Date() })
      .where(eq(chargeLines.accountingExportId, exportId))
      .returning({ id: chargeLines.id })

    const releasedPayments = await tx
      .update(payments)
      .set({ accountingExportId: null, updatedAt: new Date() })
      .where(eq(payments.accountingExportId, exportId))
      .returning({ id: payments.id })

    const releasedBills = await tx
      .update(supplierInvoices)
      .set({ accountingExportId: null, updatedAt: new Date() })
      .where(eq(supplierInvoices.accountingExportId, exportId))
      .returning({ id: supplierInvoices.id })

    const releasedSupplierPayments = await tx
      .update(supplierPayments)
      .set({ accountingExportId: null, updatedAt: new Date() })
      .where(eq(supplierPayments.accountingExportId, exportId))
      .returning({ id: supplierPayments.id })

    const releasedSettlements = await tx
      .update(partnerSettlements)
      .set({ accountingExportId: null, updatedAt: new Date() })
      .where(eq(partnerSettlements.accountingExportId, exportId))
      .returning({ id: partnerSettlements.id })

    await tx
      .update(accountingExports)
      .set({
        status: 'void',
        postedAt: null,
        voidedAt: new Date(),
        voidedById: actor.principalId,
        voidReason: reason.trim(),
        updatedAt: new Date(),
      })
      .where(eq(accountingExports.id, exportId))

    return {
      released:
        releasedInvoices.length +
        releasedCosts.length +
        releasedPayments.length +
        releasedBills.length +
        releasedSupplierPayments.length +
        releasedSettlements.length,
    }
  })
}
