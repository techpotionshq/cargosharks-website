/**
 * Allowed transitions for enquiry, quote, job, customs and invoice.
 *
 * Illegal transitions are rejected here, in `core`, not in the UI (§7.3). A
 * button that is hidden is not a control; a server action that calls
 * `assertTransition` is.
 *
 * Nothing is deleted (§5.5) — every machine below ends in a terminal status,
 * never in a removed row.
 */

import { IllegalTransitionError } from './errors'

export interface Transition<S extends string> {
  readonly from: S
  readonly to: S
  /** Permission key checked against `role_permissions` — FR-ID-03. */
  readonly requires?: string
  /** Shown on the audit trail and the activity feed. */
  readonly label: string
}

export interface Machine<S extends string> {
  readonly name: string
  readonly initial: S
  readonly states: readonly S[]
  readonly terminal: readonly S[]
  readonly transitions: readonly Transition<S>[]
}

function machine<S extends string>(m: Machine<S>): Machine<S> {
  return m
}

// --- enquiry (FR-EQ) -------------------------------------------------------

export type EnquiryStatus =
  'new' | 'assigned' | 'rating' | 'quoted' | 'won' | 'lost' | 'cancelled' | 'expired'

export const enquiryMachine = machine<EnquiryStatus>({
  name: 'enquiry',
  initial: 'new',
  states: ['new', 'assigned', 'rating', 'quoted', 'won', 'lost', 'cancelled', 'expired'],
  terminal: ['won', 'lost', 'cancelled', 'expired'],
  transitions: [
    { from: 'new', to: 'assigned', requires: 'enquiry.assign', label: 'Assigned to owner' },
    { from: 'new', to: 'cancelled', requires: 'enquiry.cancel', label: 'Cancelled' },
    { from: 'assigned', to: 'rating', requires: 'enquiry.rate', label: 'Rating started' },
    { from: 'assigned', to: 'assigned', requires: 'enquiry.assign', label: 'Reassigned' },
    { from: 'assigned', to: 'lost', requires: 'enquiry.close', label: 'Lost' },
    { from: 'assigned', to: 'cancelled', requires: 'enquiry.cancel', label: 'Cancelled' },
    { from: 'rating', to: 'quoted', requires: 'quote.send', label: 'Quoted' },
    { from: 'rating', to: 'lost', requires: 'enquiry.close', label: 'Lost' },
    { from: 'rating', to: 'cancelled', requires: 'enquiry.cancel', label: 'Cancelled' },
    // A revised quote returns the enquiry to rating rather than forking it.
    { from: 'quoted', to: 'rating', requires: 'quote.revise', label: 'Revision requested' },
    { from: 'quoted', to: 'won', requires: 'enquiry.close', label: 'Won' },
    { from: 'quoted', to: 'lost', requires: 'enquiry.close', label: 'Lost' },
    { from: 'quoted', to: 'expired', label: 'Quote validity expired' },
  ],
})

// --- quote (FR-RT-08) ------------------------------------------------------

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'superseded'

export const quoteMachine = machine<QuoteStatus>({
  name: 'quote',
  initial: 'draft',
  states: ['draft', 'sent', 'accepted', 'rejected', 'expired', 'superseded'],
  terminal: ['accepted', 'rejected', 'expired', 'superseded'],
  transitions: [
    { from: 'draft', to: 'sent', requires: 'quote.send', label: 'Sent to customer' },
    { from: 'draft', to: 'superseded', requires: 'quote.revise', label: 'Superseded by revision' },
    { from: 'sent', to: 'accepted', requires: 'quote.accept', label: 'Accepted' },
    { from: 'sent', to: 'rejected', requires: 'quote.reject', label: 'Rejected' },
    { from: 'sent', to: 'expired', label: 'Validity elapsed' },
    // Editing a quote never mutates it — a new version supersedes the old one.
    { from: 'sent', to: 'superseded', requires: 'quote.revise', label: 'Superseded by revision' },
  ],
})

// --- job (FR-JB) -----------------------------------------------------------

export type JobStatus =
  | 'draft'
  | 'booked'
  | 'in_transit'
  | 'arrived'
  | 'customs'
  | 'delivered'
  | 'completed'
  | 'closed'
  | 'on_hold'
  | 'cancelled'

