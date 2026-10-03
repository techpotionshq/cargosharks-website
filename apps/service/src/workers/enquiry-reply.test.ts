/**
 * A coordinator's reply from the enquiry screen, against a real database and a
 * fake channel (D5).
 *
 * What is asserted is what the customer would receive and what the thread
 * would then say: an email reply threads under the customer's own message, a
 * refused send leaves no row claiming it went, and WhatsApp's 24-hour refusal
 * comes back as its own code so the screen can explain it. The takeover the
 * reply causes is asserted end to end in `intake-turn.test.ts`, where the
 * agent's turn is real.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const {
  branches,
  enquiries,
  intakeConversations,
  mailboxes,
  messages,
  partnerContacts,
  partners,
  principals,
  rateRequests,
  systemActor,
  withActor,
  workingCalendars,
} = await import('@qabandi/db')
const { sendEnquiryReply, isWhatsAppWindowClosed } = await import('./enquiry-reply')
type NotificationChannel = import('../ports/index').NotificationChannel
type OutboundMessage = import('../ports/index').OutboundMessage

const BRANCH = '00000000-0000-7000-8000-0000000f2001'
const OTHER_BRANCH = '00000000-0000-7000-8000-0000000f2002'
const STAFF = '00000000-0000-7000-8000-0000000f2003'
const MAILBOX = 'reply-fixture@qabandi.test'
const PHONE_NUMBER_ID = 'wa-reply-fixture-0001'
const PARTNER = '00000000-0000-7000-8000-0000000f2004'
/** The agent's contact on file; its pricing desk writes from another box at the same domain. */
const PARTNER_CONTACT = 'ops@agent-reply-fixture.test'
const PARTNER_DESK = 'pricing@agent-reply-fixture.test'
const PARTNER_PHONE = '+86 21 5555 0199'
const sys = systemActor()
const RUN = process.hrtime.bigint().toString(36).toUpperCase().slice(-6)
let seq = 0

const staff = { principalId: STAFF, type: 'internal' as const, branchIds: [BRANCH] }
const stranger = { principalId: STAFF, type: 'internal' as const, branchIds: [OTHER_BRANCH] }

/** A channel stand-in: records what it was asked to send, and answers as told. */
function channel(key: 'whatsapp' | 'email', answer?: { accepted: false; error: string }) {
  const sent: OutboundMessage[] = []
  return {
    sent,
    resolve: async (): Promise<NotificationChannel> => ({
      key,
      async send(message: OutboundMessage) {
        sent.push(message)
        return answer ?? { accepted: true, externalRef: `${key}-out-${RUN}-${(seq += 1)}` }
      },
    }),
  }
}

async function enquiry(over: Partial<typeof enquiries.$inferInsert> = {}) {
  seq += 1
  const [row] = await withActor(sys, (tx) =>
    tx
      .insert(enquiries)
      .values({
        reference: `RPL-${RUN}-${seq}`,
        branchId: BRANCH,
        status: 'new',
        channel: 'email',
        ...over,
      })
      .returning({ id: enquiries.id }),
  )
  return row!.id
}

async function inbound(enquiryId: string, over: Partial<typeof messages.$inferInsert>) {
  const [row] = await withActor(sys, (tx) =>
    tx
      .insert(messages)
      .values({
        branchId: BRANCH,
        enquiryId,
        channel: 'email',
        direction: 'inbound',
        body: 'Please quote',
        sentAt: new Date(),
        ...over,
      })
      .returning({ id: messages.id }),
  )
  return row!.id
}

/**
 * An agent's rate reply, filed on the enquiry the way `inbound-mail.ts` files
 * one: no partner on the row, the request pointing at it.
 */
async function rateReply(
  enquiryId: string,
  over: Partial<typeof messages.$inferInsert> = {},
  link = true,
) {
  seq += 1
  const token = `${RUN.toLowerCase()}rfq${seq}`.padEnd(12, '0')
  const id = await inbound(enquiryId, {
    subject: `Re: Rate request [RFQ:${token}] Ningbo to Shuwaikh`,
    body: 'Our buy rate: USD 2,900 per 40HC',
    fromAddress: PARTNER_DESK,
    toAddresses: [MAILBOX],
    externalRef: `rate-${RUN}-${seq}@agent-reply-fixture.test`,
    sentAt: new Date(Date.now() + 60_000),
    ...over,
  })
  await withActor(sys, (tx) =>
    tx.insert(rateRequests).values({
      branchId: BRANCH,
      enquiryId,
      partnerId: PARTNER,
      token,
      status: 'responded',
      ...(link ? { messageId: id } : {}),
    }),
  )
  return id
}

