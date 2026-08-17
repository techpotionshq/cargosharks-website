/**
 * Migrate the fleet — `pnpm fleet:migrate`, `pnpm fleet:status`.
 *
 * The tool that decides whether deployment-per-customer is an operating model
 * or a slow-motion fork. Without it, upgrading fifteen customers means fifteen
 * remembered `pnpm db:migrate` invocations against fifteen sets of environment
 * variables; the one that gets skipped is not discovered until that customer
 * hits a bug fixed three releases ago, and by then their schema has diverged
 * far enough that catching up is a project.
 *
 * Two commands, and the order matters:
 *
 *   `fleet:status`   read-only. What version is everyone on, and is everyone
 *                    reachable? Run before, and run after.
 *   `fleet:migrate`  apply. Sequential, never parallel — see below.
 *
 * ## Why sequential, and why it continues past a failure
 *
 * Parallel migration across a fleet is a way to have one bad migration take
 * every customer down simultaneously instead of one at a time. Sequential
 * gives a human the chance to hit Ctrl-C on the second failure, which is the
 * entire safety property worth having here.
 *
 * A failure does *not* abort the run, because stopping leaves the fleet in a
 * split state with no report of which half is which — the worst possible
 * outcome. It continues, records the failure, prints a summary that names
 * every tenant and its outcome, and exits non-zero. The operator ends up
 * knowing exactly where they stand.
 */

import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import pg from 'pg'
import { loadEnv } from './env'
import { readFleet, safeUrl, schemaVersion, selectTenants, type Tenant } from './fleet'

loadEnv()

const here = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS = resolve(here, '../migrations')

interface Outcome {
  readonly tenant: string
  readonly status: 'migrated' | 'current' | 'unreachable' | 'failed' | 'not-configured'
  readonly before: number | null
  readonly after: number | null
  readonly detail?: string
}

async function statusOf(tenant: Tenant): Promise<Outcome> {
  if (!tenant.migrationUrl) {
    return { tenant: tenant.key, status: 'not-configured', before: null, after: null }
  }

  const pool = new pg.Pool({ connectionString: tenant.migrationUrl, max: 1 })
  try {
    /*
      Connectivity is probed separately, before the version is read.

      `schemaVersion` swallows its own error on purpose — a database that
      exists but has never been migrated has no bookkeeping table, and that is
      a legitimate state during provisioning rather than a fault. But it means
      an *unreachable* database would also come back as `null` and be reported
      as reachable-at-version-nothing, which is precisely the tenant an
      operator most needs to see flagged.
    */
    await pool.query('select 1')
    const version = await schemaVersion(pool)
    return { tenant: tenant.key, status: 'current', before: version, after: version }
  } catch (error) {
    return {
      tenant: tenant.key,
      status: 'unreachable',
      before: null,
      after: null,
      detail: error instanceof Error ? error.message : String(error),
    }
  } finally {
    await pool.end().catch(() => {})
  }
}

async function migrateOne(tenant: Tenant): Promise<Outcome> {
  if (!tenant.migrationUrl) {
    return { tenant: tenant.key, status: 'not-configured', before: null, after: null }
  }

  /*
    The same guard `migrate.ts` carries, repeated rather than trusted.

    Migrating as `app_user` would appear to work right up until a policy
    change, then fail with a permission error halfway through a transaction. A
    role that can migrate is a role that can drop a policy, and the two must
    not be the same connection (§5.1).
  */
  if (tenant.migrationUrl === tenant.databaseUrl) {
    return {
      tenant: tenant.key,
      status: 'failed',
      before: null,
      after: null,
      detail: 'migration and application connection strings are identical',
    }
  }

  const pool = new pg.Pool({ connectionString: tenant.migrationUrl, max: 1 })

  try {
    const before = await schemaVersion(pool)
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS })
    const after = await schemaVersion(pool)

    return {
      tenant: tenant.key,
      status: before === after ? 'current' : 'migrated',
      before,
      after,
    }
  } catch (error) {
    return {
      tenant: tenant.key,
      status: 'failed',
      before: null,
      after: null,
      detail: error instanceof Error ? error.message : String(error),
    }
  } finally {
    await pool.end().catch(() => {})
  }
}

function report(outcomes: readonly Outcome[]): void {
  const width = Math.max(6, ...outcomes.map((o) => o.tenant.length))

  console.log('')
  for (const outcome of outcomes) {
    const version =
      outcome.before !== null && outcome.after !== null && outcome.before !== outcome.after
        ? `${outcome.before} → ${outcome.after}`
        : outcome.after !== null
          ? String(outcome.after)
          : '—'

    console.log(
      `  ${outcome.tenant.padEnd(width)}  ${outcome.status.padEnd(15)} ${version.padStart(9)}` +
        (outcome.detail ? `  ${outcome.detail.split('\n')[0]}` : ''),
    )
  }

  /*
    Version drift, named explicitly.

    A fleet on four different schema versions still reports every tenant as
    "current" line by line — each one is at the version it is at. The whole
    reason to run this is to see the spread, so it is computed rather than left
    for someone to notice by reading a column.
  */
  const versions = new Set(outcomes.filter((o) => o.after !== null).map((o) => o.after as number))
  console.log('')
  if (versions.size > 1) {
    console.log(`  drift: ${versions.size} distinct schema versions across the fleet`)
  } else if (versions.size === 1) {
    console.log(`  the fleet is level at version ${[...versions][0]}`)
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const apply = !args.includes('--status')
  const only = args.find((arg) => !arg.startsWith('--'))

  const tenants = only ? selectTenants(only) : readFleet()

  if (tenants.length === 0) {
    console.log(
      'No tenants. Create a `fleet.json` at the workspace root, or set ' +
        'MIGRATION_DATABASE_URL for a single deployment.',
    )
    return
  }

  console.log(`${apply ? 'Migrating' : 'Reading'} ${tenants.length} deployment(s)`)
  for (const tenant of tenants) {
    console.log(`  ${tenant.key.padEnd(16)} ${safeUrl(tenant.migrationUrl)}`)
  }

  const outcomes: Outcome[] = []
  for (const tenant of tenants) {
    outcomes.push(apply ? await migrateOne(tenant) : await statusOf(tenant))
  }

  report(outcomes)

  const bad = outcomes.filter(
    (o) => o.status === 'failed' || o.status === 'unreachable' || o.status === 'not-configured',
  )
  if (bad.length > 0) {
    console.error(
      `\n${bad.length} deployment(s) need attention: ${bad.map((o) => o.tenant).join(', ')}`,
    )
    process.exitCode = 1
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
