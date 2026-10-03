/**
 * The WhatsApp half of the inbound intake — FR-EQ-02, §9 "WhatsApp — inbound".
 *
 * The exact mirror of `inbound-email-webhook.ts`, one channel over. `/webhooks/
 * whatsapp` has verified Kapso's signature, recorded a receipt and queued a job;
 * this is the half that turns that receipt into an enquiry. Everything about
 * *what becomes an enquiry* — attribution, threading, the SLA clock, the
 * acknowledgement, the AI enrichment enqueued after the commit — is
 * `ingestMessage`, shared with the email path and already tested against a real
 * database. Writing any of it twice is how the two channels start disagreeing
 * about whose message belongs to whom.
 *
 * ## Two things differ from email, and only two
 *
 *  1. **The branch is resolved by number, not by address.** An email names its
 *     branch by the mailbox it was delivered to (`mailboxes`); a WhatsApp
 *     message names it by the business `phone_number_id` Kapso puts on every
 *     delivery (`whatsapp_numbers`). Both end at a `BranchRef` handed to the same
 *     `ingestMessage`.
 *
 *  2. **The sender is a phone number, matched to a customer by phone.** That
 *     branch lives inside `ingestMessage` (`matchCustomer`), keyed off
 *     `InboundMessage.channel`, which this worker stamps `'whatsapp'`.
 *
 * ## The receipt is claimed by the route, not here
 *
 * As with email: `/webhooks/whatsapp` inserted the `inbound_webhook_events` row
 * — under Kapso's `X-Idempotency-Key` — and then queued this job. A redelivery
 * of a processed receipt is a no-op; of an unprocessed one it re-queues, and
 * `inbound-redrive.ts` sweeps any left behind. This worker passes that receipt
 * to `ingestMessage` rather than claiming a second one.
 *
 * ## An unreadable payload is reported, not retried
 *
 * The same rule the email worker keeps: the same bytes are just as unreadable
 * five attempts later, so a payload we cannot parse — or a business number we
 * hold no `whatsapp_numbers` row for — is recorded on the receipt and skipped,
 * a row somebody can find, rather than thrown into pg-boss's backoff.
 */

import { and, eq, gte, lte, sql } from 'drizzle-orm'
import {
  branches,
  enquiries,
  inboundWebhookEvents,
  intakeConversations,
  messages,
  systemActor,
  SYSTEM_PRINCIPAL_ID,
  whatsappNumbers,
  withActor,
} from '@qabandi/db'
import type { InboundMessage, NotificationChannel } from '../ports/index'
import {
  resolveWhatsAppChannel,
  resolveWhatsAppMedia,
  type WhatsAppMediaRef,
  type WhatsAppMediaSource,
} from '../adapters/index'
import { sendWithRetry } from './send-retry'
import {
  ingestMessage,
  type BranchRef,
  type EnqueueExtraction,
  type EnqueueRateExtract,
  type NudgeIntakeTurn,
} from './inbound-mail'

/** How the ack resolves a channel — the real resolver, or a test's stand-in. */
export type ResolveWhatsAppChannel = () => Promise<NotificationChannel | null>

export interface InboundWhatsAppWebhookInput {
  /** `inbound_webhook_events.id`, as queued by `/webhooks/whatsapp`. */
  readonly eventId: string
}

export interface InboundWhatsAppWebhookResult {
  readonly outcome:
    | 'created'
    | 'threaded'
    | 'duplicate'
    | 'ignored'
    | 'skipped'
    | 'rate_reply'
    | 'filed'
    /** A message the business sent from outside the product, filed as a staff reply. */
    | 'staff_reply'
  readonly enquiryId?: string | null
  /** Why nothing happened, where nothing did. */
  readonly reason?: string
}

/**
 * Turn one recorded Kapso receipt into an enquiry or a threaded message.
 */
