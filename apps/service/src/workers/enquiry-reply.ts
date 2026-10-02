/**
 * A coordinator answering the customer from the enquiry screen (D5).
 *
 * The web app holds no provider credential, by design: the Kapso key and the
 * mail relay's password live in `integration_settings`, sealed with a key only
 * this process has. So the reply box posts to `/internal/enquiries/:id/reply`
 * and this does the send, through the same channel adapters the intake agent
 * answers with (`resolveWhatsAppChannel`, `resolveEmailChannel`).
 *
 * ## Where the reply goes
 *
 * Back on the thread the customer opened. The intake conversation names it when
 * there is one (the channel, the customer's address, and the business number or
 * mailbox they wrote to); an enquiry the agent never held is read off its latest
 * inbound message instead. An email reply keeps the customer's subject,
 * "Re:"-prefixed, and carries `In-Reply-To` their last message, so their client
 * files it in the thread they started and their answer threads back here.
 *
 * ## What a sent reply writes
 *
 * Under the coordinator's own actor, so RLS and the audit trail treat it as
 * theirs:
 *
 *   - an outbound `messages` row with `author_id` the person, which is what the
 *     intake agent's human-takeover rule reads (`staffOutboundAtFor`): a person
 *     talking to the customer silences the bot for the branch's takeover window;
 *   - `last_staff_activity_at` on the conversation, the same signal stamped
 *     directly, as a reply from the coordinator's own phone stamps it;
 *   - `first_responded_at` on the enquiry if nothing stopped the SLA clock yet,
 *     because answering the customer is exactly the event that clock measures.
 *
 * A refused send writes nothing. There is no "failed" state on a message, and a
 * row for words the customer never received would be the thread lying; the web
 * keeps the text in the box and says why it did not go.
 *
 * ## WhatsApp's 24-hour window
 *
 * Meta accepts free text only within 24 hours of the customer's last message;
 * after that it refuses with error 131047 and only an approved template may
 * open the conversation again. That refusal is told apart from every other one
 * (`whatsapp_window`), so the screen can say "the customer must write first"
 * rather than "something went wrong".
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import {
  enquiries,
  intakeConversations,
  mailboxes,
  messages,
  systemActor,
  withActor,
  type Actor,
} from '@qabandi/db'
import { resolveEmailChannel, resolveWhatsAppChannel } from '../adapters/index'
import type { NotificationChannel } from '../ports/index'
import { sendWithRetry } from './send-retry'
import { whatsAppSenderNumber } from './inbound-whatsapp-webhook'

/** WhatsApp's own ceiling for a text message body, and a generous one for email. */
export const REPLY_MAX_CHARS = 4096

export interface EnquiryReplyDeps {
  readonly resolveWhatsApp?: () => Promise<NotificationChannel | null>
  readonly resolveEmail?: () => Promise<NotificationChannel | null>
  /** The pauses between send attempts; none in a test. */
  readonly sendDelays?: readonly number[]
}

export type EnquiryReplyRefusal =
  | 'not_found'
  | 'empty'
  | 'too_long'
  | 'no_thread'
  | 'channel_off'
  | 'whatsapp_window'
  | 'send_failed'

export type EnquiryReplyResult =
  | { readonly ok: true; readonly messageId: string; readonly channel: 'whatsapp' | 'email' }
  | { readonly ok: false; readonly code: EnquiryReplyRefusal; readonly detail?: string }

/**
 * Meta's "re-engagement" refusal: more than 24 hours since the customer wrote.
 * Matched on the error code Kapso passes through, and on Meta's words for it in
 * case a proxy reformats the body.
 */
export function isWhatsAppWindowClosed(error: string | undefined): boolean {
  if (!error) return false
  return /\b131047\b|re-?engagement|24 hours|customer service window/i.test(error)
}

