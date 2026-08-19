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

export async function getJobLedger(actor: Actor, jobId: string): Promise<JobLedger | undefined> {
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
        chargeTypeName: chargeTypes.nameEn,
        description: chargeLines.description,
        basis: chargeLines.basis,
        quantity: chargeLines.quantity,
        rate: chargeLines.rate,
        amount: chargeLines.amount,
        currency: chargeLines.currency,
        amountBase: chargeLines.amountBase,
        baseCurrency: chargeLines.baseCurrency,
        fxRate: chargeLines.fxRate,
        counterpartyName: sql<string | null>`coalesce(
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

    const lines = rows as ChargeLineRow[]

    return {
      jobId: job.id,
      jobReference: job.reference,
      baseCurrency: job.baseCurrency,
      marginFloorPercent: job.marginFloorPercent,
      lines,
      margin:
        lines.length === 0
          ? emptyLedgerMargin(job.baseCurrency)
          : jobMargin(
              lines.map((l) => ({
                direction: l.direction,
                amountBase: l.amountBase,
                isAccrual: l.isAccrual,
              })),
              job.baseCurrency,
            ),
    }
  })
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
): Promise<MatchCandidate[]> {
  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({
        id: chargeLines.id,
        jobId: chargeLines.jobId,
        jobReference: jobs.reference,
        chargeTypeId: chargeLines.chargeTypeId,
        chargeTypeName: chargeTypes.nameEn,
        description: chargeLines.description,
        amount: chargeLines.amount,
        currency: chargeLines.currency,
        matchedAmount: sql<string>`(
          select coalesce(sum(m.amount), 0)::text
            from supplier_invoice_matches m
           where m.charge_line_id = "charge_lines"."id" and m.retracted_at is null
        )`,
        counterpartyName: partners.legalNameEn,
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
