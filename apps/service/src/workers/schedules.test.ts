/**
 * The three smaller schedules: warn before free time costs, escalate a breached
 * SLA, refresh the rates.
 *
 * Grouped into one file because they share a shape rather than a subject. Each
 * runs unattended, each writes at most one row per subject, and each carries a
 * *warned-once* flag — `warned_at`, `escalated_at`, and a unique key on the
 * rate — for the same reason: an alarm that repeats every night is an alarm
 * somebody writes a mail rule against, and then the fourth container is the
 * one nobody sees.
 *
 * Two properties are worth naming before the tests.
 *
 * **The warning faces the other way from the accrual.** The accrual bills
 * demurrage the night after it is incurred, which is accounting and is
 * correct; the only days anybody can *act* on are the ones before the clock
 * starts, and a container moved on day four costs nothing. Both read the same
 * calendars and the same engine, and the test below pins that they agree —
 * a warning saying four days against a bill charging from day three teaches
 * the coordinator to stop trusting the warning.
 *
 * **Zero days remaining still warns.** A clock entered after its free time had
 * already lapsed — a backdated gate-in, a shipment inherited mid-move — never
 * counts down through three, two, one. Warning only on the way down leaves
 * exactly those silent, and they are the expensive ones.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import type { Actor } from '@qabandi/db'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const {
  branches,
  customers,
  enquiries,
  equipment,
  freeTimeClocks,
  jobs,
  notificationOutbox,
  principals,
  withActor,
  workingCalendars,
} = await import('@qabandi/db')

const { runFreeTimeWarnings, listExpiringFreeTime } = await import('./free-time-warning')
const { runSlaEscalation } = await import('./sla-escalation')

const BRANCH = '00000000-0000-7000-8000-00000000ce01'
const CUSTOMER = '00000000-0000-7000-8000-00000000ce02'
const PRINCIPAL = '00000000-0000-7000-8000-00000000ce03'
const JOB = '00000000-0000-7000-8000-00000000ce04'
const CONTAINER = '00000000-0000-7000-8000-00000000ce05'

const actor: Actor = { principalId: PRINCIPAL, type: 'internal', branchIds: [BRANCH] }
const systemActor = { ...actor, type: 'system' as const }

const RUN = Date.now().toString(36).toUpperCase().slice(-5)
let seq = 0

/** Midday, so the branch's calendar day matches the date in the test. */
const at = (iso: string) => new Date(`${iso}T12:00:00Z`)

async function clock(over: Record<string, unknown> = {}): Promise<string> {
  seq += 1
  return withActor(systemActor, async (tx) => {
    const [row] = await tx
      .insert(freeTimeClocks)
      .values({
        jobId: JOB,
        equipmentId: CONTAINER,
        kind: 'demurrage',
        freeDays: 10,
        startsOn: '2034-03-01',
        perDiem: '30.000',
        currency: 'KWD',
        dayBasis: 'calendar',
        ...over,
      })
      .returning({ id: freeTimeClocks.id })
    return row!.id
  })
}

const clockRow = async (id: string) => {
  const [row] = await withActor(actor, (tx) =>
    tx.select().from(freeTimeClocks).where(eq(freeTimeClocks.id, id)),
  )
  return row!
}

/** The warnings raised for this suite's job, newest last. */
const warnings = () =>
  withActor(actor, (tx) =>
    tx
      .select()
      .from(notificationOutbox)
      .where(
        and(
          eq(notificationOutbox.jobId, JOB),
          eq(notificationOutbox.eventKey, 'free_time.expiring'),
        ),
      ),
  )

async function enquiry(over: Record<string, unknown> = {}): Promise<string> {
  seq += 1
  return withActor(systemActor, async (tx) => {
    const [row] = await tx
      .insert(enquiries)
      .values({
        reference: `CE-ENQ-${RUN}-${seq}`,
        branchId: BRANCH,
        customerId: CUSTOMER,
        channel: 'email',
        mode: 'sea_fcl',
        tradeDirection: 'import',
        status: 'new',
        ...over,
      })
      .returning({ id: enquiries.id })
    return row!.id
  })
}

