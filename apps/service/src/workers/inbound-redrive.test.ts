/**
 * The re-drive sweep under the inbound webhook routes (V8).
 *
 * A receipt recorded but never processed — the send that failed after the
 * receipt committed, the job that spent its retries — is queued again; a
 * settled one, a busy one, an IMAP one and an old one are not. The send is
 * captured rather than run: whether pg-boss wrote a row is its own concern.
 */

import { describe, expect, it } from 'vitest'
import { inArray } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const { inboundWebhookEvents, systemActor, withActor } = await import('@qabandi/db')
const { runInboundRedrive } = await import('./inbound-redrive')
const { JOBS } = await import('../queue')

const RUN = Date.now().toString(36).toUpperCase().slice(-6)
const NOW = new Date()
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000)

async function receipt(over: {
  provider: string
  processedAt?: Date
  createdAt: Date
  updatedAt: Date
}): Promise<string> {
  const [row] = await withActor(systemActor(), (tx) =>
    tx
      .insert(inboundWebhookEvents)
      .values({
        provider: over.provider,
        externalId: `redrive-${RUN}-${Math.random().toString(36).slice(2)}`,
        payload: {},
        processedAt: over.processedAt ?? null,
        createdAt: over.createdAt,
        updatedAt: over.updatedAt,
      })
      .returning({ id: inboundWebhookEvents.id }),
  )
  return row!.id
}

describe.skipIf(!enabled)('runInboundRedrive', () => {
  it('re-queues a stuck receipt and leaves the rest alone', async () => {
    const stuckEmail = await receipt({
      provider: 'email',
      createdAt: minutesAgo(30),
      updatedAt: minutesAgo(30),
    })
    const stuckWhatsApp = await receipt({
      provider: 'whatsapp',
      createdAt: minutesAgo(60),
      updatedAt: minutesAgo(20),
    })
    const settled = await receipt({
      provider: 'email',
      processedAt: minutesAgo(29),
      createdAt: minutesAgo(30),
      updatedAt: minutesAgo(29),
    })
    const busy = await receipt({
      provider: 'email',
      createdAt: minutesAgo(30),
      updatedAt: minutesAgo(1),
    })
    const polled = await receipt({
      provider: 'imap',
      createdAt: minutesAgo(30),
      updatedAt: minutesAgo(30),
    })
    const ancient = await receipt({
      provider: 'email',
      createdAt: minutesAgo(8 * 24 * 60),
      updatedAt: minutesAgo(8 * 24 * 60),
    })
    const mine = new Set([stuckEmail, stuckWhatsApp, settled, busy, polled, ancient])

    /*
      Swept until ours have all been seen. The table is shared and only ever
      grows, so one batch of a hundred may be other suites' leftovers.
    */
    const sent: { job: string; id: string }[] = []
    for (let sweep = 0; sweep < 50; sweep++) {
      const before = sent.length
      await runInboundRedrive(async (job, id) => {
        sent.push({ job, id })
        // Settle it as the worker would, so the next sweep moves past it.
        await withActor(systemActor(), (tx) =>
          tx
            .update(inboundWebhookEvents)
            .set({ processedAt: NOW })
            .where(inArray(inboundWebhookEvents.id, [id])),
        )
      }, NOW)
      if (sent.length === before) break
    }

    const ours = sent.filter((s) => mine.has(s.id))
    expect(ours).toEqual(
      expect.arrayContaining([
        { job: JOBS.inboundEmail, id: stuckEmail },
        { job: JOBS.inboundWhatsApp, id: stuckWhatsApp },
      ]),
    )
    expect(ours).toHaveLength(2)
  })
})
