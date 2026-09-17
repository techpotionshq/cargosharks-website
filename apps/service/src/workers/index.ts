/**
 * Worker registration — one file per job type (§4, §9).
 *
 * Every job in the §9 table is registered here. The ones that are stubs today
 * are stubs *with their trigger and requirement recorded*, so the gap between
 * the architecture and the build is visible in the code rather than in a
 * tracking spreadsheet.
 */

import type { Job } from 'pg-boss'
import { JOBS, applyCarrierPollSchedule, applyInboundMailSchedule, getBoss } from '../queue'
import { runFreeTimeAccrual } from './free-time-accrual'
import { runFreeTimeWarnings } from './free-time-warning'
import { runSlaEscalation } from './sla-escalation'
import { runNotificationDispatch, registerChannel } from './notification-dispatch'
import { inAppChannel, resolveEmailChannel } from '../adapters/index'
import { runFxRefresh } from './fx-refresh'
import { runCarrierPoll } from './carrier-poll'
import { runInvoiceOverdueNotices, runQuoteExpiryWarnings } from './commercial-reminders'
import { runInboundMailPoll } from './inbound-mail'
import { runRateCardExpiryDigest } from './rate-card-expiry'
import { refreshExpiringRateCards } from './rate-card-refresh'
import { extractSupplierInvoice, type ExtractInvoiceInput } from './invoice-extract'
import { extractEnquiry, type ExtractEnquiryInput } from './enquiry-extract'
import { extractRateReply, type ExtractRateReplyInput } from './rate-extract'
import { sendRateRequests } from './rate-request-send'
import { autoFanoutRateRequests } from './rate-auto-fanout'
import { runInboundEmailWebhook, type InboundEmailWebhookInput } from './inbound-email-webhook'
import { runWebhookDelivery } from './webhook-delivery'

type Handler = (jobs: Job<Record<string, unknown>>[]) => Promise<void>

/** Jobs still to be built. Named so nothing silently goes missing. */
const PENDING: { name: string; trigger: string; requirement: string }[] = [
  { name: JOBS.inboundWhatsApp, trigger: 'webhook', requirement: 'FR-NT-05' },
  /*
    Superseded rather than pending, and left here as a marker until the name is
    retired from `JOBS`.

    This job was to *store* a document at issue, and it was blocked on
    `FileStore` having no implementation. `FileStore` shipped — `adapters/s3.ts`
    signs its own SigV4 and `pdf/store.ts` writes the bytes, the `assets` row
    and the versioned `documents` row inside one transaction, synchronously, at
    the moment issue happens. Doing it again on a queue would produce a second
    copy of a document whose whole point is that there is one.
  */
  { name: JOBS.pdfRender, trigger: 'superseded', requirement: '§8 — done by pdf/store.ts' },
  { name: JOBS.complianceExpiry, trigger: 'nightly', requirement: 'FR-MD-05' },
  { name: JOBS.bulkImport, trigger: 'on upload', requirement: 'FR-MD-11, FR-RT-09' },
  { name: JOBS.scheduledReport, trigger: 'daily/weekly', requirement: 'FR-RP-07' },
]