export const jobMachine = machine<JobStatus>({
  name: 'job',
  initial: 'draft',
  states: [
    'draft',
    'booked',
    'in_transit',
    'arrived',
    'customs',
    'delivered',
    'completed',
    'closed',
    'on_hold',
    'cancelled',
  ],
  terminal: ['closed', 'cancelled'],
  transitions: [
    { from: 'draft', to: 'booked', requires: 'job.book', label: 'Booked' },
    { from: 'draft', to: 'cancelled', requires: 'job.cancel', label: 'Cancelled' },
    { from: 'booked', to: 'in_transit', requires: 'job.update', label: 'Departed' },
    { from: 'booked', to: 'on_hold', requires: 'job.hold', label: 'Placed on hold' },
    { from: 'booked', to: 'cancelled', requires: 'job.cancel', label: 'Cancelled' },
    { from: 'in_transit', to: 'arrived', requires: 'job.update', label: 'Arrived' },
    { from: 'in_transit', to: 'on_hold', requires: 'job.hold', label: 'Placed on hold' },
    { from: 'arrived', to: 'customs', requires: 'job.update', label: 'Entered clearance' },
    { from: 'arrived', to: 'delivered', requires: 'job.update', label: 'Delivered' },
    { from: 'customs', to: 'delivered', requires: 'job.update', label: 'Delivered' },
    { from: 'customs', to: 'on_hold', requires: 'job.hold', label: 'Placed on hold' },
    // Completion is operational; closure is financial and needs the P&L settled.
    {
      from: 'delivered',
      to: 'completed',
      requires: 'job.complete',
      label: 'Operationally complete',
    },
    { from: 'completed', to: 'closed', requires: 'job.close', label: 'Financially closed' },
    { from: 'on_hold', to: 'booked', requires: 'job.hold', label: 'Hold released' },
    { from: 'on_hold', to: 'in_transit', requires: 'job.hold', label: 'Hold released' },
    { from: 'on_hold', to: 'customs', requires: 'job.hold', label: 'Hold released' },
    { from: 'on_hold', to: 'cancelled', requires: 'job.cancel', label: 'Cancelled' },
  ],
})

// --- customs (FR-CS) -------------------------------------------------------

export type CustomsStatus =
  | 'not_started'
  | 'documents_pending'
  | 'declaration_filed'
  | 'assessed'
  | 'duty_paid'
  | 'inspection'
  | 'released'
  | 'held'

export const customsMachine = machine<CustomsStatus>({
  name: 'customs',
  initial: 'not_started',
  states: [
    'not_started',
    'documents_pending',
    'declaration_filed',
    'assessed',
    'duty_paid',
    'inspection',
    'released',
    'held',
  ],
  terminal: ['released'],
  transitions: [
    {
      from: 'not_started',
      to: 'documents_pending',
      requires: 'customs.update',
      label: 'Documents requested',
    },
    {
      from: 'documents_pending',
      to: 'declaration_filed',
      requires: 'customs.file',
      label: 'Declaration filed',
    },
    {
      from: 'declaration_filed',
      to: 'assessed',
      requires: 'customs.update',
      label: 'Duty assessed',
    },
    {
      from: 'declaration_filed',
      to: 'inspection',
      requires: 'customs.update',
      label: 'Selected for inspection',
    },
    { from: 'assessed', to: 'duty_paid', requires: 'customs.pay', label: 'Duty paid' },
    {
      from: 'assessed',
      to: 'inspection',
      requires: 'customs.update',
      label: 'Selected for inspection',
    },
    {
      from: 'duty_paid',
      to: 'inspection',
      requires: 'customs.update',
      label: 'Selected for inspection',
    },
    { from: 'duty_paid', to: 'released', requires: 'customs.update', label: 'Released' },
    {
      from: 'inspection',
      to: 'released',
      requires: 'customs.update',
      label: 'Released after inspection',
    },
    { from: 'inspection', to: 'held', requires: 'customs.update', label: 'Held by authority' },
    { from: 'held', to: 'inspection', requires: 'customs.update', label: 'Re-inspection' },
    { from: 'held', to: 'released', requires: 'customs.update', label: 'Released' },
    {
      from: 'documents_pending',
      to: 'held',
      requires: 'customs.update',
      label: 'Held by authority',
    },
  ],
})

// --- invoice (FR-FN) -------------------------------------------------------

export type InvoiceStatus =
  'draft' | 'approved' | 'issued' | 'part_paid' | 'paid' | 'credited' | 'void'

export const invoiceMachine = machine<InvoiceStatus>({
  name: 'invoice',
  initial: 'draft',
  states: ['draft', 'approved', 'issued', 'part_paid', 'paid', 'credited', 'void'],
  terminal: ['paid', 'credited', 'void'],
  transitions: [
    { from: 'draft', to: 'approved', requires: 'invoice.approve', label: 'Approved' },
    { from: 'draft', to: 'void', requires: 'invoice.void', label: 'Voided' },
    { from: 'approved', to: 'issued', requires: 'invoice.issue', label: 'Issued' },
    { from: 'approved', to: 'draft', requires: 'invoice.approve', label: 'Returned to draft' },
    { from: 'approved', to: 'void', requires: 'invoice.void', label: 'Voided' },
    { from: 'issued', to: 'part_paid', requires: 'payment.record', label: 'Part paid' },
    { from: 'issued', to: 'paid', requires: 'payment.record', label: 'Paid' },
    // An issued invoice is never edited or voided — it is credited (§5.5).
    { from: 'issued', to: 'credited', requires: 'invoice.credit', label: 'Credit note raised' },
    { from: 'part_paid', to: 'paid', requires: 'payment.record', label: 'Paid' },
    { from: 'part_paid', to: 'credited', requires: 'invoice.credit', label: 'Credit note raised' },
  ],
})

