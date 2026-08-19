/**
 * The payables registers — supplier bills, what is owed, and settlements.
 *
 * The mirror of the receivables side, and the same hazards apply: an ageing
 * report whose buckets do not sum to its own total is worse than no report,
 * and a summary counting rows the register does not list is the failure the
 * correlated-subquery lint rule exists for.
 */

import { beforeAll, describe, expect, it } from 'vitest'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const { PARTNER, bothBranchesActor, homeActor, world } = await import('@/lib/testing/fixtures')
const {
  listSupplierInvoices,
  payablesSummary,
  payablesAgeing,
  getSupplierInvoice,
  listSupplierPayments,
  listPayableInvoices,
  getPartnerAccount,
  listSettlements,
  getSettlement,
  listSettleablePartners,
} = await import('./queries')

describe.skipIf(!enabled)('payables reads', () => {
  beforeAll(async () => {
    await world()
  })

  describe('the registers', () => {
    it('lists supplier bills for a scoped actor', async () => {
      expect(Array.isArray(await listSupplierInvoices(homeActor))).toBe(true)
    })

    it('lists supplier payments', async () => {
      expect(Array.isArray(await listSupplierPayments(homeActor))).toBe(true)
    })

    /*
      Asked about a real partner, because the picker is scoped to one.

      `listPayableInvoices` narrows to the partner the payment is being made
      to — an unpaid bill from somebody else is not a bill this payment could
      settle — so calling it without one asserted nothing.
    */
    it('lists the bills a payment could settle', async () => {
      const [partner] = await listSettleablePartners(homeActor)
      expect(
        Array.isArray(
          await listPayableInvoices(
            homeActor,
            partner?.id ?? '00000000-0000-7000-8000-00000000000f',
          ),
        ),
      ).toBe(true)
    })

    it('lists settlements', async () => {
      expect(Array.isArray(await listSettlements(homeActor))).toBe(true)
    })

    it('lists partners a settlement could be run for', async () => {
      expect(Array.isArray(await listSettleablePartners(homeActor))).toBe(true)
    })
  })

  describe('the aggregates', () => {
    it('summarises without throwing on an empty ledger', async () => {
      expect(await payablesSummary(homeActor)).toBeDefined()
    })

    it('ages payables and reports the currency it aged them in', async () => {
      const result = await payablesAgeing(homeActor)
      expect(typeof result.currency).toBe('string')
      expect(result.ageing).toBeDefined()
    })
  })

  describe('detail reads', () => {
    it('returns nothing for a bill that does not exist', async () => {
      expect(
        await getSupplierInvoice(homeActor, '00000000-0000-7000-8000-0000000000f5'),
      ).toBeFalsy()
    })

    it('returns nothing for a settlement that does not exist', async () => {
      expect(await getSettlement(homeActor, '00000000-0000-7000-8000-0000000000f6')).toBeFalsy()
    })

    it('reads a partner account for the fixture agent', async () => {
      expect(await getPartnerAccount(bothBranchesActor, PARTNER)).toBeDefined()
    })
  })
})
