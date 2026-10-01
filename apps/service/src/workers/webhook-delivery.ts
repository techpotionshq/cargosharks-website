/**
 * Outbound webhooks — FR-AD-06.
 *
 * The last of the §9 table to be built, and the one whose absence was easiest
 * to miss: `webhook_endpoints` and `webhook_deliveries` have existed since
 * Release One, `DEFAULT_QUEUE_POLICY`'s exponential backoff cites this
 * requirement as its reason for existing, and `JOBS.webhookDelivery` sat in
 * `PENDING` with the two tables referenced by nothing at all.
 *
 * ## The same shape as the notification dispatcher, for the same reasons
 *
 * **Expand**, in a transaction, turns one outbox event into delivery rows —
 * one per subscribed endpoint. **Flush**, outside any transaction, posts them.
 * Holding a database transaction open across somebody else's HTTP endpoint is
 * how a slow subscriber becomes a database incident, and that lesson is
 * already written down one file over.
 *
 * ## Signed, so the receiver can tell it is us
 *
 * HMAC-SHA256 over the exact bytes sent, in `x-qabandi-signature`, with the
 * timestamp in the signed payload so a captured request cannot be replayed a
 * week later. The secret is per endpoint and generated when it is created —
 * the same split as an API key, and for the same reason.
 *
 * ## Retries are bounded, and a dead endpoint is disabled
 *
 * Six attempts on exponential backoff, then the delivery is failed. An
 * endpoint that fails everything for a week is disabled with a reason, because
 * a customer whose URL has been dead since a redeploy should be told rather
 * than retried at for ever — and an endless retry queue is indistinguishable
 * from a working one on a graph.
 */

import { createHmac } from 'node:crypto'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { systemActor, webhookDeliveries, webhookEndpoints, withActor } from '@qabandi/db'

/** Attempts before a delivery is given up on. */
export const MAX_ATTEMPTS = 6

/** Consecutive days of total failure before an endpoint is switched off. */
const DISABLE_AFTER_DAYS = 7

/** One batch, so a backlog does not hold the worker for ever. */
const BATCH = 50

/**
 * Backoff in seconds after the first, second, … failure: 30s, 2m, 8m, 32m, 2h.
 *
 * Indexed from zero — the caller has already counted the failure it is
 * scheduling the retry for, so it passes `attempts - 1`. Passing `attempts`
 * skipped the first rung entirely and sat at the two-hour cap twice, which
 * is what the file said and not what it did until the test below was written.
 *
 * Quadrupling rather than doubling, because the failure this retries through
 * is somebody else's deploy — and a deploy takes minutes, not seconds. Doubling
 * from thirty seconds exhausts six attempts in half an hour and gives up while
 * the subscriber is still coming back up.
 */
export const backoffSeconds = (attempts: number): number => 30 * 4 ** Math.min(attempts, 4)

export interface WebhookRunResult {
  readonly expanded: number
  readonly sent: number
  readonly failed: number
  readonly disabled: number
}

/**
 * Turn undispatched outbox events into one delivery per subscribed endpoint.
 *
 * Reads the same `notification_outbox` the mail dispatcher does, deliberately:
 * a webhook and an email are two channels carrying one event, and a second
 * event table would be a second place for "did this happen" to disagree.
 *
 * Endpoints subscribe by event key. An endpoint with an empty `events` array
 * receives everything — which is what a customer integrating their whole
 * pipeline asks for, and is why the column defaults to empty rather than
 * requiring a list nobody has yet.
 */
