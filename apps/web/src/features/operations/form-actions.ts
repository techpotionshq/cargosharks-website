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
import { and, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { assertTransition, customsMachine } from '@qabandi/core'
import { customsStages, equipment, exceptions, jobMilestones, jobs, withActor } from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan } from '@/lib/permissions'
import { echo, fail, fieldErrors, succeed, type ActionState } from '@/lib/form-state'

function read(form: FormData, key: string): string | undefined {
  const value = form.get(key)
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** A `datetime-local` arrives as `YYYY-MM-DDTHH:mm` with no zone. */
const localDateTime = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? new Date(value) : null))
  .refine((value) => value === null || !Number.isNaN(value.getTime()), {
    message: 'Not a valid date and time',
  })

// --- exceptions ------------------------------------------------------------

const raiseSchema = z.object({
  jobId: z.uuid('Choose a shipment'),
  exceptionCodeId: z.uuid('Choose what went wrong'),
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
  dueAt: localDateTime,
  customerVisible: z.coerce.boolean(),
  costImpact: z
    .string()
    .trim()
    .regex(/^\d*\.?\d*$/, 'Numbers only')
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

  const parsed = raiseSchema.safeParse({
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

  const exceptionId = read(form, 'exceptionId')
  const resolution = read(form, 'resolution')
  if (!exceptionId) return fail({ _: 'Nothing to close.' })
  if (!resolution) {
    return fail(
      { resolution: 'Say what was done. This is the only record of how it was resolved.' },
      echo(form),
    )
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

const customsSchema = z.object({
  jobId: z.uuid('Choose a shipment'),
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
    .regex(/^\d*\.?\d*$/, 'Numbers only')
    .optional()
    .transform((v) => (v ? v : null)),
  dutyCurrency: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v.toUpperCase() : null)),
  inspectionRequired: z.coerce.boolean(),
  slaDueAt: localDateTime,
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
  assertCan(session, 'customs.update')

  const parsed = customsSchema.safeParse({
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
      return fail({ status: 'That is not a step customs can move to from here.' }, echo(form))
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

  const milestoneId = read(form, 'milestoneId')
  const jobId = read(form, 'jobId')
  if (!milestoneId || !jobId) return fail({ _: 'Nothing to update.' })

  const undo = form.get('undo') !== null
  const actualAt = read(form, 'actualAt')

  await withActor(session.actor, async (tx) => {
    await tx
      .update(jobMilestones)
      .set({
        actualAt: undo ? null : actualAt ? new Date(actualAt) : new Date(),
        completedById: undo ? null : session.principal.id,
        updatedAt: new Date(),
      })
      .where(eq(jobMilestones.id, milestoneId))
  })

  revalidatePath(`/jobs/${jobId}`)
  revalidatePath('/dashboard')
  return succeed(milestoneId)
}

// --- equipment -------------------------------------------------------------

const containerSchema = z.object({
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
      message: 'Four letters then six or seven digits, e.g. MSKU4419512',
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
    .regex(/^\d*\.?\d*$/, 'Numbers only')
    .optional()
    .transform((v) => (v ? v : null)),
  tareWeightKg: z
    .string()
    .trim()
    .regex(/^\d*\.?\d*$/, 'Numbers only')
    .optional()
    .transform((v) => (v ? v : null)),
})

export async function addContainer(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'job.update')

  const parsed = containerSchema.safeParse({
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
 * Not routed through `jobMachine` yet by design: the status list a coordinator
 * sees is generated from the enum, and several legal real-world moves (a
 * shipment going back on hold, then off it) are ones the machine does not
 * currently enumerate. Rather than silently allow an illegal move, the two
 * genuinely irreversible ones — cancel and close — are gated on their own
 * permissions, which is where the real protection sits.
 */
export async function setJobStatus(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()

  const jobId = read(form, 'jobId')
  const status = read(form, 'status')
  const reason = read(form, 'reason')
  if (!jobId || !status) return fail({ _: 'Nothing to update.' })

  if (status === 'cancelled') assertCan(session, 'job.cancel')
  else if (status === 'closed') assertCan(session, 'job.close')
  else if (status === 'on_hold') assertCan(session, 'job.hold')
  else assertCan(session, 'job.update')

  if (status === 'cancelled' && !reason) {
    return fail({ reason: 'Say why it was cancelled — it stays on the record.' }, echo(form))
  }

  await withActor(session.actor, async (tx) => {
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
  })

  revalidatePath('/jobs')
  revalidatePath(`/jobs/${jobId}`)
  revalidatePath('/dashboard')
  return succeed(status)
}
