// The guide wears the branch's brand, the same way the product does.
//
// `qabandi` builds an Al-Qabandi guide and `main` builds a CargoSharks one,
// with no flag to remember: `DEFAULT_BRAND_KEY` in packages/brand is the one
// line that differs between the branches (and `check-branch-identity` on main
// keeps it that way). `GUIDE_BRAND` overrides it for a deliberate one-off; the
// product's own `BRAND` variable is ignored here, because a developer's shell
// left on `BRAND=cargosharks` from running the app must not quietly put the
// wrong company on a hundred launch staff's manual.
import { register } from 'tsx/esm/api'

register()
const mod = await import('@qabandi/brand')

export const BRAND_KEY = process.env.GUIDE_BRAND ?? mod.DEFAULT_BRAND_KEY
if (!mod.BRANDS[BRAND_KEY])
  throw new Error(
    `GUIDE_BRAND="${BRAND_KEY}" is not a registered brand (${Object.keys(mod.BRANDS).join(', ')})`,
  )

/** @type {any} */
export const brand = mod.BRANDS[BRAND_KEY]
export const markSvg = (opts = {}) => mod.markSvg(brand, opts)
export const lockupSvg = (locale = 'en') => mod.lockupSvg(brand, locale)

/** The names a reader sees. Short and plain: "Al-Qabandi", "CargoSharks". */
export const brandName = brand.identity.nameEn
export const productHost = (() => {
  try {
    return new URL(brand.contact.websiteUrl).hostname.replace(/^www\./, '')
  } catch {
    return 'example.com'
  }
})()
export const hosts = {
  app: `app.${productHost}`,
  portal: hostOf(brand.contact.portalUrl, `portal.${productHost}`),
  track: hostOf(brand.contact.trackingUrl, `track.${productHost}`),
}

function hostOf(url, fallback) {
  try {
    return new URL(url).hostname
  } catch {
    return fallback
  }
}

/**
 * The colours the cards, callouts and captions are drawn in, as CSS colour
 * strings straight from the palette (OKLCH; Chromium draws them natively).
 * ffmpeg's subtitle renderer needs hex, which `gfx.mjs` gets by asking the
 * browser to paint them.
 */
export const colors = {
  // Both brands put their chrome on the accent ramp, so the deep end of it is
  // the colour a user already associates with the frame of every screen.
  deep: brand.palette.accent[900],
  mid: brand.palette.accent[700],
  brand: brand.palette.primary[600],
  bright: brand.palette.primary[500],
  soft: brand.palette.primary[300],
  accent: brand.palette.accent[600],
  ink: brand.light.ink,
}
