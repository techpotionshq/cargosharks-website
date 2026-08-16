/**
 * The brand, resolved once per process.
 *
 * Every screen, document and email in the application reads the operator's
 * identity from here rather than naming it — `FR-CP-01`, `NFR-16`. Resolution
 * is server-side, so nothing brand-related reaches the client bundle and a
 * re-skin is an environment change rather than a deployment.
 */

import 'server-only'
import { cache } from 'react'
import { resolveBrand, type Brand } from '@qabandi/brand'

/**
 * Module-level rather than per-request: the brand is a property of the
 * deployment, and re-deriving eleven colour ramps on every render would be
 * waste. `cache` keeps it stable within a request for the same reason.
 */
const resolved: Brand = resolveBrand()

export const getBrand = cache((): Brand => resolved)

/** The operator's name in the reader's language. */
export function brandName(brand: Brand, locale: 'en' | 'ar'): string {
  return locale === 'ar' ? brand.identity.nameAr : brand.identity.nameEn
}

export function brandTagline(brand: Brand, locale: 'en' | 'ar'): string {
  return locale === 'ar' ? brand.identity.taglineAr : brand.identity.taglineEn
}

export function brandLegalName(brand: Brand, locale: 'en' | 'ar'): string {
  return locale === 'ar' ? brand.identity.legalNameAr : brand.identity.legalNameEn
}