export async function expandWebhookDeliveries(): Promise<number> {
  return withActor(systemActor(), async (tx) => {
    const events = await tx.execute(sql`
      select o.id, o.event_key as "eventKey", o.branch_id as "branchId",
             o.customer_id as "customerId", o.job_id as "jobId", o.payload
        from notification_outbox o
       where o.webhooks_expanded_at is null
       order by o.created_at
       limit ${BATCH}
       for update skip locked
    `)

    let written = 0

    for (const event of events.rows as Record<string, unknown>[]) {
      const customerId = (event.customerId as string | null) ?? null
      const branchId = (event.branchId as string | null) ?? null

      const endpoints = await tx
        .select({ id: webhookEndpoints.id })
        .from(webhookEndpoints)
        .where(
          and(
            eq(webhookEndpoints.isActive, true),
            /*
              Scoped to the customer the event is about, or to the branch.

              A customer's endpoint must never receive another customer's
              shipment. `customer_id is null` is a deployment-wide subscriber —
              the operator's own systems — and is why the check is not simply
              an equality.

              An event about no customer — an SLA breach, an internal reminder
              — reaches only the deployment-wide subscribers. That case used
              to be written as `customer_id = ''`, which Postgres refuses as a
              uuid and which therefore failed the whole run the first time a
              customer-less event reached the outbox. The test that found it
              is the one this worker went a release without.
            */
            customerId === null
              ? isNull(webhookEndpoints.customerId)
              : or(
                  isNull(webhookEndpoints.customerId),
                  eq(webhookEndpoints.customerId, customerId),
                ),
            branchId === null
              ? isNull(webhookEndpoints.branchId)
              : or(isNull(webhookEndpoints.branchId), eq(webhookEndpoints.branchId, branchId)),
            // Empty subscribes to everything; otherwise the key must be listed.
            sql`(jsonb_array_length(${webhookEndpoints.events}) = 0
                 or ${webhookEndpoints.events} ? ${event.eventKey as string})`,
          ),
        )

      for (const endpoint of endpoints) {
        await tx.insert(webhookDeliveries).values({
          endpointId: endpoint.id,
          eventKey: event.eventKey as string,
          payload: {
            event: event.eventKey,
            jobId: event.jobId ?? null,
            customerId: event.customerId ?? null,
            data: event.payload ?? {},
          },
          status: 'queued',
          nextAttemptAt: new Date(),
        })
        written += 1
      }

      // Stamped whether or not anything subscribed, so an event with no
      // endpoints is expanded once rather than re-examined every run.
      await tx.execute(sql`
        update notification_outbox set webhooks_expanded_at = now() where id = ${event.id as string}
      `)
    }

    return written
  })
}

/**
 * Post everything due, outside any transaction.
 *
 * Claims a batch by pushing `next_attempt_at` forward inside a short
 * transaction, then posts. A crash mid-flight lets the lease expire and the
 * row is retried — at-least-once, which is the same trade the mail dispatcher
 * makes and the right one here: a receiver that sees a delivery twice can
 * deduplicate on the event id, and one that never sees it cannot.
 */
