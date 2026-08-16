/**
 * Provisioning — Architecture §5.1, §13.
 *
 * Creates the database and the two application roles on a server where the
 * container entrypoint is not available: a managed instance, a shared
 * development box, or the client's own cloud at handover.
 *
 * Structure comes from `infra/postgres/init/01-roles.sql`, so the local
 * container and a real server are provisioned from one file and cannot drift.
 * Passwords come from the environment and are applied afterwards, which is why
 * no real credential ever appears in the repository.
 *
 * Requires a superuser connection in `ADMIN_DATABASE_URL`. That connection is
 * used here and nowhere else — never by the running application.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { loadEnv, workspaceRoot } from './env'

loadEnv()

interface RoleTarget {
  readonly role: string
  readonly password: string
  readonly database: string
}

/** Pulls the role, password and database out of a connection string. */
function parse(url: string, label: string): RoleTarget {
  const parsed = new URL(url)
  const password = decodeURIComponent(parsed.password)
  if (!password) throw new Error(`${label} has no password`)
  return {
    role: decodeURIComponent(parsed.username),
    password,
    database: parsed.pathname.replace(/^\//, ''),
  }
}

async function main(): Promise<void> {
  const adminUrl = required('ADMIN_DATABASE_URL')
  const app = parse(required('DATABASE_URL'), 'DATABASE_URL')
  const migrator = parse(required('MIGRATION_DATABASE_URL'), 'MIGRATION_DATABASE_URL')

  if (app.database !== migrator.database) {
    throw new Error(
      `DATABASE_URL points at "${app.database}" and MIGRATION_DATABASE_URL at ` +
        `"${migrator.database}". They must be the same database.`,
    )
  }
  if (app.role === migrator.role) {
    throw new Error(
      'The application and migration roles must differ. app_user holds no ' +
        'ownership and no BYPASSRLS; app_migrator owns every object (§5.1).',
    )
  }

  // --- the cluster ---------------------------------------------------------
  const admin = new pg.Client({ connectionString: adminUrl })
  await admin.connect()

  const exists = await admin.query('select 1 from pg_database where datname = $1', [app.database])
  if (exists.rowCount === 0) {
    // CREATE DATABASE cannot run inside a transaction, hence its own statement.
    await admin.query(`create database ${quoteIdent(app.database)}`)
    console.log(`created database ${app.database}`)
  } else {
    console.log(`database ${app.database} already exists`)
  }
  await admin.end()

  // --- the roles and grants, inside the target database --------------------
  const target = new pg.Client({ connectionString: withDatabase(adminUrl, app.database) })
  await target.connect()

  const bootstrap = readFileSync(
    join(workspaceRoot(), 'infra/postgres/init/01-roles.sql'),
    'utf8',
  )
    // psql meta-commands mean nothing over the wire.
    .replace(/^\\.*$/gm, '')

  await target.query(bootstrap)
  console.log('applied infra/postgres/init/01-roles.sql')

  // Passwords last, from the environment. `alter role` rather than `create
  // role` so re-provisioning rotates a password rather than failing.
  for (const { role, password } of [migrator, app]) {
    await target.query(`alter role ${quoteIdent(role)} with password ${quoteLiteral(password)}`)
    console.log(`set password for ${role}`)
  }

  await target.end()

  console.log('\nprovisioned. next: pnpm db:migrate && pnpm db:seed')
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set — see .env.example`)
  return value
}

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url)
  parsed.pathname = `/${database}`
  return parsed.toString()
}

/**
 * Identifiers and literals are interpolated because `create database` and
 * `alter role ... password` take neither parameter. Both are quoted properly
 * rather than concatenated, and both come from a connection string the
 * operator supplied.
 */
function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
