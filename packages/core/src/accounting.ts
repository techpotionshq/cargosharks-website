/**
 * Turning a period into journal entries — the last mile out of this system and
 * into the customer's ledger.
 *
 * Everything up to the invoice was automated and then somebody re-keyed the
 * month into Tally. That is the gap this closes, and the reason it is a pure
 * function with no database in sight is that a journal is the one artefact
 * where "we think it balances" is not an acceptable answer. It either balances
 * or the export refuses, and that judgement is testable in milliseconds
 * against no infrastructure.
 *
 * ## What posts
 *
 *   issued invoice   Dr receivables            at the invoice's own FX rate
 *                    Cr revenue, per charge type's mapped account
 *                    Cr output tax
 *   credit note      the same entry, reversed
 *   supplier cost    Dr expense, per charge type
 *                    Cr payables, per counterparty
 *   receipt          Dr bank
 *                    Cr receivables
 *                    Dr/Cr FX variance where the rate moved between the two
 *
 * ## Why every amount is in base currency
 *
 * A ledger is kept in one currency. A USD invoice in a KWD entity posts at the
 * rate captured on the charge line at pricing time (FR-RT-06) — never at
 * today's rate, which would make a June export of March's invoices disagree
 * with the March export of the same invoices. Both amounts travel on the line:
 * the base figure is what posts, the transaction figure is what the customer
 * sees, and an accountant needs to be able to see both to believe either.
 *
 * ## Why it refuses rather than guesses
 *
 * An unmapped charge type does not fall back to a suspense account. A missing
 * control account does not post to zero. Either would produce a journal that
 * imports cleanly and is wrong, discovered by a finance manager at year end.
 * The refusal names the row to fix.
 */

import { D, dec, equals, money, negate, round, subtract, sum, zero } from './money'
import type { CurrencyCode, CurrencySpec, Money, Numeric } from './money'
import { DomainError } from './errors'

export class AccountingError extends DomainError {
  constructor(code: string, message: string) {
    super(code, message)
  }
}

/** The per-entity counter-accounts. Mirrors the columns added to `branches`. */
export interface ControlAccounts {
  readonly receivables?: string | null
  readonly payables?: string | null
  readonly tax?: string | null
  readonly bank?: string | null
  readonly fxVariance?: string | null
  readonly rounding?: string | null
}

/** One charge type's mapping, read from reference data. */
export interface AccountMapping {
  readonly chargeTypeId: string
  readonly key: string
  readonly nameEn: string
  readonly revenueAccountCode?: string | null
  readonly costAccountCode?: string | null
}

export interface InvoiceLineInput {
  readonly chargeTypeId: string | null
  readonly description: string
  /** Net of tax, in the invoice's currency. */
  readonly amount: Numeric
  readonly taxAmount: Numeric
}

export interface InvoiceInput {
  readonly id: string
  readonly seriesNo: string
  readonly issuedAt: Date
  readonly customerName: string
  readonly currency: CurrencyCode
  /** The invoice's own rate to base. 1 where it was raised in base currency. */
  readonly fxRate: Numeric
  readonly isCreditNote: boolean
  readonly lines: readonly InvoiceLineInput[]
}

export interface CostInput {
  readonly id: string
  readonly jobReference: string
  readonly chargeTypeId: string
  readonly incurredOn: Date
  readonly description: string
  readonly currency: CurrencyCode
  readonly amount: Numeric
  readonly fxRate: Numeric
  readonly counterpartyName: string
}

export interface PaymentInput {
  readonly id: string
  readonly receivedOn: Date
  readonly customerName: string
  readonly currency: CurrencyCode
  readonly amount: Numeric
  /** The rate on the day the money arrived. */
  readonly fxRate: Numeric
  readonly method: string
  readonly reference?: string | null
  /**
   * What the receipt settles, at the rate the invoice posted at.
   *
   * The difference between this and the receipt's own base value is realised
   * FX, and it is the single most common reason a hand-built journal fails to
   * balance. Empty for a receipt on account.
   */
  readonly allocations: readonly { readonly invoiceSeriesNo: string; readonly baseAmount: Numeric }[]
}

