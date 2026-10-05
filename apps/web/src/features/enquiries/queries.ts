/**
 * Enquiry reads — Moment 3a.
 *
 * Every query runs inside `withActor`, so none of them carries a branch
 * filter: RLS applies it. That absence is the point — a `where branch_id = ?`
 * here would be a second, forgettable copy of a rule the database already
 * enforces, and the day someone omits it is the day another branch's data
 * leaks. What is not written cannot be forgotten (§5).
 */

import 'server-only'
import { and, asc, desc, eq, isNull, lt, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  branches,
  commodities,
  customers,
  enquiries,
  locations,
  principals,
  quotes,
  withActor,
  type Actor,
  type Tx,
} from '@qabandi/db'
import type { EnquiryEditLike, EnquirySummary, Mode } from '@/lib/pilot/types'
import { named } from '@/lib/named'
import { usePilotFixtures } from '@/lib/pilot/source'
import { pageOf, pageRequest, readPage, type Page, type PageRequest } from '@/lib/paging'
import { pilotEnquiries, pilotEnquiryForEdit } from '@/lib/pilot/fixtures'

const origin = alias(locations, 'origin')
const destination = alias(locations, 'destination')

export interface EnquiryListFilters {
  readonly status?: string
  readonly ownerId?: string
  readonly overdueOnly?: boolean
  readonly unassignedOnly?: boolean
}

/*
  There was a keyset cursor here (`after: { createdAt, id }`), and no screen
  used it: it continued by creation time while the queue sorts by deadline, so
  the "next page" it produced was not the next page of anything on screen. The
  queue pages like every other register now (`lib/paging.ts`).
*/

const OPEN = ['new', 'assigned', 'rating', 'quoted']

/**
 * `locale` names the ports in the reader's language (F27). The customer
 * already arrives in both, as `customerName` and `customerNameAr`, because the
 * dashboard shares this row shape and picks for itself.
 */
/** The fixture queue, filtered and sorted as the query below does it. */
function pilotEnquiriesMatching(
  filters: EnquiryListFilters,
  locale: 'en' | 'ar',
  now: number,
): EnquirySummary[] {
  let rows = pilotEnquiries(now, locale)
  if (filters.status === 'open') rows = rows.filter((r) => OPEN.includes(r.status))
  else if (filters.status) rows = rows.filter((r) => r.status === filters.status)
  if (filters.unassignedOnly) rows = rows.filter((r) => r.owner === null)
  if (filters.overdueOnly) {
    rows = rows.filter(
      (r) => r.firstRespondedAt === null && r.slaDueAt !== null && r.slaDueAt.getTime() < now,
    )
  }
  return rows.sort((a, b) => {
    // Unanswered and closest to breach first: the queue's whole job is to
    // put the thing that will hurt at the top.
    const aDue = a.firstRespondedAt === null ? (a.slaDueAt?.getTime() ?? Infinity) : Infinity
    const bDue = b.firstRespondedAt === null ? (b.slaDueAt?.getTime() ?? Infinity) : Infinity
    return aDue - bDue || b.createdAt.getTime() - a.createdAt.getTime()
  })
}

/** The queue's filter as SQL, shared by the page and its count. */
function enquiriesWhere(filters: EnquiryListFilters) {
  return and(
    filters.status === 'open'
      ? sql`${enquiries.status} in ('new','assigned','rating','quoted')`
      : filters.status
        ? sql`${enquiries.status} = ${filters.status}`
        : undefined,
    filters.ownerId ? eq(enquiries.ownerId, filters.ownerId) : undefined,
    filters.unassignedOnly ? isNull(enquiries.ownerId) : undefined,
    filters.overdueOnly
      ? and(isNull(enquiries.firstRespondedAt), lt(enquiries.slaDueAt, new Date()))
      : undefined,
  )
}

export async function listEnquiries(
  actor: Actor,
  filters: EnquiryListFilters = {},
  locale: 'en' | 'ar' = 'en',
  request: PageRequest = pageRequest(undefined),
): Promise<Page<EnquirySummary>> {
  if (usePilotFixtures()) {
    return pageOf(pilotEnquiriesMatching(filters, locale, Date.now()), request)
  }

  return withActor(actor, (tx) =>
    readPage(
      request,
      (limit, offset) => readEnquiryRows(tx, filters, locale, limit, offset),
      async () => {
        const [row] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(enquiries)
          .where(enquiriesWhere(filters))
        return row?.n ?? 0
      },
    ),
  )
}

export interface EnquiryQueueCounts {
  readonly open: number
  readonly unassigned: number
  readonly overdue: number
  readonly quoted: number
  /** Mean quoted margin over open enquiries with a current priced quote, in percent. */
  readonly avgMargin: number
}

/**
 * The queue's headline figures and filter counts, counted in the database.
 *
 * The page used to fetch the open queue and the quoted list a hundred rows
 * each and count those, so past a hundred open enquiries every figure on the
 * strip quietly became "100 or fewer". Counted here over every row, in one
 * statement, so the strip agrees with what each filter will page through.
 */