interface Target {
  readonly channel: 'whatsapp' | 'email'
  readonly to: string
  readonly from: string | undefined
  readonly subject: string | undefined
  readonly inReplyTo: string | undefined
  readonly locale: 'en' | 'ar'
  readonly hasConversation: boolean
}

export async function sendEnquiryReply(
  input: {
    readonly actor: Actor
    readonly enquiryId: string
    readonly body: string
    readonly asOf?: Date
  },
  deps: EnquiryReplyDeps = {},
): Promise<EnquiryReplyResult> {
  const body = input.body.trim()
  if (body === '') return { ok: false, code: 'empty' }
  if (body.length > REPLY_MAX_CHARS) return { ok: false, code: 'too_long' }
  const asOf = input.asOf ?? new Date()

  const found = await withActor(input.actor, async (tx) => {
    const [enquiry] = await tx
      .select({ id: enquiries.id, branchId: enquiries.branchId, reference: enquiries.reference })
      .from(enquiries)
      .where(eq(enquiries.id, input.enquiryId))
      .limit(1)
    // Invisible under RLS is not-found, never forbidden (FR-ID-04).
    if (!enquiry) return null

    const [conversation] = await tx
      .select({
        channel: intakeConversations.channel,
        customerAddress: intakeConversations.customerAddress,
        businessAddress: intakeConversations.businessAddress,
        locale: intakeConversations.locale,
      })
      .from(intakeConversations)
      .where(eq(intakeConversations.enquiryId, enquiry.id))
      .limit(1)

    // The customer's latest message on each channel that can be answered.
    const inbound = await tx
      .select({
        channel: messages.channel,
        subject: messages.subject,
        fromAddress: messages.fromAddress,
        toAddresses: messages.toAddresses,
        externalRef: messages.externalRef,
      })
      .from(messages)
      .where(
        and(
          eq(messages.enquiryId, enquiry.id),
          eq(messages.direction, 'inbound'),
          inArray(messages.channel, ['whatsapp', 'email']),
        ),
      )
      .orderBy(desc(sql`coalesce(${messages.sentAt}, ${messages.createdAt})`))
      .limit(20)

    return { enquiry, conversation, inbound }
  })
  if (!found) return { ok: false, code: 'not_found' }

  /*
    The branch's mailbox addresses, read as the system: the policy on
    `mailboxes` shows them only to whoever may edit them, and a coordinator
    answering a customer needs the address the customer wrote to, not the
    settings screen. Only the usernames leave this query, for a branch the
    actor has already been shown an enquiry in.
  */
  const mailboxAddresses = (
    await withActor(systemActor(), (tx) =>
      tx
        .select({ username: mailboxes.username })
        .from(mailboxes)
        .where(eq(mailboxes.branchId, found.enquiry.branchId)),
    )
  ).map((m) => m.username.toLowerCase())

  const target = replyTarget({ ...found, mailboxAddresses })
  if (!target) return { ok: false, code: 'no_thread' }

  const resolve =
    target.channel === 'whatsapp'
      ? (deps.resolveWhatsApp ?? resolveWhatsAppChannel)
      : (deps.resolveEmail ?? (() => resolveEmailChannel((o, m) => console.info(o, m))))
  const channel = await resolve()
  if (!channel) return { ok: false, code: 'channel_off' }

  const sent = await sendWithRetry(
    channel,
    {
      to: target.to,
      from: target.from,
      subject: target.subject,
      body,
      locale: target.locale,
      ...(target.inReplyTo ? { inReplyTo: target.inReplyTo } : {}),
    },
    deps.sendDelays,
  )
  if (!sent.accepted) {
    const detail = (sent.error ?? 'the provider refused the message').slice(0, 300)
    if (target.channel === 'whatsapp' && isWhatsAppWindowClosed(sent.error)) {
      return { ok: false, code: 'whatsapp_window', detail }
    }
    return { ok: false, code: 'send_failed', detail }
  }

  // The office's number as the customer sees it, as the agent's replies record it.
  const fromAddress =
    target.channel === 'whatsapp' && target.from
      ? await whatsAppSenderNumber(target.from)
      : (target.from ?? null)

  const messageId = await withActor(input.actor, async (tx) => {
    const [row] = await tx
      .insert(messages)
      .values({
        branchId: found.enquiry.branchId,
        enquiryId: found.enquiry.id,
        channel: target.channel,
        direction: 'outbound',
        subject: target.channel === 'email' ? (target.subject ?? null) : null,
        body,
        fromAddress,
        toAddresses: [target.to],
        ccAddresses: [],
        // The person, not the system principal: this difference is the
        // human-takeover rule (`staffOutboundAtFor` in `intake-turn.ts`).
        authorId: input.actor.principalId,
        externalRef: sent.externalRef ?? null,
        customerVisible: true,
        sentAt: asOf,
      })
      .returning({ id: messages.id })

    if (target.hasConversation) {
      await tx
        .update(intakeConversations)
        .set({ lastStaffActivityAt: asOf, updatedAt: asOf })
        .where(eq(intakeConversations.enquiryId, found.enquiry.id))
    }

    await tx
      .update(enquiries)
      .set({ firstRespondedAt: sql`coalesce(${enquiries.firstRespondedAt}, ${asOf})` })
      .where(eq(enquiries.id, found.enquiry.id))

    return row!.id
  })

  return { ok: true, messageId, channel: target.channel }
}

