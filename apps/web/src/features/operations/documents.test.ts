/**
 * The documents register pages, searches and filters — offline.
 *
 * Live run 5 found 105 documents in one unbroken list with no search and no
 * filter. The pilot dataset has the same 105, which is what makes this the
 * register where page three is reachable offline.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/pilot/source', () => ({ usePilotFixtures: () => true }))

const { documentCounts, listDocuments } = await import('./queries')

const actor = { principalId: 'person-00', type: 'internal' as const, branchIds: [] }

describe('the documents register on fixtures', () => {
  it('pages fifty at a time, and the last page holds the rest', async () => {
    const one = await listDocuments(actor, 'en')
    const last = await listDocuments(actor, 'en', {}, { page: 3, size: 50 })

    expect(one.total).toBeGreaterThan(100)
    expect(one.rows).toHaveLength(50)
    expect(last.rows).toHaveLength(one.total - 100)
  })

  it('finds a shipment’s documents by its reference, and counts only those', async () => {
    const reference = (await listDocuments(actor, 'en')).rows[0]!.jobReference
    const hits = await listDocuments(actor, 'en', { search: reference })
    const counts = await documentCounts(actor, reference)

    expect(hits.total).toBeGreaterThan(0)
    expect(hits.rows.every((row) => row.jobReference === reference)).toBe(true)
    expect(counts.total).toBe(hits.total)
  })

  it('filters released from not yet released, as the counts split them', async () => {
    const counts = await documentCounts(actor)
    const released = await listDocuments(actor, 'en', { state: 'released' })
    const draft = await listDocuments(actor, 'en', { state: 'draft' })

    expect(released.total).toBe(counts.released)
    expect(draft.total).toBe(counts.draft)
    expect(released.total + draft.total).toBe(counts.total)
    expect(released.rows.every((row) => row.releasedAt !== null)).toBe(true)
  })
})
