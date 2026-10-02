/**
 * API keys and outbound webhooks — FR-AD-05, FR-AD-06.
 *
 * Two secrets, handled in opposite ways, and the difference is the point. An
 * API key's secret is hashed and the plaintext exists only in the action's
 * return value, so the first thing checked is that the stored row cannot give
 * it back. A webhook's signing secret is stored in clear, because the worker
 * signs every delivery with it — so there the check is that what the
 * administrator was shown is what the worker will sign with.
 *
 * Nothing here is deleted and the test database is never emptied, so every
 * assertion is scoped to a row this run created, found by its own id or name.
 */

import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const harness = vi.hoisted(() => ({ session: null as unknown }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/session', () => ({ requireSession: async () => harness.session }))

/** Keys stand in for the sentences, as in `form-actions.test.ts`. */
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    values ? `${namespace}.${key}:${JSON.stringify(values)}` : `${namespace}.${key}`,
}))

const { apiKeys, webhookEndpoints, withActor } = await import('@qabandi/db')

const { ADMIN_PRINCIPAL, AWAY_BRANCH, CUSTOMER, HOME_BRANCH, adminActor, world } =
  await import('@/lib/testing/fixtures')

const {
  listApiKeys,
  createApiKey,
  revokeApiKey,
  listWebhookEndpoints,
  createWebhookEndpoint,
  setWebhookEndpointActive,
} = await import('./api-keys')

const session = {
  actor: adminActor,
  principal: {
    id: ADMIN_PRINCIPAL,
    nameEn: 'Fixture Administrator',
    nameAr: null,
    email: 'fixtures-admin@qabandi.test',
    locale: 'en' as const,
  },
  permissions: new Set(['admin.api_keys.write']),
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

/** Per-run, because keys are revoked rather than removed. */
const RUN = Date.now().toString(36).toUpperCase().slice(-5)
let seq = 0
const nextName = () => `Test key ${RUN}-${(seq += 1)}`

/** `succeed` suffixes a counter; the page reads everything before the last colon. */
const token = (ok: string | undefined) => ok!.slice(0, ok!.lastIndexOf(':'))

/** A branch nobody in this session holds a role in. */
const FOREIGN_BRANCH = '00000000-0000-7000-8000-0000000fffff'

async function keyByName(name: string) {
  const [row] = await withActor(adminActor, (tx) =>
    tx.select().from(apiKeys).where(eq(apiKeys.name, name)).limit(1),
  )
  return row
}

async function endpointById(id: string) {
  const [row] = await withActor(adminActor, (tx) =>
    tx.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, id)).limit(1),
  )
  return row
}

/** Each endpoint gets its own URL, so it can be found again without "latest". */
const nextUrl = () => `https://hooks.example.test/${RUN}/${(seq += 1)}`

async function endpointByUrl(url: string) {
  const [row] = await withActor(adminActor, (tx) =>
    tx.select().from(webhookEndpoints).where(eq(webhookEndpoints.url, url)).limit(1),
  )
  return row
}

