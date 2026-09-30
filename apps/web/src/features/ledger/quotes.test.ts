/**
 * Quotations and raising an invoice — the half of the ledger before money moves.
 *
 * One rule dominates: **a quote is never edited.** A revision is a new row at
 * the next version and the previous one moves to `superseded`, in the same
 * transaction, so there is never a moment when two versions are both live. A
 * customer holding a printed quotation must be holding a document that still
 * exists, unchanged, in the system (SRS §7).
 *
 * The other property worth pinning is that an invoice's tax and total are
 * computed by PostgreSQL from the subtotal and the rate rather than typed, so
 * the three columns cannot disagree. That is asserted against the stored rows,
 * because a total that is right in the action and wrong in the table is the
 * failure the design exists to prevent.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { desc, eq } from 'drizzle-orm'

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

const { enquiries, invoices, quotes, withActor } = await import('@qabandi/db')

const { CUSTOMER, HOME_BRANCH, AWAY_BRANCH, PRINCIPAL, bothBranchesActor, world } =
  await import('@/lib/testing/fixtures')

const { createQuote, setQuoteStatus, createInvoice } = await import('./form-actions')

const session = {
  actor: bothBranchesActor,
  principal: {
    id: PRINCIPAL,
    nameEn: 'Ledger Quotes',
    nameAr: null,
    email: 'quotes@qabandi.test',
    locale: 'en' as const,
  },
  permissions: new Set([
    'quote.send',
    'quote.accept',
    'quote.reject',
    'quote.revise',
    'invoice.approve',
  ]),
  branchRoles: new Map([
    [HOME_BRANCH, 'sales'],
    [AWAY_BRANCH, 'sales'],
  ]),
  requiresTwoFactor: false,
}

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

let seq = 0

/** An enquiry to quote against — a quote has no customer of its own. */
async function enquiry(): Promise<string> {
  seq += 1
  return withActor(bothBranchesActor, async (tx) => {
    const [row] = await tx
      .insert(enquiries)
      .values({
        reference: `FXH-ENQ-Q-${seq}-${Date.now()}`,
        branchId: HOME_BRANCH,
        customerId: CUSTOMER,
        mode: 'sea_fcl',
        tradeDirection: 'import',
      })
      .returning({ id: enquiries.id })
    return row!.id
  })
}

/** Every version raised against one enquiry, newest first. */
async function versionsOf(enquiryId: string) {
  return withActor(bothBranchesActor, (tx) =>
    tx
      .select({
        id: quotes.id,
        version: quotes.version,
        status: quotes.status,
        reference: quotes.reference,
      })
      .from(quotes)
      .where(eq(quotes.enquiryId, enquiryId))
      .orderBy(desc(quotes.version)),
  )
}

async function draftQuote(enquiryId: string, sell = '600.000', cost = '400.000') {
  return createQuote(
    {},
    form({
      enquiryId,
      branchId: HOME_BRANCH,
      currency: 'KWD',
      totalSell: sell,
      totalCost: cost,
      validUntil: '2026-12-31',
    }),
  )
}

