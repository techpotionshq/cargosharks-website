import 'server-only'

/**
 * Payables reads — the bill, the match, the account.
 *
 * Four screens come out of this file and they are one story: what a supplier
 * has asked for, whether it agrees with what the job accrued, what we still
 * owe them, and — for an agent we run a current account with — what is left
 * once their balance is netted against ours.
 *
 * ## Why the variance is computed in base currency
 *
 * A charge line carries the rate it was accrued at and a supplier invoice
 * carries the rate it was captured at, and the two are rarely the same day.
 * Comparing the transaction figures means picking one of those rates to
 * convert the other, which quietly turns an exchange movement into a
 * commercial variance — the operator queries a 3% overcharge that is really a
 * 3% currency move.
 *
 * Both rows already carry `amount_base` (FR-RT-06), fixed when each commitment
 * was made. Comparing those compares like with like, and it is the same pair
 * of figures the accounting export posts. The transaction amounts are still
 * shown beside them, because the argument with the agent is had in their
 * currency.
 *
 * As everywhere, no query carries a branch filter: `withActor` sets the
 * principal and RLS applies the scope (§5.3).
 */

import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  branches,
  chargeLines,
  chargeTypes,
  invoices,
  jobs,
  partners,
  partnerSettlementLines,
  partnerSettlements,
  settlementStatusEnum,
  supplierInvoiceLines,
  supplierInvoiceMatches,
  supplierInvoices,
  supplierInvoiceStatusEnum,
  supplierPayments,
  type Actor,
  withActor,
} from '@qabandi/db'
import { enumFilter, uuidFilter } from '@/lib/filters'
import {
  D,
  SEED_CURRENCIES,
  ageItems,
  buildStatement,
  compareToAccrual,
  netPosition,
  resolveTolerance,
  summariseInvoice,
  tolerance,
  type Ageing,
  type CurrencySpec,
  type InvoiceMatchSummary,
  type NetPosition,
  type Statement,
  type StatementEntry,
} from '@qabandi/core'
import { named } from '@/lib/named'
import { usePilotFixtures } from '@/lib/pilot/source'
import { countRows, pageOf, pageRequest, readPage, type Page, type PageRequest } from '@/lib/paging'
import {
  pilotPartnerAccount,
  pilotPayableAgeing,
  pilotPayableInvoices,
  pilotPayablesSummary,
  pilotSettleablePartners,
  pilotSettlement,
  pilotSettlements,
  pilotSupplierInvoice,
  pilotSupplierInvoices,
  pilotSupplierPayments,
} from '@/lib/pilot/fixtures'

const spec = (code: string): CurrencySpec =>
  SEED_CURRENCIES.find((c) => c.code === code) ?? { code, minorUnits: 2 }

// --- the list --------------------------------------------------------------

export interface SupplierInvoiceRow {
  readonly id: string
  readonly reference: string
  readonly partnerId: string
  readonly partnerName: string
  readonly status: string
  readonly currency: string
  readonly total: string
  readonly amountPaid: string
  readonly invoiceDate: string
  readonly dueOn: string | null
  readonly baseCurrency: string
  /** Billed minus accrued, in base currency. Positive means they billed over. */
  readonly varianceBase: string
  readonly lineCount: number
  readonly unmatchedCount: number
}

