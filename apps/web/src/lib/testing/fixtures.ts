/**
 * Shared fixtures for the database-backed suites.
 *
 * **Test-only.** Nothing in `app/` or `features/` imports this, it is excluded
 * from the coverage report, and it never reaches a bundle. It lives under
 * `src/lib` rather than beside one slice because every slice's tests need the
 * same world, and `features/*` may not import each other (§4) — a fixture
 * module inside one slice would be unreachable from the rest.
 *
 * ## One world, built once
 *
 * Two branches, a customer, a partner, a principal holding a real role in both
 * branches, and a job. Every id is fixed, so a failure names a row rather than
 * a random uuid, and every insert is `onConflictDoNothing`, so suites running
 * in the same database do not fight each other.
 *
 * The role grant is not decoration. `app.has_permission` reads
 * `principal_branch_roles` in the database, and the security-definer paths —
 * allocating a series number, for one — check it there rather than trusting
 * anything the caller hands over. A session object claiming a permission
 * proves nothing to those.
 *
 * ## The second branch
 *
 * Present so that scoping can be *proved* rather than assumed. A query tested
 * against a database containing one branch's rows passes whatever its `where`
 * clause says; the only way to know a list is scoped is to put a row the actor
 * must not see next to one they must.
 */

import { eq } from 'drizzle-orm'
import {
  branches,
  chargeTypes,
  customers,
  jobs,
  locations,
  partners,
  principalBranchRoles,
  principals,
  roles,
  withActor,
  workingCalendars,
  type Actor,
} from '@qabandi/db'

export const HOME_BRANCH = '00000000-0000-7000-8000-00000000c001'
export const AWAY_BRANCH = '00000000-0000-7000-8000-00000000c002'
export const CUSTOMER = '00000000-0000-7000-8000-00000000c003'
export const AWAY_CUSTOMER = '00000000-0000-7000-8000-00000000c004'
export const PARTNER = '00000000-0000-7000-8000-00000000c005'
export const PRINCIPAL = '00000000-0000-7000-8000-00000000c006'
export const HOME_JOB = '00000000-0000-7000-8000-00000000c007'
export const AWAY_JOB = '00000000-0000-7000-8000-00000000c008'
export const ADMIN_PRINCIPAL = '00000000-0000-7000-8000-00000000c009'
export const ORIGIN = '00000000-0000-7000-8000-00000000c00a'
export const DESTINATION = '00000000-0000-7000-8000-00000000c00b'

/** An actor scoped to the home branch only — the interesting case. */
export const homeActor: Actor = {
  principalId: PRINCIPAL,
  type: 'internal',
  branchIds: [HOME_BRANCH],
}

/** The same principal, seeing both branches — FR-ID-02. */
export const bothBranchesActor: Actor = {
  principalId: PRINCIPAL,
  type: 'internal',
  branchIds: [HOME_BRANCH, AWAY_BRANCH],
}

/**
 * An administrator, for the reads that are permission-gated in the *policy*.
 *
 * `audit_log_read` requires `admin.audit.read`, which only `administrator`
 * holds. Testing that gate needs both sides — an actor who sees nothing and
 * one who sees the entries — because a register that returns zero rows looks
 * identical whether the policy is working or the trigger never fired.
 */
export const adminActor: Actor = {
  principalId: ADMIN_PRINCIPAL,
  type: 'internal',
  branchIds: [HOME_BRANCH, AWAY_BRANCH],
}

/** Everything the interface asks a session for, with a real role behind it. */
export function sessionFor(actor: Actor, permissions: readonly string[]) {
  return {
    actor,
    principal: {
      id: PRINCIPAL,
      nameEn: 'Fixture Principal',
      nameAr: null,
      email: 'fixtures@qabandi.test',
      locale: 'en' as const,
    },
    permissions: new Set(permissions),
    branchRoles: new Map(actor.branchIds.map((id) => [id, 'operations_manager'])),
    requiresTwoFactor: false,
  }
}

export interface World {
  readonly chargeTypeId: string
  readonly calendarId: string
}

let built: World | undefined

/**
 * Builds the world if it is not there, and returns the seeded ids the suites
 * cannot hard-code — a charge type and a calendar come from `db:seed`.
 */