export async function runInboundWhatsAppWebhook(
  input: InboundWhatsAppWebhookInput,
  asOf = new Date(),
  enqueue?: EnqueueExtraction,
  resolveChannel: ResolveWhatsAppChannel = resolveWhatsAppChannel,
  nudge?: NudgeIntakeTurn,
  /** The pauses between acknowledgement attempts — the real backoff, or none in a test. */
  sendDelays?: readonly number[],
  /** Where media bytes come from — Kapso's media call, or a test's local mock. */
  resolveMedia: () => Promise<WhatsAppMediaSource | null> = resolveWhatsAppMedia,
  /** Where a partner's WhatsApp rate reply is queued for reading: pg-boss, or a test's list. */
  rfqEnqueue?: EnqueueRateExtract,
): Promise<InboundWhatsAppWebhookResult> {
  const [event] = await withActor(systemActor(), async (tx) =>
    tx
      .select({
        id: inboundWebhookEvents.id,
        payload: inboundWebhookEvents.payload,
        processedAt: inboundWebhookEvents.processedAt,
      })
      .from(inboundWebhookEvents)
      .where(eq(inboundWebhookEvents.id, input.eventId))
      .limit(1),
  )

  if (!event) return { outcome: 'skipped', reason: 'receipt_not_found' }
  if (event.processedAt) return { outcome: 'duplicate', reason: 'already_processed' }

  /*
    The business's own outbound message, echoed — a coordinator writing from
    their phone or the Kapso inbox. Not an enquiry, and not to be ignored
    either: it is the clearest sign a person is talking to this customer.
  */
  const payload = event.payload as Record<string, unknown>
  if (isOutboundEcho(payload)) return fileStaffEcho(event.id, payload, asOf)

  let message: InboundMessage
  try {
    message = toWhatsAppInboundMessage(payload, asOf)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    await note(event.id, reason, asOf)
    return { outcome: 'skipped', reason }
  }

  const branch = await resolveWhatsAppBranch(message.mailbox)
  if (!branch) {
    /*
      No active `whatsapp_numbers` row matches the business number this message
      arrived on — the exact parallel of email's "no mailbox for this address".
      Recorded and skipped rather than thrown: a webhook can be posted for any
      number at all, and retrying a configuration decision five times a day
      forever is noise. Add the number at Settings › WhatsApp numbers.
    */
    const reason =
      `No active WhatsApp number is configured for phone_number_id ${message.mailbox}, so ` +
      'there is no branch to file its message under. Add it at Settings › WhatsApp numbers.'
    await note(event.id, reason, asOf)
    return { outcome: 'skipped', reason }
  }

  /*
    The picture or the PDF, fetched before the message is filed so it is stored
    as the message's attachment and read with the conversation — a photographed
    packing list is often the whole enquiry. Best-effort: a media call that
    fails files the message with its "[WhatsApp image]" note and no file, which
    is where this intake was before it fetched anything.
  */
  const ref = whatsAppMediaRef(payload)
  if (ref) {
    try {
      const source = await resolveMedia()
      const media = source ? await source.fetch(ref) : null
      if (media) {
        message = {
          ...message,
          attachments: [
            { filename: media.filename, contentType: media.contentType, content: media.content },
          ],
        }
      }
    } catch (error) {
      console.error(
        { eventId: event.id, error: error instanceof Error ? error.message : String(error) },
        'inbound whatsapp: media not fetched; the message is filed without it',
      )
    }
  }

  const handled = await ingestMessage(
    message,
    branch,
    asOf,
    enqueue,
    { id: event.id },
    undefined,
    rfqEnqueue,
    nudge,
  )

  /*
    Acknowledge on the same channel — FR-NT-01, the WhatsApp shape of it.

    An emailed enquiry's acknowledgement goes through the dispatcher to the
    sender's on-file email; a WhatsApp enquiry's goes straight back to the number
    that wrote in, from the number it wrote to. Same-channel is both more correct
    (a WhatsApp customer may have no email) and safer than routing an email-shaped
    dispatcher at a phone number.

    Only on a freshly *created* enquiry — a threaded reply or a duplicate is not
    a new conversation to greet — and best-effort: a failed reply must never fail
    the intake, because the enquiry is already filed and its SLA clock running.

    This is a path that replies to the sender of inbound mail, so it needs a loop
    breaker before anything else (Operations_Findings §11). Our own echo is not
    the risk — the route drops `whatsapp.message.sent` and the parser refuses an
    outbound message. The risk is another company's auto-responder answering our
    acknowledgement with a message of its own, which carries no header saying a
    machine wrote it. Three locks, in order: the sender's follow-ups thread onto
    their open enquiry (`findOpenConversation`), so a reply opens nothing new; a
    sender is acknowledged at most once per window; and a sender writing faster
    than a person types is not acknowledged at all. See `acknowledgementRefused`.
  */
  /*
    Not when the intake agent holds the conversation (`handled.intake`): it
    answers once the customer has finished typing — with what is still missing,
    or with "we have everything" — and an acknowledgement two minutes earlier is
    exactly the reply-to-every-message it replaces.
  */
  if (handled.outcome === 'created' && handled.enquiryId && !handled.intake) {
    await acknowledge(
      message,
      handled.enquiryId,
      branch,
      resolveChannel,
      asOf,
      event.id,
      sendDelays,
    ).catch((error: unknown) => {
      // Swallowed by design; the enquiry stands with or without the reply.
      console.error(
        {
          enquiryId: handled.enquiryId,
          error: error instanceof Error ? error.message : String(error),
        },
        'inbound whatsapp: acknowledgement not sent',
      )
    })
  }

  return { outcome: handled.outcome, enquiryId: handled.enquiryId }
}

