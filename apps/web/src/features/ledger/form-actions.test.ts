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

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
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

/**
 * The message keys stand in for the sentences, so an assertion names the case
 * rather than a wording a translator is free to change — as in `auth/actions.test.ts`.
 */
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    values ? `${namespace}.${key}:${JSON.stringify(values)}` : `${namespace}.${key}`,
}))

const {
  chargeTypes,
  currencies,
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
  creditStanding,
} = await import('@qabandi/db')
const { invoiceSummary, receivablesAgeing } = await import('./queries')
const {
  addInvoiceLine,
  addQuoteLine,
  allocatePayment,
  createInvoice,
  creditInvoice,
  createQuote,
  draftQuoteCoverNote,
  recordPayment,
  setInvoiceStatus,
  setQuoteCoverNote,
  setQuoteStatus,
} = await import('./form-actions')

/** Resolved once in `beforeAll`; a seeded charge type the quote lines hang on. */
let freightChargeTypeId: string

const BRANCH = '00000000-0000-7000-8000-00000000f001'

/**
 * A currency of this suite's own that no feed and no other suite ever rates —
 * ISO 4217's code reserved for testing — so "no rate on file" stays true
 * whatever ran before.
 */
// ISO 4217's "no currency": never given a rate by any suite. XTS is the
// costing suite's *rated* test currency, so it cannot double as unrated here.
const UNRATED = 'XXX'
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
  'quote.revise',
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

/**
 * A draft invoice for `total`, with one line for it, returning its id. The
 * line matters: approving or issuing an invoice with no lines is refused.
 */
