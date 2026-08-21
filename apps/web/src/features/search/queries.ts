/**
 * Global search — the one box in the topbar, and everything it promises.
 *
 * The placeholder says "Reference, container, customer", so those are the
 * three things this looks in, and the results are grouped the same three ways.
 * A person at this box is holding one string off a piece of paper — a booking
 * confirmation, a container seal photograph, an email subject line — and does
 * not know which field of ours it belongs to. Making them choose the register
 * first is the thing the box exists to avoid.
 *
 * A slice of its own rather than a helper on the jobs slice, because it reads
 * across jobs, equipment and customers, and slices do not import each other
 * (§4). Everything it needs is either its own or comes up from `@qabandi/db`.
 *
 * No branch filter appears anywhere below: every read runs inside `withActor`
 * and RLS decides what is visible (§5.3). That matters more here than on a
 * register — a search box that reached past the tenancy boundary would return
 * another branch's customer names to anyone who guessed three letters of one.
 */

import 'server-only'
import { asc, desc, eq, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  customers,
  equipment,
  jobs,
  locations,
  withActor,
  type Actor,
} from '@qabandi/db'
import type { Mode } from '@/lib/pilot/types'
import { usePilotFixtures } from '@/lib/pilot/source'
import { pilotJob, pilotJobs } from '@/lib/pilot/fixtures'

const origin = alias(locations, 'origin')
const destination = alias(locations, 'destination')

/**
 * Which field a job was found by, carried through to the result row.
 *
 * Without it a search for `BKG0011451` returns a job whose reference is
 * `KWI-2026-01041` and nothing on the screen explains the connection, which
 * reads as a wrong answer rather than a right one.
 */
export type JobMatch =
  | 'reference'
  | 'masterBill'
  | 'houseBill'
  | 'booking'
  | 'customerReference'
  | 'customer'

export interface JobHit {
  readonly id: string
  readonly reference: string
  readonly status: string
  readonly mode: Mode
  readonly customerName: string
  readonly customerNameAr: string
  readonly originName: string
  readonly originNameAr: string
  readonly destinationName: string
  readonly destinationNameAr: string
  readonly eta: Date | null
  readonly matchedOn: JobMatch
  /** The value that matched, shown when it is not the reference itself. */
  readonly matchedValue: string
}

export interface ContainerHit {
  readonly containerNo: string
  readonly type: string
  readonly jobId: string
  readonly jobReference: string
  readonly jobStatus: string
}

export interface CustomerHit {
  /**
   * Null on fixtures, where a customer is a name on a job rather than a row.
   *
   * The results page reads it as "is there a record to open": the pilot
   * dataset has no customer register behind it, and a link into one would be a
   * dead end in the middle of the demo.
   */
  readonly id: string | null
  readonly code: string | null
  readonly legalNameEn: string
  readonly legalNameAr: string | null
  readonly openJobs: number
}

export interface SearchResults {
  readonly jobs: readonly JobHit[]
  readonly containers: readonly ContainerHit[]
  readonly customers: readonly CustomerHit[]
}

const EMPTY: SearchResults = { jobs: [], containers: [], customers: [] }

/** Below this a query matches half the database and answers nothing. */
export const MIN_QUERY_LENGTH = 2

const LIMIT = 20

export function totalHits(results: SearchResults): number {
  return results.jobs.length + results.containers.length + results.customers.length
}

/**
 * Container numbers are typed loosely — `MSCU 123456 7`, or pasted with a
 * newline in the middle. Identifiers are compared with the spaces taken out on
 * both sides, the way the public tracking page does it.
 */
function tighten(value: string): string {
  return value.toUpperCase().replace(/\s+/g, '')
}

/**
 * `%` and `_` are wildcards to `like`, and an operator pasting a reference
 * containing one would otherwise widen their own search without knowing it.
 * `\` is the escape character, so it has to go first.
 */
function contains(value: string): string {
  return `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`
}

