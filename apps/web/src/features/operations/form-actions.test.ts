/**
 * Operations mutations — what people actually do to a shipment all day.
 *
 * The most-used writes in the product: ticking a milestone, raising an
 * exception, moving customs on, changing a job's status. They are cheap
 * individually and they are the ones a coordinator performs a hundred times a
 * day, so a defect here is a defect everybody meets.
 *
 * Two things are worth testing beyond "the row changed". The first is the
 * notification side effects — a milestone tick can email a customer, and the
 * three conditions that gate it each describe a message somebody would
 * otherwise receive wrongly. The second is the state machines: `saveCustomsStage`
 * asserts against `customsMachine`, and this suite checks that an illegal move
 * is refused with a sentence rather than written.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq, sql } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)

if (APP_URL) process.env.DATABASE_URL = APP_URL

const harness = vi.hoisted(() => ({ session: null as unknown }))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('@/lib/session', () => ({
  requireSession: async () => harness.session,
}))

/**
 * The message keys stand in for the sentences, so an assertion names the case
 * rather than a wording a translator is free to change — as in `auth/actions.test.ts`.
 */
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    values ? `${namespace}.${key}:${JSON.stringify(values)}` : `${namespace}.${key}`,
}))

const {
  branches,
  customers,
  customsStages,
  equipment,
  exceptionCodes,
  exceptions,
  freeTimeClocks,
  jobMilestones,
  jobs,
  principalBranchRoles,
  principals,
  roles,
  withActor,
  workingCalendars,
} = await import('@qabandi/db')

const {
  raiseException,
  closeException,
  saveCustomsStage,
  completeMilestone,
  addContainer,
  setJobStatus,
  saveFreeTimeClock,
} = await import('./form-actions')

const BRANCH = '00000000-0000-7000-8000-00000000d001'
const CUSTOMER = '00000000-0000-7000-8000-00000000d002'
const PRINCIPAL = '00000000-0000-7000-8000-00000000d003'

const actor = { principalId: PRINCIPAL, type: 'internal' as const, branchIds: [BRANCH] }

const session = {
  actor,
  principal: { id: PRINCIPAL, nameEn: 'Ops Test', nameAr: null, email: 'o@t.test', locale: 'en' },
  permissions: new Set([
    'job.update',
    'job.book',
    'job.hold',
    'job.close',
    'job.cancel',
    /*
      All three customs keys, because this session stands in for a coordinator
      who does the whole job. The separation between them is asserted in its
      own describe below, by taking one away.
    */
    'customs.update',
    'customs.file',
    'customs.pay',
    'exception.raise',
    'exception.close',
    'document.release',
  ]),
  branchRoles: new Map([[BRANCH, 'operations_manager']]),
  requiresTwoFactor: false,
}

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

let exceptionCodeId: string
let jobSeq = 0

/** A shipment, in `booked` unless told otherwise. */
async function job(status = 'booked' as string): Promise<string> {
  jobSeq += 1
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .insert(jobs)
      .values({
        reference: `OPS-JOB-TEST-${jobSeq}-${Date.now()}`,
        branchId: BRANCH,
        customerId: CUSTOMER,
        mode: 'sea_fcl',
        tradeDirection: 'import',
        status: status as 'booked',
      })
      .returning({ id: jobs.id })
    return row!.id
  })
}

/** A milestone on that job. `customerVisible` decides whether a tick emails. */
async function milestone(jobId: string, customerVisible: boolean): Promise<string> {
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .insert(jobMilestones)
      .values({
        jobId,
        code: `ms_${Math.random().toString(36).slice(2, 8)}`,
        nameEn: 'Vessel discharged',
        nameAr: 'تم تفريغ السفينة',
        seq: 10,
        customerVisible,
      })
      .returning({ id: jobMilestones.id })
    return row!.id
  })
}

async function outboxFor(jobId: string) {
  return withActor(actor, (tx) =>
    tx.execute(
      sql`select event_key, payload from notification_outbox where job_id = ${jobId}::uuid`,
    ),
  )
}

