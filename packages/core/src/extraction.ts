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
  integer,
  isoDate,
  lookup,
  normaliseDigits,
  oneOf,
  optional,
  text,
  validateImport,
  withDefault,
  type CellParser,
  type ImportDescriptor,
  type ImportIssueCode,
  type ImportLookups,
  type ImportReport,
  type ImportRow,
  type IssueValues,
  type RateRowValues,
} from './import'
import {
  abs,
  add,
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
import { BASES, calcCharge, type ChargeContext } from './rating'
import { MissingChargeContextError } from './errors'
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
  /**
   * The same header problems, coded — see `InvoiceReadingIssue`. Parallel to
   * `headerIssues` rather than replacing it, because the worker log and the
   * model check print the English and have no catalogue to word a code with.
   */
  readonly headerIssueDetails: readonly InvoiceReadingIssue[]
}

/** The header fields a reading can fail on; `lines` is "there were none". */
export type InvoiceHeaderField =
  | 'invoiceNumber'
  | 'invoiceDate'
  | 'currency'
  | 'dueOn'
  | 'subtotal'
  | 'taxAmount'
  | 'total'
  | 'lines'

/** The one problem a reading has that no cell parser reports. */
export type InvoiceReadingCode = ImportIssueCode | 'noLines'

/**
 * One reason a bill could not be read, as data.
 *
 * `core` holds no messages (§4), so a screen needs the code, the field and the
 * line to say this in the reader's language; `message` is English, for logs
 * and tests. `field` is an `InvoiceHeaderField` on a header issue and the
 * descriptor's field key (`invoiceLineDescriptor`) on a line issue. `line` is
 * the row number `validateImport` gives — the same number the arithmetic
 * findings carry, so the two kinds of problem point at the same line.
 */
export interface InvoiceReadingIssue {
  readonly where: 'header' | 'line'
  readonly field: string
  readonly line?: number
  readonly code: InvoiceReadingCode
  readonly values?: IssueValues
  readonly message: string
}

/**
 * Every reading problem on a bill, header first, as data.
 *
 * The lines' issues already carry a code from `validateImport`; this puts the
 * header's beside them in one shape, so a caller translates one list.
 */
export function invoiceReadingIssues(extracted: ExtractedInvoice): InvoiceReadingIssue[] {
  return [
    ...extracted.headerIssueDetails,
    ...extracted.lines.issues.map((issue): InvoiceReadingIssue => ({
      where: 'line',
      field: issue.field ?? '',
      line: issue.line,
      code: issue.code,
      ...(issue.values === undefined ? {} : { values: issue.values }),
      message: issue.message,
    })),
  ]
}

/* --- the header, checked by hand because it is not a row ---------------- */

