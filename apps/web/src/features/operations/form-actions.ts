'use server'

/**
 * Operations mutations — what people actually do to a shipment all day.
 *
 * Raising an exception, clearing one, moving a customs stage on, ticking a
 * milestone as done, adding a container. None of it is glamorous and all of it
 * is the product: a system where the board is read-only is a report, and the
 * thing it reports on still lives in someone's spreadsheet.
 *
 * Every action here follows the same six steps as the rest of the application
 * — session, permission, validate, assert the transition, write under
 * `withActor`, revalidate — and the state-machine assertions come from
 * `@qabandi/core`, so an illegal customs transition is refused by the domain
 * rather than by whichever screen happened to offer the button.
 */

import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  assertTransition,
  customsMachine,
  entryPermission,
  isPlausibleClockStart,
  isTerminal,
  jobMachine,
  MAX_CLOCK_BACKDATE_DAYS,
} from '@qabandi/core'
import {
  customsStages,
  documentTypes,
  documents,
  equipment,
  freeTimeClocks,
  freeTimeTermsFor,
  exceptionCodes,
  exceptions,
  jobMilestones,
  jobs,
  notificationOutbox,
  withActor,
} from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan } from '@/lib/permissions'
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
import { dayIn, todayIn } from '@/lib/time'

function read(form: FormData, key: string): string | undefined {
  const value = form.get(key)
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** A `datetime-local` arrives as `YYYY-MM-DDTHH:mm` with no zone. */
const localDateTime = (tv: Translate) =>
  z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? new Date(value) : null))
    .refine((value) => value === null || !Number.isNaN(value.getTime()), {
      message: tv('invalidDateTime'),
    })

// --- exceptions ------------------------------------------------------------

const raiseSchema = (tv: Translate) =>
  z.object({
    jobId: z.uuid(tv('chooseShipment')),
    exceptionCodeId: z.uuid(tv('chooseExceptionCode')),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    description: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .transform((v) => v || null),
    ownerId: z
      .uuid()
      .optional()
      .or(z.literal('').transform(() => undefined)),
    dueAt: localDateTime(tv),
    customerVisible: z.coerce.boolean(),
    costImpact: z
      .string()
      .trim()
      .regex(/^\d*\.?\d*$/, tv('numbersOnly'))
      .optional()
      .transform((v) => (v ? v : null)),
    costCurrency: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v.toUpperCase() : null)),
  })

export async function raiseException(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'job.update')
  const tv = await getTranslations('operationsValidation')

  const parsed = await localeParse(raiseSchema(tv), {
    jobId: read(form, 'jobId'),
    exceptionCodeId: read(form, 'exceptionCodeId'),
    severity: read(form, 'severity') ?? 'medium',
    description: read(form, 'description'),
    ownerId: read(form, 'ownerId'),
    dueAt: read(form, 'dueAt'),
    customerVisible: form.get('customerVisible') !== null,
    costImpact: read(form, 'costImpact'),
    costCurrency: read(form, 'costCurrency'),
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data
  await withActor(session.actor, async (tx) => {
    await tx.insert(exceptions).values({
      jobId: data.jobId,
      exceptionCodeId: data.exceptionCodeId,
      severity: data.severity,
      description: data.description,
      ownerId: data.ownerId ?? null,
      dueAt: data.dueAt,
      customerVisible: data.customerVisible,
      costImpact: data.costImpact,
      costCurrency: data.costCurrency,
    })

    /*
      FR-NT-01, to the branch's own staff.

      `exception.opened` is an *internal* event in the catalogue, and that is
      not the same question as `customerVisible` on the row above. That flag
      decides whether the customer sees the exception on the portal when they
      look; this decides who gets written to without looking. A customs hold
      the customer can see on their tracking page is still not a thing to email
      them about at the moment it is raised, before anyone has worked out what
      it means.

      The code's own name is used rather than the free-text description alone,
      because the description is optional and an alert reading "high severity
      exception on KWI-JOB-2026-00031" with no noun in it is an alert that gets
      opened last.
    */
    const [job] = await tx
      .select({ reference: jobs.reference, branchId: jobs.branchId })
      .from(jobs)
      .where(eq(jobs.id, data.jobId))
      .limit(1)

    const [code] = await tx
      .select({ nameEn: exceptionCodes.nameEn })
      .from(exceptionCodes)
      .where(eq(exceptionCodes.id, data.exceptionCodeId))
      .limit(1)

    if (job) {
      await tx.insert(notificationOutbox).values({
        branchId: job.branchId,
        eventKey: 'exception.opened',
        jobId: data.jobId,
        payload: {
          reference: job.reference,
          severity: data.severity,
          description: data.description ?? code?.nameEn ?? '',
        },
      })
    }
  })

  revalidatePath('/exceptions')
  revalidatePath(`/jobs/${data.jobId}`)
  revalidatePath('/dashboard')
  return succeed(data.jobId)
}

/**
 * Close one out.
 *
 * A resolution is required, and that is not bureaucracy: the exception
 * register's whole value is that it accumulates *what went wrong and what was
 * done*, and an exception closed with an empty resolution converts a record
 * into a deleted row that still takes up space.
 */
export async function closeException(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'job.update')
  const tv = await getTranslations('operationsValidation')

  const exceptionId = read(form, 'exceptionId')
  const resolution = read(form, 'resolution')
  if (!exceptionId) return fail({ _: tv('nothingToClose') })
  if (!resolution) {
    return fail({ resolution: tv('resolutionRequired') }, echo(form))
  }

  await withActor(session.actor, async (tx) => {
    await tx
      .update(exceptions)
      .set({ closedAt: new Date(), resolution, updatedAt: new Date() })
      .where(and(eq(exceptions.id, exceptionId), isNull(exceptions.closedAt)))
  })

  revalidatePath('/exceptions')
  revalidatePath('/dashboard')
  return succeed(exceptionId)
}

