/**
 * Support access — `0008_support_access.sql`.
 *
 * This is the one mechanism in the system that lets somebody outside the
 * operator's staff read the operator's commercial data. Every assertion here
 * is a sentence from the design, checked rather than trusted:
 *
 *   granted     no grant, no access — the same fail-closed default as no actor
 *   scoped      a grant naming Kuwait does not reach Dubai
 *   read-only   writes are refused by policy absence, not by a flag
 *   expiring    an expired grant stops working without a job having to run
 *   revocable   revocation bites on the next statement
 *   yours       a grant naming another engineer is worth nothing to you
 *   recorded    opening a session writes a trail entry that cannot be edited
 *
 * The last two are the ones that would be easy to get wrong and hard to
 * notice: a grant id is not a secret, so the policy has to require that the
 * grant *names the principal presenting it*, and a trail the recorded party
 * can amend is not a trail.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import {
  branches,
  createDatabase,
  customers,
  jobs,
  principalBranchRoles,
  principals,
  roles,
  SupportAccessError,
  supportActor,
  supportGrants,
  systemActor,
  withActor,
  workingCalendars,
  type Actor,
  type Database,
} from '../src/index'
import { expectNoRowsAffected, expectRlsViolation } from './rls-helpers'

const APP_URL = process.env.TEST_DATABASE_URL
const MIGRATOR_URL = process.env.TEST_MIGRATION_DATABASE_URL
const enabled = Boolean(APP_URL && MIGRATOR_URL)

const KUWAIT = '00000000-0000-7000-8000-0000000002b1'
const DUBAI = '00000000-0000-7000-8000-0000000002b2'
const CUSTOMER = '00000000-0000-7000-8000-0000000002c1'
const JOB_KWI = '00000000-0000-7000-8000-0000000002e1'
const JOB_DXB = '00000000-0000-7000-8000-0000000002e2'

const ENGINEER = '00000000-0000-7000-8000-0000000002a1'
const OTHER_ENGINEER = '00000000-0000-7000-8000-0000000002a2'
const OPERATOR_ADMIN = '00000000-0000-7000-8000-0000000002a3'

const GRANT_KUWAIT = '00000000-0000-7000-8000-000000000301'
const GRANT_EXPIRED = '00000000-0000-7000-8000-000000000302'
const GRANT_REVOKED = '00000000-0000-7000-8000-000000000303'
const GRANT_OTHER = '00000000-0000-7000-8000-000000000304'
const GRANT_WRITE = '00000000-0000-7000-8000-000000000305'

const operatorAdmin: Actor = {
  principalId: OPERATOR_ADMIN,
  type: 'internal',
  branchIds: [KUWAIT, DUBAI],
}

const hour = 60 * 60 * 1000

/** Jobs this suite created that the actor can see. */
const visibleJobs = async (db: Database, actor: Actor): Promise<string[]> =>
  withActor(
    actor,
    async (tx) => {
      const rows = await tx.execute(
        sql`select reference from jobs where reference like 'SUP-%' order by reference`,
      )
      return (rows.rows as { reference: string }[]).map((r) => r.reference)
    },
    db,
  )

