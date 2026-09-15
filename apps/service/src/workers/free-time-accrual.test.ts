/**
 * The nightly free-time accrual — the worker, not the engine.
 *
 * `core/clocks.ts` decides how many days are chargeable over a Kuwaiti weekend
 * against an escalating per-diem, and it is tested there against no database.
 * What runs here is the half that reads open clocks and writes money, and it
 * has the worst risk profile in the product: it runs unattended, it writes
 * charge lines that end up on a customer's invoice, and it does not throw when
 * it is wrong — it writes a plausible number and moves on.
 *
 * So the properties asserted below are the ones that produce a *wrong figure*
 * rather than a crash:
 *
 * **The line is keyed to the clock, so a re-run updates rather than
 * duplicates.** This is the one that matters most. A nightly job that runs
 * twice — a crash and a retry, a scheduler that fires either side of midnight,
 * an operator running it by hand — must not bill demurrage twice. Nothing
 * downstream would catch it: two accrual lines against one container are
 * individually plausible, and the variance report has nothing to compare them
 * to.
 *
 * **A clock inside its free days writes nothing at all.** Not a zero line — a
 * zero-amount accrual against a container that is still free reads, to anyone
 * looking at the job, as a container that has started costing money.
 *
 * **A closed clock is never touched again.** The container has gone; whatever
 * it accrued is now history, and a later run must not extend it.
 *
 * **Every line carries an FX rate and a timestamp**, even the same-currency
 * ones where the rate is 1 (FR-RT-06). A line with no rate is a line the
 * accounting export cannot convert later.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import type { Actor } from '@qabandi/db'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const {
  branches,
  chargeLines,
  chargeTypes,
  customers,
  freeTimeClocks,
  jobs,
  partners,
  principals,
  withActor,
  workingCalendars,
} = await import('@qabandi/db')

const { runFreeTimeAccrual } = await import('./free-time-accrual')

/* A world of this suite's own. The worker reads every open clock in the
   deployment — it is a nightly sweep, not a scoped query — so the assertions
   below are all about one named clock rather than about totals. */
const BRANCH = '00000000-0000-7000-8000-00000000fa01'
const CUSTOMER = '00000000-0000-7000-8000-00000000fa02'
const PARTNER = '00000000-0000-7000-8000-00000000fa03'
const PRINCIPAL = '00000000-0000-7000-8000-00000000fa04'
const JOB = '00000000-0000-7000-8000-00000000fa05'

const actor: Actor = { principalId: PRINCIPAL, type: 'internal', branchIds: [BRANCH] }
const systemActor = { ...actor, type: 'system' as const }

const RUN = Date.now().toString(36).toUpperCase().slice(-5)
let seq = 0

/**
 * A running clock. `startsOn` is stated rather than relative to today, and
 * every assertion states its own `asOf` — a worker whose behaviour depends on
 * when the suite happens to run is a worker nobody can debug.
 */
async function clock(over: Record<string, unknown> = {}): Promise<string> {
  seq += 1
  return withActor(systemActor, async (tx) => {
    const [row] = await tx
      .insert(freeTimeClocks)
      .values({
        jobId: JOB,
        kind: 'demurrage',
        freeDays: 5,
        startsOn: '2033-04-01',
        perDiem: '25.000',
        currency: 'KWD',
        dayBasis: 'calendar',
        counterpartyId: PARTNER,
        ...over,
      })
      .returning({ id: freeTimeClocks.id })
    return row!.id
  })
}

/** Everything the accrual wrote for one clock — there must be at most one. */
async function linesFor(clockId: string) {
  return withActor(actor, (tx) =>
    tx
      .select()
      .from(chargeLines)
      .where(and(eq(chargeLines.sourceKind, 'free_time_clock'), eq(chargeLines.sourceId, clockId))),
  )
}