// --- customs ---------------------------------------------------------------

const customsSchema = (tv: Translate) =>
  z.object({
    jobId: z.uuid(tv('chooseShipment')),
    status: z.enum([
      'not_started',
      'documents_pending',
      'declaration_filed',
      'assessed',
      'duty_paid',
      'inspection',
      'released',
      'held',
    ]),
    declarationType: z
      .string()
      .trim()
      .max(40)
      .optional()
      .transform((v) => v || null),
    declarationNo: z
      .string()
      .trim()
      .max(60)
      .optional()
      .transform((v) => v || null),
    brokerPartnerId: z
      .uuid()
      .optional()
      .or(z.literal('').transform(() => undefined)),
    dutyAmount: z
      .string()
      .trim()
      .regex(/^\d*\.?\d*$/, tv('numbersOnly'))
      .optional()
      .transform((v) => (v ? v : null)),
    dutyCurrency: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v.toUpperCase() : null)),
    inspectionRequired: z.coerce.boolean(),
    slaDueAt: localDateTime(tv),
    notes: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .transform((v) => v || null),
  })

/**
 * Create or advance the customs stage.
 *
 * One action for both because a shipment has exactly one customs stage and
 * "create it" versus "move it on" is a distinction the operator does not have:
 * they open the customs panel and set where it has got to.
 *
 * The transition is asserted against the machine in `@qabandi/core` — so
 * `released → held` is refused here even though the select would offer it,
 * because the select is generated from the enum and the enum is not the rule.
 */
