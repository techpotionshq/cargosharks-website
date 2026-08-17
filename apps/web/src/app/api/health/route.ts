import { createPool } from '@qabandi/db'
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
  fixtures: boolean
  checkedAt: string
}

export async function GET(): Promise<Response> {
  const tenant = process.env.QABANDI_TENANT ?? 'unknown'
  const fixtures = usePilotFixtures()

  const body: Health = {
    status: 'ok',
    tenant,
    schemaVersion: null,
    database: 'not-configured',
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
      const result = await pool.query(`select count(*)::int as n from drizzle.__drizzle_migrations`)
      body.database = 'ok'
      body.schemaVersion = (result.rows[0] as { n: number } | undefined)?.n ?? null
    } catch {
      // The message is not reported. A connection error carries the host, the
      // role and sometimes the database name, and this endpoint is public.
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
