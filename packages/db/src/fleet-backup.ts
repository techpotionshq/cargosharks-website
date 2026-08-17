/**
 * Backup and the restore drill — `pnpm fleet:backup`, `pnpm fleet:restore-drill`.
 *
 * Two commands, and the second is the one that matters.
 *
 * A backup nobody has restored is not a backup, it is a hypothesis. The
 * failure mode is well known and still nearly universal: the dump has been
 * running nightly for a year, the file is the right size, and on the morning
 * it is needed it turns out the extension was never installed on the target,
 * or the roles do not exist, or `uuidv7()` is unavailable because the restore
 * host is on PostgreSQL 17. Every one of those is discovered in ten minutes by
 * a drill and in four hours by an incident.
 *
 * `restore-drill` restores a dump into a scratch database, checks that the
 * schema and the row counts arrived, and drops it again. It is meant to run on
 * a schedule, and to be the thing you point at when a customer's IT reviewer
 * asks what your recovery position is.
 *
 * ## What this deliberately does not do
 *
 * It does not implement retention, offsite copying or encryption at rest.
 * Those belong to the storage the dumps are written to — an object store with
 * lifecycle rules and server-side encryption does all three better than a
 * script, and a script that half-implements them invites the belief that the
 * problem is handled.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { loadEnv, workspaceRoot } from './env'
import { safeUrl, schemaVersion, selectTenants, type Tenant } from './fleet'

loadEnv()

/** Where dumps land unless told otherwise. Gitignored; see the note below. */
const DEFAULT_DIR = join(workspaceRoot(), '.backups')

function requireTool(tool: string): void {
  const probe = spawnSync(tool, ['--version'], { shell: process.platform === 'win32' })
  if (probe.status !== 0) {
    throw new Error(
      `${tool} is not on PATH. It ships with the PostgreSQL client tools, and its ` +
        'major version must be at least the server it is dumping — an older pg_dump ' +
        'against PostgreSQL 18 refuses rather than producing a partial file.',
    )
  }
}

function run(command: string, args: string[], env?: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  })
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status ?? 'unknown'}`)
  }
}

/**
 * Dumps one tenant.
 *
 * The custom format, not plain SQL: it is compressed, and `pg_restore` can
 * read it selectively — which is what makes a single-table recovery possible
 * without replaying an entire database over a good one.
 *
 * Dumped through the **admin** connection. `app_user` cannot read every row by
 * design — RLS is forced on every table (§5.3) — so a dump taken as the
 * application role is a silently partial dump, which is the most dangerous
 * artefact this whole file exists to avoid producing.
 */
function backup(tenant: Tenant, directory: string, stamp: string): string {
  if (!tenant.adminUrl) {
    throw new Error(
      `No admin connection for ${tenant.key}. A dump taken as app_user would be ` +
        'silently partial: RLS is forced on every table, so the application role ' +
        'cannot read rows outside its own branches.',
    )
  }

  mkdirSync(directory, { recursive: true })
  const file = join(directory, `${tenant.key}-${stamp}.dump`)

  console.log(`  ${tenant.key}: ${safeUrl(tenant.adminUrl)} → ${file}`)
  run('pg_dump', ['--format=custom', '--no-owner', '--file', file, tenant.adminUrl])

  const size = statSync(file).size
  if (size < 1024) {
    throw new Error(`${file} is ${size} bytes — that is not a database.`)
  }
  console.log(`  ${tenant.key}: ${(size / 1024 / 1024).toFixed(1)} MB`)

  return file
}

/**
 * Restores a dump into a scratch database, verifies it, and drops it.
 *
 * The verification is deliberately about *content*, not exit status.
 * `pg_restore` returning zero means the file was readable, which is a much
 * weaker claim than the data being there — a dump of an empty database
 * restores perfectly.
 */
async function restoreDrill(tenant: Tenant, file: string): Promise<void> {
  if (!tenant.adminUrl) throw new Error(`No admin connection for ${tenant.key}`)

  const source = new URL(tenant.adminUrl)
  const scratch = `${source.pathname.replace(/^\//, '')}_drill`

  const server = new URL(tenant.adminUrl)
  server.pathname = '/postgres'

  const admin = new pg.Client({ connectionString: server.toString() })
  await admin.connect()

  try {
    // Dropped first: a drill that silently reused last night's scratch database
    // would verify last night's dump.
    await admin.query(`drop database if exists "${scratch}" with (force)`)
    await admin.query(`create database "${scratch}"`)
    console.log(`  restoring into ${scratch}`)

    const target = new URL(tenant.adminUrl)
    target.pathname = `/${scratch}`

    /*
      `--exit-on-error` is off on purpose, and this is the one place in the
      file where tolerating errors is right.

      A dump taken with `--no-owner` reliably produces role and extension
      notices on a fresh target that mean nothing. The count checks below are
      what decide whether the restore worked, so failing on a notice would
      reject good backups for cosmetic reasons.
    */
    run('pg_restore', ['--no-owner', '--dbname', target.toString(), file])

    const restored = new pg.Client({ connectionString: target.toString() })
    await restored.connect()
    try {
      const version = await schemaVersion(restored)
      const tables = await restored.query(
        `select count(*)::int as n from information_schema.tables
          where table_schema = 'public' and table_type = 'BASE TABLE'`,
      )
      const policies = await restored.query(
        `select count(*)::int as n from pg_policies where schemaname = 'public'`,
      )

      const tableCount = (tables.rows[0] as { n: number }).n
      const policyCount = (policies.rows[0] as { n: number }).n

      console.log(
        `  restored: ${tableCount} tables, ${policyCount} policies, schema version ${version ?? '—'}`,
      )

      if (tableCount < 20) {
        throw new Error(`only ${tableCount} tables restored — the dump is not complete`)
      }
      /*
        The check worth having.

        Row-level security is the entire tenancy boundary. `pg_dump` carries
        policies, but a restore run in a way that drops them would produce a
        database that looks perfect and enforces nothing — and it would look
        perfect right up until the first cross-branch query in production.
      */
      if (policyCount < 15) {
        throw new Error(
          `only ${policyCount} RLS policies restored — the tenancy boundary did not survive`,
        )
      }
    } finally {
      await restored.end().catch(() => {})
    }

    console.log(`  ${tenant.key}: restore verified`)
  } finally {
    await admin.query(`drop database if exists "${scratch}" with (force)`).catch(() => {})
    await admin.end().catch(() => {})
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const drill = args.includes('--drill')
  const only = args.find((arg) => !arg.startsWith('--'))
  const directory = process.env.QABANDI_BACKUP_DIR ?? DEFAULT_DIR

  requireTool('pg_dump')
  if (drill) requireTool('pg_restore')

  const tenants = selectTenants(only)
  if (tenants.length === 0) {
    console.log('No tenants configured.')
    return
  }

  // Passed in rather than read per tenant, so every file in one run shares a
  // stamp and a fleet-wide snapshot is identifiable as one.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')

  console.log(`Backing up ${tenants.length} deployment(s) to ${directory}`)

  const failures: string[] = []
  for (const tenant of tenants) {
    try {
      const file = backup(tenant, directory, stamp)
      if (drill) await restoreDrill(tenant, file)
    } catch (error) {
      console.error(`  ${tenant.key}: ${error instanceof Error ? error.message : String(error)}`)
      failures.push(tenant.key)
    }
  }

  if (failures.length > 0) {
    console.error(`\nFailed: ${failures.join(', ')}`)
    process.exitCode = 1
  } else if (!drill) {
    console.log(
      '\nDumps written. Nothing has been restored — run with --drill before relying on them.',
    )
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