/** A sender is acknowledged at most once in this many hours. */
export const ACK_WINDOW_HOURS = 24
/** More inbound messages than this from one sender inside `BURST_MINUTES`... */
export const BURST_LIMIT = 5
/** ...and the sender is treated as a machine and not acknowledged. */
export const BURST_MINUTES = 10

/**
 * Why this sender must not be acknowledged, or null when they may be.
 *
 * Both rules are about the *sender*, across every enquiry, because a loop does
 * not stay on one: each turn of the 195-enquiry incident was a fresh enquiry
 * that every per-enquiry guard saw as new.
 */
async function acknowledgementRefused(
  message: InboundMessage,
  branch: BranchRef,
  asOf: Date,
): Promise<string | null> {
  return withActor(systemActor(), async (tx) => {
    const ackSince = new Date(asOf.getTime() - ACK_WINDOW_HOURS * 60 * 60 * 1000)
    const [recentAck] = await tx
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.branchId, branch.id),
          eq(messages.channel, 'whatsapp'),
          eq(messages.direction, 'outbound'),
          sql`${messages.toAddresses} @> ${JSON.stringify([message.from])}::jsonb`,
          gte(messages.sentAt, ackSince),
          lte(messages.sentAt, asOf),
        ),
      )
      .limit(1)
    if (recentAck) return `already acknowledged within ${ACK_WINDOW_HOURS}h`

    const burstSince = new Date(message.receivedAt.getTime() - BURST_MINUTES * 60 * 1000)
    const [burst] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(
        and(
          eq(messages.branchId, branch.id),
          eq(messages.channel, 'whatsapp'),
          eq(messages.direction, 'inbound'),
          eq(messages.fromAddress, message.from),
          gte(messages.sentAt, burstSince),
          lte(messages.sentAt, message.receivedAt),
        ),
      )
    if ((burst?.count ?? 0) > BURST_LIMIT) {
      return `more than ${BURST_LIMIT} messages in ${BURST_MINUTES} minutes`
    }
    return null
  })
}

/**
 * Reply "received, your reference is …" to the sender, if WhatsApp is switched on.
 *
 * Bilingual in one message, because the sender's language is not known at intake
 * — a first WhatsApp message carries no locale, and guessing wrong is worse than
 * showing both. The reference is what a customer quotes back, exactly as the
 * emailed acknowledgement gives them one.
 */