export interface JournalLine {
  readonly date: Date
  readonly account: string
  readonly description: string
  /** The branch code — a cost centre in most charts of accounts. */
  readonly costCentre: string
  readonly debit: Money
  readonly credit: Money
  /** What the customer sees, where it differs from the posting currency. */
  readonly transactionCurrency: CurrencyCode
  readonly transactionAmount: string
  readonly fxRate: string
  readonly reference: string
  readonly counterparty: string
  readonly sourceKind: 'invoice' | 'credit_note' | 'cost' | 'receipt' | 'fx' | 'rounding'
  readonly sourceId: string
}

export interface JournalInput {
  readonly branchCode: string
  readonly baseCurrency: CurrencyCode
  readonly controls: ControlAccounts
  readonly mappings: readonly AccountMapping[]
  readonly invoices: readonly InvoiceInput[]
  readonly costs: readonly CostInput[]
  readonly payments: readonly PaymentInput[]
}

export interface Journal {
  readonly lines: readonly JournalLine[]
  readonly totalDebit: Money
  readonly totalCredit: Money
  readonly invoiceIds: readonly string[]
  readonly paymentIds: readonly string[]
}

/**
 * Build the journal, or refuse.
 *
 * The order of lines is the order an accountant reads them in: sales, then
 * purchases, then cash. Within each, source order — which is issue order,
 * because `uuidv7` sorts by time.
 */
export function buildJournal(input: JournalInput, spec: CurrencySpec): Journal {
  const lines: JournalLine[] = []
  const mapping = new Map(input.mappings.map((m) => [m.chargeTypeId, m]))
  const base = input.baseCurrency

  for (const invoice of input.invoices) {
    lines.push(...invoiceEntry(invoice, input, mapping, spec))
  }
  for (const cost of input.costs) {
    lines.push(...costEntry(cost, input, mapping, spec))
  }
  for (const payment of input.payments) {
    lines.push(...receiptEntry(payment, input, spec))
  }

  const totalDebit = totalOf(lines, 'debit', base)
  const totalCredit = totalOf(lines, 'credit', base)

  /*
    The balance check, and the one place a rounding line is legitimate.

    Per-line rounding to the currency's minor units can leave the two sides a
    fils apart on a large period — that is arithmetic, not a mistake, and every
    accounting package has an account for it. Anything larger than one minor
    unit per source document is a real defect, and posting it to rounding would
    bury exactly the thing somebody needs to see.
  */
  const difference = subtract(totalDebit, totalCredit)
  if (!dec(difference.amount).isZero()) {
    const tolerance = dec(1)
      .div(D(10).pow(spec.minorUnits))
      .times(Math.max(1, input.invoices.length + input.costs.length + input.payments.length))

    if (dec(difference.amount).abs().greaterThan(tolerance)) {
      throw new AccountingError(
        'journal_unbalanced',
        `Journal is out by ${difference.amount.toString()} ${base}, which is too much to be rounding. ` +
          'Something in the period is not what it claims to be.',
      )
    }

    const account = required(
      input.controls.rounding,
      'rounding',
      'a rounding account is needed because per-line rounding left the journal a fraction out',
    )
    const negative = dec(difference.amount).isNegative()
    lines.push({
      date: new Date(input.invoices[0]?.issuedAt ?? new Date()),
      account,
      description: 'Rounding',
      costCentre: input.branchCode,
      debit: negative ? negate(difference) : zero(base),
      credit: negative ? zero(base) : difference,
      transactionCurrency: base,
      transactionAmount: dec(difference.amount).abs().toString(),
      fxRate: '1',
      reference: '',
      counterparty: '',
      sourceKind: 'rounding',
      sourceId: '',
    })
  }

  return {
    lines,
    totalDebit: totalOf(lines, 'debit', base),
    totalCredit: totalOf(lines, 'credit', base),
    invoiceIds: input.invoices.map((i) => i.id),
    paymentIds: input.payments.map((p) => p.id),
  }
}

