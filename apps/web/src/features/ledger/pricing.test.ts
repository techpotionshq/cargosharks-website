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

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq, sql } from 'drizzle-orm'

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

const {
  chargeTypes,
  customerBranchTerms,
  enquiries,
  fxRates,
  locations,
  partners,
  quoteLines,
  quotes,
  rateCardLines,
  rateCards,
  rateRequests,
  withActor,
} = await import('@qabandi/db')

const {
  CUSTOMER,
  AWAY_CUSTOMER,
  HOME_BRANCH,
  AWAY_BRANCH,
  PARTNER,
  PRINCIPAL,
  bothBranchesActor,
  world,
} = await import('@/lib/testing/fixtures')

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
        // FCL is priced per container, and only this says how many (F39).
        containerCount: 2,
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

    /*
      A card in another currency is converted into the branch's, and the
      quotation says so. The totals are the sum of each line in the base
      currency; they used to be stored under the card's currency code — KWD
      figures labelled USD — because every card in this suite was in KWD and the
      two never differed.
    */
    it('totals a foreign-currency card in the branch currency, and says so', async () => {
      const on = await lane()
      const id = await enquiry(on)
      const today = new Date().toISOString().slice(0, 10)
      await withActor(bothBranchesActor, (tx) =>
        tx
          .insert(fxRates)
          .values({
            // INR, which no other suite converts: the test database is never
            // emptied, and a USD rate written here was read by the credit suite.
            fromCurrency: 'INR',
            toCurrency: 'KWD',
            rate: '0.01000000',
            source: 'pricing-test',
            effectiveOn: today,
          })
          .onConflictDoNothing(),
      )
      await card(
        on,
        'sell',
        [
          { chargeTypeId: oceanFreight, basis: 'per_container', rate: '250.00', currency: 'INR' },
          { chargeTypeId: documentation, basis: 'flat', rate: '15.00', currency: 'INR' },
        ],
        { currency: 'INR' },
      )

      const state = await priceEnquiry({}, form({ enquiryId: id }))
      expect(state.message).toBeUndefined()

      const quote = await quoteFor(id)
      expect(quote!.currency).toBe('KWD')
      // 2 × 250 + 15 = 515 INR, at 0.01 → 5.150 KWD.
      expect(Number(quote!.totalSell)).toBeCloseTo(5.15, 3)

      // The lines are in the quotation's currency too — a PDF prints them under
      // it, and 250 USD printed as "KWD 250.000" contradicted the total.
      const lines = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({
            rate: quoteLines.rate,
            amount: quoteLines.amount,
            currency: quoteLines.currency,
          })
          .from(quoteLines)
          .where(eq(quoteLines.quoteId, quote!.id))
          .orderBy(quoteLines.sortOrder),
      )
      expect(lines.map((line) => line.currency)).toEqual(['KWD', 'KWD'])
      expect(Number(lines[0]!.rate)).toBeCloseTo(2.5, 6)
      expect(Number(lines[0]!.amount)).toBeCloseTo(5, 3)
      expect(Number(lines[1]!.amount)).toBeCloseTo(0.15, 3)
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
     * The sell line's rate is the sell amount over its quantity — never our
     * buy rate, which printed on the customer's quotation beside the margined
     * amount, so qty × rate did not make the amount and the customer read the
     * rate we buy at (R2).
     */
    it('writes the sell rate on a margined line, not the buy rate', async () => {
      await setMargin('percent', '15')
      const on = await lane()
      const id = await enquiry(on)
      await card(on, 'buy', [{ rate: '445.150' }])

      await priceEnquiry({}, form({ enquiryId: id }))

      const [line] = await linesOf((await quoteFor(id))!.id)
      // 2 × 445.150 = 890.300 cost, +15% = 1,023.845 sell.
      expect(line!.amount).toBe('1023.845000')
      expect(Number(line!.rate)).toBeCloseTo(511.9225, 6)
      expect(Number(line!.quantity) * Number(line!.rate)).toBeCloseTo(1023.845, 3)
    })

    /** Each line is rounded before the total, so the lines add up to it (R2). */
    it('totals the rounded lines, so the quotation adds up', async () => {
      await setMargin('percent', '10')
      const on = await lane()
      const id = await enquiry(on)
      await card(
        on,
        'buy',
        [0, 1, 2].map(() => ({ chargeTypeId: documentation, basis: 'flat', rate: '1.234' })),
      )

      await priceEnquiry({}, form({ enquiryId: id }))

      const quote = await quoteFor(id)
      const lines = await linesOf(quote!.id)
      expect(lines.map((l) => l.amount)).toEqual(['1.357000', '1.357000', '1.357000'])
      expect(quote!.totalSell).toBe('4.071000')
    })

    /**
     * An absolute or target margin is in the branch currency and applies to
     * the whole quotation once. On a foreign-currency buy card it threw a
     * currency mismatch and refused the enquiry, and on several lines it was
     * applied once per line (R2).
     */
    it('lays an absolute margin once over a foreign-currency card', async () => {
      await setMargin('absolute', '50')
      await withActor(bothBranchesActor, (tx) =>
        tx
          .insert(fxRates)
          .values({
            fromCurrency: 'INR',
            toCurrency: 'KWD',
            rate: '0.01000000',
            source: 'pricing-test',
            effectiveOn: new Date().toISOString().slice(0, 10),
          })
          .onConflictDoNothing(),
      )
      const on = await lane()
      const id = await enquiry(on)
      await card(
        on,
        'buy',
        [
          { basis: 'per_container', rate: '25000.00', currency: 'INR' },
          { chargeTypeId: documentation, basis: 'flat', rate: '5000.00', currency: 'INR' },
        ],
        { currency: 'INR' },
      )

      const state = await priceEnquiry({}, form({ enquiryId: id }))
      expect(state.message).toBeUndefined()

      const quote = await quoteFor(id)
      // 2 × 25,000 + 5,000 = 55,000 INR → 550.000 KWD cost; + 50 once = 600.
      expect(quote!.totalCost).toBe('550.000000')
      expect(quote!.totalSell).toBe('600.000000')
      const lines = await linesOf(quote!.id)
      expect(lines.map((l) => l.amount)).toEqual(['545.455000', '54.545000'])
    })

    it('quotes a target sell once, however many lines the card has', async () => {
      await setMargin('target_sell', '500')
      const on = await lane()
      const id = await enquiry(on)
      await card(
        on,
        'buy',
        [0, 1, 2].map((i) => ({
          chargeTypeId: i === 0 ? oceanFreight : documentation,
          basis: 'flat',
          rate: '100.000',
        })),
      )

      await priceEnquiry({}, form({ enquiryId: id }))

      expect((await quoteFor(id))!.totalSell).toBe('500.000000')
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

      expect(state.message).toBe('ledgerValidation.pricingNoMargin')
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

      expect(state.message).toBe('ledgerValidation.pricingNoCover')
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
        tx.update(rateCards).set({ supersededById: withdrawn }).where(eq(rateCards.id, withdrawn)),
      )

      const state = await priceEnquiry({}, form({ enquiryId: id }))

      expect(state.message).toBe('ledgerValidation.pricingNoCover')
    })

    /**
     * The awarded agent rate is the cost, whatever else covers the lane (F67).
     *
     * Two agents' buy cards on one lane: the rival is cheaper and sorts first,
     * so the lane lookup alone takes it. The enquiry's accepted rate request names the
     * other, and a person pressing "Price it" after awarding it must be costed
     * off what they awarded — the sell card stays the price either way.
     */
    it('costs off the buy card the enquiry awarded, not a cheaper rival', async () => {
      const on = await lane()
      const id = await enquiry(on)
      await card(on, 'sell', [{ rate: '300.000' }])
      const awarded = await card(on, 'buy', [{ rate: '250.000' }], { partnerId: PARTNER })
      /*
        The lookup orders agents' cards by the `partner_id` uuid before
        `valid_from` — the arbitrary tie-break F67 was about — so the rival's
        id is made to sort before the fixture agent's (…c005): without the
        award it is the card that would cost this, every run.
      */
      const rival = `00000000-0000-4000-8000-${randomUUID().slice(-12)}`
      await withActor(bothBranchesActor, (tx) =>
        tx.insert(partners).values({
          id: rival,
          code: `AGT-P-${RUN}-${next()}`,
          type: 'agent',
          legalNameEn: 'Cheaper Rival',
        }),
      )
      await card(on, 'buy', [{ rate: '150.000' }], {
        partnerId: rival,
        validFrom: '2031-02-01',
        validity: '[2031-02-01,2031-12-31)',
      })
      await withActor(bothBranchesActor, (tx) =>
        tx.insert(rateRequests).values({
          branchId: HOME_BRANCH,
          enquiryId: id,
          partnerId: PARTNER,
          status: 'accepted',
          token: `p-${RUN}-${next()}`,
          rateCardId: awarded,
        }),
      )

      const state = await priceEnquiry({}, form({ enquiryId: id }))
      expect(state.message).toBeUndefined()

      const quote = await quoteFor(id)
      // Two containers at the awarded 250 — the rival's 150 would give 300.
      expect(quote!.totalCost).toBe('500.000000')
      expect(Number(quote!.totalSell)).toBeCloseTo(600, 3)
      expect((quote!.snapshot as Record<string, unknown>).buyCardId).toBe(awarded)
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

      expect(state.message).toBe('ledgerValidation.pricingNoCover')
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

    /*
      The container count, never the package count (F39). This test used to
      assert the opposite — `pieces: 3` priced as three containers — which is
      how 200 cartons were quoted as 200 × 40HC.
    */
    it('takes the container count on FCL, not the pieces', async () => {
      const on = await lane()
      const id = await enquiry(on, { pieces: 200, containerCount: 3 })
      await card(on, 'sell', [{ rate: '100.000' }])

      await priceEnquiry({}, form({ enquiryId: id }))

      const quote = await quoteFor(id)
      expect(Number(quote!.totalSell)).toBeCloseTo(300, 3)
      expect(Number((await linesOf(quote!.id))[0]!.quantity)).toBe(3)
    })

    /** Only FCL needs a count — an LCL lane still prices without one. */
    it('does not ask an LCL enquiry for a container count', async () => {
      const on = await lane()
      const id = await enquiry(on, { mode: 'sea_lcl', containerCount: null })
      await card(on, 'sell', [{ basis: 'flat', rate: '80.000' }], { mode: 'sea_lcl' })

      const state = await priceEnquiry({}, form({ enquiryId: id }))

      expect(state.message).toBeUndefined()
      expect(Number((await quoteFor(id))!.totalSell)).toBeCloseTo(80, 3)
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

    /*
      The buy side line by line, so the comparison can show a buy rate beside
      each sell rate rather than only a buy total (F41). In the quotation's
      currency, like the sell lines.
    */
    it('records the buy rate of each line beside the sell', async () => {
      const on = await lane()
      const id = await enquiry(on)
      await card(on, 'sell', [
        { chargeTypeId: oceanFreight, rate: '300.000' },
        { chargeTypeId: documentation, basis: 'flat', rate: '15.000' },
      ])
      await card(on, 'buy', [{ chargeTypeId: oceanFreight, rate: '200.000' }])

      await priceEnquiry({}, form({ enquiryId: id }))

      const snapshot = (await quoteFor(id))!.snapshot as {
        lineCosts: { chargeTypeKey: string; rate: string; amount: string; currency: string }[]
      }
      // Only the charge the buy card carries; documentation has no buy line.
      expect(snapshot.lineCosts).toHaveLength(1)
      expect(snapshot.lineCosts[0]!.chargeTypeKey).toBe('ocean_freight')
      expect(Number(snapshot.lineCosts[0]!.rate)).toBeCloseTo(200, 6)
      expect(Number(snapshot.lineCosts[0]!.amount)).toBeCloseTo(400, 3)
      expect(snapshot.lineCosts[0]!.currency).toBe('KWD')
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

    /** The replaced version points at its replacement (S3). */
    it('records which version replaced the old one', async () => {
      const on = await lane()
      const id = await enquiry(on)
      await card(on, 'sell', [{ rate: '300.000' }])

      await priceEnquiry({}, form({ enquiryId: id }))
      await priceEnquiry({}, form({ enquiryId: id }))

      const all = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ id: quotes.id, supersededById: quotes.supersededById })
          .from(quotes)
          .where(eq(quotes.enquiryId, id))
          .orderBy(quotes.version),
      )
      expect(all[0]!.supersededById).toBe(all[1]!.id)
      expect(all[1]!.supersededById).toBeNull()
    })

    /**
     * Re-pricing after the customer accepted retired the accepted quote with
     * one click (S2). It is refused with a sentence instead.
     */
    it('refuses to re-price once a version was accepted', async () => {
      const on = await lane()
      const id = await enquiry(on)
      await card(on, 'sell', [{ rate: '300.000' }])
      await priceEnquiry({}, form({ enquiryId: id }))
      await withActor(bothBranchesActor, (tx) =>
        tx.update(quotes).set({ status: 'accepted' }).where(eq(quotes.enquiryId, id)),
      )

      const state = await priceEnquiry({}, form({ enquiryId: id }))

      expect(state.message).toBe('ledgerValidation.quoteAlreadyAccepted')
      const quote = await quoteFor(id)
      expect(quote!.version).toBe(1)
      expect(quote!.status).toBe('accepted')
    })

    /**
     * Two prices at once — auto-draft and a coordinator in the same minute —
     * both read "no quote yet" and both wrote version 1; the second died on
     * `quotes_version_unique` (S19). The enquiry lock numbers them in turn.
     */
    it('numbers two simultaneous prices one after the other', async () => {
      const on = await lane()
      const id = await enquiry(on)
      await card(on, 'sell', [{ rate: '300.000' }])

      const states = await Promise.all([
        priceEnquiry({}, form({ enquiryId: id })),
        priceEnquiry({}, form({ enquiryId: id })),
      ])

      expect(states.every((s) => s.message === undefined)).toBe(true)
      const all = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ version: quotes.version })
          .from(quotes)
          .where(eq(quotes.enquiryId, id))
          .orderBy(quotes.version),
      )
      expect(all.map((q) => q.version)).toEqual([1, 2])
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

      expect(state.message).toBe('ledgerValidation.pricingNoCover')
    })

    it('refuses an enquiry with no mode to price against', async () => {
      const on = await lane()
      const id = await enquiry(on, { mode: null })
      const state = await priceEnquiry({}, form({ enquiryId: id }))

      expect(state.message).toBe('ledgerValidation.pricingNoMode')
    })

    /*
      A FCL enquiry with no container count is refused, not priced off its
      pieces (F39) — even with a card covering the lane, and before any
      quotation is written.
    */
    it('refuses a FCL enquiry with no container count', async () => {
      const on = await lane()
      const id = await enquiry(on, { pieces: 200, containerCount: null })
      await card(on, 'sell', [{ rate: '100.000' }])

      const state = await priceEnquiry({}, form({ enquiryId: id }))

      expect(state.message).toBe('ledgerValidation.pricingNoContainerCount')
      expect(await quoteFor(id)).toBeUndefined()
    })

    it('refuses a caller without the permission', async () => {
      harness.session = { ...session, permissions: new Set<string>() }
      try {
        await expect(
          priceEnquiry({}, form({ enquiryId: await enquiry(await lane()) })),
        ).rejects.toThrow('quote.send')
      } finally {
        harness.session = session
      }
    })

    it('treats an enquiry in nobody’s branch as missing', async () => {
      const state = await priceEnquiry(
        {},
        form({ enquiryId: '00000000-0000-7000-8000-0000000000ff' }),
      )

      expect(state.message).toBe('ledgerValidation.pricingNotFound')
    })
  })
})
