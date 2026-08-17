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
 * ## Writing a milestone is an upsert, not an insert
 *
 * `job_milestones_unique` is `(job_id, code)`. Providers redeliver, and
 * carriers correct their own timestamps hours later — so an event that arrives
 * twice must update the date it carries rather than fail or duplicate. The
 * conflict target is the natural key, which means idempotency comes from the
 * schema rather than from remembering to check first.
 */

import { and, eq, isNull, or, sql } from 'drizzle-orm'
import {
  inboundWebhookEvents,
  jobMilestones,
  jobs,
  milestoneTemplates,
  systemActor,
  withActor,
} from '@qabandi/db'
import { readCarrierWebhook, type Terminal49Webhook } from '../adapters/carrier-webhook'

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

    /*
      Names come from the milestone template for this mode.

      `job_milestones.name_en` and `name_ar` are `not null` because every
      document and board renders bilingually (§11). A carrier feed supplies a
      code and a date, never an Arabic name — so the template is what makes an
      automatically-created milestone indistinguishable from a hand-entered
      one, which is the point.
    */
    const [template] = await tx
      .select({
        nameEn: milestoneTemplates.nameEn,
        nameAr: milestoneTemplates.nameAr,
        seq: milestoneTemplates.seq,
        ownerRole: milestoneTemplates.ownerRole,
        customerVisible: milestoneTemplates.customerVisible,
      })
      .from(milestoneTemplates)
      .where(
        and(
          eq(milestoneTemplates.code, envelope.milestone.code),
          eq(milestoneTemplates.mode, job.mode),
          eq(milestoneTemplates.isActive, true),
        ),
      )
      .limit(1)

    if (!template) {
      /*
        A code with no template for this mode is not written.

        The board, the SLA clocks and the customer portal are all driven by the
        template — sequence, ownership, visibility. A milestone without one
        would appear out of order, belong to nobody, and be visible to a
        customer by whichever default the column carries.
      */
      return {
        status: 'ignored',
        jobReference: job.reference,
        code: envelope.milestone.code,
        reason: `no ${job.mode} template for ${envelope.milestone.code}`,
      }
    }

    const written = await tx
      .insert(jobMilestones)
      .values({
        jobId: job.id,
        code: envelope.milestone.code,
        nameEn: template.nameEn,
        nameAr: template.nameAr,
        seq: template.seq,
        ownerRole: template.ownerRole,
        customerVisible: template.customerVisible,
        actualAt: envelope.milestone.occurredAt,
        notes: envelope.milestone.location
          ? `Carrier feed · ${envelope.milestone.location}`
          : 'Carrier feed',
      })
      .onConflictDoUpdate({
        target: [jobMilestones.jobId, jobMilestones.code],
        set: {
          actualAt: envelope.milestone.occurredAt,
          notes: sql`excluded.notes`,
        },
        /*
          A hand-entered completion is not overwritten by a later feed.

          An operator who marked a milestone complete did so with information
          the carrier may not have — a phone call from the terminal — and
          having the feed silently move that date hours later would make the
          board argue with the person reading it. The feed fills gaps and
          corrects its *own* dates; it does not overrule a human.
        */
        setWhere: or(
          isNull(jobMilestones.actualAt),
          sql`${jobMilestones.notes} like 'Carrier feed%'`,
        ),
      })
      /*
        `returning` is how we learn whether the guard above fired.

        `on conflict do update ... where` returns no row when its condition
        fails, so an empty result means the milestone was left as a human
        entered it. Without this the worker logged "written" for an event that
        changed nothing — and the log is what somebody reads at 2am when a
        customer asks why a discharge date moved. Reporting the wrong outcome
        is worse than reporting none.
      */
      .returning({ id: jobMilestones.id })

    if (written.length === 0) {
      return {
        status: 'preserved',
        jobReference: job.reference,
        code: envelope.milestone.code,
        reason: 'a hand-entered completion already stands here',
      }
    }

    return {
      status: 'written',
      jobReference: job.reference,
      code: envelope.milestone.code,
    }
  })
}
