/**
 * Worker registration — one file per job type (§4, §9).
 *
 * Every job in the §9 table is registered here. The ones that are stubs today
 * are stubs *with their trigger and requirement recorded*, so the gap between
 * the architecture and the build is visible in the code rather than in a
 * tracking spreadsheet.
 */

import type { Job } from 'pg-boss'
import { JOBS, applyCarrierPollSchedule, getBoss } from '../queue'
import { runFreeTimeAccrual } from './free-time-accrual'
import { runFreeTimeWarnings } from './free-time-warning'
import { runSlaEscalation } from './sla-escalation'
import { runNotificationDispatch, registerChannel } from './notification-dispatch'
import { resolveEmailChannel } from '../adapters/index'
import { runFxRefresh } from './fx-refresh'
import { runCarrierEventIngest } from './carrier-event'
import { runCarrierPoll } from './carrier-poll'
import { runInvoiceOverdueNotices, runQuoteExpiryWarnings } from './commercial-reminders'
import { runInboundMailPoll } from './inbound-mail'
import { runRateCardExpiryDigest } from './rate-card-expiry'
import { extractSupplierInvoice, type ExtractInvoiceInput } from './invoice-extract'
import { runWebhookDelivery } from './webhook-delivery'

type Handler = (jobs: Job<Record<string, unknown>>[]) => Promise<void>

/** Jobs still to be built. Named so nothing silently goes missing. */
const PENDING: { name: string; trigger: string; requirement: string }[] = [
  /*
    Still pending, and now for a narrower reason.

    FR-EQ-02's intake is built — `inbound-mail.ts`, fed by `JOBS.inboundMailPoll`
    against Al-Qabandi's own mailboxes. This entry is the *other* implementation
    of `InboundMailSource`: the route in `webhooks/index.ts` verifies a
    signature and enqueues, and nothing yet turns a provider's receipt into an
    `InboundMessage`. Everything downstream of that conversion already exists,
    so closing it is an adapter rather than a feature.
  */
  { name: JOBS.inboundEmail, trigger: 'webhook', requirement: 'FR-EQ-02 — provider half' },
  { name: JOBS.inboundWhatsApp, trigger: 'webhook', requirement: 'FR-NT-05' },
  /*
    The renderer and the invoice template now exist and are wired to
    `/internal/documents/invoice/:id`, which renders on demand and streams.
    This queued job is what *stores* a document at issue — the moment an
    invoice stops being a view of editable rows and becomes a record — and it
    waits on `FileStore`, which has no implementation yet.
  */
  { name: JOBS.pdfRender, trigger: 'on issue', requirement: '§8 — needs FileStore' },
  { name: JOBS.complianceExpiry, trigger: 'nightly', requirement: 'FR-MD-05' },
  { name: JOBS.bulkImport, trigger: 'on upload', requirement: 'FR-MD-11, FR-RT-09' },
  { name: JOBS.scheduledReport, trigger: 'daily/weekly', requirement: 'FR-RP-07' },
]

