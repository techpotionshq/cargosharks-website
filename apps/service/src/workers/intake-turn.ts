/**
 * The intake agent's turn — read the whole conversation once the customer has
 * stopped typing, then confirm, clarify, hand to a person, or stay silent.
 *
 * `ingestMessage` files every inbound message the moment it arrives, exactly
 * as before; what changed is that *understanding* and *answering* no longer
 * happen per message. Each message on an enquiry the agent holds pushes the
 * conversation's `turn_due_at` back by a quiet window (capped at a maximum wait
 * from the first unread message), and this worker runs the turn when it falls
 * due. A customer who types five messages in a row gets one turn, one model
 * call and at most one reply.
 *
 * ## One turn, step by step
 *
 *  1. **Claim** the conversation under a lease: `for update skip locked`, then
 *     `claimed_until` and a fresh `claim_token`. A second service instance, a
 *     duplicate wake-up job and the minute sweep all race for the same row and
 *     exactly one wins; a worker that dies mid-turn loses its lease when it
 *     expires and the next sweep takes the turn over.
 *  2. **Read** the customer's messages on the enquiry that no earlier turn has
 *     read (`intake_turns.message_ids`), and classify them: substantive,
 *     chit-chat, or a machine. Only substantive content reaches a model.
 *  3. **Understand**, once: the existing enquiry extraction over a transcript
 *     of *every* customer message so far, merged into proposals by the same
 *     rules a single mail is (`extractEnquiry` with `source`).
 *  4. **Decide** with `decideIntakeReply` in core — completeness against the
 *     branch's requirement rows, the cooldown and cap, human takeover, and the
 *     sender-level loop breakers.
 *  5. **Record** the turn — before any send, so the messages it read are read
 *     even if the send dies — and release the lease.
 *  6. **Send**, after the commit, through the channel the customer wrote on;
 *     store the reply as an outbound message with the provider's id, so a
 *     quoted reply threads.
 *
 * ## The loop breakers, all of them
 *
 * `Operations_Findings §11` is the reason this file is careful: a path that
 * answers the sender of inbound mail needs a loop breaker before it needs
 * anything else. Kept from before: automatic mail is filed nowhere
 * (`isAutomaticMail`), bounces never reach a turn, and a sender writing in a
 * burst is a machine. Added here: a per-enquiry ceiling (at most one
 * confirmation and `clarifyCap` clarifications, ever), a reply only when the
 * customer wrote something substantive, auto-responder text and repeated or
 * instant replies treated as machines, a per-sender daily cap across every
 * enquiry, and no reply to a no-reply address. A conversation with an
 * auto-responder therefore ends after at most one message from us: its answer
 * is classified automatic, and an automatic turn says nothing.
 */

import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import {
  assets,
  branches,
  enquiries,
  extractionProposals,
  intakeConversations,
  intakeTurns,
  loadIntakeRequirements,
  loadIntakeSettings,
  messageAttachments,
  messages,
  notificationOutbox,
  notificationTemplates,
  NOTIFICATION_TEMPLATES,
  principals,
  systemActor,
  withActor,
  SYSTEM_PRINCIPAL_ID,
  type Tx,
} from '@qabandi/db'
import {
  classifyNewContent,
  decideIntakeReply,
  detectLanguage,
  evaluateCompleteness,
  isNoReplyAddress,
  missingPhrase,
  renderTemplate,
  silencedBeforeReading,
  type Completeness,
  type IntakeDecision,
  type IntakeLocale,
  type IntakeReason,
  type KnownFacts,
} from '@qabandi/core'
import type { NotificationChannel } from '../ports/index'
import { resolveEmailChannel, resolveWhatsAppChannel } from '../adapters/index'
import { sendWithRetry } from './send-retry'
import { whatsAppSenderNumber } from './inbound-whatsapp-webhook'
import {
  extractEnquiry,
  type ExtractEnquiryInput,
  type ExtractEnquiryResult,
} from './enquiry-extract'

/** How long a claimed turn is ours. Well past a model call's timeout. */
const LEASE_SECONDS = 10 * 60
/** Conversations one sweep takes on — the rest wait a minute, not forever. */
const SWEEP_BATCH = 25
/** The enquiry states the agent may still talk in. Quoted and beyond is a person's. */
const OPEN_STATUSES = new Set(['new', 'assigned', 'rating'])
/**
 * Agent messages to one sender in a day, across every enquiry, before it stops.
 * One confirmation and two clarifications is three; the fourth is headroom for
 * a customer with two enquiries in flight, and the fifth is a loop.
 */
export const SENDER_DAILY_CAP = 4
/**
 * Inbound messages from one sender inside `BURST_MINUTES` that make them a
 * machine. Far above the acknowledgement's old limit, because the debounce
 * makes a fast typist cost one turn — this is only for things that are not
 * typing at all.
 */
export const INTAKE_BURST_LIMIT = 20
export const BURST_MINUTES = 10
/** A reply this soon after ours was not written by a person who read ours. */
export const INSTANT_REPLY_SECONDS = 5
/** Attempts at a model that keeps failing transiently before the turn gives up. */
const MODEL_ATTEMPTS = 3
/** The transcript cap, in characters — the newest messages win. */
const MAX_TRANSCRIPT_CHARS = 24_000

export type ResolveChannel = () => Promise<NotificationChannel | null>