const required = <T>(parser: CellParser<T>, label: string): CellParser<T> => {
  return (raw, context) =>
    raw.trim() === '' ? cellFail('required', `${label} is required`) : parser(raw, context)
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
  const headerIssueDetails: InvoiceReadingIssue[] = []

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
    field: InvoiceHeaderField,
  ): NonNullable<T> | undefined => {
    const result = parser(value === null || value === undefined ? '' : String(value), { lookups })
    if (result.ok) return result.value ?? undefined
    headerIssues.push(`${label}: ${result.message}`)
    headerIssueDetails.push({
      where: 'header',
      field,
      code: result.code,
      ...(result.values === undefined ? {} : { values: result.values }),
      message: result.message,
    })
    return undefined
  }

  const invoiceNumber = read(
    required(text({ min: 1, max: 100 }), 'Invoice number'),
    raw.invoiceNumber,
    'Invoice number',
    'invoiceNumber',
  )
  const invoiceDate = read(
    required(isoDate, 'Invoice date'),
    raw.invoiceDate,
    'Invoice date',
    'invoiceDate',
  )
  const currency = read(required(currencyCode, 'Currency'), raw.currency, 'Currency', 'currency')
  const dueOn = read(optional(isoDate), raw.dueOn, 'Due date', 'dueOn')
  const subtotal = read(optional(money6), raw.subtotal, 'Subtotal', 'subtotal')
  const taxAmount = read(optional(money6), raw.taxAmount, 'Tax', 'taxAmount')
  const total = read(optional(money6), raw.total, 'Total', 'total')

  const lines = Array.isArray(raw.lines) ? (raw.lines as RawInvoiceLine[]) : []
  if (lines.length === 0) {
    headerIssues.push('Lines: the model found no invoice lines')
    headerIssueDetails.push({
      where: 'header',
      field: 'lines',
      code: 'noLines',
      message: 'the model found no invoice lines',
    })
  }

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
    headerIssueDetails,
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
 * The same list as `EXTRACTABLE_FIELDS.enquiry_extract` in `ai.ts`, and that
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
  /*
    How many containers, which is not `pieces`: a FCL quotation multiplies every
    per-container rate by this and refuses without it (F39), and before the
    model could propose it every mailed enquiry reached pricing with the one
    number pricing cannot guess. Offered after `pieces` so the two sit side by
    side in the prompt the model reads, which is where they get confused.
  */
  'containerCount',
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
      A value is text and it is trimmed. The four quantities are then reduced
      to the one number they state, or the proposal is dropped — see
      `proposedQuantity`. Everything else is left as the model wrote it, for
      the accept path to refuse with a sentence if it must.
    */
    const trimmed = typeof cell.value === 'string' ? cell.value.trim() : ''
    const value = QUANTITY_FIELDS.has(field) ? proposedQuantity(field, trimmed) : trimmed
    if (value === null || value === '') continue

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

  /*
    A container count only means something on a FCL shipment. Where the same
    reading says the mode is something else, the count is the model mistaking
    "2 pallets in a shared container" for an equipment order, and proposing it
    would put a number on an air enquiry that nothing ever reads.
  */
  const statedMode = fields.find((proposal) => proposal.field === 'mode')?.value

  return {
    fields: withoutStrayContainerCount(fields, statedMode),
    confidence: confidence(body.confidence ?? 0),
    unknownFields,
  }
}

/**
 * The enquiry fields that are numbers, and whether each must be whole.
 *
 * `false` is a decimal quantity (`numeric` on the enquiry), `true` a count.
 */
const QUANTITY_FIELDS = new Map<string, boolean>([
  ['grossWeightKg', false],
  ['volumeCbm', false],
  ['pieces', true],
  ['containerCount', true],
])

/*
  The unit a field may carry beside its figure, and nothing else. A unit that is
  not the column's own — "18 tonnes" in a kilogram column, "40 ft" as a count —
  is not stripped, so the leftover text fails the check below and the proposal
  is dropped rather than stored a thousand times too small. Stripped *before*
  the figure is looked for, because "m3" carries a digit of its own.
*/
const QUANTITY_UNITS: Readonly<Record<string, RegExp>> = {
  grossWeightKg: /(kgs?|kilos?|kilograms?|كغ|كجم|كيلو(غرام)?)(?![\p{L}\p{N}])/giu,
  volumeCbm: /(cbm|m3|m³|cubic\s+met(er|re)s?|م3|م³|متر\s+مكعب)(?![\p{L}\p{N}])/giu,
  pieces:
    /(pcs?|pieces?|pkgs?|packages?|ctns?|cartons?|pallets?|قطع(ة)?|طرود|طرد)(?![\p{L}\p{N}])/giu,
  containerCount: /(containers?|cntrs?|ctrs?|units?|حاويات|حاوية)(?![\p{L}\p{N}])/giu,
}