function invoiceEntry(
  invoice: InvoiceInput,
  input: JournalInput,
  mapping: ReadonlyMap<string, AccountMapping>,
  spec: CurrencySpec,
): JournalLine[] {
  const base = input.baseCurrency
  const rate = dec(invoice.fxRate)
  const toBase = (amount: Numeric): Money => round(money(dec(amount).times(rate), base), spec)

  const kind = invoice.isCreditNote ? 'credit_note' : 'invoice'
  const sign = invoice.isCreditNote ? -1 : 1
  const lines: JournalLine[] = []

  const net = invoice.lines.reduce((acc, l) => acc.plus(dec(l.amount)), D(0))
  const tax = invoice.lines.reduce((acc, l) => acc.plus(dec(l.taxAmount)), D(0))
  const gross = net.plus(tax)

  const receivables = required(
    input.controls.receivables,
    'receivables',
    `invoice ${invoice.seriesNo} has nowhere to post its receivable`,
  )

  /*
    One receivable line per invoice, not per invoice line.

    A statement is reconciled document by document. Twenty revenue lines
    against one AR line is what an accountant expects to see; twenty AR lines
    is a statement nobody can tick off against a remittance advice.
  */
  const arAmount = toBase(gross.times(sign))
  lines.push({
    date: invoice.issuedAt,
    account: receivables,
    description: `${invoice.isCreditNote ? 'Credit note' : 'Invoice'} ${invoice.seriesNo}`,
    costCentre: input.branchCode,
    debit: positiveSide(arAmount, 'debit', base),
    credit: positiveSide(arAmount, 'credit', base),
    transactionCurrency: invoice.currency,
    transactionAmount: gross.times(sign).toString(),
    fxRate: rate.toString(),
    reference: invoice.seriesNo,
    counterparty: invoice.customerName,
    sourceKind: kind,
    sourceId: invoice.id,
  })

  for (const line of invoice.lines) {
    const account = revenueAccountFor(line, mapping, invoice.seriesNo)
    const amount = toBase(dec(line.amount).times(-sign))
    if (dec(amount.amount).isZero()) continue

    lines.push({
      date: invoice.issuedAt,
      account,
      description: line.description,
      costCentre: input.branchCode,
      debit: positiveSide(amount, 'debit', base),
      credit: positiveSide(amount, 'credit', base),
      transactionCurrency: invoice.currency,
      transactionAmount: dec(line.amount).times(sign).toString(),
      fxRate: rate.toString(),
      reference: invoice.seriesNo,
      counterparty: invoice.customerName,
      sourceKind: kind,
      sourceId: invoice.id,
    })
  }

  if (!tax.isZero()) {
    const account = required(
      input.controls.tax,
      'tax',
      `invoice ${invoice.seriesNo} carries tax and the branch has no tax account`,
    )
    const amount = toBase(tax.times(-sign))
    lines.push({
      date: invoice.issuedAt,
      account,
      description: 'Output tax',
      costCentre: input.branchCode,
      debit: positiveSide(amount, 'debit', base),
      credit: positiveSide(amount, 'credit', base),
      transactionCurrency: invoice.currency,
      transactionAmount: tax.times(sign).toString(),
      fxRate: rate.toString(),
      reference: invoice.seriesNo,
      counterparty: invoice.customerName,
      sourceKind: kind,
      sourceId: invoice.id,
    })
  }

  return lines
}

function costEntry(
  cost: CostInput,
  input: JournalInput,
  mapping: ReadonlyMap<string, AccountMapping>,
  spec: CurrencySpec,
): JournalLine[] {
  const base = input.baseCurrency
  const rate = dec(cost.fxRate)
  const amount = round(money(dec(cost.amount).times(rate), base), spec)
  if (dec(amount.amount).isZero()) return []

  const mapped = mapping.get(cost.chargeTypeId)
  const expense = required(
    mapped?.costAccountCode,
    'cost account',
    `charge type ${mapped?.key ?? cost.chargeTypeId} is not mapped to a cost account, ` +
      `so ${cost.jobReference} cannot post`,
  )
  const payables = required(
    input.controls.payables,
    'payables',
    `cost on ${cost.jobReference} has nowhere to post its payable`,
  )

  const common = {
    date: cost.incurredOn,
    costCentre: input.branchCode,
    transactionCurrency: cost.currency,
    transactionAmount: dec(cost.amount).toString(),
    fxRate: rate.toString(),
    reference: cost.jobReference,
    counterparty: cost.counterpartyName,
    sourceKind: 'cost' as const,
    sourceId: cost.id,
  }

  return [
    {
      ...common,
      account: expense,
      description: cost.description,
      debit: positiveSide(amount, 'debit', base),
      credit: positiveSide(amount, 'credit', base),
    },
    {
      ...common,
      account: payables,
      description: `${cost.counterpartyName} — ${cost.jobReference}`,
      debit: positiveSide(negate(amount), 'debit', base),
      credit: positiveSide(negate(amount), 'credit', base),
    },
  ]
}

