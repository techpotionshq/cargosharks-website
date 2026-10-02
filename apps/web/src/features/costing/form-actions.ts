'use server'

/**
 * Writing to the charge ledger by hand — FR-FN-01, FR-FN-03.
 *
 * Most cost lines are written by something: the free-time accrual worker, the
 * consolidation allocator, the duty estimator. This is the path for the ones
 * that are not — a haulier's call-out, an inspection nobody predicted — and
 * for correcting one before it has been billed or matched.
 *
 * ## What cannot be edited, and why the rule is where it is
 *
 * A line that has been invoiced to the customer is frozen: `invoice_id` is
 * set, and §5.5 says nothing is deleted. A line a supplier has already been
 * matched against is frozen too, and that one is less obvious — editing the
 * accrual after the match would silently change a variance somebody has
 * already reviewed and approved, which is the one number on this whole feature
 * that has to stay put.
 *
 * Both checks read and write inside the same transaction. A check outside it
 * would be true when read and false when written, which is the ordinary
 * concurrency failure and is not theoretical on a screen two people share.
 */

import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { SEED_CURRENCIES, dec, type CurrencySpec } from '@qabandi/core'
import { chargeLines, branches, jobs, latestFxRate, withActor } from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan, assertCanIn } from '@/lib/permissions'
import {
  databaseMessage,
  echo,
  fail,
  failWith,
  fieldErrors,
  succeed,
  type ActionState,
  type Translate,
} from '@/lib/form-state'
import { normaliseAmount } from '@/lib/amount'
import { localeParse } from '@/lib/validate'
import { refuseForbidden } from '@/lib/refuse-forbidden'