export async function registerWorkers(log: {
  info: (o: unknown, m: string) => void
}): Promise<void> {
  const boss = await getBoss()

  /*
    The channel registry, filled at boot and refreshed per run.

    It has been empty since Release One, which meant every notification the
    product raised resolved no adapter and was written off as
    `failed: no adapter` — recorded honestly, and read by nobody. Registering
    here rather than inside `adapters()` keeps the logger out of the adapter
    resolver and puts the registration next to the dispatcher that consumes it.

    Filled here *and* before each dispatch, because the relay is a settings row
    now. Registering once at boot would mean an administrator who corrects the
    SMTP password watches the queue keep failing against the old one until
    somebody restarts the service — which is the failure this whole change
    exists to remove, reintroduced one layer up.
  */
  registerChannel(await resolveEmailChannel(log.info.bind(log)))

  const work = async (name: string, handler: Handler): Promise<void> => {
    await boss.work(name, { batchSize: 1 }, handler as never)
  }

  await work(JOBS.freeTimeAccrual, async () => {
    const result = await runFreeTimeAccrual()
    log.info(result, 'free-time accrual complete')
  })

  /*
    The other direction on the same clock: the accrual above bills what a
    container has already cost, this tells somebody while it is still free.
  */
  await work(JOBS.freeTimeWarning, async () => {
    const result = await runFreeTimeWarnings()
    if (result.warned > 0) log.info(result, 'free-time warnings raised')
  })

  await work(JOBS.slaEscalation, async () => {
    const result = await runSlaEscalation()
    log.info(result, 'SLA escalation complete')
  })

  /*
    Inbound mail — FR-EQ-02's front door.

    Logged only when it did something. This runs every minute on every
    deployment including the ones with no mailbox configured, and a per-minute
    "collected 0" would bury every other line in the service log within a day.
    A mailbox that *failed* is logged by the worker itself regardless, because
    that one is an incident.
  */
  await work(JOBS.inboundMailPoll, async () => {
    const result = await runInboundMailPoll()
    if (result.collected > 0 || result.failed > 0) log.info(result, 'inbound mail collected')
  })

  /*
    The schedule for this has existed since Release One (`0 5 * * *` in
    `queue.ts`) with no handler behind it, so the job was enqueued daily and
    discarded. The rate feed itself is off unless `FX_SOURCE=api`, and the
    worker answers "nothing to do" in that case rather than branching.
  */
  await work(JOBS.fxIngest, async () => {
    const result = await runFxRefresh()
    log.info(result, 'fx refresh complete')
  })

  /*
    One carrier event per job, because attribution can refuse.

    A batch would have to decide what to do when three of ten events cannot be
    tied to a shipment — retry the batch and reprocess the seven that
    succeeded, or swallow them. One at a time makes each outcome its own record
    and its own retry.
  */
  await work(JOBS.carrierEvent, async (queued) => {
    for (const job of queued) {
      const { eventId } = job.data as { eventId: string }
      const result = await runCarrierEventIngest(eventId)
      log.info(result, 'carrier event ingested')
    }
  })

  /*
    Carrier-direct tracking: we ask, rather than paying somebody to be told.

    The counterpart to `carrierEvent` above, which is an aggregator pushing.
    Both end in `carrier-milestone.ts`, so the two feeds cannot drift apart on
    the question of whether a machine may overwrite a person.
  */
  await work(JOBS.carrierPoll, async () => {
    const result = await runCarrierPoll()
    /*
      Logged when it asked somebody something, or when a carrier told it to
      stop. This runs on every deployment including the ones with no carrier
      registered, and a per-run "nothing to do" line is how a log stops being
      read — but a rate limit is the one silent outcome worth breaking that
      rule for, because it is the difference between a quiet feed and a
      throttled one.
    */
    if (result.polled > 0 || result.rateLimited.length > 0 || result.malformed.length > 0) {
      log.info(result, 'carrier poll complete')
    }

    /*
      Pick up a schedule change, at the end rather than the start.

      The cron is registered with pg-boss and nothing re-reads it, so unlike
      every other setting a cache expiry cannot deliver this one — something
      has to notice and re-register. At the end so that a rejected expression
      cannot stop the run that would have reported it, and logged rather than
      thrown for the same reason.
    */
    try {
      await applyCarrierPollSchedule()
    } catch (error) {
      log.info({ err: error }, 'carrier poll schedule not applied; keeping the previous one')
    }
  })

  /*
    Coverage about to lapse (FR-RT-11).

    Scheduled since Release One with nothing behind it, exactly as `fxIngest`
    was: enqueued at 21:45 every night and discarded for want of a handler.
    Two of those is a pattern, so `pnpm lint` now compares the schedule list
    against this one instead of a person doing it.
  */
  await work(JOBS.rateCardExpiry, async () => {
    const result = await runRateCardExpiryDigest()
    if (result.raised > 0) log.info(result, 'rate-card expiry digest raised')
  })

  /*
    Outbound webhooks (FR-AD-06).

    On the same minute as the notification dispatcher below, and for the same
    reason: both read `notification_outbox`, and a customer's system should
    learn a container was discharged at the same time their inbox does. The two
    stamps are separate columns so neither channel's progress marks the event
    finished for the other.
  */
  await work(JOBS.webhookDelivery, async () => {
    const result = await runWebhookDelivery()
    if (result.expanded + result.sent + result.failed > 0) {
      log.info(result, 'outbound webhooks')
    }
  })

  /*
    The two notifications that fire because time passed rather than because
    somebody clicked (FR-NT-01). Both only raise outbox rows — the dispatcher
    below owns everything about actually sending.
  */
  await work(JOBS.quoteExpiry, async () => {
    const result = await runQuoteExpiryWarnings()
    log.info(result, 'quote expiry warnings raised')
  })

  await work(JOBS.invoiceOverdue, async () => {
    const result = await runInvoiceOverdueNotices()
    log.info(result, 'invoice overdue notices raised')
  })

  await work(JOBS.notificationDispatch, async (jobs) => {
    /*
      Re-resolved per run, not per message.

      `settings.ts` caches for thirty seconds, so this is one query a minute in
      the steady state and none at all on a deployment configured purely from
      the environment. Doing it inside the loop would be a resolve per queued
      notification, which on a busy morning is the difference between a query
      and a thousand of them.
    */
    registerChannel(await resolveEmailChannel(log.info.bind(log)))

    for (const job of jobs) {
      const result = await runNotificationDispatch(job.data)
      // Logged only when it did something. This runs every minute, and a
      // per-minute "nothing to do" line is how a log stops being read.
      if (result.expanded || result.sent || result.failed || result.deferred) {
        log.info(result, 'notifications dispatched')
      }
    }
  })

  /*
    Supplier invoice extraction — FR-FN-09's missing half.

    The failure is logged and swallowed rather than rethrown, and that is
    deliberate for this job alone. Every other worker here is idempotent
    housekeeping that should retry; this one has already spent money by the
    time it can fail, the ledger already carries the reason, and pg-boss's five
    retries would spend it five more times against a scan that is not going to
    become readable. A bill that could not be read is a bill somebody types —
    which is exactly where they were before this existed.
  */
  await work(JOBS.invoiceExtract, async (jobs) => {
    for (const job of jobs) {
      const input = job.data as unknown as ExtractInvoiceInput
      try {
        const result = await extractSupplierInvoice(input)
        log.info(
          {
            assetId: input.assetId,
            invocationId: result.invocationId,
            consistent: result.consistent,
            lines: result.extracted.lines.rows.length,
            supplierInvoiceId: result.supplierInvoiceId,
            refusal: result.refusal,
          },
          result.supplierInvoiceId ? 'supplier invoice extracted' : 'supplier invoice not written',
        )
      } catch (error) {
        log.info(
          { assetId: input.assetId, err: error instanceof Error ? error.message : String(error) },
          'supplier invoice extraction failed',
        )
      }
    }
  })

  for (const pending of PENDING) {
    log.info(pending, 'job registered but not yet implemented')
  }
}
