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
import { and, desc, eq, like } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const harness = vi.hoisted(() => ({ session: null as unknown }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/session', () => ({ requireSession: async () => harness.session }))

/**
 * The message keys stand in for the sentences, so an assertion names the case
 * rather than a wording a translator is free to change — as in `auth/actions.test.ts`.
 */
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    values ? `${namespace}.${key}:${JSON.stringify(values)}` : `${namespace}.${key}`,
}))

const { enquiries, jobPartners, jobs, quotes, withActor } = await import('@qabandi/db')

const {
  AWAY_CUSTOMER,
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
const { getQuoteDetail } = await import('@/features/ledger/queries')

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

/**
 * The most recently *booked* shipment for the fixture customer.
 *
 * Narrowed to the generated reference format rather than to the customer,
 * because the importer suite books against the same customer and keeps the old
 * file number — so "the newest row" was sometimes a cutover import from
 * another file running beside this one.
 */
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
      .where(and(eq(jobs.customerId, CUSTOMER), like(jobs.reference, 'FXH-JOB-2%')))
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

  /**
   * O1 — the edit form wiped half the job.
   *
   * Each case is one of the ways a save used to corrupt the record: a field
   * the form did not carry was nulled, the status moved without its own
   * checks, and a cleared ETA told the customer it had "changed to —".
   */
  describe('an edit leaves alone what it did not carry', () => {
    async function row(jobId: string) {
      const [found] = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({
            bookingNumber: jobs.bookingNumber,
            voyageNumber: jobs.voyageNumber,
            vesselName: jobs.vesselName,
            status: jobs.status,
            eta: jobs.eta,
            etd: jobs.etd,
          })
          .from(jobs)
          .where(eq(jobs.id, jobId)),
      )
      return found!
    }

    it('keeps the columns a narrower form does not post', async () => {
      await saveJob(
        {},
        booking({ bookingNumber: 'BKG-KEEP', voyageNumber: '077W', vesselName: 'CMA CGM TAGE' }),
      )
      const job = await latestJob()

      // No bookingNumber or voyageNumber key at all — an older or narrower form.
      await saveJob({}, booking({ jobId: job.id, vesselName: 'CMA CGM TAGE' }))

      const after = await row(job.id)
      expect(after.bookingNumber).toBe('BKG-KEEP')
      expect(after.voyageNumber).toBe('077W')
      expect(after.vesselName).toBe('CMA CGM TAGE')
    })

    it('still clears a field the form posts empty', async () => {
      await saveJob({}, booking({ bookingNumber: 'BKG-CLEAR' }))
      const job = await latestJob()
      await saveJob({}, booking({ jobId: job.id, bookingNumber: '' }))
      expect((await row(job.id)).bookingNumber).toBeNull()
    })

    it('does not move the status, whatever the form posts', async () => {
      await saveJob({}, booking())
      const job = await latestJob()
      await saveJob({}, booking({ jobId: job.id, status: 'closed' }))
      expect((await row(job.id)).status).toBe('booked')
    })

    it('will not open a shipment already closed', async () => {
      const state = await saveJob({}, booking({ status: 'closed' }))
      expect(state.errors?.status).toBeDefined()
    })

    it('tells nobody when the arrival estimate is cleared', async () => {
      await saveJob({}, booking({ eta: '2026-09-01T08:00' }))
      const job = await latestJob()
      const before = await etaEventsFor(job.id)

      await saveJob({}, booking({ jobId: job.id, eta: '' }))

      expect((await row(job.id)).eta).toBeNull()
      expect(await etaEventsFor(job.id)).toBe(before)
    })
  })

  /** O4 — a time typed into the form is the branch's, not the server's. */
  describe('dates are read in the branch zone', () => {
    it('stores a Kuwait 22:00 ETA as 19:00 UTC, on the same day', async () => {
      await saveJob({}, booking({ etd: '2026-09-01T09:00', eta: '2026-09-20T22:00' }))
      const job = await latestJob()
      const [found] = await withActor(bothBranchesActor, (tx) =>
        tx.select({ etd: jobs.etd, eta: jobs.eta }).from(jobs).where(eq(jobs.id, job.id)),
      )
      expect(found!.etd!.toISOString()).toBe('2026-09-01T06:00:00.000Z')
      expect(found!.eta!.toISOString()).toBe('2026-09-20T19:00:00.000Z')
    })

    it('refuses a lone point as a weight rather than failing in the database', async () => {
      const state = await saveJob({}, booking({ grossWeightKg: '.' }))
      expect(state.errors?.grossWeightKg).toBe('jobsValidation.numbersOnly')
    })
  })

  /** O14 — the house bill is ours, and names one consignment per branch. */
  describe('house bill numbers', () => {
    it('refuses a house bill already on another shipment, on that field', async () => {
      const hbl = `HBL-${Date.now()}`
      expect((await saveJob({}, booking({ houseBillNumber: hbl }))).errors).toBeUndefined()

      const state = await saveJob({}, booking({ houseBillNumber: hbl }))
      expect(state.errors?.houseBillNumber).toBe('jobsValidation.houseBillTaken')
      expect(state.errors?.masterBillNumber).toBeUndefined()
    })

    it('lets houses share a master bill', async () => {
      const mbl = `MBL-${Date.now()}`
      await saveJob({}, booking({ masterBillNumber: mbl }))
      const state = await saveJob({}, booking({ masterBillNumber: mbl }))
      expect(state.errors).toBeUndefined()
    })
  })

  /**
   * S8 — booking from an accepted quotation.
   *
   * `saveJob` accepted any quote id: a draft, another customer's, or one
   * already booked, and weighed credit against whichever it was given.
   */
  describe('booking from a quotation', () => {
    async function quotation(
      status: 'draft' | 'accepted',
      customerId: string = CUSTOMER,
    ): Promise<{ quoteId: string; enquiryId: string }> {
      const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      return withActor(bothBranchesActor, async (tx) => {
        const [enquiry] = await tx
          .insert(enquiries)
          .values({
            reference: `FXH-ENQ-S8-${tag}`,
            branchId: HOME_BRANCH,
            customerId,
            status: 'quoted',
          })
          .returning({ id: enquiries.id })
        const [quote] = await tx
          .insert(quotes)
          .values({
            reference: `FXH-QUO-S8-${tag}`,
            enquiryId: enquiry!.id,
            branchId: HOME_BRANCH,
            currency: 'KWD',
            status,
            totalSell: '100.000',
          })
          .returning({ id: quotes.id })
        return { quoteId: quote!.id, enquiryId: enquiry!.id }
      })
    }

    async function enquiryStatus(enquiryId: string) {
      const [found] = await withActor(bothBranchesActor, (tx) =>
        tx.select({ status: enquiries.status }).from(enquiries).where(eq(enquiries.id, enquiryId)),
      )
      return found!.status
    }

    it('books an accepted quotation and wins its enquiry', async () => {
      const { quoteId, enquiryId } = await quotation('accepted')
      const state = await saveJob({}, booking({ quoteId }))
      expect(state.errors).toBeUndefined()
      expect(await enquiryStatus(enquiryId)).toBe('won')

      // QA P3: the quotation page says where the shipment went.
      const detail = await getQuoteDetail(bothBranchesActor, quoteId)
      expect(detail?.bookedJob?.reference).toBe(String(state.ok).replace(/:\d+$/, ''))
    })

    it('refuses a quotation that was never accepted', async () => {
      const { quoteId, enquiryId } = await quotation('draft')
      const state = await saveJob({}, booking({ quoteId }))
      expect(state.errors?.quoteId).toBe('jobsValidation.quoteNotAccepted')
      expect(await enquiryStatus(enquiryId)).toBe('quoted')
    })

    it("refuses another customer's quotation", async () => {
      const { quoteId } = await quotation('accepted', AWAY_CUSTOMER)
      const state = await saveJob({}, booking({ quoteId }))
      expect(state.errors?.quoteId).toBe('jobsValidation.quoteOtherCustomer')
    })

    it('refuses to book the same quotation twice', async () => {
      const { quoteId } = await quotation('accepted')
      expect((await saveJob({}, booking({ quoteId }))).errors).toBeUndefined()
      const state = await saveJob({}, booking({ quoteId }))
      expect(state.errors?.quoteId).toBe('jobsValidation.quoteAlreadyBooked')
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
