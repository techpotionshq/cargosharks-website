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

  /**
   * Meta's verification handshake — the *direct* Cloud-API path, not Kapso.
   *
   * Kapso is the transport now (below), and it needs no `hub.challenge`
   * handshake: its webhook is registered through its own API. This is kept for a
   * deployment wired straight to Meta, and answers only when
   * `WHATSAPP_WEBHOOK_VERIFY_TOKEN` is set.
   */
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

  /**
   * Inbound WhatsApp through Kapso — FR-EQ-02, the other channel.
   *
   * Kapso signs the raw body with HMAC-SHA256 and sends the hex digest in
   * `X-Webhook-Signature` (no `sha256=` prefix) — byte-identical to the email
   * webhook below, and verified by the same `verifyHmac`. Idempotency uses
   * Kapso's own `X-Idempotency-Key` header, which is the key Kapso deduplicates
   * on; only if a delivery omitted it do we fall back to the message's wamid.
   */
  app.post('/whatsapp', async (request, reply) => {
    const body = request.body as { raw: Buffer; parsed: Record<string, unknown> }
    const signature = request.headers['x-webhook-signature']

    if (!verifyHmac(body.raw, signature, config.KAPSO_WEBHOOK_SECRET)) {
      return reply.code(401).send({ error: 'bad_signature' })
    }

    // Only inbound messages open enquiries; a `sent`/`delivered`/`read` status
    // event has nothing to intake, so it is acknowledged and dropped here rather
    // than queued and skipped by the worker.
    const event = request.headers['x-webhook-event']
    if (typeof event === 'string' && event !== '' && event !== 'whatsapp.message.received') {
      return reply.code(202).send({ accepted: true, ignored: event })
    }

    await enqueueOnce(
      'whatsapp',
      whatsAppExternalId(request.headers['x-idempotency-key'], body.parsed),
      body.parsed,
      JOBS.inboundWhatsApp,
    )
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

/**
 * Kapso's idempotency key, or the message's wamid as a fallback.
 *
 * Kapso stamps `X-Idempotency-Key` on every delivery and deduplicates on it, so
 * it is the right key for our `(provider, external_id)` uniqueness too. A
 * delivery that somehow omitted it falls back to the wamid at `message.id`,
 * which identifies the message just as well; only a payload with neither is
 * hashed by `externalId`, so a redelivery of the identical body is still caught.
 */
function whatsAppExternalId(header: unknown, payload: Record<string, unknown>): string {
  if (typeof header === 'string' && header.trim() !== '') return header.trim()
  const message = payload.message
  if (message && typeof message === 'object') {
    const id = (message as Record<string, unknown>).id
    if (typeof id === 'string' && id.trim() !== '') return id.trim()
  }
  return externalId(payload)
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