export async function search(actor: Actor, query: string): Promise<SearchResults> {
  const term = query.trim()
  if (term.length < MIN_QUERY_LENGTH) return EMPTY

  if (usePilotFixtures()) return searchFixtures(term)

  const loose = contains(term)
  const tight = contains(tighten(term))

  /*
    One transaction for all three lookups, not three.

    Each `withActor` is its own `BEGIN`, `set_config` and `COMMIT`; against a
    database a few hundred milliseconds away that difference is the whole
    perceived cost of the box.
  */
  return withActor(actor, async (tx) => {
    const [jobRows, containerRows, customerRows] = await Promise.all([
      tx
        .select({
          id: jobs.id,
          reference: jobs.reference,
          status: jobs.status,
          mode: jobs.mode,
          eta: jobs.eta,
          masterBillNumber: jobs.masterBillNumber,
          houseBillNumber: jobs.houseBillNumber,
          bookingNumber: jobs.bookingNumber,
          customerReference: jobs.customerReference,
          customerName: customers.legalNameEn,
          customerNameAr: customers.legalNameAr,
          originName: origin.nameEn,
          originNameAr: origin.nameAr,
          destinationName: destination.nameEn,
          destinationNameAr: destination.nameAr,
        })
        .from(jobs)
        .leftJoin(customers, eq(customers.id, jobs.customerId))
        .leftJoin(origin, eq(origin.id, jobs.originId))
        .leftJoin(destination, eq(destination.id, jobs.destinationId))
        .where(
          or(
            sql`replace(${jobs.reference}, ' ', '') ilike ${tight}`,
            sql`replace(${jobs.masterBillNumber}, ' ', '') ilike ${tight}`,
            sql`replace(${jobs.houseBillNumber}, ' ', '') ilike ${tight}`,
            sql`replace(${jobs.bookingNumber}, ' ', '') ilike ${tight}`,
            sql`replace(${jobs.customerReference}, ' ', '') ilike ${tight}`,
            sql`${customers.legalNameEn} ilike ${loose}`,
            sql`${customers.legalNameAr} ilike ${loose}`,
          ),
        )
        // The live board's order: what is arriving soonest, then what moved last.
        .orderBy(asc(jobs.eta), desc(jobs.updatedAt))
        .limit(LIMIT),

      tx
        .select({
          containerNo: equipment.containerNo,
          type: equipment.containerType,
          jobId: jobs.id,
          jobReference: jobs.reference,
          jobStatus: jobs.status,
        })
        .from(equipment)
        .innerJoin(jobs, eq(jobs.id, equipment.jobId))
        .where(sql`replace(${equipment.containerNo}, ' ', '') ilike ${tight}`)
        .orderBy(asc(equipment.containerNo))
        .limit(LIMIT),

      tx
        .select({
          id: customers.id,
          code: customers.code,
          legalNameEn: customers.legalNameEn,
          legalNameAr: customers.legalNameAr,
          openJobs: sql<number>`(
            select count(*)::int from jobs j
             where j.customer_id = "customers"."id"
               and j.status not in ('closed', 'cancelled')
          )`,
        })
        .from(customers)
        .where(
          or(
            sql`${customers.legalNameEn} ilike ${loose}`,
            sql`${customers.legalNameAr} ilike ${loose}`,
            sql`replace(${customers.code}, ' ', '') ilike ${tight}`,
          ),
        )
        .orderBy(asc(customers.legalNameEn))
        .limit(LIMIT),
    ])

    return {
      jobs: jobRows.map((row) => {
        const { matchedOn, matchedValue } = classify(term, {
          reference: row.reference,
          masterBill: row.masterBillNumber,
          houseBill: row.houseBillNumber,
          booking: row.bookingNumber,
          customerReference: row.customerReference,
          customer: row.customerName,
        })
        return {
          id: row.id,
          reference: row.reference,
          status: row.status,
          mode: row.mode as Mode,
          customerName: row.customerName ?? '—',
          customerNameAr: row.customerNameAr ?? row.customerName ?? '—',
          originName: row.originName ?? '—',
          originNameAr: row.originNameAr ?? row.originName ?? '—',
          destinationName: row.destinationName ?? '—',
          destinationNameAr: row.destinationNameAr ?? row.destinationName ?? '—',
          eta: row.eta,
          matchedOn,
          matchedValue,
        }
      }),
      containers: containerRows.map((row) => ({
        containerNo: row.containerNo ?? '—',
        type: row.type ?? '—',
        jobId: row.jobId,
        jobReference: row.jobReference,
        jobStatus: row.jobStatus,
      })),
      customers: customerRows,
    }
  })
}