export async function saveCustomsStage(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  /*
    Every customs move needs this; two of them need more.

    `customs.file` and `customs.pay` are declared on the machine and were
    checked nowhere — every status change asserted `customs.update`, so the
    coordinator who corrects a declaration number could also file the
    declaration and clear the duty. That is the separation the three keys exist
    to draw, and FR-ID-03 puts the mapping on the transition rather than here:
    `entryPermission` reads it off the machine, so a change to the machine
    cannot leave this behind.
  */
  assertCan(session, 'customs.update')
  const tv = await getTranslations('operationsValidation')

  const parsed = await localeParse(customsSchema(tv), {
    jobId: read(form, 'jobId'),
    status: read(form, 'status') ?? 'not_started',
    declarationType: read(form, 'declarationType'),
    declarationNo: read(form, 'declarationNo'),
    brokerPartnerId: read(form, 'brokerPartnerId'),
    dutyAmount: read(form, 'dutyAmount'),
    dutyCurrency: read(form, 'dutyCurrency'),
    inspectionRequired: form.get('inspectionRequired') !== null,
    slaDueAt: read(form, 'slaDueAt'),
    notes: read(form, 'notes'),
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data

  /*
    Checked against the *target* status, and so on creation as well as on a
    move. A stage that is created directly at `duty_paid` reaches duty_paid
    without transitioning into it, and a check that only ran on the update path
    would be a permission anyone could step around by having no stage yet.
  */
  const required = entryPermission(customsMachine, data.status)
  if (required) assertCan(session, required)

  try {
    await withActor(session.actor, async (tx) => {
      const [current] = await tx
        .select({ id: customsStages.id, status: customsStages.status })
        .from(customsStages)
        .where(eq(customsStages.jobId, data.jobId))
        .limit(1)

      const values = {
        status: data.status,
        declarationType: data.declarationType,
        declarationNo: data.declarationNo,
        brokerPartnerId: data.brokerPartnerId ?? null,
        dutyAmount: data.dutyAmount,
        dutyCurrency: data.dutyCurrency,
        inspectionRequired: data.inspectionRequired,
        slaDueAt: data.slaDueAt,
        notes: data.notes,
        // The two timestamps that are *derived* from the status rather than
        // typed: filing and release stamp themselves the first time the stage
        // reaches them, and are never blanked by a later edit.
        filedAt:
          data.status === 'declaration_filed'
            ? sql`coalesce(${customsStages.filedAt}, now())`
            : undefined,
        releasedAt:
          data.status === 'released'
            ? sql`coalesce(${customsStages.releasedAt}, now())`
            : undefined,
      }

      if (current) {
        if (current.status !== data.status) {
          assertTransition(customsMachine, current.status, data.status)
        }
        await tx
          .update(customsStages)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(customsStages.id, current.id))
      } else {
        await tx.insert(customsStages).values({
          jobId: data.jobId,
          ...values,
          filedAt: data.status === 'declaration_filed' ? new Date() : null,
          releasedAt: data.status === 'released' ? new Date() : null,
        })
      }
    })
  } catch (error) {
    // The machine throws a plain error naming the illegal move. Surfacing it
    // on the field beats a stack trace, and the operator learns the rule.
    if (error instanceof Error && error.message.includes('transition')) {
      return fail({ status: tv('customsIllegalStep') }, echo(form))
    }
    throw error
  }

  revalidatePath('/customs')
  revalidatePath(`/jobs/${data.jobId}`)
  return succeed(data.status)
}

// --- milestones ------------------------------------------------------------

/**
 * Tick a milestone as done, or un-tick it.
 *
 * The single most-used write in the product once shipments are live, so it is
 * a one-field form rather than a dialog: the time defaults to now, and the
 * common case is one click.
 */
export async function completeMilestone(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'job.update')
  const tv = await getTranslations('operationsValidation')

  const milestoneId = read(form, 'milestoneId')
  const jobId = read(form, 'jobId')
  if (!milestoneId || !jobId) return fail({ _: tv('nothingToUpdate') })

  const undo = form.get('undo') !== null
  const actualAt = read(form, 'actualAt')

  await withActor(session.actor, async (tx) => {
    const reachedAt = undo ? null : actualAt ? new Date(actualAt) : new Date()

    const [milestone] = await tx
      .update(jobMilestones)
      .set({
        actualAt: reachedAt,
        completedById: undo ? null : session.principal.id,
        updatedAt: new Date(),
      })
      .where(eq(jobMilestones.id, milestoneId))
      .returning({
        nameEn: jobMilestones.nameEn,
        nameAr: jobMilestones.nameAr,
        customerVisible: jobMilestones.customerVisible,
      })

    /*
      FR-NT-01 — the notification the whole feature is for.

      Three conditions, and each one is a message somebody would otherwise
      receive wrongly:

      - **Not on undo.** Un-ticking is a correction of an operator's own
        mis-click, and "your shipment has been discharged" followed by nothing
        is worse than silence.
      - **Only if the milestone is customer-visible.** `customer_visible` is
        already the flag that decides what the portal shows (§7.2); a step the
        customer is not shown is not a step to email them about.
      - **Only with a job.** A milestone with no readable job means RLS hid the
        row, and the update above affected nothing.

      Both language forms of the name travel in the payload, because the
      dispatcher resolves the recipient's language *after* this — one event can
      become an English message to one contact and an Arabic one to another,
      and going back to the database at send time for a name that was already
      in hand would be a query per recipient.
    */
    if (!undo && milestone?.customerVisible) {
      const [job] = await tx
        .select({
          reference: jobs.reference,
          branchId: jobs.branchId,
          customerId: jobs.customerId,
        })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1)

      if (job) {
        await tx.insert(notificationOutbox).values({
          branchId: job.branchId,
          eventKey: 'job.milestone_reached',
          jobId,
          customerId: job.customerId,
          payload: {
            reference: job.reference,
            milestone: milestone.nameEn,
            milestoneAr: milestone.nameAr,
            reachedAt: dayIn(reachedAt ?? new Date()),
          },
        })
      }
    }
  })

  revalidatePath(`/jobs/${jobId}`)
  revalidatePath('/dashboard')
  return succeed(milestoneId)
}

