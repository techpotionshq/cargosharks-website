/**
 * Inbound WhatsApp onto the board — Kapso's receipt, and what becomes of it.
 *
 * Three layers, failing differently:
 *
 *  - **`toWhatsAppInboundMessage`** turns Kapso's `whatsapp.message.received`
 *    body into the channel-neutral `InboundMessage`. Pure, so it runs everywhere;
 *    a wrong answer here files a customer's message under the wrong branch or not
 *    at all, silently, because the route already answered 202.
 *  - **The Kapso send adapter** — the outbound reply. Pure with a fake `fetch`.
 *  - **The ingest**, which needs a database and sits below the fold on
 *    `TEST_DATABASE_URL`: a real WhatsApp receipt becomes an enquiry with the
 *    right channel, the sender matched to a customer by *phone*, and the
 *    acknowledgement sent back on the same number.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { toWhatsAppInboundMessage } from './inbound-whatsapp-webhook'
import { kapsoChannel } from '../adapters/whatsapp'

const AT = new Date('2026-09-28T09:00:00Z')

/** A Kapso `whatsapp.message.received` body, as documented at docs.kapso.ai. */
const received = (
  over: {
    message?: Record<string, unknown>
    conversation?: Record<string, unknown>
    top?: Record<string, unknown>
  } = {},
) => ({
  message: {
    id: 'wamid.HBgLABC',
    timestamp: '1730092800',
    type: 'text',
    from: '96599112233',
    from_user_id: 'US.123',
    text: { body: 'Two 40HC Shanghai to Shuwaikh, ready 15 October.' },
    kapso: { direction: 'inbound', status: 'received', has_media: false, content: 'Two 40HC…' },
    ...over.message,
  },
  conversation: {
    id: 'conv_1',
    contact_name: 'Faisal Al-Rashid',
    phone_number: '96599112233',
    phone_number_id: '123456789012345',
    ...over.conversation,
  },
  is_new_conversation: true,
  phone_number_id: '123456789012345',
  ...over.top,
})

describe('toWhatsAppInboundMessage', () => {
  it('reads the sender, the business number, the body and the wamid', () => {
    const message = toWhatsAppInboundMessage(received(), AT)

    expect(message.channel).toBe('whatsapp')
    expect(message.externalId).toBe('wamid.HBgLABC')
    expect(message.from).toBe('96599112233')
    expect(message.fromName).toBe('Faisal Al-Rashid')
    // `mailbox` carries the business number — the branch key for whatsapp_numbers.
    expect(message.mailbox).toBe('123456789012345')
    expect(message.to).toEqual(['123456789012345'])
    expect(message.body).toContain('Two 40HC')
    // 1730092800 unix seconds — the timestamp in Kapso's documented example.
    expect(message.receivedAt.toISOString()).toBe('2024-10-28T05:20:00.000Z')
    expect(message.automatic).toBe(false)
  })

  it('makes the first line of the message the board headline', () => {
    const message = toWhatsAppInboundMessage(
      received({ message: { text: { body: 'Need a quote\nDetails below\n2x40HC' } } }),
      AT,
    )
    expect(message.subject).toBe('Need a quote')
  })

  it('falls back to kapso.content when the text body is absent', () => {
    const message = toWhatsAppInboundMessage(
      received({
        message: { text: undefined, kapso: { direction: 'inbound', content: 'Hello there' } },
      }),
      AT,
    )
    expect(message.body).toBe('Hello there')
  })

  it('names a media message rather than leaving the body empty', () => {
    const message = toWhatsAppInboundMessage(
      received({
        message: {
          type: 'document',
          text: undefined,
          kapso: { direction: 'inbound', has_media: true },
          document: { filename: 'packing-list.pdf' },
        },
      }),
      AT,
    )
    expect(message.body).toContain('packing-list.pdf')
    expect(message.subject).toContain('packing-list.pdf')
  })

  it('threads a reply by the quoted message id', () => {
    const message = toWhatsAppInboundMessage(
      received({ message: { context: { id: 'wamid.PARENT' } } }),
      AT,
    )
    expect(message.inReplyTo).toBe('wamid.PARENT')
  })

  it('takes the sender from the conversation when the message omits the phone', () => {
    const message = toWhatsAppInboundMessage(
      received({ message: { from: undefined }, conversation: { phone_number: '96599887766' } }),
      AT,
    )
    expect(message.from).toBe('96599887766')
  })

  /* The business number names the branch; without it nothing can own the message. */
  it('refuses a receipt with no phone_number_id', () => {
    expect(() =>
      toWhatsAppInboundMessage(
        received({
          top: { phone_number_id: undefined },
          conversation: { phone_number_id: undefined },
        }),
        AT,
      ),
    ).toThrow(/phone_number_id/)
  })

  it('refuses a receipt with no message', () => {
    expect(() => toWhatsAppInboundMessage({ conversation: {}, phone_number_id: 'x' }, AT)).toThrow(
      /no `message`/,
    )
  })

  /* An outbound echo is our own words; filing one would put them on the board. */
  it('refuses an outbound echo', () => {
    expect(() =>
      toWhatsAppInboundMessage(received({ message: { kapso: { direction: 'outbound' } } }), AT),
    ).toThrow(/outbound/)
  })

  it('refuses a batched delivery, naming the fix', () => {
    expect(() => toWhatsAppInboundMessage({ batch: true, data: [] }, AT)).toThrow(/buffering/)
  })

  it('defaults the received time to now on a bad timestamp rather than refusing', () => {
    const message = toWhatsAppInboundMessage(received({ message: { timestamp: 'nope' } }), AT)
    expect(message.receivedAt).toEqual(AT)
  })
})

