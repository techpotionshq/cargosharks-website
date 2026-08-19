/**
 * The inbound webhook edge.
 *
 * Three routes, one shape: verify the signature, record the receipt, enqueue
 * the work. Everything interesting is in what happens when one of those goes
 * wrong, and none of it is visible from a screen.
 *
 * **The signature is over the raw bytes.** A parsed-then-restringified body
 * does not reproduce what the provider signed — different key order, different
 * whitespace, different digest — so the content-type parser keeps the buffer.
 * The test for this sends a body no `JSON.stringify` would produce.
 *
 * **The signature is required, not optional-if-unconfigured.** These endpoints
 * write to shipment history: an unauthenticated caller who reached
 * `/terminal49` could move a discharge date, and a demurrage figure moves with
 * it. A deployment that has not set the secret has not finished configuring
 * the integration and must refuse rather than accept.
 *
 * **A redelivery is a no-op, not a second enquiry.** Providers retry. The
 * unique key on `(provider, external_id)` is what makes the second delivery
 * cost nothing, and the enqueue happens only for the insert that won — so one
 * inbound email cannot become three.
 *
 * **Anything recorded is acknowledged.** A 4xx or 5xx for an event the system
 * simply does not map teaches the provider to redeliver for ever, and
 * Terminal49 sends lifecycle events that are not milestones by design.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import type { Actor } from '@qabandi/db'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const WHATSAPP_SECRET = 'whatsapp-app-secret'
const EMAIL_SECRET = 'inbound-email-secret'
const CARRIER_SECRET = 'carrier-webhook-secret'
const VERIFY_TOKEN = 'meta-verify-token'

const harness = vi.hoisted(() => ({
  sent: [] as { name: string; data: unknown }[],
  /** Cleared per test so "no secret configured" can be posed. */
  carrierSecret: undefined as string | undefined,
}))

vi.mock('../config', () => ({
  config: {
    get WHATSAPP_APP_SECRET() {
      return WHATSAPP_SECRET
    },
    get INBOUND_EMAIL_WEBHOOK_SECRET() {
      return EMAIL_SECRET
    },
    get CARRIER_WEBHOOK_SECRET() {
      return harness.carrierSecret
    },
    get WHATSAPP_WEBHOOK_VERIFY_TOKEN() {
      return VERIFY_TOKEN
    },
  },
}))

/*
  The queue is stubbed rather than run. What matters here is *whether* a job
  was sent and how many times — pg-boss having actually written a row is its
  own concern and needs a running boss.
*/
vi.mock('../queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../queue')>()),
  getBoss: async () => ({
    send: async (name: string, data: unknown) => {
      harness.sent.push({ name, data })
      return 'job-id'
    },
  }),
}))

const { inboundWebhookEvents, withActor } = await import('@qabandi/db')
const { webhooks } = await import('./index')
const { JOBS } = await import('../queue')

const systemActor: Actor = {
  principalId: '00000000-0000-7000-8000-0000000000a1',
  type: 'system',
  branchIds: [],
}

const RUN = Date.now().toString(36).toUpperCase().slice(-6)
let seq = 0

let app: FastifyInstance

/** Exactly the bytes the provider signed, and the digest over them. */
const sign = (raw: string, secret: string, prefix = '') =>
  prefix + createHmac('sha256', secret).update(Buffer.from(raw)).digest('hex')

const post = (url: string, raw: string, headers: Record<string, string>) =>
  app.inject({
    method: 'POST',
    url,
    payload: raw,
    headers: { 'content-type': 'application/json', ...headers },
  })

const body = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ id: `wh-${RUN}-${(seq += 1)}`, ...over })

const recorded = async (externalId: string) =>
  withActor(systemActor, (tx) =>
    tx
      .select({ id: inboundWebhookEvents.id, provider: inboundWebhookEvents.provider })
      .from(inboundWebhookEvents)
      .where(eq(inboundWebhookEvents.externalId, externalId)),
  )

