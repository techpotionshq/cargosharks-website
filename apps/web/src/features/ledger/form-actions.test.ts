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
import { desc, eq, sql } from 'drizzle-orm'

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
  chargeTypes,
  enquiries,
  invoiceLines,
  invoices,
  notificationOutbox,
  payments,
  paymentAllocations,
  quoteLines,
  quotes,
  branches,
  customers,
  principals,
  principalBranchRoles,
  roles,
  workingCalendars,
  withActor,
} = await import('@qabandi/db')
const {
  addInvoiceLine,
  addQuoteLine,
  allocatePayment,
  createInvoice,
  createQuote,
  recordPayment,
  setInvoiceStatus,
  setQuoteStatus,
} = await import('./form-actions')

/** Resolved once in `beforeAll`; a seeded charge type the quote lines hang on. */
let freightChargeTypeId: string

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
  'quote.send',
  'quote.accept',
  'quote.reject',
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

      const [freight] = await tx
        .select({ id: chargeTypes.id })
        .from(chargeTypes)
        .where(eq(chargeTypes.key, 'ocean_freight'))
        .limit(1)
      if (!freight) throw new Error('Run `pnpm db:seed` before the ledger tests')
      freightChargeTypeId = freight.id
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

/**
 * Quotations — the half of the ledger that decides a price before anybody is
 * committed to it.
 *
 * Two properties carry the feature and neither is arithmetic.
 *
 * **The margin is frozen, not recomputed.** A quote sent in March, priced at
 * March's buying rates, keeps March's margin forever (§6.3). Recomputing it
 * against a later rate card would make the margin column on the register a
 * statement about today rather than about the deal, and the register is the
 * only place anybody looks to see whether the desk is pricing well.
 *
 * **Versions supersede in one transaction.** Re-quoting writes version N+1 and
 * marks N superseded together, so there is never a moment where two versions
 * of the same quotation are both live and a customer could be shown either.
 */