describe('kapsoChannel', () => {
  const okResponse = (id = 'wamid.SENT') =>
    new Response(JSON.stringify({ messaging_product: 'whatsapp', messages: [{ id }] }), {
      status: 200,
    })

  it('posts a text message to the sending number and returns the wamid', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => okResponse('wamid.OUT'))
    const channel = kapsoChannel({
      apiKey: 'kap_test',
      baseUrl: 'https://api.kapso.ai/meta/whatsapp',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const result = await channel.send({
      to: '96599112233',
      from: '123456789012345',
      body: 'Received, your reference is KWI-ENQ-2026-00042.',
      locale: 'en',
    })

    expect(result.accepted).toBe(true)
    expect(result.externalRef).toBe('wamid.OUT')

    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('https://api.kapso.ai/meta/whatsapp/v24.0/123456789012345/messages')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'x-api-key': 'kap_test' })
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({ messaging_product: 'whatsapp', to: '96599112233', type: 'text' })
    expect(body.text.body).toContain('KWI-ENQ-2026-00042')
  })

  it('reads the wamid out of a Kapso data envelope too', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { messages: [{ id: 'wamid.WRAPPED' }] } }), {
          status: 200,
        }),
    )
    const channel = kapsoChannel({
      apiKey: 'k',
      baseUrl: 'https://api.kapso.ai/meta/whatsapp',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const result = await channel.send({ to: '9', from: '1', body: 'hi', locale: 'en' })
    expect(result.externalRef).toBe('wamid.WRAPPED')
  })

  it('refuses a send with no sending number', async () => {
    const channel = kapsoChannel({ apiKey: 'k', baseUrl: 'https://x', fetchImpl: vi.fn() as never })
    const result = await channel.send({ to: '9', from: undefined, body: 'hi', locale: 'en' })
    expect(result.accepted).toBe(false)
    expect(result.error).toMatch(/phone_number_id/)
  })

  it('reports a provider error rather than throwing', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":"bad number"}', { status: 400 }))
    const channel = kapsoChannel({
      apiKey: 'k',
      baseUrl: 'https://api.kapso.ai/meta/whatsapp',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const result = await channel.send({ to: '9', from: '1', body: 'hi', locale: 'en' })
    expect(result.accepted).toBe(false)
    expect(result.error).toContain('400')
  })
})

// --- against a database ------------------------------------------------------

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

// storeAttachments never runs for a text message, but the module resolves a file
// store at import; memory keeps it off any bucket this suite has no key for.
process.env.FILE_STORE_DRIVER = 'memory'

const {
  branches,
  customerContacts,
  customers,
  enquiries,
  inboundWebhookEvents,
  messages,
  notificationOutbox,
  principals,
  systemActor,
  whatsappNumbers,
  withActor,
  workingCalendars,
} = await import('@qabandi/db')

const { runInboundWhatsAppWebhook } = await import('./inbound-whatsapp-webhook')

