/**
 * Automatic rate award — FR-RT-10, against a real database.
 *
 * The award itself is `promoteRateReply`, tested from the web accept path; what
 * this pins is the part that is only here — the strategy that decides *when* to
 * award and *which* reply wins. It promotes the cheapest reply priced to the
 * branch base; it does nothing on the inert default; `all` holds while an agent
 * is still outstanding; and `wait` holds until the window has passed. The gate is
 * injected, because the real one reads through a cache that cannot be cleared
 * within a run.
 */

import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import type { LiveIntegration } from '../settings'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const {
  branches,
  enquiries,
  partners,
  rateCards,
  rateRequests,
  systemActor,
  withActor,
  workingCalendars,
} = await import('@qabandi/db')

const { autoPromoteRateReplies } = await import('./rate-auto-promote')

const BRANCH = '00000000-0000-7000-8000-0000000000c1'
const actor = systemActor()
const RUN = Date.now().toString(36).toUpperCase().slice(-5)
let seq = 0

const gate = (driver: string, waitHours?: number): LiveIntegration => ({
  key: 'rateAutoPromote',
  driver,
  live: driver !== 'manual',
  missing: [],
  fromRow: false,
  text: () => undefined,
  number: (_name, fallback) => waitHours ?? fallback,
  bool: (_name, fallback) => fallback,
  secret: () => undefined,
})

async function makeEnquiry(): Promise<string> {
  seq += 1
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .insert(enquiries)
      .values({
        reference: `PROMO-${RUN}-${seq}`,
        branchId: BRANCH,
        status: 'rating',
        channel: 'email',
      })
      .returning({ id: enquiries.id })
    return row!.id
  })
}

async function makeAgent(): Promise<string> {
  seq += 1
  const id = randomUUID()
  await withActor(actor, (tx) =>
    tx
      .insert(partners)
      .values({ id, code: `AGT-PR-${RUN}-${seq}`, type: 'agent', legalNameEn: `Agent ${seq}` }),
  )
  return id
}

/** A parsed, promotable reply quoting `total` KWD, from a fresh agent. */
async function parsedReply(
  enquiryId: string,
  total: string,
  createdAt?: Date,
  unpriced?: number,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const partnerId = await makeAgent()
  seq += 1
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .insert(rateRequests)
      .values({
        branchId: BRANCH,
        enquiryId,
        partnerId,
        status: 'parsed',
        token: `pr-${RUN}-${seq}`,
        quotedTotal: total,
        quotedCurrency: 'KWD',
        ...(createdAt ? { createdAt } : {}),
        response: {
          ok: true,
          ...(unpriced ? { unpriced } : {}),
          ...extra,
          rows: [
            {
              mode: 'sea_fcl',
              originCode: 'KWSWK',
              destinationCode: 'AEJEA',
              currency: 'KWD',
              validFrom: '2035-01-01',
              validTo: '2035-12-31',
              chargeCode: 'ocean_freight',
              basis: 'per_container',
              rate: total,
              minimum: null,
              maximum: null,
              containerType: null,
              transitDays: null,
              notes: null,
            },
          ],
        },
      })
      .returning({ id: rateRequests.id })
    return row!.id
  })
}

/** An RFQ still out — an agent who has not answered. */
async function sentReply(enquiryId: string): Promise<void> {
  const partnerId = await makeAgent()
  seq += 1
  await withActor(actor, (tx) =>
    tx.insert(rateRequests).values({
      branchId: BRANCH,
      enquiryId,
      partnerId,
      status: 'sent',
      token: `sent-${RUN}-${seq}`,
    }),
  )
}

const requestRow = async (id: string) => {
  const [row] = await withActor(actor, (tx) =>
    tx
      .select({ status: rateRequests.status, rateCardId: rateRequests.rateCardId })
      .from(rateRequests)
      .where(eq(rateRequests.id, id))
      .limit(1),
  )
  return row!
}

