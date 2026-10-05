/**
 * Who on the staff hears about an internal event — run 5, R12.
 *
 * ## What this replaced
 *
 * Every internal event went to every active member of staff in the branch,
 * by email and in the bell, whatever their role. Run 5 had 49 staff in Kuwait
 * and one email enquiry produced 98 deliveries: finance, read-only logins,
 * the customs broker and forty load-test coordinators were all told a new
 * enquiry needed an owner. At a hundred staff that is two hundred messages per
 * enquiry, and a mailbox that teaches everyone to ignore the product's mail is
 * worse than none.
 *
 * ## The rule
 *
 * 1. **The person the record belongs to.** An enquiry's owner, or a job's,
 *    where the event is about one and it has an owner who still works in the
 *    branch. That person, and nobody else.
 * 2. **Otherwise, the roles responsible for that kind of event.** Enquiries
 *    and quotes go to operations management and sales, who triage the queue
 *    and answer for the customer; shipment alarms to operations management;
 *    supplier money to finance. Declared below as data, one line per event.
 * 3. **Otherwise, the branch's administrators**, so a branch that has no one
 *    in the responsible role still hears.
 * 4. **Otherwise, everyone in the branch**, as before. An alarm addressed to
 *    nobody is a lost alarm, and a small office whose staff all hold custom
 *    roles must not go silent because the names do not match.
 *
 * An escalation (`escalate: true`, the SLA breach) goes to the owner *and*
 * the responsible roles: telling only the person who is late defeats it.
 *
 * Roles are named by key rather than by permission because "who should be
 * told" is not a capability: an administrator holds every permission, and
 * routing by permission would send them every alarm in the company. The seven
 * role keys are system rows (`roles.is_system`), stable across deployments.
 *
 * ## Groups, for the person's own email preference
 *
 * Each event belongs to one group, and a member of staff can turn email off
 * per group (`principals.notification_email_opt_outs`). The bell is always
 * on: an in-app alert costs nobody an inbox, and it is how a person who has
 * muted email still finds out.
 */

import { notificationEvent } from './notifications'

/** The groups a person can mute email for. Order is the order the screen lists them. */
export const STAFF_NOTIFICATION_GROUPS = [
  'enquiries',
  'quotes',
  'operations',
  'rates',
  'suppliers',
  'finance',
  'admin',
] as const

export type StaffNotificationGroup = (typeof STAFF_NOTIFICATION_GROUPS)[number]

export function isStaffNotificationGroup(value: unknown): value is StaffNotificationGroup {
  return STAFF_NOTIFICATION_GROUPS.includes(value as StaffNotificationGroup)
}

export interface StaffRouting {
  readonly group: StaffNotificationGroup
  /** Which record's owner the event concerns, if any. */
  readonly owner: 'enquiry' | 'job' | null
  /** Role keys told when there is no owner (or always, with `escalate`). */
  readonly roles: readonly string[]
  /** Tell the roles as well as the owner. */
  readonly escalate?: boolean
}

const SALES_DESK = ['operations_manager', 'sales'] as const

/**
 * One line per internal event. `test/staff-notifications.test.ts` fails if an
 * internal event is declared in `notifications.ts` without one here.
 */
export const STAFF_ROUTING: Readonly<Record<string, StaffRouting>> = {
  'enquiry.created': { group: 'enquiries', owner: 'enquiry', roles: SALES_DESK },
  'enquiry.sla_breached': {
    group: 'enquiries',
    owner: 'enquiry',
    roles: SALES_DESK,
    escalate: true,
  },
  'intake.handoff': { group: 'enquiries', owner: 'enquiry', roles: SALES_DESK },
  'quote.accepted': { group: 'quotes', owner: 'enquiry', roles: SALES_DESK },
  'quote.declined': { group: 'quotes', owner: 'enquiry', roles: SALES_DESK },
  'free_time.expiring': { group: 'operations', owner: 'job', roles: ['operations_manager'] },
  'exception.opened': { group: 'operations', owner: 'job', roles: ['operations_manager'] },
  'rate_card.expiring': { group: 'rates', owner: null, roles: ['operations_manager'] },
  'rate_request.late_reply': { group: 'rates', owner: 'enquiry', roles: SALES_DESK },
  /*
    Supplier mail with no bill in it is as often a statement of account as an
    operational note, so both desks that deal with suppliers hear of it.
  */
  'partner.mail_filed': {
    group: 'suppliers',
    owner: null,
    roles: ['operations_manager', 'finance'],
  },
  /*
    Not the job owner, although the event names a job: a supplier billing over
    accrual is money about to leave, and the person who queries it before it is
    approved is finance.
  */
  'supplier_invoice.variance_flagged': { group: 'finance', owner: null, roles: ['finance'] },
}

/** The routing for an internal event, or null for a customer event or an unknown key. */
export function staffRouting(eventKey: string): StaffRouting | null {
  const declared = notificationEvent(eventKey)
  if (!declared || declared.audience !== 'internal') return null
  return STAFF_ROUTING[eventKey] ?? null
}

/** One member of staff of the event's branch, as the dispatcher reads them. */
export interface StaffCandidate {
  readonly principalId: string
  /** Their role key in the event's branch. */
  readonly roleKey: string
}

/**
 * The principal ids to tell, by the ladder in the header.
 *
 * `ownerId` is the owner of the record the event names, if any; it counts
 * only when that person is among `candidates` (active, internal, holding a
 * role in this branch). An event with no routing declared reaches everyone,
 * the old behaviour, rather than nobody.
 */
export function staffAudience(
  eventKey: string,
  candidates: readonly StaffCandidate[],
  ownerId: string | null,
): string[] {
  const routing = staffRouting(eventKey)
  const everyone = [...new Set(candidates.map((c) => c.principalId))]
  if (!routing) return everyone

  const owner =
    routing.owner && ownerId && candidates.some((c) => c.principalId === ownerId) ? ownerId : null
  const responsible = [
    ...new Set(
      candidates.filter((c) => routing.roles.includes(c.roleKey)).map((c) => c.principalId),
    ),
  ]

  if (owner && !routing.escalate) return [owner]
  if (owner) return [...new Set([owner, ...responsible])]
  if (responsible.length > 0) return responsible

  const administrators = [
    ...new Set(candidates.filter((c) => c.roleKey === 'administrator').map((c) => c.principalId)),
  ]
  if (administrators.length > 0) return administrators
  return everyone
}

/** Whether this person has turned off email for the event's group. In-app is never muted. */
export function staffEmailMuted(eventKey: string, optOuts: readonly string[]): boolean {
  const routing = staffRouting(eventKey)
  return routing !== null && optOuts.includes(routing.group)
}

/**
 * The groups some event actually routes to, in screen order. `admin` is
 * declared for the administration events to come and has none yet, and a
 * switch that governs nothing is a switch somebody reports as broken.
 */
export function staffGroupsInUse(): StaffNotificationGroup[] {
  const used = new Set(Object.values(STAFF_ROUTING).map((routing) => routing.group))
  return STAFF_NOTIFICATION_GROUPS.filter((group) => used.has(group))
}
