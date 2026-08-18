'use server'

/**
 * Estimating duty, before the broker files.
 *
 * We are not in the filing path — Kuwait customs runs on a concession held
 * through a joint venture majority-owned by a competitor until 2030, and
 * `adapters/customs.ts` refuses to pretend otherwise. What that does not
 * excuse is the customer asking what the shipment will cost to land and
 * nobody being able to answer until the declaration comes back.
 *
 * So the estimate is ours, the assessment is theirs, and both are stored:
 * `estimated_duty_amount` beside `duty_amount`. The gap between them is the
 * only honest measure of whether the estimate is worth quoting, and one column
 * would be overwritten by the truth so the question could never be asked
 * again (0013).
 *
 * ## What is stored is what was computed, not a promise to recompute
 *
 * `estimate_basis` carries the HS lines, the prefixes that matched and the
 * rates they carried. A number disputed in June is explained from that, not
 * recomputed against a tariff that moved in March.
 */

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  SEED_CURRENCIES,
  customsValue,
  estimateDuty,
  type CurrencySpec,
  type DutiableLine,
  type TariffLine,
} from '@qabandi/core'
import { branches, customsStages, dutyRates, jobCargo, jobs, withActor } from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan } from '@/lib/permissions'
import { failWith, succeed, type ActionState } from '@/lib/form-state'

function read(form: FormData, key: string): string | undefined {
  const value = form.get(key)
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

const spec = (code: string): CurrencySpec =>
  SEED_CURRENCIES.find((c) => c.code === code) ?? { code, minorUnits: 2 }

const schema = z.object({
  jobId: z.uuid('Choose a shipment'),
  goodsValue: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,6})?$/, 'The goods value must be a number'),
  freightValue: z
    .string()
    .trim()
    .regex(/^\d*\.?\d*$/, 'Numbers only')
    .optional()
    .transform((v) => v || '0'),
  insuranceValue: z
    .string()
    .trim()
    .regex(/^\d*\.?\d*$/, 'Numbers only')
    .optional()
    .transform((v) => v || '0'),
  currency: z.string().trim().length(3),
  /**
   * The GCC general rate, applied only where the operator says so.
   *
   * Off by default. Applying 5% to a code the tariff has no row for produces a
   * number that looks researched and is a guess, and the customer told "5%" on
   * a code that turns out to be exempt has been mis-sold.
   */
  useGeneralRate: z.coerce.boolean().optional(),
})

