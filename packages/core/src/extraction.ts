/**
 * Turning what a model read off a document into rows this system will accept.
 *
 * The first surface is the supplier invoice, and it is first because of what
 * sits behind it rather than because it is easiest. `matching.ts` is written,
 * argued and tested — it compares quoted against accrued against billed and
 * finds the agent who billed 460 for something quoted at 400 — and it runs on
 * `supplier_invoice_lines`, which somebody types in by hand today. Extraction
 * here does not add a capability. It switches on one that is already paid for.
 *
 * ## A supplier invoice carries its own checksum
 *
 * This is the whole reason the surface is trustworthy, and it is worth stating
 * before anything else in the file.
 *
 * `ai.ts` makes the rule for container numbers: wherever a format verifies
 * itself, verify it and throw the model's confidence away. An invoice verifies
 * itself in a stronger way than a check digit does, because it states the same
 * quantities twice — every line says quantity, unit price *and* amount, and
 * the header says what those lines sum to. A model that misreads 1,240 as
 * 1,249 does not produce a plausible invoice. It produces one that does not
 * add up, and `reconcile` says so in figures a coordinator can read.
 *
 * So nothing here asks how confident the model was about the total. It asks
 * whether the document balances, which is arithmetic, and arithmetic is not an
 * opinion.
 *
 * ## The model produces a spreadsheet, and we already validate those
 *
 * `import.ts` has been turning untrusted rows into our shape since FR-MD-11:
 * typed cell parsers, Arabic-Indic digit normalisation, reference-table
 * lookups, an all-or-nothing report with a line number per issue. A model is
 * another producer of untrusted rows.
 *
 * So extracted lines are laid out as a *grid* — a header row and string cells,
 * exactly what `parseDelimited` hands over — and run through `validateImport`
 * against a descriptor. Every parser, every error message and every bilingual
 * label comes for free, and there is no second, weaker validator beside the
 * tested one.
 */

import {
  cellFail,
  decimal,
  isoDate,
  lookup,
  optional,
  text,
  validateImport,
  withDefault,
  type CellParser,
  type ImportDescriptor,
  type ImportLookups,
  type ImportReport,
} from './import'
import {
  abs,
  compare,
  dec,
  money,
  multiply,
  round,
  subtract,
  sum,
  zero,
  type CurrencySpec,
  type Money,
} from './money'
import { AiError, confidence, type Confidence, type FieldProposal } from './ai'

/* -------------------------------------------------------------------------
 * What we ask the model for
 * ---------------------------------------------------------------------- */

/**
 * The JSON Schema handed to the provider as structured output.
 *
 * Every value is a **string**, including the numbers, and that is deliberate
 * rather than lazy. A JSON number is a double: `1240.55` is not exactly
 * representable, and a supplier invoice in KWD carries three decimals where
 * the error starts to show. Asking for `"1240.550"` and parsing it with
 * `decimal()` keeps the figure exact from the page to `numeric(19,6)` with no
 * float anywhere in between — which is the same rule the wire format obeys
 * everywhere else in this system (§11).
 *
 * `additionalProperties: false` throughout, and **every property named in
 * `required`** — including the ones that are genuinely optional, which are
 * typed nullable instead.
 *
 * That second rule was learned from a live call rather than read in a
 * specification, and it is the more important half. `required` is the list of
 * keys the model must emit; a key left out of it is one the model may simply
 * decline to produce. `minimax/minimax-m3` read a generated invoice perfectly,
 * classified both charge lines, and returned neither `subtotal` nor `total` —
 * and then, on the identical request, returned both. It was never obliged to.
 *
 * The cost of that omission is worse than a missing field, which is why an
 * intermittent version of it is worse still. `reconcileInvoice` compares the
 * lines against the printed net, and with no printed net there is nothing to
 * compare against — so the check that catches a **dropped line** passes in
 * silence. "Optional" in this schema has to mean *the model must tell us it was
 * not printed*, never *the model may stay quiet*.
 */
