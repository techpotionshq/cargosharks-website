/**
 * Column primitives.
 *
 * Every table in the system is built from these, so the invariants in §6 hold
 * by construction rather than by review: every primary key is `uuidv7()`,
 * every timestamp is `timestamptz`, every amount is `numeric`.
 */

import { sql } from 'drizzle-orm'
import { numeric, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * Time-ordered primary key — PostgreSQL 18's `uuidv7()`, §6.4.
 *
 * Sequential inserts into the B-tree instead of the scatter UUIDv4 causes,
 * which matters on the write-heavy tables: job_milestones, charge_lines,
 * messages, audit_log.
 */
export const pk = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`)

/** A foreign key column that is not itself the primary key. */
export const ref = (name: string) => uuid(name)

export const tsz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

/**
 * Set on every business table. `updated_at` is maintained by a trigger, not by
 * application code — see `migrations/0002_triggers.sql`. Application code that
 * remembers to touch it on eleven paths and forgets on the twelfth is exactly
 * the class of bug the database boundary exists to remove.
 */
export const timestamps = {
  createdAt: tsz('created_at')
    .notNull()
    .default(sql`now()`),
  updatedAt: tsz('updated_at')
    .notNull()
    .default(sql`now()`),
}

/**
 * Money. numeric(19,6) — never float, never a JS number (§11).
 *
 * Drizzle returns numeric as a string so precision survives the wire; convert
 * with `fromDb` from `@qabandi/core/money`, never with `Number()`.
 */
export const amount = (name: string) => numeric(name, { precision: 19, scale: 6 })

/** FX rate. numeric(19,8), stored per charge line with its timestamp (FR-RT-06). */
export const rate = (name: string) => numeric(name, { precision: 19, scale: 8 })

/** A quantity: weights, volumes, days. Wider scale than money, same rules. */
export const quantity = (name: string) => numeric(name, { precision: 19, scale: 6 })
