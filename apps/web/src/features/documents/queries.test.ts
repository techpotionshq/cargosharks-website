/**
 * The per-job document reads — parties, cargo, containers.
 *
 * These feed the bill of lading and the packing list, so "empty" and "not
 * visible" must look the same to the caller and neither may throw: a job in
 * another branch is invisible to the query rather than forbidden by it
 * (FR-ID-04).
 */

import { beforeAll, describe, expect, it } from 'vitest'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const { AWAY_JOB, HOME_JOB, homeActor, world } = await import('@/lib/testing/fixtures')
const { listJobParties, listJobCargo, listJobContainers } = await import('./queries')

describe.skipIf(!enabled)('document reads', () => {
  beforeAll(async () => {
    await world()
  })

  it('lists the parties on a job', async () => {
    expect(Array.isArray(await listJobParties(homeActor, HOME_JOB))).toBe(true)
  })

  it('lists the cargo on a job', async () => {
    expect(Array.isArray(await listJobCargo(homeActor, HOME_JOB))).toBe(true)
  })

  it('lists the containers on a job', async () => {
    expect(Array.isArray(await listJobContainers(homeActor, HOME_JOB))).toBe(true)
  })

  /** Another branch's shipment reads as empty rather than raising. */
  it('returns nothing for a job the actor cannot see', async () => {
    expect(await listJobParties(homeActor, AWAY_JOB)).toEqual([])
    expect(await listJobCargo(homeActor, AWAY_JOB)).toEqual([])
    expect(await listJobContainers(homeActor, AWAY_JOB)).toEqual([])
  })
})