describe.skipIf(!enabled)('quotations', () => {
  beforeAll(async () => {
    await world()
    harness.session = session
  })

  afterAll(() => {
    harness.session = null
  })

  describe('drafting', () => {
    it('creates version one', async () => {
      const enquiryId = await enquiry()
      const state = await draftQuote(enquiryId)

      expect(state.errors).toBeUndefined()
      const versions = await versionsOf(enquiryId)
      expect(versions).toHaveLength(1)
      expect(versions[0]!.version).toBe(1)
      expect(versions[0]!.status).toBe('draft')
    })

    /**
     * The rule the slice exists to keep. Revising raises a *new* row and moves
     * the previous one to `superseded` — never an update in place.
     */
    it('revises by superseding, never by editing', async () => {
      const enquiryId = await enquiry()
      await draftQuote(enquiryId, '600.000')
      const [first] = await versionsOf(enquiryId)

      await draftQuote(enquiryId, '650.000')
      const versions = await versionsOf(enquiryId)

      expect(versions).toHaveLength(2)
      expect(versions[0]!.version).toBe(2)
      // The first row still exists, unchanged in identity, marked superseded.
      const previous = versions.find((v) => v.id === first!.id)
      expect(previous?.status).toBe('superseded')
    })

    it('keeps the reference and marks the revision on it', async () => {
      const enquiryId = await enquiry()
      await draftQuote(enquiryId)
      const [first] = await versionsOf(enquiryId)

      await draftQuote(enquiryId, '700.000')
      const [second] = await versionsOf(enquiryId)

      expect(second!.reference).toBe(`${first!.reference}-v2`)
    })

    /** Selling below cost is a mistake worth stopping before it is sent. */
    it('refuses a price below what it costs', async () => {
      const enquiryId = await enquiry()
      const state = await draftQuote(enquiryId, '100.000', '400.000')

      expect(state.errors?.totalSell).toBe('ledgerValidation.priceBelowCost')
      expect(await versionsOf(enquiryId)).toEqual([])
    })

    it('allows a quote priced exactly at cost', async () => {
      const enquiryId = await enquiry()
      const state = await draftQuote(enquiryId, '400.000', '400.000')
      expect(state.errors).toBeUndefined()
    })

    it('insists on an expiry date', async () => {
      const enquiryId = await enquiry()
      const state = await createQuote(
        {},
        form({
          enquiryId,
          branchId: HOME_BRANCH,
          currency: 'KWD',
          totalSell: '600.000',
          totalCost: '400.000',
        }),
      )
      expect(state.errors?.validUntil).toBeDefined()
    })

    it('reports field errors rather than throwing on a bad form', async () => {
      const state = await createQuote({}, form({ branchId: HOME_BRANCH }))
      expect(state.errors).toBeDefined()
    })

    /** The margin is frozen at pricing time and never recomputed (§6.3). */
    it('freezes the margin into the priced snapshot', async () => {
      const enquiryId = await enquiry()
      await draftQuote(enquiryId, '1000.000', '750.000')

      const [row] = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ snapshot: quotes.pricedSnapshot })
          .from(quotes)
          .where(eq(quotes.enquiryId, enquiryId)),
      )
      const snapshot = row!.snapshot as { marginPct: number; pricedAt: string }
      expect(snapshot.marginPct).toBeCloseTo(25, 2)
      expect(snapshot.pricedAt).toBeTruthy()
    })
  })

  describe('moving a quotation on', () => {
    it('sends a draft', async () => {
      const enquiryId = await enquiry()
      await draftQuote(enquiryId)
      const [quote] = await versionsOf(enquiryId)

      const state = await setQuoteStatus({}, form({ quoteId: quote!.id, status: 'sent' }))

      expect(state.message).toBeUndefined()
      const [after] = await versionsOf(enquiryId)
      expect(after!.status).toBe('sent')
    })

    it('raises the outbox event when it is sent, and only then', async () => {
      const enquiryId = await enquiry()
      await draftQuote(enquiryId)
      const [quote] = await versionsOf(enquiryId)

      const before = await withActor(bothBranchesActor, (tx) =>
        tx.execute(`select count(*)::int as n from notification_outbox
                     where event_key = 'quote.sent'`),
      )
      await setQuoteStatus({}, form({ quoteId: quote!.id, status: 'sent' }))
      const after = await withActor(bothBranchesActor, (tx) =>
        tx.execute(`select count(*)::int as n from notification_outbox
                     where event_key = 'quote.sent'`),
      )

      expect((after.rows[0] as { n: number }).n).toBe((before.rows[0] as { n: number }).n + 1)
    })

    it('accepts a sent quotation', async () => {
      const enquiryId = await enquiry()
      await draftQuote(enquiryId)
      const [quote] = await versionsOf(enquiryId)

      await setQuoteStatus({}, form({ quoteId: quote!.id, status: 'sent' }))
      await setQuoteStatus({}, form({ quoteId: quote!.id, status: 'accepted' }))

      const [after] = await versionsOf(enquiryId)
      expect(after!.status).toBe('accepted')
    })

    /** Straight to accepted skips the step that told the customer. */
    it('refuses a move the machine does not allow', async () => {
      const enquiryId = await enquiry()
      await draftQuote(enquiryId)
      const [quote] = await versionsOf(enquiryId)

      const state = await setQuoteStatus({}, form({ quoteId: quote!.id, status: 'accepted' }))

      expect(state.message).toBe('ledgerValidation.quoteBadTransition')
      const [after] = await versionsOf(enquiryId)
      expect(after!.status).toBe('draft')
    })

    /** `accepted` is terminal — a decision the customer made does not unmake. */
    it('refuses to move an accepted quotation on', async () => {
      const enquiryId = await enquiry()
      await draftQuote(enquiryId)
      const [quote] = await versionsOf(enquiryId)
      await setQuoteStatus({}, form({ quoteId: quote!.id, status: 'sent' }))
      await setQuoteStatus({}, form({ quoteId: quote!.id, status: 'accepted' }))

      const state = await setQuoteStatus({}, form({ quoteId: quote!.id, status: 'rejected' }))

      expect(state.message).toBe('ledgerValidation.quoteBadTransition')
      const [after] = await versionsOf(enquiryId)
      expect(after!.status).toBe('accepted')
    })

    it('says so plainly when nothing was chosen', async () => {
      expect((await setQuoteStatus({}, form({}))).errors).toBeDefined()
    })
  })

  describe('raising an invoice', () => {
    async function invoiceFor(subtotal: string, treatment = 'out_of_scope', rate = '0') {
      const state = await createInvoice(
        {},
        form({
          branchId: HOME_BRANCH,
          customerId: CUSTOMER,
          currency: 'KWD',
          subtotal,
          taxTreatment: treatment,
          taxRatePercent: rate,
          dueOn: '2026-12-31',
          language: 'en',
        }),
      )
      expect(state.errors).toBeUndefined()

      const [row] = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({
            subtotal: invoices.subtotal,
            taxAmount: invoices.taxAmount,
            total: invoices.total,
            status: invoices.status,
          })
          .from(invoices)
          .where(eq(invoices.customerId, CUSTOMER))
          .orderBy(desc(invoices.createdAt))
          .limit(1),
      )
      return row!
    }

    it('raises a draft', async () => {
      const row = await invoiceFor('500.000')
      expect(row.status).toBe('draft')
    })

    /**
     * Tax and total are computed by the database from the subtotal and the
     * rate. A total typed by hand is a total that is eventually wrong.
     */
    it('computes tax and total rather than accepting them', async () => {
      const row = await invoiceFor('200.000', 'standard', '5')

      expect(Number(row.taxAmount)).toBeCloseTo(10, 3)
      expect(Number(row.total)).toBeCloseTo(210, 3)
    })

    /** Out of scope means no tax, whatever rate the form happened to carry. */
    it('charges no tax when the treatment is out of scope', async () => {
      const row = await invoiceFor('200.000', 'out_of_scope', '5')

      expect(Number(row.taxAmount)).toBe(0)
      expect(Number(row.total)).toBeCloseTo(200, 3)
    })

    it('reports field errors rather than throwing on a bad form', async () => {
      const state = await createInvoice({}, form({ branchId: HOME_BRANCH }))
      expect(state.errors).toBeDefined()
    })
  })
})