function read(form: FormData, key: string): string | undefined {
  const value = form.get(key)
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

const spec = (code: string): CurrencySpec =>
  SEED_CURRENCIES.find((c) => c.code === code) ?? { code, minorUnits: 2 }

const optionalUuid = z
  .uuid()
  .optional()
  .or(z.literal('').transform(() => undefined))

/**
 * Money arrives as a string and is validated as a string.
 *
 * `z.coerce.number()` would be the obvious spelling and is exactly the bug
 * this codebase keeps finding: it turns `8.700` into a float on the way in,
 * and every downstream figure inherits the error. The regex says what a
 * `numeric(19,6)` accepts and the value stays text all the way to the column.
 */
const decimalString = (label: string) =>
  z
    .string()
    .trim()
    .overwrite(normaliseAmount)
    .regex(/^-?\d+(\.\d{1,6})?$/, label)

const chargeLineSchema = (tv: Translate) =>
  z.object({
    jobId: z.uuid(),
    direction: z.enum(['cost', 'revenue']),
    chargeTypeId: z.uuid(tv('chooseChargeType')),
    description: z
      .string()
      .trim()
      .max(300)
      .optional()
      .transform((v) => v || null),
    basis: z.enum(['flat', 'per_unit', 'per_kg', 'per_container', 'per_day', 'percent']),
    quantity: decimalString(tv('enterQuantity')),
    rate: decimalString(tv('enterRate')),
    currency: z.string().trim().length(3),
    /*
      Optional now, and looked up when it is left blank.

      The form defaulted it to 1 and this trusted it, so a USD 2,900 cost was
      booked as KWD 2,900 — 3.26 times the truth — on a branch whose `fx_rates`
      held the real rate. A typed rate still wins (FR-RT-06: the rate a cost was
      taken at belongs to the cost); a blank one takes the latest on file.
    */
    fxRate: decimalString(tv('enterFxRate'))
      .optional()
      .or(z.literal('').transform(() => undefined)),
    counterpartyPartnerId: optionalUuid,
    counterpartyCustomerId: optionalUuid,
  })

export const saveChargeLine = refuseForbidden(async function saveChargeLine(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'job.update')
  const tv = await getTranslations('costingValidation')

  const chargeLineId = read(form, 'chargeLineId')
  const parsed = await localeParse(chargeLineSchema(tv), {
    jobId: read(form, 'jobId'),
    direction: read(form, 'direction') ?? 'cost',
    chargeTypeId: read(form, 'chargeTypeId'),
    description: read(form, 'description'),
    basis: read(form, 'basis') ?? 'flat',
    quantity: read(form, 'quantity') ?? '1',
    rate: read(form, 'rate') ?? '',
    currency: read(form, 'currency') ?? 'KWD',
    fxRate: read(form, 'fxRate'),
    counterpartyPartnerId: read(form, 'counterpartyPartnerId') ?? '',
    counterpartyCustomerId: read(form, 'counterpartyCustomerId') ?? '',
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data

  /*
    The line amount, and the base amount, computed here in `Decimal`.

    Both could have been left to PostgreSQL — and the tax on an invoice is,
    deliberately, because there three columns must agree. Here the rounding is
    per currency: a KWD line rounds to three places and a USD line to two, and
    `numeric` has no opinion about which. Doing it in `core`'s arithmetic is
    the only spelling that gets a JPY line right as well.
  */
  const currencySpec = spec(data.currency)
  const amount = dec(data.quantity).times(dec(data.rate)).toDecimalPlaces(currencySpec.minorUnits)

  try {
    const result = await withActor(session.actor, async (tx) => {
      const [job] = await tx
        .select({ branchId: jobs.branchId, baseCurrency: branches.baseCurrency })
        .from(jobs)
        .innerJoin(branches, eq(branches.id, jobs.branchId))
        .where(eq(jobs.id, data.jobId))
        .limit(1)

      if (!job) return { error: 'not_found' as const }
      assertCanIn(session, 'job.update', job.branchId)

      const baseSpec = spec(job.baseCurrency)
      const fxRate =
        data.currency === job.baseCurrency
          ? '1'
          : (data.fxRate ?? (await latestFxRate(tx, data.currency, job.baseCurrency)))
      if (fxRate === null) return { error: 'no_rate' as const, base: job.baseCurrency }
      const amountBase =
        data.currency === job.baseCurrency
          ? amount
          : amount.times(dec(fxRate)).toDecimalPlaces(baseSpec.minorUnits)

      const values = {
        jobId: data.jobId,
        branchId: job.branchId,
        direction: data.direction,
        chargeTypeId: data.chargeTypeId,
        description: data.description,
        basis: data.basis,
        quantity: data.quantity,
        rate: data.rate,
        amount: amount.toFixed(),
        currency: data.currency,
        fxRate,
        amountBase: amountBase.toFixed(),
        baseCurrency: job.baseCurrency,
        counterpartyPartnerId: data.counterpartyPartnerId ?? null,
        counterpartyCustomerId: data.counterpartyCustomerId ?? null,
      }

      if (!chargeLineId) {
        await tx.insert(chargeLines).values(values)
        return { error: null }
      }

      /*
        A counterparty the form does not carry is left as it is. The dialog
        offers partners only; a customer named on a revenue line was erased by
        every edit, and with it the line's place in the settlement.
      */
      const { counterpartyCustomerId, ...always } = values
      const updatable = form.has('counterpartyCustomerId')
        ? { ...always, counterpartyCustomerId }
        : always

      /*
        Both freezes, read in the same transaction as the update.

        The `where` repeats them rather than trusting the read, so two people
        editing the same line while a third bills it cannot both pass a check
        that was true a moment ago.
      */
      const [existing] = await tx
        .select({
          invoiceId: chargeLines.invoiceId,
          matches: sql<number>`(
            select count(*)::int from supplier_invoice_matches m
             where m.charge_line_id = "charge_lines"."id" and m.retracted_at is null
          )`,
        })
        .from(chargeLines)
        .where(eq(chargeLines.id, chargeLineId))
        .limit(1)

      if (!existing) return { error: 'not_found' as const }
      if (existing.invoiceId !== null) return { error: 'billed' as const }
      if (existing.matches > 0) return { error: 'matched' as const }

      const updated = await tx
        .update(chargeLines)
        .set({ ...updatable, updatedAt: new Date() })
        .where(sql`${chargeLines.id} = ${chargeLineId} and ${chargeLines.invoiceId} is null`)
        .returning({ id: chargeLines.id })

      return { error: updated.length === 0 ? ('billed' as const) : null }
    })

    if (result.error === 'not_found') {
      return failWith(tv('jobNotVisible'), echo(form))
    }
    if (result.error === 'no_rate') {
      return fail(
        { fxRate: tv('noRateOnFile', { from: data.currency, to: result.base }) },
        echo(form),
      )
    }
    if (result.error === 'billed') {
      return failWith(tv('lineBilled'), echo(form))
    }
    if (result.error === 'matched') {
      return failWith(tv('lineMatched'), echo(form))
    }
  } catch (error) {
    if (databaseMessage(error).includes('not-null')) {
      return failWith(tv('lineIncomplete'), echo(form))
    }
    throw error
  }

  revalidatePath(`/jobs/${data.jobId}`)
  revalidatePath('/finance')
  return succeed(data.jobId)
})
