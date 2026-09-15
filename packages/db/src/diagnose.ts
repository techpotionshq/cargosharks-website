/**
 * "The screen is empty" — the two questions that separates.
 *
 * A register that renders nothing has exactly two causes, and they need
 * completely different fixes: the rows are not there, or the rows are there and
 * this principal cannot see them. From the screen the two are identical, and
 * from a test failure they are worse than identical — `no record to open` reads
 * like a broken query.
 *
 * So this counts the same tables twice: once as the system actor, which is what
 * the dataset holds, and once as a named principal, which is what that person's
 * screens can read. Two columns, one comparison:
 *
 *   both zero      the seed wrote nothing. Look at `db:seed-demo`.
 *   system > 0,
 *   principal 0    the rows exist and RLS is filtering them out. Look at the
 *                  branch grants printed above the table — a principal holding
 *                  no active `principal_branch_roles` row holds nothing at all
 *                  (FR-ID-02), and that is the usual answer.
 *   both > 0       the data and the scope are fine; the fault is in the screen.
 *
 * It reads through `withActor` like everything else, and as `app_user`, because
 * a diagnostic that connects as the owner answers a question nobody asked.
 *
 * Written for the seeded end-to-end job, where 48 specs failed with every
 * register empty and the log said only that. Equally the first thing to run
 * against a customer's instance when they report the same thing.
 *
 *   pnpm db:diagnose --as e2e@qabandi.test
 */

import { appendFileSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { loadEnv } from './env'
import { createDatabase } from './client'
import { systemActor, withActor, type Actor, type PrincipalType, type Tx } from './actor'

loadEnv()

/**
 * The registers the operations suite reads, in the order the navigation shows
 * them. Reference tables are deliberately absent: they come from `db:seed` and
 * are never the thing that is missing.
 */
const REGISTERS = [
  'enquiries',
  'quotes',
  'jobs',
  'consolidations',
  'exceptions',
  'invoices',
  'supplier_invoices',
  'partner_settlements',
  'customers',
  'partners',
] as const

interface Grant {
  readonly branchCode: string
  readonly roleKey: string
  readonly isActive: boolean
}

interface Principal {
  readonly actor: Actor
  readonly email: string
  readonly isActive: boolean
  readonly grants: readonly Grant[]
  readonly permissions: number
}

/**
 * One `select count(*)` per register, in a single round trip.
 *
 * The `as` on every column is load-bearing, and the reason is worth writing
 * down because getting it wrong is silent. PostgreSQL names an unaliased
 * `count(*)` subselect `count` — all ten of them — and `pg` builds each row as
 * a plain object, so ten duplicate keys collapse into one. The first draft read
 * them back with `Object.values()` and would have reported a single register's
 * figure ten times over, in a tool whose entire job is to be believed about
 * which number is zero.
 */
async function counts(tx: Tx): Promise<Record<string, number>> {
  const parts = REGISTERS.map(
    (t) => sql`(select count(*) from ${sql.identifier(t)})::int as ${sql.identifier(t)}`,
  )
  const result = await tx.execute(sql`select ${sql.join(parts, sql`, `)}`)
  const row = (result as { rows: Record<string, unknown>[] }).rows[0] ?? {}
  return Object.fromEntries(REGISTERS.map((t) => [t, Number(row[t] ?? 0)]))
}

/**
 * Resolves a principal the way `getSession()` does — the same join, the same
 * `is_active` filter on the grant. Reproducing it here rather than importing it
 * is deliberate: `apps/web` is not a dependency of this package, and a copy that
 * drifts would make this tool lie in the one situation it exists for.
 */
async function resolve(tx: Tx, email: string): Promise<Principal | null> {
  const found = await tx.execute(sql`
    select p.id::text          as principal_id,
           p.type::text        as type,
           p.customer_id::text as customer_id,
           p.partner_id::text  as partner_id,
           p.is_active         as is_active
      from principals p
     where lower(p.email) = lower(${email})
     limit 1
  `)
  const row = (found as { rows: Record<string, unknown>[] }).rows[0]
  if (!row) return null

  const granted = await tx.execute(sql`
    select b.code::text   as branch_code,
           b.id::text     as branch_id,
           r.key::text    as role_key,
           pbr.is_active  as is_active
      from principal_branch_roles pbr
      join branches b on b.id = pbr.branch_id
      join roles r    on r.id = pbr.role_id
     where pbr.principal_id = ${String(row.principal_id)}::uuid
     order by b.code
  `)
  const grantRows = (granted as { rows: Record<string, unknown>[] }).rows

  const permitted = await tx.execute(sql`
    select count(distinct rp.permission_key)::int as n
      from principal_branch_roles pbr
      join role_permissions rp on rp.role_id = pbr.role_id and rp.allowed
     where pbr.principal_id = ${String(row.principal_id)}::uuid
       and pbr.is_active
  `)

  return {
    actor: {
      principalId: String(row.principal_id),
      type: String(row.type) as PrincipalType,
      // Only the *active* grants, exactly as the session builds it — a revoked
      // grant must not widen what this reports.
      branchIds: grantRows.filter((g) => g.is_active).map((g) => String(g.branch_id)),
      customerId: row.customer_id ? String(row.customer_id) : null,
      partnerId: row.partner_id ? String(row.partner_id) : null,
    },
    email,
    isActive: Boolean(row.is_active),
    grants: grantRows.map((g) => ({
      branchCode: String(g.branch_code),
      roleKey: String(g.role_key),
      isActive: Boolean(g.is_active),
    })),
    permissions: Number((permitted as { rows: { n: unknown }[] }).rows[0]?.n ?? 0),
  }
}

/** stdout for whoever is watching, and the job summary because a log tail is not. */
function report(lines: string[], table: string[]): void {
  console.log(lines.join('\n'))
  console.log(table.join('\n'))

  const summary = process.env.GITHUB_STEP_SUMMARY
  if (!summary) return
  appendFileSync(
    summary,
    ['### Dataset and scope', '', ...lines.map((l) => `${l}  `), '', ...table, ''].join('\n'),
  )
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const at = argv.indexOf('--as')
  const email = at === -1 ? undefined : argv[at + 1]

  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set.')
  const database = createDatabase({ connectionString: url, max: 1 })

  const asSystem = await withActor(systemActor(), (tx: Tx) => counts(tx), database)

  const lines: string[] = []
  let asPrincipal: Record<string, number> | null = null

  if (email) {
    const principal = await withActor(systemActor(), (tx: Tx) => resolve(tx, email), database)

    if (!principal) {
      lines.push(`**${email}** — no such principal.`)
    } else {
      const grants = principal.grants.length
        ? principal.grants
            .map((g) => `${g.branchCode}:${g.roleKey}${g.isActive ? '' : ' (revoked)'}`)
            .join(', ')
        : 'none'
      lines.push(
        `**${email}** — type \`${principal.actor.type}\`, ` +
          `${principal.isActive ? 'active' : '**inactive**'}, ` +
          `${principal.permissions} permission(s).`,
        `Branch roles: ${grants}`,
      )
      asPrincipal = await withActor(principal.actor, (tx: Tx) => counts(tx), database)
    }
  }

  const header = asPrincipal ? '| register | system | principal |' : '| register | system |'
  const rule = asPrincipal ? '| --- | ---: | ---: |' : '| --- | ---: |'
  const table = [header, rule]
  for (const t of REGISTERS) {
    table.push(
      asPrincipal ? `| ${t} | ${asSystem[t]} | ${asPrincipal[t]} |` : `| ${t} | ${asSystem[t]} |`,
    )
  }

  report(lines, table)
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
