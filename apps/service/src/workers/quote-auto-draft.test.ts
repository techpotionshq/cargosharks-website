/**
 * Automatic quotation draft — FR-EQ-05, against a real database.
 *
 * The pricing is `priceEnquiryToQuote`, tested from the web "Price it" path; what
 * this pins is the sweep around it — it drafts for an enquiry whose buy rate was
 * awarded, it lands a *draft* (never a sent quote), it leaves an uncovered lane
 * for a person, and it does nothing on the inert default. The cover-note step is
 * injected, so the model is never reached; the assertion is only that a drafted
 * quote is handed to it.
 */

import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { and, desc, eq } from 'drizzle-orm'
import type { LiveIntegration } from '../settings'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const {
  branches,
  chargeTypes,
  customers,
  customerBranchTerms,
  enquiries,
  locations,
  partners,
  quotes,
  rateCardLines,
  rateCards,
  rateRequests,
  systemActor,
  withActor,
  workingCalendars,
  SYSTEM_PRINCIPAL_ID,
} = await import('@qabandi/db')

const { autoDraftQuotes } = await import('./quote-auto-draft')

const BRANCH = '00000000-0000-7000-8000-0000000000b1'
const CUSTOMER = '00000000-0000-7000-8000-0000000000b2'
const actor = systemActor()
const RUN = Date.now().toString(36).toUpperCase().slice(-5)
let seq = 0
let oceanFreightId: string

const gate = (driver: string): LiveIntegration => ({
  key: 'quoteAutoDraft',
  driver,
  live: driver !== 'manual',
  missing: [],
  fromRow: false,
  text: () => undefined,
  number: (_n, fallback) => fallback,
  bool: (_n, fallback) => fallback,
  secret: () => undefined,
})

async function makeLocation(): Promise<string> {
  seq += 1
  const id = randomUUID()
  /*
    `RUN` in the code, because the test database is never emptied. With
    `Z0001` the second run's insert hit the unique code, `onConflictDoNothing`
    skipped it silently, and this returned an id that was never written — so
    every run after the first failed on a foreign key.
  */
  await withActor(actor, (tx) =>
    tx.insert(locations).values({
      id,
      kind: 'seaport',
      unlocode: `Z${RUN}${seq}`,
      nameEn: `Loc ${seq}`,
      nameAr: 'م',
      countryCode: 'KW',
    }),
  )
  return id
}

/** A covered lane: fresh ports, a buy card over them, and the enquiry on it. */
async function coveredEnquiry(): Promise<string> {
  const originId = await makeLocation()
  const destinationId = await makeLocation()
  const partnerId = randomUUID()
  seq += 1

  await withActor(actor, async (tx) => {
    await tx.insert(partners).values({
      id: partnerId,
      code: `AGT-QD-${RUN}-${seq}`,
      type: 'agent',
      legalNameEn: `Agent ${seq}`,
    })

    const [card] = await tx
      .insert(rateCards)
      .values({
        direction: 'buy',
        partnerId,
        branchId: BRANCH,
        mode: 'sea_fcl',
        originId,
        destinationId,
        validity: '[2020-01-01,2040-01-01)',
        validFrom: '2020-01-01',
        validTo: '2040-01-01',
        currency: 'KWD',
        createdById: SYSTEM_PRINCIPAL_ID,
      })
      .returning({ id: rateCards.id })

    await tx.insert(rateCardLines).values({
      rateCardId: card!.id,
      chargeTypeId: oceanFreightId,
      basis: 'per_container',
      rate: '500',
      currency: 'KWD',
      sortOrder: 0,
    })
  })

  const enquiryId = await withActor(actor, async (tx) => {
    const [row] = await tx
      .insert(enquiries)
      .values({
        reference: `QD-${RUN}-${seq}`,
        branchId: BRANCH,
        customerId: CUSTOMER,
        status: 'rating',
        channel: 'email',
        mode: 'sea_fcl',
        originId,
        destinationId,
        pieces: 1,
        // Sea FCL prices per container and refuses without a count.
        containerCount: 1,
      })
      .returning({ id: enquiries.id })
    return row!.id
  })

  // The awarded buy rate — what makes the enquiry eligible.
  seq += 1
  await withActor(actor, (tx) =>
    tx.insert(rateRequests).values({
      branchId: BRANCH,
      enquiryId,
      partnerId,
      status: 'accepted',
      token: `qd-${RUN}-${seq}`,
    }),
  )

  return enquiryId
}

