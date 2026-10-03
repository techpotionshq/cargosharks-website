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
 * Where a reply would go is read here too, by the very rule the service sends
 * by: `loadEnquiryThread` and `customerReplyTarget` in `@qabandi/db`. The
 * intake conversation if there is one, otherwise the latest message on the
 * customer's side of the thread, never an agent's rate reply filed on the same
 * enquiry (NEW-1). The panel offers the box only when there is somebody it may
 * reach, and says so when the thread holds nobody but partners and staff. What
 * it shows is a courtesy: the action posts only the words, and the service
 * decides the recipient again itself.
 */

import { asc, eq, inArray } from 'drizzle-orm'
import {
  assets,
  customerReplyTarget,
  loadEnquiryThread,
  messageAttachments,
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
    const sided = await loadEnquiryThread(tx, enquiryId, { limit: MAX_MESSAGES })
    if (!sided) return null
    const enquiry = sided.enquiry

    const authorIds = [...new Set(sided.messages.flatMap((m) => (m.authorId ? [m.authorId] : [])))]
    const people =
      authorIds.length === 0
        ? []
        : await tx
            .select({ id: principals.id, nameEn: principals.nameEn, nameAr: principals.nameAr })
            .from(principals)
            .where(inArray(principals.id, authorIds))
    const personOf = new Map(people.map((p) => [p.id, p]))
    const rows = sided.messages.map((m) => ({
      ...m,
      at: m.sentAt,
      authorEn: m.authorId ? (personOf.get(m.authorId)?.nameEn ?? null) : null,
      authorAr: m.authorId ? (personOf.get(m.authorId)?.nameAr ?? null) : null,
    }))

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
      /*
        Who wrote it, by side (NEW-4), from the same rule the reply is sent by.
        An agent's rate reply sits on this thread with its buy prices; it reads
        as the partner it came from, never as "Customer". A person in the
        product is named; `staff_authored` with no principal is a person
        answering from outside it, their own phone or the Kapso inbox.
      */
      const person = row.authorId !== null && row.authorId !== SYSTEM_PRINCIPAL_ID
      const partner = row.partnerId ? sided.partnerNames.get(row.partnerId) : undefined
      const authorName =
        row.side === 'partner'
          ? partner
            ? locale === 'ar'
              ? partner.ar || partner.en
              : partner.en
            : null
          : row.side === 'staff' && person
            ? locale === 'ar'
              ? row.authorAr || row.authorEn
              : row.authorEn
            : null
      return {
        id: row.id,
        channel: row.channel === 'whatsapp' || row.channel === 'email' ? row.channel : 'other',
        direction: row.direction,
        at: row.at ?? row.createdAt,
        fromAddress: row.fromAddress,
        subject: row.subject,
        body: row.body,
        author: row.side,
        authorName,
        attachments: filesOf.get(row.id) ?? [],
      }
    })

    const target = customerReplyTarget(sided)
    const reachable = 'refused' in target ? null : target
    // The 24-hour warning counts the customer's own messages only: an agent's
    // email does not reopen the customer's WhatsApp window.
    const lastCustomer = sided.messages.findLast(
      (m) => m.direction === 'inbound' && m.side === 'customer' && m.channel === reachable?.channel,
    )

    return {
      branchId: enquiry.branchId,
      messages: thread,
      replyChannel: reachable?.channel ?? null,
      replyTo: reachable?.to ?? null,
      replyRefused: 'refused' in target && target.refused === 'not_customer',
      lastInboundAt: lastCustomer ? (lastCustomer.sentAt ?? lastCustomer.createdAt) : null,
    }
  })
}
