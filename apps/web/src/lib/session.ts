/**
 * Session resolution — Architecture §5.2, §8.
 *
 * Turns a request into an `Actor`. This is the only place that happens, and
 * every database access in the application flows through the `Actor` it
 * produces. The session lookup, the principal lookup and the branch-role
 * lookup all happen inside the same transaction that sets the RLS context, so
 * the per-request cost of database-backed sessions is one round trip rather
 * than three.
 */

import { cache } from 'react'
import { headers } from 'next/headers'
import { and, eq, gt } from 'drizzle-orm'
import {
  authSession,
  principalBranchRoles,
  principals,
  rolePermissions,
  roles,
  withoutActor,
  type Actor,
} from '@qabandi/db'

export interface Session {
  readonly actor: Actor
  readonly principal: {
    readonly id: string
    readonly nameEn: string
    readonly nameAr: string | null
    readonly email: string
    readonly locale: 'en' | 'ar'
  }
  /** Permission keys across every branch the principal holds a role in. */
  readonly permissions: ReadonlySet<string>
  /** Roles per branch — FR-ID-02. The same user is not the same everywhere. */
  readonly branchRoles: ReadonlyMap<string, string>
  readonly requiresTwoFactor: boolean
}

/**
 * Resolved once per request. `cache` is React's per-request memo, not a shared
 * cache: two requests never see each other's session.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const token = await sessionToken()
  if (!token) return null

  /**
   * Deliberately un-actored: this *is* the query that establishes the actor.
   * It reads only `auth_session` and `principals`, both outside the branch
   * scoping shapes, and it is the single sanctioned use of `withoutActor` in
   * the web application.
   */
  return withoutActor(async (tx) => {
    const [row] = await tx
      .select({
        principalId: principals.id,
        nameEn: principals.nameEn,
        nameAr: principals.nameAr,
        email: principals.email,
        locale: principals.locale,
        type: principals.type,
        customerId: principals.customerId,
        partnerId: principals.partnerId,
        isActive: principals.isActive,
      })
      .from(authSession)
      .innerJoin(principals, eq(principals.authUserId, authSession.userId))
      .where(and(eq(authSession.token, token), gt(authSession.expiresAt, new Date())))
      .limit(1)

    // FR-ID-08 and FR-MD-03: revocation and deactivation take effect on the
    // next request, because the check is here rather than inside a token.
    if (!row || !row.isActive) return null

    const branchRoleRows = await tx
      .select({
        branchId: principalBranchRoles.branchId,
        roleKey: roles.key,
        requiresTwoFactor: roles.requiresTwoFactor,
        permissionKey: rolePermissions.permissionKey,
        allowed: rolePermissions.allowed,
      })
      .from(principalBranchRoles)
      .innerJoin(roles, eq(roles.id, principalBranchRoles.roleId))
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .where(eq(principalBranchRoles.principalId, row.principalId))

    const branchRoles = new Map<string, string>()
    const permissions = new Set<string>()
    let requiresTwoFactor = false

    for (const r of branchRoleRows) {
      branchRoles.set(r.branchId, r.roleKey)
      if (r.requiresTwoFactor) requiresTwoFactor = true
      if (r.permissionKey && r.allowed) permissions.add(r.permissionKey)
    }

    const actor: Actor = {
      principalId: row.principalId,
      type: row.type,
      branchIds: [...branchRoles.keys()],
      customerId: row.customerId,
      partnerId: row.partnerId,
      ip: await clientIp(),
    }

    return {
      actor,
      principal: {
        id: row.principalId,
        nameEn: row.nameEn,
        nameAr: row.nameAr,
        email: row.email,
        locale: row.locale,
      },
      permissions,
      branchRoles,
      requiresTwoFactor,
    }
  })
})

/** Throws where a page or action requires a signed-in principal. */
export async function requireSession(): Promise<Session> {
  const session = await getSession()
  if (!session) throw new Error('unauthenticated')
  return session
}

async function sessionToken(): Promise<string | null> {
  const store = await headers()
  const cookie = store.get('cookie')
  if (!cookie) return null
  const match = /(?:^|;\s*)qabandi\.session=([^;]+)/.exec(cookie)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

async function clientIp(): Promise<string | null> {
  const store = await headers()
  const forwarded = store.get('x-forwarded-for')
  return forwarded?.split(',')[0]?.trim() ?? null
}