export interface IntakeTurnDeps {
  /** The extraction — the real one, or a test's fake model. */
  readonly extract?: (input: ExtractEnquiryInput) => Promise<ExtractEnquiryResult>
  readonly resolveWhatsApp?: ResolveChannel
  readonly resolveEmail?: ResolveChannel
  /** The pauses between send attempts — the real backoff, or none in a test. */
  readonly sendDelays?: readonly number[]
}

export interface IntakeTurnResult {
  readonly outcome: 'not_due' | 'nothing_new' | 'decided' | 'retry'
  readonly decision?: IntakeDecision
  readonly modelCalled?: boolean
  readonly missing?: readonly string[]
  readonly replyMessageId?: string | null
  readonly sendError?: string | null
}

/**
 * Every conversation whose turn is due, one at a time.
 *
 * In sequence, because each turn is a model call and a send and none of them
 * is urgent to the second; a slow provider costs the batch latency, never a
 * customer a duplicate.
 */
export async function runIntakeTurns(
  asOf = new Date(),
  deps: IntakeTurnDeps = {},
): Promise<{ due: number; decided: number; replies: number }> {
  const due = await withActor(systemActor(), (tx) =>
    tx
      .select({ id: intakeConversations.id })
      .from(intakeConversations)
      .where(
        and(
          isNotNull(intakeConversations.turnDueAt),
          lte(intakeConversations.turnDueAt, asOf),
          sql`(${intakeConversations.claimedUntil} is null or ${intakeConversations.claimedUntil} < ${asOf})`,
        ),
      )
      .orderBy(asc(intakeConversations.turnDueAt))
      .limit(SWEEP_BATCH),
  )

  let decided = 0
  let replies = 0
  const started = Date.now()
  for (const { id } of due) {
    try {
      // Each turn on the clock as it is when the turn starts: a batch of slow
      // model calls would otherwise hand the tenth conversation a lease that
      // had already run out. Measured as time elapsed, so a test's fixed clock
      // still drives it.
      const result = await runIntakeTurn(id, advanced(asOf, started), deps)
      if (result.outcome === 'decided') decided += 1
      if (result.replyMessageId) replies += 1
    } catch (error) {
      // One conversation's failure is that conversation's: its lease expires
      // and the next sweep tries again; the rest of the batch runs.
      console.error(
        { conversationId: id, error: error instanceof Error ? error.message : String(error) },
        'intake turn failed; the lease will expire and the turn retry',
      )
    }
  }
  return { due: due.length, decided, replies }
}

interface Claim {
  readonly token: string
  /** The due time the claim was taken against — moved since means new messages. */
  readonly due: Date
  readonly pendingSince: Date | null
}

/** Take the turn, or learn that somebody else has it or it is not due. */
async function claim(conversationId: string, asOf: Date): Promise<Claim | null> {
  return withActor(systemActor(), async (tx) => {
    const [row] = await tx
      .select({
        turnDueAt: intakeConversations.turnDueAt,
        pendingSince: intakeConversations.pendingSince,
      })
      .from(intakeConversations)
      .where(
        and(
          eq(intakeConversations.id, conversationId),
          lte(intakeConversations.turnDueAt, asOf),
          sql`(${intakeConversations.claimedUntil} is null or ${intakeConversations.claimedUntil} < ${asOf})`,
        ),
      )
      .for('update', { skipLocked: true })
    if (!row?.turnDueAt) return null

    const token = randomUUID()
    /*
      `pending_since` is cleared as the turn starts, not as it ends: a message
      that lands while the model is thinking then restarts the clock from its
      own arrival, and finalising can tell "nothing arrived" (due unchanged)
      from "something did" (due moved) without a timestamp race.
    */
    await tx
      .update(intakeConversations)
      .set({
        claimedUntil: new Date(asOf.getTime() + LEASE_SECONDS * 1000),
        claimToken: token,
        pendingSince: null,
        updatedAt: asOf,
      })
      .where(eq(intakeConversations.id, conversationId))
    return { token, due: row.turnDueAt, pendingSince: row.pendingSince }
  })
}

interface CustomerMessage {
  readonly id: string
  readonly body: string
  readonly subject: string | null
  readonly sentAt: Date
  readonly externalRef: string | null
}

interface Loaded {
  readonly conversation: typeof intakeConversations.$inferSelect
  readonly enquiry: {
    reference: string
    status: string
    contactName: string | null
    notes: string | null
    firstRespondedAt: Date | null
  }
  readonly senderName: { en: string; ar: string }
  readonly customer: readonly CustomerMessage[]
  readonly unseen: readonly CustomerMessage[]
  readonly machine: readonly boolean[]
  /** Unread messages carrying a PDF or an image — substantive whatever the words say. */
  readonly withDocuments: ReadonlySet<string>
  readonly humanActiveAt: Date | null
  readonly senderGuard: string | null
  readonly recentRetries: number
}

/**
 * Run one conversation's turn, if it is due and nobody else holds it.
 *
 * Exported for the tests, which drive it with a fake clock and a fake model;
 * the sweep above is the production caller.
 */