/*
  "2 x 40HC" is how equipment is written, and the model sometimes hands the
  whole phrase back as the count. The figure before a single multiplication
  sign is the count; the tail is the equipment type, which carries digits of
  its own and is ignored. The tail must be one equipment code ("40HC", "40' HC",
  "20GP", "HC") and nothing more: a mixed order like "2 x 20GP + 1 x 40HC" or
  "2 x 40HC and 20GP" is not a count this can state, so it falls through to the
  one-number rule and is dropped.
*/
const EQUIPMENT_ORDER = /^(\d+)\s*[x×*]\s*(\d{2}\s*['’]?\s*[a-z]{0,4}|[a-z]{2,4})?\s*$/iu

/**
 * One quantity the model proposed, reduced to the number it states — or `null`.
 *
 * F59: the model answered a container count of `":2"`. It was stored as-is,
 * the accept path could never apply it, and the enquiry reached pricing
 * without the one number FCL refuses to guess. The accept path is right to
 * refuse; the mistake was proposing it.
 *
 * Deliberately conservative. The text may hold exactly **one** figure, plus
 * whitespace, punctuation and the field's own unit; anything else — two
 * figures ("2-3 pallets"), a word ("about 18"), a unit that is not ours — drops
 * the proposal. A dropped proposal costs a coordinator one typed field; a
 * guessed one puts a wrong weight on a quotation. The figure itself goes
 * through `import.ts`'s `decimal`, so Arabic-Indic digits and thousands
 * separators ("18,000") are read the way every spreadsheet row is, and the
 * value stays a string — never a JS number — on its way to `numeric`.
 */
export function proposedQuantity(field: string, raw: string): string | null {
  const whole = QUANTITY_FIELDS.get(field)
  if (whole === undefined) return raw

  let value = normaliseDigits(raw).trim()
  if (field === 'containerCount') {
    const order = EQUIPMENT_ORDER.exec(value)
    if (order) value = order[1]!
  }
  const unit = QUANTITY_UNITS[field]
  if (unit) value = value.replace(unit, ' ')

  // A figure starts and ends with a digit, so ":2." yields "2", not "2.".
  const figures = value.match(/\d(?:[\d.,]*\d)?/g) ?? []
  if (figures.length !== 1) return null
  const figure = figures[0]!

  // What is left must be punctuation and space only. A minus sign is not
  // punctuation here: a negative weight is not a weight.
  const rest = value.replace(figure, '')
  if (!/^[\s\p{P}]*$/u.test(rest) || /[-−]/u.test(rest)) return null

  const parsed = decimal({ min: 0 })(figure, { lookups: {} })
  if (!parsed.ok) return null
  if (whole && !/^\d+$/.test(parsed.value)) return null
  return parsed.value
}

/**
 * Whether a container count belongs on an enquiry of this mode.
 *
 * An unknown mode is a yes: the text stated a count, and a count with no mode
 * beside it is the "2 x 40HC" enquiry whose mode is proposed separately or
 * typed later. Only a mode we *know* is not sea FCL rules it out.
 */
export function containerCountFitsMode(mode: string | null | undefined): boolean {
  return mode === null || mode === undefined || mode.trim() === '' || mode.trim() === 'sea_fcl'
}

/**
 * The proposals, less a `containerCount` that the known mode says cannot apply.
 *
 * One rule for both places a mode can be known — what the model read in the
 * same mail (`readExtractedEnquiry`) and what the enquiry already holds (the
 * worker) — so the two cannot disagree about what "FCL only" means.
 */
export function withoutStrayContainerCount(
  fields: readonly FieldProposal[],
  mode: string | null | undefined,
): FieldProposal[] {
  if (containerCountFitsMode(mode)) return [...fields]
  return fields.filter((proposal) => proposal.field !== 'containerCount')
}

/* -------------------------------------------------------------------------
 * Rate replies — reading a broker's quote off an email — FR-RT-10, `rate_extract`
 * ---------------------------------------------------------------------- */

/**
 * The other side of rate procurement, and it reuses everything above.
 *
 * A supplier invoice and a broker's rate reply are the same kind of document
 * read the same way: a header, a set of charge lines, every figure a string so
 * KWD's three decimals survive the trip through JSON. The one difference that
 * matters is what the model is *not* asked for — the lane. We emailed this
 * broker about a specific enquiry, so origin, destination and mode are ours,
 * already resolved to codes, and the model that reads the reply never gets to
 * have an opinion about which port "Jebel Ali" is. It reads charges against a
 * lane we hand it, and `readExtractedRateReply` welds the two together into
 * exactly the flat rows the CSV importer produces — so `groupRateCards` folds a
 * parsed email into a rate card with no second code path (AI_Surface §rate).
 *
 * The allowlist in `ai.ts` still names `origin`, `destination` and `mode`,
 * because the schema below asks the model to *restate* the lane it thinks it is
 * quoting; a mismatch is a signal worth surfacing, not a value we store. What we
 * store is the lane we asked about.
 */
export const RATE_EXTRACTION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  // Every key required — a rate reply that omits `declined` is one where we
  // cannot tell "no charges yet" from "no thanks". See the invoice schema note
  // above: a model may drop any key not on this list, and silence here is the
  // expensive kind.
  required: [
    'declined',
    'declinedReason',
    'currency',
    'validFrom',
    'validTo',
    'lines',
    'confidence',
  ],
  properties: {
    declined: {
      type: 'boolean',
      description: 'True if the broker declined to quote this lane at all.',
    },
    declinedReason: {
      type: ['string', 'null'],
      description: 'Their stated reason for declining, verbatim, or null.',
    },
    currency: {
      type: ['string', 'null'],
      description: 'ISO 4217 code the quote is in, e.g. USD, KWD, AED. Null if unstated.',
    },
    validFrom: {
      type: ['string', 'null'],
      description: 'ISO 8601 date the rate is valid from, or null if unstated.',
    },
    validTo: {
      type: ['string', 'null'],
      description: 'ISO 8601 date the rate expires, or null for open-ended.',
    },
    /** The lane the model believes it read — restated for a mismatch check, never stored. */
    origin: {
      type: ['string', 'null'],
      description: 'Origin the model read, for cross-check only.',
    },
    destination: {
      type: ['string', 'null'],
      description: 'Destination the model read, for cross-check only.',
    },
    mode: { type: ['string', 'null'], description: 'Mode the model read, for cross-check only.' },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'chargeType',
          'basis',
          'rate',
          'currency',
          'minimum',
          'maximum',
          'containerType',
        ],
        properties: {
          chargeType: {
            type: ['string', 'null'],
            description: 'Our charge type key, from the list shown, or null if it is not one.',
          },
          basis: {
            type: 'string',
            description: `How the charge is calculated: one of ${BASES.join(', ')}.`,
          },
          rate: { type: 'string', description: 'The amount, as printed.' },
          currency: {
            type: ['string', 'null'],
            description: 'This line’s currency if it differs from the header, else null.',
          },
          minimum: { type: ['string', 'null'], description: 'Minimum charge, or null.' },
          maximum: { type: ['string', 'null'], description: 'Maximum charge, or null.' },
          containerType: {
            type: ['string', 'null'],
            description: 'e.g. 20GP, 40HC, where the rate is per container, else null.',
          },
        },
      },
    },
    confidence: { type: 'number', description: 'Between 0 and 1, for the reply as a whole.' },
  },
}

