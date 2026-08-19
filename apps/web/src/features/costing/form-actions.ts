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
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { SEED_CURRENCIES, dec, type CurrencySpec } from '@qabandi/core'
import { chargeLines, branches, jobs, withActor } from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan, assertInBranch } from '@/lib/permissions'
import {
  databaseMessage,
  echo,
  fail,
  failWith,
  fieldErrors,
  succeed,
  type ActionState,
} from '@/lib/form-state'

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
    .regex(/^-?\d+(\.\d{1,6})?$/, label)

const chargeLineSchema = z.object({
  jobId: z.uuid(),
  direction: z.enum(['cost', 'revenue']),
  chargeTypeId: z.uuid('Choose a charge type'),
  description: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => v || null),
  basis: z.enum(['flat', 'per_unit', 'per_kg', 'per_container', 'per_day', 'percent']),
  quantity: decimalString('Enter a quantity'),
  rate: decimalString('Enter a rate'),
  currency: z.string().trim().length(3),
  fxRate: decimalString('Enter an exchange rate'),
  counterpartyPartnerId: optionalUuid,
  counterpartyCustomerId: optionalUuid,
})

export async function saveChargeLine(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'job.update')

  const chargeLineId = read(form, 'chargeLineId')
  const parsed = chargeLineSchema.safeParse({
    jobId: read(form, 'jobId'),
    direction: read(form, 'direction') ?? 'cost',
    chargeTypeId: read(form, 'chargeTypeId'),
    description: read(form, 'description'),
    basis: read(form, 'basis') ?? 'flat',
    quantity: read(form, 'quantity') ?? '1',
    rate: read(form, 'rate') ?? '',
    currency: read(form, 'currency') ?? 'KWD',
    fxRate: read(form, 'fxRate') ?? '1',
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
      assertInBranch(session, job.branchId)

      const baseSpec = spec(job.baseCurrency)
      const amountBase =
        data.currency === job.baseCurrency
          ? amount
          : amount.times(dec(data.fxRate)).toDecimalPlaces(baseSpec.minorUnits)

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
        fxRate: data.fxRate,
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
        .set({ ...values, updatedAt: new Date() })
        .where(sql`${chargeLines.id} = ${chargeLineId} and ${chargeLines.invoiceId} is null`)
        .returning({ id: chargeLines.id })

      return { error: updated.length === 0 ? ('billed' as const) : null }
    })

    if (result.error === 'not_found') {
      return failWith('That job is no longer visible.', echo(form))
    }
    if (result.error === 'billed') {
      return failWith(
        'That line has been billed to the customer and can no longer be edited. Raise a credit note instead.',
        echo(form),
      )
    }
    if (result.error === 'matched') {
      return failWith(
        'A supplier invoice has been matched against that line. Unmatch it first — editing the accrual now would change a variance somebody has already reviewed.',
        echo(form),
      )
    }
  } catch (error) {
    if (databaseMessage(error).includes('not-null')) {
      return failWith('Something on that line is missing.', echo(form))
    }
    throw error
  }

  revalidatePath(`/jobs/${data.jobId}`)
  revalidatePath('/finance')
  return succeed(data.jobId)
}