const BRANCH = '00000000-0000-7000-8000-0000000aa001'
const CUSTOMER = '00000000-0000-7000-8000-0000000aa002'
const PRINCIPAL = '00000000-0000-7000-8000-0000000aa003'
const PHONE_NUMBER_ID = 'wa-fixture-100000000001'
const KNOWN_PHONE = '96599554433'

const sys = systemActor()
const RUN = process.hrtime.bigint().toString(36).toUpperCase().slice(-6)
let seq = 0

/** A stored Kapso receipt as the route would have written it. */
async function fileReceipt(payload: Record<string, unknown>): Promise<string> {
  seq += 1
  const [row] = await withActor(sys, (tx) =>
    tx
      .insert(inboundWebhookEvents)
      .values({ provider: 'whatsapp', externalId: `${RUN}-${seq}`, payload })
      .returning({ id: inboundWebhookEvents.id }),
  )
  return row!.id
}

/** A resolveChannel stand-in that records what the ack tried to send. */
function capturingChannel() {
  const sent: { to: string; from?: string; body: string }[] = []
  const resolve = async () => ({
    key: 'whatsapp' as const,
    async send(m: { to: string; from?: string; body: string }) {
      sent.push({ to: m.to, from: m.from, body: m.body })
      return { accepted: true, externalRef: 'wamid.ACK' }
    },
  })
  return { sent, resolve }
}

const noEnqueue = async () => {}

