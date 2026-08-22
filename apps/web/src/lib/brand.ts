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
