/**
 * The dashboard — one query that answers about a dozen questions at once.
 *
 * It is the first screen anybody sees, it runs on every load, and every figure
 * on it is a count. That combination is exactly where the correlated-subquery
 * bug lived: every open-jobs count in the product read zero, nothing errored,
 * and the board looked like a quiet morning.
 *
 * So this checks a figure against the register it summarises rather than
 * checking that the call returned an object.
 */

import { beforeAll, describe, expect, it } from 'vitest'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const { bothBranchesActor, homeActor, world } = await import('@/lib/testing/fixtures')
const { getOpsOverview, getMapData } = await import('./queries')

describe.skipIf(!enabled)('dashboard', () => {
  beforeAll(async () => {
    await world()
  })

  it('answers with an overview', async () => {
    expect(await getOpsOverview(homeActor)).toBeDefined()
  })

  /**
   * The fixtures put one live shipment in each branch. A principal holding
   * both must therefore see a larger live count than one holding a single
   * branch — the assertion a count that ignores its scope cannot pass.
   */
  it('counts more for a principal who can see more', async () => {
    const narrow = await getOpsOverview(homeActor)
    const wide = await getOpsOverview(bothBranchesActor)

    expect(narrow.jobs.live).toBeGreaterThan(0)
    expect(wide.jobs.live).toBeGreaterThan(narrow.jobs.live)
  })

  /*
    F15. Quoted value and accruing demurrage were each one sum across every
    currency, labelled KWD. They are lists now, one figure per currency, and
    the trend hands over days for the page to word (U1: "17 Sep" in Arabic).
  */
  it('keeps money in its own currency and hands the trend over as days', async () => {
    const overview = await getOpsOverview(bothBranchesActor)

    for (const entry of [...overview.quotes.quotedValue, ...overview.clocks.accruing]) {
      expect(entry.currency).toMatch(/^[A-Z]{3}$/)
      expect(typeof entry.amount).toBe('string')
    }
    const currencies = overview.quotes.quotedValue.map((entry) => entry.currency)
    expect(new Set(currencies).size).toBe(currencies.length)
    expect(overview.enquiries.trend[0]?.label).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('builds map data without throwing', async () => {
    expect(await getMapData(homeActor)).toBeDefined()
  })
})
