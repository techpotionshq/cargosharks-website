/**
 * The "Back" link on a file refusal page comes from the Referer, which the
 * browser sends and an attacker can shape by linking to a crafted URL on our
 * own origin. It must always be a path on this site.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('next-intl/server', () => ({
  getLocale: vi.fn(),
  getTranslations: vi.fn(),
  getRequestConfig: (f: unknown) => f,
}))

const { backHref } = await import('./file-refusal')

const from = (referer: string | null) =>
  new Request('https://app.example/api/documents/x', {
    headers: referer ? { referer } : {},
  })

describe('the back link on a file refusal', () => {
  it('returns to the page the reader came from on this site', () => {
    expect(backHref(from('https://app.example/jobs/1?tab=docs'))).toBe('/jobs/1?tab=docs')
  })

  it('goes home from another site or with no referer', () => {
    expect(backHref(from('https://other.example/jobs/1'))).toBe('/')
    expect(backHref(from(null))).toBe('/')
  })

  it('never yields a protocol-relative link to another site', () => {
    expect(backHref(from('https://app.example//evil.example/x'))).toBe('/evil.example/x')
  })
})