describe.skipIf(!enabled)('the inbound webhook edge', () => {
  beforeAll(async () => {
    app = Fastify()
    await app.register(webhooks)
    await app.ready()
  })

  afterEach(() => {
    harness.sent.length = 0
    harness.carrierSecret = CARRIER_SECRET
  })

  afterAll(async () => {
    await app.close()
  })

  describe('Meta’s verification handshake', () => {
    it('echoes the challenge back when the token matches', async () => {
      const reply = await app.inject({
        method: 'GET',
        url: `/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=12345`,
      })

      expect(reply.statusCode).toBe(200)
      expect(reply.body).toBe('12345')
    })

    it('refuses a token that is not ours', async () => {
      const reply = await app.inject({
        method: 'GET',
        url: '/whatsapp?hub.mode=subscribe&hub.verify_token=guessed&hub.challenge=12345',
      })

      expect(reply.statusCode).toBe(403)
    })

    it('refuses a mode that is not a subscription', async () => {
      const reply = await app.inject({
        method: 'GET',
        url: `/whatsapp?hub.mode=unsubscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1`,
      })

      expect(reply.statusCode).toBe(403)
    })
  })

  describe('the signature', () => {
    it('accepts a correctly signed delivery', async () => {
      const raw = body()

      const reply = await post('/terminal49', raw, {
        'x-t49-webhook-signature': sign(raw, CARRIER_SECRET),
      })

      expect(reply.statusCode).toBe(202)
      expect(JSON.parse(reply.body)).toEqual({ accepted: true })
    })

    it('refuses a signature computed with the wrong secret', async () => {
      const raw = body()

      const reply = await post('/terminal49', raw, {
        'x-t49-webhook-signature': sign(raw, 'not-the-secret'),
      })

      expect(reply.statusCode).toBe(401)
      expect(JSON.parse(reply.body)).toEqual({ error: 'bad_signature' })
      expect(harness.sent).toEqual([])
    })

    it('refuses a delivery with no signature at all', async () => {
      const reply = await post('/terminal49', body(), {})

      expect(reply.statusCode).toBe(401)
    })

    /**
     * `timingSafeEqual` throws on a length mismatch, so the comparison is
     * length-guarded first. Without the guard a one-character header is a 500
     * — which tells an attacker their guess was the wrong *shape*, and turns a
     * refusal into a crash.
     */
    it('refuses a signature of the wrong length without falling over', async () => {
      const reply = await post('/terminal49', body(), { 'x-t49-webhook-signature': 'ab' })

      expect(reply.statusCode).toBe(401)
    })

    /**
     * The rule this endpoint states at length. An unauthenticated caller who
     * reached it could move a discharge date, and a demurrage figure moves
     * with it — so an unconfigured deployment refuses rather than accepts.
     */
    it('refuses everything when no secret is configured', async () => {
      harness.carrierSecret = undefined
      const raw = body()

      const reply = await post('/terminal49', raw, {
        'x-t49-webhook-signature': sign(raw, CARRIER_SECRET),
      })

      expect(reply.statusCode).toBe(401)
      expect(harness.sent).toEqual([])
    })

    /**
     * Signed over the bytes, not over the meaning.
     *
     * This body has whitespace and a key order no `JSON.stringify` would
     * produce, so a handler that reparsed and restringified before verifying
     * would compute a different digest and reject a genuine delivery.
     */
    it('verifies the bytes the provider sent, not a reserialised copy', async () => {
      const raw = `{\n  "zeta": 1,\n  "id": "raw-${RUN}",\n   "alpha": 2\n}`

      const reply = await post('/terminal49', raw, {
        'x-t49-webhook-signature': sign(raw, CARRIER_SECRET),
      })

      expect(reply.statusCode).toBe(202)
      expect(await recorded(`raw-${RUN}`)).toHaveLength(1)
    })

    /** WhatsApp prefixes its digest; the others do not. */
    it('expects Meta’s sha256= prefix on the WhatsApp digest', async () => {
      const raw = body()

      const prefixed = await post('/whatsapp', raw, {
        'x-hub-signature-256': sign(raw, WHATSAPP_SECRET, 'sha256='),
      })
      const bare = await post('/whatsapp', body(), {
        'x-hub-signature-256': sign(raw, WHATSAPP_SECRET),
      })

      expect(prefixed.statusCode).toBe(202)
      expect(bare.statusCode).toBe(401)
    })

    it('reads each route’s own header and secret', async () => {
      const raw = body()

      const email = await post('/email', raw, {
        'x-webhook-signature': sign(raw, EMAIL_SECRET),
      })
      // The email secret is not the carrier one, and the header differs too.
      const crossed = await post('/email', raw, {
        'x-t49-webhook-signature': sign(raw, EMAIL_SECRET),
      })

      expect(email.statusCode).toBe(202)
      expect(crossed.statusCode).toBe(401)
    })
  })

  describe('recording and enqueueing', () => {
    it('records the receipt and enqueues the work once', async () => {
      const id = `once-${RUN}`
      const raw = body({ id })

      await post('/terminal49', raw, { 'x-t49-webhook-signature': sign(raw, CARRIER_SECRET) })

      expect(await recorded(id)).toHaveLength(1)
      expect(harness.sent).toEqual([{ name: JOBS.carrierEvent, data: { eventId: expect.any(String) } }])
    })

    /**
     * Providers retry. The unique key on `(provider, external_id)` is what
     * makes the second delivery cost nothing — without it one inbound email
     * becomes three enquiries the first time a provider redelivers.
     */
    it('treats a redelivery as a no-op', async () => {
      const id = `retry-${RUN}`
      const raw = body({ id })
      const headers = { 'x-t49-webhook-signature': sign(raw, CARRIER_SECRET) }

      const first = await post('/terminal49', raw, headers)
      harness.sent.length = 0
      const second = await post('/terminal49', raw, headers)

      // Acknowledged both times — a 4xx would teach the provider to keep going.
      expect(first.statusCode).toBe(202)
      expect(second.statusCode).toBe(202)
      expect(await recorded(id)).toHaveLength(1)
      expect(harness.sent).toEqual([])
    })

    it('sends each provider’s deliveries to its own job', async () => {
      const whatsappRaw = body()
      const emailRaw = body()

      await post('/whatsapp', whatsappRaw, {
        'x-hub-signature-256': sign(whatsappRaw, WHATSAPP_SECRET, 'sha256='),
      })
      await post('/email', emailRaw, { 'x-webhook-signature': sign(emailRaw, EMAIL_SECRET) })

      expect(harness.sent.map((job) => job.name)).toEqual([
        JOBS.inboundWhatsApp,
        JOBS.inboundEmail,
      ])
    })

    /** The same id from two providers is two events, not a collision. */
    it('scopes the idempotency key to the provider', async () => {
      const id = `shared-${RUN}`
      const raw = body({ id })

      await post('/terminal49', raw, { 'x-t49-webhook-signature': sign(raw, CARRIER_SECRET) })
      await post('/email', raw, { 'x-webhook-signature': sign(raw, EMAIL_SECRET) })

      const rows = await recorded(id)
      expect(rows.map((row) => row.provider).sort()).toEqual(['email', 'terminal49'])
    })
  })

  describe('an identifier the provider did not give', () => {
    /**
     * No provider id means no idempotency key, so the payload itself is
     * hashed — a redelivery of the identical body is still recognised, which
     * is the property that actually matters.
     */
    it('falls back to hashing the payload, and still deduplicates', async () => {
      const raw = JSON.stringify({ noIdHere: `payload-${RUN}` })
      const headers = { 'x-t49-webhook-signature': sign(raw, CARRIER_SECRET) }

      await post('/terminal49', raw, headers)
      harness.sent.length = 0
      const second = await post('/terminal49', raw, headers)

      expect(second.statusCode).toBe(202)
      expect(harness.sent).toEqual([])
    })

    it('treats a different payload as a different event', async () => {
      const first = JSON.stringify({ noIdHere: `a-${RUN}` })
      const second = JSON.stringify({ noIdHere: `b-${RUN}` })

      await post('/terminal49', first, { 'x-t49-webhook-signature': sign(first, CARRIER_SECRET) })
      await post('/terminal49', second, { 'x-t49-webhook-signature': sign(second, CARRIER_SECRET) })

      expect(harness.sent).toHaveLength(2)
    })

    /** `messageId` and `message-id` are what the mail providers actually send. */
    it('accepts the identifiers a mail provider uses', async () => {
      const camel = JSON.stringify({ messageId: `camel-${RUN}` })
      const hyphen = JSON.stringify({ 'message-id': `hyphen-${RUN}` })

      await post('/email', camel, { 'x-webhook-signature': sign(camel, EMAIL_SECRET) })
      await post('/email', hyphen, { 'x-webhook-signature': sign(hyphen, EMAIL_SECRET) })

      expect(await recorded(`camel-${RUN}`)).toHaveLength(1)
      expect(await recorded(`hyphen-${RUN}`)).toHaveLength(1)
    })
  })

  describe('a body that is not JSON', () => {
    /** The parser refuses it before any handler runs, and nothing is recorded. */
    it('refuses it without recording anything', async () => {
      const reply = await post('/terminal49', '{not json at all', {
        'x-t49-webhook-signature': 'whatever',
      })

      expect(reply.statusCode).toBeGreaterThanOrEqual(400)
      expect(harness.sent).toEqual([])
    })
  })
})