// --- equipment -------------------------------------------------------------

const containerSchema = (tv: Translate) =>
  z.object({
    jobId: z.uuid(),
    /**
     * ISO 6346: four letters then seven digits, the last of which is a check
     * digit. Validated for *shape* only — the check digit is not verified here
     * because a container number typed off a photograph of a rusty door is
     * routinely one character out, and refusing it would mean the operator
     * cannot record the box that is physically in front of them.
     */
    containerNo: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v.toUpperCase().replace(/\s+/g, '') : null))
      .refine((v) => v === null || /^[A-Z]{4}\d{6,7}$/.test(v), {
        message: tv('containerNoFormat'),
      }),
    containerType: z
      .string()
      .trim()
      .max(20)
      .optional()
      .transform((v) => v || null),
    sealNo: z
      .string()
      .trim()
      .max(40)
      .optional()
      .transform((v) => v || null),
    grossWeightKg: z
      .string()
      .trim()
      .regex(/^\d*\.?\d*$/, tv('numbersOnly'))
      .optional()
      .transform((v) => (v ? v : null)),
    tareWeightKg: z
      .string()
      .trim()
      .regex(/^\d*\.?\d*$/, tv('numbersOnly'))
      .optional()
      .transform((v) => (v ? v : null)),
  })

export async function addContainer(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'job.update')
  const tv = await getTranslations('operationsValidation')

  const parsed = await localeParse(containerSchema(tv), {
    jobId: read(form, 'jobId'),
    containerNo: read(form, 'containerNo'),
    containerType: read(form, 'containerType'),
    sealNo: read(form, 'sealNo'),
    grossWeightKg: read(form, 'grossWeightKg'),
    tareWeightKg: read(form, 'tareWeightKg'),
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data
  await withActor(session.actor, async (tx) => {
    await tx.insert(equipment).values(data)
  })

  revalidatePath(`/jobs/${data.jobId}`)
  return succeed(data.containerNo ?? 'container')
}

// --- shipment status -------------------------------------------------------

/**
 * Move the shipment itself.
 *
 * Not routed through `jobMachine` by design: the status list a coordinator
 * sees is generated from the enum, and several legal real-world moves (a
 * shipment going back on hold, then off it) are ones the machine does not
 * currently enumerate. Rather than silently allow an illegal move, the two
 * genuinely irreversible ones — cancel and close — are gated on their own
 * permissions.
 *
 * Those permissions gate *entering* the two terminal states and nothing gated
 * *leaving* them, so the one rule that is not negotiable is enforced below:
 * a closed or cancelled shipment does not reopen (§5.5). Everything else stays
 * as free as the enum, which is what the coordinator's screen needs.
 */
export async function setJobStatus(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()
  // Bound before the permission check only because the first refusal comes
  // before it: which key applies depends on the status that was sent.
  const tv = await getTranslations('operationsValidation')

  const jobId = read(form, 'jobId')
  const status = read(form, 'status')
  const reason = read(form, 'reason')
  if (!jobId || !status) return fail({ _: tv('nothingToUpdate') })

  /*
    One key per consequential move, and `job.complete` was missing from it.

    The machine declares it on `delivered → completed`, and this chain checked
    `job.update` instead — so anybody who could correct a vessel name could
    also declare the shipment finished, which is the moment the job stops
    accruing and starts being invoiced. Four keys, four branches; the ordinary
    moves keep `job.update`.
  */
  if (status === 'cancelled') assertCan(session, 'job.cancel')
  else if (status === 'closed') assertCan(session, 'job.close')
  else if (status === 'completed') assertCan(session, 'job.complete')
  else if (status === 'on_hold') assertCan(session, 'job.hold')
  else assertCan(session, 'job.update')

  if (status === 'cancelled' && !reason) {
    return fail({ reason: tv('cancelReasonRequired') }, echo(form))
  }

  const left = await withActor(session.actor, async (tx) => {
    /*
      Terminal means terminal, even though the rest of the machine does not
      apply here.

      The note above is right that `jobMachine` does not enumerate every legal
      real-world move, and asserting the whole machine would refuse a shipment
      coming back off hold. But it leaves a hole the permissions it relies on
      do not cover: `job.cancel` and `job.close` gate *entering* those states,
      and nothing gated *leaving* them. Anyone holding plain `job.update` could
      move a cancelled shipment to `in_transit` — and the blanking below then
      erased `cancelled_at` and `cancelled_reason` on the way past, so the job
      returned to the live board with no trace it had ever been cancelled.
      That is the §5.5 failure rather than the state-machine one, and it is the
      half worth closing.

      Read and decide inside the transaction: two people moving the same job at
      once must not both pass a check against the state they read.
    */
    const [current] = await tx
      .select({ status: jobs.status })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1)
    if (!current) return false

    // Re-saving the state it is already in is a no-op, not a reopening.
    if (current.status !== status && isTerminal(jobMachine, current.status)) return true

    await tx
      .update(jobs)
      .set({
        status: status as 'booked',
        cancelledAt: status === 'cancelled' ? new Date() : null,
        cancelledReason: status === 'cancelled' ? (reason ?? null) : null,
        closedAt: status === 'closed' ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId))

    return false
  })

  if (left) {
    return failWith(tv('jobTerminal'), echo(form))
  }

  revalidatePath('/jobs')
  revalidatePath(`/jobs/${jobId}`)
  revalidatePath('/dashboard')
  return succeed(status)
}

