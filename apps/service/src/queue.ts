/**
 * The queue — Architecture §9.
 *
 * pg-boss over the same PostgreSQL instance. Jobs enqueue *inside* the
 * business transaction, so a job never exists for a write that rolled back —
 * a transactional outbox with no extra component.
 *
 * Redis and BullMQ were rejected deliberately: they buy throughput this system
 * will never need, and add a stateful service to hand over (§2, NFR-17).
 */

import { PgBoss } from 'pg-boss'
import { config } from './config'

/** One name per job type; the worker files mirror these one to one. */
export const JOBS = {
  inboundEmail: 'inbound-email-to-enquiry',
  inboundWhatsApp: 'inbound-whatsapp-to-thread',
  notificationDispatch: 'notification-dispatch',
  pdfRender: 'pdf-render',
  freeTimeAccrual: 'free-time-accrual',
  slaEscalation: 'sla-escalation',
  complianceExpiry: 'compliance-expiry-warning',
  rateCardExpiry: 'rate-card-expiry-digest',
  quoteExpiry: 'quote-expiry-warning',
  invoiceOverdue: 'invoice-overdue-notice',
  fxIngest: 'fx-rate-ingest',
  carrierEvent: 'carrier-event-ingest',
  bulkImport: 'bulk-import-validate',
  webhookDelivery: 'outbound-webhook-delivery',
  scheduledReport: 'scheduled-report',
} as const

export type JobName = (typeof JOBS)[keyof typeof JOBS]

/**
 * Retry with exponential backoff. FR-AD-06 requires it for outbound webhooks,
 * and it is the right default for every call that leaves the building.
 *
 * These are queue-level options in pg-boss 12 rather than constructor options,
 * so they are applied by `createQueue` below — which also means a queue can
 * differ where it needs to without changing the default for everything else.
 */
export const DEFAULT_QUEUE_POLICY = {
  retryLimit: 5,
  retryDelay: 30,
  retryBackoff: true,
  // Failed jobs are kept for a month: a notification that never arrived is an
  // incident to investigate, not a row to garbage-collect.
  deleteAfterSeconds: 30 * 24 * 60 * 60,
} as const

let boss: PgBoss | undefined

export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss

  boss = new PgBoss({
    connectionString: config.DATABASE_URL,
    schema: config.PGBOSS_SCHEMA,
    // The schema is created by provisioning, owned by app_user (§5.1). pg-boss
    // would otherwise open its install with `CREATE SCHEMA IF NOT EXISTS`, and
    // Postgres checks CREATE on the database *before* honouring IF NOT EXISTS —
    // so that statement fails for app_user whether or not the schema is already
    // there. Owning the schema is enough to create the tables inside it.
    createSchema: false,
  })

  boss.on('error', (error: unknown) => console.error({ error }, 'pg-boss error'))
  await boss.start()

  // Queues are declared explicitly in pg-boss 12; creating them at boot means
  // a typo in a job name fails here rather than silently never running.
  for (const name of Object.values(JOBS)) {
    await boss.createQueue(name, { ...DEFAULT_QUEUE_POLICY })
  }

  return boss
}

export async function stopBoss(): Promise<void> {
  await boss?.stop({ graceful: true })
  boss = undefined
}

/**
 * The recurring schedule from §9.
 *
 * Cron expressions are in UTC. Nightly work runs at 21:00 UTC — midnight in
 * Kuwait — so a "nightly" accrual lands on the right local day, which is the
 * day the per-diem is actually owed for.
 */
export async function registerSchedules(): Promise<void> {
  const b = await getBoss()
  await b.schedule(JOBS.freeTimeAccrual, '0 21 * * *')
  await b.schedule(JOBS.slaEscalation, '*/15 * * * *')
  await b.schedule(JOBS.complianceExpiry, '30 21 * * *')
  await b.schedule(JOBS.rateCardExpiry, '45 21 * * *')
  await b.schedule(JOBS.fxIngest, '0 5 * * *')

  /*
    The two time-driven notifications (FR-NT-01).

    Early morning Kuwait rather than at midnight with the accruals: both send
    mail to customers, and a message timestamped 00:15 reads as machinery. The
    dispatcher's quiet hours would hold them until 07:00 anyway, so raising
    them at 05:00 UTC — 08:00 local — means the event time and the send time
    agree, and a delivery log that has to be read during an incident says what
    it looks like it says.
  */
  await b.schedule(JOBS.quoteExpiry, '0 5 * * *')
  await b.schedule(JOBS.invoiceOverdue, '10 5 * * *')

  /*
    The dispatcher itself, which nothing had ever enqueued.

    `notification-dispatch` was declared as a queue and registered as a worker,
    and no code anywhere called `send` for it — so the handler was mounted and
    never once invoked. Every outbox row written since Release One is still
    sitting there undispatched.

    Polling every minute rather than enqueuing per event, because `apps/web`
    writes the outbox row and has no pg-boss connection to enqueue with (§3).
    A minute is well inside what any of these events needs, and it is also what
    picks up a delivery whose retry backoff has expired.
  */
  await b.schedule(JOBS.notificationDispatch, '* * * * *')
}
