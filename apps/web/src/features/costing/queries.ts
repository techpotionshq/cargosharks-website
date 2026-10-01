import 'server-only'

/**
 * The charge ledger, and the margin that falls out of it — FR-FN-01, FR-FN-04.
 *
 * `charge_lines` has existed since 0000 and until now nothing read it back.
 * The accrual workers wrote to it, the consolidation allocator wrote to it,
 * and the only reader in the product was the accounting export — so a job's
 * cost, its revenue and its margin were all in the database and none of them
 * were anywhere a person could see. This is the screen that closes that, and
 * it is the prerequisite for cost verification: you cannot review a variance
 * against a figure no screen shows.
 *
 * As everywhere else, no query here carries a branch filter — `withActor` sets
 * the principal and RLS applies the scope (§5.3).
 *
 * Amounts come back as strings and stay strings. `numeric(19,6)` is returned
 * as a string by `node-postgres` precisely so the precision survives, and the
 * arithmetic is done by `core/margin.ts` in `Decimal`. Nothing on this path
 * touches `Number()`.
 */

import { and, asc, eq, sql } from 'drizzle-orm'
import {
  chargeLines,
  chargeTypes,
  branches,
  jobs,
  partners,
  customers,
  withActor,
  type Actor,
} from '@qabandi/db'
import { emptyLedgerMargin, jobMargin, type LedgerMargin } from '@qabandi/core'
import { usePilotFixtures } from '@/lib/pilot/source'
import { pilotJobLedger, pilotMatchCandidates } from '@/lib/pilot/fixtures'

export interface ChargeLineRow {
  readonly id: string
  readonly direction: 'cost' | 'revenue'
  readonly chargeTypeId: string
  readonly chargeTypeName: string
  readonly description: string | null
  readonly basis: string
  readonly quantity: string
  readonly rate: string
  readonly amount: string
  readonly currency: string
  readonly amountBase: string
  readonly baseCurrency: string
  readonly fxRate: string
  readonly counterpartyPartnerId: string | null
  readonly counterpartyCustomerId: string | null
  readonly counterpartyName: string | null
  readonly isAccrual: boolean
  /** Where a worker or the allocator wrote it — `null` means somebody typed it. */
  readonly sourceKind: string | null
  /** Billed to the customer already; a billed line is never edited. */
  readonly isBilled: boolean
  /** How much of this accrual a supplier has since invoiced for (0014). */
  readonly matchedAmount: string
  readonly matchCount: number
  readonly createdAt: Date
}

export interface JobLedger {
  readonly jobId: string
  readonly jobReference: string
  readonly baseCurrency: string
  readonly marginFloorPercent: string | null
  readonly lines: readonly ChargeLineRow[]
  readonly margin: LedgerMargin
}

/*
  A charge type or counterparty in the reader's language.

  Every charge type carries an Arabic name; most partners do not yet, so the
  English one stands in — `nullif` because an empty Arabic name is as unset as
  a null one. English reads keep the plain column.
*/
function chargeTypeNameIn(locale: 'en' | 'ar') {
  return locale === 'ar'
    ? sql<string>`coalesce(nullif(${chargeTypes.nameAr}, ''), ${chargeTypes.nameEn})`
    : sql<string>`${chargeTypes.nameEn}`
}

function partnerNameIn(locale: 'en' | 'ar') {
  return locale === 'ar'
    ? sql<string | null>`coalesce(nullif(${partners.legalNameAr}, ''), ${partners.legalNameEn})`
    : sql<string | null>`${partners.legalNameEn}`
}

export async function getJobLedger(
  actor: Actor,
  jobId: string,
  locale: 'en' | 'ar' = 'en',
): Promise<JobLedger | undefined> {
  /*
    The fixture stops at the lines, and `jobMargin` still runs over them.

    The margin is the figure the card exists to show, and `core/margin.ts` is
    the one place that knows what it is — so a demo path that returned a
    finished `LedgerMargin` would be showing arithmetic the product does not
    do, which is the promise `lib/pilot/source.ts` opens by making. This was
    also the last un-branched read on the job file: `getJobDetail` has had its
    branch since the fixtures landed, and one query without one took the most
    used screen in the product down with it.
  */
  if (usePilotFixtures()) {
    const rows = pilotJobLedger(jobId, Date.now(), locale)
    return rows === undefined ? undefined : ledgerOf(rows)
  }

  return withActor(actor, async (tx) => {
    const [job] = await tx
      .select({
        id: jobs.id,
        reference: jobs.reference,
        baseCurrency: branches.baseCurrency,
        marginFloorPercent: branches.marginFloorPercent,
      })
      .from(jobs)
      .innerJoin(branches, eq(branches.id, jobs.branchId))
      .where(eq(jobs.id, jobId))
      .limit(1)

    if (!job) return undefined

    const rows = await tx
      .select({
        id: chargeLines.id,
        direction: chargeLines.direction,
        chargeTypeId: chargeLines.chargeTypeId,
        chargeTypeName: chargeTypeNameIn(locale),
        description: chargeLines.description,
        basis: chargeLines.basis,
        quantity: chargeLines.quantity,
        rate: chargeLines.rate,
        amount: chargeLines.amount,
        currency: chargeLines.currency,
        amountBase: chargeLines.amountBase,
        baseCurrency: chargeLines.baseCurrency,
        fxRate: chargeLines.fxRate,
        counterpartyPartnerId: chargeLines.counterpartyPartnerId,
        counterpartyCustomerId: chargeLines.counterpartyCustomerId,
        counterpartyName:
          locale === 'ar'
            ? sql<string | null>`coalesce(
                nullif("partners"."legal_name_ar", ''), "partners"."legal_name_en",
                nullif("customers"."legal_name_ar", ''), "customers"."legal_name_en"
              )`
            : sql<string | null>`coalesce(
                "partners"."legal_name_en", "customers"."legal_name_en"
              )`,
        isAccrual: chargeLines.isAccrual,
        sourceKind: chargeLines.sourceKind,
        isBilled: sql<boolean>`"charge_lines"."invoice_id" is not null`,
        /*
          What a supplier has since billed against this accrual.

          A correlated subquery rather than a join, because a charge line can
          carry several matches and joining would multiply the ledger row.
          Written with explicit qualified SQL — see `check-boundaries.mjs`
          rule 3 for why an interpolated `${chargeLines.id}` is wrong here.
        */
        matchedAmount: sql<string>`(
          select coalesce(sum(m.amount), 0)::text
            from supplier_invoice_matches m
           where m.charge_line_id = "charge_lines"."id" and m.retracted_at is null
        )`,
        matchCount: sql<number>`(
          select count(*)::int
            from supplier_invoice_matches m
           where m.charge_line_id = "charge_lines"."id" and m.retracted_at is null
        )`,
        createdAt: chargeLines.createdAt,
      })
      .from(chargeLines)
      .innerJoin(chargeTypes, eq(chargeTypes.id, chargeLines.chargeTypeId))
      .leftJoin(partners, eq(partners.id, chargeLines.counterpartyPartnerId))
      .leftJoin(customers, eq(customers.id, chargeLines.counterpartyCustomerId))
      .where(eq(chargeLines.jobId, jobId))
      .orderBy(asc(chargeLines.direction), asc(chargeLines.createdAt))

    return ledgerOf({
      jobId: job.id,
      jobReference: job.reference,
      baseCurrency: job.baseCurrency,
      marginFloorPercent: job.marginFloorPercent,
      lines: rows as ChargeLineRow[],
    })
  })
}

