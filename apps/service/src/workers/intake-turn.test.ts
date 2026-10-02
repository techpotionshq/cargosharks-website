/**
 * The intake agent against a real database, with a fake clock and a fake model.
 *
 * Every case here is a conversation a customer could have, run end to end: the
 * webhook receipt (or the polled mail) through `ingestMessage`, the debounced
 * turn through `runIntakeTurn`, the model through the real ledger with a
 * scripted provider underneath, and the reply through a channel that records
 * what it was asked to send. What is asserted is what the customer would see
 * and what the desk would see — how many replies, saying what, in which
 * language — and how many model calls it cost.
 *
 * The model is faked at the provider, not at the extractor, on purpose: the
 * proposals, the ledger row and the merge into the enquiry are all the real
 * code, so "one model call per turn" is counted in `ai_invocations`, where the
 * bill is.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { and, eq, inArray, sql } from 'drizzle-orm'

/*
  A scripted model under the real ledger. It reads the transcript the turn sends
  and answers the facts a careful reader would — enough of a reader to drive
  completeness, and deterministic enough to assert on.
*/
const model = vi.hoisted(() => ({
  calls: [] as string[],
  documents: [] as number[],
  fail: null as null | 'transient' | 'unconfigured',
}))
vi.mock('../adapters/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../adapters/index')>()
  const fake = {
    key: 'openrouter:fake/intake-model',
    available: true,
    async complete(request: {
      messages: readonly {
        role: string
        content: readonly { type: string; text?: string; dataUri?: string }[]
      }[]
    }) {
      if (model.fail === 'unconfigured') {
        throw Object.assign(new Error('no model'), { code: 'ai.not_configured' })
      }
      const user = request.messages.find((m) => m.role === 'user')
      // A document part is read as the text it carries — the fixture PDFs are text.
      const documents = (user?.content ?? []).filter((c) => c.type !== 'text')
      model.documents.push(documents.length)
      const text = (user?.content ?? [])
        .map(
          (c) =>
            c.text ?? Buffer.from((c.dataUri ?? '').split(',')[1] ?? '', 'base64').toString('utf8'),
        )
        .join('\n')
      model.calls.push(text)
      if (model.fail === 'transient') throw new Error('provider returned 502')
      return {
        model: 'fake/intake-model',
        text: JSON.stringify({ fields: readFacts(text), confidence: 0.9 }),
        toolCalls: [],
        inputTokens: 100,
        outputTokens: 40,
        finishReason: 'stop' as const,
        raw: {},
      }
    },
    // eslint-disable-next-line require-yield
    async *stream() {
      throw new Error('not used')
    },
  }
  // The file store is the real one: `memory` is one store per process now.
  return { ...actual, modelProvider: async () => fake }
})

/** The fake reader: the facts a transcript states, as extraction entries. */
function readFacts(text: string) {
  const out: { field: string; value: string; confidence: number; evidence: null }[] = []
  const add = (field: string, value: string) =>
    out.push({ field, value, confidence: 0.9, evidence: null })
  // "2x40HC", "two 40ft", "حاويتين ٤٠ قدم عالية" — a count, a size, maybe a kind.
  const order =
    /(?:\b(\d+)\s*[x×]\s*|\b(two)\s+|(حاويتين)\s+)(20|40|٤٠|٢٠)\s*('|ft|قدم)?\s*(hc|gp|high cube|عالية)?/i.exec(
      text,
    )
  if (order) {
    add('containerCount', order[1] ?? '2')
    add('mode', 'sea_fcl')
    if (order[6]) add('containerType', `${order[4]} ${order[6]}`)
  } else if (/\b(\d+)\s*containers?\b/i.test(text)) {
    add('containerCount', /\b(\d+)\s*containers?\b/i.exec(text)![1]!)
    add('mode', 'sea_fcl')
  }
  const type = /\b(40HC|20GP|40GP)\b/i.exec(text)
  if (type && !out.some((f) => f.field === 'containerType')) add('containerType', type[1]!)
  if (/\bby air\b|air ?freight|جوي/i.test(text)) add('mode', 'air')
  // The last lane named wins, as a careful reader takes a customer's correction.
  const lane =
    [...text.matchAll(/\bfrom ([A-Z][a-z]+) to ([A-Z][a-z]+)/g)].at(-1) ??
    /\b([A-Z][a-z]+) to ([A-Z][a-z]+)\b/.exec(text)
  if (lane) {
    add('origin', lane[1]!)
    add('destination', lane[2]!)
  }
  const arLane = /من (\S+) إلى (\S+)/.exec(text)
  if (arLane) {
    add('origin', arLane[1]!)
    add('destination', arLane[2]!)
  }
  const kg = /(\d[\d,]*)\s*kg/i.exec(text)
  if (kg) add('grossWeightKg', kg[1]!.replace(/,/g, ''))
  const goods = /(furniture|ceramic tiles|spare parts|garments|أثاث)/i.exec(text)
  if (goods) add('commodity', goods[1]!)
  return out
}

// --- against a database ------------------------------------------------------

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL
process.env.FILE_STORE_DRIVER = 'memory'

const {
  aiInvocations,
  assets,
  branches,
  enquiries,
  extractionProposals,
  intakeConversations,
  intakeNotReady,
  intakeRequirements,
  intakeSettings,
  intakeTurns,
  inboundWebhookEvents,
  messageAttachments,
  messages,
  notificationOutbox,
  principals,
  systemActor,
  whatsappNumbers,
  withActor,
  workingCalendars,
  SYSTEM_PRINCIPAL_ID,
} = await import('@qabandi/db')
const { DEFAULT_INTAKE_REQUIREMENTS } = await import('@qabandi/core')
const { runInboundWhatsAppWebhook } = await import('./inbound-whatsapp-webhook')
const { kapsoMediaSource } = await import('../adapters/whatsapp')
type WhatsAppMediaSource = import('../adapters/whatsapp').WhatsAppMediaSource
const { ingestMessage } = await import('./inbound-mail')
const { runIntakeTurn, transcript, withoutQuotedHistory } = await import('./intake-turn')
const { extractEnquiry } = await import('./enquiry-extract')
const { sendEnquiryReply } = await import('./enquiry-reply')

const BRANCH = '00000000-0000-7000-8000-0000000f1001'
const STAFF = '00000000-0000-7000-8000-0000000f1003'
const STAFF_EMAIL = 'intake-desk@intake-fixture.test'
const PHONE_NUMBER_ID = 'wa-intake-fixture-0001'
const MAILBOX = 'intake-fixture@qabandi.test'
const sys = systemActor()
const RUN = process.hrtime.bigint().toString(36).toUpperCase().slice(-6)
let seq = 0

/*
  This run's own stretch of time, as `inbound-whatsapp-webhook.test.ts` does:
  the sender-level loop breakers count across enquiries in windows of hours,
  and the database keeps every earlier run's rows.
*/
const RUN_AT = new Date(Date.UTC(2041, 0, 1) + (Date.now() % 10_000) * 3 * 86_400_000)
const at = (seconds: number) => new Date(RUN_AT.getTime() + seconds * 1000)
const HOUR = 3600

