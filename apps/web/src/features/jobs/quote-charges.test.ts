/**
 * Booking an accepted quotation carries its money onto the job — D13.
 *
 * Booking used to write the job and its milestones only: revenue and cost of
 * zero, nothing in the unbilled register, every charge retyped before it could
 * be billed. This prices a real quotation off a KWD sell card and an INR buy
 * card from a named partner, accepts it, books it, and follows the money:
 * the job's lines equal the quotation's, the cost sits in the card's currency
 * at the rate it was priced with, the register lists it, booking again adds
 * nothing, and billing the job produces an invoice for the quotation's total.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const harness = vi.hoisted(() => ({ session: null as unknown }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/session', () => ({ requireSession: async () => harness.session }))
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    values ? `${namespace}.${key}:${JSON.stringify(values)}` : `${namespace}.${key}`,
}))

const {
  chargeLines,
  chargeTypes,
  enquiries,
  fxRates,
  invoices,
  jobs,
  locations,
  quoteLines,
  quotes,
  rateCardLines,
  rateCards,
  withActor,
} = await import('@qabandi/db')
const { AWAY_BRANCH, CUSTOMER, HOME_BRANCH, PARTNER, PRINCIPAL, bothBranchesActor, world } =
  await import('@/lib/testing/fixtures')
const { saveJob } = await import('./form-actions')
const { priceEnquiry } = await import('@/features/ledger/pricing')
const { billJob } = await import('@/features/ledger/form-actions')
const { unbilledLinesFor } = await import('@/features/ledger/unbilled')

const session = {
  actor: bothBranchesActor,
  principal: {
    id: PRINCIPAL,
    nameEn: 'Booking Test',
    nameAr: null,
    email: 'booking@qabandi.test',
    locale: 'en' as const,
  },
  permissions: new Set(['job.book', 'job.update', 'quote.send', 'quote.revise', 'invoice.approve']),
  branchRoles: new Map([
    [HOME_BRANCH, 'operations_manager'],
    [AWAY_BRANCH, 'operations_manager'],
  ]),
  requiresTwoFactor: false,
}

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

const RUN = Date.now().toString(36).toUpperCase().slice(-5)
const READY = '2032-03-10'
let oceanFreight: string
let documentation: string

/** A quotation priced off a KWD sell card and an INR buy card, then accepted. */
async function acceptedQuote(): Promise<{ quoteId: string; originId: string; destId: string }> {
  const { originId, destId, enquiryId } = await withActor(bothBranchesActor, async (tx) => {
    const ports = await tx
      .insert(locations)
      .values([
        { nameEn: `Booking Origin ${RUN}`, countryCode: 'IN', kind: 'seaport' },
        { nameEn: `Booking Destination ${RUN}`, countryCode: 'KW', kind: 'seaport' },
      ] as never)
      .returning({ id: locations.id })
    const lane = { originId: ports[0]!.id, destinationId: ports[1]!.id }

    // INR, as the pricing suite uses: the database is shared and never
    // emptied, and a rate in a commoner currency would reach other suites.
    await tx
      .insert(fxRates)
      .values({
        fromCurrency: 'INR',
        toCurrency: 'KWD',
        rate: '0.01000000',
        source: 'pricing-test',
        effectiveOn: new Date().toISOString().slice(0, 10),
      })
      .onConflictDoNothing()

    const card = async (
      direction: 'buy' | 'sell',
      currency: string,
      lines: { chargeTypeId: string; basis: string; rate: string }[],
      over: Record<string, unknown> = {},
    ) => {
      const [row] = await tx
        .insert(rateCards)
        .values({
          direction,
          branchId: HOME_BRANCH,
          mode: 'sea_fcl',
          ...lane,
          currency,
          validFrom: '2032-01-01',
          validTo: '2032-12-31',
          validity: '[2032-01-01,2032-12-31)',
          ...over,
        } as never)
        .returning({ id: rateCards.id })
      for (const [index, line] of lines.entries()) {
        await tx
          .insert(rateCardLines)
          .values({ rateCardId: row!.id, currency, sortOrder: index, ...line } as never)
      }
    }
    await card('sell', 'KWD', [
      { chargeTypeId: oceanFreight, basis: 'per_container', rate: '250.125' },
      { chargeTypeId: documentation, basis: 'flat', rate: '15.500' },
    ])
    await card(
      'buy',
      'INR',
      [
        { chargeTypeId: oceanFreight, basis: 'per_container', rate: '20000.00' },
        { chargeTypeId: documentation, basis: 'flat', rate: '1000.00' },
      ],
      { partnerId: PARTNER },
    )

    const [enquiry] = await tx
      .insert(enquiries)
      .values({
        reference: `FXH-ENQ-BK-${RUN}`,
        branchId: HOME_BRANCH,
        customerId: CUSTOMER,
        mode: 'sea_fcl',
        tradeDirection: 'import',
        ...lane,
        readyOn: READY,
        containerCount: 2,
      })
      .returning({ id: enquiries.id })
    return { originId: lane.originId, destId: lane.destinationId, enquiryId: enquiry!.id }
  })

  const priced = await priceEnquiry({}, form({ enquiryId }))
  expect(priced.message, JSON.stringify(priced)).toBeUndefined()

  const [quote] = await withActor(bothBranchesActor, (tx) =>
    tx.select({ id: quotes.id }).from(quotes).where(eq(quotes.enquiryId, enquiryId)).limit(1),
  )
  await withActor(bothBranchesActor, async (tx) => {
    await tx
      .update(quotes)
      .set({ status: 'accepted', decidedAt: new Date() })
      .where(eq(quotes.id, quote!.id))
    await tx.update(enquiries).set({ status: 'quoted' }).where(eq(enquiries.id, enquiryId))
  })
  return { quoteId: quote!.id, originId, destId }
}