describe.skipIf(!enabled)('inbound whatsapp against a database', () => {
  beforeAll(async () => {
    await withActor(sys, async (tx) => {
      const [calendar] = await tx
        .select({ id: workingCalendars.id })
        .from(workingCalendars)
        .where(eq(workingCalendars.key, 'kuwait'))
        .limit(1)
      if (!calendar) throw new Error('Run `pnpm db:seed` before this suite')

      await tx
        .insert(principals)
        .values({
          id: PRINCIPAL,
          type: 'internal',
          email: 'inbound-whatsapp-fixture@qabandi.test',
          nameEn: 'Inbound WhatsApp Fixture',
        })
        .onConflictDoNothing()

      await tx
        .insert(branches)
        .values({
          id: BRANCH,
          code: 'IWB',
          legalNameEn: 'Inbound WhatsApp Branch',
          legalNameAr: 'فرع واتساب الوارد',
          country: 'KW',
          baseCurrency: 'KWD',
          invoiceSeries: 'IWB',
          calendarId: calendar.id,
        })
        .onConflictDoNothing()

      await tx
        .insert(customers)
        .values({
          id: CUSTOMER,
          code: 'CUST-INBOUND-WA',
          legalNameEn: 'Inbound WhatsApp Fixture Customer',
          primaryBranchId: BRANCH,
        })
        .onConflictDoNothing()

      /*
        The contact is matched by phone, stored with punctuation the webhook
        drops. Guarded by a select rather than `onConflictDoNothing`, because
        `customer_contacts` has no unique key to conflict on — an unguarded insert
        would add a duplicate on every run, and two contacts with this phone would
        make the phone match ambiguous (return two → null) and flake this suite.
        The email uses its own domain so it never joins the pool the email tests
        match on by domain.
      */
      const existingContact = await tx
        .select({ id: customerContacts.id })
        .from(customerContacts)
        .where(eq(customerContacts.customerId, CUSTOMER))
        .limit(1)
      if (existingContact.length === 0) {
        await tx.insert(customerContacts).values({
          customerId: CUSTOMER,
          nameEn: 'Fatima Al-Rashid',
          email: 'fatima-wa@wa-shipper.test',
          phone: '+965 9955 4433',
          isPrimary: true,
        })
      }

      await tx
        .insert(whatsappNumbers)
        .values({
          branchId: BRANCH,
          phoneNumberId: PHONE_NUMBER_ID,
          displayNumber: '+965 2200 0000',
          label: 'IWB fixture',
        })
        .onConflictDoUpdate({
          target: whatsappNumbers.phoneNumberId,
          set: { isActive: true, branchId: BRANCH },
        })
    })
  })

  afterAll(async () => {
    if (!enabled) return
    await withActor(sys, async (tx) => {
      await tx
        .update(enquiries)
        .set({ status: 'cancelled', closedAt: new Date() })
        .where(eq(enquiries.branchId, BRANCH))
      await tx
        .update(notificationOutbox)
        .set({ dispatchedAt: new Date() })
        .where(eq(notificationOutbox.branchId, BRANCH))
      await tx
        .update(whatsappNumbers)
        .set({ isActive: false })
        .where(eq(whatsappNumbers.phoneNumberId, PHONE_NUMBER_ID))
    })
  })

  it('opens an enquiry, matches the customer by phone, and acknowledges', async () => {
    const headline = `WhatsApp lane ${RUN} A`
    const eventId = await fileReceipt(
      received({
        message: { id: `wamid.${RUN}-A`, from: KNOWN_PHONE, text: { body: headline } },
        conversation: { phone_number: KNOWN_PHONE, phone_number_id: PHONE_NUMBER_ID },
        top: { phone_number_id: PHONE_NUMBER_ID },
      }),
    )

    const ack = capturingChannel()
    const result = await runInboundWhatsAppWebhook({ eventId }, AT, noEnqueue, ack.resolve)

    expect(result.outcome).toBe('created')
    expect(result.enquiryId).toBeTruthy()

    const [enquiry] = await withActor(sys, (tx) =>
      tx.select().from(enquiries).where(eq(enquiries.id, result.enquiryId!)).limit(1),
    )
    expect(enquiry!.channel).toBe('whatsapp')
    expect(enquiry!.customerId).toBe(CUSTOMER)
    expect(enquiry!.notes).toBe(headline)
    // contactEmail stays null for whatsapp — a phone does not belong in an email column.
    expect(enquiry!.contactEmail).toBeNull()

    const msgs = await withActor(sys, (tx) =>
      tx.select().from(messages).where(eq(messages.enquiryId, result.enquiryId!)),
    )
    expect(msgs).toHaveLength(1)
    expect(msgs[0]!.channel).toBe('whatsapp')
    expect(msgs[0]!.externalRef).toBe(`wamid.${RUN}-A`)

    expect(ack.sent).toHaveLength(1)
    expect(ack.sent[0]!.to).toBe(KNOWN_PHONE)
    expect(ack.sent[0]!.from).toBe(PHONE_NUMBER_ID)
    expect(ack.sent[0]!.body).toContain(enquiry!.reference)
  })

  it('opens an enquiry for an unknown sender and still acknowledges', async () => {
    const headline = `WhatsApp lane ${RUN} B`
    const eventId = await fileReceipt(
      received({
        message: { id: `wamid.${RUN}-B`, from: '96590000001', text: { body: headline } },
        conversation: { phone_number: '96590000001', phone_number_id: PHONE_NUMBER_ID },
        top: { phone_number_id: PHONE_NUMBER_ID },
      }),
    )

    const ack = capturingChannel()
    const result = await runInboundWhatsAppWebhook({ eventId }, AT, noEnqueue, ack.resolve)

    expect(result.outcome).toBe('created')
    const [enquiry] = await withActor(sys, (tx) =>
      tx.select().from(enquiries).where(eq(enquiries.id, result.enquiryId!)).limit(1),
    )
    expect(enquiry!.customerId).toBeNull()
    expect(ack.sent).toHaveLength(1)
  })

  it('skips a message on a number no branch answers on', async () => {
    const eventId = await fileReceipt(
      received({
        message: { id: `wamid.${RUN}-C` },
        conversation: { phone_number_id: 'wa-fixture-unconfigured' },
        top: { phone_number_id: 'wa-fixture-unconfigured' },
      }),
    )

    const ack = capturingChannel()
    const result = await runInboundWhatsAppWebhook({ eventId }, AT, noEnqueue, ack.resolve)

    expect(result.outcome).toBe('skipped')
    expect(result.reason).toContain('wa-fixture-unconfigured')
    expect(ack.sent).toHaveLength(0)
  })

  it('is idempotent — a re-run of a processed receipt does nothing', async () => {
    const eventId = await fileReceipt(
      received({
        message: { id: `wamid.${RUN}-D`, text: { body: `WhatsApp lane ${RUN} D` } },
        conversation: { phone_number_id: PHONE_NUMBER_ID },
        top: { phone_number_id: PHONE_NUMBER_ID },
      }),
    )

    const first = await runInboundWhatsAppWebhook(
      { eventId },
      AT,
      noEnqueue,
      capturingChannel().resolve,
    )
    expect(first.outcome).toBe('created')

    const ack = capturingChannel()
    const second = await runInboundWhatsAppWebhook({ eventId }, AT, noEnqueue, ack.resolve)
    expect(second.outcome).toBe('duplicate')
    expect(ack.sent).toHaveLength(0)
  })
})
