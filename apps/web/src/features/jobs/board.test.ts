/**
 * The jobs board pages and counts on the pilot dataset — R9, offline.
 *
 * Live run 5: 336 live shipments, a board that stopped at the hundredth by
 * ETA with no way on, and a "Live" tile that read 100. The database half is
 * in `queries.test.ts`; this half runs everywhere, because the fixture branch
 * is what the hosted demo and the offline end-to-end run see, and it must
 * page exactly as the query does.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/pilot/source', () => ({ usePilotFixtures: () => true }))

const { countJobBoard, listJobs, ARRIVING_WITHIN_DAYS } = await import('./queries')

// Fixture mode never reaches the database; the actor is only a signature.
const actor = { principalId: 'person-00', type: 'internal' as const, branchIds: [] }

describe('the jobs board on fixtures', () => {
  it('reaches page two, and the pages neither overlap nor disagree on the total', async () => {
    const one = await listJobs(actor, { status: 'live' }, { page: 1, size: 5 })
    const two = await listJobs(actor, { status: 'live' }, { page: 2, size: 5 })

    expect(one.total).toBeGreaterThan(5)
    expect(two.total).toBe(one.total)
    expect(two.rows).toHaveLength(Math.min(5, one.total - 5))
    const firstIds = new Set(one.rows.map((job) => job.id))
    expect(two.rows.some((job) => firstIds.has(job.id))).toBe(false)
  })

  it('counts the Live tile over every live job, not the page', async () => {
    const counts = await countJobBoard(actor)
    const page = await listJobs(actor, { status: 'live' }, { page: 1, size: 1 })

    expect(page.rows).toHaveLength(1)
    expect(counts.live).toBe(page.total)
    expect(counts.live).toBeGreaterThan(1)
  })

  it('counts arrivals the way the Arriving filter pages them', async () => {
    const counts = await countJobBoard(actor)
    const arriving = await listJobs(
      actor,
      { status: 'live', arrivingWithinDays: ARRIVING_WITHIN_DAYS },
      { page: 1, size: 1 },
    )
    expect(counts.arriving).toBe(arriving.total)
  })
})
