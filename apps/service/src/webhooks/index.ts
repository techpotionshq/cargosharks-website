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
import { and, eq } from 'drizzle-orm'
import { inboundWebhookEvents, systemActor, withActor } from '@qabandi/db'
import { JOBS, getBoss, sendReceiptJob } from '../queue'
import { config } from '../config'

/**
 * The largest inbound-email body `/webhooks/email` accepts.
 *
 * Fastify's default is 1 MB, and a provider posts attachments base64-encoded in
 * the JSON — a third larger than the file — so any mail with a real attachment
 * over about 700 KB was refused with a 413 before the handler ran, and the
 * provider eventually gave up on it. A mailbox's own attachment ceiling
 * defaults to 25 MB; 40 MB carries that after encoding, with the envelope.
 * Oversized parts are still emptied downstream, as on the IMAP path.
 */
export const EMAIL_BODY_LIMIT_BYTES = 40 * 1024 * 1024

export async function webhooks(app: FastifyInstance): Promise<void> {
  // Raw body is required for signature verification; a parsed-then-restringified
  // body will not reproduce the bytes the provider signed.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => {
    try {
      done(null, { raw: body as Buffer, parsed: JSON.parse((body as Buffer).toString('utf8')) })
    } catch (error) {
      /*
        400, not the 500 an unmarked parser error becomes (ai-19). A provider
        retries a 5xx — Kapso and Postmark for hours — and a body that is not
        JSON will not become JSON on the tenth attempt.
      */
      done(Object.assign(error as Error, { statusCode: 400 }), undefined)
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
    /*
      A token must be configured to compare against — A14. With none set, a
      request that also omitted `hub.verify_token` compared `undefined ===
      undefined` and was answered, so anybody could complete the handshake and
      register this endpoint to a Meta app of their own.
    */
    const expected = config.WHATSAPP_WEBHOOK_VERIFY_TOKEN
    if (
      expected &&
      query['hub.mode'] === 'subscribe' &&
      typeof query['hub.verify_token'] === 'string' &&
      query['hub.verify_token'] === expected
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

    // Inbound messages open enquiries, and `sent` echoes are the business's own
    // replies — a coordinator on their phone or the Kapso inbox, which the
    // intake agent must hear about to stay quiet. A `delivered`/`read` status
    // has nothing to intake, so it is acknowledged and dropped here.
    const event = request.headers['x-webhook-event']
    if (
      typeof event === 'string' &&
      event !== '' &&
      event !== 'whatsapp.message.received' &&
      event !== 'whatsapp.message.sent'
    ) {
      return reply.code(202).send({ accepted: true, ignored: event })
    }

    await enqueueOnce(
      'whatsapp',
      whatsAppExternalId(request.headers['x-idempotency-key'], body.parsed),
      // The event name rides on the receipt: the worker sees only the payload.
      event === 'whatsapp.message.sent' ? { ...body.parsed, type: event } : body.parsed,
      JOBS.inboundWhatsApp,
    )
    return reply.code(202).send({ accepted: true })
  })

  /** Inbound email becomes an enquiry within a minute, attachments kept — FR-EQ-02. */
  app.post('/email', { bodyLimit: EMAIL_BODY_LIMIT_BYTES }, async (request, reply) => {
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
 * Records the receipt and makes sure a job is queued for it.
 *
 * The unique key on (provider, external_id) is what makes a redelivery of a
 * *processed* event a no-op. The comment here used to claim the enqueue was in
 * the receipt's transaction; it never was — the insert committed, and then
 * `boss.send` ran on its own connection. A send that failed after the commit
 * answered the provider 500, the provider retried, the retry hit the conflict
 * and returned 202 having queued nothing, and the event was lost.
 *
 * Two changes close that, without pretending to a distributed transaction:
 *
 *  - a redelivery of a receipt that is still **unprocessed** queues the job
 *    again instead of returning early, so the provider's own retry is the
 *    re-drive;
 *  - `runInboundRedrive` sweeps receipts left unprocessed (a send that failed
 *    and was never retried, a job that exhausted its retries) and re-queues
 *    them.
 *
 * A second job for one receipt is harmless: `ingestMessage` locks the receipt
 * and stops at `processed_at`, so whichever runs second files nothing.
 */
async function enqueueOnce(
  provider: string,
  externalId: string,
  payload: Record<string, unknown>,
  jobName: string,
): Promise<void> {
  const eventId = await withActor(systemActor(), async (tx) => {
    const inserted = await tx
      .insert(inboundWebhookEvents)
      .values({ provider, externalId, payload })
      .onConflictDoNothing()
      .returning({ id: inboundWebhookEvents.id })
    if (inserted.length > 0) return inserted[0]!.id

    // Seen before. Processed is done with; unprocessed still needs its job.
    const [existing] = await tx
      .select({ id: inboundWebhookEvents.id, processedAt: inboundWebhookEvents.processedAt })
      .from(inboundWebhookEvents)
      .where(
        and(
          eq(inboundWebhookEvents.provider, provider),
          eq(inboundWebhookEvents.externalId, externalId),
        ),
      )
      .limit(1)
    return existing && !existing.processedAt ? existing.id : null
  })

  if (!eventId) return // Already processed; the provider is retrying.

  // A throw here answers 500, and the provider's retry lands in the branch above.
  await sendReceiptJob(await getBoss(), jobName, eventId)
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
  /*
    Postmark sends its own id as `MessageID` and the sender's in `Headers`
    (ai-8). Neither was read, so every inbound mail fell through to the hash —
    and a redelivery differing by one byte (a re-stamped header, a retry
    counter) hashed differently and was filed twice.
  */
  const candidate =
    nonEmpty(payload.id) ??
    nonEmpty(payload.messageId) ??
    nonEmpty(payload.MessageID) ??
    nonEmpty(payload['message-id']) ??
    headerMessageId(payload.Headers)
  if (candidate) return candidate
  // No provider id means no idempotency key; hash the payload so a redelivery
  // of the identical body is still recognised.
  return createHmac('sha256', 'fallback').update(JSON.stringify(payload)).digest('hex')
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** The RFC 5322 `Message-ID` from Postmark's `Headers: [{ Name, Value }]`. */
function headerMessageId(headers: unknown): string | undefined {
  if (!Array.isArray(headers)) return undefined
  const found = headers.find(
    (h): h is { Name: string; Value: unknown } =>
      typeof h === 'object' &&
      h !== null &&
      typeof (h as { Name?: unknown }).Name === 'string' &&
      (h as { Name: string }).Name.toLowerCase() === 'message-id',
  )
  return found ? nonEmpty(found.Value) : undefined
}
