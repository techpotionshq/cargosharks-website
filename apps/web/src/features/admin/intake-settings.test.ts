/**
 * The intake agent's settings and the take-over switch, against a database.
 *
 * Three properties, each a way a branch administrator could otherwise reach
 * further than their branch or leave a branch half-configured: a save writes
 * the branch's own row and replaces (never deletes) its required details; a
 * value outside the bounds the worker clamps to is refused with a sentence; and
 * a save or a take-over for a branch the person does not administer is refused
 * before anything is written.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'

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

const {
  enquiries,
  intakeConversations,
  intakeRequirements,
  intakeSettings,
  systemActor,
  withActor,
} = await import('@qabandi/db')
const { ADMIN_PRINCIPAL, AWAY_BRANCH, HOME_BRANCH, adminActor, world } =
  await import('@/lib/testing/fixtures')
const { listIntakeSettings, saveIntakeSettings } = await import('./intake-settings')
const { setIntakeAgent } = await import('../enquiries/intake-actions')

const session = {
  actor: adminActor,
  principal: {
    id: ADMIN_PRINCIPAL,
    nameEn: 'Fixture Administrator',
    nameAr: null,
    email: 'fixtures-admin@qabandi.test',
    locale: 'en' as const,
  },
  permissions: new Set(['admin.mailboxes.write', 'enquiry.assign']),
  branchRoles: new Map([
    [HOME_BRANCH, 'administrator'],
    [AWAY_BRANCH, 'administrator'],
  ]),
  requiresTwoFactor: false,
}

/** Administers the home branch only. */
const homeOnly = {
  ...session,
  actor: { ...adminActor, branchIds: [HOME_BRANCH] },
  branchRoles: new Map([[HOME_BRANCH, 'administrator']]),
}

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

const valid = (over: Record<string, string> = {}) =>
  form({
    branchId: HOME_BRANCH,
    enabled: 'on',
    whatsappQuietSeconds: '90',
    whatsappMaxWaitSeconds: '600',
    emailQuietSeconds: '60',
    emailMaxWaitSeconds: '600',
    clarifyCooldownHours: '6',
    clarifyCap: '2',
    humanTakeoverHours: '12',
    'req.all.origin': 'on',
    'req.all.destination': 'on',
    'req.air.weightOrVolume': 'on',
    ...over,
  })

const sys = systemActor()
const RUN = Date.now().toString(36).toUpperCase().slice(-5)

describe.skipIf(!enabled)('intake agent settings', () => {
  beforeAll(async () => {
    await world()
    harness.session = session
  })

  afterAll(async () => {
    // Leave the fixture branch with the agent off, as every other suite expects.
    await withActor(sys, (tx) =>
      tx
        .update(intakeSettings)
        .set({ enabled: false })
        .where(eq(intakeSettings.branchId, HOME_BRANCH)),
    )
    harness.session = null
  })

  it('writes the branch’s own row and its required details', async () => {
    const state = await saveIntakeSettings({}, valid())
    expect(state.errors).toBeUndefined()

    const [row] = await withActor(sys, (tx) =>
      tx.select().from(intakeSettings).where(eq(intakeSettings.branchId, HOME_BRANCH)),
    )
    expect(row?.enabled).toBe(true)
    expect(row?.whatsappQuietSeconds).toBe(90)

    const listed = (await listIntakeSettings()).find((r) => r.branchId === HOME_BRANCH)
    expect(listed?.inherited).toBe(false)
    expect(listed?.ownRequirements).toBe(true)
    expect(listed?.requirements).toEqual([
      { mode: null, key: 'origin', fields: ['origin'] },
      { mode: null, key: 'destination', fields: ['destination'] },
      { mode: 'air', key: 'weightOrVolume', fields: ['grossWeightKg', 'volumeCbm'] },
    ])
  })

  it('retires the previous requirements rather than deleting them', async () => {
    await saveIntakeSettings({}, valid({ 'req.all.commodity': 'on' }))
    const rows = await withActor(sys, (tx) =>
      tx
        .select({ key: intakeRequirements.key, isActive: intakeRequirements.isActive })
        .from(intakeRequirements)
        .where(eq(intakeRequirements.branchId, HOME_BRANCH)),
    )
    expect(rows.filter((r) => r.isActive).map((r) => r.key)).toEqual([
      'origin',
      'destination',
      'commodity',
      'weightOrVolume',
    ])
    expect(rows.some((r) => !r.isActive)).toBe(true)
  })

  it('refuses a value outside the bounds, and a wait shorter than the window', async () => {
    const state = await saveIntakeSettings(
      {},
      valid({ whatsappQuietSeconds: '5', emailQuietSeconds: '900', emailMaxWaitSeconds: '600' }),
    )
    expect(state.errors?.whatsappQuietSeconds).toBe(
      'intakeSettings.outOfRange:{"min":15,"max":3600}',
    )
    expect(state.errors?.emailMaxWaitSeconds).toBe('intakeSettings.waitShorterThanQuiet')
  })

  it('refuses a save with no required detail at all', async () => {
    const data = valid()
    for (const key of [...data.keys()]) if (key.startsWith('req.')) data.delete(key)
    const state = await saveIntakeSettings({}, data)
    expect(state.errors?._).toBe('intakeSettings.noRequirements')
  })

  it('refuses a branch the administrator does not administer', async () => {
    harness.session = homeOnly
    try {
      // Refused as a sentence, not a throw: every form action is wrapped in
      // refuseForbidden, so a ForbiddenError never reaches the error page.
      const state = await saveIntakeSettings({}, valid({ branchId: AWAY_BRANCH }))
      expect(state.message).toBe('common.forbiddenAction')
    } finally {
      harness.session = session
    }
  })

  describe('taking a conversation over', () => {
    async function conversation(branchId: string) {
      return withActor(sys, async (tx) => {
        const [enquiry] = await tx
          .insert(enquiries)
          .values({
            reference: `INT-${RUN}-${branchId.slice(-4)}-${Math.random().toString(36).slice(2, 6)}`,
            branchId,
            channel: 'whatsapp',
          })
          .returning({ id: enquiries.id })
        await tx.insert(intakeConversations).values({
          branchId,
          enquiryId: enquiry!.id,
          channel: 'whatsapp',
          customerAddress: '96500000000',
          businessAddress: '100000000000001',
        })
        return enquiry!.id
      })
    }

    it('switches the agent off and back on, and says who did', async () => {
      const enquiryId = await conversation(HOME_BRANCH)
      expect(
        (await setIntakeAgent({}, form({ enquiryId, enabled: 'false' }))).errors,
      ).toBeUndefined()
      const [off] = await withActor(sys, (tx) =>
        tx.select().from(intakeConversations).where(eq(intakeConversations.enquiryId, enquiryId)),
      )
      expect(off?.agentEnabled).toBe(false)
      expect(off?.agentToggledById).toBe(ADMIN_PRINCIPAL)

      await setIntakeAgent({}, form({ enquiryId, enabled: 'true' }))
      const [on] = await withActor(sys, (tx) =>
        tx
          .select({ agentEnabled: intakeConversations.agentEnabled })
          .from(intakeConversations)
          .where(and(eq(intakeConversations.enquiryId, enquiryId))),
      )
      expect(on?.agentEnabled).toBe(true)
    })

    it('does not reach another branch’s conversation', async () => {
      const enquiryId = await conversation(AWAY_BRANCH)
      harness.session = homeOnly
      try {
        const state = await setIntakeAgent({}, form({ enquiryId, enabled: 'false' }))
        expect(state.errors?._).toBe('intakeAgent.notFound')
      } finally {
        harness.session = session
      }
    })
  })
})