describe.skipIf(!enabled)('autoPromoteRateReplies', () => {
  beforeAll(async () => {
    const [calendar] = await withActor(actor, (tx) =>
      tx
        .select({ id: workingCalendars.id })
        .from(workingCalendars)
        .where(eq(workingCalendars.key, 'kuwait'))
        .limit(1),
    )
    if (!calendar) throw new Error('Run `pnpm db:seed` before the auto-promote tests')
    await withActor(actor, (tx) =>
      tx
        .insert(branches)
        .values({
          id: BRANCH,
          code: 'PRO',
          legalNameEn: 'Promote Test Branch',
          legalNameAr: 'فرع',
          country: 'KW',
          baseCurrency: 'KWD',
          invoiceSeries: 'PRO',
          calendarId: calendar.id,
        })
        .onConflictDoNothing(),
    )
  })

  it('awards the cheapest reply and leaves the dearer one', async () => {
    const id = await makeEnquiry()
    const dear = await parsedReply(id, '1000.000')
    const cheap = await parsedReply(id, '900.000')

    const result = await autoPromoteRateReplies({ source: gate('first') })

    expect(result.enabled).toBe(true)
    expect(result.promoted).toBeGreaterThanOrEqual(1)
    const cheapRow = await requestRow(cheap)
    expect(cheapRow.status).toBe('accepted')
    expect(cheapRow.rateCardId).not.toBeNull()
    // The dearer reply was not awarded.
    expect((await requestRow(dear)).status).toBe('parsed')
    // And a buy card exists for the awarded reply.
    const [card] = await withActor(actor, (tx) =>
      tx
        .select({ direction: rateCards.direction })
        .from(rateCards)
        .where(eq(rateCards.id, cheapRow.rateCardId!))
        .limit(1),
    )
    expect(card!.direction).toBe('buy')
  })

  /*
    A partial total is not a price (F69): a reply whose per-container lines
    went unpriced carried only its flat fees and beat every whole reply. With
    a whole reply beside it, the whole one is awarded; the partial one waits.
  */
  it('does not award a reply whose total left lines unpriced over a whole one', async () => {
    const id = await makeEnquiry()
    const partial = await parsedReply(id, '60.000', undefined, 2)
    const whole = await parsedReply(id, '900.000')

    await autoPromoteRateReplies({ source: gate('first') })

    expect((await requestRow(whole)).status).toBe('accepted')
    expect((await requestRow(partial)).status).toBe('parsed')
  })

  /**
   * Insurance at a percentage is unpriced on every reply alike; it is not a
   * partial total (R1). Both replies here carry one, and the cheaper wins.
   */
  it('ranks replies whose only unpriced line is a percentage', async () => {
    const id = await makeEnquiry()
    const cheaper = await parsedReply(id, '700.000', undefined, 1, { partial: 0 })
    const dearer = await parsedReply(id, '800.000', undefined, 1, { partial: 0 })

    await autoPromoteRateReplies({ source: gate('first') })

    expect((await requestRow(cheaper)).status).toBe('accepted')
    expect((await requestRow(dearer)).status).toBe('parsed')
  })

  /** A reply that priced another lane is never awarded — not even alone (S14). */
  it('never awards a reply that priced a different lane', async () => {
    const id = await makeEnquiry()
    const wrongLane = await parsedReply(id, '100.000', undefined, undefined, {
      laneMismatch: 'CNSHA → KWSWK',
    })

    await autoPromoteRateReplies({ source: gate('first') })

    expect((await requestRow(wrongLane)).status).toBe('parsed')
  })

  /*
    R1: a reply a person must check is never awarded by the machine, even
    alone and even cheapest: a line kept as "other" for want of a charge
    type, or a stated total the lines do not reach.
  */
  it('never awards a reply that is flagged for review', async () => {
    const id = await makeEnquiry()
    const unclassified = await parsedReply(id, '100.000', undefined, undefined, {
      unclassified: [{ line: 2, description: 'Screening and handling' }],
    })
    const mismatched = await parsedReply(id, '200.000', undefined, undefined, {
      currency: 'KWD',
      statedTotal: '260.000',
      totals: [{ currency: 'KWD', amount: '200' }],
    })
    const clean = await parsedReply(id, '900.000')

    await autoPromoteRateReplies({ source: gate('first') })

    expect((await requestRow(unclassified)).status).toBe('parsed')
    expect((await requestRow(mismatched)).status).toBe('parsed')
    expect((await requestRow(clean)).status).toBe('accepted')
  })

  it('does nothing on its inert default', async () => {
    const id = await makeEnquiry()
    const reply = await parsedReply(id, '500.000')

    const result = await autoPromoteRateReplies({ source: gate('manual') })

    expect(result.enabled).toBe(false)
    expect((await requestRow(reply)).status).toBe('parsed')
  })

  it('holds under "all" while an agent is still outstanding', async () => {
    const id = await makeEnquiry()
    const reply = await parsedReply(id, '700.000')
    await sentReply(id)

    await autoPromoteRateReplies({ source: gate('all') })

    // A reply is still out, so nothing is awarded yet.
    expect((await requestRow(reply)).status).toBe('parsed')
  })

  it('awards under "all" once no agent is still outstanding', async () => {
    const id = await makeEnquiry()
    const reply = await parsedReply(id, '650.000')

    await autoPromoteRateReplies({ source: gate('all') })

    expect((await requestRow(reply)).status).toBe('accepted')
  })

  it('holds under "wait" until the window has passed', async () => {
    const fresh = await makeEnquiry()
    const recent = await parsedReply(fresh, '600.000') // created just now
    const old = await makeEnquiry()
    const lapsed = await parsedReply(old, '600.000', new Date(Date.now() - 48 * 3_600_000))

    await autoPromoteRateReplies({ source: gate('wait', 24) })

    // The recent one is inside the 24h window; the 48h-old one is past it.
    expect((await requestRow(recent)).status).toBe('parsed')
    expect((await requestRow(lapsed)).status).toBe('accepted')
  })
})