/** `locale` names the partner in the reader's language (F27). */
export async function listSupplierInvoices(
  actor: Actor,
  filters: { readonly status?: string; readonly partnerId?: string } = {},
  locale: 'en' | 'ar' = 'en',
  request: PageRequest = pageRequest(undefined),
): Promise<Page<SupplierInvoiceRow>> {
  /*
    Narrowed before the fixtures branch, not after.

    Both modes must answer an unknown filter the same way. Narrowing only on
    the database path would leave `?status=xyz` returning the empty set offline
    and the whole register against Postgres — the fixtures-versus-database
    divergence that already cost this repository a screen nobody had tested.
  */
  const status = enumFilter(supplierInvoiceStatusEnum.enumValues, filters.status)
  const partnerId = uuidFilter(filters.partnerId)

  if (usePilotFixtures()) {
    return pageOf(pilotSupplierInvoices(Date.now(), { status, partnerId }, locale), request)
  }

  const where = and(
    status ? eq(supplierInvoices.status, status) : sql`${supplierInvoices.status} <> 'void'`,
    partnerId ? eq(supplierInvoices.partnerId, partnerId) : undefined,
  )
  // Paged with a count where this was `limit(200)` (the audit after live run 5).
  return withActor(actor, (tx) =>
    readPage(
      request,
      async (limit, offset) => {
        const rows = await tx
          .select({
            id: supplierInvoices.id,
            reference: supplierInvoices.reference,
            partnerId: supplierInvoices.partnerId,
            partnerName: named(locale, partners.legalNameEn, partners.legalNameAr),
            status: supplierInvoices.status,
            currency: supplierInvoices.currency,
            total: supplierInvoices.total,
            amountPaid: supplierInvoices.amountPaid,
            invoiceDate: supplierInvoices.invoiceDate,
            dueOn: supplierInvoices.dueOn,
            baseCurrency: branches.baseCurrency,
            /*
          The variance, in one scalar, so the list can be scanned for trouble.

          Written as explicit qualified SQL rather than interpolating the
          Drizzle column — `check-boundaries.mjs` rule 3: an interpolated
          `${supplierInvoices.id}` emits a bare `"id"` here and binds to the
          inner table instead of the outer one.
        */
            /*
          The subtraction happens *inside* the sum, and it has to.

          Written the other way round — `sum(billed) - (select … where
          m2.supplier_invoice_line_id = l.id)` — the correlated subquery
          references `l.id` outside any aggregate in a query that has no
          `group by`, and PostgreSQL rejects the whole statement with 42803.
          Not for some rows: for every one, so the payables register raised on
          each load rather than rendering a wrong number.

          Per line, billed minus matched, then summed is also the figure that
          is wanted: the variance on a bill is the sum of the variances on its
          lines.
        */
            varianceBase: sql<string>`(
          select coalesce(sum(
            l.amount * "supplier_invoices"."fx_rate"
            - coalesce((
                select sum(cl.amount_base)
                  from supplier_invoice_matches m2
                  join charge_lines cl on cl.id = m2.charge_line_id
                 where m2.supplier_invoice_line_id = l.id
                   and m2.retracted_at is null
              ), 0)
          ), 0)::text
            from supplier_invoice_lines l
           where l.supplier_invoice_id = "supplier_invoices"."id"
        )`,
            lineCount: sql<number>`(
          select count(*)::int from supplier_invoice_lines l
           where l.supplier_invoice_id = "supplier_invoices"."id"
        )`,
            unmatchedCount: sql<number>`(
          select count(*)::int from supplier_invoice_lines l
           where l.supplier_invoice_id = "supplier_invoices"."id"
             and not exists (
               select 1 from supplier_invoice_matches m
                where m.supplier_invoice_line_id = l.id and m.retracted_at is null
             )
        )`,
          })
          .from(supplierInvoices)
          .innerJoin(partners, eq(partners.id, supplierInvoices.partnerId))
          .innerJoin(branches, eq(branches.id, supplierInvoices.branchId))
          .where(where)
          .orderBy(
            desc(supplierInvoices.invoiceDate),
            desc(supplierInvoices.createdAt),
            desc(supplierInvoices.id),
          )
          .limit(limit)
          .offset(offset)

        return rows as SupplierInvoiceRow[]
      },
      () => countRows(tx, supplierInvoices, where),
    ),
  )
}

export interface PayablesSummary {
  readonly outstanding: number
  readonly overdue: number
  readonly awaitingApproval: number
  readonly inDispute: number
  readonly needingReview: number
}

/**
 * The five counts the payables board leads with.
 *
 * `needingReview` is the one that earns its place: bills whose lines disagree
 * with the accrual by more than the configured tolerance. It is the queue this
 * whole feature exists to produce, and putting it anywhere but the top of the
 * screen would mean it is looked at monthly rather than daily.
 */
export async function payablesSummary(actor: Actor): Promise<PayablesSummary> {
  if (usePilotFixtures()) return pilotPayablesSummary()

  return withActor(actor, async (tx) => {
    const result = await tx.execute(sql`
      select
        count(*) filter (
          where status in ('received', 'approved', 'part_paid')
        )::int as outstanding,
        count(*) filter (
          where status in ('received', 'approved', 'part_paid')
            and due_on is not null and due_on < current_date
        )::int as overdue,
        count(*) filter (where status = 'received')::int  as awaiting_approval,
        count(*) filter (where status = 'disputed')::int  as in_dispute,
        count(*) filter (
          where status in ('received', 'approved')
            and exists (
              select 1
                from supplier_invoice_lines l
               where l.supplier_invoice_id = supplier_invoices.id
                 and abs(
                   l.amount * supplier_invoices.fx_rate
                   - coalesce((
                       select sum(cl.amount_base)
                         from supplier_invoice_matches m
                         join charge_lines cl on cl.id = m.charge_line_id
                        where m.supplier_invoice_line_id = l.id
                          and m.retracted_at is null
                     ), 0)
                 ) > 0
            )
        )::int as needing_review
      from supplier_invoices
    `)

    const row = result.rows[0] as Record<string, number> | undefined
    return {
      outstanding: Number(row?.outstanding ?? 0),
      overdue: Number(row?.overdue ?? 0),
      awaitingApproval: Number(row?.awaiting_approval ?? 0),
      inDispute: Number(row?.in_dispute ?? 0),
      needingReview: Number(row?.needing_review ?? 0),
    }
  })
}

