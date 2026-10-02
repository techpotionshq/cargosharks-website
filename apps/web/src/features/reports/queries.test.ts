/**
 * The margin report, against a real database.
 *
 * What is pinned here is the grouping. `amount_base` is in each branch's own
 * base currency, and every cut except the branch one used to sum across
 * branches — dinars and dirhams in one figure, labelled with whichever
 * currency sorted first. Each row now carries one base currency, so a group
 * that spans two is two rows (F16).
 */

import { beforeAll, describe, expect, it } from 'vitest'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const { bothBranchesActor, world } = await import('@/lib/testing/fixtures')
const { REPORT_DIMENSIONS, marginByDimension } = await import('./queries')

describe.skipIf(!enabled)('margin by dimension', () => {
  beforeAll(async () => {
    await world()
  })

  it.each(REPORT_DIMENSIONS)('keeps each %s row in one base currency', async (dimension) => {
    const rows = await marginByDimension(bothBranchesActor, dimension, {
      from: '2000-01-01',
      to: '2100-12-31',
    })

    const keys = rows.map((row) => `${row.key}:${row.currency}`)
    expect(new Set(keys).size).toBe(keys.length)
    for (const row of rows) expect(row.currency).toMatch(/^[A-Z]{3}$/)
  })
})
