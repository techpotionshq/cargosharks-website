/**
 * The rest of the payables path — entering a bill, approving it, paying it.
 *
 * Matching has its own suite; this covers everything either side of it. The
 * shape worth holding on to is that a bill hardens as it moves: `received` is
 * editable, `approved` is not, and payment is only possible after approval.
 * Each of those gates is a `where` condition rather than a prior read, so the
 * tests drive them through the real actions rather than asserting on a mock.
 *
 * The approval gate is the one that carries the money. A bill whose lines
 * disagree with what was accrued, or which has lines matched to nothing, must
 * not be approved silently — the approver either queries it with the supplier
 * or accepts the variance *with a reason*, and the reason is what makes the
 * second one a decision rather than a click.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const harness = vi.hoisted(() => ({ session: null as unknown }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/session', () => ({ requireSession: async () => harness.session }))

/**
 * The message keys stand in for the sentences, so an assertion names the case
 * rather than a wording a translator is free to change — as in `auth/actions.test.ts`.
 */
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    values ? `${namespace}.${key}:${JSON.stringify(values)}` : `${namespace}.${key}`,
}))

const { supplierInvoiceLines, supplierInvoices, supplierPayments, withActor } =
  await import('@qabandi/db')

const { HOME_BRANCH, AWAY_BRANCH, PARTNER, PRINCIPAL, bothBranchesActor, world } =
  await import('@/lib/testing/fixtures')

const {
  saveSupplierInvoice,
  addSupplierInvoiceLine,
  setSupplierInvoiceStatus,
  recordSupplierPayment,
  allocateSupplierPayment,
  linkPartnerAccount,
  setPartnerTolerance,
} = await import('./form-actions')

const PERMISSIONS = [
  'payable.record',
  'payable.approve',
  'payable.pay',
  'settlement.run',
  'partner.write',
]

const session = {
  actor: bothBranchesActor,
  principal: {
    id: PRINCIPAL,
    nameEn: 'Payables Bills',
    nameAr: null,
    email: 'bills@qabandi.test',
    locale: 'en' as const,
  },
  permissions: new Set(PERMISSIONS),
  branchRoles: new Map([
    [HOME_BRANCH, 'finance'],
    [AWAY_BRANCH, 'finance'],
  ]),
  requiresTwoFactor: false,
}

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

let seq = 0
const nextRef = () => `BILL-T-${(seq += 1)}-${Date.now()}`

/** A bill entered through the real action, returning its id. */
async function enterBill(total = '100.000'): Promise<string> {
  const reference = nextRef()
  const state = await saveSupplierInvoice(
    {},
    form({
      branchId: HOME_BRANCH,
      partnerId: PARTNER,
      reference,
      currency: 'KWD',
      fxRate: '1',
      invoiceDate: '2026-08-18',
      taxAmount: '0',
    }),
  )
  if (state.errors || state.message) {
    throw new Error(`fixture bill failed: ${JSON.stringify(state)}`)
  }

  const [row] = await withActor(bothBranchesActor, (tx) =>
    tx
      .select({ id: supplierInvoices.id })
      .from(supplierInvoices)
      .where(eq(supplierInvoices.reference, reference))
      .limit(1),
  )
  const id = row!.id

  await addSupplierInvoiceLine(
    {},
    form({
      supplierInvoiceId: id,
      description: 'Ocean freight',
      quantity: '1',
      unitPrice: total,
      taxAmount: '0',
    }),
  )

  return id
}

async function billStatus(id: string): Promise<string> {
  const [row] = await withActor(bothBranchesActor, (tx) =>
    tx
      .select({ status: supplierInvoices.status })
      .from(supplierInvoices)
      .where(eq(supplierInvoices.id, id)),
  )
  return row!.status
}