export async function runIntakeTurn(
  conversationId: string,
  asOf = new Date(),
  deps: IntakeTurnDeps = {},
): Promise<IntakeTurnResult> {
  const started = Date.now()
  const held = await claim(conversationId, asOf)
  if (!held) return { outcome: 'not_due' }

  const loaded = await load(conversationId, asOf)
  if (!loaded || loaded.unseen.length === 0) {
    // Woken with nothing to read — a message counted by an earlier turn, or a
    // duplicate wake-up. No turn is recorded for an empty look.
    await release(conversationId, held, asOf, null)
    return { outcome: 'nothing_new' }
  }

  const { conversation, enquiry, unseen, customer } = loaded
  const settings = await withActor(systemActor(), (tx) =>
    loadIntakeSettings(tx, conversation.branchId),
  )
  const locale = detectLanguage(
    customer.map((m) => m.body),
    (conversation.locale as IntakeLocale | null) ?? null,
  )
  /*
    A mail whose body is "see attached" or nothing at all, with a packing list
    on it, is the most substantive message of the conversation; the marker keeps
    it out of chit-chat so the model is asked to read the document.
  */
  const newContent = classifyNewContent(
    unseen.map((m) => (loaded.withDocuments.has(m.id) ? `${m.body}\n[attachment]` : m.body)),
    loaded.machine,
  )
  const agentEnabled = conversation.agentEnabled && settings.enabled
  const enquiryOpen = OPEN_STATUSES.has(enquiry.status)

  /*
    The one model call, unless reading is worthless or abuse: a switched-off
    agent, a closed enquiry, nothing substantive (chit-chat, an auto-responder),
    or a sender tripping a loop breaker cost nothing; `silencedBeforeReading`
    holds the list. An operator who took over still reads: the reply is
    silenced below, but the coordinator fills the enquiry from the proposals.
  */
  let invocationId: string | null = null
  let modelCalled = false
  let modelFailure: IntakeReason | null = null
  const silenced = silencedBeforeReading({
    agentEnabled,
    enquiryOpen,
    newContent,
    senderGuard: loaded.senderGuard,
  })
  if (silenced === null) {
    const extract = deps.extract ?? ((input: ExtractEnquiryInput) => extractEnquiry(input))
    try {
      modelCalled = true
      const result = await extract({
        enquiryId: conversation.enquiryId,
        branchId: conversation.branchId,
        source: transcript(enquiry.reference, conversation.channel, customer),
        // Only what no earlier turn read: an attachment already read has
        // proposed what it says.
        attachmentMessageIds: unseen.filter((m) => loaded.withDocuments.has(m.id)).map((m) => m.id),
      })
      invocationId = result.invocationId ?? null
    } catch (error) {
      const code = (error as { code?: string }).code
      const settled = code === 'ai.not_configured' || code === 'ai.budget_exhausted'
      /*
        The same split the extraction workers make (Operations_Findings §11,
        OP-31): no model and no budget are settled, so the turn is decided on
        what is already known and stays silent; anything else is "ask again
        shortly", a bounded number of times, recorded as a turn so the screen
        shows the agent retrying rather than ignoring a customer.
      */
      if (!settled && loaded.recentRetries + 1 < MODEL_ATTEMPTS) {
        await recordRetry(conversation, held, asOf, loaded.recentRetries, error)
        return { outcome: 'retry', modelCalled }
      }
      modelFailure = 'model_unavailable'
      console.info(
        {
          conversationId,
          error: error instanceof Error ? error.message : String(error),
        },
        'intake turn: model unavailable, deciding on what is already known',
      )
    }
  }

  const completeness = await assess(conversation)

  const decided = decideIntakeReply({
    now: asOf,
    agentEnabled,
    enquiryOpen,
    newContent,
    completeness,
    alreadyReady: conversation.readyAt !== null,
    handedOff: conversation.handedOffAt !== null,
    clarificationsSent: conversation.clarifications,
    lastClarifiedAt: conversation.lastClarifiedAt,
    humanActiveAt: loaded.humanActiveAt,
    senderGuard: loaded.senderGuard,
    settings,
  })
  /*
    A model that was needed and could not be had silences a reply that would
    have been built on half an understanding — asking a customer for the origin
    they gave in the message nobody could read is worse than waiting for a
    person. The ready flag is not raised on it either.
  */
  const decision: IntakeDecision =
    modelFailure && (decided.action === 'clarify' || decided.action === 'confirm')
      ? { action: 'none', reason: modelFailure, markReady: false }
      : decided

  const missingKeys = completeness.missing.map((r) => r.key)
  const finalised = await finalise({
    conversation,
    held,
    asOf,
    decision,
    humanActiveAt: loaded.humanActiveAt,
    completeness,
    locale,
    unseen,
    invocationId,
    modelCalled,
    reference: enquiry.reference,
  })
  if (!finalised) return { outcome: 'not_due' } // the lease was lost; another worker owns it
  const { turnId, decision: final } = finalised

  let replyMessageId: string | null = null
  let sendError: string | null = null
  if (final.action === 'confirm' || final.action === 'clarify') {
    const sent = await sendReply({
      conversation,
      enquiry,
      senderName: loaded.senderName,
      locale,
      eventKey: final.action === 'confirm' ? 'intake.confirm' : 'intake.clarify',
      missing: missingPhrase(completeness.missing, locale),
      inReplyTo: [...customer].reverse().find((m) => m.externalRef)?.externalRef ?? null,
      // The reply is stamped when it goes, not when the turn began: the
      // instant-reply loop breaker measures the customer's answer against it,
      // and the model call in between is seconds long.
      asOf: advanced(asOf, started),
      turnId,
      deps,
    })
    replyMessageId = sent.messageId
    sendError = sent.error
  }

  return {
    outcome: 'decided',
    decision: final,
    modelCalled,
    missing: missingKeys,
    replyMessageId,
    sendError,
  }
}

