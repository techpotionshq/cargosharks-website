import 'server-only'

/**
 * Revenue that was earned and never invoiced — the quietest way a forwarder
 * loses money.
 *
 * A charge line is billed when `charge_lines.invoice_id` is set, and until now
 * nothing in this product asked the obvious next question: *which revenue
 * lines have never had that column filled?* The job screen shows it one
 * shipment at a time — `matchCount === 0` renders as "unbilled" in
 * `costing/ui/panels.tsx` — and a coordinator looking at one job has no reason
 * to suspect the other four hundred.
 *
 * That is what makes this leak different from the ones the product already
 * catches. An overdue invoice is loud: it ages, it appears in a bucket, a
 * customer is chased. An unbilled charge is silent. The cost was booked
 * against the job, the accrual made the margin look thin, and the shipment
 * closed at a number nobody questioned because there was never a document to
 * be missing. Nothing ages, because nothing was ever raised.
 *
 * ## Why the base currency, and why the job's own currency too
 *
 * The register totals in the branch's base currency, because "how much are we
 * sitting on" is one number or it is not a number. Each job also carries the
 * currency its lines are actually in, because an invoice has exactly one
 * currency and a job billing in USD and KWD cannot become one document — which
 * `billJob` refuses rather than silently converting.
 *
 * ## What is deliberately not filtered
 *
 * Not filtered by job status. The instinct is to show only delivered
 * shipments, and it is wrong: a job that has been sitting in `clearance` for
 * five weeks with 900 KWD of revenue on it is exactly the row worth seeing,
 * and hiding it until delivery is how the leak survives. The register shows
 * the age instead and lets a person judge.
 */

import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import {
  chargeLines,
  customers,
  jobs,
  withActor,
  type Actor,
} from '@qabandi/db'

export interface UnbilledJob {
  readonly jobId: string
  readonly reference: string
  readonly status: string
  readonly customerId: string | null
  readonly customerName: string | null
  /** How many revenue lines are sitting unbilled on this shipment. */
  readonly lines: number
  /** The total in the branch's base currency, for ranking and for the header. */
  readonly amountBase: string
  readonly baseCurrency: string
  /**
   * The currencies those lines are actually in.
   *
   * More than one means this job cannot become a single invoice, and the
   * register says so rather than letting somebody discover it at the click.
   */
  readonly currencies: readonly string[]
  /** When the oldest unbilled line was written — the age of the leak. */
  readonly oldestAt: Date
}

export interface UnbilledSummary {
  readonly jobs: readonly UnbilledJob[]
  readonly totalBase: string
  readonly baseCurrency: string
  readonly jobCount: number
}

/**
 * Every shipment carrying revenue nobody has billed, worst first.
 *
 * No branch filter: `withActor` means RLS applies one, and a second copy here
 * would be a rule to forget. Ordered by amount rather than by age, because the
 * question this screen answers is "what is worth doing first" — and a
 * three-month-old 12 KWD line is not it.
 */
export async function unbilledRevenue(actor: Actor, limit = 100): Promise<UnbilledSummary> {
  const rows = await withActor(actor, async (tx) =>
    tx
      .select({
        jobId: jobs.id,
        reference: jobs.reference,
        status: jobs.status,
        customerId: jobs.customerId,
        customerName: customers.legalNameEn,
        lines: sql<number>`count(*)::int`,
        amountBase: sql<string>`sum("charge_lines"."amount_base")::text`,
        baseCurrency: sql<string>`min("charge_lines"."base_currency")`,
        currencies: sql<string[]>`array_agg(distinct "charge_lines"."currency")`,
        /*
          Typed as text and converted below, deliberately.

          A raw `sql<Date>` fragment is a promise the driver does not keep:
          `min(created_at)` comes back from `pg` as the string
          `2026-08-22 20:09:53.424545+00`, and the declared type made it look
          like a `Date` right up to the point something called `.getTime()` on
          it. Converting once, here, is what keeps `UnbilledJob.oldestAt` an
          honest `Date` for every reader.
        */
        oldestAt: sql<string>`min("charge_lines"."created_at")`,
      })
      .from(chargeLines)
      .innerJoin(jobs, eq(jobs.id, chargeLines.jobId))
      .leftJoin(customers, eq(customers.id, jobs.customerId))
      .where(
        and(
          /*
            Revenue only. A cost line with no invoice is the ordinary state of
            a shipment in progress — it means nobody has *billed us* yet, which
            `payables` already tracks. Only the sell side is money we have
            failed to ask for.
          */
          eq(chargeLines.direction, 'revenue'),
          isNull(chargeLines.invoiceId),
          /*
            An accrual is our own estimate of a cost still to come, and it has
            no business on a customer invoice. `is_accrual` is how the ledger
            distinguishes a figure we booked from a figure we agreed.
          */
          eq(chargeLines.isAccrual, false),
        ),
      )
      .groupBy(jobs.id, jobs.reference, jobs.status, jobs.customerId, customers.legalNameEn)
      .orderBy(desc(sql`sum("charge_lines"."amount_base")`))
      .limit(limit),
  )

  const totalBase = rows
    .reduce((sum, row) => sum + Number(row.amountBase ?? 0), 0)
    .toFixed(3)

  return {
    jobs: rows.map((row) => ({ ...row, oldestAt: new Date(row.oldestAt) })) as UnbilledJob[],
    totalBase,
    baseCurrency: rows[0]?.baseCurrency ?? 'KWD',
    jobCount: rows.length,
  }
}

export interface UnbilledLine {
  readonly id: string
  readonly description: string | null
  readonly chargeTypeId: string | null
  readonly quantity: string
  readonly rate: string
  readonly amount: string
  readonly currency: string
}

/** The lines behind one shipment's figure, in the order they were written. */
export async function unbilledLinesFor(actor: Actor, jobId: string): Promise<UnbilledLine[]> {
  return withActor(actor, async (tx) =>
    tx
      .select({
        id: chargeLines.id,
        description: chargeLines.description,
        chargeTypeId: chargeLines.chargeTypeId,
        quantity: chargeLines.quantity,
        rate: chargeLines.rate,
        amount: chargeLines.amount,
        currency: chargeLines.currency,
      })
      .from(chargeLines)
      .where(
        and(
          eq(chargeLines.jobId, jobId),
          eq(chargeLines.direction, 'revenue'),
          eq(chargeLines.isAccrual, false),
          isNull(chargeLines.invoiceId),
        ),
      )
      .orderBy(chargeLines.createdAt),
  )
}
