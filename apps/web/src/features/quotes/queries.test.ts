/**
 * Where a comparison's prices came from — QA P3.
 *
 * The enquiry page said "Priced from the imported rate card" over a quotation
 * somebody typed by hand. The comparison now says which it was, read off
 * `rate_card_version_id`, the lineage column a card-priced quotation carries.
 */

import { beforeAll, describe, expect, it } from 'vitest'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const { enquiries, quotes, withActor } = await import('@qabandi/db')
const { CUSTOMER, HOME_BRANCH, bothBranchesActor, world } = await import('@/lib/testing/fixtures')
const { getQuoteComparison } = await import('./queries')

const system = { ...bothBranchesActor, type: 'system' as const }

describe.skipIf(!enabled)('the rate comparison', () => {
  beforeAll(async () => {
    await world()
  })

  it('says a quotation typed by hand was priced by hand', async () => {
    const stamp = `${Date.now()}`
    const enquiryId = await withActor(system, async (tx) => {
      const [enquiry] = await tx
        .insert(enquiries)
        .values({
          reference: `QCMP-ENQ-${stamp}`,
          branchId: HOME_BRANCH,
          customerId: CUSTOMER,
          status: 'quoted',
          channel: 'email',
          firstRespondedAt: new Date(),
        })
        .returning({ id: enquiries.id })
      await tx.insert(quotes).values({
        reference: `QCMP-QUO-${stamp}`,
        enquiryId: enquiry!.id,
        branchId: HOME_BRANCH,
        version: 1,
        status: 'draft',
        currency: 'KWD',
        totalSell: '500',
        totalCost: '400',
        validUntil: '2035-12-31',
      })
      return enquiry!.id
    })

    const comparison = await getQuoteComparison(bothBranchesActor, enquiryId)
    expect(comparison?.pricedFrom).toBe('manual')
  })
})
