/**
 * Why a model's suggestion could not be applied, as a sentence (ai-17).
 *
 * Shared by the accept actions, which say it after a click, and the panel,
 * which now says it *before* one: "Accept all" applied what it could and left
 * the rest with no word of why — its message lived in a button that vanished
 * once fewer than two suggestions were left. A row that will not apply now
 * carries its reason on the row itself, whichever button was pressed.
 *
 * Its own module because `form-actions.ts` is a server-action file, whose
 * every export must be an async action.
 */

import type { Translate } from '@/lib/form-state'
import type { ExpectedValue, ResolutionFailure } from './proposals'

/** A refusal, as a sentence the coordinator can act on. */
export function describeFailure(tv: Translate, failure: ResolutionFailure): string {
  switch (failure.kind) {
    case 'not_found':
      return tv('suggestionNotOnFile', { value: failure.value })
    case 'ambiguous':
      return tv('suggestionAmbiguous', { value: failure.value, count: failure.count })
    case 'invalid':
      return tv('suggestionInvalid', {
        value: failure.value,
        expected: describeExpected(tv, failure.expected),
      })
    case 'unknown_field':
      return tv('suggestionUnknownField')
    default: {
      const unhandled: never = failure
      return unhandled
    }
  }
}

/**
 * What the field would have taken, in the reader's language.
 *
 * `@qabandi/db` says which kind and the words are chosen here, because the
 * catalogue lives here — an English phrase from the resolver was the one
 * untranslated hole in an otherwise Arabic sentence. A list of allowed values
 * stays as the stored codes (`sea_fcl, air`): a refused value is by definition
 * not one of them, so the row beside this refusal shows it raw, and the codes
 * are what it has to be compared with.
 */
function describeExpected(tv: Translate, expected: ExpectedValue): string {
  switch (expected.kind) {
    case 'number':
      return tv('expectedNumber')
    case 'integer':
      return tv('expectedInteger')
    case 'positiveInteger':
      return tv('expectedPositiveInteger')
    case 'boolean':
      return tv('expectedBoolean')
    case 'date':
      return tv('expectedDate')
    case 'oneOf':
      return tv('expectedOneOf', { values: expected.values.join(', ') })
    default: {
      const unhandled: never = expected
      return unhandled
    }
  }
}