export const INVOICE_EXTRACTION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'invoiceNumber',
    'invoiceDate',
    'dueOn',
    'currency',
    'subtotal',
    'taxAmount',
    'total',
    'lines',
    'confidence',
  ],
  properties: {
    invoiceNumber: {
      type: 'string',
      description: 'The supplier’s own invoice number, exactly as printed.',
    },
    invoiceDate: { type: 'string', description: 'ISO 8601 date, YYYY-MM-DD.' },
    dueOn: { type: ['string', 'null'], description: 'ISO 8601 date, or null.' },
    currency: { type: 'string', description: 'ISO 4217 code, e.g. KWD, USD, AED.' },
    subtotal: { type: ['string', 'null'], description: 'Net of tax, as printed.' },
    taxAmount: { type: ['string', 'null'], description: 'Tax total, as printed.' },
    total: { type: ['string', 'null'], description: 'Gross total, as printed.' },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'quantity', 'unitPrice', 'amount', 'taxAmount', 'chargeType'],
        properties: {
          description: { type: 'string' },
          quantity: { type: ['string', 'null'] },
          unitPrice: { type: ['string', 'null'] },
          amount: { type: 'string' },
          taxAmount: { type: ['string', 'null'] },
          /**
           * Our charge type, where the line clearly is one.
           *
           * Named rather than coded: the model is shown the list of charge
           * codes this deployment actually has and answers with one of them or
           * with null. It never invents an identifier, and `lookup()` refuses
           * anything not in the set — so an unrecognised charge is an
           * unclassified line a person codes, not a foreign key to nowhere.
           */
          chargeType: { type: ['string', 'null'] },
        },
      },
    },
    confidence: {
      type: 'number',
      description: 'Between 0 and 1, for the extraction as a whole.',
    },
  },
}

/** The raw shape, before anything has been checked. Every field a string. */
export interface RawInvoiceLine {
  readonly description?: unknown
  readonly quantity?: unknown
  readonly unitPrice?: unknown
  readonly amount?: unknown
  readonly taxAmount?: unknown
  readonly chargeType?: unknown
}

export interface RawExtractedInvoice {
  readonly invoiceNumber?: unknown
  readonly invoiceDate?: unknown
  readonly dueOn?: unknown
  readonly currency?: unknown
  readonly subtotal?: unknown
  readonly taxAmount?: unknown
  readonly total?: unknown
  readonly lines?: unknown
  readonly confidence?: unknown
}

/* -------------------------------------------------------------------------
 * The descriptor — the same machinery a CSV goes through
 * ---------------------------------------------------------------------- */

/**
 * A decimal that may be absent, defaulting to a stated value.
 *
 * `quantity` and `unitPrice` are routinely missing from a freight invoice: a
 * documentation fee is a flat charge printed once, with no unit and no count.
 * Defaulting quantity to `1` and unit price to the line amount is what makes
 * the arithmetic below check something real rather than failing on every flat
 * charge in the Gulf.
 */
const money6 = decimal({ allowNegative: true })

/**
 * Charge type, matched against what this deployment actually has.
 *
 * `lookup` is given the *codes*, so a model answering `THC` resolves and one
 * answering `Terminal Handling Charge — Origin` does not. That asymmetry is
 * deliberate: the prompt shows the model the code list, and a free-text answer
 * is a signal the model was guessing rather than reading.
 */
const chargeType = lookup('chargeTypes', { label: 'charge type' })

/**
 * One extracted invoice line, as a row.
 *
 * `required` is only true for the two fields a line cannot be a line without.
 * Everything else is optional and reconciled: refusing a whole invoice because
 * one line omitted its unit price would send a coordinator back to typing all
 * eleven.
 */
