/**
 * The audit log — Architecture §5.4, FR-AD-01.
 *
 * Written by a trigger attached to every business table, never by application
 * code. That is not a stylistic preference:
 *
 *   - FR-AD-01 requires that *no role, including administrator*, can edit an
 *     audit entry. Application-level logging cannot satisfy that — an
 *     administrator with database access edits the row. Revoking UPDATE and
 *     DELETE at the database can, and does (see `0004_audit.sql`).
 *   - A trigger cannot be forgotten. The `audit.log(...)` call that someone
 *     omits on the twelfth mutation path is the most likely DRY violation in
 *     a codebase this shape, and this removes the opportunity entirely.
 *
 * `bigserial`, not uuidv7, because nothing references an audit row by id and
 * insert throughput on the hottest table in the system matters more than a
 * portable key.
 */

import { bigserial, index, inet, jsonb, text, uuid } from 'drizzle-orm/pg-core'
import { ref, tsz } from './columns'
import { systemTable } from './table'

export const auditLog = systemTable(
  'Insert-only by design. An audit trigger on the audit table would recurse, ' +
    'and UPDATE/DELETE are revoked from every role including app_admin.',
)(
  'audit_log',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    at: tsz('at').notNull().defaultNow(),
    /** Read from `app.principal_id` — the transaction-local actor (§5.2). */
    principalId: uuid('principal_id'),
    principalType: text('principal_type'),
    tableName: text('table_name').notNull(),
    /**
     * The row's primary key, as text.
     *
     * Not `uuid`: most tables are keyed by `uuidv7()`, but the reference
     * tables an administrator edits — currencies, countries, incoterms,
     * container types — are keyed by their code, and those edits are exactly
     * the ones worth auditing. Text holds both. The trigger is told which
     * column to read at attach time, so this never guesses.
     */
    rowId: text('row_id').notNull(),
    op: text('op').notNull(),
    before: jsonb('before').$type<Record<string, unknown>>(),
    after: jsonb('after').$type<Record<string, unknown>>(),
    branchId: ref('branch_id'),
    ip: inet('ip'),
  },
  (t) => [
    index('audit_log_row_idx').on(t.tableName, t.rowId, t.at),
    index('audit_log_principal_idx').on(t.principalId, t.at),
    // Partitioning by month is the only scaling measure anticipated (§12),
    // and only when it earns it. This index is what defers that.
    index('audit_log_at_idx').on(t.at),
  ],
)
