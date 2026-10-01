/**
 * Writing one carrier milestone onto one job — the rule about not overruling a
 * person, and the upsert that makes an hourly poll safe.
 *
 * This is the half of the carrier feed that is shared. `carrier-poll.ts`
 * decides *which* shipment a carrier's event is about; this decides what
 * happens next, and it is deliberately one implementation so that a second
 * feed cannot grow a second answer to "does the machine overwrite the human".
 *
 * **The feed fills gaps and corrects its own dates; it does not overrule a
 * person.** An operator who marked a milestone complete did so with
 * information the carrier may not have — a phone call from the terminal. A
 * feed that silently moved that date hours later would make the board argue
 * with the person reading it, and the `returning` clause is how the caller
 * learns the guard fired rather than logging "written" for a write that
 * changed nothing.
 *
 * **The write is an upsert.** The poll re-reads the same event every hour and
 * carriers correct their own timestamps later — so idempotency comes from
 * `job_milestones_unique` rather than from remembering to check first, which
 * is what makes an hourly poll safe to run at all.
 *
 * **The note is load-bearing.** `Carrier feed …` in `notes` is what the guard
 * reads back to tell a row this system wrote from a row a person wrote, and
 * the poll appends the carrier's SCAC after it. A source that stopped starting
 * with those two words would start overwriting operators, silently.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import type { Actor } from '@qabandi/db'
import type { MilestoneTarget } from './carrier-milestone'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const {
  branches,
  customers,
  jobMilestones,
  jobs,
  milestoneTemplates,
  principals,
  withActor,
  workingCalendars,
} = await import('@qabandi/db')

const { writeCarrierMilestone } = await import('./carrier-milestone')

const BRANCH = '00000000-0000-7000-8000-00000000ca01'
const CUSTOMER = '00000000-0000-7000-8000-00000000ca02'
const PRINCIPAL = '00000000-0000-7000-8000-00000000ca03'

const actor: Actor = { principalId: PRINCIPAL, type: 'internal', branchIds: [BRANCH] }
const systemActor = { ...actor, type: 'system' as const }

const RUN = Date.now().toString(36).toUpperCase().slice(-5)
let seq = 0

async function job(over: Record<string, unknown> = {}): Promise<MilestoneTarget> {
  seq += 1
  const reference = `CAR-${RUN}-${seq}`
  return withActor(systemActor, async (tx) => {
    const [row] = await tx
      .insert(jobs)
      .values({
        reference,
        branchId: BRANCH,
        customerId: CUSTOMER,
        mode: 'sea_fcl',
        tradeDirection: 'import',
        status: 'in_transit',
        ...over,
      })
      .returning({
        id: jobs.id,
        reference: jobs.reference,
        mode: jobs.mode,
        tradeDirection: jobs.tradeDirection,
      })
    return row!
  })
}

/** What the feeds call, with the note prefix the guard depends on. */
const write = (
  target: MilestoneTarget,
  code: string,
  occurredAt: string,
  extra: { location?: string; source?: string } = {},
) =>
  withActor(systemActor, (tx) =>
    writeCarrierMilestone(
      tx,
      target,
      { code, occurredAt: new Date(occurredAt), location: extra.location },
      extra.source,
    ),
  )

const milestonesOf = (jobId: string) =>
  withActor(actor, (tx) => tx.select().from(jobMilestones).where(eq(jobMilestones.jobId, jobId)))

const milestoneOn = async (jobId: string, code: string) => {
  const [row] = await withActor(actor, (tx) =>
    tx
      .select()
      .from(jobMilestones)
      .where(and(eq(jobMilestones.jobId, jobId), eq(jobMilestones.code, code))),
  )
  return row
}

/** The seeded sequence for one mode, direction and code. */
const templateSeq = async (mode: string, direction: string, code: string) => {
  const [row] = await withActor(actor, (tx) =>
    tx
      .select({ seq: milestoneTemplates.seq })
      .from(milestoneTemplates)
      .where(
        and(
          eq(milestoneTemplates.mode, mode as 'sea_fcl'),
          eq(milestoneTemplates.direction, direction as 'import'),
          eq(milestoneTemplates.code, code),
        ),
      ),
  )
  return row?.seq
}

