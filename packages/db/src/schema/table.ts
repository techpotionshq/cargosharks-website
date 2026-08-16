/**
 * A thin wrapper over Drizzle's `pgTable` that records what it creates.
 *
 * The registry exists for one reason: §5 makes RLS and audit universal
 * obligations, and "universal" needs to be checkable. The policy tests walk
 * this registry and assert that every business table has row-level security
 * enabled *and* forced, and an audit trigger attached. A new table that
 * nobody remembered to protect fails the build rather than shipping.
 *
 * Tables opt out explicitly, with a reason, via `systemTable`.
 */

import { pgTable as drizzlePgTable } from 'drizzle-orm/pg-core'

export type TableClass = 'business' | 'system'

interface Registration {
  readonly name: string
  readonly class: TableClass
  readonly reason?: string
}

const registry = new Map<string, Registration>()

type PgTable = typeof drizzlePgTable

/**
 * Declares a business table: RLS-scoped, audited, never deleted from.
 * Signature is Drizzle's own — this only records the name on the way past.
 */
export const pgTable: PgTable = ((name: string, ...rest: unknown[]) => {
  registry.set(name, { name, class: 'business' })
  return (drizzlePgTable as (...args: unknown[]) => unknown)(name, ...rest)
}) as PgTable

/**
 * Declares a table outside the §5 obligations. Every use needs a reason, and
 * there are only a few legitimate ones: the audit log itself (insert-only, and
 * a trigger on it would recurse), reference data readable by everyone, and the
 * auth library's own tables.
 */
export function systemTable(reason: string): PgTable {
  return ((name: string, ...rest: unknown[]) => {
    registry.set(name, { name, class: 'system', reason })
    return (drizzlePgTable as (...args: unknown[]) => unknown)(name, ...rest)
  }) as PgTable
}

/** Table names the RLS and audit tests must find protected. */
export function businessTableNames(): string[] {
  return [...registry.values()]
    .filter((r) => r.class === 'business')
    .map((r) => r.name)
    .sort()
}

export function systemTableNames(): string[] {
  return [...registry.values()]
    .filter((r) => r.class === 'system')
    .map((r) => r.name)
    .sort()
}

export function tableRegistry(): Registration[] {
  return [...registry.values()].sort((a, b) => a.name.localeCompare(b.name))
}
