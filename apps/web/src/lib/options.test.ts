/**
 * Who is offered as the owner of work — U6.
 *
 * A read-only user was in the owner and coordinator pickers, and a job or an
 * exception given to them then sat with someone who could not move it. The
 * picker now reads "can act" off the role's grants.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const { principalBranchRoles, principals, roles, withActor } = await import('@qabandi/db')
const { HOME_BRANCH, PRINCIPAL, bothBranchesActor, world } = await import('@/lib/testing/fixtures')
const { loadOptions } = await import('./options')

const READ_ONLY = '00000000-0000-7000-8000-0000000c0e01'

describe.skipIf(!enabled)('the people picker', () => {
  beforeAll(async () => {
    await world()
    await withActor({ ...bothBranchesActor, type: 'system' }, async (tx) => {
      const [role] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.key, 'read_only'))
        .limit(1)
      await tx
        .insert(principals)
        .values({
          id: READ_ONLY,
          type: 'internal',
          email: 'read-only-picker@qabandi.test',
          nameEn: 'Read Only Picker',
        })
        .onConflictDoNothing()
      await tx
        .insert(principalBranchRoles)
        .values({ principalId: READ_ONLY, branchId: HOME_BRANCH, roleId: role!.id })
        .onConflictDoNothing()
    })
  })

  it('offers someone who can work, and not a read-only user', async () => {
    const { people } = await loadOptions(bothBranchesActor)
    const ids = people.map((person) => person.value)
    expect(ids).toContain(PRINCIPAL)
    expect(ids).not.toContain(READ_ONLY)
  })
})