let senders = 0
const newSender = () =>
  `9657${(Number.parseInt(RUN, 36) % 10_000).toString().padStart(4, '0')}${String((senders += 1)).padStart(3, '0')}`

/** A channel stand-in that records sends and hands back a provider id. */
function recorder(key: 'whatsapp' | 'email') {
  const sent: {
    to: string
    from?: string
    subject?: string
    body: string
    locale: string
    inReplyTo?: string
    ref: string
  }[] = []
  const resolve = async () => ({
    key,
    async send(m: {
      to: string
      from?: string
      subject?: string
      body: string
      locale: 'en' | 'ar'
      inReplyTo?: string
    }) {
      const ref =
        key === 'whatsapp'
          ? `wamid.OUT-${RUN}-${(seq += 1)}`
          : `<out-${RUN}-${(seq += 1)}@qabandi.test>`
      sent.push({ ...m, ref })
      return { accepted: true, externalRef: ref }
    },
  })
  return { sent, resolve }
}

const noEnqueue = async () => {}
const nudges: { conversationId: string; dueAt: Date }[] = []
const nudge = async (n: { conversationId: string; dueAt: Date }) => {
  nudges.push(n)
}

/** One WhatsApp message from `sender`, `seconds` into the run, through the real webhook worker. */
async function say(
  sender: string,
  body: string,
  seconds: number,
  ack = recorder('whatsapp'),
  extra: Record<string, unknown> = {},
  resolveMedia: () => Promise<WhatsAppMediaSource | null> = async () => null,
) {
  seq += 1
  const wamid = `wamid.IN-${RUN}-${seq}`
  const [event] = await withActor(sys, (tx) =>
    tx
      .insert(inboundWebhookEvents)
      .values({
        provider: 'whatsapp',
        externalId: `${RUN}-intake-${seq}`,
        payload: {
          message: {
            id: wamid,
            timestamp: String(Math.floor(at(seconds).getTime() / 1000)),
            type: 'text',
            from: sender,
            text: { body },
            kapso: { direction: 'inbound' },
            ...extra,
          },
          conversation: { phone_number: sender, phone_number_id: PHONE_NUMBER_ID },
          phone_number_id: PHONE_NUMBER_ID,
        },
      })
      .returning({ id: inboundWebhookEvents.id }),
  )
  const result = await runInboundWhatsAppWebhook(
    { eventId: event!.id },
    at(seconds),
    noEnqueue,
    ack.resolve,
    nudge,
    undefined,
    resolveMedia,
  )
  return { ...result, eventId: event!.id, wamid }
}

async function conversationFor(enquiryId: string) {
  const [row] = await withActor(sys, (tx) =>
    tx
      .select()
      .from(intakeConversations)
      .where(eq(intakeConversations.enquiryId, enquiryId))
      .limit(1),
  )
  return row!
}

async function turnsFor(conversationId: string) {
  return withActor(sys, (tx) =>
    tx
      .select()
      .from(intakeTurns)
      .where(eq(intakeTurns.conversationId, conversationId))
      .orderBy(intakeTurns.createdAt),
  )
}

