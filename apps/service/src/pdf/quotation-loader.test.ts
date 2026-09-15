/**
 * Assembling a quotation out of the quote, its enquiry and the branch.
 *
 * `quotation.test.ts` covers the template as a pure function of a view. This
 * covers the other side, and the faults here are the quiet ones: a lane that
 * silently becomes origin-to-origin, an Arabic conditions column that is
 * fetched from the wrong entity, a revision dated today instead of the day it
 * was sent. Every one of them renders a document that looks entirely correct.
 *
 * The load-bearing case is the last describe below. `quotes.total_cost` sits
 * in the same row as `total_sell`, and the loader must never select it — that
 * is what makes "the margin cannot reach the customer" a property of the code
 * rather than of everybody remembering.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import type { Actor } from '@qabandi/db'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const {
  branches,
  chargeTypes,
  customers,
  enquiries,
  locations,
  principals,
  quoteLines,
  quotes,
  withActor,
  workingCalendars,
} = await import('@qabandi/db')

const { DocumentNotFoundError, loadQuotationView } = await import('./documents')

/* Its own fixtures, distinct from the `db0…` set `job-loaders.test.ts` uses. */
const BRANCH = '00000000-0000-7000-8000-00000000fa01'
const CUSTOMER = '00000000-0000-7000-8000-00000000fa02'
const PRINCIPAL = '00000000-0000-7000-8000-00000000fa03'
const ABSENT = '00000000-0000-7000-8000-00000000fa00'

const actor: Actor = { principalId: PRINCIPAL, type: 'internal', branchIds: [BRANCH] }
const systemActor = { ...actor, type: 'system' as const }

const RUN = Date.now().toString(36).toUpperCase().slice(-5)
let seq = 0
const next = () => (seq += 1)

let SHUWAIKH: string
let JEBEL_ALI: string
let oceanFreightId: string
let enquiryId: string

/**
 * A quote on the shared enquiry, so the lane and Incoterm come from one place.
 *
 * Each one takes the next `version`, because it has to: `unique (enquiry_id,
 * version)` is how the schema states that a quote is never edited and a
 * revision is a new row (FR-RT-08). Fixtures that all defaulted to version 1
 * collided on the second insert — the constraint working exactly as intended.
 */
async function quote(over: Record<string, unknown> = {}): Promise<string> {
  const version = next()
  return withActor(systemActor, async (tx) => {
    const [row] = await tx
      .insert(quotes)
      .values({
        reference: `QT-${RUN}-${version}`,
        enquiryId,
        version,
        branchId: BRANCH,
        currency: 'KWD',
        status: 'sent',
        totalSell: '1284.500',
        /*
          A cost on every fixture, deliberately.

          The point of the last test in this file is that the loader does not
          read it. A fixture with no cost would pass that test whether or not
          the loader was careful.
        */
        totalCost: '990.250',
        preparedById: PRINCIPAL,
        ...over,
      })
      .returning({ id: quotes.id })
    return row!.id
  })
}

const line = (quoteId: string, over: Record<string, unknown> = {}) =>
  withActor(systemActor, (tx) =>
    tx.insert(quoteLines).values({
      quoteId,
      chargeTypeId: oceanFreightId,
      basis: 'per_container',
      quantity: '2',
      rate: '540.000',
      amount: '1080.000',
      currency: 'KWD',
      ...over,
    } as never),
  )