/**
 * Which of a job's identifiers the term was found in.
 *
 * Recomputed here rather than asked of the database: a `case` in the `select`
 * would duplicate the `where` clause, and the two would drift the first time
 * one of them gained a column.
 */
function classify(
  term: string,
  fields: Readonly<Record<JobMatch, string | null>>,
): { matchedOn: JobMatch; matchedValue: string } {
  const tight = tighten(term)
  const loose = term.toLowerCase()

  for (const key of [
    'reference',
    'masterBill',
    'houseBill',
    'booking',
    'customerReference',
  ] as const) {
    const value = fields[key]
    if (value && tighten(value).includes(tight)) return { matchedOn: key, matchedValue: value }
  }

  const customer = fields.customer
  if (customer && customer.toLowerCase().includes(loose)) {
    return { matchedOn: 'customer', matchedValue: customer }
  }

  // The row came back, so something matched; the reference is the honest
  // fallback rather than a claim about a field we cannot name.
  return { matchedOn: 'reference', matchedValue: fields.reference ?? term }
}

/**
 * The same search over the seeded pilot dataset.
 *
 * Not an approximation of the query above but the same promise kept without a
 * database, because the demo is run this way (`QABANDI_PILOT_FIXTURES=1`) and
 * a search box that only works against Postgres is a search box the client
 * never sees working.
 */
function searchFixtures(term: string): SearchResults {
  const tight = tighten(term)
  const loose = term.toLowerCase()
  const matchesTight = (value: string | null | undefined) =>
    Boolean(value && tighten(value).includes(tight))
  const matchesLoose = (value: string | null | undefined) =>
    Boolean(value && value.toLowerCase().includes(loose))

  const jobHits: JobHit[] = []
  const containerHits: ContainerHit[] = []
  /** Keyed by English legal name — the fixture has no customer identifier. */
  const customerHits = new Map<string, CustomerHit>()

  for (const summary of pilotJobs()) {
    const detail = pilotJob(summary.id)

    for (const container of detail?.containers ?? []) {
      if (!matchesTight(container.containerNo)) continue
      containerHits.push({
        containerNo: container.containerNo,
        type: container.type,
        jobId: summary.id,
        jobReference: summary.reference,
        jobStatus: summary.status,
      })
    }

    const identifiers: Readonly<Record<JobMatch, string | null>> = {
      reference: summary.reference,
      masterBill: detail?.masterBillNumber ?? null,
      houseBill: detail?.houseBillNumber ?? null,
      booking: detail?.bookingNumber ?? null,
      customerReference: detail?.customerReference ?? null,
      customer: summary.customerName,
    }

    const hitByIdentifier =
      matchesTight(identifiers.reference) ||
      matchesTight(identifiers.masterBill) ||
      matchesTight(identifiers.houseBill) ||
      matchesTight(identifiers.booking) ||
      matchesTight(identifiers.customerReference)
    const hitByCustomer =
      matchesLoose(summary.customerName) || matchesLoose(summary.customerNameAr)

    if (hitByIdentifier || hitByCustomer) {
      jobHits.push({
        id: summary.id,
        reference: summary.reference,
        status: summary.status,
        mode: summary.mode,
        customerName: summary.customerName,
        customerNameAr: summary.customerNameAr,
        originName: summary.originName,
        originNameAr: summary.originNameAr,
        destinationName: summary.destinationName,
        destinationNameAr: summary.destinationNameAr,
        eta: summary.eta,
        ...classify(term, identifiers),
      })
    }

    if (!hitByCustomer) continue
    const existing = customerHits.get(summary.customerName)
    customerHits.set(summary.customerName, {
      id: null,
      code: null,
      legalNameEn: summary.customerName,
      legalNameAr: summary.customerNameAr,
      openJobs: (existing?.openJobs ?? 0) + 1,
    })
  }

  return {
    jobs: jobHits
      .sort((a, b) => (a.eta?.getTime() ?? Infinity) - (b.eta?.getTime() ?? Infinity))
      .slice(0, LIMIT),
    containers: containerHits.slice(0, LIMIT),
    customers: [...customerHits.values()]
      .sort((a, b) => a.legalNameEn.localeCompare(b.legalNameEn))
      .slice(0, LIMIT),
  }
}