/** FR-FN-10's buckets, on the side that pays rather than the side that bills. */
export async function payablesAgeing(
  actor: Actor,
  asOf = new Date(),
): Promise<{
  readonly byCurrency: readonly { readonly currency: string; readonly ageing: Ageing }[]
}> {
  /*
    The fixture stops at the items and `ageItems` still runs, exactly as it
    does below. The bucketing is the part a finance manager is being shown, so
    a demo path that returned a pre-computed `Ageing` would be demonstrating
    arithmetic the product does not run.

    The seeds are cut from `asOf` rather than from now, so asking for the
    ageing at a past date moves the due dates with it instead of reporting
    today's buckets under yesterday's heading.
  */
  if (usePilotFixtures()) {
    return {
      byCurrency: [
        { currency: 'KWD', ageing: ageItems(pilotPayableAgeing(asOf.getTime()), 'KWD', asOf) },
      ],
    }
  }

  return withActor(actor, async (tx) => {
    /*
      One ageing per base currency, each bill in its own branch's base.

      It took the base of whichever branch came back first and aged every
      visible bill in it — a DXB bill converted to dirhams counted as dinars
      for a principal who sees both branches.
    */
    const rows = await tx
      .select({
        outstanding: sql<string>`(
          ("supplier_invoices"."total" - "supplier_invoices"."amount_paid")
          * "supplier_invoices"."fx_rate"
        )::text`,
        dueOn: supplierInvoices.dueOn,
        base: branches.baseCurrency,
      })
      .from(supplierInvoices)
      .innerJoin(branches, eq(branches.id, supplierInvoices.branchId))
      .where(inArray(supplierInvoices.status, ['received', 'approved', 'part_paid']))

    const bases = [...new Set(rows.map((r) => r.base))].sort()
    return {
      byCurrency: bases.map((base) => ({
        currency: base,
        ageing: ageItems(
          rows
            .filter((r) => r.base === base)
            .map((r) => ({
              outstanding: r.outstanding,
              dueOn: r.dueOn ? new Date(r.dueOn) : null,
            })),
          base,
          asOf,
        ),
      })),
    }
  })
}

// --- one bill, and the argument about it -----------------------------------

interface SupplierMatchRow {
  readonly id: string
  readonly chargeLineId: string
  readonly jobId: string
  readonly jobReference: string
  readonly chargeTypeName: string
  readonly claimed: string
  /** The accrual this match covers, in base currency. */
  readonly accruedBase: string
  readonly accruedAmount: string
  readonly accruedCurrency: string
}

interface SupplierLineRow {
  readonly id: string
  readonly description: string
  readonly chargeTypeId: string | null
  readonly chargeTypeName: string | null
  readonly jobId: string | null
  readonly jobReference: string | null
  readonly quantity: string
  readonly unitPrice: string
  readonly amount: string
  readonly taxAmount: string
  readonly billedBase: string
  readonly accruedBase: string
  readonly matches: readonly SupplierMatchRow[]
  readonly verdict: string
  readonly varianceBase: string
  readonly variancePercent: string | null
  readonly allowedBase: string
  readonly needsReview: boolean
}

export interface SupplierInvoiceDetail {
  readonly id: string
  readonly reference: string
  readonly branchId: string
  readonly partnerId: string
  readonly partnerName: string
  readonly status: string
  readonly currency: string
  readonly baseCurrency: string
  readonly subtotal: string
  readonly taxAmount: string
  readonly total: string
  readonly amountPaid: string
  readonly fxRate: string
  readonly invoiceDate: string
  readonly dueOn: string | null
  readonly assetId: string | null
  readonly varianceAcceptedReason: string | null
  readonly disputeReason: string | null
  readonly notes: string | null
  readonly approvedAt: Date | null
  readonly settlementId: string | null
  readonly lines: readonly SupplierLineRow[]
  readonly summary: InvoiceMatchSummary
}

/** `locale` names the partner and the charge types in the reader's language (F27). */
export async function getSupplierInvoice(
  actor: Actor,
  id: string,
  locale: 'en' | 'ar' = 'en',
): Promise<SupplierInvoiceDetail | undefined> {
  /*
    The fixture stops at the three selects, and `compareToAccrual` and
    `summariseInvoice` still run over them — see `composeSupplierInvoice`. The
    verdict on a line is the whole content of this screen, so a demo path that
    stated one would be showing a judgement the product did not make.
  */
  if (usePilotFixtures()) {
    const rows = pilotSupplierInvoice(id, Date.now(), locale)
    return rows === undefined
      ? undefined
      : composeSupplierInvoice(rows.bill, rows.lines, rows.matches)
  }

  return withActor(actor, async (tx) => {
    const [bill] = await tx
      .select({
        id: supplierInvoices.id,
        reference: supplierInvoices.reference,
        branchId: supplierInvoices.branchId,
        partnerId: supplierInvoices.partnerId,
        partnerName: named(locale, partners.legalNameEn, partners.legalNameAr),
        partnerTolerancePercent: partners.varianceTolerancePercent,
        partnerToleranceAbsolute: partners.varianceToleranceAbsolute,
        status: supplierInvoices.status,
        currency: supplierInvoices.currency,
        baseCurrency: branches.baseCurrency,
        subtotal: supplierInvoices.subtotal,
        taxAmount: supplierInvoices.taxAmount,
        total: supplierInvoices.total,
        amountPaid: supplierInvoices.amountPaid,
        fxRate: supplierInvoices.fxRate,
        invoiceDate: supplierInvoices.invoiceDate,
        dueOn: supplierInvoices.dueOn,
        assetId: supplierInvoices.assetId,
        varianceAcceptedReason: supplierInvoices.varianceAcceptedReason,
        disputeReason: supplierInvoices.disputeReason,
        notes: supplierInvoices.notes,
        approvedAt: supplierInvoices.approvedAt,
        settlementId: supplierInvoices.settlementId,
      })
      .from(supplierInvoices)
      .innerJoin(partners, eq(partners.id, supplierInvoices.partnerId))
      .innerJoin(branches, eq(branches.id, supplierInvoices.branchId))
      .where(eq(supplierInvoices.id, id))
      .limit(1)

    if (!bill) return undefined

    const lineRows = await tx
      .select({
        id: supplierInvoiceLines.id,
        description: supplierInvoiceLines.description,
        chargeTypeId: supplierInvoiceLines.chargeTypeId,
        chargeTypeName: named(locale, chargeTypes.nameEn, chargeTypes.nameAr),
        tolerancePercent: chargeTypes.varianceTolerancePercent,
        toleranceAbsolute: chargeTypes.varianceToleranceAbsolute,
        jobId: supplierInvoiceLines.jobId,
        jobReference: jobs.reference,
        quantity: supplierInvoiceLines.quantity,
        unitPrice: supplierInvoiceLines.unitPrice,
        amount: supplierInvoiceLines.amount,
        taxAmount: supplierInvoiceLines.taxAmount,
      })
      .from(supplierInvoiceLines)
      .leftJoin(chargeTypes, eq(chargeTypes.id, supplierInvoiceLines.chargeTypeId))
      .leftJoin(jobs, eq(jobs.id, supplierInvoiceLines.jobId))
      .where(eq(supplierInvoiceLines.supplierInvoiceId, id))
      .orderBy(asc(supplierInvoiceLines.sortOrder), asc(supplierInvoiceLines.createdAt))

    const lineIds = lineRows.map((l) => l.id)
    const matchRows =
      lineIds.length === 0
        ? []
        : await tx
            .select({
              id: supplierInvoiceMatches.id,
              lineId: supplierInvoiceMatches.supplierInvoiceLineId,
              chargeLineId: supplierInvoiceMatches.chargeLineId,
              claimed: supplierInvoiceMatches.amount,
              jobId: chargeLines.jobId,
              jobReference: jobs.reference,
              chargeTypeName: named(locale, chargeTypes.nameEn, chargeTypes.nameAr),
              accruedBase: chargeLines.amountBase,
              accruedAmount: chargeLines.amount,
              accruedCurrency: chargeLines.currency,
            })
            .from(supplierInvoiceMatches)
            .innerJoin(chargeLines, eq(chargeLines.id, supplierInvoiceMatches.chargeLineId))
            .innerJoin(jobs, eq(jobs.id, chargeLines.jobId))
            .innerJoin(chargeTypes, eq(chargeTypes.id, chargeLines.chargeTypeId))
            .where(
              and(
                inArray(supplierInvoiceMatches.supplierInvoiceLineId, lineIds),
                isNull(supplierInvoiceMatches.retractedAt),
              ),
            )

    return composeSupplierInvoice(bill, lineRows, matchRows)
  })
}

