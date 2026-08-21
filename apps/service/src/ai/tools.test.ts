/**
 * Reading the arguments a model produced.
 *
 * Everything else in `tools.ts` is a query and belongs in a database-backed
 * suite. What is testable here — and worth testing more than the queries — is
 * the step before them: turning a model's JSON into a filter.
 *
 * That step has exactly one interesting failure and it is not an exception. A
 * filter that silently means something other than what was asked produces a
 * confident, wrong, plausible answer, and a question about money answered that
 * way is worse than an error by a wide margin.
 */

import { describe, expect, it } from 'vitest'
import { readFilters } from './tools'

describe('reading a model’s optional filters', () => {
  it('takes a real value', () => {
    expect(readFilters({ customer: 'Al Madina' }).text('customer')).toBe('Al Madina')
  })

  it('trims, because a model pads', () => {
    expect(readFilters({ customer: '  Al Madina  ' }).text('customer')).toBe('Al Madina')
  })

  /*
    Found in a live call rather than imagined. Asked which invoices were
    overdue, `minimax/minimax-m3` chose the right tool and filled the optional
    customer filter with the string "None" — which, taken literally, searches
    for a customer of that name, matches nothing, and answers "no invoices are
    overdue" on a day when several are.

    A schema cannot prevent this: the field is legitimately a string. It has to
    be caught where the string becomes a filter.
  */
  it('treats a model’s written-out null as absent', () => {
    for (const written of ['None', 'none', 'null', 'N/A', 'n/a', 'undefined', 'nil', '-']) {
      expect(readFilters({ customer: written }).text('customer')).toBeUndefined()
    }
  })

  it('treats "any" and "all" as absent, since both mean do not filter', () => {
    expect(readFilters({ customer: 'any' }).text('customer')).toBeUndefined()
    expect(readFilters({ status: 'All' }).text('status')).toBeUndefined()
  })

  it('treats a real null, an empty string and a missing key alike', () => {
    expect(readFilters({ customer: null }).text('customer')).toBeUndefined()
    expect(readFilters({ customer: '' }).text('customer')).toBeUndefined()
    expect(readFilters({}).text('customer')).toBeUndefined()
  })

  it('ignores a value that is not a string at all', () => {
    expect(readFilters({ customer: 42 }).text('customer')).toBeUndefined()
    expect(readFilters({ customer: { name: 'x' } }).text('customer')).toBeUndefined()
  })

  describe('counts', () => {
    it('takes a sensible limit', () => {
      expect(readFilters({ limit: 10 }).count('limit', 20)).toBe(10)
    })

    it('falls back where the model gave nothing usable', () => {
      expect(readFilters({}).count('limit', 20)).toBe(20)
      expect(readFilters({ limit: 'lots' }).count('limit', 20)).toBe(20)
      expect(readFilters({ limit: null }).count('limit', 20)).toBe(20)
    })

    /*
      Clamped rather than refused. A model asking for a thousand rows has
      misunderstood the question, and the useful response is fifty rows rather
      than an error the person has to read — but a thousand rows of shipments
      in a prompt is real money and a worse answer.
    */
    it('clamps a request for far too much', () => {
      expect(readFilters({ limit: 5_000 }).count('limit', 20)).toBe(50)
      expect(readFilters({ limit: 0 }).count('limit', 20)).toBe(1)
      expect(readFilters({ limit: -3 }).count('limit', 20)).toBe(1)
    })

    it('takes a whole number from a fractional one', () => {
      expect(readFilters({ limit: 7.9 }).count('limit', 20)).toBe(7)
    })
  })

  describe('flags', () => {
    it('is true only for a real boolean true', () => {
      expect(readFilters({ overdueOnly: true }).flag('overdueOnly')).toBe(true)
      expect(readFilters({ overdueOnly: 'true' }).flag('overdueOnly')).toBe(false)
      expect(readFilters({ overdueOnly: 1 }).flag('overdueOnly')).toBe(false)
      expect(readFilters({}).flag('overdueOnly')).toBe(false)
    })
  })
})
