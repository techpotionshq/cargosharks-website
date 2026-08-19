/**
 * The agent current account — statement, ageing, and the monthly net.
 *
 * An overseas agent is not a supplier and not a customer. They are both, on
 * the same shipments, in the same month: we owe them destination charges on
 * our exports and they owe us destination charges on their imports, and once a
 * month somebody works out which way the money goes. Run as two independent
 * ledgers, that reconciliation is a spreadsheet emailed back and forth, and it
 * is where the disagreements live.
 *
 * ## Why one balance and not two
 *
 * A receivable of 4,000 and a payable of 3,600 is not a company that is owed
 * 4,000 and owes 3,600. It is a company that is owed 400 and has 3,600 of
 * mutual exposure that never needs to move through a bank. Reporting the gross
 * pair is technically true and operationally useless — it overstates both
 * sides of the balance sheet and invites two transfers where one belongs.
 *
 * ## Why the offset is the smaller of the two, always
 *
 * Netting can only extinguish what both sides actually owe. Offsetting more
 * than the smaller balance would create a debit balance on a payable, which is
 * an asset dressed as a liability and reads as a supplier who owes us money
 * for no reason anyone can trace. The residual carries the direction.
 *
 * ## Why one currency
 *
 * A netting agreement is denominated. Netting a USD payable against a KWD
 * receivable at a rate chosen on the day of settlement is a currency trade,
 * not a set-off, and both parties have to agree the rate before it is one.
 * Mixed input throws — the caller converts at the agreed rate, on purpose, and
 * records it.
 */

import { abs, compare, dec, isZero, money, subtract, sum, zero } from './money'
import type { CurrencyCode, Money, Numeric } from './money'
import { DomainError } from './errors'

export class NettingError extends DomainError {
  constructor(code: string, message: string) {
    super(code, message)
  }
}

// --- the statement ---------------------------------------------------------

/**
 * What a line of the statement is.
 *
 * Named from our side of the relationship, which is the side reading it:
 * `invoice` is one we raised on them, `bill` is one they raised on us.
 * Deliberately not `debit`/`credit` as the primary vocabulary — an operations
 * manager reads this screen, and half of them will read a credit as money
 * arriving.
 */
export type StatementKind = 'invoice' | 'credit_note' | 'receipt' | 'bill' | 'payment' | 'offset'

/**
 * Which way each kind moves the balance. `+1` is they-owe-us.
 *
 * `offset` is zero, and that is the interesting entry: a set-off clears equal
 * and opposite documents, so it moves the *net* balance by nothing at all.
 */
const SIGN: Record<StatementKind, number> = {
  invoice: 1,
  credit_note: -1,
  receipt: -1,
  bill: -1,
  payment: 1,
  offset: 0,
}

export interface StatementEntry {
  readonly id: string
  readonly kind: StatementKind
  readonly date: Date
  readonly reference: string
  readonly description: string
  /** Face value, always positive. The kind carries the direction. */
  readonly amount: Numeric
  /** What is still open on it — drives the ageing, not the balance. */
  readonly outstanding?: Numeric
  readonly dueOn?: Date | null
}

export interface StatementLine extends StatementEntry {
  /** They-owe-us, positive. Negative means we owe them. */
  readonly balance: Money
  readonly signedAmount: Money
}

export interface Statement {
  readonly currency: CurrencyCode
  readonly lines: readonly StatementLine[]
  /** Everything they owe us that is still open. */
  readonly receivable: Money
  /** Everything we owe them that is still open. */
  readonly payable: Money
  /** Receivable minus payable — the number the relationship turns on. */
  readonly closing: Money
}

/**
 * The running balance, oldest first.
 *
 * Sorted here rather than trusted from the caller. A statement whose running
 * balance is computed in one order and displayed in another is worse than one
 * with no running balance at all, and the sort is one line.
 *
 * A set-off still earns a line even though it moves nothing: it explains why
 * two documents stopped being outstanding, and a statement that shows them
 * vanishing without a reason is one nobody signs.
 */