describe.skipIf(!enabled)('quotations', () => {
  const RUN = Date.now().toString(36).toUpperCase().slice(-5)
  let seq = 0

  // The fixtures above are already in the database by the time this runs; what
  // its `afterAll` cleared is the mocked session, so this puts it back.
  beforeAll(() => {
    harness.session = session
  })

  async function enquiry(): Promise<string> {
    seq += 1
    return withActor({ ...actor, type: 'system' }, async (tx) => {
      const [row] = await tx
        .insert(enquiries)
        .values({
          reference: `LGT-ENQ-${RUN}-${seq}`,
          branchId: BRANCH,
          customerId: CUSTOMER,
          status: 'rating',
          channel: 'email',
          // Answered already, so the SLA sweep has nothing to escalate here.
          firstRespondedAt: new Date(),
        })
        .returning({ id: enquiries.id })
      return row!.id
    })
  }

  const quotesFor = (enquiryId: string) =>
    withActor(actor, (tx) =>
      tx.select().from(quotes).where(eq(quotes.enquiryId, enquiryId)).orderBy(quotes.version),
    )

  const priced = (fields: Record<string, string> = {}) => ({
    currency: 'USD',
    totalSell: '4250.00',
    totalCost: '3600.00',
    validUntil: '2035-12-31',
    ...fields,
  })

  describe('drafting one', () => {
    it('freezes the margin it was priced at', async () => {
      const id = await enquiry()

      const state = await createQuote(
        {},
        form({
          enquiryId: id,
          branchId: BRANCH,
          ...priced({ totalSell: '1000', totalCost: '750' }),
        }),
      )

      const [row] = await quotesFor(id)
      expect(state.ok).toBeTruthy()
      expect(row?.version).toBe(1)
      expect(row?.status).toBe('draft')
      expect((row!.pricedSnapshot as { marginPct: number }).marginPct).toBe(25)
    })

    it('carries the note the salesperson attached to the price', async () => {
      const id = await enquiry()

      await createQuote(
        {},
        form({ enquiryId: id, branchId: BRANCH, ...priced(), notes: 'Rate held to month end' }),
      )

      const [row] = await quotesFor(id)
      expect((row!.pricedSnapshot as { notes: string }).notes).toBe('Rate held to month end')
    })

    /**
     * Re-quoting keeps the reference and adds a version. A customer chasing
     * "your quotation QUO-2026-00042" must find one document with a history,
     * not three unrelated numbers.
     */
    it('supersedes the previous version in the same transaction', async () => {
      const id = await enquiry()
      await createQuote({}, form({ enquiryId: id, branchId: BRANCH, ...priced() }))

      await createQuote(
        {},
        form({ enquiryId: id, branchId: BRANCH, ...priced({ totalSell: '4400.00' }) }),
      )

      const rows = await quotesFor(id)
      expect(rows.map((r) => r.version)).toEqual([1, 2])
      expect(rows[0]?.status).toBe('superseded')
      expect(rows[1]?.status).toBe('draft')
      // Same document, second version.
      expect(rows[1]?.reference).toBe(`${rows[0]?.reference}-v2`)
    })

    /**
     * The desk is stopped, not warned. A quotation sent below cost is a loss
     * the company is contractually bound to once it is accepted, and it is
     * almost always a transposed figure rather than a decision.
     */
    it('refuses a price below what the job costs us', async () => {
      const id = await enquiry()

      const state = await createQuote(
        {},
        form({
          enquiryId: id,
          branchId: BRANCH,
          ...priced({ totalSell: '3600.00', totalCost: '4250.00' }),
        }),
      )

      expect(state.errors?.totalSell).toMatch(/below what it costs/)
      expect(await quotesFor(id)).toEqual([])
    })

    it('allows a price exactly at cost, which is a decision rather than a slip', async () => {
      const id = await enquiry()

      const state = await createQuote(
        {},
        form({
          enquiryId: id,
          branchId: BRANCH,
          ...priced({ totalSell: '3600.00', totalCost: '3600.00' }),
        }),
      )

      expect(state.ok).toBeTruthy()
      expect((await quotesFor(id))[0]?.pricedSnapshot).toMatchObject({ marginPct: 0 })
    })

    it('asks for the figures it cannot invent', async () => {
      const state = await createQuote({}, form({ enquiryId: await enquiry(), branchId: BRANCH }))

      expect(state.errors?.totalSell).toBeTruthy()
      expect(state.errors?.totalCost).toBeTruthy()
      expect(state.errors?.validUntil).toBeTruthy()
    })

    /** Money is decimal all the way down; a thousand-separator is not a number. */
    it('refuses an amount that is not one', async () => {
      const state = await createQuote(
        {},
        form({
          enquiryId: await enquiry(),
          branchId: BRANCH,
          ...priced({ totalSell: '4,250.00' }),
        }),
      )

      expect(state.errors?.totalSell).toBeTruthy()
    })

    it('refuses a branch the salesperson does not sit in', async () => {
      await expect(
        createQuote(
          {},
          form({
            enquiryId: await enquiry(),
            branchId: '00000000-0000-7000-8000-0000000000b2',
            ...priced(),
          }),
        ),
      ).rejects.toThrow()
    })
  })

  describe('pricing its lines', () => {
    async function draft(): Promise<string> {
      const id = await enquiry()
      await createQuote({}, form({ enquiryId: id, branchId: BRANCH, ...priced() }))
      const [row] = await quotesFor(id)
      return row!.id
    }

    const linesOf = (quoteId: string) =>
      withActor(actor, (tx) => tx.select().from(quoteLines).where(eq(quoteLines.quoteId, quoteId)))

    /**
     * The multiplication happens in PostgreSQL, on `numeric`. `0.1 * 3` is not
     * `0.3` in a float and a quotation is not the place to find that out.
     */
    it('multiplies the line out in the database, not in JavaScript', async () => {
      const quoteId = await draft()

      await addQuoteLine(
        {},
        form({
          quoteId,
          chargeTypeId: freightChargeTypeId,
          basis: 'per_container',
          quantity: '3',
          rate: '0.1',
          currency: 'USD',
        }),
      )

      const [line] = await linesOf(quoteId)
      expect(Number(line?.amount)).toBeCloseTo(0.3, 6)
      expect(line?.basis).toBe('per_container')
    })

    it('records the description the customer will read', async () => {
      const quoteId = await draft()

      await addQuoteLine(
        {},
        form({
          quoteId,
          chargeTypeId: freightChargeTypeId,
          quantity: '1',
          rate: '1450',
          currency: 'USD',
          description: 'Ocean freight KWI/JEA, all-in',
        }),
      )

      expect((await linesOf(quoteId))[0]?.description).toBe('Ocean freight KWI/JEA, all-in')
    })

    it('asks which charge the line is', async () => {
      const state = await addQuoteLine({}, form({ quoteId: await draft(), rate: '100' }))

      expect(state.errors?.chargeTypeId).toBeTruthy()
    })

    it('refuses a rate that is not a number', async () => {
      const state = await addQuoteLine(
        {},
        form({ quoteId: await draft(), chargeTypeId: freightChargeTypeId, rate: 'about 1450' }),
      )

      expect(state.errors?.rate).toBeTruthy()
    })

    /**
     * A sent quotation is a document the customer is holding. Editing its
     * lines underneath them would leave the two copies disagreeing with no
     * record that anything changed — which is what versions are for.
     */
    it('refuses to edit a quotation that has been sent', async () => {
      const quoteId = await draft()
      await setQuoteStatus({}, form({ quoteId, status: 'sent' }))

      await expect(
        addQuoteLine(
          {},
          form({
            quoteId,
            chargeTypeId: freightChargeTypeId,
            quantity: '1',
            rate: '50',
            currency: 'USD',
          }),
        ),
      ).rejects.toThrow(/sent quotation cannot be edited/)

      expect(await linesOf(quoteId)).toEqual([])
    })
  })

  describe('sending and deciding', () => {
    async function draft(): Promise<string> {
      const id = await enquiry()
      await createQuote({}, form({ enquiryId: id, branchId: BRANCH, ...priced() }))
      const [row] = await quotesFor(id)
      return row!.id
    }

    const quoteRow = async (quoteId: string) => {
      const [row] = await withActor(actor, (tx) =>
        tx.select().from(quotes).where(eq(quotes.id, quoteId)),
      )
      return row
    }

    it('stamps when it was sent, and does not move that on a resend', async () => {
      const quoteId = await draft()

      await setQuoteStatus({}, form({ quoteId, status: 'sent' }))
      const first = (await quoteRow(quoteId))!.sentAt

      await setQuoteStatus({}, form({ quoteId, status: 'sent' }))

      expect(first).toBeInstanceOf(Date)
      // `coalesce(sent_at, now())` — the date the customer was told is the
      // date the clock on their decision started, and a resend does not reset
      // it.
      expect((await quoteRow(quoteId))!.sentAt).toEqual(first)
    })

    /**
     * Raised inside the same transaction, so a quotation that fails to move
     * never announces itself to the customer (§7.4).
     */
    it('raises the notification with the price at the currency’s own precision', async () => {
      const quoteId = await draft()

      await setQuoteStatus({}, form({ quoteId, status: 'sent' }))

      const [event] = await withActor(actor, (tx) =>
        tx
          .select()
          .from(notificationOutbox)
          .where(eq(notificationOutbox.eventKey, 'quote.sent'))
          .orderBy(desc(notificationOutbox.createdAt))
          .limit(1),
      )
      const payload = event?.payload as { total: string; currency: string; reference: string }
      // `numeric(19,6)` returns `4250.000000`; USD has two decimals, and a
      // price quoted to six reads as a machine rather than as an offer.
      expect(payload.total).toBe('4250.00')
      expect(payload.currency).toBe('USD')
      expect(event?.customerId).toBe(CUSTOMER)
    })

    it('records the decision date when the customer answers', async () => {
      const quoteId = await draft()
      await setQuoteStatus({}, form({ quoteId, status: 'sent' }))

      await setQuoteStatus({}, form({ quoteId, status: 'accepted' }))

      const row = await quoteRow(quoteId)
      expect(row?.status).toBe('accepted')
      expect(row?.decidedAt).toBeInstanceOf(Date)
    })

    /** The state machine, not a free-text column. */
    it('refuses a move the machine does not allow', async () => {
      const quoteId = await draft()

      const state = await setQuoteStatus({}, form({ quoteId, status: 'accepted' }))

      expect(state.message).toMatch(/cannot move to that state/)
      expect((await quoteRow(quoteId))?.status).toBe('draft')
    })

    it('asks for something to update', async () => {
      expect((await setQuoteStatus({}, form({}))).errors?._).toBe('Nothing to update.')
      expect((await setQuoteStatus({}, form({ quoteId: 'x' }))).errors?._).toBeTruthy()
    })

    /**
     * Three moves, three keys. Accepting a quotation commits the company to a
     * price and rejecting one closes a deal, so neither is the same
     * permission as drafting.
     */
    it('asks a different permission for each move', async () => {
      const quoteId = await draft()
      await setQuoteStatus({}, form({ quoteId, status: 'sent' }))
      harness.session = { ...session, permissions: new Set(['quote.send']) }

      await expect(setQuoteStatus({}, form({ quoteId, status: 'accepted' }))).rejects.toThrow()
      await expect(setQuoteStatus({}, form({ quoteId, status: 'rejected' }))).rejects.toThrow()

      harness.session = session
    })
  })
})

