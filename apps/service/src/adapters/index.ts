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

import type {
  CarrierTracking,
  CustomsFiling,
  EInvoiceTransmit,
  FileStore,
  FxRateSource,
} from '../ports/index'

import type { NotificationChannel } from '../ports/index'
import { config } from '../config'
import { logChannel, smtpChannel, type SmtpOptions } from './smtp'
import { resolveCarrierTracking } from './carrier-tracking'
import { resolveCustomsFiling } from './customs'
import { resolveEInvoiceTransmit } from './einvoice'
import { resolveFileStore } from './file-store'
import { resolveFxSource } from './fx'

export { smtpChannel, logChannel, sendMail, encodeHeader, SmtpError, type SmtpOptions } from './smtp'
export { manualFxSource, httpFxSource } from './fx'
export { manualCarrierTracking, terminal49Tracking } from './carrier-tracking'
export { mapProviderEvents, type ProviderEvent } from './carrier-events'
export { noTransmit, aspTransmit } from './einvoice'
export { manualCustomsFiling } from './customs'
export {
  s3FileStore,
  memoryFileStore,
  parseStorageKey,
  qualifyKey,
  FileStoreError,
  MAX_EXPIRY_SECONDS,
} from './file-store'

/**
 * The mail options this deployment is configured with.
 *
 * Lives here rather than in `smtp.ts` for the same reason `resolveFileStore`
 * lives outside `s3.ts`: the wire protocol takes options and knows nothing
 * about where they came from, which is what lets it be tested against a socket
 * with no environment at all.
 */
export function smtpOptions(): SmtpOptions {
  return {
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    user: config.SMTP_USER,
    password: config.SMTP_PASSWORD,
    from: config.MAIL_FROM,
    rejectUnauthorized: config.SMTP_TLS_REJECT_UNAUTHORIZED,
  }
}

/**
 * Which mail driver this deployment runs on.
 *
 * Unlike the tracking and transmission ports, the default here is *on*. Those
 * two are a per-container cost and a contract with a tax authority, so they
 * default to the Release One behaviour and stay off until someone buys them.
 * Sending mail is neither: FR-NT-01 is a Must, and a deployment that quietly
 * decided not to send anything would satisfy the letter of "no surprises" by
 * failing at the thing it was installed to do.
 */
export function resolveEmailChannel(log: (o: unknown, m: string) => void): NotificationChannel {
  if (config.MAIL_DRIVER === 'log') return logChannel(log)

  if (config.SMTP_USER && !config.SMTP_PASSWORD) {
    throw new Error('SMTP_USER is set without SMTP_PASSWORD. Set both, or neither.')
  }

  return smtpChannel(smtpOptions())
}

export interface Adapters {
  readonly fx: FxRateSource
  readonly fileStore: FileStore
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
    fileStore: resolveFileStore(),
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
    /*
      Read from config rather than from the channel, because the channel is
      registered on the dispatcher rather than held here — and because
      `email: log` is the single most important line in this log. A deployment
      that is writing mail to a file instead of sending it looks identical from
      the outside to one that is working.
    */
    email:
      config.MAIL_DRIVER === 'log'
        ? 'log (not sending)'
        : `smtp ${config.SMTP_HOST}:${config.SMTP_PORT}`,
    fx: a.fx.key,
    fileStore: a.fileStore.key,
    carrierTracking: a.carrierTracking.key,
    customsFiling: a.customsFiling.key,
    eInvoice: a.eInvoice.key,
  }
}
