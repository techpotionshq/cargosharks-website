/**
 * The adapters — where the ports in `../ports/index.ts` meet the outside.
 *
 * `ports/index.ts` says of its seven interfaces that *"each has a real first
 * implementation today and a second one the SRS itself names"*. The interfaces
 * were declared; the implementations were not written. `FX_SOURCE`,
 * `FX_API_URL` and `FX_API_KEY` had been in the config since Release One with
 * nothing reading them, and `registerChannel` in the notification dispatcher
 * has an empty registry — so a queued notification resolved no adapter and
 * did nothing, quietly.
 *
 * This directory is the first implementations, made real, plus the second ones
 * the SRS names.
 *
 * ## Every default is the Release One behaviour
 *
 * `manual` rates, `manual` tracking, `manual` customs, `none` for
 * transmission. A deployment that configures nothing behaves exactly as it did
 * before this existed. That is not caution for its own sake: two of these are
 * recurring per-unit costs and one is a contract with a tax authority, so
 * switching on because a variable was left in an example file is the wrong
 * failure.
 *
 * ## Resolved once, at boot
 *
 * Each resolver throws on a half-configured driver — a key without a URL, a
 * driver without a key. `config.ts` already argues why: *"a missing WhatsApp
 * token should stop the service at start-up with a clear message, not surface
 * at 2am as a failed notification for a shipment that has already sailed."*
 * The same reasoning covers a tracking feed that silently returns nothing.
 */

import type { CarrierTracking, CustomsFiling, EInvoiceTransmit, FxRateSource } from '../ports/index'

import { resolveCarrierTracking } from './carrier-tracking'
import { resolveCustomsFiling } from './customs'
import { resolveEInvoiceTransmit } from './einvoice'
import { resolveFxSource } from './fx'

export { manualFxSource, httpFxSource } from './fx'
export { manualCarrierTracking, terminal49Tracking } from './carrier-tracking'
export { mapProviderEvents, type ProviderEvent } from './carrier-events'
export { noTransmit, aspTransmit } from './einvoice'
export { manualCustomsFiling } from './customs'

export interface Adapters {
  readonly fx: FxRateSource
  readonly carrierTracking: CarrierTracking
  readonly customsFiling: CustomsFiling
  readonly eInvoice: EInvoiceTransmit
}

let resolved: Adapters | undefined

/**
 * Resolve every external port, once.
 *
 * Memoised because these hold connections and keys, and because resolving per
 * call would turn a configuration error into an intermittent one.
 */
export function adapters(): Adapters {
  resolved ??= {
    fx: resolveFxSource(),
    carrierTracking: resolveCarrierTracking(),
    customsFiling: resolveCustomsFiling(),
    eInvoice: resolveEInvoiceTransmit(),
  }
  return resolved
}

/**
 * What this deployment is actually wired to, for the boot log.
 *
 * Printed on start because "which integrations are live here" is the first
 * question of any support conversation about a fleet, and reading it off the
 * environment by hand gets it wrong.
 */
export function describeAdapters(): Record<string, string> {
  const a = adapters()
  return {
    fx: a.fx.key,
    carrierTracking: a.carrierTracking.key,
    customsFiling: a.customsFiling.key,
    eInvoice: a.eInvoice.key,
  }
}
