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

const { AWAY_BRANCH, HOME_BRANCH, PARTNER, PRINCIPAL, bothBranchesActor, homeActor, world } =
  await import('@/lib/testing/fixtures')
const { supplierInvoices, withActor } = await import('@qabandi/db')
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
  defaultBillBranch,
} = await import('./queries')

describe.skipIf(!enabled)('payables reads', () => {
  beforeAll(async () => {
    await world()
  })

  describe('the registers', () => {
    it('lists supplier bills for a scoped actor', async () => {
      expect(Array.isArray((await listSupplierInvoices(homeActor)).rows)).toBe(true)
    })

    it('lists supplier payments', async () => {
      expect(Array.isArray((await listSupplierPayments(homeActor)).rows)).toBe(true)
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
      expect(Array.isArray((await listSettlements(homeActor)).rows)).toBe(true)
    })

    it('lists partners a settlement could be run for', async () => {
      expect(Array.isArray(await listSettleablePartners(homeActor))).toBe(true)
    })
  })

  /*
    U5. "Capture bill" opened on no branch for anyone in two, so the clerk
    picked one every time and sometimes picked wrong.
  */
  describe('the branch a new bill opens on', () => {
    const captured = (branchId: string) =>
      withActor(bothBranchesActor, (tx) =>
        tx.insert(supplierInvoices).values({
          branchId,
          partnerId: PARTNER,
          reference: `U5-${branchId.slice(-4)}-${Date.now()}-${Math.random()}`,
          currency: 'KWD',
          invoiceDate: '2026-08-18',
          recordedById: PRINCIPAL,
        }),
      )

    it('is the only branch the person may record in', async () => {
      expect(await defaultBillBranch(homeActor, [AWAY_BRANCH], [HOME_BRANCH, AWAY_BRANCH])).toBe(
        AWAY_BRANCH,
      )
    })

    it('follows the last bill they captured, among the branches they may record in', async () => {
      const both = [HOME_BRANCH, AWAY_BRANCH]
      await captured(AWAY_BRANCH)
      expect(await defaultBillBranch(bothBranchesActor, both, both)).toBe(AWAY_BRANCH)
      await captured(HOME_BRANCH)
      expect(await defaultBillBranch(bothBranchesActor, both, both)).toBe(HOME_BRANCH)
      // A branch they may no longer record in is not offered back.
      expect(
        await defaultBillBranch(
          bothBranchesActor,
          [AWAY_BRANCH, '00000000-0000-7000-8000-0000000000ff'],
          both,
        ),
      ).toBe(AWAY_BRANCH)
    })

    it('falls back to the first branch the picker lists', async () => {
      const stranger = { ...bothBranchesActor, principalId: '00000000-0000-7000-8000-0000000000aa' }
      expect(
        await defaultBillBranch(stranger, [HOME_BRANCH, AWAY_BRANCH], [AWAY_BRANCH, HOME_BRANCH]),
      ).toBe(AWAY_BRANCH)
    })
  })

  describe('the aggregates', () => {
    it('summarises without throwing on an empty ledger', async () => {
      expect(await payablesSummary(homeActor)).toBeDefined()
    })

    /** F16. One ageing per base currency, never two bases added together. */
    it('ages payables once per base currency', async () => {
      const result = await payablesAgeing(bothBranchesActor)
      const currencies = result.byCurrency.map((entry) => entry.currency)
      expect(new Set(currencies).size).toBe(currencies.length)
      for (const entry of result.byCurrency) {
        expect(entry.ageing.total.currency).toBe(entry.currency)
      }
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
