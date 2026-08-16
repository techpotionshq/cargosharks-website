/**
 * The actor transaction — Architecture §5.2.
 *
 * Every request opens exactly one transaction and stamps the acting principal
 * into transaction-local settings, which the RLS policies then read. There is
 * no un-actored path to the database from request handling: `db` itself is not
 * exported for query use, only `withActor`.
 */

import { sql } from 'drizzle-orm'
import type { PgTransaction } from 'drizzle-orm/pg-core'
import { db, type Database } from './client'

export type PrincipalType = 'internal' | 'customer_contact' | 'agent_contact' | 'system'

/**
 * Who is acting. Assembled once per request from the session, then carried
 * unchanged — never re-derived mid-transaction.
 */
export interface Actor {
  readonly principalId: string
  readonly type: PrincipalType
  /** The branches this principal holds a role in — FR-ID-02. */
  readonly branchIds: readonly string[]
  readonly customerId?: string | null
  readonly partnerId?: string | null
  readonly ip?: string | null
}

export type Tx = PgTransaction<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any
>

/**
 * Background work is an auditable principal, not an absence of one.
 *
 * The id is fixed so the seed can create the matching `principals` row; every
 * nightly accrual and every notification dispatch is attributable to it.
 */
export const SYSTEM_PRINCIPAL_ID = '00000000-0000-7000-8000-000000000001'

export function systemActor(branchIds: readonly string[] = []): Actor {
  return {
    principalId: SYSTEM_PRINCIPAL_ID,
    type: 'system',
    branchIds,
    customerId: null,
    partnerId: null,
    ip: null,
  }
}

/**
 * Opens the transaction and stamps the actor.
 *
 * The third argument to `set_config` — `true` — makes each setting
 * **transaction-local**. That is what makes this safe behind PgBouncer in
 * transaction-pooling mode: the setting cannot survive into another request's
 * use of the same pooled connection. A session-level `SET` would leak one
 * customer's identity into the next customer's query, and this is the single
 * most important detail in the file.
 */
export async function withActor<T>(
  actor: Actor,
  fn: (tx: Tx) => Promise<T>,
  database: Database = db,
): Promise<T> {
  return database.transaction(async (tx) => {
    await tx.execute(sql`
      select
        set_config('app.principal_id',   ${actor.principalId},          true),
        set_config('app.principal_type', ${actor.type},                 true),
        set_config('app.branch_ids',     ${actor.branchIds.join(',')},  true),
        set_config('app.customer_id',    ${actor.customerId ?? ''},     true),
        set_config('app.partner_id',     ${actor.partnerId ?? ''},      true),
        set_config('app.ip',             ${actor.ip ?? ''},             true)
    `)
    return fn(tx as Tx)
  })
}

/**
 * Escape hatch for migrations, seeds and the RLS test harness only.
 *
 * Named to be obvious in a diff. Anything in `apps/` that calls this is a bug:
 * it runs with no principal set, so RLS sees no branches and — by the `else
 * false` arm of every policy — returns nothing at all. That is the intended
 * failure mode. It fails closed, loudly, rather than leaking.
 */
export async function withoutActor<T>(
  fn: (tx: Tx) => Promise<T>,
  database: Database = db,
): Promise<T> {
  return database.transaction(async (tx) => fn(tx as Tx))
}