describe.skipIf(!enabled)('booking a quotation carries its charges', () => {
  let quoteId: string
  let jobId: string
  let lane: { originId: string; destinationId: string }

  beforeAll(async () => {
    await world()
    harness.session = session
    await withActor(bothBranchesActor, async (tx) => {
      const rows = await tx
        .select({ id: chargeTypes.id, key: chargeTypes.key })
        .from(chargeTypes)
        .where(sql`${chargeTypes.key} in ('ocean_freight', 'documentation')`)
      oceanFreight = rows.find((r) => r.key === 'ocean_freight')!.id
      documentation = rows.find((r) => r.key === 'documentation')!.id
    })

    const quoted = await acceptedQuote()
    quoteId = quoted.quoteId
    lane = { originId: quoted.originId, destinationId: quoted.destId }
    const state = await saveJob(
      {},
      form({
        branchId: HOME_BRANCH,
        customerId: CUSTOMER,
        mode: 'sea_fcl',
        tradeDirection: 'import',
        status: 'booked',
        originId: quoted.originId,
        destinationId: quoted.destId,
        quoteId,
      }),
    )
    expect(state.errors, JSON.stringify(state)).toBeUndefined()
    const [job] = await withActor(bothBranchesActor, (tx) =>
      tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.quoteId, quoteId)).limit(1),
    )
    jobId = job!.id
  })

  afterAll(() => {
    harness.session = null
  })

  const linesOf = (direction: 'cost' | 'revenue') =>
    withActor(bothBranchesActor, (tx) =>
      tx
        .select()
        .from(chargeLines)
        .where(and(eq(chargeLines.jobId, jobId), eq(chargeLines.direction, direction)))
        .orderBy(chargeLines.createdAt),
    )

  it('writes the quotation’s lines as revenue, figure for figure', async () => {
    const offered = await withActor(bothBranchesActor, (tx) =>
      tx
        .select()
        .from(quoteLines)
        .where(eq(quoteLines.quoteId, quoteId))
        .orderBy(quoteLines.sortOrder),
    )
    const revenue = await linesOf('revenue')
    expect(revenue).toHaveLength(offered.length)
    expect(
      revenue.map((l) => [l.chargeTypeId, l.basis, l.quantity, l.rate, l.amount, l.currency]),
    ).toEqual(
      offered.map((l) => [l.chargeTypeId, l.basis, l.quantity, l.rate, l.amount, l.currency]),
    )
    expect(revenue.every((l) => l.counterpartyCustomerId === CUSTOMER)).toBe(true)
    // 2 × 250.125 + 15.500, three decimals because KWD has three.
    expect(revenue.map((l) => l.amountBase)).toEqual(['500.250000', '15.500000'])
  })

  it('writes the awarded buy side as cost, in the card’s currency, owed to its partner', async () => {
    const cost = await linesOf('cost')
    expect(cost).toHaveLength(2)
    expect(cost.every((l) => l.currency === 'INR' && l.baseCurrency === 'KWD')).toBe(true)
    expect(cost.every((l) => l.counterpartyPartnerId === PARTNER)).toBe(true)
    expect(cost.map((l) => l.fxRate)).toEqual(['0.01000000', '0.01000000'])
    expect(cost.map((l) => l.amount)).toEqual(['40000.000000', '1000.000000'])
    expect(cost.map((l) => l.amountBase)).toEqual(['400.000000', '10.000000'])
  })

  it('totals exactly what the quotation totalled', async () => {
    const [quote] = await withActor(bothBranchesActor, (tx) =>
      tx
        .select({ totalSell: quotes.totalSell, totalCost: quotes.totalCost })
        .from(quotes)
        .where(eq(quotes.id, quoteId)),
    )
    const [sums] = await withActor(bothBranchesActor, (tx) =>
      tx
        .select({
          revenue: sql<string>`sum(amount_base) filter (where direction = 'revenue')::numeric(19,6)::text`,
          cost: sql<string>`sum(amount_base) filter (where direction = 'cost')::numeric(19,6)::text`,
        })
        .from(chargeLines)
        .where(eq(chargeLines.jobId, jobId)),
    )
    expect(sums!.revenue).toBe(quote!.totalSell)
    expect(sums!.cost).toBe(quote!.totalCost)
    expect(sums!.revenue).toBe('515.750000')
  })

  it('appears in the unbilled register', async () => {
    const unbilled = await unbilledLinesFor(bothBranchesActor, jobId)
    expect(unbilled).toHaveLength(2)
  })

  it('cannot be booked a second time, and adds no lines trying', async () => {
    const before = (await linesOf('revenue')).length + (await linesOf('cost')).length
    const again = await saveJob(
      {},
      form({
        branchId: HOME_BRANCH,
        customerId: CUSTOMER,
        mode: 'sea_fcl',
        tradeDirection: 'import',
        status: 'booked',
        ...lane,
        quoteId,
      }),
    )
    expect(again.errors?.quoteId, JSON.stringify(again)).toBeDefined()
    expect(again.errors?.quoteId).toBe('jobsValidation.quoteAlreadyBooked')
    expect((await linesOf('revenue')).length + (await linesOf('cost')).length).toBe(before)
  })

  it('bills into an invoice equal to the quotation', async () => {
    const billed = await billJob({}, form({ jobId }))
    expect(billed.ok, JSON.stringify(billed)).toBeDefined()
    const invoiceId = String(billed.ok).replace(/:\d+$/, '')
    const [invoice] = await withActor(bothBranchesActor, (tx) =>
      tx
        .select({ total: invoices.total, currency: invoices.currency })
        .from(invoices)
        .where(eq(invoices.id, invoiceId)),
    )
    expect(invoice).toEqual({ total: '515.750000', currency: 'KWD' })
    expect(await unbilledLinesFor(bothBranchesActor, jobId)).toHaveLength(0)
  })
})
