'use server'

/**
 * Consolidation mutations — building a master, and splitting what it cost.
 *
 * The allocation is the only action in this file that matters commercially.
 * Everything else records facts a booking confirmation already states; posting
 * an allocation is the moment twenty jobs learn what they cost, and it is
 * therefore the moment per-house margin becomes either true or fiction.
 *
 * ## The split is computed in `core`, not here
 *
 * `allocate()` is a pure function over the cargo figures, tested against
 * sums-exactly, reproducible-under-any-order and refuses-a-zero-driver. This
 * action reads the figures, calls it, and writes the rows. Nothing about the
 * arithmetic lives in a server action, which is why it can be argued about in
 * a unit test rather than in production.
 *
 * ## Allocated costs are ordinary charge lines
 *
 * They land in `charge_lines` with `source_kind = 'consol_allocation'` and
 * `source_id` pointing at the master line, so job P&L, the invoice builder and
 * the accounting export need to know nothing about consolidation — and
 * "why is there a 62.400 KWD freight cost on this house?" is one join from an
 * answer.
 */

import { revalidatePath } from 'next/cache'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  SEED_CURRENCIES,
  allocate,
  dec,
  money,
  toDb,
  type AllocationBasis,
  type AllocationTarget,
  type CurrencySpec,
} from '@qabandi/core'
import {
  branches,
  chargeLines,
  consolAllocationShares,
  consolChargeLines,
  consolidations,
  jobs,
  withActor,
} from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan, assertInBranch } from '@/lib/permissions'
import { echo, fail, failWith, fieldErrors, succeed, type ActionState } from '@/lib/form-state'

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

const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null)

const localDateTime = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? new Date(value) : null))
  .refine((value) => value === null || !Number.isNaN(value.getTime()), {
    message: 'Not a valid date and time',
  })

// --- the master ------------------------------------------------------------

const consolidationSchema = z.object({
  branchId: z.uuid('Choose a branch'),
  mode: z.enum(['sea_fcl', 'sea_lcl', 'air', 'land', 'courier']),
  tradeDirection: z.enum(['import', 'export', 'cross_trade']),
  masterBillNumber: optionalText(60),
  bookingNumber: optionalText(60),
  carrierPartnerId: optionalUuid,
  coloadPartnerId: optionalUuid,
  vesselName: optionalText(120),
  voyageNumber: optionalText(60),
  flightNumber: optionalText(60),
  originId: optionalUuid,
  destinationId: optionalUuid,
  etd: localDateTime,
  eta: localDateTime,
  notes: optionalText(1000),
})