// --- documents ---------------------------------------------------------------

/**
 * Release a document to the customer — FR-DC-05, FR-NT-01.
 *
 * `documents.released_at` has been in the schema since Release One, read by
 * the portal, the register, the job page and the download route, and **set by
 * nothing**. Every document in the system was permanently a draft: the
 * customer-facing download route refused anything unreleased, so the document
 * vault was a place files went into and never came out of.
 *
 * ## Why this is one-way
 *
 * There is no un-release. Once a document has been made available and the
 * customer notified, withdrawing the flag changes what the system says
 * happened without changing what did happen — the customer has the file. A
 * document that should not have gone out is corrected the way every other
 * mistake in this product is corrected (§5.5): a new version supersedes it,
 * and the record keeps both.
 */
export async function releaseDocument(form: FormData): Promise<void> {
  const session = await requireSession()
  assertCan(session, 'document.release')

  const documentId = read(form, 'documentId')
  if (!documentId) throw new Error('No document given')

  await withActor(session.actor, async (tx) => {
    /*
      `is null` in the WHERE, not a read-then-write.

      Two coordinators clicking release on the same document within the same
      second would otherwise both see it unreleased and both raise the event,
      and the customer receives the same notice twice. Making the update itself
      conditional means the second one matches no rows, and the guard below
      sees that and stays silent.
    */
    const [released] = await tx
      .update(documents)
      .set({
        releasedAt: new Date(),
        releasedById: session.principal.id,
        updatedAt: new Date(),
      })
      .where(and(eq(documents.id, documentId), isNull(documents.releasedAt)))
      .returning({ jobId: documents.jobId, documentTypeId: documents.documentTypeId })

    // Already released, or invisible under RLS — which is the same answer to
    // the caller either way (FR-ID-04).
    if (!released) return

    const [context] = await tx
      .select({
        reference: jobs.reference,
        branchId: jobs.branchId,
        customerId: jobs.customerId,
        typeNameEn: documentTypes.nameEn,
        typeNameAr: documentTypes.nameAr,
      })
      .from(jobs)
      .innerJoin(documentTypes, eq(documentTypes.id, released.documentTypeId))
      .where(eq(jobs.id, released.jobId))
      .limit(1)

    if (context) {
      await tx.insert(notificationOutbox).values({
        branchId: context.branchId,
        eventKey: 'document.released',
        jobId: released.jobId,
        customerId: context.customerId,
        payload: {
          reference: context.reference,
          documentType: context.typeNameEn,
          documentTypeAr: context.typeNameAr ?? context.typeNameEn,
        },
      })
    }
  })

  revalidatePath('/documents')
  revalidatePath('/jobs')
}

/* ------------------------------------------------------------- free time */

const clockSchema = (tv: Translate) =>
  z.object({
    clockId: z.uuid().optional(),
    jobId: z.uuid(),
    equipmentId: z.union([z.uuid(), z.literal('')]).optional(),
    kind: z.enum(['demurrage', 'detention', 'storage']),
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, tv('dateFormat')),
    endsOn: z
      .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, tv('dateFormat')), z.literal('')])
      .optional()
      .transform((v) => v || null),
    freeDays: z.coerce.number().int().min(0).max(365),
    perDiem: z
      .string()
      .trim()
      .regex(/^\d+(\.\d{1,6})?$/, tv('amountPerDay')),
    currency: z
      .string()
      .trim()
      .length(3)
      .transform((v) => v.toUpperCase()),
    counterpartyId: z.union([z.uuid(), z.literal('')]).optional(),
  })

