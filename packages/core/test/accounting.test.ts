import { describe, expect, it } from 'vitest'
import {
  SEED_CURRENCIES,
  buildJournal,
  isBalanced,
  toJournalCsv,
  unmappedChargeTypes,
  type AccountMapping,
  type ControlAccounts,
  type CurrencySpec,
  type InvoiceInput,
  type JournalInput,
} from '../src/index'

const KWD: CurrencySpec = SEED_CURRENCIES.find((c) => c.code === 'KWD')!

const controls: ControlAccounts = {
  receivables: '1200',
  payables: '2100',
  tax: '2200',
  bank: '1010',
  fxVariance: '7800',
  rounding: '7900',
}

const mappings: AccountMapping[] = [
  {
    chargeTypeId: 'ct-freight',
    key: 'ocean_freight',
    nameEn: 'Ocean freight',
    revenueAccountCode: '4010',
    costAccountCode: '5010',
  },
  {
    chargeTypeId: 'ct-thc',
    key: 'thc',
    nameEn: 'Terminal handling',
    revenueAccountCode: '4020',
    costAccountCode: '5020',
  },
  {
    chargeTypeId: 'ct-unmapped',
    key: 'legalisation',
    nameEn: 'Legalisation',
    revenueAccountCode: null,
    costAccountCode: null,
  },
]

const base = (over: Partial<JournalInput> = {}): JournalInput => ({
  branchCode: 'KWI',
  baseCurrency: 'KWD',
  controls,
  mappings,
  invoices: [],
  costs: [],
  payments: [],
  ...over,
})

const invoice = (over: Partial<InvoiceInput> = {}): InvoiceInput => ({
  id: 'inv-1',
  seriesNo: 'KWI-2026-00001',
  issuedAt: new Date('2026-03-15T09:00:00Z'),
  customerName: 'Gulf Trading Co.',
  currency: 'KWD',
  fxRate: 1,
  isCreditNote: false,
  lines: [
    { chargeTypeId: 'ct-freight', description: 'Ocean freight KWI/JEA', amount: '400', taxAmount: '0' },
    { chargeTypeId: 'ct-thc', description: 'Terminal handling', amount: '100', taxAmount: '0' },
  ],
  ...over,
})

describe('sales', () => {
  it('posts one receivable against the revenue lines behind it', () => {
    const journal = buildJournal(base({ invoices: [invoice()] }), KWD)

    expect(journal.lines).toHaveLength(3)
    expect(journal.lines[0]).toMatchObject({ account: '1200', sourceKind: 'invoice' })
    expect(journal.lines[0]!.debit.amount.toString()).toBe('500')
    expect(journal.lines[1]!.credit.amount.toString()).toBe('400')
    expect(journal.lines[2]!.credit.amount.toString()).toBe('100')
    expect(isBalanced(journal)).toBe(true)
  })

  it('posts tax to its own account', () => {
    const journal = buildJournal(
      base({
        invoices: [
          invoice({
            lines: [
              { chargeTypeId: 'ct-freight', description: 'Freight', amount: '100', taxAmount: '5' },
            ],
          }),
        ],
      }),
      KWD,
    )

    const tax = journal.lines.find((l) => l.account === '2200')
    expect(tax?.credit.amount.toString()).toBe('5')
    expect(journal.lines[0]!.debit.amount.toString()).toBe('105')
    expect(isBalanced(journal)).toBe(true)
  })

  it('reverses a credit note without a second code path', () => {
    const journal = buildJournal(
      base({ invoices: [invoice({ id: 'cn-1', isCreditNote: true })] }),
      KWD,
    )

    expect(journal.lines[0]!.credit.amount.toString()).toBe('500')
    expect(journal.lines[0]!.debit.amount.toString()).toBe('0')
    expect(journal.lines[1]!.debit.amount.toString()).toBe('400')
    expect(isBalanced(journal)).toBe(true)
  })

  it('posts a foreign-currency invoice at its own rate, not at today\'s', () => {
    // USD 1,000 raised when the rate was 0.307. It posts as 307.000 KWD for
    // ever, whatever the rate does afterwards.
    const journal = buildJournal(
      base({
        invoices: [
          invoice({
            currency: 'USD',
            fxRate: '0.307',
            lines: [
              { chargeTypeId: 'ct-freight', description: 'Freight', amount: '1000', taxAmount: '0' },
            ],
          }),
        ],
      }),
      KWD,
    )

    expect(journal.lines[0]!.debit.amount.toString()).toBe('307')
    expect(journal.lines[0]!.transactionAmount).toBe('1000')
    expect(journal.lines[0]!.transactionCurrency).toBe('USD')
    expect(isBalanced(journal)).toBe(true)
  })
})

describe('purchases', () => {
  it('posts a supplier cost against payables', () => {
    const journal = buildJournal(
      base({
        costs: [
          {
            id: 'cl-1',
            jobReference: 'KWI-JOB-2026-00042',
            chargeTypeId: 'ct-freight',
            incurredOn: new Date('2026-03-10T00:00:00Z'),
            description: 'Ocean freight — MSC',
            currency: 'KWD',
            amount: '320',
            fxRate: 1,
            counterpartyName: 'MSC Kuwait',
          },
        ],
      }),
      KWD,
    )

    expect(journal.lines[0]).toMatchObject({ account: '5010' })
    expect(journal.lines[0]!.debit.amount.toString()).toBe('320')
    expect(journal.lines[1]).toMatchObject({ account: '2100' })
    expect(journal.lines[1]!.credit.amount.toString()).toBe('320')
    expect(isBalanced(journal)).toBe(true)
  })
})