async function clockRow(clockId: string) {
  const [row] = await withActor(actor, (tx) =>
    tx.select().from(freeTimeClocks).where(eq(freeTimeClocks.id, clockId)),
  )
  return row!
}

/**
 * A moment on the given day, in the branch's calendar.
 *
 * Midday UTC rather than late evening, and the difference is a whole day of
 * demurrage: Kuwait is UTC+3, so `23:00Z` is already tomorrow there and the
 * clock counts one day more than the date in the test says. Stating the hour
 * this way keeps every expectation below readable as "on this date".
 */
const at = (iso: string) => new Date(`${iso}T12:00:00Z`)

describe.skipIf(!enabled)('the nightly free-time accrual', () => {
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
          email: 'accrual-worker@qabandi.test',
          nameEn: 'Accrual Fixture',
        })
        .onConflictDoNothing()

      await tx
        .insert(branches)
        .values({
          id: BRANCH,
          code: 'FTA',
          legalNameEn: 'Free Time Accrual Branch',
          legalNameAr: 'فرع الاستحقاق',
          country: 'KW',
          baseCurrency: 'KWD',
          invoiceSeries: 'FTA',
          calendarId: calendar.id,
        })
        .onConflictDoNothing()

      await tx
        .insert(customers)
        .values({
          id: CUSTOMER,
          code: 'CUST-ACCRUAL',
          legalNameEn: 'Accrual Fixture Customer',
          primaryBranchId: BRANCH,
        })
        .onConflictDoNothing()

      await tx
        .insert(partners)
        .values({
          id: PARTNER,
          code: 'CAR-ACCRUAL',
          type: 'carrier',
          legalNameEn: 'Accrual Fixture Carrier',
        })
        .onConflictDoNothing()

      await tx
        .insert(jobs)
        .values({
          id: JOB,
          reference: `FTA-JOB-${RUN}`,
          branchId: BRANCH,
          customerId: CUSTOMER,
          mode: 'sea_fcl',
          tradeDirection: 'import',
          status: 'arrived',
        })
        .onConflictDoNothing()
    })
  })

  afterAll(async () => {
    /*
      Close every clock this file opened.

      Nothing is ever deleted, and an open clock is picked up by every
      subsequent run of this worker — including other suites' runs and the next
      run of this one, where it would accrue years of demurrage and slow the
      sweep down for good.
    */
    if (!enabled) return
    await withActor(systemActor, (tx) =>
      tx.update(freeTimeClocks).set({ endsOn: '2033-12-31' }).where(eq(freeTimeClocks.jobId, JOB)),
    )
  })

  describe('what it charges', () => {
    /** Five free days from 1 April, so the tenth is day five of charging. */
    it('charges the days past free time and nothing before them', async () => {
      const id = await clock({ freeDays: 5, startsOn: '2033-04-01', perDiem: '25.000' })

      await runFreeTimeAccrual(at('2033-04-10'))

      const [line] = await linesFor(id)
      // 1–10 April is ten elapsed days; five are free.
      expect(line?.quantity).toBe('5.000000')
      expect(line?.amount).toBe('125.000000')
    })

    /**
     * A zero line reads, on the job file, as a container that has started
     * costing money. Nothing at all is the honest answer.
     */
    it('writes nothing while the container is still inside its free days', async () => {
      const id = await clock({ freeDays: 10, startsOn: '2033-04-01' })

      await runFreeTimeAccrual(at('2033-04-05'))

      expect(await linesFor(id)).toEqual([])
      expect((await clockRow(id)).accruedDays).toBe(0)
    })

    it('charges from the first day past free time, not from the start', async () => {
      const id = await clock({ freeDays: 3, startsOn: '2033-04-01', perDiem: '10.000' })

      await runFreeTimeAccrual(at('2033-04-04'))

      const [line] = await linesFor(id)
      expect(line?.quantity).toBe('1.000000')
      expect(line?.description).toContain('1 day(s)')
    })

    /** The escalating per-diem a carrier actually writes into a tariff. */
    it('follows the escalation bands where the clock has them', async () => {
      const id = await clock({
        freeDays: 0,
        startsOn: '2033-04-01',
        perDiem: '10.000',
        tiers: [
          { fromDay: 1, perDiem: '10.000' },
          { fromDay: 3, perDiem: '30.000' },
        ],
      })

      await runFreeTimeAccrual(at('2033-04-04'))

      // Days 1–2 at 10, days 3–4 at 30.
      const [line] = await linesFor(id)
      expect(line?.quantity).toBe('4.000000')
      expect(line?.amount).toBe('80.000000')
    })

    /** A Kuwaiti weekend is Friday and Saturday, and a working clock skips it. */
    it('counts working days where the clock is on a working basis', async () => {
      const calendar = await clock({
        freeDays: 0,
        startsOn: '2033-04-01',
        perDiem: '10.000',
        dayBasis: 'calendar',
      })
      const working = await clock({
        freeDays: 0,
        startsOn: '2033-04-01',
        perDiem: '10.000',
        dayBasis: 'working',
      })

      await runFreeTimeAccrual(at('2033-04-10'))

      const [calendarLine] = await linesFor(calendar)
      const [workingLine] = await linesFor(working)
      expect(Number(workingLine?.quantity)).toBeLessThan(Number(calendarLine?.quantity))
    })
  })

  describe('the line it writes', () => {
    it('is a cost accrual against the job, per day, from this clock', async () => {
      const id = await clock({ freeDays: 0, startsOn: '2033-04-01' })

      await runFreeTimeAccrual(at('2033-04-03'))

      const [line] = await linesFor(id)
      expect(line?.jobId).toBe(JOB)
      expect(line?.branchId).toBe(BRANCH)
      expect(line?.direction).toBe('cost')
      expect(line?.basis).toBe('per_day')
      expect(line?.isAccrual).toBe(true)
      expect(line?.sourceKind).toBe('free_time_clock')
      expect(line?.sourceId).toBe(id)
    })

    /** Whoever the days are owed to — the carrier, or the terminal. */
    it('names the counterparty the days are owed to', async () => {
      const id = await clock({ freeDays: 0, startsOn: '2033-04-01' })

      await runFreeTimeAccrual(at('2033-04-03'))

      expect((await linesFor(id))[0]?.counterpartyPartnerId).toBe(PARTNER)
    })

    /**
     * Every line carries a rate and a timestamp, including the same-currency
     * ones where the rate is 1 (FR-RT-06). A line with no rate is one the
     * accounting export cannot convert later, and the special case is the
     * thing that would go missing.
     */
    it('carries an exchange rate and its timestamp even at parity', async () => {
      const id = await clock({ freeDays: 0, startsOn: '2033-04-01', currency: 'KWD' })
      const asOf = at('2033-04-03')

      await runFreeTimeAccrual(asOf)

      const [line] = await linesFor(id)
      expect(Number(line?.fxRate)).toBe(1)
      expect(line?.fxRateAt?.getTime()).toBe(asOf.getTime())
      expect(line?.baseCurrency).toBe('KWD')
      expect(line?.amountBase).toBe(line?.amount)
    })

    it('resolves the charge type from the kind of clock', async () => {
      const id = await clock({ kind: 'storage', freeDays: 0, startsOn: '2033-04-01' })

      await runFreeTimeAccrual(at('2033-04-03'))

      const [line] = await linesFor(id)
      const [type] = await withActor(actor, (tx) =>
        tx
          .select({ key: chargeTypes.key })
          .from(chargeTypes)
          .where(eq(chargeTypes.id, line!.chargeTypeId!)),
      )
      expect(type?.key).toBe('storage')
    })
  })

  describe('running it twice', () => {
    /**
     * The assertion this worker exists to survive.
     *
     * A nightly job runs twice more often than anyone plans for: a crash and a
     * retry, a scheduler firing either side of midnight, an operator running
     * it by hand after a bad night. Two accrual lines against one container are
     * individually plausible and nothing downstream compares them, so the
     * second one is simply a customer overcharged.
     */
    it('updates the same line rather than writing a second', async () => {
      const id = await clock({ freeDays: 0, startsOn: '2033-04-01', perDiem: '20.000' })

      await runFreeTimeAccrual(at('2033-04-03'))
      const first = await linesFor(id)
      await runFreeTimeAccrual(at('2033-04-03'))
      const second = await linesFor(id)

      expect(first).toHaveLength(1)
      expect(second).toHaveLength(1)
      expect(second[0]!.id).toBe(first[0]!.id)
      expect(second[0]!.amount).toBe(first[0]!.amount)
    })

    it('extends the same line as the days go on', async () => {
      const id = await clock({ freeDays: 0, startsOn: '2033-04-01', perDiem: '20.000' })

      await runFreeTimeAccrual(at('2033-04-03'))
      const early = (await linesFor(id))[0]!
      await runFreeTimeAccrual(at('2033-04-06'))
      const later = (await linesFor(id))[0]!

      expect(later.id).toBe(early.id)
      expect(Number(later.amount)).toBeGreaterThan(Number(early.amount))
      expect(await linesFor(id)).toHaveLength(1)
    })
  })

  describe('what it writes back on the clock', () => {
    it('records the days, the amount, and when it last looked', async () => {
      const id = await clock({ freeDays: 0, startsOn: '2033-04-01', perDiem: '20.000' })
      const asOf = at('2033-04-03')

      await runFreeTimeAccrual(asOf)

      const row = await clockRow(id)
      expect(row.accruedDays).toBe(3)
      expect(row.accruedAmount).toBe('60.000000')
      expect(row.lastAccruedAt?.getTime()).toBe(asOf.getTime())
    })

    /** The job screen reads the amount off the clock, and the line off this. */
    it('points the clock at the line it wrote', async () => {
      const id = await clock({ freeDays: 0, startsOn: '2033-04-01' })

      await runFreeTimeAccrual(at('2033-04-03'))

      const row = await clockRow(id)
      const [line] = await linesFor(id)
      expect(row.chargeLineId).toBe(line!.id)
    })
  })

  describe('what it leaves alone', () => {
    /**
     * The container has gone. Whatever it accrued is history now, and a run a
     * week later must not quietly extend the bill.
     */
    it('never touches a clock that has been closed', async () => {
      const id = await clock({ freeDays: 0, startsOn: '2033-04-01', endsOn: '2033-04-03' })

      await runFreeTimeAccrual(at('2033-05-01'))

      expect(await linesFor(id)).toEqual([])
      expect((await clockRow(id)).lastAccruedAt).toBeNull()
    })

    it('stops extending a line once the clock is closed', async () => {
      const id = await clock({ freeDays: 0, startsOn: '2033-04-01', perDiem: '20.000' })
      await runFreeTimeAccrual(at('2033-04-03'))
      const whileOpen = (await linesFor(id))[0]!.amount

      await withActor(systemActor, (tx) =>
        tx.update(freeTimeClocks).set({ endsOn: '2033-04-03' }).where(eq(freeTimeClocks.id, id)),
      )
      await runFreeTimeAccrual(at('2033-05-01'))

      expect((await linesFor(id))[0]!.amount).toBe(whileOpen)
    })

    it('reports how many open clocks it looked at', async () => {
      await clock({ freeDays: 0, startsOn: '2033-04-01' })

      const result = await runFreeTimeAccrual(at('2033-04-03'))

      expect(result.clocks).toBeGreaterThan(0)
      expect(result.lines).toBeGreaterThan(0)
      expect(result.lines).toBeLessThanOrEqual(result.clocks)
    })
  })
})