export const invoiceLineDescriptor: ImportDescriptor = {
  key: 'supplier-invoice-lines',
  label: 'Supplier invoice lines',
  fields: [
    {
      key: 'description',
      label: 'Description',
      required: true,
      parse: text({ min: 1, max: 500 }),
      hint: 'Their words, not ours.',
    },
    {
      key: 'quantity',
      label: 'Quantity',
      required: false,
      parse: withDefault(money6, '1'),
      hint: 'Defaults to 1 for a flat charge.',
    },
    {
      key: 'unitPrice',
      label: 'Unit price',
      required: false,
      parse: optional(money6),
    },
    {
      key: 'amount',
      label: 'Amount',
      required: true,
      parse: money6,
    },
    {
      key: 'taxAmount',
      label: 'Tax',
      required: false,
      parse: withDefault(money6, '0'),
    },
    {
      key: 'chargeType',
      label: 'Charge type',
      required: false,
      parse: optional(chargeType),
    },
  ],
}

/** Header cells, in the order `invoiceLinesGrid` writes them. */
const LINE_HEADERS = ['description', 'quantity', 'unitPrice', 'amount', 'taxAmount', 'chargeType']

/**
 * The model's lines, as the grid `validateImport` expects.
 *
 * A header row and string cells — the same thing `parseDelimited` produces
 * from a CSV, which is the point. Nulls become empty cells, because an absent
 * value and a blank spreadsheet cell mean the same thing to every parser in
 * `import.ts` and teaching them a third emptiness would be a second way to be
 * wrong.
 */
export function invoiceLinesGrid(lines: readonly RawInvoiceLine[]): string[][] {
  const cell = (value: unknown): string =>
    value === null || value === undefined ? '' : String(value)

  return [
    [...LINE_HEADERS],
    ...lines.map((line) => [
      cell(line.description),
      cell(line.quantity),
      cell(line.unitPrice),
      cell(line.amount),
      cell(line.taxAmount),
      cell(line.chargeType),
    ]),
  ]
}

export interface InvoiceLineValues {
  readonly description: string
  readonly quantity: string
  /** `null` where the supplier printed a flat charge with no unit. */
  readonly unitPrice: string | null
  readonly amount: string
  readonly taxAmount: string
  /** `null` where the line is not clearly one of our charge codes. */
  readonly chargeType: string | null
}

export interface InvoiceHeaderValues {
  readonly invoiceNumber: string
  readonly invoiceDate: string
  readonly dueOn?: string
  readonly currency: string
  readonly subtotal?: string
  readonly taxAmount?: string
  readonly total?: string
}

export interface ExtractedInvoice {
  readonly header: InvoiceHeaderValues
  readonly lines: ImportReport<InvoiceLineValues>
  readonly confidence: number
  /** Header problems, in the same shape a row issue takes. */
  readonly headerIssues: readonly string[]
}

/* --- the header, checked by hand because it is not a row ---------------- */

const required = <T>(parser: CellParser<T>, label: string): CellParser<T> => {
  return (raw, context) =>
    raw.trim() === '' ? cellFail(`${label} is required`) : parser(raw, context)
}

const currencyCode = lookup('currencies', { label: 'currency', length: 3 })

/**
 * Read what the model returned into checked values.
 *
 * The header is validated field by field rather than as a one-row grid,
 * because it is not a row: its problems are *"this invoice has no number"*,
 * not *"line 2, column C"*, and reporting them with a line number would send
 * somebody looking for a row that does not exist.
 *
 * The lines go through `validateImport` unchanged, which means `ok` carries
 * its usual meaning — `FR-MD-11`'s rule that a file with errors imports
 * nothing. A caller that writes lines from a report where `ok` is false has
 * misunderstood the contract, and there is exactly one place that decides
 * (`applyExtractedInvoice` in the service).
 */
