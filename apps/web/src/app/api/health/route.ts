import { createPool, EXPECTED_MIGRATIONS } from '@qabandi/db'
import { usePilotFixtures } from '@/lib/pilot/source'

/**
 * What a fleet monitor polls — one endpoint per deployment.
 *
 * The thing being checked is not "does Node answer", which a load balancer
 * already knows, but "can this deployment do the one thing it exists to do":
 * reach its database, as the application role, with its migrations applied.
 * A process that answers 200 while its database is unreachable is worse than
 * one that is down, because nothing pages anyone.
 *
 * Deliberately unauthenticated and deliberately thin. It reports liveness and
 * schema version and nothing else — no row counts, no customer names, no
 * configuration. An unauthenticated endpoint is a public endpoint, and the
 * temptation to add "just one useful number" to it is how monitoring becomes
 * an information leak.
 */

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface Health {
  status: 'ok' | 'degraded'
  tenant: string
  /** Applied migration count — how a fleet answers "who is behind?". */
  schemaVersion: number | null
  database: 'ok' | 'unreachable' | 'not-configured'
  /**
   * What this build expects, against what the database has.
   *
   * Added after a redeploy answered `relation "support_grants" does not exist`:
   * the code was new, the database was a migration behind, and nothing running
   * could say so. The symptom was a `42P01` buried in a stack trace; the cause
   * was one number being lower than another, which is exactly the kind of thing
   * a health endpoint should state outright.
   */
  expectedSchemaVersion: number
  migrationsPending: number | null
  /**
   * Whether the session signing key is set to something real.
   *
   * Added after a deployment answered 500 on sign-in and nothing else could
   * say why: `auth.ts` refuses to start without `BETTER_AUTH_SECRET`, and it
   * throws at module evaluation — so the failure surfaced as an opaque stack
   * in a chunk file. A health endpoint that reports "reachable" while the
   * application cannot authenticate anybody is reporting the wrong thing.
   *
   * Deliberately a boolean. Whether a secret is configured is not sensitive;
   * its value obviously is, and even its length is a hint worth withholding.
   */
  auth: 'ok' | 'not-configured'
  fixtures: boolean
  checkedAt: string
}

export async function GET(): Promise<Response> {
  const tenant = process.env.QABANDI_TENANT ?? 'unknown'
  const fixtures = usePilotFixtures()

  /*
    The same check `auth.ts` makes, without importing it.

    Importing `auth.ts` here would run its module-level guard and take the
    health endpoint down with the thing it is trying to report — the one
    endpoint that must answer when everything else cannot.
  */
  const secret = process.env.BETTER_AUTH_SECRET
  const authConfigured = Boolean(secret) && !secret!.includes('replace-me')

  const body: Health = {
    status: authConfigured ? 'ok' : 'degraded',
    tenant,
    schemaVersion: null,
    expectedSchemaVersion: EXPECTED_MIGRATIONS,
    migrationsPending: null,
    database: 'not-configured',
    auth: authConfigured ? 'ok' : 'not-configured',
    fixtures,
    checkedAt: new Date().toISOString(),
  }

  if (process.env.DATABASE_URL) {
    /*
      Its own short-lived pool rather than the application's.

      A health check that borrows the request pool reports healthy for exactly
      as long as the pool has a spare connection, and unhealthy the moment the
      application is busy — which inverts what it is for. One connection, a
      short timeout, closed immediately.
    */
    const pool = createPool({ connectionString: process.env.DATABASE_URL, max: 1 })
    try {
      /*
        Reachability and schema version are two questions, asked separately.

        They used to be one: the probe read `drizzle.__drizzle_migrations`, and
        when `app_user` had no grant on that schema the permission error was
        reported as `database: unreachable`. A real outage was chased as a
        networking fault for an hour on the strength of that one word.

        `select 1` is a question every role can answer, so it isolates
        connectivity. The version is asked afterwards and allowed to fail on
        its own terms.
      */
      await pool.query('select 1')
      body.database = 'ok'

      try {
        const result = await pool.query(
          `select count(*)::int as n from drizzle.__drizzle_migrations`,
        )
        body.schemaVersion = (result.rows[0] as { n: number } | undefined)?.n ?? null
      } catch {
        /*
          An unreadable version is itself the answer.

          `0009_schema_version_read` grants `app_user` select on the migration
          table, so on any current schema this query succeeds. Reaching the
          database and *not* being able to read it therefore means the schema
          predates that grant — which is to say it is behind, and saying "ok"
          here would be confidently wrong about the exact fault this endpoint
          was extended to catch.
        */
        body.schemaVersion = null
        body.status = 'degraded'
      }

      /*
        A database behind the code is degraded, not healthy.

        Reported rather than merely observed: a deployment in this state serves
        most pages perfectly and fails on whichever feature the newest
        migration added, which is the hardest kind of fault to attribute. The
        answer is `pnpm db:migrate`, and it should not take a stack trace to
        work that out.
      */
      if (body.schemaVersion !== null) {
        body.migrationsPending = Math.max(0, EXPECTED_MIGRATIONS - body.schemaVersion)
        if (body.migrationsPending > 0) body.status = 'degraded'
      }
    } catch (error) {
      /*
        Reported as a class publicly, logged in full privately.

        A connection error carries the host, the role and often the database
        name, so it cannot go in the response — this endpoint is unauthenticated
        by design. But discarding it entirely is what made the last outage take
        an hour: "unreachable" is a symptom with a dozen causes, and the cause
        was in the exception nobody kept. It goes to stderr, where the platform
        log has it and the public does not.
      */
      console.error(
        JSON.stringify({
          level: 'error',
          source: 'health',
          message: error instanceof Error ? error.message : String(error),
          tenant,
        }),
      )
      body.database = 'unreachable'
      body.status = 'degraded'
    } finally {
      await pool.end().catch(() => {})
    }
  } else if (!fixtures) {
    // No database and no fixtures is a misconfigured deployment, not a
    // deliberate offline one.
    body.status = 'degraded'
  }

  return Response.json(body, {
    status: body.status === 'ok' ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  })
}
