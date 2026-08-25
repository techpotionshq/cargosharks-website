/**
 * Estimating duty on a shipment.
 *
 * Three decisions drive everything here, and each one is a choice about being
 * wrong in the safe direction:
 *
 * **The value is CIF, not the commercial invoice.** The GCC assesses on cost,
 * insurance and freight, so the freight we are charging is part of what duty
 * is computed on. Leaving it out is the single most common way an estimate
 * comes in low — and it comes in low by exactly the amount the customer least
 * expects to hear about later.
 *
 * **The general rate is off by default.** Applying 5% to a code the tariff has
 * no row for produces a number that looks researched and is a guess, and the
 * customer told "5%" on a code that turns out to be exempt has been mis-sold.
 *
 * **An unmatched line is reported, not silently zero.** The estimate is still
 * returned, because a partial answer is useful, but the sentence says how many
 * lines had no tariff row so nobody quotes the total as complete.
 *
 * The value is apportioned across lines by weight, which is not accurate and
 * is not meant to be: the total is right either way and a per-line figure is
 * what the broker can read.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const harness = vi.hoisted(() => ({ session: null as unknown }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/session', () => ({ requireSession: async () => harness.session }))

const { customsStages, jobCargo, jobs, withActor } = await import('@qabandi/db')

const { AWAY_BRANCH, CUSTOMER, HOME_BRANCH, PRINCIPAL, bothBranchesActor, world } =
  await import('@/lib/testing/fixtures')

const { estimateJobDuty } = await import('./duty-actions')

const systemActor = { ...bothBranchesActor, type: 'system' as const }

function sessionWith(permissions: readonly string[]) {
  return {
    actor: bothBranchesActor,
    principal: {
      id: PRINCIPAL,
      nameEn: 'Customs Broker',
      nameAr: null,
      email: 'customs@qabandi.test',
      locale: 'en' as const,
    },
    permissions: new Set(permissions),
    branchRoles: new Map([
      [HOME_BRANCH, 'coordinator'],
      [AWAY_BRANCH, 'coordinator'],
    ]),
    requiresTwoFactor: false,
  }
}

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

const RUN = Date.now().toString(36).toUpperCase().slice(-5)
let seq = 0

async function freshJob(): Promise<string> {
  seq += 1
  return withActor(systemActor, async (tx) => {
    const [row] = await tx
      .insert(jobs)
      .values({
        reference: `DTY-${RUN}-${seq}`,
        branchId: HOME_BRANCH,
        customerId: CUSTOMER,
        mode: 'sea_fcl',
        tradeDirection: 'import',
        status: 'customs',
      })
      .returning({ id: jobs.id })
    return row!.id
  })
}

/** Cargo lines, since duty is assessed on what is in the box. */
async function cargo(
  jobId: string,
  lines: { hsCode: string | null; weight: string; description?: string }[],
): Promise<void> {
  await withActor(systemActor, (tx) =>
    tx.insert(jobCargo).values(
      lines.map((line, index) => ({
        jobId,
        lineNo: index + 1,
        hsCode: line.hsCode,
        descriptionEn: line.description ?? `Line ${index + 1}`,
        grossWeightKg: line.weight,
      })),
    ),
  )
}

const stageFor = async (jobId: string) => {
  const [row] = await withActor(bothBranchesActor, (tx) =>
    tx.select().from(customsStages).where(eq(customsStages.jobId, jobId)),
  )
  return row
}

const estimate = (jobId: string, extra: Record<string, string> = {}) =>
  estimateJobDuty({}, form({ jobId, goodsValue: '1000.000', currency: 'KWD', ...extra }))

