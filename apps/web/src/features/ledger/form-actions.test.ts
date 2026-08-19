/**
 * The money mutations, against a real database.
 *
 * These are the actions that move money: they issue an invoice, allocate a
 * number from the branch's statutory series, record a receipt and match it
 * against what is owed. Every one of them is mostly SQL, and SQL is precisely
 * what a mocked test cannot check — the constraint, the policy, the enum cast
 * and the `update … returning` are the behaviour, not an implementation detail
 * behind it.
 *
 * So this runs the real actions against real PostgreSQL, exactly as
 * `packages/db/test` does, and skips entirely without a database so that a
 * developer working on `core` is never blocked by one.
 *
 * Only two things are stubbed, and both are Next's rather than ours:
 * `revalidatePath`, which needs a request scope that does not exist here, and
 * `requireSession`, which reads cookies. Everything below those — Zod parsing,
 * the permission checks, the state machines, the transaction, the policies —
 * is the code that ships.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq, sql } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)

/*
  Point the process-wide handle at the test database before anything touches
  it. `db` in `packages/db/src/client.ts` is a lazy Proxy that reads
  DATABASE_URL on first property access, so assigning here — before any action
  runs a query — is what keeps these writes off whatever DATABASE_URL happened
  to be configured for development.
*/
if (APP_URL) process.env.DATABASE_URL = APP_URL

const harness = vi.hoisted(() => ({ session: null as unknown }))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('@/lib/session', () => ({
  requireSession: async () => harness.session,
}))

const {
  invoices,
  payments,
  paymentAllocations,
  branches,
  customers,
  principals,
  principalBranchRoles,
  roles,
  workingCalendars,
  withActor,
} = await import('@qabandi/db')
const { recordPayment, allocatePayment, setInvoiceStatus } = await import('./form-actions')

const BRANCH = '00000000-0000-7000-8000-00000000f001'
const CUSTOMER = '00000000-0000-7000-8000-00000000f002'
const PRINCIPAL = '00000000-0000-7000-8000-00000000f003'

/** Every permission these actions ask for. Scoping is tested separately. */
const PERMISSIONS = [
  'payment.record',
  'invoice.issue',
  'invoice.void',
  'invoice.credit',
  'invoice.approve',
]

const actor = {
  principalId: PRINCIPAL,
  type: 'internal' as const,
  branchIds: [BRANCH],
}

const session = {
  actor,
  principal: { id: PRINCIPAL, nameEn: 'Test', nameAr: null, email: 't@t.test', locale: 'en' },
  permissions: new Set(PERMISSIONS),
  branchRoles: new Map([[BRANCH, 'finance']]),
  requiresTwoFactor: false,
}

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

/** A draft invoice for `total`, returning its id. */
async function draftInvoice(total: string, currency = 'KWD'): Promise<string> {
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .insert(invoices)
      .values({ branchId: BRANCH, customerId: CUSTOMER, currency, subtotal: total, total })
      .returning({ id: invoices.id })
    return row!.id
  })
}

/**
 * An invoice that has been through the real issue path.
 *
 * `draft → approved → issued`, each step through the action rather than by
 * writing the status directly — the series number is allocated by the issuing
 * transaction and `invoices_series_when_issued` refuses any other route.
 */
async function issuedInvoice(total: string, currency = 'KWD'): Promise<string> {
  const id = await draftInvoice(total, currency)
  await setInvoiceStatus({}, form({ invoiceId: id, status: 'approved' }))
  await setInvoiceStatus({}, form({ invoiceId: id, status: 'issued' }))
  return id
}

/** A receipt for `amount`, returning its id. */
async function receipt(amount: string, currency = 'KWD'): Promise<string> {
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .insert(payments)
      .values({
        branchId: BRANCH,
        customerId: CUSTOMER,
        amount,
        currency,
        receivedOn: '2026-08-18',
        method: 'bank_transfer',
        recordedById: PRINCIPAL,
      })
      .returning({ id: payments.id })
    return row!.id
  })
}

async function invoiceRow(id: string) {
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .select({ status: invoices.status, paid: invoices.amountPaid, total: invoices.total })
      .from(invoices)
      .where(eq(invoices.id, id))
      .limit(1)
    return row!
  })
}

