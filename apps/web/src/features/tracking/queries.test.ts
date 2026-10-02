/**
 * A signed-in customer's view of their own shipment — QA P2-12.
 *
 * `trackOwnShipment` takes an id and no second identifier, so the only thing
 * standing between a customer and another company's shipment is the
 * `customer_contact` arm of the jobs policy, read under their own actor. That
 * is a claim about the database, so it is tested against one.
 */

import { beforeAll, describe, expect, it } from 'vitest'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const { AWAY_JOB, CUSTOMER, HOME_JOB, world } = await import('@/lib/testing/fixtures')
const { trackOwnShipment } = await import('./queries')

const contact = {
  principalId: '00000000-0000-7000-8000-0000000000e2',
  type: 'customer_contact' as const,
  branchIds: [],
  customerId: CUSTOMER,
  partnerId: null,
  ip: null,
}

describe.skipIf(!enabled)('a customer tracking their own shipment', () => {
  beforeAll(async () => {
    await world()
  })

  it('opens their own shipment by id, with no second identifier', async () => {
    const result = await trackOwnShipment(contact, HOME_JOB)
    expect(result?.reference).toBe('FXH-JOB-FIXTURE-1')
  })

  it("finds nothing for another company's shipment", async () => {
    expect(await trackOwnShipment(contact, AWAY_JOB)).toBeUndefined()
  })
})
