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
 * To the customer, and to nobody else. The intake conversation names the thread
 * when there is one (the channel, the customer's address, and the business
 * number or mailbox they wrote to); an enquiry the agent never held is read off
 * the latest message on the *customer's side* of its thread. "Latest inbound"
 * is not that: an agent's rate reply to our RFQ is filed on the enquiry it
 * prices, and a reply once took its sender for the customer and sent a selling
 * price to the agent who had quoted the buy (NEW-1). Which side each message is
 * on, and the check that refuses an address we know as a partner's, a
 * colleague's, another customer's or our own, is `loadEnquiryThread` and
 * `customerReplyTarget` in `@qabandi/db`, the rule the panel shows too. The web
 * posts only the words; the recipient is decided here, every time. When nobody
 * on the thread may be answered the reply is refused (`not_customer`), never
 * sent to the nearest address.
 *
 * An email reply keeps the customer's subject, "Re:"-prefixed, and carries
 * `In-Reply-To` their last message (theirs, never the agent's), so their client
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

import { eq, sql } from 'drizzle-orm'
import { isWhatsAppWindowClosed } from '@qabandi/core'
import {
  customerReplyTarget,
  enquiries,
  intakeConversations,
  loadEnquiryThread,
  mailboxes,
  messages,
  systemActor,
  whatsappNumbers,
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
  | 'not_customer'
  | 'channel_off'
  | 'whatsapp_window'
  | 'send_failed'

export type EnquiryReplyResult =
  | { readonly ok: true; readonly messageId: string; readonly channel: 'whatsapp' | 'email' }
  | { readonly ok: false; readonly code: EnquiryReplyRefusal; readonly detail?: string }

/*
  Meta's 24-hour refusal, in every shape Kapso has returned it (NEW-2), is read
  by one rule in core so the intake panel reads it the same way.
*/
export { isWhatsAppWindowClosed } from '@qabandi/core'

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

  /*
    The branch's own mailboxes and WhatsApp numbers, read as the system: their
    policies show them only to whoever may edit them, and a coordinator
    answering a customer needs the address the customer wrote to, not the
    settings screen. Read only for a branch the actor's own view has just shown
    an enquiry in, and only to tell the office's own messages apart from the
    customer's (and to know which mailbox the customer wrote to).
  */
  const branch = await withActor(input.actor, async (tx) => {
    const [row] = await tx
      .select({ branchId: enquiries.branchId })
      .from(enquiries)
      .where(eq(enquiries.id, input.enquiryId))
      .limit(1)
    return row ?? null
  })
  // Invisible under RLS is not-found, never forbidden (FR-ID-04).
  if (!branch) return { ok: false, code: 'not_found' }

  const ownAddresses = await withActor(systemActor(), async (tx) => {
    const boxes = await tx
      .select({ username: mailboxes.username })
      .from(mailboxes)
      .where(eq(mailboxes.branchId, branch.branchId))
    const numbers = await tx
      .select({ id: whatsappNumbers.phoneNumberId, display: whatsappNumbers.displayNumber })
      .from(whatsappNumbers)
      .where(eq(whatsappNumbers.branchId, branch.branchId))
    return [
      ...boxes.map((m) => m.username),
      ...numbers.flatMap((n) => (n.display ? [n.id, n.display] : [n.id])),
    ]
  })

  const thread = await withActor(input.actor, (tx) =>
    loadEnquiryThread(tx, input.enquiryId, { ownAddresses }),
  )
  if (!thread) return { ok: false, code: 'not_found' }

  const target = customerReplyTarget(thread)
  if ('refused' in target) return { ok: false, code: target.refused }

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
    /*
      The provider's words are logged here and travel to the web only as
      `detail` for its log: the screen says the code's sentence in the
      reader's language and never prints a provider's JSON (NEW-2).
    */
    console.warn(
      { enquiryId: thread.enquiry.id, channel: target.channel, detail },
      'enquiry reply: provider refused',
    )
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
        branchId: thread.enquiry.branchId,
        enquiryId: thread.enquiry.id,
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
        .where(eq(intakeConversations.enquiryId, thread.enquiry.id))
    }

    await tx
      .update(enquiries)
      .set({ firstRespondedAt: sql`coalesce(${enquiries.firstRespondedAt}, ${asOf})` })
      .where(eq(enquiries.id, thread.enquiry.id))

    return row!.id
  })

  return { ok: true, messageId, channel: target.channel }
}
