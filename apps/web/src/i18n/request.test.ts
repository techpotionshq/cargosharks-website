/**
 * Which language a request renders in (NEW-5): the reader's explicit choice,
 * then the account's saved language, then English.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('next-intl/server', () => ({ getRequestConfig: (fn: unknown) => fn }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('@/lib/session', () => ({ getSession: async () => null }))

const { resolveRequestLocale } = await import('./request')
const signedIn = (locale: string) => async () => ({ principal: { locale } })

describe('the language a request renders in', () => {
  it('uses the account’s saved language when the reader has not chosen', async () => {
    expect(await resolveRequestLocale(undefined, signedIn('ar'))).toBe('ar')
  })

  it('keeps an explicit choice over the saved language', async () => {
    expect(await resolveRequestLocale('en', signedIn('ar'))).toBe('en')
    expect(await resolveRequestLocale('ar', signedIn('en'))).toBe('ar')
  })

  it('falls back to English signed out, on a stray cookie, or when the session cannot be read', async () => {
    expect(await resolveRequestLocale(undefined, async () => null)).toBe('en')
    expect(await resolveRequestLocale('fr', async () => null)).toBe('en')
    expect(
      await resolveRequestLocale(undefined, async () => {
        throw new Error('database down')
      }),
    ).toBe('en')
  })
})