export function buildStatement(
  entries: readonly StatementEntry[],
  currency: CurrencyCode,
): Statement {
  const ordered = [...entries].sort((a, b) => a.date.getTime() - b.date.getTime())

  let running = zero(currency)
  const lines: StatementLine[] = ordered.map((entry) => {
    const signed =
      entry.kind === 'offset'
        ? zero(currency)
        : money(dec(entry.amount).times(SIGN[entry.kind]), currency)
    running = { amount: running.amount.plus(signed.amount), currency }
    return { ...entry, signedAmount: signed, balance: running }
  })

  const openOf = (kinds: readonly StatementKind[]): Money =>
    sum(
      ordered
        .filter((e) => kinds.includes(e.kind))
        .map((e) => money(e.outstanding ?? e.amount, currency)),
      currency,
    )

  const receivable = subtract(openOf(['invoice']), openOf(['credit_note']))
  const payable = openOf(['bill'])

  return { currency, lines, receivable, payable, closing: subtract(receivable, payable) }
}

// --- the net ---------------------------------------------------------------

export type NetDirection = 'they_owe_us' | 'we_owe_them' | 'square'

export interface NetPosition {
  readonly currency: CurrencyCode
  readonly receivable: Money
  readonly payable: Money
  /** What set-off extinguishes on both sides — the smaller of the two. */
  readonly offset: Money
  /** What is left after the set-off, always positive. */
  readonly residual: Money
  readonly direction: NetDirection
}

/**
 * The month's position, and what actually has to move.
 *
 * Both figures must be positive. A negative receivable is a credit balance and
 * is a real thing — an agent in credit with us — but it arrives here as the
 * *payable* side, because that is what it is. Accepting a negative would let a
 * sign error at the query pass silently into a settlement statement, and the
 * only place it would surface is a bank transfer in the wrong direction.
 */
export function netPosition(
  receivable: Money,
  payable: Money,
  currency: CurrencyCode,
): NetPosition {
  if (receivable.currency !== currency || payable.currency !== currency) {
    throw new NettingError(
      'netting_currency_mismatch',
      'A set-off is denominated. Convert both sides at the agreed rate before netting them.',
    )
  }
  if (dec(receivable.amount).isNegative() || dec(payable.amount).isNegative()) {
    throw new NettingError(
      'netting_negative_side',
      'Both sides of a set-off are positive balances. A credit balance belongs on the other side.',
    )
  }

  const offset = compare(receivable, payable) <= 0 ? receivable : payable
  const residual = abs(subtract(receivable, payable))

  return {
    currency,
    receivable,
    payable,
    offset,
    residual,
    direction: isZero(residual)
      ? 'square'
      : compare(receivable, payable) > 0
        ? 'they_owe_us'
        : 'we_owe_them',
  }
}

// --- ageing ----------------------------------------------------------------

/**
 * FR-FN-10's buckets, applied to either side of the account.
 *
 * The same function for receivables and payables, because the question is the
 * same one and asking it twice in two dialects is how the two answers end up
 * disagreeing about what "60 days" means. Here it means: due date more than
 * sixty and at most ninety days before the reference date. A document with no
 * due date is `current` until somebody sets one, rather than instantly overdue
 * — a missing term is a data gap, not a late payment.
 */
export interface AgeableItem {
  readonly outstanding: Numeric
  readonly dueOn?: Date | null
}

export interface Ageing {
  readonly current: Money
  readonly days30: Money
  readonly days60: Money
  readonly days90: Money
  readonly total: Money
}

const DAY_MS = 86_400_000

export function ageItems(
  items: readonly AgeableItem[],
  currency: CurrencyCode,
  asOf: Date,
): Ageing {
  const buckets: Money[] = [zero(currency), zero(currency), zero(currency), zero(currency)]

  for (const item of items) {
    const value = money(item.outstanding, currency)
    if (isZero(value)) continue

    const overdueDays = item.dueOn
      ? Math.floor((asOf.getTime() - item.dueOn.getTime()) / DAY_MS)
      : 0

    const index = overdueDays <= 0 ? 0 : overdueDays <= 30 ? 1 : overdueDays <= 60 ? 2 : 3
    buckets[index] = { amount: buckets[index]!.amount.plus(value.amount), currency }
  }

  return {
    current: buckets[0]!,
    days30: buckets[1]!,
    days60: buckets[2]!,
    days90: buckets[3]!,
    total: sum(buckets, currency),
  }
}