export async function saveConsolidation(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'consol.write')

  const consolidationId = read(form, 'consolidationId')
  const parsed = consolidationSchema.safeParse({
    branchId: read(form, 'branchId'),
    mode: read(form, 'mode'),
    tradeDirection: read(form, 'tradeDirection'),
    masterBillNumber: read(form, 'masterBillNumber'),
    bookingNumber: read(form, 'bookingNumber'),
    carrierPartnerId: read(form, 'carrierPartnerId') ?? '',
    coloadPartnerId: read(form, 'coloadPartnerId') ?? '',
    vesselName: read(form, 'vesselName'),
    voyageNumber: read(form, 'voyageNumber'),
    flightNumber: read(form, 'flightNumber'),
    originId: read(form, 'originId') ?? '',
    destinationId: read(form, 'destinationId') ?? '',
    etd: read(form, 'etd'),
    eta: read(form, 'eta'),
    notes: read(form, 'notes'),
  })

  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))
  const data = parsed.data
  assertInBranch(session, data.branchId)

  const reference = await withActor(session.actor, async (tx) => {
    const values = {
      branchId: data.branchId,
      mode: data.mode,
      tradeDirection: data.tradeDirection,
      masterBillNumber: data.masterBillNumber,
      bookingNumber: data.bookingNumber,
      carrierPartnerId: data.carrierPartnerId ?? null,
      coloadPartnerId: data.coloadPartnerId ?? null,
      vesselName: data.vesselName,
      voyageNumber: data.voyageNumber,
      flightNumber: data.flightNumber,
      originId: data.originId ?? null,
      destinationId: data.destinationId ?? null,
      etd: data.etd,
      eta: data.eta,
      notes: data.notes,
      ownerId: session.principal.id,
    }

    if (consolidationId) {
      const [row] = await tx
        .update(consolidations)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(consolidations.id, consolidationId))
        .returning({ reference: consolidations.reference })
      return row?.reference ?? ''
    }

    /*
      The same reference shape as a job, from its own sequence.

      `consol_reference_seq` rather than reusing the job sequence: the two are
      different kinds of thing and a shared counter would leave both with gaps
      neither can explain — the same reasoning as the per-branch invoice
      series.
    */
    const [branch] = await tx
      .select({ code: branches.code })
      .from(branches)
      .where(eq(branches.id, data.branchId))
      .limit(1)

    if (!branch) throw new Error('not_found')

    const seq = await tx.execute(sql`select nextval('consol_reference_seq')::text as seq`)
    const number = (seq.rows[0] as { seq: string }).seq
    const newReference = `${branch.code}-CNS-${new Date().getUTCFullYear()}-${number.padStart(5, '0')}`

    const [row] = await tx
      .insert(consolidations)
      .values({ ...values, reference: newReference })
      .returning({ reference: consolidations.reference })

    return row!.reference
  })

  revalidatePath('/consolidations')
  return succeed(reference)
}

export async function attachHouse(form: FormData): Promise<void> {
  const session = await requireSession()
  assertCan(session, 'consol.write')

  const consolidationId = read(form, 'consolidationId')
  const jobId = read(form, 'jobId')
  if (!consolidationId || !jobId) throw new Error('Nothing to attach')

  await withActor(session.actor, async (tx) => {
    /*
      `is null` in the WHERE, not a read-then-write.

      A job already under another master must not be moved by a second click
      on a stale screen — the update simply matches nothing, and the house
      stays where its costs were allocated.

      The master's own status rides in the same condition, and for the same
      reason it is a condition rather than a check: closing draws a line under
      a consolidation, and a house attached afterwards was not in the split
      that has already run. Nothing would recompute it, so that house carries
      no share of the master's costs and its margin reads better than it is.
      Attaching to a closed master matches nothing instead.
    */
    await tx
      .update(jobs)
      .set({ consolidationId, updatedAt: new Date() })
      .where(
        and(
          eq(jobs.id, jobId),
          isNull(jobs.consolidationId),
          sql`exists (
            select 1 from consolidations
             where id = ${consolidationId}::uuid and status = 'open'
          )`,
        ),
      )
  })

  revalidatePath(`/consolidations/${consolidationId}`)
  revalidatePath(`/jobs/${jobId}`)
}

export async function detachHouse(form: FormData): Promise<void> {
  const session = await requireSession()
  assertCan(session, 'consol.write')

  const consolidationId = read(form, 'consolidationId')
  const jobId = read(form, 'jobId')
  if (!consolidationId || !jobId) throw new Error('Nothing to detach')

  await withActor(session.actor, async (tx) => {
    /*
      A house carrying allocated costs cannot simply leave.

      Its share of the master freight is on it as a charge line, possibly
      already invoiced. Detaching silently would leave a cost with no
      explanation and a master whose splits no longer sum to it. Reverse the
      allocation first — that is a deliberate act, and it is the one that
      writes the reversing lines.
    */
    const [allocated] = await tx
      .select({ id: chargeLines.id })
      .from(chargeLines)
      .where(and(eq(chargeLines.jobId, jobId), eq(chargeLines.sourceKind, 'consol_allocation')))
      .limit(1)

    if (allocated) throw new Error('has_allocated_costs')

    await tx
      .update(jobs)
      .set({ consolidationId: null, updatedAt: new Date() })
      .where(and(eq(jobs.id, jobId), eq(jobs.consolidationId, consolidationId)))
  })

  revalidatePath(`/consolidations/${consolidationId}`)
  revalidatePath(`/jobs/${jobId}`)
}

