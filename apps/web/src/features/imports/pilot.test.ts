/**
 * Bulk import on the pilot — no database at all.
 *
 * `/imports` on the hosted demo answered "Check" with a 500 ("DATABASE_URL is
 * not set"), and the customer sheet offered no branch, so it could not even
 * be checked. Now the check reads the pilot's own reference data and only the
 * import itself is refused — in words, never as a crash.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({ session: null as unknown }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/session', () => ({ requireSession: async () => harness.session }))

const { runImport } = await import('./actions')
const { importableBranches } = await import('./queries')
const { pilotImportableBranches, pilotOptions } = await import('@/lib/pilot/fixtures')

const BRANCH = pilotImportableBranches()[0]!.id

function upload(kind: string, content: string, extra: Record<string, string> = {}): FormData {
  const form = new FormData()
  form.set('kind', kind)
  form.set('file', new File([content], 'sheet.csv', { type: 'text/csv' }))
  for (const [key, value] of Object.entries(extra)) form.set(key, value)
  return form
}

const customers = (code: string) =>
  ['Customer code,Legal name (English),Country', `${code},Imported Trading Co,KW`].join('\n')

describe('bulk import with pilot fixtures', () => {
  const saved = { fixtures: process.env.QABANDI_PILOT_FIXTURES, url: process.env.DATABASE_URL }

  beforeAll(() => {
    process.env.QABANDI_PILOT_FIXTURES = '1'
    delete process.env.DATABASE_URL
    harness.session = {
      actor: { principalId: 'person-00', type: 'internal', branchIds: [BRANCH] },
      principal: { id: 'person-00', nameEn: 'Pilot', nameAr: null, email: 'p@p.test' },
      permissions: new Set(['customer.write']),
      branchRoles: new Map([[BRANCH, 'administrator']]),
      requiresTwoFactor: false,
    }
  })

  afterAll(() => {
    if (saved.fixtures === undefined) delete process.env.QABANDI_PILOT_FIXTURES
    else process.env.QABANDI_PILOT_FIXTURES = saved.fixtures
    if (saved.url !== undefined) process.env.DATABASE_URL = saved.url
  })

  it('offers the pilot branches to import into', async () => {
    const branches = await importableBranches(
      { principalId: 'person-00', type: 'internal', branchIds: [] },
      'ar',
    )
    expect(branches.map((b) => b.id)).toContain(BRANCH)
  })

  it('checks a sheet against the pilot reference data', async () => {
    const state = await runImport(
      {},
      upload('customers', customers('NEWCO1'), { branchId: BRANCH }),
    )
    expect(state.error).toBeUndefined()
    expect(state.ok).toBe(true)
    expect(state.acceptedRows).toBe(1)
  })

  it('refuses a code the pilot already has, as a database would', async () => {
    const existing = pilotOptions().customers[0]!.label.split(' — ')[0]!
    const state = await runImport(
      {},
      upload('customers', customers(existing), { branchId: BRANCH }),
    )
    expect(state.ok).toBe(false)
    expect(state.issueCount).toBeGreaterThan(0)
  })

  it('refuses the import itself in words, not with a crash', async () => {
    const state = await runImport(
      {},
      upload('customers', customers('NEWCO2'), { branchId: BRANCH, intent: 'commit' }),
    )
    expect(state.error).toBe('needs_database')
    expect(state.committed).toBeUndefined()
  })
})
