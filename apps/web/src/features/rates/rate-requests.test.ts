/**
 * The rate-request read models — the comparison a coordinator ranks agents on.
 *
 * The interesting behaviour is not the select, it is what the function does with
 * the rows: it brings every quoted currency onto the branch's base so USD, KWD
 * and AED sort against each other, flags the cheapest comparable reply, and
 * marks an incomparable one honestly rather than ranking it at a made-up number.
 * That is tested against real rows. The pilot branch is covered too, because the
 * hosted demo and the e2e suite render exactly it.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const pilot = vi.hoisted(() => ({ on: false }))
vi.mock('@/lib/pilot/source', () => ({ usePilotFixtures: () => pilot.on }))

const { enquiries, fxRates, rateRequests, withActor } = await import('@qabandi/db')
const { world, bothBranchesActor, HOME_BRANCH, CUSTOMER, PARTNER } =
  await import('@/lib/testing/fixtures')
const { getEnquiryRateRequests, listCoveringAgents, getRenewals, replyCounts } =
  await import('./rate-requests')

const system = { ...bothBranchesActor, type: 'system' as const }
const RUN = Date.now().toString(36).toUpperCase().slice(-5)
let seq = 0

async function makeEnquiry(readyOn?: string): Promise<string> {
  seq += 1
  return withActor(system, async (tx) => {
    const [row] = await tx
      .insert(enquiries)
      .values({
        reference: `FXH-RRV-${RUN}-${seq}`,
        branchId: HOME_BRANCH,
        customerId: CUSTOMER,
        status: 'rating',
        channel: 'email',
        ...(readyOn ? { readyOn } : {}),
      })
      .returning({ id: enquiries.id })
    return row!.id
  })
}

async function reply(
  enquiryId: string,
  status: 'sent' | 'responded' | 'parsed' | 'accepted' | 'declined' | 'expired',
  quoted?: { total: string; currency: string; unpriced?: number },
  extra: Record<string, unknown> = {},
) {
  seq += 1
  await withActor(system, (tx) =>
    tx.insert(rateRequests).values({
      branchId: HOME_BRANCH,
      enquiryId,
      partnerId: PARTNER,
      status,
      token: `rrv-${RUN}-${seq}`,
      quotedTotal: quoted?.total ?? null,
      quotedCurrency: quoted?.currency ?? null,
      response: quoted
        ? {
            ok: true,
            rows: [{ chargeCode: 'ocean_freight' }],
            ...(quoted.unpriced ? { unpriced: quoted.unpriced } : {}),
            ...extra,
          }
        : null,
    }),
  )
}

describe.skipIf(!enabled)('getEnquiryRateRequests', () => {
  beforeAll(async () => {
    await world()
  })
  afterEach(() => {
    pilot.on = false
  })

  it('flags the cheapest comparable reply and counts the rest', async () => {
    const enquiryId = await makeEnquiry()
    await reply(enquiryId, 'parsed', { total: '1000.000', currency: 'KWD' })
    await reply(enquiryId, 'parsed', { total: '900.000', currency: 'KWD' })
    await reply(enquiryId, 'sent')

    const view = await getEnquiryRateRequests(bothBranchesActor, enquiryId)

    expect(view).not.toBeNull()
    expect(view!.baseCurrency).toBe('KWD')
    expect(view!.answered).toBe(2)
    expect(view!.awaiting).toBe(1)
    const cheapest = view!.requests.find((r) => r.isCheapest)
    expect(Number(cheapest?.quotedTotal)).toBe(900)
  })

  /*
    A partial total is not a price (F69). Two per-container lines the reply
    could not price left SHACO's 4,120 USD reply at its 60 USD flat fee, and it
    was ranked cheapest on that. It stays listed, marked partial, and out of
    the comparison — the whole reply wins even though its figure is higher.
  */
  it('leaves a reply with unpriced lines out of the cheapest', async () => {
    const enquiryId = await makeEnquiry()
    await reply(enquiryId, 'parsed', { total: '60.000', currency: 'KWD', unpriced: 2 })
    await reply(enquiryId, 'parsed', { total: '900.000', currency: 'KWD' })

    const view = await getEnquiryRateRequests(bothBranchesActor, enquiryId)

    const partial = view!.requests.find((r) => Number(r.quotedTotal) === 60)
    expect(partial?.unpricedLines).toBe(2)
    expect(partial?.isCheapest).toBe(false)
    expect(Number(view!.requests.find((r) => r.isCheapest)?.quotedTotal)).toBe(900)
    // A partial reply is still an answer.
    expect(view!.answered).toBe(2)
  })

  /*
    Insurance at 0.3% is unpriced on every reply — no enquiry carries a
    declared value — and counted as partial it left every FCL reply that
    quoted insurance unranked (R1). Only a missing consignment quantity makes
    a total partial.
  */
  it('still ranks a reply whose only unpriced line is a percentage', async () => {
    const enquiryId = await makeEnquiry()
    await reply(
      enquiryId,
      'parsed',
      { total: '800.000', currency: 'KWD', unpriced: 1 },
      { partial: 0 },
    )
    await reply(enquiryId, 'parsed', { total: '900.000', currency: 'KWD' })

    const view = await getEnquiryRateRequests(bothBranchesActor, enquiryId)

    expect(Number(view!.requests.find((r) => r.isCheapest)?.quotedTotal)).toBe(800)
  })

  /* A reply that priced another lane is shown, never offered or ranked (S14). */
  it('neither offers nor ranks a reply that priced a different lane', async () => {
    const enquiryId = await makeEnquiry()
    await reply(
      enquiryId,
      'parsed',
      { total: '500.000', currency: 'KWD' },
      { laneMismatch: 'CNSHA → KWSWK' },
    )
    await reply(enquiryId, 'parsed', { total: '900.000', currency: 'KWD' })

    const view = await getEnquiryRateRequests(bothBranchesActor, enquiryId)

    const wrongLane = view!.requests.find((r) => r.laneMismatch !== null)
    expect(wrongLane?.canPromote).toBe(false)
    expect(wrongLane?.isCheapest).toBe(false)
    expect(Number(view!.requests.find((r) => r.isCheapest)?.quotedTotal)).toBe(900)
  })

  /*
    An accepted reply and a decline are both answers (F65). The panel read
    "0 awaiting, 0 answered" above an accepted row; an expired request is
    neither, because nobody replied and nobody is waiting.
  */
  it('counts an accepted reply and a decline as answered', async () => {
    const enquiryId = await makeEnquiry()
    await reply(enquiryId, 'accepted', { total: '800.000', currency: 'KWD' })
    await reply(enquiryId, 'declined')
    await reply(enquiryId, 'expired')
    await reply(enquiryId, 'sent')

    const view = await getEnquiryRateRequests(bothBranchesActor, enquiryId)

    expect(view!.answered).toBe(2)
    expect(view!.awaiting).toBe(1)
  })

  /*
    A foreign-currency reply is brought onto the base at the rate "Price it"
    would use: the newest on or before the enquiry's readiness day, a
    hand-entered rate over the feed's on the same day, in decimals, rounded to
    the base's three places. The days are in 2041 so no other suite, which
    converts on or before today, ever reads these rows; a row after the
    readiness day is there to prove it is not used.
  */
  describe('converting a reply onto the base', () => {
    const rate = (day: string, value: string, source: string) =>
      withActor(system, (tx) =>
        tx
          .insert(fxRates)
          .values({ fromCurrency: 'USD', toCurrency: 'KWD', rate: value, effectiveOn: day, source })
          .onConflictDoNothing(),
      )

    it('converts a USD reply into KWD at the feed rate, to the fils', async () => {
      await rate('2041-03-09', '0.30917960428721', 'er-api')
      await rate('2041-03-12', '0.50000000', 'er-api') // after the readiness day
      const enquiryId = await makeEnquiry('2041-03-09')
      await reply(enquiryId, 'parsed', { total: '1850.00', currency: 'USD' })

      const view = await getEnquiryRateRequests(bothBranchesActor, enquiryId)

      const usd = view!.requests[0]
      expect(usd?.comparable).toBe(true)
      // 1850 × 0.30917960428721 = 571.98226793…, half-up to three places.
      expect(usd?.normalizedTotal).toBe('571.982')
    })

    it('uses a hand-entered rate over the feed on the same day, as pricing does', async () => {
      await rate('2041-03-10', '0.31000000', 'er-api')
      await rate('2041-03-10', '0.30850000', 'manual')
      const enquiryId = await makeEnquiry('2041-03-10')
      await reply(enquiryId, 'parsed', { total: '1850.00', currency: 'USD' })
      await reply(enquiryId, 'parsed', { total: '570.730', currency: 'KWD' })

      const view = await getEnquiryRateRequests(bothBranchesActor, enquiryId)

      const usd = view!.requests.find((r) => r.quotedCurrency === 'USD')
      expect(usd?.normalizedTotal).toBe('570.725')
      // A fils cheaper than the KWD reply, and ranked so as decimals.
      expect(view!.requests.find((r) => r.isCheapest)?.quotedCurrency).toBe('USD')
    })
  })

  it('returns null for an enquiry that is not there', async () => {
    const view = await getEnquiryRateRequests(bothBranchesActor, '')
    expect(view).toBeNull()
  })

  it('serves the fixture comparison in pilot mode', async () => {
    pilot.on = true
    // The enquiry the model read — the one the demo asked agents about.
    const view = await getEnquiryRateRequests(bothBranchesActor, 'enq-318')
    expect(view).not.toBeNull()
    expect(view!.requests.length).toBeGreaterThan(0)
    expect(typeof view!.baseCurrency).toBe('string')
    // The demo's summary is counted by hand; it must agree with its own list.
    expect({ awaiting: view!.awaiting, answered: view!.answered }).toEqual(
      replyCounts(view!.requests),
    )
  })
})

describe.skipIf(!enabled)('the pilot read models', () => {
  afterEach(() => {
    pilot.on = false
  })

  it('lists covering agents from fixtures', async () => {
    pilot.on = true
    const agents = await listCoveringAgents(bothBranchesActor, 'any')
    expect(Array.isArray(agents)).toBe(true)
  })

  it('lists renewals in flight from fixtures', async () => {
    pilot.on = true
    const renewals = await getRenewals(bothBranchesActor)
    expect(Array.isArray(renewals)).toBe(true)
  })
})
