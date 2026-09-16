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
  decideProposal,
  enquiryMachine,
  entryPermission,
  slaDueAt,
  type WorkingCalendar,
} from '@qabandi/core'
import {
  branches,
  calendarHolidays,
  enquiries,
  extractionProposals,
  notificationOutbox,
  withActor,
  workingCalendars,
} from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan, assertInBranch } from '@/lib/permissions'
import { echo, fail, failWith, fieldErrors, succeed, type ActionState } from '@/lib/form-state'
import { createEnquirySchema } from './schema'
import { enquiryColumn, resolveProposal, type ResolutionFailure } from './proposals'

/** Enquiry SLA: four working hours to a first response — FR-EQ-01. */
const FIRST_RESPONSE_MINUTES = 4 * 60

export async function submitEnquiry(_previous: ActionState, form: FormData): Promise<ActionState> {
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

/**
 * Cancel an enquiry, or start rating one — the two transitions the machine
 * declared and nothing exercised.
 *
 * `enquiry.cancel` and `enquiry.rate` were in `permissionKeys()` from Release
 * One, seeded into the matrix, and checked in no file: the queue could take an
 * enquiry and close it won or lost, and had no way to say "this one is being
 * priced" or "the customer went elsewhere before we quoted".
 *
 * Both matter for the same reason, which is the SLA. An enquiry sitting in
 * `assigned` looks unanswered to the escalation worker whether somebody is
 * working on it or whether it has been forgotten; `rating` is the difference.
 * And a cancelled enquiry that stays `new` is chased for ever.
 */
export async function advanceEnquiry(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()

  // This file reads FormData directly, like its siblings above.
  const enquiryId = String(form.get('enquiryId') ?? '')
  const to = String(form.get('to') ?? '')
  const reason = String(form.get('reason') ?? '').trim()
  if (!enquiryId || (to !== 'cancelled' && to !== 'rating')) {
    return failWith('Nothing to do.')
  }

  // The key the machine declares for the move, rather than one restated here.
  const required = entryPermission(enquiryMachine, to)
  if (required) assertCan(session, required)

  /*
    A cancellation needs a reason, and reuses `lost_reason`.

    The column is "why this enquiry produced no job", and cancelled and lost
    are two ways of arriving there. A second column would split the one report
    anybody runs on this — why are we not winning work — across two fields.
  */
  if (to === 'cancelled' && reason === '') {
    return fail({ reason: 'Say why it was cancelled — it stays on the record.' }, echo(form))
  }

  const outcome = await withActor(session.actor, async (tx) => {
    const [current] = await tx
      .select({ status: enquiries.status, branchId: enquiries.branchId })
      .from(enquiries)
      .where(eq(enquiries.id, enquiryId))
      .limit(1)
    if (!current) return 'not_found' as const
    assertInBranch(session, current.branchId)

    try {
      assertTransition(enquiryMachine, current.status, to)
    } catch {
      return 'illegal' as const
    }

    await tx
      .update(enquiries)
      .set({
        status: to,
        // Cancelling closes it; starting to rate does not.
        closedAt: to === 'cancelled' ? new Date() : undefined,
        lostReason: to === 'cancelled' ? reason : undefined,
        updatedAt: new Date(),
      })
      .where(eq(enquiries.id, enquiryId))

    return 'ok' as const
  })

  if (outcome === 'not_found') return failWith('No such enquiry, or it is not one you can see.')
  if (outcome === 'illegal') {
    return failWith('That is not a step this enquiry can take from where it is.')
  }

  revalidatePath('/enquiries')
  revalidatePath(`/enquiries/${enquiryId}`)
  revalidatePath('/dashboard')
  return succeed(enquiryId)
}

// --- what a model read -----------------------------------------------------

/**
 * Accepting one proposal — `AI-05`.
 *
 * The write is ordinary. It updates the column under the coordinator's own
 * actor, through the same RLS and the same audit trigger as the enquiry form,
 * and then closes the proposal. Nothing about it is an "AI write", which is
 * the point: the audit trail answers *who put this on the shipment* without a
 * new concept to answer it.
 *
 * ## `decideProposal` runs again, here, against the row as it is now
 *
 * Not against the row as it was when the model was asked. A coordinator may
 * have typed the value in the twenty minutes since, and a person's answer
 * wins — so a column that has filled up in the meantime discards the proposal
 * rather than overwriting it. `target_was_empty` records what was true then,
 * which is what makes the drift visible; this check decides what happens now.
 *
 * ## Resolution happens inside the transaction
 *
 * `origin`, `destination` and `commodity` arrive as text a stranger emailed
 * us. Resolving them outside this transaction would resolve them under
 * different visibility than the update runs under, and refusing ambiguity is
 * the whole safeguard — two matches is refused as firmly as none.
 */
export async function acceptProposal(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'enquiry.assign')

  const proposalId = readField(form, 'proposalId')
  const enquiryId = readField(form, 'enquiryId')
  if (!proposalId || !enquiryId) return failWith('Nothing to do.')

  const outcome = await withActor(session.actor, async (tx) => {
    const [proposal] = await tx
      .select({
        id: extractionProposals.id,
        field: extractionProposals.field,
        value: extractionProposals.value,
        confidence: extractionProposals.confidence,
        targetId: extractionProposals.targetId,
        status: extractionProposals.status,
      })
      .from(extractionProposals)
      .where(eq(extractionProposals.id, proposalId))
      .limit(1)

    if (!proposal || proposal.targetId !== enquiryId) return { error: 'gone' as const }
    if (proposal.status !== 'proposed') return { error: 'settled' as const }

    const resolution = await resolveProposal(tx, proposal.field, proposal.value)
    if (!resolution.ok) return { error: 'unresolved' as const, failure: resolution.failure }

    /*
      The never-overwrite rule, re-applied at the moment of the write.

      Thresholds at zero for the same reason the worker sets them there: this
      surface proposes and a person accepts, so filtering by score here would
      only hide from the coordinator a proposal they are already looking at and
      have just clicked. What `decideProposal` is being asked is the one
      question that still matters — is the column still empty?
    */
    const current = await enquiryColumn(tx, enquiryId, resolution.column)
    const verdict = decideProposal(
      {
        field: proposal.field,
        value: proposal.value,
        confidence: Number(proposal.confidence ?? 0),
      },
      { current, humanAuthored: current !== null, applyThreshold: 0, reviewThreshold: 0 },
    )
    if (verdict === 'discard') return { error: 'occupied' as const }

    await tx
      .update(enquiries)
      .set({ [resolution.column]: resolution.value, updatedAt: new Date() })
      .where(eq(enquiries.id, enquiryId))

    await tx
      .update(extractionProposals)
      .set({
        status: 'applied',
        decidedById: session.actor.principalId,
        decidedAt: new Date(),
        closedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(extractionProposals.id, proposalId))

    return { ok: true as const }
  })

  if ('error' in outcome) {
    if (outcome.error === 'unresolved') {
      return failWith(describeFailure(outcome.failure))
    }
    if (outcome.error === 'gone') return failWith('That suggestion is no longer there.')
    if (outcome.error === 'settled') return failWith('Somebody has already decided that one.')
    if (outcome.error === 'occupied') {
      return failWith('That field has been filled in since, so the suggestion was not applied.')
    }
    return failWith('That did not work.')
  }

  revalidatePath(`/enquiries/${enquiryId}`)
  return succeed(enquiryId)
}

/**
 * Accept every open suggestion on an enquiry in one action — the one-click fill.
 *
 * The same rule as accepting one, applied down the list: each proposal is
 * resolved, checked against the column as it stands *now*, and written under the
 * coordinator's own actor — so a field a person filled between the model reading
 * the mail and this click is left alone, not overwritten. A proposal that will
 * not resolve, or whose column is no longer empty, is skipped and counted rather
 * than failing the batch; the ones it could not apply stay in the queue for a
 * person to look at. It confirms what a coordinator has already read three inches
 * above the form, in one click instead of twelve.
 */
export async function acceptAllProposals(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'enquiry.assign')

  const enquiryId = readField(form, 'enquiryId')
  if (!enquiryId) return failWith('Nothing to do.')

  const result = await withActor(session.actor, async (tx) => {
    const proposals = await tx
      .select({
        id: extractionProposals.id,
        field: extractionProposals.field,
        value: extractionProposals.value,
        confidence: extractionProposals.confidence,
      })
      .from(extractionProposals)
      .where(
        and(
          eq(extractionProposals.targetTable, 'enquiries'),
          eq(extractionProposals.targetId, enquiryId),
          eq(extractionProposals.status, 'proposed'),
        ),
      )

    let applied = 0
    let skipped = 0
    for (const proposal of proposals) {
      const resolution = await resolveProposal(tx, proposal.field, proposal.value)
      if (!resolution.ok) {
        skipped += 1
        continue
      }
      const current = await enquiryColumn(tx, enquiryId, resolution.column)
      const verdict = decideProposal(
        {
          field: proposal.field,
          value: proposal.value,
          confidence: Number(proposal.confidence ?? 0),
        },
        { current, humanAuthored: current !== null, applyThreshold: 0, reviewThreshold: 0 },
      )
      if (verdict === 'discard') {
        skipped += 1
        continue
      }

      await tx
        .update(enquiries)
        .set({ [resolution.column]: resolution.value, updatedAt: new Date() })
        .where(eq(enquiries.id, enquiryId))
      await tx
        .update(extractionProposals)
        .set({
          status: 'applied',
          decidedById: session.actor.principalId,
          decidedAt: new Date(),
          closedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(extractionProposals.id, proposal.id))
      applied += 1
    }

    return { applied, skipped }
  })

  revalidatePath(`/enquiries/${enquiryId}`)
  if (result.applied === 0 && result.skipped > 0) {
    return failWith('None could be applied — those fields have since been filled in.')
  }
  return succeed(String(result.applied))
}

/**
 * Rejecting one, which is a decision and is recorded as one.
 *
 * Not a delete. Nothing is deleted (§5.5), and a rejected proposal is the most
 * useful row in the table: it is the evaluation set. A surface whose wrong
 * answers are thrown away cannot be measured, and `AI-19`'s golden set is
 * assembled from exactly these.
 */
export async function rejectProposal(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'enquiry.assign')

  const proposalId = readField(form, 'proposalId')
  const enquiryId = readField(form, 'enquiryId')
  if (!proposalId || !enquiryId) return failWith('Nothing to do.')

  await withActor(session.actor, async (tx) => {
    await tx
      .update(extractionProposals)
      .set({
        status: 'rejected',
        decidedById: session.actor.principalId,
        decidedAt: new Date(),
        closedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(extractionProposals.id, proposalId),
          eq(extractionProposals.targetId, enquiryId),
          eq(extractionProposals.status, 'proposed'),
        ),
      )
  })

  revalidatePath(`/enquiries/${enquiryId}`)
  return succeed(enquiryId)
}

function readField(form: FormData, key: string): string | undefined {
  const value = form.get(key)
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** A refusal, as a sentence the coordinator can act on. */
function describeFailure(failure: ResolutionFailure): string {
  switch (failure.kind) {
    case 'not_found':
      return `“${failure.value}” is not a place or commodity on file, so it was not applied. Add it, or set the field by hand.`
    case 'ambiguous':
      return `“${failure.value}” matches ${failure.count} records, and guessing between them is how the wrong one gets written. Set the field by hand.`
    case 'invalid':
      return `“${failure.value}” is not a valid value — expected ${failure.expected}.`
    default:
      return 'That suggestion names a field this screen cannot set.'
  }
}
