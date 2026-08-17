/**
 * Stand up a deployment — `pnpm tenant:new`.
 *
 * Everything between "we have signed a customer" and "somebody can sign in",
 * in one command that either finishes or leaves nothing behind.
 *
 * It replaces a six-step manual procedure — `db:provision`, `db:migrate`,
 * `db:seed`, `db:create-user`, a brand file, an env block — which is fine
 * once, tolerable three times, and a source of quiet variation by the tenth. A
 * deployment where one step was skipped is not obviously broken; it is broken
 * on the day somebody hits the feature that needed it, which is usually weeks
 * later and usually in front of the customer.
 *
 * Composed from the existing scripts rather than reimplementing them. Each is
 * spawned as its own process with that tenant's environment, so there is
 * exactly one provisioning path in this repository and the fleet cannot drift
 * from the single-deployment instructions in the README.
 *
 *     pnpm tenant:new --key acme --name "Acme Logistics" \
 *                     --admin-email ops@acme.com --admin-name "Operations"
 *
 * Connection strings come from the environment, named from the key exactly as
 * `fleet.ts` documents. Nothing here invents or stores a credential.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnv, workspaceRoot } from './env'
import { envPrefix, tenantEnvNames, type TenantRecord } from './fleet'

loadEnv()

interface Options {
  readonly key: string
  readonly name: string
  readonly brand?: string
  readonly region?: string
  readonly adminEmail: string
  readonly adminName: string
  readonly seedDemo: boolean
  readonly dryRun: boolean
  readonly branchCode: string
  readonly currency?: string
}

function parseArgs(argv: string[]): Options {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(`--${flag}`)
    return index >= 0 ? argv[index + 1] : undefined
  }

  const key = get('key')
  const name = get('name')
  const adminEmail = get('admin-email')

  if (!key || !name || !adminEmail) {
    throw new Error(
      'Usage: pnpm tenant:new --key <key> --name "<name>" --admin-email <email> ' +
        '[--admin-name "<name>"] [--brand <brand>] [--region <region>] ' +
        '[--seed-demo] [--dry-run]',
    )
  }

  if (!/^[a-z][a-z0-9-]*$/.test(key)) {
    // The key becomes an environment-variable name and a telemetry attribute.
    // Constraining it here beats discovering the constraint at the point where
    // `QABANDI_ACME LOGISTICS_DATABASE_URL` silently fails to resolve.
    throw new Error(`--key must be lower-case letters, digits and hyphens: got "${key}"`)
  }

  return {
    key,
    name,
    brand: get('brand'),
    region: get('region'),
    adminEmail,
    adminName: get('admin-name') ?? 'Administrator',
    seedDemo: argv.includes('--seed-demo'),
    dryRun: argv.includes('--dry-run'),
    // Upper-cased from the key unless given: `acme` becomes `ACME`, which is
    // what a single-office operator would have typed anyway.
    branchCode: (get('branch-code') ?? key)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 10),
    currency: get('currency'),
  }
}

/** Runs one of the existing scripts with this tenant's environment. */
function step(label: string, args: string[], env: NodeJS.ProcessEnv, dryRun: boolean): void {
  console.log(`\n── ${label}`)
  if (dryRun) {
    console.log(`   (dry run) pnpm ${args.join(' ')}`)
    return
  }

  const result = spawnSync('pnpm', args, {
    cwd: workspaceRoot(),
    env: { ...process.env, ...env },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}`)
  }
}

function registerInManifest(record: TenantRecord, dryRun: boolean): void {
  const path = join(workspaceRoot(), 'fleet.json')
  const existing: TenantRecord[] = existsSync(path)
    ? (() => {
        const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
        return (
          Array.isArray(parsed) ? parsed : ((parsed as { tenants?: unknown }).tenants ?? [])
        ) as TenantRecord[]
      })()
    : []

  if (existing.some((tenant) => tenant.key === record.key)) {
    console.log(`\n── fleet.json already lists ${record.key}; leaving it alone`)
    return
  }

  console.log(`\n── registering ${record.key} in fleet.json`)
  if (dryRun) return

  writeFileSync(path, `${JSON.stringify({ tenants: [...existing, record] }, null, 2)}\n`)
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const names = tenantEnvNames(options.key)

  const databaseUrl = process.env[names.databaseUrl]
  const migrationUrl = process.env[names.migrationUrl]
  const adminUrl = process.env[names.adminUrl]

  const missing = [
    !databaseUrl && names.databaseUrl,
    !migrationUrl && names.migrationUrl,
    !adminUrl && names.adminUrl,
  ].filter((value): value is string => Boolean(value))

  if (missing.length > 0) {
    throw new Error(
      `Set these before provisioning ${options.key}:\n  ${missing.join('\n  ')}\n\n` +
        'They are read from the environment rather than the manifest so that no ' +
        "customer's credentials are ever committed — see packages/db/src/fleet.ts.",
    )
  }

  /*
    The environment each composed script sees.

    The tenant's URLs are mapped onto the plain names the existing scripts
    already read, which is what lets them be reused unchanged. `BRAND` and
    `QABANDI_TENANT` are set too, so the seeded deployment and its telemetry
    agree about who this is from the first row written.
  */
  const env: NodeJS.ProcessEnv = {
    DATABASE_URL: databaseUrl,
    MIGRATION_DATABASE_URL: migrationUrl,
    ADMIN_DATABASE_URL: adminUrl,
    QABANDI_TENANT: options.key,
    ...(options.brand ? { BRAND: options.brand } : {}),
  }

  console.log(`Provisioning ${options.name} (${options.key})`)
  if (options.dryRun) console.log('Dry run — nothing will be written.\n')

  step('creating the database and both roles', ['db:provision'], env, options.dryRun)
  step('applying migrations', ['db:migrate'], env, options.dryRun)
  step('seeding reference data and the permission matrix', ['db:seed'], env, options.dryRun)

  if (options.seedDemo) {
    // Evaluation deployments only. The guard is the flag: nobody loads twenty
    // fictional shipments into a customer's production database by accident,
    // but a demo instance is useless without them.
    step('loading the demo dataset', ['db:seed-demo'], env, options.dryRun)
  }

  /*
    The operating entity, before the people in it.

    A role is granted per branch (FR-ID-02), so `db:create-user` refuses on a
    deployment with none — which meant this command produced a database that
    could not be signed into. The branch code defaults to the tenant key
    upper-cased, which is what an operator with one office means anyway.
  */
  step(
    'creating the operating entity',
    [
      'db:create-branch',
      '--code',
      options.branchCode,
      '--name',
      options.name,
      ...(options.region ? ['--country', options.region.toUpperCase()] : []),
      ...(options.currency ? ['--currency', options.currency] : []),
    ],
    env,
    options.dryRun,
  )

  step(
    'creating the first administrator',
    [
      'db:create-user',
      '--email',
      options.adminEmail,
      '--name',
      options.adminName,
      '--role',
      'administrator',
    ],
    env,
    options.dryRun,
  )

  registerInManifest(
    {
      key: options.key,
      name: options.name,
      brand: options.brand,
      region: options.region,
      liveAt: undefined,
    },
    options.dryRun,
  )

  const prefix = envPrefix(options.key)
  console.log(`
── ${options.name} is provisioned.

   Still to do, and deliberately not automated:

     1. Set BETTER_AUTH_SECRET for this deployment — \`openssl rand -base64 32\`.
        A per-tenant value: the application refuses to start in production
        without one, because the fallback is a shared signing key and a session
        minted anywhere would be accepted everywhere.
     2. Point QABANDI_TENANT=${options.key} at the running process so telemetry
        can tell this deployment from the others.
     3. Take a backup and rehearse the restore before go-live —
        \`pnpm fleet:backup ${options.key}\`. A backup nobody has restored is a
        hypothesis.
     4. Confirm the deployment answers on /api/health.

   The administrator password was printed once above. It is not stored.
   Environment variables for this tenant are QABANDI_${prefix}_*.
`)
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
