/**
 * The two notifications nobody clicks.
 *
 * Nine events are required and seven happen because somebody does something —
 * a quote is sent, a milestone is ticked. These two happen because *time
 * passes*, which is why they were the two that were missing: an event with no
 * button has no obvious place to live, so it ends up with no place at all. It
 * is also why they are worth testing. Nothing calls them from a screen, so a
 * quote-expiry warning that stopped firing would look exactly like a month
 * with no quotes about to lapse.
 *
 * **Neither one nags.** Each fires once per quote and per invoice, and that is
 * a deliberate limit rather than an unfinished feature. A quotation chased
 * twice has been answered by silence. Automated dunning is worse: a customer
 * who has already telephoned about a payment and then receives a weekly demand
 * learns that nobody in the building reads their own system. Chasing money is
 * a finance decision about a relationship, and the ageing report already puts
 * that list in front of the person who should be making it.
 *
 * **Idempotent against the outbox, not against a flag.** There is no
 * `warned_at` column here and adding one would store a fact already recorded —
 * the outbox *is* the log of what has been announced. So the test for "does
 * not nag" is the same test as "survives a restart mid-run", which is the
 * point of doing it that way.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, isNotNull } from 'drizzle-orm'
import type { Actor } from '@qabandi/db'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const {
  branches,
  customers,
  enquiries,
  invoices,
  notificationOutbox,
  principals,
  quotes,
  withActor,
  workingCalendars,
} = await import('@qabandi/db')

const { runQuoteExpiryWarnings, runInvoiceOverdueNotices } = await import('./commercial-reminders')

const BRANCH = '00000000-0000-7000-8000-00000000ba01'
const CUSTOMER = '00000000-0000-7000-8000-00000000ba02'
const PRINCIPAL = '00000000-0000-7000-8000-00000000ba03'

const actor: Actor = { principalId: PRINCIPAL, type: 'internal', branchIds: [BRANCH] }
const systemActor = { ...actor, type: 'system' as const }

const RUN = Date.now().toString(36).toUpperCase().slice(-5)
let seq = 0

/** Midday, so a date in the test is the same date the worker sees. */
const at = (iso: string) => new Date(`${iso}T12:00:00Z`)

/**
 * A sent quotation with a validity to run out, on an enquiry of its own.
 *
 * `quotes_version_unique` is (enquiry, version) — a revision is a new row at
 * the next version, which is the rule the ledger slice exists to keep. Sharing
 * one enquiry across the file therefore means every run after the first
 * collides on version one, so each quotation gets its own enquiry instead.
 */
async function quote(over: Record<string, unknown> = {}): Promise<string> {
  seq += 1
  const reference = `CRM-QUO-${RUN}-${seq}`
  await withActor(systemActor, async (tx) => {
    const [enquiry] = await tx
      .insert(enquiries)
      .values({
        reference: `CRM-ENQ-${RUN}-${seq}`,
        branchId: BRANCH,
        customerId: CUSTOMER,
        channel: 'email',
        mode: 'sea_fcl',
        tradeDirection: 'import',
      })
      .returning({ id: enquiries.id })

    await tx.insert(quotes).values({
      reference,
      enquiryId: enquiry!.id,
      branchId: BRANCH,
      status: 'sent',
      currency: 'KWD',
      totalSell: '600.000',
      totalCost: '400.000',
      validUntil: '2036-03-10',
      ...over,
    })
  })
  return reference
}

/** An issued invoice with a due date to fall behind. */
async function invoice(over: Record<string, unknown> = {}): Promise<string> {
  seq += 1
  const seriesNo = `CRM-INV-${RUN}-${seq}`
  await withActor(systemActor, (tx) =>
    tx.insert(invoices).values({
      branchId: BRANCH,
      customerId: CUSTOMER,
      seriesNo,
      status: 'issued',
      currency: 'KWD',
      subtotal: '500.000',
      taxAmount: '0.000',
      total: '500.000',
      taxTreatment: 'out_of_scope',
      issuedAt: at('2036-02-01'),
      dueOn: '2036-02-20',
      ...over,
    }),
  )
  return seriesNo
}

/** The rows announced for one reference — there must be at most one. */
async function announced(eventKey: string, field: string, value: string) {
  const rows = await withActor(actor, (tx) =>
    tx
      .select({ payload: notificationOutbox.payload, branchId: notificationOutbox.branchId })
      .from(notificationOutbox)
      .where(eq(notificationOutbox.eventKey, eventKey)),
  )
  return rows.filter((row) => (row.payload as Record<string, unknown>)[field] === value)
}

