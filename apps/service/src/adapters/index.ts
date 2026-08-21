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
 * ## Two lifetimes, because there are two configuration layers
 *
 * `adapters()` still resolves once and memoises. What is left in it — the file
 * store and customs filing — is configured purely from the environment, holds
 * a client or a credential, and cannot change without a restart anyway.
 *
 * Mail, FX, carrier tracking and e-invoice transmission are resolved *per run*
 * instead, because they are rows now (`integration_settings`, FR-AD-03) and
 * the entire point of a row is that a key pasted at 09:05 works at 09:06.
 * `resolveInboundMail` below has taken this shape since the mailbox list
 * became rows, and for the same stated reason.
 *
 * Each resolver still throws on a half-configured driver — a key without a
 * URL, a driver without a key — and `safely` decides what that means. From the
 * environment it is a boot failure, exactly as `config.ts` argues: *"a missing
 * WhatsApp token should stop the service at start-up with a clear message, not
 * surface at 2am as a failed notification for a shipment that has already
 * sailed."* From a row it must not be, because the screen that fixes it is
 * served by the process that would be refusing to start.
 */

import type {
  CarrierTracking,
  CustomsFiling,
  EInvoiceTransmit,
  FileStore,
  FxRateSource,
  ModelProvider,
} from '../ports/index'

import { eq } from 'drizzle-orm'
import { hasSecretKey, mailboxes, openSecret, systemActor, withActor } from '@qabandi/db'
import type { InboundMailSource, NotificationChannel } from '../ports/index'
import { integration, noteIntegrationResult, type LiveIntegration } from '../settings'
import { logChannel, smtpChannel, type SmtpOptions } from './smtp'
import { imapSource } from './imap'
import {
  CARRIER_SETTINGS_KEYS,
  manualCarrierTracking,
  resolveCarrierTracking,
  type CarrierSettings,
} from './carrier-tracking'
import { resolveCustomsFiling } from './customs'
import { noTransmit, resolveEInvoiceTransmit } from './einvoice'
import { resolveFileStore, unavailableFileStore } from './file-store'
import { manualFxSource, resolveFxSource } from './fx'
import { modelProviderFrom, noModel } from './model'

export {
  smtpChannel,
  logChannel,
  sendMail,
  encodeHeader,
  SmtpError,
  type SmtpOptions,
} from './smtp'
export { manualFxSource, httpFxSource } from './fx'
export { manualCarrierTracking, dcsaCredentials } from './carrier-tracking'
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
  openRouterModel,
  readCompletion,
  modelProviderFrom,
  monthlyBudgetUsd,
  noModel,
  ModelError,
  type OpenRouterOptions,
} from './model'
export {
  s3FileStore,
  memoryFileStore,
  parseStorageKey,
  qualifyKey,
  FileStoreError,
  MAX_EXPIRY_SECONDS,
} from './file-store'

/**
 * A resolver that must not be able to take the deployment down.
 *
 * The two configuration layers fail differently and this is where the
 * difference is applied. An environment variable that is wrong stops the
 * service at boot, which is right: it is fixed by the person deploying, before
 * anybody depends on the process. A *row* that is wrong is fixed on a screen —
 * so refusing to resolve would take out the screen along with the mistake, and
 * leave a deployment that can only be recovered through psql.
 *
 * So a bad row degrades to the Release One driver, records why on the row, and
 * the settings page shows it red. The capability is off, which it was anyway,
 * and everything else keeps running.
 *
 * `noted` makes the write a transition rather than a heartbeat: stamping
 * `last_ok_at` on every resolve would be a write per worker tick against a
 * table of ten rows, for no information a fresher timestamp would carry.
 */
const noted = new Map<string, string | null>()

async function safely<T>(
  key: string,
  fallback: T,
  build: () => T,
  log?: (o: unknown, m: string) => void,
): Promise<T> {
  try {
    const built = build()
    if (noted.get(key) !== null) {
      noted.set(key, null)
      await noteIntegrationResult(key, null).catch(() => {})
    }
    return built
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (noted.get(key) !== message) {
      noted.set(key, message)
      await noteIntegrationResult(key, message).catch(() => {})
      log?.({ integration: key, err: message }, 'integration is misconfigured; using the default')
    }
    return fallback
  }
}

