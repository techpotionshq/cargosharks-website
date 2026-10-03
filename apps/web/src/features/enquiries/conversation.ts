import 'server-only'

/**
 * An enquiry's whole thread, for the conversation panel (D5).
 *
 * Everything on `messages` against the enquiry, inbound and outbound, oldest
 * first: the customer's own words, the agent's replies, a coordinator's answer
 * from this screen or from their own phone. The intake panel shows only what
 * the agent sent; a coordinator deciding whether to take over needs what the
 * customer said, which no screen showed before this.
 *
 * Where a reply would go is read here too, by the same rule the service sends
 * by (`workers/enquiry-reply.ts`): the intake conversation if there is one,
 * otherwise the latest inbound message. The panel offers the box only when
 * there is somewhere to send it.
 */

import { asc, desc, eq, inArray, sql } from 'drizzle-orm'
import {
  assets,
  enquiries,
  intakeConversations,
  messageAttachments,
  messages,
  principals,
  withActor,
  SYSTEM_PRINCIPAL_ID,
  type Actor,
} from '@qabandi/db'
import { usePilotFixtures } from '@/lib/pilot/source'
import { pilotEnquiryConversation } from '@/lib/pilot/fixtures'
import type { ConversationMessageLike, EnquiryConversationLike } from '@/lib/pilot/types'

/**
 * A thread longer than this shows its newest messages; the cap keeps one
 * runaway sender (`Operations_Findings.md` §11) from making the page enormous.
 */
const MAX_MESSAGES = 200

export async function enquiryConversation(
  actor: Actor,
  enquiryId: string,
  locale: 'en' | 'ar' = 'en',
): Promise<EnquiryConversationLike | null> {
  if (usePilotFixtures()) return pilotEnquiryConversation()
  if (!enquiryId) return null

  return withActor(actor, async (tx) => {
    const [enquiry] = await tx
      .select({ id: enquiries.id, branchId: enquiries.branchId })
      .from(enquiries)
      .where(eq(enquiries.id, enquiryId))
      .limit(1)
    if (!enquiry) return null

    const at = sql<Date>`coalesce(${messages.sentAt}, ${messages.createdAt})`
    // The newest `MAX_MESSAGES`, then put back in reading order below.
    const rows = await tx
      .select({
        id: messages.id,
        channel: messages.channel,
        direction: messages.direction,
        at: messages.sentAt,
        createdAt: messages.createdAt,
        fromAddress: messages.fromAddress,
        subject: messages.subject,
        body: messages.body,
        authorId: messages.authorId,
        staffAuthored: messages.staffAuthored,
        authorEn: principals.nameEn,
        authorAr: principals.nameAr,
      })
      .from(messages)
      .leftJoin(principals, eq(principals.id, messages.authorId))
      .where(eq(messages.enquiryId, enquiry.id))
      .orderBy(desc(at), desc(messages.id))
      .limit(MAX_MESSAGES)
    rows.reverse()

    const ids = rows.map((r) => r.id)
    const files =
      ids.length === 0
        ? []
        : await tx
            .select({
              messageId: messageAttachments.messageId,
              assetId: assets.id,
              fileName: assets.fileName,
            })
            .from(messageAttachments)
            .innerJoin(assets, eq(assets.id, messageAttachments.assetId))
            .where(inArray(messageAttachments.messageId, ids))
            .orderBy(asc(messageAttachments.createdAt))
    const filesOf = new Map<string, ConversationMessageLike['attachments'][number][]>()
    for (const file of files) {
      const list = filesOf.get(file.messageId) ?? []
      list.push({ assetId: file.assetId, fileName: file.fileName })
      filesOf.set(file.messageId, list)
    }

    const thread: ConversationMessageLike[] = rows.map((row) => {
      const outbound = row.direction === 'outbound'
      /*
        Who wrote it. The system principal is the agent (and the automatic
        acknowledgement); any other principal is a named person in the product;
        `staff_authored` with no principal is a person answering from outside
        it, their own phone or the Kapso inbox. An outbound row with neither
        was written by an automation that names nobody, so it reads as the
        system too.
      */
      const person = outbound && row.authorId !== null && row.authorId !== SYSTEM_PRINCIPAL_ID
      return {
        id: row.id,
        channel: row.channel === 'whatsapp' || row.channel === 'email' ? row.channel : 'other',
        direction: outbound ? 'outbound' : 'inbound',
        at: row.at ?? row.createdAt,
        fromAddress: row.fromAddress,
        subject: row.subject,
        body: row.body,
        author: !outbound ? null : person || row.staffAuthored ? 'staff' : 'agent',
        authorName: person ? (locale === 'ar' ? row.authorAr || row.authorEn : row.authorEn) : null,
        attachments: filesOf.get(row.id) ?? [],
      }
    })

    const [conversation] = await tx
      .select({
        channel: intakeConversations.channel,
        customerAddress: intakeConversations.customerAddress,
      })
      .from(intakeConversations)
      .where(eq(intakeConversations.enquiryId, enquiry.id))
      .limit(1)

    const inbound = thread.filter(
      (m) => m.direction === 'inbound' && (m.channel === 'whatsapp' || m.channel === 'email'),
    )
    const latestInbound = inbound.at(-1)
    const replyChannel: EnquiryConversationLike['replyChannel'] = conversation
      ? conversation.channel === 'whatsapp'
        ? 'whatsapp'
        : 'email'
      : latestInbound?.fromAddress
        ? latestInbound.channel === 'whatsapp'
          ? 'whatsapp'
          : 'email'
        : null
    const replyTo = conversation
      ? conversation.customerAddress
      : (latestInbound?.fromAddress ?? null)

    return {
      branchId: enquiry.branchId,
      messages: thread,
      replyChannel,
      replyTo,
      lastInboundAt:
        inbound.filter((m) => m.channel === (replyChannel ?? 'whatsapp')).at(-1)?.at ?? null,
    }
  })
}
