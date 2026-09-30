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
import { getTranslations } from 'next-intl/server'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  AllocationError,
  SEED_CURRENCIES,
  allocate,
  dec,
  money,
  toDb,
  type AllocationBasis,
  type AllocationRefusal,
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
import {
  echo,
  fail,
  failWith,
  fieldErrors,
  succeed,
  type ActionState,
  type Translate,
} from '@/lib/form-state'
import { localeParse } from '@/lib/validate'

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

const localDateTime = (tv: Translate) =>
  z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? new Date(value) : null))
    .refine((value) => value === null || !Number.isNaN(value.getTime()), {
      message: tv('notValidDateTime'),
    })

// --- the master ------------------------------------------------------------

const consolidationSchema = (tv: Translate) =>
  z.object({
    branchId: z.uuid(tv('chooseBranch')),
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
    etd: localDateTime(tv),
    eta: localDateTime(tv),
    notes: optionalText(1000),
  })

export async function saveConsolidation(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'consol.write')
  const tv = await getTranslations('consolidationValidation')

  const consolidationId = read(form, 'consolidationId')
  const parsed = await localeParse(consolidationSchema(tv), {
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

/**
 * Put a shipment under this master.
 *
 * Returns an `ActionState` because the shipment is the one thing on this form
 * the operator chooses, and a refusal thrown from a plain form action lands on
 * the error boundary — where production redacts it to "something went wrong".
 * The master's id is a hidden field the page wrote, so its absence is a
 * tampered form rather than a mistake, and it still throws.
 */
export async function attachHouse(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'consol.write')
  const tv = await getTranslations('consolidationValidation')

  const consolidationId = read(form, 'consolidationId')
  if (!consolidationId) throw new Error('Nothing to attach')
  const jobId = read(form, 'jobId')
  if (!jobId) return fail({ jobId: tv('chooseShipment') })

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
  return succeed(jobId)
}

/**
 * Take a house off the master.
 *
 * The refusal below is the operator's to act on — they clicked detach on a
 * house whose costs were split — so it comes back as a sentence under the
 * button. Both ids are hidden fields, and a missing one is still thrown.
 */
export async function detachHouse(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'consol.write')
  const tv = await getTranslations('consolidationValidation')

  const consolidationId = read(form, 'consolidationId')
  const jobId = read(form, 'jobId')
  if (!consolidationId || !jobId) throw new Error('Nothing to detach')

  const refused = await withActor(session.actor, async (tx) => {
    /*
      A house carrying allocated costs cannot simply leave.

      Its share of the master freight is on it as a charge line, possibly
      already invoiced. Detaching silently would leave a cost with no
      explanation and a master whose splits no longer sum to it. Reverse the
      allocation first — that is a deliberate act, and it is the one that
      writes the reversing lines.
    */
    /*
      "Carrying" means a share still standing: more allocation lines than
      reversals, counting only this master's costs. It used to be "any
      allocation line at all" — but a reversal adds a line rather than removing
      one, so a house stayed undetachable forever after its split was reversed,
      and the refusal's own advice ("reverse that split first") could not work.
      It also counted shares from a master the house had since left.
    */
    const counts = await tx
      .select({ kind: chargeLines.sourceKind, count: sql<number>`count(*)::int` })
      .from(chargeLines)
      .where(
        and(
          eq(chargeLines.jobId, jobId),
          inArray(chargeLines.sourceKind, ['consol_allocation', 'consol_allocation_reversal']),
          inArray(
            chargeLines.sourceId,
            tx
              .select({ id: consolChargeLines.id })
              .from(consolChargeLines)
              .where(eq(consolChargeLines.consolidationId, consolidationId)),
          ),
        ),
      )
      .groupBy(chargeLines.sourceKind)
    const shares = counts.find((row) => row.kind === 'consol_allocation')?.count ?? 0
    const reversals = counts.find((row) => row.kind === 'consol_allocation_reversal')?.count ?? 0

    if (shares > reversals) return true

    await tx
      .update(jobs)
      .set({ consolidationId: null, updatedAt: new Date() })
      .where(and(eq(jobs.id, jobId), eq(jobs.consolidationId, consolidationId)))
    return false
  })

  if (refused) return failWith(tv('houseHasSplitCosts'))

  revalidatePath(`/consolidations/${consolidationId}`)
  revalidatePath(`/jobs/${jobId}`)
  return succeed(jobId)
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

const money6 = (tv: Translate) =>
  z
    .string()
    .trim()
    .regex(/^-?\d+(\.\d{1,6})?$/, tv('amountNumber'))

const chargeSchema = (tv: Translate) =>
  z.object({
    consolidationId: z.uuid(),
    direction: z.enum(['cost', 'revenue']),
    chargeTypeId: z.uuid(tv('chooseChargeType')),
    description: optionalText(500),
    amount: money6(tv),
    currency: z.string().trim().length(3),
    fxRate: z
      .string()
      .trim()
      .regex(/^\d+(\.\d{1,8})?$/, tv('rateNumber'))
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
  const tv = await getTranslations('consolidationValidation')

  const parsed = await localeParse(chargeSchema(tv), {
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
  const tv = await getTranslations('consolidationValidation')

  const chargeLineId = read(form, 'chargeLineId')
  const consolidationId = read(form, 'consolidationId')
  if (!chargeLineId || !consolidationId) return failWith(tv('nothingToAllocate'))

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
    if (error instanceof Error && error.message === 'already_allocated') {
      return failWith(tv('alreadySplit'))
    }
    if (error instanceof AllocationError) {
      const message = allocationRefusal(tv, error.refusal)
      if (message) return failWith(message)
    }
    throw error
  }
}

/**
 * The engine's refusal, in the operator's language.
 *
 * `core` says what went wrong as a code and values and keeps its English for
 * the log; passing that English through put "Every house has a zero volume"
 * on an Arabic screen. The zero-driver case is one key per basis rather than a
 * basis word interpolated into one sentence, because in Arabic the noun
 * decides the agreement of the words around it.
 *
 * `null` for the refusals this action cannot produce — it reads the houses
 * itself, so a duplicate is impossible, and it builds the manual map from the
 * same list, so a missing share is too. Those stay thrown: they would mean a
 * bug here, and a sentence would hide it.
 */
function allocationRefusal(tv: Translate, refusal: AllocationRefusal): string | null {
  switch (refusal.code) {
    case 'allocation_no_targets':
      return tv('allocationNoHouses')
    case 'allocation_negative_driver':
      return tv('allocationNegativeDriver')
    case 'allocation_zero_driver':
      switch (refusal.values.basis) {
        case 'volume':
          return tv('allocationZeroVolume')
        case 'chargeable_weight':
          return tv('allocationZeroChargeableWeight')
        case 'gross_weight':
          return tv('allocationZeroGrossWeight')
        case 'packages':
          return tv('allocationZeroPackages')
        // Both read a driver of one per house, so neither can total zero.
        case 'equal':
        case 'manual':
          return null
        default: {
          const unhandled: never = refusal.values.basis
          return unhandled
        }
      }
    case 'allocation_manual_mismatch':
      return tv('allocationManualMismatch', refusal.values)
    case 'allocation_duplicate_target':
    case 'allocation_manual_missing':
    case 'allocation_manual_incomplete':
      return null
    default: {
      const unhandled: never = refusal
      return unhandled
    }
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
    // Not currently allocated: a second click, or a reversal already done.
    // Reversing again would post a credit against nothing.
    const [master] = await tx
      .select({ allocatedAt: consolChargeLines.allocatedAt })
      .from(consolChargeLines)
      .where(eq(consolChargeLines.id, chargeLineId))
      .limit(1)
    if (!master?.allocatedAt) return

    const allPosted = await tx
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
      .orderBy(asc(chargeLines.createdAt), asc(chargeLines.id))

    /*
      Only the shares no earlier reversal has already undone.

      Allocate → reverse → allocate leaves two allocation lines per house under
      this cost and one reversal. Reversing "every allocation line" — as this
      did — negated the first share a second time, understating the house's
      cost by exactly one share. Each reversal writes one line per share it
      undoes, so per house the oldest `k` shares are spoken for, where `k` is
      that house's reversal count; the rest are what is live now. No link
      column needed: the pairing is by count, in posting order.
    */
    const reversedCounts = await tx
      .select({ jobId: chargeLines.jobId, count: sql<number>`count(*)::int` })
      .from(chargeLines)
      .where(
        and(
          eq(chargeLines.sourceKind, 'consol_allocation_reversal'),
          eq(chargeLines.sourceId, chargeLineId),
        ),
      )
      .groupBy(chargeLines.jobId)
    const alreadyReversed = new Map(reversedCounts.map((row) => [row.jobId, row.count]))
    const seen = new Map<string, number>()
    const posted = allPosted.filter((line) => {
      const index = seen.get(line.jobId) ?? 0
      seen.set(line.jobId, index + 1)
      return index >= (alreadyReversed.get(line.jobId) ?? 0)
    })

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

// --- forming one from a suggestion -----------------------------------------

/**
 * A suggested cluster, turned into a real consolidation with its houses on it.
 *
 * The shortest path between *noticing* that four shipments share a lane and a
 * week, and *having* the master they should have been booked under. Every
 * field on the new consolidation comes from the cluster itself — same branch,
 * same mode, same trade direction, same origin and destination — because a
 * cluster that did not agree on all five would not have been a cluster.
 *
 * ## The houses are attached under the same conditions a click would use
 *
 * Not a bulk update. Each job is attached with the `is null` guard `attachHouse`
 * documents at length: a shipment that has been consolidated elsewhere since
 * the screen was drawn simply does not move, rather than being pulled off the
 * master whose costs have already been split across it. A stale suggestion is
 * ordinary — this screen is a list of things nobody has done yet — so the
 * action reports what it managed rather than refusing the lot.
 *
 * ## It creates an *open* master and nothing else
 *
 * No carrier, no booking number, no vessel, no ETD. Those are the things a
 * coordinator negotiates after deciding to consolidate, and inventing them
 * would put figures on a record that reads as agreed. The one act this
 * performs is the one the screen is about: these shipments belong together.
 */
export async function consolidateCluster(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'consol.write')
  const tv = await getTranslations('consolidationValidation')

  const branchId = read(form, 'branchId')
  const mode = read(form, 'mode')
  const originId = read(form, 'originId')
  const destinationId = read(form, 'destinationId')
  const jobIds = form.getAll('jobId').filter((v): v is string => typeof v === 'string' && v !== '')

  if (!branchId || !mode || !originId || !destinationId || jobIds.length < 2) {
    return failWith(tv('clusterIncomplete'))
  }
  assertInBranch(session, branchId)

  const outcome = await withActor(session.actor, async (tx) => {
    /*
      The trade direction is read off the shipments rather than taken from the
      form, because it is the one field of the five that the cluster key does
      not carry — grouping is on mode and lane. Reading it here also means the
      value on the master is one of the values on its houses, which is what a
      customs broker will expect when they compare the two.
    */
    const houses = await tx
      .select({
        id: jobs.id,
        tradeDirection: jobs.tradeDirection,
        branchId: jobs.branchId,
      })
      .from(jobs)
      .where(
        and(
          inArray(jobs.id, jobIds),
          eq(jobs.branchId, branchId),
          eq(jobs.mode, mode as 'sea_lcl'),
          isNull(jobs.consolidationId),
          isNull(jobs.closedAt),
          isNull(jobs.cancelledAt),
        ),
      )

    if (houses.length < 2) return { error: 'nothing_left' as const }

    const [branch] = await tx
      .select({ code: branches.code })
      .from(branches)
      .where(eq(branches.id, branchId))
      .limit(1)
    if (!branch) return { error: 'nothing_left' as const }

    const seq = await tx.execute(sql`select nextval('consol_reference_seq')::text as seq`)
    const number = (seq.rows[0] as { seq: string }).seq
    const reference = `${branch.code}-CNS-${new Date().getUTCFullYear()}-${number.padStart(5, '0')}`

    const [created] = await tx
      .insert(consolidations)
      .values({
        branchId,
        reference,
        mode: mode as 'sea_lcl',
        tradeDirection: houses[0]!.tradeDirection,
        originId,
        destinationId,
        ownerId: session.principal.id,
        notes: 'Formed from a suggested grouping.',
      })
      .returning({ id: consolidations.id, reference: consolidations.reference })

    /*
      One guarded update for the lot, not one per house.

      The condition is `attachHouse`'s, applied to the set: a job that has been
      consolidated since this screen was drawn is excluded by `is null` and
      stays where its costs were allocated. `returning` is what makes the
      difference visible, so the count below is what actually moved rather than
      what was asked for.
    */
    const attached = await tx
      .update(jobs)
      .set({ consolidationId: created!.id, updatedAt: new Date() })
      .where(
        and(
          inArray(
            jobs.id,
            houses.map((h) => h.id),
          ),
          isNull(jobs.consolidationId),
        ),
      )
      .returning({ id: jobs.id })

    return {
      ok: true as const,
      consolidationId: created!.id,
      reference: created!.reference,
      attached: attached.length,
      asked: jobIds.length,
    }
  })

  if ('error' in outcome) {
    return failWith(tv('clusterGone'))
  }

  revalidatePath('/consolidations')
  revalidatePath(`/consolidations/${outcome.consolidationId}`)
  return succeed(outcome.reference)
}
