import { describe, expect, it } from 'vitest'
import { issueLocales } from './issue-locale'

describe('issueLocales', () => {
  it('issues in the reader’s language and offers the other (N5)', () => {
    expect(issueLocales('ar')).toEqual({ primary: 'ar', other: 'en' })
    expect(issueLocales('en')).toEqual({ primary: 'en', other: 'ar' })
  })

  it('falls back to English for a locale the documents do not print', () => {
    expect(issueLocales('fr')).toEqual({ primary: 'en', other: 'ar' })
    expect(issueLocales(undefined)).toEqual({ primary: 'en', other: 'ar' })
  })
})
