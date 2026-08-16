'use server'

/**
 * Enquiry mutations, in the shape a `<form>` speaks.
 *
 * Separate from `actions.ts`, and the split is deliberate rather than
 * organisational. `actions.ts` holds the *domain* operations: they take typed
 * input, they throw on a bad transition, and they are what a background job or
 * an inbound-email handler would call. These take a `FormData` and return a
 * `FormState`, because a form needs the failure rendered against the field
 * that caused it rather than thrown.
 *
 * Wiring the form straight to the domain action would force one of the two to
 * compromise: either the domain action grows a `FormData` parameter, or the
 * form loses per-field errors. Neither is worth avoiding a fifty-line adapter.
 */

import { revalidatePath } from 'next/cache'
import { and, eq, sql } from 'drizzle-orm'
import {
  assertTransition,
  enquiryMachine,
  slaDueAt,
  type WorkingCalendar,
} from '@qabandi/core'
import {
  branches,
  calendarHolidays,
  enquiries,
  notificationOutbox,
  withActor,
  workingCalendars,
} from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan, assertInBranch } from '@/lib/permissions'
import { echo, fail, fieldErrors, succeed, type ActionState } from '@/lib/form-state'
import { createEnquirySchema } from './schema'

/** Enquiry SLA: four working hours to a first response — FR-EQ-01. */
const FIRST_RESPONSE_MINUTES = 4 * 60

export async function submitEnquiry(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'enquiry.assign')

  const read = (key: string): string | undefined => {
    const value = form.get(key)
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
  }

  const parsed = createEnquirySchema.safeParse({
    branchId: read('branchId'),
    customerId: read('customerId') ?? null,
    contactName: read('contactName') ?? null,
    contactEmail: read('contactEmail') ?? null,
    channel: read('channel') ?? 'email',
    mode: read('mode') ?? null,
    tradeDirection: read('tradeDirection') ?? null,
    originId: read('originId') ?? null,
    destinationId: read('destinationId') ?? null,
    commodityId: read('commodityId') ?? null,
    incoterm: read('incoterm') ?? null,
    readyOn: read('readyOn') ?? null,
    grossWeightKg: read('grossWeightKg') ?? null,
    volumeCbm: read('volumeCbm') ?? null,
    pieces: read('pieces') ? Number(read('pieces')) : null,
    isDangerous: form.get('isDangerous') !== null,
    notes: read('notes') ?? null,
  })

  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data
  assertInBranch(session, data.branchId)

  const reference = await withActor(session.actor, async (tx) => {
    const calendar = await loadCalendar(tx, data.branchId)
    const startedAt = new Date()

    const [row] = await tx
      .insert(enquiries)
      .values({
        ...data,
        reference: await nextReference(tx, data.branchId),
        status: 'new',
        ownerId: read('ownerId') ?? null,
        slaStartedAt: startedAt,
        slaDueAt: slaDueAt(startedAt, FIRST_RESPONSE_MINUTES, calendar),
      })
      .returning({ id: enquiries.id, reference: enquiries.reference })

    // Written in the same transaction: if the insert rolls back the
    // notification never existed — a transactional outbox with no extra
    // moving part (§7.4).
    await tx.insert(notificationOutbox).values({
      branchId: data.branchId,
      eventKey: 'enquiry.created',
      enquiryId: row!.id,
      customerId: data.customerId ?? null,
      payload: { reference: row!.reference },
    })

    return row!.reference
  })

  revalidatePath('/enquiries')
  revalidatePath('/dashboard')
  return succeed(reference)
}

/** Hands the enquiry to a person. The board's most-used single action. */
export async function assignEnquiryAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'enquiry.assign')

  const enquiryId = String(form.get('enquiryId') ?? '')
  const ownerId = String(form.get('ownerId') ?? '')
  if (!enquiryId || !ownerId) return fail({ ownerId: 'Choose who should own this.' }, echo(form))

  await withActor(session.actor, async (tx) => {
    const [current] = await tx
      .select({ status: enquiries.status })
      .from(enquiries)
      .where(eq(enquiries.id, enquiryId))
      .limit(1)
    // Invisible under RLS means not-found, which is also the right answer to
    // give: no enumeration signal for another branch's enquiry (FR-ID-04).
    if (!current) throw new Error('not_found')

    // Already-assigned enquiries get reassigned rather than rejected — the
    // state machine only governs the first move out of `new`.
    if (current.status === 'new') assertTransition(enquiryMachine, current.status, 'assigned')

    await tx
      .update(enquiries)
      .set({ ownerId, status: current.status === 'new' ? 'assigned' : current.status })
      .where(eq(enquiries.id, enquiryId))
  })

  revalidatePath('/enquiries')
  revalidatePath(`/enquiries/${enquiryId}`)
  return succeed(ownerId)
}

