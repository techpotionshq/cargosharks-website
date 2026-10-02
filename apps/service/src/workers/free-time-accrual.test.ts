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
 * **A stopped clock is settled at its end, never extended past it.** The
 * container has gone; a later run must not extend the bill — but a stop entered
 * late, or corrected backwards, must take back the days after it.
 *
 * **Every line carries an FX rate and a timestamp**, even the same-currency
 * ones where the rate is 1 (FR-RT-06), and a foreign-currency clock is
 * converted at a real rate, never at parity.
 *
 * **A finished job, or a line already invoiced or matched to a bill, is left
 * alone.**
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
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
  fxRates,
  jobs,
  partners,
  principals,
  supplierInvoiceLines,
  supplierInvoiceMatches,
  supplierInvoices,
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
/** A job that has been closed — nothing accrues against it any more. */
const CLOSED_JOB = '00000000-0000-7000-8000-00000000fa06'

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

      await tx
        .insert(jobs)
        .values({
          id: CLOSED_JOB,
          reference: `FTA-CLOSED-${RUN}`,
          branchId: BRANCH,
          customerId: CUSTOMER,
          mode: 'sea_fcl',
          tradeDirection: 'import',
          status: 'closed',
        })
        .onConflictDoNothing()

      /*
        One OMR rate, dated inside the suite's 2033 window and identical on
        every run, so whichever run's row is "latest" the figure is the same.
        OMR, because no other suite converts it — a USD row dated 2033 would
        become every other suite's latest dollar.
      */
      await tx
        .insert(fxRates)
        .values({
          fromCurrency: 'OMR',
          toCurrency: 'KWD',
          rate: '0.79800000',
          source: 'fta-fixture',
          effectiveOn: '2033-04-01',
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
      tx
        .update(freeTimeClocks)
        .set({ endsOn: '2033-12-31' })
        .where(inArray(freeTimeClocks.jobId, [JOB, CLOSED_JOB])),
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

    /*
      A carrier's USD or OMR per-diem was written at rate 1, so USD 750 sat in
      margin and reports as KWD 750 (V3). Converted at the latest rate on or
      before the day.
    */
    it('converts a foreign-currency clock to the branch base at a real rate', async () => {
      const id = await clock({
        freeDays: 0,
        startsOn: '2033-04-01',
        perDiem: '10.000',
        currency: 'OMR',
      })

      await runFreeTimeAccrual(at('2033-04-03'))

      const [line] = await linesFor(id)
      expect(line?.currency).toBe('OMR')
      expect(line?.amount).toBe('30.000000')
      expect(Number(line?.fxRate)).toBe(0.798)
      expect(line?.baseCurrency).toBe('KWD')
      expect(line?.amountBase).toBe('23.940000')
    })

    it('writes nothing at parity when there is no rate to the base', async () => {
      const id = await clock({
        freeDays: 0,
        startsOn: '2033-04-01',
        perDiem: '10.000',
        currency: 'SAR',
      })

      const result = await runFreeTimeAccrual(at('2033-04-03'))

      expect(await linesFor(id)).toEqual([])
      expect(result.unconvertible).toBeGreaterThan(0)
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
    it('settles a clock closed before it ever ran at its end, not at today', async () => {
      const id = await clock({
        freeDays: 0,
        startsOn: '2033-04-01',
        endsOn: '2033-04-03',
        perDiem: '20.000',
      })

      await runFreeTimeAccrual(at('2033-05-01'))

      const [line] = await linesFor(id)
      // 1–3 April, not 1 April to 1 May.
      expect(line?.quantity).toBe('3.000000')
      expect(line?.amount).toBe('60.000000')
    })

    /*
      A container returned on the 7th, entered on the 10th: the three nights
      after the return were billed and stayed billed, because a stopped clock
      dropped out of the sweep with what it had (V4).
    */
    it('takes back the days after a stop that was entered late', async () => {
      const id = await clock({ freeDays: 0, startsOn: '2033-04-01', perDiem: '20.000' })
      await runFreeTimeAccrual(at('2033-04-10'))
      expect((await linesFor(id))[0]!.amount).toBe('200.000000')

      await withActor(systemActor, (tx) =>
        tx.update(freeTimeClocks).set({ endsOn: '2033-04-07' }).where(eq(freeTimeClocks.id, id)),
      )
      await runFreeTimeAccrual(at('2033-04-11'))

      const lines = await linesFor(id)
      expect(lines).toHaveLength(1)
      expect(lines[0]!.quantity).toBe('7.000000')
      expect(lines[0]!.amount).toBe('140.000000')
      expect((await clockRow(id)).accruedDays).toBe(7)
    })

    it('runs to today, not to a stop dated in the future', async () => {
      const id = await clock({
        freeDays: 0,
        startsOn: '2033-04-01',
        endsOn: '2033-04-20',
        perDiem: '20.000',
      })

      await runFreeTimeAccrual(at('2033-04-05'))

      expect((await linesFor(id))[0]!.quantity).toBe('5.000000')
    })

    /* O2: a job that is closed is finished, whatever its clocks say. */
    it('accrues nothing against a closed job', async () => {
      const id = await clock({ jobId: CLOSED_JOB, freeDays: 0, startsOn: '2033-04-01' })

      await runFreeTimeAccrual(at('2033-04-10'))

      expect(await linesFor(id)).toEqual([])
    })

    /*
      O2: a line matched to the carrier's bill is a figure the payable agrees
      with. Re-pricing it underneath the match would make the two disagree with
      nobody having changed either.
    */
    it('does not re-price a line already matched to a supplier bill', async () => {
      const id = await clock({ freeDays: 0, startsOn: '2033-04-01', perDiem: '20.000' })
      await runFreeTimeAccrual(at('2033-04-03'))
      const [line] = await linesFor(id)
      expect(line!.amount).toBe('60.000000')

      await withActor(systemActor, async (tx) => {
        const [bill] = await tx
          .insert(supplierInvoices)
          .values({
            branchId: BRANCH,
            partnerId: PARTNER,
            reference: `FTA-BILL-${RUN}-${seq}`,
            currency: 'KWD',
            invoiceDate: '2033-04-04',
            subtotal: '60.000',
            total: '60.000',
          })
          .returning({ id: supplierInvoices.id })
        const [billLine] = await tx
          .insert(supplierInvoiceLines)
          .values({
            supplierInvoiceId: bill!.id,
            branchId: BRANCH,
            jobId: JOB,
            description: 'Demurrage',
            unitPrice: '60.000',
            amount: '60.000',
          })
          .returning({ id: supplierInvoiceLines.id })
        await tx.insert(supplierInvoiceMatches).values({
          supplierInvoiceLineId: billLine!.id,
          chargeLineId: line!.id,
          branchId: BRANCH,
          amount: '60.000',
        })
      })

      const result = await runFreeTimeAccrual(at('2033-04-10'))

      expect((await linesFor(id))[0]!.amount).toBe('60.000000')
      expect(result.frozen).toBeGreaterThan(0)
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