export async function closeConsolidation(form: FormData): Promise<void> {
  const session = await requireSession()
  assertCan(session, 'consol.write')

  const consolidationId = read(form, 'consolidationId')
  if (!consolidationId) throw new Error('Nothing to close')

  await withActor(session.actor, async (tx) => {
    await tx
      .update(consolidations)
      .set({ status: 'closed', closedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(consolidations.id, consolidationId), eq(consolidations.status, 'open')))
  })

  revalidatePath(`/consolidations/${consolidationId}`)
}

// --- master charges --------------------------------------------------------

const money6 = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d{1,6})?$/, 'Amount must be a number')

const chargeSchema = z.object({
  consolidationId: z.uuid(),
  direction: z.enum(['cost', 'revenue']),
  chargeTypeId: z.uuid('Choose a charge type'),
  description: optionalText(500),
  amount: money6,
  currency: z.string().trim().length(3),
  fxRate: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,8})?$/, 'Rate must be a number')
    .optional()
    .transform((v) => v || '1'),
  allocationBasis: z.enum([
    'chargeable_weight',
    'volume',
    'gross_weight',
    'packages',
    'equal',
    'manual',
  ]),
  counterpartyPartnerId: optionalUuid,
})

export async function addConsolCharge(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'consol.write')

  const parsed = chargeSchema.safeParse({
    consolidationId: read(form, 'consolidationId'),
    direction: read(form, 'direction'),
    chargeTypeId: read(form, 'chargeTypeId'),
    description: read(form, 'description'),
    amount: read(form, 'amount'),
    currency: read(form, 'currency'),
    fxRate: read(form, 'fxRate'),
    allocationBasis: read(form, 'allocationBasis'),
    counterpartyPartnerId: read(form, 'counterpartyPartnerId') ?? '',
  })

  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))
  const data = parsed.data

  await withActor(session.actor, async (tx) => {
    const [consol] = await tx
      .select({ branchId: consolidations.branchId })
      .from(consolidations)
      .where(eq(consolidations.id, data.consolidationId))
      .limit(1)

    if (!consol) throw new Error('not_found')

    const [branch] = await tx
      .select({ baseCurrency: branches.baseCurrency })
      .from(branches)
      .where(eq(branches.id, consol.branchId))
      .limit(1)

    const baseCurrency = branch?.baseCurrency ?? data.currency
    /*
      The base amount is computed once, here, and stored — never derived on
      read. It is the same rule `charge_lines` has carried since Release One
      (FR-RT-06): the rate and the moment it was taken live on the row, so a
      rate change tomorrow cannot rewrite what this cost.
    */
    const amountBase = toDb(money(dec(data.amount).times(dec(data.fxRate)), baseCurrency))

    await tx.insert(consolChargeLines).values({
      consolidationId: data.consolidationId,
      branchId: consol.branchId,
      direction: data.direction,
      chargeTypeId: data.chargeTypeId,
      description: data.description,
      basis: 'flat',
      quantity: '1',
      rate: data.amount,
      amount: data.amount,
      currency: data.currency.toUpperCase(),
      fxRate: data.fxRate,
      amountBase,
      baseCurrency,
      counterpartyPartnerId: data.counterpartyPartnerId ?? null,
      allocationBasis: data.allocationBasis,
    })
  })

  revalidatePath(`/consolidations/${data.consolidationId}`)
  return succeed(data.amount)
}

// --- the allocation --------------------------------------------------------

/**
 * Split one master charge across the houses and post the result.
 *
 * Everything that can refuse, refuses before a row is written: no houses, a
 * zero driver, an already-allocated line. The engine's own refusals carry a
 * sentence the operator can act on — "every house has a zero volume, so there
 * is nothing to split by" names the fix.
 */
