/**
 * Inbound webhooks — WhatsApp, email and FX (§3, §9).
 *
 * Every handler does the same three things and nothing more: verify the
 * signature, record the receipt for idempotency, enqueue the work. Providers
 * redeliver, and a webhook that does real work inline turns one inbound email
 * into three enquiries the first time a provider retries.
 */

import type { FastifyInstance } from 'fastify'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { inboundWebhookEvents, systemActor, withActor } from '@qabandi/db'
import { JOBS, getBoss } from '../queue'
import { config } from '../config'

export async function webhooks(app: FastifyInstance): Promise<void> {
  // Raw body is required for signature verification; a parsed-then-restringified
  // body will not reproduce the bytes the provider signed.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => {
    try {
      done(null, { raw: body as Buffer, parsed: JSON.parse((body as Buffer).toString('utf8')) })
    } catch (error) {
      done(error as Error, undefined)
    }
  })

  /** Meta's verification handshake, performed once at subscription time. */
  app.get<{ Querystring: Record<string, string> }>('/whatsapp', async (request, reply) => {
    const query = request.query
    if (
      query['hub.mode'] === 'subscribe' &&
      query['hub.verify_token'] === config.WHATSAPP_WEBHOOK_VERIFY_TOKEN
    ) {
      return reply.code(200).send(query['hub.challenge'])
    }
    return reply.code(403).send({ error: 'forbidden' })
  })

  app.post('/whatsapp', async (request, reply) => {
    const body = request.body as { raw: Buffer; parsed: Record<string, unknown> }
    const signature = request.headers['x-hub-signature-256']

    if (!verifyHmac(body.raw, signature, config.WHATSAPP_APP_SECRET, 'sha256=')) {
      return reply.code(401).send({ error: 'bad_signature' })
    }

    await enqueueOnce('whatsapp', externalId(body.parsed), body.parsed, JOBS.inboundWhatsApp)
    return reply.code(202).send({ accepted: true })
  })

  /** Inbound email becomes an enquiry within a minute, attachments kept — FR-EQ-02. */
  app.post('/email', async (request, reply) => {
    const body = request.body as { raw: Buffer; parsed: Record<string, unknown> }
    const signature = request.headers['x-webhook-signature']

    if (!verifyHmac(body.raw, signature, config.INBOUND_EMAIL_WEBHOOK_SECRET)) {
      return reply.code(401).send({ error: 'bad_signature' })
    }

    await enqueueOnce('email', externalId(body.parsed), body.parsed, JOBS.inboundEmail)
    return reply.code(202).send({ accepted: true })
  })
}

/**
 * Records the receipt and enqueues once.
 *
 * The unique key on (provider, external_id) is what makes a redelivery a
 * no-op. The enqueue happens in the same transaction as the receipt, so a
 * crash between the two cannot leave a recorded-but-unqueued event.
 */
async function enqueueOnce(
  provider: string,
  externalId: string,
  payload: Record<string, unknown>,
  jobName: string,
): Promise<void> {
  const inserted = await withActor(systemActor(), async (tx) =>
    tx
      .insert(inboundWebhookEvents)
      .values({ provider, externalId, payload })
      .onConflictDoNothing()
      .returning({ id: inboundWebhookEvents.id }),
  )

  if (inserted.length === 0) return // Already seen; the provider is retrying.

  const boss = await getBoss()
  await boss.send(jobName, { eventId: inserted[0]!.id })
}

function verifyHmac(
  raw: Buffer,
  header: unknown,
  secret: string | undefined,
  prefix = '',
): boolean {
  if (!secret || typeof header !== 'string') return false
  const expected = prefix + createHmac('sha256', secret).update(raw).digest('hex')
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function externalId(payload: Record<string, unknown>): string {
  const candidate =
    (payload.id as string | undefined) ??
    (payload.messageId as string | undefined) ??
    (payload['message-id'] as string | undefined)
  if (candidate) return candidate
  // No provider id means no idempotency key; hash the payload so a redelivery
  // of the identical body is still recognised.
  return createHmac('sha256', 'fallback').update(JSON.stringify(payload)).digest('hex')
}
