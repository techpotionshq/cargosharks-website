'use server'

/**
 * Shipment mutations.
 *
 * A job file is the centre of this product — the thing every other slice
 * points at — so its create action does more than insert a row. Opening a
 * shipment also lays down its milestone plan, and it does so in the same
 * transaction, because a job with no milestones is a job with no tracking
 * page, no customer visibility and nothing for the exception rules to measure
 * lateness against.
 *
 * The milestone plan comes from `milestone_templates`, keyed by mode. That is
 * what makes the product whitelabelable in the way that actually matters: a
 * different forwarder with a different operating procedure changes rows in a
 * reference table, not code.
 */

import { revalidatePath } from 'next/cache'
import { and, asc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { fromDb, toScale } from '@qabandi/core'
import {
  branches,
  checkCredit,
  jobMilestones,
  jobPartners,
  jobs,
  milestoneTemplates,
  notificationOutbox,
  quotes,
  withActor,
} from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan, assertInBranch } from '@/lib/permissions'
import {
  echo,
  fail,
  failWith,
  fieldErrors,
  isUniqueViolation,
  succeed,
  type ActionState,
} from '@/lib/form-state'

function read(form: FormData, key: string): string | undefined {
  const value = form.get(key)
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

const optionalText = (max = 80) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null)

const optionalNumber = z
  .string()
  .trim()
  .regex(/^\d*\.?\d*$/, 'Numbers only')
  .optional()
  .transform((v) => (v ? v : null))

const optionalDateTime = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? new Date(v) : null))
  .refine((v) => v === null || !Number.isNaN(v.getTime()), { message: 'Not a valid date' })

const jobSchema = z
  .object({
    jobId: z.uuid().optional(),
    branchId: z.uuid('Choose a branch'),
    customerId: z.uuid('Choose a customer'),
    quoteId: z
      .uuid()
      .optional()
      .or(z.literal('').transform(() => undefined)),
    mode: z.enum(['sea_fcl', 'sea_lcl', 'air', 'land', 'courier']),
    tradeDirection: z.enum(['import', 'export', 'cross_trade']),
    status: z.enum([
      'draft',
      'booked',
      'in_transit',
      'arrived',
      'customs',
      'delivered',
      'completed',
      'closed',
      'on_hold',
      'cancelled',
    ]),
    ownerId: z
      .uuid()
      .optional()
      .or(z.literal('').transform(() => undefined)),
    originId: z.uuid('Choose where it starts'),
    destinationId: z.uuid('Choose where it goes'),
    commodityId: z
      .uuid()
      .optional()
      .or(z.literal('').transform(() => undefined)),
    incoterm: optionalText(10),
    masterBillNumber: optionalText(),
    houseBillNumber: optionalText(),
    bookingNumber: optionalText(),
    vesselName: optionalText(),
    voyageNumber: optionalText(40),
    flightNumber: optionalText(40),
    placeOfReceipt: optionalText(),
    placeOfDelivery: optionalText(),
    customerReference: optionalText(),
    etd: optionalDateTime,
    eta: optionalDateTime,
    grossWeightKg: optionalNumber,
    volumeCbm: optionalNumber,
    pieces: z.coerce.number().int().min(0).max(1_000_000).optional(),
  })
  .refine((value) => value.originId !== value.destinationId, {
    message: 'A shipment cannot start and end in the same place',
    path: ['destinationId'],
  })
  .refine((value) => !value.etd || !value.eta || value.eta >= value.etd, {
    message: 'Arrival cannot be before departure',
    path: ['eta'],
  })

