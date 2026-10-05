/**
 * The customers register pages on the pilot dataset — R10, offline.
 *
 * Live run 5 had 211 customers and a register that stopped at 200 by name, so
 * Jahra Industries was missing from the list while the search box found it.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/pilot/source', () => ({ usePilotFixtures: () => true }))

const { listCustomers } = await import('./queries')

const actor = { principalId: 'person-00', type: 'internal' as const, branchIds: [] }

describe('the customers register on fixtures', () => {
  it('reaches the last customer by name through the pages', async () => {
    const all = await listCustomers(actor, undefined, { page: 1, size: 500 })
    const size = 5
    const pages = Math.ceil(all.total / size)
    const last = await listCustomers(actor, undefined, { page: pages, size })

    expect(all.total).toBeGreaterThan(size)
    expect(last.total).toBe(all.total)
    expect(last.rows.at(-1)?.id).toBe(all.rows.at(-1)?.id)
  })

  it('pages the search results and counts them, not the whole register', async () => {
    const all = await listCustomers(actor)
    const term = all.rows[0]!.legalNameEn.slice(0, 4)
    const hits = await listCustomers(actor, term)

    expect(hits.total).toBe(hits.rows.length)
    expect(hits.total).toBeLessThanOrEqual(all.total)
    expect(
      hits.rows.every(
        (row) =>
          row.legalNameEn.toLowerCase().includes(term.toLowerCase()) ||
          row.code.toLowerCase().includes(term.toLowerCase()),
      ),
    ).toBe(true)
  })
})
