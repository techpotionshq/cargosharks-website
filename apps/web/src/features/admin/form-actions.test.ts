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

const harness = vi.hoisted(() => ({
  session: null as unknown,
  /** The mail outcome a sign-in link reports — the service is not running here. */
  linkOutcome: 'not_configured' as string,
  linksSent: [] as string[],
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/session', () => ({ requireSession: async () => harness.session }))

/*
  The reset flow runs inside Better Auth and mails through the service, neither
  of which this suite stands up. What is asserted is that an invitation asks for
  the link, and that the administrator is told what became of it.
*/
vi.mock('./sign-in-link', () => ({
  sendSignInLink: async (email: string) => {
    harness.linksSent.push(email)
    return harness.linkOutcome
  },
}))

/**
 * The message keys stand in for the sentences, so an assertion names the case
 * rather than a wording a translator is free to change — as in `auth/actions.test.ts`.
 */
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    values ? `${namespace}.${key}:${JSON.stringify(values)}` : `${namespace}.${key}`,
}))

const {
  authAccount,
  authUser,
  branches,
  chargeTypes,
  commodities,
  documentTypes,
  exceptionCodes,
  principalBranchRoles,
  principals,
  roles,
  withActor,
} = await import('@qabandi/db')

const { ADMIN_PRINCIPAL, AWAY_BRANCH, CUSTOMER, HOME_BRANCH, adminActor, world } =
  await import('@/lib/testing/fixtures')

