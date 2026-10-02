/**
 * Integrations — how this deployment reaches the outside world.
 *
 * The property worth more than the rest is that nothing here hands a
 * credential back: the list reports whether a secret is *set*, never what it
 * is, and a blank secret on an edit keeps the stored one rather than clearing
 * it. Both are asserted against the database, not the return value alone.
 *
 * Integration rows are deployment-wide and `DELETE` is revoked, so this file
 * writes only `einvoice` — which nothing else in the web suite reads — and
 * leaves it switched off, so the resolver skips it and the environment answers
 * for every other suite exactly as before. Every other case is a refusal and
 * writes nothing.
 */

import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const harness = vi.hoisted(() => ({ session: null as unknown }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/session', () => ({ requireSession: async () => harness.session }))

/** Keys stand in for sentences, as in `form-actions.test.ts`. */
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    values ? `${namespace}.${key}:${JSON.stringify(values)}` : `${namespace}.${key}`,
}))

const { INTEGRATIONS } = await import('@qabandi/core')
const { integrationSettings, secretKeyProblem, withActor } = await import('@qabandi/db')

const { ADMIN_PRINCIPAL, AWAY_BRANCH, HOME_BRANCH, adminActor, world } =
  await import('@/lib/testing/fixtures')

const { listIntegrations, integrationKeyProblem, saveIntegration, setIntegrationActive } =
  await import('./integrations')

const session = {
  actor: adminActor,
  principal: {
    id: ADMIN_PRINCIPAL,
    nameEn: 'Fixture Administrator',
    nameAr: null,
    email: 'fixtures-admin@qabandi.test',
    locale: 'en' as const,
  },
  permissions: new Set(['admin.integrations.write']),
  branchRoles: new Map([
    [HOME_BRANCH, 'administrator'],
    [AWAY_BRANCH, 'administrator'],
  ]),
  requiresTwoFactor: false,
}

const form = (fields: Record<string, string | string[]>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) value.forEach((v) => data.append(key, v))
    else data.set(key, value)
  }
  return data
}

/** Per-run, because the row is kept between runs rather than removed. */
const RUN = Date.now().toString(36).toUpperCase().slice(-5)

/**
 * Environment the tests change, put back afterwards. The sealing key is read
 * at use rather than at import, so toggling it here reaches the action.
 */
const TOUCHED = [
  'MAILBOX_ENCRYPTION_KEY',
  'EINVOICE_ASP_API_KEY',
  'CARRIER_POLL_CRON',
  'QABANDI_PILOT_FIXTURES',
] as const
const saved = Object.fromEntries(TOUCHED.map((name) => [name, process.env[name]]))