/** The raw shape of one extracted rate line, before anything is checked. */
export interface RawRateLine {
  readonly chargeType?: unknown
  readonly basis?: unknown
  readonly rate?: unknown
  readonly currency?: unknown
  readonly minimum?: unknown
  readonly maximum?: unknown
  readonly containerType?: unknown
}

export interface RawExtractedRateReply {
  readonly declined?: unknown
  readonly declinedReason?: unknown
  readonly currency?: unknown
  readonly validFrom?: unknown
  readonly validTo?: unknown
  readonly origin?: unknown
  readonly destination?: unknown
  readonly mode?: unknown
  readonly lines?: unknown
  readonly confidence?: unknown
}

/** The lane we asked about — the model does not get to choose it. */
export interface RateReplyLane {
  readonly mode: string
  readonly originCode: string
  readonly destinationCode: string
}

/**
 * Modes, hard-coded for the same reason `enquiry-extract` hard-codes them:
 * `transport_mode` is a Postgres enum, not a reference row, so this cannot
 * drift without a migration, and `rate-extract.test.ts` pins it to the enum.
 */
export const MODES = ['sea_fcl', 'sea_lcl', 'air', 'land', 'courier'] as const

/** The header currency parser — a code we actually hold, three letters. */
const rateCurrencyCode: CellParser<string> = lookup('currencies', { label: 'currency', length: 3 })