describe.skipIf(!enabled)('drafting an invoice', () => {
  beforeAll(() => {
    harness.session = session
  })

  const linesOf = (invoiceId: string) =>
    withActor(actor, (tx) =>
      tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId)),
    )

  const newest = async () => {
    const [row] = await withActor(actor, (tx) =>
      tx
        .select()
        .from(invoices)
        .where(eq(invoices.branchId, BRANCH))
        .orderBy(desc(invoices.createdAt))
        .limit(1),
    )
    return row!
  }

  const draft = (fields: Record<string, string> = {}) =>
    form({
      branchId: BRANCH,
      customerId: CUSTOMER,
      currency: 'KWD',
      subtotal: '1000.000',
      taxTreatment: 'out_of_scope',
      dueOn: '2035-12-31',
      language: 'en',
      ...fields,
    })

  /**
   * Tax and total are computed by PostgreSQL from the subtotal and the rate,
   * so the three columns cannot disagree. A total typed by hand is a total
   * that is eventually wrong.
   */
  it('computes the tax and the total rather than accepting them', async () => {
    await createInvoice({}, draft({ taxTreatment: 'standard', taxRatePercent: '5' }))

    const row = await newest()
    expect(Number(row.taxAmount)).toBeCloseTo(50, 6)
    expect(Number(row.total)).toBeCloseTo(1050, 6)
  })

  /**
   * A rate is only applied under `standard`. A zero-rated or exempt supply
   * carries a rate of nothing however the form was filled in, because the
   * treatment is the fact and the percentage is a consequence of it.
   */
  it('applies no rate to a supply that is not standard-rated', async () => {
    await createInvoice({}, draft({ taxTreatment: 'zero_rated', taxRatePercent: '5' }))

    const row = await newest()
    expect(Number(row.taxRatePercent)).toBe(0)
    expect(Number(row.taxAmount)).toBe(0)
    expect(Number(row.total)).toBeCloseTo(1000, 6)
  })

  /** Drafts have no number — `invoices_series_when_issued` sees to that. */
  it('starts as a draft with no series number', async () => {
    await createInvoice({}, draft())

    const row = await newest()
    expect(row.status).toBe('draft')
    expect(row.seriesNo).toBeNull()
  })

  it('remembers which language the customer is invoiced in', async () => {
    await createInvoice({}, draft({ language: 'ar' }))

    expect((await newest()).language).toBe('ar')
  })

  it('asks for the amount and the date it cannot invent', async () => {
    const state = await createInvoice(
      {},
      form({
        branchId: BRANCH,
        customerId: CUSTOMER,
        currency: 'KWD',
        taxTreatment: 'out_of_scope',
        language: 'en',
      }),
    )

    expect(state.errors?.subtotal).toBeTruthy()
    expect(state.errors?.dueOn).toBeTruthy()
  })

  it('refuses a branch the clerk does not sit in', async () => {
    await expect(
      createInvoice({}, draft({ branchId: '00000000-0000-7000-8000-0000000000b2' })),
    ).rejects.toThrow()
  })

  describe('its lines', () => {
    async function drafted(fields: Record<string, string> = {}): Promise<string> {
      await createInvoice({}, draft({ subtotal: '0', ...fields }))
      return (await newest()).id
    }

    /**
     * Recomputed from the lines rather than incremented, so a corrected line
     * cannot leave the header permanently out by the difference.
     */
    it('rolls the header forward from the lines each time', async () => {
      const invoiceId = await drafted()

      await addInvoiceLine(
        {},
        form({ invoiceId, descriptionEn: 'Ocean freight', quantity: '2', unitPrice: '150.000' }),
      )
      await addInvoiceLine(
        {},
        form({ invoiceId, descriptionEn: 'Terminal handling', quantity: '1', unitPrice: '45.500' }),
      )

      const [row] = await withActor(actor, (tx) =>
        tx.select().from(invoices).where(eq(invoices.id, invoiceId)),
      )
      expect(Number(row?.subtotal)).toBeCloseTo(345.5, 6)
      expect(Number(row?.total)).toBeCloseTo(345.5, 6)
      expect(await linesOf(invoiceId)).toHaveLength(2)
    })

    it('taxes only the lines that are taxable', async () => {
      const invoiceId = await drafted({ taxTreatment: 'standard', taxRatePercent: '5' })

      await addInvoiceLine(
        {},
        form({
          invoiceId,
          descriptionEn: 'Taxable service',
          quantity: '1',
          unitPrice: '100.000',
          isTaxable: 'on',
        }),
      )
      await addInvoiceLine(
        {},
        form({ invoiceId, descriptionEn: 'Disbursement', quantity: '1', unitPrice: '100.000' }),
      )

      const lines = await linesOf(invoiceId)
      const taxable = lines.find((l) => l.descriptionEn === 'Taxable service')
      const disbursement = lines.find((l) => l.descriptionEn === 'Disbursement')

      expect(Number(taxable?.taxAmount)).toBeCloseTo(5, 6)
      expect(Number(disbursement?.taxAmount)).toBe(0)
    })

    /** A free-text line is allowed; a mis-keyed charge type is not. */
    it('takes a line with no charge type against it', async () => {
      const invoiceId = await drafted()

      const state = await addInvoiceLine(
        {},
        form({
          invoiceId,
          chargeTypeId: '',
          descriptionEn: 'Sundry disbursement',
          quantity: '1',
          unitPrice: '20.000',
        }),
      )

      expect(state.ok).toBeTruthy()
      expect((await linesOf(invoiceId))[0]?.chargeTypeId).toBeNull()
    })

    it('insists on a description, because that is what the customer reads', async () => {
      const state = await addInvoiceLine(
        {},
        form({ invoiceId: await drafted(), quantity: '1', unitPrice: '20.000' }),
      )

      expect(state.errors?.descriptionEn).toBeTruthy()
    })

    it('refuses a unit price that is not a number', async () => {
      const state = await addInvoiceLine(
        {},
        form({ invoiceId: await drafted(), descriptionEn: 'Freight', unitPrice: 'TBA' }),
      )

      expect(state.errors?.unitPrice).toBeTruthy()
    })
  })
})