/**
 * The bill, its lines and its matches, judged — and the one place that happens.
 *
 * Extracted so the fixture path runs it too. Every figure below is reached by
 * `compareToAccrual` and `summariseInvoice`; nothing here decides a verdict or
 * a variance, which is what keeps the offline demo and a deployment against a
 * real database answering the same question the same way.
 */
function composeSupplierInvoice(
  bill: SupplierBillHeader,
  lineRows: readonly SupplierBillLine[],
  matchRows: readonly SupplierBillMatch[],
): SupplierInvoiceDetail {
  const baseSpec = spec(bill.baseCurrency)
  const partnerTolerance = tolerance(bill.partnerTolerancePercent, bill.partnerToleranceAbsolute)

  const lines: SupplierLineRow[] = lineRows.map((line) => {
    const matches = matchRows
      .filter((m) => m.lineId === line.id)
      .map((m): SupplierMatchRow => ({
        id: m.id,
        chargeLineId: m.chargeLineId,
        jobId: m.jobId,
        jobReference: m.jobReference,
        chargeTypeName: m.chargeTypeName,
        claimed: m.claimed,
        accruedBase: m.accruedBase,
        accruedAmount: m.accruedAmount,
        accruedCurrency: m.accruedCurrency,
      }))

    /*
      Both sides in base currency — see the header. `numeric` strings are
      multiplied by `Decimal` inside `core`, never here, and never by
      `Number`.
    */
    const billedBase = decimalTimes(line.amount, bill.fxRate)
    const accruedBase = sumStrings(matches.map((m) => m.accruedBase))

    const tol = resolveTolerance(
      tolerance(line.tolerancePercent, line.toleranceAbsolute),
      partnerTolerance,
    )
    const outcome = compareToAccrual(
      { amount: toDecimal(accruedBase), currency: bill.baseCurrency },
      { amount: toDecimal(billedBase), currency: bill.baseCurrency },
      tol,
      baseSpec,
    )

    return {
      id: line.id,
      description: line.description,
      chargeTypeId: line.chargeTypeId,
      chargeTypeName: line.chargeTypeName,
      jobId: line.jobId,
      jobReference: line.jobReference,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      amount: line.amount,
      taxAmount: line.taxAmount,
      billedBase,
      accruedBase,
      matches,
      verdict: outcome.verdict,
      varianceBase: outcome.variance.amount.toString(),
      variancePercent: outcome.variancePercent?.toString() ?? null,
      allowedBase: outcome.allowed.amount.toString(),
      needsReview: outcome.needsReview,
    }
  })

  return {
    ...bill,
    lines,
    summary: summariseInvoice(
      lines.map((l) => ({
        id: l.id,
        description: l.description,
        billed: l.billedBase,
        accrued: l.accruedBase,
        matchCount: l.matches.length,
        /*
          The allowance is re-expressed as an absolute limit rather than
          recomputed. `compareToAccrual` has already resolved partner over
          charge type for this line, and handing `summariseInvoice` the
          resolved figure is what keeps the totals row and the line rows
          agreeing about which lines are in trouble.
        */
        tolerance: tolerance('0', l.allowedBase),
      })),
      bill.baseCurrency,
      baseSpec,
    ),
  }
}

