/**
 * Outbound webhooks — the worker that was built last and tested never.
 *
 * `webhook-delivery.ts` exported its expand and flush halves, its backoff and
 * its ceilings for exactly this file, which then did not get written. The
 * failure modes are the dispatcher's, one file over: a number that stays at
 * zero. A subscriber that receives nothing looks like a subscriber with a
 * quiet week, and an endpoint retried for ever looks like one that works.
 *
 * Four properties, and the reasons they are the four:
 *
 * **An event reaches the endpoints that subscribed to it, and no others.** The
 * scoping is by customer, by branch and by event key, and a customer's
 * endpoint receiving another customer's shipment is a breach rather than a
 * bug (§5.3).
 *
 * **What is posted is signed over the bytes sent.** The receiver's only way to
 * tell it is us is the HMAC; a signature computed over anything other than the
 * exact body is one that never verifies, and the receiver drops everything
 * without anything here noticing.
 *
 * **A refusal backs off and eventually gives up.** Six attempts on a
 * quadrupling schedule, then the row stands as a record of what was never
 * delivered — rather than a retry queue that grows for ever.
 *
 * **An endpoint that has delivered nothing for a week is switched off,** with
 * the reason on the row, because a URL that died in somebody's redeploy does
 * not come back on its own.
 *
 * `fetch` is stubbed. The point is what this worker decides around the call,
 * and a real HTTP endpoint in a test is a way to test the network.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { and, eq, inArray, lt, sql } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const {
  branches,
  notificationOutbox,
  systemActor,
  webhookDeliveries,
  webhookEndpoints,
  withActor,
  workingCalendars,
} = await import('@qabandi/db')

const { MAX_ATTEMPTS, backoffSeconds, expandWebhookDeliveries, flushWebhookDeliveries } =
  await import('./webhook-delivery')

/* One branch of our own, so nothing raised by the other suites can reach the
   endpoints below: every endpoint is scoped to it. */
const BRANCH = '00000000-0000-7000-8000-00000000e001'

/** Subscribes to everything raised in the branch. */
const E_ALL = '00000000-0000-7000-8000-00000000e0a1'
/** Subscribes to `invoice.issued` only. */
const E_INVOICE = '00000000-0000-7000-8000-00000000e0a2'
/** Subscribes to something else, and must never hear about an invoice. */
const E_OTHER = '00000000-0000-7000-8000-00000000e0a3'
/**
 * The one that is going to be switched off. Subscribed to an event nothing
 * else here raises, and minted fresh per run: rows are never deleted, so an
 * endpoint that delivered something in yesterday's run has, truthfully, not
 * been dead for a week — and the assertion is about one that has.
 */
const E_DEAD = `00000000-0000-7000-8000-${Date.now().toString(16).padStart(12, '0').slice(-12)}`

/**
 * Healthy but quiet: its last delivery got through eight days ago and nothing
 * has been raised for it since. Minted per run for `E_DEAD`'s reason.
 */
const E_QUIET = `00000000-0000-7000-8001-${Date.now().toString(16).padStart(12, '0').slice(-12)}`

const SECRET = 'whsec_test_' + E_INVOICE.slice(-4)
const MINE = [E_ALL, E_INVOICE, E_OTHER, E_DEAD, E_QUIET]

const RUN = Date.now().toString(36).toUpperCase().slice(-5)
let seq = 0

const fetchMock = vi.fn<typeof fetch>()

/** A deployment-wide event in our branch, found again by its reference. */
async function raiseEvent(eventKey: string): Promise<{ id: string; reference: string }> {
  seq += 1
  const reference = `WH-${RUN}-${seq}`
  const [row] = await withActor(systemActor([BRANCH]), (tx) =>
    tx
      .insert(notificationOutbox)
      .values({ branchId: BRANCH, eventKey, payload: { reference } })
      .returning({ id: notificationOutbox.id }),
  )
  return { id: row!.id, reference }
}

const deliveriesFor = (reference: string) =>
  withActor(systemActor([BRANCH]), (tx) =>
    tx
      .select()
      .from(webhookDeliveries)
      .where(
        and(
          inArray(webhookDeliveries.endpointId, MINE),
          sql`${webhookDeliveries.payload} -> 'data' ->> 'reference' = ${reference}`,
        ),
      ),
  )

const endpoint = async (id: string) => {
  const [row] = await withActor(systemActor([BRANCH]), (tx) =>
    tx.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, id)),
  )
  return row!
}

const answer =
  (status: number, body = 'ok') =>
  async () =>
    new Response(body, { status })

