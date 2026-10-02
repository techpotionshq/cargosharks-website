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
import { getTranslations } from 'next-intl/server'
import { and, asc, eq, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  canTransition,
  enquiryMachine,
  fromDb,
  instantFromLocal,
  isLocalDateTime,
  localInputValue,
  toScale,
} from '@qabandi/core'
import {
  branchTimeZone,
  branches,
  checkCredit,
  enquiries,
  jobMilestones,
  jobPartners,
  jobs,
  milestoneTemplates,
  notificationOutbox,
  quotes,
  withActor,
} from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan, assertCanIn } from '@/lib/permissions'
import {
  databaseMessage,
  echo,
  fail,
  failWith,
  fieldErrors,
  isUniqueViolation,
  succeed,
  type ActionState,
  type Translate,
} from '@/lib/form-state'
import { localeParse } from '@/lib/validate'
import { dayIn } from '@/lib/time'
import { refuseForbidden } from '@/lib/refuse-forbidden'

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

/*
  A quantity: digits, optionally a point and up to six more.

  `^\d*\.?\d*$` was the rule, and it accepts a lone "." — which reached the
  `numeric` column and came back as a 500 rather than a message on the field.
*/
const optionalNumber = (tv: Translate) =>
  z
    .string()
    .trim()
    .regex(/^\d{1,13}(\.\d{1,6})?$/, tv('numbersOnly'))
    .optional()
    .transform((v) => (v ? v : null))

/*
  Kept as the wall-clock string the input posted, and read as an instant only
  inside the write, in the branch's zone. `new Date()` here parsed it as UTC on
  the server, so an ETA of 22:00 in Kuwait was stored as 01:00 the next day and
  emailed to the customer as such. Two values in the same zone compare
  correctly as strings, which is all the refinement below needs.
*/
const optionalDateTime = (tv: Translate) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => v || null)
    .refine((v) => v === null || isLocalDateTime(v), { message: tv('notValidDate') })

/*
  The statuses a shipment can be *opened* in.

  Moving a shipment on is `setJobStatus`'s job, and it checks a separate key
  for each consequential move — hold, complete, close, cancel. This form wrote
  `status` with none of those checks, so anybody who could book could open a
  job already closed, and an edit quietly reopened a cancelled one as a draft
  (`cancelled` was not among the options, so the select fell back to the first).
  Opening is limited to the states that need no key beyond booking, and an
  edit does not touch the status at all.
*/
const OPENING_STATUSES = [
  'draft',
  'booked',
  'in_transit',
  'arrived',
  'customs',
  'delivered',
] as const

const jobSchema = (tv: Translate) =>
  z
    .object({
      jobId: z.uuid().optional(),
      branchId: z.uuid(tv('chooseBranch')),
      customerId: z.uuid(tv('chooseCustomer')),
      quoteId: z
        .uuid()
        .optional()
        .or(z.literal('').transform(() => undefined)),
      mode: z.enum(['sea_fcl', 'sea_lcl', 'air', 'land', 'courier']),
      tradeDirection: z.enum(['import', 'export', 'cross_trade']),
      status: z.enum(OPENING_STATUSES),
      ownerId: z
        .uuid()
        .optional()
        .or(z.literal('').transform(() => undefined)),
      originId: z.uuid(tv('chooseOrigin')),
      destinationId: z.uuid(tv('chooseDestination')),
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
      etd: optionalDateTime(tv),
      eta: optionalDateTime(tv),
      grossWeightKg: optionalNumber(tv),
      volumeCbm: optionalNumber(tv),
      pieces: z.coerce.number().int().min(0).max(1_000_000).optional(),
    })
    .refine((value) => value.originId !== value.destinationId, {
      message: tv('sameOriginDestination'),
      path: ['destinationId'],
    })
    .refine((value) => !value.etd || !value.eta || value.eta >= value.etd, {
      message: tv('arrivalBeforeDeparture'),
      path: ['eta'],
    })

/** A refusal raised inside the transaction, carried out to a field message. */
class JobRefusal extends Error {
  constructor(
    readonly field: string,
    readonly key: string,
  ) {
    super(key)
  }
}