describe('cash and realised FX', () => {
  it('clears the receivable at the rate it was raised at', () => {
    // USD 1,000 invoiced at 0.307 (307.000 KWD receivable), paid when the
    // rate is 0.309 (309.000 KWD in the bank). The 2.000 KWD difference is a
    // gain, and clearing AR at the receipt's rate would leave the receivable
    // permanently wrong by exactly that.
    const journal = buildJournal(
      base({
        payments: [
          {
            id: 'pay-1',
            receivedOn: new Date('2026-04-02T00:00:00Z'),
            customerName: 'Gulf Trading Co.',
            currency: 'USD',
            amount: '1000',
            fxRate: '0.309',
            method: 'transfer',
            reference: 'TT-99',
            allocations: [{ invoiceSeriesNo: 'KWI-2026-00001', baseAmount: '307' }],
          },
        ],
      }),
      KWD,
    )

    const bank = journal.lines.find((l) => l.account === '1010')!
    const ar = journal.lines.find((l) => l.account === '1200')!
    const fx = journal.lines.find((l) => l.account === '7800')!

    expect(bank.debit.amount.toString()).toBe('309')
    expect(ar.credit.amount.toString()).toBe('307')
    expect(fx.credit.amount.toString()).toBe('2')
    expect(isBalanced(journal)).toBe(true)
  })

  it('raises no FX line when the rate did not move', () => {
    const journal = buildJournal(
      base({
        payments: [
          {
            id: 'pay-2',
            receivedOn: new Date('2026-04-02T00:00:00Z'),
            customerName: 'Gulf Trading Co.',
            currency: 'KWD',
            amount: '500',
            fxRate: 1,
            method: 'cheque',
            allocations: [{ invoiceSeriesNo: 'KWI-2026-00001', baseAmount: '500' }],
          },
        ],
      }),
      KWD,
    )

    expect(journal.lines).toHaveLength(2)
    expect(isBalanced(journal)).toBe(true)
  })

  it('posts a receipt on account with nothing allocated', () => {
    const journal = buildJournal(
      base({
        payments: [
          {
            id: 'pay-3',
            receivedOn: new Date('2026-04-02T00:00:00Z'),
            customerName: 'Gulf Trading Co.',
            currency: 'KWD',
            amount: '250',
            fxRate: 1,
            method: 'cash',
            allocations: [],
          },
        ],
      }),
      KWD,
    )

    expect(journal.lines[1]!.description).toBe('On account')
    expect(isBalanced(journal)).toBe(true)
  })
})

describe('refusals', () => {
  it('refuses an unmapped revenue account and names the charge type', () => {
    expect(() =>
      buildJournal(
        base({
          invoices: [
            invoice({
              lines: [
                { chargeTypeId: 'ct-unmapped', description: 'Legalisation', amount: '30', taxAmount: '0' },
              ],
            }),
          ],
        }),
        KWD,
      ),
    ).toThrow(/Legalisation is not mapped to a revenue account/)
  })

  it('refuses a free-text invoice line rather than posting it to a suspense account', () => {
    expect(() =>
      buildJournal(
        base({
          invoices: [
            invoice({
              lines: [{ chargeTypeId: null, description: 'Sundry', amount: '30', taxAmount: '0' }],
            }),
          ],
        }),
        KWD,
      ),
    ).toThrow(/has no charge type/)
  })

  it('refuses when the branch has no receivables account', () => {
    expect(() =>
      buildJournal(base({ controls: { ...controls, receivables: null }, invoices: [invoice()] }), KWD),
    ).toThrow(/No receivables configured/)
  })

  it('lists what needs mapping before the export is attempted', () => {
    const missing = unmappedChargeTypes({
      mappings,
      invoices: [
        invoice({
          lines: [
            { chargeTypeId: 'ct-unmapped', description: 'Legalisation', amount: '30', taxAmount: '0' },
          ],
        }),
      ],
      costs: [],
    })

    expect(missing.map((m) => m.key)).toEqual(['legalisation'])
  })
})

describe('the file', () => {
  it('quotes a legal name containing a comma', () => {
    const csv = toJournalCsv(
      buildJournal(base({ invoices: [invoice({ customerName: 'Al-Sayer Trading, W.L.L.' })] }), KWD),
      'KWD',
    )

    expect(csv.split('\r\n')[1]).toContain('"Al-Sayer Trading, W.L.L."')
  })

  it('writes the header the importers expect', () => {
    const csv = toJournalCsv(buildJournal(base({ invoices: [invoice()] }), KWD), 'KWD')
    expect(csv.split('\r\n')[0]).toBe(
      'date,account,description,cost_centre,debit,credit,currency,transaction_currency,transaction_amount,fx_rate,reference,counterparty,source,source_id',
    )
  })

  it('leaves the unused side of a line empty rather than zero', () => {
    // A zero in the debit column of a credit line imports as a debit line in
    // more than one package. Empty is the only portable answer.
    const csv = toJournalCsv(buildJournal(base({ invoices: [invoice()] }), KWD), 'KWD')
    const revenue = csv.split('\r\n')[2]!.split(',')
    expect(revenue[4]).toBe('')
    expect(revenue[5]).toBe('400')
  })
})
