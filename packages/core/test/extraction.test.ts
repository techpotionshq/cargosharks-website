import { describe, expect, it } from 'vitest'
import {
  INVOICE_EXTRACTION_SCHEMA,
  driftMagnitude,
  invoiceLinesGrid,
  invoiceTotal,
  isSelfConsistent,
  ENQUIRY_EXTRACTION_SCHEMA,
  ENQUIRY_FIELDS,
  readExtractedEnquiry,
  readExtractedInvoice,
  reconcileInvoice,
  type RawExtractedInvoice,
  type RawInvoiceLine,
} from '../src/extraction'
import { EXTRACTABLE_FIELDS } from '../src/ai'
import { SEED_CURRENCIES, toDb } from '../src/money'
import type { ImportLookups } from '../src/import'

const KWD = SEED_CURRENCIES.find((c) => c.code === 'KWD')!
const USD = SEED_CURRENCIES.find((c) => c.code === 'USD')!

const lookups: ImportLookups = {
  currencies: new Set(['KWD', 'USD', 'AED']),
  chargeTypes: new Set(['OFR', 'THC', 'DOC', 'CUS']),
}

const line = (over: Partial<RawInvoiceLine> = {}): RawInvoiceLine => ({
  description: 'Ocean freight Jebel Ali to Shuwaikh',
  quantity: '2',
  unitPrice: '450.000',
  amount: '900.000',
  taxAmount: '0',
  chargeType: 'OFR',
  ...over,
})

const invoice = (over: Partial<RawExtractedInvoice> = {}): RawExtractedInvoice => ({
  invoiceNumber: 'AGT-2026-1187',
  invoiceDate: '2026-08-14',
  currency: 'KWD',
  subtotal: '900.000',
  taxAmount: '0',
  total: '900.000',
  lines: [line()],
  confidence: 0.92,
  ...over,
})

const read = (over: Partial<RawExtractedInvoice> = {}) =>
  readExtractedInvoice(invoice(over), lookups)

describe('the schema we send', () => {
  /*
    Every figure a string. A JSON number is a double, and a KWD invoice
    carries three decimals — which is exactly where a double starts to lie.
  */
  it('asks for every amount as a string, never as a number', () => {
    const props = INVOICE_EXTRACTION_SCHEMA.properties as Record<string, { type: unknown }>
    for (const key of ['subtotal', 'taxAmount', 'total']) {
      expect(props[key]!.type).toEqual(['string', 'null'])
    }

    const lineProps = (
      props.lines as unknown as {
        items: { properties: Record<string, { type: unknown }> }
      }
    ).items.properties
    expect(lineProps.amount!.type).toBe('string')
    expect(lineProps.unitPrice!.type).toEqual(['string', 'null'])
  })

  it('refuses fields it did not ask for, as strict output requires', () => {
    expect(INVOICE_EXTRACTION_SCHEMA.additionalProperties).toBe(false)
  })
})

describe('invoiceLinesGrid', () => {
  it('lays lines out as a header row and string cells', () => {
    const grid = invoiceLinesGrid([line()])
    expect(grid[0]).toEqual([
      'description',
      'quantity',
      'unitPrice',
      'amount',
      'taxAmount',
      'chargeType',
    ])
    expect(grid[1]![3]).toBe('900.000')
  })

  it('writes a null as a blank cell, which every parser already understands', () => {
    const grid = invoiceLinesGrid([line({ unitPrice: null, chargeType: null })])
    expect(grid[1]![2]).toBe('')
    expect(grid[1]![5]).toBe('')
  })
})

