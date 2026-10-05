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
import { allPermissionKeys } from '@qabandi/core'
import { usePilotFixtures, useDemoLogin } from '@/lib/pilot/source'
import { demoSession } from '@/lib/pilot/demo'
import { DEFAULT_TIME_ZONE, resolveTimeZone } from '@/lib/time'
import { clientAddressFrom } from '@/lib/client-address'
import { getBrand } from '@/lib/brand'
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
    /** The zone this principal reads dates in — `lib/time.ts`. */
    readonly timezone: string
  }
  /**
   * Permission keys across every branch the principal holds a role in.
   *
   * Pooled, so it answers "may this person do X *anywhere*" — which is the
   * right question for what a navigation offers, and the wrong one for a write
   * against a particular branch's record. Those ask `canIn` (`permissions.ts`),
   * which reads `branchPermissions` below.
   */
  readonly permissions: ReadonlySet<string>
  /** Roles per branch — FR-ID-02. The same user is not the same everywhere. */
  readonly branchRoles: ReadonlyMap<string, string>
  /**
   * Permission keys per branch — FR-ID-02, A2.
   *
   * Optional only so that a session built by hand (the unit tests' harnesses,
   * which hold one role everywhere) need not restate it; `canIn` then reads
   * `permissions` for every branch in `branchRoles`, which is what such a
   * session means. Every session resolved from a database sets it.
   */
  readonly branchPermissions?: ReadonlyMap<string, ReadonlySet<string>>
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
 *
 * The demo login's operations persona *is* this object rather than a copy of
 * it (`lib/pilot/demo.ts`), which is why the two cannot drift. The one thing
 * restated over there is the address below, because the sign-in panel has to
 * print it before there is a session to read it from.
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
    /*
      `.example` is reserved (RFC 2606) and cannot be registered, which is the
      point: this address is printed on the demo sign-in screen, so it is read
      by prospects rather than only by tests. It comes from the brand
      (`operations@<key>.example`), because a fixed one printed the supplier's
      domain on the client's demo, and before that the client's on the
      supplier's.
    */
    email: getBrand().demo.operationsEmail,
    locale: 'en',
    timezone: DEFAULT_TIME_ZONE,
  },
  // `allPermissionKeys()`, not `permissionKeys()`. The latter returns only the
  // keys the state machines reference, so this principal held every
  // operational permission and no administrative one — and `/settings/*`,
  // whose layout redirects when a principal can open no area at all, bounced
  // straight back to the dashboard in every fixture-backed deployment.
  permissions: new Set(allPermissionKeys()),
  branchRoles: new Map([
    ['00000000-0000-7000-8000-0000000000b1', 'operations_manager'],
    ['00000000-0000-7000-8000-0000000000b2', 'operations_manager'],
  ]),
  requiresTwoFactor: false,
}

export const getSession = cache(async (): Promise<Session | null> => {
  if (usePilotFixtures()) {
    /*
      The public demo asks who you are — `QABANDI_DEMO_LOGIN=1`, off by
      default, `lib/pilot/demo.ts`.

      The whole of the change is this one branch, and the ordering is the
      point: with the flag unset the line below runs exactly as it always has,
      which is what the offline end-to-end suite and every
      `QABANDI_PILOT_FIXTURES=1 pnpm dev` depend on. With it set, no cookie
      means no session, and the shells send the visitor to `/sign-in` as they
      already do for anyone signed out.
    */
    if (useDemoLogin()) return await demoSession(PILOT_SESSION)
    return PILOT_SESSION
  }

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
        timezone: principals.timezone,
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
      // Revoked grants are filtered here rather than at the call sites, so a
      // revocation takes effect everywhere on the principal's next request —
      // including in the RLS branch list the actor carries (FR-ID-08).
      .where(
        and(
          eq(principalBranchRoles.principalId, row.principalId),
          eq(principalBranchRoles.isActive, true),
        ),
      )

    const branchRoles = new Map<string, string>()
    const permissions = new Set<string>()
    const branchPermissions = new Map<string, Set<string>>()
    let requiresTwoFactor = false

    for (const r of branchRoleRows) {
      branchRoles.set(r.branchId, r.roleKey)
      if (r.requiresTwoFactor) requiresTwoFactor = true
      let inBranch = branchPermissions.get(r.branchId)
      if (!inBranch) branchPermissions.set(r.branchId, (inBranch = new Set()))
      if (r.permissionKey && r.allowed) {
        permissions.add(r.permissionKey)
        inBranch.add(r.permissionKey)
      }
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
        // Resolved rather than trusted: tzdata drops zones, and a principal
        // carrying one the runtime no longer knows must read dates in the
        // default rather than throw on every page.
        timezone: resolveTimeZone(row.timezone),
      },
      permissions,
      branchRoles,
      branchPermissions,
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
 * Where a signed-in principal belongs.
 *
 * Four audiences are served as four route groups (§3), and each shell already
 * bounces the wrong actor to the right place. This states that mapping once so
 * the *entry* points agree with the shells — the root redirect and the sign-in
 * guard both need it, and a copy of it in each is how they drift apart.
 */
export function homeFor(session: Session): '/dashboard' | '/portal' | '/agent' {
  switch (session.actor.type) {
    case 'customer_contact':
      return '/portal'
    case 'agent_contact':
      return '/agent'
    default:
      return '/dashboard'
  }
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
 * There are *two* names, not one. `advanced.useSecureCookies` is on in
 * production, and Better Auth does not merely add the `Secure` attribute when
 * it is — it renames the cookie to `__Secure-qabandi.session_token`, because
 * the `__Secure-` prefix is what makes a browser refuse the cookie over plain
 * HTTP (`createCookieGetter` in `better-auth/cookies`). So the name differs
 * between a developer's laptop and every deployed environment, and reading only
 * the unprefixed one meant sign-in worked locally and produced an endless
 * bounce back to the login form on the container — the session cookie was set,
 * correctly, under a name nothing here looked at.
 *
 * Both are checked, prefixed first, which is exactly what Better Auth's own
 * `getSessionCookie` does. Deriving the name from the auth instance instead
 * would be tighter still, but `$context` is not in the public typings.
 *
 * The value is `<token>.<signature>`. Only the token half is stored in
 * `auth_session.token`, so the signature has to come off before the lookup.
 * Better Auth has already verified that signature in its own middleware; the
 * check that matters here is that the token still resolves to an unexpired row,
 * which is the query below.
 */
const SESSION_COOKIE = 'qabandi.session_token'
const SESSION_COOKIE_NAMES = [`__Secure-${SESSION_COOKIE}`, SESSION_COOKIE] as const

async function sessionToken(): Promise<string | null> {
  const store = await cookies()

  for (const name of SESSION_COOKIE_NAMES) {
    const raw = store.get(name)?.value
    if (!raw) continue

    const token = raw.split('.')[0]
    if (token) return token
  }

  return null
}

/** The audit trail's address — `lib/client-address.ts` says which entry and why. */
async function clientIp(): Promise<string | null> {
  return clientAddressFrom(await headers())
}
