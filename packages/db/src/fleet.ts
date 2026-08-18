/**
 * The fleet — every deployment this vendor runs, in one place.
 *
 * The product is sold deployment-per-customer: one database, one schema, one
 * set of RLS policies, no `tenant_id` above `branch_id` (§6.1). That is the
 * right shape for mid-market forwarders — it is a data-sovereignty answer as
 * well as an architecture — but it moves a cost onto whoever operates it. At
 * three customers, standing one up by hand is an afternoon. At fifteen it is a
 * full-time job, and the difference between a supportable business and an
 * unsupportable one is entirely whether the operations are scripted.
 *
 * This module is the registry the scripts read. It exists so that
 * `fleet:migrate` cannot be run against a list someone assembled by memory.
 *
 * ## Secrets are not in the manifest
 *
 * `fleet.json` holds what is safe to commit — the key, the display name, the
 * brand and the region. Connection strings come from the environment, named by
 * convention from the key:
 *
 *     QABANDI_<KEY>_DATABASE_URL             the application role, app_user
 *     QABANDI_<KEY>_MIGRATION_DATABASE_URL   app_migrator
 *     QABANDI_<KEY>_ADMIN_DATABASE_URL       superuser, provisioning only
 *
 * The split is not ceremony. A manifest with fifteen production passwords in
 * it is a file that ends up in a chat message the first time somebody
 * onboards, and the whole point of the per-tenant model is that one customer's
 * credentials do not reach another customer's data.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnv, workspaceRoot } from './env'
export { EXPECTED_MIGRATIONS } from './schema-version'

export interface TenantRecord {
  /** Stable identifier. Appears in telemetry as `qabandi.tenant`. */
  readonly key: string
  readonly name: string
  /** `packages/brand/src/brands/<brand>.ts`. */
  readonly brand?: string
  /** Where the data lives — the answer to a residency question. */
  readonly region?: string
  /** Set once the deployment is live; a dry tenant is still in provisioning. */
  readonly liveAt?: string
}

export interface Tenant extends TenantRecord {
  readonly databaseUrl?: string
  readonly migrationUrl?: string
  readonly adminUrl?: string
}

const MANIFEST = 'fleet.json'

/** `acme-logistics` becomes `ACME_LOGISTICS`. */
export function envPrefix(key: string): string {
  return key.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
}

export function tenantEnvNames(key: string): {
  databaseUrl: string
  migrationUrl: string
  adminUrl: string
} {
  const prefix = envPrefix(key)
  return {
    databaseUrl: `QABANDI_${prefix}_DATABASE_URL`,
    migrationUrl: `QABANDI_${prefix}_MIGRATION_DATABASE_URL`,
    adminUrl: `QABANDI_${prefix}_ADMIN_DATABASE_URL`,
  }
}

/**
 * Reads the manifest and resolves each tenant's connection strings.
 *
 * A missing manifest is not an error. A single-deployment installation — which
 * is what Al-Qabandi's own is — has no fleet, and every one of these scripts
 * should still work against the plain `DATABASE_URL` in the environment. That
 * fallback is what keeps the fleet tooling from being a second, divergent way
 * to operate one deployment.
 */
export function readFleet(): Tenant[] {
  loadEnv()

  const path = join(workspaceRoot(), MANIFEST)

  if (!existsSync(path)) {
    if (!process.env.MIGRATION_DATABASE_URL && !process.env.DATABASE_URL) return []
    return [
      {
        key: process.env.QABANDI_TENANT ?? 'default',
        name: process.env.QABANDI_TENANT ?? 'This deployment',
        brand: process.env.BRAND,
        databaseUrl: process.env.DATABASE_URL,
        migrationUrl: process.env.MIGRATION_DATABASE_URL,
        adminUrl: process.env.ADMIN_DATABASE_URL,
      },
    ]
  }

  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  const records = (
    Array.isArray(parsed) ? parsed : ((parsed as { tenants?: unknown }).tenants ?? [])
  ) as TenantRecord[]

  return records.map((record) => {
    const names = tenantEnvNames(record.key)
    return {
      ...record,
      databaseUrl: process.env[names.databaseUrl],
      migrationUrl: process.env[names.migrationUrl],
      adminUrl: process.env[names.adminUrl],
    }
  })
}

/** One tenant by key, or every tenant when no key is given. */
export function selectTenants(key?: string): Tenant[] {
  const fleet = readFleet()
  if (!key) return fleet

  const found = fleet.filter((tenant) => tenant.key === key)
  if (found.length === 0) {
    throw new Error(
      `No tenant "${key}" in ${MANIFEST}. Known: ${fleet.map((t) => t.key).join(', ') || '(none)'}`,
    )
  }
  return found
}

/**
 * The applied-migration count, which is how a fleet answers "who is behind?".
 *
 * Read from Drizzle's own bookkeeping rather than from a version column we
 * maintain, because the two could disagree and only one of them decides what
 * the schema actually is.
 */
export async function schemaVersion(pool: {
  query: (text: string) => Promise<{ rows: unknown[] }>
}): Promise<number | null> {
  try {
    const result = await pool.query('select count(*)::int as n from drizzle.__drizzle_migrations')
    return (result.rows[0] as { n: number } | undefined)?.n ?? null
  } catch {
    // No bookkeeping table means migrations have never run here — a database
    // that exists but was never migrated, which is a real state during
    // provisioning and worth distinguishing from unreachable.
    return null
  }
}

/**
 * Redacts a connection string for logging.
 *
 * These scripts print what they are about to do, and what they are about to do
 * contains a password. Printing it into a CI log is how a credential leaves
 * the systems that were supposed to hold it.
 */
export function safeUrl(url: string | undefined): string {
  if (!url) return '(not set)'
  try {
    const parsed = new URL(url)
    parsed.password = '***'
    return parsed.toString()
  } catch {
    return '(unparseable)'
  }
}