describe.skipIf(!enabled)('the reminders nobody clicks', () => {
  beforeAll(async () => {
    await withActor(systemActor, async (tx) => {
      const [calendar] = await tx
        .select({ id: workingCalendars.id })
        .from(workingCalendars)
        .where(eq(workingCalendars.key, 'kuwait'))
        .limit(1)
      if (!calendar) throw new Error('Run `pnpm db:seed` before this suite')

      await tx
        .insert(principals)
        .values({
          id: PRINCIPAL,
          type: 'internal',
          email: 'reminders-fixture@qabandi.test',
          nameEn: 'Reminders Fixture',
        })
        .onConflictDoNothing()

      await tx
        .insert(branches)
        .values({
          id: BRANCH,
          code: 'RMD',
          legalNameEn: 'Reminders Branch',
          legalNameAr: 'فرع التذكيرات',
          country: 'KW',
          baseCurrency: 'KWD',
          invoiceSeries: 'RMD',
          calendarId: calendar.id,
        })
        .onConflictDoNothing()

      await tx
        .insert(customers)
        .values({
          id: CUSTOMER,
          code: 'CUST-REMINDERS',
          legalNameEn: 'Reminders Fixture Customer',
          primaryBranchId: BRANCH,
        })
        .onConflictDoNothing()

    })
  })

  afterAll(async () => {
    /*
      Settled and decided, so a later run does not re-announce this one's rows.
      Nothing is deleted (§5.5) — the outbox rows stay, which is exactly what
      makes the workers idempotent, so the subjects are what must move on.
    */
    if (!enabled) return
    await withActor(systemActor, async (tx) => {
      await tx.update(quotes).set({ status: 'rejected' }).where(eq(quotes.branchId, BRANCH))
      await tx
        .update(invoices)
        .set({ status: 'paid', amountPaid: '500.000' })
        // A draft carries no series number, and `invoices_series_when_issued`
        // refuses to move it past draft.
        .where(and(eq(invoices.branchId, BRANCH), isNotNull(invoices.seriesNo)))
    })
  })

  describe('a quotation running out', () => {
    /** Three days' notice — long enough to telephone, short enough to matter. */
    it('warns about one inside the window', async () => {
      const reference = await quote({ validUntil: '2036-03-10' })

      const result = await runQuoteExpiryWarnings(at('2036-03-08'))

      expect(result.raised).toBeGreaterThan(0)
      expect(await announced('quote.expiring', 'reference', reference)).toHaveLength(1)
    })

    it('says how long is left, and until when', async () => {
      const reference = await quote({ validUntil: '2036-03-10' })

      await runQuoteExpiryWarnings(at('2036-03-08'))

      const [raised] = await announced('quote.expiring', 'reference', reference)
      const payload = raised!.payload as { validUntil: string; daysRemaining: number }
      expect(payload.validUntil).toBe('2036-03-10')
      expect(payload.daysRemaining).toBe(2)
      expect(raised!.branchId).toBe(BRANCH)
    })

    it('says nothing about one with weeks left on it', async () => {
      const reference = await quote({ validUntil: '2036-06-30' })

      await runQuoteExpiryWarnings(at('2036-03-08'))

      expect(await announced('quote.expiring', 'reference', reference)).toEqual([])
    })

    /** A quotation that expired last week needs a conversation, not a countdown. */
    it('says nothing about one that has already lapsed', async () => {
      const reference = await quote({ validUntil: '2036-03-01' })

      await runQuoteExpiryWarnings(at('2036-03-08'))

      expect(await announced('quote.expiring', 'reference', reference)).toEqual([])
    })

    /** A draft has not been offered to anyone. */
    it('says nothing about a draft', async () => {
      const reference = await quote({ status: 'draft', validUntil: '2036-03-10' })

      await runQuoteExpiryWarnings(at('2036-03-08'))

      expect(await announced('quote.expiring', 'reference', reference)).toEqual([])
    })

    /** An accepted quotation has already had its answer. */
    it('says nothing about one that has been decided', async () => {
      const reference = await quote({ status: 'accepted', validUntil: '2036-03-10' })

      await runQuoteExpiryWarnings(at('2036-03-08'))

      expect(await announced('quote.expiring', 'reference', reference)).toEqual([])
    })

    it('says nothing about one with no validity at all', async () => {
      const reference = await quote({ validUntil: null })

      await runQuoteExpiryWarnings(at('2036-03-08'))

      expect(await announced('quote.expiring', 'reference', reference)).toEqual([])
    })

    /**
     * Once. A quotation chased twice has been answered by silence, and this is
     * also the restart test — the outbox is the log, so a service that died
     * mid-run cannot produce a second message on the way back up.
     */
    it('warns once and not again the next night', async () => {
      const reference = await quote({ validUntil: '2036-03-10' })

      await runQuoteExpiryWarnings(at('2036-03-08'))
      await runQuoteExpiryWarnings(at('2036-03-09'))

      expect(await announced('quote.expiring', 'reference', reference)).toHaveLength(1)
    })
  })

  describe('an invoice falling behind', () => {
    it('notices one past its due date', async () => {
      const seriesNo = await invoice({ dueOn: '2036-02-20' })

      const result = await runInvoiceOverdueNotices(at('2036-03-08'))

      expect(result.raised).toBeGreaterThan(0)
      expect(await announced('invoice.overdue', 'seriesNo', seriesNo)).toHaveLength(1)
    })

    /**
     * What is *outstanding*, not what was invoiced. Asking a customer for the
     * full amount of an invoice they have part paid is the fastest way to have
     * the whole balance disputed.
     */
    it('asks for what is left, not for what was billed', async () => {
      const seriesNo = await invoice({
        status: 'part_paid',
        amountPaid: '200.000',
        dueOn: '2036-02-20',
      })

      await runInvoiceOverdueNotices(at('2036-03-08'))

      const [raised] = await announced('invoice.overdue', 'seriesNo', seriesNo)
      const payload = raised!.payload as { total: string; currency: string; daysOverdue: number }
      expect(Number(payload.total)).toBeCloseTo(300, 3)
      expect(payload.currency).toBe('KWD')
      expect(payload.daysOverdue).toBeGreaterThan(0)
    })

    /**
     * A part-paid invoice a month late is exactly the one worth a note, and
     * treating it as paid because *something* arrived is how a balance quietly
     * ages out of anybody's view.
     */
    it('counts a part-paid invoice as still owing', async () => {
      const seriesNo = await invoice({
        status: 'part_paid',
        amountPaid: '1.000',
        dueOn: '2036-02-20',
      })

      await runInvoiceOverdueNotices(at('2036-03-08'))

      expect(await announced('invoice.overdue', 'seriesNo', seriesNo)).toHaveLength(1)
    })

    it('says nothing about one that has been settled', async () => {
      const seriesNo = await invoice({
        status: 'paid',
        amountPaid: '500.000',
        dueOn: '2036-02-20',
      })

      await runInvoiceOverdueNotices(at('2036-03-08'))

      expect(await announced('invoice.overdue', 'seriesNo', seriesNo)).toEqual([])
    })

    it('says nothing about a draft nobody sent', async () => {
      const seriesNo = await invoice({ status: 'draft', seriesNo: null, dueOn: '2036-02-20' })

      await runInvoiceOverdueNotices(at('2036-03-08'))

      expect(await announced('invoice.overdue', 'seriesNo', seriesNo)).toEqual([])
    })

    it('says nothing about one that is not due yet', async () => {
      const seriesNo = await invoice({ dueOn: '2036-06-30' })

      await runInvoiceOverdueNotices(at('2036-03-08'))

      expect(await announced('invoice.overdue', 'seriesNo', seriesNo)).toEqual([])
    })

    /** A day's grace, so an invoice due today is not chased this evening. */
    it('leaves a day’s grace before it chases', async () => {
      const seriesNo = await invoice({ dueOn: '2036-03-08' })

      await runInvoiceOverdueNotices(at('2036-03-08'))

      expect(await announced('invoice.overdue', 'seriesNo', seriesNo)).toEqual([])
    })

    it('says nothing about one with no due date', async () => {
      const seriesNo = await invoice({ dueOn: null })

      await runInvoiceOverdueNotices(at('2036-03-08'))

      expect(await announced('invoice.overdue', 'seriesNo', seriesNo)).toEqual([])
    })

    /**
     * The one that matters most. A customer who has already telephoned about a
     * payment and then receives a weekly demand learns that nobody in the
     * building reads their own system.
     */
    it('chases once and never again', async () => {
      const seriesNo = await invoice({ dueOn: '2036-02-20' })

      await runInvoiceOverdueNotices(at('2036-03-08'))
      await runInvoiceOverdueNotices(at('2036-03-15'))
      await runInvoiceOverdueNotices(at('2036-04-01'))

      expect(await announced('invoice.overdue', 'seriesNo', seriesNo)).toHaveLength(1)
    })
  })
})
