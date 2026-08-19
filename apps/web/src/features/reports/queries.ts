import 'server-only'

/**
 * Management reporting — the aggregate the job P&L already implies.
 *
 * `core/margin.ts` answers "what did this shipment make". Every screen in the
 * product asks it one job at a time, which serves a coordinator and says
 * nothing to the person who signs the cheque. The question they ask is which
 * lanes, which customers and which salespeople are worth the desk space, and
 * it needs the same arithmetic grouped and over a period.
 *
 * ## Why this sums in SQL rather than through `core/margin.ts`
 *
 * Everywhere else in this product the money arithmetic goes through `core`,
 * and that rule is not being relaxed casually. It holds where the *shape* of
 * the calculation is a domain decision — a margin percentage, a set-off, an
 * FX conversion. This is a `sum()` over `numeric` with a `group by`, and the
 * two facts that matter are both already settled by the time the rows exist:
 * every line carries `amount_base`, fixed at the rate taken when the
 * commitment was made (FR-RT-06), and PostgreSQL's `numeric` is the same
 * arbitrary-precision decimal `Decimal` is. Pulling a hundred thousand charge
 * lines into Node to add them up would be slower and no more correct.
 *
 * The margin *percentage* is not computed here. It comes back as revenue and
 * cost, and the caller runs `summariseMargin` — because that one is a domain
 * decision (what a zero-revenue job's margin percentage is, for instance) and
 * it must be the same answer here as on the job screen.
 *
 * ## Which date a shipment belongs to
 *
 * `coalesce(etd, created_at)`, and stated rather than assumed. A forwarder
 * thinks about a shipment in the month it sailed, not the month somebody
 * opened the file — an enquiry booked in March for an April sailing is April's
 * business. Where there is no departure yet the file date is the only honest
 * answer, and a booked-but-unsailed job still belongs in the pipeline.
 *
 * As everywhere, no query carries a branch filter: `withActor` sets the
 * principal and RLS applies the scope (§5.3).
 */

import { and, eq, gte, lte, sql } from 'drizzle-orm'
import {
  branches,
  chargeLines,
  customers,
  jobs,
  locations,
  principals,
  withActor,
  type Actor,
} from '@qabandi/db'

/** What a management report can be cut by. */
export type ReportDimension = 'branch' | 'customer' | 'lane' | 'mode' | 'owner'

export const REPORT_DIMENSIONS: readonly ReportDimension[] = [
  'branch',
  'customer',
  'lane',
  'mode',
  'owner',
]

export interface ReportRow {
  readonly key: string
  readonly labelEn: string
  readonly labelAr: string | null
  readonly jobCount: number
  readonly revenue: string
  readonly cost: string
  readonly grossProfit: string
  readonly currency: string
}

export interface ReportPeriod {
  /** `YYYY-MM-DD`, inclusive. */
  readonly from: string
  readonly to: string
}

/**
 * The period a report defaults to: the calendar year to date.
 *
 * Not "the last 30 days". A forwarder's year is the unit every other number
 * they hold is stated in — the agent agreement, the bank facility, the audit —
 * and a report opening on a rolling window is one nobody can reconcile against
 * anything.
 */
export function yearToDate(today = new Date()): ReportPeriod {
  const iso = today.toISOString().slice(0, 10)
  return { from: `${iso.slice(0, 4)}-01-01`, to: iso }
}

