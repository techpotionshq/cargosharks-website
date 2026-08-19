/**
 * Carrier events onto jobs — the ingestion half of `CarrierTracking`.
 *
 * A webhook has been received, verified and recorded; this turns it into a
 * completed milestone on the right shipment, or refuses and says why.
 *
 * ## Attribution refuses ambiguity
 *
 * The identifiers are tried in descending order of trust — our own job
 * reference, then the bill of lading, then the container number — and **a
 * match that finds more than one job is treated as no match at all**.
 *
 * That is the decision worth defending. A container number is reused every few
 * weeks and a house bill can repeat across carriers and years, so "the first
 * job that matched" is a coin flip. An unattributed event costs an operator
 * the manual entry they were already doing; a misattributed one writes a false
 * history onto a real shipment, and nobody finds it until a demurrage dispute
 * turns on when the box was actually discharged.
 *
 * ## Attribution is all this file does
 *
 * Deciding *which job* is the risk here; deciding what to write is the same
 * problem the poll feed has, so it lives once in `carrier-milestone.ts` and
 * both feeds call it. Two copies would have grown two answers to "does the
 * feed overwrite a hand-entered date", and nobody would find out until a
 * demurrage dispute turned on a discharge the two paths disagreed about.
 */

import { and, eq, isNull, or } from 'drizzle-orm'
import { inboundWebhookEvents, jobs, systemActor, withActor } from '@qabandi/db'
import { readCarrierWebhook, type Terminal49Webhook } from '../adapters/carrier-webhook'
import { writeCarrierMilestone } from './carrier-milestone'

export interface CarrierEventResult {
  readonly status: 'written' | 'preserved' | 'unattributed' | 'ignored' | 'ambiguous'
  readonly jobReference?: string
  readonly code?: string
  readonly reason?: string
}

export async function runCarrierEventIngest(eventId: string): Promise<CarrierEventResult> {
  return withActor(systemActor(), async (tx) => {
    const [received] = await tx
      .select({ payload: inboundWebhookEvents.payload })
      .from(inboundWebhookEvents)
      .where(eq(inboundWebhookEvents.id, eventId))
      .limit(1)

    if (!received) return { status: 'ignored', reason: 'no such webhook event' }

    const envelope = readCarrierWebhook(received.payload as Terminal49Webhook)

    if (!envelope.milestone) {
      // Lifecycle events and estimate revisions land here. Recorded by the
      // webhook table already; nothing to do and nothing to retry.
      return { status: 'ignored', reason: envelope.reason }
    }

    /*
      Our own reference first, because we chose it.

      It was sent at submission in `ref_numbers` and echoed back on every
      event, so when it is present there is no guessing to do.
    */
    const candidates = envelope.jobReference
      ? await tx
          .select({ id: jobs.id, reference: jobs.reference, mode: jobs.mode })
          .from(jobs)
          .where(eq(jobs.reference, envelope.jobReference))
          .limit(2)
      : []

    /*
      Then the bills of lading, and only if the reference found nothing.

      `limit(2)` rather than `limit(1)` on purpose: one row is a match, two is
      an ambiguity, and asking for one would silently pick whichever the
      planner happened to return first.
    */
    const matched =
      candidates.length > 0
        ? candidates
        : envelope.billOfLading
          ? await tx
              .select({ id: jobs.id, reference: jobs.reference, mode: jobs.mode })
              .from(jobs)
              .where(
                and(
                  isNull(jobs.closedAt),
                  or(
                    eq(jobs.masterBillNumber, envelope.billOfLading),
                    eq(jobs.houseBillNumber, envelope.billOfLading),
                  ),
                ),
              )
              .limit(2)
          : []

    if (matched.length === 0) {
      return {
        status: 'unattributed',
        code: envelope.milestone.code,
        reason: `no job for ref=${envelope.jobReference ?? '-'} bl=${envelope.billOfLading ?? '-'}`,
      }
    }

    if (matched.length > 1) {
      return {
        status: 'ambiguous',
        code: envelope.milestone.code,
        reason: `${envelope.billOfLading ?? envelope.jobReference} matches more than one open job`,
      }
    }

    const job = matched[0]!

    const write = await writeCarrierMilestone(tx, job, envelope.milestone)

    return { ...write, jobReference: job.reference }
  })
}