/**
 * The descriptor a parsed reply is validated against.
 *
 * The same fourteen fields the rate-card CSV carries, so a validated row *is* a
 * `RateRowValues` and drops straight into `groupRateCards`. No aliases and no
 * synonyms: unlike a human's spreadsheet, this grid is machine-built with the
 * columns already in our names, so the only job left is parsing and lookup.
 */
export const rateReplyDescriptor: ImportDescriptor = {
  key: 'rate-reply-lines',
  label: 'Rate reply lines',
  fields: [
    { key: 'mode', label: 'Mode', required: true, parse: oneOf(MODES) },
    {
      key: 'originCode',
      label: 'Origin',
      required: true,
      parse: lookup('locations', { label: 'location' }),
    },
    {
      key: 'destinationCode',
      label: 'Destination',
      required: true,
      parse: lookup('locations', { label: 'location' }),
    },
    { key: 'currency', label: 'Currency', required: true, parse: rateCurrencyCode },
    { key: 'validFrom', label: 'Valid from', required: true, parse: isoDate },
    { key: 'validTo', label: 'Valid to', required: false, parse: optional(isoDate) },
    {
      key: 'chargeCode',
      label: 'Charge',
      required: true,
      parse: lookup('chargeTypes', { label: 'charge type' }),
    },
    { key: 'basis', label: 'Basis', required: true, parse: oneOf(BASES) },
    { key: 'rate', label: 'Rate', required: true, parse: decimal() },
    { key: 'minimum', label: 'Minimum', required: false, parse: optional(decimal()) },
    { key: 'maximum', label: 'Maximum', required: false, parse: optional(decimal()) },
    {
      key: 'containerType',
      label: 'Container',
      required: false,
      parse: optional(text({ max: 10 })),
    },
    {
      key: 'transitDays',
      label: 'Transit days',
      required: false,
      parse: optional(integer({ min: 0, max: 400 })),
    },
    { key: 'notes', label: 'Notes', required: false, parse: optional(text({ max: 500 })) },
  ],
}

/** Column order for the grid the reply is validated as. */
const RATE_ROW_HEADERS = [
  'mode',
  'originCode',
  'destinationCode',
  'currency',
  'validFrom',
  'validTo',
  'chargeCode',
  'basis',
  'rate',
  'minimum',
  'maximum',
  'containerType',
  'transitDays',
  'notes',
] as const

export interface ExtractedRateReply {
  /** The broker declined to quote — a legitimate, terminal answer (FR-RT-10). */
  readonly declined: boolean
  readonly declinedReason?: string
  /** The header currency the lines default to, checked, or undefined if unstated. */
  readonly currency?: string
  /** The lane the model claimed to read — set only when it disagrees with ours. */
  readonly laneMismatch?: string
  /** The validated lines, in the exact shape `groupRateCards` consumes. */
  readonly lines: ImportReport<RateRowValues>
  readonly confidence: number
  readonly headerIssues: readonly string[]
}

/**
 * Read a broker's rate reply into rows we can price and promote.
 *
 * `lane` is ours — the enquiry we asked about. The model's charges are welded
 * onto it, validated once through the descriptor above, and handed back as an
 * `ImportReport` a caller stores as `rate_requests.response` and, on a human's
 * accept, feeds to `groupRateCards`. A declined reply short-circuits: there is
 * nothing to price and nothing to promote, but "no thanks" is an answer the
 * board must show, so it is a value and not an absence.
 */
