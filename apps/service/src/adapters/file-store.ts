/**
 * Which file store this deployment is wired to.
 *
 * The protocol itself is in `s3.ts`, which imports no configuration and so can
 * be tested against AWS's published signing vectors without an environment —
 * the same split as `dcsa-events.ts` sitting beneath `dcsa-tracking.ts`.
 * What is left here is the one decision that belongs to a deployment: which
 * driver, and with which credentials.
 */

import type { FileStore } from '../ports/index'
import type { LiveIntegration } from '../settings'
import { FileStoreError, memoryFileStore, s3FileStore } from './s3'

export {
  s3FileStore,
  memoryFileStore,
  signRequest,
  presignUrl,
  parseStorageKey,
  qualifyKey,
  retiredKey,
  FileStoreError,
  MAX_EXPIRY_SECONDS,
  type S3Options,
  type SigV4Credentials,
} from './s3'

/**
 * The one in-memory store this process has, made on first use.
 *
 * `fileStore()` resolves per use — so a settings change takes effect without a
 * restart — and with the memory driver that meant a *new, empty* map on every
 * call (ai-3). An upload put the PDF in one map and "Read a bill" looked in
 * another, so with the driver `docs/Dev_Environment.md` recommends for local
 * work every read failed with "no such key". The bytes still go at a restart,
 * which is what the memory driver has always meant; they no longer go between
 * one request and the next.
 *
 * Tests that want isolation call `memoryFileStore()` directly, as they did.
 */
let processMemory: ReturnType<typeof memoryFileStore> | undefined

export function processMemoryStore(): ReturnType<typeof memoryFileStore> {
  processMemory ??= memoryFileStore()
  return processMemory
}

/**
 * Resolve the driver named in the environment, and refuse a half-configured
 * one.
 *
 * `config.ts` already makes the case: a missing credential should stop the
 * service at boot with a clear message rather than surface later as a document
 * that cannot be produced. An operator who wants no object storage says
 * `memory` and means it; an operator who says `s3` and omits the bucket has
 * made a mistake, and this is the cheapest possible moment to tell them.
 */
export function resolveFileStore(settings: LiveIntegration): FileStore {
  if (settings.driver === 'memory') return processMemoryStore()

  const endpoint = settings.text('endpoint')
  const bucket = settings.text('bucket')
  const accessKeyId = settings.text('accessKeyId')
  const secretAccessKey = settings.secret('secretAccessKey')

  const missing = (
    [
      ['endpoint', endpoint],
      ['bucket', bucket],
      ['access key id', accessKeyId],
      ['secret access key', secretAccessKey],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([name]) => name)

  if (missing.length > 0) {
    throw new Error(
      `Object storage is set to s3 and is missing ${missing.join(', ')}. ` +
        'Set them at Settings › Integrations, or choose the memory driver to ' +
        'run without object storage.',
    )
  }

  return s3FileStore({
    endpoint: endpoint!,
    bucket: bucket!,
    region: settings.text('region') ?? 'us-east-1',
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
    forcePathStyle: settings.bool('forcePathStyle', true),
  })
}

/**
 * A store that refuses every operation, and says why.
 *
 * The fallback for a *misconfigured* deployment, and the one place in this
 * system where degrading to the Release One behaviour would be wrong. Every
 * other port has a safe default: manual milestones, manual rates, no
 * transmission — each means "a person does it instead". `memoryFileStore` does
 * not mean that. It accepts the upload, reports success, holds the bytes in
 * the process and loses them at the next restart, with nothing anywhere saying
 * a document went missing.
 *
 * So a bad configuration refuses at the point of use. The upload fails
 * loudly, the caller already handles `FileStoreError`, and the settings card
 * shows the reason — which is recoverable, where a silent loss is not.
 */
export function unavailableFileStore(reason: string): FileStore {
  const refuse = (): never => {
    throw new FileStoreError(`Object storage is not configured: ${reason}`)
  }

  return {
    key: 'unavailable',
    put: refuse,
    get: refuse,
    signedUrl: refuse,
    retire: refuse,
  }
}