/** Everything a turn reads, in one transaction. */
async function load(conversationId: string, asOf: Date): Promise<Loaded | null> {
  return withActor(systemActor(), async (tx) => {
    const [conversation] = await tx
      .select()
      .from(intakeConversations)
      .where(eq(intakeConversations.id, conversationId))
      .limit(1)
    if (!conversation) return null

    const [enquiry] = await tx
      .select({
        reference: enquiries.reference,
        status: enquiries.status,
        contactName: enquiries.contactName,
        notes: enquiries.notes,
        firstRespondedAt: enquiries.firstRespondedAt,
        legalNameEn: branches.legalNameEn,
        legalNameAr: branches.legalNameAr,
      })
      .from(enquiries)
      .innerJoin(branches, eq(branches.id, enquiries.branchId))
      .where(eq(enquiries.id, conversation.enquiryId))
      .limit(1)
    if (!enquiry) return null

    const inbound = await tx
      .select({
        id: messages.id,
        body: messages.body,
        subject: messages.subject,
        sentAt: messages.sentAt,
        createdAt: messages.createdAt,
        fromAddress: messages.fromAddress,
        externalRef: messages.externalRef,
      })
      .from(messages)
      .where(and(eq(messages.enquiryId, conversation.enquiryId), eq(messages.direction, 'inbound')))
      .orderBy(asc(messages.sentAt), asc(messages.createdAt))

    // A colleague's mail on the thread is not the customer talking.
    const staff = await staffAddresses(
      tx,
      inbound.map((m) => m.fromAddress ?? ''),
    )
    const customer: CustomerMessage[] = inbound
      .filter((m) => !staff.has((m.fromAddress ?? '').toLowerCase()))
      .map((m) => ({
        id: m.id,
        body: m.body,
        subject: m.subject,
        sentAt: m.sentAt ?? m.createdAt,
        externalRef: m.externalRef,
      }))

    const turns = await tx
      .select({ messageIds: intakeTurns.messageIds, reason: intakeTurns.reason })
      .from(intakeTurns)
      .where(eq(intakeTurns.conversationId, conversationId))
      .orderBy(desc(intakeTurns.createdAt))
    const seen = new Set(turns.flatMap((t) => t.messageIds ?? []))
    const unseen = customer.filter((m) => !seen.has(m.id))

    const documents =
      unseen.length === 0
        ? []
        : await tx
            .select({ messageId: messageAttachments.messageId })
            .from(messageAttachments)
            .innerJoin(assets, eq(assets.id, messageAttachments.assetId))
            .where(
              and(
                inArray(
                  messageAttachments.messageId,
                  unseen.map((m) => m.id),
                ),
                inArray(assets.contentType, [
                  'application/pdf',
                  'image/jpeg',
                  'image/png',
                  'image/webp',
                ]),
              ),
            )
    const withDocuments = new Set(documents.map((d) => d.messageId))

    let recentRetries = 0
    for (const turn of turns) {
      if (turn.reason !== 'model_retry') break
      recentRetries += 1
    }

    // What we last said to this sender, for the instant-reply rule.
    const [lastOurs] = await tx
      .select({ sentAt: messages.sentAt })
      .from(messages)
      .where(
        and(
          eq(messages.enquiryId, conversation.enquiryId),
          eq(messages.direction, 'outbound'),
          eq(messages.authorId, SYSTEM_PRINCIPAL_ID),
        ),
      )
      .orderBy(desc(messages.sentAt))
      .limit(1)

    const earlier = customer.filter((m) => seen.has(m.id)).map((m) => m.body.trim())
    const machine = unseen.map((m, i) => {
      const body = m.body.trim()
      // The same words twice, from the same sender, is a template answering.
      const repeated =
        body.length >= 12 &&
        (earlier.includes(body) || unseen.slice(0, i).some((u) => u.body.trim() === body))
      const instant =
        lastOurs?.sentAt != null &&
        m.sentAt.getTime() >= lastOurs.sentAt.getTime() &&
        m.sentAt.getTime() - lastOurs.sentAt.getTime() < INSTANT_REPLY_SECONDS * 1000
      return repeated || instant
    })

    /*
      A person on this conversation: a staff member's mail on the thread, an
      outbound message a person wrote, or "Mark replied" on the enquiry — a
      coordinator saying they have answered by phone or from their own inbox.
    */
    const staffOutboundAt = await staffOutboundAtFor(tx, conversation.enquiryId)
    const staffInbound = inbound
      .filter((m) => staff.has((m.fromAddress ?? '').toLowerCase()))
      .map((m) => m.sentAt ?? m.createdAt)
    const humanActiveAt = latest([
      conversation.lastStaffActivityAt,
      staffOutboundAt,
      enquiry.firstRespondedAt,
      ...staffInbound,
    ])

    const senderGuard = await senderGuardFor(tx, conversation, asOf)

    return {
      conversation,
      enquiry,
      senderName: { en: enquiry.legalNameEn, ar: enquiry.legalNameAr },
      customer,
      unseen,
      machine,
      withDocuments,
      humanActiveAt,
      senderGuard,
      recentRetries,
    }
  })
}

/**
 * The sender-level loop breakers, or null when the agent may write.
 *
 * Across every enquiry from this sender on this branch, because a loop does not
 * stay on one: each turn of the 195-enquiry incident was a fresh enquiry that
 * every per-enquiry guard saw as new.
 */