/*
  The three row shapes `composeSupplierInvoice` takes.

  Written out rather than inferred from the selects above because the fixture
  builds them too, and a structural type inferred from a Drizzle query is not
  something another module can state. The tolerance columns are inputs to
  `resolveTolerance` and not part of `SupplierInvoiceDetail`; the rest of the
  header is spread into the return unchanged.
*/
type SupplierBillHeader = Omit<SupplierInvoiceDetail, 'lines' | 'summary'> & {
  readonly partnerTolerancePercent: string | null
  readonly partnerToleranceAbsolute: string | null
}

interface SupplierBillLine {
  readonly id: string
  readonly description: string
  readonly chargeTypeId: string | null
  readonly chargeTypeName: string | null
  readonly tolerancePercent: string | null
  readonly toleranceAbsolute: string | null
  readonly jobId: string | null
  readonly jobReference: string | null
  readonly quantity: string
  readonly unitPrice: string
  readonly amount: string
  readonly taxAmount: string
}

interface SupplierBillMatch {
  readonly id: string
  readonly lineId: string
  readonly chargeLineId: string
  readonly claimed: string
  readonly jobId: string
  readonly jobReference: string
  readonly chargeTypeName: string
  readonly accruedBase: string
  readonly accruedAmount: string
  readonly accruedCurrency: string
}

// --- payments --------------------------------------------------------------

export interface SupplierPaymentRow {
  readonly id: string
  readonly partnerId: string
  readonly partnerName: string
  readonly amount: string
  readonly currency: string
  readonly paidOn: string
  readonly method: string
  readonly reference: string | null
  readonly allocated: string
}

/** `locale` names the partner in the reader's language (F27). */
export async function listSupplierPayments(
  actor: Actor,
  locale: 'en' | 'ar' = 'en',
  /*
    `withBalanceOnly` is the payables board's "not yet put against a bill"
    list. The board fetched the newest two hundred payments and kept those
    with a balance, so an advance paid before the two-hundredth most recent
    payment could never be allocated from it. In the `where` now, and paged.
  */
  filters: { readonly withBalanceOnly?: boolean } = {},
  request: PageRequest = pageRequest(undefined),
): Promise<Page<SupplierPaymentRow>> {
  if (usePilotFixtures()) {
    const rows = pilotSupplierPayments(Date.now(), locale)
    return pageOf(
      filters.withBalanceOnly
        ? rows.filter((row) => new D(row.amount).minus(row.allocated).gt(0))
        : rows,
      request,
    )
  }

  const where = filters.withBalanceOnly
    ? sql`${supplierPayments.amount} > (
        select coalesce(sum(a.amount), 0) from supplier_payment_allocations a
         where a.supplier_payment_id = "supplier_payments"."id"
      )`
    : undefined
  return withActor(actor, (tx) =>
    readPage(
      request,
      async (limit, offset) => {
        const rows = await tx
          .select({
            id: supplierPayments.id,
            partnerId: supplierPayments.partnerId,
            partnerName: named(locale, partners.legalNameEn, partners.legalNameAr),
            amount: supplierPayments.amount,
            currency: supplierPayments.currency,
            paidOn: supplierPayments.paidOn,
            method: supplierPayments.method,
            reference: supplierPayments.reference,
            allocated: sql<string>`(
          select coalesce(sum(a.amount), 0)::text
            from supplier_payment_allocations a
           where a.supplier_payment_id = "supplier_payments"."id"
        )`,
          })
          .from(supplierPayments)
          .innerJoin(partners, eq(partners.id, supplierPayments.partnerId))
          .where(where)
          .orderBy(
            desc(supplierPayments.paidOn),
            desc(supplierPayments.createdAt),
            desc(supplierPayments.id),
          )
          .limit(limit)
          .offset(offset)

        return rows as SupplierPaymentRow[]
      },
      () => countRows(tx, supplierPayments, where),
    ),
  )
}

/** Bills of that partner with something still open, for the allocation form. */
export async function listPayableInvoices(
  actor: Actor,
  partnerId: string,
): Promise<{ readonly id: string; readonly reference: string; readonly outstanding: string }[]> {
  if (usePilotFixtures()) return pilotPayableInvoices(partnerId)

  return withActor(actor, async (tx) =>
    tx
      .select({
        id: supplierInvoices.id,
        reference: supplierInvoices.reference,
        outstanding: sql<string>`(
          "supplier_invoices"."total" - "supplier_invoices"."amount_paid"
        )::text`,
      })
      .from(supplierInvoices)
      .where(
        and(
          eq(supplierInvoices.partnerId, partnerId),
          inArray(supplierInvoices.status, ['approved', 'part_paid']),
          sql`${supplierInvoices.total} > ${supplierInvoices.amountPaid}`,
        ),
      )
      .orderBy(asc(supplierInvoices.dueOn), asc(supplierInvoices.invoiceDate)),
  )
}

// --- the agent current account ---------------------------------------------

export interface PartnerAccount {
  readonly partnerId: string
  readonly partnerName: string
  readonly currency: string
  /** Null where the partner is not also a customer — no account to run. */
  readonly customerId: string | null
  readonly statement: Statement
  readonly net: NetPosition
  readonly receivableAgeing: Ageing
  readonly payableAgeing: Ageing
}