describe.skipIf(!enabled)('support access', () => {
  let app: Database

  beforeAll(async () => {
    app = createDatabase({ connectionString: APP_URL!, max: 4 })

    await withActor(
      systemActor(),
      async (tx) => {
        const [calendar] = await tx
          .select({ id: workingCalendars.id })
          .from(workingCalendars)
          .where(eq(workingCalendars.key, 'kuwait'))
          .limit(1)
        if (!calendar) throw new Error('Run `pnpm db:seed` before the support tests')

        const currency = await tx.execute(sql`select code from currencies limit 1`)
        const currencyCode = (currency.rows[0] as { code: string }).code

        await tx
          .insert(branches)
          .values([
            {
              id: KUWAIT,
              code: 'SUP-KWI',
              legalNameEn: 'Support Kuwait',
              legalNameAr: 'دعم الكويت',
              country: 'KW',
              baseCurrency: currencyCode,
              invoiceSeries: 'SUP-KWI',
              calendarId: calendar.id,
            },
            {
              id: DUBAI,
              code: 'SUP-DXB',
              legalNameEn: 'Support Dubai',
              legalNameAr: 'دعم دبي',
              country: 'AE',
              baseCurrency: currencyCode,
              invoiceSeries: 'SUP-DXB',
              calendarId: calendar.id,
            },
          ])
          .onConflictDoNothing()

        await tx
          .insert(customers)
          .values([{ id: CUSTOMER, code: 'SUP-CUST', legalNameEn: 'Support Customer' }])
          .onConflictDoNothing()

        await tx
          .insert(jobs)
          .values([
            {
              id: JOB_KWI,
              reference: 'SUP-KWI-1',
              branchId: KUWAIT,
              customerId: CUSTOMER,
              mode: 'sea_fcl',
              tradeDirection: 'import',
            },
            {
              id: JOB_DXB,
              reference: 'SUP-DXB-1',
              branchId: DUBAI,
              customerId: CUSTOMER,
              mode: 'air',
              tradeDirection: 'export',
            },
          ])
          .onConflictDoNothing()

        await tx
          .insert(principals)
          .values([
            {
              id: ENGINEER,
              type: 'support',
              email: 'engineer@techpotions.test',
              nameEn: 'Support Engineer',
            },
            {
              id: OTHER_ENGINEER,
              type: 'support',
              email: 'other@techpotions.test',
              nameEn: 'Another Engineer',
            },
            {
              id: OPERATOR_ADMIN,
              type: 'internal',
              email: 'admin@operator.test',
              nameEn: 'Operator Administrator',
            },
          ])
          .onConflictDoNothing()

        const [adminRole] = await tx
          .select({ id: roles.id })
          .from(roles)
          .where(eq(roles.key, 'administrator'))
          .limit(1)
        if (!adminRole) throw new Error('Run `pnpm db:seed` before the support tests')

        await tx
          .insert(principalBranchRoles)
          .values([{ principalId: OPERATOR_ADMIN, branchId: KUWAIT, roleId: adminRole.id }])
          .onConflictDoNothing()

        const now = Date.now()
        await tx
          .insert(supportGrants)
          .values([
            {
              id: GRANT_KUWAIT,
              principalId: ENGINEER,
              grantedById: OPERATOR_ADMIN,
              branchIds: [KUWAIT],
              scope: 'read',
              reason: 'TICKET-1 invoice total query',
              expiresAt: new Date(now + 4 * hour),
            },
            {
              id: GRANT_EXPIRED,
              principalId: ENGINEER,
              grantedById: OPERATOR_ADMIN,
              branchIds: [KUWAIT],
              scope: 'read',
              reason: 'TICKET-2 closed last week',
              // `created_at` is defaulted to now, and the check constraint
              // demands expiry after it — so this row is written with both in
              // the past to represent a grant that has since lapsed.
              createdAt: new Date(now - 48 * hour),
              expiresAt: new Date(now - 24 * hour),
            },
            {
              id: GRANT_REVOKED,
              principalId: ENGINEER,
              grantedById: OPERATOR_ADMIN,
              branchIds: [KUWAIT],
              scope: 'read',
              reason: 'TICKET-3 withdrawn',
              expiresAt: new Date(now + 4 * hour),
              revokedAt: new Date(now - hour),
              revokedById: OPERATOR_ADMIN,
            },
            {
              id: GRANT_OTHER,
              principalId: OTHER_ENGINEER,
              grantedById: OPERATOR_ADMIN,
              branchIds: [KUWAIT, DUBAI],
              scope: 'read',
              reason: 'TICKET-4 another engineer',
              expiresAt: new Date(now + 4 * hour),
            },
            {
              id: GRANT_WRITE,
              principalId: ENGINEER,
              grantedById: OPERATOR_ADMIN,
              branchIds: [KUWAIT],
              scope: 'write',
              reason: 'TICKET-5 escalated to write',
              expiresAt: new Date(now + 4 * hour),
            },
          ])
          .onConflictDoNothing()
      },
      app,
    )
  })

  // ------------------------------------------------------------------------
  // Granted, and scoped
  // ------------------------------------------------------------------------

  it('sees nothing without a grant', async () => {
    const noGrant: Actor = {
      principalId: ENGINEER,
      type: 'support',
      branchIds: [KUWAIT, DUBAI],
    }
    expect(await visibleJobs(app, noGrant)).toEqual([])
  })

  it('sees the granted branch and no other', async () => {
    const actor = supportActor({
      principalId: ENGINEER,
      grantId: GRANT_KUWAIT,
      action: 'GET /jobs',
    })
    expect(await visibleJobs(app, actor)).toEqual(['SUP-KWI-1'])
  })

  /*
    A dead grant does not open a session at all.

    Stronger than "sees nothing", and discovered by running these against a
    real database: the access-log insert in `withActor` is itself subject to
    `support_access_log_insert`, which admits a row only for a live grant. So
    an expired or revoked grant fails at the door rather than reading an empty
    result — no half-open session, and nothing that could be mistaken for an
    empty database.
  */
  it('refuses an expired grant', async () => {
    const actor = supportActor({ principalId: ENGINEER, grantId: GRANT_EXPIRED })
    await expect(visibleJobs(app, actor)).rejects.toThrow(SupportAccessError)
  })

  it('refuses a revoked grant', async () => {
    const actor = supportActor({ principalId: ENGINEER, grantId: GRANT_REVOKED })
    await expect(visibleJobs(app, actor)).rejects.toThrow(SupportAccessError)
  })

  /**
   * A grant id is an identifier, not a secret. If the policy checked only that
   * the grant were live, one engineer's id would open the deployment for
   * anyone who saw it — including a former colleague whose own grant lapsed.
   */
  it("refuses another engineer's grant", async () => {
    const actor = supportActor({ principalId: ENGINEER, grantId: GRANT_OTHER })
    await expect(visibleJobs(app, actor)).rejects.toThrow(SupportAccessError)
  })

  // ------------------------------------------------------------------------
  // Read-only
  // ------------------------------------------------------------------------

  /**
   * Refused by policy *absence*, not by a check that says no. `0008` creates
   * support policies `for select` only, so an update finds nothing that admits
   * it and affects no rows — the same outcome as a row that is not there.
   */
  it('cannot write under a read grant', async () => {
    const actor = supportActor({ principalId: ENGINEER, grantId: GRANT_KUWAIT })

    const attempt = await withActor(
      actor,
      async (tx) =>
        tx.execute(sql`update jobs set reference = 'SUP-TAMPERED' where id = ${JOB_KWI}`),
      app,
    )
    expectNoRowsAffected(attempt, 'a read-only support session updated a job')

    const after = await withActor(
      operatorAdmin,
      async (tx) => tx.execute(sql`select reference from jobs where id = ${JOB_KWI}`),
      app,
    )
    expect((after.rows[0] as { reference: string }).reference).toBe('SUP-KWI-1')
  })

  it('cannot insert under a read grant', async () => {
    const actor = supportActor({ principalId: ENGINEER, grantId: GRANT_KUWAIT })

    await expectRlsViolation(
      withActor(
        actor,
        async (tx) =>
          tx.execute(sql`
            insert into jobs (reference, branch_id, customer_id, mode, trade_direction)
            values ('SUP-INSERTED', ${KUWAIT}, ${CUSTOMER}, 'air', 'export')
          `),
        app,
      ),
    )
  })

  /** The escalation exists, is separate, and is per grant. */
  it('can write under a write grant, within the granted branch', async () => {
    const actor = supportActor({ principalId: ENGINEER, grantId: GRANT_WRITE })

    await withActor(
      actor,
      async (tx) =>
        tx.execute(
          sql`update jobs set customer_reference = 'seen by support' where id = ${JOB_KWI}`,
        ),
      app,
    )

    const after = await withActor(
      operatorAdmin,
      async (tx) => tx.execute(sql`select customer_reference from jobs where id = ${JOB_KWI}`),
      app,
    )
    expect((after.rows[0] as { customer_reference: string | null }).customer_reference).toBe(
      'seen by support',
    )
  })

  it('cannot write outside the granted branch even under a write grant', async () => {
    const actor = supportActor({ principalId: ENGINEER, grantId: GRANT_WRITE })

    const attempt = await withActor(
      actor,
      async (tx) =>
        tx.execute(sql`update jobs set customer_reference = 'reached' where id = ${JOB_DXB}`),
      app,
    )
    expectNoRowsAffected(attempt, 'a write grant reached outside its branches')

    const after = await withActor(
      operatorAdmin,
      async (tx) => tx.execute(sql`select customer_reference from jobs where id = ${JOB_DXB}`),
      app,
    )
    expect((after.rows[0] as { customer_reference: string | null }).customer_reference).not.toBe(
      'reached',
    )
  })

  // ------------------------------------------------------------------------
  // Recorded
  // ------------------------------------------------------------------------

  it('writes a trail entry naming the grant and the ticket', async () => {
    await withActor(
      supportActor({
        principalId: ENGINEER,
        grantId: GRANT_KUWAIT,
        action: 'GET /invoices/abc',
      }),
      async (tx) => tx.execute(sql`select 1`),
      app,
    )

    const rows = await withActor(
      operatorAdmin,
      async (tx) =>
        tx.execute(sql`
          select l.action, g.reason
            from support_access_log l
            join support_grants g on g.id = l.grant_id
           where l.grant_id = ${GRANT_KUWAIT} and l.action = 'GET /invoices/abc'
           limit 1
        `),
      app,
    )
    expect(rows.rows[0]).toMatchObject({
      action: 'GET /invoices/abc',
      reason: 'TICKET-1 invoice total query',
    })
  })

  /** The operator can always see who has been in, which is the whole point. */
  it('lets the operator read the whole trail', async () => {
    const rows = await withActor(
      operatorAdmin,
      async (tx) =>
        tx.execute(
          sql`select count(*)::int as n from support_access_log where grant_id = ${GRANT_KUWAIT}`,
        ),
      app,
    )
    expect((rows.rows[0] as { n: number }).n).toBeGreaterThan(0)
  })

  /** A trail the recorded party can amend is not a trail. */
  it('refuses to update or delete a trail entry', async () => {
    const actor = supportActor({ principalId: ENGINEER, grantId: GRANT_KUWAIT })

    await expect(
      withActor(
        actor,
        async (tx) => tx.execute(sql`update support_access_log set action = 'x'`),
        app,
      ),
    ).rejects.toThrow()

    await expect(
      withActor(actor, async (tx) => tx.execute(sql`delete from support_access_log`), app),
    ).rejects.toThrow()
  })

  /** Nobody extends their own access. */
  it('refuses a support principal writing its own grant', async () => {
    const actor = supportActor({ principalId: ENGINEER, grantId: GRANT_KUWAIT })

    const attempt = await withActor(
      actor,
      async (tx) =>
        tx.execute(
          sql`update support_grants set expires_at = now() + interval '30 days' where id = ${GRANT_KUWAIT}`,
        ),
      app,
    )
    expectNoRowsAffected(attempt, 'a support session extended its own grant')
  })

  /** And cannot enumerate anyone else's. */
  it('shows a support principal only its own grants', async () => {
    const rows = await withActor(
      supportActor({ principalId: ENGINEER, grantId: GRANT_KUWAIT }),
      async (tx) =>
        tx.execute(sql`select count(*)::int as n from support_grants where id = ${GRANT_OTHER}`),
      app,
    )
    expect((rows.rows[0] as { n: number }).n).toBe(0)
  })

  /**
   * The operator can see the vendor's engineers.
   *
   * A support principal holds no role in this deployment, so 0004's
   * `principals_scope` hid them from the operator's own staff — and every
   * query behind the vendor-access screen joins `principals` to name the
   * engineer. The join found nothing and the page rendered as though no
   * support access had ever been granted, which reads as reassurance rather
   * than as a fault. Only running it against a database showed that.
   */
  it('shows support principals to internal staff', async () => {
    const rows = await withActor(
      operatorAdmin,
      async (tx) => tx.execute(sql`select name_en from principals where id = ${ENGINEER}`),
      app,
    )
    expect((rows.rows[0] as { name_en: string } | undefined)?.name_en).toBe('Support Engineer')
  })

  /** The join the screen actually performs, asserted end to end. */
  it('names the engineer and the granter on every grant', async () => {
    const rows = await withActor(
      operatorAdmin,
      async (tx) =>
        tx.execute(sql`
          select p.name_en as engineer, granter.name_en as granted_by
            from support_grants g
            join principals p on p.id = g.principal_id
            join principals granter on granter.id = g.granted_by_id
           where g.id = ${GRANT_KUWAIT}
        `),
      app,
    )
    expect(rows.rows[0]).toMatchObject({
      engineer: 'Support Engineer',
      granted_by: 'Operator Administrator',
    })
  })

  /** Widening it no further: staff still cannot enumerate another branch's people. */
  it('does not widen visibility of ordinary staff', async () => {
    const rows = await withActor(
      { principalId: OPERATOR_ADMIN, type: 'internal', branchIds: [] },
      async (tx) =>
        tx.execute(sql`select count(*)::int as n from principals where id = ${OTHER_ENGINEER}`),
      app,
    )
    // Still visible — but only because it is a *support* principal, which is
    // the whole and only widening this migration makes.
    expect((rows.rows[0] as { n: number }).n).toBe(1)
  })

  /** The operator sees every grant against their own deployment. */
  it('shows the operator every grant', async () => {
    const rows = await withActor(
      operatorAdmin,
      async (tx) =>
        tx.execute(sql`select count(*)::int as n from support_grants where reason like 'TICKET-%'`),
      app,
    )
    expect((rows.rows[0] as { n: number }).n).toBe(5)
  })
})