async function senderGuardFor(
  tx: Tx,
  conversation: typeof intakeConversations.$inferSelect,
  asOf: Date,
): Promise<string | null> {
  if (isNoReplyAddress(conversation.customerAddress)) return 'no-reply address'

  const daySince = new Date(asOf.getTime() - 24 * 60 * 60 * 1000)
  const [ours] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(messages)
    .where(
      and(
        eq(messages.branchId, conversation.branchId),
        eq(messages.direction, 'outbound'),
        eq(messages.authorId, SYSTEM_PRINCIPAL_ID),
        sql`${messages.toAddresses} @> ${JSON.stringify([conversation.customerAddress])}::jsonb`,
        gte(messages.sentAt, daySince),
      ),
    )
  /*
    Replies that did not go count as well as replies that did.

    A failed send stores no outbound message (there is nothing on the thread to
    show), so counting messages alone let an agent whose every reply bounced off
    the provider, a WhatsApp 422 outside the 24-hour window, try again on every
    turn of every enquiry this sender opened: a loop the cap exists to stop,
    invisible to it. The attempt is on the turn instead, with its `send_error`,
    and stamped with the turn's clock so the window reads the same time the
    messages above do.
  */
  const [failedSends] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(intakeTurns)
    .innerJoin(intakeConversations, eq(intakeConversations.id, intakeTurns.conversationId))
    .where(
      and(
        eq(intakeConversations.branchId, conversation.branchId),
        eq(intakeConversations.customerAddress, conversation.customerAddress),
        inArray(intakeTurns.action, ['confirm', 'clarify']),
        isNull(intakeTurns.replyMessageId),
        isNotNull(intakeTurns.sendError),
        gte(intakeTurns.createdAt, daySince),
      ),
    )
  if ((ours?.count ?? 0) + (failedSends?.count ?? 0) >= SENDER_DAILY_CAP) {
    return `${SENDER_DAILY_CAP} agent messages or failed attempts to this sender in 24h`
  }

  const burstSince = new Date(asOf.getTime() - BURST_MINUTES * 60 * 1000)
  const [burst] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(messages)
    .where(
      and(
        eq(messages.branchId, conversation.branchId),
        eq(messages.direction, 'inbound'),
        eq(messages.fromAddress, conversation.customerAddress),
        gte(messages.sentAt, burstSince),
        lte(messages.sentAt, asOf),
      ),
    )
  if ((burst?.count ?? 0) > INTAKE_BURST_LIMIT) {
    return `more than ${INTAKE_BURST_LIMIT} messages in ${BURST_MINUTES} minutes`
  }
  return null
}

/** The active internal principals among these addresses, lowercased. */
async function staffAddresses(tx: Tx, addresses: readonly string[]): Promise<Set<string>> {
  const wanted = [
    ...new Set(addresses.map((a) => a.trim().toLowerCase()).filter((a) => a.includes('@'))),
  ]
  if (wanted.length === 0) return new Set()
  const rows = await tx
    .select({ email: principals.email })
    .from(principals)
    .where(
      and(
        inArray(sql`lower(${principals.email})`, wanted),
        eq(principals.type, 'internal'),
        eq(principals.isActive, true),
      ),
    )
  return new Set(rows.map((r) => r.email.toLowerCase()))
}

/**
 * What the enquiry knows now, after this turn's proposals, against its branch's
 * requirements.
 *
 * A fact is known if the column holds it or a proposal the customer's words
 * produced is open or applied. A *rejected* proposal is a coordinator saying
 * "not that", and does not count — the agent may then ask again.
 */
async function assess(
  conversation: typeof intakeConversations.$inferSelect,
): Promise<Completeness> {
  return withActor(systemActor(), async (tx) => {
    const requirements = await loadIntakeRequirements(tx, conversation.branchId)
    const [row] = await tx
      .select({
        mode: enquiries.mode,
        originId: enquiries.originId,
        destinationId: enquiries.destinationId,
        commodityId: enquiries.commodityId,
        incoterm: enquiries.incoterm,
        readyOn: enquiries.readyOn,
        grossWeightKg: enquiries.grossWeightKg,
        volumeCbm: enquiries.volumeCbm,
        pieces: enquiries.pieces,
        containerCount: enquiries.containerCount,
        containerType: enquiries.containerType,
        dimensions: enquiries.dimensions,
      })
      .from(enquiries)
      .where(eq(enquiries.id, conversation.enquiryId))
      .limit(1)

    const proposals = await tx
      .select({ field: extractionProposals.field, value: extractionProposals.value })
      .from(extractionProposals)
      .where(
        and(
          eq(extractionProposals.targetTable, 'enquiries'),
          eq(extractionProposals.targetId, conversation.enquiryId),
          inArray(extractionProposals.status, ['proposed', 'applied']),
        ),
      )
      .orderBy(asc(extractionProposals.createdAt))
    const proposed = new Map<string, string>()
    for (const p of proposals) proposed.set(p.field, String(p.value ?? ''))

    const text = (v: unknown): string | null =>
      v === null || v === undefined ? null : typeof v === 'string' ? v : JSON.stringify(v)
    const pick = (column: unknown, field: string): string | null =>
      text(column) ?? proposed.get(field) ?? null

    const known: KnownFacts = {
      mode: pick(row?.mode, 'mode'),
      origin: pick(row?.originId, 'origin'),
      destination: pick(row?.destinationId, 'destination'),
      commodity: pick(row?.commodityId, 'commodity'),
      incoterm: pick(row?.incoterm, 'incoterm'),
      readyOn: pick(row?.readyOn, 'readyOn'),
      grossWeightKg: pick(row?.grossWeightKg, 'grossWeightKg'),
      volumeCbm: pick(row?.volumeCbm, 'volumeCbm'),
      pieces: pick(row?.pieces, 'pieces'),
      containerCount: pick(row?.containerCount, 'containerCount'),
      containerType: pick(row?.containerType, 'containerType'),
      dimensions: pick(row?.dimensions, 'dimensions'),
    }
    return evaluateCompleteness(known, requirements)
  })
}

