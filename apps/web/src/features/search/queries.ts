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
import { customers, equipment, inSeries, jobs, locations, withActor, type Actor } from '@qabandi/db'
import type { Mode } from '@/lib/pilot/types'
import { usePilotFixtures } from '@/lib/pilot/source'
import {
  pilotConsolidations,
  pilotEnquiries,
  pilotInvoices,
  pilotJob,
  pilotJobs,
  pilotQuotes,
} from '@/lib/pilot/fixtures'
import { pickName } from '@/lib/named'
import { pageOf, pageOffset, type PageRequest } from '@/lib/paging'

const origin = alias(locations, 'origin')
const destination = alias(locations, 'destination')

/**
 * Which field a job was found by, carried through to the result row.
 *
 * Without it a search for `BKG0011451` returns a job whose reference is
 * `KWI-2026-01041` and nothing on the screen explains the connection, which
 * reads as a wrong answer rather than a right one.
 */
type JobMatch =
  'reference' | 'masterBill' | 'houseBill' | 'booking' | 'customerReference' | 'customer'

interface JobHit {
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

interface ContainerHit {
  readonly containerNo: string
  readonly type: string
  readonly jobId: string
  readonly jobReference: string
  readonly jobStatus: string
}

interface CustomerHit {
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

/**
 * The other references a person holds — U4.
 *
 * The box promised "Reference" and found only a job's: an enquiry number off
 * a customer's email, a quote number off a PDF, an invoice number off a
 * remittance advice or a consolidation reference all answered "Nothing
 * matches", and so did a master bill that belongs to a consolidation rather
 * than to any one house.
 */
export type RecordKind = 'enquiry' | 'quote' | 'invoice' | 'consolidation'

interface RecordHit {
  readonly kind: RecordKind
  readonly id: string
  readonly reference: string
  /** Set when the term matched something other than the reference — a master bill. */
  readonly matchedValue: string | null
}

/** The four groups the results page draws, each of which can be paged on its own. */
export const SEARCH_SECTIONS = ['jobs', 'records', 'containers', 'customers'] as const
export type SearchSection = (typeof SEARCH_SECTIONS)[number]

export interface SearchResults {
  readonly jobs: readonly JobHit[]
  readonly containers: readonly ContainerHit[]
  readonly customers: readonly CustomerHit[]
  readonly records: readonly RecordHit[]
  /**
   * Every match in each group, counted — not the length of the group shown.
   *
   * Each group shows its first twenty, and used to stop there without saying
   * so: a customer name that matched sixty shipments listed twenty and the
   * page said "20 results". The totals are what the page prints, and a group
   * with more than it shows links to a paged view of itself (`focus`).
   */
  readonly totals: Readonly<Record<SearchSection, number>>
}

const EMPTY: SearchResults = {
  jobs: [],
  containers: [],
  customers: [],
  records: [],
  totals: { jobs: 0, containers: 0, customers: 0, records: 0 },
}

/** Where a record opens. */
export function recordHref(kind: RecordKind, id: string): string {
  const base = {
    enquiry: 'enquiries',
    quote: 'quotes',
    invoice: 'invoices',
    consolidation: 'consolidations',
  }
  return `/${base[kind]}/${id}`
}

/** Below this a query matches half the database and answers nothing. */
export const MIN_QUERY_LENGTH = 2

/** Rows per group on the overview; a focused group pages at the register size. */
export const SECTION_PREVIEW = 20

/** Every match, across the groups — from the counts, never from what is shown. */
export function totalHits(results: SearchResults): number {
  return SEARCH_SECTIONS.reduce((sum, section) => sum + results.totals[section], 0)
}

/** One group, paged: which group, and which page of it. */
export interface SearchFocus {
  readonly section: SearchSection
  readonly request: PageRequest
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

/**
 * The search, every group at once (the overview), or one group a page at a
 * time (`focus`, which leaves the other groups empty and uncounted).
 */
export async function search(
  actor: Actor,
  query: string,
  focus?: SearchFocus,
): Promise<SearchResults> {
  const term = query.trim()
  if (term.length < MIN_QUERY_LENGTH) return EMPTY

  if (usePilotFixtures()) return windowed(searchFixtures(term), focus)

  const loose = contains(term)
  const tight = contains(tighten(term))

  const jobsWhere = or(
    sql`replace(${jobs.reference}, ' ', '') ilike ${tight}`,
    sql`replace(${jobs.masterBillNumber}, ' ', '') ilike ${tight}`,
    sql`replace(${jobs.houseBillNumber}, ' ', '') ilike ${tight}`,
    sql`replace(${jobs.bookingNumber}, ' ', '') ilike ${tight}`,
    sql`replace(${jobs.customerReference}, ' ', '') ilike ${tight}`,
    sql`${customers.legalNameEn} ilike ${loose}`,
    sql`${customers.legalNameAr} ilike ${loose}`,
  )
  const containersWhere = sql`replace(${equipment.containerNo}, ' ', '') ilike ${tight}`
  const customersWhere = or(
    sql`${customers.legalNameEn} ilike ${loose}`,
    sql`${customers.legalNameAr} ilike ${loose}`,
    sql`replace(${customers.code}, ' ', '') ilike ${tight}`,
  )
  /*
    The four kinds of record as one list, newest first, so it can page.

    It was four queries of twenty concatenated and cut to twenty, which meant
    twenty matching enquiries hid every matching invoice. One `union all`
    keeps the kinds together under one order and one offset. A draft invoice
    has no number yet, so there is nothing for anyone to be holding; a
    consolidation also matches by its master bill, and says so.
  */
  const recordsUnion = sql`
    select 'enquiry' as kind, e.id, e.reference, null::text as "matchedBill", e.created_at
      from enquiries e
     where replace(e.reference, ' ', '') ilike ${tight}
    union all
    select 'quote', q.id, q.reference, null::text, q.created_at
      from quotes q
     where replace(q.reference, ' ', '') ilike ${tight}
    union all
    select 'invoice', i.id, i.series_no, null::text, i.created_at
      from invoices i
     where replace(i.series_no, ' ', '') ilike ${tight}
    union all
    select 'consolidation', c.id, c.reference, c.master_bill_number, c.created_at
      from consolidations c
     where replace(c.reference, ' ', '') ilike ${tight}
        or replace(c.master_bill_number, ' ', '') ilike ${tight}
  `

  const window = (section: SearchSection) =>
    focus === undefined
      ? { limit: SECTION_PREVIEW, offset: 0 }
      : focus.section === section
        ? { limit: focus.request.size, offset: pageOffset(focus.request) }
        : null
  const wanted = (section: SearchSection) => window(section) !== null

  /*
    One transaction for every lookup, not one each.

    Each `withActor` is its own `BEGIN`, `set_config` and `COMMIT`; against a
    database a few hundred milliseconds away that difference is the whole
    perceived cost of the box.
  */
  return withActor(actor, async (tx) => {
    const count = async (rows: Promise<{ n: number }[]>) => (await rows)[0]?.n ?? 0
    const none = async () => []

    const [jobRows, containerRows, customerRows, recordRows, totals] = await inSeries([
      () => {
        const w = window('jobs')
        if (!w) return none()
        return (
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
            .where(jobsWhere)
            // The live board's order: what is arriving soonest, then what moved last.
            .orderBy(asc(jobs.eta), desc(jobs.updatedAt), asc(jobs.id))
            .limit(w.limit)
            .offset(w.offset)
        )
      },

      () => {
        const w = window('containers')
        if (!w) return none()
        return tx
          .select({
            containerNo: equipment.containerNo,
            type: equipment.containerType,
            jobId: jobs.id,
            jobReference: jobs.reference,
            jobStatus: jobs.status,
          })
          .from(equipment)
          .innerJoin(jobs, eq(jobs.id, equipment.jobId))
          .where(containersWhere)
          .orderBy(asc(equipment.containerNo), asc(equipment.id))
          .limit(w.limit)
          .offset(w.offset)
      },

      () => {
        const w = window('customers')
        if (!w) return none()
        return tx
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
          .where(customersWhere)
          .orderBy(asc(customers.legalNameEn), asc(customers.id))
          .limit(w.limit)
          .offset(w.offset)
      },

      async () => {
        const w = window('records')
        if (!w) return []
        const result = await tx.execute(sql`
          select kind, id, reference, "matchedBill"
            from (${recordsUnion}) r
           order by created_at desc, id
           limit ${w.limit} offset ${w.offset}
        `)
        return result.rows as unknown as {
          kind: RecordKind
          id: string
          reference: string | null
          matchedBill: string | null
        }[]
      },

      async () => ({
        jobs: wanted('jobs')
          ? await count(
              tx
                .select({ n: sql<number>`count(*)::int` })
                .from(jobs)
                .leftJoin(customers, eq(customers.id, jobs.customerId))
                .where(jobsWhere),
            )
          : 0,
        containers: wanted('containers')
          ? await count(
              tx
                .select({ n: sql<number>`count(*)::int` })
                .from(equipment)
                .innerJoin(jobs, eq(jobs.id, equipment.jobId))
                .where(containersWhere),
            )
          : 0,
        customers: wanted('customers')
          ? await count(
              tx
                .select({ n: sql<number>`count(*)::int` })
                .from(customers)
                .where(customersWhere),
            )
          : 0,
        records: wanted('records')
          ? ((
              (await tx.execute(sql`select count(*)::int as n from (${recordsUnion}) r`))
                .rows[0] as { n: number } | undefined
            )?.n ?? 0)
          : 0,
      }),
    ])

    const matched = (reference: string, other: string | null) =>
      tighten(reference).includes(tighten(term)) ? null : other

    return {
      jobs: jobRows.map((row) => {
        const { matchedOn, matchedValue } = classify(
          term,
          {
            reference: row.reference,
            masterBill: row.masterBillNumber,
            houseBill: row.houseBillNumber,
            booking: row.bookingNumber,
            customerReference: row.customerReference,
            customer: row.customerName,
          },
          row.customerNameAr,
        )
        return {
          id: row.id,
          reference: row.reference,
          status: row.status,
          mode: row.mode as Mode,
          customerName: row.customerName ?? '—',
          customerNameAr: pickName('ar', row.customerName, row.customerNameAr) ?? '—',
          originName: row.originName ?? '—',
          originNameAr: pickName('ar', row.originName, row.originNameAr) ?? '—',
          destinationName: row.destinationName ?? '—',
          destinationNameAr: pickName('ar', row.destinationName, row.destinationNameAr) ?? '—',
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
      records: recordRows.map((row) => ({
        kind: row.kind,
        id: row.id,
        reference: row.reference ?? '—',
        matchedValue:
          row.kind === 'consolidation' && row.reference
            ? matched(row.reference, row.matchedBill)
            : null,
      })),
      totals,
    }
  })
}

/**
 * The fixture search cut to the window the database query takes: twenty a
 * group on the overview, or one group's page when focused. The totals are the
 * full lists' lengths, which on fixtures *are* the counts.
 */
function windowed(all: Omit<SearchResults, 'totals'>, focus?: SearchFocus): SearchResults {
  const cut = <T>(section: SearchSection, rows: readonly T[]): readonly T[] => {
    if (focus === undefined) return rows.slice(0, SECTION_PREVIEW)
    if (focus.section !== section) return []
    return pageOf(rows, focus.request).rows
  }
  const counted = (section: SearchSection, rows: readonly unknown[]) =>
    focus === undefined || focus.section === section ? rows.length : 0
  return {
    jobs: cut('jobs', all.jobs),
    containers: cut('containers', all.containers),
    customers: cut('customers', all.customers),
    records: cut('records', all.records),
    totals: {
      jobs: counted('jobs', all.jobs),
      containers: counted('containers', all.containers),
      customers: counted('customers', all.customers),
      records: counted('records', all.records),
    },
  }
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
  customerAr?: string | null,
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

  // Both names, because the `where` matches both: a job found by its
  // customer's Arabic name otherwise fell through to "reference".
  for (const customer of [fields.customer, customerAr]) {
    if (customer && customer.toLowerCase().includes(loose)) {
      return { matchedOn: 'customer', matchedValue: customer }
    }
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
function searchFixtures(term: string): Omit<SearchResults, 'totals'> {
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
    const hitByCustomer = matchesLoose(summary.customerName) || matchesLoose(summary.customerNameAr)

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

  const records: RecordHit[] = [
    ...pilotEnquiries()
      .filter((row) => matchesTight(row.reference))
      .map((row) => ({
        kind: 'enquiry' as const,
        id: row.id,
        reference: row.reference,
        matchedValue: null,
      })),
    ...pilotQuotes()
      .filter((row) => matchesTight(row.reference))
      .map((row) => ({
        kind: 'quote' as const,
        id: row.id,
        reference: row.reference,
        matchedValue: null,
      })),
    ...pilotInvoices()
      .filter((row) => matchesTight(row.seriesNo))
      .map((row) => ({
        kind: 'invoice' as const,
        id: row.id,
        reference: row.seriesNo ?? '—',
        matchedValue: null,
      })),
    ...pilotConsolidations()
      .filter((row) => matchesTight(row.reference) || matchesTight(row.masterBillNumber))
      .map((row) => ({
        kind: 'consolidation' as const,
        id: row.id,
        reference: row.reference,
        matchedValue: matchesTight(row.reference) ? null : row.masterBillNumber,
      })),
  ]

  // Every match; `windowed` takes the overview's twenty or a focused page.
  return {
    records,
    jobs: jobHits.sort((a, b) => (a.eta?.getTime() ?? Infinity) - (b.eta?.getTime() ?? Infinity)),
    containers: containerHits,
    customers: [...customerHits.values()].sort((a, b) =>
      a.legalNameEn.localeCompare(b.legalNameEn),
    ),
  }
}