/**
 * One partner's account, both directions, in the settlement currency.
 *
 * Two ledgers held apart are a spreadsheet emailed back and forth; this is the
 * screen that ends that. Documents already claimed by a settlement are
 * excluded — they have been dealt with, and showing them again is how the same
 * invoice gets netted twice.
 */
export async function getPartnerAccount(
  actor: Actor,
  partnerId: string,
  asOf = new Date(),
  // Names the partner in the reader's language (F27).
  locale: 'en' | 'ar' = 'en',
): Promise<PartnerAccount | undefined> {
  /*
    The fixture stops at the entries. `buildStatement`, `netPosition` and
    `ageItems` all still run over them in `accountOf` below — the netting is
    the argument this card makes, and a fixture that arrived with a residual
    already computed would be making it on the product's behalf.
  */
  if (usePilotFixtures()) {
    const rows = pilotPartnerAccount(partnerId, Date.now(), locale)
    return rows === undefined
      ? undefined
      : accountOf(
          rows.partnerId,
          rows.partnerName,
          rows.customerId,
          rows.currency,
          rows.entries,
          asOf,
        )
  }

  return withActor(actor, async (tx) => {
    const [partner] = await tx
      .select({
        id: partners.id,
        name: named(locale, partners.legalNameEn, partners.legalNameAr),
        customerId: partners.settlementCustomerId,
        settlementCurrency: partners.settlementCurrency,
        currency: partners.currency,
      })
      .from(partners)
      .where(eq(partners.id, partnerId))
      .limit(1)

    if (!partner) return undefined

    const currency = partner.settlementCurrency ?? partner.currency ?? 'KWD'

    const bills = await tx
      .select({
        id: supplierInvoices.id,
        reference: supplierInvoices.reference,
        date: supplierInvoices.invoiceDate,
        dueOn: supplierInvoices.dueOn,
        total: supplierInvoices.total,
        amountPaid: supplierInvoices.amountPaid,
      })
      .from(supplierInvoices)
      .where(
        and(
          eq(supplierInvoices.partnerId, partnerId),
          eq(supplierInvoices.currency, currency),
          isNull(supplierInvoices.settlementId),
          inArray(supplierInvoices.status, ['received', 'approved', 'part_paid', 'disputed']),
        ),
      )
      .orderBy(asc(supplierInvoices.invoiceDate))

    /*
      The receivable side exists only where somebody has said the agent is also
      a customer of ours. Guessing at it — matching on name, or on country —
      would eventually net a settlement against a different company with a
      similar name, and that is not a mistake anybody discovers quickly.
    */
    const ours = partner.customerId
      ? await tx
          .select({
            id: invoices.id,
            reference: invoices.seriesNo,
            date: invoices.issuedAt,
            dueOn: invoices.dueOn,
            total: invoices.total,
            amountPaid: invoices.amountPaid,
            amountCredited: invoices.amountCredited,
            isCreditNote: invoices.isCreditNote,
          })
          .from(invoices)
          .where(
            and(
              eq(invoices.customerId, partner.customerId),
              eq(invoices.currency, currency),
              inArray(invoices.status, ['issued', 'part_paid', 'credited']),
              sql`not exists (
                select 1 from partner_settlement_lines sl
                 where sl.invoice_id = "invoices"."id"
              )`,
            ),
          )
          .orderBy(asc(invoices.issuedAt))
      : []

    const entries: StatementEntry[] = [
      ...ours.map((i): StatementEntry => ({
        id: i.id,
        kind: i.isCreditNote ? 'credit_note' : 'invoice',
        date: i.date ?? new Date(),
        reference: i.reference ?? i.id.slice(0, 8),
        description: i.isCreditNote ? 'Credit note' : 'Invoice',
        amount: i.total,
        // Less partial credit notes (F9); a note itself is born settled.
        outstanding: subtractStrings(subtractStrings(i.total, i.amountPaid), i.amountCredited),
        dueOn: i.dueOn ? new Date(i.dueOn) : null,
      })),
      ...bills.map((b): StatementEntry => ({
        id: b.id,
        kind: 'bill',
        date: new Date(b.date),
        reference: b.reference,
        description: 'Supplier invoice',
        amount: b.total,
        outstanding: subtractStrings(b.total, b.amountPaid),
        dueOn: b.dueOn ? new Date(b.dueOn) : null,
      })),
    ]

    return accountOf(partner.id, partner.name, partner.customerId, currency, entries, asOf)
  })
}

/**
 * The statement, the net position and both ageings — the one place they are
 * computed, so the fixture path computes them the same way.
 *
 * The two ageings are drawn from the *entries* rather than from the statement
 * lines, and the difference matters: a statement line carries a running
 * balance, and bucketing balances rather than open amounts would age the
 * relationship instead of the documents.
 */
function accountOf(
  partnerId: string,
  partnerName: string,
  customerId: string | null,
  currency: string,
  entries: readonly StatementEntry[],
  asOf: Date,
): PartnerAccount {
  const statement = buildStatement(entries, currency)

  const ageingOf = (kind: StatementEntry['kind']): Ageing =>
    ageItems(
      entries
        .filter((e) => e.kind === kind)
        .map((e) => ({ outstanding: e.outstanding ?? e.amount, dueOn: e.dueOn })),
      currency,
      asOf,
    )

  return {
    partnerId,
    partnerName,
    currency,
    customerId,
    statement,
    net: netPosition(statement.receivable, statement.payable, currency),
    receivableAgeing: ageingOf('invoice'),
    payableAgeing: ageingOf('bill'),
  }
}