async function acknowledge(
  message: InboundMessage,
  enquiryId: string,
  branch: BranchRef,
  resolveChannel: ResolveWhatsAppChannel,
  asOf: Date,
  eventId: string,
  sendDelays?: readonly number[],
): Promise<void> {
  const channel = await resolveChannel()
  if (!channel) return // WhatsApp is off; the enquiry is filed, just not greeted.

  const refused = await acknowledgementRefused(message, branch, asOf)
  if (refused) {
    console.info({ enquiryId, reason: refused }, 'inbound whatsapp: acknowledgement withheld')
    return
  }

  const [row] = await withActor(systemActor(), async (tx) =>
    tx
      .select({ reference: enquiries.reference })
      .from(enquiries)
      .where(eq(enquiries.id, enquiryId))
      .limit(1),
  )
  if (!row?.reference) return

  const body = acknowledgementBody(row.reference)
  const sent = await sendWithRetry(
    channel,
    {
      to: message.from,
      // The business number that received it — the branch's own, from the receipt.
      from: message.mailbox,
      body,
      locale: 'en',
    },
    sendDelays,
  )
  if (!sent.accepted) {
    /*
      Recorded, not only logged: on the receipt, where "why was this customer
      never greeted" is looked for, beside the intake that did succeed. The
      enquiry stands; the acknowledgement is what failed.
    */
    const reason =
      `acknowledgement not sent after ${sent.attempts} attempt(s): ` +
      (sent.error ?? 'the provider refused the message')
    console.error({ enquiryId, eventId, reason }, 'inbound whatsapp: acknowledgement failed')
    await withActor(systemActor(), (tx) =>
      tx
        .update(inboundWebhookEvents)
        .set({ error: reason.slice(0, 1000), updatedAt: asOf })
        .where(eq(inboundWebhookEvents.id, eventId)),
    )
    return
  }

  /*
    The acknowledgement goes on the thread as an outbound message, with the
    wamid Kapso returned.

    It used to leave no row. A customer who long-pressed it and replied quoted a
    message we had no record of, so the reply could not thread by
    `inReplyTo`; and the once-per-window rule above has nothing to count without
    it. The thread is also simply more honest with it — the coordinator sees
    what the customer was told.
  */
  const senderNumber = await whatsAppSenderNumber(message.mailbox)
  await withActor(systemActor(), async (tx) => {
    await tx.insert(messages).values({
      branchId: branch.id,
      enquiryId,
      channel: 'whatsapp',
      direction: 'outbound',
      body,
      // The number the customer sees, not the provider's id for it.
      fromAddress: senderNumber,
      toAddresses: [message.from],
      ccAddresses: [],
      externalRef: sent.externalRef ?? null,
      customerVisible: true,
      // A machine wrote it — the system principal, so a staff reply (a person's
      // id, or `staff_authored`) is never confused with it.
      authorId: SYSTEM_PRINCIPAL_ID,
      sentAt: asOf,
    })
  })
}

/** The acknowledgement text — Arabic then English, personalised with the reference. */
function acknowledgementBody(reference: string): string {
  return (
    `مرحبًا، لقد استلمنا طلبك. رقمك المرجعي هو ${reference}. ` +
    'سنعود إليك بعرض السعر قريبًا.\n\n' +
    `Hi — we've received your enquiry. Your reference is ${reference}. ` +
    "We'll come back to you with a quote shortly."
  )
}

/**
 * The business `phone_number_id` -> the branch that answers on it.
 *
 * One row, not the whole map the email path builds: an email poll resolves every
 * mailbox once per run, but a webhook is one message on one number, so this looks
 * up the one it needs. `is_active` and the unique constraint on `phone_number_id`
 * mean this is at most one row.
 */
async function resolveWhatsAppBranch(phoneNumberId: string): Promise<BranchRef | null> {
  const [row] = await withActor(systemActor(), async (tx) =>
    tx
      .select({ id: branches.id, code: branches.code })
      .from(whatsappNumbers)
      .innerJoin(branches, eq(branches.id, whatsappNumbers.branchId))
      .where(
        and(eq(whatsappNumbers.phoneNumberId, phoneNumberId), eq(whatsappNumbers.isActive, true)),
      )
      .limit(1),
  )
  return row ?? null
}

/**
 * Records why a receipt was not turned into anything, without failing the job.
 *
 * And settles it: `processed_at` is stamped beside the reason, as the
 * automatic-mail path does. The re-drive sweep (`inbound-redrive.ts`) queues
 * every receipt left unprocessed, and these are decisions, not faults — the
 * same payload is just as unreadable, and the same number just as unconfigured,
 * on the next attempt.
 */
async function note(id: string, reason: string, asOf: Date): Promise<void> {
  await withActor(systemActor(), async (tx) => {
    await tx
      .update(inboundWebhookEvents)
      .set({ error: reason, processedAt: asOf, updatedAt: asOf })
      .where(eq(inboundWebhookEvents.id, id))
  })
}

/**
 * Kapso's `whatsapp.message.received` body, read into the shape both channels
 * speak — the WhatsApp counterpart of email's `toInboundMessage`.
 *
 * Exported for its own tests: this is the only function in the file with
 * branches worth pinning, and pinning them needs no database. The payload shape
 * is Kapso's platform webhook (documented at docs.kapso.ai; snake_case, already
 * normalised out of Meta's Graph envelope), *not* the raw Meta payload — so
 * there is nothing to un-nest and no `normalizeWebhook` to call.
 */