const enquiryRow = async (id: string) => {
  const [row] = await withActor(actor, (tx) =>
    tx.select().from(enquiries).where(eq(enquiries.id, id)),
  )
  return row!
}

const breaches = (enquiryId: string) =>
  withActor(actor, (tx) =>
    tx
      .select()
      .from(notificationOutbox)
      .where(
        and(
          eq(notificationOutbox.enquiryId, enquiryId),
          eq(notificationOutbox.eventKey, 'enquiry.sla_breached'),
        ),
      ),
  )

describe.skipIf(!enabled)('the nightly and quarter-hourly schedules', () => {
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
          email: 'schedules-worker@qabandi.test',
          nameEn: 'Schedules Fixture',
        })
        .onConflictDoNothing()

      await tx
        .insert(branches)
        .values({
          id: BRANCH,
          code: 'SCH',
          legalNameEn: 'Schedules Branch',
          legalNameAr: 'فرع الجداول',
          country: 'KW',
          baseCurrency: 'KWD',
          invoiceSeries: 'SCH',
          calendarId: calendar.id,
        })
        .onConflictDoNothing()

      await tx
        .insert(customers)
        .values({
          id: CUSTOMER,
          code: 'CUST-SCHEDULES',
          legalNameEn: 'Schedules Fixture Customer',
          primaryBranchId: BRANCH,
        })
        .onConflictDoNothing()

      await tx
        .insert(jobs)
        .values({
          id: JOB,
          reference: `SCH-JOB-${RUN}`,
          branchId: BRANCH,
          customerId: CUSTOMER,
          mode: 'sea_fcl',
          tradeDirection: 'import',
          status: 'arrived',
        })
        .onConflictDoNothing()

      await tx
        .insert(equipment)
        .values({
          id: CONTAINER,
          jobId: JOB,
          containerNo: 'MSCU7781234',
        })
        .onConflictDoNothing()
    })
  })

  /**
   * Escalate the backlog before asserting on anything.
   *
   * `runSlaEscalation` sweeps the two hundred oldest unescalated breaches in
   * the deployment with no ordering, and the web suites leave enquiries whose
   * SLA lapsed in the year 2000 — nothing is ever deleted, so that backlog only
   * grows. With it in place this file's own enquiry is simply not in the batch,
   * and the test fails for a reason that has nothing to do with the worker.
   *
   * Draining is what a real deployment does after an outage: run until a pass
   * finds nothing left. The cap is a guard against a bug in the worker turning
   * this into an infinite loop rather than a failing test.
   */
  beforeAll(async () => {
    for (let pass = 0; pass < 25; pass++) {
      const { escalated } = await runSlaEscalation(at('2034-03-02'))
      if (escalated === 0) break
    }
  })

  afterAll(async () => {
    // An open clock is swept by every later run of either free-time worker.
    if (!enabled) return
    await withActor(systemActor, (tx) =>
      tx.update(freeTimeClocks).set({ endsOn: '2034-12-31' }).where(eq(freeTimeClocks.jobId, JOB)),
    )
  })

  describe('warning before free time costs anything', () => {
    it('warns a container inside the warning window', async () => {
      // Ten free days from 1 March; on the 8th there are three left.
      const id = await clock({ freeDays: 10, startsOn: '2034-03-01' })

      const result = await runFreeTimeWarnings(at('2034-03-08'))

      expect(result.warned).toBeGreaterThan(0)
      expect((await clockRow(id)).warnedAt).toBeInstanceOf(Date)
    })

    it('says nothing while the container is still comfortably free', async () => {
      const id = await clock({ freeDays: 30, startsOn: '2034-03-01' })

      await runFreeTimeWarnings(at('2034-03-02'))

      expect((await clockRow(id)).warnedAt).toBeNull()
    })

    /**
     * The case worth being deliberate about: a backdated gate-in never counts
     * down through three, two, one, and those are the expensive ones.
     */
    it('warns a clock that was already past its free time when it was entered', async () => {
      const id = await clock({ freeDays: 2, startsOn: '2034-03-01' })

      await runFreeTimeWarnings(at('2034-03-20'))

      expect((await clockRow(id)).warnedAt).toBeInstanceOf(Date)
      const raised = (await warnings()).filter(
        (row) => (row.payload as { daysRemaining?: string }).daysRemaining === '0',
      )
      expect(raised.length).toBeGreaterThan(0)
      /*
        And worded as lapsed, not "in 0 day(s)" (N7): the last free day was
        2034-03-02, eighteen days before the run, with the charge named in
        Arabic rather than as the enum.
      */
      const lapsed = raised
        .map((row) => row.payload as Record<string, string>)
        .find((p) => p.runsOut === 'ran out 18 days ago')
      expect(lapsed?.runsOutAr).toBe('انتهى منذ 18 يومًا')
      expect(lapsed?.kindAr).toBe('الأرضيات')
    })

    /** A warning that arrives three nights running gets a mail rule written. */
    it('warns once and not again the following night', async () => {
      const id = await clock({ freeDays: 10, startsOn: '2034-03-01' })

      await runFreeTimeWarnings(at('2034-03-08'))
      const first = (await clockRow(id)).warnedAt
      const before = (await warnings()).length

      await runFreeTimeWarnings(at('2034-03-09'))

      expect((await clockRow(id)).warnedAt?.getTime()).toBe(first?.getTime())
      expect((await warnings()).length).toBe(before)
    })

    it('never warns about a clock that has been closed', async () => {
      const id = await clock({ freeDays: 10, startsOn: '2034-03-01', endsOn: '2034-03-05' })

      await runFreeTimeWarnings(at('2034-03-08'))

      expect((await clockRow(id)).warnedAt).toBeNull()
    })

    /** Everything the coordinator needs to act, without opening the job. */
    it('carries the container, the daily rate and the date it expires', async () => {
      await clock({ freeDays: 10, startsOn: '2034-03-01', perDiem: '45.000' })

      await runFreeTimeWarnings(at('2034-03-08'))

      const payloads = (await warnings()).map((row) => row.payload as Record<string, string>)
      // At the currency's three decimals, not the column's six (N7).
      const mine = payloads.find((p) => p.perDiem === '45.000')
      expect(mine?.containerNo).toBe('MSCU7781234')
      // Last free day 2034-03-10, two days after the run.
      expect(mine?.runsOut).toBe('runs out in 2 days')
      expect(mine?.runsOutAr).toBe('ينتهي خلال يومين')
      expect(mine?.currency).toBe('KWD')
      expect(mine?.expiresOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(mine?.reference).toContain('SCH-JOB-')
    })

    /**
     * Left join, not inner. A storage clock runs against loose cargo with no
     * container at all, and an inner join silently drops exactly the LCL and
     * air consignments this is meant to cover.
     */
    it('warns about loose cargo that has no container', async () => {
      const id = await clock({
        kind: 'storage',
        equipmentId: null,
        freeDays: 10,
        startsOn: '2034-03-01',
      })

      await runFreeTimeWarnings(at('2034-03-08'))

      expect((await clockRow(id)).warnedAt).toBeInstanceOf(Date)
      const loose = (await warnings()).find(
        (row) => (row.payload as { kind?: string }).kind === 'storage',
      )
      expect(loose).toBeDefined()
      expect((loose!.payload as { containerNo?: string }).containerNo).toBe('—')
    })

    it('reports what it looked at as well as what it warned', async () => {
      await clock({ freeDays: 10, startsOn: '2034-03-01' })

      const result = await runFreeTimeWarnings(at('2034-03-08'))

      expect(result.examined).toBeGreaterThan(0)
      expect(result.warned).toBeLessThanOrEqual(result.examined)
    })
  })

  describe('the same question, asked by the board', () => {
    /**
     * The screen and the email must not disagree about which containers are at
     * risk, so they ask through the same engine — and this one writes nothing,
     * so the badge does not have to wait for the night's run.
     */
    it('lists what the worker would warn about, and writes nothing', async () => {
      const id = await clock({ freeDays: 10, startsOn: '2034-03-01' })

      const listed = await listExpiringFreeTime(at('2034-03-08'))

      expect(listed.some((row) => row.jobId === JOB)).toBe(true)
      // Reading the board does not consume the warning.
      expect((await clockRow(id)).warnedAt).toBeNull()
    })

    it('leaves out a container that is not near its expiry', async () => {
      await clock({ freeDays: 60, startsOn: '2034-03-01' })

      const listed = await listExpiringFreeTime(at('2034-03-02'))

      expect(listed.every((row) => row.daysRemaining <= 3)).toBe(true)
    })

    /** Closest to costing money first — the board's whole job. */
    it('puts the most urgent first', async () => {
      await clock({ freeDays: 10, startsOn: '2034-03-01' })
      await clock({ freeDays: 12, startsOn: '2034-03-01' })

      const listed = await listExpiringFreeTime(at('2034-03-09'))

      const days = listed.map((row) => row.daysRemaining)
      expect([...days].sort((a, b) => a - b)).toEqual(days)
    })

    /** The two workers read one engine, so they cannot drift apart. */
    it('agrees with the warning worker about which clocks are at risk', async () => {
      const id = await clock({ freeDays: 10, startsOn: '2034-03-01' })

      const listedBefore = await listExpiringFreeTime(at('2034-03-08'))
      await runFreeTimeWarnings(at('2034-03-08'))

      expect(listedBefore.some((row) => row.jobId === JOB)).toBe(true)
      expect((await clockRow(id)).warnedAt).toBeInstanceOf(Date)
    })
  })

  describe('escalating a breached SLA', () => {
    const PAST = at('2034-03-01')
    const LATER = at('2034-03-02')

    it('escalates an enquiry nobody answered in time', async () => {
      const id = await enquiry({ slaDueAt: PAST })

      const result = await runSlaEscalation(LATER)

      expect(result.escalated).toBeGreaterThan(0)
      expect((await enquiryRow(id)).escalatedAt).toBeInstanceOf(Date)
      expect(await breaches(id)).toHaveLength(1)
    })

    /** An escalation that repeats every fifteen minutes is one that is filtered. */
    it('escalates once, not every quarter of an hour', async () => {
      const id = await enquiry({ slaDueAt: PAST })

      await runSlaEscalation(LATER)
      const first = (await enquiryRow(id)).escalatedAt
      await runSlaEscalation(at('2034-03-03'))

      expect((await enquiryRow(id)).escalatedAt?.getTime()).toBe(first?.getTime())
      expect(await breaches(id)).toHaveLength(1)
    })

    it('leaves an enquiry that was answered in time alone', async () => {
      const id = await enquiry({ slaDueAt: PAST, firstRespondedAt: at('2034-02-28') })

      await runSlaEscalation(LATER)

      expect((await enquiryRow(id)).escalatedAt).toBeNull()
      expect(await breaches(id)).toEqual([])
    })

    /** A closed enquiry cannot breach — there is nobody left to chase. */
    it('leaves a closed enquiry alone', async () => {
      const id = await enquiry({
        slaDueAt: PAST,
        status: 'lost',
        lostReason: 'Went elsewhere',
        closedAt: at('2034-02-28'),
      })

      await runSlaEscalation(LATER)

      expect((await enquiryRow(id)).escalatedAt).toBeNull()
    })

    it('leaves an enquiry whose clock has not run out yet', async () => {
      const id = await enquiry({ slaDueAt: at('2034-03-10') })

      await runSlaEscalation(LATER)

      expect((await enquiryRow(id)).escalatedAt).toBeNull()
    })

    it('leaves an enquiry with no clock at all', async () => {
      const id = await enquiry({ slaDueAt: null })

      await runSlaEscalation(LATER)

      expect((await enquiryRow(id)).escalatedAt).toBeNull()
    })

    /** The alarm names the enquiry and whoever was meant to be holding it. */
    it('names the enquiry and its owner on the alarm', async () => {
      const id = await enquiry({ slaDueAt: PAST, ownerId: PRINCIPAL, status: 'assigned' })

      await runSlaEscalation(LATER)

      const [raised] = await breaches(id)
      const payload = raised!.payload as { reference: string; ownerId: string }
      expect(payload.reference).toContain('CE-ENQ-')
      expect(payload.ownerId).toBe(PRINCIPAL)
      expect(raised?.branchId).toBe(BRANCH)
    })
  })
})
