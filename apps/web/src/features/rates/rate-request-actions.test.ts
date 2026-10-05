/**
 * Rate procurement's two writes, against a real database — FR-RT-10.
 *
 * `requestRates` fans an enquiry out to the agents a coordinator picked, once
 * each; `acceptRateReply` folds a parsed reply into a versioned buy card. Both
 * are mostly SQL and guards — a token per request, a skip for an agent already
 * asked, a refusal for a reply that declined or did not parse — and guards are
 * exactly what a mocked test cannot check. So this runs the real actions and
 * skips without a database, the same contract as the rest of the slice suites.
 */

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'

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

const { enquiries, partners, rateCardLines, rateCards, rateRequests, withActor } =
  await import('@qabandi/db')
const { world, bothBranchesActor, HOME_BRANCH, AWAY_BRANCH, CUSTOMER, PARTNER, PRINCIPAL } =
  await import('@/lib/testing/fixtures')
const { requestRates, acceptRateReply } = await import('./rate-request-actions')

const session = {
  actor: bothBranchesActor,
  principal: {
    id: PRINCIPAL,
    nameEn: 'Rate Desk',
    nameAr: null,
    email: 'rates@qabandi.test',
    locale: 'en' as const,
  },
  permissions: new Set(['rate.card.write']),
  branchRoles: new Map([
    [HOME_BRANCH, 'operations_manager'],
    [AWAY_BRANCH, 'operations_manager'],
  ]),
  requiresTwoFactor: false,
}

const form = (fields: Record<string, string | string[]>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) data.append(key, v)
  }
  return data
}

const system = { ...bothBranchesActor, type: 'system' as const }
const RUN = Date.now().toString(36).toUpperCase().slice(-5)
let seq = 0

/** A fresh enquiry in the home branch, returning its id. */
async function makeEnquiry(): Promise<string> {
  seq += 1
  return withActor(system, async (tx) => {
    const [row] = await tx
      .insert(enquiries)
      .values({
        reference: `FXH-RFQ-${RUN}-${seq}`,
        branchId: HOME_BRANCH,
        customerId: CUSTOMER,
        status: 'rating',
        channel: 'email',
      })
      .returning({ id: enquiries.id })
    return row!.id
  })
}

/**
 * A fresh agent, with a random id every call.
 *
 * The `rate_cards` no-overlap constraint spans a partner's live cards for a
 * lane — so a card-writing test that reused a fixed partner would collide with
 * the card its own prior run left behind. A new
 * partner each time keeps the exclusion key clear across runs.
 */
async function makeAgent(): Promise<string> {
  seq += 1
  const id = randomUUID()
  await withActor(system, (tx) =>
    tx
      .insert(partners)
      .values({ id, code: `AGT-RFQ-${RUN}-${seq}`, type: 'agent', legalNameEn: `Agent ${seq}` })
      .onConflictDoNothing(),
  )
  return id
}

const requestsFor = (enquiryId: string) =>
  withActor(bothBranchesActor, (tx) =>
    tx
      .select({
        id: rateRequests.id,
        partnerId: rateRequests.partnerId,
        status: rateRequests.status,
        token: rateRequests.token,
        rateCardId: rateRequests.rateCardId,
      })
      .from(rateRequests)
      .where(eq(rateRequests.enquiryId, enquiryId)),
  )

