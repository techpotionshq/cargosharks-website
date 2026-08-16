/**
 * The wrapped-error trap.
 *
 * The shapes below are not invented. They were captured from PostgreSQL 18.6
 * through Drizzle by inserting a rate card that overlapped an existing one for
 * the same partner and lane — the exact rejection `FR-RT-08` exists to cause:
 *
 *     err.name             'Error'
 *     err.code             undefined      <- what the old code read
 *     err.cause.code       '23P01'
 *     err.cause.constraint 'rate_cards_no_overlap'
 *
 * Reading `err.code` therefore found nothing, `writeError` fell through to
 * `throw`, and the operator got a 500 where a sentence was written for them.
 * A unit test could not have found this — only the real driver produces the
 * wrapper — so the observed shape is pinned here instead.
 */

import { describe, expect, it } from 'vitest'
import { CONFLICT_STATES, REFERENCE_STATES, sqlState } from './sql-state'

/** The wrapper Drizzle actually produced, reproduced exactly. */
const drizzleWrapped = (code: string, constraint?: string): Error =>
  Object.assign(new Error('Failed query: insert into "rate_cards" ...'), {
    cause: Object.assign(new Error('pg'), { code, constraint }),
  })

describe('sqlState', () => {
  it('finds the code Drizzle hid behind `cause` — the real overlap rejection', () => {
    expect(sqlState(drizzleWrapped('23P01', 'rate_cards_no_overlap'))).toBe('23P01')
  })

  it('still reads a bare driver error, in case the wrapper goes away', () => {
    expect(sqlState(Object.assign(new Error('pg'), { code: '23505' }))).toBe('23505')
  })

  it('walks more than one level of wrapping', () => {
    const inner = Object.assign(new Error('pg'), { code: '23503' })
    const outer = Object.assign(new Error('a'), {
      cause: Object.assign(new Error('b'), { cause: inner }),
    })
    expect(sqlState(outer)).toBe('23503')
  })

  it('returns undefined for an error that carries no SQLSTATE', () => {
    expect(sqlState(new Error('something else'))).toBeUndefined()
    expect(sqlState(undefined)).toBeUndefined()
    expect(sqlState(null)).toBeUndefined()
    expect(sqlState('a string')).toBeUndefined()
  })

  it('ignores a `code` that is not shaped like a SQLSTATE', () => {
    // Node's own errors carry `code: 'ENOENT'`, and treating that as a
    // constraint violation would report a missing file as a duplicate row.
    expect(sqlState(Object.assign(new Error('fs'), { code: 'ENOENT' }))).toBeUndefined()
    expect(sqlState(Object.assign(new Error('n'), { code: 42 }))).toBeUndefined()
  })

  it('terminates on a self-referential cause instead of spinning', () => {
    const cyclic: { cause?: unknown } = {}
    cyclic.cause = cyclic
    expect(sqlState(cyclic)).toBeUndefined()
  })
})

describe('the state sets the importer maps', () => {
  it('treats the temporal overlap constraint as a conflict, not a crash', () => {
    // 23P01 is what `unique ... without overlaps` raises. Missing it was the
    // whole bug: an overlapping tariff is the most likely rejection here.
    expect(CONFLICT_STATES.has('23P01')).toBe(true)
    expect(CONFLICT_STATES.has('23505')).toBe(true)
  })

  it('treats a dangling reference or refused value as a row problem', () => {
    for (const code of ['23503', '23514', '22P02']) {
      expect(REFERENCE_STATES.has(code)).toBe(true)
    }
  })

  it('keeps the two sets disjoint, so a code cannot mean both', () => {
    for (const code of CONFLICT_STATES) expect(REFERENCE_STATES.has(code)).toBe(false)
  })
})
