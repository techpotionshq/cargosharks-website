/**
 * RLS policy tests — Architecture §13.
 *
 * "RLS policy tests are non-negotiable: they are the enforcement mechanism for
 * FR-ID-04 and NFR-09, and an untested policy is an untested access control."
 *
 * These run against a real database as `app_user` — the same role the
 * application uses, with no BYPASSRLS and no ownership. Running them as the
 * owner would pass while proving nothing.
 *
 * They also insert fixtures rather than counting an empty table. A test that
 * asserts "the other branch sees zero jobs" against a database containing no
 * jobs passes whatever the policy says, which is worse than no test at all.
 *
 * Set `TEST_DATABASE_URL` (app_user) and `TEST_MIGRATION_DATABASE_URL`
 * (app_migrator) to run them; without those they skip, so a developer without
 * a database can still work on `core`.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { eq, like, sql } from 'drizzle-orm'
import {
  branches,
  createDatabase,
  customers,
  jobPartners,
  jobs,
  partners,
  systemActor,
  withActor,
  workingCalendars,
  type Actor,
  type Database,
} from '../src/index'
import { businessTableNames } from '../src/schema/table'

const APP_URL = process.env.TEST_DATABASE_URL
const MIGRATOR_URL = process.env.TEST_MIGRATION_DATABASE_URL
const enabled = Boolean(APP_URL && MIGRATOR_URL)

// Fixed ids so a failure names a row rather than a random uuid.
const KUWAIT = '00000000-0000-7000-8000-0000000000b1'
const DUBAI = '00000000-0000-7000-8000-0000000000b2'
const CUSTOMER_A = '00000000-0000-7000-8000-0000000000c1'
const CUSTOMER_B = '00000000-0000-7000-8000-0000000000c2'
const PARTNER_P = '00000000-0000-7000-8000-0000000000d1'
const JOB_KWI = '00000000-0000-7000-8000-0000000000e1'
const JOB_DXB = '00000000-0000-7000-8000-0000000000e2'

const kuwaitStaff: Actor = {
  principalId: '00000000-0000-7000-8000-0000000000a1',
  type: 'internal',
  branchIds: [KUWAIT],
}
const dubaiStaff: Actor = {
  principalId: '00000000-0000-7000-8000-0000000000a2',
  type: 'internal',
  branchIds: [DUBAI],
}
/** A contact of customer A, who trades through Kuwait only. */
const customerAContact: Actor = {
  principalId: '00000000-0000-7000-8000-0000000000a3',
  type: 'customer_contact',
  branchIds: [],
  customerId: CUSTOMER_A,
}
/** An agent whose partner is on the Kuwait job and no other. */
const agentContact: Actor = {
  principalId: '00000000-0000-7000-8000-0000000000a4',
  type: 'agent_contact',
  branchIds: [],
  partnerId: PARTNER_P,
}