export async function countEnquiries(actor: Actor): Promise<EnquiryQueueCounts> {
  if (usePilotFixtures()) {
    const now = Date.now()
    const open = pilotEnquiriesMatching({ status: 'open' }, 'en', now)
    const priced = open.filter((r) => r.quotedMargin !== null)
    return {
      open: open.length,
      unassigned: pilotEnquiriesMatching({ status: 'open', unassignedOnly: true }, 'en', now)
        .length,
      overdue: pilotEnquiriesMatching({ status: 'open', overdueOnly: true }, 'en', now).length,
      quoted: pilotEnquiriesMatching({ status: 'quoted' }, 'en', now).length,
      avgMargin:
        priced.reduce((sum, r) => sum + (r.quotedMargin ?? 0), 0) / Math.max(priced.length, 1),
    }
  }

  return withActor(actor, async (tx) => {
    const [row] = await tx
      .select({
        open: sql<number>`count(*)::int`,
        unassigned: sql<number>`(count(*) filter (where ${enquiries.ownerId} is null))::int`,
        overdue: sql<number>`(count(*) filter (
          where ${enquiries.firstRespondedAt} is null and ${enquiries.slaDueAt} < now()
        ))::int`,
        quoted: sql<number>`(count(*) filter (where ${enquiries.status} = 'quoted'))::int`,
        /*
          The same rounding the row applies (one decimal of a percent), averaged
          as the page used to average the rows: a display figure, so a float is
          the honest type, and no money is computed from it.

          A correlated subquery rather than a join: an enquiry can carry two
          unsuperseded quotes for a moment, and a join would count it twice in
          every figure above. Qualified SQL, because with one table in the
          `from` Drizzle would print a bare "id" (check-boundaries rule 3).
        */
        avgMargin: sql<number>`coalesce(avg((
          select round(((q.total_sell - q.total_cost) / nullif(q.total_sell, 0)) * 100, 1)
            from quotes q
           where q.enquiry_id = "enquiries"."id" and q.superseded_by_id is null
           order by q.created_at desc
           limit 1
        )), 0)::float8`,
      })
      .from(enquiries)
      .where(enquiriesWhere({ status: 'open' }))
    return {
      open: row?.open ?? 0,
      unassigned: row?.unassigned ?? 0,
      overdue: row?.overdue ?? 0,
      quoted: row?.quoted ?? 0,
      avgMargin: Number(row?.avgMargin ?? 0),
    }
  })
}

async function readEnquiryRows(
  tx: Tx,
  filters: EnquiryListFilters,
  locale: 'en' | 'ar',
  limit: number,
  offset: number,
): Promise<EnquirySummary[]> {
  const rows = await tx
    .select({
      id: enquiries.id,
      reference: enquiries.reference,
      status: enquiries.status,
      channel: enquiries.channel,
      mode: enquiries.mode,
      createdAt: enquiries.createdAt,
      slaDueAt: enquiries.slaDueAt,
      firstRespondedAt: enquiries.firstRespondedAt,
      branchCode: branches.code,
      customerName: customers.legalNameEn,
      customerNameAr: customers.legalNameAr,
      contactName: enquiries.contactName,
      contactEmail: enquiries.contactEmail,
      owner: named(locale, principals.nameEn, principals.nameAr),
      originName: named(locale, origin.nameEn, origin.nameAr),
      destinationName: named(locale, destination.nameEn, destination.nameAr),
      quotedSell: quotes.totalSell,
      quotedCost: quotes.totalCost,
      quotedCurrency: quotes.currency,
    })
    .from(enquiries)
    .leftJoin(branches, eq(branches.id, enquiries.branchId))
    .leftJoin(customers, eq(customers.id, enquiries.customerId))
    .leftJoin(principals, eq(principals.id, enquiries.ownerId))
    .leftJoin(origin, eq(origin.id, enquiries.originId))
    .leftJoin(destination, eq(destination.id, enquiries.destinationId))
    // The current quote only: a superseded revision is not this enquiry's price.
    .leftJoin(quotes, and(eq(quotes.enquiryId, enquiries.id), isNull(quotes.supersededById)))
    .where(enquiriesWhere(filters))
    // Unanswered first, closest to breach first — the fixture branch above
    // sorts the same way. An answered enquiry's deadline no longer threatens
    // anything, so it must not hold a new one down the queue.
    .orderBy(
      sql`${enquiries.firstRespondedAt} is not null`,
      asc(enquiries.slaDueAt),
      desc(enquiries.createdAt),
      // A unique tail, so two enquiries created in the same instant cannot
      // swap places between page one and page two.
      asc(enquiries.id),
    )
    .limit(limit)
    .offset(offset)

  return rows.map((row): EnquirySummary => {
    const sell = row.quotedSell === null ? null : Number(row.quotedSell)
    const cost = row.quotedCost === null ? null : Number(row.quotedCost)
    return {
      id: row.id,
      reference: row.reference,
      /*
          The joined branch, not a slice of the reference.

          This read `reference.split('-')[1]`, which is the branch in the pilot
          fixtures — they number enquiries `ENQ-KWI-2026-0001` — and is the
          literal string `ENQ` on a real database, where the action writes
          `KWI-ENQ-2026-00001`. Two reference formats, one derivation written
          against the wrong one, and nothing to notice it because the demo path
          agreed with itself.
        */
      branchCode: row.branchCode ?? '',
      status: row.status,
      channel: row.channel,
      mode: row.mode as Mode | null,
      /*
          An enquiry from a company we have never shipped for has no customer
          row, and that is the normal state of a new lead (FR-EQ-02) — not
          missing data. Falling straight to an em-dash rendered the most
          interesting row in the queue as anonymous.
        */
      customerName: row.customerName ?? row.contactName ?? row.contactEmail ?? '—',
      // `||` for the Arabic name: an empty one is as unset as a null one.
      customerNameAr:
        row.customerNameAr || row.customerName || row.contactName || row.contactEmail || '—',
      originName: row.originName ?? '—',
      destinationName: row.destinationName ?? '—',
      owner: row.owner,
      createdAt: row.createdAt,
      slaDueAt: row.slaDueAt,
      firstRespondedAt: row.firstRespondedAt,
      // In the quotation's own currency. It was labelled KWD whatever the
      // quote was in — a Dubai branch's AED quotes read as dinars (S16).
      quotedSell: sell === null ? null : { amount: sell, currency: row.quotedCurrency ?? 'KWD' },
      quotedMargin:
        sell === null || cost === null || sell === 0
          ? null
          : Math.round(((sell - cost) / sell) * 1000) / 10,
    }
  })
}