export async function allocateConsolCharge(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'consol.allocate')

  const chargeLineId = read(form, 'chargeLineId')
  const consolidationId = read(form, 'consolidationId')
  if (!chargeLineId || !consolidationId) return failWith('Nothing to allocate.')

  try {
    const posted = await withActor(session.actor, async (tx) => {
      const [line] = await tx
        .select({
          id: consolChargeLines.id,
          branchId: consolChargeLines.branchId,
          direction: consolChargeLines.direction,
          chargeTypeId: consolChargeLines.chargeTypeId,
          description: consolChargeLines.description,
          amount: consolChargeLines.amount,
          currency: consolChargeLines.currency,
          fxRate: consolChargeLines.fxRate,
          fxRateAt: consolChargeLines.fxRateAt,
          baseCurrency: consolChargeLines.baseCurrency,
          counterpartyPartnerId: consolChargeLines.counterpartyPartnerId,
          allocationBasis: consolChargeLines.allocationBasis,
          allocatedAt: consolChargeLines.allocatedAt,
        })
        .from(consolChargeLines)
        .where(eq(consolChargeLines.id, chargeLineId))
        .limit(1)

      if (!line) throw new Error('not_found')
      if (line.allocatedAt) throw new Error('already_allocated')

      const houses = await tx
        .select({
          jobId: jobs.id,
          chargeableWeightKg: jobs.chargeableWeightKg,
          volumeCbm: sql<string>`(
            select coalesce(sum(c.volume_cbm), 0)::text from job_cargo c where c.job_id = "jobs"."id"
          )`,
          grossWeightKg: sql<string>`(
            select coalesce(sum(c.gross_weight_kg), 0)::text
              from job_cargo c where c.job_id = "jobs"."id"
          )`,
          packages: sql<number>`(
            select coalesce(sum(c.package_count), 0)::int
              from job_cargo c where c.job_id = "jobs"."id"
          )`,
        })
        .from(jobs)
        .where(eq(jobs.consolidationId, consolidationId))

      const targets: AllocationTarget[] = houses.map((h) => ({
        jobId: h.jobId,
        chargeableWeightKg: h.chargeableWeightKg,
        volumeCbm: h.volumeCbm,
        grossWeightKg: h.grossWeightKg,
        packages: h.packages,
      }))

      /*
        Manual shares come from the form, one field per house, and the engine
        checks they sum to the whole. No tolerance: the operator is looking at
        the screen and can fix a fils in five seconds; nobody reading the cost
        account in November can.
      */
      const manual =
        line.allocationBasis === 'manual'
          ? new Map(
              targets.map((t) => [
                t.jobId,
                money(read(form, `share_${t.jobId}`) ?? '0', line.currency),
              ]),
            )
          : undefined

      const allocation = allocate(
        money(line.amount, line.currency),
        targets,
        line.allocationBasis as AllocationBasis,
        spec(line.currency),
        manual,
      )

      const rate = dec(line.fxRate)

      for (const share of allocation.shares) {
        await tx.insert(chargeLines).values({
          jobId: share.jobId,
          branchId: line.branchId,
          direction: line.direction,
          chargeTypeId: line.chargeTypeId,
          description: line.description
            ? `${line.description} (consolidated)`
            : 'Allocated from consolidation',
          basis: 'flat',
          quantity: '1',
          rate: toDb(share.share),
          amount: toDb(share.share),
          currency: line.currency,
          /*
            The master's rate and its timestamp, copied onto every share.

            Not today's rate. The cost was bought once, at one rate, and the
            twenty lines it becomes are that one purchase — re-rating them
            would make the shares stop summing to what was paid.
          */
          fxRate: line.fxRate,
          fxRateAt: line.fxRateAt,
          amountBase: toDb(money(dec(share.share.amount).times(rate), line.baseCurrency)),
          baseCurrency: line.baseCurrency,
          counterpartyPartnerId: line.counterpartyPartnerId,
          sourceKind: 'consol_allocation',
          sourceId: line.id,
        })

        if (line.allocationBasis === 'manual') {
          await tx.insert(consolAllocationShares).values({
            consolChargeLineId: line.id,
            jobId: share.jobId,
            branchId: line.branchId,
            shareAmount: toDb(share.share),
          })
        }
      }

      await tx
        .update(consolChargeLines)
        .set({
          allocatedAt: new Date(),
          allocatedById: session.principal.id,
          updatedAt: new Date(),
        })
        .where(and(eq(consolChargeLines.id, line.id), isNull(consolChargeLines.allocatedAt)))

      return allocation.shares.length
    })

    revalidatePath(`/consolidations/${consolidationId}`)
    return succeed(String(posted))
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'already_allocated') {
        return failWith('That cost has already been split. Reverse it first to split it again.')
      }
      /*
        The engine's refusals are already sentences aimed at the operator —
        "Every house has a zero volume, so there is nothing to split by.
        Capture the cargo figures, or allocate equally." Passing them through
        beats replacing them with "allocation failed".
      */
      if (
        'code' in error &&
        typeof error.code === 'string' &&
        error.code.startsWith('allocation')
      ) {
        return failWith(error.message)
      }
    }
    throw error
  }
}