function receiptEntry(
  payment: PaymentInput,
  input: JournalInput,
  spec: CurrencySpec,
): JournalLine[] {
  const base = input.baseCurrency
  const rate = dec(payment.fxRate)
  const received = round(money(dec(payment.amount).times(rate), base), spec)

  const bank = required(
    input.controls.bank,
    'bank',
    `receipt ${payment.reference ?? payment.id} has nowhere to post the cash`,
  )
  const receivables = required(
    input.controls.receivables,
    'receivables',
    `receipt ${payment.reference ?? payment.id} has no receivable to clear`,
  )

  const common = {
    date: payment.receivedOn,
    costCentre: input.branchCode,
    transactionCurrency: payment.currency,
    transactionAmount: dec(payment.amount).toString(),
    fxRate: rate.toString(),
    reference: payment.reference ?? '',
    counterparty: payment.customerName,
    sourceKind: 'receipt' as const,
    sourceId: payment.id,
  }

  const lines: JournalLine[] = [
    {
      ...common,
      account: bank,
      description: `Receipt — ${payment.method}`,
      debit: received,
      credit: zero(base),
    },
  ]

  /*
    The receivable is cleared at the rate it was *raised* at, not the rate the
    money arrived at.

    This is the whole of realised FX. A USD 10,000 invoice raised at 0.307 sits
    in the ledger as 3,070 KWD. If the money arrives when the rate is 0.309 the
    bank receives 3,090 KWD, and the 20 KWD difference is a gain — not extra
    revenue, and not a discrepancy to be squashed by clearing AR at the wrong
    figure. Clearing at the receipt's rate would leave the receivable balance
    permanently wrong by exactly the amount nobody could explain.
  */
  const cleared =
    payment.allocations.length === 0
      ? received
      : round(
          money(
            payment.allocations.reduce((acc, a) => acc.plus(dec(a.baseAmount)), D(0)),
            base,
          ),
          spec,
        )

  lines.push({
    ...common,
    account: receivables,
    description:
      payment.allocations.length === 0
        ? 'On account'
        : `Settles ${payment.allocations.map((a) => a.invoiceSeriesNo).join(', ')}`,
    debit: zero(base),
    credit: cleared,
  })

  const variance = subtract(received, cleared)
  if (!dec(variance.amount).isZero()) {
    const account = required(
      input.controls.fxVariance,
      'FX variance',
      `receipt ${payment.reference ?? payment.id} realised an exchange difference and ` +
        'the branch has no FX variance account',
    )
    lines.push({
      ...common,
      account,
      description: 'Exchange difference',
      debit: positiveSide(negate(variance), 'debit', base),
      credit: positiveSide(negate(variance), 'credit', base),
      sourceKind: 'fx',
    })
  }

  return lines
}

/**
 * A signed amount becomes a debit column and a credit column.
 *
 * Positive is a debit. Every entry in this module computes a signed figure and
 * then splits it here, which is why a credit note needs no separate code path:
 * it is an invoice whose sign is the other way round.
 */
function positiveSide(amount: Money, side: 'debit' | 'credit', base: CurrencyCode): Money {
  const value = dec(amount.amount)
  if (side === 'debit') return value.isPositive() ? amount : zero(base)
  return value.isNegative() ? negate(amount) : zero(base)
}

