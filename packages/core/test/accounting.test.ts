import { describe, expect, it } from 'vitest'
import {
  SEED_CURRENCIES,
  allocatedBase,
  buildJournal,
  isBalanced,
  journalTotals,
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
    {
      chargeTypeId: 'ct-freight',
      description: 'Ocean freight KWI/JEA',
      amount: '400',
      taxAmount: '0',
    },
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

  it("posts a foreign-currency invoice at its own rate, not at today's", () => {
    // USD 1,000 raised when the rate was 0.307. It posts as 307.000 KWD for
    // ever, whatever the rate does afterwards.
    const journal = buildJournal(
      base({
        invoices: [
          invoice({
            currency: 'USD',
            fxRate: '0.307',
            lines: [
              {
                chargeTypeId: 'ct-freight',
                description: 'Freight',
                amount: '1000',
                taxAmount: '0',
              },
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
                {
                  chargeTypeId: 'ct-unmapped',
                  description: 'Legalisation',
                  amount: '30',
                  taxAmount: '0',
                },
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
      buildJournal(
        base({ controls: { ...controls, receivables: null }, invoices: [invoice()] }),
        KWD,
      ),
    ).toThrow(/No receivables configured/)
  })

  it('lists what needs mapping before the export is attempted', () => {
    const missing = unmappedChargeTypes({
      mappings,
      invoices: [
        invoice({
          lines: [
            {
              chargeTypeId: 'ct-unmapped',
              description: 'Legalisation',
              amount: '30',
              taxAmount: '0',
            },
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
      buildJournal(
        base({ invoices: [invoice({ customerName: 'Al-Sayer Trading, W.L.L.' })] }),
        KWD,
      ),
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

/**
 * The rounding line — the one place a plug is legitimate, and the one place
 * it could hide a real defect.
 *
 * Every line is converted and rounded to the currency's minor units on its
 * own, and the receivable is the rounded *total* rather than the total of the
 * rounded lines. Those two can differ by a fils, which is arithmetic and not a
 * mistake; every accounting package has an account for it. Anything larger is
 * something in the period not being what it claims to be, and posting that to
 * rounding would bury exactly the thing somebody needs to see.
 */
describe('rounding, and the line that is not rounding', () => {
  /** Two USD lines that each round away to nothing while the total does not. */
  const fractional = (lines: number) =>
    base({
      controls,
      invoices: [
        invoice({
          currency: 'USD',
          fxRate: '0.30650',
          lines: Array.from({ length: lines }, (_, i) => ({
            chargeTypeId: 'ct-freight',
            description: `Fraction ${i + 1}`,
            amount: '0.0015',
            taxAmount: '0',
          })),
        }),
      ],
    })

  it('posts the fils the per-line rounding left behind', () => {
    const journal = buildJournal(fractional(2), KWD)
    const rounding = journal.lines.find((l) => l.description === 'Rounding')

    expect(rounding).toBeDefined()
    expect(rounding!.account).toBe('7900')
    expect(rounding!.sourceKind).toBe('rounding')
    expect(isBalanced(journal)).toBe(true)
  })

  /**
   * The refusal that matters. Four fractions out of one document is no longer
   * rounding, and a journal that plugged it would balance while stating
   * something untrue about the period.
   */
  it('refuses a difference too large to be rounding, and says so', () => {
    expect(() => buildJournal(fractional(4), KWD)).toThrow(/too much to be rounding/)
  })

  it('refuses to plug a difference with no rounding account configured', () => {
    expect(() =>
      buildJournal({ ...fractional(2), controls: { ...controls, rounding: null } }, KWD),
    ).toThrow(/rounding account is needed/)
  })

  /** Nothing to plug on a period whose lines happen to land exactly. */
  it('posts no rounding line where nothing needed rounding', () => {
    const journal = buildJournal(base({ invoices: [invoice()] }), KWD)

    expect(journal.lines.some((l) => l.description === 'Rounding')).toBe(false)
    expect(isBalanced(journal)).toBe(true)
  })
})

describe('lines worth nothing', () => {
  /**
   * A zero line is dropped rather than posted. A journal carrying a row of
   * zeros is a journal an accountant has to read past, and each one is a
   * question — "what was this and why is it nil" — with no answer.
   */
  it('drops an invoice line that converts to nothing', () => {
    const journal = buildJournal(
      base({
        invoices: [
          invoice({
            lines: [
              {
                chargeTypeId: 'ct-freight',
                description: 'Ocean freight',
                amount: '400',
                taxAmount: '0',
              },
              {
                chargeTypeId: 'ct-thc',
                description: 'Waived handling',
                amount: '0',
                taxAmount: '0',
              },
            ],
          }),
        ],
      }),
      KWD,
    )

    expect(journal.lines.some((l) => l.description === 'Waived handling')).toBe(false)
    expect(journal.lines).toHaveLength(2)
    expect(isBalanced(journal)).toBe(true)
  })

  it('drops a cost that converts to nothing', () => {
    const journal = buildJournal(
      base({
        costs: [
          {
            id: 'cl-0',
            jobReference: 'KWI-JOB-2026-00042',
            chargeTypeId: 'ct-freight',
            incurredOn: new Date('2026-03-10T00:00:00Z'),
            description: 'Nil cost',
            currency: 'KWD',
            amount: '0',
            fxRate: 1,
            counterpartyName: 'MSC Kuwait',
          },
        ],
      }),
      KWD,
    )

    expect(journal.lines).toHaveLength(0)
    expect(isBalanced(journal)).toBe(true)
  })
})

describe('the pre-flight, on every side of the period', () => {
  const unmappedLine = {
    chargeTypeId: 'ct-unmapped',
    description: 'Legalisation',
    amount: '30',
    taxAmount: '0',
  }

  it('lists a cost charge type with no cost account', () => {
    const missing = unmappedChargeTypes({
      mappings,
      invoices: [],
      costs: [
        {
          id: 'cl-2',
          jobReference: 'KWI-JOB-2026-00043',
          chargeTypeId: 'ct-unmapped',
          incurredOn: new Date('2026-03-10T00:00:00Z'),
          description: 'Legalisation',
          currency: 'KWD',
          amount: '30',
          fxRate: 1,
          counterpartyName: 'Chamber of Commerce',
        },
      ],
    })

    expect(missing.map((m) => m.key)).toEqual(['legalisation'])
  })

  /**
   * Only the supplier lines that will actually post. A bill that agrees with
   * its accrual posts nothing, so an unmapped charge type on it is not going
   * to stop the period — and listing it would send a finance manager off to
   * map an account the export never asks for.
   */
  it('lists a supplier line only where the bill disagrees with the accrual', () => {
    const agreeing = unmappedChargeTypes({
      mappings,
      invoices: [],
      costs: [],
      supplierInvoices: [
        {
          id: 'sup-2',
          reference: 'JEA/2026/8842',
          invoiceDate: new Date('2026-03-20T00:00:00Z'),
          partnerName: 'Star Shipping LLC',
          currency: 'KWD',
          fxRate: 1,
          lines: [
            {
              chargeTypeId: 'ct-unmapped',
              description: 'Legalisation',
              billed: '30',
              accrued: '30',
              taxAmount: '0',
            },
          ],
        },
      ],
    })

    const disagreeing = unmappedChargeTypes({
      mappings,
      invoices: [],
      costs: [],
      supplierInvoices: [
        {
          id: 'sup-3',
          reference: 'JEA/2026/8843',
          invoiceDate: new Date('2026-03-20T00:00:00Z'),
          partnerName: 'Star Shipping LLC',
          currency: 'KWD',
          fxRate: 1,
          lines: [
            {
              chargeTypeId: 'ct-unmapped',
              description: 'Legalisation',
              billed: '45',
              accrued: '30',
              taxAmount: '0',
            },
          ],
        },
      ],
    })

    expect(agreeing).toEqual([])
    expect(disagreeing.map((m) => m.key)).toEqual(['legalisation'])
  })

  /** A free-text line has no charge type to map; it is refused at build time. */
  it('says nothing about a free-text line, which is a different refusal', () => {
    const missing = unmappedChargeTypes({
      mappings,
      invoices: [invoice({ lines: [{ ...unmappedLine, chargeTypeId: null }] })],
      costs: [],
    })

    expect(missing).toEqual([])
  })

  it('names each charge type once however many documents used it', () => {
    const missing = unmappedChargeTypes({
      mappings,
      invoices: [
        invoice({ id: 'inv-a', lines: [unmappedLine] }),
        invoice({ id: 'inv-b', lines: [unmappedLine] }),
      ],
      costs: [],
    })

    expect(missing).toHaveLength(1)
  })
})

describe('what the caller adds up before it posts', () => {
  it('sums an allocation in the base currency', () => {
    const total = allocatedBase([{ baseAmount: '120.500' }, { baseAmount: '80.250' }], 'KWD')

    expect(total.amount.toString()).toBe('200.75')
    expect(total.currency).toBe('KWD')
  })

  /** A currency-bearing zero, because a zero with no currency is the seed of
   *  every mixed-currency bug. */
  it('sums an empty allocation into a zero that still knows its currency', () => {
    expect(allocatedBase([], 'KWD')).toEqual({ amount: expect.anything(), currency: 'KWD' })
    expect(allocatedBase([], 'KWD').amount.isZero()).toBe(true)
  })

  it('states the two sides of a period as strings', () => {
    const journal = buildJournal(base({ invoices: [invoice()] }), KWD)

    expect(journalTotals(journal)).toEqual({ debit: '500', credit: '500' })
  })
})