describe.skipIf(!enabled)('estimating duty', () => {
  beforeAll(async () => {
    await world()
    harness.session = sessionWith(['customs.update'])
  })

  afterAll(() => {
    harness.session = null
  })

  describe('the value duty is assessed on', () => {
    /**
     * The seeded Kuwaiti tariff carries `24` at 100% — tobacco, which is why
     * it is the row worth computing against: the duty equals the value, so the
     * arithmetic is legible in the assertion rather than buried in a rate.
     */
    it('assesses on cost, insurance and freight together', async () => {
      const jobId = await freshJob()
      await cargo(jobId, [{ hsCode: '2402.20', weight: '100' }])

      const state = await estimate(jobId, {
        goodsValue: '1000.000',
        freightValue: '150.000',
        insuranceValue: '50.000',
      })

      expect(state.message).toBeUndefined()
      const stage = await stageFor(jobId)
      // 1000 + 150 + 50, not 1000.
      expect(Number(stage?.customsValue)).toBeCloseTo(1200, 3)
      expect(Number(stage?.estimatedDutyAmount)).toBeCloseTo(1200, 3)
    })

    it('treats absent freight and insurance as nothing rather than refusing', async () => {
      const jobId = await freshJob()
      await cargo(jobId, [{ hsCode: '2402.20', weight: '100' }])

      await estimate(jobId, { goodsValue: '800.000' })

      expect(Number((await stageFor(jobId))?.customsValue)).toBeCloseTo(800, 3)
    })

    it('records the currency it was assessed in', async () => {
      const jobId = await freshJob()
      await cargo(jobId, [{ hsCode: '2402.20', weight: '100' }])

      await estimate(jobId, { currency: 'usd' })

      expect((await stageFor(jobId))?.customsValueCurrency).toBe('USD')
    })
  })

  describe('the tariff', () => {
    /** A zero-rated code is a real answer, not a missing one. */
    it('estimates nothing on a zero-rated code', async () => {
      const jobId = await freshJob()
      await cargo(jobId, [{ hsCode: '3004.90', weight: '100', description: 'Medicaments' }])

      const state = await estimate(jobId)

      expect(state.message).toBeUndefined()
      expect(Number((await stageFor(jobId))?.estimatedDutyAmount)).toBe(0)
    })

    /**
     * Reported rather than silently zero. The estimate still comes back —
     * a partial answer is useful — but the sentence says how many lines had
     * nothing to match, so nobody quotes the total as complete.
     */
    it('says how many lines had no tariff row', async () => {
      const jobId = await freshJob()
      await cargo(jobId, [{ hsCode: '9999.99', weight: '100', description: 'Unclassified' }])

      const state = await estimate(jobId)

      expect(state.message).toContain('no tariff row')
      expect(state.message).toContain('Reference → Duty rates')
    })

    it('treats a line with no HS code at all as unmatched', async () => {
      const jobId = await freshJob()
      await cargo(jobId, [{ hsCode: null, weight: '100', description: 'General cargo' }])

      expect((await estimate(jobId)).message).toContain('no tariff row')
    })

    /**
     * Off by default, and this is the assertion that keeps it off: a rate
     * applied to a code the tariff has no row for is a guess wearing a
     * number's clothes.
     */
    it('applies no general rate unless the operator asked for one', async () => {
      const jobId = await freshJob()
      await cargo(jobId, [{ hsCode: '9999.99', weight: '100' }])

      await estimate(jobId)

      expect(Number((await stageFor(jobId))?.estimatedDutyAmount)).toBe(0)
    })

    it('applies the GCC general rate where the operator said so', async () => {
      const jobId = await freshJob()
      await cargo(jobId, [{ hsCode: '9999.99', weight: '100' }])

      const state = await estimate(jobId, { goodsValue: '1000.000', useGeneralRate: 'on' })

      expect(state.message).toBeUndefined()
      // 5% of 1000.
      expect(Number((await stageFor(jobId))?.estimatedDutyAmount)).toBeCloseTo(50, 3)
    })
  })

  describe('the working shown', () => {
    /**
     * The basis is stored, not just the total. An estimate somebody quoted to
     * a customer has to be reconstructable — which line, which prefix matched,
     * at what rate.
     */
    it('records how the figure was reached', async () => {
      const jobId = await freshJob()
      await cargo(jobId, [
        { hsCode: '2402.20', weight: '60', description: 'Cigarettes' },
        { hsCode: '3004.90', weight: '40', description: 'Medicaments' },
      ])

      await estimate(jobId, { goodsValue: '1000.000' })

      const basis = (await stageFor(jobId))?.estimateBasis as {
        country: string
        currency: string
        generalRateApplied: boolean
        lines: { hsCode: string; ratePercent: string; value: string }[]
      }
      expect(basis.country).toBe('KW')
      expect(basis.currency).toBe('KWD')
      expect(basis.generalRateApplied).toBe(false)
      expect(basis.lines).toHaveLength(2)
    })

    /** Apportioned by weight: 60/40 of the value across two lines. */
    it('splits the value across the lines by weight', async () => {
      const jobId = await freshJob()
      await cargo(jobId, [
        { hsCode: '2402.20', weight: '60' },
        { hsCode: '3004.90', weight: '40' },
      ])

      await estimate(jobId, { goodsValue: '1000.000' })

      const stage = await stageFor(jobId)
      const basis = stage?.estimateBasis as { lines: { value: string }[] }
      expect(Number(basis.lines[0]!.value)).toBeCloseTo(600, 2)
      expect(Number(basis.lines[1]!.value)).toBeCloseTo(400, 2)
      // Only the tobacco line carries duty, at 100% of its apportioned value.
      expect(Number(stage?.estimatedDutyAmount)).toBeCloseTo(600, 2)
    })

    /** Nothing weighed means nothing to weight by — split evenly instead. */
    it('splits evenly where no line has a weight', async () => {
      const jobId = await freshJob()
      await cargo(jobId, [
        { hsCode: '2402.20', weight: '0' },
        { hsCode: '3004.90', weight: '0' },
      ])

      await estimate(jobId, { goodsValue: '1000.000' })

      const basis = (await stageFor(jobId))?.estimateBasis as { lines: { value: string }[] }
      expect(Number(basis.lines[0]!.value)).toBeCloseTo(500, 2)
    })
  })

  describe('where the estimate is written', () => {
    /**
     * A job either has one customs stage or none — the index is unique on
     * `job_id` — and being estimated before anybody opened its stage is the
     * ordinary case, not an error.
     */
    it('opens a customs stage for a shipment that has none', async () => {
      const jobId = await freshJob()
      await cargo(jobId, [{ hsCode: '2402.20', weight: '100' }])
      expect(await stageFor(jobId)).toBeUndefined()

      await estimate(jobId)

      expect((await stageFor(jobId))?.status).toBe('not_started')
    })

    it('updates the stage in place on a second estimate', async () => {
      const jobId = await freshJob()
      await cargo(jobId, [{ hsCode: '2402.20', weight: '100' }])

      await estimate(jobId, { goodsValue: '1000.000' })
      await estimate(jobId, { goodsValue: '2000.000' })

      const rows = await withActor(bothBranchesActor, (tx) =>
        tx
          .select({ id: customsStages.id })
          .from(customsStages)
          .where(eq(customsStages.jobId, jobId)),
      )
      expect(rows).toHaveLength(1)
      expect(Number((await stageFor(jobId))?.customsValue)).toBeCloseTo(2000, 3)
    })
  })

  describe('refusals', () => {
    /** There is nothing to classify until somebody says what is in the box. */
    it('says there is nothing to classify on a shipment with no cargo', async () => {
      const jobId = await freshJob()

      const state = await estimate(jobId)

      expect(state.message).toContain('no cargo lines')
      expect(await stageFor(jobId)).toBeUndefined()
    })

    it('refuses a value that is not a number', async () => {
      const jobId = await freshJob()
      expect((await estimate(jobId, { goodsValue: 'a lot' })).message).toBeDefined()
    })

    it('refuses a currency that is not three letters', async () => {
      const jobId = await freshJob()
      expect((await estimate(jobId, { currency: 'KUWAITI' })).message).toBeDefined()
    })

    it('reports rather than throwing on a form with nothing in it', async () => {
      expect((await estimateJobDuty({}, form({}))).message).toBeDefined()
    })

    it('raises when the shipment is not visible', async () => {
      await expect(estimate('00000000-0000-7000-8000-0000000000d9')).rejects.toThrow('not_found')
    })

    it('refuses a caller who may not work customs', async () => {
      const jobId = await freshJob()
      harness.session = sessionWith(['job.update'])
      try {
        await expect(estimate(jobId)).rejects.toThrow('customs.update')
      } finally {
        harness.session = sessionWith(['customs.update'])
      }
    })
  })
})
