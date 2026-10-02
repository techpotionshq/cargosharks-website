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
import { and, eq } from 'drizzle-orm'
import {
  isOutboundEcho,
  toWhatsAppInboundMessage,
  whatsAppMediaRef,
} from './inbound-whatsapp-webhook'
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

describe('what a receipt carries besides words', () => {
  it('names the media a message carries by its id', () => {
    expect(
      whatsAppMediaRef(
        received({
          message: {
            type: 'document',
            document: { id: 'm-1', mime_type: 'application/pdf', filename: 'pl.pdf' },
          },
        }),
      ),
    ).toEqual({
      kind: 'document',
      id: 'm-1',
      mimeType: 'application/pdf',
      filename: 'pl.pdf',
      url: null,
    })
    expect(whatsAppMediaRef(received())).toBeNull()
  })

  it('takes a link Kapso already resolved onto the payload', () => {
    const ref = whatsAppMediaRef(
      received({
        message: {
          type: 'image',
          image: { id: 'm-2' },
          kapso: { direction: 'inbound', media_url: 'https://media.kapso.test/m-2' },
        },
      }),
    )
    expect(ref?.url).toBe('https://media.kapso.test/m-2')
  })

  it('tells the business’s own outbound echo from a customer’s message', () => {
    expect(isOutboundEcho(received())).toBe(false)
    expect(isOutboundEcho(received({ message: { kapso: { direction: 'outbound' } } }))).toBe(true)
    expect(isOutboundEcho(received({ top: { type: 'whatsapp.message.sent' } }))).toBe(true)
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
/** A customer whose contact number was typed the local way, with no country code. */
const LOCAL_CUSTOMER = '00000000-0000-7000-8000-0000000aa004'
const LOCAL_PHONE_STORED = '6612 3478'
const LOCAL_PHONE_E164 = '96566123478'

const sys = systemActor()
const RUN = process.hrtime.bigint().toString(36).toUpperCase().slice(-6)
let seq = 0

/*
  This run's own stretch of time.

  The loop breakers count a sender's messages and acknowledgements in windows
  of minutes and hours, and the database keeps every earlier run's rows. With
  one fixed instant for every run, the fixed fixture phone would read as
  already acknowledged on the second run and as a burst by the sixth. Each run
  gets a two-day slot of its own, far from any other run's.
*/
const RUN_AT = new Date(Date.UTC(2040, 0, 1) + (Date.now() % 10_000) * 2 * 86_400_000)
const RUN_SECONDS = Math.floor(RUN_AT.getTime() / 1000)
/** A WhatsApp timestamp `minutes` into this run's slot. */
const ts = (minutes = 0) => String(RUN_SECONDS + minutes * 60)

/** A sender number of this run's own, so nothing from an earlier run is theirs. */
const senderNo = (n: number) =>
  `9656${(Number.parseInt(RUN, 36) % 10_000).toString().padStart(4, '0')}${String(n).padStart(3, '0')}`

/** A stored Kapso receipt as the route would have written it. */
async function fileReceipt(payload: Record<string, unknown>): Promise<string> {
  seq += 1
  // The fixture's documented 2024 timestamp is shared by every run; move a
  // receipt that kept it into this run's slot.
  const message = payload.message as Record<string, unknown> | undefined
  if (message && message.timestamp === '1730092800') message.timestamp = ts(seq)
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
  const sent: { to: string; from?: string; body: string; wamid: string }[] = []
  const resolve = async () => ({
    key: 'whatsapp' as const,
    async send(m: { to: string; from?: string; body: string }) {
      // A wamid per send, as Kapso returns one: a reply quoting it must find one row.
      const wamid = `wamid.ACK-${RUN}-${(seq += 1)}`
      sent.push({ to: m.to, from: m.from, body: m.body, wamid })
      return { accepted: true, externalRef: wamid }
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
        .insert(customers)
        .values({
          id: LOCAL_CUSTOMER,
          code: 'CUST-INBOUND-WA-LOCAL',
          legalNameEn: 'Inbound WhatsApp Local Number Customer',
          primaryBranchId: BRANCH,
        })
        .onConflictDoNothing()
      const localContact = await tx
        .select({ id: customerContacts.id })
        .from(customerContacts)
        .where(eq(customerContacts.customerId, LOCAL_CUSTOMER))
        .limit(1)
      if (localContact.length === 0) {
        await tx.insert(customerContacts).values({
          customerId: LOCAL_CUSTOMER,
          nameEn: 'Salem Al-Mutairi',
          email: 'salem-wa@wa-local.test',
          phone: LOCAL_PHONE_STORED,
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
    const result = await runInboundWhatsAppWebhook({ eventId }, RUN_AT, noEnqueue, ack.resolve)

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
    // The customer's message, and our acknowledgement beside it on the thread.
    const inbound = msgs.filter((m) => m.direction === 'inbound')
    expect(inbound).toHaveLength(1)
    expect(inbound[0]!.channel).toBe('whatsapp')
    expect(inbound[0]!.externalRef).toBe(`wamid.${RUN}-A`)
    expect(msgs.filter((m) => m.direction === 'outbound')).toHaveLength(1)

    expect(ack.sent).toHaveLength(1)
    expect(ack.sent[0]!.to).toBe(KNOWN_PHONE)
    expect(ack.sent[0]!.from).toBe(PHONE_NUMBER_ID)
    expect(ack.sent[0]!.body).toContain(enquiry!.reference)

    /*
      Once, on the channel they used. A known customer's WhatsApp enquiry also
      queued the email acknowledgement, so the same customer was greeted twice —
      the second time by email, outside every WhatsApp guard.
    */
    const emailed = await withActor(sys, (tx) =>
      tx
        .select({ id: notificationOutbox.id })
        .from(notificationOutbox)
        .where(
          and(
            eq(notificationOutbox.enquiryId, result.enquiryId!),
            eq(notificationOutbox.eventKey, 'enquiry.received'),
          ),
        ),
    )
    expect(emailed).toEqual([])
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
    const result = await runInboundWhatsAppWebhook({ eventId }, RUN_AT, noEnqueue, ack.resolve)

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
    const result = await runInboundWhatsAppWebhook({ eventId }, RUN_AT, noEnqueue, ack.resolve)

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
      RUN_AT,
      noEnqueue,
      capturingChannel().resolve,
    )
    expect(first.outcome).toBe('created')

    const ack = capturingChannel()
    const second = await runInboundWhatsAppWebhook({ eventId }, RUN_AT, noEnqueue, ack.resolve)
    expect(second.outcome).toBe('duplicate')
    expect(ack.sent).toHaveLength(0)
  })

  /*
    Two runs holding one receipt — a job and its re-drive, or a redelivery that
    re-queued a job still running. Both used to pass the processed check before
    either had written, and both filed the message (V16). The receipt lock in
    `ingestMessage` lets exactly one through.
  */
  it('files a receipt once when two runs hold it at the same time', async () => {
    const sender = `9657${RUN.replace(/[^0-9]/g, '')
      .padEnd(7, '1')
      .slice(0, 7)}`
    const eventId = await fileReceipt(
      received({
        message: { id: `wamid.${RUN}-E`, from: sender, text: { body: `Race ${RUN}` } },
        conversation: { phone_number: sender, phone_number_id: PHONE_NUMBER_ID },
        top: { phone_number_id: PHONE_NUMBER_ID },
      }),
    )

    const ack = capturingChannel()
    const results = await Promise.all([
      runInboundWhatsAppWebhook({ eventId }, RUN_AT, noEnqueue, ack.resolve),
      runInboundWhatsAppWebhook({ eventId }, RUN_AT, noEnqueue, ack.resolve),
    ])

    expect(results.map((r) => r.outcome).sort()).toEqual(['created', 'duplicate'])
    const filed = await withActor(sys, (tx) =>
      tx
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.externalRef, `wamid.${RUN}-E`)),
    )
    expect(filed).toHaveLength(1)
    expect(ack.sent).toHaveLength(1)
  })

  /** One sender's message, on the fixture number, at `minutes` into the run. */
  const from = (
    sender: string,
    id: string,
    text: string,
    minutes: number,
    extra: Record<string, unknown> = {},
  ) =>
    received({
      message: { id, from: sender, text: { body: text }, timestamp: ts(minutes), ...extra },
      conversation: { phone_number: sender, phone_number_id: PHONE_NUMBER_ID },
      top: { phone_number_id: PHONE_NUMBER_ID },
    })

  const thread = (enquiryId: string) =>
    withActor(sys, (tx) => tx.select().from(messages).where(eq(messages.enquiryId, enquiryId)))

  /*
    The same wamid under a fresh idempotency key — a provider redelivering as a
    new delivery — is the same message, and files nothing a second time.
  */
  it('files a message once even when it is redelivered under a new receipt', async () => {
    const sender = senderNo(20)
    const ack = capturingChannel()
    const wamid = `wamid.${RUN}-DUP`
    const first = await runInboundWhatsAppWebhook(
      { eventId: await fileReceipt(from(sender, wamid, 'Rate for 1x20GP please', 1000)) },
      RUN_AT,
      noEnqueue,
      ack.resolve,
    )
    const second = await runInboundWhatsAppWebhook(
      { eventId: await fileReceipt(from(sender, wamid, 'Rate for 1x20GP please', 1000)) },
      RUN_AT,
      noEnqueue,
      ack.resolve,
    )
    expect(first.outcome).toBe('created')
    expect(second.outcome).toBe('duplicate')
    const rows = await withActor(sys, (tx) =>
      tx.select({ id: messages.id }).from(messages).where(eq(messages.externalRef, wamid)),
    )
    expect(rows).toHaveLength(1)
  })

  /*
    A failed acknowledgement used to leave no trace at all. It is now retried
    while the failure looks like the provider's, and recorded on the receipt
    when it still fails — with no outbound row claiming a message was sent.
  */
  it('retries a failing acknowledgement, then records why it was not sent', async () => {
    const sender = senderNo(21)
    let attempts = 0
    const failing = async () => ({
      key: 'whatsapp' as const,
      async send() {
        attempts += 1
        return { accepted: false, error: 'kapso 503: upstream unavailable' }
      },
    })
    const eventId = await fileReceipt(from(sender, `wamid.${RUN}-FAIL`, 'Quote please', 1100))
    const result = await runInboundWhatsAppWebhook(
      { eventId },
      RUN_AT,
      noEnqueue,
      failing,
      undefined,
      [0, 0],
    )
    expect(result.outcome).toBe('created')
    expect(attempts).toBe(3)
    const [receipt] = await withActor(sys, (tx) =>
      tx
        .select({ error: inboundWebhookEvents.error })
        .from(inboundWebhookEvents)
        .where(eq(inboundWebhookEvents.id, eventId)),
    )
    expect(receipt?.error).toMatch(/acknowledgement not sent after 3 attempt\(s\): kapso 503/)
    const outbound = (await thread(result.enquiryId!)).filter((m) => m.direction === 'outbound')
    expect(outbound).toEqual([])
  })

  it('does not retry an acknowledgement the provider refused as wrong', async () => {
    const sender = senderNo(22)
    let attempts = 0
    const refusing = async () => ({
      key: 'whatsapp' as const,
      async send() {
        attempts += 1
        return { accepted: false, error: 'kapso 400: recipient not on WhatsApp' }
      },
    })
    const eventId = await fileReceipt(from(sender, `wamid.${RUN}-BAD`, 'Quote please', 1200))
    await runInboundWhatsAppWebhook({ eventId }, RUN_AT, noEnqueue, refusing, undefined, [0, 0])
    expect(attempts).toBe(1)
  })

  /*
    V1. "Hi", "2x40HC", "Shanghai to Shuwaikh" as three messages used to make
    three enquiries, three SLA clocks, three model calls and three greetings.
  */
  it('threads a sender’s follow-ups onto their open enquiry and greets once', async () => {
    const sender = senderNo(1)
    const ack = capturingChannel()

    const outcomes = []
    for (const [i, text] of ['Hi', '2x40HC', 'Shanghai to Shuwaikh'].entries()) {
      const eventId = await fileReceipt(from(sender, `wamid.${RUN}-F${i}`, text, 100 + i))
      outcomes.push(await runInboundWhatsAppWebhook({ eventId }, RUN_AT, noEnqueue, ack.resolve))
    }

    expect(outcomes.map((o) => o.outcome)).toEqual(['created', 'threaded', 'threaded'])
    const enquiryId = outcomes[0]!.enquiryId!
    expect(outcomes[1]!.enquiryId).toBe(enquiryId)
    expect(outcomes[2]!.enquiryId).toBe(enquiryId)
    expect(ack.sent).toHaveLength(1)

    // The acknowledgement is on the thread, outbound, with the wamid it went out as.
    const rows = await thread(enquiryId)
    expect(rows.filter((m) => m.direction === 'inbound')).toHaveLength(3)
    const outbound = rows.filter((m) => m.direction === 'outbound')
    expect(outbound).toHaveLength(1)
    expect(outbound[0]!.externalRef).toBe(ack.sent[0]!.wamid)
    expect(outbound[0]!.toAddresses).toEqual([sender])
  })

  it('threads a reply that quotes the acknowledgement, even a day later', async () => {
    const sender = senderNo(2)
    const ack = capturingChannel()
    const first = await runInboundWhatsAppWebhook(
      { eventId: await fileReceipt(from(sender, `wamid.${RUN}-G0`, 'Need a rate', 200)) },
      RUN_AT,
      noEnqueue,
      ack.resolve,
    )
    expect(first.outcome).toBe('created')

    const reply = await runInboundWhatsAppWebhook(
      {
        eventId: await fileReceipt(
          from(sender, `wamid.${RUN}-G1`, 'Any news?', 200 + 26 * 60, {
            context: { id: ack.sent[0]!.wamid },
          }),
        ),
      },
      RUN_AT,
      noEnqueue,
      ack.resolve,
    )

    expect(reply.outcome).toBe('threaded')
    expect(reply.enquiryId).toBe(first.enquiryId)
  })

  /*
    The 195-enquiry loop, on WhatsApp: another company's auto-responder answers
    our greeting. Its answer threads; and should it open an enquiry anyway — the
    first was closed — it is not greeted a second time inside the window.
  */
  it('does not greet the same sender twice inside the window', async () => {
    const sender = senderNo(3)
    const ack = capturingChannel()
    const first = await runInboundWhatsAppWebhook(
      { eventId: await fileReceipt(from(sender, `wamid.${RUN}-H0`, 'Quote please', 300)) },
      RUN_AT,
      noEnqueue,
      ack.resolve,
    )
    expect(ack.sent).toHaveLength(1)

    await withActor(sys, (tx) =>
      tx
        .update(enquiries)
        .set({ status: 'cancelled', closedAt: RUN_AT })
        .where(eq(enquiries.id, first.enquiryId!)),
    )

    const bot = await runInboundWhatsAppWebhook(
      {
        eventId: await fileReceipt(
          from(sender, `wamid.${RUN}-H1`, 'Thank you for your message. We will reply soon.', 301),
        ),
      },
      RUN_AT,
      noEnqueue,
      ack.resolve,
    )

    expect(bot.outcome).toBe('created')
    expect(ack.sent).toHaveLength(1)
  })

  it('does not greet a sender writing faster than a person types', async () => {
    const sender = senderNo(4)
    // Six messages in the last few minutes, on an enquiry since closed and never greeted.
    await withActor(sys, async (tx) => {
      const [closed] = await tx
        .insert(enquiries)
        .values({
          reference: `IWB-BURST-${RUN}`,
          branchId: BRANCH,
          status: 'cancelled',
          channel: 'whatsapp',
        })
        .returning({ id: enquiries.id })
      await tx.insert(messages).values(
        [0, 1, 2, 3, 4, 5].map((i) => ({
          branchId: BRANCH,
          enquiryId: closed!.id,
          channel: 'whatsapp' as const,
          direction: 'inbound' as const,
          body: `auto ${i}`,
          fromAddress: sender,
          externalRef: `wamid.${RUN}-burst-${i}`,
          sentAt: new Date((RUN_SECONDS + (400 + i) * 60) * 1000),
        })),
      )
    })

    const ack = capturingChannel()
    const result = await runInboundWhatsAppWebhook(
      { eventId: await fileReceipt(from(sender, `wamid.${RUN}-I0`, 'auto 6', 407)) },
      RUN_AT,
      noEnqueue,
      ack.resolve,
    )

    expect(result.outcome).toBe('created')
    expect(ack.sent).toHaveLength(0)
  })

  /* V13: most Kuwaiti contacts are typed without the country code. */
  it('matches a contact stored as a local number to the international sender', async () => {
    const result = await runInboundWhatsAppWebhook(
      {
        eventId: await fileReceipt(
          from(LOCAL_PHONE_E164, `wamid.${RUN}-J0`, `Local number ${RUN}`, 500),
        ),
      },
      RUN_AT,
      noEnqueue,
      capturingChannel().resolve,
    )

    const [enquiry] = await withActor(sys, (tx) =>
      tx.select().from(enquiries).where(eq(enquiries.id, result.enquiryId!)).limit(1),
    )
    expect(enquiry!.customerId).toBe(LOCAL_CUSTOMER)
  })
})