export async function marginByDimension(
  actor: Actor,
  dimension: ReportDimension,
  period: ReportPeriod,
): Promise<ReportRow[]> {
  return withActor(actor, async (tx) => {
    /*
      One `sum` per direction rather than a join per direction.

      `filter (where ...)` computes both sides in a single pass over the
      ledger. Two subqueries joined on the grouping key would read the table
      twice and, worse, would drop any group that has revenue and no cost —
      which is every job whose supplier bills have not arrived.
    */
    const revenue = sql<string>`
      coalesce(sum(${chargeLines.amountBase}) filter (where ${chargeLines.direction} = 'revenue'), 0)
    `
    const cost = sql<string>`
      coalesce(sum(${chargeLines.amountBase}) filter (where ${chargeLines.direction} = 'cost'), 0)
    `
    const jobCount = sql<number>`count(distinct ${jobs.id})::int`
    /*
      Subtracted in PostgreSQL, on `numeric`, never in JavaScript.

      The same rule as everywhere else in this product: `numeric(19,6)` is an
      arbitrary-precision decimal and a JS `number` is a float. A year of
      Kuwaiti margins reduced through `Number()` loses fils, and a management
      report that disagrees with the job screens by a few hundred fils is a
      report nobody trusts twice. The sort is here for the same reason — it
      orders on the exact value rather than on a lossy copy of it.
    */
    const grossProfit = sql<string>`
      coalesce(sum(${chargeLines.amountBase}) filter (where ${chargeLines.direction} = 'revenue'), 0)
      - coalesce(sum(${chargeLines.amountBase}) filter (where ${chargeLines.direction} = 'cost'), 0)
    `
    const shipmentDate = sql`coalesce(${jobs.etd}::date, ${jobs.createdAt}::date)`

    const where = and(
      gte(shipmentDate, period.from),
      lte(shipmentDate, period.to),
      /*
        Cancelled shipments are excluded; closed ones are not.

        A cancelled job may still carry charge lines somebody entered before it
        fell through, and counting those as trade would overstate every lane it
        touched. A closed job is finished work and is exactly what a period
        report is about.
      */
      sql`${jobs.cancelledAt} is null`,
    )

    /*
      Each dimension states its own query rather than sharing a builder.

      Drizzle's query builder is typed by its joins, so a `base` reused across
      five different join shapes loses the column types that make the result
      checkable. Five explicit queries that the compiler verifies beat one
      clever one that it cannot.
    */
    switch (dimension) {
      case 'branch':
        return tx
          .select({
            key: branches.id,
            labelEn: branches.legalNameEn,
            labelAr: branches.legalNameAr,
            jobCount,
            revenue,
            cost,
            grossProfit,
            currency: sql<string>`min(${chargeLines.baseCurrency})`,
          })
          .from(jobs)
          .innerJoin(chargeLines, eq(chargeLines.jobId, jobs.id))
          .innerJoin(branches, eq(branches.id, jobs.branchId))
          .where(where)
          .groupBy(branches.id, branches.legalNameEn, branches.legalNameAr)
          .orderBy(sql`${grossProfit} desc`)
          .then(normalise)

      case 'customer':
        return tx
          .select({
            key: customers.id,
            labelEn: customers.legalNameEn,
            labelAr: customers.legalNameAr,
            jobCount,
            revenue,
            cost,
            grossProfit,
            currency: sql<string>`min(${chargeLines.baseCurrency})`,
          })
          .from(jobs)
          .innerJoin(chargeLines, eq(chargeLines.jobId, jobs.id))
          .innerJoin(customers, eq(customers.id, jobs.customerId))
          .where(where)
          .groupBy(customers.id, customers.legalNameEn, customers.legalNameAr)
          .orderBy(sql`${grossProfit} desc`)
          .then(normalise)

      case 'lane': {
        /*
          A lane is the pair, and it is built in SQL rather than in JavaScript.

          Grouping by two ids and stitching the names afterwards would need a
          second query per lane or a map of every location in the deployment.
          The pair is the identity here — Jebel Ali to Shuwaikh is one lane and
          the reverse is a different one, which is why the codes are
          concatenated in order rather than sorted.
        */
        const origin = sql`origin`
        const destination = sql`destination`
        return tx
          .select({
            key: sql<string>`coalesce(${origin}.unlocode, '?') || ' → ' || coalesce(${destination}.unlocode, '?')`,
            labelEn: sql<string>`coalesce(${origin}.name_en, '—') || ' → ' || coalesce(${destination}.name_en, '—')`,
            labelAr: sql<
              string | null
            >`coalesce(${origin}.name_ar, ${origin}.name_en) || ' ← ' || coalesce(${destination}.name_ar, ${destination}.name_en)`,
            jobCount,
            revenue,
            cost,
            grossProfit,
            currency: sql<string>`min(${chargeLines.baseCurrency})`,
          })
          .from(jobs)
          .innerJoin(chargeLines, eq(chargeLines.jobId, jobs.id))
          .leftJoin(sql`${locations} as origin`, sql`origin.id = ${jobs.originId}`)
          .leftJoin(sql`${locations} as destination`, sql`destination.id = ${jobs.destinationId}`)
          .where(where)
          .groupBy(
            sql`origin.unlocode`,
            sql`destination.unlocode`,
            sql`origin.name_en`,
            sql`destination.name_en`,
            sql`origin.name_ar`,
            sql`destination.name_ar`,
          )
          .orderBy(sql`${grossProfit} desc`)
          .then(normalise)
      }

      case 'mode':
        return tx
          .select({
            key: sql<string>`${jobs.mode}::text`,
            labelEn: sql<string>`${jobs.mode}::text`,
            labelAr: sql<string | null>`null`,
            jobCount,
            revenue,
            cost,
            grossProfit,
            currency: sql<string>`min(${chargeLines.baseCurrency})`,
          })
          .from(jobs)
          .innerJoin(chargeLines, eq(chargeLines.jobId, jobs.id))
          .where(where)
          .groupBy(jobs.mode)
          .orderBy(sql`${grossProfit} desc`)
          .then(normalise)

      case 'owner':
        /*
          Left join, and the unowned bucket is kept.

          A job with no owner is not an edge case to filter away — it is
          unattributed trade, and how much of it there is happens to be the
          most useful thing this cut says in the first month of a deployment.
        */
        return tx
          .select({
            key: sql<string>`coalesce(${principals.id}::text, 'unassigned')`,
            labelEn: sql<string>`coalesce(${principals.nameEn}, 'Unassigned')`,
            labelAr: sql<string | null>`coalesce(${principals.nameAr}, ${principals.nameEn})`,
            jobCount,
            revenue,
            cost,
            grossProfit,
            currency: sql<string>`min(${chargeLines.baseCurrency})`,
          })
          .from(jobs)
          .innerJoin(chargeLines, eq(chargeLines.jobId, jobs.id))
          .leftJoin(principals, eq(principals.id, jobs.ownerId))
          .where(where)
          .groupBy(principals.id, principals.nameEn, principals.nameAr)
          .orderBy(sql`${grossProfit} desc`)
          .then(normalise)
    }
  })
}

/**
 * The one thing left to do in JavaScript: name the currency.
 *
 * `min(base_currency)` is null for a group with no charge lines, which cannot
 * happen given the inner join but costs nothing to answer honestly. Everything
 * else — the sums, the subtraction, the ordering — happened in PostgreSQL on
 * `numeric`, which is the only place this arithmetic is exact.
 */
function normalise(
  rows: {
    key: string
    labelEn: string
    labelAr: string | null
    jobCount: number
    revenue: string
    cost: string
    grossProfit: string
    currency: string | null
  }[],
): ReportRow[] {
  return rows.map((row) => ({ ...row, currency: row.currency ?? 'KWD' }))
}