export function readExtractedInvoice(
  raw: RawExtractedInvoice,
  lookups: ImportLookups,
): ExtractedInvoice {
  const headerIssues: string[] = []

  /*
    `optional()` answers `null` for a blank cell and this answers `undefined`
    for both blank and invalid, which is the distinction the caller actually
    wants: every optional header field means "the page did not print one", and
    a caller forced to handle `null` and `undefined` separately would write the
    same branch twice and get one of them wrong.
  */
  const read = <T>(
    parser: CellParser<T>,
    value: unknown,
    label: string,
  ): NonNullable<T> | undefined => {
    const result = parser(value === null || value === undefined ? '' : String(value), { lookups })
    if (result.ok) return result.value ?? undefined
    headerIssues.push(`${label}: ${result.message}`)
    return undefined
  }

  const invoiceNumber = read(
    required(text({ min: 1, max: 100 }), 'Invoice number'),
    raw.invoiceNumber,
    'Invoice number',
  )
  const invoiceDate = read(required(isoDate, 'Invoice date'), raw.invoiceDate, 'Invoice date')
  const currency = read(required(currencyCode, 'Currency'), raw.currency, 'Currency')
  const dueOn = read(optional(isoDate), raw.dueOn, 'Due date')
  const subtotal = read(optional(money6), raw.subtotal, 'Subtotal')
  const taxAmount = read(optional(money6), raw.taxAmount, 'Tax')
  const total = read(optional(money6), raw.total, 'Total')

  const lines = Array.isArray(raw.lines) ? (raw.lines as RawInvoiceLine[]) : []
  if (lines.length === 0) headerIssues.push('Lines: the model found no invoice lines')

  const report = validateImport<InvoiceLineValues>(invoiceLinesGrid(lines), invoiceLineDescriptor, {
    lookups,
  })

  /*
    Clamped here rather than trusted, and `confidence` in `ai.ts` says why: a
    model that answers 1.2 has said "very sure" in a malformed way, and losing
    eleven correct fields over the formatting of one number is the wrong trade.
  */
  const stated = Number(raw.confidence)
  const confidence = Number.isFinite(stated) ? Math.min(1, Math.max(0, stated)) : 0

  return {
    header: {
      invoiceNumber: invoiceNumber ?? '',
      invoiceDate: invoiceDate ?? '',
      dueOn,
      currency: currency ?? '',
      subtotal,
      taxAmount,
      total,
    },
    lines: report,
    confidence,
    headerIssues,
  }
}

/* -------------------------------------------------------------------------
 * Reconciliation — the part that makes this trustworthy
 * ---------------------------------------------------------------------- */

export type ArithmeticCheck = 'line_amount' | 'subtotal' | 'total'

/**
 * One place the document does not add up.
 *
 * Both figures are carried, never a boolean. *"Line 3 says 450.000 but 3 ×
 * 150.500 is 451.500"* is a sentence a coordinator acts on in seconds; *"line
 * 3 failed validation"* is one they have to reconstruct from the PDF, which
 * costs more than typing the line would have.
 */
export interface ArithmeticFinding {
  readonly check: ArithmeticCheck
  /** The line number as `import.ts` counts them — the header is line 1. */
  readonly line?: number
  readonly stated: Money
  readonly computed: Money
  readonly difference: Money
}

/**
 * Does this invoice add up?
 *
 * Three checks, and each one catches a different misreading:
 *
 *   `line_amount`  quantity × unit price against the printed amount — catches
 *                  a digit misread in any one of the three
 *   `subtotal`     the lines against the printed net — catches a line missed
 *                  entirely, which no per-line check can see
 *   `total`        net plus tax against the printed gross — catches a tax
 *                  figure read off the wrong row
 *
 * The middle one is the one worth having. A model that skips a line produces
 * output where every individual line is perfectly correct, and the only
 * evidence anything is missing is that the remaining lines no longer sum to
 * the total the supplier printed.
 *
 * ## Why comparison is exact after rounding, with no tolerance
 *
 * `matching.ts` has a tolerance and it is right to: it compares *our* accrual
 * against *their* bill, two figures that were arrived at independently and are
 * allowed to differ. This compares a document against itself. A supplier's own
 * invoice adds up in their accounting system or they have a bigger problem
 * than we do, so a discrepancy here is our reading being wrong, not theirs —
 * and a tolerance would do nothing but let small misreadings through silently.
 *
 * Both sides are rounded to the currency's minor units first, because the
 * printed page is rounded and comparing an unrounded product against a printed
 * figure would flag every invoice with a fractional unit price on it.
 */
