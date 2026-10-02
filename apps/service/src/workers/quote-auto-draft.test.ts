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
  priceEnquiryToQuote,
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
let haulageId: string

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

/** An agent and a one-line buy card from it over a lane; returns the card. */
async function buyCard(
  originId: string,
  destinationId: string,
  rate: string,
  validFrom: string,
  partnerId: string = randomUUID(),
): Promise<{ partnerId: string; cardId: string }> {
  seq += 1

  const cardId = await withActor(actor, async (tx) => {
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
        validity: `[${validFrom},2040-01-01)`,
        validFrom,
        validTo: '2040-01-01',
        currency: 'KWD',
        createdById: SYSTEM_PRINCIPAL_ID,
      })
      .returning({ id: rateCards.id })

    await tx.insert(rateCardLines).values({
      rateCardId: card!.id,
      chargeTypeId: oceanFreightId,
      basis: 'per_container',
      rate,
      currency: 'KWD',
      sortOrder: 0,
    })
    return card!.id
  })

  return { partnerId, cardId }
}

/** A sell card over a lane, one line per charge given — the price, not a margin. */
async function sellCard(
  originId: string,
  destinationId: string,
  lines: readonly { chargeTypeId: string; rate: string }[],
): Promise<void> {
  await withActor(actor, async (tx) => {
    const [card] = await tx
      .insert(rateCards)
      .values({
        direction: 'sell',
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
    await tx.insert(rateCardLines).values(
      lines.map((line, index) => ({
        rateCardId: card!.id,
        chargeTypeId: line.chargeTypeId,
        basis: 'per_container' as const,
        rate: line.rate,
        currency: 'KWD',
        sortOrder: index,
      })),
    )
  })
}

/**
 * A partner id that sorts before any random one.
 *
 * The lane lookup orders agents' cards by `partner_id` before `valid_from` —
 * the uuid itself, which is the arbitrary tie-break F67 was about. Giving the
 * rival the lowest id makes it the card the lookup would take without the
 * award, every run, rather than on the toss of two random uuids.
 */
const lowestPartnerId = () => `00000000-0000-4000-8000-${randomUUID().slice(-12)}`

/**
 * A covered lane: fresh ports, a buy card over them, and the enquiry on it.
 *
 * With `rival`, a second agent's cheaper card, which sorts first, covers the same lane
 * and the award names the first card — the shape of QUO-2026-00004 (F67),
 * where the lane lookup alone would pick the rival.
 */
async function coveredEnquiry(
  options: { rival?: boolean; sell?: readonly { chargeTypeId: string; rate: string }[] } = {},
): Promise<string> {
  const originId = await makeLocation()
  const destinationId = await makeLocation()
  const awardedCard = await buyCard(originId, destinationId, '500', '2020-01-01')
  if (options.sell) await sellCard(originId, destinationId, options.sell)
  const partnerId = awardedCard.partnerId
  if (options.rival) {
    await buyCard(originId, destinationId, '300', '2021-01-01', lowestPartnerId())
  }

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
      // Only the rival test depends on this link; the others price the one
      // card on the lane either way.
      rateCardId: options.rival ? awardedCard.cardId : null,
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
    const [haulage] = await withActor(actor, (tx) =>
      tx
        .select({ id: chargeTypes.id })
        .from(chargeTypes)
        .where(eq(chargeTypes.key, 'haulage'))
        .limit(1),
    )
    if (!calendar || !ocean || !haulage) {
      throw new Error('Run `pnpm db:seed` before the auto-draft tests')
    }
    oceanFreightId = ocean.id
    haulageId = haulage.id

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

  it('costs the quotation off the awarded card, not a cheaper one on the lane', async () => {
    const id = await coveredEnquiry({ rival: true })

    await autoDraftQuotes({ source: gate('auto'), draftCoverNote: vi.fn(async () => ({})) })

    const quote = await draftQuote(id)
    expect(quote).toBeDefined()
    // The awarded 500, marked up 20% — not the rival's 300 → 360.
    expect(quote!.totalCost).toBe('500.000000')
    expect(quote!.totalSell).toBe('600.000000')
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

  /**
   * The race the eligibility read cannot see: a coordinator prices the
   * enquiry after the sweep listed it. The sweep asks for a first quotation
   * only, so it refuses rather than superseding the person's draft (S19).
   */
  it('never supersedes a quotation somebody wrote after the sweep looked', async () => {
    const id = await coveredEnquiry()
    const first = await withActor(actor, (tx) => priceEnquiryToQuote(tx, id, SYSTEM_PRINCIPAL_ID))

    const second = await withActor(actor, (tx) =>
      priceEnquiryToQuote(tx, id, SYSTEM_PRINCIPAL_ID, { firstOnly: true }),
    )

    expect('reference' in first).toBe(true)
    expect(second).toEqual({ error: 'already_quoted' })
  })

  /*
    ai-13: a sell card that sells what the awarded rate never quoted — haulage
    on a port-to-port award — and freight below the agent's figure. The draft
    is still written, as the coordinator's starting point, but marked for
    review with both reasons frozen into its snapshot.
  */
  it('marks a draft for review when a charge sells below cost or was never bought', async () => {
    const id = await coveredEnquiry({
      sell: [
        { chargeTypeId: oceanFreightId, rate: '450' },
        { chargeTypeId: haulageId, rate: '120' },
      ],
    })

    const result = await autoDraftQuotes({
      source: gate('auto'),
      draftCoverNote: vi.fn(async () => ({})),
    })

    expect(result.flagged).toBeGreaterThanOrEqual(1)
    const [row] = await withActor(actor, (tx) =>
      tx
        .select({ snapshot: quotes.pricedSnapshot, status: quotes.status })
        .from(quotes)
        .where(eq(quotes.enquiryId, id))
        .limit(1),
    )
    expect(row!.status).toBe('draft')
    expect(row!.snapshot!.review).toEqual({
      needed: true,
      concerns: [
        {
          kind: 'negative_margin',
          chargeTypeKey: 'ocean_freight',
          sell: '450',
          cost: '500',
          marginPercent: '-11.1',
        },
        { kind: 'unbacked_charge', chargeTypeKey: 'haulage' },
      ],
    })
  })

  it('does not mark a draft priced at the house margin off the awarded rate', async () => {
    const id = await coveredEnquiry()
    await autoDraftQuotes({ source: gate('auto'), draftCoverNote: vi.fn(async () => ({})) })
    const [row] = await withActor(actor, (tx) =>
      tx
        .select({ snapshot: quotes.pricedSnapshot })
        .from(quotes)
        .where(eq(quotes.enquiryId, id))
        .limit(1),
    )
    expect(row!.snapshot!.review).toEqual({ needed: false, concerns: [] })
  })
})