export function toWhatsAppInboundMessage(
  payload: Record<string, unknown>,
  asOf: Date,
): InboundMessage {
  /*
    Buffering must stay off (it is off by default). A batched delivery is a
    different shape — {type, batch:true, data:[...]} — and rather than half-read
    it here, we refuse with a reason a person can act on: one message per event.
  */
  if (payload.batch === true) {
    throw new Error(
      'This Kapso webhook is batched. Turn message buffering off for ' +
        'whatsapp.message.received — the intake reads one message per delivery.',
    )
  }

  const message = obj(payload.message)
  if (!message) {
    throw new Error(
      'The Kapso receipt carries no `message`. Keys seen: ' +
        Object.keys(payload).slice(0, 20).join(', '),
    )
  }

  const kapso = obj(message.kapso) ?? {}
  // Defensive: the route subscribes to `whatsapp.message.received` only, but a
  // misconfigured webhook could forward an outbound echo. An echo is not an
  // enquiry, and filing one would put our own words on the board as a customer's.
  if (str(kapso.direction) === 'outbound') {
    throw new Error('This is an outbound message echo, not an inbound enquiry; ignoring.')
  }

  const conversation = obj(payload.conversation) ?? {}

  /*
    The business number that received it. Top-level `phone_number_id` first
    (Kapso puts it there and on the conversation), because that is what a
    `whatsapp_numbers` row is keyed on and therefore what names the branch.
  */
  const phoneNumberId = str(payload.phone_number_id) || str(conversation.phone_number_id)
  if (phoneNumberId === '') {
    throw new Error('The Kapso receipt names no phone_number_id, so no branch can own it.')
  }

  // The sender. A phone where WhatsApp still exposes one; otherwise the number on
  // the conversation, then the business-scoped user id — because a message can
  // arrive with no phone at all once the sender adopts a username.
  const from =
    str(message.from) ||
    str(conversation.phone_number) ||
    str(message.from_user_id) ||
    str(conversation.business_scoped_user_id) ||
    str(message.username) ||
    str(conversation.username)
  if (from === '') {
    throw new Error('The Kapso receipt names no sender, so its message cannot be attributed.')
  }

  const wamid = str(message.id)
  if (wamid === '') {
    // The wamid is what a later reply threads onto and what stops a re-file. The
    // receipt's own idempotency is Kapso's X-Idempotency-Key (on the route), so
    // this is about threading, not dedup — but a message with no id can do
    // neither, and refusing says so once.
    throw new Error('The Kapso message carries no id, so it cannot be threaded or de-duplicated.')
  }

  const body = whatsAppBody(message, kapso)

  return {
    externalId: wamid,
    channel: 'whatsapp',
    // `mailbox` carries the business number here — the branch key, matched
    // against `whatsapp_numbers` rather than `mailboxes`. See `InboundMessage`.
    mailbox: phoneNumberId,
    from,
    fromName: str(conversation.contact_name) || undefined,
    to: [phoneNumberId],
    cc: [],
    /*
      WhatsApp has no subject. The board still needs a headline it can triage on,
      so the first line of the message becomes one — the same role the email
      subject plays in `createEnquiry`. A media-only message has no words, so it
      falls back to naming what arrived.
    */
    subject: whatsAppSubject(body),
    body,
    receivedAt: whatsAppTimestamp(message.timestamp, asOf),
    // A reply to one of our messages carries the quoted message's id; that lets
    // `findTarget` thread it onto the enquiry we sent, exactly as In-Reply-To does.
    inReplyTo: str(obj(message.context)?.id) || undefined,
    references: [],
    // Media (has_media) is not fetched in this cut — Kapso serves the bytes on a
    // second, authenticated call. The words are captured; the attachment is noted
    // in the body so nothing is silently lost, and pulling the file is a follow-on.
    attachments: [],
    /*
      WhatsApp carries no `Auto-Submitted` or null return path, so nothing here
      can say a machine wrote this — and machines do write in: another
      company's auto-responder answers our acknowledgement like any customer.
      The loop breakers are therefore the worker's, not the parser's: threading
      onto the sender's open enquiry, one acknowledgement per sender per window,
      and none to a sender writing in a burst.
    */
    automatic: false,
  }
}