export function reconcileInvoice(
  extracted: ExtractedInvoice,
  spec: CurrencySpec,
): ArithmeticFinding[] {
  const findings: ArithmeticFinding[] = []
  const code = spec.code
  const at = (value: string | undefined): Money | undefined =>
    value === undefined ? undefined : round(money(value, code), spec)

  const rows = extracted.lines.rows

  /* --- per line ------------------------------------------------------- */

  for (const row of rows) {
    const { quantity, unitPrice, amount } = row.values
    // Nothing to check where the supplier printed no unit price: a flat fee
    // states its amount once and inventing a unit price to verify it against
    // would be checking our own arithmetic rather than theirs.
    if (unitPrice === undefined || unitPrice === null) continue

    const stated = round(money(amount, code), spec)
    const computed = round(multiply(money(unitPrice, code), dec(quantity)), spec)

    if (compare(stated, computed) !== 0) {
      findings.push({
        check: 'line_amount',
        line: row.line,
        stated,
        computed,
        difference: subtract(stated, computed),
      })
    }
  }

  /* --- the lines against the printed net ------------------------------ */

  const lineSum = round(
    sum(
      rows.map((row) => money(row.values.amount, code)),
      code,
    ),
    spec,
  )

  const statedSubtotal = at(extracted.header.subtotal)
  if (statedSubtotal && compare(statedSubtotal, lineSum) !== 0) {
    findings.push({
      check: 'subtotal',
      stated: statedSubtotal,
      computed: lineSum,
      difference: subtract(statedSubtotal, lineSum),
    })
  }

  /* --- net plus tax against the printed gross ------------------------- */

  const statedTotal = at(extracted.header.total)
  if (statedTotal) {
    /*
      The subtotal the supplier printed, where they printed one, and our sum
      of the lines otherwise.

      Preferring theirs matters: if a line was missed, the subtotal check above
      has already reported it, and deriving the gross from our short sum would
      report the *same* single fault a second time as a total mismatch. One
      missing line should produce one finding a coordinator can act on, not two
      that look like two problems.
    */
    const net = statedSubtotal ?? lineSum
    const tax = at(extracted.header.taxAmount) ?? zero(code)
    const computed = round(money(net.amount.plus(tax.amount), code), spec)

    if (compare(statedTotal, computed) !== 0) {
      findings.push({
        check: 'total',
        stated: statedTotal,
        computed,
        difference: subtract(statedTotal, computed),
      })
    }
  }

  return findings
}

/**
 * Whether this extraction may be written without a person reading the PDF.
 *
 * Deliberately strict, and the strictness is the feature. Four conditions, and
 * only the first is about the model:
 *
 *   - it said it was sure, above the deployment's threshold;
 *   - every line parsed, by `FR-MD-11`'s all-or-nothing rule;
 *   - **the document adds up**;
 *   - and there was something to add it up *against*.
 *
 * The last is the subtle one and it is not hypothetical — a live model read a
 * two-line invoice correctly and returned no subtotal and no total, so
 * `reconcileInvoice` had nothing to compare the lines with and returned no
 * findings at all. Absence of findings is not evidence of correctness when
 * nothing was checked, and a multi-line invoice with no printed net is exactly
 * the shape a dropped line hides in. One line needs no cross-check: it *is*
 * the total, and a debit note that prints nothing but an amount is ordinary.
 *
 * The third does most of the work. A confident model that misread a digit
 * fails it; a hesitant model that read the page correctly passes. That is the
 * right way round, and it is only available because an invoice states its
 * quantities twice.
 *
 * Note what this does *not* decide: whether the bill is correct. Whether the
 * agent has billed what they quoted is `matching.ts`'s question, it has a
 * tolerance and a variance report, and it is asked of rows that are already
 * captured. This asks only whether we read the page right.
 */