/**
 * Record the turn and move the conversation, under the lease — or nothing.
 *
 * Returns the turn's id, or null when the claim token no longer matches: the
 * lease expired mid-turn and another worker took the conversation over, so
 * this one writes nothing and sends nothing.
 */
async function finalise(input: {
  conversation: typeof intakeConversations.$inferSelect
  held: Claim
  asOf: Date
  decision: IntakeDecision
  /** The latest sign of a person on the conversation when the turn loaded it. */
  humanActiveAt: Date | null
  completeness: Completeness
  locale: IntakeLocale
  unseen: readonly CustomerMessage[]
  invocationId: string | null
  modelCalled: boolean
  reference: string
}): Promise<{ turnId: string; decision: IntakeDecision } | null> {
  const { conversation, held, asOf, completeness } = input
  return withActor(systemActor(), async (tx) => {
    const [current] = await tx
      .select({
        claimToken: intakeConversations.claimToken,
        turnDueAt: intakeConversations.turnDueAt,
        pendingSince: intakeConversations.pendingSince,
        agentEnabled: intakeConversations.agentEnabled,
        lastStaffActivityAt: intakeConversations.lastStaffActivityAt,
      })
      .from(intakeConversations)
      .where(eq(intakeConversations.id, conversation.id))
      .for('update')
    if (!current || current.claimToken !== held.token) return null

    /*
      The decision was taken before the model call, which is seconds long. A
      coordinator who switched the agent off, or answered the customer, in those
      seconds has the last word: the reply is withdrawn and the turn records why.
    */
    let decision = input.decision
    if (decision.action === 'confirm' || decision.action === 'clarify') {
      const settings = await loadIntakeSettings(tx, conversation.branchId)
      const humanNow = await latestStaffActivity(tx, conversation, current.lastStaffActivityAt)
      if (!current.agentEnabled || !settings.enabled) {
        decision = { action: 'none', reason: 'agent_off', markReady: decision.markReady }
      } else if (humanNow && (!input.humanActiveAt || humanNow > input.humanActiveAt)) {
        decision = { action: 'none', reason: 'human_active', markReady: decision.markReady }
      }
    }

    const [turn] = await tx
      .insert(intakeTurns)
      .values({
        branchId: conversation.branchId,
        conversationId: conversation.id,
        enquiryId: conversation.enquiryId,
        action: decision.action,
        reason: decision.reason,
        missing: completeness.missing.map((r) => r.key),
        messageIds: input.unseen.map((m) => m.id),
        locale: input.locale,
        invocationId: input.invocationId,
        // On the turn's clock, which the sender cap's 24-hour window reads.
        createdAt: asOf,
      })
      .returning({ id: intakeTurns.id })

    const ready = conversation.readyAt ?? (decision.markReady ? asOf : null)
    const state =
      ready && completeness.complete
        ? 'complete'
        : decision.action === 'handoff' || conversation.handedOffAt
          ? 'handed_off'
          : decision.action === 'clarify'
            ? 'awaiting_customer'
            : conversation.state === 'complete' && !completeness.complete
              ? 'collecting'
              : conversation.state
    const moved = current.turnDueAt?.getTime() !== held.due.getTime()

    await tx
      .update(intakeConversations)
      .set({
        state,
        locale: input.locale,
        turns: sql`${intakeConversations.turns} + 1`,
        modelCalls: input.modelCalled
          ? sql`${intakeConversations.modelCalls} + 1`
          : intakeConversations.modelCalls,
        clarifications:
          decision.action === 'clarify'
            ? sql`${intakeConversations.clarifications} + 1`
            : intakeConversations.clarifications,
        lastClarifiedAt: decision.action === 'clarify' ? asOf : conversation.lastClarifiedAt,
        readyAt: ready,
        handedOffAt: decision.action === 'handoff' ? asOf : conversation.handedOffAt,
        lastTurnAt: asOf,
        claimedUntil: null,
        claimToken: null,
        // A message that arrived mid-turn moved the due time; leave its turn be.
        turnDueAt: moved ? current.turnDueAt : null,
        pendingSince: moved ? current.pendingSince : null,
        updatedAt: asOf,
      })
      .where(eq(intakeConversations.id, conversation.id))

    if (decision.action === 'handoff') {
      /*
        The desk is told on the internal channel, in both languages — the
        dispatcher picks each reader's. Raised once: `handed_off_at` is set in
        this same statement and a handed-off conversation never hands off again.
      */
      await tx.insert(notificationOutbox).values({
        branchId: conversation.branchId,
        eventKey: 'intake.handoff',
        enquiryId: conversation.enquiryId,
        payload: {
          reference: input.reference,
          missing: missingPhrase(completeness.missing, 'en'),
          missingAr: missingPhrase(completeness.missing, 'ar'),
        },
      })
    }

    return { turnId: turn!.id, decision }
  })
}

/** The last message a person sent the customer on this enquiry, if any. */
async function staffOutboundAtFor(tx: Tx, enquiryId: string): Promise<Date | null> {
  const [row] = await tx
    .select({ at: sql<Date | null>`max(${messages.sentAt})` })
    .from(messages)
    .where(
      and(
        eq(messages.enquiryId, enquiryId),
        eq(messages.direction, 'outbound'),
        // A person in the product (their own id), or outside it — their
        // phone or the Kapso inbox, echoed back and marked `staff_authored`.
        sql`(${messages.staffAuthored} or (${messages.authorId} is not null and ${messages.authorId} <> ${SYSTEM_PRINCIPAL_ID}))`,
      ),
    )
  return row?.at ? new Date(row.at) : null
}

