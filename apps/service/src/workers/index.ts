/**
 * Worker registration — one file per job type (§4, §9).
 *
 * Every job in the §9 table is registered here. The ones that are stubs today
 * are stubs *with their trigger and requirement recorded*, so the gap between
 * the architecture and the build is visible in the code rather than in a
 * tracking spreadsheet.
 */

import type { Job } from 'pg-boss'
import { JOBS, getBoss } from '../queue'
import { runFreeTimeAccrual } from './free-time-accrual'
import { runSlaEscalation } from './sla-escalation'
import { runNotificationDispatch, registerChannel } from './notification-dispatch'
import { resolveEmailChannel } from '../adapters/index'
import { runFxRefresh } from './fx-refresh'
import { runCarrierEventIngest } from './carrier-event'
import { runInvoiceOverdueNotices, runQuoteExpiryWarnings } from './commercial-reminders'

type Handler = (jobs: Job<Record<string, unknown>>[]) => Promise<void>

/** Jobs still to be built. Named so nothing silently goes missing. */
const PENDING: { name: string; trigger: string; requirement: string }[] = [
  { name: JOBS.inboundEmail, trigger: 'webhook', requirement: 'FR-EQ-02' },
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
  { name: JOBS.rateCardExpiry, trigger: 'nightly', requirement: 'FR-RT-11' },
  { name: JOBS.bulkImport, trigger: 'on upload', requirement: 'FR-MD-11, FR-RT-09' },
  { name: JOBS.webhookDelivery, trigger: 'event', requirement: 'FR-AD-06' },
  { name: JOBS.scheduledReport, trigger: 'daily/weekly', requirement: 'FR-RP-07' },
]

export async function registerWorkers(log: {
  info: (o: unknown, m: string) => void
}): Promise<void> {
  const boss = await getBoss()

  /*
    The channel registry, filled.

    It has been empty since Release One, which meant every notification the
    product raised resolved no adapter and was written off as
    `failed: no adapter` — recorded honestly, and read by nobody. Registering
    here rather than inside `adapters()` keeps the logger out of the adapter
    resolver and puts the registration next to the dispatcher that consumes it.
  */
  registerChannel(resolveEmailChannel(log.info.bind(log)))

  const work = async (name: string, handler: Handler): Promise<void> => {
    await boss.work(name, { batchSize: 1 }, handler as never)
  }

  await work(JOBS.freeTimeAccrual, async () => {
    const result = await runFreeTimeAccrual()
    log.info(result, 'free-time accrual complete')
  })

  await work(JOBS.slaEscalation, async () => {
    const result = await runSlaEscalation()
    log.info(result, 'SLA escalation complete')
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
    for (const job of jobs) {
      const result = await runNotificationDispatch(job.data)
      // Logged only when it did something. This runs every minute, and a
      // per-minute "nothing to do" line is how a log stops being read.
      if (result.expanded || result.sent || result.failed || result.deferred) {
        log.info(result, 'notifications dispatched')
      }
    }
  })

  for (const pending of PENDING) {
    log.info(pending, 'job registered but not yet implemented')
  }
}
