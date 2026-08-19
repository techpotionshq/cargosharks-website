/**
 * Matching receipts against invoices — the two ceilings, and nothing else.
 *
 * A receipt settles one invoice or several; an invoice is settled by one
 * receipt or several. Both directions have a limit and they are different
 * limits:
 *
 *   **You cannot allocate more of a receipt than you received.** The customer
 *   sent 500; the sum of what it settles cannot exceed 500. Breaking this
 *   invents money — the ledger shows more collected than arrived, and the bank
 *   reconciliation is the place it surfaces, weeks later.
 *
 *   **You cannot settle an invoice by more than it is owed.** An invoice for
 *   120 cannot be settled by 130. Breaking this produces a negative balance
 *   that reads as a credit the customer does not have.
 *
 * ## Why this is in `core` and not next to the SQL
 *
 * It lived inline in the web layer's `allocate()`, written as
 *
 *     const value = Number(amount)
 *     if (value > Number(received) - Number(allocated)) throw …
 *
 * in a file whose own header says money is never parsed into a JavaScript
 * number on this path. The comparison is the whole rule, and a float is the
 * one representation that cannot be trusted to make it: an invoice of 8.700
 * with 8.600 already settled leaves 0.099999999999999645 by that arithmetic,
 * so the customer paying the last 100 fils is told it is more than they owe
 * and the invoice can never reach `paid`. The failure needs no concurrency, no
 * unusual data and no large numbers — three decimals is enough.
 *
 * Decimal comparison has no such case. Putting it here makes it a rule that is
 * tested in milliseconds against no infrastructure, rather than a line of
 * arithmetic buried between two SQL statements where nobody reads it.
 *
 * The *enforcement* stays in the caller's transaction, and must: the position
 * these functions judge has to be read in the same transaction as the insert,
 * or two people allocating the same receipt at once both pass a check that was
 * true when they read it. This decides; the transaction makes it hold.
 */

import { dec, fromDb, money, subtract } from './money'
import type { CurrencyCode, Money, Numeric } from './money'
import { DomainError } from './errors'

export class SettlementError extends DomainError {
  constructor(code: string, message: string) {
    super(code, message)
  }
}

/**
 * The four figures the decision turns on, as `numeric` hands them over.
 *
 * Strings, because that is what `numeric(19,6)` comes back as and the whole
 * point is that they are never anything else on the way here.
 */
export interface SettlementPosition {
  /** The receipt's face value. */
  readonly received: Numeric
  /** Already allocated from that receipt, across every invoice. */
  readonly allocated: Numeric
  /** The invoice's total. */
  readonly invoiced: Numeric
  /** Already settled against that invoice, from every receipt. */
  readonly settled: Numeric
}

/**
 * Why an allocation was refused.
 *
 * Two reasons rather than one because the operator's next action differs:
 * `over_allocated` means find another receipt, `over_invoiced` means find
 * another invoice.
 */
export type SettlementRefusal = 'over_allocated' | 'over_invoiced'

export type SettlementVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly reason: SettlementRefusal
      /** What was actually available, for a message that names a number. */
      readonly available: Money
    }

/** What is left of the receipt to allocate. */
export function unallocated(received: Numeric, allocated: Numeric, currency: CurrencyCode): Money {
  return subtract(money(received, currency), money(allocated, currency))
}

/** What is left outstanding on the invoice. */
export function outstanding(invoiced: Numeric, settled: Numeric, currency: CurrencyCode): Money {
  return subtract(money(invoiced, currency), money(settled, currency))
}

/**
 * May this amount be allocated from that receipt to that invoice?
 *
 * Both ceilings, checked exactly. Equality passes in both directions — paying
 * an invoice off to the fils is the *normal* case, and a check that rejects it
 * is worse than no check at all.
 */
export function checkSettlement(
  amount: Numeric,
  position: SettlementPosition,
  currency: CurrencyCode,
): SettlementVerdict {
  const value = dec(amount)

  if (value.isNegative() || value.isZero()) {
    throw new SettlementError(
      'settlement_amount_not_positive',
      'An allocation must be a positive amount.',
    )
  }

  const receiptLeft = unallocated(position.received, position.allocated, currency)
  if (value.greaterThan(receiptLeft.amount)) {
    return { ok: false, reason: 'over_allocated', available: receiptLeft }
  }

  const invoiceLeft = outstanding(position.invoiced, position.settled, currency)
  if (value.greaterThan(invoiceLeft.amount)) {
    return { ok: false, reason: 'over_invoiced', available: invoiceLeft }
  }

  return { ok: true }
}

/**
 * The position as the database reports it — nulls included.
 *
 * `sum(amount)` over no rows is `null`, not zero, and the first allocation
 * against any receipt is exactly that case. Coalescing at the edge rather than
 * in every caller is what stops one of them forgetting.
 */
export function positionFromDb(
  row: {
    readonly received: string | null
    readonly allocated: string | null
    readonly invoiced: string | null
    readonly settled: string | null
  },
  currency: CurrencyCode,
): SettlementPosition {
  return {
    received: fromDb(row.received, currency).amount,
    allocated: fromDb(row.allocated, currency).amount,
    invoiced: fromDb(row.invoiced, currency).amount,
    settled: fromDb(row.settled, currency).amount,
  }
}