const outbound = (enquiryId: string) =>
  withActor(sys, (tx) =>
    tx
      .select({
        authorId: messages.authorId,
        channel: messages.channel,
        subject: messages.subject,
        body: messages.body,
        toAddresses: messages.toAddresses,
        fromAddress: messages.fromAddress,
      })
      .from(messages)
      .where(and(eq(messages.enquiryId, enquiryId), eq(messages.direction, 'outbound'))),
  )

const responded = async (enquiryId: string) =>
  (
    await withActor(sys, (tx) =>
      tx
        .select({ at: enquiries.firstRespondedAt })
        .from(enquiries)
        .where(eq(enquiries.id, enquiryId)),
    )
  )[0]!.at

describe('reading Meta’s 24-hour refusal', () => {
  it('knows the re-engagement error by its code and by its words', () => {
    expect(isWhatsAppWindowClosed('kapso 400: {"error":{"code":131047}}')).toBe(true)
    expect(isWhatsAppWindowClosed('Re-engagement message')).toBe(true)
    expect(isWhatsAppWindowClosed('kapso 401: invalid api key')).toBe(false)
    // Kapso's own refusal, exactly as the live run recorded it (NEW-2).
    expect(
      isWhatsAppWindowClosed(
        'kapso 422: {"error":"Cannot send non-template messages outside the 24-hour window."}',
      ),
    ).toBe(true)
    expect(isWhatsAppWindowClosed(undefined)).toBe(false)
  })
})

