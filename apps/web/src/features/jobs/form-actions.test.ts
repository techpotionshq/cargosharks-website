/**
 * Booking a shipment, and correcting one already booked.
 *
 * Two decisions in this action are worth pinning because both are asymmetric
 * on purpose.
 *
 * **Credit is checked on booking, not on update.** Booking is the moment the
 * exposure is taken on; an update is a coordinator correcting a vessel name on
 * work already accepted, and blocking that would strand the shipment rather
 * than prevent it.
 *
 * **The arrival estimate is read before it is overwritten.** `job.eta_changed`
 * is only worth raising when the arrival actually moved — a save that touched
 * the vessel name must not tell a customer their dates changed.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { desc, eq } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const harness = vi.hoisted(() => ({ session: null as unknown }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/session', () => ({ requireSession: async () => harness.session }))

const { jobPartners, jobs, withActor } = await import('@qabandi/db')

const {
  CUSTOMER,
  DESTINATION,
  HOME_BRANCH,
  AWAY_BRANCH,
  ORIGIN,
  PARTNER,
  PRINCIPAL,
  bothBranchesActor,
  world,
} = await import('@/lib/testing/fixtures')

const { saveJob, addJobPartner } = await import('./form-actions')

const session = {
  actor: bothBranchesActor,
  principal: {
    id: PRINCIPAL,
    nameEn: 'Jobs Test',
    nameAr: null,
    email: 'jobs@qabandi.test',
    locale: 'en' as const,
  },
  permissions: new Set(['job.book', 'job.update', 'job.close', 'job.hold', 'job.cancel']),
  branchRoles: new Map([
    [HOME_BRANCH, 'coordinator'],
    [AWAY_BRANCH, 'coordinator'],
  ]),
  requiresTwoFactor: false,
}

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

const booking = (extra: Record<string, string> = {}) =>
  form({
    branchId: HOME_BRANCH,
    customerId: CUSTOMER,
    mode: 'sea_fcl',
    tradeDirection: 'import',
    status: 'booked',
    originId: ORIGIN,
    destinationId: DESTINATION,
    ...extra,
  })

/** The most recently created shipment for the fixture customer. */
async function latestJob() {
  const [row] = await withActor(bothBranchesActor, (tx) =>
    tx
      .select({
        id: jobs.id,
        reference: jobs.reference,
        status: jobs.status,
        eta: jobs.eta,
        vesselName: jobs.vesselName,
      })
      .from(jobs)
      .where(eq(jobs.customerId, CUSTOMER))
      .orderBy(desc(jobs.createdAt))
      .limit(1),
  )
  return row!
}

async function etaEventsFor(jobId: string): Promise<number> {
  const result = await withActor(bothBranchesActor, (tx) =>
    tx.execute(
      `select count(*)::int as n from notification_outbox
        where job_id = '${jobId}' and event_key = 'job.eta_changed'`,
    ),
  )
  return (result.rows[0] as { n: number }).n
}

describe.skipIf(!enabled)('booking a shipment', () => {
  beforeAll(async () => {
    await world()
    harness.session = session
  })

  afterAll(() => {
    harness.session = null
  })

  describe('creating', () => {
    it('books a shipment and gives it a reference', async () => {
      const state = await saveJob({}, booking())

      expect(state.errors).toBeUndefined()
      expect(state.message).toBeUndefined()

      const job = await latestJob()
      // `FXH-JOB-2026-00001` — branch code, its own series, zero-padded.
      expect(job.reference).toMatch(/^FXH-JOB-\d{4}-\d{5}$/)
      expect(job.status).toBe('booked')
    })

    it('gives consecutive shipments consecutive references', async () => {
      await saveJob({}, booking())
      const first = await latestJob()
      await saveJob({}, booking())
      const second = await latestJob()

      const number = (r: string) => Number(r.split('-')[3])
      expect(number(second.reference)).toBe(number(first.reference) + 1)
    })

    it('insists on somewhere to start and somewhere to go', async () => {
      const state = await saveJob(
        {},
        form({
          branchId: HOME_BRANCH,
          customerId: CUSTOMER,
          mode: 'sea_fcl',
          tradeDirection: 'import',
          status: 'booked',
        }),
      )
      expect(state.errors?.originId ?? state.errors?.destinationId).toBeDefined()
    })

    it('refuses a mode it does not carry', async () => {
      const state = await saveJob({}, booking({ mode: 'teleport' }))
      expect(state.errors?.mode).toBeDefined()
    })

    it('reports field errors rather than throwing on a bad form', async () => {
      const state = await saveJob({}, form({ branchId: HOME_BRANCH }))
      expect(state.errors).toBeDefined()
    })

    it('records the cargo figures it was given', async () => {
      await saveJob({}, booking({ grossWeightKg: '1250.500', volumeCbm: '12.250', pieces: '8' }))
      const job = await latestJob()

      const [row] = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ weight: jobs.grossWeightKg, volume: jobs.volumeCbm, pieces: jobs.pieces })
          .from(jobs)
          .where(eq(jobs.id, job.id)),
      )
      expect(Number(row!.weight)).toBeCloseTo(1250.5, 3)
      expect(Number(row!.volume)).toBeCloseTo(12.25, 3)
      expect(row!.pieces).toBe(8)
    })
  })

  describe('correcting one already booked', () => {
    it('updates without raising an arrival notice when the arrival did not move', async () => {
      await saveJob({}, booking({ eta: '2026-09-01T08:00' }))
      const job = await latestJob()
      const before = await etaEventsFor(job.id)

      await saveJob(
        {},
        booking({ jobId: job.id, eta: '2026-09-01T08:00', vesselName: 'MV Corrected' }),
      )

      const after = await latestJob()
      expect(after.vesselName).toBe('MV Corrected')
      expect(await etaEventsFor(job.id)).toBe(before)
    })

    /** The notice exists for the case the customer's dates actually changed. */
    it('raises an arrival notice when the arrival moves', async () => {
      await saveJob({}, booking({ eta: '2026-09-01T08:00' }))
      const job = await latestJob()
      const before = await etaEventsFor(job.id)

      await saveJob({}, booking({ jobId: job.id, eta: '2026-09-08T08:00' }))

      expect(await etaEventsFor(job.id)).toBe(before + 1)
    })

    /**
     * Documented rather than endorsed: saving against a shipment the actor
     * cannot see throws `not_found` and the catch only maps unique violations,
     * so it surfaces as an unhandled failure rather than a sentence. Reachable
     * only from a stale screen — the register never offers an invisible job —
     * which is why it is pinned here rather than changed.
     */
    it('raises rather than reporting when the shipment is not visible', async () => {
      await expect(
        saveJob({}, booking({ jobId: '00000000-0000-7000-8000-0000000000fa' })),
      ).rejects.toThrow('not_found')
    })
  })

  describe('partners on a shipment', () => {
    it('attaches an agent in a role', async () => {
      await saveJob({}, booking())
      const job = await latestJob()

      const state = await addJobPartner(
        {},
        form({ jobId: job.id, branchId: HOME_BRANCH, partnerId: PARTNER, role: 'origin_agent' }),
      )

      expect(state.errors).toBeUndefined()
      const rows = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ role: jobPartners.role })
          .from(jobPartners)
          .where(eq(jobPartners.jobId, job.id)),
      )
      expect(rows.map((r) => r.role)).toContain('origin_agent')
    })

    it('reports field errors rather than throwing on a bad form', async () => {
      const state = await addJobPartner({}, form({ partnerId: PARTNER }))
      expect(state.errors).toBeDefined()
    })
  })
})