describe.skipIf(!enabled)('requestRates', () => {
  beforeAll(async () => {
    await world()
    harness.session = session
  })
  afterAll(() => {
    harness.session = null
  })

  it('writes one sent request per agent, each with its own token', async () => {
    const enquiryId = await makeEnquiry()
    const second = await makeAgent()

    const state = await requestRates({}, form({ enquiryId, partnerId: [PARTNER, second] }))

    expect(state.ok).toMatch(/^2:/)
    const rows = await requestsFor(enquiryId)
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.status === 'sent')).toBe(true)
    expect(new Set(rows.map((r) => r.token)).size).toBe(2)
  })

  /** An agent already on the enquiry is skipped, not asked twice. */
  it('does not ask an agent already on the enquiry', async () => {
    const enquiryId = await makeEnquiry()
    await requestRates({}, form({ enquiryId, partnerId: PARTNER }))

    const state = await requestRates({}, form({ enquiryId, partnerId: PARTNER }))

    expect(state.ok).toMatch(/^0:/)
    expect(await requestsFor(enquiryId)).toHaveLength(1)
  })

  it('asks for at least one agent', async () => {
    const state = await requestRates({}, form({ enquiryId: await makeEnquiry() }))
    expect(state.message).toBe('ratesValidation.pickAgent')
  })

  it('refuses when no enquiry was named', async () => {
    const state = await requestRates({}, form({ partnerId: PARTNER }))
    expect(state.message).toBe('ratesValidation.enquiryMissing')
  })
})

