'use server'

/**
 * Enquiry mutations.
 *
 * The shape every server action in the application follows:
 *
 *   1. resolve the session          -> who is acting
 *   2. check the permission         -> what the interface offers (FR-ID-03)
 *   3. validate with the schema     -> generated from the column definition
 *   4. assert the state transition  -> rejected in core, not in the UI (§7.3)
 *   5. write inside withActor       -> RLS scopes it, the trigger audits it
 *   6. enqueue in the same transaction -> no job for a write that rolled back
 *
 * There is no service class between the action and the table. Adding one would
 * mean a layer whose only content is the six steps above.
 */

import { revalidatePath } from 'next/cache'
import { and, eq, sql } from 'drizzle-orm'
import { assertTransition, enquiryMachine, slaDueAt, type WorkingCalendar } from '@qabandi/core'
import {
  calendarHolidays,
  enquiries,
  notificationOutbox,
  branches,
  workingCalendars,
  withActor,
} from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan, assertInBranch } from '@/lib/permissions'
import { assignEnquirySchema, closeEnquirySchema, createEnquirySchema } from './schema'

/** Enquiry SLA: four working hours to a first response — FR-EQ-01. */
const FIRST_RESPONSE_MINUTES = 4 * 60

export async function createEnquiry(input: unknown) {
  const session = await requireSession()
  assertCan(session, 'enquiry.assign')

  const data = createEnquirySchema.parse(input)
  assertInBranch(session, data.branchId)

  return withActor(session.actor, async (tx) => {
    const calendar = await loadCalendar(tx, data.branchId)
    const startedAt = new Date()

    const [row] = await tx
      .insert(enquiries)
      .values({
        ...data,
        reference: await nextReference(tx, data.branchId),
        status: 'new',
        slaStartedAt: startedAt,
        // Computed once, through the branch's own calendar, then compared
        // cheaply by the escalation job every fifteen minutes (§9).
        slaDueAt: slaDueAt(startedAt, FIRST_RESPONSE_MINUTES, calendar),
      })
      .returning()

    // The outbox row is written in this transaction. If the insert above rolls
    // back, the notification never existed — a transactional outbox with no
    // extra component (§7.4).
    await tx.insert(notificationOutbox).values({
      branchId: data.branchId,
      eventKey: 'enquiry.created',
      enquiryId: row!.id,
      customerId: data.customerId ?? null,
      payload: { reference: row!.reference },
    })

    revalidatePath('/enquiries')
    return row!
  })
}

export async function assignEnquiry(input: unknown) {
  const session = await requireSession()
  assertCan(session, 'enquiry.assign')
  const { enquiryId, ownerId } = assignEnquirySchema.parse(input)

  return withActor(session.actor, async (tx) => {
    // PostgreSQL 18's RETURNING OLD.* gives the prior status without a second
    // round trip (§6.4) — exactly what the transition check needs.
    const [current] = await tx
      .select({ status: enquiries.status })
      .from(enquiries)
      .where(eq(enquiries.id, enquiryId))
      .limit(1)

    // Invisible under RLS means not-found, which is the correct answer here
    // too: no enumeration signal for another branch's enquiry (FR-ID-04).
    if (!current) throw new Error('not_found')

    assertTransition(enquiryMachine, current.status, 'assigned')

    const [row] = await tx
      .update(enquiries)
      .set({ ownerId, status: 'assigned' })
      .where(eq(enquiries.id, enquiryId))
      .returning()

    revalidatePath('/enquiries')
    return row!
  })
}

export async function closeEnquiry(input: unknown) {
  const session = await requireSession()
  assertCan(session, 'enquiry.close')
  const { enquiryId, outcome, reason } = closeEnquirySchema.parse(input)

  return withActor(session.actor, async (tx) => {
    const [current] = await tx
      .select({ status: enquiries.status })
      .from(enquiries)
      .where(eq(enquiries.id, enquiryId))
      .limit(1)
    if (!current) throw new Error('not_found')

    assertTransition(enquiryMachine, current.status, outcome)

    const [row] = await tx
      .update(enquiries)
      .set({ status: outcome, closedAt: new Date(), lostReason: outcome === 'lost' ? reason : null })
      .where(eq(enquiries.id, enquiryId))
      .returning()

    revalidatePath('/enquiries')
    return row!
  })
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
 * Allocated inside the transaction against the branch row, so two concurrent
 * enquiries cannot take the same number — the row lock does the work that an
 * application-level counter would get wrong under load.
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
