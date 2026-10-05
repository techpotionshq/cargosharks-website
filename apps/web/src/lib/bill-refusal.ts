/**
 * Why the service did not write a bill it was asked to read, in the reader's
 * language.
 *
 * Shared by the two places a person asks for a bill to be read: the payables
 * "Read a bill" dialog and the partner page's "Read as a bill" on filed mail.
 * It lives here rather than in either slice because slices never import each
 * other, and the partner page saying only "did not read as a bill" when the
 * service had said exactly which field failed sent people to retype a bill
 * whose date was the only problem (D1).
 */

import type { Translate } from '@/lib/form-state'

/** The part of the service's reply a bill-reading action reads. */
export interface BillReading {
  readonly supplierInvoiceId?: string | null
  /** English, for the service's log. Not shown — see `billRefusal`. */
  readonly refusal?: string | null
  readonly refusalCode?: string | null
  readonly refusalValues?: Readonly<Record<string, string>>
  readonly findings?: readonly BillFinding[]
  readonly readingIssues?: readonly BillReadingIssue[]
}

/**
 * One part of the scan that did not read — `InvoiceReadingIssue` in `core`,
 * as the service sends it. `field` is a header field or a line's column key;
 * `code` is the cell parser's (or `noLines`).
 */
interface BillReadingIssue {
  readonly where: string
  readonly field: string
  readonly line?: number | null
  readonly code: string
  readonly values?: Readonly<Record<string, string | number>>
}

/** One place the document does not add up, both figures as decimal strings. */
interface BillFinding {
  readonly check: string
  readonly line?: number | null
  readonly stated?: string
  readonly computed?: string
}

/**
 * Every code `invoice-extract.ts` refuses with. Mirrored rather than imported,
 * because `apps/web` does not import the service; a code added there and not
 * here gets the action's own fallback rather than the service's English.
 */
const BILL_REFUSALS = [
  'scan_too_large',
  'no_lines',
  'not_reconciled',
  'unreadable_fields',
  'low_confidence',
  'no_exchange_rate',
  'already_captured',
] as const

type BillRefusal = (typeof BILL_REFUSALS)[number]

function isBillRefusal(code: unknown): code is BillRefusal {
  return typeof code === 'string' && (BILL_REFUSALS as readonly string[]).includes(code)
}

/**
 * Why the bill was not written, in the reader's language — or null for the
 * caller's fallback where the service sent no code this file knows.
 *
 * The `never` default keeps the switch exhaustive over `BILL_REFUSALS`.
 */
export function billRefusal(tv: Translate<'payablesValidation'>, body: BillReading): string | null {
  const code = body.refusalCode
  if (!isBillRefusal(code)) return null
  const values = body.refusalValues ?? {}

  switch (code) {
    case 'scan_too_large':
      return tv('scanTooLarge', { sizeMb: values.sizeMb ?? '', limitMb: values.limitMb ?? '' })
    case 'no_lines':
      return tv('billNoLines')
    case 'not_reconciled': {
      const details = (body.findings ?? [])
        .map((finding) => billFinding(tv, finding))
        .filter((detail): detail is string => detail !== null)
      /*
        A reply with no figures on its findings — a service older than this
        file — still says the one thing that matters: it did not add up.
      */
      return details.length > 0
        ? tv('billNotReconciled', { details: details.join(tv('findingJoiner')) })
        : tv('billNotReconciledPlain')
    }
    case 'unreadable_fields': {
      /*
        Each issue worded here from its code, field and line — never the
        service's `issues`, which are English. An issue this file cannot word
        is left out rather than guessed at; with none worded at all (a service
        older than this file, or only codes it does not know), the count
        sentence still says what matters: nothing was written, capture it by
        hand.
      */
      const details = (body.readingIssues ?? [])
        .map((issue) => billReadingIssue(tv, issue))
        .filter((detail): detail is string => detail !== null)
      return details.length > 0
        ? tv('billPartsUnreadableDetail', { details: details.join(tv('findingJoiner')) })
        : tv('billPartsUnreadable', { count: Number(values.count ?? 0) || 1 })
    }
    case 'low_confidence':
      return tv('billLowConfidence')
    case 'no_exchange_rate':
      return tv('billNoExchangeRate', {
        currency: values.currency ?? '',
        base: values.base ?? '',
      })
    case 'already_captured':
      return tv('billAlreadyCaptured', { reference: values.reference ?? '' })
    default: {
      const unhandled: never = code
      return unhandled
    }
  }
}

