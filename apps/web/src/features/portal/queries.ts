/**
 * The customer portal's reads — `FR-CP-03`, `FR-CP-04`.
 *
 * The same tables and the same shapes as the operations board, run under a
 * different principal. A customer contact sees their own shipments because the
 * `customer_contact` arm of the RLS policy matches their `app.customer_id`
 * (§5.3) — not because this file filters anything. There is no `where
 * customer_id = ?` below, and its absence is the security property.
 *
 * What differs from the ops board is the *projection*: no owner, no margin, no
 * internal exception, no unreleased document. Those columns are not filtered
 * out of the response; they are never selected.
 */

import 'server-only'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  documentTypes,
  documents,
  jobMilestones,
  jobs,
  locations,
  withActor,
  type Actor,
} from '@qabandi/db'
import type { Mode, PortalShipment } from '@/lib/pilot/types'
import { usePilotFixtures } from '@/lib/pilot/source'
import { pilotPortalShipments } from '@/lib/pilot/fixtures'

const origin = alias(locations, 'origin')
const destination = alias(locations, 'destination')

export async function listPortalShipments(actor: Actor): Promise<PortalShipment[]> {
  if (usePilotFixtures()) return pilotPortalShipments()

  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({
        id: jobs.id,
        reference: jobs.reference,
        customerReference: jobs.customerReference,
        status: jobs.status,
        mode: jobs.mode,
        eta: jobs.eta,
        originName: origin.nameEn,
        destinationName: destination.nameEn,
        milestonesTotal: sql<number>`(
          select count(*)::int from ${jobMilestones}
           where ${jobMilestones.jobId} = ${jobs.id}
             and ${jobMilestones.customerVisible} = true
        )`,
        milestonesDone: sql<number>`(
          select count(*)::int from ${jobMilestones}
           where ${jobMilestones.jobId} = ${jobs.id}
             and ${jobMilestones.customerVisible} = true
             and ${jobMilestones.actualAt} is not null
        )`,
        // Released only. A draft on the job is not a customer document.
        documentsReleased: sql<number>`(
          select count(*)::int from ${documents}
           join ${documentTypes} on ${documentTypes.id} = ${documents.documentTypeId}
           where ${documents.jobId} = ${jobs.id}
             and ${documents.releasedAt} is not null
             and ${documents.supersededById} is null
             and ${documentTypes.isCustomerVisible} = true
        )`,
        nextMilestone: sql<string | null>`(
          select ${jobMilestones.nameEn} from ${jobMilestones}
           where ${jobMilestones.jobId} = ${jobs.id}
             and ${jobMilestones.customerVisible} = true
             and ${jobMilestones.actualAt} is null
           order by ${jobMilestones.seq}
           limit 1
        )`,
      })
      .from(jobs)
      .leftJoin(origin, eq(origin.id, jobs.originId))
      .leftJoin(destination, eq(destination.id, jobs.destinationId))
      .where(and(isNull(jobs.cancelledAt), sql`${jobs.status} <> 'draft'`))
      .orderBy(asc(jobs.eta))
      .limit(50)

    return rows.map((row) => ({
      id: row.id,
      reference: row.reference,
      customerReference: row.customerReference,
      status: row.status,
      mode: row.mode as Mode,
      originName: row.originName ?? '—',
      destinationName: row.destinationName ?? '—',
      eta: row.eta,
      milestonesTotal: row.milestonesTotal,
      milestonesDone: row.milestonesDone,
      documentsReleased: row.documentsReleased,
      nextMilestone: row.nextMilestone,
    }))
  })
}