describe.skipIf(!enabled)('supplier bills', () => {
  beforeAll(async () => {
    await world()
    harness.session = session
  })

  afterAll(() => {
    harness.session = null
  })

  describe('entering a bill', () => {
    it('creates a bill in received', async () => {
      const id = await enterBill()
      expect(await billStatus(id)).toBe('received')
    })

    it('adds a line and totals it onto the bill', async () => {
      const id = await enterBill('250.000')

      const [bill] = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ total: supplierInvoices.total, subtotal: supplierInvoices.subtotal })
          .from(supplierInvoices)
          .where(eq(supplierInvoices.id, id)),
      )
      expect(Number(bill!.total)).toBeCloseTo(250, 3)
    })

    /** Money keeps its scale through the whole path — three places for KWD. */
    it('stores a line at full precision', async () => {
      const id = await enterBill('12.345')
      const [line] = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ amount: supplierInvoiceLines.amount })
          .from(supplierInvoiceLines)
          .where(eq(supplierInvoiceLines.supplierInvoiceId, id)),
      )
      expect(Number(line!.amount)).toBe(12.345)
    })

    it('reports field errors rather than throwing on a bad form', async () => {
      const state = await saveSupplierInvoice({}, form({ branchId: HOME_BRANCH }))
      expect(state.errors).toBeDefined()
      expect(Object.keys(state.errors ?? {}).length).toBeGreaterThan(0)
    })

    it('insists on the supplier’s own invoice number', async () => {
      const state = await saveSupplierInvoice(
        {},
        form({
          branchId: HOME_BRANCH,
          partnerId: PARTNER,
          reference: '',
          currency: 'KWD',
          fxRate: '1',
          invoiceDate: '2026-08-18',
          taxAmount: '0',
        }),
      )
      expect(state.errors?.reference).toBeDefined()
    })

    it('refuses a line on a bill that does not exist', async () => {
      const state = await addSupplierInvoiceLine(
        {},
        form({
          supplierInvoiceId: '00000000-0000-7000-8000-0000000000e9',
          description: 'Ghost',
          quantity: '1',
          unitPrice: '10.000',
          taxAmount: '0',
        }),
      )
      expect(state.message).toBe('payablesValidation.billGone')
    })
  })

  describe('approval — the gate that carries the money', () => {
    /**
     * A line matched to nothing is the common case on a first bill, and it is
     * exactly what must not be waved through: nobody has checked that this
     * charge was expected at all.
     */
    it('refuses to approve a bill whose lines are matched to nothing', async () => {
      const id = await enterBill()

      const state = await setSupplierInvoiceStatus(
        {},
        form({ supplierInvoiceId: id, action: 'approve' }),
      )

      expect(state.message).toBe('payablesValidation.varianceNeedsReview')
      expect(await billStatus(id)).toBe('received')
    })

    /** Accepting the variance is allowed — saying nothing about it is not. */
    it('insists on a reason when the variance is accepted', async () => {
      const id = await enterBill()

      const state = await setSupplierInvoiceStatus(
        {},
        form({ supplierInvoiceId: id, action: 'approve', acceptVariance: 'on' }),
      )

      expect(state.message).toBe('payablesValidation.sayWhy')
      expect(await billStatus(id)).toBe('received')
    })

    it('approves when the variance is accepted with a reason', async () => {
      const id = await enterBill()

      const state = await setSupplierInvoiceStatus(
        {},
        form({
          supplierInvoiceId: id,
          action: 'approve',
          acceptVariance: 'on',
          reason: 'Agreed by phone with the agent',
        }),
      )

      expect(state.message).toBeUndefined()
      expect(await billStatus(id)).toBe('approved')
    })

    it('records who accepted the variance and why', async () => {
      const id = await enterBill()
      await setSupplierInvoiceStatus(
        {},
        form({
          supplierInvoiceId: id,
          action: 'approve',
          acceptVariance: 'on',
          reason: 'Rate agreed in writing',
        }),
      )

      const [row] = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({
            at: supplierInvoices.varianceAcceptedAt,
            why: supplierInvoices.varianceAcceptedReason,
            approvedBy: supplierInvoices.approvedById,
          })
          .from(supplierInvoices)
          .where(eq(supplierInvoices.id, id)),
      )
      expect(row!.at).not.toBeNull()
      expect(row!.why).toBe('Rate agreed in writing')
      expect(row!.approvedBy).toBe(PRINCIPAL)
    })

    it('refuses to approve a bill that is already approved', async () => {
      const id = await enterBill()
      await setSupplierInvoiceStatus(
        {},
        form({
          supplierInvoiceId: id,
          action: 'approve',
          acceptVariance: 'on',
          reason: 'Agreed with the agent',
        }),
      )

      const again = await setSupplierInvoiceStatus(
        {},
        form({
          supplierInvoiceId: id,
          action: 'approve',
          acceptVariance: 'on',
          reason: 'Agreed with the agent',
        }),
      )
      expect(again.message).toBe('payablesValidation.billNotAwaitingApproval')
    })

    /** An approved bill's lines are settled fact; editing them is refused. */
    it('refuses to add a line once the bill is approved', async () => {
      const id = await enterBill()
      await setSupplierInvoiceStatus(
        {},
        form({
          supplierInvoiceId: id,
          action: 'approve',
          acceptVariance: 'on',
          reason: 'Agreed with the agent',
        }),
      )

      const state = await addSupplierInvoiceLine(
        {},
        form({
          supplierInvoiceId: id,
          description: 'Late addition',
          quantity: '1',
          unitPrice: '5.000',
          taxAmount: '0',
        }),
      )
      expect(state.message).toBe('payablesValidation.billLinesLocked')
    })

    it('says so plainly when there is nothing to do', async () => {
      expect((await setSupplierInvoiceStatus({}, form({}))).message).toBe(
        'payablesValidation.nothingToDo',
      )
    })

    it('reports a bill that is not visible', async () => {
      const state = await setSupplierInvoiceStatus(
        {},
        form({ supplierInvoiceId: '00000000-0000-7000-8000-0000000000ea', action: 'approve' }),
      )
      expect(state.message).toBeDefined()
    })
  })

  describe('paying', () => {
    async function approvedBill(total = '100.000'): Promise<string> {
      const id = await enterBill(total)
      await setSupplierInvoiceStatus(
        {},
        form({
          supplierInvoiceId: id,
          action: 'approve',
          acceptVariance: 'on',
          reason: 'Agreed with the agent',
        }),
      )
      return id
    }

    async function payment(amount: string): Promise<string> {
      const reference = `PAY-T-${(seq += 1)}-${Date.now()}`
      const state = await recordSupplierPayment(
        {},
        form({
          branchId: HOME_BRANCH,
          partnerId: PARTNER,
          amount,
          currency: 'KWD',
          fxRate: '1',
          paidOn: '2026-08-18',
          method: 'bank_transfer',
          reference,
        }),
      )
      if (state.errors || state.message) {
        throw new Error(`fixture payment failed: ${JSON.stringify(state)}`)
      }

      const [row] = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ id: supplierPayments.id })
          .from(supplierPayments)
          .where(eq(supplierPayments.reference, reference))
          .limit(1),
      )
      return row!.id
    }

    it('records a payment to a supplier', async () => {
      const id = await payment('100.000')
      expect(id).toBeTruthy()
    })

    it('reports field errors rather than throwing on a bad payment form', async () => {
      const state = await recordSupplierPayment({}, form({ branchId: HOME_BRANCH }))
      expect(state.errors).toBeDefined()
    })

    it('settles an approved bill in full', async () => {
      const billId = await approvedBill('100.000')
      const paymentId = await payment('100.000')

      const state = await allocateSupplierPayment(
        {},
        form({ supplierPaymentId: paymentId, supplierInvoiceId: billId, amount: '100.000' }),
      )

      expect(state.errors).toBeUndefined()
      expect(await billStatus(billId)).toBe('paid')
    })

    it('marks a bill part_paid when something is still owed', async () => {
      const billId = await approvedBill('100.000')
      const paymentId = await payment('40.000')

      await allocateSupplierPayment(
        {},
        form({ supplierPaymentId: paymentId, supplierInvoiceId: billId, amount: '40.000' }),
      )

      expect(await billStatus(billId)).toBe('part_paid')
    })

    /**
     * The decimal case that broke the receivables side. 8.700 with 8.600 paid
     * leaves exactly 0.100, which floating point makes 0.09999999999999964 —
     * and the last hundred fils is refused as more than is outstanding.
     */
    it('accepts the last fils of a bill paid in pieces', async () => {
      const billId = await approvedBill('8.700')

      const first = await payment('8.600')
      await allocateSupplierPayment(
        {},
        form({ supplierPaymentId: first, supplierInvoiceId: billId, amount: '8.600' }),
      )
      expect(await billStatus(billId)).toBe('part_paid')

      const last = await payment('0.100')
      const state = await allocateSupplierPayment(
        {},
        form({ supplierPaymentId: last, supplierInvoiceId: billId, amount: '0.100' }),
      )

      expect(state.errors).toBeUndefined()
      expect(await billStatus(billId)).toBe('paid')
    })

    /** Paying a bill nobody approved is the control this ordering exists for. */
    it('refuses to pay a bill that has not been approved', async () => {
      const billId = await enterBill('100.000')
      const paymentId = await payment('100.000')

      const state = await allocateSupplierPayment(
        {},
        form({ supplierPaymentId: paymentId, supplierInvoiceId: billId, amount: '100.000' }),
      )

      expect(state.errors?.supplierInvoiceId).toBe('payablesValidation.billNotApproved')
    })

    it('refuses more than the payment has left', async () => {
      const billId = await approvedBill('900.000')
      const paymentId = await payment('100.000')

      const state = await allocateSupplierPayment(
        {},
        form({ supplierPaymentId: paymentId, supplierInvoiceId: billId, amount: '500.000' }),
      )
      expect(state.errors?.amount).toBe('payablesValidation.overAllocated')
    })

    it('refuses more than the bill still owes', async () => {
      const billId = await approvedBill('50.000')
      const paymentId = await payment('500.000')

      const state = await allocateSupplierPayment(
        {},
        form({ supplierPaymentId: paymentId, supplierInvoiceId: billId, amount: '200.000' }),
      )
      expect(state.errors?.amount).toBe('payablesValidation.overInvoiced')
    })

    it('asks for a bill when none was chosen', async () => {
      const paymentId = await payment('10.000')
      const state = await allocateSupplierPayment(
        {},
        form({ supplierPaymentId: paymentId, amount: '10.000' }),
      )
      expect(state.errors?.supplierInvoiceId).toBeDefined()
    })

    it('rejects a malformed amount before touching the database', async () => {
      const billId = await approvedBill()
      const paymentId = await payment('100.000')
      const state = await allocateSupplierPayment(
        {},
        form({ supplierPaymentId: paymentId, supplierInvoiceId: billId, amount: 'lots' }),
      )
      expect(state.errors?.amount).toBeDefined()
    })
  })

  describe('partner settings', () => {
    it('sets a variance tolerance', async () => {
      const state = await setPartnerTolerance(
        {},
        form({ partnerId: PARTNER, varianceTolerancePercent: '5', varianceToleranceAbsolute: '2' }),
      )
      expect(state.errors).toBeUndefined()
    })

    it('refuses a tolerance that is not a number', async () => {
      const state = await setPartnerTolerance(
        {},
        form({ partnerId: PARTNER, varianceTolerancePercent: 'loads' }),
      )
      expect(state.errors?.varianceTolerancePercent).toBeDefined()
    })

    it('says so plainly when no partner was chosen', async () => {
      expect((await setPartnerTolerance({}, form({}))).message).toBe(
        'payablesValidation.nothingToDo',
      )
      expect((await linkPartnerAccount({}, form({}))).message).toBe(
        'payablesValidation.nothingToDo',
      )
    })
  })
})
