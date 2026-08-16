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
import { cookies, headers } from 'next/headers'
import { and, eq, gt } from 'drizzle-orm'
import { permissionKeys } from '@qabandi/core'
import { usePilotFixtures } from '@/lib/pilot/source'
import {
  authSession,
  principalBranchRoles,
  principals,
  rolePermissions,
  roles,
  systemActor,
  withActor,
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
/**
 * The pilot principal.
 *
 * The pilot environment runs before Better Auth has a user table to read
 * (Pilot §4 stands the environment up on day 1; identity lands on days 3–5),
 * and the day-15 rehearsal has to survive a room with no network. So when the
 * fixtures are in use, session resolution short-circuits to one internal
 * principal in both branches, holding every permission.
 *
 * It is gated by exactly the same predicate as the data, and that predicate
 * refuses to engage in production against a real database. There is no path
 * where this stands in for a real session on a deployment that has one.
 */
const PILOT_SESSION: Session = {
  actor: {
    principalId: '00000000-0000-7000-8000-0000000000a1',
    type: 'internal',
    branchIds: ['00000000-0000-7000-8000-0000000000b1', '00000000-0000-7000-8000-0000000000b2'],
    customerId: null,
    partnerId: null,
    ip: null,
  },
  principal: {
    id: '00000000-0000-7000-8000-0000000000a1',
    nameEn: 'Fahad Al-Rashid',
    nameAr: 'فهد الرشيد',
    email: 'operations@qabandi.local',
    locale: 'en',
  },
  permissions: new Set(permissionKeys()),
  branchRoles: new Map([
    ['00000000-0000-7000-8000-0000000000b1', 'operations_manager'],
    ['00000000-0000-7000-8000-0000000000b2', 'operations_manager'],
  ]),
  requiresTwoFactor: false,
}

export const getSession = cache(async (): Promise<Session | null> => {
  if (usePilotFixtures()) return PILOT_SESSION

  const token = await sessionToken()
  if (!token) return null

  /**
   * Run as the **system** principal — this *is* the query that establishes the
   * actor, so there is no principal to run it as yet.
   *
   * It used to be `withoutActor`, on the reasoning that `principals` sits
   * outside the branch-scoping shapes. That reasoning was wrong, and provably
   * so: `principals` is `FORCE ROW LEVEL SECURITY` and its policy opens with
   * `id = app.principal_id() OR app.is_system()`. With no settings stamped,
   * both are false, the join returned zero rows for every token, and **no user
   * could ever sign in** — a valid credential produced a session row and then
   * bounced straight back to the login form.
   *
   * The system actor satisfies `app.is_system()`. That is a real widening, so
   * it is worth being precise about why it is safe here: the query is keyed by
   * the session token, which is a bearer secret the caller must already hold,
   * and it selects a fixed projection of one principal. It does not accept a
   * caller-supplied principal id, so it cannot be steered into reading someone
   * else's row.
   */
  return withActor(systemActor(), async (tx) => {
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

/**
 * The Better Auth session cookie.
 *
 * `advanced.cookiePrefix` is `qabandi`, and Better Auth appends its own
 * `session_token` — so the cookie is `qabandi.session_token`, not
 * `qabandi.session`. Reading the wrong name meant a perfectly valid sign-in
 * produced no session at all, and every authenticated route bounced straight
 * back to the login form.
 *
 * The value is `<token>.<signature>`. Only the token half is stored in
 * `auth_session.token`, so the signature has to come off before the lookup.
 * Better Auth has already verified that signature in its own middleware; the
 * check that matters here is that the token still resolves to an unexpired row,
 * which is the query below.
 */
const SESSION_COOKIE = 'qabandi.session_token'

async function sessionToken(): Promise<string | null> {
  const store = await cookies()
  const raw = store.get(SESSION_COOKIE)?.value
  if (!raw) return null

  const token = raw.split('.')[0]
  return token ? token : null
}

async function clientIp(): Promise<string | null> {
  const store = await headers()
  const forwarded = store.get('x-forwarded-for')
  return forwarded?.split(',')[0]?.trim() ?? null
}
