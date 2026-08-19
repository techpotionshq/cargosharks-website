/**
 * Granting support access — the operator's side of `0008_support_access.sql`.
 *
 * The database already refuses everything that matters: a grant naming no
 * principal, an expired one, one presented by an engineer it does not name.
 * What is tested here are the three constraints that belong to *policy* rather
 * than to enforcement, and each is a rule about a human decision:
 *
 * **A maximum duration.** The database enforces that a grant expires; how soon
 * is a choice, and "until someone remembers to revoke it" is the choice people
 * make when the form lets them. Eight hours is a working day — long enough
 * that nobody re-authorises mid-investigation, short enough that a forgotten
 * grant is gone by the morning.
 *
 * **Write access is typed for, not picked from a list.** A radio button
 * labelled `write` next to one labelled `read` gets clicked. Escalation should
 * feel like a different act, because it is one.
 *
 * **A support session cannot grant support access.** The policy would refuse
 * it anyway — a support principal holds no role here, so `app.has_permission`
 * finds nothing — but failing in the action is clearer, and it states the rule
 * where someone reads it.
 *
 * The empty-selection case is the subtlest and gets its own test. The database
 * reads an empty branch array as *every branch*, which is right for a
 * schema-level primitive and wrong for a form: a blank multi-select is what
 * somebody submits when they have not thought about it, and it must not be the
 * widest grant the system can make.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { desc, eq } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const harness = vi.hoisted(() => ({ session: null as unknown }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/session', () => ({ requireSession: async () => harness.session }))

const { principals, supportGrants, withActor } = await import('@qabandi/db')

const { ADMIN_PRINCIPAL, AWAY_BRANCH, HOME_BRANCH, adminActor, world } =
  await import('@/lib/testing/fixtures')

const { grantSupportAccess } = await import('./form-actions')

const systemActor = { ...adminActor, type: 'system' as const }

/** A support engineer, a retired one, and a member of staff who is not either. */
const ENGINEER = '00000000-0000-7000-8000-00000000ba01'
const RETIRED_ENGINEER = '00000000-0000-7000-8000-00000000ba02'

function sessionWith(
  permissions: readonly string[],
  over: { actorType?: string; branches?: string[] } = {},
) {
  const branches = over.branches ?? [HOME_BRANCH, AWAY_BRANCH]
  return {
    actor: {
      principalId: ADMIN_PRINCIPAL,
      type: over.actorType ?? 'internal',
      branchIds: branches,
    },
    principal: {
      id: ADMIN_PRINCIPAL,
      nameEn: 'Fixture Administrator',
      nameAr: null,
      email: 'fixtures-admin@qabandi.test',
      locale: 'en' as const,
    },
    permissions: new Set(permissions),
    branchRoles: new Map(branches.map((id) => [id, 'administrator'])),
    requiresTwoFactor: false,
  }
}

const form = (fields: Record<string, string | string[]>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) value.forEach((v) => data.append(key, v))
    else data.set(key, value)
  }
  return data
}

const grantForm = (extra: Record<string, string | string[]> = {}) =>
  form({
    principalId: ENGINEER,
    branchIds: [HOME_BRANCH],
    hours: '2',
    reason: 'Ticket QBD-4471, invoice will not issue',
    ...extra,
  })

async function latestGrant() {
  const [row] = await withActor(adminActor, (tx) =>
    tx
      .select()
      .from(supportGrants)
      .where(eq(supportGrants.principalId, ENGINEER))
      .orderBy(desc(supportGrants.createdAt))
      .limit(1),
  )
  return row
}

