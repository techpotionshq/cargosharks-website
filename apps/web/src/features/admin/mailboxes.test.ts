/**
 * Mailboxes — the five front doors, configured as rows (FR-EQ-02, FR-AD-03).
 *
 * The property worth more than the rest is that the password goes in and
 * never comes back: it is sealed before it reaches the table, a blank field on
 * an edit means "unchanged" rather than "cleared", and neither the list nor a
 * rejected form's echo carries it.
 *
 * Every mailbox here is on a `.invalid` host, which can never resolve, and is
 * left inactive when the suite ends. The test database is not the one the
 * running service polls, but a row that could connect somewhere is not worth
 * leaving behind in a database that is never emptied.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { and, eq } from 'drizzle-orm'

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

const { mailboxes, openSecret, withActor } = await import('@qabandi/db')

const { ADMIN_PRINCIPAL, AWAY_BRANCH, HOME_BRANCH, adminActor, world } =
  await import('@/lib/testing/fixtures')

const { listMailboxes, mailboxKeyConfigured, saveMailbox, setMailboxActive } =
  await import('./mailboxes')

const session = {
  actor: adminActor,
  principal: {
    id: ADMIN_PRINCIPAL,
    nameEn: 'Fixture Administrator',
    nameAr: null,
    email: 'fixtures-admin@qabandi.test',
    locale: 'en' as const,
  },
  permissions: new Set(['admin.mailboxes.write']),
  branchRoles: new Map([
    [HOME_BRANCH, 'administrator'],
    [AWAY_BRANCH, 'administrator'],
  ]),
  requiresTwoFactor: false,
}

/** One branch only — for what RLS and `assertInBranch` keep out. */
const homeOnly = {
  ...session,
  actor: { ...adminActor, branchIds: [HOME_BRANCH] },
  branchRoles: new Map([[HOME_BRANCH, 'administrator']]),
}

const form = (fields: Record<string, string | string[]>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) value.forEach((v) => data.append(key, v))
    else data.set(key, value)
  }
  return data
}

/** Per-run, because mailboxes are deactivated rather than removed. */
const RUN = Date.now().toString(36).toUpperCase().slice(-5)
const HOST = `imap.${RUN.toLowerCase()}.invalid`
let seq = 0
const nextUsername = () => `intake-${RUN.toLowerCase()}-${(seq += 1)}@qabandi.test`

/** A throwaway key for this suite, so it runs whether or not `.env.local` has one. */
const TEST_KEY = randomBytes(32).toString('base64')
const originalKey = process.env.MAILBOX_ENCRYPTION_KEY

const created = new Set<string>()

const mailbox = (fields: Record<string, string> = {}) =>
  form({
    branchId: HOME_BRANCH,
    host: HOST,
    port: '993',
    secure: 'on',
    username: nextUsername(),
    password: 'correct horse battery staple',
    ...fields,
  })

/** Reads the sealed column, which nothing in the web app is meant to select. */
async function rowFor(username: string, host = HOST) {
  const [row] = await withActor({ ...adminActor, type: 'system' }, (tx) =>
    tx
      .select()
      .from(mailboxes)
      .where(and(eq(mailboxes.host, host), eq(mailboxes.username, username)))
      .limit(1),
  )
  if (row) created.add(row.id)
  return row
}

async function connect(fields: Record<string, string> = {}) {
  const data = mailbox(fields)
  const state = await saveMailbox({}, data)
  expect(state.errors).toBeUndefined()
  const row = await rowFor(String(data.get('username')), String(data.get('host')))
  expect(row).toBeDefined()
  return row!
}

