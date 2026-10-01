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
import { integration } from './settings'

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
  carrierPoll: 'carrier-poll',
  bulkImport: 'bulk-import-validate',
  /*
    Extraction is queued rather than awaited, even on the attended path.

    A model call is tens of seconds on a multi-page scan, and a coordinator
    who uploaded a PDF should not be holding a request open for it. The job
    also buys the retry policy every call that leaves the building needs —
    which is why `adapters/model.ts` deliberately has no retry loop of its own.
  */
  invoiceExtract: 'supplier-invoice-extract',
  /*
    Reading an emailed enquiry — FR-EQ-02's twelve null columns.

    Queued for a stronger reason than the invoice above, and the ordering is
    the whole design: `handleMessage` enqueues this *after* the enquiry is
    committed, never before, so a model that is slow, rate-limited or
    unconfigured cannot cost us the intake. An enquiry that never arrived is a
    customer who went elsewhere; an enquiry a coordinator has to type out is
    Tuesday.
  */
  enquiryExtract: 'enquiry-extract',
  /*
    Reading a broker's rate reply — FR-RT-10, the far end of rate procurement.

    Queued for the invoice's reason, not the enquiry's: the reply is already an
    ingested message, so a slow model cannot cost us intake, only the freshness
    of a comparison a coordinator will look at in minutes. `ingestMessage`
    enqueues it after commit, once a reply is matched to the RFQ it answers.
  */
  rateExtract: 'rate-extract',
  /*
    Sending rate requests — the near end. A coordinator picks agents on the
    enquiry screen; the send fans out here so the request returns immediately
    and one unreachable agent does not fail the others.
  */
  rateRequestSend: 'rate-request-send',
  /*
    Automatic rate procurement — opens the RFQ rows `rateRequestSend` then mails.
    Off unless the `rateAutoFanout` integration is switched to `auto`; the sweep
    runs every tick and answers nothing-to-do until then.
  */
  rateAutoFanout: 'rate-auto-fanout',
  /*
    Automatic rate award — promotes the cheapest parsed reply to a buy card.
    Off unless `rateAutoPromote` names a strategy; the sweep idles otherwise.
  */
  rateAutoPromote: 'rate-auto-promote',
  /*
    Automatic quotation draft — the end of the pipeline. Prices an enquiry whose
    buy rate was awarded and lands a draft quote. Off unless `quoteAutoDraft` is
    switched on; the sweep idles otherwise.
  */
  quoteAutoDraft: 'quote-auto-draft',
  /*
    Re-queues inbound webhook receipts left unprocessed — a `boss.send` that
    failed after the receipt committed, or a job that ran out of retries. See
    `workers/inbound-redrive.ts`.
  */
  inboundRedrive: 'inbound-webhook-redrive',
  webhookDelivery: 'outbound-webhook-delivery',
  scheduledReport: 'scheduled-report',
} as const

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
    Rate-request sends — FR-RT-10, every minute. The near twin of the mail poll:
    a coordinator picks agents on the enquiry screen, the web action writes the
    rows, and this drains them to email within the minute. Web has no queue
    access, so the drain is what bridges the two without a synchronous call.
  */
  await b.schedule(JOBS.rateRequestSend, '* * * * *')

  /*
    Automatic rate procurement — FR-RT-10, every minute. Feeds the drain above:
    an enquiry that reaches a resolvable lane has an RFQ opened to every covering
    agent, once. Scheduled unconditionally; the handler answers nothing-to-do
    unless the `rateAutoFanout` integration is switched to `auto`, the same way
    `carrierPoll` and `fxIngest` stay on the schedule and idle on their inert
    default — a cron that switches on with a setting rather than a redeploy.
  */
  await b.schedule(JOBS.rateAutoFanout, '* * * * *')

  /*
    Automatic rate award — FR-RT-10, every minute. The far end of the fan-out:
    once agents have replied and the enquiry's chosen strategy says it is time,
    the cheapest reply becomes a buy card. Scheduled unconditionally; idles until
    `rateAutoPromote` names a strategy, the same as its two siblings above.
  */
  await b.schedule(JOBS.rateAutoPromote, '* * * * *')

  /*
    Automatic quotation draft — FR-EQ-05, every minute. The end of the pipeline:
    an enquiry with an awarded buy rate and a covered lane is priced against the
    house margin and lands a draft quotation for a person to review and send.
    Scheduled unconditionally; idles until `quoteAutoDraft` is switched on.
  */
  await b.schedule(JOBS.quoteAutoDraft, '* * * * *')

  await applyCarrierPollSchedule()

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
  await applyInboundMailSchedule()

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

  /*
    Inbound receipts that never became anything, every ten minutes. Slow on
    purpose: a receipt is only picked up once it has sat ten minutes untouched,
    which is past a healthy job and past pg-boss's own first retries.
  */
  await b.schedule(JOBS.inboundRedrive, '*/10 * * * *')
}

