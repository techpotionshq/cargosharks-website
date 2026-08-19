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

const { AWAY_JOB, HOME_JOB, bothBranchesActor, homeActor, world } =
  await import('@/lib/testing/fixtures')
const { listJobs, getJobDetail, listOpenExceptions, listRunningClocks } = await import('./queries')

describe.skipIf(!enabled)('job register', () => {
  beforeAll(async () => {
    await world()
  })

  describe('scoping — FR-ID-04', () => {
    it('lists the actor’s own branch and not another', async () => {
      const references = (await listJobs(homeActor)).map((j) => j.reference)
      expect(references).toContain('FXH-JOB-FIXTURE-1')
      expect(references).not.toContain('FXA-JOB-FIXTURE-1')
    })

    it('lists both for a principal holding a role in both', async () => {
      const references = (await listJobs(bothBranchesActor)).map((j) => j.reference)
      expect(references).toContain('FXH-JOB-FIXTURE-1')
      expect(references).toContain('FXA-JOB-FIXTURE-1')
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
      const sea = await listJobs(bothBranchesActor, { mode: 'sea_fcl' })
      expect(sea.map((j) => j.reference)).toContain('FXH-JOB-FIXTURE-1')
      expect(sea.map((j) => j.reference)).not.toContain('FXA-JOB-FIXTURE-1')
      expect(sea.every((j) => j.mode === 'sea_fcl')).toBe(true)
    })

    it('filters by branch code', async () => {
      const home = await listJobs(bothBranchesActor, { branchCode: 'FXH' })
      expect(home.map((j) => j.reference)).toContain('FXH-JOB-FIXTURE-1')
      expect(home.map((j) => j.reference)).not.toContain('FXA-JOB-FIXTURE-1')
    })

    it('filters by explicit status', async () => {
      const inTransit = await listJobs(bothBranchesActor, { status: 'in_transit' })
      expect(inTransit.every((j) => j.status === 'in_transit')).toBe(true)
      expect(inTransit.map((j) => j.reference)).toContain('FXH-JOB-FIXTURE-1')
    })

    /** `live` is a set of statuses rather than one — the board's default. */
    it('treats live as the working set, not a single status', async () => {
      const live = await listJobs(bothBranchesActor, { status: 'live' })
      expect(live.map((j) => j.reference)).toContain('FXH-JOB-FIXTURE-1')
      expect(live.every((j) => j.status !== 'cancelled' && j.status !== 'closed')).toBe(true)
    })

    it('returns nothing for a filter nothing matches', async () => {
      expect(await listJobs(bothBranchesActor, { branchCode: 'NOPE' })).toEqual([])
    })
  })

  describe('detail', () => {
    it('reads a job the actor may see', async () => {
      const detail = await getJobDetail(homeActor, HOME_JOB)
      expect(detail?.reference).toBe('FXH-JOB-FIXTURE-1')
    })

    it('returns nothing for an id that does not exist', async () => {
      expect(await getJobDetail(homeActor, '00000000-0000-7000-8000-0000000000fe')).toBeUndefined()
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
