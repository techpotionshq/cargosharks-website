import 'server-only'

/**
 * The shipments that should have shared a container — `grouping.ts`, applied.
 *
 * `listAttachableJobs` answers "what else could join *this* master", which is
 * the question asked once a consolidation already exists. This answers the one
 * that comes first and is worth more: *which loose bookings should have been a
 * consolidation at all?*
 *
 * The difference is the whole margin. A coordinator attaching houses to an
 * open master is already consolidating; a coordinator who never noticed that
 * three customers all shipped Shanghai to Shuwaikh that week bought three LCL
 * rates and never priced the FCL that would have carried all three. Nothing in
 * the ledger records that. There is no error, no exception row and no variance
 * — the shipments simply cost what they cost.
 *
 * ## Every filter here is a reason a shipment cannot be grouped
 *
 * Not a heuristic about whether it *should* be. Already consolidated, closed,
 * cancelled, or a full container in its own right — each of those is a fact
 * that makes the suggestion impossible rather than unwise. The judgement calls
 * stay with the coordinator, who knows which customer will not co-load.
 */

import { and, desc, eq, isNull, ne, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { customers, jobs, locations, withActor, type Actor } from '@qabandi/db'
import { clusterShipments, type GroupableShipment, type ShipmentCluster } from '@qabandi/core'

const origin = alias(locations, 'candidate_origin')
const destination = alias(locations, 'candidate_destination')

/**
 * Loose shipments, grouped into the containers they could share.
 *
 * The clustering itself is `core/grouping.ts` and runs in memory: it is
 * arithmetic over a few hundred rows, it is pure, and it is tested in a
 * millisecond against no database. Expressing the window logic in SQL would
 * make it fast and untestable, which is the wrong trade at this size.
 *
 * No branch filter — `withActor` means RLS applies one.
 */
export async function consolidationCandidates(
  actor: Actor,
  limit = 400,
): Promise<ShipmentCluster[]> {
  const rows = await withActor(actor, async (tx) =>
    tx
      .select({
        jobId: jobs.id,
        reference: jobs.reference,
        branchId: jobs.branchId,
        customerId: jobs.customerId,
        customerName: customers.legalNameEn,
        mode: jobs.mode,
        originId: jobs.originId,
        destinationId: jobs.destinationId,
        originName: origin.nameEn,
        destinationName: destination.nameEn,
        readyOn: jobs.etd,
        volumeCbm: jobs.volumeCbm,
        grossWeightKg: jobs.grossWeightKg,
        pieces: jobs.pieces,
      })
      .from(jobs)
      .leftJoin(customers, eq(customers.id, jobs.customerId))
      .leftJoin(origin, eq(origin.id, jobs.originId))
      .leftJoin(destination, eq(destination.id, jobs.destinationId))
      .where(
        and(
          isNull(jobs.consolidationId),
          isNull(jobs.closedAt),
          isNull(jobs.cancelledAt),
          /*
            Groupable modes only.

            `sea_fcl` is excluded because a full container is already the whole
            box — there is nothing to share and proposing it would be proposing
            to unpack somebody's shipment. `land` and `courier` are excluded
            because neither is bought by the container, so the arithmetic this
            screen does has nothing to say about them.

            `sea_lcl` and `air` are what remain, and they are exactly the two
            where a consolidator buys space wholesale and sells it retail.
          */
          or(eq(jobs.mode, 'sea_lcl'), eq(jobs.mode, 'air')),
          // A cancelled-in-all-but-name shipment is not a candidate either.
          ne(jobs.status, 'cancelled'),
          /*
            Something to measure, or there is nothing to add up.

            A booking with neither a volume nor a weight contributes zero to
            every total and would sit in a cluster making it look emptier than
            it is — worse than being absent, because a coordinator reading
            "18 CBM across four shipments" would be reading a figure for three.
          */
          sql`(${jobs.volumeCbm} is not null or ${jobs.grossWeightKg} is not null)`,
        ),
      )
      /*
        Newest first, so the cap below is a statement and not an accident.

        This had a `limit` and no ordering, which meant the four hundred loose
        shipments considered were whichever ones Postgres returned first — and
        on a database nothing is deleted from, that was the oldest. The full
        suite caught it: three fresh bookings on a busy lane were never offered,
        because four hundred older fixtures took every slot. In production the
        same thing would silently drop this week's bookings from the screen
        whose only job is this week's bookings.

        Ordered by creation, the cap means "the most recent loose shipments",
        which is the set a coordinator would have chosen by hand.
      */
      .orderBy(desc(jobs.createdAt))
      .limit(limit),
  )

  return clusterShipments(rows.map(toShipment))
}

/**
 * A row as the engine wants it.
 *
 * `numeric` arrives as a string and is parsed here, at the boundary, which is
 * the one place in this system where that is right: these figures are summed
 * for a suggestion and never written back. Nothing downstream of a cluster
 * total reaches a `numeric` column — the consolidation it creates carries no
 * cargo figures of its own, and the houses keep the exact values they already
 * hold.
 */
function toShipment(row: {
  jobId: string
  reference: string
  branchId: string
  customerId: string | null
  customerName: string | null
  mode: string
  originId: string | null
  destinationId: string | null
  originName: string | null
  destinationName: string | null
  readyOn: Date | null
  volumeCbm: string | null
  grossWeightKg: string | null
  pieces: number | null
}): GroupableShipment {
  return {
    jobId: row.jobId,
    reference: row.reference,
    branchId: row.branchId,
    customerId: row.customerId,
    customerName: row.customerName,
    mode: row.mode,
    originId: row.originId,
    destinationId: row.destinationId,
    originName: row.originName,
    destinationName: row.destinationName,
    readyOn: row.readyOn ? new Date(row.readyOn) : null,
    volumeCbm: numeric(row.volumeCbm),
    grossWeightKg: numeric(row.grossWeightKg),
    pieces: row.pieces,
  }
}

function numeric(value: string | null): number | null {
  if (value === null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