function revenueAccountFor(
  line: InvoiceLineInput,
  mapping: ReadonlyMap<string, AccountMapping>,
  seriesNo: string,
): string {
  if (!line.chargeTypeId) {
    throw new AccountingError(
      'journal_unmapped_line',
      `A line on invoice ${seriesNo} has no charge type, so it cannot be posted. ` +
        'Free-text lines have to be given one before the period can close.',
    )
  }
  const mapped = mapping.get(line.chargeTypeId)
  return required(
    mapped?.revenueAccountCode,
    'revenue account',
    `charge type ${mapped?.nameEn ?? line.chargeTypeId} is not mapped to a revenue account, ` +
      `so invoice ${seriesNo} cannot post`,
  )
}

function required(value: string | null | undefined, what: string, why: string): string {
  if (!value || value.trim() === '') {
    throw new AccountingError('journal_unmapped', `No ${what} configured: ${why}.`)
  }
  return value.trim()
}

function totalOf(lines: readonly JournalLine[], side: 'debit' | 'credit', base: CurrencyCode): Money {
  return lines.length === 0
    ? zero(base)
    : sum(
        lines.map((l) => l[side]),
        base,
      )
}

/**
 * The generic double-entry CSV.
 *
 * Deliberately the first format and deliberately not an API integration.
 * Tally, QuickBooks, Xero, Focus and Sage all import a journal CSV; each of
 * their APIs covers exactly one of them. This ships in a day and covers every
 * prospect, and the API adapters are a later, narrower decision.
 *
 * RFC 4180 quoting throughout — a customer legal name containing a comma is
 * not an edge case in this region, it is Tuesday.
 */
export const JOURNAL_CSV_COLUMNS = [
  'date',
  'account',
  'description',
  'cost_centre',
  'debit',
  'credit',
  'currency',
  'transaction_currency',
  'transaction_amount',
  'fx_rate',
  'reference',
  'counterparty',
  'source',
  'source_id',
] as const

export function toJournalCsv(journal: Journal, baseCurrency: CurrencyCode): string {
  const rows = journal.lines.map((l) => [
    isoDate(l.date),
    l.account,
    l.description,
    l.costCentre,
    dec(l.debit.amount).isZero() ? '' : l.debit.amount.toString(),
    dec(l.credit.amount).isZero() ? '' : l.credit.amount.toString(),
    baseCurrency,
    l.transactionCurrency,
    l.transactionAmount,
    l.fxRate,
    l.reference,
    l.counterparty,
    l.sourceKind,
    l.sourceId,
  ])

  return [JOURNAL_CSV_COLUMNS, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Does it balance? The assertion a caller makes before it writes anything. */
export function isBalanced(journal: Journal): boolean {
  return equals(journal.totalDebit, journal.totalCredit)
}

/** Every charge type in use that has no account against it — the pre-flight. */
export function unmappedChargeTypes(
  input: Pick<JournalInput, 'mappings' | 'invoices' | 'costs'>,
): AccountMapping[] {
  const mapping = new Map(input.mappings.map((m) => [m.chargeTypeId, m]))
  const missing = new Map<string, AccountMapping>()

  for (const invoice of input.invoices) {
    for (const line of invoice.lines) {
      if (!line.chargeTypeId) continue
      const mapped = mapping.get(line.chargeTypeId)
      if (mapped && !mapped.revenueAccountCode) missing.set(mapped.chargeTypeId, mapped)
    }
  }
  for (const cost of input.costs) {
    const mapped = mapping.get(cost.chargeTypeId)
    if (mapped && !mapped.costAccountCode) missing.set(mapped.chargeTypeId, mapped)
  }

  return [...missing.values()]
}

/** Sum of an allocation's base amounts — used to build `PaymentInput`. */
export function allocatedBase(
  allocations: readonly { readonly baseAmount: Numeric }[],
  base: CurrencyCode,
): Money {
  return allocations.length === 0
    ? zero(base)
    : sum(
        allocations.map((a) => money(a.baseAmount, base)),
        base,
      )
}

/** Convenience for callers assembling a period total. */
export function journalTotals(journal: Journal): { debit: string; credit: string } {
  return {
    debit: journal.totalDebit.amount.toString(),
    credit: journal.totalCredit.amount.toString(),
  }
}