export function readExtractedRateReply(
  raw: RawExtractedRateReply,
  lookups: ImportLookups,
  lane: RateReplyLane,
  /**
   * The date an unstated `validFrom` falls back to — the day the reply arrived.
   *
   * A human filling the CSV states a start date; an agent replying to an RFQ
   * almost never does — they quote a rate and, at most, a "valid until". Learned
   * from a live reply whose three good lines were all rejected for a missing
   * start date. A rate is valid from the day it is quoted unless the agent says
   * otherwise, so the caller passes the reply's own date and the lines validate.
   * Omitted, the field stays required and an unstated start is a row issue, which
   * is the right behaviour for any caller that has no date to stand in.
   */
  defaultValidFrom = '',
): ExtractedRateReply {
  const headerIssues: string[] = []

  const stated = Number(raw.confidence)
  const replyConfidence = Number.isFinite(stated) ? Math.min(1, Math.max(0, stated)) : 0

  const declined = raw.declined === true
  const declinedReason =
    typeof raw.declinedReason === 'string' && raw.declinedReason.trim() !== ''
      ? raw.declinedReason.trim()
      : undefined

  // The header currency the lines fall back to. Validated leniently: an unknown
  // code is a header issue, not a hard stop, because a line may carry its own.
  const headerCurrency =
    typeof raw.currency === 'string' && raw.currency.trim() !== '' ? raw.currency.trim() : undefined

  const validFrom =
    typeof raw.validFrom === 'string' && raw.validFrom.trim() !== ''
      ? raw.validFrom.trim()
      : defaultValidFrom
  const validTo =
    typeof raw.validTo === 'string' && raw.validTo.trim() !== '' ? raw.validTo.trim() : ''

  // A lane the model read that is not the one we asked about — surfaced, never
  // acted on. "We asked JEA→KWI and the reply prices NSA→KWI" is a sentence a
  // coordinator wants; silently pricing the wrong lane is the trap.
  const claimedOrigin = asCode(raw.origin)
  const claimedDestination = asCode(raw.destination)
  let laneMismatch: string | undefined
  if (
    (claimedOrigin && claimedOrigin.toUpperCase() !== lane.originCode.toUpperCase()) ||
    (claimedDestination && claimedDestination.toUpperCase() !== lane.destinationCode.toUpperCase())
  ) {
    laneMismatch = `reply reads ${claimedOrigin ?? '?'}→${claimedDestination ?? '?'}, we asked ${lane.originCode}→${lane.destinationCode}`
  }

  const rawLines = Array.isArray(raw.lines) ? (raw.lines as RawRateLine[]) : []
  if (!declined && rawLines.length === 0) {
    headerIssues.push('Lines: the reply is not marked declined but carries no rate lines')
  }

  const cell = (value: unknown): string =>
    value === null || value === undefined ? '' : String(value)

  const grid: string[][] = [
    [...RATE_ROW_HEADERS],
    ...rawLines.map((line) => [
      lane.mode,
      lane.originCode,
      lane.destinationCode,
      cell(line.currency) || (headerCurrency ?? ''),
      validFrom,
      validTo,
      cell(line.chargeType),
      cell(line.basis),
      cell(line.rate),
      cell(line.minimum),
      cell(line.maximum),
      cell(line.containerType),
      '',
      '',
    ]),
  ]

  const lines = validateImport<RateRowValues>(grid, rateReplyDescriptor, { lookups })

  return {
    declined,
    ...(declinedReason ? { declinedReason } : {}),
    ...(headerCurrency ? { currency: headerCurrency } : {}),
    ...(laneMismatch ? { laneMismatch } : {}),
    lines,
    confidence: replyConfidence,
    headerIssues,
  }
}

function asCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * What a reply costs, per currency, priced against the enquiry.
 *
 * A rate card line is a rate, not a number: `120 per container` costs nothing
 * until you know there are two of them. So the headline figure a broker's reply
 * is ranked on is its lines priced against *this enquiry's* quantities — the
 * `ChargeContext` the caller builds from weight, volume and container count —
 * summed per currency. Per currency, because a Gulf quote routinely prices
 * ocean freight in USD and local charges in KWD, and adding those without an FX
 * rate would be a lie; the comparison view converts each currency's subtotal to
 * base at read time, where the rate is a dated fact on the row (FR-RT-06).
 *
 * A line that cannot be priced for want of context — a `percent` line with no
 * base — is counted, not guessed, so the caller can say "two of five lines
 * could not be priced" rather than quietly under-quote.
 */
