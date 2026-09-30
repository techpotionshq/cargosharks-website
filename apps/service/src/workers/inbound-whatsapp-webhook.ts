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
 * — under Kapso's `X-Idempotency-Key` — and enqueued in one transaction, so a
 * redelivery is a no-op and a crash cannot leave a recorded-but-unqueued event.
 * This worker passes that receipt to `ingestMessage` rather than claiming a
 * second one.
 *
 * ## An unreadable payload is reported, not retried
 *
 * The same rule the email worker keeps: the same bytes are just as unreadable
 * five attempts later, so a payload we cannot parse — or a business number we
 * hold no `whatsapp_numbers` row for — is recorded on the receipt and skipped,
 * a row somebody can find, rather than thrown into pg-boss's backoff.
 */

import { and, eq } from 'drizzle-orm'
import {
  branches,
  enquiries,
  inboundWebhookEvents,
  systemActor,
  whatsappNumbers,
  withActor,
} from '@qabandi/db'
import type { InboundMessage, NotificationChannel } from '../ports/index'
import { resolveWhatsAppChannel } from '../adapters/index'
import { ingestMessage, type BranchRef, type EnqueueExtraction } from './inbound-mail'

/** How the ack resolves a channel — the real resolver, or a test's stand-in. */
export type ResolveWhatsAppChannel = () => Promise<NotificationChannel | null>

export interface InboundWhatsAppWebhookInput {
  /** `inbound_webhook_events.id`, as queued by `/webhooks/whatsapp`. */
  readonly eventId: string
}

export interface InboundWhatsAppWebhookResult {
  readonly outcome: 'created' | 'threaded' | 'duplicate' | 'ignored' | 'skipped' | 'rate_reply'
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

  let message: InboundMessage
  try {
    message = toWhatsAppInboundMessage(event.payload as Record<string, unknown>, asOf)
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

  const handled = await ingestMessage(message, branch, asOf, enqueue, { id: event.id })

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
    The loop that scarred the email path (Operations_Findings §11) cannot form
    here: our reply is a `whatsapp.message.sent`, which the webhook route drops,
    and even a misrouted echo is refused by the parser as outbound.
  */
  if (handled.outcome === 'created' && handled.enquiryId) {
    await acknowledge(message, handled.enquiryId, resolveChannel).catch(() => {
      // Swallowed by design; the enquiry stands with or without the reply.
    })
  }

  return { outcome: handled.outcome, enquiryId: handled.enquiryId }
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
  resolveChannel: ResolveWhatsAppChannel,
): Promise<void> {
  const channel = await resolveChannel()
  if (!channel) return // WhatsApp is off; the enquiry is filed, just not greeted.

  const [row] = await withActor(systemActor(), async (tx) =>
    tx
      .select({ reference: enquiries.reference })
      .from(enquiries)
      .where(eq(enquiries.id, enquiryId))
      .limit(1),
  )
  if (!row?.reference) return

  await channel.send({
    to: message.from,
    // The business number that received it — the branch's own, from the receipt.
    from: message.mailbox,
    body: acknowledgementBody(row.reference),
    locale: 'en',
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

/** Records why a receipt was not turned into anything, without failing the job. */
async function note(id: string, reason: string, asOf: Date): Promise<void> {
  await withActor(systemActor(), async (tx) => {
    await tx
      .update(inboundWebhookEvents)
      .set({ error: reason, updatedAt: asOf })
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
    // WhatsApp has no bounce loop the way email does; a machine does not write in.
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