describe.skipIf(!enabled)('a coordinator’s reply from the enquiry screen', () => {
  beforeAll(async () => {
    await withActor(sys, async (tx) => {
      const [calendar] = await tx
        .select({ id: workingCalendars.id })
        .from(workingCalendars)
        .where(eq(workingCalendars.key, 'kuwait'))
        .limit(1)
      if (!calendar) throw new Error('Run `pnpm db:seed` before this suite')
      for (const [id, code] of [
        [BRANCH, 'RPL'],
        [OTHER_BRANCH, 'RPO'],
      ] as const) {
        await tx
          .insert(branches)
          .values({
            id,
            code,
            legalNameEn: `Reply Fixture ${code}`,
            legalNameAr: 'فرع الرد التجريبي',
            country: 'KW',
            baseCurrency: 'KWD',
            invoiceSeries: code,
            calendarId: calendar.id,
          })
          .onConflictDoNothing()
      }
      await tx
        .insert(principals)
        .values({
          id: STAFF,
          type: 'internal',
          email: 'reply-desk@reply-fixture.test',
          nameEn: 'Reply Desk',
        })
        .onConflictDoNothing()
      await tx
        .insert(mailboxes)
        .values({
          branchId: BRANCH,
          host: 'imap.reply-fixture.test',
          username: MAILBOX,
          passwordSealed: 'v1:aaaa:bbbb:cccc',
          isActive: false,
        })
        .onConflictDoNothing()
      await tx
        .insert(partners)
        .values({ id: PARTNER, code: `RPLAG${RUN}`, type: 'agent', legalNameEn: 'Reply Agent Ltd' })
        .onConflictDoNothing()
      await tx.insert(partnerContacts).values({
        partnerId: PARTNER,
        nameEn: 'Agent ops',
        email: PARTNER_CONTACT,
        phone: PARTNER_PHONE,
      })
    })
  })

  afterAll(async () => {
    if (!enabled) return
    await withActor(sys, (tx) =>
      tx
        .update(enquiries)
        .set({ status: 'cancelled', closedAt: new Date() })
        .where(eq(enquiries.branchId, BRANCH)),
    )
  })

  it('answers an email in the customer’s own thread, from the mailbox they wrote to', async () => {
    const id = await enquiry()
    await inbound(id, {
      subject: 'RFQ 2x40HC Ningbo to Shuwaikh',
      fromAddress: 'buyer@customer.test',
      toAddresses: [MAILBOX.toUpperCase(), 'someone-else@qabandi.test'],
      externalRef: `rfq-${RUN}@customer.test`,
    })
    const mail = channel('email')

    const result = await sendEnquiryReply(
      { actor: staff, enquiryId: id, body: '  Thank you, we will price it today.\n\nDesk  ' },
      { resolveEmail: mail.resolve, sendDelays: [] },
    )

    expect(result).toMatchObject({ ok: true, channel: 'email' })
    expect(mail.sent[0]).toMatchObject({
      to: 'buyer@customer.test',
      from: MAILBOX.toUpperCase(),
      subject: 'Re: RFQ 2x40HC Ningbo to Shuwaikh',
      inReplyTo: `<rfq-${RUN}@customer.test>`,
      body: 'Thank you, we will price it today.\n\nDesk',
    })
    const [row] = await outbound(id)
    expect(row).toMatchObject({
      authorId: STAFF,
      channel: 'email',
      subject: 'Re: RFQ 2x40HC Ningbo to Shuwaikh',
      toAddresses: ['buyer@customer.test'],
    })
    // Answering the customer is the event the first-response clock measures.
    expect(await responded(id)).toBeInstanceOf(Date)
  })

  it('stamps the intake conversation when the agent holds the enquiry', async () => {
    const id = await enquiry({ channel: 'whatsapp' })
    await inbound(id, { channel: 'whatsapp', fromAddress: '96550001111' })
    await withActor(sys, (tx) =>
      tx.insert(intakeConversations).values({
        branchId: BRANCH,
        enquiryId: id,
        channel: 'whatsapp',
        customerAddress: '96550001111',
        businessAddress: PHONE_NUMBER_ID,
      }),
    )
    const wa = channel('whatsapp')
    const asOf = new Date(Date.UTC(2040, 5, 1, 9))

    const result = await sendEnquiryReply(
      { actor: staff, enquiryId: id, body: 'Which container type?', asOf },
      { resolveWhatsApp: wa.resolve, sendDelays: [] },
    )

    expect(result.ok).toBe(true)
    expect(wa.sent[0]).toMatchObject({ to: '96550001111', from: PHONE_NUMBER_ID })
    const [conversation] = await withActor(sys, (tx) =>
      tx
        .select({ at: intakeConversations.lastStaffActivityAt })
        .from(intakeConversations)
        .where(eq(intakeConversations.enquiryId, id)),
    )
    expect(conversation!.at?.getTime()).toBe(asOf.getTime())
  })

  it('reports WhatsApp’s 24-hour refusal as its own code, and files nothing', async () => {
    const id = await enquiry({ channel: 'whatsapp' })
    await inbound(id, {
      channel: 'whatsapp',
      fromAddress: '96550002222',
      toAddresses: [PHONE_NUMBER_ID],
    })
    const wa = channel('whatsapp', {
      accepted: false,
      error:
        'kapso 400: {"error":{"message":"Re-engagement message","code":131047,"error_data":{"details":"Message failed to send because more than 24 hours have passed since the customer last replied to this number."}}}',
    })

    const result = await sendEnquiryReply(
      { actor: staff, enquiryId: id, body: 'Are you still interested?' },
      { resolveWhatsApp: wa.resolve, sendDelays: [] },
    )

    expect(result).toMatchObject({ ok: false, code: 'whatsapp_window' })
    // Read off the inbound message: the business number it was sent to.
    expect(wa.sent[0]).toMatchObject({ to: '96550002222', from: PHONE_NUMBER_ID })
    expect(await outbound(id)).toHaveLength(0)
    expect(await responded(id)).toBeNull()
  })

  it('reads Kapso’s own 24-hour refusal as the window closing (NEW-2)', async () => {
    const id = await enquiry({ channel: 'whatsapp' })
    await inbound(id, {
      channel: 'whatsapp',
      fromAddress: '96550005555',
      toAddresses: [PHONE_NUMBER_ID],
    })
    const wa = channel('whatsapp', {
      accepted: false,
      error: 'kapso 422: {"error":"Cannot send non-template messages outside the 24-hour window."}',
    })

    const result = await sendEnquiryReply(
      { actor: staff, enquiryId: id, body: 'Hello' },
      { resolveWhatsApp: wa.resolve, sendDelays: [] },
    )

    expect(result).toMatchObject({ ok: false, code: 'whatsapp_window' })
    expect(await outbound(id)).toHaveLength(0)
  })

  it('passes any other refusal on with the provider’s words', async () => {
    const id = await enquiry()
    await inbound(id, { fromAddress: 'buyer@customer.test', toAddresses: [MAILBOX] })
    const mail = channel('email', { accepted: false, error: '550 mailbox unavailable' })

    const result = await sendEnquiryReply(
      { actor: staff, enquiryId: id, body: 'Hello' },
      { resolveEmail: mail.resolve, sendDelays: [] },
    )

    expect(result).toEqual({ ok: false, code: 'send_failed', detail: '550 mailbox unavailable' })
    expect(await outbound(id)).toHaveLength(0)
  })

  it('says the channel is off rather than pretending to send', async () => {
    const id = await enquiry({ channel: 'whatsapp' })
    await inbound(id, {
      channel: 'whatsapp',
      fromAddress: '96550003333',
      toAddresses: [PHONE_NUMBER_ID],
    })

    const result = await sendEnquiryReply(
      { actor: staff, enquiryId: id, body: 'Hello' },
      { resolveWhatsApp: async () => null, sendDelays: [] },
    )

    expect(result).toMatchObject({ ok: false, code: 'channel_off' })
  })

  it('has nowhere to send on an enquiry nobody wrote in on', async () => {
    const id = await enquiry({ channel: 'phone' })
    const mail = channel('email')

    const result = await sendEnquiryReply(
      { actor: staff, enquiryId: id, body: 'Hello' },
      { resolveEmail: mail.resolve, sendDelays: [] },
    )

    expect(result).toMatchObject({ ok: false, code: 'no_thread' })
    expect(mail.sent).toHaveLength(0)
  })

  it('cannot answer an enquiry in a branch the actor does not hold', async () => {
    const id = await enquiry()
    await inbound(id, { fromAddress: 'buyer@customer.test', toAddresses: [MAILBOX] })
    const mail = channel('email')

    const result = await sendEnquiryReply(
      { actor: stranger, enquiryId: id, body: 'Hello' },
      { resolveEmail: mail.resolve, sendDelays: [] },
    )

    // Invisible under RLS: not found, never forbidden.
    expect(result).toMatchObject({ ok: false, code: 'not_found' })
    expect(mail.sent).toHaveLength(0)
  })

  describe('never to anyone but the customer (NEW-1)', () => {
    it('refuses when the only inbound message is an agent’s rate reply, and sends nothing', async () => {
      const id = await enquiry()
      await rateReply(id)
      const mail = channel('email')

      const result = await sendEnquiryReply(
        { actor: staff, enquiryId: id, body: 'Our price is KWD 1,150 all in' },
        { resolveEmail: mail.resolve, sendDelays: [] },
      )

      expect(result).toMatchObject({ ok: false, code: 'not_customer' })
      expect(mail.sent).toHaveLength(0)
      expect(await outbound(id)).toHaveLength(0)
    })

    it('answers the customer, in the customer’s thread, when a rate reply is newer', async () => {
      const id = await enquiry()
      await inbound(id, {
        subject: 'Quote 2x40HC Ningbo',
        fromAddress: 'buyer@customer.test',
        toAddresses: [MAILBOX],
        externalRef: `cust-${RUN}@customer.test`,
        sentAt: new Date(Date.now() - 60_000),
      })
      await rateReply(id)
      const mail = channel('email')

      const result = await sendEnquiryReply(
        { actor: staff, enquiryId: id, body: 'Our price is KWD 1,150 all in' },
        { resolveEmail: mail.resolve, sendDelays: [] },
      )

      expect(result).toMatchObject({ ok: true, channel: 'email' })
      expect(mail.sent).toHaveLength(1)
      // Re: the customer's subject and under their mail, never the agent's.
      expect(mail.sent[0]).toMatchObject({
        to: 'buyer@customer.test',
        subject: 'Re: Quote 2x40HC Ningbo',
        inReplyTo: `<cust-${RUN}@customer.test>`,
      })
    })

    it('knows a partner by address, by corporate domain, and by an RFQ tag with no link', async () => {
      for (const reply of [
        // The contact on file, writing about the enquiry by its reference.
        { fromAddress: PARTNER_CONTACT, subject: 'About your shipment' },
        // Another box at the agent's domain, with no rate request pointing at it.
        { fromAddress: PARTNER_DESK, subject: 'Revised rate' },
        // A late reply carrying our tag from an address we have never seen.
        { fromAddress: 'someone@elsewhere.test', subject: 'Re: [RFQ:abcdef0123456789] rates' },
      ]) {
        const id = await enquiry()
        await inbound(id, { ...reply, toAddresses: [MAILBOX] })
        const mail = channel('email')

        const result = await sendEnquiryReply(
          { actor: staff, enquiryId: id, body: 'Hello' },
          { resolveEmail: mail.resolve, sendDelays: [] },
        )

        expect(result, reply.fromAddress).toMatchObject({ ok: false, code: 'not_customer' })
        expect(mail.sent).toHaveLength(0)
      }
    })

    it('never answers staff or the office’s own mailbox writing in', async () => {
      for (const from of ['reply-desk@reply-fixture.test', MAILBOX]) {
        const id = await enquiry()
        await inbound(id, { fromAddress: from, toAddresses: [MAILBOX] })
        const mail = channel('email')

        const result = await sendEnquiryReply(
          { actor: staff, enquiryId: id, body: 'Hello' },
          { resolveEmail: mail.resolve, sendDelays: [] },
        )

        expect(result, from).toMatchObject({ ok: false, code: 'not_customer' })
        expect(mail.sent).toHaveLength(0)
      }
    })

    it('answers the customer on WhatsApp when a partner’s email is the newest message', async () => {
      const id = await enquiry({ channel: 'whatsapp' })
      await inbound(id, {
        channel: 'whatsapp',
        fromAddress: '96550004444',
        toAddresses: [PHONE_NUMBER_ID],
        sentAt: new Date(Date.now() - 60_000),
      })
      await rateReply(id)
      const wa = channel('whatsapp')
      const mail = channel('email')

      const result = await sendEnquiryReply(
        { actor: staff, enquiryId: id, body: 'Our price is KWD 1,150' },
        { resolveWhatsApp: wa.resolve, resolveEmail: mail.resolve, sendDelays: [] },
      )

      expect(result).toMatchObject({ ok: true, channel: 'whatsapp' })
      expect(wa.sent[0]).toMatchObject({ to: '96550004444', from: PHONE_NUMBER_ID })
      expect(mail.sent).toHaveLength(0)
    })

    it('never answers a partner’s WhatsApp number', async () => {
      const id = await enquiry({ channel: 'whatsapp' })
      await inbound(id, {
        channel: 'whatsapp',
        fromAddress: '862155550199',
        toAddresses: [PHONE_NUMBER_ID],
      })
      const wa = channel('whatsapp')

      const result = await sendEnquiryReply(
        { actor: staff, enquiryId: id, body: 'Hello' },
        { resolveWhatsApp: wa.resolve, sendDelays: [] },
      )

      expect(result).toMatchObject({ ok: false, code: 'not_customer' })
      expect(wa.sent).toHaveLength(0)
    })

    it('uses the intake conversation’s address, whatever came in later', async () => {
      const id = await enquiry()
      await inbound(id, {
        subject: 'Air freight please',
        fromAddress: 'importer@customer.test',
        toAddresses: [MAILBOX],
        externalRef: `conv-${RUN}@customer.test`,
        sentAt: new Date(Date.now() - 60_000),
      })
      await rateReply(id)
      await withActor(sys, (tx) =>
        tx.insert(intakeConversations).values({
          branchId: BRANCH,
          enquiryId: id,
          channel: 'email',
          customerAddress: 'importer@customer.test',
          businessAddress: MAILBOX,
        }),
      )
      const mail = channel('email')

      const result = await sendEnquiryReply(
        { actor: staff, enquiryId: id, body: 'Thank you' },
        { resolveEmail: mail.resolve, sendDelays: [] },
      )

      expect(result).toMatchObject({ ok: true, channel: 'email' })
      expect(mail.sent[0]).toMatchObject({
        to: 'importer@customer.test',
        from: MAILBOX,
        subject: 'Re: Air freight please',
        inReplyTo: `<conv-${RUN}@customer.test>`,
      })
    })

    it('refuses a conversation whose address turns out to be a partner’s', async () => {
      const id = await enquiry()
      await withActor(sys, (tx) =>
        tx.insert(intakeConversations).values({
          branchId: BRANCH,
          enquiryId: id,
          channel: 'email',
          customerAddress: PARTNER_CONTACT.toUpperCase(),
          businessAddress: MAILBOX,
        }),
      )
      const mail = channel('email')

      const result = await sendEnquiryReply(
        { actor: staff, enquiryId: id, body: 'Hello' },
        { resolveEmail: mail.resolve, sendDelays: [] },
      )

      expect(result).toMatchObject({ ok: false, code: 'not_customer' })
      expect(mail.sent).toHaveLength(0)
    })
  })

  it('refuses an empty reply before anything is read', async () => {
    const result = await sendEnquiryReply({ actor: staff, enquiryId: 'x', body: '   ' })
    expect(result).toMatchObject({ ok: false, code: 'empty' })
  })
})