describe.skipIf(!enabled)('mailboxes', () => {
  beforeAll(async () => {
    await world()
    process.env.MAILBOX_ENCRYPTION_KEY = TEST_KEY
    harness.session = session
  })

  afterAll(async () => {
    // Nothing this suite made is left in a state the poll would pick up.
    harness.session = session
    for (const id of created) await setMailboxActive({}, form({ mailboxId: id }))
    harness.session = null
    if (originalKey === undefined) delete process.env.MAILBOX_ENCRYPTION_KEY
    else process.env.MAILBOX_ENCRYPTION_KEY = originalKey
  })

  describe('whether a password can be sealed at all', () => {
    it('says yes with a well-formed key', async () => {
      expect(await mailboxKeyConfigured()).toBe(true)
    })

    /** Read at use, not cached at import — so the screen notices a restart's worth of change. */
    it('says no without one, and no again for a passphrase in its place', async () => {
      try {
        delete process.env.MAILBOX_ENCRYPTION_KEY
        expect(await mailboxKeyConfigured()).toBe(false)
        process.env.MAILBOX_ENCRYPTION_KEY = 'a passphrase somebody typed'
        expect(await mailboxKeyConfigured()).toBe(false)
      } finally {
        process.env.MAILBOX_ENCRYPTION_KEY = TEST_KEY
      }
    })
  })

  describe('connecting a mailbox', () => {
    it('stores the password sealed, never as typed', async () => {
      const row = await connect({ password: 'plain-secret-1', folder: 'Enquiries' })

      expect(row.passwordSealed).not.toContain('plain-secret-1')
      expect(row.passwordSealed.startsWith('v1:')).toBe(true)
      expect(openSecret(row.passwordSealed)).toBe('plain-secret-1')
      expect(row.folder).toBe('Enquiries')
      expect(row.archiveFolder).toBeNull()
    })

    it('falls back to 993 and INBOX, and reads an unticked box as STARTTLS', async () => {
      const username = nextUsername()
      const data = mailbox({ username })
      data.delete('port')
      data.delete('secure')
      await saveMailbox({}, data)

      const row = await rowFor(username)
      expect(row?.port).toBe(993)
      expect(row?.folder).toBe('INBOX')
      expect(row?.secure).toBe(false)
    })

    it('insists on a password for a new mailbox', async () => {
      const state = await saveMailbox({}, mailbox({ password: '' }))
      expect(state.errors?.password).toBe('adminValidation.mailboxPassword')
    })

    /** The echo lands in the HTML of the response, which is no place for a credential. */
    it('re-renders a rejected form without the password in it', async () => {
      const state = await saveMailbox({}, mailbox({ port: '70000', password: 'do-not-echo' }))

      expect(state.errors?.port).toBeDefined()
      expect(state.values?.host).toBe(HOST)
      expect(state.values).not.toHaveProperty('password')
    })

    it('refuses a port that is not one', async () => {
      expect((await saveMailbox({}, mailbox({ port: '0' }))).errors?.port).toBeDefined()
      expect((await saveMailbox({}, mailbox({ port: 'imap' }))).errors?.port).toBeDefined()
    })

    it('insists on a host, a username and a branch', async () => {
      expect((await saveMailbox({}, mailbox({ host: '  ' }))).errors?.host).toBeDefined()
      expect((await saveMailbox({}, mailbox({ username: '' }))).errors?.username).toBeDefined()
      expect((await saveMailbox({}, mailbox({ branchId: 'dxb' }))).errors?.branchId).toBeDefined()
    })

    it('says the key is missing rather than failing to seal', async () => {
      try {
        delete process.env.MAILBOX_ENCRYPTION_KEY
        const state = await saveMailbox({}, mailbox())
        expect(state.errors?._).toBe('adminValidation.mailboxKeyMissing')
        expect(state.values).not.toHaveProperty('password')
      } finally {
        process.env.MAILBOX_ENCRYPTION_KEY = TEST_KEY
      }
    })

    /**
     * Two rows for one address would poll it twice; the second finds nothing.
     *
     * This raised until `saveMailbox` read `databaseMessage(error)`: under
     * Drizzle the constraint name is on the wrapped error's `.cause`, not on
     * the top-level message (see `isUniqueViolation` in `form-state.ts`).
     */
    it('names the clash rather than raising when the address is already connected', async () => {
      const username = nextUsername()
      await connect({ username })

      const again = await saveMailbox({}, mailbox({ username, branchId: AWAY_BRANCH }))

      expect(again.errors?.username).toBe('adminValidation.mailboxConnected')
    })

    it('refuses a branch the administrator does not hold', async () => {
      harness.session = homeOnly
      try {
        await expect(saveMailbox({}, mailbox({ branchId: AWAY_BRANCH }))).resolves.toMatchObject({
          message: expect.stringContaining('forbiddenAction'),
        })
      } finally {
        harness.session = session
      }
    })

    it('refuses a caller without the mailbox key', async () => {
      harness.session = { ...session, permissions: new Set(['admin.users.write']) }
      try {
        await expect(saveMailbox({}, mailbox())).resolves.toMatchObject({
          message: expect.stringContaining('forbiddenAction'),
        })
        await expect(listMailboxes()).rejects.toThrow('admin.mailboxes.write')
        await expect(mailboxKeyConfigured()).rejects.toThrow('admin.mailboxes.write')
        await expect(setMailboxActive({}, form({ mailboxId: 'x' }))).resolves.toMatchObject({
          message: expect.stringContaining('forbiddenAction'),
        })
      } finally {
        harness.session = session
      }
    })
  })

  describe('editing a mailbox', () => {
    /**
     * Blank means unchanged. An administrator fixing a folder name must not
     * have to re-type a credential they may not have.
     */
    it('keeps the sealed password when the field is left blank', async () => {
      const username = nextUsername()
      const before = await connect({ username, password: 'kept-secret' })

      const state = await saveMailbox(
        {},
        mailbox({
          mailboxId: before.id,
          username,
          password: '',
          folder: 'Quotes',
          archiveFolder: 'Handled',
        }),
      )

      const after = await rowFor(username)
      expect(state.ok).toBeTruthy()
      expect(after?.passwordSealed).toBe(before.passwordSealed)
      expect(after?.folder).toBe('Quotes')
      expect(after?.archiveFolder).toBe('Handled')
    })

    it('replaces it when a new one is typed, and clears the stale error', async () => {
      const username = nextUsername()
      const before = await connect({ username, password: 'old-secret' })
      await withActor(adminActor, (tx) =>
        tx
          .update(mailboxes)
          .set({ lastError: 'AUTHENTICATIONFAILED' })
          .where(eq(mailboxes.id, before.id)),
      )

      await saveMailbox({}, mailbox({ mailboxId: before.id, username, password: 'new-secret' }))

      const after = await rowFor(username)
      expect(after?.passwordSealed).not.toBe(before.passwordSealed)
      expect(openSecret(after!.passwordSealed)).toBe('new-secret')
      expect(after?.lastError).toBeNull()
    })

    /*
      F54: an edit whose id matches no row used to report success and change
      nothing, and an id that is not a uuid reached the database as a cast
      error. Both are now a sentence on the form, and neither writes a row —
      in particular the edit is never quietly turned into an insert.
    */
    it('refuses an edit to a mailbox that is not there, rather than reporting success', async () => {
      const username = nextUsername()
      const state = await saveMailbox(
        {},
        mailbox({ mailboxId: '00000000-0000-7000-8000-00000000ffff', username }),
      )

      expect(state.ok).toBeUndefined()
      expect(state.errors).toEqual({ _: 'adminValidation.mailboxGone' })
      expect(state.values?.password).toBeUndefined()
      expect(await rowFor(username)).toBeUndefined()
    })

    it('refuses a mailbox id that is not an id, before the database sees it', async () => {
      const username = nextUsername()
      const state = await saveMailbox({}, mailbox({ mailboxId: 'not-a-uuid', username }))

      expect(state.errors).toEqual({ _: 'adminValidation.missingMailbox' })
      expect(await rowFor(username)).toBeUndefined()
    })
  })

  describe('starting and stopping a mailbox', () => {
    it('deactivates rather than deletes, and clears the error on the way back', async () => {
      const row = await connect()

      const off = await setMailboxActive({}, form({ mailboxId: row.id }))
      expect(off.ok).toBeTruthy()
      expect((await rowFor(row.username))?.isActive).toBe(false)

      await withActor(adminActor, (tx) =>
        tx.update(mailboxes).set({ lastError: 'timeout' }).where(eq(mailboxes.id, row.id)),
      )
      await setMailboxActive({}, form({ mailboxId: row.id, isActive: 'true' }))
      const on = await rowFor(row.username)
      expect(on?.isActive).toBe(true)
      expect(on?.lastError).toBeNull()

      await setMailboxActive({}, form({ mailboxId: row.id }))
      expect((await rowFor(row.username))?.isActive).toBe(false)
    })

    it('says so plainly when nobody was chosen', async () => {
      expect((await setMailboxActive({}, form({}))).errors?._).toBe(
        'adminValidation.missingMailbox',
      )
    })

    /** Invisible under RLS reads as not-found — no signal about another branch. */
    it('cannot see another branch’s mailbox to switch it', async () => {
      const away = await connect({ branchId: AWAY_BRANCH })
      harness.session = homeOnly
      try {
        await expect(setMailboxActive({}, form({ mailboxId: away.id }))).rejects.toThrow(
          'not_found',
        )
      } finally {
        harness.session = session
      }
    })
  })

  describe('the list', () => {
    it('shows every mailbox the branches own, and never the credential', async () => {
      const row = await connect()
      await setMailboxActive({}, form({ mailboxId: row.id }))

      const list = await listMailboxes()
      const mine = list.find((m) => m.id === row.id)

      // Deactivated stays listed — it answers "why did that office go quiet".
      expect(mine?.isActive).toBe(false)
      expect(mine?.branchCode).toBeTruthy()
      for (const entry of list) {
        expect(entry).not.toHaveProperty('passwordSealed')
        expect(JSON.stringify(entry)).not.toContain('v1:')
      }
    })

    it('leaves out a branch the administrator does not hold', async () => {
      const away = await connect({ branchId: AWAY_BRANCH })
      harness.session = homeOnly
      try {
        const list = await listMailboxes()
        expect(list.some((m) => m.id === away.id)).toBe(false)
        expect(list.every((m) => m.branchId === HOME_BRANCH)).toBe(true)
      } finally {
        harness.session = session
      }
    })

    it('reads the seeded fixtures in the hosted demo', async () => {
      const previous = process.env.QABANDI_PILOT_FIXTURES
      process.env.QABANDI_PILOT_FIXTURES = '1'
      try {
        const list = await listMailboxes()
        expect(list.length).toBeGreaterThan(0)
        expect(list.some((m) => m.host.endsWith('.invalid'))).toBe(false)
      } finally {
        if (previous === undefined) delete process.env.QABANDI_PILOT_FIXTURES
        else process.env.QABANDI_PILOT_FIXTURES = previous
      }
    })
  })
})