/** Marks the first reply as sent — the moment the SLA clock stops. */
export async function respondEnquiryAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'enquiry.assign')

  const enquiryId = String(form.get('enquiryId') ?? '')
  if (!enquiryId) return fail({ _: 'Missing enquiry.' })

  await withActor(session.actor, async (tx) => {
    await tx
      .update(enquiries)
      .set({ firstRespondedAt: sql`coalesce(${enquiries.firstRespondedAt}, now())` })
      .where(eq(enquiries.id, enquiryId))
  })

  revalidatePath('/enquiries')
  revalidatePath('/dashboard')
  return succeed(enquiryId)
}

/** Closes it won or lost. `lostReason` is required on a loss — it is the data. */
export async function closeEnquiryAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'enquiry.close')

  const enquiryId = String(form.get('enquiryId') ?? '')
  const outcome = String(form.get('outcome') ?? '')
  const reason = String(form.get('reason') ?? '').trim()

  if (outcome !== 'won' && outcome !== 'lost') {
    return fail({ outcome: 'Choose won or lost.' }, echo(form))
  }
  if (outcome === 'lost' && !reason) {
    return fail(
      { reason: 'Say why it was lost — this is the only place that answer gets recorded.' },
      echo(form),
    )
  }

  await withActor(session.actor, async (tx) => {
    const [current] = await tx
      .select({ status: enquiries.status })
      .from(enquiries)
      .where(eq(enquiries.id, enquiryId))
      .limit(1)
    if (!current) throw new Error('not_found')

    assertTransition(enquiryMachine, current.status, outcome)

    await tx
      .update(enquiries)
      .set({
        status: outcome,
        closedAt: new Date(),
        lostReason: outcome === 'lost' ? reason : null,
      })
      .where(eq(enquiries.id, enquiryId))
  })

  revalidatePath('/enquiries')
  revalidatePath('/dashboard')
  return succeed(outcome)
}

/**
 * Loads the branch's working calendar — NFR-03.
 *
 * Kuwait, Qatar and the UAE share neither a weekend nor a holiday list, so an
 * SLA computed against the wrong calendar is wrong by days, not minutes.
 */
async function loadCalendar(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  branchId: string,
): Promise<WorkingCalendar> {
  const [row] = await tx
    .select({
      id: workingCalendars.id,
      timeZone: workingCalendars.timeZone,
      weekend: workingCalendars.weekend,
      startMinute: workingCalendars.dayStartMinute,
      endMinute: workingCalendars.dayEndMinute,
    })
    .from(branches)
    .innerJoin(workingCalendars, eq(workingCalendars.id, branches.calendarId))
    .where(eq(branches.id, branchId))
    .limit(1)

  if (!row) throw new Error('branch_calendar_missing')

  const holidays = await tx
    .select({ onDate: calendarHolidays.onDate })
    .from(calendarHolidays)
    .where(eq(calendarHolidays.calendarId, row.id))

  return {
    id: row.id,
    timeZone: row.timeZone,
    weekend: row.weekend as WorkingCalendar['weekend'],
    holidays: new Set(holidays.map((h: { onDate: string }) => h.onDate)),
    hours: { startMinute: row.startMinute, endMinute: row.endMinute },
  }
}

/**
 * The branch's next enquiry reference.
 *
 * Allocated inside the transaction from a sequence, so two concurrent
 * enquiries cannot take the same number — which an application-level counter
 * gets wrong the first time two people submit at once.
 */
async function nextReference(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  branchId: string,
): Promise<string> {
  const [branch] = await tx
    .select({ code: branches.code })
    .from(branches)
    .where(and(eq(branches.id, branchId)))
    .limit(1)
  if (!branch) throw new Error('not_found')

  const year = new Date().getUTCFullYear()
  const result = await tx.execute(sql`select nextval('enquiry_reference_seq')::text as seq`)
  const seq = (result.rows[0] as { seq: string }).seq
  return `${branch.code}-ENQ-${year}-${seq.padStart(5, '0')}`
}
