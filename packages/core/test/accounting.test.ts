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
  type SettlementInput,
  type SupplierInvoiceInput,
  type SupplierPaymentInput,
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

/**
 * The payables side — FR-FN-09 in the ledger.
 *
 * The claim being tested is the one in the module header and it is the one a
 * reviewer will doubt: a supplier invoice that agrees with the accrual posts
 * *nothing*. Every other case here exists to show that the claim is a design
 * decision rather than a missing feature.
 */
describe('supplier invoices', () => {
  const bill = (over: Partial<SupplierInvoiceInput> = {}): SupplierInvoiceInput => ({
    id: 'sup-1',
    reference: 'JEA/2026/8841',
    invoiceDate: new Date('2026-03-20T00:00:00Z'),
    partnerName: 'Star Shipping LLC',
    currency: 'KWD',
    fxRate: 1,
    lines: [
      {
        chargeTypeId: 'ct-freight',
        description: 'Ocean freight KWI/JEA',
        billed: '320',
        accrued: '320',
        taxAmount: '0',
      },
    ],
    ...over,
  })

  it('posts nothing at all when the bill agrees with what was accrued', () => {
    const journal = buildJournal(base({ supplierInvoices: [bill()] }), KWD)
    expect(journal.lines).toHaveLength(0)
    expect(journal.supplierInvoiceIds).toEqual(['sup-1'])
  })

  it('posts the difference, and only the difference, when the agent bills over', () => {
    // Accrued 320, billed 380. The 60 is the argument, and it is the whole
    // entry — the 320 was already a liability the day the cost was recorded.
    const journal = buildJournal(
      base({
        supplierInvoices: [
          bill({
            lines: [
              {
                chargeTypeId: 'ct-freight',
                description: 'Ocean freight KWI/JEA',
                billed: '380',
                accrued: '320',
                taxAmount: '0',
              },
            ],
          }),
        ],
      }),
      KWD,
    )

    expect(journal.lines).toHaveLength(2)
    expect(journal.lines[0]).toMatchObject({ account: '5010' })
    expect(journal.lines[0]!.debit.amount.toString()).toBe('60')
    expect(journal.lines[1]).toMatchObject({ account: '2100' })
    expect(journal.lines[1]!.credit.amount.toString()).toBe('60')
    expect(isBalanced(journal)).toBe(true)
  })

  it('reverses the entry when they bill under, releasing the over-accrual', () => {
    const journal = buildJournal(
      base({
        supplierInvoices: [
          bill({
            lines: [
              {
                chargeTypeId: 'ct-freight',
                description: 'Ocean freight KWI/JEA',
                billed: '290',
                accrued: '320',
                taxAmount: '0',
              },
            ],
          }),
        ],
      }),
      KWD,
    )

    expect(journal.lines[0]!.credit.amount.toString()).toBe('30')
    expect(journal.lines[1]!.debit.amount.toString()).toBe('30')
    expect(isBalanced(journal)).toBe(true)
  })

  it('posts a charge nobody accrued in full, because none of it was expected', () => {
    const journal = buildJournal(
      base({
        supplierInvoices: [
          bill({
            lines: [
              {
                chargeTypeId: 'ct-thc',
                description: 'Terminal handling — not quoted',
                billed: '45',
                accrued: '0',
                taxAmount: '0',
              },
            ],
          }),
        ],
      }),
      KWD,
    )

    expect(journal.lines[0]).toMatchObject({ account: '5020' })
    expect(journal.lines[0]!.debit.amount.toString()).toBe('45')
  })

  it('takes input tax to its own account, not to the output tax account', () => {
    const journal = buildJournal(
      base({
        controls: { ...controls, inputTax: '1250' },
        supplierInvoices: [
          bill({
            currency: 'AED',
            fxRate: '0.0836',
            lines: [
              {
                chargeTypeId: 'ct-freight',
                description: 'Ocean freight',
                billed: '1000',
                accrued: '1000',
                taxAmount: '50',
              },
            ],
          }),
        ],
      }),
      KWD,
    )

    expect(journal.lines).toHaveLength(2)
    expect(journal.lines[0]).toMatchObject({ account: '1250' })
    expect(journal.lines[0]!.debit.amount.toString()).toBe('4.18')
    expect(isBalanced(journal)).toBe(true)
  })

  it('refuses a taxed bill where the branch has no input tax account', () => {
    expect(() =>
      buildJournal(
        base({
          supplierInvoices: [
            bill({
              lines: [
                {
                  chargeTypeId: 'ct-freight',
                  description: 'Ocean freight',
                  billed: '320',
                  accrued: '320',
                  taxAmount: '16',
                },
              ],
            }),
          ],
        }),
        KWD,
      ),
    ).toThrow(/No input tax configured/)
  })

  it('refuses a variance on a line with no charge type, and names the line', () => {
    expect(() =>
      buildJournal(
        base({
          supplierInvoices: [
            bill({
              lines: [
                {
                  chargeTypeId: null,
                  description: 'Sundry charges',
                  billed: '40',
                  accrued: '0',
                  taxAmount: '0',
                },
              ],
            }),
          ],
        }),
        KWD,
      ),
    ).toThrow(/Sundry charges/)
  })

  it('does not refuse an unmapped free-text line that agrees with the accrual', () => {
    const journal = buildJournal(
      base({
        supplierInvoices: [
          bill({
            lines: [
              {
                chargeTypeId: null,
                description: 'Sundry charges',
                billed: '40',
                accrued: '40',
                taxAmount: '0',
              },
            ],
          }),
        ],
      }),
      KWD,
    )
    expect(journal.lines).toHaveLength(0)
  })

  it('lists only the charge types a variance will actually try to post', () => {
    const missing = unmappedChargeTypes({
      mappings,
      invoices: [],
      costs: [],
      supplierInvoices: [
        bill({
          lines: [
            // Disagrees and is unmapped — this one blocks the export.
            {
              chargeTypeId: 'ct-unmapped',
              description: 'Legalisation',
              billed: '30',
              accrued: '20',
              taxAmount: '0',
            },
            // Also unmapped, but agrees, so it never posts and never blocks.
            {
              chargeTypeId: 'ct-unmapped',
              description: 'Legalisation',
              billed: '20',
              accrued: '20',
              taxAmount: '0',
            },
          ],
        }),
      ],
    })

    expect(missing.map((m) => m.key)).toEqual(['legalisation'])
  })
})

