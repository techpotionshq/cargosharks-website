/**
 * Session resolution — the one place a request becomes an `Actor`.
 *
 * Every database access in the application flows through what this produces,
 * so a mistake here is not a bug on one screen: it is the branch list RLS
 * reads, for every query, for that request. Nothing in it throws when it is
 * wrong — a session that resolves to too many branches looks exactly like a
 * user with a lot of access.
 *
 * Four properties are worth more than the rest.
 *
 * **Revocation and deactivation take effect on the next request.** The checks
 * are here rather than inside a token, which is the whole reason a token is
 * not trusted on its own (FR-ID-08, FR-MD-03). A deactivated principal and a
 * revoked branch grant both have to disappear without waiting for anything to
 * expire.
 *
 * **The branch list is derived from live grants, not carried.** `actor.branchIds`
 * comes from the roles read in this transaction, so a grant revoked a second
 * ago is gone from the RLS scope on the next page load.
 *
 * **The same user is not the same everywhere (FR-ID-02).** Roles are per
 * branch; permissions are the union across them.
 *
 * **The cookie has two names.** `useSecureCookies` renames it to
 * `__Secure-qabandi.session_token` in production rather than merely adding an
 * attribute, so reading only the bare name meant sign-in worked on a laptop
 * and bounced for ever on the deployed container — the cookie was set,
 * correctly, under a name nothing looked at.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import type { Actor } from '@qabandi/db'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const harness = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  headers: new Map<string, string>(),
  pilot: false,
}))

/*
  `cache` is React's per-request memo. Outside a request there is nothing to
  memoise against, and memoising across tests would make every case after the
  first read the first one's answer — so it is the identity function here.
*/
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T>(fn: T) => fn,
}))

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = harness.cookies.get(name)
      return value === undefined ? undefined : { name, value }
    },
  }),
  headers: async () => ({ get: (name: string) => harness.headers.get(name) ?? null }),
}))

/*
  Both predicates, not just the one this file used to care about.

  `getSession` calls `useDemoLogin()` as well now, and a `vi.mock` factory
  replaces the whole module — so mocking only `usePilotFixtures` did not leave
  the other export in place, it deleted it, and every test through this path
  threw `No "useDemoLogin" export is defined`. `false` is the default the demo
  gate ships with, so these tests keep asserting the behaviour a deployment
  without it gets.
*/
vi.mock('@/lib/pilot/source', () => ({
  usePilotFixtures: () => harness.pilot,
  useDemoLogin: () => false,
}))

const {
  authSession,
  authUser,
  principalBranchRoles,
  principals,
  rolePermissions,
  roles,
  withActor,
} = await import('@qabandi/db')

const { getSession, requireSession, homeFor } = await import('./session')

const BRANCH_A = '00000000-0000-7000-8000-00000000fe01'
const BRANCH_B = '00000000-0000-7000-8000-00000000fe02'
const PRINCIPAL = '00000000-0000-7000-8000-00000000fe03'
const RETIRED = '00000000-0000-7000-8000-00000000fe04'

const bootstrap: Actor = {
  principalId: PRINCIPAL,
  type: 'system',
  branchIds: [BRANCH_A, BRANCH_B],
}

const RUN = Date.now().toString(36).toUpperCase().slice(-5)
let seq = 0

/** A key nothing asks about, recorded against the coordinator role as denied. */
const DENIED_KEY = 'test.denied.never-granted'

/** A Better Auth user and an unexpired session against it. */
async function signedIn(
  principalId: string,
  over: { expiresAt?: Date; token?: string } = {},
): Promise<string> {
  seq += 1
  const token = over.token ?? `tok-${RUN}-${seq}`
  const userId = `au-${RUN}-${seq}`

  await withActor(bootstrap, async (tx) => {
    await tx
      .insert(authUser)
      .values({ id: userId, name: 'Session Fixture', email: `${userId}@qabandi.test` })
    await tx.insert(authSession).values({
      id: `as-${RUN}-${seq}`,
      token,
      userId,
      expiresAt: over.expiresAt ?? new Date(Date.now() + 60 * 60_000),
    })
    await tx.update(principals).set({ authUserId: userId }).where(eq(principals.id, principalId))
  })

  return token
}

