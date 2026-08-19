/**
 * The RLS negative matrix — Architecture §5, §13.
 *
 * `rls.test.ts` proves the policies do what they are for: a Kuwait actor sees
 * the Kuwait job. This file proves the other half, which is the half that
 * matters when the software is sold to someone who did not write it — that
 * nothing else is reachable, by any principal, through any verb.
 *
 * Three properties it is built around:
 *
 * 1. **Writes are tested, not assumed.** A policy created with `using` and no
 *    `with check` reuses the `using` expression for INSERT and UPDATE. That is
 *    a Postgres default most reviewers read past, and `branches` is the proof:
 *    `using (true)` there granted every portal user INSERT and UPDATE on the
 *    operator's own legal entities until `0007_policy_holes.sql`. Read-only
 *    tests would never have found it.
 *
 * 2. **The sweeps are generic.** The per-table assertions walk
 *    `businessTableNames()` rather than a hand-kept list, so a table added next
 *    year without a policy fails here instead of leaking quietly. The declared
 *    constants below are the only place an exception can be stated, and each
 *    one has to be written down deliberately.
 *
 * 3. **Absence of an actor is a tested state.** Every policy's `else false` arm
 *    depends on it, and a regression that made "no principal" mean "see
 *    everything" is the worst outcome this system has.
 *
 * Set `TEST_DATABASE_URL` (app_user) and `TEST_MIGRATION_DATABASE_URL`
 * (app_migrator) to run. Without them the suite skips, so `pnpm test:core`
 * stays a database-free 130ms.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import {
  branches,
  chargeLines,
  createDatabase,
  customers,
  invoices,
  jobMilestones,
  jobPartners,
  jobs,
  partners,
  principalBranchRoles,
  principals,
  roles,
  systemActor,
  withActor,
  workingCalendars,
  type Actor,
  type Database,
} from '../src/index'
import { businessTableNames } from '../src/schema/table'
import { expectNoRowsAffected, expectRlsViolation } from './rls-helpers'

const APP_URL = process.env.TEST_DATABASE_URL
const MIGRATOR_URL = process.env.TEST_MIGRATION_DATABASE_URL
const enabled = Boolean(APP_URL && MIGRATOR_URL)

/**
 * Fixed ids, distinct from `rls.test.ts` so the two suites can run in either
 * order against the same database without colliding.
 */
const KUWAIT = '00000000-0000-7000-8000-0000000001b1'
const DUBAI = '00000000-0000-7000-8000-0000000001b2'
const CUSTOMER_A = '00000000-0000-7000-8000-0000000001c1'
const CUSTOMER_B = '00000000-0000-7000-8000-0000000001c2'
const PARTNER_P = '00000000-0000-7000-8000-0000000001d1'
const JOB_KWI = '00000000-0000-7000-8000-0000000001e1'
const JOB_DXB = '00000000-0000-7000-8000-0000000001e2'
const INVOICE_KWI = '00000000-0000-7000-8000-0000000001f1'
const INVOICE_DXB = '00000000-0000-7000-8000-0000000001f2'
const CHARGE_KWI = '00000000-0000-7000-8000-000000000201'
const MILESTONE_INTERNAL = '00000000-0000-7000-8000-000000000211'

const REVOKED_ADMIN = '00000000-0000-7000-8000-0000000001a9'

const kuwaitStaff: Actor = {
  principalId: '00000000-0000-7000-8000-0000000001a1',
  type: 'internal',
  branchIds: [KUWAIT],
}
const dubaiStaff: Actor = {
  principalId: '00000000-0000-7000-8000-0000000001a2',
  type: 'internal',
  branchIds: [DUBAI],
}
const customerAContact: Actor = {
  principalId: '00000000-0000-7000-8000-0000000001a3',
  type: 'customer_contact',
  branchIds: [],
  customerId: CUSTOMER_A,
}
const agentContact: Actor = {
  principalId: '00000000-0000-7000-8000-0000000001a4',
  type: 'agent_contact',
  branchIds: [],
  partnerId: PARTNER_P,
}
/** Holds an administrator grant whose `is_active` is false — FR-ID-08. */
const revokedAdmin: Actor = {
  principalId: REVOKED_ADMIN,
  type: 'internal',
  branchIds: [KUWAIT],
}

