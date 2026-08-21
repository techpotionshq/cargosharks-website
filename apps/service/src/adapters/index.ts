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

import { eq } from 'drizzle-orm'
import { hasSecretKey, mailboxes, openSecret, systemActor, withActor } from '@qabandi/db'
import type { InboundMailSource, NotificationChannel } from '../ports/index'
import { config } from '../config'
import { logChannel, smtpChannel, type SmtpOptions } from './smtp'
import { imapSource } from './imap'
import { resolveCarrierTracking } from './carrier-tracking'
import { resolveCustomsFiling } from './customs'
import { resolveEInvoiceTransmit } from './einvoice'
import { resolveFileStore } from './file-store'
import { resolveFxSource } from './fx'

export {
  smtpChannel,
  logChannel,
  sendMail,
  encodeHeader,
  SmtpError,
  type SmtpOptions,
} from './smtp'
export { manualFxSource, httpFxSource } from './fx'
export { manualCarrierTracking, terminal49Tracking, dcsaCredentials } from './carrier-tracking'
export { mapProviderEvents, type ProviderEvent } from './carrier-events'
export {
  dcsaTracking,
  fetchDcsaEvents,
  DcsaError,
  DCSA_CARRIERS,
  type DcsaTracking,
  type DcsaCarrierProfile,
  type DcsaCredential,
} from './dcsa-tracking'
export {
  readDcsaEvents,
  type DcsaEvent,
  type DcsaReading,
  type CarrierEstimates,
} from './dcsa-events'
export { imapSource, flattenHtml, toInboundMessage, ImapError, type ImapOptions } from './imap'
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

/**
 * The mailboxes this deployment polls — one source each, read from rows.
 *
 * Configuration is rows, not code (FR-AD-03): an administrator adds the Doha
 * office on a screen, and the next poll reads it. There is no environment
 * variable to set and no deployment to wait for, which is the difference
 * between an office onboarded in a minute and one onboarded in a sprint.
 *
 * Async, unlike the other six resolvers, and that is the whole reason this one
 * is not memoised into `adapters()` beside them. Those hold a key or a client
 * and are resolved once at boot; this is a query, and it has to run *per poll*
 * — a mailbox added at 09:05 must be read at 09:06, not at the next restart.
 *
 * A row whose password will not open is skipped rather than fatal: one Dubai
 * credential sealed under a rotated key should not stop Kuwait's mail. The
 * reason is written back to `last_error`, which is what the settings screen
 * shows, because an administrator who can see "this key cannot open it" fixes
 * it in a minute and one who sees an empty queue does not know to look.
 */
export async function resolveInboundMail(): Promise<InboundMailSource[]> {
  const rows = await withActor(systemActor(), (tx) =>
    tx
      .select({
        id: mailboxes.id,
        host: mailboxes.host,
        port: mailboxes.port,
        secure: mailboxes.secure,
        username: mailboxes.username,
        passwordSealed: mailboxes.passwordSealed,
        folder: mailboxes.folder,
        archiveFolder: mailboxes.archiveFolder,
      })
      .from(mailboxes)
      .where(eq(mailboxes.isActive, true)),
  )

  const sources: InboundMailSource[] = []

  for (const row of rows) {
    let password: string
    try {
      password = openSecret(row.passwordSealed)
    } catch (error) {
      await noteMailboxError(row.id, error instanceof Error ? error.message : String(error))
      continue
    }

    sources.push(
      imapSource({
        host: row.host,
        port: row.port,
        secure: row.secure,
        user: row.username,
        password,
        folder: row.folder,
        archiveFolder: row.archiveFolder ?? undefined,
        batch: config.INBOUND_MAIL_BATCH,
        maxAttachmentBytes: config.INBOUND_MAIL_MAX_ATTACHMENT_MB * 1024 * 1024,
      }),
    )
  }

  return sources
}

/** Records why a mailbox produced nothing, for the settings screen to show. */
export async function noteMailboxError(id: string, message: string | null): Promise<void> {
  await withActor(systemActor(), async (tx) => {
    await tx
      .update(mailboxes)
      .set({ lastError: message, lastPolledAt: new Date() })
      .where(eq(mailboxes.id, id))
  })
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
    /*
      Read from config for the same reason as `email` above: "off" and "on but
      polling nothing" look identical from outside, and this is the line that
      separates them. FR-EQ-02 is a Must, so a deployment showing `none` here
      is one where the enquiry front door is not connected.
    */
    /*
      Whether inbound mail *can* work, not how many mailboxes exist.

      The mailbox list is rows now, and reading it here would mean a database
      query inside the boot log. What this line can still answer is the
      question that actually strands a deployment: without the key, every
      mailbox is unreadable and the screen that adds one cannot save.
    */
    inboundMail: hasSecretKey()
      ? 'imap — mailboxes configured in settings'
      : 'imap — MAILBOX_ENCRYPTION_KEY not set, mailboxes unreadable',
    fx: a.fx.key,
    fileStore: a.fileStore.key,
    carrierTracking: a.carrierTracking.key,
    customsFiling: a.customsFiling.key,
    eInvoice: a.eInvoice.key,
  }
}