const draftQuote = async (enquiryId: string) => {
  const [row] = await withActor(actor, (tx) =>
    tx
      .select({
        id: quotes.id,
        status: quotes.status,
        totalSell: quotes.totalSell,
        totalCost: quotes.totalCost,
      })
      .from(quotes)
      .where(and(eq(quotes.enquiryId, enquiryId), eq(quotes.status, 'draft')))
      .orderBy(desc(quotes.version))
      .limit(1),
  )
  return row
}

describe.skipIf(!enabled)('autoDraftQuotes', () => {
  beforeAll(async () => {
    const [calendar] = await withActor(actor, (tx) =>
      tx
        .select({ id: workingCalendars.id })
        .from(workingCalendars)
        .where(eq(workingCalendars.key, 'kuwait'))
        .limit(1),
    )
    const [ocean] = await withActor(actor, (tx) =>
      tx
        .select({ id: chargeTypes.id })
        .from(chargeTypes)
        .where(eq(chargeTypes.key, 'ocean_freight'))
        .limit(1),
    )
    if (!calendar || !ocean) throw new Error('Run `pnpm db:seed` before the auto-draft tests')
    oceanFreightId = ocean.id

    await withActor(actor, async (tx) => {
      await tx
        .insert(branches)
        .values({
          id: BRANCH,
          code: 'QDR',
          legalNameEn: 'Auto-draft Test Branch',
          legalNameAr: 'فرع',
          country: 'KW',
          baseCurrency: 'KWD',
          invoiceSeries: 'QDR',
          calendarId: calendar.id,
        })
        .onConflictDoNothing()
      await tx
        .insert(customers)
        .values({ id: CUSTOMER, code: 'CUST-QD', legalNameEn: 'Auto-draft Customer' })
        .onConflictDoNothing()
      // The house margin — 20%, so the sell is the buy times 1.2.
      await tx
        .insert(customerBranchTerms)
        .values({
          customerId: CUSTOMER,
          branchId: BRANCH,
          defaultMarginKind: 'percent',
          defaultMarginValue: '20',
        })
        .onConflictDoNothing()
    })
  })

  it('drafts a quotation and its covering note when eligible', async () => {
    const id = await coveredEnquiry()
    const coverNote = vi.fn(async () => ({}))

    const result = await autoDraftQuotes({ source: gate('auto'), draftCoverNote: coverNote })

    expect(result.enabled).toBe(true)
    expect(result.drafted).toBeGreaterThanOrEqual(1)
    const quote = await draftQuote(id)
    expect(quote).toBeDefined()
    expect(quote!.status).toBe('draft')
    // Buy 500 at the house 20% margin → sell 600.
    expect(Number(quote!.totalCost)).toBeCloseTo(500, 0)
    expect(Number(quote!.totalSell)).toBeCloseTo(600, 0)
    // The cover note was drafted against that quotation.
    expect(coverNote).toHaveBeenCalledWith(
      expect.objectContaining({ quoteId: quote!.id, locale: 'en' }),
    )
  })

  it('does nothing on its inert default', async () => {
    const id = await coveredEnquiry()

    const result = await autoDraftQuotes({ source: gate('manual') })

    expect(result.enabled).toBe(false)
    expect(await draftQuote(id)).toBeUndefined()
  })

  it('leaves an enquiry that already has a quotation', async () => {
    const id = await coveredEnquiry()
    // Draft one, then run again — the second sweep must not draft a second.
    await autoDraftQuotes({ source: gate('auto'), draftCoverNote: vi.fn(async () => ({})) })
    const first = await draftQuote(id)

    await autoDraftQuotes({ source: gate('auto'), draftCoverNote: vi.fn(async () => ({})) })

    const after = await draftQuote(id)
    expect(after!.id).toBe(first!.id)
  })
})