export const saveJob = refuseForbidden(async function saveJob(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, read(form, 'jobId') ? 'job.update' : 'job.book')
  const tv = await getTranslations('jobsValidation')

  const parsed = await localeParse(jobSchema(tv), {
    jobId: read(form, 'jobId'),
    branchId: read(form, 'branchId'),
    customerId: read(form, 'customerId'),
    quoteId: read(form, 'quoteId'),
    mode: read(form, 'mode') ?? 'sea_fcl',
    tradeDirection: read(form, 'tradeDirection') ?? 'import',
    // An edit carries no status — see `OPENING_STATUSES` — so it validates as
    // the default and is never written.
    status: (read(form, 'jobId') ? undefined : read(form, 'status')) ?? 'booked',
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
  assertCanIn(session, read(form, 'jobId') ? 'job.update' : 'job.book', data.branchId)

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
    const blocked = await creditBlockOnBooking(session, tv, data)
    if (blocked) return { ...blocked, values: echo(form) }
  }

  const values = {
    branchId: data.branchId,
    customerId: data.customerId,
    quoteId: data.quoteId ?? null,
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
    grossWeightKg: data.grossWeightKg,
    volumeCbm: data.volumeCbm,
    pieces: data.pieces ?? null,
  }

  let reference: string
  try {
    reference = await withActor(session.actor, async (tx) => {
      const timeZone = await branchTimeZone(tx, { branchId: data.branchId })

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
            etd: jobs.etd,
            eta: jobs.eta,
            branchId: jobs.branchId,
            customerId: jobs.customerId,
          })
          .from(jobs)
          .where(eq(jobs.id, data.jobId))
          .limit(1)
        if (!before) throw new Error('not_found')

        /*
          Only what the form carried.

          The edit dialog once left eight fields out of its defaults — owner,
          commodity, booking, voyage, flight, both dates and the quotation — and
          this wrote every column regardless, so each save nulled them. The
          dialog now carries them all; this is the second half, so a form that
          omits a field (an older screen, a narrower dialog) leaves the column
          alone instead of erasing it.

          A date is also left alone when it comes back exactly as the form was
          given it. The input has minutes and the column has seconds, so writing
          it back would nudge the instant and raise an arrival notice for a save
          that moved nothing.
        */
        const unchanged = (field: 'etd' | 'eta') =>
          data[field] === localInputValue(before[field], timeZone)
        const dates = {
          ...(form.has('etd') && !unchanged('etd')
            ? { etd: data.etd ? instantFromLocal(data.etd, timeZone) : null }
            : {}),
          ...(form.has('eta') && !unchanged('eta')
            ? { eta: data.eta ? instantFromLocal(data.eta, timeZone) : null }
            : {}),
        }
        // The quotation is fixed at booking, where it is checked and claimed;
        // an edit re-pointing it would skip every one of those checks.
        const present = Object.fromEntries(
          Object.entries(values).filter(([field]) => field !== 'quoteId' && form.has(field)),
        ) as Partial<typeof values>

        const [row] = await tx
          .update(jobs)
          .set({ ...present, ...dates, updatedAt: new Date() })
          .where(eq(jobs.id, data.jobId))
          .returning({ reference: jobs.reference, eta: jobs.eta })
        if (!row) throw new Error('not_found')

        /*
          A cleared estimate is not news to send. The payload would read "ETA
          changed to —", which tells the customer nothing except that somebody
          emptied a field.
        */
        if (row.eta && before.eta?.getTime() !== row.eta.getTime()) {
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
              //
              // A missing date is a dash, not the words "not set": this payload is
              // built once and merged into the English *and* the Arabic template,
              // so words here would be English inside an Arabic message. The
              // recipient's language is only known at dispatch.
              previousEta: before.eta ? dayIn(before.eta, timeZone) : '—',
              eta: dayIn(row.eta, timeZone),
            },
          })
        }

        return row.reference
      }

      /*
        Booking off a quotation — FR-RT-08's last step.

        The quotation is locked and checked here, under the same transaction
        as the job, because "accepted, this customer's, and not booked yet" is
        a claim two coordinators can race to: `for update` makes the second
        one wait and then see the first one's job.
      */
      let enquiryToWin: string | null = null
      if (data.quoteId) {
        enquiryToWin = await claimQuote(tx, data.quoteId, data)
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
        .values({
          ...values,
          status: data.status,
          etd: data.etd ? instantFromLocal(data.etd, timeZone) : null,
          eta: data.eta ? instantFromLocal(data.eta, timeZone) : null,
          reference: newReference,
        })
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

      /*
        Booking off an accepted quotation is the enquiry being won.

        Nothing moved it there before: the job was opened, the quote touched,
        and the enquiry sat in the queue as open business forever. Only from
        `quoted`, the one state the machine allows `won` from — an enquiry the
        pipeline left somewhere else is left for a person to close rather than
        forced past the machine. Not gated on `enquiry.close`: the booking is
        the evidence, and a coordinator who may book may record what the
        booking already says.
      */
      if (enquiryToWin) {
        await tx
          .update(enquiries)
          .set({ status: 'won', closedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(enquiries.id, enquiryToWin), eq(enquiries.status, 'quoted')))
      }
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
    if (error instanceof JobRefusal) {
      return fail({ [error.field]: tv(error.key as 'quoteNotBookable') }, echo(form))
    }
    /*
      Named, not assumed. Every unique violation was reported as "that master
      bill number is taken" — and no constraint on `jobs` covers the master
      bill, which consolidated houses legitimately share. The house bill is the
      number we issue, and the one that must not repeat within a branch.
    */
    if (isUniqueViolation(error) && databaseMessage(error).includes('jobs_house_bill_unique')) {
      return fail({ houseBillNumber: tv('houseBillTaken') }, echo(form))
    }
    throw error
  }

  revalidatePath('/jobs')
  revalidatePath('/dashboard')
  return succeed(reference)
})

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
  tv: Translate,
  data: { branchId: string; customerId: string; quoteId?: string | null },
): Promise<ActionState | null> {
  let proposed = null
  if (data.quoteId) {
    const [quote] = await withActor(session.actor, (tx) => readQuote(tx, data.quoteId!))
    /*
      The quotation's total is the exposure only if it is *this* booking's
      quotation. Any quote id was accepted here — another customer's, a
      rejected draft — and the credit decision was then taken on a figure that
      had nothing to do with the shipment. Refused before the check, so the
      check is never run against the wrong number.
    */
    const problem = quoteProblem(quote, data)
    if (problem) return fail({ quoteId: tv(problem) })
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
    assessment.outcome === 'on_hold' ? tv('creditHold') : tv('creditLimitExceeded', { excess }),
  )
}

