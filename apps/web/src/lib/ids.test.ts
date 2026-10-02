/**
 * A record id from a URL — A17. `/jobs/abc` reached PostgreSQL as a failed
 * uuid cast and came back as a 500; it is now the not-found page.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({ fixtures: false }))

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))
vi.mock('@/lib/pilot/source', () => ({ usePilotFixtures: () => harness.fixtures }))

const { isUuid, recordId } = await import('./ids')

const ID = '0192f1a2-7b3c-7d4e-8f50-123456789abc'

beforeEach(() => {
  harness.fixtures = false
})

describe('record ids', () => {
  it('passes a uuid through', () => {
    expect(recordId(ID)).toBe(ID)
    expect(isUuid(ID.toUpperCase())).toBe(true)
  })

  it('sends anything else to not-found instead of to the database', () => {
    for (const bad of ['abc', '1', `${ID}x`, "' or 1=1 --", '']) {
      expect(() => recordId(bad)).toThrow('NEXT_NOT_FOUND')
    }
  })

  /** The fixtures key records as `job-1041` and run no query that could fail. */
  it('stands aside for the pilot fixtures', () => {
    harness.fixtures = true
    expect(recordId('job-1041')).toBe('job-1041')
  })
})