/**
 * Reverse a posted allocation.
 *
 * Posts the negative of every share rather than deleting the rows, because
 * they may already sit on an issued invoice. A cost that was invoiced and then
 * vanished is a reconciliation nobody can perform; one that was invoiced and
 * then reversed is a line of explanation.
 */
export async function reverseConsolAllocation(form: FormData): Promise<void> {
  const session = await requireSession()
  assertCan(session, 'consol.allocate')

  const chargeLineId = read(form, 'chargeLineId')
  const consolidationId = read(form, 'consolidationId')
  if (!chargeLineId || !consolidationId) throw new Error('Nothing to reverse')

  await withActor(session.actor, async (tx) => {
    const posted = await tx
      .select({
        id: chargeLines.id,
        jobId: chargeLines.jobId,
        branchId: chargeLines.branchId,
        direction: chargeLines.direction,
        chargeTypeId: chargeLines.chargeTypeId,
        description: chargeLines.description,
        amount: chargeLines.amount,
        currency: chargeLines.currency,
        fxRate: chargeLines.fxRate,
        fxRateAt: chargeLines.fxRateAt,
        amountBase: chargeLines.amountBase,
        baseCurrency: chargeLines.baseCurrency,
        counterpartyPartnerId: chargeLines.counterpartyPartnerId,
      })
      .from(chargeLines)
      .where(
        and(
          eq(chargeLines.sourceKind, 'consol_allocation'),
          eq(chargeLines.sourceId, chargeLineId),
        ),
      )

    for (const line of posted) {
      /*
        Written out rather than spread, so the reversal cannot inherit a column
        that should not carry over. `invoice_id` is the one that matters: a
        reversal of a billed line is itself unbilled, and copying the invoice
        id would quietly attach a credit to a document that was already issued.
      */
      await tx.insert(chargeLines).values({
        jobId: line.jobId,
        branchId: line.branchId,
        direction: line.direction,
        chargeTypeId: line.chargeTypeId,
        description: `${line.description ?? 'Allocation'} — reversed`,
        basis: 'flat',
        quantity: '1',
        rate: `-${line.amount}`,
        amount: `-${line.amount}`,
        currency: line.currency,
        fxRate: line.fxRate,
        fxRateAt: line.fxRateAt,
        amountBase: `-${line.amountBase}`,
        baseCurrency: line.baseCurrency,
        counterpartyPartnerId: line.counterpartyPartnerId,
        sourceKind: 'consol_allocation_reversal',
        sourceId: chargeLineId,
      })
    }

    await tx
      .update(consolChargeLines)
      .set({ allocatedAt: null, allocatedById: null, updatedAt: new Date() })
      .where(eq(consolChargeLines.id, chargeLineId))
  })

  revalidatePath(`/consolidations/${consolidationId}`)
}