/**
 * Business tables an unauthenticated connection may read, each with a reason.
 *
 * These are 0004's shape-4 configuration tables: the engines cannot run
 * without them and a customer's quote PDF needs the currency's minor units and
 * the charge type's Arabic name. `branches` joins them because a customer
 * needs the issuing entity's legal name and letterhead on documents they
 * receive — read only, since `0007_policy_holes.sql`.
 *
 * Anything else appearing in the sweep below is a leak, and the failure names
 * it. Adding a name here is a decision someone has to defend in review.
 */
const PUBLIC_READ = new Set([
  'branches',
  'calendar_holidays',
  'charge_types',
  'commodities',
  'container_types',
  'countries',
  'currencies',
  'document_types',
  'exception_codes',
  'free_time_rules',
  'fx_rates',
  'incoterms',
  'locations',
  'milestone_templates',
  'notification_templates',
  'role_permissions',
  'roles',
  'working_calendars',
])

interface CountRow {
  n: number
}

describe.skipIf(!enabled)('RLS negative matrix', () => {
  let app: Database
  let migrator: Database
  let chargeTypeId: string
  let currencyCode: string

  beforeAll(async () => {
    app = createDatabase({ connectionString: APP_URL!, max: 4 })
    migrator = createDatabase({ connectionString: MIGRATOR_URL!, max: 2 })

    await withActor(
      systemActor(),
      async (tx) => {
        const [calendar] = await tx
          .select({ id: workingCalendars.id })
          .from(workingCalendars)
          .where(eq(workingCalendars.key, 'kuwait'))
          .limit(1)
        if (!calendar) throw new Error('Run `pnpm db:seed` before the RLS matrix')

        // Looked up rather than hard-coded: the matrix is about policies, and
        // coupling it to a particular seed key would make an unrelated seed
        // edit look like a security regression.
        const charge = await tx.execute(sql`select id from charge_types limit 1`)
        const currency = await tx.execute(sql`select code from currencies limit 1`)
        chargeTypeId = (charge.rows[0] as { id: string }).id
        currencyCode = (currency.rows[0] as { code: string }).code

        await tx
          .insert(branches)
          .values([
            {
              id: KUWAIT,
              code: 'MTX-KWI',
              legalNameEn: 'Matrix Kuwait',
              legalNameAr: 'مصفوفة الكويت',
              country: 'KW',
              baseCurrency: currencyCode,
              invoiceSeries: 'MTX-KWI',
              calendarId: calendar.id,
            },
            {
              id: DUBAI,
              code: 'MTX-DXB',
              legalNameEn: 'Matrix Dubai',
              legalNameAr: 'مصفوفة دبي',
              country: 'AE',
              baseCurrency: currencyCode,
              invoiceSeries: 'MTX-DXB',
              calendarId: calendar.id,
            },
          ])
          .onConflictDoNothing()

        await tx
          .insert(customers)
          .values([
            { id: CUSTOMER_A, code: 'MTX-CUST-A', legalNameEn: 'Matrix Customer A' },
            { id: CUSTOMER_B, code: 'MTX-CUST-B', legalNameEn: 'Matrix Customer B' },
          ])
          .onConflictDoNothing()

        await tx
          .insert(partners)
          .values([
            { id: PARTNER_P, code: 'MTX-AGT-P', type: 'agent', legalNameEn: 'Matrix Agent P' },
          ])
          .onConflictDoNothing()

        await tx
          .insert(jobs)
          .values([
            {
              id: JOB_KWI,
              reference: 'MTX-KWI-1',
              branchId: KUWAIT,
              customerId: CUSTOMER_A,
              mode: 'sea_fcl',
              tradeDirection: 'import',
            },
            {
              id: JOB_DXB,
              reference: 'MTX-DXB-1',
              branchId: DUBAI,
              customerId: CUSTOMER_B,
              mode: 'air',
              tradeDirection: 'export',
            },
          ])
          .onConflictDoNothing()

        await tx
          .insert(jobPartners)
          .values([
            { jobId: JOB_KWI, branchId: KUWAIT, partnerId: PARTNER_P, role: 'origin_agent' },
          ])
          .onConflictDoNothing()

        await tx
          .insert(invoices)
          .values([
            {
              id: INVOICE_KWI,
              branchId: KUWAIT,
              customerId: CUSTOMER_A,
              currency: currencyCode,
            },
            {
              id: INVOICE_DXB,
              branchId: DUBAI,
              customerId: CUSTOMER_B,
              currency: currencyCode,
            },
          ])
          .onConflictDoNothing()

        // Cost data. A customer must never see what the job cost the operator,
        // and an agent must never see it either.
        await tx
          .insert(chargeLines)
          .values([
            {
              id: CHARGE_KWI,
              jobId: JOB_KWI,
              branchId: KUWAIT,
              direction: 'cost',
              chargeTypeId,
              basis: 'flat',
              rate: '100.000000',
              amount: '100.000000',
              currency: currencyCode,
              amountBase: '100.000000',
              baseCurrency: currencyCode,
            },
          ])
          .onConflictDoNothing()

        // An internal note about a delay is not the customer's to read.
        await tx
          .insert(jobMilestones)
          .values([
            {
              id: MILESTONE_INTERNAL,
              jobId: JOB_KWI,
              code: 'MTX_INTERNAL',
              nameEn: 'Internal only',
              nameAr: 'داخلي فقط',
              seq: 999,
              customerVisible: false,
            },
          ])
          .onConflictDoNothing()

        // A principal whose administrator grant has been revoked. The row
        // stays — §5.5 — and `is_active` carries the revocation.
        const [adminRole] = await tx
          .select({ id: roles.id })
          .from(roles)
          .where(eq(roles.key, 'administrator'))
          .limit(1)
        if (!adminRole) throw new Error('Run `pnpm db:seed` before the RLS matrix')

        await tx
          .insert(principals)
          .values([
            {
              id: REVOKED_ADMIN,
              type: 'internal',
              email: 'revoked@matrix.test',
              nameEn: 'Revoked Administrator',
            },
          ])
          .onConflictDoNothing()

        await tx
          .insert(principalBranchRoles)
          .values([
            {
              principalId: REVOKED_ADMIN,
              branchId: KUWAIT,
              roleId: adminRole.id,
              isActive: false,
            },
          ])
          .onConflictDoNothing()
      },
      app,
    )
  })

  // ------------------------------------------------------------------------
  // Sweeps — generic over every business table
  // ------------------------------------------------------------------------

  /**
   * The fail-closed default, checked on every table rather than on `jobs`.
   *
   * A connection with no actor stamped is what a bug looks like: a background
   * job that forgot `withActor`, a handler that opened `db` directly. It must
   * see nothing outside the declared configuration set.
   */
  it('exposes no business table to a connection with no actor', async () => {
    const leaked: string[] = []

    for (const table of businessTableNames()) {
      const result = await app.execute(sql`select count(*)::int as n from ${sql.identifier(table)}`)
      const n = (result.rows[0] as unknown as CountRow).n
      if (n > 0 && !PUBLIC_READ.has(table)) leaked.push(table)
    }

    expect(leaked).toEqual([])
  })

  /**
   * The generalised form of the `branches` hole.
   *
   * A `for all` policy whose qualifier is the literal `true` is an open write
   * path for every principal type that reaches the database, because the
   * omitted `with check` reuses that qualifier. Read-open is a legitimate
   * choice for configuration; write-open never is.
   */
  it('has no unconditional write policy on any table', async () => {
    const result = await migrator.execute(sql`
      select tablename, policyname
        from pg_policies
       where schemaname = 'public'
         and cmd in ('ALL', 'INSERT', 'UPDATE')
         and coalesce(qual, 'true') = 'true'
         and coalesce(with_check, qual, 'true') = 'true'
    `)

    // `audit_log_insert` is the documented exception: the audit trigger runs
    // `security definer` and inserts regardless, and the policy exists so that
    // a *direct* insert by app_user is not silently accepted by policy
    // absence. Nothing else may appear here.
    const open = (result.rows as { tablename: string; policyname: string }[])
      .filter((r) => r.policyname !== 'audit_log_insert')
      .map((r) => `${r.tablename}.${r.policyname}`)
      .sort()

    expect(open).toEqual([])
  })

  /**
   * §5.5, swept: no business table exposes a delete path to the application.
   *
   * `supplier_invoice_matches` is the one exception, granted deliberately in
   * 0018 and argued there: a match is not a record of something that happened,
   * it is an *assertion* that two rows correspond, and retracting a wrong
   * assertion is not the same act as deleting a document. The audit trigger
   * records the retraction either way.
   *
   * Listed here by name rather than by relaxing the query, on the same
   * principle as the unconditional-write test above: an exception that has
   * been argued for is a line in this array, and anything else is a finding.
   * A new table appearing here means somebody granted DELETE without saying
   * why, which is exactly what this test exists to catch.
   */
  const DELETE_GRANTED = ['supplier_invoice_matches']

  it('grants DELETE on no business table but the argued exception', async () => {
    const result = await migrator.execute(sql`
      select table_name
        from information_schema.role_table_grants
       where grantee = 'app_user'
         and table_schema = 'public'
         and privilege_type in ('DELETE', 'TRUNCATE')
    `)
    const granted = (result.rows as { table_name: string }[])
      .map((r) => r.table_name)
      .filter((name) => !DELETE_GRANTED.includes(name))

    expect(granted).toEqual([])
  })

  // ------------------------------------------------------------------------
  // Cross-branch isolation — the write half
  // ------------------------------------------------------------------------

  /**
   * The `with check` path. Reading another branch is prevented by `using`;
   * *writing into* another branch is prevented by `with check`, and only an
   * INSERT proves it.
   */
  it('refuses an insert into another branch', async () => {
    await expectRlsViolation(
      withActor(
        kuwaitStaff,
        async (tx) =>
          tx.insert(jobs).values({
            reference: 'MTX-SMUGGLED-1',
            branchId: DUBAI,
            customerId: CUSTOMER_B,
            mode: 'air',
            tradeDirection: 'export',
          }),
        app,
      ),
    )
  })

  /**
   * An update against an invisible row is not an error — the row simply is not
   * there to update, so the statement affects nothing. Asserting the row is
   * unchanged afterwards is what distinguishes "RLS held" from "the statement
   * silently succeeded".
   */
  it("cannot update another branch's job", async () => {
    await withActor(
      kuwaitStaff,
      async (tx) =>
        tx.execute(sql`update jobs set reference = 'MTX-TAMPERED' where id = ${JOB_DXB}`),
      app,
    )

    const after = await withActor(
      dubaiStaff,
      async (tx) => tx.execute(sql`select reference from jobs where id = ${JOB_DXB}`),
      app,
    )
    expect((after.rows[0] as { reference: string }).reference).toBe('MTX-DXB-1')
  })

  /**
   * The subtle one: re-pointing a row you *can* see into a branch you cannot.
   *
   * `using` is satisfied — the row is visible — so only `with check` on the new
   * row stops this. A policy written with `using` alone and an explicit
   * `with check (true)` would pass every other test in this file and fail here.
   */
  it('refuses to move its own job into another branch', async () => {
    await expectRlsViolation(
      withActor(
        kuwaitStaff,
        async (tx) => tx.execute(sql`update jobs set branch_id = ${DUBAI} where id = ${JOB_KWI}`),
        app,
      ),
    )
  })

  // ------------------------------------------------------------------------
  // Portal and partner escalation
  // ------------------------------------------------------------------------

  /**
   * What each external population must not reach, stated as data.
   *
   * Every row here is a sentence from the SRS: agents see operations, not
   * commercial documents; customers see invoices, not what the job cost.
   */
  const forbidden: { actor: Actor; label: string; table: string; why: string }[] = [
    {
      actor: customerAContact,
      label: 'customer contact',
      table: 'charge_lines',
      why: 'cost lines are what the job cost the operator',
    },
    {
      actor: customerAContact,
      label: 'customer contact',
      table: 'rate_cards',
      why: "buy rates are not the customer's to read",
    },
    {
      actor: customerAContact,
      label: 'customer contact',
      table: 'rate_requests',
      why: "what we paid an agent to quote is not the customer's to read",
    },
    {
      actor: customerAContact,
      label: 'customer contact',
      table: 'free_time_clocks',
      why: 'free-time clocks are cost data',
    },
    {
      actor: agentContact,
      label: 'agent contact',
      table: 'invoices',
      why: 'agents see operations, never commercial documents',
    },
    {
      actor: agentContact,
      label: 'agent contact',
      table: 'charge_lines',
      why: 'agents see operations, never commercial documents',
    },
    {
      actor: agentContact,
      label: 'agent contact',
      table: 'payments',
      why: 'agents see operations, never commercial documents',
    },
  ]

  it.each(forbidden)('hides $table from a $label — $why', async ({ actor, table }) => {
    const result = await withActor(
      actor,
      async (tx) => tx.execute(sql`select count(*)::int as n from ${sql.identifier(table)}`),
      app,
    )
    expect((result.rows[0] as CountRow).n).toBe(0)
  })

  /** A customer contact sees their own invoice and not the other customer's. */
  it("scopes invoices to the contact's own customer", async () => {
    const result = await withActor(
      customerAContact,
      async (tx) =>
        tx.execute(sql`
          select id::text from invoices where id in (${INVOICE_KWI}, ${INVOICE_DXB})
        `),
      app,
    )
    expect((result.rows as { id: string }[]).map((r) => r.id)).toEqual([INVOICE_KWI])
  })

  /** `customer_visible = false` means what it says, on a job they can see. */
  it('hides an internal milestone on a job the customer can otherwise see', async () => {
    const result = await withActor(
      customerAContact,
      async (tx) =>
        tx.execute(
          sql`select count(*)::int as n from job_milestones where id = ${MILESTONE_INTERNAL}`,
        ),
      app,
    )
    expect((result.rows[0] as CountRow).n).toBe(0)
  })

  // ------------------------------------------------------------------------
  // The two holes closed by 0007_policy_holes.sql
  // ------------------------------------------------------------------------

  /**
   * Regression test for the `branches` hole.
   *
   * Before 0007, `branches_scope` was `for all using (true)`, so this update
   * succeeded — a portal user could rewrite the operator's legal name, tax
   * registration and statutory invoice series. `seed.ts` had already moved
   * branch editing onto its own permission in the interface for exactly that
   * reason; the policy never followed.
   */
  it('refuses a portal user writing to branches', async () => {
    /*
      No exception, and that is correct.

      `branches_write` is the only policy covering UPDATE, and its `using` arm
      is false for a portal user — so the row is not a candidate and the
      statement updates nothing. FR-ID-04 asks for exactly this shape: not
      found rather than forbidden, because an error is an enumeration signal.
    */
    const attempt = await withActor(
      customerAContact,
      async (tx) =>
        tx.execute(sql`update branches set invoice_series = 'HIJACKED' where id = ${KUWAIT}`),
      app,
    )
    expectNoRowsAffected(attempt, 'a portal user updated a branch')

    const after = await withActor(
      kuwaitStaff,
      async (tx) => tx.execute(sql`select invoice_series from branches where id = ${KUWAIT}`),
      app,
    )
    expect((after.rows[0] as { invoice_series: string }).invoice_series).toBe('MTX-KWI')
  })

  /** Staff without `admin.branches.write` are refused too — not only portals. */
  it('refuses branch writes from staff lacking the permission', async () => {
    const attempt = await withActor(
      kuwaitStaff,
      async (tx) =>
        tx.execute(sql`update branches set legal_name_en = 'Renamed' where id = ${KUWAIT}`),
      app,
    )
    expectNoRowsAffected(attempt, 'staff without admin.branches.write renamed a branch')
  })

  /** Branch details stay readable — documents need the issuing entity. */
  it('still lets a portal user read the branch on their documents', async () => {
    const result = await withActor(
      customerAContact,
      async (tx) => tx.execute(sql`select legal_name_en from branches where id = ${KUWAIT}`),
      app,
    )
    expect((result.rows[0] as { legal_name_en: string }).legal_name_en).toBe('Matrix Kuwait')
  })

  /**
   * Regression test for the revoked-grant hole — FR-ID-08.
   *
   * 0005 gave `principal_branch_roles` an `is_active` flag and stated that
   * revocation takes effect on the next request. Session resolution honoured
   * it; `app.has_permission()` did not, so the database backstop kept granting
   * an authority the application had already withdrawn.
   */
  it('does not honour a revoked grant in app.has_permission', async () => {
    const result = await withActor(
      revokedAdmin,
      async (tx) => tx.execute(sql`select app.has_permission('admin.branches.write') as allowed`),
      app,
    )
    expect((result.rows[0] as { allowed: boolean }).allowed).toBe(false)
  })

  /** And the policy that reads it refuses the write. */
  it('refuses a configuration write from a revoked administrator', async () => {
    const attempt = await withActor(
      revokedAdmin,
      async (tx) =>
        tx.execute(sql`update branches set legal_name_en = 'Revoked' where id = ${KUWAIT}`),
      app,
    )
    expectNoRowsAffected(attempt, 'a revoked administrator still wrote to branches')
  })

  /** Configuration is administrator-written — FR-AD-03, checked negatively. */
  it('refuses reference-data writes from a coordinator-shaped actor', async () => {
    const attempt = await withActor(
      kuwaitStaff,
      async (tx) =>
        tx.execute(sql`update currencies set minor_units = 9 where code = ${currencyCode}`),
      app,
    )
    expectNoRowsAffected(attempt, 'a non-administrator edited reference data')
  })
})
