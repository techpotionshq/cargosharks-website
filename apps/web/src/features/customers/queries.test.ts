/**
 * The customer register.
 *
 * `customerCodeExists` is the one worth care: it backs the uniqueness hint on
 * the code field, and a check that always answers "free" turns a friendly
 * warning into a constraint violation at submit time — which, until the
 * `DrizzleQueryError` unwrapping was fixed, surfaced as a 500.
 */

import { beforeAll, describe, expect, it } from 'vitest'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const { homeActor, world } = await import('@/lib/testing/fixtures')
const { listCustomers, hasAnyCustomer, customerCodeExists } = await import('./queries')

describe.skipIf(!enabled)('customer reads', () => {
  beforeAll(async () => {
    await world()
  })

  /*
    Asserted as a register rather than by naming one row.

    The register pages, ordered by name, and nothing is ever deleted — so
    every run of the customer suites pushes the boundary along and any single
    code eventually moves to a later page. That a particular customer is
    *findable* is the next test's job, through the search the screen uses.
  */
  it('lists customers a page at a time, with the total', async () => {
    const first = await listCustomers(homeActor)

    expect(first.rows.length).toBeGreaterThan(0)
    expect(first.rows.length).toBeLessThanOrEqual(first.size)
    expect(first.total).toBeGreaterThanOrEqual(first.rows.length)
    expect(first.rows.every((c) => c.code.length > 0)).toBe(true)
  })

  /*
    R10: the register stopped at two hundred and hid the rest. Two rows a page
    makes the second page reachable on any database with three customers, and
    the pages must neither overlap nor disagree about the total.
  */
  it('reaches the second page, and the pages do not overlap', async () => {
    const one = await listCustomers(homeActor, undefined, { page: 1, size: 2 })
    const two = await listCustomers(homeActor, undefined, { page: 2, size: 2 })

    expect(one.total).toBeGreaterThan(2)
    expect(two.total).toBe(one.total)
    expect(two.rows.length).toBeGreaterThan(0)
    const firstIds = new Set(one.rows.map((c) => c.id))
    expect(two.rows.some((c) => firstIds.has(c.id))).toBe(false)
  })

  it('narrows by search rather than matching everything', async () => {
    const hits = await listCustomers(homeActor, 'CUST-FIXTURE-HOME')
    expect(hits.rows.map((c) => c.code)).toContain('CUST-FIXTURE-HOME')
    expect(hits.total).toBe(hits.rows.length)
    const none = await listCustomers(homeActor, 'zzz-no-such-customer')
    expect(none.rows).toEqual([])
    expect(none.total).toBe(0)
  })

  it('knows whether any customer exists', async () => {
    expect(await hasAnyCustomer(homeActor)).toBe(true)
  })

  /** Both answers matter — a check that only ever says "free" is not a check. */
  it('reports whether a code is taken', async () => {
    expect(await customerCodeExists(homeActor, 'CUST-FIXTURE-HOME')).toBe(true)
    expect(await customerCodeExists(homeActor, 'CODE-THAT-IS-FREE')).toBe(false)
  })
})
