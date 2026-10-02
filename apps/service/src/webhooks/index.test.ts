/**
 * The inbound webhook edge.
 *
 * Two routes, one shape: verify the signature, record the receipt, enqueue
 * the work. Everything interesting is in what happens when one of those goes
 * wrong, and none of it is visible from a screen.
 *
 * **The signature is over the raw bytes.** A parsed-then-restringified body
 * does not reproduce what the provider signed — different key order, different
 * whitespace, different digest — so the content-type parser keeps the buffer.
 * The test for this sends a body no `JSON.stringify` would produce.
 *
 * **The signature is required, not optional-if-unconfigured.** These endpoints
 * put work in front of a coordinator: an unauthenticated caller who reached
 * `/email` could raise an enquiry in a customer's name. A deployment that has
 * not set the secret has not finished configuring the integration and must
 * refuse rather than accept.
 *
 * **A redelivery is a no-op, not a second enquiry.** Providers retry. The
 * unique key on `(provider, external_id)` is what makes the second delivery of
 * a *processed* event cost nothing — so one inbound email cannot become three.
 * A redelivery of an event still unprocessed queues its job again: the first
 * send may be exactly what failed, and the worker refuses to file twice.
 *
 * **Anything recorded is acknowledged.** A 4xx or 5xx for a payload the
 * system simply does not understand teaches the provider to redeliver for
 * ever. Recorded, acknowledged, and dropped by the worker with a reason.
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
/** Kapso's webhook signing secret — the one the WhatsApp POST route verifies now. */
const KAPSO_SECRET = 'kapso-webhook-secret'
const EMAIL_SECRET = 'inbound-email-secret'
const VERIFY_TOKEN = 'meta-verify-token'

const harness = vi.hoisted(() => ({
  sent: [] as { name: string; data: unknown }[],
  /** Set to make the next `boss.send` throw, as a queue that is down does. */
  failNext: false,
  /** Cleared per test so "no secret configured" can be posed. */
  emailSecret: undefined as string | undefined,
  /** Unset per test so "no verify token configured" can be posed (A14). */
  verifyTokenUnset: false,
}))

