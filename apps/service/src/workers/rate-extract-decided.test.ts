/**
 * A late reading never reopens a decided rate request (V15).
 *
 * `extractRateReply` runs as a pg-boss job, so a retry can land minutes after a
 * person — or the auto-promote sweep — accepted, declined or superseded the
 * request it is reading. It used to write `parsed`/`declined` whatever the row
 * said by then, putting an accepted request back on the comparison board. The
 * model is mocked: what is pinned is the write, not the reading.
 */

import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { eq, inArray } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

vi.mock('../ai/ledger', () => ({
  invoke: async () => ({
    invocationId: '00000000-0000-7000-8000-00000000e0e1',
    reused: false,
    response: {
      model: 'test/model',
      text: JSON.stringify({ declined: true, declinedReason: 'no space', confidence: 0.9 }),
      toolCalls: [],
      inputTokens: 0,
      outputTokens: 0,
      finishReason: 'stop',
      raw: {},
    },
  }),
}))

const {
  branches,
  enquiries,
  locations,
  messages,
  partners,
  rateRequests,
  systemActor,
  withActor,
  workingCalendars,
} = await import('@qabandi/db')
const { extractRateReply } = await import('./rate-extract')

const BRANCH = '00000000-0000-7000-8000-00000000f5e1'
const actor = systemActor()
const RUN = Date.now().toString(36).toUpperCase().slice(-5)
let seq = 0

/** A request in `status`, on an enquiry with a coded lane, with a reply filed. */
async function request(status: 'responded' | 'accepted' | 'superseded') {
  seq += 1
  return withActor(actor, async (tx) => {
    const ports = await tx
      .select({ id: locations.id, code: locations.unlocode })
      .from(locations)
      .where(inArray(locations.unlocode, ['CNSHA', 'KWSWK']))
    const id = (code: string) => ports.find((p) => p.code === code)!.id

    const [enquiry] = await tx
      .insert(enquiries)
      .values({
        reference: `RXD-${RUN}-${seq}`,
        branchId: BRANCH,
        status: 'rating',
        channel: 'email',
        mode: 'sea_fcl',
        originId: id('CNSHA'),
        destinationId: id('KWSWK'),
      })
      .returning({ id: enquiries.id })
    const partnerId = randomUUID()
    await tx
      .insert(partners)
      .values({ id: partnerId, code: `AGT-RXD-${RUN}-${seq}`, type: 'agent', legalNameEn: 'RXD' })
    const [message] = await tx
      .insert(messages)
      .values({
        branchId: BRANCH,
        enquiryId: enquiry!.id,
        channel: 'email',
        direction: 'inbound',
        body: 'Sorry, no space this week.',
      })
      .returning({ id: messages.id })
    const [row] = await tx
      .insert(rateRequests)
      .values({
        branchId: BRANCH,
        enquiryId: enquiry!.id,
        partnerId,
        status,
        token: `rxd-${RUN}-${seq}`,
        messageId: message!.id,
      })
      .returning({ id: rateRequests.id })
    return { id: row!.id, messageId: message!.id }
  })
}

const statusOf = async (id: string) => {
  const [row] = await withActor(actor, (tx) =>
    tx
      .select({ status: rateRequests.status })
      .from(rateRequests)
      .where(eq(rateRequests.id, id))
      .limit(1),
  )
  return row!.status
}

describe.skipIf(!enabled)('extractRateReply against a decided request', () => {
  beforeAll(async () => {
    const [calendar] = await withActor(actor, (tx) =>
      tx
        .select({ id: workingCalendars.id })
        .from(workingCalendars)
        .where(eq(workingCalendars.key, 'kuwait'))
        .limit(1),
    )
    if (!calendar) throw new Error('Run `pnpm db:seed` before this suite')
    await withActor(actor, (tx) =>
      tx
        .insert(branches)
        .values({
          id: BRANCH,
          code: 'RXF',
          legalNameEn: 'Rate Extract Decided Branch',
          legalNameAr: 'فرع',
          country: 'KW',
          baseCurrency: 'KWD',
          invoiceSeries: 'RXF',
          calendarId: calendar.id,
        })
        .onConflictDoNothing(),
    )
  })

  it('writes the reading onto a request still waiting for it', async () => {
    const req = await request('responded')
    const result = await extractRateReply({
      branchId: BRANCH,
      rateRequestId: req.id,
      messageId: req.messageId,
    })
    expect(result.skipped).toBeUndefined()
    expect(await statusOf(req.id)).toBe('declined')
  })

  it.each(['accepted', 'superseded'] as const)(
    'leaves an %s request as it was decided',
    async (status) => {
      const req = await request(status)
      const result = await extractRateReply({
        branchId: BRANCH,
        rateRequestId: req.id,
        messageId: req.messageId,
      })
      expect(result.skipped).toBe('request_already_decided')
      expect(await statusOf(req.id)).toBe(status)
    },
  )
})