export interface SettlementRow {
  readonly id: string
  readonly reference: string
  readonly partnerId: string
  readonly partnerName: string
  readonly status: string
  readonly currency: string
  readonly periodFrom: string
  readonly periodTo: string
  readonly receivableTotal: string
  readonly payableTotal: string
  readonly offsetAmount: string
  readonly residualAmount: string
  readonly residualDirection: string
  readonly agreedAt: Date | null
  readonly settledAt: Date | null
}

/** `locale` names the partner in the reader's language (F27). */
export async function listSettlements(
  actor: Actor,
  filters: { readonly partnerId?: string; readonly status?: string } = {},
  locale: 'en' | 'ar' = 'en',
  request: PageRequest = pageRequest(undefined),
): Promise<Page<SettlementRow>> {
  const status = enumFilter(settlementStatusEnum.enumValues, filters.status)
  const partnerId = uuidFilter(filters.partnerId)

  if (usePilotFixtures()) {
    return pageOf(pilotSettlements(Date.now(), { status, partnerId }, locale), request)
  }

  const where = and(
    partnerId ? eq(partnerSettlements.partnerId, partnerId) : undefined,
    status ? eq(partnerSettlements.status, status) : sql`${partnerSettlements.status} <> 'void'`,
  )
  // Paged with a count where this was `limit(200)` (the audit after live run 5).
  return withActor(actor, (tx) =>
    readPage(
      request,
      async (limit, offset) => {
        const rows = await tx
          .select({
            id: partnerSettlements.id,
            reference: partnerSettlements.reference,
            partnerId: partnerSettlements.partnerId,
            partnerName: named(locale, partners.legalNameEn, partners.legalNameAr),
            status: partnerSettlements.status,
            currency: partnerSettlements.currency,
            periodFrom: partnerSettlements.periodFrom,
            periodTo: partnerSettlements.periodTo,
            receivableTotal: partnerSettlements.receivableTotal,
            payableTotal: partnerSettlements.payableTotal,
            offsetAmount: partnerSettlements.offsetAmount,
            residualAmount: partnerSettlements.residualAmount,
            residualDirection: partnerSettlements.residualDirection,
            agreedAt: partnerSettlements.agreedAt,
            settledAt: partnerSettlements.settledAt,
          })
          .from(partnerSettlements)
          .innerJoin(partners, eq(partners.id, partnerSettlements.partnerId))
          .where(where)
          .orderBy(
            desc(partnerSettlements.periodTo),
            desc(partnerSettlements.createdAt),
            desc(partnerSettlements.id),
          )
          .limit(limit)
          .offset(offset)

        return rows as SettlementRow[]
      },
      () => countRows(tx, partnerSettlements, where),
    ),
  )
}

export interface SettlementLineRow {
  readonly id: string
  readonly kind: 'invoice' | 'bill'
  readonly reference: string
  readonly amount: string
  readonly isFull: boolean
  readonly documentId: string
}

export interface SettlementDetail extends SettlementRow {
  readonly branchId: string
  readonly notes: string | null
  readonly voidReason: string | null
  readonly lines: readonly SettlementLineRow[]
}

/** `locale` names the partner in the reader's language (F27). */
export async function getSettlement(
  actor: Actor,
  id: string,
  locale: 'en' | 'ar' = 'en',
): Promise<SettlementDetail | undefined> {
  /*
    No core call behind this one: `settlement.ts` did its arithmetic when the
    statement was drawn and the row carries the answer, so the fixture returns
    the finished shape. Every figure on it comes from the same builder the
    register row came from, which is what stops the header of this page
    disagreeing with the row the reader clicked a second ago.
  */
  if (usePilotFixtures()) return pilotSettlement(id, Date.now(), locale)

  return withActor(actor, async (tx) => {
    const [row] = await tx
      .select({
        id: partnerSettlements.id,
        reference: partnerSettlements.reference,
        branchId: partnerSettlements.branchId,
        partnerId: partnerSettlements.partnerId,
        partnerName: named(locale, partners.legalNameEn, partners.legalNameAr),
        status: partnerSettlements.status,
        currency: partnerSettlements.currency,
        periodFrom: partnerSettlements.periodFrom,
        periodTo: partnerSettlements.periodTo,
        receivableTotal: partnerSettlements.receivableTotal,
        payableTotal: partnerSettlements.payableTotal,
        offsetAmount: partnerSettlements.offsetAmount,
        residualAmount: partnerSettlements.residualAmount,
        residualDirection: partnerSettlements.residualDirection,
        agreedAt: partnerSettlements.agreedAt,
        settledAt: partnerSettlements.settledAt,
        notes: partnerSettlements.notes,
        voidReason: partnerSettlements.voidReason,
      })
      .from(partnerSettlements)
      .innerJoin(partners, eq(partners.id, partnerSettlements.partnerId))
      .where(eq(partnerSettlements.id, id))
      .limit(1)

    if (!row) return undefined

    const lines = await tx
      .select({
        id: partnerSettlementLines.id,
        kind: partnerSettlementLines.kind,
        amount: partnerSettlementLines.amount,
        isFull: partnerSettlementLines.isFull,
        invoiceId: partnerSettlementLines.invoiceId,
        supplierInvoiceId: partnerSettlementLines.supplierInvoiceId,
        invoiceReference: invoices.seriesNo,
        billReference: supplierInvoices.reference,
      })
      .from(partnerSettlementLines)
      .leftJoin(invoices, eq(invoices.id, partnerSettlementLines.invoiceId))
      .leftJoin(supplierInvoices, eq(supplierInvoices.id, partnerSettlementLines.supplierInvoiceId))
      .where(eq(partnerSettlementLines.settlementId, id))
      .orderBy(asc(partnerSettlementLines.kind))

    return {
      ...row,
      lines: lines.map((l): SettlementLineRow => ({
        id: l.id,
        kind: l.kind,
        reference: (l.kind === 'invoice' ? l.invoiceReference : l.billReference) ?? '—',
        amount: l.amount,
        isFull: l.isFull,
        documentId: (l.kind === 'invoice' ? l.invoiceId : l.supplierInvoiceId) ?? '',
      })),
    }
  })
}

