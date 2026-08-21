/**
 * Instant pricing — FR-EQ-05, FR-RT-01…06.
 *
 * The arithmetic is covered exhaustively in `packages/core`, against no
 * infrastructure. What is asserted here is everything between the rate card
 * row and the quotation: which card is chosen, what the consignment is
 * measured as, and what ends up frozen on the quote. Those are the parts that
 * cannot be wrong quietly — a quotation with the right shape and the wrong
 * number looks exactly like a correct one.
 *
 * Three properties get disproportionate attention, because each is a way of
 * charging the wrong customer the wrong amount:
 *
 * **The right card.** A customer's negotiated tariff must price their
 * shipments and nobody else's, a superseded card must price nothing at all,
 * and the date asked about is the readiness date rather than today.
 *
 * **The right quantity.** Air is billed on chargeable weight from
 * `chargeable_rules`, and a weight break may bill *more* kilos than the
 * shipment weighs because declaring up to the band is cheaper.
 *
 * **The whole decision, frozen.** `priced_snapshot` has to carry enough to
 * reconcile a June invoice against a March booking — the divisor, the FX rate,
 * the margin rule, the cards used.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq, sql } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const harness = vi.hoisted(() => ({ session: null as unknown }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/session', () => ({ requireSession: async () => harness.session }))

const {
  chargeTypes,
  customerBranchTerms,
  enquiries,
  locations,
  quoteLines,
  quotes,
  rateCardLines,
  rateCards,
  withActor,
} = await import('@qabandi/db')

const { CUSTOMER, AWAY_CUSTOMER, HOME_BRANCH, AWAY_BRANCH, PRINCIPAL, bothBranchesActor, world } =
  await import('@/lib/testing/fixtures')

const { priceEnquiry } = await import('./pricing')

const session = {
  actor: bothBranchesActor,
  principal: {
    id: PRINCIPAL,
    nameEn: 'Pricing Test',
    nameAr: null,
    email: 'pricing@qabandi.test',
    locale: 'en' as const,
  },
  /*
    Both keys. Raising the first quotation is `quote.send`; pricing the same
    enquiry again withdraws a quotation the customer is holding, which is
    `quote.revise` — the machine declares it on `sent → superseded` and the
    revision test below is the one that exercises it.
  */
  permissions: new Set(['quote.send', 'quote.revise']),
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

const RUN = Date.now().toString(36).toUpperCase().slice(-5)
let seq = 0
const next = () => (seq += 1)

let oceanFreight: string
let documentation: string

/** Far enough out that no seeded card can also cover it. */
const READY = '2031-04-15'

/**
 * Every test gets a lane of its own, and it has to.
 *
 * `rate_cards_no_overlap` forbids two cards for the same
 * `(direction, partner, customer, mode, lane)` whose validity ranges overlap —
 * and it has no predicate on `superseded_by_id`, so retiring a card does not
 * give its window back. That is the schema being right: a renewal starts where
 * the old card ends (`listExpiringRateCards` looks for exactly that), and two
 * live cards for one lane would make "the valid rate" ambiguous.
 *
 * It does mean a suite that reuses one lane can run once. Fresh ports per test
 * cost two inserts and make the file re-runnable for ever, which is worth more
 * than the rows. `unlocode` is left null — the unique index treats nulls as
 * distinct, so invented codes are not needed either.
 */
async function lane(): Promise<{ originId: string; destinationId: string }> {
  const n = next()
  return withActor(bothBranchesActor, async (tx) => {
    const rows = await tx
      .insert(locations)
      .values([
        { nameEn: `Pricing Origin ${RUN}-${n}`, countryCode: 'KW', kind: 'seaport' },
        { nameEn: `Pricing Destination ${RUN}-${n}`, countryCode: 'AE', kind: 'seaport' },
      ] as never)
      .returning({ id: locations.id })
    return { originId: rows[0]!.id, destinationId: rows[1]!.id }
  })
}

interface Lane {
  readonly originId: string
  readonly destinationId: string
}

async function enquiry(on: Lane, over: Record<string, unknown> = {}): Promise<string> {
  return withActor(bothBranchesActor, async (tx) => {
    const [row] = await tx
      .insert(enquiries)
      .values({
        reference: `FXH-ENQ-P-${RUN}-${next()}`,
        branchId: HOME_BRANCH,
        customerId: CUSTOMER,
        mode: 'sea_fcl',
        tradeDirection: 'import',
        originId: on.originId,
        destinationId: on.destinationId,
        readyOn: READY,
        pieces: 2,
        ...over,
      })
      .returning({ id: enquiries.id })
    return row!.id
  })
}

