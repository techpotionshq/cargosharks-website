/**
 * An enquiry's thread with every message put on a side, and where a reply to
 * the customer may go (NEW-1).
 *
 * Two callers that must not disagree: the service that sends a coordinator's
 * reply (`workers/enquiry-reply.ts`) and the panel that shows the thread and
 * says who a reply would reach (`features/enquiries/conversation.ts`). The rule
 * itself is pure and lives in `core/thread-sides.ts`; this reads what it needs,
 * under the caller's actor, so RLS decides what may be answered.
 *
 * The service is the authority. The web never names a recipient; it shows the
 * one this computes and posts only the words.
 */

import { and, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import {
  identifyingDomain,
  notCustomerAddress,
  phoneDigits,
  rfqTokenIn,
  threadSide,
  type ThreadParties,
  type ThreadSide,
} from '@qabandi/core'
import {
  customerContacts,
  enquiries,
  intakeConversations,
  messages,
  partnerContacts,
  partners,
  principals,
  rateRequests,
} from './schema/index'
import { SYSTEM_PRINCIPAL_ID, type Tx } from './actor'

/** One message on the thread, with the side it is on. */
export interface SidedMessage {
  readonly id: string
  readonly channel: string
  readonly direction: 'inbound' | 'outbound'
  readonly sentAt: Date | null
  readonly createdAt: Date
  readonly fromAddress: string | null
  readonly toAddresses: readonly string[]
  readonly subject: string | null
  readonly body: string
  readonly externalRef: string | null
  readonly authorId: string | null
  readonly staffAuthored: boolean
  readonly side: ThreadSide
  /** The partner, where `side` is `partner` and we can say which. */
  readonly partnerId: string | null
}

export interface EnquiryThread {
  readonly enquiry: {
    readonly id: string
    readonly branchId: string
    readonly reference: string
    readonly customerId: string | null
  }
  readonly conversation: {
    readonly channel: string
    readonly customerAddress: string
    readonly businessAddress: string
    readonly locale: string | null
  } | null
  /** Oldest first: the newest `limit`, put back in reading order. */
  readonly messages: readonly SidedMessage[]
  readonly partnerNames: ReadonlyMap<string, { readonly en: string; readonly ar: string | null }>
  readonly parties: ThreadParties
}

/** Digits-only phone, as the `right(..., 7)` prefilter below compares it. */
const storedDigits = (column: AnyPgColumn) =>
  sql<string>`right(regexp_replace(coalesce(${column}, ''), '[^0-9]', '', 'g'), 7)`

/**
 * The thread, sided.
 *
 * `ownAddresses` are the office's mailboxes and WhatsApp numbers, which only
 * the service may read (their policy shows them to whoever may edit them); a
 * message from one of them is the office, never the customer. Null when the
 * enquiry is invisible to the actor.
 */
export async function loadEnquiryThread(
  tx: Tx,
  enquiryId: string,
  options: { readonly ownAddresses?: readonly string[]; readonly limit?: number } = {},
): Promise<EnquiryThread | null> {
  const [enquiry] = await tx
    .select({
      id: enquiries.id,
      branchId: enquiries.branchId,
      reference: enquiries.reference,
      customerId: enquiries.customerId,
    })
    .from(enquiries)
    .where(eq(enquiries.id, enquiryId))
    .limit(1)
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

  const at = sql`coalesce(${messages.sentAt}, ${messages.createdAt})`
  const rows = await tx
    .select({
      id: messages.id,
      channel: messages.channel,
      direction: messages.direction,
      sentAt: messages.sentAt,
      createdAt: messages.createdAt,
      fromAddress: messages.fromAddress,
      toAddresses: messages.toAddresses,
      subject: messages.subject,
      body: messages.body,
      externalRef: messages.externalRef,
      authorId: messages.authorId,
      staffAuthored: messages.staffAuthored,
      partnerId: messages.partnerId,
    })
    .from(messages)
    .where(eq(messages.enquiryId, enquiry.id))
    .orderBy(desc(at), desc(messages.id))
    .limit(options.limit ?? 200)
  rows.reverse()

  /*
    Every rate request that names this enquiry, or whose reply is on it, or
    whose token a message here carries. A rate reply is filed on the enquiry it
    prices with no partner on the row (the column is for supplier mail filed on
    no record), so the request is what says whose it is.
  */
  const tokens = [...new Set(rows.flatMap((r) => rfqTokenIn(r.subject, r.body) ?? []))]
  const ids = rows.map((r) => r.id)
  const requests = await tx
    .select({
      token: rateRequests.token,
      partnerId: rateRequests.partnerId,
      messageId: rateRequests.messageId,
    })
    .from(rateRequests)
    .where(
      or(
        eq(rateRequests.enquiryId, enquiry.id),
        inArray(rateRequests.messageId, ids),
        inArray(rateRequests.token, tokens),
      ),
    )
  const requestPartnerOf = new Map(
    requests.filter((r) => r.messageId).map((r) => [r.messageId!, r.partnerId]),
  )
  const tokenPartnerOf = new Map(requests.map((r) => [r.token, r.partnerId]))

  const parties = await loadParties(tx, enquiry.customerId, [
    ...rows.map((r) => r.fromAddress),
    conversation?.customerAddress ?? null,
  ])
  const withOwn: ThreadParties = {
    ...parties,
    ownAddresses: (options.ownAddresses ?? []).map((a) => a.toLowerCase()),
  }

  const sided: SidedMessage[] = rows.map((row) => {
    const direction = row.direction === 'outbound' ? 'outbound' : 'inbound'
    const { side, partnerId } = threadSide(
      {
        direction,
        fromAddress: row.fromAddress,
        subject: row.subject,
        body: row.body,
        authorId: row.authorId,
        staffAuthored: row.staffAuthored,
        partnerId: row.partnerId,
        rateRequestPartnerId: requestPartnerOf.get(row.id) ?? null,
      },
      withOwn,
      SYSTEM_PRINCIPAL_ID,
      (token) => tokenPartnerOf.get(token) ?? null,
    )
    return {
      id: row.id,
      channel: row.channel,
      direction,
      sentAt: row.sentAt,
      createdAt: row.createdAt,
      fromAddress: row.fromAddress,
      toAddresses: row.toAddresses ?? [],
      subject: row.subject,
      body: row.body,
      externalRef: row.externalRef,
      authorId: row.authorId,
      staffAuthored: row.staffAuthored,
      side,
      partnerId,
    }
  })

  const partnerIds = [...new Set(sided.flatMap((m) => (m.partnerId ? [m.partnerId] : [])))]
  const names =
    partnerIds.length === 0
      ? []
      : await tx
          .select({ id: partners.id, en: partners.legalNameEn, ar: partners.legalNameAr })
          .from(partners)
          .where(inArray(partners.id, partnerIds))

  return {
    enquiry,
    conversation: conversation ?? null,
    messages: sided,
    partnerNames: new Map(names.map((n) => [n.id, { en: n.en, ar: n.ar }])),
    parties: withOwn,
  }
}

/**
 * The partners, staff and other customers any of these addresses could be.
 *
 * Prefiltered in SQL (exact mail, mail domain, the last seven digits of a
 * phone) so a branch with a thousand contacts reads a handful; the exact rule
 * is `core`'s. Inactive contacts count: an agent's old address is still the
 * agent's, and the safe mistake here is refusing, not leaking.
 */
async function loadParties(
  tx: Tx,
  customerId: string | null,
  addresses: readonly (string | null)[],
): Promise<Omit<ThreadParties, 'ownAddresses'>> {
  const present = addresses.flatMap((a) => (a?.trim() ? [a.trim().toLowerCase()] : []))
  const emails = [...new Set(present.filter((a) => a.includes('@')))]
  const domains = [...new Set(emails.flatMap((e) => identifyingDomain(e) ?? []))]
  const last7 = [
    ...new Set(
      present.filter((a) => !a.includes('@')).flatMap((a) => phoneDigits(a)?.slice(-7) ?? []),
    ),
  ]
  if (emails.length === 0 && last7.length === 0) {
    return { partners: [], staff: [], otherCustomers: [] }
  }

  const partnerRows = await tx
    .select({
      partnerId: partnerContacts.partnerId,
      email: partnerContacts.email,
      phone: partnerContacts.phone,
    })
    .from(partnerContacts)
    .where(
      or(
        inArray(sql`lower(${partnerContacts.email})`, emails),
        inArray(sql`lower(split_part(${partnerContacts.email}, '@', 2))`, domains),
        inArray(storedDigits(partnerContacts.phone), last7),
      ),
    )

  const staffRows = await tx
    .select({ email: principals.email, phone: principals.phone })
    .from(principals)
    .where(
      and(
        eq(principals.type, 'internal'),
        or(
          inArray(sql`lower(${principals.email})`, emails),
          inArray(storedDigits(principals.phone), last7),
        ),
      ),
    )

  const otherCustomers =
    customerId === null
      ? []
      : await tx
          .select({ email: customerContacts.email, phone: customerContacts.phone })
          .from(customerContacts)
          .where(
            and(
              or(ne(customerContacts.customerId, customerId), isNull(customerContacts.customerId)),
              or(
                inArray(sql`lower(${customerContacts.email})`, emails),
                inArray(storedDigits(customerContacts.phone), last7),
              ),
            ),
          )

  return { partners: partnerRows, staff: staffRows, otherCustomers }
}

/** Where a reply to the customer goes, and how it threads. */
export interface CustomerReplyTarget {
  readonly channel: 'whatsapp' | 'email'
  readonly to: string
  /** The business number or mailbox the customer wrote to, where known. */
  readonly from: string | undefined
  readonly subject: string | undefined
  readonly inReplyTo: string | undefined
  readonly locale: 'en' | 'ar'
  readonly hasConversation: boolean
}

/**
 * Who a reply to the customer reaches, or why nobody safely can.
 *
 * The intake conversation first: it is the agent's record of the customer's
 * thread and names the business address the provider needs. Failing that, the
 * latest message on the customer's side of the thread, never a partner's,
 * staff's or the office's own. Either way the address is checked against
 * everyone we know who is not this customer, and a match refuses: a
 * conversation opened by a sender we have since learned is an agent is still
 * not a customer to send a price to.
 *
 * `not_customer` is a thread with somebody on it but nobody we may answer;
 * `no_thread` is a thread with nobody on it at all.
 */
export function customerReplyTarget(
  thread: EnquiryThread,
): CustomerReplyTarget | { readonly refused: 'no_thread' | 'not_customer' } {
  const { conversation, parties } = thread
  const locale = conversation?.locale === 'ar' ? 'ar' : 'en'
  const answerable = (m: SidedMessage) =>
    m.direction === 'inbound' && (m.channel === 'whatsapp' || m.channel === 'email')
  const customerSide = thread.messages.filter(
    (m) =>
      answerable(m) && m.side === 'customer' && notCustomerAddress(m.fromAddress, parties) === null,
  )

  let channel: 'whatsapp' | 'email'
  let to: string
  let from: string | undefined
  if (conversation) {
    channel = conversation.channel === 'whatsapp' ? 'whatsapp' : 'email'
    to = conversation.customerAddress
    from = conversation.businessAddress || undefined
    if (notCustomerAddress(to, parties) !== null) return { refused: 'not_customer' }
  } else {
    const latest = customerSide.at(-1)
    if (!latest) {
      return { refused: thread.messages.some(answerable) ? 'not_customer' : 'no_thread' }
    }
    channel = latest.channel === 'whatsapp' ? 'whatsapp' : 'email'
    to = latest.fromAddress!.trim()
    from =
      channel === 'whatsapp'
        ? latest.toAddresses[0]
        : latest.toAddresses.find((a) => parties.ownAddresses.includes(a.toLowerCase()))
  }
  // WhatsApp sends *from* a number the account owns; without it there is no send.
  if (channel === 'whatsapp' && !from) return { refused: 'no_thread' }

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

  /*
    Threaded under the customer's own mail only. A partner's rate reply on the
    same enquiry has a subject and a Message-ID too, and a reply "Re:" the
    agent's subject, `In-Reply-To` the agent's mail, would land in the
    customer's inbox as part of a conversation they were never in.
  */
  const theirs = customerSide.filter(
    (m) => m.channel === 'email' && m.fromAddress?.trim().toLowerCase() === to.toLowerCase(),
  )
  const lastEmail = theirs.at(-1)
  const original = theirs.findLast((m) => m.subject?.trim())?.subject?.trim()
  const subject = original
    ? /^re:/i.test(original)
      ? original
      : `Re: ${original}`
    : thread.enquiry.reference
  const ref = lastEmail?.externalRef ?? undefined
  const inReplyTo = ref ? (ref.startsWith('<') ? ref : `<${ref}>`) : undefined
  return { channel, to, from, subject, inReplyTo, locale, hasConversation: Boolean(conversation) }
}
