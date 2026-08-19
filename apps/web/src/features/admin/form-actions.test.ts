/**
 * Administration — who may sign in, what they may do, and where.
 *
 * The only slice whose bugs are access-control bugs. Two properties are worth
 * more than the rest and are checked first: an invitation creates an identity
 * with **no credential** (an administrator who can set a colleague's password
 * can sign in as them, and the audit log would say it was the colleague), and
 * a role is granted **per branch** (FR-ID-02) rather than as a column on the
 * user.
 *
 * The duplicate-email path is here deliberately. It runs through
 * `isUniqueViolation`, which until recently never fired because Drizzle wraps
 * the driver's error — so this asserts the sentence rather than the 500.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const harness = vi.hoisted(() => ({ session: null as unknown }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/session', () => ({ requireSession: async () => harness.session }))

const { authAccount, branches, principalBranchRoles, principals, roles, withActor } =
  await import('@qabandi/db')

const { ADMIN_PRINCIPAL, AWAY_BRANCH, HOME_BRANCH, adminActor, world } =
  await import('@/lib/testing/fixtures')

const {
  saveUser,
  setUserActive,
  saveBranch,
  saveReferenceRecord,
  listAssignableRoles,
  getUserGrants,
} = await import('./form-actions')

const session = {
  actor: adminActor,
  principal: {
    id: ADMIN_PRINCIPAL,
    nameEn: 'Fixture Administrator',
    nameAr: null,
    email: 'fixtures-admin@qabandi.test',
    locale: 'en' as const,
  },
  permissions: new Set([
    'admin.users.write',
    'admin.branches.write',
    'admin.reference.write',
    'admin.audit.read',
    'admin.brand.read',
  ]),
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

let coordinatorRoleId: string
let financeRoleId: string
let calendarId: string
let seq = 0

const nextEmail = () => `invited-${(seq += 1)}-${Date.now()}@qabandi.test`

async function principalByEmail(email: string) {
  const [row] = await withActor(adminActor, (tx) =>
    tx
      .select({ id: principals.id, isActive: principals.isActive, nameEn: principals.nameEn })
      .from(principals)
      .where(eq(principals.email, email))
      .limit(1),
  )
  return row
}

describe.skipIf(!enabled)('administration', () => {
  beforeAll(async () => {
    const built = await world()
    calendarId = built.calendarId
    harness.session = session

    const found = await withActor({ ...adminActor, type: 'system' }, (tx) =>
      tx.select({ id: roles.id, key: roles.key }).from(roles),
    )
    coordinatorRoleId = found.find((r) => r.key === 'coordinator')!.id
    financeRoleId = found.find((r) => r.key === 'finance')!.id
  })

  afterAll(() => {
    harness.session = null
  })

  describe('inviting a user', () => {
    it('creates the identity', async () => {
      const email = nextEmail()
      const state = await saveUser(
        {},
        form({
          nameEn: 'Invited Person',
          email,
          locale: 'en',
          roleId: coordinatorRoleId,
          branchIds: [HOME_BRANCH],
          isActive: 'on',
        }),
      )

      expect(state.errors).toBeUndefined()
      expect((await principalByEmail(email))?.nameEn).toBe('Invited Person')
    })

    /**
     * No credential, deliberately. Passwords are set by the person who owns
     * them — through `db:create-user` on day one or a reset link after that.
     */
    it('leaves the new account with no credential to sign in with', async () => {
      const email = nextEmail()
      await saveUser(
        {},
        form({
          nameEn: 'No Password',
          email,
          locale: 'en',
          roleId: coordinatorRoleId,
          branchIds: [HOME_BRANCH],
          isActive: 'on',
        }),
      )

      const principal = await principalByEmail(email)
      const credentials = await withActor(adminActor, (tx) =>
        tx.select({ id: authAccount.id }).from(authAccount).where(eq(authAccount.userId, email)),
      )
      expect(principal).toBeDefined()
      expect(credentials).toEqual([])
    })

    /** FR-ID-02 — the grant is a row per branch, not a column on the user. */
    it('grants the role once per branch', async () => {
      const email = nextEmail()
      await saveUser(
        {},
        form({
          nameEn: 'Two Branches',
          email,
          locale: 'en',
          roleId: financeRoleId,
          branchIds: [HOME_BRANCH, AWAY_BRANCH],
          isActive: 'on',
        }),
      )

      const principal = await principalByEmail(email)
      const grants = await withActor(adminActor, (tx) =>
        tx
          .select({ branchId: principalBranchRoles.branchId })
          .from(principalBranchRoles)
          .where(eq(principalBranchRoles.principalId, principal!.id)),
      )
      expect(grants.map((g) => g.branchId).sort()).toEqual([HOME_BRANCH, AWAY_BRANCH].sort())
    })

    it('insists on at least one branch', async () => {
      const state = await saveUser(
        {},
        form({
          nameEn: 'Nowhere Person',
          email: nextEmail(),
          locale: 'en',
          roleId: coordinatorRoleId,
          isActive: 'on',
        }),
      )
      expect(state.errors?.branchIds).toBeDefined()
    })

    it('refuses an address that is not one', async () => {
      const state = await saveUser(
        {},
        form({
          nameEn: 'Bad Address',
          email: 'not-an-email',
          locale: 'en',
          roleId: coordinatorRoleId,
          branchIds: [HOME_BRANCH],
          isActive: 'on',
        }),
      )
      expect(state.errors?.email).toBeDefined()
    })

    /**
     * The path that produced a 500 until `isUniqueViolation` learned to see
     * through Drizzle's wrapper. It must be a sentence on the field.
     */
    it('says who already has the address rather than raising', async () => {
      const email = nextEmail()
      const fields = {
        nameEn: 'First',
        email,
        locale: 'en',
        roleId: coordinatorRoleId,
        branchIds: [HOME_BRANCH],
        isActive: 'on',
      }
      await saveUser({}, form(fields))

      const again = await saveUser({}, form({ ...fields, nameEn: 'Second' }))

      expect(again.errors?.email).toContain('already has that email')
    })

    it('lower-cases the address, so one person is one identity', async () => {
      const email = nextEmail()
      await saveUser(
        {},
        form({
          nameEn: 'Shouty',
          email: email.toUpperCase(),
          locale: 'en',
          roleId: coordinatorRoleId,
          branchIds: [HOME_BRANCH],
          isActive: 'on',
        }),
      )
      expect(await principalByEmail(email)).toBeDefined()
    })
  })

  describe('suspending a user', () => {
    it('deactivates rather than deletes — §5.5', async () => {
      const email = nextEmail()
      await saveUser(
        {},
        form({
          nameEn: 'To Suspend',
          email,
          locale: 'en',
          roleId: coordinatorRoleId,
          branchIds: [HOME_BRANCH],
          isActive: 'on',
        }),
      )
      const principal = await principalByEmail(email)

      /*
        Deactivating means *omitting* the field, not sending 'false'. The
        action reads `form.get('isActive') !== null`, which is how an unchecked
        HTML checkbox arrives — it is absent, not false.
      */
      const state = await setUserActive({}, form({ principalId: principal!.id }))

      expect(state.errors).toBeUndefined()
      const after = await principalByEmail(email)
      expect(after).toBeDefined()
      expect(after!.isActive).toBe(false)
    })

    /** Locking yourself out of the only administrator account. */
    it('refuses to suspend your own account', async () => {
      const state = await setUserActive({}, form({ principalId: ADMIN_PRINCIPAL }))
      expect(state.message).toContain('your own account')
    })

    it('says so plainly when nobody was chosen', async () => {
      expect((await setUserActive({}, form({}))).errors).toBeDefined()
    })
  })

  describe('branches', () => {
    it('creates one', async () => {
      const code = `B${String(Date.now()).slice(-6)}${(seq += 1)}`.slice(0, 8)
      const state = await saveBranch(
        {},
        form({
          code,
          legalNameEn: 'Test Entity',
          legalNameAr: 'كيان الاختبار',
          baseCurrency: 'KWD',
          country: 'KW',
          calendarId,
          timeZone: 'Asia/Kuwait',
          invoiceSeries: code,
          isActive: 'on',
        }),
      )
      expect(state.errors).toBeUndefined()

      const [row] = await withActor(adminActor, (tx) =>
        tx.select({ code: branches.code }).from(branches).where(eq(branches.code, code)),
      )
      expect(row?.code).toBe(code)
    })

    /**
     * Arabic is required on a branch, not optional. It is what prints on an
     * Arabic invoice, and a blank there is a document that cannot be issued.
     */
    it('insists on the Arabic legal name', async () => {
      const state = await saveBranch(
        {},
        form({
          code: 'NOAR',
          legalNameEn: 'No Arabic',
          legalNameAr: '',
          baseCurrency: 'KWD',
          country: 'KW',
          calendarId,
          timeZone: 'Asia/Kuwait',
          invoiceSeries: 'NOAR',
          isActive: 'on',
        }),
      )
      expect(state.errors?.legalNameAr).toBeDefined()
    })

    it('insists on a working calendar', async () => {
      const state = await saveBranch(
        {},
        form({
          code: 'NOCA',
          legalNameEn: 'No Calendar',
          legalNameAr: 'بدون تقويم',
          baseCurrency: 'KWD',
          country: 'KW',
          timeZone: 'Asia/Kuwait',
          invoiceSeries: 'NOCA',
          isActive: 'on',
        }),
      )
      expect(state.errors?.calendarId).toBeDefined()
    })

    it('reports a duplicate branch code rather than raising', async () => {
      const state = await saveBranch(
        {},
        form({
          code: 'FXH',
          legalNameEn: 'Clashing Entity',
          legalNameAr: 'كيان',
          baseCurrency: 'KWD',
          country: 'KW',
          calendarId,
          timeZone: 'Asia/Kuwait',
          invoiceSeries: 'FXH',
          isActive: 'on',
        }),
      )
      expect(state.errors?.code).toBeDefined()
    })
  })

  describe('the pickers behind the forms', () => {
    it('offers the assignable roles', async () => {
      const options = await listAssignableRoles()
      expect(options.map((r) => r.key)).toContain('coordinator')
    })

    it('reads a user’s grants back', async () => {
      const grants = await getUserGrants(ADMIN_PRINCIPAL)
      expect(grants).toBeDefined()
    })
  })

  describe('reference data — FR-AD-03', () => {
    it('reports field errors rather than throwing on a bad record', async () => {
      const state = await saveReferenceRecord({}, form({ table: 'not_a_table' }))
      expect(state.errors ?? state.message).toBeTruthy()
    })
  })
})