/**
 * A single enquiry.
 *
 * Returns undefined for another branch's enquiry — not because this checks,
 * but because the row is invisible to the query. That is FR-ID-04 satisfied
 * literally: not-found rather than forbidden, with no enumeration signal.
 */
export async function getEnquiry(actor: Actor, id: string) {
  if (usePilotFixtures()) return pilotEnquiries().find((e) => e.id === id)

  return withActor(actor, async (tx) => {
    const [row] = await tx.select().from(enquiries).where(eq(enquiries.id, id)).limit(1)
    return row
  })
}

/**
 * The editable facts of one enquiry, for the "Edit details" dialog.
 *
 * The current customer, ports and commodity come back with their labels as well
 * as their ids: `loadOptions` caps each list, and a select whose value is not
 * among its options submits nothing — so saving the dialog unchanged on an
 * enquiry to a port past the cap would have cleared the port. The dialog adds
 * the current row back when the list left it out.
 */
export async function enquiryForEdit(
  actor: Actor,
  id: string,
  locale: 'en' | 'ar' = 'en',
): Promise<EnquiryEditLike | undefined> {
  if (usePilotFixtures()) return pilotEnquiryForEdit(id)

  return withActor(actor, async (tx) => {
    const [row] = await tx
      .select({
        id: enquiries.id,
        branchId: enquiries.branchId,
        status: enquiries.status,
        customerId: enquiries.customerId,
        customerLabel: sql<string | null>`case when ${customers.id} is null then null
          else ${customers.code} || ' — ' || ${named(locale, customers.legalNameEn, customers.legalNameAr)} end`,
        contactName: enquiries.contactName,
        contactEmail: enquiries.contactEmail,
        mode: enquiries.mode,
        tradeDirection: enquiries.tradeDirection,
        originId: enquiries.originId,
        originLabel: sql<string | null>`case when ${origin.id} is null then null
          else coalesce(${origin.unlocode} || ' — ', '') || ${named(locale, origin.nameEn, origin.nameAr)} end`,
        destinationId: enquiries.destinationId,
        destinationLabel: sql<string | null>`case when ${destination.id} is null then null
          else coalesce(${destination.unlocode} || ' — ', '') || ${named(locale, destination.nameEn, destination.nameAr)} end`,
        commodityId: enquiries.commodityId,
        commodityLabel: sql<string | null>`case when ${commodities.id} is null then null
          else ${commodities.code} || ' — ' || ${named(locale, commodities.nameEn, commodities.nameAr)} end`,
        incoterm: enquiries.incoterm,
        readyOn: enquiries.readyOn,
        grossWeightKg: enquiries.grossWeightKg,
        volumeCbm: enquiries.volumeCbm,
        pieces: enquiries.pieces,
        containerCount: enquiries.containerCount,
        containerType: enquiries.containerType,
        isDangerous: enquiries.isDangerous,
        notes: enquiries.notes,
        updatedAt: enquiries.updatedAt,
      })
      .from(enquiries)
      .leftJoin(customers, eq(customers.id, enquiries.customerId))
      .leftJoin(origin, eq(origin.id, enquiries.originId))
      .leftJoin(destination, eq(destination.id, enquiries.destinationId))
      .leftJoin(commodities, eq(commodities.id, enquiries.commodityId))
      .where(eq(enquiries.id, id))
      .limit(1)
    if (!row) return undefined
    const { updatedAt, ...facts } = row
    return { ...facts, version: updatedAt.toISOString() }
  })
}