export async function estimateJobDuty(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'customs.update')

  const parsed = schema.safeParse({
    jobId: read(form, 'jobId'),
    goodsValue: read(form, 'goodsValue'),
    freightValue: read(form, 'freightValue'),
    insuranceValue: read(form, 'insuranceValue'),
    currency: read(form, 'currency') ?? 'KWD',
    useGeneralRate: read(form, 'useGeneralRate') === 'on',
  })

  if (!parsed.success) {
    return failWith(parsed.error.issues[0]?.message ?? 'Check the figures.')
  }

  const data = parsed.data
  const currency = data.currency.toUpperCase()
  const currencySpec = spec(currency)

  const outcome = await withActor(session.actor, async (tx) => {
    const [job] = await tx
      .select({ id: jobs.id, branchCountry: branches.country })
      .from(jobs)
      .innerJoin(branches, eq(branches.id, jobs.branchId))
      .where(eq(jobs.id, data.jobId))
      .limit(1)

    if (!job) throw new Error('not_found')

    const cargo = await tx
      .select({
        hsCode: jobCargo.hsCode,
        descriptionEn: jobCargo.descriptionEn,
        grossWeightKg: jobCargo.grossWeightKg,
      })
      .from(jobCargo)
      .where(eq(jobCargo.jobId, data.jobId))

    if (cargo.length === 0) return { kind: 'no_cargo' as const }

    const tariff = (await tx
      .select()
      .from(dutyRates)
      .where(eq(dutyRates.country, job.branchCountry))) as unknown as TariffLine[]

    /*
      CIF, not the commercial invoice.

      The GCC assesses on cost, insurance and freight, so the freight we are
      charging is part of the value duty is computed on. Leaving it out is the
      single most common way an estimate comes in low, and it comes in low by
      exactly the amount the customer least expects.
    */
    const value = customsValue(
      {
        goods: data.goodsValue,
        freight: data.freightValue,
        insurance: data.insuranceValue,
      },
      currency,
      currencySpec,
    )

    /*
      The declared value is apportioned across the lines by weight.

      Not because that is accurate — it is not — but because the *total* is
      right either way and a per-line estimate is what the broker can read. A
      shipment whose lines carry their own values would skip this; none does
      yet, because `job_cargo` holds no value column and adding one before
      anybody has asked for it would be a column nobody fills in.
    */
    const totalGross = cargo.reduce((acc, c) => acc + Number(c.grossWeightKg ?? 0), 0)
    const lines: DutiableLine[] = cargo.map((c) => ({
      hsCode: c.hsCode,
      description: c.descriptionEn,
      value:
        totalGross > 0
          ? ((Number(value.amount) * Number(c.grossWeightKg ?? 0)) / totalGross).toFixed(6)
          : (Number(value.amount) / cargo.length).toFixed(6),
    }))

    const on = new Date()
    const estimate = estimateDuty(lines, tariff, {
      country: job.branchCountry,
      currency,
      on,
      spec: currencySpec,
      ...(data.useGeneralRate ? { generalRatePercent: '5', generalRateDescription: 'GCC general rate' } : {}),
    })

    const basis = {
      computedAt: on.toISOString(),
      country: job.branchCountry,
      currency,
      goodsValue: data.goodsValue,
      freightValue: data.freightValue,
      insuranceValue: data.insuranceValue,
      generalRateApplied: data.useGeneralRate === true,
      lines: estimate.lines.map((l) => ({
        description: l.description,
        hsCode: l.hsCode,
        matchedPrefix: l.matchedPrefix,
        ratePercent: l.ratePercent,
        value: l.value.amount.toString(),
        duty: l.duty.amount.toString(),
      })),
      unmatched: estimate.unmatched.map((u) => u.hsCode ?? null),
    }

    /*
      Upsert onto the single customs stage a job has.

      `customs_stages_job_idx` is unique on `job_id`, so a job either has one
      stage or none — and a shipment being estimated before anybody opened its
      customs stage is the ordinary case, not an error.
    */
    const updated = await tx
      .update(customsStages)
      .set({
        customsValue: value.amount.toString(),
        customsValueCurrency: currency,
        estimatedDutyAmount: estimate.duty.amount.toString(),
        estimatedAt: on,
        estimateBasis: basis,
        updatedAt: new Date(),
      })
      .where(eq(customsStages.jobId, data.jobId))
      .returning({ id: customsStages.id })

    if (updated.length === 0) {
      await tx.insert(customsStages).values({
        jobId: data.jobId,
        status: 'not_started',
        customsValue: value.amount.toString(),
        customsValueCurrency: currency,
        estimatedDutyAmount: estimate.duty.amount.toString(),
        estimatedAt: on,
        estimateBasis: basis,
      })
    }

    return {
      kind: 'ok' as const,
      duty: estimate.duty.amount.toString(),
      unmatched: estimate.unmatched.length,
    }
  })

  if (outcome.kind === 'no_cargo') {
    return failWith(
      'This shipment has no cargo lines yet, so there is nothing to classify. Add them under Cargo.',
    )
  }

  revalidatePath(`/jobs/${data.jobId}`)
  revalidatePath('/customs')

  if (outcome.unmatched > 0) {
    return failWith(
      `Estimated ${outcome.duty} ${currency}, but ${outcome.unmatched} line(s) had no tariff row. ` +
        'Add the HS codes, or add the rates under Reference → Duty rates.',
    )
  }

  return succeed(outcome.duty)
}
