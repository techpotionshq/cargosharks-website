/**
 * Permission checks — FR-ID-03.
 *
 * These decide what the interface *offers*. They are not the security
 * boundary: RLS is (§5.3), and `assertTransition` in `core` is the second
 * (§7.3). A permission check that is forgotten here hides a button; a policy
 * that is forgotten there leaks a branch. The asymmetry is deliberate, and it
 * is why the expensive guarantees live in the database.
 */

import type { Machine, Transition } from '@qabandi/core'
import { permittedTransitions } from '@qabandi/core'
import type { Session } from './session'

export class ForbiddenError extends Error {
  constructor(readonly permission: string) {
    super(`Missing permission: ${permission}`)
    this.name = 'ForbiddenError'
  }
}

export function can(session: Session, permission: string): boolean {
  return session.permissions.has(permission)
}

export function assertCan(session: Session, permission: string): void {
  if (!can(session, permission)) throw new ForbiddenError(permission)
}

/**
 * The keys that open the settings area, and the pages each one unlocks.
 *
 * Settings is a separate route group with its own shell (`app/(settings)`)
 * rather than a section of the operations sidebar. The split is not decoration:
 * these four screens configure the operator — who may sign in, what a branch
 * invoices as, what the product is called — and none of them move a shipment.
 * Mixing them into the same navigation as Shipments and Invoices meant an
 * operator scanned past "Audit log" forty times a day and an administrator hunted
 * for it among twenty operational links.
 *
 * Reference data deliberately stayed behind in operations. Adding a port when a
 * new lane opens is daily work for an operations manager, and putting it behind
 * an administration wall is how a system grows a free-text "Other" field that
 * swallows the data it was meant to structure.
 *
 * Order matters: it is the order of the settings navigation, and the first entry
 * a principal can see is where `/settings` sends them.
 */
export const SETTINGS_AREAS = [
  { key: 'users', href: '/settings/users', permission: 'admin.users.write', icon: 'users' },
  {
    key: 'branches',
    href: '/settings/branches',
    permission: 'admin.branches.write',
    icon: 'branches',
  },
  { key: 'audit', href: '/settings/audit', permission: 'admin.audit.read', icon: 'audit' },
  { key: 'brand', href: '/settings/brand', permission: 'admin.brand.read', icon: 'admin' },
] as const

export type SettingsArea = (typeof SETTINGS_AREAS)[number]

/** The settings pages this principal may open, in navigation order. */
export function settingsAreasFor(session: Session): SettingsArea[] {
  return SETTINGS_AREAS.filter((area) => can(session, area.permission))
}

/**
 * Whether to offer the settings entry point at all.
 *
 * A door that leads only to a redirect is worse than no door, so the link in
 * the operations sidebar renders on the same condition the layout admits on.
 */
export function canOpenSettings(session: Session): boolean {
  return SETTINGS_AREAS.some((area) => can(session, area.permission))
}

/** True where the principal holds any role in the branch — FR-ID-02. */
export function inBranch(session: Session, branchId: string): boolean {
  return session.branchRoles.has(branchId)
}

export function assertInBranch(session: Session, branchId: string): void {
  if (!inBranch(session, branchId)) throw new ForbiddenError(`branch:${branchId}`)
}

/**
 * The actions to render on a record, derived from the state machine rather
 * than restated in the component. A new transition appears in the interface by
 * virtue of existing in `core/states.ts`.
 */
export function availableActions<S extends string>(
  session: Session,
  machine: Machine<S>,
  from: S,
): Transition<S>[] {
  return permittedTransitions(machine, from, session.permissions)
}
