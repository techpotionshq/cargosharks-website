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
import { runNotificationDispatch } from './notification-dispatch'
import { runFxRefresh } from './fx-refresh'
import { runCarrierEventIngest } from './carrier-event'

type Handler = (jobs: Job<Record<string, unknown>>[]) => Promise<void>

/** Jobs still to be built. Named so nothing silently goes missing. */
const PENDING: { name: string; trigger: string; requirement: string }[] = [
  { name: JOBS.inboundEmail, trigger: 'webhook', requirement: 'FR-EQ-02' },
  { name: JOBS.inboundWhatsApp, trigger: 'webhook', requirement: 'FR-NT-05' },
  { name: JOBS.pdfRender, trigger: 'on demand', requirement: '§8, bilingual' },
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

  await work(JOBS.notificationDispatch, async (jobs) => {
    for (const job of jobs) await runNotificationDispatch(job.data)
  })

  for (const pending of PENDING) {
    log.info(pending, 'job registered but not yet implemented')
  }
}