describe.skipIf(!enabled)('assembling a quotation', () => {
  beforeAll(async () => {
    await withActor(systemActor, async (tx) => {
      const [calendar] = await tx
        .select({ id: workingCalendars.id })
        .from(workingCalendars)
        .where(eq(workingCalendars.key, 'kuwait'))
        .limit(1)
      if (!calendar) throw new Error('Run `pnpm db:seed` before this suite')

      const ports = await tx
        .select({ id: locations.id, unlocode: locations.unlocode })
        .from(locations)
        .where(inArray(locations.unlocode, ['KWSWK', 'AEJEA']))
      SHUWAIKH = ports.find((p) => p.unlocode === 'KWSWK')?.id ?? ''
      JEBEL_ALI = ports.find((p) => p.unlocode === 'AEJEA')?.id ?? ''
      if (!SHUWAIKH || !JEBEL_ALI) throw new Error('Run `pnpm db:seed` before this suite')

      const [freight] = await tx
        .select({ id: chargeTypes.id })
        .from(chargeTypes)
        .where(eq(chargeTypes.key, 'ocean_freight'))
        .limit(1)
      if (!freight) throw new Error('Run `pnpm db:seed` before this suite')
      oceanFreightId = freight.id

      await tx
        .insert(principals)
        .values({
          id: PRINCIPAL,
          type: 'internal',
          email: 'quotations@qabandi.test',
          nameEn: 'Quotations Fixture',
        })
        .onConflictDoNothing()

      await tx
        .insert(branches)
        .values({
          id: BRANCH,
          code: 'QTD',
          legalNameEn: 'Quotations Branch Co.',
          legalNameAr: 'فرع عروض الأسعار',
          country: 'KW',
          baseCurrency: 'KWD',
          invoiceSeries: 'QTD',
          taxRegistration: 'KW-TRN-QTD',
          calendarId: calendar.id,
          tradingConditionsEn: 'Subject to our standard trading conditions.',
          tradingConditionsAr: 'تخضع لشروط التعامل العامة لدينا.',
        })
        .onConflictDoUpdate({
          target: branches.id,
          // Re-stated on every run: the columns arrived in 0023, and a database
          // seeded before that has the branch row without them.
          set: {
            tradingConditionsEn: 'Subject to our standard trading conditions.',
            tradingConditionsAr: 'تخضع لشروط التعامل العامة لدينا.',
          },
        })

      await tx
        .insert(customers)
        .values({
          id: CUSTOMER,
          code: 'CUST-QUOTATIONS',
          legalNameEn: 'Quotations Fixture Customer',
          legalNameAr: 'عميل عروض الأسعار',
          primaryBranchId: BRANCH,
        })
        .onConflictDoNothing()

      const [row] = await tx
        .insert(enquiries)
        .values({
          reference: `ENQ-${RUN}-0`,
          branchId: BRANCH,
          customerId: CUSTOMER,
          mode: 'sea_fcl',
          tradeDirection: 'import',
          incoterm: 'CIF',
          originId: JEBEL_ALI,
          destinationId: SHUWAIKH,
        })
        .returning({ id: enquiries.id })
      enquiryId = row!.id
    })
  })

  afterAll(async () => {
    // Closed, so nothing sweeps these enquiries for an SLA breach afterwards.
    if (!enabled) return
    await withActor(systemActor, (tx) =>
      tx
        .update(enquiries)
        .set({ closedAt: new Date(), status: 'won' })
        .where(eq(enquiries.branchId, BRANCH)),
    )
  })

  it('takes the shipment from the enquiry rather than from the quote', async () => {
    const id = await quote()
    const view = await loadQuotationView(actor, id)

    expect(view.mode).toBe('sea_fcl')
    expect(view.incoterm).toBe('CIF')
    expect(view.enquiryReference).toBe(`ENQ-${RUN}-0`)
  })

  /**
   * Both ends of the lane are rows of the same table.
   *
   * Without a separate alias per end, Drizzle emits one `locations` join for
   * both columns and the origin quietly becomes the destination — producing
   * "Shuwaikh → Shuwaikh" on a document that is otherwise perfect.
   */
  it('resolves each end of the lane to its own port', async () => {
    const view = await loadQuotationView(actor, await quote())

    // `toContain`, because the seed names the port rather than the city —
    // "Shuwaikh Port". The assertion that matters is the last one.
    expect(view.originEn).toContain('Jebel Ali')
    expect(view.destinationEn).toContain('Shuwaikh')
    expect(view.originEn).not.toBe(view.destinationEn)
  })

  it('carries both languages of the branch’s trading conditions', async () => {
    const view = await loadQuotationView(actor, await quote())

    expect(view.tradingConditionsEn).toContain('standard trading conditions')
    expect(view.tradingConditionsAr).toContain('شروط التعامل')
  })

  it('reads the lines in the order they were priced', async () => {
    const id = await quote()
    await line(id, {
      sortOrder: 2,
      amount: '204.500',
      rate: '204.500',
      basis: 'flat',
      quantity: '1',
    })
    await line(id, { sortOrder: 1 })

    const view = await loadQuotationView(actor, id)

    // `numeric(19,6)` comes back at its full scale, not the scale it went in at.
    expect(view.lines.map((l) => l.amount)).toEqual(['1080.000000', '204.500000'])
    expect(view.lines[0]!.chargeNameEn).toBe('Ocean Freight')
  })

  describe('the date it carries', () => {
    /**
     * A reprint must show the day the customer was given it.
     *
     * The validity was counted from that date, so a reprint that redates
     * itself silently extends an offer that has already lapsed.
     */
    it('is the day it was sent, where it has been', async () => {
      const sentAt = new Date('2026-03-04T08:00:00Z')
      const view = await loadQuotationView(actor, await quote({ sentAt }))

      expect(view.issuedAt.toISOString()).toBe(sentAt.toISOString())
    })

    it('falls back to when it was drafted', async () => {
      const view = await loadQuotationView(actor, await quote({ status: 'draft', sentAt: null }))

      expect(view.issuedAt).toBeInstanceOf(Date)
    })
  })

  describe('the priced snapshot', () => {
    it('yields the notes, inclusions and exclusions', async () => {
      const id = await quote({
        pricedSnapshot: {
          notes: 'Space subject to confirmation',
          inclusions: ['Ocean freight'],
          exclusions: ['Duties and taxes'],
          transitDays: 4,
        },
      })

      const view = await loadQuotationView(actor, id)

      expect(view.notes).toBe('Space subject to confirmation')
      expect(view.inclusions).toEqual(['Ocean freight'])
      expect(view.exclusions).toEqual(['Duties and taxes'])
      expect(view.transitDays).toBe(4)
    })

    /** `priced_snapshot` is operator-shaped JSON, so nothing in it is trusted. */
    it('ignores anything in it that is not the shape expected', async () => {
      const id = await quote({
        pricedSnapshot: { inclusions: 'not a list', exclusions: [1, 'Duties', null], notes: 42 },
      })

      const view = await loadQuotationView(actor, id)

      expect(view.inclusions).toEqual([])
      expect(view.exclusions).toEqual(['Duties'])
      expect(view.notes).toBeNull()
    })

    it('copes with no snapshot at all', async () => {
      const view = await loadQuotationView(actor, await quote({ pricedSnapshot: null }))

      expect(view.inclusions).toEqual([])
      expect(view.exclusions).toEqual([])
      expect(view.notes).toBeNull()
      expect(view.transitDays).toBeNull()
    })
  })

  /**
   * Invisible rather than forbidden — FR-ID-04.
   *
   * Row-level security makes a quote outside the principal's branches absent
   * from the query rather than refused, so reporting it as a permission error
   * would confirm that it exists.
   */
  it('is not found rather than forbidden when it is out of reach', async () => {
    await expect(loadQuotationView(actor, ABSENT)).rejects.toThrow(DocumentNotFoundError)
  })

  /**
   * The reason `QuotationView` is narrower than the row it comes from.
   *
   * Every fixture above carries `total_cost: 990.250`. If the loader ever
   * selects it, it arrives in the view and from there onto a customer's
   * document — so this asserts on the whole serialised view rather than on a
   * named field, because the field it must not have is one nobody declared.
   */
  it('never carries the buy side', async () => {
    const id = await quote()
    await line(id)

    const view = await loadQuotationView(actor, id)

    expect(view.total).toBe('1284.500000')
    // Prefix rather than the exact string: the column returns six decimals, and
    // a guard written against three would pass while the cost sat in the view.
    expect(JSON.stringify(view)).not.toContain('990.25')
    expect(JSON.stringify(view)).not.toMatch(/cost/i)
  })
})
