/**
 * When is a bill late — one rule for every screen that says "overdue".
 *
 * The invoices register counted only `issued` invoices, while the finance KPI
 * and the customer portal also counted `part_paid` ones. A customer who had
 * paid half and was a month late read "overdue" in the portal and nothing in
 * the register an operator works from, and the register's filter count
 * disagreed with the rows it listed. Four copies of a rule drift; one does not.
 *
 * Overdue is a state *and* a date *and* a balance, which is why it is not a
 * status in the enum:
 *
 * - the document is still owed — sent and not settled, credited or voided;
 * - its due day has passed, compared as calendar days (`YYYY-MM-DD`) in the
 *   branch's zone, so the last day of terms is not late at any hour of it;
 * - something is still owing, compared as a `Decimal` because a balance of
 *   `'0.000000'` is a string and `'0.000000' > 0` is not a question a string
 *   can answer.
 *
 * SQL statements cannot call this, so they read the status lists below and
 * repeat the date and balance terms. The lists are the part that drifted.
 */

import { D, type Numeric } from './money'

/** Customer invoices that are still owed: sent and not yet settled. */
export const OWED_INVOICE_STATUSES = ['issued', 'part_paid'] as const

/** Supplier bills that are still owed: received or approved, or part paid. */
export const OWED_BILL_STATUSES = ['received', 'approved', 'part_paid'] as const

export interface OverdueCandidate {
  readonly status: string
  /** A calendar day, `YYYY-MM-DD`. A longer ISO string is read to its day. */
  readonly dueOn: string | null
  /** What is still owed. A string from the database or a `Decimal`. */
  readonly balance: Numeric
  /** A credit note is owed *to* the customer, so it is never late. */
  readonly isCreditNote?: boolean
}

/** Whether a calendar day is before `today`. Both are read as `YYYY-MM-DD`. */
export function isPastDay(dueOn: string | null | undefined, today: string): boolean {
  if (!dueOn) return false
  return dueOn.slice(0, 10) < today.slice(0, 10)
}

function late(candidate: OverdueCandidate, owed: readonly string[], today: string): boolean {
  return (
    candidate.isCreditNote !== true &&
    owed.includes(candidate.status) &&
    isPastDay(candidate.dueOn, today) &&
    new D(candidate.balance).greaterThan(0)
  )
}

/** A customer invoice past its due day with something still owed. */
export function isInvoiceOverdue(invoice: OverdueCandidate, today: string): boolean {
  return late(invoice, OWED_INVOICE_STATUSES, today)
}

/** A supplier bill past its due day with something still owed. */
export function isBillOverdue(bill: OverdueCandidate, today: string): boolean {
  return late(bill, OWED_BILL_STATUSES, today)
}
