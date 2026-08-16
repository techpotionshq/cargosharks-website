/**
 * Enquiry reads.
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
import { customers, enquiries, locations, principals, withActor, type Actor } from '@qabandi/db'

const origin = alias(locations, 'origin')
const destination = alias(locations, 'destination')

export interface EnquiryListFilters {
  readonly status?: 'new' | 'assigned' | 'rating' | 'quoted'
  readonly ownerId?: string
  readonly overdueOnly?: boolean
  /** Keyset pagination — §12. No OFFSET, so page 400 costs what page 1 does. */
  readonly after?: { createdAt: Date; id: string }
  readonly limit?: number
}

export async function listEnquiries(actor: Actor, filters: EnquiryListFilters = {}) {
  const limit = Math.min(filters.limit ?? 50, 200)

  return withActor(actor, async (tx) => {
    return tx
      .select({
        id: enquiries.id,
        reference: enquiries.reference,
        status: enquiries.status,
        mode: enquiries.mode,
        createdAt: enquiries.createdAt,
        slaDueAt: enquiries.slaDueAt,
        firstRespondedAt: enquiries.firstRespondedAt,
        customerName: customers.legalNameEn,
        customerNameAr: customers.legalNameAr,
        ownerName: principals.nameEn,
        originName: origin.nameEn,
        destinationName: destination.nameEn,
      })
      .from(enquiries)
      .leftJoin(customers, eq(customers.id, enquiries.customerId))
      .leftJoin(principals, eq(principals.id, enquiries.ownerId))
      .leftJoin(origin, eq(origin.id, enquiries.originId))
      .leftJoin(destination, eq(destination.id, enquiries.destinationId))
      .where(
        and(
          filters.status ? eq(enquiries.status, filters.status) : undefined,
          filters.ownerId ? eq(enquiries.ownerId, filters.ownerId) : undefined,
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
      .orderBy(desc(enquiries.createdAt), desc(enquiries.id))
      .limit(limit)
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
  return withActor(actor, async (tx) => {
    const [row] = await tx.select().from(enquiries).where(eq(enquiries.id, id)).limit(1)
    return row
  })
}

/** Counts for the ops board tiles, in one round trip. */
export async function enquiryBoardCounts(actor: Actor) {
  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({
        status: enquiries.status,
        total: sql<number>`count(*)::int`,
        overdue: sql<number>`
          count(*) filter (
            where ${enquiries.firstRespondedAt} is null and ${enquiries.slaDueAt} < now()
          )::int`,
      })
      .from(enquiries)
      .where(isNull(enquiries.closedAt))
      .groupBy(enquiries.status)
      .orderBy(asc(enquiries.status))

    return rows
  })
}