describe('readExtractedInvoice', () => {
  it('reads a clean invoice with no issues', () => {
    const result = read()
    expect(result.headerIssues).toEqual([])
    expect(result.lines.ok).toBe(true)
    expect(result.lines.rows[0]!.values.description).toContain('Ocean freight')
    expect(result.confidence).toBe(0.92)
  })

  it('reports a missing invoice number as a header problem, not a row one', () => {
    const result = read({ invoiceNumber: '' })
    expect(result.headerIssues.join()).toMatch(/Invoice number/)
    expect(result.lines.issues).toEqual([])
  })

  it('refuses a currency this deployment does not hold', () => {
    expect(read({ currency: 'ZZZ' }).headerIssues.join()).toMatch(/currency/i)
  })

  /*
    The whole reuse claim, as a test. Arabic-Indic digits and European
    grouping both arrive from real Gulf paperwork, and neither needed a line
    of code here — `import.ts` has handled them since FR-MD-11.
  */
  it('inherits Arabic-Indic digits and European grouping from the CSV parsers', () => {
    const result = readExtractedInvoice(
      invoice({
        lines: [line({ amount: '١٢٣٤.٥٠٠', quantity: '1', unitPrice: '١٢٣٤.٥٠٠' })],
        subtotal: '1.234,500',
        total: '1.234,500',
      }),
      lookups,
    )
    expect(result.lines.rows[0]!.values.amount).toBe('1234.500')
    expect(result.header.subtotal).toBe('1234.500')
  })

  it('defaults a flat charge to quantity one and leaves its unit price null', () => {
    const result = read({ lines: [line({ quantity: null, unitPrice: null, amount: '15.000' })] })
    expect(result.lines.rows[0]!.values.quantity).toBe('1')
    expect(result.lines.rows[0]!.values.unitPrice).toBeNull()
  })

  it('leaves an unrecognised charge code unclassified rather than inventing one', () => {
    const result = read({ lines: [line({ chargeType: 'MYSTERY-FEE' })] })
    expect(result.lines.ok).toBe(false)
    expect(result.lines.issues[0]!.message).toMatch(/charge type/i)
  })

  it('says so when the model found no lines at all', () => {
    expect(read({ lines: [] }).headerIssues.join()).toMatch(/no invoice lines/)
  })

  it('survives a model that returned something other than an array of lines', () => {
    const result = readExtractedInvoice({ ...invoice(), lines: 'sorry' }, lookups)
    expect(result.headerIssues.join()).toMatch(/no invoice lines/)
  })
})

describe('reconcileInvoice', () => {
  it('finds nothing wrong with an invoice that adds up', () => {
    expect(reconcileInvoice(read(), KWD)).toEqual([])
  })

  /*
    The single-digit misreading this whole surface exists to catch. 2 × 450 is
    900, and a model that read the amount as 990 produces a line that is
    individually plausible and arithmetically impossible.
  */
  it('catches a misread line amount against its own quantity and unit price', () => {
    const findings = reconcileInvoice(read({ lines: [line({ amount: '990.000' })] }), KWD)
    const amountFinding = findings.find((f) => f.check === 'line_amount')

    expect(amountFinding).toBeDefined()
    expect(toDb(amountFinding!.stated)).toBe('990')
    expect(toDb(amountFinding!.computed)).toBe('900')
    expect(toDb(amountFinding!.difference)).toBe('90')
    expect(amountFinding!.line).toBe(2)
  })

  /*
    The check that earns its place. A dropped line leaves every remaining line
    perfectly correct — no per-line check can see it — and the only evidence is
    that they no longer sum to what the supplier printed.
  */
  it('catches a line the model missed entirely', () => {
    const findings = reconcileInvoice(
      read({
        lines: [line()],
        subtotal: '1050.000',
        total: '1050.000',
      }),
      KWD,
    )

    const subtotal = findings.find((f) => f.check === 'subtotal')
    expect(subtotal).toBeDefined()
    expect(toDb(subtotal!.difference)).toBe('150')
  })

  /*
    One fault should read as one finding. Deriving the gross from our short sum
    would report the same dropped line a second time as a total mismatch, and a
    coordinator would go looking for two problems.
  */
  it('reports a dropped line once, not twice', () => {
    const findings = reconcileInvoice(
      read({ lines: [line()], subtotal: '1050.000', total: '1050.000' }),
      KWD,
    )
    expect(findings.map((f) => f.check)).toEqual(['subtotal'])
  })

  it('catches a tax figure read off the wrong row', () => {
    const findings = reconcileInvoice(
      read({ subtotal: '900.000', taxAmount: '45.000', total: '900.000' }),
      KWD,
    )
    expect(findings.map((f) => f.check)).toEqual(['total'])
    expect(toDb(findings[0]!.computed)).toBe('945')
  })

  it('checks nothing on a flat charge that printed no unit price', () => {
    const flat = read({
      lines: [line({ quantity: null, unitPrice: null, amount: '15.000' })],
      subtotal: '15.000',
      total: '15.000',
    })
    expect(reconcileInvoice(flat, KWD)).toEqual([])
  })

  /*
    KWD carries three decimals and USD two. Rounding both sides to the
    currency's minor units is what stops a fractional unit price flagging
    every invoice — and using the wrong currency's units is the classic way
    this check turns into noise.
  */
  it('rounds to the currency’s own minor units before comparing', () => {
    const raw = invoice({
      currency: 'USD',
      lines: [line({ quantity: '3', unitPrice: '10.005', amount: '30.02' })],
      subtotal: '30.02',
      taxAmount: '0',
      total: '30.02',
    })
    // 3 × 10.005 = 30.015, which is 30.02 at two decimals and 30.015 at three.
    expect(reconcileInvoice(readExtractedInvoice(raw, lookups), USD)).toEqual([])
    expect(reconcileInvoice(readExtractedInvoice(raw, lookups), KWD).length).toBeGreaterThan(0)
  })

  it('handles a credit line without treating the sign as an error', () => {
    const credit = read({
      lines: [
        line(),
        line({
          description: 'Goodwill credit',
          quantity: '1',
          unitPrice: '-50.000',
          amount: '-50.000',
          chargeType: null,
        }),
      ],
      subtotal: '850.000',
      total: '850.000',
    })
    expect(credit.lines.ok).toBe(true)
    expect(reconcileInvoice(credit, KWD)).toEqual([])
  })
})

