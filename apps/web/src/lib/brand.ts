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

/**
 * The operator's mail domain, for the example addresses in placeholders and
 * on-screen command samples.
 *
 * Those examples are the last place a hard-coded operator survives a re-skin:
 * they look like copy rather than configuration, so nobody thinks to change
 * them, and a whitelabel client ends up reading another company's domain in
 * their own settings screen. Derived from `supportEmail`, with the RFC 2606
 * reserved domain as the fallback so a brand that omits one still shows
 * something address-shaped that belongs to nobody.
 */
export function brandMailDomain(brand: Brand): string {
  return brand.contact.supportEmail.split('@')[1] ?? 'example.com'
}