/** Partners with a current account configured — the ones a set-off can run for. */
/** `locale` names, and orders, the partners in the reader's language (F27). */
export async function listSettleablePartners(
  actor: Actor,
  locale: 'en' | 'ar' = 'en',
): Promise<{ readonly id: string; readonly name: string; readonly currency: string }[]> {
  if (usePilotFixtures()) return pilotSettleablePartners(locale)

  const name = named(locale, partners.legalNameEn, partners.legalNameAr)
  return withActor(actor, async (tx) =>
    tx
      .select({
        id: partners.id,
        name,
        currency: sql<string>`coalesce(
          "partners"."settlement_currency", "partners"."currency", 'KWD'
        )`,
      })
      .from(partners)
      .where(and(eq(partners.isActive, true), sql`${partners.settlementCustomerId} is not null`))
      .orderBy(asc(name)),
  )
}

// --- decimal helpers -------------------------------------------------------

/*
  Four one-line wrappers over `Decimal`, and they exist so that no caller in
  this file is tempted to write `Number(a) * Number(b)`.

  Every one of these operates on the string form `numeric(19,6)` arrives as. It
  is the same discipline `core/money.ts` enforces; these are here rather than
  there because they are plumbing for a query layer, not domain arithmetic.
*/
/*
  `Decimal` is `core`'s dependency, not this app's, so the type is taken from
  the constructor `core` exports rather than by importing `decimal.js` here.
  Adding it to `apps/web`'s dependencies to name a return type would put a
  second copy of the arithmetic library one `npm install` away from existing.
*/
type Dec = InstanceType<typeof D>

function toDecimal(value: string | null | undefined): Dec {
  return new D(value ?? 0)
}

function decimalTimes(a: string, b: string): string {
  return toDecimal(a).times(toDecimal(b)).toFixed()
}

function sumStrings(values: readonly string[]): string {
  return values.reduce((acc, v) => acc.plus(toDecimal(v)), new D(0)).toFixed()
}

function subtractStrings(a: string, b: string): string {
  return toDecimal(a).minus(toDecimal(b)).toFixed()
}

/**
 * The branch "Capture bill" opens on — U5.
 *
 * It opened on none for anyone in more than one branch, so a clerk who only
 * ever keys Kuwait's bills picked Kuwait every time, and the one time they
 * did not, the bill went to Dubai. In order:
 *
 *   1. the only branch where they hold `payable.record`, if there is one;
 *   2. the branch of the last bill they captured themselves, if it is still
 *      one they may record in;
 *   3. the first branch they may record in, in the order the picker lists
 *      them.
 *
 * Still a default, never a decision: the field stays editable and the action
 * checks the branch it is handed. `permitted` is the caller's
 * `branchesWhere(session, 'payable.record')`; `listed` the picker's order.
 */
export async function defaultBillBranch(
  actor: Actor,
  permitted: readonly string[],
  listed: readonly string[],
): Promise<string | undefined> {
  if (permitted.length <= 1) return permitted[0]
  const first = listed.find((id) => permitted.includes(id)) ?? permitted[0]

  // The pilot has no bill anybody captured, so there is no last one to read.
  if (usePilotFixtures()) return first

  const [last] = await withActor(actor, (tx) =>
    tx
      .select({ branchId: supplierInvoices.branchId })
      .from(supplierInvoices)
      .where(
        and(
          eq(supplierInvoices.recordedById, actor.principalId),
          inArray(supplierInvoices.branchId, [...permitted]),
        ),
      )
      .orderBy(desc(supplierInvoices.createdAt))
      .limit(1),
  )
  return last?.branchId ?? first
}

/**
 * The currency a branch keeps its books in, to default a money form to.
 *
 * The payment form defaulted to KWD for every branch, so a Dubai payment in
 * dirhams had to be re-chosen by hand and one that was not went in as dinars.
 * Undefined offline — the pilot form keeps the deployment's first currency.
 */
export async function branchBaseCurrency(
  actor: Actor,
  branchId: string | undefined,
): Promise<string | undefined> {
  if (!branchId || usePilotFixtures()) return undefined
  const [row] = await withActor(actor, (tx) =>
    tx
      .select({ base: branches.baseCurrency })
      .from(branches)
      .where(eq(branches.id, branchId))
      .limit(1),
  )
  return row?.base
}