vi.mock('../config', () => ({
  config: {
    get WHATSAPP_APP_SECRET() {
      return WHATSAPP_SECRET
    },
    get KAPSO_WEBHOOK_SECRET() {
      return KAPSO_SECRET
    },
    get INBOUND_EMAIL_WEBHOOK_SECRET() {
      return harness.emailSecret
    },
    get WHATSAPP_WEBHOOK_VERIFY_TOKEN() {
      return harness.verifyTokenUnset ? undefined : VERIFY_TOKEN
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
      if (harness.failNext) {
        harness.failNext = false
        throw new Error('queue unavailable')
      }
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

/** What the worker does once it has filed the event. */
const markProcessed = async (externalId: string) =>
  withActor(systemActor, (tx) =>
    tx
      .update(inboundWebhookEvents)
      .set({ processedAt: new Date() })
      .where(eq(inboundWebhookEvents.externalId, externalId)),
  )

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
    harness.failNext = false
    harness.emailSecret = EMAIL_SECRET
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

    /**
     * A14. With no token configured, a request that also sent none compared
     * `undefined === undefined` and was answered.
     */
    it('answers nobody when no verify token is configured', async () => {
      harness.verifyTokenUnset = true
      try {
        const reply = await app.inject({
          method: 'GET',
          url: '/whatsapp?hub.mode=subscribe&hub.challenge=12345',
        })
        expect(reply.statusCode).toBe(403)
        expect(reply.body).not.toBe('12345')
      } finally {
        harness.verifyTokenUnset = false
      }
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

      const reply = await post('/email', raw, {
        'x-webhook-signature': sign(raw, EMAIL_SECRET),
      })

      expect(reply.statusCode).toBe(202)
      expect(JSON.parse(reply.body)).toEqual({ accepted: true })
    })

    it('refuses a signature computed with the wrong secret', async () => {
      const raw = body()

      const reply = await post('/email', raw, {
        'x-webhook-signature': sign(raw, 'not-the-secret'),
      })

      expect(reply.statusCode).toBe(401)
      expect(JSON.parse(reply.body)).toEqual({ error: 'bad_signature' })
      expect(harness.sent).toEqual([])
    })

    it('refuses a delivery with no signature at all', async () => {
      const reply = await post('/email', body(), {})

      expect(reply.statusCode).toBe(401)
    })

    /**
     * `timingSafeEqual` throws on a length mismatch, so the comparison is
     * length-guarded first. Without the guard a one-character header is a 500
     * — which tells an attacker their guess was the wrong *shape*, and turns a
     * refusal into a crash.
     */
    it('refuses a signature of the wrong length without falling over', async () => {
      const reply = await post('/email', body(), { 'x-webhook-signature': 'ab' })

      expect(reply.statusCode).toBe(401)
    })

    /**
     * The rule this endpoint states at length. An unauthenticated caller who
     * reached it could raise an enquiry in a customer's name — so an
     * unconfigured deployment refuses rather than accepts.
     */
    it('refuses everything when no secret is configured', async () => {
      harness.emailSecret = undefined
      const raw = body()

      const reply = await post('/email', raw, {
        'x-webhook-signature': sign(raw, EMAIL_SECRET),
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

      const reply = await post('/email', raw, {
        'x-webhook-signature': sign(raw, EMAIL_SECRET),
      })

      expect(reply.statusCode).toBe(202)
      expect(await recorded(`raw-${RUN}`)).toHaveLength(1)
    })

    /**
     * WhatsApp arrives through Kapso now: `x-webhook-signature`, a bare hex
     * digest over the raw body keyed with the Kapso webhook secret — the same
     * shape as the email route, not Meta's prefixed `x-hub-signature-256`.
     */
    it('verifies the WhatsApp delivery with Kapso’s signature, not Meta’s', async () => {
      const raw = body()

      const good = await post('/whatsapp', raw, {
        'x-webhook-signature': sign(raw, KAPSO_SECRET),
      })
      // Meta's old header and secret must no longer be accepted here.
      const meta = await post('/whatsapp', body(), {
        'x-hub-signature-256': sign(raw, WHATSAPP_SECRET, 'sha256='),
      })
      const wrong = await post('/whatsapp', body(), {
        'x-webhook-signature': sign(raw, 'not-the-secret'),
      })

      expect(good.statusCode).toBe(202)
      expect(meta.statusCode).toBe(401)
      expect(wrong.statusCode).toBe(401)
    })

    /**
     * Kapso deduplicates on its own `X-Idempotency-Key`, so the route keys the
     * receipt on it in preference to anything in the body.
     */
    it('keys a WhatsApp receipt on Kapso’s idempotency header', async () => {
      const raw = body({ message: { id: 'wamid.body' } })
      const key = `idem-${RUN}`

      await post('/whatsapp', raw, {
        'x-webhook-signature': sign(raw, KAPSO_SECRET),
        'x-idempotency-key': key,
      })

      expect(await recorded(key)).toHaveLength(1)
    })

    /** A status event (not a received message) is acknowledged and dropped. */
    it('acknowledges a non-received WhatsApp event without enqueueing it', async () => {
      const raw = body()

      const reply = await post('/whatsapp', raw, {
        'x-webhook-signature': sign(raw, KAPSO_SECRET),
        'x-webhook-event': 'whatsapp.message.delivered',
      })

      expect(reply.statusCode).toBe(202)
      expect(harness.sent).toEqual([])
    })

    it('reads each route’s own header and secret', async () => {
      const raw = body()

      const email = await post('/email', raw, {
        'x-webhook-signature': sign(raw, EMAIL_SECRET),
      })
      // Meta's header, correctly signed with Meta's secret — on the mail
      // route, which reads neither. A handler that took any valid-looking
      // signature would accept this.
      const crossed = await post('/email', body(), {
        'x-hub-signature-256': sign(raw, WHATSAPP_SECRET, 'sha256='),
      })

      expect(email.statusCode).toBe(202)
      expect(crossed.statusCode).toBe(401)
    })
  })

  describe('recording and enqueueing', () => {
    it('records the receipt and enqueues the work once', async () => {
      const id = `once-${RUN}`
      const raw = body({ id })

      await post('/email', raw, { 'x-webhook-signature': sign(raw, EMAIL_SECRET) })

      expect(await recorded(id)).toHaveLength(1)
      expect(harness.sent).toEqual([
        { name: JOBS.inboundEmail, data: { eventId: expect.any(String) } },
      ])
    })

    /**
     * Providers retry. The unique key on `(provider, external_id)` is what
     * makes the second delivery cost nothing — without it one inbound email
     * becomes three enquiries the first time a provider redelivers.
     */
    it('treats a redelivery as a no-op', async () => {
      const id = `retry-${RUN}`
      const raw = body({ id })
      const headers = { 'x-webhook-signature': sign(raw, EMAIL_SECRET) }

      const first = await post('/email', raw, headers)
      await markProcessed(id)
      harness.sent.length = 0
      const second = await post('/email', raw, headers)

      // Acknowledged both times — a 4xx would teach the provider to keep going.
      expect(first.statusCode).toBe(202)
      expect(second.statusCode).toBe(202)
      expect(await recorded(id)).toHaveLength(1)
      expect(harness.sent).toEqual([])
    })

    /*
      The lost event (V8). The receipt committed, the send failed, the route
      answered 500 — and the provider's retry used to hit the unique key and
      get a 202 for a job nobody queued.
    */
    it('queues the job again when the first send failed', async () => {
      const id = `lost-${RUN}`
      const raw = body({ id })
      const headers = { 'x-webhook-signature': sign(raw, EMAIL_SECRET) }

      harness.failNext = true
      const first = await post('/email', raw, headers)
      expect(first.statusCode).toBe(500)
      expect(await recorded(id)).toHaveLength(1)
      expect(harness.sent).toEqual([])

      const retry = await post('/email', raw, headers)

      expect(retry.statusCode).toBe(202)
      expect(await recorded(id)).toHaveLength(1)
      expect(harness.sent).toEqual([
        { name: JOBS.inboundEmail, data: { eventId: (await recorded(id))[0]!.id } },
      ])
    })

    /*
      Fastify's default body limit is 1 MB, and a provider posts attachments
      base64 in the JSON — anything past about 700 KB was refused with a 413
      before the handler ran (V9).
    */
    it('accepts an email carrying a real attachment', async () => {
      const id = `big-${RUN}`
      const raw = body({ id, attachment: 'A'.repeat(3 * 1024 * 1024) })

      const reply = await post('/email', raw, { 'x-webhook-signature': sign(raw, EMAIL_SECRET) })

      expect(reply.statusCode).toBe(202)
      expect(await recorded(id)).toHaveLength(1)
    })

    it('sends each provider’s deliveries to its own job', async () => {
      const whatsappRaw = body()
      const emailRaw = body()

      await post('/whatsapp', whatsappRaw, {
        'x-webhook-signature': sign(whatsappRaw, KAPSO_SECRET),
      })
      await post('/email', emailRaw, { 'x-webhook-signature': sign(emailRaw, EMAIL_SECRET) })

      expect(harness.sent.map((job) => job.name)).toEqual([JOBS.inboundWhatsApp, JOBS.inboundEmail])
    })

    /** The same id from two providers is two events, not a collision. */
    it('scopes the idempotency key to the provider', async () => {
      const id = `shared-${RUN}`
      const raw = body({ id })

      await post('/email', raw, { 'x-webhook-signature': sign(raw, EMAIL_SECRET) })
      await post('/whatsapp', raw, { 'x-webhook-signature': sign(raw, KAPSO_SECRET) })

      const rows = await recorded(id)
      expect(rows.map((row) => row.provider).sort()).toEqual(['email', 'whatsapp'])
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
      const headers = { 'x-webhook-signature': sign(raw, EMAIL_SECRET) }

      await post('/email', raw, headers)
      await withActor(systemActor, (tx) =>
        tx
          .update(inboundWebhookEvents)
          .set({ processedAt: new Date() })
          .where(
            eq(inboundWebhookEvents.id, (harness.sent[0]!.data as { eventId: string }).eventId),
          ),
      )
      harness.sent.length = 0
      const second = await post('/email', raw, headers)

      expect(second.statusCode).toBe(202)
      expect(harness.sent).toEqual([])
    })

    it('treats a different payload as a different event', async () => {
      const first = JSON.stringify({ noIdHere: `a-${RUN}` })
      const second = JSON.stringify({ noIdHere: `b-${RUN}` })

      await post('/email', first, { 'x-webhook-signature': sign(first, EMAIL_SECRET) })
      await post('/email', second, { 'x-webhook-signature': sign(second, EMAIL_SECRET) })

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
      const reply = await post('/email', '{not json at all', {
        'x-webhook-signature': 'whatever',
      })

      expect(reply.statusCode).toBeGreaterThanOrEqual(400)
      expect(harness.sent).toEqual([])
    })
  })
})
