/**
 * @qabandi/brand — everything that identifies the operator.
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
export { qabandiBrand } from './brands/qabandi'