describe.skipIf(!enabled)('outbound webhook delivery', () => {
  beforeAll(async () => {
    await withActor(systemActor([BRANCH]), async (tx) => {
      const [calendar] = await tx
        .select({ id: workingCalendars.id })
        .from(workingCalendars)
        .where(eq(workingCalendars.key, 'kuwait'))
        .limit(1)
      if (!calendar) throw new Error('Run `pnpm db:seed` before this suite')

      await tx
        .insert(branches)
        .values({
          id: BRANCH,
          code: 'NWH',
          legalNameEn: 'Webhook Fixture Branch',
          legalNameAr: 'فرع',
          country: 'KW',
          baseCurrency: 'KWD',
          invoiceSeries: 'NWH',
          calendarId: calendar.id,
          timeZone: 'Asia/Kuwait',
        })
        .onConflictDoNothing()

      /*
        Stated, not merely inserted. A previous run switches `E_DEAD` off —
        that is one of the assertions — and rows are never deleted, so each
        run has to put the endpoints back the way the tests expect them.
      */
      for (const [id, events] of [
        [E_ALL, []],
        [E_INVOICE, ['invoice.issued']],
        [E_OTHER, ['job.booked']],
        [E_DEAD, ['customs.hold']],
        [E_QUIET, ['quiet.fixture']],
      ] as const) {
        await tx
          .insert(webhookEndpoints)
          .values({
            id,
            branchId: BRANCH,
            url: `https://subscriber.test/${id.slice(-4)}`,
            secret: SECRET,
            events: [...events],
          })
          .onConflictDoUpdate({
            target: webhookEndpoints.id,
            set: {
              events: [...events],
              secret: SECRET,
              isActive: true,
              disabledAt: null,
              disabledReason: null,
            },
          })
      }

      /*
        Expand nothing that was raised before this run.

        `expand` takes the fifty oldest un-expanded outbox rows, and the web
        suites raise hundreds without ever running this worker — so the row
        a test has just raised sits behind them and a single pass never
        reaches it. They are other suites' events; stamping them is what the
        worker would do on its next few ticks anyway.
      */
      await tx.execute(sql`
        update notification_outbox set webhooks_expanded_at = now()
         where webhooks_expanded_at is null
      `)

      /*
        Exhaust whatever an earlier run left due.

        `flush` claims the fifty oldest due rows in the deployment, so rows a
        crashed run abandoned sit at the front of that queue and this file's
        own never get claimed. They are already garbage; being due is the only
        thing that makes them harmful.
      */
      await tx
        .update(webhookDeliveries)
        .set({ status: 'failed', attempts: MAX_ATTEMPTS, nextAttemptAt: null })
        .where(
          and(
            inArray(webhookDeliveries.status, ['queued', 'failed']),
            lt(webhookDeliveries.attempts, MAX_ATTEMPTS),
          ),
        )
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    fetchMock.mockReset()
  })

  it('expands an event into one delivery per subscribed endpoint, and no more', async () => {
    const { id, reference } = await raiseEvent('invoice.issued')

    await expandWebhookDeliveries()

    const rows = await deliveriesFor(reference)
    const heard = new Set(rows.map((row) => row.endpointId))

    expect(heard).toEqual(new Set([E_ALL, E_INVOICE]))
    expect(rows.every((row) => row.status === 'queued')).toBe(true)
    expect(rows[0]!.payload).toMatchObject({ event: 'invoice.issued', data: { reference } })

    // Stamped, so the same event is never expanded twice.
    const [outbox] = await withActor(systemActor([BRANCH]), (tx) =>
      tx
        .select({ expandedAt: notificationOutbox.webhooksExpandedAt })
        .from(notificationOutbox)
        .where(eq(notificationOutbox.id, id)),
    )
    expect(outbox?.expandedAt).not.toBeNull()

    await expandWebhookDeliveries()
    expect((await deliveriesFor(reference)).length).toBe(rows.length)
  })

  it('posts the signed payload and marks the delivery sent', async () => {
    const { reference } = await raiseEvent('invoice.issued')
    await expandWebhookDeliveries()

    vi.stubGlobal('fetch', fetchMock.mockImplementation(answer(200, 'accepted')))
    const now = new Date()
    await flushWebhookDeliveries(now)

    const rows = await deliveriesFor(reference)
    expect(rows.length).toBe(2)
    for (const row of rows) {
      expect(row.status).toBe('sent')
      expect(row.attempts).toBe(1)
      expect(row.responseStatus).toBe(200)
      expect(row.responseBody).toBe('accepted')
      expect(row.deliveredAt).not.toBeNull()
      expect(row.nextAttemptAt).toBeNull()
    }

    const delivery = rows.find((row) => row.endpointId === E_INVOICE)!
    const call = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith(E_INVOICE.slice(-4)) && String(init?.body).includes(reference),
    )
    expect(call).toBeDefined()
    const [, init] = call!
    const headers = init!.headers as Record<string, string>
    const body = init!.body as string

    expect(init!.method).toBe('POST')
    expect(headers['x-qabandi-event']).toBe('invoice.issued')
    expect(JSON.parse(body)).toMatchObject({ id: delivery.id, event: 'invoice.issued' })

    /*
      The signature is over `timestamp.body` — the exact bytes — so this is
      computed the way a receiver would, from the headers and body alone.
    */
    const timestamp = headers['x-qabandi-timestamp']
    expect(timestamp).toBe(Math.floor(now.getTime() / 1000).toString())
    const expected = createHmac('sha256', SECRET).update(`${timestamp}.${body}`).digest('hex')
    expect(headers['x-qabandi-signature']).toBe(`sha256=${expected}`)
  })

  it('backs off after a refusal, and gives up after the sixth', async () => {
    const { reference } = await raiseEvent('invoice.issued')
    await expandWebhookDeliveries()

    vi.stubGlobal('fetch', fetchMock.mockImplementation(answer(503, 'try later')))
    const before = Date.now()
    await flushWebhookDeliveries()

    for (const row of await deliveriesFor(reference)) {
      expect(row.status).toBe('failed')
      expect(row.attempts).toBe(1)
      expect(row.responseStatus).toBe(503)
      // Thirty seconds, the first rung of the ladder — not due again now.
      const delay = row.nextAttemptAt!.getTime() - before
      expect(delay).toBeGreaterThan(20_000)
      expect(delay).toBeLessThan(60_000)
    }

    // One attempt from the ceiling, and due: the next refusal is the last.
    await withActor(systemActor([BRANCH]), (tx) =>
      tx
        .update(webhookDeliveries)
        .set({ attempts: MAX_ATTEMPTS - 1, nextAttemptAt: new Date(0) })
        .where(
          and(
            inArray(webhookDeliveries.endpointId, MINE),
            sql`${webhookDeliveries.payload} -> 'data' ->> 'reference' = ${reference}`,
          ),
        ),
    )
    await flushWebhookDeliveries()

    for (const row of await deliveriesFor(reference)) {
      expect(row.status).toBe('failed')
      expect(row.attempts).toBe(MAX_ATTEMPTS)
      expect(row.nextAttemptAt).toBeNull()
    }

    // Exhausted rows are no longer claimed, so the endpoint is left alone.
    fetchMock.mockClear()
    await flushWebhookDeliveries()
    const mine = fetchMock.mock.calls.filter(([, init]) => String(init?.body).includes(reference))
    expect(mine).toHaveLength(0)
  })

  /*
    Quadrupling, not doubling: the failure this retries through is somebody
    else's deploy, which takes minutes. Doubling from thirty seconds would
    spend all six attempts inside half an hour.
  */
  it('spaces the retries so a subscriber has time to come back', () => {
    expect([0, 1, 2, 3, 4, 5].map(backoffSeconds)).toEqual([30, 120, 480, 1920, 7680, 7680])
  })

  it('switches off an endpoint that has delivered nothing for a week', async () => {
    const now = new Date()
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000)

    // A delivery that has been waiting since last week and never got through.
    await withActor(systemActor([BRANCH]), (tx) =>
      tx.insert(webhookDeliveries).values({
        endpointId: E_DEAD,
        eventKey: 'invoice.issued',
        payload: { event: 'invoice.issued', data: { reference: `WH-${RUN}-stale` } },
        status: 'queued',
        nextAttemptAt: eightDaysAgo,
        createdAt: eightDaysAgo,
      }),
    )

    /*
      And one that worked: delivered eight days ago, nothing raised since. It
      is quiet, not dead — "no success in a week" is not "failing for a week"
      when there was nothing to send.
    */
    await withActor(systemActor([BRANCH]), (tx) =>
      tx.insert(webhookDeliveries).values({
        endpointId: E_QUIET,
        eventKey: 'quiet.fixture',
        payload: { event: 'quiet.fixture', data: { reference: `WH-${RUN}-quiet` } },
        status: 'delivered',
        attempts: 1,
        deliveredAt: eightDaysAgo,
        createdAt: eightDaysAgo,
      }),
    )

    vi.stubGlobal('fetch', fetchMock.mockImplementation(answer(503)))
    await flushWebhookDeliveries(now)

    const dead = await endpoint(E_DEAD)
    expect(dead.isActive).toBe(false)
    expect(dead.disabledAt).not.toBeNull()
    expect(dead.disabledReason).toMatch(/^no_delivery_since:\d{4}-\d{2}-\d{2}$/)

    // The one that delivered this week is left alone, and so is one with no history.
    expect((await endpoint(E_INVOICE)).isActive).toBe(true)
    expect((await endpoint(E_OTHER)).isActive).toBe(true)
    expect((await endpoint(E_QUIET)).isActive).toBe(true)

    // Off means off: the next event it subscribed to is not expanded to it.
    const { reference } = await raiseEvent('customs.hold')
    await expandWebhookDeliveries()
    const heard = new Set((await deliveriesFor(reference)).map((row) => row.endpointId))
    expect(heard.has(E_DEAD)).toBe(false)
    expect(heard.has(E_ALL)).toBe(true)
  })
})
