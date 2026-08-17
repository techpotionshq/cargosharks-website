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

  /**
   * Container events from Terminal49 — the ingestion half of `CarrierTracking`.
   *
   * The provider has no polling endpoint: a shipment is submitted once and its
   * events arrive here from then on. So this route is not a convenience, it is
   * the only way carrier milestones reach a job automatically.
   *
   * Answers 202 for anything it has recorded, including payloads it cannot
   * use. A webhook that returns 4xx or 5xx for an event it simply does not map
   * teaches the provider to redeliver forever — and Terminal49 sends lifecycle
   * events (`tracking_request.succeeded`) that are not milestones by design.
   * Recorded, acknowledged, and dropped by the worker with a reason.
   */
  app.post('/terminal49', async (request, reply) => {
    const body = request.body as { raw: Buffer; parsed: Record<string, unknown> }

    /*
      The signature is required, not optional-if-unconfigured.

      This endpoint writes to shipment history. An unauthenticated caller who
      could reach it could move a discharge date, and a demurrage figure moves
      with it. A deployment that has not set the secret has not finished
      configuring the integration, and should refuse rather than accept.
    */
    if (
      !verifyHmac(
        body.raw,
        request.headers['x-t49-webhook-signature'],
        config.CARRIER_WEBHOOK_SECRET,
      )
    ) {
      return reply.code(401).send({ error: 'bad_signature' })
    }

    await enqueueOnce('terminal49', externalId(body.parsed), body.parsed, JOBS.carrierEvent)
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