/** One finding as a clause, or null for a check this file cannot word. */
function billFinding(tv: Translate<'payablesValidation'>, finding: BillFinding): string | null {
  const { stated, computed } = finding
  if (stated === undefined || computed === undefined) return null

  switch (finding.check) {
    case 'line_amount':
      // The line as a string, like the figures beside it: a number would be
      // localised and could print in different digits from its neighbours.
      return finding.line
        ? tv('findingLine', { line: String(finding.line), stated, computed })
        : tv('findingLineUnnumbered', { stated, computed })
    case 'subtotal':
      return tv('findingSubtotal', { stated, computed })
    case 'total':
      return tv('findingTotal', { stated, computed })
    default:
      return null
  }
}

/**
 * One reading issue as a clause — which field, on which line, and why — or
 * null for a field this file has no name for.
 *
 * The field names are ours, not the scan's: "Invoice date" rather than
 * whatever the supplier printed, because the coordinator corrects our form.
 * The line number is the one the arithmetic findings carry, so both kinds of
 * problem point at the same line.
 */
function billReadingIssue(
  tv: Translate<'payablesValidation'>,
  issue: BillReadingIssue,
): string | null {
  if (issue.code === 'noLines') return tv('readingNoLines')
  const field = readingField(tv, issue.field)
  if (field === null) return null
  const problem = readingProblem(tv, issue)
  // The line as a string, like `findingLine`: a number would be localised.
  return issue.where === 'line' && issue.line
    ? tv('readingOnLine', { line: String(issue.line), field, problem })
    : tv('readingInField', { field, problem })
}

/** A header field or a line's column, by the key `core` reports it under. */
function readingField(tv: Translate<'payablesValidation'>, field: string): string | null {
  switch (field) {
    case 'invoiceNumber':
      return tv('readingFieldInvoiceNumber')
    case 'invoiceDate':
      return tv('readingFieldInvoiceDate')
    case 'dueOn':
      return tv('readingFieldDueOn')
    case 'currency':
      return tv('readingFieldCurrency')
    case 'subtotal':
      return tv('readingFieldSubtotal')
    case 'taxAmount':
      return tv('readingFieldTax')
    case 'total':
      return tv('readingFieldTotal')
    case 'description':
      return tv('readingFieldDescription')
    case 'quantity':
      return tv('readingFieldQuantity')
    case 'unitPrice':
      return tv('readingFieldUnitPrice')
    case 'amount':
      return tv('readingFieldAmount')
    case 'chargeType':
      return tv('readingFieldChargeType')
    default:
      return null
  }
}

/**
 * Why a field did not read, coarsely.
 *
 * Coarser than the import screen's vocabulary on purpose: the fix for a bill
 * is to correct one field on our form, and "not a date" says that as well as
 * "day out of range" does. A code with no clause of its own is "could not be
 * read" — true of every one of them, and never English.
 */
function readingProblem(tv: Translate<'payablesValidation'>, issue: BillReadingIssue): string {
  switch (issue.code) {
    case 'required':
      return tv('readingMissing')
    case 'notDate':
    case 'monthOutOfRange':
    case 'dayOutOfRange':
      return tv('readingNotDate')
    case 'notAmount':
    case 'tooManyDigits':
    case 'tooManyDecimals':
    case 'negative':
      return tv('readingNotAmount')
    case 'unknownReference':
    case 'noReferenceData':
      if (issue.field === 'currency') return tv('readingUnknownCurrency')
      if (issue.field === 'chargeType') return tv('readingUnknownChargeType')
      return tv('readingUnreadable')
    default:
      return tv('readingUnreadable')
  }
}