/** The cookie as the browser presents it: `<token>.<signature>`. */
const present = (token: string, name = 'qabandi.session_token') => {
  harness.cookies.clear()
  harness.cookies.set(name, `${token}.a-signature-better-auth-already-checked`)
}

let coordinatorRole: string
let financeRole: string

describe.skipIf(!enabled)('resolving a session', () => {
  beforeAll(async () => {
    await withActor(bootstrap, async (tx) => {
      const found = await tx.select({ id: roles.id, key: roles.key }).from(roles)
      coordinatorRole = found.find((r) => r.key === 'coordinator')!.id
      financeRole = found.find((r) => r.key === 'finance')!.id

      await tx
        .insert(principals)
        .values([
          {
            id: PRINCIPAL,
            type: 'internal',
            email: 'session-fixture@qabandi.test',
            nameEn: 'Session Fixture',
            nameAr: 'جلسة',
            locale: 'en',
          },
          {
            id: RETIRED,
            type: 'internal',
            email: 'session-retired@qabandi.test',
            nameEn: 'Retired Fixture',
          },
        ])
        .onConflictDoNothing()

      // `onConflictDoNothing` leaves an earlier run's row untouched.
      await tx.update(principals).set({ isActive: true }).where(eq(principals.id, PRINCIPAL))
      await tx.update(principals).set({ isActive: false }).where(eq(principals.id, RETIRED))

      const [calendar] = await tx
        .execute(`select id from working_calendars where key = 'kuwait' limit 1`)
        .then((r) => r.rows as { id: string }[])

      for (const [id, code] of [
        [BRANCH_A, 'SEA'],
        [BRANCH_B, 'SEB'],
      ] as const) {
        await tx.execute(
          `insert into branches (id, code, legal_name_en, legal_name_ar, country,
                                 base_currency, invoice_series, calendar_id)
           values ('${id}', '${code}', 'Session Branch ${code}', 'فرع', 'KW', 'KWD',
                   '${code}', '${calendar!.id}')
           on conflict do nothing`,
        )
      }

      await tx
        .insert(principalBranchRoles)
        .values([
          { principalId: PRINCIPAL, branchId: BRANCH_A, roleId: coordinatorRole },
          { principalId: PRINCIPAL, branchId: BRANCH_B, roleId: financeRole },
        ])
        .onConflictDoNothing()

      await tx
        .update(principalBranchRoles)
        .set({ isActive: true })
        .where(eq(principalBranchRoles.principalId, PRINCIPAL))

      const denied = await tx
        .select({ id: rolePermissions.id })
        .from(rolePermissions)
        .where(eq(rolePermissions.permissionKey, DENIED_KEY))
      if (denied.length === 0) {
        await tx
          .insert(rolePermissions)
          .values({ roleId: coordinatorRole, permissionKey: DENIED_KEY, allowed: false })
      }
    })
  })

  afterEach(() => {
    harness.cookies.clear()
    harness.headers.clear()
    harness.pilot = false
  })

  describe('finding the token', () => {
    it('resolves a signed-in principal', async () => {
      present(await signedIn(PRINCIPAL))

      const session = await getSession()

      expect(session?.principal.id).toBe(PRINCIPAL)
      expect(session?.principal.email).toBe('session-fixture@qabandi.test')
      expect(session?.actor.type).toBe('internal')
    })

    /**
     * Two names, not one, and the prefixed one first — exactly what Better
     * Auth's own `getSessionCookie` does. Reading only the bare name meant
     * sign-in worked locally and bounced for ever on the container.
     */
    it('reads the production cookie name as well as the local one', async () => {
      present(await signedIn(PRINCIPAL), '__Secure-qabandi.session_token')

      expect((await getSession())?.principal.id).toBe(PRINCIPAL)
    })

    /** The value is `<token>.<signature>`; only the token half is stored. */
    it('takes the token from in front of the signature', async () => {
      const token = await signedIn(PRINCIPAL)
      harness.cookies.set('qabandi.session_token', `${token}.sig.with.dots`)

      expect((await getSession())?.principal.id).toBe(PRINCIPAL)
    })

    it('resolves nothing when there is no cookie at all', async () => {
      expect(await getSession()).toBeNull()
    })

    it('resolves nothing for a cookie with an empty value', async () => {
      harness.cookies.set('qabandi.session_token', '')
      expect(await getSession()).toBeNull()
    })

    it('resolves nothing for a token nothing issued', async () => {
      present('a-token-nobody-ever-issued')
      expect(await getSession()).toBeNull()
    })
  })

  describe('revocation and deactivation — FR-ID-08, FR-MD-03', () => {
    /** The check is here rather than inside the token, which is the point. */
    it('refuses a session that has expired', async () => {
      present(await signedIn(PRINCIPAL, { expiresAt: new Date(Date.now() - 60_000) }))

      expect(await getSession()).toBeNull()
    })

    it('refuses a principal who has been deactivated', async () => {
      present(await signedIn(RETIRED))

      expect(await getSession()).toBeNull()
    })

    /**
     * The branch list is derived from live grants rather than carried, so a
     * revoked grant is out of the RLS scope on the very next request — no
     * waiting for a token to expire.
     */
    it('drops a revoked branch grant from the actor’s scope', async () => {
      present(await signedIn(PRINCIPAL))
      expect((await getSession())?.actor.branchIds).toContain(BRANCH_B)

      await withActor(bootstrap, (tx) =>
        tx
          .update(principalBranchRoles)
          .set({ isActive: false })
          .where(eq(principalBranchRoles.branchId, BRANCH_B)),
      )
      try {
        const after = await getSession()

        expect(after?.actor.branchIds).toContain(BRANCH_A)
        expect(after?.actor.branchIds).not.toContain(BRANCH_B)
        expect(after?.branchRoles.has(BRANCH_B)).toBe(false)
      } finally {
        await withActor(bootstrap, (tx) =>
          tx
            .update(principalBranchRoles)
            .set({ isActive: true })
            .where(eq(principalBranchRoles.branchId, BRANCH_B)),
        )
      }
    })
  })

  describe('what the principal may do', () => {
    /** FR-ID-02 — the same user is not the same everywhere. */
    it('carries a role per branch, not one role', async () => {
      present(await signedIn(PRINCIPAL))

      const session = await getSession()

      expect(session?.branchRoles.get(BRANCH_A)).toBe('coordinator')
      expect(session?.branchRoles.get(BRANCH_B)).toBe('finance')
    })

    it('unions the permissions across every branch held', async () => {
      present(await signedIn(PRINCIPAL))

      const session = await getSession()

      // A coordinator's and a finance role's keys are both present.
      const permissions = [...(session?.permissions ?? [])]
      expect(permissions.length).toBeGreaterThan(0)
      expect(permissions).toContain('job.update')
      expect(permissions).toContain('invoice.approve')
    })

    /**
     * `allowed: false` is a denial recorded, not a permission.
     *
     * The fixture row is left in place rather than cleaned up, because
     * `DELETE` is revoked from `app_user` (§5.5) — and it is inert: a key no
     * policy and no screen asks about, recorded as denied. Flipping a real
     * permission instead would have been tidier here and would have changed
     * what `app.has_permission` answers for every suite running beside this
     * one.
     */
    it('leaves out a permission the role explicitly disallows', async () => {
      present(await signedIn(PRINCIPAL))

      expect((await getSession())?.permissions.has(DENIED_KEY)).toBe(false)
    })

    it('raises the two-factor flag when any role held demands it', async () => {
      present(await signedIn(PRINCIPAL))
      const before = (await getSession())?.requiresTwoFactor

      await withActor(bootstrap, (tx) =>
        tx.update(roles).set({ requiresTwoFactor: true }).where(eq(roles.id, coordinatorRole)),
      )
      try {
        expect((await getSession())?.requiresTwoFactor).toBe(true)
      } finally {
        await withActor(bootstrap, (tx) =>
          tx
            .update(roles)
            .set({ requiresTwoFactor: before ?? false })
            .where(eq(roles.id, coordinatorRole)),
        )
      }
    })
  })

  describe('the actor it hands on', () => {
    /**
     * Stamped into the audit trail, so it must be the entry our own proxy
     * wrote — not the leftmost, which the caller can type (A15,
     * `lib/client-address.ts`). One trusted hop by default.
     */
    it('takes the client address our proxy appended, not the one the caller sent', async () => {
      present(await signedIn(PRINCIPAL))
      harness.headers.set('x-forwarded-for', '6.6.6.6, 203.0.113.9')

      expect((await getSession())?.actor.ip).toBe('203.0.113.9')
    })

    it('carries no address where the proxy sent none', async () => {
      present(await signedIn(PRINCIPAL))

      expect((await getSession())?.actor.ip).toBeNull()
    })
  })

  describe('requiring one', () => {
    it('hands back the session where there is one', async () => {
      present(await signedIn(PRINCIPAL))
      expect((await requireSession()).principal.id).toBe(PRINCIPAL)
    })

    it('throws where there is not', async () => {
      await expect(requireSession()).rejects.toThrow('unauthenticated')
    })
  })

  describe('the pilot short-circuit', () => {
    /**
     * Gated by the same predicate as the data, which refuses to engage in
     * production against a real database — there is no path where this stands
     * in for a real session on a deployment that has one.
     */
    it('answers with the pilot principal, without reading a cookie', async () => {
      harness.pilot = true

      const session = await getSession()

      expect(session?.principal.email).toBe('operations@cargosharks.example')
      expect(session?.actor.branchIds).toHaveLength(2)
    })

    /**
     * `allPermissionKeys()`, not `permissionKeys()`. The latter returns only
     * the keys the state machines reference, so this principal held every
     * operational permission and no administrative one — and `/settings/*`
     * bounced straight back to the dashboard on every fixture deployment.
     */
    it('holds the administrative permissions as well as the operational ones', async () => {
      harness.pilot = true

      const session = await getSession()

      expect(session?.permissions.has('job.update')).toBe(true)
      expect(session?.permissions.has('admin.users.write')).toBe(true)
    })
  })
})

/**
 * Four audiences are served as four route groups, and each shell bounces the
 * wrong actor to the right place. Stated once here so the *entry* points agree
 * with the shells — a copy in each is how they drift apart.
 */
describe('where a principal belongs', () => {
  const as = (type: string) =>
    homeFor({
      actor: { principalId: 'x', type, branchIds: [] },
      principal: { id: 'x', nameEn: 'x', nameAr: null, email: 'x@y.z', locale: 'en' },
      permissions: new Set(),
      branchRoles: new Map(),
      requiresTwoFactor: false,
    } as never)

  it('sends a customer contact to the portal', () => {
    expect(as('customer_contact')).toBe('/portal')
  })

  it('sends an agent contact to the agent area', () => {
    expect(as('agent_contact')).toBe('/agent')
  })

  it('sends staff to the dashboard', () => {
    expect(as('internal')).toBe('/dashboard')
  })

  /** Including a support engineer: they work the operational screens. */
  it('sends anyone else to the dashboard too', () => {
    expect(as('support')).toBe('/dashboard')
  })
})