/**
 * Who the reply goes to, from what, and how it threads.
 *
 * The conversation first, because it is the agent's own record of the thread
 * and names the business address the provider needs. Failing that, the latest
 * inbound message: its sender is the customer, and for WhatsApp its recipient
 * is the business `phone_number_id` (the intake stores it there). For email
 * the mailbox is whichever of the recipients is one of the branch's own;
 * failing that the relay's default sender answers.
 */
function replyTarget(found: {
  enquiry: { reference: string }
  conversation:
    | { channel: string; customerAddress: string; businessAddress: string; locale: string | null }
    | undefined
  inbound: readonly {
    channel: string
    subject: string | null
    fromAddress: string | null
    toAddresses: string[] | null
    externalRef: string | null
  }[]
  mailboxAddresses: readonly string[]
}): Target | null {
  const { conversation, inbound } = found
  const locale = conversation?.locale === 'ar' ? 'ar' : 'en'

  let channel: 'whatsapp' | 'email'
  let to: string | undefined
  let from: string | undefined
  if (conversation) {
    channel = conversation.channel === 'whatsapp' ? 'whatsapp' : 'email'
    to = conversation.customerAddress
    from = conversation.businessAddress
  } else {
    const latest = inbound[0]
    if (!latest?.fromAddress) return null
    channel = latest.channel === 'whatsapp' ? 'whatsapp' : 'email'
    to = latest.fromAddress
    const recipients = latest.toAddresses ?? []
    from =
      channel === 'whatsapp'
        ? recipients[0]
        : recipients.find((address) => found.mailboxAddresses.includes(address.toLowerCase()))
  }
  if (!to) return null
  // WhatsApp sends *from* a number the account owns; without it there is no send.
  if (channel === 'whatsapp' && !from) return null

  if (channel === 'whatsapp') {
    return {
      channel,
      to,
      from,
      subject: undefined,
      inReplyTo: undefined,
      locale,
      hasConversation: Boolean(conversation),
    }
  }

  const lastEmail = inbound.find((m) => m.channel === 'email')
  const original = inbound.find((m) => m.channel === 'email' && m.subject?.trim())?.subject?.trim()
  const subject = original
    ? /^re:/i.test(original)
      ? original
      : `Re: ${original}`
    : found.enquiry.reference
  const ref = lastEmail?.externalRef ?? undefined
  const inReplyTo = ref ? (ref.startsWith('<') ? ref : `<${ref}>`) : undefined
  return { channel, to, from, subject, inReplyTo, locale, hasConversation: Boolean(conversation) }
}
