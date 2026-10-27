import { describe, expect, it } from 'vitest'
import { arabicTwins, checkLinks, knownPaths } from '../scripts/blog/lib.mjs'

/**
 * The links a generated post may carry. The first draft linked a "free time
 * calculator" to the top of the home page, and its Arabic edition sent
 * readers to the English home page; both cases are below.
 */
const known = knownPaths()

describe('checkLinks', () => {
  it('accepts real pages and the anchors that exist', () => {
    const md =
      '[a](/what-we-do/) [b](/#calculator) [c](/ar/#calculator) [d](/freight-invoicing-software/)'
    expect(() => checkLinks(md, 'en', known)).not.toThrow()
  })

  it('refuses an anchor no page carries', () => {
    expect(() => checkLinks('[calc](/#free-time-calculator)', 'en', known)).toThrow(
      '/#free-time-calculator',
    )
  })

  it('refuses a page that does not exist', () => {
    expect(() => checkLinks('[tool](/free-time-calculator/)', 'en', known)).toThrow(
      '/free-time-calculator/',
    )
  })
})

describe('arabicTwins', () => {
  it('moves an Arabic link to the page that has an Arabic twin', () => {
    expect(arabicTwins('[الحاسبة](/#calculator)', known)).toBe('[الحاسبة](/ar/#calculator)')
    expect(arabicTwins('[الفوترة](/freight-invoicing-software/)', known)).toBe(
      '[الفوترة](/ar/freight-invoicing-software/)',
    )
  })

  it('leaves English-only pages, Arabic links and external links alone', () => {
    const md = '[ن](/what-we-do/) [م](/ar/compare/) [خ](https://example.com/)'
    expect(arabicTwins(md, known)).toBe(md)
  })
})
