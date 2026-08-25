/**
 * Pool configuration — Architecture §2, §5.1.
 *
 * Drizzle over plain `node-postgres`. Not PostgREST, not a Supabase client:
 * no vendor API appears in application code, so the pilot-to-Release-One move
 * is a connection string, a storage adapter and a DNS change (§3.1).
 */

import { readFileSync } from 'node:fs'
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

/**
 * Whether the connection string points somewhere the packets never leave.
 *
 * A unix socket has no hostname at all, which is why the empty string counts:
 * `postgres:///qabandi` is as local as it gets.
 */
function isLoopback(connectionString: string): boolean {
  try {
    const { hostname } = new URL(connectionString)
    return (
      hostname === '' || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
    )
  } catch {
    // An unparseable string is somebody else's error to report, and guessing
    // "local" here would be the unsafe guess.
    return false
  }
}

/**
 * TLS to the database — and, more usefully, making its absence a decision.
 *
 * This was listed as an open gap in `docs/compliance/Security_Measures.md` §6
 * for a plain reason: nothing in the connection string or in this file asked
 * for TLS, so whether the traffic was encrypted depended entirely on where the
 * database happened to be that week. A reviewer cannot audit "it depends", and
 * neither can we.
 *
 * Four states, and the fourth is the point:
 *
 *   - `disable` — no TLS, deliberately. The right answer when the database is
 *     on the far end of a private network the operator controls, and it is
 *     recorded as a choice rather than inferred from a silence.
 *   - `require` — encrypted, certificate not verified. Stops passive capture;
 *     does not stop an active man in the middle. Most managed providers on a
 *     private link sit here.
 *   - `verify-full` — encrypted and the certificate checked against
 *     `DATABASE_CA_CERT`. The only setting that survives a hostile network.
 *   - unset — allowed anywhere the packets stay on the machine, and a hard
 *     refusal in production against a remote host. Starting anyway would mean
 *     shipping credentials in clear across somebody's network because nobody
 *     got round to picking, which is exactly the failure this is here to make
 *     impossible.
 *
 * A `sslmode=` already in the connection string wins outright: it is the
 * standard way to say this, `node-postgres` honours it, and quietly overriding
 * an operator's explicit parameter is how a "secure by default" flag ends up
 * downgrading a connection somebody had already secured.
 */
export function resolveSsl(connectionString: string): pg.PoolConfig['ssl'] {
  if (/[?&]sslmode=/i.test(connectionString)) return undefined

  const mode = (process.env.DATABASE_SSL ?? '').trim().toLowerCase()

  if (mode === 'disable') return undefined
  // nosemgrep: problem-based-packs.insecure-transport.js-node.bypass-tls-verification.bypass-tls-verification
  //
  // Flagged, and correctly — this is the weaker mode, and it is weaker on
  // purpose. `require` is PostgreSQL's own name for "encrypt, do not verify",
  // and a deployment that asks for it by name has said so deliberately. The
  // rule's advice is to use `verify-full`, which is exactly what the next
  // branch implements and what `.env.example` recommends. Removing this option
  // would not make anything safer; it would make the operator's only choices
  // `verify-full` or nothing, and the deployments that cannot yet produce a CA
  // bundle would pick nothing.
  if (mode === 'require') return { rejectUnauthorized: false }
  if (mode === 'verify-full') {
    const caPath = process.env.DATABASE_CA_CERT
    if (!caPath) {
      throw new Error(
        'DATABASE_SSL is "verify-full" but DATABASE_CA_CERT is not set. Point it at the ' +
          "certificate authority bundle for the database's certificate — verification without " +
          'a CA to verify against is just `require` wearing a stricter name.',
      )
    }
    return { rejectUnauthorized: true, ca: readFileSync(caPath, 'utf8') }
  }
  if (mode !== '') {
    throw new Error(
      `DATABASE_SSL is "${mode}", which is not one of disable, require or verify-full. ` +
        'Unset it to accept the default, which is refusal in production against a remote host.',
    )
  }

  if (process.env.NODE_ENV === 'production' && !isLoopback(connectionString)) {
    throw new Error(
      'DATABASE_SSL is not set and the database is not local, so this would connect in clear ' +
        'text across a network in production. Set DATABASE_SSL to verify-full (with ' +
        'DATABASE_CA_CERT), to require, or to disable if the link is private and that is a ' +
        'decision somebody has actually made.',
    )
  }

  return undefined
}

export function createPool(config: PoolConfig): pg.Pool {
  const pool = new pg.Pool({
    connectionString: config.connectionString,
    ssl: resolveSsl(config.connectionString),
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
