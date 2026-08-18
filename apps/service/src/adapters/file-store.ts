/**
 * Which file store this deployment is wired to.
 *
 * The protocol itself is in `s3.ts`, which imports no configuration and so can
 * be tested against AWS's published signing vectors without an environment —
 * the same split as `carrier-events.ts` sitting beneath `carrier-tracking.ts`.
 * What is left here is the one decision that belongs to a deployment: which
 * driver, and with which credentials.
 */

import type { FileStore } from '../ports/index'
import { config } from '../config'
import { memoryFileStore, s3FileStore } from './s3'

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
 * Resolve the driver named in the environment, and refuse a half-configured
 * one.
 *
 * `config.ts` already makes the case: a missing credential should stop the
 * service at boot with a clear message rather than surface later as a document
 * that cannot be produced. An operator who wants no object storage says
 * `memory` and means it; an operator who says `s3` and omits the bucket has
 * made a mistake, and this is the cheapest possible moment to tell them.
 */
export function resolveFileStore(): FileStore {
  if (config.FILE_STORE_DRIVER === 'memory') return memoryFileStore()

  const missing = (
    [
      ['S3_ENDPOINT', config.S3_ENDPOINT],
      ['S3_BUCKET', config.S3_BUCKET],
      ['S3_ACCESS_KEY_ID', config.S3_ACCESS_KEY_ID],
      ['S3_SECRET_ACCESS_KEY', config.S3_SECRET_ACCESS_KEY],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([name]) => name)

  if (missing.length > 0) {
    throw new Error(
      `FILE_STORE_DRIVER=s3 requires ${missing.join(', ')}. ` +
        'Set them, or set FILE_STORE_DRIVER=memory to run without object storage.',
    )
  }

  return s3FileStore({
    endpoint: config.S3_ENDPOINT!,
    bucket: config.S3_BUCKET!,
    region: config.S3_REGION,
    accessKeyId: config.S3_ACCESS_KEY_ID!,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY!,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
  })
}