export async function registerWorkers(log: {
  info: (o: unknown, m: string) => void
  /**
   * One level above `info`, and there is exactly one thing that uses it.
   *
   * An extraction that proposed a field it may not speak to is a security
   * event rather than a busy day — `admissible()` keeps the refused names for
   * precisely this line, because silently filtering would lose the only
   * evidence a prompt injection was attempted.
   */
  warn: (o: unknown, m: string) => void
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
  // Static, so registered once beside the relay rather than re-resolved: the
  // in-app channel has no configuration to reload and cannot fail to build.
  registerChannel(inAppChannel)

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

    /*
      Pick up a schedule change, at the end and never fatally.

      The same reconciler the carrier poll runs, for the same reason: pg-boss
      holds the cron it was registered with and nothing re-reads it. This job
      runs every minute, so a corrected expression takes effect on the next
      tick.
    */
    try {
      await applyInboundMailSchedule()
    } catch (error) {
      log.info({ err: error }, 'inbound mail schedule not applied; keeping the previous one')
    }
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
    Carrier-direct tracking: we ask, rather than paying somebody to be told.

    The only automatic milestone feed there is. It ends in
    `carrier-milestone.ts`, which owns the rule about whether a machine may
    overwrite a person — the one place that question is answered.
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
    /*
      The digest tells the desk; the refresh acts. Same nightly job and same
      expiring list — a buy card inside the horizon opens a rate request to its
      incumbent agent, and the minute sweep mails it. Run after the digest so a
      failure to renew never suppresses the warning a person still needs.
    */
    const refreshed = await refreshExpiringRateCards()
    if (refreshed.opened > 0) log.info(refreshed, 'rate-card refresh requests opened')
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
    // Re-asserted beside the relay, so a dispatch reached by any path has the
    // in-app channel too. Idempotent and configuration-free, so unlike the
    // relay above it costs nothing to repeat.
    registerChannel(inAppChannel)

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
        /*
          The comment above holds for a scan that will not become readable. It
          does not hold for a provider that answered with nothing.

          Both were swallowed until a real bill arrived by email and the
          provider returned an empty body — the identical request succeeded a
          minute later, so five retries would have cost five more calls and
          *worked*, rather than spending five times to learn the same thing.
          "It has already spent money" argues against retrying a document; it
          argues for retrying a hiccup.

          So the split is the same one `enquiryExtract` makes below: a
          deployment with no model and one that has spent its budget are
          settled and swallowed; everything else goes back to the queue's
          backoff. What is *not* retried either way is a bill that was read and
          did not reconcile — that returns a refusal rather than throwing, and
          is already handled above.
        */
        const code = (error as { code?: string }).code
        const settled = code === 'ai.not_configured' || code === 'ai.budget_exhausted'

        log.info(
          {
            assetId: input.assetId,
            err: error instanceof Error ? error.message : String(error),
            retrying: !settled,
          },
          'supplier invoice extraction failed',
        )

        if (!settled) throw error
      }
    }
  })

  /*
    The provider half of the enquiry front door — FR-EQ-02.

    `/webhooks/email` has verified, recorded and queued since Release One with
    nothing on the other end: the route answered 202, the provider stopped
    retrying, and the enquiry never appeared. Failures rethrow here, unlike the
    two extraction jobs below, because everything this job can fail on is worth
    retrying — a database that blinked, storage that refused an attachment. The
    one failure that is not is an unreadable payload, and that returns a reason
    rather than throwing.
  */
  await work(JOBS.inboundEmail, async (jobs) => {
    for (const job of jobs) {
      const input = job.data as unknown as InboundEmailWebhookInput
      const result = await runInboundEmailWebhook(input)
      log.info(
        { eventId: input.eventId, outcome: result.outcome, enquiryId: result.enquiryId },
        result.reason ? `inbound email webhook: ${result.reason}` : 'inbound email webhook handled',
      )
    }
  })

  /*
    Reading an emailed enquiry — FR-EQ-02's twelve null columns.

    Failures are logged and swallowed, like the invoice above and for a related
    reason. This one has not necessarily spent money by the time it fails, so
    the argument is different: the enquiry is already on the board with its SLA
    clock running, and five retries against a mail the model cannot read would
    spend five times to arrive at the same coordinator typing the same twelve
    fields. What retrying *would* buy is a transient rate-limit clearing, which
    is real — so a provider failure is left to pg-boss and only a refusal to
    read this particular mail is swallowed.
  */
  await work(JOBS.enquiryExtract, async (jobs) => {
    for (const job of jobs) {
      const input = job.data as unknown as ExtractEnquiryInput
      try {
        const result = await extractEnquiry(input)
        log.info(
          {
            enquiryId: input.enquiryId,
            invocationId: result.invocationId,
            proposed: result.proposed,
            occupied: result.occupied,
            refused: result.refused,
            skipped: result.skipped,
          },
          result.proposed > 0 ? 'enquiry read' : 'enquiry read, nothing proposed',
        )
        /*
          A refusal is a security event, not a filter miss. `admissible()`
          keeps the names for exactly this line — an extraction that tried to
          set `customerId` is either a prompt bug or a mail that talked the
          model into one, and both want somebody's attention.
        */
        if (result.refused.length > 0) {
          log.warn(
            { enquiryId: input.enquiryId, refused: result.refused },
            'enquiry extraction proposed fields it may not speak to',
          )
        }
      } catch (error) {
        /*
          Transient failures rethrow so pg-boss retries; settled ones do not.

          Written this way after watching it happen: the provider returned an
          empty body on one of two enquiries, the same request succeeded
          untouched a minute later, and the twelve cargo facts on that mail
          were lost to a `catch` that logged and moved on. An empty response, a
          rate limit and a gateway error are all "ask again in thirty seconds",
          which is exactly what the queue's backoff is for.

          The two that must *not* retry are the ones five attempts cannot fix:
          a deployment with no model configured, and one that has reached its
          monthly ceiling. Retrying those spends the budget on discovering the
          budget is spent, and the enquiry is on the board either way — a
          coordinator types the fields, which is where they were before this
          existed.
        */
        const code = (error as { code?: string }).code
        const settled = code === 'ai.not_configured' || code === 'ai.budget_exhausted'

        log.info(
          {
            enquiryId: input.enquiryId,
            err: error instanceof Error ? error.message : String(error),
            retrying: !settled,
          },
          'enquiry extraction failed',
        )

        if (!settled) throw error
      }
    }
  })

  /*
    Reading a broker's rate reply — FR-RT-10. The same settled/transient split
    the two extraction jobs above make: no model and no budget are swallowed, a
    hiccup goes back to the backoff. A reply that read poorly is not a failure —
    it lands as `parsed` with issues a coordinator sees, so nothing throws for it.
  */
  await work(JOBS.rateExtract, async (jobs) => {
    for (const job of jobs) {
      const input = job.data as unknown as ExtractRateReplyInput
      try {
        const result = await extractRateReply(input)
        log.info(
          {
            rateRequestId: input.rateRequestId,
            invocationId: result.invocationId,
            status: result.status,
            lines: result.lines,
            rejected: result.rejected,
            skipped: result.skipped,
          },
          result.status === 'declined' ? 'rate reply read: declined' : 'rate reply read',
        )
      } catch (error) {
        const code = (error as { code?: string }).code
        const settled = code === 'ai.not_configured' || code === 'ai.budget_exhausted'
        log.info(
          {
            rateRequestId: input.rateRequestId,
            err: error instanceof Error ? error.message : String(error),
            retrying: !settled,
          },
          'rate reply extraction failed',
        )
        if (!settled) throw error
      }
    }
  })

  /*
    Sending rate requests to agents — the near end of FR-RT-10, a drain on a
    minute's cron. Web has no queue access, so the enquiry action writes the
    rows and this sweep sends them; a request whose agent has no email on file is
    skipped inside, not thrown, so one missing address never fails the sweep.
  */
  await work(JOBS.rateRequestSend, async () => {
    const result = await sendRateRequests()
    if (result.sent + result.skipped + result.failed > 0) log.info(result, 'rate requests sent')
  })

  /*
    Automatic rate procurement — FR-RT-10, the hands-off fan-out that feeds the
    send drain above. Scheduled every minute but off until the `rateAutoFanout`
    integration is switched to `auto`, so on the inert default it returns at once
    and logs nothing. Only a sweep that actually opened rows says so.
  */
  await work(JOBS.rateAutoFanout, async () => {
    const result = await autoFanoutRateRequests()
    if (result.enabled && result.enquiries > 0) log.info(result, 'rate requests auto-fanned')
  })

  for (const pending of PENDING) {
    log.info(pending, 'job registered but not yet implemented')
  }
}