async function draftInvoice(total: string, currency = 'KWD'): Promise<string> {
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .insert(invoices)
      .values({ branchId: BRANCH, customerId: CUSTOMER, currency, subtotal: total, total })
      .returning({ id: invoices.id })
    await tx.insert(invoiceLines).values({
      invoiceId: row!.id,
      descriptionEn: 'Ocean freight',
      unitPrice: total,
      amount: total,
    })
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

      await tx
        .insert(currencies)
        .values({ code: UNRATED, nameEn: 'No currency', nameAr: 'بلا عملة', minorUnits: 2 })
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

      expect(state.errors?.amount).toBe('ledgerValidation.overAllocated')
    })

    it('refuses more than the invoice still owes', async () => {
      const invoiceId = await issuedInvoice('120.000')
      const paymentId = await receipt('500.000')

      const state = await allocatePayment({}, form({ paymentId, invoiceId, amount: '200.000' }))

      expect(state.errors?.amount).toBe('ledgerValidation.overInvoiced')
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

    const receiptFor = (invoiceId: string, fields: Record<string, string> = {}) =>
      form({
        branchId: BRANCH,
        customerId: CUSTOMER,
        amount: '50.000',
        currency: 'KWD',
        receivedOn: '2026-08-18',
        method: 'bank_transfer',
        invoiceId,
        ...fields,
      })

    /** F4. This returned a 500: `recordPayment` caught none of the refusals. */
    it('says so, rather than crashing, when the receipt is more than is owed', async () => {
      const invoiceId = await issuedInvoice('40.000')
      const state = await recordPayment({}, receiptFor(invoiceId))
      expect(state.errors?.amount).toBe('ledgerValidation.overInvoiced')
      expect(Number((await invoiceRow(invoiceId)).paid)).toBe(0)
    })

    it('refuses a receipt of nothing', async () => {
      const invoiceId = await issuedInvoice('40.000')
      const state = await recordPayment({}, receiptFor(invoiceId, { amount: '0' }))
      expect(state.errors?.amount).toBe('ledgerValidation.amountMustBePositive')
    })

    it('refuses to settle an invoice that has not been issued', async () => {
      const invoiceId = await draftInvoice('40.000')
      await setInvoiceStatus({}, form({ invoiceId, status: 'approved' }))
      const state = await recordPayment({}, receiptFor(invoiceId, { amount: '40.000' }))
      expect(state.errors?.invoiceId).toBe('ledgerValidation.invoiceNotPayable')
    })

    /*
      F9. Crediting flipped the status and wrote nothing else, so the export
      never reversed the revenue and the reports disagreed about what was owed.
    */
    it('raises a numbered credit note that reverses the invoice', async () => {
      const invoiceId = await issuedInvoice('40.000')
      const state = await setInvoiceStatus({}, form({ invoiceId, status: 'credited' }))
      expect(state.errors).toBeUndefined()

      const [note] = await withActor(actor, (tx) =>
        tx.select().from(invoices).where(eq(invoices.creditsInvoiceId, invoiceId)),
      )
      expect(note).toMatchObject({ isCreditNote: true, status: 'credited' })
      expect(note!.seriesNo).toBeTruthy()
      expect(Number(note!.total)).toBe(40)
      // Born settled, so no "what is owed" query ever counts it.
      expect(Number(note!.amountPaid)).toBe(40)
      const lines = await withActor(actor, (tx) =>
        tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, note!.id)),
      )
      expect(lines.map((l) => Number(l.amount))).toEqual([40])
    })

    it('refuses to settle a credited invoice', async () => {
      const invoiceId = await issuedInvoice('40.000')
      await setInvoiceStatus({}, form({ invoiceId, status: 'credited' }))
      const state = await recordPayment({}, receiptFor(invoiceId, { amount: '40.000' }))
      expect(state.errors?.invoiceId).toBe('ledgerValidation.invoiceNotPayable')
    })

    /** 500 KWD settling a 500 USD invoice. */
    it("refuses a receipt in a currency other than the invoice's", async () => {
      const invoiceId = await issuedInvoice('40.00', 'USD')
      const state = await recordPayment(
        {},
        receiptFor(invoiceId, { amount: '40.000', currency: 'KWD' }),
      )
      expect(state.errors?.invoiceId).toBe(
        'ledgerValidation.receiptCurrencyMismatch:{"received":"KWD","invoiced":"USD"}',
      )
    })

    /** F2. A foreign receipt was always stored at rate 1. */
    it('stores the rate a foreign receipt was typed at', async () => {
      const state = await recordPayment(
        {},
        form({
          branchId: BRANCH,
          customerId: CUSTOMER,
          amount: '100.00',
          currency: 'USD',
          fxRate: '0.3071',
          receivedOn: '2026-08-18',
          method: 'bank_transfer',
          reference: 'FX-TYPED',
        }),
      )
      expect(state.errors).toBeUndefined()
      const [row] = await withActor(actor, (tx) =>
        tx
          .select({ fxRate: payments.fxRate })
          .from(payments)
          .where(eq(payments.reference, 'FX-TYPED'))
          .limit(1),
      )
      expect(Number(row!.fxRate)).toBeCloseTo(0.3071, 8)
    })

    it('asks for a rate where none is typed and none is on file', async () => {
      const state = await recordPayment(
        {},
        form({
          branchId: BRANCH,
          customerId: CUSTOMER,
          amount: '100.00',
          currency: UNRATED,
          receivedOn: '2026-08-18',
          method: 'bank_transfer',
        }),
      )
      expect(state.errors?.fxRate).toBe(
        `ledgerValidation.fxRateNeeded:{"currency":"${UNRATED}","base":"KWD"}`,
      )
    })

    /** F8. The second part of one receipt against the same invoice. */
    it('adds a top-up to the allocation already there', async () => {
      const invoiceId = await issuedInvoice('100.000')
      const paymentId = await receipt('100.000')

      await allocatePayment({}, form({ paymentId, invoiceId, amount: '30.000' }))
      const state = await allocatePayment({}, form({ paymentId, invoiceId, amount: '70.000' }))

      expect(state.errors).toBeUndefined()
      const rows = await withActor(actor, (tx) =>
        tx
          .select({ amount: paymentAllocations.amount })
          .from(paymentAllocations)
          .where(eq(paymentAllocations.paymentId, paymentId)),
      )
      expect(rows.map((r) => Number(r.amount))).toEqual([100])
      expect((await invoiceRow(invoiceId)).status).toBe('paid')
    })

    /** F10. Two allocations against one invoice at once used to over-settle it. */
    it('lets only one of two concurrent allocations settle the last of an invoice', async () => {
      const invoiceId = await issuedInvoice('100.000')
      const first = await receipt('100.000')
      const second = await receipt('100.000')

      const states = await Promise.all([
        allocatePayment({}, form({ paymentId: first, invoiceId, amount: '100.000' })),
        allocatePayment({}, form({ paymentId: second, invoiceId, amount: '100.000' })),
      ])

      expect(states.filter((st) => st.errors === undefined)).toHaveLength(1)
      expect(Number((await invoiceRow(invoiceId)).paid)).toBe(100)
    })
  })

  /*
    F9. A credit note reversed the whole invoice or nothing. Part of one is
    now its own numbered note, the invoice owing less and staying open; the
    register, the ageing and the credit exposure all count the reduction.
  */
  describe('creditInvoice — part of an invoice', () => {
    const notesFor = (invoiceId: string) =>
      withActor(actor, (tx) =>
        tx.select().from(invoices).where(eq(invoices.creditsInvoiceId, invoiceId)),
      )
    const credited = async (invoiceId: string) => {
      const [row] = await withActor(actor, (tx) =>
        tx
          .select({ status: invoices.status, credited: invoices.amountCredited })
          .from(invoices)
          .where(eq(invoices.id, invoiceId)),
      )
      return row!
    }
    const kwdOwed = async () =>
      (await invoiceSummary(actor)).outstanding.find((o) => o.currency === 'KWD')?.amount ?? '0'
    const kwdAgeing = async () => {
      const kwd = (await receivablesAgeing(actor)).byCurrency.find((c) => c.currency === 'KWD')
      return kwd ? JSON.stringify(kwd) : ''
    }

    it('raises a note for part of it, scaled across its lines, and leaves it issued', async () => {
      // Two lines, one taxed, so the proration has something to split.
      const invoiceId = await withActor(actor, async (tx) => {
        const [row] = await tx
          .insert(invoices)
          .values({
            branchId: BRANCH,
            customerId: CUSTOMER,
            currency: 'KWD',
            subtotal: '100.000',
            taxAmount: '5.000',
            total: '105.000',
          })
          .returning({ id: invoices.id })
        await tx.insert(invoiceLines).values([
          { invoiceId: row!.id, descriptionEn: 'Freight', unitPrice: '60', amount: '60.000' },
          {
            invoiceId: row!.id,
            descriptionEn: 'Clearance',
            unitPrice: '40',
            amount: '40.000',
            taxAmount: '5.000',
            isTaxable: true,
            sortOrder: 1,
          },
        ])
        return row!.id
      })
      await setInvoiceStatus({}, form({ invoiceId, status: 'approved' }))
      await setInvoiceStatus({}, form({ invoiceId, status: 'issued' }))

      const owedBefore = await kwdOwed()
      const exposureBefore = (await creditStanding(actor, CUSTOMER, BRANCH)).outstanding
      const state = await creditInvoice(
        {},
        form({ invoiceId, amount: '21.000', notes: 'One pallet short' }),
      )
      expect(state.errors).toBeUndefined()
      expect(state.ok).toBeTruthy()

      const [note] = await notesFor(invoiceId)
      expect(note).toMatchObject({
        isCreditNote: true,
        status: 'credited',
        notes: 'One pallet short',
      })
      expect(state.ok!.split(':')[0]).toBe(note!.seriesNo)
      expect(note!.total).toMatch(/^21\.0+$/)
      expect(note!.amountPaid).toMatch(/^21\.0+$/)
      const lines = await withActor(actor, (tx) =>
        tx
          .select({ amount: invoiceLines.amount, tax: invoiceLines.taxAmount })
          .from(invoiceLines)
          .where(eq(invoiceLines.invoiceId, note!.id))
          .orderBy(invoiceLines.sortOrder),
      )
      // A fifth of each: 12 + 8 net, 1 tax.
      expect(lines.map((l) => [Number(l.amount), Number(l.tax)])).toEqual([
        [12, 0],
        [8, 1],
      ])

      const after = await credited(invoiceId)
      expect(after.status).toBe('issued')
      expect(after.credited).toMatch(/^21\.0+$/)

      // Owed less by exactly the note, on the register and in the exposure.
      const owedAfter = await kwdOwed()
      expect(
        (
          await withActor(actor, (tx) =>
            tx.execute(sql`select (${owedBefore}::numeric - ${owedAfter}::numeric)::text as d`),
          )
        ).rows[0],
      ).toMatchObject({ d: expect.stringMatching(/^21\.0+$/) })
      const exposureAfter = (await creditStanding(actor, CUSTOMER, BRANCH)).outstanding
      expect(exposureBefore.amount.minus(exposureAfter.amount).toFixed(3)).toBe('21.000')

      // The rest is payable, and only the rest.
      const over = await recordPayment(
        {},
        form({
          branchId: BRANCH,
          customerId: CUSTOMER,
          amount: '84.001',
          currency: 'KWD',
          receivedOn: '2026-08-18',
          method: 'bank_transfer',
          invoiceId,
        }),
      )
      expect(over.errors?.amount).toBe('ledgerValidation.overInvoiced')
      const paid = await recordPayment(
        {},
        form({
          branchId: BRANCH,
          customerId: CUSTOMER,
          amount: '84.000',
          currency: 'KWD',
          receivedOn: '2026-08-18',
          method: 'bank_transfer',
          invoiceId,
        }),
      )
      expect(paid.errors).toBeUndefined()
      expect((await credited(invoiceId)).status).toBe('paid')
    })

    it('refuses more than is still owed, and closes the invoice at exactly that', async () => {
      const invoiceId = await issuedInvoice('100.000')
      const paymentId = await receipt('40.000')
      await allocatePayment({}, form({ paymentId, invoiceId, amount: '40.000' }))
      const ageingBefore = await kwdAgeing()

      const tooMuch = await creditInvoice({}, form({ invoiceId, amount: '60.001' }))
      expect(tooMuch.errors?.amount).toBe(
        'ledgerValidation.creditExceedsOwed:{"creditable":"60.000","currency":"KWD"}',
      )
      expect((await creditInvoice({}, form({ invoiceId, amount: '1.0001' }))).errors?.amount).toBe(
        'ledgerValidation.creditTooPrecise',
      )
      expect((await creditInvoice({}, form({ invoiceId, amount: 'ten' }))).errors?.amount).toBe(
        'ledgerValidation.creditAmountNumber',
      )
      expect(await notesFor(invoiceId)).toHaveLength(0)

      await creditInvoice({}, form({ invoiceId, amount: '25.000' }))
      expect((await credited(invoiceId)).status).toBe('part_paid')
      expect(await kwdAgeing()).not.toBe(ageingBefore)

      await creditInvoice({}, form({ invoiceId, amount: '35.000' }))
      const closed = await credited(invoiceId)
      expect(closed.status).toBe('credited')
      expect(closed.credited).toMatch(/^60\.0+$/)
      expect(await notesFor(invoiceId)).toHaveLength(2)

      // Nothing is left to credit.
      const again = await creditInvoice({}, form({ invoiceId, amount: '1.000' }))
      expect(again.message).toBe('ledgerValidation.invoiceBadTransition')
    })

    it('credits only what is still owed when crediting the whole of a part-paid invoice', async () => {
      const invoiceId = await issuedInvoice('100.000')
      const paymentId = await receipt('30.000')
      await allocatePayment({}, form({ paymentId, invoiceId, amount: '30.000' }))
      await creditInvoice({}, form({ invoiceId, amount: '20.000' }))

      await setInvoiceStatus({}, form({ invoiceId, status: 'credited' }))
      const notes = await notesFor(invoiceId)
      expect(notes.map((n) => Number(n.total)).sort()).toEqual([20, 50])
      expect(await credited(invoiceId)).toMatchObject({ status: 'credited' })
    })

    it('refuses a draft, a credit note, and an invoice in another branch', async () => {
      const draft = await draftInvoice('10.000')
      expect((await creditInvoice({}, form({ invoiceId: draft, amount: '1' }))).message).toBe(
        'ledgerValidation.invoiceBadTransition',
      )

      const invoiceId = await issuedInvoice('10.000')
      await creditInvoice({}, form({ invoiceId, amount: '1.000' }))
      const [note] = await notesFor(invoiceId)
      expect((await creditInvoice({}, form({ invoiceId: note!.id, amount: '1' }))).message).toBe(
        'ledgerValidation.invoiceBadTransition',
      )

      // `invoice.credit` held elsewhere is not held here.
      harness.session = {
        ...session,
        branchRoles: new Map([['00000000-0000-7000-8000-0000000000ff', 'finance']]),
      }
      try {
        await expect(creditInvoice({}, form({ invoiceId, amount: '1.000' }))).rejects.toThrow()
      } finally {
        harness.session = session
      }
    })
  })

  /*
    F22. An open receivable imported at cutover carries what was paid before
    it with no receipt behind it. Re-deriving paid-to-date from receipts alone
    wiped it on the first receipt, and the customer owed it again.
  */
  describe('a payment made before cutover', () => {
    /** Shaped as `writeOpenReceivables` writes it: numbered, part paid, opening set. */
    const imported = () =>
      withActor(actor, async (tx) => {
        const [row] = await tx
          .insert(invoices)
          .values({
            branchId: BRANCH,
            customerId: CUSTOMER,
            seriesNo: `OPEN-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            status: 'part_paid',
            currency: 'KWD',
            subtotal: '100.000',
            total: '100.000',
            amountPaid: '40.000',
            amountPaidOpening: '40.000',
            issuedAt: new Date('2026-01-15T09:00:00Z'),
          })
          .returning({ id: invoices.id })
        return row!.id
      })

    it('keeps the opening payment through a receipt, and caps the receipt at the rest', async () => {
      const invoiceId = await imported()
      const over = await allocatePayment(
        {},
        form({ paymentId: await receipt('60.001'), invoiceId, amount: '60.001' }),
      )
      expect(over.errors?.amount).toBe('ledgerValidation.overInvoiced')

      const part = await allocatePayment(
        {},
        form({ paymentId: await receipt('20.000'), invoiceId, amount: '20.000' }),
      )
      expect(part.errors).toBeUndefined()
      let row = await invoiceRow(invoiceId)
      expect(row.status).toBe('part_paid')
      expect(row.paid).toMatch(/^60\.0+$/)

      await allocatePayment(
        {},
        form({ paymentId: await receipt('40.000'), invoiceId, amount: '40.000' }),
      )
      row = await invoiceRow(invoiceId)
      expect(row.status).toBe('paid')
      expect(row.paid).toMatch(/^100\.0+$/)
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
    /** F10. Two clicks on Issue each allocated a number, leaving a gap. */
    it('consumes one number when the same invoice is issued twice at once', async () => {
      const counter = () =>
        withActor(actor, async (tx) => {
          const [row] = await tx
            .select({ next: branches.invoiceSeriesNext })
            .from(branches)
            .where(eq(branches.id, BRANCH))
          return Number(row!.next)
        })
      const id = await draftInvoice('10.000')
      await setInvoiceStatus({}, form({ invoiceId: id, status: 'approved' }))
      const before = await counter()

      await Promise.all([
        setInvoiceStatus({}, form({ invoiceId: id, status: 'issued' })),
        setInvoiceStatus({}, form({ invoiceId: id, status: 'issued' })),
      ])

      expect(await counter()).toBe(before + 1)
    })

    it('refuses to approve an invoice with no lines', async () => {
      const id = await withActor(actor, async (tx) => {
        const [row] = await tx
          .insert(invoices)
          .values({ branchId: BRANCH, customerId: CUSTOMER, currency: 'KWD' })
          .returning({ id: invoices.id })
        return row!.id
      })
      const state = await setInvoiceStatus({}, form({ invoiceId: id, status: 'approved' }))
      expect(state.message).toBe('ledgerValidation.invoiceNoLines')
    })

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
      // And the old one says what replaced it — every "current quotation"
      // read filters on this, and nothing wrote it (S3).
      expect(rows[0]?.supersededById).toBe(rows[1]?.id)
      expect(rows[1]?.supersededById).toBeNull()
    })

    /** v3 is the first version's stem plus `-v3`, not `-v2-v3` (S6). */
    it('numbers every revision from the first reference', async () => {
      const id = await enquiry()
      for (const sell of ['4250.00', '4300.00', '4400.00']) {
        await createQuote(
          {},
          form({ enquiryId: id, branchId: BRANCH, ...priced({ totalSell: sell }) }),
        )
      }

      const rows = await quotesFor(id)
      expect(rows[2]?.reference).toBe(`${rows[0]?.reference}-v3`)
      expect(rows[1]?.supersededById).toBe(rows[2]?.id)
    })

    /** Superseding a quote the customer may hold is a revision — its own key (S6). */
    it('asks quote.revise before superseding a version', async () => {
      const id = await enquiry()
      await createQuote({}, form({ enquiryId: id, branchId: BRANCH, ...priced() }))
      harness.session = { ...session, permissions: new Set(['quote.send']) }

      await expect(
        createQuote({}, form({ enquiryId: id, branchId: BRANCH, ...priced() })),
      ).rejects.toThrow()
      harness.session = session

      expect((await quotesFor(id)).map((r) => r.status)).toEqual(['draft'])
    })

    /**
     * The customer said yes to that version. Re-quoting used to retire it
     * whatever its status, and a job booked from it then pointed at a
     * superseded quote (S2).
     */
    it('never supersedes an accepted quotation', async () => {
      const id = await enquiry()
      await createQuote({}, form({ enquiryId: id, branchId: BRANCH, ...priced() }))
      const [first] = await quotesFor(id)
      await setQuoteStatus({}, form({ quoteId: first!.id, status: 'sent' }))
      await setQuoteStatus({}, form({ quoteId: first!.id, status: 'accepted' }))

      const state = await createQuote({}, form({ enquiryId: id, branchId: BRANCH, ...priced() }))

      expect(state.message).toBe('ledgerValidation.quoteAlreadyAccepted')
      const rows = await quotesFor(id)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.status).toBe('accepted')
      expect(rows[0]?.supersededById).toBeNull()
    })

    /** A quotation already past its date is not an offer (S9). */
    it('refuses an expiry date that has already passed', async () => {
      const id = await enquiry()

      const state = await createQuote(
        {},
        form({ enquiryId: id, branchId: BRANCH, ...priced({ validUntil: '2020-01-01' }) }),
      )

      expect(state.errors?.validUntil).toBe('ledgerValidation.quoteExpiryInPast')
      expect(await quotesFor(id)).toEqual([])
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

      expect(state.errors?.totalSell).toBe('ledgerValidation.priceBelowCost')
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

    /**
     * Money is decimal all the way down, and a figure that cannot be read
     * unambiguously is refused — a comma as the decimal mark, say.
     */
    it('refuses an amount that is not one', async () => {
      const state = await createQuote(
        {},
        form({
          enquiryId: await enquiry(),
          branchId: BRANCH,
          ...priced({ totalSell: '4.250,00' }),
        }),
      )

      expect(state.errors?.totalSell).toBeTruthy()
    })

    /**
     * QA P3. A thousands separator used to be refused as "not a number",
     * although "4,250.00" is how every quotation in the business prints the
     * figure. It reads as the figure it is, and stays a decimal string.
     */
    it('reads a grouped amount as the figure it is', async () => {
      const id = await enquiry()
      const state = await createQuote(
        {},
        form({ enquiryId: id, branchId: BRANCH, ...priced({ totalSell: '4,250.00' }) }),
      )

      expect(state.errors).toBeUndefined()
      const [row] = await quotesFor(id)
      expect(row?.totalSell).toBe('4250.000000')
    })

    /**
     * The branch is the enquiry's. The dialog defaulted to the session's
     * first branch and the action trusted it, so a KWI enquiry got a DXB
     * quotation (S7); a posted branch is now ignored, and one outside the
     * salesperson's branches cannot reach it either.
     */
    it('takes the branch from the enquiry, not from the form', async () => {
      const id = await enquiry()

      const state = await createQuote(
        {},
        form({ enquiryId: id, branchId: '00000000-0000-7000-8000-0000000000b2', ...priced() }),
      )

      expect(state.ok).toBeTruthy()
      expect((await quotesFor(id))[0]?.branchId).toBe(BRANCH)
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

    /**
     * QA P2-5. "New quotation" on a priced enquiry made a v2 with no lines,
     * so the revised offer printed a total over an empty table. The lines
     * travel to the new draft, and the total is theirs.
     */
    it('copies the lines onto a revision, and the total follows them', async () => {
      const id = await enquiry()
      await createQuote({}, form({ enquiryId: id, branchId: BRANCH, ...priced() }))
      const [first] = await quotesFor(id)
      for (const rate of ['1450.00', '250.50']) {
        await addQuoteLine(
          {},
          form({
            quoteId: first!.id,
            chargeTypeId: freightChargeTypeId,
            quantity: '1',
            rate,
            currency: 'USD',
            description: `Line at ${rate}`,
          }),
        )
      }

      await createQuote(
        {},
        form({ enquiryId: id, branchId: BRANCH, ...priced({ totalSell: '9999.00' }) }),
      )

      const [, second] = await quotesFor(id)
      const lines = await linesOf(second!.id)
      expect(lines.map((l) => l.description).sort()).toEqual(['Line at 1450.00', 'Line at 250.50'])
      expect(second?.totalSell).toBe('1700.500000')
      // The first version keeps its own lines — a revision copies, never moves.
      expect(await linesOf(first!.id)).toHaveLength(2)
    })

    it('leaves the lines behind when the revision changes currency', async () => {
      const id = await enquiry()
      await createQuote({}, form({ enquiryId: id, branchId: BRANCH, ...priced() }))
      const [first] = await quotesFor(id)
      await addQuoteLine(
        {},
        form({
          quoteId: first!.id,
          chargeTypeId: freightChargeTypeId,
          quantity: '1',
          rate: '100',
          currency: 'USD',
        }),
      )

      await createQuote(
        {},
        form({
          enquiryId: id,
          branchId: BRANCH,
          ...priced({ currency: 'KWD', totalSell: '4300' }),
        }),
      )

      const [, second] = await quotesFor(id)
      expect(await linesOf(second!.id)).toHaveLength(0)
      expect(second?.totalSell).toBe('4300.000000')
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

      const state = await addQuoteLine(
        {},
        form({
          quoteId,
          chargeTypeId: freightChargeTypeId,
          quantity: '1',
          rate: '50',
          currency: 'USD',
        }),
      )

      // Returned rather than thrown, so the dialog can say it.
      expect(state.message).toBe('ledgerValidation.quoteSentNoEdit')
      expect(await linesOf(quoteId)).toEqual([])
    })

    /** The hidden currency field was the only guard (S10). */
    it('refuses a line in another currency than the quotation', async () => {
      const quoteId = await draft()

      const state = await addQuoteLine(
        {},
        form({ quoteId, chargeTypeId: freightChargeTypeId, rate: '100', currency: 'KWD' }),
      )

      expect(state.message).toBe('ledgerValidation.quoteLineCurrency')
      expect(await linesOf(quoteId)).toEqual([])
    })

    /**
     * Once a draft has lines they are the offer, and the total follows them.
     * The typed total stood unreconciled beneath the lines on the PDF (S10).
     */
    it('keeps the total equal to its lines, rounded to the currency', async () => {
      const quoteId = await draft()
      for (const rate of ['1000.004', '250']) {
        await addQuoteLine(
          {},
          form({ quoteId, chargeTypeId: freightChargeTypeId, rate, currency: 'USD' }),
        )
      }

      const [row] = await withActor(actor, (tx) =>
        tx.select().from(quotes).where(eq(quotes.id, quoteId)),
      )
      // USD has two decimals: 1000.004 is 1000.00 on the line and in the sum.
      expect(row?.totalSell).toBe('1250.000000')
      // Restated against the frozen cost of 3600 — a loss, and it says so.
      expect((row!.pricedSnapshot as { marginPct: number }).marginPct).toBe(-188)
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

    /**
     * Sending is what quotes the enquiry (S1). An enquiry that went through
     * an RFQ sat in `rating` for good, and `won` is legal only from `quoted`.
     */
    it('moves an enquiry in rating to quoted when the quotation is sent', async () => {
      const quoteId = await draft()
      const enquiryId = (await quoteRow(quoteId))!.enquiryId

      await setQuoteStatus({}, form({ quoteId, status: 'sent' }))

      const [row] = await withActor(actor, (tx) =>
        tx.select({ status: enquiries.status }).from(enquiries).where(eq(enquiries.id, enquiryId)),
      )
      expect(row?.status).toBe('quoted')
    })

    /** A double-click is two sends; the customer gets one mail (S17). */
    it('raises one quote.sent however many times Send is pressed at once', async () => {
      const quoteId = await draft()
      const { reference } = (await quoteRow(quoteId))!

      await Promise.all([
        setQuoteStatus({}, form({ quoteId, status: 'sent' })),
        setQuoteStatus({}, form({ quoteId, status: 'sent' })),
      ])

      const events = await withActor(actor, (tx) =>
        tx.execute(
          sql`select 1 from notification_outbox
               where event_key = 'quote.sent' and payload->>'reference' = ${reference}`,
        ),
      )
      expect(events.rows).toHaveLength(1)
    })

    /** Past its last valid day it cannot be sent or accepted (S9). */
    it('refuses to send or accept a lapsed quotation, but lets the customer say no', async () => {
      const quoteId = await draft()
      await setQuoteStatus({}, form({ quoteId, status: 'sent' }))
      await withActor({ ...actor, type: 'system' }, (tx) =>
        tx.update(quotes).set({ validUntil: '2020-01-01' }).where(eq(quotes.id, quoteId)),
      )

      expect((await setQuoteStatus({}, form({ quoteId, status: 'accepted' }))).message).toBe(
        'ledgerValidation.quoteLapsed',
      )
      expect((await quoteRow(quoteId))?.status).toBe('sent')

      await setQuoteStatus({}, form({ quoteId, status: 'rejected' }))
      expect((await quoteRow(quoteId))?.status).toBe('rejected')
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

      expect(state.message).toBe('ledgerValidation.quoteBadTransition')
      expect((await quoteRow(quoteId))?.status).toBe('draft')
    })

    it('asks for something to update', async () => {
      expect((await setQuoteStatus({}, form({}))).errors?._).toBe(
        'ledgerValidation.nothingToUpdate',
      )
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
      descriptionEn: 'Ocean freight',
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

  /*
    F5. The typed amount used to land on the header only: the export builds
    the receivable from lines, so the invoice posted nothing, and the first
    line added afterwards silently replaced the typed figure.
  */
  it('writes the amount as its first line, so the totals are a sum of lines', async () => {
    await createInvoice({}, draft({ subtotal: '250.500', descriptionEn: 'Customs clearance' }))

    const row = await newest()
    const lines = await linesOf(row.id)
    expect(lines).toHaveLength(1)
    expect(lines[0]!.descriptionEn).toBe('Customs clearance')
    expect(Number(lines[0]!.amount)).toBeCloseTo(250.5, 6)
    expect(Number(row.subtotal)).toBeCloseTo(250.5, 6)
  })

  /** F2. A hand-raised foreign invoice carries its rate for the export. */
  it('records the rate a foreign invoice was raised at', async () => {
    await createInvoice({}, draft({ currency: 'USD', subtotal: '100.00', fxRate: '0.307' }))
    expect(Number((await newest()).fxRate)).toBeCloseTo(0.307, 8)
  })

  it('stores rate 1 for an invoice in the branch currency', async () => {
    await createInvoice({}, draft())
    expect(Number((await newest()).fxRate)).toBe(1)
  })

  it('asks for a rate for a foreign invoice with none on file', async () => {
    const state = await createInvoice({}, draft({ currency: UNRATED, subtotal: '100.00' }))
    expect(state.errors?.fxRate).toBe(
      `ledgerValidation.fxRateNeeded:{"currency":"${UNRATED}","base":"KWD"}`,
    )
  })

  it('refuses an invoice for nothing', async () => {
    const state = await createInvoice({}, draft({ subtotal: '0' }))
    expect(state.errors?.subtotal).toBe('ledgerValidation.amountMustBePositive')
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
    /** A draft with no lines yet, at the given tax treatment. */
    async function drafted(fields: Record<string, string> = {}): Promise<string> {
      return withActor(actor, async (tx) => {
        const [row] = await tx
          .insert(invoices)
          .values({
            branchId: BRANCH,
            customerId: CUSTOMER,
            currency: 'KWD',
            taxTreatment: (fields.taxTreatment ?? 'out_of_scope') as 'standard',
            taxRatePercent: fields.taxRatePercent ?? '0',
          })
          .returning({ id: invoices.id })
        return row!.id
      })
    }

    /*
      F4. The line amount was unrounded `qty × price` and tax was rounded to
      six places: this invoice stored 1681.301650, showed 1,681.302, and paying
      the figure shown was refused as more than was owed.
    */
    it('rounds each line, and its tax, to the currency', async () => {
      const invoiceId = await drafted({ taxTreatment: 'standard', taxRatePercent: '5' })

      await addInvoiceLine(
        {},
        form({
          invoiceId,
          descriptionEn: 'Ocean freight',
          quantity: '3',
          unitPrice: '533.746',
          isTaxable: 'on',
        }),
      )

      const [line] = await linesOf(invoiceId)
      expect(line!.amount).toBe('1601.238000')
      expect(line!.taxAmount).toBe('80.062000')
      const [row] = await withActor(actor, (tx) =>
        tx.select().from(invoices).where(eq(invoices.id, invoiceId)),
      )
      expect(row!.total).toBe('1681.300000')
    })

    /** F6. The status was read and ignored, so an issued invoice took new lines. */
    it('refuses a line on an invoice that is no longer a draft', async () => {
      const invoiceId = await draftInvoice('10.000')
      await setInvoiceStatus({}, form({ invoiceId, status: 'approved' }))
      await setInvoiceStatus({}, form({ invoiceId, status: 'issued' }))

      const state = await addInvoiceLine(
        {},
        form({ invoiceId, descriptionEn: 'Late extra', quantity: '1', unitPrice: '5.000' }),
      )

      expect(state.message).toBe('ledgerValidation.invoiceNotDraftNoEdit')
      expect(await linesOf(invoiceId)).toHaveLength(1)
    })

    /** U6. "-1" is a number; being told otherwise sends the clerk hunting a typo. */
    it('says a negative quantity must be more than zero', async () => {
      const state = await addInvoiceLine(
        {},
        form({
          invoiceId: await drafted(),
          descriptionEn: 'Freight',
          quantity: '-1',
          unitPrice: '5.000',
        }),
      )
      expect(state.errors?.quantity).toBe('ledgerValidation.quantityMoreThanZero')
    })

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

/**
 * The covering note — the generative surface behind the evaluation harness.
 *
 * Two rules carry it, and neither is arithmetic. **Drafting goes through the
 * service**, because the web app has no model client — so those tests stub
 * `fetch` and assert the web action's half: it refuses off a draft, it reports
 * a missing model, and it hands the drafted prose back on success. **Saving is
 * a plain textarea**, real against the database, guarded so a note cannot land
 * on a quotation that has just been sent.
 */
describe.skipIf(!enabled)('quotation covering note', () => {
  const RUN = Date.now().toString(36).toUpperCase().slice(-5)
  let seq = 0

  beforeAll(() => {
    harness.session = session
  })

  // The stub and the two env vars are per-test: a leaked `fetch` or a stray
  // SERVICE_URL would make the next test pass or fail for the wrong reason.
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.SERVICE_URL
    delete process.env.INTERNAL_API_SECRET
  })

  /** A fresh draft quotation, returning its id. */
  async function draftQuote(): Promise<string> {
    seq += 1
    const enquiryId = await withActor({ ...actor, type: 'system' }, async (tx) => {
      const [row] = await tx
        .insert(enquiries)
        .values({
          reference: `LGT-CN-${RUN}-${seq}`,
          branchId: BRANCH,
          customerId: CUSTOMER,
          status: 'rating',
          channel: 'email',
          firstRespondedAt: new Date(),
        })
        .returning({ id: enquiries.id })
      return row!.id
    })
    await createQuote(
      {},
      form({
        enquiryId,
        branchId: BRANCH,
        currency: 'USD',
        totalSell: '1000',
        totalCost: '750',
        validUntil: '2035-12-31',
      }),
    )
    const [row] = await withActor(actor, (tx) =>
      tx.select({ id: quotes.id }).from(quotes).where(eq(quotes.enquiryId, enquiryId)).limit(1),
    )
    return row!.id
  }

  const noteOf = async (quoteId: string) => {
    const [row] = await withActor(actor, (tx) =>
      tx
        .select({ en: quotes.coverNoteEn, ar: quotes.coverNoteAr })
        .from(quotes)
        .where(eq(quotes.id, quoteId))
        .limit(1),
    )
    return row!
  }

  describe('setQuoteCoverNote — the textarea a coordinator owns', () => {
    it('saves an English note against the draft', async () => {
      const quoteId = await draftQuote()

      const state = await setQuoteCoverNote(
        {},
        form({ quoteId, locale: 'en', note: 'Dear customer, please find our quotation enclosed.' }),
      )

      expect(state.ok).toBeTruthy()
      const row = await noteOf(quoteId)
      expect(row.en).toBe('Dear customer, please find our quotation enclosed.')
      expect(row.ar).toBeNull()
    })

    /** The two languages are separate columns; saving one leaves the other. */
    it('keeps the languages apart', async () => {
      const quoteId = await draftQuote()

      await setQuoteCoverNote({}, form({ quoteId, locale: 'en', note: 'English note' }))
      await setQuoteCoverNote({}, form({ quoteId, locale: 'ar', note: 'ملاحظة عربية' }))

      const row = await noteOf(quoteId)
      expect(row.en).toBe('English note')
      expect(row.ar).toBe('ملاحظة عربية')
    })

    /** An emptied textarea clears the note rather than storing a blank string. */
    it('stores null when the note is cleared', async () => {
      const quoteId = await draftQuote()
      await setQuoteCoverNote({}, form({ quoteId, locale: 'en', note: 'Something' }))

      await setQuoteCoverNote({}, form({ quoteId, locale: 'en', note: '   ' }))

      expect((await noteOf(quoteId)).en).toBeNull()
    })

    /**
     * A sent quotation is a document the customer is holding. The `where` guards
     * the status in the same statement, so a note cannot appear on a quote that
     * has just been sent out from under the editor.
     */
    it('refuses to touch a note once the quotation is sent', async () => {
      const quoteId = await draftQuote()
      await setQuoteStatus({}, form({ quoteId, status: 'sent' }))

      const state = await setQuoteCoverNote({}, form({ quoteId, locale: 'en', note: 'Too late' }))

      expect(state.message).toBe('ledgerValidation.coverNoteEditDraftOnly')
      expect((await noteOf(quoteId)).en).toBeNull()
    })

    it('rejects a note longer than the column allows', async () => {
      const quoteId = await draftQuote()

      const state = await setQuoteCoverNote(
        {},
        form({ quoteId, locale: 'en', note: 'x'.repeat(1501) }),
      )

      expect(state.errors?.note).toBeTruthy()
    })
  })

  describe('draftQuoteCoverNote — the model, behind the service', () => {
    /** A fetch that answers as the service would, with the drafted prose. */
    const respondWith = (note: string) =>
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ note }) })),
      )

    it('hands back the prose the service drafted', async () => {
      const quoteId = await draftQuote()
      process.env.SERVICE_URL = 'http://service.test'
      process.env.INTERNAL_API_SECRET = 'secret'
      respondWith('We are pleased to enclose our quotation.')

      const state = await draftQuoteCoverNote({}, form({ quoteId, locale: 'en' }))

      expect(state.message).toBeUndefined()
      expect(state.ok).toContain('We are pleased to enclose our quotation.')
      expect(fetch).toHaveBeenCalledOnce()
    })

    /** The draft check runs before the service is ever called. */
    it('refuses to draft once the quotation is sent, without calling the service', async () => {
      const quoteId = await draftQuote()
      await setQuoteStatus({}, form({ quoteId, status: 'sent' }))
      process.env.SERVICE_URL = 'http://service.test'
      process.env.INTERNAL_API_SECRET = 'secret'
      const spy = vi.fn()
      vi.stubGlobal('fetch', spy)

      const state = await draftQuoteCoverNote({}, form({ quoteId, locale: 'en' }))

      expect(state.message).toBe('ledgerValidation.coverNoteDraftOnly')
      expect(spy).not.toHaveBeenCalled()
    })

    /** The service's English is for its log; the code is what gets worded. */
    it('words the service refusal code, never its English', async () => {
      const quoteId = await draftQuote()
      process.env.SERVICE_URL = 'http://service.test'
      process.env.INTERNAL_API_SECRET = 'secret'
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            note: null,
            refusal: 'A covering note can only be drafted on a draft quote.',
            refusalCode: 'not_draft',
          }),
        })),
      )

      const state = await draftQuoteCoverNote({}, form({ quoteId, locale: 'en' }))

      expect(state.message).toBe('ledgerValidation.coverNoteDraftOnly')
    })

    it('falls back to the generic sentence for a code it does not know', async () => {
      const quoteId = await draftQuote()
      process.env.SERVICE_URL = 'http://service.test'
      process.env.INTERNAL_API_SECRET = 'secret'
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          status: 200,
          json: async () => ({ note: null, refusal: 'Something new.', refusalCode: 'brand_new' }),
        })),
      )

      const state = await draftQuoteCoverNote({}, form({ quoteId, locale: 'en' }))

      expect(state.message).toBe('ledgerValidation.nothingDrafted')
    })

    it('explains that no model is configured on a 503', async () => {
      const quoteId = await draftQuote()
      process.env.SERVICE_URL = 'http://service.test'
      process.env.INTERNAL_API_SECRET = 'secret'
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })),
      )

      const state = await draftQuoteCoverNote({}, form({ quoteId, locale: 'en' }))

      expect(state.message).toBe('ledgerValidation.coverNoteNoModel')
    })

    it('falls back to writing by hand when the service is not wired up', async () => {
      const quoteId = await draftQuote()

      const state = await draftQuoteCoverNote({}, form({ quoteId, locale: 'en' }))

      expect(state.message).toMatch(/^ledgerValidation\.coverNote(NeedsService|Failed|TimedOut)$/)
    })

    it('reports a timeout rather than throwing when the service hangs', async () => {
      const quoteId = await draftQuote()
      process.env.SERVICE_URL = 'http://service.test'
      process.env.INTERNAL_API_SECRET = 'secret'
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new Error('aborted')
        }),
      )

      const state = await draftQuoteCoverNote({}, form({ quoteId, locale: 'en' }))

      expect(state.message).toMatch(/^ledgerValidation\.coverNote(TimedOut|NeedsService|Failed)$/)
    })
  })
})