type Tx = Parameters<Parameters<typeof withActor>[1]>[0]

/** A quotation and the enquiry it answers, as booking needs to judge it. */
function readQuote(tx: Tx, quoteId: string) {
  return tx
    .select({
      status: quotes.status,
      branchId: quotes.branchId,
      // `total_sell`, not the cost: the credit limit is about what the
      // customer will be asked to pay, not what the shipment costs us.
      total: quotes.totalSell,
      currency: quotes.currency,
      enquiryId: enquiries.id,
      enquiryStatus: enquiries.status,
      customerId: enquiries.customerId,
    })
    .from(quotes)
    .innerJoin(enquiries, eq(enquiries.id, quotes.enquiryId))
    .where(eq(quotes.id, quoteId))
    .limit(1)
}

/** Why a quotation cannot be booked against, or null if it can. */
function quoteProblem(
  quote: { status: string; branchId: string; customerId: string | null } | undefined,
  data: { branchId: string; customerId: string },
): 'quoteNotBookable' | 'quoteNotAccepted' | 'quoteOtherCustomer' | null {
  if (!quote) return 'quoteNotBookable'
  if (quote.status !== 'accepted') return 'quoteNotAccepted'
  if (quote.customerId !== data.customerId || quote.branchId !== data.branchId) {
    return 'quoteOtherCustomer'
  }
  return null
}

/**
 * Lock a quotation for booking, and say which enquiry the booking wins.
 *
 * Throws a `JobRefusal` when the quotation is not one this booking may use —
 * not accepted, another customer's, or already behind a live shipment. A
 * cancelled shipment releases its quotation: the customer still accepted it.
 */
async function claimQuote(
  tx: Tx,
  quoteId: string,
  data: { branchId: string; customerId: string },
): Promise<string | null> {
  await tx.select({ id: quotes.id }).from(quotes).where(eq(quotes.id, quoteId)).for('update')
  const [quote] = await readQuote(tx, quoteId)
  const problem = quoteProblem(quote, data)
  if (problem) throw new JobRefusal('quoteId', problem)

  const [booked] = await tx
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.quoteId, quoteId), ne(jobs.status, 'cancelled')))
    .limit(1)
  if (booked) throw new JobRefusal('quoteId', 'quoteAlreadyBooked')

  return canTransition(enquiryMachine, quote!.enquiryStatus, 'won') ? quote!.enquiryId : null
}

/** Name a carrier, agent, broker or haulier on the shipment. */
export const addJobPartner = refuseForbidden(async function addJobPartner(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'job.update')
  const tv = await getTranslations('jobsValidation')

  const schema = z.object({
    jobId: z.uuid(),
    branchId: z.uuid(),
    partnerId: z.uuid(tv('choosePartner')),
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

  const parsed = await localeParse(schema, {
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
})
