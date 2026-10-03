/**
 * The conversation panel's read and its reply action (D5).
 *
 * The read is checked against real rows, because the two things it decides
 * are both questions about the data: who wrote each outbound message (the
 * agent, a named person, or a person outside the product), and where a reply
 * would go. The action is checked with the service faked at `fetch`, because
 * the send is the service's and has its own suite (`enquiry-reply.test.ts`);
 * what belongs here is who may send, what is handed over, and how each refusal
 * reads to the coordinator.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const harness = vi.hoisted(() => ({ session: null as unknown }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/session', () => ({ requireSession: async () => harness.session }))
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    values ? `${namespace}.${key}:${JSON.stringify(values)}` : `${namespace}.${key}`,
}))

const { enquiries, intakeConversations, messages, rateRequests, withActor, SYSTEM_PRINCIPAL_ID } =
  await import('@qabandi/db')
const { AWAY_BRANCH, HOME_BRANCH, PARTNER, PRINCIPAL, bothBranchesActor, world } =
  await import('@/lib/testing/fixtures')
const { enquiryConversation } = await import('./conversation')
const { replyToCustomer } = await import('./conversation-actions')

const session = {
  actor: bothBranchesActor,
  principal: {
    id: PRINCIPAL,
    nameEn: 'Enquiry Desk',
    nameAr: null,
    email: 'enquiries@qabandi.test',
    locale: 'en' as const,
  },
  permissions: new Set(['enquiry.assign']),
  branchRoles: new Map([
    [HOME_BRANCH, 'sales'],
    [AWAY_BRANCH, 'sales'],
  ]),
  requiresTwoFactor: false,
}

const system = { ...bothBranchesActor, type: 'system' as const }
const RUN = process.hrtime.bigint().toString(36).toUpperCase().slice(-6)
let seq = 0

async function enquiry(branchId = HOME_BRANCH) {
  seq += 1
  const [row] = await withActor(system, (tx) =>
    tx
      .insert(enquiries)
      .values({
        reference: `CNV-${RUN}-${seq}`,
        branchId,
        status: 'new',
        channel: 'whatsapp',
      })
      .returning({ id: enquiries.id }),
  )
  return row!.id
}

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

describe.skipIf(!enabled)('the conversation on an enquiry', () => {
  beforeAll(async () => {
    await world()
    harness.session = session
  })

  afterAll(() => {
    harness.session = null
  })

  describe('reading the thread', () => {
    it('lists every message oldest first and says who wrote what', async () => {
      const id = await enquiry()
      const minute = (m: number) => new Date(Date.UTC(2040, 0, 1, 9, m))
      await withActor(system, (tx) =>
        tx.insert(messages).values([
          {
            branchId: HOME_BRANCH,
            enquiryId: id,
            channel: 'whatsapp',
            direction: 'inbound',
            body: 'Hi\nI need 2x40HC',
            fromAddress: '96550009999',
            toAddresses: ['wa-home'],
            sentAt: minute(0),
          },
          {
            branchId: HOME_BRANCH,
            enquiryId: id,
            channel: 'whatsapp',
            direction: 'outbound',
            body: 'Which goods?',
            authorId: SYSTEM_PRINCIPAL_ID,
            sentAt: minute(2),
          },
          {
            branchId: HOME_BRANCH,
            enquiryId: id,
            channel: 'whatsapp',
            direction: 'outbound',
            body: 'From my phone',
            staffAuthored: true,
            sentAt: minute(4),
          },
          {
            branchId: HOME_BRANCH,
            enquiryId: id,
            channel: 'whatsapp',
            direction: 'outbound',
            body: 'We will price it today.',
            authorId: PRINCIPAL,
            sentAt: minute(3),
          },
        ]),
      )

      const thread = await enquiryConversation(bothBranchesActor, id)

      expect(thread!.messages.map((m) => m.body)).toEqual([
        'Hi\nI need 2x40HC',
        'Which goods?',
        'We will price it today.',
        'From my phone',
      ])
      expect(thread!.messages.map((m) => m.author)).toEqual([null, 'agent', 'staff', 'staff'])
      expect(thread!.messages[2]!.authorName).toBeTruthy()
      expect(thread!.messages[3]!.authorName).toBeNull()
      // No intake conversation: the reply goes back to whoever wrote in, on WhatsApp.
      expect(thread!.replyChannel).toBe('whatsapp')
      expect(thread!.replyTo).toBe('96550009999')
      expect(thread!.lastInboundAt?.getTime()).toBe(minute(0).getTime())
    })

    it('answers on the intake conversation’s address when the agent holds it', async () => {
      const id = await enquiry()
      await withActor(system, (tx) =>
        tx.insert(intakeConversations).values({
          branchId: HOME_BRANCH,
          enquiryId: id,
          channel: 'email',
          customerAddress: 'buyer@customer.test',
          businessAddress: 'desk@qabandi.test',
        }),
      )

      const thread = await enquiryConversation(bothBranchesActor, id)

      expect(thread).toMatchObject({ replyChannel: 'email', replyTo: 'buyer@customer.test' })
    })

    /** An agent's rate reply, filed as `inbound-mail.ts` files one. */
    async function rateReply(enquiryId: string, at: Date) {
      seq += 1
      const [row] = await withActor(system, (tx) =>
        tx
          .insert(messages)
          .values({
            branchId: HOME_BRANCH,
            enquiryId,
            channel: 'email',
            direction: 'inbound',
            subject: 'Re: Rate request Ningbo to Shuwaikh',
            body: 'USD 2,900 per 40HC',
            fromAddress: 'pricing@shaco-agent.test',
            sentAt: at,
          })
          .returning({ id: messages.id }),
      )
      await withActor(system, (tx) =>
        tx.insert(rateRequests).values({
          branchId: HOME_BRANCH,
          enquiryId,
          partnerId: PARTNER,
          token: `cnv${RUN.toLowerCase()}${seq}`.padEnd(12, '0'),
          status: 'responded',
          messageId: row!.id,
        }),
      )
    }

    it('never offers to answer an agent’s rate reply (NEW-1)', async () => {
      const id = await enquiry()
      await rateReply(id, new Date(Date.UTC(2040, 0, 1, 9)))

      const thread = await enquiryConversation(bothBranchesActor, id)

      expect(thread).toMatchObject({ replyChannel: null, replyTo: null, replyRefused: true })
    })

    it('answers the customer, not the newer rate reply (NEW-1)', async () => {
      const id = await enquiry()
      await withActor(system, (tx) =>
        tx.insert(messages).values({
          branchId: HOME_BRANCH,
          enquiryId: id,
          channel: 'whatsapp',
          direction: 'inbound',
          body: 'Quote please',
          fromAddress: '96550008888',
          toAddresses: ['wa-home'],
          sentAt: new Date(Date.UTC(2040, 0, 1, 8)),
        }),
      )
      await rateReply(id, new Date(Date.UTC(2040, 0, 1, 9)))

      const thread = await enquiryConversation(bothBranchesActor, id)

      expect(thread).toMatchObject({
        replyChannel: 'whatsapp',
        replyTo: '96550008888',
        replyRefused: false,
      })
      expect(thread!.lastInboundAt?.getTime()).toBe(Date.UTC(2040, 0, 1, 8))
    })

    it('has nobody to answer on an enquiry nobody wrote in on', async () => {
      const thread = await enquiryConversation(bothBranchesActor, await enquiry())
      expect(thread).toMatchObject({ messages: [], replyChannel: null, replyTo: null })
    })
  })

  describe('replying', () => {
    const fetchMock = vi.fn()
    const answer = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })

    beforeEach(() => {
      vi.stubGlobal('fetch', fetchMock)
      vi.stubEnv('SERVICE_URL', 'http://service.test/')
      vi.stubEnv('INTERNAL_API_SECRET', 'secret')
    })

    afterEach(() => {
      fetchMock.mockReset()
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
      harness.session = session
    })

    it('hands the words and the actor to the service', async () => {
      const id = await enquiry()
      fetchMock.mockResolvedValue(answer(200, { messageId: 'm1', channel: 'whatsapp' }))

      const state = await replyToCustomer({}, form({ enquiryId: id, body: '  Hello there  ' }))

      expect(state.ok).toBeDefined()
      const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
      expect(url).toBe(`http://service.test/internal/enquiries/${id}/reply`)
      expect((init.headers as Record<string, string>)['x-internal-secret']).toBe('secret')
      expect(JSON.parse(init.body as string)).toEqual({
        actor: bothBranchesActor,
        body: 'Hello there',
      })
    })

    it('asks for words before calling anything', async () => {
      const state = await replyToCustomer({}, form({ enquiryId: await enquiry(), body: '  ' }))
      expect(state.errors?.body).toBe('conversation.bodyRequired')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('refuses an enquiry in a branch where the sender only reads', async () => {
      const id = await enquiry(AWAY_BRANCH)
      harness.session = {
        ...session,
        branchPermissions: new Map([
          [HOME_BRANCH, new Set(['enquiry.assign'])],
          [AWAY_BRANCH, new Set(['enquiry.read'])],
        ]),
      }

      const state = await replyToCustomer({}, form({ enquiryId: id, body: 'Hello' }))

      expect(state.message).toEqual(expect.stringContaining('forbiddenAction'))
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('explains WhatsApp’s 24-hour refusal and keeps what was typed', async () => {
      const id = await enquiry()
      fetchMock.mockResolvedValue(answer(422, { error: 'whatsapp_window', detail: 'kapso 400' }))

      const state = await replyToCustomer({}, form({ enquiryId: id, body: 'Still there?' }))

      expect(state.message).toBe('conversation.windowClosed')
      expect(state.values?.body).toBe('Still there?')
    })

    it('says a thread with only partners and staff on it has nobody to answer', async () => {
      const id = await enquiry()
      fetchMock.mockResolvedValue(answer(422, { error: 'not_customer', detail: null }))

      const state = await replyToCustomer({}, form({ enquiryId: id, body: 'KWD 1,150' }))

      expect(state.message).toBe('conversation.notCustomer')
      expect(state.values?.body).toBe('KWD 1,150')
    })

    it('passes any other refusal on in the provider’s words', async () => {
      const id = await enquiry()
      fetchMock.mockResolvedValue(answer(502, { error: 'send_failed', detail: '550 no mailbox' }))

      const state = await replyToCustomer({}, form({ enquiryId: id, body: 'Hello' }))

      expect(state.message).toBe('conversation.sendFailed:{"detail":"550 no mailbox"}')
      expect(state.values?.body).toBe('Hello')
    })

    it('says when the service cannot be reached', async () => {
      const id = await enquiry()
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

      const state = await replyToCustomer({}, form({ enquiryId: id, body: 'Hello' }))

      expect(state.message).toBe('conversation.serviceUnreachable')
    })

    it('says so when no service is configured, and sends nothing', async () => {
      vi.stubEnv('SERVICE_URL', '')
      const state = await replyToCustomer({}, form({ enquiryId: await enquiry(), body: 'Hello' }))
      expect(state.message).toBe('conversation.serviceNotConfigured')
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