describe('isSelfConsistent', () => {
  it('accepts a confident extraction of a document that balances', () => {
    expect(isSelfConsistent(read(), KWD, 0.8)).toBe(true)
  })

  /*
    The right way round, and the reason this surface is trustworthy: a
    confident model that misread a digit is refused, and a hesitant one that
    read the page correctly is not.
  */
  it('refuses a confident extraction that does not add up', () => {
    const wrong = read({ lines: [line({ amount: '990.000' })], confidence: 0.99 })
    expect(isSelfConsistent(wrong, KWD, 0.8)).toBe(false)
  })

  it('refuses a balancing extraction the model was not sure about', () => {
    expect(isSelfConsistent(read({ confidence: 0.4 }), KWD, 0.8)).toBe(false)
  })

  it('refuses anything with a header problem', () => {
    expect(isSelfConsistent(read({ invoiceNumber: '' }), KWD, 0.5)).toBe(false)
  })

  it('refuses an invoice with no lines', () => {
    expect(isSelfConsistent(read({ lines: [] }), KWD, 0.5)).toBe(false)
  })
})

describe('invoiceTotal', () => {
  it('takes the printed gross where there is one', () => {
    expect(toDb(invoiceTotal(read(), KWD))).toBe('900')
  })

  /*
    A single-line agent debit note routinely prints nothing but the amount.
    Every caller wants a total and none of them should invent its own, or two
    screens end up disagreeing about what a bill is worth.
  */
  it('falls back to the lines plus tax where the page printed no gross', () => {
    const noTotal = read({ total: null, subtotal: null, taxAmount: '13.500' })
    expect(toDb(invoiceTotal(noTotal, KWD))).toBe('913.5')
  })
})

describe('driftMagnitude', () => {
  it('sums the absolute drift so a queue can be ordered by how wrong it is', () => {
    const findings = reconcileInvoice(
      read({ lines: [line({ amount: '990.000' })], subtotal: '900.000', total: '945.000' }),
      KWD,
    )
    expect(findings.length).toBeGreaterThan(1)
    expect(Number(toDb(driftMagnitude(findings, KWD)))).toBeGreaterThan(0)
  })
})