/** The message text — the text body, Kapso's flattened `content`, or a media note. */
function whatsAppBody(message: Record<string, unknown>, kapso: Record<string, unknown>): string {
  const text = str(obj(message.text)?.body) || str(kapso.content)
  if (text.trim() !== '') return text

  // Caption on an image/document/video, where there is one.
  for (const key of ['image', 'document', 'video', 'audio', 'sticker'] as const) {
    const media = obj(message[key])
    if (media) {
      const caption = str(media.caption)
      const filename = str(media.filename)
      const label = filename ? `${key}: ${filename}` : key
      return caption.trim() !== '' ? `[${label}]\n${caption}` : `[WhatsApp ${label}]`
    }
  }

  const type = str(message.type)
  return type && type !== 'text' ? `[WhatsApp ${type} message]` : '[WhatsApp message]'
}

/** A headline for the board: the first non-empty line, trimmed to a sane length. */
function whatsAppSubject(body: string): string {
  const firstLine = body
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '')
  if (!firstLine) return 'WhatsApp enquiry'
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine
}

/**
 * WhatsApp timestamps are unix seconds as a string. A missing or unparseable one
 * costs the SLA clock a few seconds, not an enquiry — the same trade email makes.
 */
function whatsAppTimestamp(value: unknown, fallback: Date): Date {
  const seconds = Number(str(value))
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback
  return new Date(seconds * 1000)
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

const obj = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined

/**
 * Whether a receipt is the business's own outbound message — Kapso's
 * `whatsapp.message.sent` echo, or any delivery whose message says it went out.
 */
export function isOutboundEcho(payload: Record<string, unknown>): boolean {
  const message = obj(payload.message)
  if (!message) return false
  const kapso = obj(message.kapso) ?? {}
  return str(kapso.direction) === 'outbound' || str(payload.type) === 'whatsapp.message.sent'
}

/** An echo this new may be our own send whose row is not written yet. */
const ECHO_SETTLE_SECONDS = 30

/**
 * File a message the business sent from outside the product as a staff reply.
 *
 * Kapso echoes every outbound message — ours as well as a coordinator's — so
 * the first question is whose it is. Ours carries a wamid we already hold on an
 * outbound row (the agent's reply, the acknowledgement), or the same words we
 * sent this customer minutes ago; that echo is settled with nothing written.
 * An echo that arrives before our own row could exist is thrown back to the
 * queue to try again in a moment, rather than guessed at: calling the agent's
 * own reply a staff reply would silence the agent for half a day.
 *
 * Anything else a person wrote. It is filed as an outbound message marked
 * `staff_authored` on the customer's most recent enquiry, and that enquiry's
 * intake conversation records staff activity — so the agent stays silent while
 * a person has the conversation, exactly as for a reply written in the product.
 */
async function fileStaffEcho(
  eventId: string,
  payload: Record<string, unknown>,
  asOf: Date,
): Promise<InboundWhatsAppWebhookResult> {
  const message = obj(payload.message) ?? {}
  const conversation = obj(payload.conversation) ?? {}
  const wamid = str(message.id)
  const phoneNumberId = str(payload.phone_number_id) || str(conversation.phone_number_id)
  const customer = str(message.to) || str(conversation.phone_number)
  const body = whatsAppBody(message, obj(message.kapso) ?? {})
  const sentAt = whatsAppTimestamp(message.timestamp, asOf)

  if (!wamid || !customer || !phoneNumberId) {
    const reason = 'outbound echo with no message id, recipient or business number; nothing to file'
    await note(eventId, reason, asOf)
    return { outcome: 'skipped', reason }
  }
  const branch = await resolveWhatsAppBranch(phoneNumberId)
  if (!branch) {
    const reason = `outbound echo on phone_number_id ${phoneNumberId}, which no branch answers on`
    await note(eventId, reason, asOf)
    return { outcome: 'skipped', reason }
  }

  const ours = await withActor(systemActor(), async (tx) => {
    const [byId] = await tx
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.externalRef, wamid), eq(messages.direction, 'outbound')))
      .limit(1)
    if (byId) return true
    const since = new Date(sentAt.getTime() - 10 * 60 * 1000)
    const [byText] = await tx
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.branchId, branch.id),
          eq(messages.channel, 'whatsapp'),
          eq(messages.direction, 'outbound'),
          eq(messages.authorId, SYSTEM_PRINCIPAL_ID),
          eq(messages.body, body),
          sql`${messages.toAddresses} @> ${JSON.stringify([customer])}::jsonb`,
          gte(messages.sentAt, since),
        ),
      )
      .limit(1)
    return Boolean(byText)
  })
  if (ours) {
    await note(eventId, 'echo of a message this system sent; nothing to file', asOf)
    return { outcome: 'ignored', reason: 'own_echo' }
  }
  if (asOf.getTime() - sentAt.getTime() < ECHO_SETTLE_SECONDS * 1000) {
    // Thrown, not noted: pg-boss retries in thirty seconds, by when our own
    // send — if this is one — has written the row that identifies it.
    throw new Error('outbound echo too recent to tell from our own send; retrying')
  }

  const senderNumber = await whatsAppSenderNumber(phoneNumberId)
  const enquiryId = await withActor(systemActor(), async (tx) => {
    const [latest] = await tx
      .select({ enquiryId: messages.enquiryId })
      .from(messages)
      .where(
        and(
          eq(messages.branchId, branch.id),
          eq(messages.channel, 'whatsapp'),
          eq(messages.direction, 'inbound'),
          eq(messages.fromAddress, customer),
          sql`${messages.enquiryId} is not null`,
        ),
      )
      .orderBy(sql`${messages.sentAt} desc`)
      .limit(1)
    const target = latest?.enquiryId ?? null

    await tx.insert(messages).values({
      branchId: branch.id,
      enquiryId: target,
      channel: 'whatsapp',
      direction: 'outbound',
      body,
      fromAddress: senderNumber,
      toAddresses: [customer],
      ccAddresses: [],
      externalRef: wamid,
      // A person, outside the product: no principal to name, so the flag says it.
      staffAuthored: true,
      customerVisible: true,
      sentAt,
    })
    if (target) {
      await tx
        .update(intakeConversations)
        .set({ lastStaffActivityAt: sentAt, updatedAt: asOf })
        .where(eq(intakeConversations.enquiryId, target))
    }
    await tx
      .update(inboundWebhookEvents)
      .set({
        processedAt: asOf,
        error: target ? null : 'staff reply filed on no enquiry: the customer has none open',
        updatedAt: asOf,
      })
      .where(eq(inboundWebhookEvents.id, eventId))
    return target
  })
  return { outcome: 'staff_reply', enquiryId }
}