export function isSelfConsistent(
  extracted: ExtractedInvoice,
  spec: CurrencySpec,
  confidenceThreshold: number,
): boolean {
  if (extracted.headerIssues.length > 0) return false
  if (!extracted.lines.ok) return false
  if (extracted.lines.rows.length === 0) return false
  if (extracted.confidence < confidenceThreshold) return false

  /*
    Nothing to reconcile against. See the note above: with two or more lines
    and no printed net, the arithmetic that would catch a missing line has no
    second figure to use, and reports success by doing nothing.
  */
  const hasStatedTotal =
    extracted.header.subtotal !== undefined || extracted.header.total !== undefined
  if (extracted.lines.rows.length > 1 && !hasStatedTotal) return false

  return reconcileInvoice(extracted, spec).length === 0
}

/**
 * The header total, or the sum of the lines where the page printed none.
 *
 * Every caller wants this and none of them should decide it: a supplier
 * invoice with no printed gross is ordinary — a single-line agent debit note
 * often has nothing but the amount — and each caller inventing its own
 * fallback is how two screens disagree about what a bill is worth.
 */
export function invoiceTotal(extracted: ExtractedInvoice, spec: CurrencySpec): Money {
  const code = spec.code
  if (extracted.header.total !== undefined) return round(money(extracted.header.total, code), spec)

  const net = sum(
    extracted.lines.rows.map((row) => money(row.values.amount, code)),
    code,
  )
  const tax = extracted.header.taxAmount ?? '0'
  return round(money(net.amount.plus(dec(tax)), code), spec)
}

/**
 * A short, readable account of what did not add up.
 *
 * Text rather than a component, because the same sentence has to appear in a
 * worker log, on a review queue and in a service response, and three
 * renderings of one fact drift. Not localised here: `core` holds no messages,
 * and the caller has the locale.
 */
export function describeFinding(finding: ArithmeticFinding): string {
  const where = finding.line ? `line ${finding.line}` : finding.check
  const stated = finding.stated.amount.toFixed()
  const computed = finding.computed.amount.toFixed()
  return `${where}: the document says ${stated}, the figures give ${computed}`
}

/** Total absolute drift, for ordering a review queue by how wrong it is. */
export function driftMagnitude(findings: readonly ArithmeticFinding[], spec: CurrencySpec): Money {
  return round(
    sum(
      findings.map((finding) => abs(finding.difference)),
      spec.code,
    ),
    spec,
  )
}

/* -------------------------------------------------------------------------
 * The enquiry — FR-EQ-02's twelve null columns
 * ---------------------------------------------------------------------- */

/**
 * The fields an enquiry extraction may speak to, in the order a form asks them.
 *
 * The same twelve as `EXTRACTABLE_FIELDS.enquiry_extract` in `ai.ts`, and that
 * duplication is deliberate: this list is what the *provider* is told, the
 * other is what the *system* will accept, and `extraction.test.ts` asserts
 * they agree. One list would be tidier and would remove the only check that
 * catches a schema loosened without the allowlist following it.
 */
export const ENQUIRY_FIELDS = [
  'mode',
  'tradeDirection',
  'origin',
  'destination',
  'commodity',
  'incoterm',
  'readyOn',
  'grossWeightKg',
  'volumeCbm',
  'pieces',
  'dimensions',
  'isDangerous',
] as const

export type EnquiryField = (typeof ENQUIRY_FIELDS)[number]

/**
 * What we ask for when reading an emailed enquiry.
 *
 * An array of proposals rather than an object of twelve nullable fields, and
 * the shape is doing real work. A model asked for `{mode: null, origin: null,
 * …}` answers with twelve keys whatever the mail said, and every one of those
 * nulls then has to be filtered back out; a model asked for a list answers
 * with what it found. More importantly the array element *is* `FieldProposal`
 * — field, value, confidence, evidence — so nothing between here and
 * `extraction_proposals` has to reshape it, and there is no second place where
 * a confidence could be attached to the wrong field.
 *
 * `evidence` is required-but-nullable for the reason the invoice schema
 * documents at length: `required` is the list of keys the model must emit, and
 * a key outside it may simply be declined. Evidence is the whole difference
 * between a coordinator confirming *"2 × 40HC, from line 3"* and re-reading
 * the mail, so it has to be a thing the model states it could not find rather
 * than a thing it can quietly omit.
 *
 * Every value is a **string**, including the weights and the piece count, for
 * the same reason the invoice schema gives: a JSON number is a double, and
 * these land in `numeric` columns through the same `decimal()` parser a
 * spreadsheet goes through. `isDangerous` is `"true"` / `"false"`.
 */