/** A person's latest mark on the conversation, read again under the finalise lock. */
async function latestStaffActivity(
  tx: Tx,
  conversation: typeof intakeConversations.$inferSelect,
  lastStaffActivityAt: Date | null,
): Promise<Date | null> {
  return latest([lastStaffActivityAt, await staffOutboundAtFor(tx, conversation.enquiryId)])
}

/** The clock moved on by the real time spent since `started`. */
function advanced(asOf: Date, started: number): Date {
  return new Date(asOf.getTime() + Math.max(0, Date.now() - started))
}

/** Let go of a turn that had nothing to do — or reschedule one that will retry. */
async function release(
  conversationId: string,
  held: Claim,
  asOf: Date,
  retryAt: Date | null,
): Promise<void> {
  await withActor(systemActor(), async (tx) => {
    const [current] = await tx
      .select({
        claimToken: intakeConversations.claimToken,
        turnDueAt: intakeConversations.turnDueAt,
        pendingSince: intakeConversations.pendingSince,
      })
      .from(intakeConversations)
      .where(eq(intakeConversations.id, conversationId))
      .for('update')
    if (!current || current.claimToken !== held.token) return
    const moved = current.turnDueAt?.getTime() !== held.due.getTime()
    await tx
      .update(intakeConversations)
      .set({
        claimedUntil: null,
        claimToken: null,
        turnDueAt: moved ? current.turnDueAt : retryAt,
        pendingSince: moved ? current.pendingSince : retryAt ? held.pendingSince : null,
        updatedAt: asOf,
      })
      .where(eq(intakeConversations.id, conversationId))
  })
}

/**
 * A transient model failure: recorded as a turn that read nothing, and the
 * conversation rescheduled with a backoff. The messages stay unread, so the
 * next attempt reads them; after `MODEL_ATTEMPTS` the turn is decided silent.
 */
async function recordRetry(
  conversation: typeof intakeConversations.$inferSelect,
  held: Claim,
  asOf: Date,
  attempts: number,
  error: unknown,
): Promise<void> {
  await withActor(systemActor(), async (tx) => {
    await tx.insert(intakeTurns).values({
      branchId: conversation.branchId,
      conversationId: conversation.id,
      enquiryId: conversation.enquiryId,
      action: 'none',
      reason: 'model_retry',
      messageIds: [],
      // The same clock as a decided turn, so the two order correctly.
      createdAt: asOf,
      sendError: error instanceof Error ? error.message.slice(0, 500) : String(error),
    })
  })
  await release(conversation.id, held, asOf, new Date(asOf.getTime() + 60_000 * 2 ** attempts))
}

/**
 * Render the template for the customer's language and channel, send it on the
 * channel they wrote on, and file it as an outbound message.
 *
 * Best-effort in the way the acknowledgement always was: the turn is already
 * recorded, so a failed send is written on the turn (`send_error`) for the
 * screen, and is not retried — a clarification that arrives an hour late,
 * after the customer has written again, is a worse message than none. It still
 * spends the caps: the turn already counted the clarification or raised the
 * ready flag, and `senderGuardFor` counts the failed attempt as a message.
 */