/**
 * The mail options this deployment is configured with.
 *
 * Lives here rather than in `smtp.ts` for the same reason `resolveFileStore`
 * lives outside `s3.ts`: the wire protocol takes options and knows nothing
 * about where they came from, which is what lets it be tested against a socket
 * with no environment at all.
 *
 * `from` takes a branch override when one is supplied — five legal entities
 * sending from one address is the same mistake as five numbering from one
 * invoice series, and the more visible one because the customer reads it.
 */
export function smtpOptions(settings: LiveIntegration, from?: string | null): SmtpOptions {
  return {
    host: settings.text('host') ?? 'localhost',
    port: settings.number('port', 1025),
    secure: settings.bool('secure', false),
    user: settings.text('user'),
    password: settings.secret('password'),
    from: from?.trim() || settings.text('from') || 'no-reply@qabandi.local',
    rejectUnauthorized: settings.bool('rejectUnauthorized', true),
  }
}

/** The mail settings, resolved. Exposed so the dispatcher can pick a branch `from`. */
export async function mailSettings(): Promise<LiveIntegration> {
  return integration('smtp')
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
 *
 * Resolved per dispatch run rather than once at boot, which is what makes a
 * relay corrected on the settings screen take effect on the next tick instead
 * of at the next restart. The dispatcher runs every minute, and `settings.ts`
 * caches for thirty seconds, so this is at most two queries a minute.
 */
export async function resolveEmailChannel(
  log: (o: unknown, m: string) => void,
): Promise<NotificationChannel> {
  const settings = await integration('smtp')

  if (settings.driver === 'log') return logChannel(log)

  return safely(
    'smtp',
    logChannel(log),
    () => {
      /*
        A user with no password is refused rather than sent.

        The adapter would otherwise offer the username and no credential, which
        most relays answer by accepting the connection and rejecting the
        recipient — a per-message failure that reads as a bad address.
      */
      if (settings.text('user') && !settings.secret('password')) {
        throw new Error('A mail username is set with no password. Set both, or neither.')
      }
      return smtpChannel(smtpOptions(settings))
    },
    log,
  )
}

/**
 * The FX feed, resolved per run.
 *
 * Async and unmemoised for the same reason `resolveInboundMail` below is: this
 * is a query now, and the whole point of the query is that a key pasted at
 * 09:05 works at 09:06.
 */
export async function fxSource(log?: (o: unknown, m: string) => void): Promise<FxRateSource> {
  const settings = await integration('fx')
  return safely('fx', manualFxSource, () => resolveFxSource(settings), log)
}

/** The carrier feed — one driver row plus one credential row per carrier. */
export async function carrierTracking(
  log?: (o: unknown, m: string) => void,
): Promise<CarrierTracking> {
  const loaded = await Promise.all(CARRIER_SETTINGS_KEYS.map((key) => integration(key)))

  const carriers: Record<string, LiveIntegration> = {}
  CARRIER_SETTINGS_KEYS.forEach((key, index) => {
    const value = loaded[index]
    if (value) carriers[key] = value
  })

  const settings: CarrierSettings = {
    tracking: carriers['carrierTracking'] ?? (await integration('carrierTracking')),
    carriers,
  }

  return safely(
    'carrierTracking',
    manualCarrierTracking,
    () => resolveCarrierTracking(settings),
    log,
  )
}

/** The e-invoice transmitter. `none` until a deployment appoints a provider. */
export async function eInvoiceTransmit(
  log?: (o: unknown, m: string) => void,
): Promise<EInvoiceTransmit> {
  const settings = await integration('einvoice')
  return safely('einvoice', noTransmit, () => resolveEInvoiceTransmit(settings), log)
}

/**
 * The model provider, resolved per call.
 *
 * The model slug is part of this driver's identity — `key` reads
 * `openrouter:<model>` — so the ledger records which model answered rather
 * than which vendor did.
 *
 * Degrades to `noModel` rather than throwing, through `safely`, for the reason
 * that applies to every row-configured integration and applies hardest here: a
 * mistyped slug must not take out the settings screen that fixes it. A surface
 * that finds `available === false` records that it could not run — which is
 * different from recording that it found nothing.
 */
export async function modelProvider(log?: (o: unknown, m: string) => void): Promise<ModelProvider> {
  const settings = await integration('ai')
  return safely('ai', noModel, () => modelProviderFrom(settings), log)
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
        pollBatch: mailboxes.pollBatch,
        maxAttachmentMb: mailboxes.maxAttachmentMb,
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
        /*
          Per mailbox, not per deployment.

          A shared Office 365 mailbox on a throttled tenant and a self-hosted
          Dovecot want different answers, and `INBOUND_MAIL_BATCH` meant
          tuning one of them down tuned all five. The columns carry the old
          environment values as their defaults, so nothing moves until an
          administrator moves it.
        */
        batch: row.pollBatch,
        maxAttachmentBytes: row.maxAttachmentMb * 1024 * 1024,
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

/**
 * The one port that is still environment-only, and still resolved once.
 *
 * `customsFiling` has a single implementation and nothing to configure. Every
 * other port is a settings row now and is resolved per use, on the reasoning
 * at the top of this file.
 */
export interface Adapters {
  readonly customsFiling: CustomsFiling
}

let resolved: Adapters | undefined

export function adapters(): Adapters {
  resolved ??= { customsFiling: resolveCustomsFiling() }
  return resolved
}

/**
 * Object storage, resolved per use.
 *
 * The one resolver here that does **not** degrade to a working default, and
 * the reason is worth stating where somebody will read it: every other port's
 * fallback means "a person does this by hand instead". `memoryFileStore` does
 * not. It accepts an upload, reports success, and loses the bytes at the next
 * restart — so falling back to it would turn a mistyped bucket name into
 * documents that silently disappear.
 *
 * A bad configuration therefore returns a store that refuses, loudly, at the
 * point of use. `FileStoreError` is a shape every caller already handles.
 */
export async function fileStore(log?: (o: unknown, m: string) => void): Promise<FileStore> {
  const settings = await integration('fileStore')

  try {
    const built = resolveFileStore(settings)
    if (noted.get('fileStore') !== null) {
      noted.set('fileStore', null)
      await noteIntegrationResult('fileStore', null).catch(() => {})
    }
    return built
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (noted.get('fileStore') !== message) {
      noted.set('fileStore', message)
      await noteIntegrationResult('fileStore', message).catch(() => {})
      log?.({ integration: 'fileStore', err: message }, 'object storage is not configured')
    }
    return unavailableFileStore(message)
  }
}

/**
 * What this deployment is actually wired to, for the boot log.
 *
 * Printed on start because "which integrations are live here" is the first
 * question of any support conversation about a fleet, and reading it off the
 * environment by hand gets it wrong.
 */
export async function describeAdapters(): Promise<Record<string, string>> {
  const a = adapters()

  /*
    Async now, and the reason is the point of the whole change: four of these
    answers live in the database, so the boot log has to ask it. It runs once
    per process start, after the pool is up.

    A database that cannot be reached does not stop the log line — every
    resolver here falls back to the environment — so this cannot be the thing
    that prevents a service from starting and saying why.
  */
  const [mail, fx, carrier, einvoice, model, store] = await Promise.all([
    integration('smtp'),
    fxSource(),
    carrierTracking(),
    eInvoiceTransmit(),
    modelProvider(),
    fileStore(),
  ])

  return {
    /*
      `email: log` is the single most important line in this log. A deployment
      that is writing mail to a file instead of sending it looks identical from
      the outside to one that is working.

      The `(row)` marker matters as much: "the relay is wrong" and "the relay
      you edited is not the one in use" are different problems with the same
      symptom, and this is the only place that distinguishes them.
    */
    email:
      mail.driver === 'log'
        ? 'log (not sending)'
        : `smtp ${mail.text('host') ?? 'localhost'}:${mail.number('port', 1025)}` +
          (mail.fromRow ? ' (from settings)' : ''),
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
    fx: fx.key,
    fileStore: store.key,
    carrierTracking: carrier.key,
    customsFiling: a.customsFiling.key,
    eInvoice: einvoice.key,
    /*
      The only line here that is also a spend. `none` means no document is
      being read by a model, which is a legitimate configuration and an
      expensive surprise if it was not the intended one.
    */
    model: model.key,
  }
}
