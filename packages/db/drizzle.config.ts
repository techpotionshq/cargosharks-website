import { loadEnv } from './src/env'
import { defineConfig } from 'drizzle-kit'

loadEnv()

/**
 * Migrations are forward-only, versioned in the repository, and applied by
 * `app_migrator` in CI (§13) — never by the application's own role.
 *
 * `drizzle-kit generate` writes the table DDL; the policies, triggers and
 * temporal constraints are hand-written custom migrations in the same folder,
 * because they are the enforcement mechanism and should be read as SQL rather
 * than inferred from a schema file.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  casing: 'snake_case',
  dbCredentials: {
    url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
  },
  verbose: true,
  strict: true,
})