/**
 * A card covering the given lane, with its lines.
 *
 * `validity` is a `daterange` written by SQL — Drizzle has no range type, so
 * the column is set explicitly rather than derived from the two date columns.
 */
async function card(
  on: Lane,
  direction: 'buy' | 'sell',
  lines: Record<string, unknown>[],
  over: Record<string, unknown> = {},
): Promise<string> {
  return withActor(bothBranchesActor, async (tx) => {
    const [row] = await tx
      .insert(rateCards)
      .values({
        direction,
        branchId: HOME_BRANCH,
        mode: 'sea_fcl',
        originId: on.originId,
        destinationId: on.destinationId,
        currency: 'KWD',
        validFrom: '2031-01-01',
        validTo: '2031-12-31',
        validity: '[2031-01-01,2031-12-31)',
        ...over,
      } as never)
      .returning({ id: rateCards.id })

    for (const [index, line] of lines.entries()) {
      await tx.insert(rateCardLines).values({
        rateCardId: row!.id,
        chargeTypeId: oceanFreight,
        basis: 'per_container',
        rate: '100.000',
        currency: 'KWD',
        sortOrder: index,
        ...line,
      } as never)
    }
    return row!.id
  })
}

async function quoteFor(enquiryId: string) {
  const [row] = await withActor(bothBranchesActor, (tx) =>
    tx
      .select({
        id: quotes.id,
        status: quotes.status,
        version: quotes.version,
        currency: quotes.currency,
        totalSell: quotes.totalSell,
        totalCost: quotes.totalCost,
        validUntil: quotes.validUntil,
        snapshot: quotes.pricedSnapshot,
      })
      .from(quotes)
      .where(eq(quotes.enquiryId, enquiryId))
      .orderBy(sql`${quotes.version} desc`)
      .limit(1),
  )
  return row
}

const linesOf = (quoteId: string) =>
  withActor(bothBranchesActor, (tx) =>
    tx
      .select({
        chargeTypeId: quoteLines.chargeTypeId,
        basis: quoteLines.basis,
        quantity: quoteLines.quantity,
        rate: quoteLines.rate,
        amount: quoteLines.amount,
      })
      .from(quoteLines)
      .where(eq(quoteLines.quoteId, quoteId))
      .orderBy(quoteLines.sortOrder),
  )