async function invocationsFor(enquiryId: string) {
  const [row] = await withActor(sys, (tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(aiInvocations)
      .where(eq(aiInvocations.enquiryId, enquiryId)),
  )
  return row!.n
}

async function openProposalFields(enquiryId: string): Promise<string[]> {
  const rows = await withActor(sys, (tx) =>
    tx
      .select({ field: extractionProposals.field })
      .from(extractionProposals)
      .where(
        and(
          eq(extractionProposals.targetId, enquiryId),
          eq(extractionProposals.status, 'proposed'),
        ),
      ),
  )
  return rows.map((r) => r.field)
}

async function isHeld(enquiryId: string): Promise<boolean> {
  const [row] = await withActor(sys, (tx) =>
    tx
      .select({ held: sql<boolean>`${intakeNotReady(enquiries.id)}` })
      .from(enquiries)
      .where(eq(enquiries.id, enquiryId)),
  )
  return row!.held
}

describe('the transcript a turn sends', () => {
  it('numbers every customer message, oldest first, without quoted history', () => {
    const text = transcript('KWI-ENQ-1', 'email', [
      { subject: 'RFQ', body: 'Two 40HC please' },
      { subject: 'Re: RFQ', body: 'Furniture.\n\nOn Tue, Desk wrote:\n> Which goods?' },
    ])
    expect(text).toContain('[1] Subject: RFQ\nTwo 40HC please')
    expect(text).toContain('[2] Subject: Re: RFQ\nFurniture.')
    expect(text).not.toContain('Which goods?')
  })

  it('drops the oldest messages first when the conversation is too long', () => {
    const long = Array.from({ length: 40 }, (_, i) => ({
      subject: null,
      body: `${i} ${'x'.repeat(1000)}`,
    }))
    const text = transcript('R', 'whatsapp', long)
    expect(text).toContain('[earlier messages omitted]')
    expect(text).toContain('[40] 39')
    expect(text).not.toContain('[1] 0')
  })

  it('cuts a forwarded original as well as a quoted one', () => {
    expect(withoutQuotedHistory('Yes 3\n-----Original Message-----\nFrom: x')).toBe('Yes 3')
  })
})

describe.skipIf(!enabled)('the intake agent against a database', () => {
  beforeAll(async () => {
    await withActor(sys, async (tx) => {
      const [calendar] = await tx
        .select({ id: workingCalendars.id })
        .from(workingCalendars)
        .where(eq(workingCalendars.key, 'kuwait'))
        .limit(1)
      if (!calendar) throw new Error('Run `pnpm db:seed` before this suite')

      await tx
        .insert(branches)
        .values({
          id: BRANCH,
          code: 'ITK',
          legalNameEn: 'Intake Fixture Branch',
          legalNameAr: 'فرع الاستقبال التجريبي',
          country: 'KW',
          baseCurrency: 'KWD',
          invoiceSeries: 'ITK',
          calendarId: calendar.id,
        })
        .onConflictDoNothing()

      await tx
        .insert(principals)
        .values({ id: STAFF, type: 'internal', email: STAFF_EMAIL, nameEn: 'Intake Desk' })
        .onConflictDoNothing()

      await tx
        .insert(whatsappNumbers)
        .values({
          branchId: BRANCH,
          phoneNumberId: PHONE_NUMBER_ID,
          displayNumber: '+965 2200 1234',
          label: 'ITK fixture',
        })
        .onConflictDoUpdate({
          target: whatsappNumbers.phoneNumberId,
          set: { isActive: true, branchId: BRANCH, displayNumber: '+965 2200 1234' },
        })

      // The agent on, for this branch only, with the shipped defaults otherwise.
      await tx
        .insert(intakeSettings)
        .values({ branchId: BRANCH, enabled: true })
        .onConflictDoUpdate({
          target: intakeSettings.branchId,
          set: {
            enabled: true,
            whatsappQuietSeconds: 120,
            whatsappMaxWaitSeconds: 600,
            emailQuietSeconds: 60,
            emailMaxWaitSeconds: 600,
            clarifyCooldownHours: 6,
            clarifyCap: 2,
            humanTakeoverHours: 12,
          },
        })

      // Its own requirement rows — a test does not assume the seed ran.
      const [existing] = await tx
        .select({ id: intakeRequirements.id })
        .from(intakeRequirements)
        .where(eq(intakeRequirements.branchId, BRANCH))
        .limit(1)
      if (!existing) {
        await tx.insert(intakeRequirements).values(
          DEFAULT_INTAKE_REQUIREMENTS.map((r, position) => ({
            branchId: BRANCH,
            mode: r.mode,
            key: r.key,
            fields: [...r.fields],
            position,
          })),
        )
      }
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
        .update(intakeConversations)
        .set({ turnDueAt: null })
        .where(eq(intakeConversations.branchId, BRANCH))
      await tx
        .update(whatsappNumbers)
        .set({ isActive: false })
        .where(eq(whatsappNumbers.phoneNumberId, PHONE_NUMBER_ID))
    })
  })

  it('waits for five quick messages, then answers once with one model call', async () => {
    const sender = newSender()
    const ack = recorder('whatsapp')
    const wa = recorder('whatsapp')
    model.calls.length = 0

    const lines = [
      'Hi',
      'I need a quotation please',
      '2x40HC',
      'from Shanghai to Shuwaikh',
      'furniture',
    ]
    const results = []
    for (const [i, line] of lines.entries()) results.push(await say(sender, line, 10 * i, ack))
    const enquiryId = results[0]!.enquiryId!
    expect(results.map((r) => r.outcome)).toEqual([
      'created',
      'threaded',
      'threaded',
      'threaded',
      'threaded',
    ])
    expect(results.every((r) => r.enquiryId === enquiryId)).toBe(true)

    // No acknowledgement: the agent answers once the customer stops.
    expect(ack.sent).toHaveLength(0)

    const conversation = await conversationFor(enquiryId)
    // Quiet window after the last message, at 40 s: due at 160 s.
    expect(conversation.turnDueAt?.getTime()).toBe(at(160).getTime())
    expect(nudges.at(-1)?.dueAt.getTime()).toBe(at(160).getTime())

    // Before it is due, nothing happens.
    expect(
      (await runIntakeTurn(conversation.id, at(100), { resolveWhatsApp: wa.resolve })).outcome,
    ).toBe('not_due')

    const turn = await runIntakeTurn(conversation.id, at(161), { resolveWhatsApp: wa.resolve })
    expect(turn.outcome).toBe('decided')
    expect(turn.decision?.action).toBe('confirm')
    expect(model.calls).toHaveLength(1)
    expect(model.calls[0]).toContain('[5] furniture')
    expect(await invocationsFor(enquiryId)).toBe(1)
    expect(wa.sent).toHaveLength(1)
    expect(wa.sent[0]!.to).toBe(sender)
    expect(wa.sent[0]!.from).toBe(PHONE_NUMBER_ID)
    expect(wa.sent[0]!.body).toContain('we have everything we need')

    // The reply is on the thread, by the agent, with the provider's id.
    const [reply] = await withActor(sys, (tx) =>
      tx
        .select()
        .from(messages)
        .where(and(eq(messages.enquiryId, enquiryId), eq(messages.direction, 'outbound'))),
    )
    expect(reply?.externalRef).toBe(wa.sent[0]!.ref)
    expect(reply?.authorId).toBe(SYSTEM_PRINCIPAL_ID)
    // Sent by the provider's id; recorded from the number the customer sees.
    expect(reply?.fromAddress).toBe('+965 2200 1234')

    const after = await conversationFor(enquiryId)
    expect(after.state).toBe('complete')
    expect(after.readyAt).not.toBeNull()
    expect(after.turnDueAt).toBeNull()
    expect(after.turns).toBe(1)
    expect(after.modelCalls).toBe(1)
    expect(await isHeld(enquiryId)).toBe(false)

    // A duplicate wake-up for the same moment finds nothing to do.
    expect(
      (await runIntakeTurn(conversation.id, at(162), { resolveWhatsApp: wa.resolve })).outcome,
    ).toBe('not_due')

    // "thanks 👍" after the confirmation: a turn, no model call, no reply.
    await say(sender, 'thanks 👍', 300, ack)
    const thanks = await runIntakeTurn(conversation.id, at(500), { resolveWhatsApp: wa.resolve })
    expect(thanks.decision?.reason).toBe('chit_chat')
    expect(model.calls).toHaveLength(1)
    expect(wa.sent).toHaveLength(1)
  })

  it('asks once for exactly what is missing, then confirms and releases the pipeline', async () => {
    const sender = newSender()
    const wa = recorder('whatsapp')
    model.calls.length = 0

    const first = await say(sender, 'Need a rate for 2 containers from Ningbo to Kuwait', 0)
    const enquiryId = first.enquiryId!
    const { id } = await conversationFor(enquiryId)

    // Held from the moment it arrives: nothing downstream may act yet.
    expect(await isHeld(enquiryId)).toBe(true)

    const asked = await runIntakeTurn(id, at(130), { resolveWhatsApp: wa.resolve })
    expect(asked.decision).toEqual({ action: 'clarify', reason: 'clarified', markReady: false })
    expect(asked.missing).toEqual(['commodity', 'containerType'])
    expect(wa.sent).toHaveLength(1)
    expect(wa.sent[0]!.body).toBe(
      `Thank you — to prepare your quotation (${await reference(enquiryId)}) we still need what the cargo is and the container type (20', 40' or 40' high cube). — Intake Fixture Branch`,
    )
    expect((await conversationFor(enquiryId)).state).toBe('awaiting_customer')
    expect(await isHeld(enquiryId)).toBe(true)

    // The customer answers, quoting our message.
    const answer = await say(sender, '40HC, spare parts', 600, undefined, {
      context: { id: wa.sent[0]!.ref },
    })
    expect(answer.enquiryId).toBe(enquiryId)
    const done = await runIntakeTurn(id, at(800), { resolveWhatsApp: wa.resolve })
    expect(done.decision?.action).toBe('confirm')
    expect(wa.sent).toHaveLength(2)
    expect(model.calls).toHaveLength(2)
    expect(model.calls[1]).toContain('[1] Need a rate')
    expect(model.calls[1]).toContain('[2] 40HC, spare parts')
    expect(await isHeld(enquiryId)).toBe(false)
  })

  it('waits out the cooldown, asks a second time, and then hands to a person', async () => {
    const sender = newSender()
    const wa = recorder('whatsapp')
    const first = await say(sender, 'Quote please for 3 containers to Kuwait', 0)
    const enquiryId = first.enquiryId!
    const { id } = await conversationFor(enquiryId)

    expect(
      (await runIntakeTurn(id, at(130), { resolveWhatsApp: wa.resolve })).decision?.action,
    ).toBe('clarify')

    // Inside the cooldown: read, but not asked again.
    await say(sender, 'It is quite urgent for us', 2 * HOUR)
    const cooling = await runIntakeTurn(id, at(2 * HOUR + 130), { resolveWhatsApp: wa.resolve })
    expect(cooling.decision?.reason).toBe('cooldown')
    expect(cooling.modelCalled).toBe(true)
    expect(wa.sent).toHaveLength(1)

    // Past it, the customer writes again: the second and last clarification.
    await say(sender, 'Please send the price today', 7 * HOUR)
    expect(
      (await runIntakeTurn(id, at(7 * HOUR + 130), { resolveWhatsApp: wa.resolve })).decision
        ?.action,
    ).toBe('clarify')
    expect(wa.sent).toHaveLength(2)

    // A third time: no message — a person is told instead.
    await say(sender, 'Hello?? any update on my request', 14 * HOUR)
    const handed = await runIntakeTurn(id, at(14 * HOUR + 130), { resolveWhatsApp: wa.resolve })
    expect(handed.decision).toEqual({ action: 'handoff', reason: 'cap_reached', markReady: false })
    expect(wa.sent).toHaveLength(2)
    const conversation = await conversationFor(enquiryId)
    expect(conversation.state).toBe('handed_off')
    expect(conversation.clarifications).toBe(2)
    const outbox = await withActor(sys, (tx) =>
      tx
        .select({ payload: notificationOutbox.payload })
        .from(notificationOutbox)
        .where(
          and(
            eq(notificationOutbox.enquiryId, enquiryId),
            eq(notificationOutbox.eventKey, 'intake.handoff'),
          ),
        ),
    )
    expect(outbox).toHaveLength(1)
    expect((outbox[0]!.payload as Record<string, string>).missing).toContain('where it ships from')
    expect((outbox[0]!.payload as Record<string, string>).missingAr).toContain('مكان التحميل')

    // And after that it stays silent.
    await say(sender, 'hello', 15 * HOUR)
    await say(sender, 'Is anyone there? I need 3 containers', 15 * HOUR + 5)
    const after = await runIntakeTurn(id, at(15 * HOUR + 200), { resolveWhatsApp: wa.resolve })
    expect(after.decision?.reason).toBe('handed_off')
    expect(wa.sent).toHaveLength(2)
  })

  it('lets a later message correct a fact an earlier turn proposed', async () => {
    const sender = newSender()
    const wa = recorder('whatsapp')
    const first = await say(sender, 'Need 2x40HC furniture from China to Kuwait', 0)
    const enquiryId = first.enquiryId!
    const { id } = await conversationFor(enquiryId)
    await runIntakeTurn(id, at(130), { resolveWhatsApp: wa.resolve })

    await say(sender, 'Sorry, I mean from Shanghai to Shuwaikh', 2 * HOUR)
    await runIntakeTurn(id, at(2 * HOUR + 130), { resolveWhatsApp: wa.resolve })

    const rows = await withActor(sys, (tx) =>
      tx
        .select({
          field: extractionProposals.field,
          value: extractionProposals.value,
          status: extractionProposals.status,
          decidedById: extractionProposals.decidedById,
        })
        .from(extractionProposals)
        .where(
          and(
            eq(extractionProposals.targetId, enquiryId),
            inArray(extractionProposals.field, ['origin', 'destination', 'commodity']),
          ),
        )
        .orderBy(extractionProposals.createdAt),
    )
    const of = (field: string) =>
      rows.filter((r) => r.field === field).map((r) => [r.value, r.status])
    // The first answer is kept as history, closed by the newer read; one open answer each.
    expect(of('origin')).toEqual([
      ['China', 'superseded'],
      ['Shanghai', 'proposed'],
    ])
    expect(of('destination')).toEqual([
      ['Kuwait', 'superseded'],
      ['Shuwaikh', 'proposed'],
    ])
    // An answer read again unchanged is neither duplicated nor superseded.
    expect(of('commodity')).toEqual([['furniture', 'proposed']])
    expect(rows.find((r) => r.status === 'superseded')?.decidedById).toBe(SYSTEM_PRINCIPAL_ID)
  })

  it('answers neither a greeting alone nor anything once a person has replied', async () => {
    const sender = newSender()
    const wa = recorder('whatsapp')
    model.calls.length = 0
    const first = await say(sender, 'السلام عليكم', 0)
    const enquiryId = first.enquiryId!
    const { id } = await conversationFor(enquiryId)

    const greeting = await runIntakeTurn(id, at(130), { resolveWhatsApp: wa.resolve })
    expect(greeting.decision?.reason).toBe('chit_chat')
    expect(model.calls).toHaveLength(0)
    expect(wa.sent).toHaveLength(0)

    // A coordinator writes to the customer from the product.
    await withActor(sys, (tx) =>
      tx.insert(messages).values({
        branchId: BRANCH,
        enquiryId,
        channel: 'whatsapp',
        direction: 'outbound',
        body: 'Hello, this is Sara from the desk.',
        authorId: STAFF,
        toAddresses: [sender],
        sentAt: at(200),
      }),
    )
    await say(sender, 'I need 2 containers from Ningbo to Kuwait', 300)
    const human = await runIntakeTurn(id, at(450), { resolveWhatsApp: wa.resolve })
    expect(human.decision?.reason).toBe('human_active')
    expect(wa.sent).toHaveLength(0)
    // Still read, so the person who took over has the customer's facts proposed.
    expect(human.modelCalled).toBe(true)
    expect(model.calls).toHaveLength(1)
    expect(await openProposalFields(enquiryId)).toEqual(
      expect.arrayContaining(['origin', 'destination', 'containerCount']),
    )
  })

  /*
    D5: a reply sent from the enquiry screen is the coordinator's, not the
    agent's. It goes out from the branch number, files under their own id and
    stamps the conversation, so the agent's next turn stays silent.
  */
  it('stands down after a coordinator replies from the enquiry screen', async () => {
    const sender = newSender()
    const wa = recorder('whatsapp')
    const first = await say(sender, 'السلام عليكم', 0)
    const enquiryId = first.enquiryId!
    const { id } = await conversationFor(enquiryId)

    const sent = await sendEnquiryReply(
      {
        actor: { principalId: STAFF, type: 'internal', branchIds: [BRANCH] },
        enquiryId,
        body: 'Hello, this is the desk. How can we help?',
        asOf: at(60),
      },
      { resolveWhatsApp: wa.resolve, sendDelays: [] },
    )
    expect(sent.ok).toBe(true)
    expect(wa.sent).toHaveLength(1)
    expect(wa.sent[0]).toMatchObject({ to: sender, from: PHONE_NUMBER_ID })

    const [filed] = await withActor(sys, (tx) =>
      tx
        .select({
          authorId: messages.authorId,
          fromAddress: messages.fromAddress,
          externalRef: messages.externalRef,
        })
        .from(messages)
        .where(and(eq(messages.enquiryId, enquiryId), eq(messages.direction, 'outbound'))),
    )
    expect(filed).toMatchObject({
      authorId: STAFF,
      fromAddress: '+965 2200 1234',
      externalRef: wa.sent[0]!.ref,
    })
    expect((await conversationFor(enquiryId)).lastStaffActivityAt?.getTime()).toBe(at(60).getTime())

    await say(sender, 'I need 2 containers from Ningbo to Kuwait', 120)
    const turn = await runIntakeTurn(id, at(300), { resolveWhatsApp: wa.resolve })
    expect(turn.decision?.reason).toBe('human_active')
    expect(wa.sent).toHaveLength(1)
  })

  it('stays quiet once an operator takes over, without spending a model call', async () => {
    const sender = newSender()
    const wa = recorder('whatsapp')
    const first = await say(sender, 'Rate for 1x20GP Jebel to Kuwait', 0)
    const enquiryId = first.enquiryId!
    const { id } = await conversationFor(enquiryId)
    await withActor(sys, (tx) =>
      tx
        .update(intakeConversations)
        .set({ agentEnabled: false, agentToggledById: STAFF, agentToggledAt: at(10) })
        .where(eq(intakeConversations.id, id)),
    )
    model.calls.length = 0
    const turn = await runIntakeTurn(id, at(130), { resolveWhatsApp: wa.resolve })
    expect(turn.decision?.reason).toBe('agent_off')
    expect(model.calls).toHaveLength(0)
    expect(wa.sent).toHaveLength(0)
    // An operator who took over owns the pipeline too.
    expect(await isHeld(enquiryId)).toBe(false)
  })

  it('withdraws its reply when the agent is switched off while the model reads', async () => {
    const sender = newSender()
    const wa = recorder('whatsapp')
    const first = await say(sender, 'Need a rate for 2 containers from Ningbo to Kuwait', 0)
    const { id } = await conversationFor(first.enquiryId!)

    // The coordinator's switch lands between the decision to read and the send.
    const turn = await runIntakeTurn(id, at(130), {
      resolveWhatsApp: wa.resolve,
      extract: async (input) => {
        await withActor(sys, (tx) =>
          tx
            .update(intakeConversations)
            .set({ agentEnabled: false, agentToggledById: STAFF, agentToggledAt: at(131) })
            .where(eq(intakeConversations.id, id)),
        )
        return extractEnquiry(input)
      },
    })
    expect(turn.decision?.reason).toBe('agent_off')
    expect(wa.sent).toHaveLength(0)
  })

  it('withdraws its reply when a person answers while the model reads', async () => {
    const sender = newSender()
    const wa = recorder('whatsapp')
    const first = await say(sender, 'Need a rate for 2 containers from Ningbo to Kuwait', 0)
    const { id } = await conversationFor(first.enquiryId!)

    const turn = await runIntakeTurn(id, at(130), {
      resolveWhatsApp: wa.resolve,
      extract: async (input) => {
        await withActor(sys, (tx) =>
          tx
            .update(intakeConversations)
            .set({ lastStaffActivityAt: at(131) })
            .where(eq(intakeConversations.id, id)),
        )
        return extractEnquiry(input)
      },
    })
    expect(turn.decision?.reason).toBe('human_active')
    expect(wa.sent).toHaveLength(0)
  })

  it('never holds a conversation with an auto-responder', async () => {
    const sender = newSender()
    const wa = recorder('whatsapp')
    const first = await say(sender, 'Price for 2 containers Ningbo to Kuwait?', 0)
    const enquiryId = first.enquiryId!
    const { id } = await conversationFor(enquiryId)
    expect(
      (await runIntakeTurn(id, at(130), { resolveWhatsApp: wa.resolve })).decision?.action,
    ).toBe('clarify')
    model.calls.length = 0

    // Their bot answers our clarification, instantly and then again.
    await say(
      sender,
      'Thank you for contacting Gulf Traders. We will get back to you shortly.',
      131,
    )
    const bot = await runIntakeTurn(id, at(400), { resolveWhatsApp: wa.resolve })
    expect(bot.decision?.reason).toBe('automatic')
    expect(model.calls).toHaveLength(0)

    await say(
      sender,
      'Thank you for contacting Gulf Traders. We will get back to you shortly.',
      7 * HOUR,
    )
    expect(
      (await runIntakeTurn(id, at(7 * HOUR + 200), { resolveWhatsApp: wa.resolve })).decision
        ?.reason,
    ).toBe('automatic')
    expect(wa.sent).toHaveLength(1)
    expect(model.calls).toHaveLength(0)
  })

  it('treats an instant reply as a machine', async () => {
    const sender = newSender()
    const wa = recorder('whatsapp')
    const first = await say(sender, 'Need 2 containers Busan to Kuwait', 0)
    const { id } = await conversationFor(first.enquiryId!)
    await runIntakeTurn(id, at(130), { resolveWhatsApp: wa.resolve })
    expect(wa.sent).toHaveLength(1)
    model.calls.length = 0
    // Two seconds after our clarification went out at 130 s.
    await say(sender, 'Your message has been received, our agent Ahmad will handle it', 132)
    const turn = await runIntakeTurn(id, at(400), { resolveWhatsApp: wa.resolve })
    expect(turn.decision?.reason).toBe('automatic')
    expect(model.calls).toHaveLength(0)
  })

  it('runs one turn when two workers race for it, and survives a crashed one', async () => {
    const sender = newSender()
    const wa = recorder('whatsapp')
    const first = await say(sender, 'Air freight 300 kg spare parts from Dubai to Kuwait by air', 0)
    const enquiryId = first.enquiryId!
    const { id } = await conversationFor(enquiryId)
    model.calls.length = 0

    // A redelivery of the same receipt files nothing.
    const again = await runInboundWhatsAppWebhook(
      { eventId: first.eventId },
      at(1),
      noEnqueue,
      wa.resolve,
      nudge,
    )
    expect(again.outcome).toBe('duplicate')

    // A worker that claimed the turn and died: its lease is still live.
    await withActor(sys, (tx) =>
      tx
        .update(intakeConversations)
        .set({ claimedUntil: at(400), claimToken: '00000000-0000-4000-8000-000000000001' })
        .where(eq(intakeConversations.id, id)),
    )
    expect((await runIntakeTurn(id, at(200), { resolveWhatsApp: wa.resolve })).outcome).toBe(
      'not_due',
    )

    // Once the lease expires, two instances race; exactly one decides.
    const [a, b] = await Promise.all([
      runIntakeTurn(id, at(401), { resolveWhatsApp: wa.resolve }),
      runIntakeTurn(id, at(401), { resolveWhatsApp: wa.resolve }),
    ])
    expect([a.outcome, b.outcome].sort()).toEqual(['decided', 'not_due'])
    expect(model.calls).toHaveLength(1)
    expect(wa.sent).toHaveLength(1)
    expect(wa.sent[0]!.body).toContain('we have everything')
    expect(await turnsFor(id)).toHaveLength(1)

    // The losing worker, retried, finds nothing left to do.
    expect((await runIntakeTurn(id, at(500), { resolveWhatsApp: wa.resolve })).outcome).toBe(
      'not_due',
    )
    expect(await turnsFor(id)).toHaveLength(1)
  })

  it('retries a failing model a bounded number of times, then stays silent', async () => {
    const sender = newSender()
    const wa = recorder('whatsapp')
    const first = await say(sender, 'Need 2 containers Ningbo to Kuwait', 0)
    const { id } = await conversationFor(first.enquiryId!)
    model.fail = 'transient'
    try {
      expect((await runIntakeTurn(id, at(130), { resolveWhatsApp: wa.resolve })).outcome).toBe(
        'retry',
      )
      const c1 = await conversationFor(first.enquiryId!)
      expect(c1.turnDueAt?.getTime()).toBe(at(130 + 60).getTime())
      expect((await runIntakeTurn(id, at(200), { resolveWhatsApp: wa.resolve })).outcome).toBe(
        'retry',
      )
      const last = await runIntakeTurn(id, at(400), { resolveWhatsApp: wa.resolve })
      expect(last.decision?.reason).toBe('model_unavailable')
      expect(wa.sent).toHaveLength(0)
    } finally {
      model.fail = null
    }
  })

  it('answers an Arabic conversation in Arabic', async () => {
    const sender = newSender()
    const wa = recorder('whatsapp')
    const first = await say(sender, 'مرحبا، عندي حاويتين ٤٠ قدم عالية من شنغهاي إلى الكويت', 0)
    const enquiryId = first.enquiryId!
    const { id } = await conversationFor(enquiryId)
    const turn = await runIntakeTurn(id, at(130), { resolveWhatsApp: wa.resolve })
    expect(turn.decision?.action).toBe('clarify')
    expect(turn.missing).toEqual(['commodity'])
    expect(wa.sent[0]!.locale).toBe('ar')
    expect(wa.sent[0]!.body).toContain('نحتاج أيضاً إلى نوع البضاعة')
    expect(wa.sent[0]!.body).toContain('فرع الاستقبال التجريبي')
    expect((await conversationFor(enquiryId)).locale).toBe('ar')

    await say(sender, 'أثاث منزلي', 900)
    await runIntakeTurn(id, at(1100), { resolveWhatsApp: wa.resolve })
    expect(wa.sent[1]!.body).toContain('وصلتنا كل التفاصيل')
  })

  it('caps the agent’s messages to one sender across enquiries', async () => {
    const sender = newSender()
    const wa = recorder('whatsapp')
    // Four agent messages to this sender earlier today, on enquiries since closed.
    await withActor(sys, async (tx) => {
      for (let i = 0; i < 4; i += 1) {
        await tx.insert(messages).values({
          branchId: BRANCH,
          channel: 'whatsapp',
          direction: 'outbound',
          body: 'earlier agent message',
          authorId: SYSTEM_PRINCIPAL_ID,
          toAddresses: [sender],
          sentAt: at(-HOUR + i),
        })
      }
    })
    const first = await say(sender, 'Need 2 containers Ningbo to Kuwait', 0)
    const { id } = await conversationFor(first.enquiryId!)
    model.calls.length = 0
    const turn = await runIntakeTurn(id, at(130), { resolveWhatsApp: wa.resolve })
    expect(turn.decision?.reason).toBe('loop_guard')
    expect(wa.sent).toHaveLength(0)
    expect(model.calls).toHaveLength(0)
  })

  it('counts replies the provider refused toward the caps, and records each failure', async () => {
    const sender = newSender()
    let attempts = 0
    // Kapso refusing every message, as Meta does outside the 24-hour window.
    const refusing = async () => ({
      key: 'whatsapp' as const,
      async send() {
        attempts += 1
        return { accepted: false, error: 'Kapso 422: outside the 24h window' }
      },
    })
    const deps = { resolveWhatsApp: refusing, sendDelays: [] }

    // One enquiry: asked, refused; asked again after the cooldown, refused; then a person.
    const first = await say(sender, 'Need 2 containers Ningbo to Kuwait', 0)
    const { id } = await conversationFor(first.enquiryId!)
    const one = await runIntakeTurn(id, at(130), deps)
    expect(one.decision?.action).toBe('clarify')
    expect(one.sendError).toContain('422')
    await say(sender, 'Still need that rate please', 7 * HOUR)
    expect((await runIntakeTurn(id, at(7 * HOUR + 130), deps)).decision?.action).toBe('clarify')
    await say(sender, 'Hello? Any rate for the Ningbo boxes', 14 * HOUR)
    expect((await runIntakeTurn(id, at(14 * HOUR + 130), deps)).decision?.action).toBe('handoff')
    const turns = await turnsFor(id)
    // Each refused reply is on its turn for the desk to see, with no message filed.
    expect(turns.filter((t) => t.sendError?.includes('422'))).toHaveLength(2)
    expect(turns.every((t) => t.replyMessageId === null)).toBe(true)

    /*
      Two more enquiries from the same sender, each asked and refused: four in a
      day. WhatsApp threads a sender onto their open enquiry, so each is closed
      before the next opens.
    */
    const close = (enquiryId: string) =>
      withActor(sys, (tx) =>
        tx
          .update(enquiries)
          .set({ status: 'cancelled', closedAt: new Date() })
          .where(eq(enquiries.id, enquiryId)),
      )
    let previous = first.enquiryId!
    for (const [i, lane] of ['Busan to Kuwait', 'Qingdao to Kuwait'].entries()) {
      await close(previous)
      const start = 15 * HOUR + i * HOUR
      const next = await say(sender, `Also 3 containers ${lane}`, start)
      expect(next.enquiryId).not.toBe(previous)
      previous = next.enquiryId!
      const c = await conversationFor(previous)
      expect((await runIntakeTurn(c.id, at(start + 130), deps)).decision?.action).toBe('clarify')
    }
    await close(previous)
    expect(attempts).toBe(4)

    // The fifth is stopped by the daily cap, although nothing was ever delivered.
    const fifth = await say(sender, 'And 1 container Xiamen to Kuwait', 18 * HOUR)
    const c5 = await conversationFor(fifth.enquiryId!)
    const capped = await runIntakeTurn(c5.id, at(18 * HOUR + 130), deps)
    expect(capped.decision?.reason).toBe('loop_guard')
    expect(attempts).toBe(4)
  })

  it('spends no model call on a sender writing in a burst', async () => {
    const sender = newSender()
    const wa = recorder('whatsapp')
    const first = await say(sender, 'Need 2 containers Ningbo to Kuwait', 0)
    const enquiryId = first.enquiryId!
    for (let i = 1; i <= 21; i += 1) await say(sender, `Line ${i} of the order sheet`, i * 5)
    const { id } = await conversationFor(enquiryId)
    model.calls.length = 0
    const turn = await runIntakeTurn(id, at(400), { resolveWhatsApp: wa.resolve })
    expect(turn.decision?.reason).toBe('loop_guard')
    expect(turn.modelCalled).toBe(false)
    expect(model.calls).toHaveLength(0)
    expect(await invocationsFor(enquiryId)).toBe(0)
    expect(wa.sent).toHaveLength(0)
  })

  /** A Kapso `whatsapp.message.sent` echo — the business writing to `to`. */
  async function echo(
    to: string,
    body: string,
    seconds: number,
    asOfSeconds: number,
    wamid?: string,
  ) {
    seq += 1
    const id = wamid ?? `wamid.STAFF-${RUN}-${seq}`
    const [event] = await withActor(sys, (tx) =>
      tx
        .insert(inboundWebhookEvents)
        .values({
          provider: 'whatsapp',
          externalId: `${RUN}-echo-${seq}`,
          payload: {
            type: 'whatsapp.message.sent',
            message: {
              id,
              timestamp: String(Math.floor(at(seconds).getTime() / 1000)),
              type: 'text',
              to,
              text: { body },
              kapso: { direction: 'outbound' },
            },
            conversation: { phone_number: to, phone_number_id: PHONE_NUMBER_ID },
            phone_number_id: PHONE_NUMBER_ID,
          },
        })
        .returning({ id: inboundWebhookEvents.id }),
    )
    return runInboundWhatsAppWebhook(
      { eventId: event!.id },
      at(asOfSeconds),
      noEnqueue,
      async () => null,
      nudge,
    )
  }

  it('hears a coordinator replying from their own phone, and stays quiet', async () => {
    const sender = newSender()
    const wa = recorder('whatsapp')
    const first = await say(sender, 'Need 2 containers Ningbo to Kuwait', 0)
    const enquiryId = first.enquiryId!

    const staff = await echo(
      sender,
      'Hi, Sara here from the desk — which goods are these?',
      60,
      120,
    )
    expect(staff).toEqual({ outcome: 'staff_reply', enquiryId })
    const [row] = await withActor(sys, (tx) =>
      tx
        .select()
        .from(messages)
        .where(and(eq(messages.enquiryId, enquiryId), eq(messages.direction, 'outbound'))),
    )
    expect(row?.staffAuthored).toBe(true)
    expect(row?.authorId).toBeNull()

    const { id } = await conversationFor(enquiryId)
    const turn = await runIntakeTurn(id, at(200), { resolveWhatsApp: wa.resolve })
    expect(turn.decision?.reason).toBe('human_active')
    expect(wa.sent).toHaveLength(0)
  })

  it('knows its own replies when Kapso echoes them back', async () => {
    const sender = newSender()
    const wa = recorder('whatsapp')
    const first = await say(sender, 'Need 2 containers Busan to Kuwait', 0)
    const { id } = await conversationFor(first.enquiryId!)
    await runIntakeTurn(id, at(130), { resolveWhatsApp: wa.resolve })
    expect(wa.sent).toHaveLength(1)

    // Too soon to tell from our own send: back to the queue, nothing written.
    await expect(echo(sender, 'unknown text', 131, 135)).rejects.toThrow(/too recent/)
    // The agent's own message, by its wamid: settled, and no staff reply filed.
    const own = await echo(sender, wa.sent[0]!.body, 130, 131, wa.sent[0]!.ref)
    expect(own.reason).toBe('own_echo')
    const staffRows = await withActor(sys, (tx) =>
      tx
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.enquiryId, first.enquiryId!), eq(messages.staffAuthored, true))),
    )
    expect(staffRows).toEqual([])
  })

  describe('WhatsApp media', () => {
    /** A local stand-in for Kapso's media endpoints: metadata, then bytes. */
    async function mediaServer(files: Record<string, { type: string; body: Buffer }>) {
      const { createServer } = await import('node:http')
      const hits: string[] = []
      const server = createServer((req, res) => {
        hits.push(`${req.headers['x-api-key']} ${req.url}`)
        const url = req.url ?? ''
        const meta = /\/v[\d.]+\/(.+)$/.exec(url)
        if (url.startsWith('/files/')) {
          const file = files[url.slice('/files/'.length)]!
          res.writeHead(200, { 'content-type': file.type, 'content-length': file.body.length })
          res.end(file.body)
          return
        }
        const id = decodeURIComponent(meta?.[1] ?? '')
        const file = files[id]
        if (!file) {
          res.writeHead(404).end('{}')
          return
        }
        const { port } = server.address() as { port: number }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            url: `http://127.0.0.1:${port}/files/${id}`,
            mime_type: file.type,
            file_size: file.body.length,
          }),
        )
      })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
      const { port } = server.address() as { port: number }
      return {
        hits,
        close: () => new Promise<void>((resolve) => server.close(() => resolve())),
        source: (maxBytes?: number) =>
          kapsoMediaSource({ apiKey: 'mock-key', baseUrl: `http://127.0.0.1:${port}`, maxBytes }),
      }
    }

    it('fetches a caption-less PDF, stores it, and reads it in the turn', async () => {
      const mock = await mediaServer({
        'media-pdf-1': {
          type: 'application/pdf',
          body: Buffer.from('%PDF-1.4 Two 40HC of furniture from Qingdao to Kuwait'),
        },
      })
      try {
        const sender = newSender()
        const wa = recorder('whatsapp')
        model.documents.length = 0
        const first = await say(
          sender,
          '',
          0,
          undefined,
          {
            type: 'document',
            text: undefined,
            document: { id: 'media-pdf-1', mime_type: 'application/pdf' },
          },
          async () => mock.source(),
        )
        expect(mock.hits.every((h) => h.startsWith('mock-key '))).toBe(true)
        const attached = await withActor(sys, (tx) =>
          tx
            .select({ name: assets.fileName, type: assets.contentType, size: assets.byteSize })
            .from(messageAttachments)
            .innerJoin(assets, eq(assets.id, messageAttachments.assetId))
            .innerJoin(messages, eq(messages.id, messageAttachments.messageId))
            .where(eq(messages.enquiryId, first.enquiryId!)),
        )
        expect(attached).toEqual([
          { name: 'whatsapp-document.pdf', type: 'application/pdf', size: 53 },
        ])

        const { id } = await conversationFor(first.enquiryId!)
        const turn = await runIntakeTurn(id, at(130), { resolveWhatsApp: wa.resolve })
        expect(model.documents).toEqual([1])
        expect(turn.decision?.action).toBe('confirm')
      } finally {
        await mock.close()
      }
    })

    it('files an oversized picture as a stub and does not send it to the model', async () => {
      const mock = await mediaServer({
        'media-big-1': { type: 'image/jpeg', body: Buffer.alloc(2048, 1) },
      })
      try {
        const sender = newSender()
        model.documents.length = 0
        const first = await say(
          sender,
          '',
          0,
          undefined,
          { type: 'image', text: undefined, image: { id: 'media-big-1', mime_type: 'image/jpeg' } },
          async () => mock.source(1024),
        )
        const [asset] = await withActor(sys, (tx) =>
          tx
            .select({ key: assets.storageKey })
            .from(messageAttachments)
            .innerJoin(assets, eq(assets.id, messageAttachments.assetId))
            .innerJoin(messages, eq(messages.id, messageAttachments.messageId))
            .where(eq(messages.enquiryId, first.enquiryId!)),
        )
        expect(asset?.key.startsWith('oversized:')).toBe(true)
        // Only the metadata call: the bytes were never downloaded.
        expect(mock.hits).toHaveLength(1)

        // A caption-less picture still counts as content: the model is asked.
        const { id } = await conversationFor(first.enquiryId!)
        const turn = await runIntakeTurn(id, at(130), {
          resolveWhatsApp: recorder('whatsapp').resolve,
        })
        expect(turn.modelCalled).toBe(true)
        expect(model.documents).toEqual([0])
      } finally {
        await mock.close()
      }
    })

    it('files the message without the file when the media call fails', async () => {
      const mock = await mediaServer({})
      try {
        const first = await say(
          newSender(),
          '',
          0,
          undefined,
          { type: 'image', text: undefined, image: { id: 'missing', mime_type: 'image/png' } },
          async () => mock.source(),
        )
        expect(first.outcome).toBe('created')
      } finally {
        await mock.close()
      }
    })
  })

  describe('on an email thread', () => {
    const branchRef = { id: BRANCH, code: 'ITK' }
    const mail = (over: Partial<Parameters<typeof ingestMessage>[0]> & { at: number }) => ({
      externalId: `<in-${RUN}-${(seq += 1)}@customer.test>`,
      channel: 'email' as const,
      mailbox: MAILBOX,
      from: `buyer-${RUN.toLowerCase()}@customer-intake.test`,
      to: [MAILBOX],
      cc: [],
      subject: 'RFQ Ningbo',
      body: '',
      receivedAt: at(over.at),
      references: [],
      attachments: [],
      automatic: false,
      ...over,
    })
    const ingest = (m: ReturnType<typeof mail>) =>
      ingestMessage(
        m,
        branchRef,
        m.receivedAt,
        noEnqueue,
        undefined,
        async () => {},
        async () => {},
        nudge,
      )

    it('clarifies in the thread, threads the answer back, and confirms', async () => {
      const email = recorder('email')
      model.calls.length = 0
      const original = mail({
        at: 0,
        body: 'Please quote 2x40HC from Ningbo to Kuwait.\n\nRegards',
      })
      const created = await ingest(original)
      expect(created.outcome).toBe('created')
      const enquiryId = created.enquiryId!

      // No immediate acknowledgement row: the agent answers instead.
      const acks = await withActor(sys, (tx) =>
        tx
          .select()
          .from(notificationOutbox)
          .where(
            and(
              eq(notificationOutbox.enquiryId, enquiryId),
              eq(notificationOutbox.eventKey, 'enquiry.received'),
            ),
          ),
      )
      expect(acks).toHaveLength(0)

      const { id, turnDueAt } = await conversationFor(enquiryId)
      expect(turnDueAt?.getTime()).toBe(at(60).getTime())
      const asked = await runIntakeTurn(id, at(61), { resolveEmail: email.resolve })
      expect(asked.decision?.action).toBe('clarify')
      expect(asked.missing).toEqual(['commodity'])
      expect(email.sent[0]!.to).toBe(original.from)
      expect(email.sent[0]!.from).toBe(MAILBOX)
      expect(email.sent[0]!.subject).toBe('Re: RFQ Ningbo')
      expect(email.sent[0]!.inReplyTo).toBe(original.externalId)
      expect(email.sent[0]!.body).toContain('what the cargo is')

      // Their reply carries our Message-ID and lands on the same enquiry.
      const answer = await ingest(
        mail({
          at: 3600,
          subject: 'Re: RFQ Ningbo',
          body: 'Garments.\n\nOn Mon, Intake wrote:\n> what the cargo is',
          inReplyTo: email.sent[0]!.ref,
        }),
      )
      expect(answer.outcome).toBe('threaded')
      expect(answer.enquiryId).toBe(enquiryId)
      const done = await runIntakeTurn(id, at(3700), { resolveEmail: email.resolve })
      expect(done.decision?.action).toBe('confirm')
      expect(email.sent).toHaveLength(2)
      expect(model.calls[1]).not.toContain('> what the cargo is')
    })

    it('reads the PDF on a mail that says only "see attached"', async () => {
      const email = recorder('email')
      model.calls.length = 0
      model.documents.length = 0
      const created = await ingest(
        mail({
          at: 20_000,
          from: `docs-${RUN.toLowerCase()}@customer-intake.test`,
          subject: 'Enquiry',
          body: 'see attached',
          attachments: [
            {
              filename: 'enquiry.pdf',
              contentType: 'application/pdf',
              content: Buffer.from('%PDF-1.4 Two 40HC of furniture from Qingdao to Kuwait'),
            },
          ],
        }),
      )
      const { id } = await conversationFor(created.enquiryId!)
      const turn = await runIntakeTurn(id, at(20_100), { resolveEmail: email.resolve })
      expect(model.documents).toEqual([1])
      expect(turn.decision?.action).toBe('confirm')
    })

    it('goes quiet when a colleague answers on the thread', async () => {
      const email = recorder('email')
      const created = await ingest(
        mail({
          at: 10_000,
          from: `other-${RUN.toLowerCase()}@customer-intake.test`,
          body: 'Rate for 2 containers to Kuwait?',
        }),
      )
      const enquiryId = created.enquiryId!
      const { id } = await conversationFor(enquiryId)
      const ref = await reference(enquiryId)
      // A coordinator replies from their own mailbox, copying the intake address.
      await ingest(
        mail({
          at: 10_030,
          from: STAFF_EMAIL,
          subject: `Re: ${ref}`,
          body: 'Hi, Sara here — which goods?',
        }),
      )
      const turn = await runIntakeTurn(id, at(10_200), { resolveEmail: email.resolve })
      expect(turn.decision?.reason).toBe('human_active')
      expect(email.sent).toHaveLength(0)
      // The colleague's mail was not read as the customer's.
      expect(turn.missing).toContain('origin')
    })
  })
})

async function reference(enquiryId: string): Promise<string> {
  const [row] = await withActor(systemActor(), (tx) =>
    tx
      .select({ reference: enquiries.reference })
      .from(enquiries)
      .where(eq(enquiries.id, enquiryId)),
  )
  return row!.reference
}