/**
 * Queue the job that turns one inbound receipt into an enquiry.
 *
 * Keyed on the receipt and throttled to one per minute, so a provider retrying
 * hard, or the re-drive sweep overlapping a redelivery, does not stack a dozen
 * jobs for one event. A duplicate that slips through anyway is harmless — see
 * `enqueueOnce` in `webhooks/index.ts`.
 */
export async function sendReceiptJob(
  b: Pick<PgBoss, 'send'>,
  jobName: string,
  eventId: string,
): Promise<void> {
  await b.send(jobName, { eventId }, { singletonKey: eventId, singletonSeconds: 60 })
}

/**
 * The carrier poll's schedule, which is a settings row rather than a constant.
 *
 * Hourly on the half hour by default, because that is the resolution the
 * events themselves have: a carrier publishes a discharge minutes to an hour
 * after the crane, so asking more often buys nothing but rate limit. It is
 * configurable because a trial tier's budget and a commercial tier's are
 * different problems, and because a demo wants to see the thing work inside
 * ten minutes rather than inside an hour.
 *
 * Off unless carrier tracking is set to `dcsa`: the worker answers "nothing to
 * do" for the other drivers rather than branching, exactly as `fxIngest` does
 * when no feed is bought.
 *
 * ## Why this needs a reconciler and the other settings do not
 *
 * Everything else that moved into `integration_settings` is read at the moment
 * it is used, so a change takes effect on the next tick. A cron is different:
 * it is *registered with pg-boss*, once, and pg-boss keeps firing the old one
 * until somebody tells it otherwise. A settings cache expiring cannot deliver
 * that — something has to notice and re-register.
 *
 * So the poll reconciles its own schedule at the end of each run. Changing
 * hourly to every ten minutes therefore takes effect at the next hourly run
 * rather than immediately, which is the right trade: the alternative is a
 * reconcile loop on its own timer, running for ever on every deployment, to
 * save at most one period of a setting that changes when a carrier contract
 * does. It converges, it is self-healing after a restart, and it costs
 * nothing on the deployments that never touch it.
 */
export async function applyCarrierPollSchedule(): Promise<string> {
  const b = await getBoss()
  const settings = await integration('carrierPoll')
  const cron = settings.text('cron')?.trim() || config.CARRIER_POLL_CRON

  /*
    A cron pg-boss cannot parse would throw out of the run that reconciled it,
    and on the boot path it would stop the service. Refused here and the
    previous schedule is left alone, which is the state an administrator can
    still recover from — the form validates this too, so reaching it means the
    value arrived some other way.
  */
  if (!/^\S+(\s+\S+){4}$/.test(cron)) {
    throw new Error(`The carrier poll schedule "${cron}" is not a five-field cron expression.`)
  }

  // Idempotent by job name: pg-boss replaces the existing schedule rather than
  // adding a second one, so this is safe to call on every run.
  await b.schedule(JOBS.carrierPoll, cron)
  return cron
}

/**
 * The inbound mail poll's schedule — the second cron that is a settings row.
 *
 * Same shape and same reason as `applyCarrierPollSchedule` above: pg-boss
 * holds the expression it was registered with, so a cache expiry cannot
 * deliver a change on its own and something has to re-register. The poll
 * reconciles its own schedule at the end of each run, which for a per-minute
 * job means a change takes effect within a minute.
 */
export async function applyInboundMailSchedule(): Promise<string> {
  const b = await getBoss()
  const settings = await integration('inboundEmail')
  const cron = settings.text('cron')?.trim() || config.INBOUND_MAIL_CRON

  if (!/^\S+(\s+\S+){4}$/.test(cron)) {
    throw new Error(`The inbound mail schedule "${cron}" is not a five-field cron expression.`)
  }

  await b.schedule(JOBS.inboundMailPoll, cron)
  return cron
}