describe.skipIf(!enabled)('row-level security', () => {
  let app: Database
  let migrator: Database

  beforeAll(async () => {
    app = createDatabase({ connectionString: APP_URL!, max: 4 })
    migrator = createDatabase({ connectionString: MIGRATOR_URL!, max: 2 })

    // Fixtures are written by the system principal — background work is an
    // auditable principal, not an absence of one (§5.2).
    await withActor(
      systemActor(),
      async (tx) => {
        const [calendar] = await tx
          .select({ id: workingCalendars.id })
          .from(workingCalendars)
          .where(eq(workingCalendars.key, 'kuwait'))
          .limit(1)
        if (!calendar) throw new Error('Run `pnpm db:seed` before the RLS tests')

        await tx
          .insert(branches)
          .values([
            {
              id: KUWAIT,
              code: 'KWI',
              legalNameEn: 'Al-Qabandi Kuwait',
              legalNameAr: 'القبندي الكويت',
              country: 'KW',
              baseCurrency: 'KWD',
              invoiceSeries: 'KWI',
              calendarId: calendar.id,
            },
            {
              id: DUBAI,
              code: 'DXB',
              legalNameEn: 'Al-Qabandi Dubai',
              legalNameAr: 'القبندي دبي',
              country: 'AE',
              baseCurrency: 'AED',
              invoiceSeries: 'DXB',
              calendarId: calendar.id,
            },
          ])
          .onConflictDoNothing()

        await tx
          .insert(customers)
          .values([
            { id: CUSTOMER_A, code: 'CUST-A', legalNameEn: 'Customer A' },
            { id: CUSTOMER_B, code: 'CUST-B', legalNameEn: 'Customer B' },
          ])
          .onConflictDoNothing()

        await tx
          .insert(partners)
          .values([{ id: PARTNER_P, code: 'AGT-P', type: 'agent', legalNameEn: 'Agent P' }])
          .onConflictDoNothing()

        await tx
          .insert(jobs)
          .values([
            {
              id: JOB_KWI,
              reference: 'KWI-JOB-TEST-1',
              branchId: KUWAIT,
              customerId: CUSTOMER_A,
              mode: 'sea_fcl',
              tradeDirection: 'import',
            },
            {
              id: JOB_DXB,
              reference: 'DXB-JOB-TEST-1',
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
      },
      app,
    )
  })

  /**
   * The jobs *this test created* that the actor can see.
   *
   * Filtered to the `-TEST-` fixtures rather than selecting the whole table.
   * The unfiltered version asserted against every row in the database, so the
   * moment a development machine had demo data the suite failed — not because
   * RLS had broken, but because the assertion was about the wrong thing.
   *
   * The filter costs nothing that matters: the question is whether a Kuwait
   * actor can see the Dubai fixture, and that is exactly what still fails if a
   * policy regresses. Rows the test did not create cannot answer it either way.
   */
  const visibleJobs = async (actor: Actor): Promise<string[]> =>
    withActor(
      actor,
      async (tx) => {
        const rows = await tx
          .select({ reference: jobs.reference })
          .from(jobs)
          .where(like(jobs.reference, '%-JOB-TEST-%'))
        return rows.map((r) => r.reference).sort()
      },
      app,
    )

  /**
   * The universal obligation from §5, checked rather than assumed.
   *
   * ENABLE alone leaves the owning role bypassing silently, and app_migrator
   * owns every table here — so FORCE is checked too.
   */
  it('enables and forces RLS on every business table', async () => {
    const result = await migrator.execute(sql`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
    `)

    const byName = new Map(
      (
        result.rows as {
          relname: string
          relrowsecurity: boolean
          relforcerowsecurity: boolean
        }[]
      ).map((r) => [r.relname, r]),
    )

    const unprotected = businessTableNames().filter((name) => {
      const row = byName.get(name)
      return !row || !row.relrowsecurity || !row.relforcerowsecurity
    })

    expect(unprotected).toEqual([])
  })

  /** Every business table carries the audit trigger — FR-AD-01. */
  it('attaches the audit trigger to every business table', async () => {
    const result = await migrator.execute(sql`
      select c.relname
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and not t.tgisinternal and t.tgname like '%\\_audit'
    `)
    const audited = new Set((result.rows as { relname: string }[]).map((r) => r.relname))
    expect(businessTableNames().filter((name) => !audited.has(name))).toEqual([])
  })

  /**
   * Enabled is not the same as scoped.
   *
   * `enable row level security` with no policy attached denies every row to
   * every principal, and the two tests above both pass in that state: RLS is
   * on, forced, and audited. The table is simply empty from the application's
   * point of view — every list renders zero rows, every lookup is *not found*,
   * and nothing anywhere says why.
   *
   * That is the shape of the mistake a new table invites. The obligations that
   * are mechanically checked get remembered; the policy is written by hand in
   * SQL, in a different file, and is the step that gets missed. Fail-closed is
   * the right default and a silent one, so it needs saying out loud here.
   */
  it('attaches at least one policy to every business table', async () => {
    const result = await migrator.execute(sql`
      select tablename, count(*)::int as policies
        from pg_policies
       where schemaname = 'public'
       group by tablename
    `)
    const withPolicies = new Set(
      (result.rows as { tablename: string; policies: number }[])
        .filter((r) => r.policies > 0)
        .map((r) => r.tablename),
    )
    expect(businessTableNames().filter((name) => !withPolicies.has(name))).toEqual([])
  })

  /**
   * FR-ID-04, stated as a test: another branch's job is *not found*, not
   * forbidden. The row is invisible to the query, so there is no enumeration
   * signal and no chance of an interface layer forgetting to filter.
   */
  it('scopes internal staff to their own branches', async () => {
    expect(await visibleJobs(kuwaitStaff)).toEqual(['KWI-JOB-TEST-1'])
    expect(await visibleJobs(dubaiStaff)).toEqual(['DXB-JOB-TEST-1'])
  })

  /** A user holding a role in both branches sees both — FR-ID-02. */
  it('follows the branch list, not a single branch', async () => {
    const both = { ...kuwaitStaff, branchIds: [KUWAIT, DUBAI] }
    expect(await visibleJobs(both)).toEqual(['DXB-JOB-TEST-1', 'KWI-JOB-TEST-1'])
  })

  /** The portal: a customer contact sees their own jobs and nothing else. */
  it('scopes a customer contact to their own customer', async () => {
    expect(await visibleJobs(customerAContact)).toEqual(['KWI-JOB-TEST-1'])
  })

  /** The agent view: visibility comes from `job_partners`, nothing else. */
  it('scopes an agent contact to the jobs their partner is on', async () => {
    expect(await visibleJobs(agentContact)).toEqual(['KWI-JOB-TEST-1'])
  })

  /**
   * No actor means no rows — the fail-closed default. Every policy's
   * `else false` arm depends on this, and a change that made an absent
   * principal mean "see everything" would be the worst possible regression.
   */
  it('returns nothing when no actor is set', async () => {
    const result = await app.execute(sql`select count(*)::int as n from jobs`)
    expect((result.rows[0] as { n: number }).n).toBe(0)
  })

  /**
   * The settings are transaction-local (§5.2). This is what makes the design
   * safe behind PgBouncer in transaction-pooling mode: one request's identity
   * cannot survive into the next request on the same pooled connection.
   */
  it('does not leak the actor beyond its transaction', async () => {
    await withActor(kuwaitStaff, async (tx) => tx.execute(sql`select 1`), app)
    const after = await app.execute(
      sql`select coalesce(nullif(current_setting('app.principal_id', true), ''), '') as principal`,
    )
    expect((after.rows[0] as { principal: string }).principal).toBe('')
  })

  /** FR-AD-01: nobody edits an audit entry, administrators included. */
  it('refuses to update or delete an audit entry', async () => {
    await expect(
      withActor(kuwaitStaff, async (tx) => tx.execute(sql`update audit_log set op = 'X'`), app),
    ).rejects.toThrow()

    await expect(
      withActor(kuwaitStaff, async (tx) => tx.execute(sql`delete from audit_log`), app),
    ).rejects.toThrow()
  })

  /** The trigger did fire, and it recorded the acting principal. */
  it('writes an audit entry naming the principal that acted', async () => {
    const rows = await withActor(
      systemActor(),
      async (tx) =>
        tx.execute(sql`
          select principal_type, op, row_id
            from audit_log
           where table_name = 'jobs' and row_id = ${JOB_KWI}
           limit 1
        `),
      app,
    )
    expect(rows.rows[0]).toMatchObject({ principal_type: 'system', op: 'INSERT', row_id: JOB_KWI })
  })

  /** §5.5: nothing is deleted. The role cannot execute a delete at all. */
  it('refuses to delete from a business table', async () => {
    await expect(
      withActor(kuwaitStaff, async (tx) => tx.execute(sql`delete from jobs`), app),
    ).rejects.toThrow()
  })
})
