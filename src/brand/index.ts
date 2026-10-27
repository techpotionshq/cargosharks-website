/**
 * The brand: everything that identifies CargoSharks on the site.
 *
 * Vendored from `packages/brand` in the product repository (majwadalam/cargosharks)
 * when the website moved out of it. Only the CargoSharks brand is registered:
 * the website never renders another operator. The product's copy stays the
 * source for the app and its PDFs; refresh this from it when the brand changes.
 *
 * Originally, in the product:
 *
 * `FR-CP-01` and `NFR-16` require that a customer sees nothing identifying a
 * third-party product. The cheapest way to guarantee that permanently is to
 * make the operator a parameter: one object holds the names, palette,
 * typography, logo and letterhead, and both applications read it rather than
 * hard-coding anything.
 *
 * Framework-free by construction — `apps/web` renders these tokens as CSS
 * custom properties behind Tailwind utilities, and `apps/service` renders the
 * same tokens into PDF letterhead through Chromium. One source, two renderers.
 */

export * from './types'
export * from './palette'
export * from './define'
export * from './css'
export * from './logo'
export * from './resolve'
export * from './registration'
export { cargosharksBrand } from './brands/cargosharks'