describe.skipIf(!enabled)('granting support access', () => {
  beforeAll(async () => {
    await world()
    harness.session = sessionWith(['admin.users.write'])

    await withActor(systemActor, async (tx) => {
      await tx
        .insert(principals)
        .values([
          {
            id: ENGINEER,
            type: 'support',
            email: 'engineer@vendor.test',
            nameEn: 'Support Engineer',
          },
          {
            id: RETIRED_ENGINEER,
            type: 'support',
            email: 'retired@vendor.test',
            nameEn: 'Retired Engineer',
            isActive: false,
          },
        ])
        .onConflictDoNothing()

      // `onConflictDoNothing` will not have retired the second one on a rerun.
      await tx
        .update(principals)
        .set({ isActive: false })
        .where(eq(principals.id, RETIRED_ENGINEER))
    })
  })

  afterAll(() => {
    harness.session = null
  })

  describe('a read grant', () => {
    it('opens the branches it was given, for the hours it was given', async () => {
      const state = await grantSupportAccess({}, grantForm({ hours: '3' }))

      expect(state.errors).toBeUndefined()
      const grant = await latestGrant()
      expect(grant?.scope).toBe('read')
      expect(grant?.branchIds).toEqual([HOME_BRANCH])
      expect(grant?.grantedById).toBe(ADMIN_PRINCIPAL)
      expect(grant?.reason).toContain('QBD-4471')
    })

    it('expires it, and within the day', async () => {
      await grantSupportAccess({}, grantForm({ hours: '8' }))

      const grant = await latestGrant()
      expect(grant?.expiresAt).toBeInstanceOf(Date)
      const hoursAway = (grant!.expiresAt!.getTime() - Date.now()) / 3_600_000
      expect(hoursAway).toBeGreaterThan(7.9)
      expect(hoursAway).toBeLessThan(8.1)
    })

    /**
     * A blank multi-select is what somebody submits when they have not thought
     * about it. The database would read it as every branch in the deployment;
     * the form reads it as the branches the granting administrator holds.
     */
    it('falls back to the granter’s own branches, never to all of them', async () => {
      const data = grantForm()
      data.delete('branchIds')

      await grantSupportAccess({}, data)

      const grant = await latestGrant()
      expect(grant?.branchIds).not.toEqual([])
      expect([...(grant?.branchIds ?? [])].sort()).toEqual([HOME_BRANCH, AWAY_BRANCH].sort())
    })

    it('opens more than one branch when more than one was chosen', async () => {
      await grantSupportAccess({}, grantForm({ branchIds: [HOME_BRANCH, AWAY_BRANCH] }))

      expect([...(await latestGrant())!.branchIds!.sort()]).toEqual(
        [HOME_BRANCH, AWAY_BRANCH].sort(),
      )
    })
  })

  describe('escalating to write', () => {
    /** Typed, not toggled — the sentence has to pass through a human's head. */
    it('refuses write access without the confirmation typed out', async () => {
      const state = await grantSupportAccess({}, grantForm({ scope: 'write' }))

      expect(state.errors?.escalate).toContain('GRANT WRITE')
    })

    it('refuses write access when the confirmation is nearly right', async () => {
      const state = await grantSupportAccess(
        {},
        grantForm({ scope: 'write', escalate: 'grant-write' }),
      )
      expect(state.errors?.escalate).toBeDefined()
    })

    it('grants write access when the confirmation was typed', async () => {
      const state = await grantSupportAccess(
        {},
        grantForm({ scope: 'write', escalate: 'grant write' }),
      )

      expect(state.errors).toBeUndefined()
      expect((await latestGrant())?.scope).toBe('write')
    })
  })

  describe('who may be granted, and by whom', () => {
    /**
     * A control that silently does nothing is worse than one that refuses. The
     * support policies are conditioned on the principal type, so granting a
     * staff principal would in fact grant nothing at all — and look like it
     * had worked.
     */
    it('refuses to grant support access to a member of staff', async () => {
      const state = await grantSupportAccess({}, grantForm({ principalId: ADMIN_PRINCIPAL }))
      expect(state.errors?.principalId).toContain('Not a support engineer')
    })

    it('refuses a support engineer who has been deactivated', async () => {
      const state = await grantSupportAccess({}, grantForm({ principalId: RETIRED_ENGINEER }))
      expect(state.errors?.principalId).toContain('deactivated')
    })

    it('refuses somebody who is not there at all', async () => {
      const state = await grantSupportAccess(
        {},
        grantForm({ principalId: '00000000-0000-7000-8000-00000000bafe' }),
      )
      expect(state.errors?.principalId).toBeDefined()
    })

    /** Stated here rather than left to the policy, so the rule is readable. */
    it('refuses a support session granting support access', async () => {
      harness.session = sessionWith(['admin.users.write'], { actorType: 'support' })
      try {
        const state = await grantSupportAccess({}, grantForm())
        expect(state.errors?.principalId).toContain('support session')
      } finally {
        harness.session = sessionWith(['admin.users.write'])
      }
    })

    /**
     * The same rule `saveUser` applies: otherwise `admin.users.write` in one
     * branch is a route to every branch — grant a support session across the
     * group, then read the trail.
     */
    it('refuses to open a branch the granter does not hold', async () => {
      harness.session = sessionWith(['admin.users.write'], { branches: [HOME_BRANCH] })
      try {
        const state = await grantSupportAccess({}, grantForm({ branchIds: [AWAY_BRANCH] }))
        expect(state.errors?.branchIds).toContain('branches you hold yourself')
      } finally {
        harness.session = sessionWith(['admin.users.write'])
      }
    })

    it('refuses a caller who may not administer users', async () => {
      harness.session = sessionWith([])
      try {
        await expect(grantSupportAccess({}, grantForm())).rejects.toThrow('admin.users.write')
      } finally {
        harness.session = sessionWith(['admin.users.write'])
      }
    })
  })

  describe('the duration and the reason', () => {
    /** "Until someone remembers to revoke it" is not a duration. */
    it('refuses longer than a working day', async () => {
      const state = await grantSupportAccess({}, grantForm({ hours: '48' }))
      expect(state.errors?.hours).toContain('grant again')
    })

    it('refuses less than an hour', async () => {
      expect((await grantSupportAccess({}, grantForm({ hours: '0' }))).errors?.hours).toBeDefined()
    })

    it('insists the reason names the ticket or the request', async () => {
      expect((await grantSupportAccess({}, grantForm({ reason: 'help' }))).errors?.reason)
        .toBeDefined()
    })

    it('reports field errors rather than throwing on an empty form', async () => {
      expect((await grantSupportAccess({}, form({}))).errors).toBeDefined()
    })
  })
})