describe.skipIf(!enabled)('pricing an enquiry off a rate card', () => {
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

    // Anything left behind by an earlier run would compete for the same lane.
  })

  afterAll(async () => {
    if (!enabled) return
    harness.session = null
  })

  describe('a sell card is the price', () => {
    it('prices every line on the card and writes the quotation', async () => {
      const on = await lane()
      const id = await enquiry(on)
      await card(on, 'sell', [
        { chargeTypeId: oceanFreight, basis: 'per_container', rate: '250.000' },
        { chargeTypeId: documentation, basis: 'flat', rate: '15.000' },
      ])

      const state = await priceEnquiry({}, form({ enquiryId: id }))
      expect(state.message).toBeUndefined()

      const quote = await quoteFor(id)
      expect(quote!.status).toBe('draft')
      // Two containers at 250, plus a flat 15.
      expect(Number(quote!.totalSell)).toBeCloseTo(515, 3)
      expect(quote!.currency).toBe('KWD')

      const lines = await linesOf(quote!.id)
      expect(lines).toHaveLength(2)
      expect(Number(lines[0]!.quantity)).toBe(2)
    })

    /** Nothing is added to a sell rate — somebody decided that price. */
    it('does not apply a margin on top of a selling rate', async () => {
      const on = await lane()
      const id = await enquiry(on)
      await card(on, 'sell', [{ rate: '300.000' }])

      await priceEnquiry({}, form({ enquiryId: id }))

      const quote = await quoteFor(id)
      expect(Number(quote!.totalSell)).toBeCloseTo(600, 3)
      expect((quote!.snapshot as Record<string, unknown>).source).toBe('sell_card')
    })

    it('prices the cost alongside where a buy card also covers the lane', async () => {
      const on = await lane()
      const id = await enquiry(on)
      await card(on, 'sell', [{ rate: '300.000' }])
      await card(on, 'buy', [{ rate: '200.000' }])

      await priceEnquiry({}, form({ enquiryId: id }))

      const quote = await quoteFor(id)
      expect(Number(quote!.totalSell)).toBeCloseTo(600, 3)
      expect(Number(quote!.totalCost)).toBeCloseTo(400, 3)
      // (600 - 400) / 600
      expect((quote!.snapshot as Record<string, number>).marginPct).toBeCloseTo(33.33, 1)
    })
  })

  describe('a buy card plus the house margin', () => {
    const setMargin = (kind: 'percent' | 'absolute' | 'target_sell' | null, value: string | null) =>
      withActor(bothBranchesActor, (tx) =>
        tx
          .insert(customerBranchTerms)
          .values({
            customerId: CUSTOMER,
            branchId: HOME_BRANCH,
            defaultMarginKind: kind,
            defaultMarginValue: value,
          } as never)
          .onConflictDoUpdate({
            target: [customerBranchTerms.customerId, customerBranchTerms.branchId],
            set: { defaultMarginKind: kind, defaultMarginValue: value },
          }),
      )

    afterAll(() => setMargin(null, null))

    it('marks a buying rate up by the customer’s own percentage', async () => {
      await setMargin('percent', '25')
      const on = await lane()
      const id = await enquiry(on)
      await card(on, 'buy', [{ rate: '200.000' }])

      await priceEnquiry({}, form({ enquiryId: id }))

      const quote = await quoteFor(id)
      // 2 × 200 = 400 cost, +25% = 500 sell.
      expect(Number(quote!.totalCost)).toBeCloseTo(400, 3)
      expect(Number(quote!.totalSell)).toBeCloseTo(500, 3)
      expect((quote!.snapshot as Record<string, unknown>).source).toBe('buy_card_plus_margin')
    })

    /**
     * Refuses rather than guessing.
     *
     * A house margin of zero is a decision; no house margin is an absence, and
     * quoting at cost because nobody set one is how a forwarder works for
     * nothing for a quarter before anybody notices.
     */
    it('refuses where the customer has no house margin', async () => {
      await setMargin(null, null)
      const on = await lane()
      const id = await enquiry(on)
      await card(on, 'buy', [{ rate: '200.000' }])

      const state = await priceEnquiry({}, form({ enquiryId: id }))

      expect(state.message).toContain('house margin')
      expect(await quoteFor(id)).toBeUndefined()
    })
  })

  describe('choosing the card', () => {
    /**
     * Somebody else's negotiated tariff must never price this shipment.
     *
     * The customer-specific card exists precisely so that one customer pays
     * differently; leaking it to the next enquiry on the same lane is both a
     * wrong price and a disclosure.
     */
    it('never prices off another customer’s card', async () => {
      const on = await lane()
      const id = await enquiry(on)
      await card(on, 'sell', [{ rate: '999.000' }], { customerId: AWAY_CUSTOMER })

      const state = await priceEnquiry({}, form({ enquiryId: id }))

      expect(state.message).toContain('No rate card covers')
    })

    it('prefers the customer’s own card over the house card', async () => {
      const on = await lane()
      const id = await enquiry(on)
      await card(on, 'sell', [{ rate: '300.000' }])
      await card(on, 'sell', [{ rate: '180.000' }], { customerId: CUSTOMER })

      await priceEnquiry({}, form({ enquiryId: id }))

      // The negotiated 180, not the house 300.
      expect(Number((await quoteFor(id))!.totalSell)).toBeCloseTo(360, 3)
    })

    /** A superseded card is a price that was withdrawn — FR-RT-08. */
    it('ignores a superseded card', async () => {
      const on = await lane()
      const id = await enquiry(on)
      const withdrawn = await card(on, 'sell', [{ rate: '300.000' }])
      await withActor(bothBranchesActor, (tx) =>
        tx
          .update(rateCards)
          .set({ supersededById: withdrawn })
          .where(eq(rateCards.id, withdrawn)),
      )

      const state = await priceEnquiry({}, form({ enquiryId: id }))

      expect(state.message).toContain('No rate card covers')
    })

    /**
     * Cover is asked for on the readiness date, not today.
     *
     * A shipment ready in six weeks priced off a card that lapses next week is
     * a price nobody can honour, and `validity` exists to prevent exactly it.
     */
    it('asks for cover on the readiness date', async () => {
      const on = await lane()
      const id = await enquiry(on, { readyOn: '2032-06-01' })
      await card(on, 'sell', [{ rate: '300.000' }])

      const state = await priceEnquiry({}, form({ enquiryId: id }))

      expect(state.message).toContain('No rate card covers')
    })
  })

  describe('what the consignment is measured as', () => {
    /**
     * Air bills the greater of actual and volumetric — and the divisor comes
     * from `chargeable_rules`, which is configuration.
     */
    it('rates air on chargeable weight, not gross', async () => {
      const on = await lane()
      const id = await enquiry(on, {
        mode: 'air',
        grossWeightKg: '100.000',
        volumeCbm: '1.200',
        pieces: 1,
      })
      await card(on, 'sell', [{ basis: 'per_kg', rate: '2.000' }], { mode: 'air' })

      await priceEnquiry({}, form({ enquiryId: id }))

      const quote = await quoteFor(id)
      // 1.2 cbm at the seeded 6000 divisor is 200 kg, against 100 actual.
      expect(Number(quote!.totalSell)).toBeCloseTo(400, 3)

      const snapshot = quote!.snapshot as Record<string, string>
      expect(Number(snapshot.chargeableKg)).toBeCloseTo(200, 3)
      expect(snapshot.chargeableBasis).toBe('volumetric')
      // The divisor is recorded, so "why 200 when it weighs 100" has an answer
      // that survives a later edit to the rule.
      expect(Number(snapshot.divisorCm3PerKg)).toBe(6000)
    })

    /**
     * A weight break may bill more kilos than the shipment weighs.
     *
     * 95 kg at the +45 band costs more than declaring 100 kg at the +100 band,
     * and the trade bills the lower of the two. Pricing the cheaper rate
     * against the actual weight would take the band without the declaration
     * that earns it.
     */
    it('declares up to a break where that is cheaper', async () => {
      const on = await lane()
      const id = await enquiry(on, {
        mode: 'air',
        grossWeightKg: '95.000',
        volumeCbm: '0.100',
        pieces: 1,
      })
      await card(
        on,
        'sell',
        [
          {
            basis: 'per_kg',
            rate: '5.000',
            weightBreaks: [
              { fromKg: '45', ratePerKg: '5.000' },
              { fromKg: '100', ratePerKg: '3.000' },
            ],
          },
        ],
        { mode: 'air' },
      )

      await priceEnquiry({}, form({ enquiryId: id }))

      const quote = await quoteFor(id)
      // 95 × 5 = 475, against 100 × 3 = 300. The lower wins.
      expect(Number(quote!.totalSell)).toBeCloseTo(300, 3)

      const lines = await linesOf(quote!.id)
      // Billed at the declared weight and the band's rate, so the customer can
      // check the arithmetic on the page.
      expect(Number(lines[0]!.quantity)).toBeCloseTo(100, 3)
      expect(Number(lines[0]!.rate)).toBeCloseTo(3, 3)
    })

    it('takes the container count from the enquiry’s pieces on FCL', async () => {
      const on = await lane()
      const id = await enquiry(on, { pieces: 3 })
      await card(on, 'sell', [{ rate: '100.000' }])

      await priceEnquiry({}, form({ enquiryId: id }))

      expect(Number((await quoteFor(id))!.totalSell)).toBeCloseTo(300, 3)
    })
  })

  describe('what is frozen on the quotation', () => {
    it('records the cards, the rule and the base currency', async () => {
      const on = await lane()
      const id = await enquiry(on)
      const sell = await card(on, 'sell', [{ rate: '300.000' }])
      const buy = await card(on, 'buy', [{ rate: '200.000' }])

      await priceEnquiry({}, form({ enquiryId: id }))

      const snapshot = (await quoteFor(id))!.snapshot as Record<string, unknown>
      expect(snapshot.sellCardId).toBe(sell)
      expect(snapshot.buyCardId).toBe(buy)
      expect(snapshot.baseCurrency).toBe('KWD')
      expect(snapshot.pricedAt).toEqual(expect.any(String))
    })

    /** The block the quotation PDF renders, derived from what was priced. */
    it('lists the charges as inclusions', async () => {
      const on = await lane()
      const id = await enquiry(on)
      await card(on, 'sell', [
        { chargeTypeId: oceanFreight, rate: '250.000' },
        { chargeTypeId: documentation, basis: 'flat', rate: '15.000' },
      ])

      await priceEnquiry({}, form({ enquiryId: id }))

      const snapshot = (await quoteFor(id))!.snapshot as { inclusions: string[] }
      expect(snapshot.inclusions).toHaveLength(2)
      expect(snapshot.inclusions.join(' ')).toMatch(/Ocean Freight/i)
    })

    it('gives the quotation a validity it did not have to be told', async () => {
      const on = await lane()
      const id = await enquiry(on)
      await card(on, 'sell', [{ rate: '300.000' }])

      await priceEnquiry({}, form({ enquiryId: id }))

      expect((await quoteFor(id))!.validUntil).toEqual(expect.any(String))
    })
  })

  describe('as a revision', () => {
    /** A quote is never edited — FR-RT-08. */
    it('supersedes the previous version rather than editing it', async () => {
      const on = await lane()
      const id = await enquiry(on)
      await card(on, 'sell', [{ rate: '300.000' }])

      await priceEnquiry({}, form({ enquiryId: id }))
      await priceEnquiry({}, form({ enquiryId: id }))

      const all = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ version: quotes.version, status: quotes.status })
          .from(quotes)
          .where(eq(quotes.enquiryId, id))
          .orderBy(quotes.version),
      )

      expect(all).toHaveLength(2)
      expect(all[0]!.status).toBe('superseded')
      expect(all[1]!.status).toBe('draft')
    })

    /**
     * Withdrawing a live quotation is its own key — FR-ID-03.
     *
     * `quote.revise` sits on the machine's `sent → superseded` edge and was
     * checked nowhere: pricing an enquiry twice withdrew an offer the customer
     * was holding on `quote.send` alone. Raising the *first* one still needs
     * only `quote.send`, because there is nothing to withdraw.
     */
    it('needs quote.revise to supersede, but not to raise the first', async () => {
      const on = await lane()
      const id = await enquiry(on)
      await card(on, 'sell', [{ rate: '300.000' }])

      harness.session = { ...session, permissions: new Set(['quote.send']) }
      try {
        // The first is allowed on `quote.send` alone.
        expect((await priceEnquiry({}, form({ enquiryId: id }))).message).toBeUndefined()

        await expect(priceEnquiry({}, form({ enquiryId: id }))).rejects.toThrow('quote.revise')
      } finally {
        harness.session = session
      }
    })

    /** Pricing is a first response — it stops the SLA clock. */
    it('marks the enquiry quoted and stamps the first reply', async () => {
      const on = await lane()
      const id = await enquiry(on)
      await card(on, 'sell', [{ rate: '300.000' }])

      await priceEnquiry({}, form({ enquiryId: id }))

      const [row] = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ status: enquiries.status, firstRespondedAt: enquiries.firstRespondedAt })
          .from(enquiries)
          .where(eq(enquiries.id, id)),
      )
      expect(row!.status).toBe('quoted')
      expect(row!.firstRespondedAt).not.toBeNull()
    })
  })

  describe('refusing', () => {
    it('says so plainly when no card covers the lane', async () => {
      const state = await priceEnquiry({}, form({ enquiryId: await enquiry(await lane()) }))

      expect(state.message).toContain('No rate card covers')
    })

    it('refuses an enquiry with no mode to price against', async () => {
      const on = await lane()
      const id = await enquiry(on, { mode: null })
      const state = await priceEnquiry({}, form({ enquiryId: id }))

      expect(state.message).toContain('no transport mode')
    })

    it('refuses a caller without the permission', async () => {
      harness.session = { ...session, permissions: new Set<string>() }
      try {
        await expect(
          priceEnquiry({}, form({ enquiryId: await enquiry(await lane()) })),
        ).rejects.toThrow(
          'quote.send',
        )
      } finally {
        harness.session = session
      }
    })

    it('treats an enquiry in nobody’s branch as missing', async () => {
      const state = await priceEnquiry(
        {},
        form({ enquiryId: '00000000-0000-7000-8000-0000000000ff' }),
      )

      expect(state.message).toContain('No such enquiry')
    })
  })
})