function withEnv(name: (typeof TOUCHED)[number], value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

async function einvoiceRow() {
  const [row] = await withActor(adminActor, (tx) =>
    tx
      .select({
        driver: integrationSettings.driver,
        settings: integrationSettings.settings,
        secrets: integrationSettings.secrets,
        isActive: integrationSettings.isActive,
        lastError: integrationSettings.lastError,
      })
      .from(integrationSettings)
      .where(eq(integrationSettings.key, 'einvoice'))
      .limit(1),
  )
  return row
}

describe.skipIf(!enabled)('integrations', () => {
  beforeAll(async () => {
    await world()
    harness.session = session

    // A variable would satisfy the required key and hide the refusal below.
    withEnv('EINVOICE_ASP_API_KEY', undefined)
    // Keep a working key where one is configured; invent one only where not.
    if (secretKeyProblem() !== null) {
      withEnv('MAILBOX_ENCRYPTION_KEY', randomBytes(32).toString('base64'))
    }
  })

  afterAll(async () => {
    harness.session = session
    // Off, so the resolver skips the row and the environment answers again.
    await setIntegrationActive({}, form({ key: 'einvoice', isActive: 'false' }))
    harness.session = null
    for (const name of TOUCHED) withEnv(name, saved[name])
  })

  describe('saving', () => {
    /**
     * Create on the first run against a database, update on every run after —
     * one row per catalogue key, and nothing is ever deleted.
     */
    it('saves a live driver with its setting and a sealed key', async () => {
      const secret = `asp-key-${RUN}`
      const state = await saveIntegration(
        {},
        form({
          key: 'einvoice',
          driver: 'asp',
          url: `https://asp.example.test/${RUN}`,
          apiKey: `  ${secret}  `,
        }),
      )

      expect(state.errors).toBeUndefined()
      expect(state.message).toBeUndefined()
      expect(state.ok).toMatch(/^einvoice:/)

      const row = await einvoiceRow()
      expect(row?.driver).toBe('asp')
      expect(row?.settings).toEqual({ url: `https://asp.example.test/${RUN}` })
      expect(row?.isActive).toBe(true)
      expect(row?.lastError).toBeNull()
      // Sealed, not stored: the plaintext appears nowhere in the column.
      expect(row?.secrets.apiKey).toMatch(/^v1:/)
      expect(JSON.stringify(row?.secrets)).not.toContain(secret)
    })

    /**
     * A sealed value cannot be rendered back into the form, so a blank box is
     * "unchanged" — correcting a URL must not clear the key beside it.
     */
    it('keeps the stored key when the field is left blank on an edit', async () => {
      const before = await einvoiceRow()

      const state = await saveIntegration(
        {},
        form({
          key: 'einvoice',
          driver: 'asp',
          url: `https://asp.example.test/${RUN}/corrected`,
          apiKey: '   ',
        }),
      )

      expect(state.errors).toBeUndefined()
      const after = await einvoiceRow()
      expect(after?.settings).toEqual({ url: `https://asp.example.test/${RUN}/corrected` })
      expect(after?.secrets.apiKey).toBe(before?.secrets.apiKey)
    })

    it('reactivates a row that had been switched off', async () => {
      await setIntegrationActive({}, form({ key: 'einvoice', isActive: 'false' }))
      expect((await einvoiceRow())?.isActive).toBe(false)

      await saveIntegration({}, form({ key: 'einvoice', driver: 'none' }))

      const row = await einvoiceRow()
      expect(row?.isActive).toBe(true)
      expect(row?.driver).toBe('none')
      // Settings are replaced wholesale; the key survives a save that omits it.
      expect(row?.settings).toEqual({})
      expect(row?.secrets.apiKey).toMatch(/^v1:/)
    })

    it('refuses an integration the catalogue does not name', async () => {
      expect((await saveIntegration({}, form({ key: 'telex' }))).message).toBe(
        'adminValidation.unknownIntegration',
      )
      expect((await saveIntegration({}, form({}))).message).toBe(
        'adminValidation.unknownIntegration',
      )
    })

    it('refuses a driver the integration does not have', async () => {
      const state = await saveIntegration({}, form({ key: 'einvoice', driver: 'carrier-pigeon' }))
      expect(state.errors?.driver).toBe('adminValidation.unknownDriver:{"driver":"carrier-pigeon"}')
    })

    it('insists on the fields a live driver needs, and a full URL', async () => {
      const blank = await saveIntegration({}, form({ key: 'einvoice', driver: 'asp' }))
      expect(blank.errors?.url).toBe('adminValidation.neededToSwitchOn')

      const bare = await saveIntegration(
        {},
        form({ key: 'einvoice', driver: 'asp', url: 'asp.example.test' }),
      )
      expect(bare.errors?.url).toBe('adminValidation.fullUrl')
    })

    /**
     * `fileStore` rather than `einvoice`, because the einvoice row now holds a
     * key — which is exactly what makes a blank field acceptable there. A
     * refusal writes nothing, so this leaves the storage configuration alone.
     */
    it('insists on a required key that is neither stored nor in the environment', async () => {
      const [row] = await withActor(adminActor, (tx) =>
        tx
          .select({ secrets: integrationSettings.secrets })
          .from(integrationSettings)
          .where(eq(integrationSettings.key, 'fileStore'))
          .limit(1),
      )
      const alreadySet =
        row?.secrets.secretAccessKey !== undefined ||
        Boolean(process.env.S3_SECRET_ACCESS_KEY?.trim())

      const state = await saveIntegration(
        {},
        form({ key: 'fileStore', driver: 's3', forcePathStyle: 'on' }),
      )

      expect(state.errors?.endpoint).toBe('adminValidation.neededToSwitchOn')
      expect(state.errors?.secretAccessKey).toBe(
        alreadySet ? undefined : 'adminValidation.neededToSwitchOn',
      )
    })

    it('refuses a number that is not one, or is out of range', async () => {
      const save = (batch: string) =>
        saveIntegration({}, form({ key: 'carrierPoll', batch, cron: '*/30 * * * *' }))

      expect((await save('many')).errors?.batch).toBe('adminValidation.mustBeNumber')
      expect((await save('0')).errors?.batch).toBe('adminValidation.minValue:{"min":1}')
      expect((await save('501')).errors?.batch).toBe('adminValidation.maxValue:{"max":500}')
    })

    /** The arithmetic behind the carrier's rate cap has to be checkable at all. */
    it('refuses a poll schedule whose calls per hour cannot be worked out', async () => {
      const state = await saveIntegration(
        {},
        form({ key: 'carrierPoll', batch: '10', cron: 'whenever it likes' }),
      )
      expect(state.errors?.cron).toBe('adminValidation.cronUnreadable')
    })

    /** The echo lands in the response HTML, so a key must never ride back in it. */
    it('echoes what was typed except the credential', async () => {
      const state = await saveIntegration(
        {},
        form({ key: 'einvoice', driver: 'asp', url: 'ftp://nope', apiKey: 'do-not-echo' }),
      )
      expect(state.values?.url).toBe('ftp://nope')
      expect(state.values).not.toHaveProperty('apiKey')
    })

    it('refuses to take a key it has no way to seal', async () => {
      const key = process.env.MAILBOX_ENCRYPTION_KEY
      withEnv('MAILBOX_ENCRYPTION_KEY', undefined)
      try {
        const state = await saveIntegration(
          {},
          form({ key: 'einvoice', driver: 'none', apiKey: 'unsealable' }),
        )
        expect(state.message).toMatch(/^adminValidation\.credentialCannotBeSealed:/)
        // The reason is a translated sentence now, not secrets.ts's English (U1).
        expect(state.message).toContain('adminValidation.keyMissing')
        expect(state.values).not.toHaveProperty('apiKey')
      } finally {
        withEnv('MAILBOX_ENCRYPTION_KEY', key)
      }
    })
  })

  describe('reading', () => {
    it('lists every integration in catalogue order, configured or not', async () => {
      const list = await listIntegrations()

      expect(list.map((i) => i.key)).toEqual(INTEGRATIONS.map((spec) => spec.key))
      const einvoice = list.find((i) => i.key === 'einvoice')!
      expect(einvoice.hasRow).toBe(true)
      expect(einvoice.group).toBe('finance')
      expect(einvoice.secrets).toEqual([{ name: 'apiKey', isSet: true }])
      expect(einvoice.fields.map((f) => f.name)).toEqual(['url'])
    })

    /** Presence, never value — neither the plaintext nor the ciphertext. */
    it('never returns a credential', async () => {
      const row = await einvoiceRow()
      const serialised = JSON.stringify(await listIntegrations())

      expect(serialised).not.toContain(row!.secrets.apiKey!)
      expect(serialised).not.toContain(`asp-key-${RUN}`)
      expect(serialised).not.toContain('"sealed"')
    })

    /**
     * Null rather than an invented number when the schedule cannot be read — a
     * wrong reassurance about a rate limit hides a 429.
     */
    it('works out the carrier poll’s calls per hour, or declines to', async () => {
      withEnv('CARRIER_POLL_CRON', '0 * * * *')
      try {
        const poll = (await listIntegrations()).find((i) => i.key === 'carrierPoll')!
        // Only meaningful while the environment is answering for the schedule.
        if (poll.fields.find((f) => f.name === 'cron')?.source === 'env') {
          const batch = Number(poll.fields.find((f) => f.name === 'batch')?.value ?? 15)
          expect(poll.callsPerHour).toBe(batch)
        }

        withEnv('CARRIER_POLL_CRON', 'not a schedule')
        const unreadable = (await listIntegrations()).find((i) => i.key === 'carrierPoll')!
        if (unreadable.fields.find((f) => f.name === 'cron')?.source === 'env') {
          expect(unreadable.callsPerHour).toBeNull()
        }
        // The figure belongs to the carrier poll alone.
        expect(
          (await listIntegrations())
            .filter((i) => i.key !== 'carrierPoll')
            .every((i) => i.callsPerHour === null),
        ).toBe(true)
      } finally {
        withEnv('CARRIER_POLL_CRON', saved.CARRIER_POLL_CRON)
      }
    })

    it('reads the fixture rows when the pilot fixtures are on', async () => {
      withEnv('QABANDI_PILOT_FIXTURES', '1')
      try {
        const list = await listIntegrations()
        expect(list).toHaveLength(INTEGRATIONS.length)
        expect(list.find((i) => i.key === 'carrierPoll')?.hasRow).toBe(true)
      } finally {
        withEnv('QABANDI_PILOT_FIXTURES', saved.QABANDI_PILOT_FIXTURES)
      }
    })

    /**
     * The reason rather than a boolean: a missing key and a key of the wrong
     * shape look identical from `false` and are fixed differently.
     */
    it('says why a key cannot be sealed, or nothing when it can', async () => {
      expect(await integrationKeyProblem()).toBeNull()

      const key = process.env.MAILBOX_ENCRYPTION_KEY
      try {
        withEnv('MAILBOX_ENCRYPTION_KEY', undefined)
        // Data, not an English sentence — the page words it (U1).
        expect(await integrationKeyProblem()).toEqual({ ok: false, reason: 'missing' })

        withEnv('MAILBOX_ENCRYPTION_KEY', 'a passphrase somebody typed')
        expect(await integrationKeyProblem()).toMatchObject({ reason: 'length', expected: 32 })
      } finally {
        withEnv('MAILBOX_ENCRYPTION_KEY', key)
      }
    })
  })

  describe('switching off and on', () => {
    /** The rollback: an inactive row is skipped and the environment answers. */
    it('deactivates a row without losing what was configured', async () => {
      const state = await setIntegrationActive({}, form({ key: 'einvoice', isActive: 'false' }))

      expect(state.ok).toMatch(/^einvoice:/)
      const row = await einvoiceRow()
      expect(row?.isActive).toBe(false)
      expect(row?.secrets.apiKey).toMatch(/^v1:/)

      const listed = (await listIntegrations()).find((i) => i.key === 'einvoice')!
      expect(listed.isActive).toBe(false)
      // Not answering, so the key the row holds is no longer reported as set.
      expect(listed.secrets[0]?.isSet).toBe(false)
    })

    it('switches it back on', async () => {
      await setIntegrationActive({}, form({ key: 'einvoice', isActive: 'true' }))
      expect((await einvoiceRow())?.isActive).toBe(true)
    })

    it('refuses an integration the catalogue does not name', async () => {
      expect((await setIntegrationActive({}, form({ key: 'telex' }))).message).toBe(
        'adminValidation.unknownIntegration',
      )
      expect((await setIntegrationActive({}, form({}))).message).toBe(
        'adminValidation.unknownIntegration',
      )
    })
  })

  describe('permission', () => {
    it('refuses a caller without the integrations key', async () => {
      harness.session = { ...session, permissions: new Set(['admin.users.write']) }
      try {
        await expect(listIntegrations()).rejects.toThrow()
        await expect(integrationKeyProblem()).rejects.toThrow()
        await expect(saveIntegration({}, form({ key: 'einvoice' }))).resolves.toMatchObject({
          message: expect.stringContaining('forbiddenAction'),
        })
        await expect(
          setIntegrationActive({}, form({ key: 'einvoice', isActive: 'false' })),
        ).resolves.toMatchObject({ message: expect.stringContaining('forbiddenAction') })
      } finally {
        harness.session = session
      }
    })
  })
})