const {
  saveUser,
  setUserActive,
  saveBranch,
  saveReferenceRecord,
  listAssignableRoles,
  getUserGrants,
  sendUserSignInLink,
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

/** Per-run, because reference rows are retired rather than removed. */
const RUN = Date.now().toString(36).toUpperCase().slice(-5)

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
     * A login, and no password — A7.
     *
     * The invitation used to write a principal and nothing else, so the
     * person invited could never sign in. Now it creates the `auth_user` and
     * mails a link through the reset flow; the password is still set only by
     * the person who owns it, so there is still no credential row.
     */
    it('creates a login with no password, and sends the link to set one', async () => {
      const email = nextEmail()
      harness.linksSent = []
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
      const [login] = await withActor(adminActor, (tx) =>
        tx.select({ id: authUser.id }).from(authUser).where(eq(authUser.email, email)),
      )
      const credentials = await withActor(adminActor, (tx) =>
        tx
          .select({ id: authAccount.id })
          .from(authAccount)
          .where(eq(authAccount.userId, login!.id)),
      )
      const [linked] = await withActor(adminActor, (tx) =>
        tx
          .select({ authUserId: principals.authUserId })
          .from(principals)
          .where(eq(principals.id, principal!.id)),
      )
      expect(linked?.authUserId).toBe(login!.id)
      expect(credentials).toEqual([])
      expect(harness.linksSent).toEqual([email])
    })

    /** "Sent" is said only when the mail service took it. */
    it('tells the administrator honestly when the link could not be mailed', async () => {
      const email = nextEmail()
      await saveUser(
        {},
        form({
          nameEn: 'Unmailed',
          email,
          locale: 'en',
          roleId: coordinatorRoleId,
          branchIds: [HOME_BRANCH],
          isActive: 'on',
        }),
      )
      const principal = await principalByEmail(email)

      harness.linkOutcome = 'not_configured'
      const unsent = await sendUserSignInLink({}, form({ principalId: principal!.id }))
      expect(unsent.ok).toBeUndefined()
      expect(unsent.message).toBe('adminValidation.signInLink.not_configured')

      harness.linkOutcome = 'sent'
      const sent = await sendUserSignInLink({}, form({ principalId: principal!.id }))
      expect(sent.ok).toBeDefined()
      expect(sent.message).toBe(`adminValidation.signInLinkSent:${JSON.stringify({ email })}`)
      harness.linkOutcome = 'not_configured'
    })

    /**
     * A2. Administrator in one branch, read-only in the other: the pooled
     * permission set said "can write users" and the role in the second branch
     * said "works there", and together they let this person make themselves
     * administrator there.
     */
    it('refuses a grant in a branch the administrator only holds a lesser role in', async () => {
      harness.session = {
        ...session,
        branchRoles: new Map([
          [HOME_BRANCH, 'administrator'],
          [AWAY_BRANCH, 'read_only'],
        ]),
        branchPermissions: new Map([
          [HOME_BRANCH, new Set(['admin.users.write'])],
          [AWAY_BRANCH, new Set(['job.read'])],
        ]),
      }
      try {
        const state = await saveUser(
          {},
          form({
            principalId: ADMIN_PRINCIPAL,
            nameEn: 'Fixture Administrator',
            email: 'fixtures-admin@qabandi.test',
            locale: 'en',
            roleId: financeRoleId,
            branchIds: [HOME_BRANCH, AWAY_BRANCH],
            isActive: 'on',
          }),
        )
        expect(state.errors?.branchIds).toBe('adminValidation.grantOwnBranchesOnly')
      } finally {
        harness.session = session
      }
    })

    /**
     * A2. The form shows only the branches the administrator administers, so
     * saving it must not revoke the person's grant in a branch it never
     * showed — editing a phone number from Kuwait used to cost them Dubai.
     */
    it('leaves a grant in a branch the administrator does not administer alone', async () => {
      const email = nextEmail()
      await saveUser(
        {},
        form({
          nameEn: 'Two Places',
          email,
          locale: 'en',
          roleId: coordinatorRoleId,
          branchIds: [HOME_BRANCH, AWAY_BRANCH],
          isActive: 'on',
        }),
      )
      const principal = await principalByEmail(email)

      harness.session = {
        ...session,
        branchPermissions: new Map([
          [HOME_BRANCH, new Set(['admin.users.write'])],
          [AWAY_BRANCH, new Set<string>()],
        ]),
      }
      try {
        const state = await saveUser(
          {},
          form({
            principalId: principal!.id,
            nameEn: 'Two Places',
            email,
            locale: 'en',
            roleId: financeRoleId,
            branchIds: [HOME_BRANCH],
            isActive: 'on',
          }),
        )
        expect(state.errors).toBeUndefined()

        // A person-level change from here is refused: they work elsewhere too.
        const renamed = await saveUser(
          {},
          form({
            principalId: principal!.id,
            nameEn: 'Renamed From Home',
            email,
            locale: 'en',
            roleId: financeRoleId,
            branchIds: [HOME_BRANCH],
            isActive: 'on',
          }),
        )
        expect(renamed.message).toBe('adminValidation.personSpansOtherBranches')
      } finally {
        harness.session = session
      }

      const grants = await withActor(adminActor, (tx) =>
        tx
          .select({
            branchId: principalBranchRoles.branchId,
            isActive: principalBranchRoles.isActive,
          })
          .from(principalBranchRoles)
          .where(eq(principalBranchRoles.principalId, principal!.id)),
      )
      expect(grants.find((g) => g.branchId === AWAY_BRANCH)?.isActive).toBe(true)
      expect(grants.find((g) => g.branchId === HOME_BRANCH)?.isActive).toBe(true)
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

      expect(again.errors?.email).toBe('adminValidation.emailTaken')
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

  /*
    A7. Nothing could create a customer-portal login: the portal and its RLS
    arm existed, and the only way in was a database client.
  */
  describe('giving a customer contact portal access', () => {
    it('creates a portal login scoped to that customer, and sends the link', async () => {
      const { inviteCustomerContact } = await import('./portal-contacts')
      const { listPortalContacts } = await import('./queries')
      const email = nextEmail()
      harness.linksSent = []

      const state = await inviteCustomerContact(
        {},
        form({ customerId: CUSTOMER, nameEn: 'Portal Person', email, locale: 'ar' }),
      )

      expect(state.errors).toBeUndefined()
      const [row] = await withActor(adminActor, (tx) =>
        tx
          .select({
            type: principals.type,
            customerId: principals.customerId,
            authUserId: principals.authUserId,
            locale: principals.locale,
          })
          .from(principals)
          .where(eq(principals.email, email)),
      )
      expect(row).toMatchObject({ type: 'customer_contact', customerId: CUSTOMER, locale: 'ar' })
      expect(row?.authUserId).toBeTruthy()
      expect(harness.linksSent).toEqual([email])

      // And the customer page can see it — a portal login with no branch role
      // used to be invisible to every member of staff.
      const listed = await listPortalContacts(adminActor, CUSTOMER)
      expect(listed.find((c) => c.email === email)?.hasPassword).toBe(false)
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
      expect(state.message).toBe('adminValidation.cannotSuspendSelf')
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

    /**
     * Configuration is rows, not code — and this is the action that proves it.
     * A nineteenth accessorial in 2027 is a line an administrator types, not a
     * release, so the four tables and their per-table columns are worth
     * pinning down individually: the target is chosen at run time, and passing
     * a `category` to `commodities` is a runtime error rather than a type one.
     */
    const reference = (fields: Record<string, string>) =>
      form({ nameEn: 'Fixture', nameAr: 'نموذج', isActive: 'on', ...fields })

    const rowByCode = async (
      table: 'commodity' | 'document_type' | 'exception_code',
      code: string,
    ) => {
      const target = {
        commodity: commodities,
        document_type: documentTypes,
        exception_code: exceptionCodes,
      }[table]
      const [row] = await withActor(adminActor, (tx) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tx
          .select()
          .from(target as any)
          .where(eq((target as any).code, code))
          .limit(1),
      )
      return row as Record<string, unknown> | undefined
    }

    it('adds a commodity with the classification a broker will read', async () => {
      const code = `REF-COM-${RUN}-${(seq += 1)}`

      const state = await saveReferenceRecord(
        {},
        reference({ table: 'commodity', code, nameEn: 'Ceramic tiles', hsCode: '6907.21.00' }),
      )

      const row = await rowByCode('commodity', code)
      expect(state.ok).toBeTruthy()
      expect(row?.nameAr).toBe('نموذج')
      expect(row?.hsCode).toBe('6907.21.00')
    })

    /**
     * Where a charge posts in the customer's ledger (0011). Reference data
     * rather than code, because every accounting package in the Gulf numbers
     * its accounts differently — and an unmapped charge type is what the
     * accounting export refuses on, by name.
     */
    it('adds a charge type with its basis and its two account codes', async () => {
      const key = `REF-CHG-${RUN}-${(seq += 1)}`

      await saveReferenceRecord(
        {},
        reference({
          table: 'charge_type',
          code: key,
          nameEn: 'Legalisation',
          category: 'documentation',
          defaultBasis: 'per_container',
          revenueAccountCode: '4090',
          costAccountCode: '5090',
        }),
      )

      const [row] = await withActor(adminActor, (tx) =>
        tx.select().from(chargeTypes).where(eq(chargeTypes.key, key)).limit(1),
      )
      // Keyed rather than coded: `charge_types` has no `code` column, and the
      // form's one field feeds whichever the table actually has.
      expect(row?.key).toBe(key)
      expect(row?.defaultBasis).toBe('per_container')
      expect(row?.revenueAccountCode).toBe('4090')
      expect(row?.costAccountCode).toBe('5090')
    })

    it('falls back to sensible defaults where the form left them out', async () => {
      const key = `REF-CHG-${RUN}-${(seq += 1)}`

      await saveReferenceRecord({}, reference({ table: 'charge_type', code: key }))

      const [row] = await withActor(adminActor, (tx) =>
        tx.select().from(chargeTypes).where(eq(chargeTypes.key, key)).limit(1),
      )
      expect(row?.category).toBe('other')
      expect(row?.defaultBasis).toBe('flat')
    })

    it('adds a document type and an exception code with their own columns', async () => {
      const doc = `REF-DOC-${RUN}-${(seq += 1)}`
      const exc = `REF-EXC-${RUN}-${(seq += 1)}`

      await saveReferenceRecord(
        {},
        reference({ table: 'document_type', code: doc, category: 'customs' }),
      )
      await saveReferenceRecord(
        {},
        reference({ table: 'exception_code', code: exc, defaultSeverity: 'critical' }),
      )

      expect((await rowByCode('document_type', doc))?.category).toBe('customs')
      expect((await rowByCode('exception_code', exc))?.defaultSeverity).toBe('critical')
    })

    it('edits the record it was given rather than adding another', async () => {
      const code = `REF-COM-${RUN}-${(seq += 1)}`
      await saveReferenceRecord({}, reference({ table: 'commodity', code, nameEn: 'First name' }))
      const created = await rowByCode('commodity', code)

      await saveReferenceRecord(
        {},
        reference({
          table: 'commodity',
          recordId: created!.id as string,
          code,
          nameEn: 'Corrected name',
        }),
      )

      const rows = await withActor(adminActor, (tx) =>
        tx.select().from(commodities).where(eq(commodities.code, code)),
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]?.nameEn).toBe('Corrected name')
    })

    /**
     * Retired, not deleted — §5.5. A commodity that was used on four hundred
     * shipments cannot be removed without taking their history with it, so it
     * stops being offered instead.
     */
    it('retires a record by clearing its flag rather than removing it', async () => {
      const code = `REF-COM-${RUN}-${(seq += 1)}`
      await saveReferenceRecord({}, reference({ table: 'commodity', code }))
      const created = await rowByCode('commodity', code)

      const withoutFlag = form({
        table: 'commodity',
        recordId: created!.id as string,
        code,
        nameEn: 'Fixture',
        nameAr: 'نموذج',
      })
      await saveReferenceRecord({}, withoutFlag)

      expect((await rowByCode('commodity', code))?.isActive).toBe(false)
    })

    /**
     * Through `isUniqueViolation`, which until recently never fired because
     * Drizzle wraps the driver's error — so this asserts the sentence rather
     * than the 500 an administrator would otherwise see.
     */
    it('names the clash rather than raising when the code is taken', async () => {
      const code = `REF-COM-${RUN}-${(seq += 1)}`
      await saveReferenceRecord({}, reference({ table: 'commodity', code }))

      const state = await saveReferenceRecord({}, reference({ table: 'commodity', code }))

      expect(state.errors?.code).toBe('adminValidation.codeInUseInTable')
    })

    it('insists on the Arabic name, because it appears on Arabic documents', async () => {
      const state = await saveReferenceRecord(
        {},
        form({ table: 'commodity', code: `REF-COM-${RUN}-X`, nameEn: 'Tiles', nameAr: '' }),
      )

      expect(state.errors?.nameAr).toBeTruthy()
    })

    it('refuses a code with characters a URL or an export would mangle', async () => {
      const state = await saveReferenceRecord(
        {},
        reference({ table: 'commodity', code: 'tiles & fittings' }),
      )

      expect(state.errors?.code).toBe('adminValidation.lettersDigitsHyphens')
    })

    it('refuses a caller without the reference key', async () => {
      harness.session = { ...session, permissions: new Set(['admin.users.write']) }

      await expect(
        saveReferenceRecord({}, reference({ table: 'commodity', code: `REF-COM-${RUN}-Y` })),
      ).rejects.toThrow()

      harness.session = session
    })
  })
})
