/**
 * Migration runner — Architecture §5.1, §13.
 *
 * Runs as `app_migrator`, never as `app_user`. Forward-only, versioned in the
 * repository, applied by CI from tagged commits. Refuses to start against the
 * application's own connection string, because a role that can migrate is a
 * role that can drop a policy.
 */

import { loadEnv } from './env'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import pg from 'pg'

loadEnv()

const here = dirname(fileURLToPath(import.meta.url))

async function main(): Promise<void> {
  const url = process.env.MIGRATION_DATABASE_URL
  if (!url) {
    throw new Error(
      'MIGRATION_DATABASE_URL is not set. Migrations run as app_migrator; ' +
        'DATABASE_URL is app_user and holds no ownership (§5.1).',
    )
  }
  if (url === process.env.DATABASE_URL) {
    throw new Error(
      'MIGRATION_DATABASE_URL and DATABASE_URL are the same connection. ' +
        'The application must not connect as a role that can alter policies.',
    )
  }

  const pool = new pg.Pool({ connectionString: url, max: 1 })
  const db = drizzle(pool)

  const started = Date.now()
  await migrate(db, { migrationsFolder: resolve(here, '../migrations') })
  console.log(`migrations applied in ${Date.now() - started}ms`)

  await pool.end()
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
