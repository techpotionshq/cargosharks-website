/**
 * Open support sessions — the customer-visible half of `0008_support_access`.
 *
 * The database enforces that support access is granted, scoped, time-boxed and
 * recorded. None of that is worth much if the operator has to go looking to
 * find out it is happening: the property being sold is *"you can see who from
 * our side is in your data, and take it away"*, and a permission the customer
 * has to audit for is not a permission they control.
 *
 * So this is read on every internal page load, memoised for the request, and
 * rendered as a banner rather than a settings screen nobody visits.
 */

import { cache } from 'react'
import { sql } from 'drizzle-orm'
import { withActor, type Actor } from '@qabandi/db'
import { usePilotFixtures } from '@/lib/pilot/source'

export interface OpenSupportSession {
  readonly id: string
  readonly engineer: string
  readonly reason: string
  readonly scope: 'read' | 'write'
  readonly expiresAt: Date
  /** Empty means the whole deployment, which the banner says out loud. */
  readonly branchCodes: readonly string[]
}

export const getOpenSupportSessions = cache(
  async (actor: Actor): Promise<readonly OpenSupportSession[]> => {
    // No database, no grants. The pilot environment has no support contract
    // running against it and should not imply one.
    if (usePilotFixtures()) return []

    return withActor(actor, async (tx) => {
      /*
        Branch codes are joined here rather than resolved in the component,
        because `branch_ids` is an array column and the alternative is a query
        per grant on a banner that renders on every page.

        `left join` on the unnested array: a grant with an empty array — the
        whole deployment — must still return its row, and an inner join would
        silently drop exactly the grant most worth showing.
      */
      const rows = await tx.execute(sql`
        select
          g.id::text                                  as id,
          p.name_en                                   as engineer,
          g.reason                                    as reason,
          g.scope::text                               as scope,
          g.expires_at                                as expires_at,
          coalesce(
            array_remove(array_agg(b.code order by b.code), null),
            '{}'
          )                                           as branch_codes
        from support_grants g
        join principals p on p.id = g.principal_id
        left join lateral unnest(g.branch_ids) as gb(branch_id) on true
        left join branches b on b.id = gb.branch_id
        where g.revoked_at is null
          and g.expires_at > now()
        group by g.id, p.name_en, g.reason, g.scope, g.expires_at
        order by g.expires_at
      `)

      return (
        rows.rows as unknown as {
          id: string
          engineer: string
          reason: string
          scope: 'read' | 'write'
          expires_at: string
          branch_codes: string[]
        }[]
      ).map((r) => ({
        id: r.id,
        engineer: r.engineer,
        reason: r.reason,
        scope: r.scope,
        /*
          `new Date(...)`, and it is not defensive padding.

          A `timestamptz` read through `tx.execute(sql`…`)` comes back as the
          driver's raw value — a string — not the `Date` the query builder
          would have produced. The declared type said `Date`, TypeScript
          believed it, and the first `.toISOString()` threw at render.

          It threw in the *layout*, so it took every internal screen down
          rather than one panel — the same failure shape as `getNavCounts`.
          Verifying these queries by printing their rows never caught it,
          because printing a value never calls a `Date` method.
        */
        expiresAt: new Date(r.expires_at),
        branchCodes: r.branch_codes ?? [],
      }))
    })
  },
)

/**
 * Withdraw a grant — FR-ID-08's shape, applied to us.
 *
 * `revoked_at` rather than a delete: `app_user` holds no DELETE anywhere
 * (§5.5), and a revocation that erases the record of access having been
 * granted is worse than no revocation at all. The write is gated by
 * `support_grants_write`, which requires `admin.users.write`, so a support
 * principal cannot renew or restore its own.
 */
export async function revokeSupportGrant(actor: Actor, grantId: string): Promise<void> {
  await withActor(actor, async (tx) => {
    await tx.execute(sql`
      update support_grants
         set revoked_at = now(), revoked_by_id = ${actor.principalId}::uuid
       where id = ${grantId}::uuid and revoked_at is null
    `)
  })
}

/**
 * Support engineers who can be granted access, for the picker.
 *
 * Only `support` principals. The grant form is not a way to give a staff
 * account a second route to the data, and the action refuses one anyway — this
 * is about not offering a choice that will be rejected.
 */
export async function supportEngineers(
  actor: Actor,
): Promise<{ id: string; nameEn: string; email: string }[]> {
  if (usePilotFixtures()) return []

  return withActor(actor, async (tx) => {
    const rows = await tx.execute(sql`
      select id::text as id, name_en, email
        from principals
       where type = 'support' and is_active
       order by name_en
    `)
    return (rows.rows as unknown as { id: string; name_en: string; email: string }[]).map((r) => ({
      id: r.id,
      nameEn: r.name_en,
      email: r.email,
    }))
  })
}

export interface SupportHistoryEntry {
  readonly id: string
  readonly engineer: string
  readonly reason: string
  readonly scope: 'read' | 'write'
  readonly grantedBy: string
  readonly createdAt: Date
  readonly expiresAt: Date
  readonly revokedAt: Date | null
  /** How many transactions were opened under it — the read trail, counted. */
  readonly accessCount: number
}

/**
 * Every grant ever issued against this deployment, with how much it was used.
 *
 * The count is the part worth showing. A grant that was never opened is
 * evidence that nobody looked; a grant with four hundred entries against a
 * one-line ticket is a question. Neither is visible from the grant row alone,
 * and the whole promise of `support_access_log` is that the customer can audit
 * us without asking us for the data.
 */
export async function supportHistory(
  actor: Actor,
  limit = 50,
): Promise<readonly SupportHistoryEntry[]> {
  if (usePilotFixtures()) return []

  return withActor(actor, async (tx) => {
    const rows = await tx.execute(sql`
      select
        g.id::text                                as id,
        p.name_en                                 as engineer,
        g.reason                                  as reason,
        g.scope::text                             as scope,
        granter.name_en                           as granted_by,
        g.created_at                              as created_at,
        g.expires_at                              as expires_at,
        g.revoked_at                              as revoked_at,
        (select count(*)::int from support_access_log l where l.grant_id = g.id) as access_count
      from support_grants g
      join principals p on p.id = g.principal_id
      join principals granter on granter.id = g.granted_by_id
      order by g.created_at desc
      limit ${limit}
    `)

    return (
      rows.rows as unknown as {
        id: string
        engineer: string
        reason: string
        scope: 'read' | 'write'
        granted_by: string
        created_at: string
        expires_at: string
        revoked_at: string | null
        access_count: number
      }[]
    ).map((r) => ({
      id: r.id,
      engineer: r.engineer,
      reason: r.reason,
      scope: r.scope,
      grantedBy: r.granted_by,
      // Raw SQL yields strings for `timestamptz` — see the note above.
      createdAt: new Date(r.created_at),
      expiresAt: new Date(r.expires_at),
      revokedAt: r.revoked_at === null ? null : new Date(r.revoked_at),
      accessCount: r.access_count,
    }))
  })
}
