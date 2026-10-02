/**
 * A credit note for part of an invoice — F9.
 *
 * A credit note used to reverse its whole invoice and nothing else: the
 * customer disputing one line of five, or owed a goodwill reduction, could
 * only be credited everything and re-invoiced the rest, which consumed two
 * statutory numbers and confused every statement in between.
 *
 * The note is the invoice's own lines scaled by one ratio — the amount
 * credited over the invoice's total — rather than one line of its own. That
 * is what keeps the accounting export right without it knowing partial
 * credit exists: each scaled line reverses revenue on the account its
 * original posted to, and the tax line reverses in the same proportion the
 * tax was charged. The engine (`accounting.ts`) already reverses any note
 * line by line; it is handed lines that sum to the amount, and nothing else.
 *
 * Each figure is rounded to the currency, and whatever the rounding leaves
 * over goes onto the largest line's net amount, so the note's total is the
 * amount typed to the last fils. The tax stays at its own rounded share: the
 * residual is at most a few minor units and moving it onto the tax would
 * state a tax figure the rate did not produce.
 */

import type { Decimal } from 'decimal.js'
import { D, dec, money, round, type CurrencySpec, type Numeric } from './money'

export interface CreditableInvoice {
  readonly subtotal: Numeric
  readonly taxAmount: Numeric
  readonly total: Numeric
  readonly amountPaid: Numeric
  readonly amountCredited: Numeric
  readonly lines: readonly { readonly amount: Numeric; readonly taxAmount: Numeric }[]
}

export interface CreditNotePlan {
  /** One per invoice line, in the same order. Strings, for `numeric` columns. */
  readonly lines: readonly { readonly amount: string; readonly taxAmount: string }[]
  readonly subtotal: string
  readonly taxAmount: string
  readonly total: string
  /** Whether this note leaves nothing owed on the invoice — `credited`. */
  readonly closes: boolean
}

export type CreditNoteRefusal = 'not_positive' | 'too_precise' | 'exceeds_creditable'

/**
 * What can still be credited: what is still owed.
 *
 * Not the total less earlier notes. Crediting money the customer has already
 * paid is a refund, which this platform does not issue — and a balance below
 * zero would read in ageing and the credit exposure as the customer being
 * owed, with nothing anywhere to settle it.
 */
export function creditableAmount(invoice: CreditableInvoice): Decimal {
  const left = dec(invoice.total).minus(dec(invoice.amountPaid)).minus(dec(invoice.amountCredited))
  return left.isNegative() ? new D(0) : left
}

export function planCreditNote(
  invoice: CreditableInvoice,
  amount: Numeric,
  spec: CurrencySpec,
):
  | { readonly ok: true; readonly plan: CreditNotePlan }
  | { readonly ok: false; readonly reason: CreditNoteRefusal; readonly creditable: string } {
  const credit = dec(amount)
  const creditable = creditableAmount(invoice)
  const refuse = (reason: CreditNoteRefusal) =>
    ({ ok: false, reason, creditable: creditable.toFixed(spec.minorUnits) }) as const

  if (!credit.greaterThan(0)) return refuse('not_positive')
  // 1.2345 KWD is not an amount anyone can be credited.
  if (credit.decimalPlaces() > spec.minorUnits) return refuse('too_precise')
  if (credit.greaterThan(creditable)) return refuse('exceeds_creditable')

  const total = dec(invoice.total)
  const ratio = credit.dividedBy(total)
  const scale = (value: Numeric): Decimal =>
    round(money(dec(value).times(ratio), spec.code), spec).amount

  let lines = invoice.lines.map((line) => ({
    amount: scale(line.amount),
    taxAmount: scale(line.taxAmount),
  }))

  let subtotal: Decimal
  let tax: Decimal
  if (lines.length === 0) {
    // A header with no lines — an opening balance imported at cutover. The
    // same proportion, on the header alone.
    tax = scale(invoice.taxAmount)
    subtotal = credit.minus(tax)
  } else {
    const sum = lines.reduce((acc, l) => acc.plus(l.amount).plus(l.taxAmount), new D(0))
    const residual = credit.minus(sum)
    if (!residual.isZero()) {
      const largest = lines.reduce(
        (best, line, index) =>
          line.amount.abs().greaterThan(lines[best]!.amount.abs()) ? index : best,
        0,
      )
      lines = lines.map((line, index) =>
        index === largest ? { ...line, amount: line.amount.plus(residual) } : line,
      )
    }
    subtotal = lines.reduce((acc, l) => acc.plus(l.amount), new D(0))
    tax = lines.reduce((acc, l) => acc.plus(l.taxAmount), new D(0))
  }

  return {
    ok: true,
    plan: {
      lines: lines.map((l) => ({ amount: l.amount.toFixed(), taxAmount: l.taxAmount.toFixed() })),
      subtotal: subtotal.toFixed(),
      taxAmount: tax.toFixed(),
      total: credit.toFixed(),
      closes: credit.equals(creditable),
    },
  }
}