export interface RateReplySummary {
  readonly totals: readonly { readonly currency: string; readonly amount: Money }[]
  /** The single currency the reply is in, when it is in exactly one. */
  readonly primary?: { readonly currency: string; readonly amount: Money }
  /** Lines whose basis needed context the enquiry did not supply. */
  readonly unpriced: number
  /**
   * The unpriced lines that make the total *partial*: those missing a
   * quantity of the consignment itself — weight, units or containers.
   *
   * Not every unpriced line does (R1). A `percent` line (insurance at 0.3%)
   * needs a base no enquiry supplies, so it is unpriced on every reply alike;
   * counted as partial, any FCL reply quoting insurance could never be ranked
   * or auto-awarded, whatever the enquiry held. It leaves every rival short by
   * the same kind of line, so the totals still rank. A per-container line
   * with no container count is different: one reply's total is missing its
   * biggest figure and another's may not be, which is what ranking it
   * "Cheapest" on its flat fees got wrong (F69).
   */
  readonly partial: number
}

/**
 * Whether a stored reply's total is partial — the gate the comparison and the
 * auto-award both rank on, read from `rate_requests.response`.
 *
 * `partial` where the reply was summarised since it existed; older rows carry
 * only `unpriced`, which is the stricter reading and is kept for them rather
 * than guessing which of their lines were which. Re-summarising (a container
 * count entered) writes `partial`.
 */
export function replyIsPartial(response: unknown): boolean {
  const r = (response ?? {}) as { partial?: unknown; unpriced?: unknown }
  const count = typeof r.partial === 'number' ? r.partial : r.unpriced
  return typeof count === 'number' && count > 0
}

/** The context fields that are quantities of the consignment — see `partial`. */
const CONSIGNMENT_FIELDS: ReadonlySet<string> = new Set(['kg', 'units', 'containers'])

/**
 * The quantities a rate reply is priced against, from the enquiry's figures.
 *
 * Shared by the service, which summarises a reply when it is read, and the web,
 * which re-summarises the replies already read when a coordinator enters the
 * container count — so both price a reply against the same context (R1).
 *
 * Approximate by design: the figure is a *sort key* for the comparison view,
 * not the quote, which is struck later when `priceEnquiry` runs against the
 * promoted card. Weight is the gross. On a FCL lane the container count is the
 * enquiry's own `container_count` — never `pieces`, which counts packages (F39,
 * F66) — and with no count at all the per-container lines stay unpriced:
 * counted, not guessed. `days` is one, exactly as `pricing.ts` prices a
 * `per_day` line, so the two engines agree on what "priceable" means; a storage
 * charge per day costs one day in both.
 */
export function rateReplyContext(e: {
  readonly mode: string | null
  readonly grossWeightKg: string | null
  readonly pieces: number | null
  readonly containerCount: number | null
}): ChargeContext {
  const ctx: { -readonly [K in keyof ChargeContext]: ChargeContext[K] } = { days: 1 }
  if (e.grossWeightKg != null) ctx.kg = e.grossWeightKg
  if (e.pieces != null) ctx.units = e.pieces
  if (e.mode === 'sea_fcl' && e.containerCount != null) ctx.containers = e.containerCount
  return ctx
}

export function summariseRateReply(
  rows: readonly ImportRow<RateRowValues>[],
  ctx: ChargeContext,
): RateReplySummary {
  const byCurrency = new Map<string, Money>()
  let unpriced = 0
  let partial = 0

  for (const { values } of rows) {
    let amount: Money
    try {
      amount = calcCharge(
        {
          basis: values.basis as (typeof BASES)[number],
          rate: dec(values.rate),
          currency: values.currency,
          minimum: values.minimum === null ? null : dec(values.minimum),
          maximum: values.maximum === null ? null : dec(values.maximum),
        },
        ctx,
      )
    } catch (error) {
      // Only a missing-context refusal is swallowed; a genuine bug still throws.
      if (error instanceof MissingChargeContextError) {
        unpriced += 1
        if (CONSIGNMENT_FIELDS.has(error.field)) partial += 1
        continue
      }
      throw error
    }

    const running = byCurrency.get(amount.currency)
    byCurrency.set(amount.currency, running ? add(running, amount) : amount)
  }

  const totals = [...byCurrency.entries()].map(([currency, amount]) => ({ currency, amount }))
  return {
    totals,
    ...(totals.length === 1 ? { primary: totals[0] } : {}),
    unpriced,
    partial,
  }
}