describe('paying a supplier', () => {
  const payment = (over: Partial<SupplierPaymentInput> = {}): SupplierPaymentInput => ({
    id: 'sp-1',
    paidOn: new Date('2026-04-05T00:00:00Z'),
    partnerName: 'Star Shipping LLC',
    currency: 'KWD',
    amount: '320',
    fxRate: 1,
    method: 'transfer',
    reference: 'TT-99120',
    allocations: [{ supplierReference: 'JEA/2026/8841', baseAmount: '320' }],
    ...over,
  })

  it('clears the payable and takes the cash out of the bank', () => {
    const journal = buildJournal(base({ supplierPayments: [payment()] }), KWD)

    expect(journal.lines[0]).toMatchObject({ account: '2100' })
    expect(journal.lines[0]!.debit.amount.toString()).toBe('320')
    expect(journal.lines[1]).toMatchObject({ account: '1010' })
    expect(journal.lines[1]!.credit.amount.toString()).toBe('320')
    expect(isBalanced(journal)).toBe(true)
  })

  it('clears the payable at the rate the bill posted at, and realises the difference', () => {
    // USD 1,000 accrued at 0.307 (307.000 KWD payable), paid when the rate is
    // 0.309 (309.000 KWD out of the bank). The 2.000 KWD is a realised loss.
    const journal = buildJournal(
      base({
        supplierPayments: [
          payment({
            currency: 'USD',
            amount: '1000',
            fxRate: '0.309',
            allocations: [{ supplierReference: 'JEA/2026/8841', baseAmount: '307' }],
          }),
        ],
      }),
      KWD,
    )

    expect(journal.lines[0]!.debit.amount.toString()).toBe('307')
    expect(journal.lines[1]!.credit.amount.toString()).toBe('309')
    expect(journal.lines[2]).toMatchObject({ account: '7800', sourceKind: 'fx' })
    expect(journal.lines[2]!.debit.amount.toString()).toBe('2')
    expect(isBalanced(journal)).toBe(true)
  })

  it('posts a payment on account against payables in full', () => {
    const journal = buildJournal(base({ supplierPayments: [payment({ allocations: [] })] }), KWD)
    expect(journal.lines).toHaveLength(2)
    expect(journal.lines[0]!.description).toBe('On account')
  })
})

describe('setting off an agent current account', () => {
  const settlement = (over: Partial<SettlementInput> = {}): SettlementInput => ({
    id: 'set-1',
    reference: 'SET-JEA-2026-03',
    settledOn: new Date('2026-03-31T00:00:00Z'),
    partnerName: 'Star Shipping LLC',
    currency: 'KWD',
    fxRate: 1,
    offset: '3600',
    ...over,
  })

  it('clears both sides and moves no cash', () => {
    const journal = buildJournal(base({ settlements: [settlement()] }), KWD)

    expect(journal.lines).toHaveLength(2)
    expect(journal.lines[0]).toMatchObject({ account: '2100' })
    expect(journal.lines[0]!.debit.amount.toString()).toBe('3600')
    expect(journal.lines[1]).toMatchObject({ account: '1200' })
    expect(journal.lines[1]!.credit.amount.toString()).toBe('3600')
    expect(journal.lines.every((l) => l.account !== '1010')).toBe(true)
    expect(isBalanced(journal)).toBe(true)
  })

  it('posts nothing where the two sides had nothing in common', () => {
    const journal = buildJournal(base({ settlements: [settlement({ offset: '0' })] }), KWD)
    expect(journal.lines).toHaveLength(0)
  })

  it('carries the agreed rate onto both legs, so the set-off cannot realise FX', () => {
    const journal = buildJournal(
      base({ settlements: [settlement({ currency: 'USD', fxRate: '0.307', offset: '1000' })] }),
      KWD,
    )
    expect(journal.lines[0]!.debit.amount.toString()).toBe('307')
    expect(journal.lines[1]!.credit.amount.toString()).toBe('307')
    expect(journal.lines).toHaveLength(2)
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