describe.skipIf(!enabled)('acceptRateReply', () => {
  beforeAll(async () => {
    await world()
    harness.session = session
  })
  afterAll(() => {
    harness.session = null
  })

  /** A rate request in a given state, with an optional stored reply. */
  async function makeRequest(
    status: 'sent' | 'responded' | 'parsed',
    response?: Record<string, unknown>,
    partnerId: string = PARTNER,
  ): Promise<{ enquiryId: string; rateRequestId: string }> {
    const enquiryId = await makeEnquiry()
    seq += 1
    const rateRequestId = await withActor(system, async (tx) => {
      const [row] = await tx
        .insert(rateRequests)
        .values({
          branchId: HOME_BRANCH,
          enquiryId,
          partnerId,
          status,
          token: `accept-${RUN}-${seq}`,
          response: response ?? null,
        })
        .returning({ id: rateRequests.id })
      return row!.id
    })
    return { enquiryId, rateRequestId }
  }

  it('refuses a request that is not parsed', async () => {
    const { enquiryId, rateRequestId } = await makeRequest('responded')

    const state = await acceptRateReply({}, form({ rateRequestId, enquiryId }))

    expect(state.message).toBe('ratesValidation.promoteNotParsed')
  })

  it('refuses a reply the agent declined', async () => {
    const { enquiryId, rateRequestId } = await makeRequest('parsed', { declined: true })

    const state = await acceptRateReply({}, form({ rateRequestId, enquiryId }))

    expect(state.message).toBe('ratesValidation.promoteDeclined')
  })

  it('refuses a reply with no clean lines', async () => {
    const { enquiryId, rateRequestId } = await makeRequest('parsed', { ok: true, rows: [] })

    const state = await acceptRateReply({}, form({ rateRequestId, enquiryId }))

    expect(state.message).toBe('ratesValidation.promoteNoCleanLines')
  })

  it('refuses when the request is gone', async () => {
    const state = await acceptRateReply(
      {},
      form({ rateRequestId: '00000000-0000-7000-8000-0000000000ee', enquiryId: '' }),
    )
    expect(state.message).toBe('ratesValidation.promoteRequestGone')
  })

  /**
   * The happy path: a parsed reply becomes a versioned buy card, and the request
   * is marked accepted with the card on it. The lines replay through
   * `groupRateCards` — the same importer the CSV path uses — and the fixture's
   * own ports and a seeded charge key resolve to ids.
   */
  it('promotes a parsed reply into a buy card', async () => {
    const agent = await makeAgent()
    const { enquiryId, rateRequestId } = await makeRequest(
      'parsed',
      {
        ok: true,
        rows: [
          {
            mode: 'sea_fcl',
            originCode: 'KWFX1',
            destinationCode: 'AEFX1',
            currency: 'USD',
            validFrom: '2035-01-01',
            validTo: '2035-12-31',
            chargeCode: 'ocean_freight',
            basis: 'per_container',
            rate: '1500',
            minimum: null,
            maximum: null,
            containerType: null,
            transitDays: null,
            notes: null,
          },
        ],
      },
      agent,
    )

    const state = await acceptRateReply({}, form({ rateRequestId, enquiryId }))

    expect(state.message).toBeUndefined()
    expect(state.ok).toBeTruthy()

    const [row] = await requestsFor(enquiryId)
    expect(row!.status).toBe('accepted')
    expect(row!.rateCardId).not.toBeNull()

    const [card] = await withActor(bothBranchesActor, (tx) =>
      tx
        .select({ direction: rateCards.direction, partnerId: rateCards.partnerId })
        .from(rateCards)
        .where(eq(rateCards.id, row!.rateCardId!))
        .limit(1),
    )
    expect(card!.direction).toBe('buy')
    expect(card!.partnerId).toBe(agent)
  })

  /** Promoting the same reply twice must not write a second card. */
  it('refuses to promote a reply that is already a card', async () => {
    const agent = await makeAgent()
    const { enquiryId, rateRequestId } = await makeRequest(
      'parsed',
      {
        ok: true,
        rows: [
          {
            mode: 'sea_fcl',
            originCode: 'KWFX1',
            destinationCode: 'AEFX1',
            currency: 'USD',
            validFrom: '2036-01-01',
            validTo: '2036-12-31',
            chargeCode: 'ocean_freight',
            basis: 'per_container',
            rate: '1600',
            minimum: null,
            maximum: null,
            containerType: null,
            transitDays: null,
            notes: null,
          },
        ],
      },
      agent,
    )
    await acceptRateReply({}, form({ rateRequestId, enquiryId }))

    const state = await acceptRateReply({}, form({ rateRequestId, enquiryId }))

    expect(state.message).toMatch(/^ratesValidation\.(promoteAlreadyCard|promoteNotParsed)$/)
  })

  /** One reply row, on the fixture's coded lane. */
  const replyRow = (over: Record<string, unknown> = {}) => ({
    mode: 'sea_fcl',
    originCode: 'KWFX1',
    destinationCode: 'AEFX1',
    currency: 'USD',
    validFrom: '2037-01-01',
    validTo: null,
    chargeCode: 'ocean_freight',
    basis: 'per_container',
    rate: '1500',
    minimum: null,
    maximum: null,
    containerType: null,
    transitDays: null,
    notes: null,
    ...over,
  })

  const cardsOf = (agent: string) =>
    withActor(bothBranchesActor, (tx) =>
      tx
        .select({
          id: rateCards.id,
          currency: rateCards.currency,
          validFrom: rateCards.validFrom,
          validTo: rateCards.validTo,
        })
        .from(rateCards)
        .where(eq(rateCards.partnerId, agent))
        .orderBy(rateCards.validFrom),
    )

  /**
   * USD freight and KWD handling in one reply were two cards on one lane and
   * window, and the second hit `rate_cards_no_overlap` — the reply could never
   * be accepted (S4). One card now, each line in its own currency.
   */
  it('promotes a mixed-currency reply as one card', async () => {
    const agent = await makeAgent()
    const { enquiryId, rateRequestId } = await makeRequest(
      'parsed',
      {
        ok: true,
        rows: [
          replyRow({ validFrom: '2038-01-01' }),
          replyRow({
            validFrom: '2038-01-01',
            currency: 'KWD',
            chargeCode: 'documentation',
            basis: 'flat',
            rate: '25',
          }),
        ],
      },
      agent,
    )

    const state = await acceptRateReply({}, form({ rateRequestId, enquiryId }))

    expect(state.message).toBeUndefined()
    const cards = await cardsOf(agent)
    expect(cards).toHaveLength(1)
    const lines = await withActor(bothBranchesActor, (tx) =>
      tx
        .select({ currency: rateCardLines.currency })
        .from(rateCardLines)
        .where(eq(rateCardLines.rateCardId, cards[0]!.id))
        .orderBy(rateCardLines.sortOrder),
    )
    expect(lines.map((l) => l.currency)).toEqual(['USD', 'KWD'])
  })

  /**
   * An agent with a live card on the lane — an open-ended one, here — used to
   * make every later award from them fail with 23P01 (S5). The newer rate
   * ends the older card where it starts; the older one stays for the dates
   * before.
   */
  it('ends the agent’s earlier card on the lane where the new award starts', async () => {
    const agent = await makeAgent()
    const first = await makeRequest(
      'parsed',
      { ok: true, rows: [replyRow({ validFrom: '2039-01-01' })] },
      agent,
    )
    await acceptRateReply({}, form(first))
    const second = await makeRequest(
      'parsed',
      { ok: true, rows: [replyRow({ validFrom: '2039-03-01', rate: '1400' })] },
      agent,
    )

    const state = await acceptRateReply({}, form(second))

    expect(state.message).toBeUndefined()
    const cards = await cardsOf(agent)
    expect(cards.map((c) => [c.validFrom, c.validTo])).toEqual([
      ['2039-01-01', '2039-03-01'],
      ['2039-03-01', null],
    ])
  })

  it('refuses, with the date, an award that would start before the agent’s card', async () => {
    const agent = await makeAgent()
    const first = await makeRequest(
      'parsed',
      { ok: true, rows: [replyRow({ validFrom: '2040-06-01' })] },
      agent,
    )
    await acceptRateReply({}, form(first))
    const second = await makeRequest(
      'parsed',
      { ok: true, rows: [replyRow({ validFrom: '2040-06-01' })] },
      agent,
    )

    const state = await acceptRateReply({}, form(second))

    expect(state.message).toBe('ratesValidation.promoteOverlapsCard:{"validFrom":"2040-06-01"}')
    // The refusal offers the replacement rather than leaving a dead end (R3).
    expect(state.values).toEqual({ canSupersede: '1' })
    expect(await cardsOf(agent)).toHaveLength(1)
  })

  /*
    R3, live run 5: RTMAG's newer reply on a lane it already had a card for
    from the same day was refused "would overlap", and pricing went on using
    the old card. Asked to, the new reply now supersedes it: the old card is
    kept, with its window, and points at the card that replaced it.
  */
  it('replaces the agent’s card from the same date when asked to', async () => {
    const agent = await makeAgent()
    const first = await makeRequest(
      'parsed',
      { ok: true, rows: [replyRow({ validFrom: '2042-06-01' })] },
      agent,
    )
    await acceptRateReply({}, form(first))
    const second = await makeRequest(
      'parsed',
      { ok: true, rows: [replyRow({ validFrom: '2042-06-01', rate: '1450' })] },
      agent,
    )

    const state = await acceptRateReply({}, form({ ...second, supersede: '1' }))

    expect(state.message).toBeUndefined()
    const cards = await withActor(bothBranchesActor, (tx) =>
      tx
        .select({
          id: rateCards.id,
          validFrom: rateCards.validFrom,
          validTo: rateCards.validTo,
          supersededById: rateCards.supersededById,
        })
        .from(rateCards)
        .where(eq(rateCards.partnerId, agent))
        .orderBy(rateCards.createdAt),
    )
    expect(cards).toHaveLength(2)
    const [old, replacement] = cards
    // Nothing deleted, nothing narrowed: the old card is history, pointing on.
    expect(old!.validFrom).toBe('2042-06-01')
    expect(old!.supersededById).toBe(replacement!.id)
    expect(replacement!.supersededById).toBeNull()
    const [request] = await withActor(bothBranchesActor, (tx) =>
      tx
        .select({ status: rateRequests.status, rateCardId: rateRequests.rateCardId })
        .from(rateRequests)
        .where(eq(rateRequests.id, second.rateRequestId)),
    )
    expect(request).toEqual({ status: 'accepted', rateCardId: replacement!.id })
  })

  /** A reply that priced another lane is not this enquiry's rate (S14). */
  it('refuses a reply that priced a different lane', async () => {
    const agent = await makeAgent()
    const { enquiryId, rateRequestId } = await makeRequest(
      'parsed',
      { ok: true, laneMismatch: 'CNSHA → KWSWK', rows: [replyRow({ validFrom: '2041-01-01' })] },
      agent,
    )

    const state = await acceptRateReply({}, form({ rateRequestId, enquiryId }))

    expect(state.message).toMatch(/^ratesValidation\.promoteLaneMismatch/)
    expect(await cardsOf(agent)).toEqual([])
  })
})
