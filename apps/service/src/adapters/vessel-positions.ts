/**
 * Which vessel-position driver this deployment runs, from `vesselPositions`.
 *
 * Kept apart from the driver itself for the reason `resolveFxSource` is: the
 * wire protocol takes a key and knows nothing of rows or environment, which is
 * what lets `aisstream.ts` be tested against a fake socket.
 */

import type { LiveIntegration } from '../settings'

export type VesselPositionConfig =
  { readonly driver: 'off' } | { readonly driver: 'aisstream'; readonly apiKey: string }

/**
 * Off unless a person chose a driver *and* supplied its key.
 *
 * Throws on a live driver with no key, so `safely` records the reason on the
 * settings row and the screen shows it red; the fallback is `off`. An unknown
 * driver throws for the same reason: a typo in `VESSEL_POSITIONS_DRIVER` must
 * not read as "switched on".
 */
export function resolveVesselPositionConfig(settings: LiveIntegration): VesselPositionConfig {
  const driver = settings.driver ?? 'off'
  if (driver === 'off') return { driver: 'off' }
  if (driver === 'aisstream') {
    const apiKey = settings.secret('apiKey')
    if (!apiKey) throw new Error('aisstream is selected but no API key is set')
    return { driver: 'aisstream', apiKey }
  }
  throw new Error(`unknown vessel position driver: ${driver}`)
}