describe('the cross-check has to have something to check against', () => {
  /*
    Found by a live call, not by reading a specification: the model read a
    two-line invoice correctly and returned no subtotal and no total, so
    `reconcileInvoice` compared nothing and reported nothing wrong. An absence
    of findings is not evidence of correctness when nothing was checked.
  */
  it('reports no findings when the page stated no net — which is the danger', () => {
    const blind = read({ subtotal: null, total: null, lines: [line(), line()] })
    expect(reconcileInvoice(blind, KWD)).toEqual([])
  })

  it('refuses to write a multi-line invoice that cannot be cross-checked', () => {
    const blind = read({ subtotal: null, total: null, lines: [line(), line()], confidence: 0.99 })
    expect(isSelfConsistent(blind, KWD, 0.8)).toBe(false)
  })

  /*
    One line is its own total. A single-line agent debit note that prints
    nothing but an amount is ordinary, and refusing it would send a coordinator
    to type the one figure the extraction already had.
  */
  it('still accepts a single-line invoice with no printed total', () => {
    const one = read({ subtotal: null, total: null, lines: [line()] })
    expect(isSelfConsistent(one, KWD, 0.8)).toBe(true)
  })

  it('accepts a multi-line invoice once a net is stated', () => {
    const checked = read({ subtotal: '1800.000', total: '1800.000', lines: [line(), line()] })
    expect(isSelfConsistent(checked, KWD, 0.8)).toBe(true)
  })
})

describe('the emailed enquiry', () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    field: 'mode',
    value: 'sea_fcl',
    confidence: 0.9,
    evidence: '2 x 40HC',
    ...over,
  })

  const read = (over: Record<string, unknown> = {}) =>
    readExtractedEnquiry({ fields: [entry()], confidence: 0.8, ...over })

  it('reads a proposal per field, keeping the evidence span', () => {
    const extracted = read()
    expect(extracted.fields).toEqual([
      { field: 'mode', value: 'sea_fcl', confidence: 0.9, evidence: '2 x 40HC' },
    ])
    expect(extracted.confidence).toBe(0.8)
  })

  /**
   * The schema and the allowlist are two lists that must agree, and this is
   * the test the duplication buys. `ENQUIRY_FIELDS` is what the provider is
   * told; `EXTRACTABLE_FIELDS.enquiry_extract` is what the system will accept.
   * A schema loosened without the allowlist following it is otherwise silent.
   */
  it('offers the model exactly the fields the surface will accept', () => {
    expect([...ENQUIRY_FIELDS].sort()).toEqual([...EXTRACTABLE_FIELDS.enquiry_extract].sort())
  })

  it('names the enum in the schema, so the provider cannot invent a field', () => {
    const fields = (ENQUIRY_EXTRACTION_SCHEMA.properties as Record<string, Record<string, never>>)
      .fields as unknown as { items: { properties: { field: { enum: string[] } } } }
    expect(fields.items.properties.field.enum).toEqual([...ENQUIRY_FIELDS])
  })

  /*
    A field outside the twelve is kept and reported rather than dropped. An
    extraction that answered `customerId` is either a prompt bug or a mail that
    talked the model into one, and both want somebody's attention — dropping it
    silently would lose the only evidence it happened.
  */
  it('reports a field it was never offered rather than discarding it quietly', () => {
    const extracted = read({ fields: [entry({ field: 'customerId', value: 'cust-1' })] })
    expect(extracted.fields).toEqual([])
    expect(extracted.unknownFields).toEqual(['customerId'])
  })

  it('drops one malformed entry and keeps the rest', () => {
    const extracted = read({
      fields: [entry({ confidence: 'very sure' }), entry({ field: 'pieces', value: '240' })],
    })
    expect(extracted.fields.map((f) => f.field)).toEqual(['pieces'])
  })

  it('omits an empty value rather than proposing a blank', () => {
    expect(read({ fields: [entry({ value: '   ' })] }).fields).toEqual([])
  })

  it('leaves evidence off entirely where the model would not name a span', () => {
    const [proposal] = read({ fields: [entry({ evidence: null })] }).fields
    expect(proposal).not.toHaveProperty('evidence')
  })

  it('clamps a confidence outside the range rather than losing the field', () => {
    expect(read({ fields: [entry({ confidence: 1.4 })] }).fields[0]?.confidence).toBe(1)
  })

  it('refuses a response that is not the shape asked for', () => {
    expect(() => readExtractedEnquiry({ confidence: 0.9 })).toThrow(/fields/)
    expect(() => readExtractedEnquiry('nope')).toThrow(/JSON object/)
  })
})
