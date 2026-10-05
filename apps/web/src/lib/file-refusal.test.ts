/**
 * The "Back" link on a file refusal page comes from the Referer, which the
 * browser sends and an attacker can shape by linking to a crafted URL on our
 * own origin. It must always be a path on this site.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('next-intl/server', () => ({
  getLocale: vi.fn(async () => 'ar'),
  // The key itself stands in for the words, so the markup can be read.
  getTranslations: vi.fn(async () => (key: string) => `«${key}»`),
  getRequestConfig: (f: unknown) => f,
}))

const { backHref, fileRefusal, retryHref } = await import('./file-refusal')

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

/*
  A person whose browser lands on a failed download gets a page with a way to
  try again and a way back; a script gets the JSON it always got (U3, and the
  launch review that found raw JSON in front of people).
*/
describe('the file refusal page', () => {
  const browser = (url: string) =>
    new Request(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        referer: 'https://app.example/quotes/q1',
      },
    })

  it('offers a retry to the same file, and a way back', async () => {
    const response = await fileRefusal(
      browser('https://app.example/api/quotes/q1/pdf?locale=ar'),
      'render_failed',
    )
    const html = await response.text()
    expect(response.status).toBe(502)
    expect(html).toContain('href="/api/quotes/q1/pdf?locale=ar"')
    expect(html).toContain('«retry»')
    expect(html).toContain('href="/quotes/q1"')
    expect(html).toContain('dir="rtl"')
  })

  it('sends a signed-out reader to sign in rather than to retry', async () => {
    const html = await (
      await fileRefusal(browser('https://app.example/api/documents/x'), 'unauthenticated')
    ).text()
    expect(html).toContain('href="/sign-in"')
    expect(html).not.toContain('«retry»')
  })

  it('keeps JSON for a programmatic caller', async () => {
    const response = await fileRefusal(
      new Request('https://app.example/api/quotes/q1/pdf'),
      'not_available',
    )
    expect(response.status).toBe(501)
    expect(await response.json()).toEqual({ error: 'not_available' })
  })

  it('retries only this route, never another site', () => {
    expect(retryHref(new Request('https://app.example//evil.example/x'))).toBe('/evil.example/x')
  })
})
