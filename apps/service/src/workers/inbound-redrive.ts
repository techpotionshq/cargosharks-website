/**
 * Re-drive inbound webhook receipts that never became anything — FR-EQ-02.
 *
 * `/webhooks/email` and `/webhooks/whatsapp` record a receipt and then queue a
 * job for it, in two steps, because pg-boss sends on its own connection. Two
 * things could leave a receipt recorded and never processed: the send failing
 * after the receipt committed (and the provider not retrying), and a job that
 * spent all five pg-boss retries on, say, a storage outage. Either way the
 * customer's message sat in an idempotency table that nothing reads, and the
 * next redelivery was refused as a duplicate. An enquiry that never arrived is
 * a customer who went elsewhere.
 *
 * So this sweep looks for receipts with no `processed_at` and queues their job
 * again. A receipt is *settled* — processed, or deliberately skipped with a
 * reason — the moment `processed_at` is stamped, which is why the workers stamp
 * it on an unreadable payload too: that one is just as unreadable tomorrow.
 *
 * ## Bounded both ways
 *
 * Only receipts quiet for `QUIET_MINUTES` — past a healthy job and past
 * pg-boss's own first retries, so this never races the normal path — and only
 * those younger than `MAX_AGE_DAYS`. A receipt that fails every day for a week
 * is an incident with its reason written on the row, not something to retry
 * for the life of the deployment. The IMAP poll's receipts are not here: the
 * poll re-reads its own mailbox.
 */

import { and, asc, gte, inArray, isNull, lte } from 'drizzle-orm'
import { inboundWebhookEvents, systemActor, withActor } from '@qabandi/db'
import { JOBS } from '../queue'

/** How long a receipt sits untouched before the sweep picks it up. */
export const QUIET_MINUTES = 10
/** How far back the sweep looks; older failures are left with their reason. */
export const MAX_AGE_DAYS = 7
/** Receipts re-queued per sweep — a backlog drains steadily. */
const BATCH = 100

/** Which job handles a receipt, by the provider the route recorded it under. */
const JOB_BY_PROVIDER = {
  email: JOBS.inboundEmail,
  whatsapp: JOBS.inboundWhatsApp,
} as const

export type SendReceipt = (jobName: string, eventId: string) => Promise<void>

export interface InboundRedriveResult {
  readonly requeued: number
  readonly failed: number
}

export async function runInboundRedrive(
  send: SendReceipt,
  asOf = new Date(),
): Promise<InboundRedriveResult> {
  const quietSince = new Date(asOf.getTime() - QUIET_MINUTES * 60_000)
  const oldest = new Date(asOf.getTime() - MAX_AGE_DAYS * 24 * 60 * 60_000)

  const stuck = await withActor(systemActor(), (tx) =>
    tx
      .select({ id: inboundWebhookEvents.id, provider: inboundWebhookEvents.provider })
      .from(inboundWebhookEvents)
      .where(
        and(
          inArray(inboundWebhookEvents.provider, Object.keys(JOB_BY_PROVIDER)),
          isNull(inboundWebhookEvents.processedAt),
          gte(inboundWebhookEvents.createdAt, oldest),
          // `updated_at` moves on every recorded failure, so a receipt still
          // being retried by pg-boss is not quiet yet.
          lte(inboundWebhookEvents.updatedAt, quietSince),
        ),
      )
      .orderBy(asc(inboundWebhookEvents.createdAt))
      .limit(BATCH),
  )

  let requeued = 0
  let failed = 0
  for (const row of stuck) {
    const job = JOB_BY_PROVIDER[row.provider as keyof typeof JOB_BY_PROVIDER]
    try {
      await send(job, row.id)
      requeued++
    } catch (error) {
      // One refused send costs that receipt this sweep; the next sweep retries it.
      failed++
      console.error(
        { receipt: row.id, error: error instanceof Error ? error.message : String(error) },
        'inbound redrive: could not re-queue the receipt',
      )
    }
  }

  return { requeued, failed }
}
