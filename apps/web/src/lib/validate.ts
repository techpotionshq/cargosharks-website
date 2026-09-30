import 'server-only'

/**
 * `schema.safeParse(input)`, with zod's own messages replaced by the catalogue's.
 *
 * A rule that carries a catalogue message (`.min(2, tv(…))`) already speaks
 * both languages. A rule that carries none — `z.uuid()`, `.max(120)`, a
 * `z.enum` — fell back to zod's built-in text: English, and written for
 * developers ("Too small: expected string to have >=2 characters"), so an
 * Arabic form mixed languages and an English one read like a stack trace.
 *
 * Zod 4 resolves a message in a fixed order: the rule's own, then a per-parse
 * `error` map, then the global config, then the locale. A per-parse map
 * therefore fills *only* the rules with no message of their own and never
 * overrides a catalogue one — checked against zod 4.4, and pinned by
 * `validate.test.ts`. Per call rather than `z.config()`, because global config
 * is process-wide and two requests in two languages would race for it.
 *
 * Zod ships an Arabic locale, and this used it first. It leaves the type name
 * in English ("يفترض أن تكون string") and a stray leading space, so the
 * messages are ours: a dozen plain sentences in `validation.*`, the same in
 * both languages as every other string in the product.
 */

import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import type { Translate } from '@/lib/form-state'

export async function localeParse<Schema extends z.ZodType>(schema: Schema, input: unknown) {
  return schema.safeParse(input, { error: await errorMap() })
}

async function errorMap(): Promise<z.core.$ZodErrorMap | undefined> {
  try {
    const t = await getTranslations('validation')
    return (issue) => describe(t, issue)
  } catch {
    /*
      No request to read a locale from — a unit test calling an action
      directly. Zod's own English is what that test was written against, so
      failing open to it changes nothing for anyone.
    */
    return undefined
  }
}

/** One zod issue as one sentence. Literal keys only, so `check-messages` sees each. */
function describe(t: Translate<'validation'>, issue: z.core.$ZodRawIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      return issue.expected === 'number' ? t('expectedNumber') : t('invalidType')

    case 'too_small': {
      const minimum = Number(issue.minimum)
      if (issue.origin === 'string') {
        return issue.exact ? t('exactLength', { length: minimum }) : t('tooShort', { minimum })
      }
      if (issue.origin === 'number' || issue.origin === 'bigint') {
        return t('numberTooSmall', { minimum })
      }
      if (issue.origin === 'array' || issue.origin === 'set') return t('chooseAtLeast', { minimum })
      return t('checkValue')
    }

    case 'too_big': {
      const maximum = Number(issue.maximum)
      if (issue.origin === 'string') {
        return issue.exact ? t('exactLength', { length: maximum }) : t('tooLong', { maximum })
      }
      if (issue.origin === 'number' || issue.origin === 'bigint') {
        return t('numberTooBig', { maximum })
      }
      if (issue.origin === 'array' || issue.origin === 'set') return t('chooseAtMost', { maximum })
      return t('checkValue')
    }

    case 'invalid_format':
      switch (issue.format) {
        case 'email':
          return t('validEmail')
        case 'url':
          return t('validUrl')
        // Every uuid field in this product is a picker, never typed.
        case 'uuid':
        case 'guid':
          return t('chooseOption')
        case 'date':
        case 'datetime':
        case 'time':
          return t('validDate')
        default:
          return t('checkFormat')
      }

    case 'invalid_value':
      return t('chooseOption')

    case 'not_multiple_of':
      return t('multipleOf', { divisor: Number(issue.divisor) })

    default:
      return t('checkValue')
  }
}
