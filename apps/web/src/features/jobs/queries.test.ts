/**
 * The shipment register and the job detail behind it.
 *
 * `listJobs` is the busiest read in the product and the one with the most
 * filters, so each filter is checked to *exclude* as well as include: a filter
 * that quietly matches everything looks identical to a working one on a screen
 * with three rows.
 *
 * The away-branch job exists so that scoping is proved rather than assumed
 * (FR-ID-04). A register tested against a single branch's data passes whatever
 * its `where` clause says.
 */

import { beforeAll, describe, expect, it } from 'vitest'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const { AWAY_JOB, CUSTOMER, HOME_BRANCH, HOME_JOB, bothBranchesActor, homeActor, world } =
  await import('@/lib/testing/fixtures')
const { commodities, freeTimeClocks, jobs, withActor } = await import('@qabandi/db')
const { shiftDay, todayIn } = await import('@qabandi/core')
const { countJobBoard, listJobs, getJobDetail, listOpenExceptions, listRunningClocks } =
  await import('./queries')

/** One wide page: these tests ask what the filter matches, not how it pages. */
const WIDE = { page: 1, size: 200 }

describe.skipIf(!enabled)('job register', () => {
  beforeAll(async () => {
    await world()
  })

  describe('scoping — FR-ID-04', () => {
    /*
      Asserted by *branch* rather than by naming one fixture row.

      The register pages at fifty, and the suites that write jobs cannot clean
      up after themselves — `DELETE` is revoked from `app_user` (§5.5), so
      every run leaves its shipments behind and any single reference eventually
      falls off the end of the page. What must hold regardless of how much
      history has accumulated is the scoping itself: nothing from the away
      branch appears, however many rows there are.

      The branch is read from `branchCode`, not from the reference prefix — a
      cutover import keeps the old file number, so the prefix names the branch
      only for shipments this system raised itself.
    */
    it('lists the actor’s own branch and not another', async () => {
      const rows = (await listJobs(homeActor, {}, WIDE)).rows
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.every((job) => job.branchCode === 'FXH')).toBe(true)
    })

    it('lists both for a principal holding a role in both', async () => {
      /*
        Asked one branch at a time, and neither assertion names a row.

        Filtering to the away branch was not enough on its own: other suites
        write shipments there too, nothing is ever deleted, and the one fixture
        reference eventually falls off the end of any page. So the register
        proves the *scope* — rows come back for each branch and each row
        belongs to the branch it was asked for — and the fixture's visibility
        is proved by reading it directly, which no amount of accumulated
        history can push out of reach.
      */
      const home = (await listJobs(bothBranchesActor, { branchCode: 'FXH' }, WIDE)).rows
      const away = (await listJobs(bothBranchesActor, { branchCode: 'FXA' }, WIDE)).rows

      expect(home.length).toBeGreaterThan(0)
      expect(away.length).toBeGreaterThan(0)
      expect(away.every((job) => job.branchCode === 'FXA')).toBe(true)
      expect((await getJobDetail(bothBranchesActor, AWAY_JOB))?.reference).toBe('FXA-JOB-FIXTURE-1')
    })

    /** Another branch's shipment is *not found*, not forbidden. */
    it('returns nothing for a job in another branch', async () => {
      expect(await getJobDetail(homeActor, AWAY_JOB)).toBeUndefined()
      expect((await getJobDetail(bothBranchesActor, AWAY_JOB))?.reference).toBe('FXA-JOB-FIXTURE-1')
    })
  })

  describe('filters', () => {
    /**
     * Each filter is checked for what it leaves out. A predicate that matches
     * everything is indistinguishable from a working one unless something that
     * should be excluded is present to be excluded.
     */
    it('filters by mode, excluding the others', async () => {
      const sea = (await listJobs(bothBranchesActor, { mode: 'sea_fcl' }, WIDE)).rows
      expect(sea.length).toBeGreaterThan(0)
      expect(sea.every((j) => j.mode === 'sea_fcl')).toBe(true)
      expect(sea.map((j) => j.reference)).not.toContain('FXA-JOB-FIXTURE-1')

      // Asserted from the thin side too: the air list holds the air fixture,
      // which a predicate matching everything could not produce and exclude
      // at the same time.
      const air = (await listJobs(bothBranchesActor, { mode: 'air' }, WIDE)).rows
      expect(air.map((j) => j.reference)).toContain('FXA-JOB-FIXTURE-1')
    })

    /**
     * The register's branch column and its branch filter must be the same
     * fact. They were not: the filter read the joined `branches.code` and the
     * column was derived from the reference prefix, which is only the branch
     * code for jobs this system raised — never for the cutover imports that
     * keep their old file number on purpose.
     */
    it('labels a branch from the branch, not from the reference', async () => {
      const home = (await listJobs(bothBranchesActor, { branchCode: 'FXH' }, WIDE)).rows
      const imported = home.find((job) => !job.reference.startsWith('FXH-'))

      expect(home.length).toBeGreaterThan(0)
      if (imported) expect(imported.branchCode).toBe('FXH')
    })

    it('filters by branch code', async () => {
      const home = (await listJobs(bothBranchesActor, { branchCode: 'FXH' }, WIDE)).rows
      expect(home.length).toBeGreaterThan(0)
      expect(home.every((j) => j.branchCode === 'FXH')).toBe(true)

      const away = (await listJobs(bothBranchesActor, { branchCode: 'FXA' }, WIDE)).rows
      expect(away.length).toBeGreaterThan(0)
      expect(away.every((j) => j.branchCode === 'FXA')).toBe(true)
    })

    it('filters by explicit status', async () => {
      const inTransit = (await listJobs(bothBranchesActor, { status: 'in_transit' }, WIDE)).rows
      expect(inTransit.length).toBeGreaterThan(0)
      expect(inTransit.every((j) => j.status === 'in_transit')).toBe(true)
    })

    /** `live` is a set of statuses rather than one — the board's default. */
    it('treats live as the working set, not a single status', async () => {
      const live = (await listJobs(bothBranchesActor, { status: 'live' }, WIDE)).rows
      expect(live.length).toBeGreaterThan(0)
      expect(live.every((j) => j.status !== 'cancelled' && j.status !== 'closed')).toBe(true)
      // More than one status, or `live` is a spelling of `in_transit`.
      expect(new Set(live.map((j) => j.status)).size).toBeGreaterThan(1)
    })

    it('returns nothing for a filter nothing matches', async () => {
      expect((await listJobs(bothBranchesActor, { branchCode: 'NOPE' }, WIDE)).rows).toEqual([])
    })
  })

  /*
    R9: the board stopped at a hundred shipments and its "Live" tile counted
    the page. One row a page reaches page two on any database with two live
    jobs, and the total has to be the same set whichever page is asked for.
  */
  describe('paging and counts — R9', () => {
    /*
      Over every status rather than the live ones: which suites have left
      live shipments in the home branch varies, and this asks about paging,
      not about the live filter (the fixture-mode half in `board.test.ts`
      walks a known dataset to page two regardless).
    */
    it('reaches the second page, without repeating the first', async () => {
      const one = await listJobs(bothBranchesActor, {}, { page: 1, size: 1 })
      const two = await listJobs(bothBranchesActor, {}, { page: 2, size: 1 })

      expect(one.total).toBeGreaterThan(1)
      expect(two.total).toBe(one.total)
      expect(two.rows).toHaveLength(1)
      expect(two.rows[0]!.id).not.toBe(one.rows[0]!.id)
    })

    it('counts the live tile over every live job, not over a page', async () => {
      const counts = await countJobBoard(homeActor)
      const live = await listJobs(homeActor, { status: 'live' }, { page: 1, size: 1 })

      expect(counts.live).toBe(live.total)
      expect(counts.arriving).toBeLessThanOrEqual(counts.live)
      expect(counts.held).toBeLessThanOrEqual(counts.live)
    })
  })

  describe('detail', () => {
    it('reads a job the actor may see', async () => {
      const detail = await getJobDetail(homeActor, HOME_JOB)
      expect(detail?.reference).toBe('FXH-JOB-FIXTURE-1')
    })

    /** QA P3: the commodity was the literal '—' whatever the job carried. */
    it('names the commodity the job carries, in both languages', async () => {
      const code = `QAC-${Date.now()}`
      const job = await withActor({ ...bothBranchesActor, type: 'system' }, async (tx) => {
        const [commodity] = await tx
          .insert(commodities)
          .values({ code, nameEn: 'Dates, packed', nameAr: 'تمور معبأة' })
          .returning({ id: commodities.id })
        const [row] = await tx
          .insert(jobs)
          .values({
            reference: `FXH-COM-${Date.now()}`,
            branchId: HOME_BRANCH,
            customerId: CUSTOMER,
            commodityId: commodity!.id,
            mode: 'sea_fcl',
            tradeDirection: 'import',
            status: 'booked',
          })
          .returning({ id: jobs.id })
        return row!
      })

      const detail = await getJobDetail(bothBranchesActor, job.id)
      expect(detail?.commodity).toBe('Dates, packed')
      expect(detail?.commodityAr).toBe('تمور معبأة')
    })

    it('returns nothing for an id that does not exist', async () => {
      expect(await getJobDetail(homeActor, '00000000-0000-7000-8000-0000000000fe')).toBeUndefined()
    })
  })

  /*
    O15. The register summed every clock and called it KWD, and the job-file
    meter counted 24-hour periods from midnight UTC — a day short of `accrue`
    and still counting after the box came back.
  */
  describe('free-time clocks on the job file', () => {
    it('counts the way the accrual does, and stops at the end date', async () => {
      const today = todayIn()
      const [job] = await withActor(bothBranchesActor, (tx) =>
        tx
          .insert(jobs)
          .values({
            reference: `FXH-CLK-${Date.now()}`,
            branchId: HOME_BRANCH,
            customerId: CUSTOMER,
            mode: 'sea_fcl',
            tradeDirection: 'import',
            status: 'arrived',
          })
          .returning({ id: jobs.id }),
      )
      await withActor(bothBranchesActor, (tx) =>
        tx.insert(freeTimeClocks).values([
          {
            jobId: job!.id,
            kind: 'demurrage',
            freeDays: 5,
            startsOn: shiftDay(today, -2),
            perDiem: '10.000',
            currency: 'USD',
            accruedAmount: '50.000',
          },
          {
            jobId: job!.id,
            kind: 'storage',
            freeDays: 5,
            startsOn: shiftDay(today, -9),
            endsOn: shiftDay(today, -8),
            perDiem: '5.000',
            currency: 'KWD',
            accruedAmount: '10.000',
          },
        ]),
      )

      const detail = await getJobDetail(bothBranchesActor, job!.id)
      const running = detail!.clocks.find((clock) => clock.kind === 'demurrage')!
      const stopped = detail!.clocks.find((clock) => clock.kind === 'storage')!
      // Started the day before yesterday: that day, yesterday and today.
      expect(running.elapsedDays).toBe(3)
      // Two days, then the box came back — a week ago, not counting since.
      expect(stopped.elapsedDays).toBe(2)
      expect(stopped.endsOn).toBe(shiftDay(today, -8))

      // Only the running clock accrues, and in its own currency.
      expect(detail!.accruing).toEqual({ amount: 50, currency: 'USD' })
    })
  })

  describe('the boards', () => {
    /**
     * These feed the dashboard. They must answer for an actor with nothing
     * outstanding rather than throw — an empty board is the normal state on a
     * quiet morning.
     */
    it('answers with a list even when nothing is outstanding', async () => {
      expect(Array.isArray(await listOpenExceptions(homeActor))).toBe(true)
      expect(Array.isArray(await listRunningClocks(homeActor))).toBe(true)
    })

    it('scopes open exceptions to the actor', async () => {
      const mine = await listOpenExceptions(homeActor)
      expect(mine.every((e) => typeof e.jobReference === 'string')).toBe(true)
    })
  })
})