describe.skipIf(!enabled)('ledger money mutations', () => {
  beforeAll(async () => {
    harness.session = session

    await withActor({ ...actor, type: 'system' }, async (tx) => {
      const [calendar] = await tx
        .select({ id: workingCalendars.id })
        .from(workingCalendars)
        .where(eq(workingCalendars.key, 'kuwait'))
        .limit(1)
      if (!calendar) throw new Error('Run `pnpm db:seed` before the ledger tests')

      await tx
        .insert(principals)
        .values({
          id: PRINCIPAL,
          type: 'internal',
          email: 'ledger-test@qabandi.test',
          nameEn: 'Ledger Test',
        })
        .onConflictDoNothing()
      await tx
        .insert(customers)
        .values({ id: CUSTOMER, code: 'CUST-LEDGER-TEST', legalNameEn: 'Ledger Test Customer' })
        .onConflictDoNothing()
      await tx
        .insert(branches)
        .values({
          id: BRANCH,
          code: 'LGT',
          legalNameEn: 'Ledger Test Branch',
          legalNameAr: 'فرع الاختبار',
          country: 'KW',
          baseCurrency: 'KWD',
          invoiceSeries: 'LGT',
          calendarId: calendar.id,
        })
        .onConflictDoNothing()

      /*
        A real role grant, not just a permission set on the mocked session.

        `app.allocate_series_number` re-checks `invoice.issue` against
        `principal_branch_roles` in the database, because a security-definer
        function cannot trust anything the caller hands it. A session object
        claiming the permission proves nothing there — which is the point, and
        which is why this row has to exist for the issue path to work at all.
      */
      const [financeRole] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.key, 'finance'))
        .limit(1)
      if (!financeRole) throw new Error('Run `pnpm db:seed` before the ledger tests')

      await tx
        .insert(principalBranchRoles)
        .values({ principalId: PRINCIPAL, branchId: BRANCH, roleId: financeRole.id })
        .onConflictDoNothing()
    })
  })

  afterAll(() => {
    harness.session = null
  })

  describe('allocatePayment — the two ceilings, against real rows', () => {
    it('settles an invoice in full and marks it paid', async () => {
      const invoiceId = await issuedInvoice('120.000')
      const paymentId = await receipt('120.000')

      const state = await allocatePayment({}, form({ paymentId, invoiceId, amount: '120.000' }))

      expect(state.errors).toBeUndefined()
      const row = await invoiceRow(invoiceId)
      expect(row.status).toBe('paid')
      expect(Number(row.paid)).toBe(120)
    })

    it('marks an invoice part_paid when something is still owed', async () => {
      const invoiceId = await issuedInvoice('120.000')
      const paymentId = await receipt('50.000')

      await allocatePayment({}, form({ paymentId, invoiceId, amount: '50.000' }))

      const row = await invoiceRow(invoiceId)
      expect(row.status).toBe('part_paid')
      expect(Number(row.paid)).toBe(50)
    })

    /**
     * The bug this suite was written for.
     *
     * An invoice of 8.700 with 8.600 settled leaves exactly 0.100 outstanding.
     * Computed as floats that remainder is 0.09999999999999964, and the last
     * hundred fils was refused as "more than is still outstanding" — leaving an
     * invoice that is fully paid and can never say so.
     */
    it('accepts the last fils of an invoice paid down in pieces', async () => {
      const invoiceId = await issuedInvoice('8.700')
      const first = await receipt('8.600')
      const last = await receipt('0.100')

      await allocatePayment({}, form({ paymentId: first, invoiceId, amount: '8.600' }))
      const partway = await invoiceRow(invoiceId)
      expect(partway.status).toBe('part_paid')

      const state = await allocatePayment({}, form({ paymentId: last, invoiceId, amount: '0.100' }))

      expect(state.errors).toBeUndefined()
      const settled = await invoiceRow(invoiceId)
      expect(settled.status).toBe('paid')
      expect(Number(settled.paid)).toBeCloseTo(8.7, 3)
    })

    it('refuses more than the receipt has left', async () => {
      const invoiceId = await issuedInvoice('900.000')
      const paymentId = await receipt('500.000')

      await allocatePayment({}, form({ paymentId, invoiceId, amount: '400.000' }))
      const state = await allocatePayment({}, form({ paymentId, invoiceId, amount: '200.000' }))

      expect(state.errors?.amount).toContain('unallocated')
    })

    it('refuses more than the invoice still owes', async () => {
      const invoiceId = await issuedInvoice('120.000')
      const paymentId = await receipt('500.000')

      const state = await allocatePayment({}, form({ paymentId, invoiceId, amount: '200.000' }))

      expect(state.errors?.amount).toContain('outstanding')
      const row = await invoiceRow(invoiceId)
      expect(Number(row.paid)).toBe(0)
    })

    /** A refusal must leave nothing behind — no allocation row, no paid total. */
    it('writes nothing when it refuses', async () => {
      const invoiceId = await issuedInvoice('120.000')
      const paymentId = await receipt('500.000')

      await allocatePayment({}, form({ paymentId, invoiceId, amount: '999.000' }))

      const allocations = await withActor(actor, (tx) =>
        tx.select().from(paymentAllocations).where(eq(paymentAllocations.invoiceId, invoiceId)),
      )
      expect(allocations).toEqual([])
    })

    it('rejects a malformed amount before touching the database', async () => {
      const invoiceId = await issuedInvoice('120.000')
      const paymentId = await receipt('120.000')

      const state = await allocatePayment({}, form({ paymentId, invoiceId, amount: 'lots' }))

      expect(state.errors?.amount).toBeDefined()
      expect(Number((await invoiceRow(invoiceId)).paid)).toBe(0)
    })

    it('asks for an invoice when none was chosen', async () => {
      const paymentId = await receipt('120.000')
      const state = await allocatePayment({}, form({ paymentId, amount: '10.000' }))
      expect(state.errors?.invoiceId).toBeDefined()
    })
  })

  describe('recordPayment', () => {
    it('records a receipt and settles an invoice in one action', async () => {
      const invoiceId = await issuedInvoice('75.500')

      const state = await recordPayment(
        {},
        form({
          branchId: BRANCH,
          customerId: CUSTOMER,
          amount: '75.500',
          currency: 'KWD',
          receivedOn: '2026-08-18',
          method: 'bank_transfer',
          invoiceId,
        }),
      )

      expect(state.errors).toBeUndefined()
      expect(state.ok).toBeDefined()
      const row = await invoiceRow(invoiceId)
      expect(row.status).toBe('paid')
    })

    it('records a receipt with no invoice attached', async () => {
      const state = await recordPayment(
        {},
        form({
          branchId: BRANCH,
          customerId: CUSTOMER,
          amount: '10.000',
          currency: 'KWD',
          receivedOn: '2026-08-18',
          method: 'cash',
        }),
      )
      expect(state.errors).toBeUndefined()
    })

    /** Money keeps its scale through the whole path — three decimals for KWD. */
    it('stores the amount at full precision, not rounded to two places', async () => {
      const state = await recordPayment(
        {},
        form({
          branchId: BRANCH,
          customerId: CUSTOMER,
          amount: '12.345',
          currency: 'KWD',
          receivedOn: '2026-08-18',
          method: 'cash',
          reference: 'PRECISION-TEST',
        }),
      )
      expect(state.errors).toBeUndefined()

      const [row] = await withActor(actor, (tx) =>
        tx
          .select({ amount: payments.amount })
          .from(payments)
          .where(eq(payments.reference, 'PRECISION-TEST'))
          .limit(1),
      )
      expect(Number(row!.amount)).toBe(12.345)
    })

    it('refuses a receipt in a branch the principal holds no role in', async () => {
      await expect(
        recordPayment(
          {},
          form({
            branchId: '00000000-0000-7000-8000-0000000000ff',
            customerId: CUSTOMER,
            amount: '10.000',
            currency: 'KWD',
            receivedOn: '2026-08-18',
            method: 'cash',
          }),
        ),
      ).rejects.toThrow()
    })

    it('reports field errors rather than throwing on a bad form', async () => {
      const state = await recordPayment({}, form({ branchId: BRANCH, customerId: CUSTOMER }))
      expect(state.errors).toBeDefined()
      expect(Object.keys(state.errors ?? {}).length).toBeGreaterThan(0)
    })
  })

  describe('setInvoiceStatus — the statutory series', () => {
    /**
     * The number is allocated at issue, not at creation: a draft that is
     * abandoned must not consume one, because a gap in a statutory series is
     * what an auditor asks about.
     */
    it('leaves a draft without a number', async () => {
      const invoiceId = await draftInvoice('40.000')
      const [row] = await withActor(actor, (tx) =>
        tx.select({ no: invoices.seriesNo }).from(invoices).where(eq(invoices.id, invoiceId)),
      )
      expect(row!.no).toBeNull()
    })

    it('allocates a number on issue and stamps who issued it', async () => {
      const invoiceId = await draftInvoice('40.000')
      await setInvoiceStatus({}, form({ invoiceId, status: 'approved' }))

      const state = await setInvoiceStatus({}, form({ invoiceId, status: 'issued' }))
      expect(state.errors).toBeUndefined()

      const [row] = await withActor(actor, (tx) =>
        tx
          .select({
            no: invoices.seriesNo,
            status: invoices.status,
            issuedAt: invoices.issuedAt,
            issuedBy: invoices.issuedById,
          })
          .from(invoices)
          .where(eq(invoices.id, invoiceId)),
      )
      expect(row!.status).toBe('issued')
      expect(row!.no).toMatch(/^LGT-\d{4}-\d{5}$/)
      expect(row!.issuedAt).not.toBeNull()
      expect(row!.issuedBy).toBe(PRINCIPAL)
    })

    /** Consecutive, with no gaps — the property the whole design protects. */
    it('issues consecutive numbers within the branch', async () => {
      const numbers: number[] = []
      for (let i = 0; i < 3; i++) {
        const invoiceId = await issuedInvoice('5.000')
        const [row] = await withActor(actor, (tx) =>
          tx.select({ no: invoices.seriesNo }).from(invoices).where(eq(invoices.id, invoiceId)),
        )
        numbers.push(Number(row!.no!.split('-')[2]))
      }
      expect(numbers[1]).toBe(numbers[0]! + 1)
      expect(numbers[2]).toBe(numbers[1]! + 1)
    })

    /**
     * Two issues at the same instant must not collide. `update … returning` on
     * the branch row is atomic, so the second waits on the first's lock rather
     * than reading the same counter.
     */
    it('gives every concurrent issue a distinct number', async () => {
      const ids = await Promise.all([
        draftInvoice('1.000'),
        draftInvoice('1.000'),
        draftInvoice('1.000'),
        draftInvoice('1.000'),
      ])

      await Promise.all(
        ids.map((id) => setInvoiceStatus({}, form({ invoiceId: id, status: 'approved' }))),
      )
      await Promise.all(
        ids.map((id) => setInvoiceStatus({}, form({ invoiceId: id, status: 'issued' }))),
      )

      const rows = await Promise.all(
        ids.map((id) =>
          withActor(actor, (tx) =>
            tx.select({ no: invoices.seriesNo }).from(invoices).where(eq(invoices.id, id)),
          ),
        ),
      )
      const allocated = rows.map((r) => r[0]!.no)
      expect(allocated.every(Boolean)).toBe(true)
      expect(new Set(allocated).size).toBe(ids.length)
    })

    /** Issuing twice must not burn a second number. */
    it('keeps the first number if issue is repeated', async () => {
      const invoiceId = await issuedInvoice('9.000')
      const [first] = await withActor(actor, (tx) =>
        tx.select({ no: invoices.seriesNo }).from(invoices).where(eq(invoices.id, invoiceId)),
      )

      await setInvoiceStatus({}, form({ invoiceId, status: 'issued' }))
      const [second] = await withActor(actor, (tx) =>
        tx.select({ no: invoices.seriesNo }).from(invoices).where(eq(invoices.id, invoiceId)),
      )

      expect(second!.no).toBe(first!.no)
    })

    it('refuses a transition the machine does not allow', async () => {
      const invoiceId = await draftInvoice('9.000')
      const state = await setInvoiceStatus({}, form({ invoiceId, status: 'paid' }))
      expect(state.message ?? JSON.stringify(state.errors)).toBeTruthy()
      expect(state.ok).toBeUndefined()
    })

    /**
     * The counter policy must not become a way to edit a branch.
     *
     * `branches_allocate_series` (0016) lets issuing staff advance their own
     * branch's counters, because the number is allocated by the person issuing
     * the document and `branches_write` is an administrator's key. A policy
     * cannot restrict *which columns* an update touches, so a trigger does —
     * and without it this policy would hand every finance user the branch's
     * legal name, its tax registration and its control accounts.
     */
    it('refuses to let issuing staff change anything but the counters', async () => {
      await expect(
        withActor(actor, (tx) =>
          tx
            .update(branches)
            .set({ legalNameEn: 'Renamed By Finance', updatedAt: new Date() })
            .where(eq(branches.id, BRANCH)),
        ),
      ).rejects.toThrow()

      const [row] = await withActor(actor, (tx) =>
        tx.select({ name: branches.legalNameEn }).from(branches).where(eq(branches.id, BRANCH)),
      )
      expect(row!.name).toBe('Ledger Test Branch')
    })

    it('refuses to let issuing staff change the control accounts', async () => {
      await expect(
        withActor(actor, (tx) =>
          tx
            .update(branches)
            .set({ arAccountCode: '9999', updatedAt: new Date() })
            .where(eq(branches.id, BRANCH)),
        ),
      ).rejects.toThrow()
    })

    /**
     * FR-NT-01. The customer is told when the invoice is raised, and the event
     * carries the number they can quote back rather than the internal id.
     */
    it('raises an outbox notification carrying the series number', async () => {
      const invoiceId = await issuedInvoice('30.000')
      const [issued] = await withActor(actor, (tx) =>
        tx.select({ no: invoices.seriesNo }).from(invoices).where(eq(invoices.id, invoiceId)),
      )

      const events = await withActor(actor, (tx) =>
        tx.execute(
          sql`select payload from notification_outbox
               where branch_id = ${BRANCH}::uuid and event_key = 'invoice.issued'`,
        ),
      )

      const numbers = (events.rows as { payload: { seriesNo?: string } }[]).map(
        (r) => r.payload?.seriesNo,
      )
      expect(numbers).toContain(issued!.no)
    })
  })
})
