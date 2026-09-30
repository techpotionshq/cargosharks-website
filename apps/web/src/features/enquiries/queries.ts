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
import { and, asc, desc, eq, isNull, lt, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  branches,
  customers,
  enquiries,
  locations,
  principals,
  quotes,
  withActor,
  type Actor,
} from '@qabandi/db'
import type { EnquirySummary, Mode } from '@/lib/pilot/types'
import { usePilotFixtures } from '@/lib/pilot/source'
import { pilotEnquiries } from '@/lib/pilot/fixtures'

const origin = alias(locations, 'origin')
const destination = alias(locations, 'destination')

export interface EnquiryListFilters {
  readonly status?: string
  readonly ownerId?: string
  readonly overdueOnly?: boolean
  readonly unassignedOnly?: boolean
  /** Keyset pagination — §12. No OFFSET, so page 400 costs what page 1 does. */
  readonly after?: { createdAt: Date; id: string }
  readonly limit?: number
}

const OPEN = ['new', 'assigned', 'rating', 'quoted']

export async function listEnquiries(
  actor: Actor,
  filters: EnquiryListFilters = {},
): Promise<EnquirySummary[]> {
  const limit = Math.min(filters.limit ?? 50, 200)

  if (usePilotFixtures()) {
    const now = Date.now()
    let rows = pilotEnquiries(now)
    if (filters.status === 'open') rows = rows.filter((r) => OPEN.includes(r.status))
    else if (filters.status) rows = rows.filter((r) => r.status === filters.status)
    if (filters.unassignedOnly) rows = rows.filter((r) => r.owner === null)
    if (filters.overdueOnly) {
      rows = rows.filter(
        (r) => r.firstRespondedAt === null && r.slaDueAt !== null && r.slaDueAt.getTime() < now,
      )
    }
    return rows
      .sort((a, b) => {
        // Unanswered and closest to breach first: the queue's whole job is to
        // put the thing that will hurt at the top.
        const aDue = a.firstRespondedAt === null ? (a.slaDueAt?.getTime() ?? Infinity) : Infinity
        const bDue = b.firstRespondedAt === null ? (b.slaDueAt?.getTime() ?? Infinity) : Infinity
        return aDue - bDue || b.createdAt.getTime() - a.createdAt.getTime()
      })
      .slice(0, limit)
  }

  return withActor(actor, async (tx) => {
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
        owner: principals.nameEn,
        originName: origin.nameEn,
        destinationName: destination.nameEn,
        quotedSell: quotes.totalSell,
        quotedCost: quotes.totalCost,
      })
      .from(enquiries)
      .leftJoin(branches, eq(branches.id, enquiries.branchId))
      .leftJoin(customers, eq(customers.id, enquiries.customerId))
      .leftJoin(principals, eq(principals.id, enquiries.ownerId))
      .leftJoin(origin, eq(origin.id, enquiries.originId))
      .leftJoin(destination, eq(destination.id, enquiries.destinationId))
      // The current quote only: a superseded revision is not this enquiry's price.
      .leftJoin(quotes, and(eq(quotes.enquiryId, enquiries.id), isNull(quotes.supersededById)))
      .where(
        and(
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
          filters.after
            ? or(
                lt(enquiries.createdAt, filters.after.createdAt),
                and(
                  eq(enquiries.createdAt, filters.after.createdAt),
                  lt(enquiries.id, filters.after.id),
                ),
              )
            : undefined,
        ),
      )
      // Unanswered first, closest to breach first — the fixture branch above
      // sorts the same way. An answered enquiry's deadline no longer threatens
      // anything, so it must not hold a new one down the queue.
      .orderBy(
        sql`${enquiries.firstRespondedAt} is not null`,
        asc(enquiries.slaDueAt),
        desc(enquiries.createdAt),
      )
      .limit(limit)

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
        customerNameAr:
          row.customerNameAr ?? row.customerName ?? row.contactName ?? row.contactEmail ?? '—',
        originName: row.originName ?? '—',
        destinationName: row.destinationName ?? '—',
        owner: row.owner,
        createdAt: row.createdAt,
        slaDueAt: row.slaDueAt,
        firstRespondedAt: row.firstRespondedAt,
        quotedSell: sell === null ? null : { amount: sell, currency: 'KWD' },
        quotedMargin:
          sell === null || cost === null || sell === 0
            ? null
            : Math.round(((sell - cost) / sell) * 1000) / 10,
      }
    })
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
