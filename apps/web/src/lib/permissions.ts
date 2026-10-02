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
  /*
    Vendor access — who from the supplier's side can see this deployment's
    data, for how long, and what they opened.

    Gated on `admin.users.write` rather than a key of its own: granting an
    outsider access to the whole deployment is the same authority as granting a
    colleague access to a branch, and inventing a separate permission would let
    an operator hold one without the other — which is a distinction with no
    meaning and a matrix with an extra row nobody can explain.
  */
  { key: 'support', href: '/settings/support', permission: 'admin.users.write', icon: 'audit' },
  /*
    The wording every customer notification goes out in — FR-NT-03.

    On `admin.reference.write` rather than a key of its own, because it is the
    same authority as editing a charge type or an exception code: configuration
    an administrator changes without a release, which is the whole of FR-AD-03.
    A separate key would be a matrix row nobody could explain the difference of.
  */
  {
    key: 'notifications',
    href: '/settings/notifications',
    permission: 'admin.reference.write',
    icon: 'bell',
  },
  /*
    Read-only keys a customer's ERP integrates against — FR-AD-05.

    Its own key in the matrix, and it always was: `admin.api_keys.write` has
    been in `ADMIN_PERMISSIONS` since it was written and was checked nowhere,
    because there was no screen. Issuing an outsider a credential to this
    deployment's data is not the same authority as editing a charge type.
  */
  {
    key: 'apiKeys',
    href: '/settings/api-keys',
    permission: 'admin.api_keys.write',
    icon: 'globe',
  },
  /*
    The mailboxes the intake reads — FR-EQ-02, FR-AD-03.

    Its own key rather than `admin.reference.write`, and the difference is
    real: a charge type is a business rule, and this row is the password to a
    mailbox that in an office this size is usually somebody's whole account.
    An operations manager who should be able to add a port should not be able
    to point the enquiry intake at a mailbox of their choosing.
  */
  {
    key: 'mailboxes',
    href: '/settings/mailboxes',
    permission: 'admin.mailboxes.write',
    icon: 'enquiries',
  },
  /*
    The WhatsApp business numbers the intake answers on — FR-EQ-02, FR-AD-03.

    On `admin.mailboxes.write`, not a key of its own: it is the same authority as
    the mailboxes row above — pointing the enquiry intake at an inbound endpoint
    of one's choosing, per branch. An operator who should not be able to redirect
    the email intake should not be able to redirect the WhatsApp one either, and a
    separate key would be a matrix row with no distinction anyone could explain.
    Unlike mailboxes it carries no credential — the Kapso key is an integration.
  */
  {
    key: 'whatsappNumbers',
    href: '/settings/whatsapp-numbers',
    permission: 'admin.mailboxes.write',
    icon: 'enquiries',
  },
  /*
    How the intake agent behind those numbers and mailboxes answers — FR-EQ-02.

    On `admin.mailboxes.write` for the same reason the WhatsApp numbers are: it
    is the next step of one decision, per branch — which doors feed this
    branch's board, and what the agent behind them says to its customers.
  */
  {
    key: 'intakeAgent',
    href: '/settings/intake-agent',
    permission: 'admin.mailboxes.write',
    icon: 'assistant',
  },
  /*
    The credentials this deployment reaches its suppliers with — FR-AD-03.

    Its own key, and the strictest reasoning on this list. The mailbox entry
    above earns a separate permission because a row carries one office's
    credential; this one carries *every* office's, because
    `integration_settings` has no `branch_id` to narrow it. There is no such
    thing as changing the SMTP relay or the Maersk registration for Kuwait
    only, so the permission is the whole of the scoping — which is why the
    policy conditions on it rather than on the branch list every other
    configuration table narrows by.
  */
  {
    key: 'integrations',
    href: '/settings/integrations',
    permission: 'admin.integrations.write',
    icon: 'globe',
  },
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
 * Does the principal hold `permission` *in this branch* — FR-ID-02, A2.
 *
 * `can` pools every branch's permissions, so an administrator in Dubai who is
 * read-only in Kuwait "can" `admin.users.write`, and `inBranch` only says they
 * hold *some* role in Kuwait. Together they let that person make themselves
 * administrator in Kuwait. A write against a branch's record asks this
 * instead, and `app.has_permission_in` is the same question in the database.
 *
 * A session with no `branchPermissions` was built by hand with one role
 * everywhere (see the field's comment in `session.ts`), so the pooled set is
 * that role's set in every branch it names.
 */
export function canIn(session: Session, permission: string, branchId: string): boolean {
  if (!session.branchRoles.has(branchId)) return false
  const scoped = session.branchPermissions
  if (!scoped) return session.permissions.has(permission)
  return scoped.get(branchId)?.has(permission) ?? false
}

export function assertCanIn(session: Session, permission: string, branchId: string): void {
  if (!canIn(session, permission, branchId)) {
    throw new ForbiddenError(`${permission}@branch:${branchId}`)
  }
}

/** The branches in which the principal holds `permission`, for pickers and filters. */
export function branchesWhere(session: Session, permission: string): string[] {
  return [...session.branchRoles.keys()].filter((id) => canIn(session, permission, id))
}

/**
 * A branch picker's options, narrowed to the branches this person may do the
 * form's work in — QA P2-4.
 *
 * Pickers listed every active branch, and the action's `assertCanIn` refused
 * the ones the person only reads, as a 500: a Kuwait finance user who could
 * see Dubai was offered Dubai on "New invoice" and crashed the form choosing
 * it. The list now asks the action's own question. A picker that ends up
 * empty is a dialog the caller should not render.
 */
export function permittedBranches<T extends { readonly value: string }>(
  session: Session,
  permission: string,
  choices: readonly T[],
): T[] {
  const allowed = new Set(branchesWhere(session, permission))
  return choices.filter((choice) => allowed.has(choice.value))
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
