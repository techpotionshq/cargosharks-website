/**
 * The RFQ send drain backs off, and stops (V10).
 *
 * It used to retry every unsent row every minute, forever, with `limit 200`
 * and no order — an agent behind a relay that timed out after DATA got the
 * same RFQ every minute, and a pile of unsendable rows starved new ones. The
 * channel is a fake that refuses one address and accepts every other, so
 * leftovers from other suites drain out of the way instead of muddying this.
 */

import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import type { NotificationChannel } from '../ports/index'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const {
  branches,
  partnerContacts,
  partners,
  rateRequests,
  systemActor,
  withActor,
  workingCalendars,
} = await import('@qabandi/db')
const { sendRateRequests, MAX_SEND_ATTEMPTS } = await import('./rate-request-send')

const BRANCH = '00000000-0000-7000-8000-00000000f5a1'
const actor = systemActor()
const RUN = Date.now().toString(36).toLowerCase().slice(-6)
const REFUSED = `refused-${RUN}@rfq-retry.test`

/** Refuses `REFUSED`, accepts everyone else. */
const channel: NotificationChannel & { tried: string[] } = {
  key: 'email',
  tried: [],
  async send(message) {
    channel.tried.push(message.to)
    return message.to === REFUSED
      ? { accepted: false, error: 'relay timed out after DATA' }
      : { accepted: true, externalRef: 'ok' }
  },
}

async function request(email: string): Promise<string> {
  const partnerId = randomUUID()
  return withActor(actor, async (tx) => {
    await tx.insert(partners).values({
      id: partnerId,
      code: `AGT-RTY-${RUN}-${partnerId.slice(-6)}`,
      type: 'agent',
      legalNameEn: 'Retry Agent',
    })
    await tx.insert(partnerContacts).values({ partnerId, nameEn: 'Desk', email, isPrimary: true })
    const [row] = await tx
      .insert(rateRequests)
      .values({ branchId: BRANCH, partnerId, status: 'sent', token: `rty-${RUN}-${partnerId}` })
      .returning({ id: rateRequests.id })
    return row!.id
  })
}

const rowOf = async (id: string) => {
  const [row] = await withActor(actor, (tx) =>
    tx.select().from(rateRequests).where(eq(rateRequests.id, id)).limit(1),
  )
  return row!
}

/** Sweep until a sweep sends nothing new — other suites' leftovers drain first. */
async function drain(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const result = await sendRateRequests({ channel })
    if (result.sent === 0) return
  }
}

describe.skipIf(!enabled)('sendRateRequests retrying', () => {
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
          code: 'RTY',
          legalNameEn: 'RFQ Retry Branch',
          legalNameAr: 'فرع',
          country: 'KW',
          baseCurrency: 'KWD',
          invoiceSeries: 'RTY',
          calendarId: calendar.id,
        })
        .onConflictDoNothing(),
    )
  })

  it('records a refused send and waits before trying it again', async () => {
    const id = await request(REFUSED)

    await drain()
    const first = await rowOf(id)
    expect(first.sentAt).toBeNull()
    expect(first.sendAttempts).toBe(1)
    expect(first.sendError).toContain('timed out')

    // Straight away again: not due yet, so not mailed again.
    channel.tried.length = 0
    await sendRateRequests({ channel })
    expect(channel.tried).not.toContain(REFUSED)
    expect((await rowOf(id)).sendAttempts).toBe(1)

    // Once the wait has passed it is tried again.
    await withActor(actor, (tx) =>
      tx
        .update(rateRequests)
        .set({ lastSendAttemptAt: new Date(Date.now() - 60 * 60_000) })
        .where(eq(rateRequests.id, id)),
    )
    await sendRateRequests({ channel })
    expect((await rowOf(id)).sendAttempts).toBe(2)
  })

  it('stops trying after the ceiling, and leaves the reason', async () => {
    const id = await request(REFUSED)
    await withActor(actor, (tx) =>
      tx
        .update(rateRequests)
        .set({ sendAttempts: MAX_SEND_ATTEMPTS, lastSendAttemptAt: new Date(0) })
        .where(eq(rateRequests.id, id)),
    )

    channel.tried.length = 0
    await sendRateRequests({ channel })

    expect(channel.tried).not.toContain(REFUSED)
    expect((await rowOf(id)).sendAttempts).toBe(MAX_SEND_ATTEMPTS)
  })

  it('still sends a new request behind ones that keep failing', async () => {
    const good = await request(`good-${RUN}@rfq-retry.test`)

    await drain()

    expect((await rowOf(good)).sentAt).not.toBeNull()
  })
})
