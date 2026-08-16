/**
 * The mark, drawn rather than filed.
 *
 * One square SVG serves the ops sidebar, the white letterhead, the tracking
 * page on a phone and the 32px favicon, because it is generated from the
 * palette at render time instead of exported three times at three sizes. A
 * raster logo cannot do that, and keeping three exports in sync is how the
 * wrong one ships.
 *
 * When Al-Qabandi's own artwork arrives (Pilot §5, item 4) it replaces this
 * through `logo.kind = 'custom'` and nothing downstream changes — every
 * consumer already asks the brand for its mark rather than importing a file.
 */

import type { Brand } from './types'

export interface MarkOptions {
  /** Rendered size in px. The geometry is a square `viewBox`, so this scales. */
  readonly size?: number
  /**
   * `full` draws the brand tile. `flat` draws the glyph alone in
   * `currentColor`, for places that already sit on a brand surface — the
   * chrome of the sidebar, or a monochrome document header.
   */
  readonly variant?: 'full' | 'flat'
  /** Disambiguates gradient ids where several marks share a document. */
  readonly idPrefix?: string
  /** Added verbatim to the root `<svg>`; the caller owns layout. */
  readonly className?: string
  /**
   * Decorative marks are hidden from assistive technology — the accessible
   * name comes from the wordmark beside it. A mark standing alone passes a
   * label here instead.
   */
  readonly title?: string
}

/**
 * Three waves under the monogram.
 *
 * A maritime tell that costs eight path commands and is the difference between
 * a generic tech monogram and something a forwarder recognises as theirs.
 */
const WAVES = [
  'M8 37.5c2.4 0 2.4-2.1 4.8-2.1s2.4 2.1 4.8 2.1 2.4-2.1 4.8-2.1 2.4 2.1 4.8 2.1 2.4-2.1 4.8-2.1 2.4 2.1 4.8 2.1',
  'M8 42.2c2.4 0 2.4-2.1 4.8-2.1s2.4 2.1 4.8 2.1 2.4-2.1 4.8-2.1 2.4 2.1 4.8 2.1 2.4-2.1 4.8-2.1 2.4 2.1 4.8 2.1',
]

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * The mark as an SVG string.
 *
 * A string rather than a component because `apps/service` renders the same
 * mark into PDF letterhead through Chromium, where React is not available.
 * One geometry, two renderers.
 */
export function markSvg(brand: Brand, options: MarkOptions = {}): string {
  const size = options.size ?? 40
  const variant = options.variant ?? 'full'
  const prefix = options.idPrefix ?? 'qb-mark'
  const className = options.className ? ` class="${escapeXml(options.className)}"` : ''
  const label = options.title
  const a11y = label
    ? ` role="img" aria-label="${escapeXml(label)}"`
    : ' aria-hidden="true" focusable="false"'

  if (brand.logo.kind === 'custom' && brand.logo.customSvg) {
    // The supplied file keeps its own geometry; only sizing and the accessible
    // name are ours, because those belong to the placement, not the artwork.
    return brand.logo.customSvg
      .replace(/\s+(?:width|height|aria-hidden|role|aria-label|focusable)="[^"]*"/g, '')
      .replace('<svg', `<svg width="${size}" height="${size}"${className}${a11y}`)
  }

  const letter = escapeXml(brand.logo.monogramLetter)
  /** `logoRadius` is a fraction of the tile, so a 24px mark stays in proportion. */
  const radius = brand.shape.logoRadius * 48

  if (variant === 'flat') {
    return [
      `<svg${className}${a11y} width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">`,
      `<text x="24" y="25" text-anchor="middle" dominant-baseline="central"`,
      ` font-family="${escapeXml(brand.typography.display)}" font-size="30" font-weight="${brand.typography.wordmarkWeight}"`,
      ` letter-spacing="-0.5" fill="currentColor">${letter}</text>`,
      brand.logo.showWaves
        ? WAVES.map(
            (d, i) =>
              `<path d="${d}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none" opacity="${i === 0 ? 0.5 : 0.25}"/>`,
          ).join('')
        : '',
      '</svg>',
    ].join('')
  }

  return [
    `<svg${className}${a11y} width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">`,
    '<defs>',
    `<linearGradient id="${prefix}-tile" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0" stop-color="${brand.palette.primary[800]}"/>`,
    `<stop offset="1" stop-color="${brand.palette.primary[950]}"/>`,
    '</linearGradient>',
    `<clipPath id="${prefix}-clip"><rect width="48" height="48" rx="${radius}"/></clipPath>`,
    '</defs>',
    `<rect width="48" height="48" rx="${radius}" fill="url(#${prefix}-tile)"/>`,
    // The waves sit under the letter and are clipped by the tile, so they read
    // as water the monogram floats on rather than as a separate element.
    brand.logo.showWaves
      ? `<g clip-path="url(#${prefix}-clip)">${WAVES.map(
          (d, i) =>
            `<path d="${d}" stroke="${brand.palette.accent[400]}" stroke-width="1.8" stroke-linecap="round" fill="none" opacity="${i === 0 ? 0.42 : 0.2}"/>`,
        ).join('')}</g>`
      : '',
    // A hairline inset keeps the tile from reading as a flat square at 24px.
    `<rect x="0.75" y="0.75" width="46.5" height="46.5" rx="${radius - 0.75}" stroke="${brand.palette.accent[400]}" stroke-opacity="0.28" stroke-width="1.5"/>`,
    `<text x="24" y="23" text-anchor="middle" dominant-baseline="central"`,
    ` font-family="${escapeXml(brand.typography.display)}" font-size="27" font-weight="${brand.typography.wordmarkWeight}"`,
    ` letter-spacing="-0.5" fill="${brand.palette.accent[300]}">${letter}</text>`,
    '</svg>',
  ].join('')
}

