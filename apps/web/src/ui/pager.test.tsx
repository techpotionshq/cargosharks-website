/**
 * The pager prints the range and the total, and links to the pages either
 * side with every filter carried.
 *
 * Rendered to static markup, as the dialog test does: the pager is a server
 * component with no state, so its HTML is all there is to check. The words
 * come from a stub that echoes the key and its values, so the assertions are
 * about which message is used with which numbers rather than about wording.
 */

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next-intl/server', () => ({
  // `i18n/request` registers its config through this at import time.
  getRequestConfig: (config: unknown) => config,
  getLocale: async () => 'en',
  getTranslations:
    async () =>
    (key: string, values: Record<string, string> = {}) =>
      `${key}(${Object.entries(values)
        .map(([name, value]) => `${name}=${value}`)
        .join(',')})`,
}))

const { Pager } = await import('./pager')

const render = async (props: Parameters<typeof Pager>[0]) =>
  renderToStaticMarkup((await Pager(props))!)

describe('the register pager', () => {
  it('says which rows these are of how many, and links both ways', async () => {
    const html = await render({
      page: { total: 336, page: 2, size: 50 },
      path: '/jobs',
      params: { filter: 'all' },
    })
    expect(html).toContain('pageRange(from=51,to=100,total=336)')
    expect(html).toContain('pageOf(page=2,pages=7)')
    expect(html).toContain('href="/jobs?filter=all"')
    expect(html).toContain('href="/jobs?filter=all&amp;page=3"')
  })

  it('offers no previous page on the first, and no next on the last', async () => {
    const first = await render({ page: { total: 120, page: 1, size: 50 }, path: '/customers' })
    expect(first).not.toContain('rel="prev"')
    expect(first).toContain('href="/customers?page=2"')

    const last = await render({ page: { total: 120, page: 3, size: 50 }, path: '/customers' })
    expect(last).toContain('pageRange(from=101,to=120,total=120)')
    expect(last).not.toContain('rel="next"')
  })

  it('still prints the total on a register that fits one page', async () => {
    const html = await render({ page: { total: 12, page: 1, size: 50 }, path: '/customers' })
    expect(html).toContain('pageRange(from=1,to=12,total=12)')
    expect(html).not.toContain('pageOf(')
  })

  it('points a bookmark past the end back at the last page', async () => {
    const html = await render({ page: { total: 60, page: 5, size: 50 }, path: '/documents' })
    expect(html).toContain('pagePast(page=5,pages=2)')
    expect(html).toContain('href="/documents?page=2"')
  })

  it('renders nothing for an empty register, whose empty state says enough', async () => {
    expect(await Pager({ page: { total: 0, page: 1, size: 50 }, path: '/jobs' })).toBeNull()
  })
})