// --- the machinery ---------------------------------------------------------

export function transitionsFrom<S extends string>(m: Machine<S>, from: S): Transition<S>[] {
  return m.transitions.filter((t) => t.from === from)
}

export function nextStates<S extends string>(m: Machine<S>, from: S): S[] {
  return [...new Set(transitionsFrom(m, from).map((t) => t.to))]
}

export function findTransition<S extends string>(
  m: Machine<S>,
  from: S,
  to: S,
): Transition<S> | undefined {
  return m.transitions.find((t) => t.from === from && t.to === to)
}

export function canTransition<S extends string>(m: Machine<S>, from: S, to: S): boolean {
  return findTransition(m, from, to) !== undefined
}

export function isTerminal<S extends string>(m: Machine<S>, state: S): boolean {
  return m.terminal.includes(state)
}

/**
 * Throws unless the transition is allowed. Server actions call this before the
 * write; the database's status check constraint is the second line of defence.
 */
export function assertTransition<S extends string>(m: Machine<S>, from: S, to: S): Transition<S> {
  const transition = findTransition(m, from, to)
  if (!transition) throw new IllegalTransitionError(m.name, from, to)
  return transition
}

/**
 * The permission that *reaching* a state demands, wherever it is reached from.
 *
 * For the caller who knows both ends of the move, `assertTransition` returns
 * the transition and its `requires` is the exact answer. This exists for the
 * caller who does not: a form that sets a status without caring what the
 * status was, and — the case it was written for — the creation of a record
 * whose first status is chosen rather than transitioned into.
 *
 * `customs.file` and `customs.pay` were declared on the customs machine and
 * checked nowhere: the customs form asserted `customs.update` for every move,
 * so anyone who could correct a declaration number could also file the
 * declaration and clear the duty. Re-stating the mapping at the call site is
 * what let it drift in the first place, so it is derived here instead.
 *
 * ## Throws where the answer is ambiguous, rather than guessing
 *
 * If two paths into a state demand different permissions there is no single
 * answer, and the tempting fallbacks are both wrong: returning `undefined`
 * silently drops the check, and returning either one enforces a permission the
 * principal's actual path did not require. A machine written that way is a
 * machine whose caller must use `assertTransition`, and this says so loudly at
 * the moment it becomes true rather than at the moment somebody exploits it.
 */
export function entryPermission<S extends string>(m: Machine<S>, to: S): string | undefined {
  const required = new Set(m.transitions.filter((t) => t.to === to).map((t) => t.requires))
  if (required.size > 1) {
    throw new Error(
      `${m.name}: reaching "${to}" requires different permissions depending on where it is ` +
        `reached from (${[...required].map((r) => r ?? 'none').sort().join(', ')}). ` +
        'Use assertTransition, which knows the path taken.',
    )
  }
  return [...required][0]
}

/**
 * The transitions a principal holding `permissions` may take from `from` —
 * what the UI renders as available actions, derived rather than duplicated.
 */
export function permittedTransitions<S extends string>(
  m: Machine<S>,
  from: S,
  permissions: ReadonlySet<string>,
): Transition<S>[] {
  return transitionsFrom(m, from).filter((t) => !t.requires || permissions.has(t.requires))
}

/** Every permission key the machines reference — seeds `role_permissions`. */
export function permissionKeys(): string[] {
  const machines = [enquiryMachine, quoteMachine, jobMachine, customsMachine, invoiceMachine]
  const keys = new Set<string>()
  for (const m of machines) {
    for (const t of m.transitions) if (t.requires) keys.add(t.requires)
  }
  return [...keys].sort()
}

/**
 * The permissions that gate a *screen* rather than a state transition.
 *
 * These have no machine to derive them from — nothing transitions when an
 * administrator edits a branch — so they are declared. They lived as a private
 * list in `db/seed.ts`, which meant `permissionKeys()` was, despite its name,
 * only ever half the permissions in the system. Anything that reasoned about
 * "every permission" from `core` silently got the operational half and none of
 * the administrative one.
 *
 * That fault then happened a second time, inside the fix. `consol.write`,
 * `consol.allocate` and `document.generate` were enforced by `assertCan` and
 * granted per role in `db/seed.ts`, and never added here — so they existed
 * everywhere except the one list that defines "all of them". The consequence
 * is not a denied request that reads as a bug: the `administrator` role is
 * seeded from `allPermissionKeys()` and nothing else, so an administrator
 * simply never received them, and the button was absent rather than refused.
 * `scripts/check-permissions.mjs` now fails the build on a key enforced in the
 * application and missing from this file, because review does not catch it —
 * twice now.
 *
 * The comments are the separation of duties, and each is load-bearing:
 *
 * - `admin.branches.write` is its own key rather than folded into
 *   `admin.reference.write`, because a branch carries its base currency, its
 *   working calendar and its **statutory invoice series** — anyone who can add
 *   a port must not thereby be able to renumber the invoice sequence.
 * - `admin.brand.read` gates the whitelabel console, which lists the `BRAND_*`
 *   variables configuring the deployment. Nothing there is secret, but it is
 *   deployment surface.
 */
