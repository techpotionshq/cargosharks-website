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
import { trace } from '@opentelemetry/api'
import { db, type Database } from './client'

export type PrincipalType = 'internal' | 'customer_contact' | 'agent_contact' | 'system' | 'support'

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
  /**
   * The `support_grants` row admitting this actor, for a `support` principal.
   *
   * Carried rather than looked up per statement so the policies read one
   * transaction-local setting, and so the access log records *which* grant was
   * used rather than inferring it from a timestamp. Absent for every other
   * principal type, and an absent grant is what makes a support principal see
   * nothing at all — the same fail-closed default as an absent actor.
   */
  readonly supportGrantId?: string | null
  /** What the engineer is doing, recorded in `support_access_log`. */
  readonly supportAction?: string | null
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
  /*
    The tenant dimension, attached once, here.

    Every request in this system opens exactly one actor transaction, so this
    is the only place that reliably knows *who* a unit of work belongs to —
    which makes it the only place worth attaching that to a trace. Tagging at
    each call site instead would give the same partial coverage the audit
    trigger exists to avoid: eleven paths tagged, the twelfth not, and no way
    to tell which telemetry is trustworthy.

    `@opentelemetry/api` is a no-op without a registered SDK, so this costs a
    property lookup on a laptop with nothing configured. It is also why the
    vendor choice stays open: `apps/*` register whichever exporter they like
    and this file never learns the difference.

    `principal_id` is included and the customer's *name* is not. Support needs
    to answer "which tenant is slow", not to read commercial data out of a
    dashboard — a telemetry backend is a second copy of your data with weaker
    access control than the database it came from.
  */
  const span = trace.getActiveSpan()
  if (span) {
    span.setAttribute('qabandi.principal.type', actor.type)
    span.setAttribute('qabandi.principal.id', actor.principalId)
    span.setAttribute('qabandi.branch.count', actor.branchIds.length)
    if (actor.branchIds.length > 0) {
      span.setAttribute('qabandi.branch.ids', actor.branchIds.join(','))
    }
    if (actor.supportGrantId) {
      // A support session is the one thing worth being able to filter a whole
      // backend down to after the fact.
      span.setAttribute('qabandi.support.grant_id', actor.supportGrantId)
    }
  }

  return database.transaction(async (tx) => {
    await tx.execute(sql`
      select
        set_config('app.principal_id',     ${actor.principalId},           true),
        set_config('app.principal_type',   ${actor.type},                  true),
        set_config('app.branch_ids',       ${actor.branchIds.join(',')},   true),
        set_config('app.customer_id',      ${actor.customerId ?? ''},      true),
        set_config('app.partner_id',       ${actor.partnerId ?? ''},       true),
        set_config('app.ip',               ${actor.ip ?? ''},              true),
        set_config('app.support_grant_id', ${actor.supportGrantId ?? ''},  true)
    `)

    /*
      The read trail — see `supportAccessLog`.

      Written here rather than at the call site for the same reason audit is a
      trigger rather than a helper: a support session that logs on eleven paths
      and not the twelfth is worse than one that does not log at all, because
      the gap is invisible.

      Inside the actor transaction, so it rolls back with whatever it was
      recording. An access that did not happen leaves no entry, and an entry
      always has the statements it covers committed alongside it.

      The insert is subject to the same policies as everything else; `0008`
      admits it for a support principal holding the matching grant, which also
      means a forged `app.support_grant_id` cannot write a plausible-looking
      row for a grant it does not hold.
    */
    if (actor.type === 'support' && actor.supportGrantId) {
      try {
        await tx.execute(sql`
          insert into support_access_log (grant_id, principal_id, action, ip)
          values (
            ${actor.supportGrantId}::uuid,
            ${actor.principalId}::uuid,
            ${actor.supportAction ?? null},
            ${actor.ip ?? null}
          )
        `)
      } catch (cause) {
        /*
          The grant is not live, and the session stops here.

          `support_access_log_insert` admits the row only when
          `app.is_support()` holds — which requires a grant that names this
          principal, is unrevoked and has not expired. So an expired or revoked
          grant cannot even open a session, which is the correct fail-closed
          behaviour and better than one that reads nothing and looks like an
          empty database.

          Rethrown with a sentence rather than the raw `42501`, because this is
          a state a support engineer reaches routinely — a grant lapses mid
          investigation — and "insufficient privilege" sends them to the wrong
          problem.
        */
        throw new SupportAccessError(
          'Support access is not active: the grant is expired, revoked, or does not name this principal.',
          { cause },
        )
      }
    }

    return fn(tx as Tx)
  })
}

/**
 * A support session that could not be opened.
 *
 * Named so a caller can tell "your access has lapsed" — which is routine and
 * has an obvious remedy — from a genuine database fault, which does not.
 */
export class SupportAccessError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'SupportAccessError'
  }
}

/**
 * A support actor, which is only ever assembled from a grant.
 *
 * There is deliberately no way to construct one without a grant id: the
 * signature is the enforcement, so a call site cannot accidentally produce a
 * support principal that the policies would then have to reject.
 */
export function supportActor(params: {
  principalId: string
  grantId: string
  branchIds?: readonly string[]
  action?: string | null
  ip?: string | null
}): Actor {
  return {
    principalId: params.principalId,
    type: 'support',
    branchIds: params.branchIds ?? [],
    customerId: null,
    partnerId: null,
    ip: params.ip ?? null,
    supportGrantId: params.grantId,
    supportAction: params.action ?? null,
  }
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
