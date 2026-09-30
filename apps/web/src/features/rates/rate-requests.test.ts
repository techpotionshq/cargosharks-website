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

async function makeEnquiry(): Promise<string> {
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
      })
      .returning({ id: enquiries.id })
    return row!.id
  })
}

async function reply(
  enquiryId: string,
  status: 'sent' | 'responded' | 'parsed' | 'accepted' | 'declined' | 'expired',
  quoted?: { total: string; currency: string; unpriced?: number },
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

  /**
   * A foreign-currency reply is brought onto the base at the latest rate on
   * file. The rate is inserted far in the future so it wins over any the seed
   * carries, which makes the converted figure deterministic: 3000 × 0.308.
   */
  it('brings a foreign-currency reply onto the base at the latest rate', async () => {
    await withActor(system, (tx) =>
      tx
        .insert(fxRates)
        .values({
          fromCurrency: 'USD',
          toCurrency: 'KWD',
          rate: '0.308000',
          effectiveOn: '2040-01-01',
          source: 'manual',
        })
        .onConflictDoNothing(),
    )
    const enquiryId = await makeEnquiry()
    await reply(enquiryId, 'parsed', { total: '3000.000', currency: 'USD' })

    const view = await getEnquiryRateRequests(bothBranchesActor, enquiryId)

    const usd = view!.requests[0]
    expect(usd?.quotedCurrency).toBe('USD')
    expect(usd?.comparable).toBe(true)
    expect(Number(usd?.normalizedTotal)).toBeCloseTo(924, 0)
  })

  it('returns null for an enquiry that is not there', async () => {
    const view = await getEnquiryRateRequests(bothBranchesActor, '')
    expect(view).toBeNull()
  })

  it('serves the fixture comparison in pilot mode', async () => {
    pilot.on = true
    const view = await getEnquiryRateRequests(bothBranchesActor, 'any')
    expect(view).not.toBeNull()
    expect(Array.isArray(view!.requests)).toBe(true)
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