export const ADMIN_PERMISSIONS = [
  'admin.reference.write',
  /*
    Releasing a document is not a state transition, so no machine declares it.

    `documents.released_at` is the gate between "a draft is on the job" and
    "the customer has it" — the single most consequential one-click act in the
    product, because a draft bill of lading that reaches a consignee is a
    commercial problem that cannot be recalled. It needs a key of its own
    rather than riding on `job.update`, which every coordinator holds.
  */
  'document.release',
  /*
    Issuing is a second key, and not the same one as releasing.

    `document.release` is "the customer now has it"; `document.generate` is
    "these bytes are now the document" — it stores a rendered PDF, versions the
    copy before it and writes the `documents` row. They are adjacent and they
    are not the same act, which is why a coordinator holds both but the split
    survives: regenerating a bill of lading differently after release is the
    failure this pair exists to make visible.
  */
  'document.generate',
  'admin.audit.read',
  'admin.users.write',
  'admin.api_keys.write',
  /*
    Mailbox credentials — FR-EQ-02, FR-AD-03.

    Administrator-only, and not granted to the operations manager who holds
    most of the other configuration. The row carries the credential to a
    mailbox that is usually a real person's account, so the screen that edits
    it is a different kind of screen from the one that edits charge types.
  */
  'admin.mailboxes.write',
  'admin.branches.write',
  'admin.brand.read',
  'rate.card.write',
  'report.read',
  'job.read',
  'finance.export',
  'customer.write',
  'partner.write',
  /*
    The payables side — 0014, FR-FN-09.

    Three keys rather than one, and the split is the separation of duties a
    forwarder actually runs on:

      `payable.record`  capture what arrived, and match it against the accrual.
                        Operations work: the coordinator holding the file knows
                        which job the agent's line belongs to.
      `payable.approve` release it for payment, with the variance in front of
                        you. Finance's, and the whole reason the matching
                        screen exists — approving a bill that is 15% over its
                        accrual is a decision somebody has to own.
      `payable.pay`     move the money.

    Collapsing the first two would mean the person who entered the bill is the
    person who cleared it, which is the segregation failure an auditor asks
    about immediately after invoice issuance.
  */
  'payable.record',
  'payable.approve',
  'payable.pay',
  /*
    Consolidation, split in two — FR-CN.

    `consol.write` builds the master: open it, attach and detach houses, close
    it at the cut-off. That is operations' work, and the coordinator holding
    the file does it.

    `consol.allocate` splits the master's cost across those houses, which
    decides what twenty jobs cost and therefore what twenty margins are. It
    sits with the people who answer for the margin, on the same reasoning that
    puts `invoice.issue` with finance and `job.book` with operations — and it
    is why building the master and pricing it are not one key.
  */
  'consol.write',
  'consol.allocate',
  /*
    Netting an agent's account is neither of the above.

    A set-off changes what *both* sides owe without any money moving, so it
    cannot ride on `payable.pay` — and it touches receivables, which nobody on
    the payables path otherwise holds. It sits with the people who answer for
    the relationship, the same reasoning that put `consol.allocate` with the
    people who answer for the margin.
  */
  'settlement.run',
  /*
    Letting a customer trade past their credit limit.

    Its own key, and not `customer.write`, which is the one that would
    otherwise carry it. `customer.write` is master-data maintenance — a
    coordinator correcting an address holds it — and folding the credit
    exception into it would mean the person who can fix a phone number can
    release a shipment for a customer who is 40,000 down. The whole mechanism
    exists to make that a decision somebody owns, so the key has to be one
    somebody is deliberately given.

    Not finance's either, or not only. The manager who releases the container
    is the one who answers for the relationship, and in a five-branch forwarder
    that is the branch and operations manager as often as the accountant.
  */
  'credit.override',
] as const

/**
 * Every permission key in the system — machine-derived plus declared.
 *
 * This is what "an account holding everything" means, and the only correct
 * input to a seed of the full matrix or to a session that stands in for one.
 */
export function allPermissionKeys(): string[] {
  return [...new Set([...permissionKeys(), ...ADMIN_PERMISSIONS])].sort()
}
