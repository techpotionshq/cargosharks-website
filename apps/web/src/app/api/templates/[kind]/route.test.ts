/**
 * The downloaded template is named for the deployment's brand.
 *
 * It was `qabandi-<kind>-template.csv` on every deployment, so the CargoSharks
 * demo handed a visitor a file carrying a client's name. The brand is mocked to
 * one that is not the default, because under the default the old literal and
 * the new derivation print the same filename and the test would prove nothing.
 * No database: a template is generated from the descriptor.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/session', () => ({
  getSession: async () => ({
    actor: {
      principalId: '00000000-0000-7000-8000-0000000000a1',
      type: 'internal',
      branchIds: [],
      customerId: null,
      partnerId: null,
      ip: null,
    },
    permissions: new Set(['job.read']),
    branchRoles: new Map(),
    branchPermissions: new Map(),
    requiresTwoFactor: false,
  }),
}))
vi.mock('@/lib/brand', () => ({ getBrand: () => ({ identity: { key: 'acme' } }) }))

describe('an import template download', () => {
  it("is named from the brand's key", async () => {
    const { GET } = await import('./route')
    const response = await GET(new Request('http://localhost/api/templates/open-jobs'), {
      params: Promise.resolve({ kind: 'open-jobs' }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="acme-open-jobs-template.csv"',
    )
  })
})
