import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '@/lib/markdown'

/**
 * What a model-written body can and cannot put on the page. Fixed inputs, so
 * these run whether or not any post exists yet.
 */
describe('rendering a post body', () => {
  it('wraps tables so they scroll on a phone', () => {
    expect(renderMarkdown('| a | b |\n| - | - |\n| 1 | 2 |')).toContain(
      '<div class="tablewrap"><table>',
    )
  })

  it('escapes raw HTML', () => {
    const html = renderMarkdown('Hello <script>alert(1)</script> there')
    expect(html).not.toMatch(/<script/i)
    expect(html).toContain('&lt;script&gt;')
  })

  it('keeps web, site and mail links', () => {
    expect(renderMarkdown('[a](https://example.com/x)')).toContain(
      '<a href="https://example.com/x" rel="noopener" target="_blank">a</a>',
    )
    expect(renderMarkdown('[a](/freight-invoicing-software/)')).toContain(
      '<a href="/freight-invoicing-software/">a</a>',
    )
    expect(renderMarkdown('[a](#faq)')).toContain('<a href="#faq">a</a>')
    expect(renderMarkdown('[a](mailto:x@example.com)')).toContain('href="mailto:x@example.com"')
  })

  it('turns any other scheme into plain text', () => {
    for (const href of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'java\tscript:alert(1)',
      'data:text/html,<b>x</b>',
      'vbscript:msgbox(1)',
      '//evil.example/x',
      '/\\evil.example/x',
    ]) {
      const html = renderMarkdown(`[the notice](<${href}>)`)
      expect(html, href).not.toContain('<a ')
      expect(html, href).toContain('the notice')
    }
    expect(renderMarkdown('![x](javascript:alert(1))')).not.toContain('<img')
    // A refused image falls back to its alt text, which is model output too.
    const fallback = renderMarkdown('![<img src=x onerror=alert(1)>](javascript:alert(1))')
    expect(fallback).not.toContain('<img')
    expect(fallback).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })
})
