/**
 * The customer portal's quotations and invoices (D12), against a database.
 *
 * Every claim here is about RLS under a customer contact's own actor, which is
 * a claim about the database and only provable against one: the reads carry
 * no `where customer_id`, so the policy is the only thing standing between one
 * company and another's prices. Two contacts, two companies, one rule each way.
 *
 * And the answers. Accept and Decline run `moveQuote`, the transition the
 * operations screen uses, so the refusals and the outbox row are pinned here
 * from the customer's side.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const harness = vi.hoisted(() => ({ session: null as unknown }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/session', () => ({ requireSession: async () => harness.session }))
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => (key: string) => `${namespace}.${key}`,
}))

const { enquiries, invoiceLines, invoices, notificationOutbox, quoteLines, quotes, withActor } =
  await import('@qabandi/db')
const { AWAY_BRANCH, AWAY_CUSTOMER, CUSTOMER, HOME_BRANCH, PRINCIPAL, bothBranchesActor, world } =
  await import('@/lib/testing/fixtures')
const { getPortalInvoice, getPortalQuote, listPortalInvoices, listPortalQuotes } =
  await import('./queries')
const { decidePortalQuote } = await import('./form-actions')

const RUN = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
const system = { ...bothBranchesActor, type: 'system' as const }

const contact = (principalId: string, customerId: string) => ({
  principalId,
  type: 'customer_contact' as const,
  branchIds: [],
  customerId,
  partnerId: null,
  ip: '203.0.113.7',
})

const mine = contact('00000000-0000-7000-8000-0000000000e5', CUSTOMER)
const theirs = contact('00000000-0000-7000-8000-0000000000e6', AWAY_CUSTOMER)

const sessionFor = (actor: unknown) => ({
  actor,
  principal: { id: 'p', nameEn: 'Portal', nameAr: null, email: 'p@x.test', locale: 'en' },
  permissions: new Set<string>(),
  branchRoles: new Map(),
  branchPermissions: new Map(),
  requiresTwoFactor: false,
})

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

let seq = 0
let chargeTypeId = ''

/** A day relative to today in Kuwait, as the `date` column holds it. */
function dayFromToday(days: number): string {
  const now = new Date(Date.now() + days * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuwait' }).format(now)
}

async function enquiryFor(customerId: string, branchId: string): Promise<string> {
  seq += 1
  return withActor(system, async (tx) => {
    const [row] = await tx
      .insert(enquiries)
      .values({
        reference: `PTL-ENQ-${RUN}-${seq}`,
        branchId,
        customerId,
        mode: 'air',
        tradeDirection: 'import',
      })
      .returning({ id: enquiries.id })
    return row!.id
  })
}

async function quote(
  enquiryId: string,
  branchId: string,
  fields: { status: 'draft' | 'sent' | 'superseded'; version?: number; validUntil?: string },
): Promise<string> {
  seq += 1
  return withActor(system, async (tx) => {
    const [row] = await tx
      .insert(quotes)
      .values({
        reference: `PTL-QTE-${RUN}-${seq}`,
        enquiryId,
        branchId,
        version: fields.version ?? 1,
        status: fields.status,
        currency: 'KWD',
        totalSell: '1150.500',
        totalCost: '953.235',
        validUntil: fields.validUntil ?? dayFromToday(10),
        sentAt: fields.status === 'draft' ? null : new Date(),
      })
      .returning({ id: quotes.id })
    await tx.insert(quoteLines).values({
      quoteId: row!.id,
      chargeTypeId,
      basis: 'flat',
      rate: '1150.500',
      amount: '1150.500',
      currency: 'KWD',
    })
    return row!.id
  })
}

async function invoice(
  customerId: string,
  branchId: string,
  status: 'draft' | 'issued' | 'void',
): Promise<string> {
  seq += 1
  return withActor(system, async (tx) => {
    const [row] = await tx
      .insert(invoices)
      .values({
        branchId,
        customerId,
        status,
        seriesNo: status === 'issued' ? `PTL-${RUN}-${seq}` : null,
        currency: 'KWD',
        subtotal: '500.125',
        taxAmount: '0',
        total: '500.125',
        amountPaid: '200.000',
        issuedAt: status === 'issued' ? new Date('2026-06-01T09:00:00Z') : null,
        dueOn: status === 'issued' ? '2026-07-01' : null,
      })
      .returning({ id: invoices.id })
    await tx.insert(invoiceLines).values({
      invoiceId: row!.id,
      descriptionEn: 'Air freight',
      descriptionAr: 'شحن جوي',
      unitPrice: '500.125',
      amount: '500.125',
    })
    return row!.id
  })
}

async function statusOf(id: string) {
  const [row] = await withActor(system, (tx) =>
    tx
      .select({ status: quotes.status, note: quotes.decisionNote, decidedAt: quotes.decidedAt })
      .from(quotes)
      .where(eq(quotes.id, id)),
  )
  return row!
}

async function outboxFor(enquiryId: string) {
  return withActor(system, (tx) =>
    tx
      .select({ eventKey: notificationOutbox.eventKey, payload: notificationOutbox.payload })
      .from(notificationOutbox)
      .where(
        and(
          eq(notificationOutbox.enquiryId, enquiryId),
          eq(notificationOutbox.branchId, HOME_BRANCH),
        ),
      ),
  )
}

describe.skipIf(!enabled)('the customer portal: quotations and invoices', () => {
  let myEnquiry: string
  let sent: string
  let draft: string
  let replaced: string
  let lapsed: string
  let theirQuote: string
  let myIssued: string
  let myDraftInvoice: string
  let myVoid: string
  let theirInvoice: string

  beforeAll(async () => {
    const built = await world()
    chargeTypeId = built.chargeTypeId

    myEnquiry = await enquiryFor(CUSTOMER, HOME_BRANCH)
    replaced = await quote(myEnquiry, HOME_BRANCH, { status: 'superseded', version: 1 })
    sent = await quote(myEnquiry, HOME_BRANCH, { status: 'sent', version: 2 })
    await withActor(system, (tx) =>
      tx.update(quotes).set({ supersededById: sent }).where(eq(quotes.id, replaced)),
    )
    draft = await quote(await enquiryFor(CUSTOMER, HOME_BRANCH), HOME_BRANCH, { status: 'draft' })
    // Yesterday in Kuwait: the offer stood all of that day and no longer.
    lapsed = await quote(await enquiryFor(CUSTOMER, HOME_BRANCH), HOME_BRANCH, {
      status: 'sent',
      validUntil: dayFromToday(-1),
    })
    theirQuote = await quote(await enquiryFor(AWAY_CUSTOMER, AWAY_BRANCH), AWAY_BRANCH, {
      status: 'sent',
    })

    myIssued = await invoice(CUSTOMER, HOME_BRANCH, 'issued')
    myDraftInvoice = await invoice(CUSTOMER, HOME_BRANCH, 'draft')
    myVoid = await invoice(CUSTOMER, HOME_BRANCH, 'void')
    theirInvoice = await invoice(AWAY_CUSTOMER, AWAY_BRANCH, 'issued')
  })

  describe('reads', () => {
    it('lists only the sent, current quotations of the contact’s own company', async () => {
      const ids = (await listPortalQuotes(mine)).map((q) => q.id)
      expect(ids).toContain(sent)
      expect(ids).toContain(lapsed)
      expect(ids).not.toContain(draft)
      expect(ids).not.toContain(replaced)
      expect(ids).not.toContain(theirQuote)
    })

    it('shows another company’s contact none of them', async () => {
      const ids = (await listPortalQuotes(theirs)).map((q) => q.id)
      expect(ids).toContain(theirQuote)
      for (const id of [sent, lapsed, draft, replaced]) expect(ids).not.toContain(id)
      expect(await getPortalQuote(theirs, sent)).toBeUndefined()
      expect(await getPortalInvoice(theirs, myIssued)).toBeUndefined()
    })

    it('opens a quotation with its lines, sell side only, money as text', async () => {
      const detail = await getPortalQuote(mine, sent)
      expect(detail?.total).toBe('1150.500000')
      expect(detail?.lines).toHaveLength(1)
      expect(detail?.lines[0]?.amount).toBe('1150.500000')
      // No cost, no margin: the projection has no column for them.
      expect(JSON.stringify(detail)).not.toContain('953.235')
      expect(await getPortalQuote(mine, draft)).toBeUndefined()
      expect(await getPortalQuote(mine, replaced)).toBeUndefined()
    })

    it('lists issued invoices only, with the balance worked out in numeric', async () => {
      const rows = await listPortalInvoices(mine)
      const ids = rows.map((row) => row.id)
      expect(ids).toContain(myIssued)
      expect(ids).not.toContain(myDraftInvoice)
      expect(ids).not.toContain(myVoid)
      expect(ids).not.toContain(theirInvoice)
      expect(rows.find((row) => row.id === myIssued)?.balance).toBe('300.125000')

      const detail = await getPortalInvoice(mine, myIssued, 'ar')
      expect(detail?.lines[0]?.description).toBe('شحن جوي')
      expect(await getPortalInvoice(mine, myDraftInvoice)).toBeUndefined()
    })

    it('gives a staff actor nothing through the portal reads (A9)', async () => {
      expect(await listPortalQuotes(bothBranchesActor)).toEqual([])
      expect(await listPortalInvoices(bothBranchesActor)).toEqual([])
      expect(await getPortalQuote(bothBranchesActor, sent)).toBeUndefined()
    })
  })

  describe('answers', () => {
    it('refuses a staff session posting to the portal action', async () => {
      harness.session = sessionFor({ ...bothBranchesActor, principalId: PRINCIPAL })
      const state = await decidePortalQuote({}, form({ quoteId: sent, decision: 'accepted' }))
      expect(state.message).toBe('common.forbiddenAction')
      expect((await statusOf(sent)).status).toBe('sent')
    })

    it('refuses another company’s quotation as not found', async () => {
      harness.session = sessionFor(theirs)
      const state = await decidePortalQuote({}, form({ quoteId: sent, decision: 'accepted' }))
      expect(state.message).toBe('portalQuotes.refusedMissing')
      expect((await statusOf(sent)).status).toBe('sent')
    })

    it('refuses a replaced version and a draft as not found', async () => {
      harness.session = sessionFor(mine)
      for (const id of [replaced, draft]) {
        const state = await decidePortalQuote({}, form({ quoteId: id, decision: 'accepted' }))
        expect(state.message).toBe('portalQuotes.refusedMissing')
      }
    })

    it('refuses to accept or decline an offer whose day has passed', async () => {
      harness.session = sessionFor(mine)
      for (const decision of ['accepted', 'rejected']) {
        const state = await decidePortalQuote({}, form({ quoteId: lapsed, decision }))
        expect(state.message).toBe('portalQuotes.refusedExpired')
      }
      expect((await statusOf(lapsed)).status).toBe('sent')
    })

    it('accepts through the shared transition and tells the branch', async () => {
      harness.session = sessionFor(mine)
      const state = await decidePortalQuote({}, form({ quoteId: sent, decision: 'accepted' }))
      expect(state.ok).toBeTruthy()

      const after = await statusOf(sent)
      expect(after.status).toBe('accepted')
      expect(after.decidedAt).not.toBeNull()

      const events = await outboxFor(myEnquiry)
      expect(events.map((e) => e.eventKey)).toEqual(['quote.accepted'])
      expect(events[0]?.payload).toMatchObject({ total: '1150.500', currency: 'KWD' })
    })

    it('refuses a second answer to a decided quotation', async () => {
      harness.session = sessionFor(mine)
      const state = await decidePortalQuote({}, form({ quoteId: sent, decision: 'rejected' }))
      expect(state.message).toBe('portalQuotes.refusedDecided')
      expect((await statusOf(sent)).status).toBe('accepted')
    })

    it('declines with the reason kept on the quote and in the notice', async () => {
      const enquiryId = await enquiryFor(CUSTOMER, HOME_BRANCH)
      const id = await quote(enquiryId, HOME_BRANCH, { status: 'sent' })
      harness.session = sessionFor(mine)

      const state = await decidePortalQuote(
        {},
        form({ quoteId: id, decision: 'rejected', reason: '  Transit is too long.  ' }),
      )
      expect(state.ok).toBeTruthy()
      const after = await statusOf(id)
      expect(after.status).toBe('rejected')
      expect(after.note).toBe('Transit is too long.')

      const events = await outboxFor(enquiryId)
      expect(events.map((e) => e.eventKey)).toEqual(['quote.declined'])
      expect(events[0]?.payload).toMatchObject({ reason: 'Transit is too long.' })
    })
  })
})
