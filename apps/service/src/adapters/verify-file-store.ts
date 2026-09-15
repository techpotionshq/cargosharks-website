/**
 * Prove the file store works against the bucket this deployment is pointed at.
 *
 *     pnpm --filter @qabandi/service exec tsx src/adapters/verify-file-store.ts
 *
 * The unit tests pin the signing against AWS's published vectors and stub the
 * network, which is what makes them worth running in CI — but they cannot tell
 * you that a token has the right permissions, that the bucket exists, or that
 * this provider is one of the ones that quietly disagrees about path style.
 * Only a real round-trip does that, and doing it by hand with `curl` means
 * signing by hand.
 *
 * It writes one small object under `verify/`, reads it back through a signed
 * URL exactly as a browser would, retires it, and confirms the live key stops
 * resolving while the retired copy remains. Nothing else in the bucket is
 * touched.
 *
 * It reads the environment directly rather than going through `config.ts`,
 * which insists on a `DATABASE_URL` and an `INTERNAL_API_SECRET` before it will
 * hand anything over. That insistence is right for the service and wrong here:
 * checking a bucket should not require a database, and somebody who has just
 * pasted in a set of storage credentials should be able to test *those*.
 */

import { loadEnv } from '@qabandi/db'
import { s3FileStore } from './s3'

const KEY = `verify/file-store-check.txt`
const BODY = Buffer.from(`al-qabandi file store check\n`)

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

async function main(): Promise<void> {
  loadEnv()

  const fileStore = s3FileStore({
    endpoint: required('S3_ENDPOINT'),
    bucket: required('S3_BUCKET'),
    region: process.env.S3_REGION ?? 'auto',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
  })

  console.log('bucket:', process.env.S3_BUCKET, 'at', process.env.S3_ENDPOINT)

  const stored = await fileStore.put(KEY, BODY, 'text/plain; charset=utf-8')
  console.log(
    'put   :',
    stored.storageKey,
    `${stored.byteSize} bytes`,
    stored.checksum.slice(0, 12),
  )

  const read = await fileStore.get(stored.storageKey)
  if (!read.equals(BODY)) throw new Error('what came back is not what went in')
  console.log('get   : bytes match')

  // The path a customer actually takes: a signed URL, followed by something
  // that holds none of our credentials.
  const url = await fileStore.signedUrl(stored.storageKey, 120, {
    downloadFilename: 'check.txt',
  })
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`signed URL returned ${response.status}: ${await response.text()}`)
  }
  if ((await response.text()) !== BODY.toString()) {
    throw new Error('signed URL served different bytes')
  }
  console.log(
    'sign  : fetched by URL,',
    response.headers.get('content-disposition') ?? 'no filename',
  )

  await fileStore.retire(stored.storageKey)
  const gone = await fileStore
    .get(stored.storageKey)
    .then(() => false)
    .catch(() => true)
  if (!gone) throw new Error('retired key still resolves')

  const kept = await fileStore.get(`retired/${KEY}`)
  if (!kept.equals(BODY)) throw new Error('retired copy is not intact')
  console.log('retire: live key gone, retired/ copy intact')

  console.log('\nfile store OK')
}

main().catch((error: unknown) => {
  console.error('\nfile store FAILED:', error instanceof Error ? error.message : error)
  process.exit(1)
})