describe.skipIf(!enabled)('operations mutations', () => {
  beforeAll(async () => {
    harness.session = session

    await withActor({ ...actor, type: 'system' }, async (tx) => {
      const [calendar] = await tx
        .select({ id: workingCalendars.id })
        .from(workingCalendars)
        .where(eq(workingCalendars.key, 'kuwait'))
        .limit(1)
      const [role] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.key, 'operations_manager'))
        .limit(1)
      const [code] = await tx.select({ id: exceptionCodes.id }).from(exceptionCodes).limit(1)
      if (!calendar || !role || !code) {
        throw new Error('Run `pnpm db:seed` before the operations tests')
      }
      exceptionCodeId = code.id

      await tx
        .insert(principals)
        .values({
          id: PRINCIPAL,
          type: 'internal',
          email: 'ops-test@qabandi.test',
          nameEn: 'Ops Test',
        })
        .onConflictDoNothing()

      await tx
        .insert(customers)
        .values({ id: CUSTOMER, code: 'CUST-OPS-TEST', legalNameEn: 'Ops Test Customer' })
        .onConflictDoNothing()

      await tx
        .insert(branches)
        .values({
          id: BRANCH,
          code: 'OPS',
          legalNameEn: 'Ops Test Branch',
          legalNameAr: 'فرع',
          country: 'KW',
          baseCurrency: 'KWD',
          invoiceSeries: 'OPS',
          calendarId: calendar.id,
        })
        .onConflictDoNothing()

      await tx
        .insert(principalBranchRoles)
        .values({ principalId: PRINCIPAL, branchId: BRANCH, roleId: role.id })
        .onConflictDoNothing()
    })
  })

  afterAll(() => {
    harness.session = null
  })

  describe('completeMilestone', () => {
    it('stamps the milestone and who ticked it', async () => {
      const jobId = await job()
      const milestoneId = await milestone(jobId, false)

      const state = await completeMilestone({}, form({ milestoneId, jobId }))
      expect(state.errors).toBeUndefined()

      const [row] = await withActor(actor, (tx) =>
        tx
          .select({ at: jobMilestones.actualAt, by: jobMilestones.completedById })
          .from(jobMilestones)
          .where(eq(jobMilestones.id, milestoneId)),
      )
      expect(row!.at).not.toBeNull()
      expect(row!.by).toBe(PRINCIPAL)
    })

    it('accepts an explicit time rather than defaulting to now', async () => {
      const jobId = await job()
      const milestoneId = await milestone(jobId, false)

      await completeMilestone({}, form({ milestoneId, jobId, actualAt: '2026-08-01T09:15' }))

      const [row] = await withActor(actor, (tx) =>
        tx
          .select({ at: jobMilestones.actualAt })
          .from(jobMilestones)
          .where(eq(jobMilestones.id, milestoneId)),
      )
      expect(new Date(row!.at as Date).toISOString()).toContain('2026-08-01')
    })

    /** O4. 09:15 typed in Kuwait is 06:15 UTC — not 09:15 UTC, read as noon. */
    it("reads the typed time in the branch's zone", async () => {
      const jobId = await job()
      const milestoneId = await milestone(jobId, false)

      await completeMilestone({}, form({ milestoneId, jobId, actualAt: '2026-08-01T09:15' }))

      const [row] = await withActor(actor, (tx) =>
        tx
          .select({ at: jobMilestones.actualAt })
          .from(jobMilestones)
          .where(eq(jobMilestones.id, milestoneId)),
      )
      expect(row!.at!.toISOString()).toBe('2026-08-01T06:15:00.000Z')
    })

    /** O17. An Invalid Date reached the database and came back as a 500. */
    it('refuses a time that is not one, on the field', async () => {
      const jobId = await job()
      const milestoneId = await milestone(jobId, false)
      const state = await completeMilestone({}, form({ milestoneId, jobId, actualAt: 'soon' }))
      expect(state.errors?.actualAt).toBe('operationsValidation.invalidDateTime')
    })

    /** Un-ticking clears both the time and the attribution. */
    it('undoes a tick', async () => {
      const jobId = await job()
      const milestoneId = await milestone(jobId, false)

      await completeMilestone({}, form({ milestoneId, jobId }))
      await completeMilestone({}, form({ milestoneId, jobId, undo: 'on' }))

      const [row] = await withActor(actor, (tx) =>
        tx
          .select({ at: jobMilestones.actualAt, by: jobMilestones.completedById })
          .from(jobMilestones)
          .where(eq(jobMilestones.id, milestoneId)),
      )
      expect(row!.at).toBeNull()
      expect(row!.by).toBeNull()
    })

    /**
     * FR-NT-01. The customer hears about a step they are shown, and both
     * language forms travel in the payload because the dispatcher resolves the
     * recipient's language afterwards.
     */
    it('raises a customer notification for a visible milestone', async () => {
      const jobId = await job()
      const milestoneId = await milestone(jobId, true)

      await completeMilestone({}, form({ milestoneId, jobId }))

      const events = await outboxFor(jobId)
      const rows = events.rows as { event_key: string; payload: Record<string, string> }[]
      expect(rows.map((r) => r.event_key)).toContain('job.milestone_reached')
      expect(rows[0]!.payload.milestone).toBe('Vessel discharged')
      expect(rows[0]!.payload.milestoneAr).toBe('تم تفريغ السفينة')
    })

    /** A step the customer never sees is not a step to email them about. */
    it('stays silent for a milestone the customer is not shown', async () => {
      const jobId = await job()
      const milestoneId = await milestone(jobId, false)

      await completeMilestone({}, form({ milestoneId, jobId }))

      expect((await outboxFor(jobId)).rows).toEqual([])
    })

    /**
     * Un-ticking is an operator correcting their own mis-click. "Your shipment
     * has been discharged" followed by nothing is worse than silence.
     */
    it('stays silent on undo', async () => {
      const jobId = await job()
      const milestoneId = await milestone(jobId, true)

      await completeMilestone({}, form({ milestoneId, jobId, undo: 'on' }))

      expect((await outboxFor(jobId)).rows).toEqual([])
    })

    it('reports rather than throws when nothing was chosen', async () => {
      const state = await completeMilestone({}, form({}))
      expect(state.errors).toBeDefined()
    })
  })

  describe('saveCustomsStage', () => {
    it('creates the stage on first save', async () => {
      const jobId = await job()

      const state = await saveCustomsStage({}, form({ jobId, status: 'not_started' }))
      expect(state.errors).toBeUndefined()

      const rows = await withActor(actor, (tx) =>
        tx.select().from(customsStages).where(eq(customsStages.jobId, jobId)),
      )
      expect(rows).toHaveLength(1)
    })

    /**
     * Filing stamps itself the first time and is never blanked by an edit.
     *
     * Routed through `documents_pending` because that is the only way there:
     * the machine has no `not_started → declaration_filed` edge, and asking
     * for one is refused rather than written.
     */
    it('stamps filedAt when the declaration is filed, and keeps it', async () => {
      const jobId = await job()
      await saveCustomsStage({}, form({ jobId, status: 'not_started' }))
      await saveCustomsStage({}, form({ jobId, status: 'documents_pending' }))
      await saveCustomsStage({}, form({ jobId, status: 'declaration_filed' }))

      const [first] = await withActor(actor, (tx) =>
        tx
          .select({ filedAt: customsStages.filedAt })
          .from(customsStages)
          .where(eq(customsStages.jobId, jobId)),
      )
      expect(first!.filedAt).not.toBeNull()

      // Editing the same stage again must not move the stamp.
      await saveCustomsStage({}, form({ jobId, status: 'declaration_filed', declarationNo: 'D-1' }))
      const [second] = await withActor(actor, (tx) =>
        tx
          .select({ filedAt: customsStages.filedAt })
          .from(customsStages)
          .where(eq(customsStages.jobId, jobId)),
      )
      expect(second!.filedAt).toEqual(first!.filedAt)
    })

    /**
     * The machine, not the screen, decides what customs may do next. This is
     * the guard `setJobStatus` does not have.
     */
    it('refuses a move the customs machine does not allow', async () => {
      const jobId = await job()
      await saveCustomsStage({}, form({ jobId, status: 'not_started' }))

      const state = await saveCustomsStage({}, form({ jobId, status: 'released' }))

      expect(state.errors?.status).toBe('operationsValidation.customsIllegalStep')
      const [row] = await withActor(actor, (tx) =>
        tx
          .select({ status: customsStages.status })
          .from(customsStages)
          .where(eq(customsStages.jobId, jobId)),
      )
      expect(row!.status).toBe('not_started')
    })

    it('rejects a malformed job id before touching the database', async () => {
      const state = await saveCustomsStage({}, form({ jobId: 'not-a-uuid', status: 'not_started' }))
      expect(state.errors).toBeDefined()
    })

    /**
     * The separation of duties the customs machine declares — FR-ID-03.
     *
     * `customs.file` and `customs.pay` were on the machine and checked
     * nowhere: every status change asserted `customs.update`, so the
     * coordinator who corrects a declaration number could also file the
     * declaration and clear the duty. These take one key away at a time and
     * check the move it guards is the move that stops.
     */
    describe('the three customs keys are three keys', () => {
      const withoutKey = async (missing: string, run: () => Promise<unknown>) => {
        const held = new Set(session.permissions)
        held.delete(missing)
        harness.session = { ...session, permissions: held }
        try {
          return await run()
        } finally {
          harness.session = session
        }
      }

      it('needs customs.file to file the declaration', async () => {
        const jobId = await job()
        await saveCustomsStage({}, form({ jobId, status: 'documents_pending' }))

        await withoutKey('customs.file', async () => {
          await expect(
            saveCustomsStage({}, form({ jobId, status: 'declaration_filed' })),
          ).resolves.toMatchObject({ message: expect.stringContaining('forbiddenAction') })
        })
      })

      it('needs customs.pay to clear the duty', async () => {
        const jobId = await job()
        await saveCustomsStage({}, form({ jobId, status: 'documents_pending' }))
        await saveCustomsStage({}, form({ jobId, status: 'declaration_filed' }))
        await saveCustomsStage({}, form({ jobId, status: 'assessed' }))

        await withoutKey('customs.pay', async () => {
          await expect(
            saveCustomsStage({}, form({ jobId, status: 'duty_paid' })),
          ).resolves.toMatchObject({ message: expect.stringContaining('forbiddenAction') })
        })
      })

      /** The ordinary moves keep working on `customs.update` alone. */
      it('leaves the rest of the stage to customs.update', async () => {
        const jobId = await job()

        const state = await withoutKey('customs.file', () =>
          saveCustomsStage({}, form({ jobId, status: 'documents_pending' })),
        )

        expect((state as { errors?: unknown }).errors).toBeUndefined()
      })

      /**
       * Creation is checked too.
       *
       * A stage created directly at `duty_paid` reaches duty_paid without
       * transitioning into it, so a check that ran only on the update path
       * would be a permission anyone could step around by having no stage yet.
       */
      it('checks the key on creation, not only on a move', async () => {
        const jobId = await job()

        await withoutKey('customs.pay', async () => {
          await expect(
            saveCustomsStage({}, form({ jobId, status: 'duty_paid' })),
          ).resolves.toMatchObject({ message: expect.stringContaining('forbiddenAction') })
        })
      })
    })
  })

  describe('exceptions', () => {
    it('raises an exception against a shipment', async () => {
      const jobId = await job()

      const state = await raiseException(
        {},
        form({
          jobId,
          exceptionCodeId,
          severity: 'high',
          description: 'Container held for inspection',
          customerVisible: 'on',
        }),
      )

      expect(state.errors).toBeUndefined()
      const rows = await withActor(actor, (tx) =>
        tx
          .select({ id: exceptions.id, severity: exceptions.severity })
          .from(exceptions)
          .where(eq(exceptions.jobId, jobId)),
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]!.severity).toBe('high')
    })

    /** O17. A lone "." passed the old money rule and failed in `numeric`. */
    it('refuses a lone point as a cost impact, on the field', async () => {
      const jobId = await job()
      const state = await raiseException(
        {},
        form({ jobId, exceptionCodeId, severity: 'low', costImpact: '.', costCurrency: 'KWD' }),
      )
      expect(state.errors?.costImpact).toBe('operationsValidation.numbersOnly')
    })

    /** O4. The due time is the branch's wall clock. */
    it("stores the due time in the branch's zone", async () => {
      const jobId = await job()
      await raiseException(
        {},
        form({ jobId, exceptionCodeId, severity: 'low', dueAt: '2026-10-05T17:00' }),
      )
      const [row] = await withActor(actor, (tx) =>
        tx.select({ dueAt: exceptions.dueAt }).from(exceptions).where(eq(exceptions.jobId, jobId)),
      )
      expect(row!.dueAt!.toISOString()).toBe('2026-10-05T14:00:00.000Z')
    })

    it('refuses an unknown severity', async () => {
      const jobId = await job()
      const state = await raiseException(
        {},
        form({ jobId, exceptionCodeId, severity: 'catastrophic' }),
      )
      expect(state.errors?.severity).toBeDefined()
    })

    it('closes an open exception', async () => {
      const jobId = await job()
      await raiseException({}, form({ jobId, exceptionCodeId, severity: 'low' }))
      const [open] = await withActor(actor, (tx) =>
        tx.select({ id: exceptions.id }).from(exceptions).where(eq(exceptions.jobId, jobId)),
      )

      const state = await closeException(
        {},
        form({ exceptionId: open!.id, jobId, resolution: 'Released after inspection' }),
      )
      expect(state.errors).toBeUndefined()

      const [closed] = await withActor(actor, (tx) =>
        tx
          .select({ closedAt: exceptions.closedAt })
          .from(exceptions)
          .where(eq(exceptions.id, open!.id)),
      )
      expect(closed!.closedAt).not.toBeNull()
    })
  })

  describe('addContainer', () => {
    /** ISO 6346 shape: four letters then six or seven digits. */
    it('accepts a well-formed container number and upper-cases it', async () => {
      const jobId = await job()
      const state = await addContainer({}, form({ jobId, containerNo: ' msku4419512 ' }))
      expect(state.errors).toBeUndefined()
    })

    it('refuses a container number of the wrong shape', async () => {
      const jobId = await job()
      const state = await addContainer({}, form({ jobId, containerNo: 'MSK-441' }))
      expect(state.errors?.containerNo).toBeDefined()
    })

    /** QA P3: an empty form saved a blank equipment row nobody could name. */
    it('refuses a container with neither a number nor a type', async () => {
      const jobId = await job()
      const state = await addContainer({}, form({ jobId }))
      expect(state.errors?.containerNo).toBe('operationsValidation.containerNeedsNumberOrType')
      const rows = await withActor(actor, (tx) =>
        tx.select().from(equipment).where(eq(equipment.jobId, jobId)),
      )
      expect(rows).toEqual([])
    })

    it('accepts a box booked by type before its number is known', async () => {
      const jobId = await job()
      const state = await addContainer({}, form({ jobId, containerType: '40HC' }))
      expect(state.errors).toBeUndefined()
    })

    /**
     * The check digit is deliberately *not* verified — a number typed off a
     * photograph of a rusty door is routinely one character out, and refusing
     * it would mean the operator cannot record the box in front of them.
     */
    it('accepts a number whose check digit is wrong', async () => {
      const jobId = await job()
      const state = await addContainer({}, form({ jobId, containerNo: 'MSKU4419519' }))
      expect(state.errors).toBeUndefined()
    })
  })

  /** O2. A clock could be started and never stopped. */
  describe('free-time clocks', () => {
    it('stops a clock by giving it an end date', async () => {
      const jobId = await job('arrived')
      const today = new Date().toISOString().slice(0, 10)
      const clock = {
        jobId,
        kind: 'demurrage',
        startsOn: today,
        freeDays: '5',
        perDiem: '25.000',
        currency: 'KWD',
      }
      expect((await saveFreeTimeClock({}, form(clock))).errors).toBeUndefined()
      const [row] = await withActor(actor, (tx) =>
        tx.select().from(freeTimeClocks).where(eq(freeTimeClocks.jobId, jobId)),
      )

      const state = await saveFreeTimeClock({}, form({ ...clock, clockId: row!.id, endsOn: today }))
      expect(state.errors).toBeUndefined()

      const [after] = await withActor(actor, (tx) =>
        tx.select().from(freeTimeClocks).where(eq(freeTimeClocks.id, row!.id)),
      )
      expect(after!.endsOn).toBe(today)
    })

    it("will not move another job's clock", async () => {
      const mine = await job('arrived')
      const theirs = await job('arrived')
      const today = new Date().toISOString().slice(0, 10)
      const clock = { kind: 'demurrage', startsOn: today, freeDays: '5', perDiem: '25.000' }
      await saveFreeTimeClock({}, form({ ...clock, jobId: theirs }))
      const [row] = await withActor(actor, (tx) =>
        tx.select().from(freeTimeClocks).where(eq(freeTimeClocks.jobId, theirs)),
      )

      await saveFreeTimeClock({}, form({ ...clock, jobId: mine, clockId: row!.id, endsOn: today }))

      const [after] = await withActor(actor, (tx) =>
        tx.select().from(freeTimeClocks).where(eq(freeTimeClocks.id, row!.id)),
      )
      expect(after!.jobId).toBe(theirs)
      expect(after!.endsOn).toBeNull()
    })
  })

  describe('setJobStatus', () => {
    it('moves a job on', async () => {
      const jobId = await job('booked')
      const state = await setJobStatus({}, form({ jobId, status: 'in_transit' }))
      expect(state.errors).toBeUndefined()

      const [row] = await withActor(actor, (tx) =>
        tx.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, jobId)),
      )
      expect(row!.status).toBe('in_transit')
    })

    /** A cancellation without a reason is a record nobody can explain later. */
    it('insists on a reason to cancel', async () => {
      const jobId = await job('booked')
      const state = await setJobStatus({}, form({ jobId, status: 'cancelled' }))
      expect(state.errors?.reason).toBeDefined()

      const [row] = await withActor(actor, (tx) =>
        tx.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, jobId)),
      )
      expect(row!.status).toBe('booked')
    })

    it('records the reason it was cancelled', async () => {
      const jobId = await job('booked')
      await setJobStatus({}, form({ jobId, status: 'cancelled', reason: 'Customer withdrew' }))

      const [row] = await withActor(actor, (tx) =>
        tx
          .select({
            status: jobs.status,
            at: jobs.cancelledAt,
            reason: jobs.cancelledReason,
          })
          .from(jobs)
          .where(eq(jobs.id, jobId)),
      )
      expect(row!.status).toBe('cancelled')
      expect(row!.at).not.toBeNull()
      expect(row!.reason).toBe('Customer withdrew')
    })

    /**
     * `jobMachine` marks `closed` and `cancelled` terminal, and every other
     * status write in this codebase asserts against its machine before
     * writing — `setInvoiceStatus` does, `saveCustomsStage` does. This one
     * does not, so a cancelled shipment can be moved back into the live board
     * and its cancellation record is blanked on the way.
     */
    it('does not let a cancelled job be reopened', async () => {
      const jobId = await job('booked')
      await setJobStatus({}, form({ jobId, status: 'cancelled', reason: 'Customer withdrew' }))

      await setJobStatus({}, form({ jobId, status: 'in_transit' }))

      const [row] = await withActor(actor, (tx) =>
        tx
          .select({ status: jobs.status, reason: jobs.cancelledReason })
          .from(jobs)
          .where(eq(jobs.id, jobId)),
      )
      expect(row!.status).toBe('cancelled')
      expect(row!.reason).toBe('Customer withdrew')
    })

    it('does not let a closed job be reopened', async () => {
      const jobId = await job('booked')
      await setJobStatus({}, form({ jobId, status: 'closed' }))

      await setJobStatus({}, form({ jobId, status: 'in_transit' }))

      const [row] = await withActor(actor, (tx) =>
        tx.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, jobId)),
      )
      expect(row!.status).toBe('closed')
    })

    /**
     * The flexibility the action is deliberately written to keep.
     *
     * `jobMachine` does not enumerate coming back off hold, and the whole
     * machine is not asserted here precisely so that a coordinator can do it.
     * Only the terminal states are closed, so this must still work.
     */
    it('lets a shipment go on hold and come back off it', async () => {
      const jobId = await job('booked')

      await setJobStatus({}, form({ jobId, status: 'on_hold' }))
      const state = await setJobStatus({}, form({ jobId, status: 'booked' }))

      expect(state.errors).toBeUndefined()
      expect(state.message).toBeUndefined()
      const [row] = await withActor(actor, (tx) =>
        tx.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, jobId)),
      )
      expect(row!.status).toBe('booked')
    })

    /** Re-saving the state it is already in is a no-op, not a reopening. */
    it('tolerates re-saving a closed job as closed', async () => {
      const jobId = await job('booked')
      await setJobStatus({}, form({ jobId, status: 'closed' }))

      const state = await setJobStatus({}, form({ jobId, status: 'closed' }))

      expect(state.message).toBeUndefined()
      const [row] = await withActor(actor, (tx) =>
        tx.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, jobId)),
      )
      expect(row!.status).toBe('closed')
    })

    it('reports rather than throws when nothing was chosen', async () => {
      const state = await setJobStatus({}, form({}))
      expect(state.errors).toBeDefined()
    })
  })
})
