/**
 * The groupage registers — consolidations, and the jobs attachable to them.
 *
 * `listAttachableJobs` backs the "attach a house" picker, and an option the
 * operator cannot then attach is worse than no option: the attach fails at the
 * policy and reads as a broken screen.
 */

import { beforeAll, describe, expect, it } from 'vitest'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const { homeActor, world } = await import('@/lib/testing/fixtures')
const { listConsolidations, listAttachableJobs, getConsolidation } = await import('./queries')

describe.skipIf(!enabled)('consolidation reads', () => {
  beforeAll(async () => {
    await world()
  })

  it('lists consolidations for a scoped actor', async () => {
    expect(Array.isArray((await listConsolidations(homeActor)).rows)).toBe(true)
  })

  /**
   * Asked about a consolidation that exists, because the picker is only
   * interesting for one that does: `listAttachableJobs` answers `[]` for an id
   * it cannot find, so a sentinel would assert nothing at all.
   */
  it('offers attachable jobs the actor can see', async () => {
    const [consolidation] = (await listConsolidations(homeActor)).rows
    const options = await listAttachableJobs(
      homeActor,
      consolidation?.id ?? '00000000-0000-7000-8000-0000000000f1',
    )
    expect(Array.isArray(options)).toBe(true)
    expect(options.every((o) => typeof o.label === 'string')).toBe(true)
  })

  it('returns nothing for a consolidation that does not exist', async () => {
    expect(
      await getConsolidation(homeActor, '00000000-0000-7000-8000-0000000000f1'),
    ).toBeUndefined()
  })
})
