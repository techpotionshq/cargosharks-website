/**
 * SLA escalation — FR-EQ-01, every fifteen minutes (§9).
 *
 * `sla_due_at` was computed at creation through the branch's working calendar,
 * so this job is a cheap comparison rather than a re-derivation per row: the
 * partial index `enquiries_sla_open_idx` answers it directly.
 *
 * One working-calendar duration function serves enquiry SLA, customs SLA and
 * exception ageing (NFR-03) — the same `core/clocks.ts` this job's due dates
 * came from.
 */

import { and, eq, isNotNull, isNull, lt } from 'drizzle-orm'
import { enquiries, notificationOutbox, systemActor, withActor } from '@qabandi/db'

export async function runSlaEscalation(asOf = new Date()): Promise<{ escalated: number }> {
  return withActor(systemActor(), async (tx) => {
    const breached = await tx
      .select({
        id: enquiries.id,
        branchId: enquiries.branchId,
        reference: enquiries.reference,
        customerId: enquiries.customerId,
        ownerId: enquiries.ownerId,
      })
      .from(enquiries)
      .where(
        and(
          isNull(enquiries.firstRespondedAt),
          isNull(enquiries.closedAt),
          // Escalated once, not every fifteen minutes forever. An escalation
          // that repeats is an escalation that gets filtered out of an inbox.
          isNull(enquiries.escalatedAt),
          isNotNull(enquiries.slaDueAt),
          lt(enquiries.slaDueAt, asOf),
        ),
      )
      .limit(200)

    for (const row of breached) {
      await tx.update(enquiries).set({ escalatedAt: asOf }).where(eq(enquiries.id, row.id))

      await tx.insert(notificationOutbox).values({
        branchId: row.branchId,
        eventKey: 'enquiry.sla_breached',
        enquiryId: row.id,
        customerId: row.customerId,
        payload: { reference: row.reference, ownerId: row.ownerId },
      })
    }

    return { escalated: breached.length }
  })
}