export async function flushWebhookDeliveries(now = new Date()): Promise<WebhookRunResult> {
  const claimed = await withActor(systemActor(), async (tx) =>
    tx.execute(sql`
      update webhook_deliveries d
         set next_attempt_at = now() + interval '2 minutes', updated_at = now()
       where d.id in (
         select id from webhook_deliveries
          where status in ('queued', 'failed')
            and attempts < ${MAX_ATTEMPTS}
            and (next_attempt_at is null or next_attempt_at <= now())
          order by next_attempt_at nulls first
          limit ${BATCH}
          for update skip locked
       )
      returning d.id, d.endpoint_id as "endpointId", d.event_key as "eventKey",
                d.payload, d.attempts
    `),
  )

  let sent = 0
  let failed = 0

  for (const row of claimed.rows as Record<string, unknown>[]) {
    const [endpoint] = await withActor(systemActor(), (tx) =>
      tx
        .select({ url: webhookEndpoints.url, secret: webhookEndpoints.secret })
        .from(webhookEndpoints)
        .where(eq(webhookEndpoints.id, row.endpointId as string))
        .limit(1),
    )
    if (!endpoint) continue

    const body = JSON.stringify({ id: row.id, ...(row.payload as object) })
    const timestamp = Math.floor(now.getTime() / 1000).toString()
    /*
      The timestamp is inside the signed payload, not merely a header.

      Signing the body alone makes a captured request replayable for ever;
      signing `timestamp.body` lets the receiver reject anything older than a
      few minutes. The same shape the inbound handlers verify, from the other
      side.
    */
    const signature = createHmac('sha256', endpoint.secret)
      .update(`${timestamp}.${body}`)
      .digest('hex')

    const attempts = Number(row.attempts) + 1

    try {
      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-qabandi-event': row.eventKey as string,
          'x-qabandi-timestamp': timestamp,
          'x-qabandi-signature': `sha256=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(15_000),
      })

      // The response body is kept truncated: it is for a support engineer
      // reading why a subscriber refused, not a log of their whole page.
      const detail = (await response.text().catch(() => '')).slice(0, 500)

      if (response.ok) {
        await withActor(systemActor(), (tx) =>
          tx
            .update(webhookDeliveries)
            .set({
              status: 'sent',
              attempts,
              responseStatus: response.status,
              responseBody: detail,
              deliveredAt: new Date(),
              nextAttemptAt: null,
              updatedAt: new Date(),
            })
            .where(eq(webhookDeliveries.id, row.id as string)),
        )
        sent += 1
      } else {
        await recordFailure(row.id as string, attempts, response.status, detail)
        failed += 1
      }
    } catch (error) {
      // A timeout or a DNS failure is the same as a 5xx from here: try again.
      await recordFailure(row.id as string, attempts, null, String(error).slice(0, 500))
      failed += 1
    }
  }

  const disabled = await disableDeadEndpoints(now)

  return { expanded: 0, sent, failed, disabled }
}

async function recordFailure(
  id: string,
  attempts: number,
  status: number | null,
  detail: string,
): Promise<void> {
  const exhausted = attempts >= MAX_ATTEMPTS
  await withActor(systemActor(), (tx) =>
    tx
      .update(webhookDeliveries)
      .set({
        status: 'failed',
        attempts,
        responseStatus: status,
        responseBody: detail,
        // Null once exhausted, so the claim query stops picking it up and the
        // row stands as a record of what was never delivered.
        nextAttemptAt: exhausted
          ? null
          : new Date(Date.now() + backoffSeconds(attempts - 1) * 1000),
        updatedAt: new Date(),
      })
      .where(eq(webhookDeliveries.id, id)),
  )
}

/**
 * Switch off an endpoint that has delivered nothing for a week.
 *
 * A customer's URL that died in a redeploy will not come back on its own, and
 * retrying it for ever costs a request every few minutes and hides the real
 * failures behind it. Disabled with a reason, so the answer to "why did we
 * stop getting these" is on the row rather than in somebody's memory.
 */
async function disableDeadEndpoints(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - DISABLE_AFTER_DAYS * 24 * 60 * 60 * 1000)

  const disabled = await withActor(systemActor(), (tx) =>
    tx.execute(sql`
      update webhook_endpoints e
         set is_active = false,
             disabled_at = now(),
             -- A code and its day, not a sentence: the settings page translates
             -- it, and an English sentence stored here showed on Arabic pages (U1).
             disabled_reason = ${`no_delivery_since:${cutoff.toISOString().slice(0, 10)}`},
             updated_at = now()
       where e.is_active
         and exists (
           select 1 from webhook_deliveries d
            where d.endpoint_id = e.id and d.created_at < ${cutoff.toISOString()}
         )
         and not exists (
           select 1 from webhook_deliveries d
            where d.endpoint_id = e.id
              and d.delivered_at is not null
              and d.delivered_at >= ${cutoff.toISOString()}
         )
      returning e.id
    `),
  )

  return disabled.rows.length
}

/** Expand, then flush — what the queue handler runs. */
export async function runWebhookDelivery(now = new Date()): Promise<WebhookRunResult> {
  const expanded = await expandWebhookDeliveries()
  const flushed = await flushWebhookDeliveries(now)
  return { ...flushed, expanded }
}
