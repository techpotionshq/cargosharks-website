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
  fxIngest: 'fx-rate-ingest',
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
}