describe.skipIf(!enabled)('API keys and webhooks', () => {
  beforeAll(async () => {
    await world()
    harness.session = session
  })

  afterAll(() => {
    harness.session = null
  })

  describe('issuing a key', () => {
    it('hands the secret back once and stores only its hash', async () => {
      const name = nextName()
      const state = await createApiKey(
        {},
        form({ name, customerId: CUSTOMER, branchId: HOME_BRANCH, expiresAt: '' }),
      )

      expect(state.errors).toBeUndefined()
      const [prefix, secret] = token(state.ok).split('.')
      expect(prefix).toMatch(/^qb_[0-9a-f]{12}$/)
      expect(secret).toMatch(/^[0-9a-f]{64}$/)

      const row = await keyByName(name)
      expect(row?.prefix).toBe(prefix)
      // SHA-256, because that is what `apps/service` verifies with.
      expect(row?.secretHash).toBe(createHash('sha256').update(secret!).digest('hex'))
      expect(JSON.stringify(row)).not.toContain(secret)
      expect(row?.scopes).toEqual(['job.read'])
      expect(row?.createdById).toBe(ADMIN_PRINCIPAL)
      expect(row?.expiresAt).toBeNull()
    })

    it('keeps an expiry date when one is given', async () => {
      const name = nextName()
      await createApiKey(
        {},
        form({ name, customerId: CUSTOMER, branchId: HOME_BRANCH, expiresAt: '2030-01-31' }),
      )
      expect((await keyByName(name))?.expiresAt?.toISOString().slice(0, 10)).toBe('2030-01-31')
    })

    it('names each missing or malformed field', async () => {
      const state = await createApiKey(
        {},
        form({ name: 'ab', customerId: 'nope', branchId: '', expiresAt: '31/01/2030' }),
      )
      expect(state.errors).toMatchObject({
        name: 'adminValidation.keyName',
        customerId: 'adminValidation.chooseCustomerForKey',
        branchId: 'adminValidation.chooseBranch',
        expiresAt: 'adminValidation.dateFormat',
      })
      // What was typed comes back, so the dialog does not lose it.
      expect(state.values?.name).toBe('ab')
    })

    it('refuses to issue a key for a branch the administrator is not in', async () => {
      await expect(
        createApiKey(
          {},
          form({ name: nextName(), customerId: CUSTOMER, branchId: FOREIGN_BRANCH }),
        ),
      ).rejects.toThrow()
    })
  })

  describe('listing keys', () => {
    it('shows the key by prefix with its customer, and never a secret', async () => {
      const name = nextName()
      const state = await createApiKey(
        {},
        form({ name, customerId: CUSTOMER, branchId: HOME_BRANCH }),
      )
      const [prefix, secret] = token(state.ok).split('.')

      const listed = await listApiKeys()
      const mine = listed.find((k) => k.prefix === prefix)

      expect(mine?.name).toBe(name)
      expect(mine?.customerName).toBeTruthy()
      expect(mine?.createdBy).toBe('Fixture Administrator')
      expect(mine?.revokedAt).toBeNull()
      expect(mine).not.toHaveProperty('secretHash')
      expect(JSON.stringify(listed)).not.toContain(secret)
    })
  })

  describe('revoking a key', () => {
    it('stamps the revocation rather than removing the row — §5.5', async () => {
      const name = nextName()
      await createApiKey({}, form({ name, customerId: CUSTOMER, branchId: HOME_BRANCH }))
      const created = await keyByName(name)

      const state = await revokeApiKey({}, form({ keyId: created!.id }))

      expect(token(state.ok)).toBe(created!.id)
      const after = await keyByName(name)
      expect(after?.revokedAt).toBeInstanceOf(Date)
      expect(after?.revokedById).toBe(ADMIN_PRINCIPAL)
    })

    /** A second click must not move the date the key actually stopped working. */
    it('leaves an already-revoked key alone and says so', async () => {
      const name = nextName()
      await createApiKey({}, form({ name, customerId: CUSTOMER, branchId: HOME_BRANCH }))
      const created = await keyByName(name)
      await revokeApiKey({}, form({ keyId: created!.id }))
      const first = (await keyByName(name))!.revokedAt

      const again = await revokeApiKey({}, form({ keyId: created!.id }))

      expect(again.message).toBe('adminValidation.alreadyRevoked')
      expect((await keyByName(name))!.revokedAt).toEqual(first)
    })

    it('treats an unknown key the same way', async () => {
      const state = await revokeApiKey({}, form({ keyId: '00000000-0000-7000-8000-0000000eeeee' }))
      expect(state.message).toBe('adminValidation.alreadyRevoked')
    })

    it('says so plainly when nothing was chosen', async () => {
      expect((await revokeApiKey({}, form({}))).message).toBe('adminValidation.nothingToRevoke')
    })
  })

  describe('webhook endpoints', () => {
    /** Stored in clear because the worker signs with it — so it must match what was shown. */
    it('subscribes a URL and hands back the signing secret it will sign with', async () => {
      const url = nextUrl()
      const state = await createWebhookEndpoint(
        {},
        form({
          url,
          customerId: CUSTOMER,
          branchId: HOME_BRANCH,
          events: 'shipment.created, milestone.reached\ninvoice.issued',
        }),
      )

      expect(state.errors).toBeUndefined()
      const secret = token(state.ok)
      expect(secret).toMatch(/^[0-9a-f]{64}$/)

      const row = await endpointByUrl(url)
      expect(row?.secret).toBe(secret)
      expect(row?.customerId).toBe(CUSTOMER)
      expect(row?.branchId).toBe(HOME_BRANCH)
      expect(row?.events).toEqual(['shipment.created', 'milestone.reached', 'invoice.issued'])
      expect(row?.isActive).toBe(true)
    })

    /** Empty means everything — what a customer integrating a whole pipeline asks for. */
    it('subscribes to every event when none are named, with no customer', async () => {
      const url = nextUrl()
      const state = await createWebhookEndpoint({}, form({ url, branchId: HOME_BRANCH }))

      expect(state.errors).toBeUndefined()
      const row = await endpointByUrl(url)
      expect(row?.events).toEqual([])
      expect(row?.customerId).toBeNull()
    })

    /**
     * A4. No branch is every branch's events, and the session here administers
     * two branches of a database that holds more. Deployment-wide is for an
     * administrator of every branch; anybody else is asked to choose one.
     */
    it('refuses an endpoint for every branch from an administrator of only some', async () => {
      const url = nextUrl()
      const state = await createWebhookEndpoint({}, form({ url }))

      expect(state.errors?.branchId).toBe('adminValidation.webhookEveryBranch')
      expect(await endpointByUrl(url)).toBeUndefined()
    })

    /** A2. Holding the key in one branch is not holding it in another. */
    it('refuses a branch where the administrator holds a role but not the key', async () => {
      harness.session = {
        ...session,
        branchPermissions: new Map([
          [HOME_BRANCH, new Set(['admin.api_keys.write'])],
          [AWAY_BRANCH, new Set<string>()],
        ]),
      }
      try {
        const url = nextUrl()
        const state = await createWebhookEndpoint({}, form({ url, branchId: AWAY_BRANCH }))
        expect(state.errors?.branchId).toBe('adminValidation.apiAccessNotAdministered')
        await expect(
          createApiKey({}, form({ name: nextName(), customerId: CUSTOMER, branchId: AWAY_BRANCH })),
        ).rejects.toThrow()
      } finally {
        harness.session = session
      }
    })

    it('refuses plain HTTP, because a signature does not stop anyone reading', async () => {
      const url = `http://hooks.example.test/${RUN}/plain`
      const state = await createWebhookEndpoint({}, form({ url }))

      expect(state.errors?.url).toBe('adminValidation.httpsOnly')
      expect(await endpointByUrl(url)).toBeUndefined()
    })

    it('refuses something that is not a URL at all', async () => {
      const state = await createWebhookEndpoint({}, form({ url: 'not a url' }))
      expect(state.errors?.url).toBe('adminValidation.postUrl')
    })

    it('refuses a customer that is not an id', async () => {
      const state = await createWebhookEndpoint({}, form({ url: nextUrl(), customerId: 'acme' }))
      expect(state.errors?.customerId).toBeDefined()
    })

    it('refuses a branch the administrator is not in', async () => {
      const state = await createWebhookEndpoint(
        {},
        form({ url: nextUrl(), branchId: FOREIGN_BRANCH }),
      )
      expect(state.errors?.branchId).toBe('adminValidation.apiAccessNotAdministered')
    })

    it('lists an endpoint with its delivery counts and never its secret', async () => {
      const url = nextUrl()
      const state = await createWebhookEndpoint(
        {},
        form({ url, customerId: CUSTOMER, branchId: HOME_BRANCH }),
      )
      const secret = token(state.ok)

      const listed = await listWebhookEndpoints()
      const mine = listed.find((e) => e.url === url)

      expect(mine?.isActive).toBe(true)
      expect(mine?.customerName).toBeTruthy()
      expect(mine?.queued).toBe(0)
      expect(mine?.failed).toBe(0)
      expect(mine?.lastDeliveredAt).toBeNull()
      expect(JSON.stringify(listed)).not.toContain(secret)
    })

    /**
     * Switching off means *omitting* `isActive`, as an unchecked checkbox
     * arrives; switching back on clears the reason so a stale "disabled
     * because…" does not sit under a live endpoint.
     */
    it('switches a subscriber off and back on', async () => {
      const url = nextUrl()
      await createWebhookEndpoint({}, form({ url, branchId: HOME_BRANCH }))
      const { id } = (await endpointByUrl(url))!

      const off = await setWebhookEndpointActive({}, form({ endpointId: id }))
      expect(token(off.ok)).toBe(id)
      const disabled = await endpointById(id)
      expect(disabled?.isActive).toBe(false)
      expect(disabled?.disabledAt).toBeInstanceOf(Date)
      expect(disabled?.disabledReason).toBe('switched_off')

      await setWebhookEndpointActive({}, form({ endpointId: id, isActive: 'on' }))
      const enabled = await endpointById(id)
      expect(enabled?.isActive).toBe(true)
      expect(enabled?.disabledAt).toBeNull()
      expect(enabled?.disabledReason).toBeNull()
    })

    it('says so plainly when no endpoint was chosen', async () => {
      expect((await setWebhookEndpointActive({}, form({}))).message).toBe(
        'adminValidation.nothingToChange',
      )
    })
  })

  describe('permissions', () => {
    /** The key opens all six; a caller without it gets none of them. */
    it('refuses every action to a caller without admin.api_keys.write', async () => {
      harness.session = { ...session, permissions: new Set(['admin.users.write']) }
      try {
        await expect(listApiKeys()).rejects.toThrow()
        await expect(listWebhookEndpoints()).rejects.toThrow()
        await expect(
          createApiKey({}, form({ name: nextName(), customerId: CUSTOMER, branchId: HOME_BRANCH })),
        ).rejects.toThrow()
        await expect(revokeApiKey({}, form({ keyId: CUSTOMER }))).rejects.toThrow()
        await expect(createWebhookEndpoint({}, form({ url: nextUrl() }))).rejects.toThrow()
        await expect(setWebhookEndpointActive({}, form({ endpointId: CUSTOMER }))).rejects.toThrow()
      } finally {
        harness.session = session
      }
    })
  })

  describe('the hosted demo', () => {
    /** With fixtures on, the lists never reach `withActor` — the demo has no database. */
    it('reads the pilot fixtures instead of the database', async () => {
      const previous = process.env.QABANDI_PILOT_FIXTURES
      process.env.QABANDI_PILOT_FIXTURES = '1'
      try {
        expect(Array.isArray(await listApiKeys())).toBe(true)
        expect(Array.isArray(await listWebhookEndpoints())).toBe(true)
      } finally {
        if (previous === undefined) delete process.env.QABANDI_PILOT_FIXTURES
        else process.env.QABANDI_PILOT_FIXTURES = previous
      }
    })
  })
})