export async function world(): Promise<World> {
  if (built) return built

  built = await withActor({ ...bothBranchesActor, type: 'system' }, async (tx) => {
    const [calendar] = await tx
      .select({ id: workingCalendars.id })
      .from(workingCalendars)
      .where(eq(workingCalendars.key, 'kuwait'))
      .limit(1)
    const [role] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.key, 'operations_manager'))
      .limit(1)
    const [adminRole] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.key, 'administrator'))
      .limit(1)
    const [charge] = await tx.select({ id: chargeTypes.id }).from(chargeTypes).limit(1)

    if (!calendar || !role || !adminRole || !charge) {
      throw new Error('Run `pnpm db:seed` before the database-backed suites')
    }

    await tx
      .insert(principals)
      .values([
        {
          id: PRINCIPAL,
          type: 'internal',
          email: 'fixtures@qabandi.test',
          nameEn: 'Fixture Principal',
        },
        {
          id: ADMIN_PRINCIPAL,
          type: 'internal',
          email: 'fixtures-admin@qabandi.test',
          nameEn: 'Fixture Administrator',
        },
      ])
      .onConflictDoNothing()

    await tx
      .insert(customers)
      .values([
        { id: CUSTOMER, code: 'CUST-FIXTURE-HOME', legalNameEn: 'Fixture Home Customer' },
        { id: AWAY_CUSTOMER, code: 'CUST-FIXTURE-AWAY', legalNameEn: 'Fixture Away Customer' },
      ])
      .onConflictDoNothing()

    await tx
      .insert(partners)
      .values({ id: PARTNER, code: 'AGT-FIXTURE', type: 'agent', legalNameEn: 'Fixture Agent' })
      .onConflictDoNothing()

    /*
      Two places, because a shipment needs somewhere to start and somewhere to
      go — `saveJob` requires both.

      Their UN/LOCODEs are invented (`KWFX1`, `AEFX1`) and that is the point.
      These rows were `KWSWK` and `AEJEA`, the real Shuwaikh and Jebel Ali,
      which the seed also creates — and `locations_unlocode_idx` is unique, so
      on a seeded database the insert below conflicted, did nothing, and the
      ids `ORIGIN` and `DESTINATION` never existed. Every suite that put a lane
      on an enquiry then failed on a foreign key, but only on a machine where
      `pnpm db:seed` had been run, which is every machine except the one where
      the fixture was written. `apps/service` hit the identical fault from the
      other side and solved it by looking the ports up; here the rows belong to
      this fixture, so they get codes nothing else will ever claim.
    */
    await tx
      .insert(locations)
      .values([
        {
          id: ORIGIN,
          kind: 'seaport',
          unlocode: 'KWFX1',
          nameEn: 'Fixture Origin',
          nameAr: 'ميناء الاختبار',
          countryCode: 'KW',
        },
        {
          id: DESTINATION,
          kind: 'seaport',
          unlocode: 'AEFX1',
          nameEn: 'Fixture Destination',
          nameAr: 'ميناء الوصول للاختبار',
          countryCode: 'AE',
        },
      ])
      .onConflictDoNothing()

    for (const [id, code, name] of [
      [HOME_BRANCH, 'FXH', 'Fixture Home Branch'],
      [AWAY_BRANCH, 'FXA', 'Fixture Away Branch'],
    ] as const) {
      await tx
        .insert(branches)
        .values({
          id,
          code,
          legalNameEn: name,
          legalNameAr: 'فرع',
          country: 'KW',
          baseCurrency: 'KWD',
          invoiceSeries: code,
          calendarId: calendar.id,
        })
        .onConflictDoNothing()

      await tx
        .insert(principalBranchRoles)
        .values([
          { principalId: PRINCIPAL, branchId: id, roleId: role.id },
          { principalId: ADMIN_PRINCIPAL, branchId: id, roleId: adminRole.id },
        ])
        .onConflictDoNothing()
    }

    await tx
      .insert(jobs)
      .values([
        {
          id: HOME_JOB,
          reference: 'FXH-JOB-FIXTURE-1',
          branchId: HOME_BRANCH,
          customerId: CUSTOMER,
          mode: 'sea_fcl',
          tradeDirection: 'import',
          status: 'in_transit',
        },
        {
          id: AWAY_JOB,
          reference: 'FXA-JOB-FIXTURE-1',
          branchId: AWAY_BRANCH,
          customerId: AWAY_CUSTOMER,
          mode: 'air',
          tradeDirection: 'export',
          status: 'in_transit',
        },
      ])
      .onConflictDoNothing()

    return { chargeTypeId: charge.id, calendarId: calendar.id }
  })

  return built
}
