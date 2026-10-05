/**
 * An import problem, in the operator's language.
 *
 * `@qabandi/core/import` reports every problem as a code and the values its
 * sentence needs, and keeps an English `message` only for logs and tests —
 * `core` holds no messages (§4). This is where the code becomes a sentence.
 *
 * One switch of literal keys, exhaustive over the union, because that is the
 * only shape `check-messages` can verify: a key built from the code at run
 * time would pass every check and render a raw key path the first time an
 * Arabic-speaking operator uploaded a bad file. A code added to the engine, to
 * a descriptor's check or to the writer below fails the typecheck here until
 * it has words.
 *
 * Pure, and free of `next-intl` itself, so the console can call it with its
 * client translator and a test can call it with a stand-in.
 */

import type { RowIssue } from '@qabandi/core/import'
import type { Translate } from '@/lib/form-state'
import type { ImportCheckCode } from './descriptors'

/**
 * Problems only the write can find — a code the file names that the database
 * does not hold. Reported in the same shape as the engine's, so the screen and
 * the downloaded CSV list them the same way.
 */
export type WriteIssueCode = 'unknownCustomer'

export type ImportIssue = RowIssue<ImportCheckCode | WriteIssueCode>

/**
 * The line of the report as the operator reads it.
 *
 * Where the problem belongs to one field the field's heading leads, as the
 * engine's English does. The heading itself is not translated: it is the
 * column name printed in the template and in the operator's own file, and a
 * translation of it would name a column they cannot find.
 */
export function describeIssue(t: Translate<'importsValidation'>, issue: ImportIssue): string {
  const problem = describeProblem(t, issue)
  return issue.label === undefined ? problem : t('inField', { field: issue.label, problem })
}

function describeProblem(t: Translate<'importsValidation'>, issue: ImportIssue): string {
  const values = { ...issue.values }
  switch (issue.code) {
    /* --- one cell ------------------------------------------------------- */
    case 'required':
      return t('required')
    case 'tooShort':
      return t('tooShort', values)
    case 'tooLong':
      return t('tooLong', values)
    case 'codeCharacters':
      return t('codeCharacters')
    case 'notAmount':
      return t('notAmount')
    case 'tooManyDigits':
      return t('tooManyDigits')
    case 'tooManyDecimals':
      return t('tooManyDecimals')
    case 'negative':
      return t('negative')
    case 'belowMinimum':
      return t('belowMinimum', values)
    case 'aboveMaximum':
      return t('aboveMaximum', values)
    case 'notWholeNumber':
      return t('notWholeNumber')
    case 'notDate':
      return t('notDate')
    case 'monthOutOfRange':
      return t('monthOutOfRange')
    case 'dayOutOfRange':
      return t('dayOutOfRange')
    case 'notYesNo':
      return t('notYesNo')
    case 'notOneOf':
      return t('notOneOf', values)
    case 'wrongLength':
      return t('wrongLength', values)
    case 'noReferenceData':
      return t('noReferenceData')
    case 'unknownReference':
      return unknownReference(t, values.set)
    case 'notEmail':
      return t('notEmail')
    case 'emailTooLong':
      return t('emailTooLong')
    case 'notPhone':
      return t('notPhone')

    /* --- the sheet ------------------------------------------------------ */
    case 'noHeadings':
      return t('noHeadings')
    case 'noColumn':
      return t('noColumn', values)
    case 'tooManyRows':
      return t('tooManyRows', values)
    case 'duplicateInFile':
      return t('duplicateInFile', values)
    case 'alreadyExists':
      return t('alreadyExists', values)
    case 'noRows':
      return t('noRows')

    /* --- the descriptors' cross-field checks ---------------------------- */
    case 'validToBeforeFrom':
      return t('validToBeforeFrom')
    case 'maximumBelowMinimum':
      return t('maximumBelowMinimum')
    case 'containerTypeNeeded':
      return t('containerTypeNeeded')
    case 'zeroRateNeedsMinimum':
      return t('zeroRateNeedsMinimum')
    case 'etaBeforeEtd':
      return t('etaBeforeEtd')
    case 'dueBeforeIssue':
      return t('dueBeforeIssue', values)
    case 'totalMismatch':
      return t('totalMismatch', values)
    case 'overpaid':
      return t('overpaid', values)
    case 'nothingOutstanding':
      return t('nothingOutstanding')

    /* --- the write ------------------------------------------------------ */
    case 'unknownCustomer':
      return t('unknownCustomer', values)

    default: {
      const unhandled: never = issue.code
      return unhandled
    }
  }
}

/**
 * One sentence per reference set rather than one sentence with the set's name
 * interpolated: in Arabic the sentence agrees with its noun — *ليست عملة* but
 * *ليس موقعًا* — and no placeholder can carry that.
 *
 * The set names are the ones `queries.ts` loads. A set this does not know
 * still gets an honest, if vaguer, sentence rather than a code.
 */
function unknownReference(t: Translate<'importsValidation'>, set: string | number | undefined) {
  switch (set) {
    case 'countries':
      return t('unknownCountry')
    case 'currencies':
      return t('unknownCurrency')
    case 'locations':
      return t('unknownLocation')
    case 'chargeTypes':
      return t('unknownChargeType')
    case 'incoterms':
      return t('unknownIncoterm')
    default:
      return t('unknownReference')
  }
}