/**
 * Start a free-time clock, or stop one — §7.2, FR-JB-11.
 *
 * The half of demurrage that never existed. `free_time_clocks` was read by the
 * dashboard, the job screen and the nightly accrual, and written only by
 * `seed-demo` — so the counter that is the point of the feature ran on
 * demonstration data and on nothing a customer had shipped. An operator whose
 * container was sitting at Shuwaikh had no way to say so.
 *
 * ## Stopping is a date, not a delete
 *
 * `ends_on` is when the box came back. Setting it stops the accrual and leaves
 * every day already charged where it is, which is what a credit note is for if
 * they were wrong (§5.5). The worker skips clocks with an end date, so this is
 * the whole of "stop it".
 */
export async function saveFreeTimeClock(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'job.update')
  const tv = await getTranslations('operationsValidation')

  const parsed = await localeParse(clockSchema(tv), {
    clockId: read(form, 'clockId'),
    jobId: read(form, 'jobId'),
    equipmentId: read(form, 'equipmentId') ?? '',
    kind: read(form, 'kind') ?? 'demurrage',
    startsOn: read(form, 'startsOn') ?? '',
    endsOn: read(form, 'endsOn') ?? '',
    freeDays: read(form, 'freeDays') ?? '0',
    perDiem: read(form, 'perDiem') ?? '',
    currency: read(form, 'currency') ?? 'KWD',
    counterpartyId: read(form, 'counterpartyId') ?? '',
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data
  if (data.endsOn && data.endsOn < data.startsOn) {
    return fail({ endsOn: tv('endsBeforeStart') }, echo(form))
  }

  /*
    A mistyped year is the expensive typo on this form.

    The regex above accepts any well-formed date, which is how a clock came to
    start in 2019 on a shipment that arrived a fortnight ago: the nightly
    accrual read it, billed 2427 days at KWD 28, and wrote the charge line
    itself. The field is free text with no default, so there is nothing between
    the wrong keystroke and the invoice except this.

    Refused here as well as skipped by the worker, because the worker only
    stops the bill — the operator who typed it is the one who can correct it,
    and they are standing here.
  */
  if (!isPlausibleClockStart(data.startsOn, todayIn())) {
    return fail(
      {
        startsOn: tv('clockStartTooOld', { years: MAX_CLOCK_BACKDATE_DAYS / 365 }),
      },
      echo(form),
    )
  }

  await withActor(session.actor, async (tx) => {
    const values = {
      jobId: data.jobId,
      equipmentId: data.equipmentId || null,
      kind: data.kind,
      startsOn: data.startsOn,
      endsOn: data.endsOn,
      freeDays: data.freeDays,
      perDiem: data.perDiem,
      currency: data.currency,
      counterpartyId: data.counterpartyId || null,
    }

    if (data.clockId) {
      await tx
        .update(freeTimeClocks)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(freeTimeClocks.id, data.clockId))
    } else {
      await tx.insert(freeTimeClocks).values(values)
    }
  })

  revalidatePath(`/jobs/${data.jobId}`)
  revalidatePath('/jobs')
  revalidatePath('/dashboard')
  return succeed(data.kind)
}

/**
 * The terms this branch grants, for the form's defaults — FR-AD-03.
 *
 * Read from `free_time_rules` rather than defaulted in the dialog, because
 * that table exists precisely so the terms are configuration. Returning
 * nothing is a legitimate answer: an unconfigured mode means the operator
 * types the days and the rate, which is what they did for every clock before
 * this existed.
 */
export async function freeTimeDefaults(input: {
  readonly jobId: string
  readonly kind: 'demurrage' | 'detention' | 'storage'
  readonly containerType?: string | null
}): Promise<{ freeDays: number; perDiem: string; currency: string } | null> {
  const session = await requireSession()
  assertCan(session, 'job.update')

  return withActor(session.actor, async (tx) => {
    const [job] = await tx
      .select({ branchId: jobs.branchId, mode: jobs.mode })
      .from(jobs)
      .where(eq(jobs.id, input.jobId))
      .limit(1)
    if (!job) return null

    const terms = await freeTimeTermsFor(tx, {
      kind: input.kind,
      branchId: job.branchId,
      mode: job.mode,
      containerType: input.containerType ?? null,
    })

    return terms
      ? { freeDays: terms.freeDays, perDiem: terms.perDiem, currency: terms.currency }
      : null
  })
}