export async function saveJob(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, read(form, 'jobId') ? 'job.update' : 'job.book')

  const parsed = jobSchema.safeParse({
    jobId: read(form, 'jobId'),
    branchId: read(form, 'branchId'),
    customerId: read(form, 'customerId'),
    quoteId: read(form, 'quoteId'),
    mode: read(form, 'mode') ?? 'sea_fcl',
    tradeDirection: read(form, 'tradeDirection') ?? 'import',
    status: read(form, 'status') ?? 'booked',
    ownerId: read(form, 'ownerId'),
    originId: read(form, 'originId'),
    destinationId: read(form, 'destinationId'),
    commodityId: read(form, 'commodityId'),
    incoterm: read(form, 'incoterm'),
    masterBillNumber: read(form, 'masterBillNumber'),
    houseBillNumber: read(form, 'houseBillNumber'),
    bookingNumber: read(form, 'bookingNumber'),
    vesselName: read(form, 'vesselName'),
    voyageNumber: read(form, 'voyageNumber'),
    placeOfReceipt: read(form, 'placeOfReceipt'),
    placeOfDelivery: read(form, 'placeOfDelivery'),
    flightNumber: read(form, 'flightNumber'),
    customerReference: read(form, 'customerReference'),
    etd: read(form, 'etd'),
    eta: read(form, 'eta'),
    grossWeightKg: read(form, 'grossWeightKg'),
    volumeCbm: read(form, 'volumeCbm'),
    pieces: read(form, 'pieces'),
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data
  assertInBranch(session, data.branchId)

  /*
    Credit is checked on booking, not on update.

    Booking is the moment we take on the exposure; an update is a coordinator
    correcting a vessel name on work already accepted, and blocking that would
    strand the shipment rather than prevent it. The commitment being weighed is
    the quotation where the job came from one — that is the only figure anybody
    has agreed at this point, since charge lines are added afterwards.

    Before the transaction below for the reason `ledger/form-actions.ts` gives:
    `checkCredit` opens its own actor transaction and nesting would hold two
    pooled connections for one unit of work.
  */
  if (!data.jobId) {
    const blocked = await creditBlockOnBooking(session, data)
    if (blocked) return { ...blocked, values: echo(form) }
  }

  const values = {
    branchId: data.branchId,
    customerId: data.customerId,
    quoteId: data.quoteId ?? null,
    status: data.status,
    mode: data.mode,
    tradeDirection: data.tradeDirection,
    ownerId: data.ownerId ?? null,
    originId: data.originId,
    destinationId: data.destinationId,
    commodityId: data.commodityId ?? null,
    incoterm: data.incoterm,
    masterBillNumber: data.masterBillNumber,
    houseBillNumber: data.houseBillNumber,
    bookingNumber: data.bookingNumber,
    vesselName: data.vesselName,
    voyageNumber: data.voyageNumber,
    flightNumber: data.flightNumber,
    placeOfReceipt: data.placeOfReceipt,
    placeOfDelivery: data.placeOfDelivery,
    customerReference: data.customerReference,
    etd: data.etd,
    eta: data.eta,
    grossWeightKg: data.grossWeightKg,
    volumeCbm: data.volumeCbm,
    pieces: data.pieces ?? null,
  }

  let reference: string
  try {
    reference = await withActor(session.actor, async (tx) => {
      if (data.jobId) {
        /*
          The arrival estimate is read before it is overwritten.

          `job.eta_changed` is only worth raising when the arrival *actually
          moved* — a save that touched the vessel name must not tell a customer
          their dates changed — and knowing that needs the previous value. This
          runs inside the same transaction as the update, so the pair is
          consistent even though it is two statements.
        */
        const [before] = await tx
          .select({
            eta: jobs.eta,
            branchId: jobs.branchId,
            customerId: jobs.customerId,
          })
          .from(jobs)
          .where(eq(jobs.id, data.jobId))
          .limit(1)
        if (!before) throw new Error('not_found')

        const [row] = await tx
          .update(jobs)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(jobs.id, data.jobId))
          .returning({ reference: jobs.reference, eta: jobs.eta })
        if (!row) throw new Error('not_found')

        if (before.eta?.getTime() !== row.eta?.getTime()) {
          await tx.insert(notificationOutbox).values({
            branchId: before.branchId,
            eventKey: 'job.eta_changed',
            jobId: data.jobId,
            customerId: before.customerId,
            payload: {
              reference: row.reference,
              // Formatted here rather than in the template, because a template
              // is a string with holes in it and cannot format a date. The date
              // only, since an arrival estimate accurate to the minute is a
              // precision the shipping line does not have.
              previousEta: before.eta ? before.eta.toISOString().slice(0, 10) : 'not set',
              eta: row.eta ? row.eta.toISOString().slice(0, 10) : 'not set',
            },
          })
        }

        return row.reference
      }

      const [branch] = await tx
        .select({ code: branches.code })
        .from(branches)
        .where(eq(branches.id, data.branchId))
        .limit(1)
      if (!branch) throw new Error('not_found')

      const seq = await tx.execute(sql`select nextval('job_reference_seq')::text as seq`)
      const number = (seq.rows[0] as { seq: string }).seq
      const newReference = `${branch.code}-JOB-${new Date().getUTCFullYear()}-${number.padStart(5, '0')}`

      const [row] = await tx
        .insert(jobs)
        .values({ ...values, reference: newReference })
        .returning({ id: jobs.id, reference: jobs.reference })

      /**
       * The milestone plan, from the template for this mode.
       *
       * In the same transaction as the job, because a job without milestones
       * has no tracking page and nothing for the lateness rules to measure —
       * and a two-step "now add the milestones" is a step someone skips.
       *
       * `planned_at` is left null rather than guessed. A plan invented from an
       * average transit time reads as a real schedule and is not one; the
       * dates arrive with the booking confirmation.
       */
      const template = await tx
        .select({
          code: milestoneTemplates.code,
          nameEn: milestoneTemplates.nameEn,
          nameAr: milestoneTemplates.nameAr,
          seq: milestoneTemplates.seq,
          ownerRole: milestoneTemplates.ownerRole,
          customerVisible: milestoneTemplates.customerVisible,
        })
        .from(milestoneTemplates)
        // Keyed by mode **and** direction — the unique constraint is on
        // (mode, direction, service_type, code). Filtering on mode alone
        // returns the import plan *and* the export plan and lays down every
        // step twice.
        .where(
          and(
            eq(milestoneTemplates.mode, data.mode),
            eq(milestoneTemplates.direction, data.tradeDirection),
            eq(milestoneTemplates.isActive, true),
          ),
        )
        .orderBy(asc(milestoneTemplates.seq))

      if (template.length) {
        await tx.insert(jobMilestones).values(
          template.map((step) => ({
            jobId: row!.id,
            code: step.code,
            nameEn: step.nameEn,
            nameAr: step.nameAr,
            seq: step.seq,
            ownerRole: step.ownerRole,
            customerVisible: step.customerVisible,
          })),
        )
      }

      // Booking a job off an accepted quotation marks the quote as consumed,
      // so the quote register stops showing it as an open opportunity.
      if (data.quoteId) {
        await tx.update(quotes).set({ updatedAt: new Date() }).where(eq(quotes.id, data.quoteId))
      }

      /*
        FR-NT-01, in the same transaction as the job and its milestone plan.

        The mode is sent as the stored code — `sea_fcl`, `air` — rather than a
        display name, and that is a deliberate limit of a template engine that
        substitutes strings. Translating it would mean either a lookup the
        outbox has no business doing or a second copy of the mode vocabulary in
        two languages; the customer's own booking confirmation carries the
        prose, and this message carries the reference they need to track it.
      */
      await tx.insert(notificationOutbox).values({
        branchId: data.branchId,
        eventKey: 'job.created',
        jobId: row!.id,
        customerId: data.customerId,
        payload: { reference: row!.reference, mode: data.mode },
      })

      return row!.reference
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail(
        { masterBillNumber: 'That bill number is already on another shipment.' },
        echo(form),
      )
    }
    throw error
  }

  revalidatePath('/jobs')
  revalidatePath('/dashboard')
  return succeed(reference)
}

/** Name a carrier, agent, broker or haulier on the shipment. */
/**
 * The credit gate on booking.
 *
 * Returns the failure to hand back, or null to proceed.
 *
 * There is no job id yet, so a one-shot override cannot name this shipment —
 * only a standing override on the customer releases a booking. That is the
 * conversation that actually happens: a manager decides the customer may trade
 * over their limit for a period, and the coordinator then books freely. The
 * alternative — book first, authorise afterwards — is a check that has already
 * failed by the time anybody reads it.
 */
async function creditBlockOnBooking(
  session: Awaited<ReturnType<typeof requireSession>>,
  data: { branchId: string; customerId: string; quoteId?: string | null },
): Promise<ActionState | null> {
  let proposed = null
  if (data.quoteId) {
    const [quote] = await withActor(session.actor, (tx) =>
      tx
        // `total_sell`, not the cost: the credit limit is about what the
        // customer will be asked to pay, not what the shipment costs us.
        .select({ total: quotes.totalSell, currency: quotes.currency })
        .from(quotes)
        .where(eq(quotes.id, data.quoteId!))
        .limit(1),
    )
    if (quote?.total) proposed = fromDb(quote.total, quote.currency)
  }

  const { assessment, allowed, standing } = await checkCredit(session.actor, {
    customerId: data.customerId,
    branchId: data.branchId,
    proposed,
  })
  if (allowed) return null

  const excess = `${toScale(assessment.excess)} ${standing.currency}`
  return failWith(
    assessment.outcome === 'on_hold'
      ? 'This customer is on credit hold. Release the hold on their account before booking.'
      : `Booking this shipment puts the customer ${excess} past their credit limit. ` +
          'A branch manager can record an override on the customer account.',
  )
}

export async function addJobPartner(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'job.update')

  const schema = z.object({
    jobId: z.uuid(),
    branchId: z.uuid(),
    partnerId: z.uuid('Choose a partner'),
    role: z.enum([
      'carrier',
      'origin_agent',
      'destination_agent',
      'customs_broker',
      'haulier',
      'terminal',
    ]),
    reference: optionalText(),
  })

  const parsed = schema.safeParse({
    jobId: read(form, 'jobId'),
    branchId: read(form, 'branchId'),
    partnerId: read(form, 'partnerId'),
    role: read(form, 'role') ?? 'carrier',
    reference: read(form, 'reference'),
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data
  await withActor(session.actor, async (tx) => {
    await tx.insert(jobPartners).values(data)
  })

  revalidatePath(`/jobs/${data.jobId}`)
  revalidatePath('/partners')
  return succeed(data.partnerId)
}
