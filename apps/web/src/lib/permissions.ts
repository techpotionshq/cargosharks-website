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
