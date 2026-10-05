/**
 * The paging rule every register shares (`lib/paging.ts`).
 *
 * Small, because the helpers are small; but every register's "page 2" and
 * every total under a table goes through them, so a slip here is a slip on
 * twenty screens at once.
 */

import { describe, expect, it } from 'vitest'
import { PAGE_SIZE, pageCount, pageHref, pageOf, pageOffset, pageRequest } from './paging'

describe('pageRequest', () => {
  it('reads a page number from the query string', () => {
    expect(pageRequest('3')).toEqual({ page: 3, size: PAGE_SIZE })
    expect(pageRequest(['2', '9'])).toEqual({ page: 2, size: PAGE_SIZE })
  })

  // A hand-typed address is a stranger's input: page one, never an error.
  it('treats anything that is not a positive whole number as page one', () => {
    for (const raw of [undefined, '', '0', '-1', '1.5', 'abc', '1e9', '9999999']) {
      expect(pageRequest(raw).page).toBe(1)
    }
  })
})

describe('pageOf', () => {
  const rows = Array.from({ length: 105 }, (_, index) => index)

  it('cuts the page and keeps the total of every row', () => {
    const two = pageOf(rows, { page: 2, size: 50 })
    expect(two.rows[0]).toBe(50)
    expect(two.rows).toHaveLength(50)
    expect(two.total).toBe(105)

    const three = pageOf(rows, { page: 3, size: 50 })
    expect(three.rows).toEqual([100, 101, 102, 103, 104])
    expect(pageCount(three)).toBe(3)
    expect(pageOffset(three)).toBe(100)
  })

  it('returns no rows past the end, and still the total', () => {
    const past = pageOf(rows, { page: 9, size: 50 })
    expect(past.rows).toEqual([])
    expect(past.total).toBe(105)
  })

  it('counts one page for an empty register', () => {
    expect(pageCount(pageOf([], { page: 1, size: 50 }))).toBe(1)
  })
})

describe('pageHref', () => {
  it('keeps every filter and drops the empty ones', () => {
    expect(pageHref('/jobs', { filter: 'arriving', status: undefined, q: '' }, 2)).toBe(
      '/jobs?filter=arriving&page=2',
    )
  })

  // Page one is the bare address, so the sidebar link and a bookmark agree.
  it('leaves page one out of the address', () => {
    expect(pageHref('/customers', { q: 'jahra', page: '4' }, 1)).toBe('/customers?q=jahra')
    expect(pageHref('/customers', {}, 1)).toBe('/customers')
  })

  it('pages a second list on the same screen by its own parameter', () => {
    expect(pageHref('/payables', { page: '2', paymentsPage: '1' }, 3, 'paymentsPage')).toBe(
      '/payables?page=2&paymentsPage=3',
    )
  })
})
