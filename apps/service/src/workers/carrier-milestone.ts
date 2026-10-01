/**
 * Writing one carrier milestone onto one job — the half no feed may own.
 *
 * `carrier-poll.ts` decides *which* shipment a carrier's event is about. What
 * happens next — template lookup, upsert, and the rule about not overruling a
 * person — happens here, once, on purpose.
 *
 * It lived inside a feed once, and when a second feed arrived it was copied.
 * The two copies grew two answers to "does the feed overwrite a hand-entered
 * date", and the two answers were indistinguishable on the board until
 * somebody disputed a demurrage figure and found the paths disagreed about a
 * discharge. A third feed will call this rather than reimplement it.
 */

import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { jobMilestones, jobs, milestoneTemplates, type Tx } from '@qabandi/db'
import type { CarrierMilestone } from '../ports/index'

/** As much of a job as writing a milestone needs. */
export interface MilestoneTarget {
  readonly id: string
  readonly reference: string
  /*
    The column's own type rather than `string`.

    Milestone templates are per mode, so this value is half of the lookup
    below. Widening it to `string` would let a caller pass a mode that does not
    exist, find no template, and be told "no template for this mode" — a
    truthful message about an impossible situation, and a day to work out why.
  */
  readonly mode: (typeof jobs.$inferSelect)['mode']
  /*
    And its direction, for the same reason.

    A milestone set is per mode *and* per direction: `vessel_departed` sits at
    thirty on the way in and seventy on the way out. Selecting on mode alone
    returned whichever row the planner produced first, so a carrier's departure
    on an export shipment could be written at the import position — rendering it
    before the gate-in that precedes it, on a board whose whole job is order.
  */
  readonly tradeDirection: (typeof jobs.$inferSelect)['tradeDirection']
}

export interface MilestoneWrite {
  readonly status: 'written' | 'preserved' | 'ignored'
  readonly code: string
  readonly reason?: string
}

/**
 * Put a carrier's milestone on a job, or explain why it was not put there.
 *
 * `source` names the feed in `job_milestones.notes`, and it is load-bearing
 * rather than decorative: the `setWhere` guard below reads it back to tell a
 * row this system wrote from a row a person wrote, so the prefix is what stops
 * a feed from silently correcting an operator. **It must keep starting with
 * `Carrier feed`** — the poll worker appends the carrier's SCAC after it, so
 * the note says who said so without breaking the guard.
 */
export async function writeCarrierMilestone(
  tx: Tx,
  job: MilestoneTarget,
  milestone: CarrierMilestone,
  source = 'Carrier feed',
): Promise<MilestoneWrite> {
  /*
    Names come from the milestone template for this mode.

    `job_milestones.name_en` and `name_ar` are `not null` because every
    document and board renders bilingually (§11). A carrier feed supplies a
    code and a date, never an Arabic name — so the template is what makes an
    automatically-created milestone indistinguishable from a hand-entered one,
    which is the point.
  */
  const candidates = await tx
    .select({
      nameEn: milestoneTemplates.nameEn,
      nameAr: milestoneTemplates.nameAr,
      seq: milestoneTemplates.seq,
      ownerRole: milestoneTemplates.ownerRole,
      customerVisible: milestoneTemplates.customerVisible,
      direction: milestoneTemplates.direction,
    })
    .from(milestoneTemplates)
    .where(
      and(
        eq(milestoneTemplates.code, milestone.code),
        eq(milestoneTemplates.mode, job.mode),
        eq(milestoneTemplates.isActive, true),
      ),
    )

  /*
    The job's own direction first, any direction for the mode second.

    Both candidates are read and the choice made here rather than narrowed in
    the `where`, because narrowing would silently stop writing milestones for a
    cross-trade shipment — nothing seeds a `cross_trade` set, and a template
    from the neighbouring direction is a better answer than none. Same shape as
    the notification dispatcher's branch override, for the same reason.
  */
  const template = candidates.find((row) => row.direction === job.tradeDirection) ?? candidates[0]

  if (!template) {
    /*
      A code with no template for this mode is not written.

      The board, the SLA clocks and the customer portal are all driven by the
      template — sequence, ownership, visibility. A milestone without one would
      appear out of order, belong to nobody, and be visible to a customer by
      whichever default the column carries.
    */
    return {
      status: 'ignored',
      code: milestone.code,
      reason: `no ${job.mode} template for ${milestone.code}`,
    }
  }

  const notes = milestone.location ? `${source} · ${milestone.location}` : source

  const written = await tx
    .insert(jobMilestones)
    .values({
      jobId: job.id,
      code: milestone.code,
      nameEn: template.nameEn,
      nameAr: template.nameAr,
      seq: template.seq,
      ownerRole: template.ownerRole,
      customerVisible: template.customerVisible,
      actualAt: milestone.occurredAt,
      notes,
    })
    /*
      An upsert, not an insert.

      `job_milestones_unique` is `(job_id, code)`. Providers redeliver, a poll
      re-reads the same event every hour, and carriers correct their own
      timestamps hours later — so an event that arrives twice must update the
      date it carries rather than fail or duplicate. Idempotency comes from the
      schema rather than from remembering to check first, which is what makes
      an hourly poll safe to run at all.
    */
    .onConflictDoUpdate({
      target: [jobMilestones.jobId, jobMilestones.code],
      set: { actualAt: milestone.occurredAt, notes: sql`excluded.notes` },
      /*
        A hand-entered completion is not overwritten by a later feed.

        An operator who marked a milestone complete did so with information the
        carrier may not have — a phone call from the terminal — and having the
        feed silently move that date hours later would make the board argue
        with the person reading it. The feed fills gaps and corrects its *own*
        dates; it does not overrule a human.

        "Its own" means nobody has completed it by hand since (O6). The note
        alone was the test, and an operator correcting a feed-written date
        through the milestone dialog leaves the note as the feed wrote it — so
        the correction reverted within the hour, and that date drives
        demurrage. A hand completion stamps `completed_by_id`; the feed never
        does.
      */
      setWhere: or(
        isNull(jobMilestones.actualAt),
        and(isNull(jobMilestones.completedById), sql`${jobMilestones.notes} like 'Carrier feed%'`),
      ),
    })
    /*
      `returning` is how we learn whether the guard above fired.

      `on conflict do update ... where` returns no row when its condition
      fails, so an empty result means the milestone was left as a human entered
      it. Without this the worker logged "written" for an event that changed
      nothing — and the log is what somebody reads at 2am when a customer asks
      why a discharge date moved. Reporting the wrong outcome is worse than
      reporting none.
    */
    .returning({ id: jobMilestones.id })

  if (written.length === 0) {
    return {
      status: 'preserved',
      code: milestone.code,
      reason: 'a hand-entered completion already stands here',
    }
  }

  return { status: 'written', code: milestone.code }
}
