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
  inboundMailPoll: 'inbound-mail-poll',
  inboundEmail: 'inbound-email-to-enquiry',
  inboundWhatsApp: 'inbound-whatsapp-to-thread',
  notificationDispatch: 'notification-dispatch',
  pdfRender: 'pdf-render',
  freeTimeAccrual: 'free-time-accrual',
  freeTimeWarning: 'free-time-warning',
  slaEscalation: 'sla-escalation',
  complianceExpiry: 'compliance-expiry-warning',
  rateCardExpiry: 'rate-card-expiry-digest',
  quoteExpiry: 'quote-expiry-warning',
  invoiceOverdue: 'invoice-overdue-notice',
  fxIngest: 'fx-rate-ingest',
  carrierEvent: 'carrier-event-ingest',
  carrierPoll: 'carrier-poll',
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

  /*
    The warning runs in the morning, not with the nightly batch.

    Everything else on this list is bookkeeping and belongs at midnight local.
    This one exists to be acted on: 04:00 UTC is 07:00 in Kuwait, so it is at
    the top of the inbox when the coordinator opens it and there is a working
    day left to book a haulier in. Sent at midnight it would be eleven mails
    down by then, which is the same as not sending it.
  */
  await b.schedule(JOBS.freeTimeWarning, '0 4 * * *')
  await b.schedule(JOBS.slaEscalation, '*/15 * * * *')
  /*
    `complianceExpiry` is deliberately not here.

    It was scheduled at 21:30 from Release One with no handler — the third of
    these found by `scripts/check-schedules.mjs`, and the only one still open.
    A cron with nobody listening is worse than no cron: it costs a discarded
    job every night and it makes the feature look built. FR-MD-05 also wants
    warnings at 60, 30 and 7 days sent to the *partner* as well as to us, and
    `NotificationAudience` has no partner arm yet, so this is a design decision
    rather than a missing function. It goes back on the schedule the day the
    handler exists; `PENDING` in `workers/index.ts` holds the gap until then.
  */
  await b.schedule(JOBS.rateCardExpiry, '45 21 * * *')
  await b.schedule(JOBS.fxIngest, '0 5 * * *')

  /*
    The carrier poll — `CARRIER_POLL_CRON`, hourly on the half hour by default.

    Hourly because that is the resolution the events themselves have: a carrier
    publishes a discharge minutes to an hour after the crane, so asking more
    often buys nothing but rate limit. Configurable because a trial tier's
    budget and a commercial tier's are different problems, and because a demo
    wants to see the thing work inside ten minutes rather than inside an hour.

    Off unless `CARRIER_TRACKING_DRIVER=dcsa`: the worker answers "nothing to
    do" for the other drivers rather than branching, exactly as `fxIngest`
    does when no feed is bought.
  */
  await b.schedule(JOBS.carrierPoll, config.CARRIER_POLL_CRON)

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
    The inbound mail poll — `INBOUND_MAIL_CRON`, every minute by default.

    Every minute because FR-EQ-02 says an emailed enquiry appears in the queue
    "within one minute", and a cron expression has no finer resolution. Worth
    stating plainly rather than claiming compliance: a mail landing just after
    a tick waits most of a minute and is then processed, so this meets the
    requirement at its boundary. IMAP IDLE would make it immediate and is an
    adapter change — `InboundMailSource` was shaped so it would be.

    Off unless `INBOUND_MAIL_DRIVER=imap`: the worker answers "nothing to do"
    for `none` rather than branching, exactly as `fxIngest` and `carrierPoll`
    do when nobody has configured a feed.
  */
  await b.schedule(JOBS.inboundMailPoll, config.INBOUND_MAIL_CRON)

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
  /*
    Outbound webhooks, every minute alongside the dispatcher (FR-AD-06).

    A subscriber integrating their pipeline expects an event within a minute of
    it happening; anything slower and they poll the read API instead, which is
    the thing webhooks exist to replace.
  */
  await b.schedule(JOBS.webhookDelivery, '* * * * *')

  await b.schedule(JOBS.notificationDispatch, '* * * * *')
}