/**
 * The mark as a `data:` URI, for `<link rel="icon">` and anywhere a URL is the
 * only thing accepted. Base64 rather than percent-encoding: Safari has
 * historically been particular about `#` and `%` inside an inline SVG icon.
 */
export function faviconDataUri(brand: Brand): string {
  const svg = markSvg(brand, { size: 64 })
  return `data:image/svg+xml;base64,${base64(svg)}`
}

/**
 * UTF-8 → base64, without assuming Node or the browser.
 *
 * The package is consumed by Next on the server and by the PDF renderer, and
 * may be evaluated in either; `btoa` alone mangles the Arabic in a brand name,
 * so the bytes are encoded first.
 */
function base64(value: string): string {
  const runtime = globalThis as {
    btoa?: (input: string) => string
    Buffer?: { from(input: string, encoding: string): { toString(encoding: string): string } }
  }

  if (runtime.Buffer) return runtime.Buffer.from(value, 'utf8').toString('base64')

  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return runtime.btoa ? runtime.btoa(binary) : binary
}

/**
 * Mark plus wordmark as standalone SVG, for PDF letterhead where there is no
 * HTML layout to lock the two together.
 */
export function lockupSvg(brand: Brand, locale: 'en' | 'ar' = 'en'): string {
  const name = locale === 'ar' ? brand.identity.nameAr : brand.identity.nameEn
  const tagline = locale === 'ar' ? brand.identity.taglineAr : brand.identity.taglineEn
  const family = locale === 'ar' ? brand.typography.arabic : brand.typography.display

  return [
    '<svg width="260" height="48" viewBox="0 0 260 48" fill="none" xmlns="http://www.w3.org/2000/svg"',
    ` role="img" aria-label="${escapeXml(name)}">`,
    markSvg(brand, { size: 48, idPrefix: 'qb-lockup' }).replace('<svg', '<svg x="0" y="0"'),
    `<text x="60" y="21" font-family="${escapeXml(family)}" font-size="17" font-weight="${brand.typography.wordmarkWeight}"`,
    ` letter-spacing="${brand.typography.wordmarkTracking}" fill="${brand.palette.primary[900]}">${escapeXml(name)}</text>`,
    `<text x="60" y="37" font-family="${escapeXml(family)}" font-size="10.5" font-weight="500"`,
    ` letter-spacing="0.08em" fill="${brand.palette.primary[600]}">${escapeXml(tagline.toUpperCase())}</text>`,
    '</svg>',
  ].join('')
}