async function sendReply(input: {
  conversation: typeof intakeConversations.$inferSelect
  enquiry: Loaded['enquiry']
  senderName: { en: string; ar: string }
  locale: IntakeLocale
  eventKey: 'intake.confirm' | 'intake.clarify'
  missing: string
  inReplyTo: string | null
  asOf: Date
  turnId: string
  deps: IntakeTurnDeps
}): Promise<{ messageId: string | null; error: string | null }> {
  const { conversation, locale, asOf } = input
  const channelKey = conversation.channel === 'whatsapp' ? 'whatsapp' : 'email'

  const fail = async (error: string): Promise<{ messageId: null; error: string }> => {
    await withActor(systemActor(), (tx) =>
      tx
        .update(intakeTurns)
        .set({ sendError: error, updatedAt: asOf })
        .where(eq(intakeTurns.id, input.turnId)),
    )
    console.info({ conversationId: conversation.id, error }, 'intake turn: reply not sent')
    return { messageId: null, error }
  }

  const template = await withActor(systemActor(), (tx) =>
    resolveTemplate(tx, input.eventKey, channelKey, locale, conversation.branchId),
  )
  if (!template) return fail(`no ${input.eventKey} template for ${channelKey}/${locale}`)

  const payload = {
    reference: input.enquiry.reference,
    missing: input.missing,
    recipientName: input.enquiry.contactName ?? '',
    senderName: locale === 'ar' ? input.senderName.ar : input.senderName.en,
  }
  const body = renderTemplate(template.body, payload)
  /*
    An email reply keeps the customer's own subject, "Re:"-prefixed, so it sits
    in the thread they started; the template's subject is for a mail that opens
    a thread, which this never is when the customer wrote first.
  */
  const original = input.enquiry.notes?.trim()
  const subject =
    channelKey === 'email' && original
      ? /^re:/i.test(original)
        ? original
        : `Re: ${original}`
      : renderTemplate(template.subject ?? '', payload)

  const resolve =
    channelKey === 'whatsapp'
      ? (input.deps.resolveWhatsApp ?? resolveWhatsAppChannel)
      : (input.deps.resolveEmail ?? (() => resolveEmailChannel((o, m) => console.info(o, m))))
  const channel = await resolve()
  if (!channel) return fail(`${channelKey} is not switched on for this deployment`)

  const inReplyTo =
    channelKey === 'email' && input.inReplyTo
      ? input.inReplyTo.startsWith('<')
        ? input.inReplyTo
        : `<${input.inReplyTo}>`
      : undefined

  const sent = await sendWithRetry(
    channel,
    {
      to: conversation.customerAddress,
      from: conversation.businessAddress,
      subject,
      body,
      locale,
      ...(inReplyTo ? { inReplyTo } : {}),
    },
    input.deps.sendDelays,
  )
  if (!sent.accepted) {
    return fail(
      `not sent after ${sent.attempts} attempt(s): ${sent.error ?? 'the provider refused the message'}`,
    )
  }

  const fromAddress =
    channelKey === 'whatsapp'
      ? await whatsAppSenderNumber(conversation.businessAddress)
      : conversation.businessAddress
  const messageId = await withActor(systemActor(), async (tx) => {
    const [row] = await tx
      .insert(messages)
      .values({
        branchId: conversation.branchId,
        enquiryId: conversation.enquiryId,
        channel: channelKey,
        direction: 'outbound',
        subject: channelKey === 'email' ? subject : null,
        body,
        // The office's number as the customer sees it (the provider id stays on
        // the conversation, where the next send needs it); the mailbox for email.
        fromAddress,
        toAddresses: [conversation.customerAddress],
        ccAddresses: [],
        // The system principal marks it as the agent's — a person's reply has
        // their own id here, and that difference is the human-takeover rule.
        authorId: SYSTEM_PRINCIPAL_ID,
        externalRef: sent.externalRef ?? null,
        customerVisible: true,
        sentAt: asOf,
      })
      .returning({ id: messages.id })
    await tx
      .update(intakeTurns)
      .set({ replyMessageId: row!.id, updatedAt: asOf })
      .where(eq(intakeTurns.id, input.turnId))
    return row!.id
  })
  return { messageId, error: null }
}

/**
 * The branch's wording first, the default row second, the seeded constant last
 * — the dispatcher's order (`resolveTemplate` there), plus a floor: a
 * deployment that never re-ran the seed after this shipped still says
 * something sensible rather than nothing.
 */
async function resolveTemplate(
  tx: Tx,
  eventKey: string,
  channel: 'whatsapp' | 'email',
  locale: IntakeLocale,
  branchId: string,
): Promise<{ subject: string | null; body: string } | null> {
  const rows = await tx
    .select({
      subject: notificationTemplates.subject,
      body: notificationTemplates.body,
      branchId: notificationTemplates.branchId,
    })
    .from(notificationTemplates)
    .where(
      and(
        eq(notificationTemplates.eventKey, eventKey),
        eq(notificationTemplates.channel, channel),
        eq(notificationTemplates.locale, locale),
        eq(notificationTemplates.isActive, true),
      ),
    )
  const row = rows.find((r) => r.branchId === branchId) ?? rows.find((r) => r.branchId === null)
  if (row) return row
  const seeded = NOTIFICATION_TEMPLATES.find(
    (t) => t.eventKey === eventKey && t.channel === channel && t.locale === locale,
  )
  return seeded ? { subject: seeded.subject, body: seeded.body } : null
}

/**
 * Every customer message so far, oldest first, as one text for one model call.
 *
 * Quoted history is cut from each email — a reply chain carries every earlier
 * message again, and reading it twice costs money and invites the model to
 * count a fact twice. When the whole is too long the *oldest* messages go,
 * because a later message is the one that corrects an earlier one.
 */
export function transcript(
  reference: string,
  channel: string,
  customer: readonly Pick<CustomerMessage, 'body' | 'subject'>[],
): string {
  const header =
    channel === 'whatsapp'
      ? `Enquiry ${reference}: a WhatsApp conversation. The customer's messages, oldest first.`
      : `Enquiry ${reference}: an email thread. The customer's messages, oldest first.`
  const parts = customer.map((m, i) => {
    const body = withoutQuotedHistory(m.body).trim()
    const subject = channel === 'email' && m.subject ? `Subject: ${m.subject}\n` : ''
    return `[${i + 1}] ${subject}${body}`
  })
  let kept = parts
  while (kept.length > 1 && kept.join('\n\n').length > MAX_TRANSCRIPT_CHARS) kept = kept.slice(1)
  const text = kept.join('\n\n')
  const capped = text.length > MAX_TRANSCRIPT_CHARS ? text.slice(-MAX_TRANSCRIPT_CHARS) : text
  return `${header}\n\n${kept.length < parts.length ? '[earlier messages omitted]\n\n' : ''}${capped}`
}

/** An email body without the earlier messages it quotes beneath itself. */
export function withoutQuotedHistory(body: string): string {
  const lines = body.split(/\r?\n/)
  const out: string[] = []
  for (const line of lines) {
    if (/^\s*>/.test(line)) continue
    if (/^On .{4,200} wrote:\s*$/.test(line.trim())) break
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(line.trim())) break
    if (/^From: .+/.test(line.trim()) && out.length > 0) break
    out.push(line)
  }
  return out.join('\n')
}

function latest(dates: readonly (Date | null | undefined)[]): Date | null {
  let best: Date | null = null
  for (const d of dates) if (d && (!best || d.getTime() > best.getTime())) best = d
  return best
}