export const ENQUIRY_EXTRACTION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['fields', 'confidence'],
  properties: {
    fields: {
      type: 'array',
      description: 'One entry per fact found in the mail. Omit a field entirely if absent.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'value', 'confidence', 'evidence'],
        properties: {
          field: { type: 'string', enum: [...ENQUIRY_FIELDS] },
          value: { type: 'string', description: 'The value as text. Never null — omit instead.' },
          confidence: { type: 'number', description: 'Your own estimate, 0 to 1.' },
          evidence: {
            type: ['string', 'null'],
            description: 'The span of the mail this was read from, quoted. Null if none.',
          },
        },
      },
    },
    confidence: { type: 'number', description: 'Your confidence in the extraction as a whole.' },
  },
}

export interface ExtractedEnquiry {
  readonly fields: readonly FieldProposal[]
  readonly confidence: Confidence
  /**
   * Fields the model named that are not on the list.
   *
   * Kept rather than dropped, and handed to `admissible()` by the caller. A
   * model that answered `customerId` is either a prompt bug or a mail that
   * talked it into one, and both want a row somebody can find — `ai.ts` argues
   * this at its own refusal path and the argument is the same here.
   */
  readonly unknownFields: readonly string[]
}

/**
 * Read the model's answer into proposals.
 *
 * Refuses the response as a whole only when it is not the shape asked for.
 * A single malformed entry is dropped and the rest kept, because the failure
 * this guards against is *one* field arriving with a confidence of `"high"` —
 * and throwing away eleven good facts over the twelfth is a worse outcome than
 * the coordinator typing one of them.
 */
export function readExtractedEnquiry(raw: unknown): ExtractedEnquiry {
  if (typeof raw !== 'object' || raw === null) {
    throw new AiError('extraction.not_an_object', 'The extraction was not a JSON object.')
  }

  const body = raw as Record<string, unknown>
  if (!Array.isArray(body.fields)) {
    throw new AiError('extraction.no_fields', 'The extraction carried no `fields` array.')
  }

  const permitted = new Set<string>(ENQUIRY_FIELDS)
  const fields: FieldProposal[] = []
  const unknownFields: string[] = []

  for (const entry of body.fields) {
    if (typeof entry !== 'object' || entry === null) continue
    const cell = entry as Record<string, unknown>

    const field = typeof cell.field === 'string' ? cell.field.trim() : ''
    if (field === '') continue
    if (!permitted.has(field)) {
      unknownFields.push(field)
      continue
    }

    /*
      A value is text and it is trimmed, and nothing else is done to it here.

      Normalisation belongs to `import.ts` — Arabic-Indic digits, thousands
      separators, the lot — because that is where every other untrusted row in
      this system is normalised and a second implementation would drift from
      it. What this loop decides is only whether there is a proposal at all.
    */
    const value = typeof cell.value === 'string' ? cell.value.trim() : ''
    if (value === '') continue

    let scored: Confidence
    try {
      scored = confidence(cell.confidence)
    } catch {
      // One unreadable score is not a reason to lose eleven readable facts.
      continue
    }

    const evidence = typeof cell.evidence === 'string' ? cell.evidence.trim() : ''
    fields.push({ field, value, confidence: scored, ...(evidence === '' ? {} : { evidence }) })
  }

  return {
    fields,
    confidence: confidence(body.confidence ?? 0),
    unknownFields,
  }
}
