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

  it('lists customers and finds the fixtures', async () => {
    const codes = (await listCustomers(homeActor)).map((c) => c.code)
    expect(codes).toContain('CUST-FIXTURE-HOME')
  })

  it('narrows by search rather than matching everything', async () => {
    const hits = await listCustomers(homeActor, 'CUST-FIXTURE-HOME')
    expect(hits.map((c) => c.code)).toContain('CUST-FIXTURE-HOME')
    expect(await listCustomers(homeActor, 'zzz-no-such-customer')).toEqual([])
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
