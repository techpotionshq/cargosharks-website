/**
 * A supplier's filed mail, on the partner page — listed, attached, dealt with.
 *
 * The intake files a known supplier's mail on no record; these prove the place
 * it surfaces: it is listed for its partner until somebody acts, attaching it
 * puts it on a job of the same branch and nowhere else, and marking it dealt
 * with keeps the row. A reader without the branch is refused before a write.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'

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

const { jobs, messages, systemActor, withActor } = await import('@qabandi/db')
const { ADMIN_PRINCIPAL, AWAY_BRANCH, HOME_BRANCH, HOME_JOB, PARTNER, adminActor, world } =
  await import('@/lib/testing/fixtures')
const { partnerMail } = await import('./partner-mail')
const { attachPartnerMailToJob, markPartnerMailHandled } = await import('./partner-mail-actions')

const session = {
  actor: adminActor,
  principal: {
    id: ADMIN_PRINCIPAL,
    nameEn: 'Fixture Administrator',
    nameAr: null,
    email: 'fixtures-admin@qabandi.test',
    locale: 'en' as const,
  },
  permissions: new Set(['job.update', 'payable.record']),
  branchRoles: new Map([
    [HOME_BRANCH, 'administrator'],
    [AWAY_BRANCH, 'administrator'],
  ]),
  requiresTwoFactor: false,
}
const awayOnly = {
  ...session,
  actor: { ...adminActor, branchIds: [AWAY_BRANCH] },
  branchRoles: new Map([[AWAY_BRANCH, 'administrator']]),
}

const sys = systemActor()
const RUN = Date.now().toString(36)
const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [k, v] of Object.entries(fields)) data.set(k, v)
  return data
}

async function filed(subject: string): Promise<string> {
  const [row] = await withActor(sys, (tx) =>
    tx
      .insert(messages)
      .values({
        branchId: HOME_BRANCH,
        partnerId: PARTNER,
        channel: 'email',
        direction: 'inbound',
        subject,
        body: 'Please note the revised cut-off.',
        fromAddress: 'ops@partner-mail.test',
        sentAt: new Date(),
      })
      .returning({ id: messages.id }),
  )
  return row!.id
}

describe.skipIf(!enabled)('partner mail', () => {
  beforeAll(async () => {
    await world()
    harness.session = session
  })
  afterAll(() => {
    harness.session = null
  })

  it('lists a filed mail for its partner until it is dealt with, and keeps the row', async () => {
    const id = await filed(`Cut-off ${RUN}`)
    expect((await partnerMail(adminActor, PARTNER)).map((m) => m.id)).toContain(id)

    expect((await markPartnerMailHandled({}, form({ messageId: id }))).ok).toBeTruthy()
    expect((await partnerMail(adminActor, PARTNER)).map((m) => m.id)).not.toContain(id)
    const [kept] = await withActor(sys, (tx) =>
      tx.select({ readAt: messages.readAt }).from(messages).where(eq(messages.id, id)),
    )
    expect(kept?.readAt).not.toBeNull()
  })

  it('attaches a mail to a job of its branch by reference', async () => {
    const id = await filed(`About a job ${RUN}`)
    const [job] = await withActor(sys, (tx) =>
      tx.select({ reference: jobs.reference }).from(jobs).where(eq(jobs.id, HOME_JOB)),
    )
    const missing = await attachPartnerMailToJob(
      {},
      form({ messageId: id, jobReference: 'NOPE-1' }),
    )
    expect(missing.errors?.jobReference).toBe('partnerMail.jobNotFound:{"reference":"NOPE-1"}')

    const state = await attachPartnerMailToJob(
      {},
      form({ messageId: id, jobReference: job!.reference.toLowerCase() }),
    )
    expect(state.ok).toBeTruthy()
    const [row] = await withActor(sys, (tx) =>
      tx.select({ jobId: messages.jobId }).from(messages).where(eq(messages.id, id)),
    )
    expect(row?.jobId).toBe(HOME_JOB)
  })

  it('does not reach another branch’s mail', async () => {
    const id = await filed(`Not yours ${RUN}`)
    harness.session = awayOnly
    try {
      const state = await markPartnerMailHandled({}, form({ messageId: id }))
      expect(state.message).toBe('partnerMail.notFound')
    } finally {
      harness.session = session
    }
  })
})
