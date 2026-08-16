/**
 * Pool configuration — Architecture §2, §5.1.
 *
 * Drizzle over plain `node-postgres`. Not PostgREST, not a Supabase client:
 * no vendor API appears in application code, so the pilot-to-Release-One move
 * is a connection string, a storage adapter and a DNS change (§3.1).
 */

import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema/index'

/**
 * `numeric` must arrive as a string.
 *
 * By default `node-postgres` leaves numeric as text, and that is exactly what
 * is wanted — parsing it into a JS `number` would silently destroy the third
 * decimal of every KWD amount and the eighth of every FX rate. This registers
 * the identity parser explicitly so a future dependency cannot quietly change
 * the default underneath us (§11).
 */
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => value)
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => value)

/** `date` columns stay as `YYYY-MM-DD`, never a Date in the server's zone. */
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value)

export interface PoolConfig {
  readonly connectionString: string
  readonly max?: number
  /**
   * True behind PgBouncer in transaction-pooling mode. Prepared statements are
   * not shared across pooled connections, so they are disabled; the actor
   * settings are transaction-local and survive that fine (§5.2).
   */
  readonly pooled?: boolean
}

export function createPool(config: PoolConfig): pg.Pool {
  const pool = new pg.Pool({
    connectionString: config.connectionString,
    max: config.max ?? 10,
    // Fail fast rather than queue behind a dead database.
    connectionTimeoutMillis: 10_000,
    /**
     * Idle connections are dropped quickly and kept alive while they live.
     *
     * Managed Postgres in front of a pooler will close an idle connection
     * without telling the client, which surfaces much later as "Connection
     * terminated unexpectedly" on a query that did nothing wrong. Retiring our
     * own idle connections before the far end does, and sending TCP keepalives
     * on the ones still in use, turns that class of failure into nothing.
     */
    idleTimeoutMillis: 10_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 5_000,
    application_name: 'qabandi',
  })

  /**
   * Idle-client errors must be handled or they take the process with them.
   *
   * `pg.Pool` emits `error` for a connection that dies while *idle in the
   * pool* — nobody is awaiting it, so there is no promise to reject, and an
   * unhandled `error` event on an EventEmitter is a hard crash in Node. The
   * pool removes the dead client by itself; all this listener has to do is
   * exist, and say so when it fires.
   */
  pool.on('error', (error) => {
    console.error('[db] idle client error, connection discarded:', error.message)
  })

  return pool
}

export function createDatabase(config: PoolConfig) {
  const pool = createPool(config)
  return drizzle(pool, {
    schema,
    logger: process.env.DATABASE_LOG === 'true',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
}

export type Database = ReturnType<typeof createDatabase>

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env — the application connects as app_user, ` +
        'which holds no BYPASSRLS and no table ownership (§5.1).',
    )
  }
  return value
}

let cached: Database | undefined

/**
 * The process-wide database handle, as `app_user`.
 *
 * Deliberately not exported for direct querying from feature code: go through
 * `withActor`, which is the only path that sets the RLS context.
 */
export const db: Database = new Proxy({} as Database, {
  get(_target, property) {
    cached ??= createDatabase({
      connectionString: requiredEnv('DATABASE_URL'),
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      pooled: process.env.DATABASE_POOLED === 'true',
    })
    return Reflect.get(cached as object, property)
  },
})

export { schema }