/**
 * The media a message carries, by Meta's id — or null for a text message.
 *
 * Exported for its tests. The id is what Kapso's media call is asked for; a
 * `media_url` Kapso already resolved onto the payload is taken when present.
 */
export function whatsAppMediaRef(payload: Record<string, unknown>): WhatsAppMediaRef | null {
  const message = obj(payload.message)
  if (!message) return null
  const kapso = obj(message.kapso) ?? {}
  for (const kind of ['image', 'document', 'video', 'audio'] as const) {
    const media = obj(message[kind])
    if (!media) continue
    const id = str(media.id)
    const url = str(kapso.media_url) || str(obj(kapso.media_data)?.url) || null
    if (!id && !url) return null
    return {
      kind,
      id,
      mimeType: str(media.mime_type) || null,
      filename: str(media.filename) || null,
      url,
    }
  }
  return null
}

/**
 * The business number a WhatsApp message went out from, as a person reads it.
 *
 * Kapso addresses a send by `phone_number_id` — an opaque provider key — and
 * that is what the outbound rows used to store as their sender, so the thread
 * showed a customer a sixteen-digit id where the office's number belongs. The
 * id stays where it is needed (the send itself, and the conversation's
 * `business_address`); the row records `whatsapp_numbers.display_number`, and
 * falls back to the id only for a number nobody entered a display number for.
 */
export async function whatsAppSenderNumber(phoneNumberId: string): Promise<string> {
  const [row] = await withActor(systemActor(), (tx) =>
    tx
      .select({ displayNumber: whatsappNumbers.displayNumber })
      .from(whatsappNumbers)
      .where(eq(whatsappNumbers.phoneNumberId, phoneNumberId))
      .limit(1),
  )
  return row?.displayNumber?.trim() || phoneNumberId
}
