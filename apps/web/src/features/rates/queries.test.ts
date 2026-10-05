/**
 * The rate register's tab counts (D9).
 *
 * The All/Buying/Selling counts were computed from the rows already filtered
 * by the selected tab, so on ?direction=sell the tabs read "Buying 0". They
 * now come from `rateCardSummary`, which counts every card the reader may see
 * regardless of the tab. Proved on the pilot branch, which the hosted demo and
 * the e2e suite render, and against real rows where a database is configured.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const pilot = vi.hoisted(() => ({ on: false }))
vi.mock('@/lib/pilot/source', () => ({ usePilotFixtures: () => pilot.on }))

const { world, bothBranchesActor } = await import('@/lib/testing/fixtures')
const { listRateCards, rateCardSummary } = await import('./queries')

describe('rate register tab counts on the pilot branch', () => {
  it('counts every card by direction, whichever tab is open', async () => {
    pilot.on = true
    try {
      const { cards } = await rateCardSummary(bothBranchesActor)
      const all = await listRateCards(bothBranchesActor)
      const sell = await listRateCards(bothBranchesActor, 'sell')
      expect(cards.all).toBe(all.total)
      expect(cards.buy).toBe(all.rows.filter((r) => r.direction === 'buy').length)
      expect(cards.sell).toBe(sell.total)
      // The bug in one line: the sell tab's rows hold no buy card at all.
      expect(sell.rows.some((r) => r.direction === 'buy')).toBe(false)
      expect(cards.buy).toBeGreaterThan(0)
    } finally {
      pilot.on = false
    }
  })
})

describe.skipIf(!enabled)('rate register tab counts against the database', () => {
  beforeAll(async () => {
    await world()
  })

  it('splits the visible cards into buy and sell without the tab filter', async () => {
    const { cards } = await rateCardSummary(bothBranchesActor)
    const buy = await listRateCards(bothBranchesActor, 'buy')
    const sell = await listRateCards(bothBranchesActor, 'sell')
    expect(cards.buy + cards.sell).toBe(cards.all)
    // The register's own total, so the two agree exactly however many cards
    // there are; while it was capped at 200 this could only be checked below it.
    expect(cards.buy).toBe(buy.total)
    expect(cards.sell).toBe(sell.total)
  })
})