/**
 * The P&L over a ledger, and the one place it is computed.
 *
 * Shared by both branches above on purpose. `jobMargin` is what a job's margin
 * *is* — a second reduction written for the fixture path would be a second
 * definition of the number the commercial conversation turns on, which is
 * exactly what `core/margin.ts`'s own header exists to prevent.
 *
 * An empty ledger takes `emptyLedgerMargin` rather than a sum over nothing: a
 * gross percentage on no revenue is null, not zero, and `belowFloor` reads the
 * difference (`FR-FN-05`).
 */
function ledgerOf(read: Omit<JobLedger, 'margin'>): JobLedger {
  return {
    ...read,
    margin:
      read.lines.length === 0
        ? emptyLedgerMargin(read.baseCurrency)
        : jobMargin(
            read.lines.map((l) => ({
              direction: l.direction,
              amountBase: l.amountBase,
              isAccrual: l.isAccrual,
            })),
            read.baseCurrency,
          ),
  }
}

/**
 * Cost lines on a job that a supplier has not fully billed for yet.
 *
 * The matching screen's other half: when somebody is looking at an agent's
 * invoice line and asking what it should settle, this is the candidate list.
 * Ordered by charge type so the obvious pairing — their "OCEAN FREIGHT"
 * against our ocean freight accrual — sits next to itself.
 */
export interface MatchCandidate {
  readonly id: string
  readonly jobId: string
  readonly jobReference: string
  readonly chargeTypeId: string
  readonly chargeTypeName: string
  readonly description: string | null
  readonly amount: string
  readonly currency: string
  readonly matchedAmount: string
  readonly counterpartyName: string | null
}

export async function listMatchCandidates(
  actor: Actor,
  filters: { readonly jobId?: string; readonly partnerId?: string } = {},
  locale: 'en' | 'ar' = 'en',
): Promise<MatchCandidate[]> {
  /*
    Reached from the supplier bill's matching dialog, so it needs the same
    branch that read gets — otherwise fixing `getSupplierInvoice` alone only
    moves the failure one query down the page.
  */
  if (usePilotFixtures()) return pilotMatchCandidates(filters, Date.now(), locale)

  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({
        id: chargeLines.id,
        jobId: chargeLines.jobId,
        jobReference: jobs.reference,
        chargeTypeId: chargeLines.chargeTypeId,
        chargeTypeName: chargeTypeNameIn(locale),
        description: chargeLines.description,
        amount: chargeLines.amount,
        currency: chargeLines.currency,
        matchedAmount: sql<string>`(
          select coalesce(sum(m.amount), 0)::text
            from supplier_invoice_matches m
           where m.charge_line_id = "charge_lines"."id" and m.retracted_at is null
        )`,
        counterpartyName: partnerNameIn(locale),
      })
      .from(chargeLines)
      .innerJoin(jobs, eq(jobs.id, chargeLines.jobId))
      .innerJoin(chargeTypes, eq(chargeTypes.id, chargeLines.chargeTypeId))
      .leftJoin(partners, eq(partners.id, chargeLines.counterpartyPartnerId))
      .where(
        and(
          eq(chargeLines.direction, 'cost'),
          filters.jobId ? eq(chargeLines.jobId, filters.jobId) : undefined,
          /*
            Filtered on the counterparty where we know it, and not otherwise.

            An agent's monthly invoice covers thirty shipments and every cost
            line on them names that agent — so this narrows a two-hundred-row
            list to twelve. But a cost accrued with no counterparty recorded is
            exactly the sort of line that most needs matching, so an unset
            counterparty stays in the list rather than being filtered out.
          */
          filters.partnerId
            ? sql`(${chargeLines.counterpartyPartnerId} = ${filters.partnerId}
                   or ${chargeLines.counterpartyPartnerId} is null)`
            : undefined,
        ),
      )
      .orderBy(asc(chargeTypes.sortOrder), asc(chargeLines.createdAt))
      .limit(300)

    return rows as MatchCandidate[]
  })
}