describe.skipIf(!enabled)('writing a carrier milestone', () => {
  beforeAll(async () => {
    await withActor(systemActor, async (tx) => {
      const [calendar] = await tx
        .select({ id: workingCalendars.id })
        .from(workingCalendars)
        .where(eq(workingCalendars.key, 'kuwait'))
        .limit(1)
      if (!calendar) throw new Error('Run `pnpm db:seed` before this suite')

      await tx
        .insert(principals)
        .values({
          id: PRINCIPAL,
          type: 'internal',
          email: 'carrier-worker@qabandi.test',
          nameEn: 'Carrier Fixture',
        })
        .onConflictDoNothing()

      await tx
        .insert(branches)
        .values({
          id: BRANCH,
          code: 'CAR',
          legalNameEn: 'Carrier Events Branch',
          legalNameAr: 'فرع الناقل',
          country: 'KW',
          baseCurrency: 'KWD',
          invoiceSeries: 'CAR',
          calendarId: calendar.id,
        })
        .onConflictDoNothing()

      await tx
        .insert(customers)
        .values({
          id: CUSTOMER,
          code: 'CUST-CARRIER',
          legalNameEn: 'Carrier Fixture Customer',
          primaryBranchId: BRANCH,
        })
        .onConflictDoNothing()
    })
  })

  afterAll(async () => {
    // Closed, so a later poll or sweep does not pick these shipments up.
    if (!enabled) return
    await withActor(systemActor, (tx) =>
      tx.update(jobs).set({ closedAt: new Date() }).where(eq(jobs.branchId, BRANCH)),
    )
  })

  describe('the template decides everything but the date', () => {
    it('names it from the template, in both languages', async () => {
      const target = await job()

      await write(target, 'discharged', '2034-06-14T11:00:00Z')

      const written = await milestoneOn(target.id, 'discharged')
      // Both are `not null` because every board and document renders
      // bilingually, and a feed supplies a code and a date — never an Arabic
      // name.
      expect(written?.nameEn).toBeTruthy()
      expect(written?.nameAr).toBeTruthy()
    })

    /**
     * The sequence belongs to the job's *direction*, not merely its mode.
     *
     * `vessel_departed` is in both the import and the export set for `sea_fcl`
     * at different positions — thirty on the way in, seventy on the way out —
     * so a lookup on mode alone returns whichever row the planner happened to
     * produce. On an export shipment that renders the departure before the
     * gate-in that precedes it, on a board whose whole job is order.
     */
    it('takes the sequence for the job’s own trade direction', async () => {
      const target = await job({ tradeDirection: 'export' })

      await write(target, 'vessel_departed', '2034-06-10T06:00:00Z')

      const written = await milestoneOn(target.id, 'vessel_departed')
      expect(written?.seq).toBe(await templateSeq('sea_fcl', 'export', 'vessel_departed'))
    })

    it('takes the import sequence on an import shipment', async () => {
      const target = await job({ tradeDirection: 'import' })

      await write(target, 'vessel_departed', '2034-06-10T06:00:00Z')

      const written = await milestoneOn(target.id, 'vessel_departed')
      expect(written?.seq).toBe(await templateSeq('sea_fcl', 'import', 'vessel_departed'))
    })

    /** The note says which feed said so, and the guard below reads it back. */
    it('records the source and the place on the note', async () => {
      const target = await job()

      await write(target, 'discharged', '2034-06-14T11:00:00Z', { location: 'KWSWK' })

      const written = await milestoneOn(target.id, 'discharged')
      expect(written?.notes).toContain('Carrier feed')
      expect(written?.notes).toContain('KWSWK')
    })

    /**
     * A code with no template for this mode is not written at all: the board,
     * the SLA clocks and the portal are all driven by the template, so a
     * milestone without one would appear out of order, belong to nobody, and
     * be visible to a customer by whichever default the column carries.
     */
    it('refuses a code the mode has no template for', async () => {
      const target = await job({ mode: 'air' })

      const result = await write(target, 'discharged', '2034-06-14T11:00:00Z')

      expect(result.status).toBe('ignored')
      expect(result.reason).toContain('air template')
      expect(await milestonesOf(target.id)).toEqual([])
    })
  })

  describe('repetition and correction', () => {
    /** The poll re-reads the same event every hour, all day. */
    it('updates rather than duplicating when the same event arrives twice', async () => {
      const target = await job()

      await write(target, 'discharged', '2034-06-14T11:00:00Z')
      await write(target, 'discharged', '2034-06-14T11:00:00Z')

      const rows = (await milestonesOf(target.id)).filter((m) => m.code === 'discharged')
      expect(rows).toHaveLength(1)
    })

    /** Carriers correct their own timestamps hours later, and that must land. */
    it('accepts the carrier correcting a date it wrote itself', async () => {
      const target = await job()
      await write(target, 'discharged', '2034-06-14T11:00:00Z')

      const result = await write(target, 'discharged', '2034-06-14T16:30:00Z')

      expect(result.status).toBe('written')
      const written = await milestoneOn(target.id, 'discharged')
      expect(written?.actualAt?.toISOString()).toBe('2034-06-14T16:30:00.000Z')
    })

    /**
     * The poll names the carrier on the note — `Carrier feed · MAEU` — and the
     * guard is a `like 'Carrier feed%'`. So the suffix must not cost the feed
     * the right to correct its own dates, which is the whole reason the poll
     * appends rather than replaces.
     */
    it('lets the poll correct a date it wrote under a carrier’s name', async () => {
      const target = await job()
      const source = 'Carrier feed · MAEU'
      await write(target, 'discharged', '2034-06-14T11:00:00Z', { source })

      const result = await write(target, 'discharged', '2034-06-14T16:30:00Z', { source })

      expect(result.status).toBe('written')
    })

    /**
     * The rule the guard exists for. An operator marked this complete from a
     * phone call the carrier never made, and a feed that moved the date hours
     * later would make the board argue with the person reading it.
     */
    it('leaves a hand-entered completion exactly where the operator put it', async () => {
      const target = await job()
      const entered = new Date('2034-06-13T08:00:00Z')

      await withActor(systemActor, (tx) =>
        tx.insert(jobMilestones).values({
          jobId: target.id,
          code: 'discharged',
          nameEn: 'Discharged',
          nameAr: 'تم التفريغ',
          seq: 50,
          actualAt: entered,
          notes: 'Confirmed by phone with the terminal',
        }),
      )

      const result = await write(target, 'discharged', '2034-06-14T11:00:00Z')

      /*
        Reported as `preserved`, not as `written`.

        `on conflict do update … where` returns no row when the guard fails, and
        the caller reads that back — because the log is what somebody reads at
        2am when a customer asks why a discharge date moved, and reporting the
        wrong outcome is worse than reporting none.
      */
      expect(result.status).toBe('preserved')
      const written = await milestoneOn(target.id, 'discharged')
      expect(written?.actualAt?.toISOString()).toBe(entered.toISOString())
      expect(written?.notes).toBe('Confirmed by phone with the terminal')
    })

    /**
     * O6. The feed wrote it, an operator corrected the date through the
     * milestone dialog — which stamps who did it and leaves the note — and the
     * next poll put the carrier's date back.
     */
    it('leaves a feed date a person has since corrected', async () => {
      const target = await job()
      await write(target, 'discharged', '2034-06-14T11:00:00Z')
      const corrected = new Date('2034-06-15T07:30:00Z')
      await withActor(systemActor, (tx) =>
        tx
          .update(jobMilestones)
          .set({ actualAt: corrected, completedById: PRINCIPAL })
          .where(and(eq(jobMilestones.jobId, target.id), eq(jobMilestones.code, 'discharged'))),
      )

      const result = await write(target, 'discharged', '2034-06-14T11:00:00Z')

      expect(result.status).toBe('preserved')
      const after = await milestoneOn(target.id, 'discharged')
      expect(after?.actualAt?.toISOString()).toBe(corrected.toISOString())
    })

    /** A milestone a person created but left incomplete is a gap to fill. */
    it('fills a milestone a person created but never completed', async () => {
      const target = await job()

      await withActor(systemActor, (tx) =>
        tx.insert(jobMilestones).values({
          jobId: target.id,
          code: 'discharged',
          nameEn: 'Discharged',
          nameAr: 'تم التفريغ',
          seq: 50,
          actualAt: null,
          notes: 'Planned',
        }),
      )

      const result = await write(target, 'discharged', '2034-06-14T11:00:00Z')

      expect(result.status).toBe('written')
      expect((await milestoneOn(target.id, 'discharged'))?.actualAt).toBeInstanceOf(Date)
    })
  })
})
