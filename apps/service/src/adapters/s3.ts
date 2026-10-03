/**
 * The S3 wire protocol — the half of `FileStore` with no configuration in it.
 *
 * The port was declared at Release One and had nothing behind it. Everything
 * downstream of it stalled quietly: `pdfRender` is listed in `workers/index.ts`
 * as *"needs FileStore"*, `renderInvoicePdf` streams rather than stores because
 * there was nowhere to put a document, and the download route in `apps/web`
 * answered `503 storage_not_configured` while pointing at a bucket URL it built
 * by hand. This is the missing implementation.
 *
 * ## Why the requests are signed here rather than by a vendor SDK
 *
 * `@aws-sdk/client-s3` plus the presigner is fifteen megabytes and several
 * dozen transitive packages to do two things: sign a request and put bytes on
 * the end of it. `httpFxSource` and the DCSA adapter are both plain `fetch`,
 * and the S3 REST surface this needs is four verbs wide — PUT, GET,
 * DELETE and the copy that makes a retirement. SigV4 is the only hard part and
 * it is a hundred lines of HMAC that has not changed since 2012; it is covered
 * below by the signing vectors AWS publishes for exactly this purpose.
 *
 * The payoff is that the adapter is protocol-shaped rather than AWS-shaped.
 * R2, MinIO, Backblaze and Supabase Storage all speak this dialect, and the
 * only thing that varies between them is an endpoint and whether the bucket
 * goes in the host or in the path.
 *
 * ## What `retire` does, and what it does not
 *
 * `assets.retired_at` says files are *"never deleted; they are retired"*. A
 * `retire` that called `DeleteObject` would make that comment a lie at the one
 * layer where it matters, so this copies the object under a `retired/` prefix
 * and then removes the live key. The bytes survive — a bucket lifecycle rule or
 * a person decides what happens to them afterwards — and the key the
 * application knows stops resolving, which is what retirement means to a
 * caller. Object tagging would have been tidier; R2 does not implement it.
 */

import { createHash, createHmac, randomBytes } from 'node:crypto'
import type { FileStore, StoredFile } from '../ports/index'

/* -------------------------------------------------------------------------
   Signature Version 4.

   Free functions that know nothing about buckets or files, because that is the
   shape AWS's published test vectors take and being able to run them
   unmodified is worth more than tidier ergonomics.
   ------------------------------------------------------------------------- */

const ALGORITHM = 'AWS4-HMAC-SHA256'
const SERVICE = 's3'

function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

/**
 * RFC 3986, not `encodeURIComponent`.
 *
 * The two differ on `!'()*`, which `encodeURIComponent` leaves alone and the
 * signing spec requires escaped. A key holding an apostrophe — and shipping
 * paperwork is full of company names with apostrophes — would otherwise be
 * signed one way and requested another, and fail in a way that looks like a
 * credentials problem.
 */
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

/** Path separators survive; everything inside a segment is escaped. */
function encodePath(path: string): string {
  return path.split('/').map(uriEncode).join('/')
}

/** `YYYYMMDDTHHMMSSZ` and its date half, which is all SigV4 asks for. */
function stamps(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
  return { amzDate, dateStamp: amzDate.slice(0, 8) }
}

function signingKey(secretKey: string, dateStamp: string, region: string): Buffer {
  const kDate = hmac(`AWS4${secretKey}`, dateStamp)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, SERVICE)
  return hmac(kService, 'aws4_request')
}

function canonicalQuery(query: Readonly<Record<string, string>>): string {
  return Object.keys(query)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(query[k]!)}`)
    .join('&')
}

export interface SigV4Credentials {
  readonly accessKeyId: string
  readonly secretAccessKey: string
  readonly region: string
}

export interface CanonicalRequest {
  readonly method: string
  /** Already-encoded absolute path, beginning with `/`. */
  readonly path: string
  readonly query?: Readonly<Record<string, string>>
  readonly headers: Readonly<Record<string, string>>
  /** Hex SHA-256 of the body, or the literal `UNSIGNED-PAYLOAD`. */
  readonly payloadHash: string
}

/**
 * Sign a request with an `Authorization` header.
 *
 * Returns the headers to send rather than mutating a request object, so the
 * caller sends precisely what was signed. Those two drifting apart is the most
 * common way this goes wrong, and it presents as `SignatureDoesNotMatch`, which
 * says nothing about which header was the culprit.
 */
export function signRequest(
  request: CanonicalRequest,
  credentials: SigV4Credentials,
  now: Date,
): Record<string, string> {
  const { amzDate, dateStamp } = stamps(now)
  const scope = `${dateStamp}/${credentials.region}/${SERVICE}/aws4_request`

  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(request.headers)) {
    headers[name.toLowerCase()] = value
  }
  headers['x-amz-content-sha256'] = request.payloadHash
  headers['x-amz-date'] = amzDate

  const names = Object.keys(headers).sort()
  const signedHeaders = names.join(';')
  const canonicalHeaders = names
    .map((n) => `${n}:${headers[n]!.trim().replace(/\s+/g, ' ')}\n`)
    .join('')

  const canonical = [
    request.method,
    request.path,
    canonicalQuery(request.query ?? {}),
    canonicalHeaders,
    signedHeaders,
    request.payloadHash,
  ].join('\n')

  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonical)].join('\n')
  const signature = createHmac(
    'sha256',
    signingKey(credentials.secretAccessKey, dateStamp, credentials.region),
  )
    .update(stringToSign, 'utf8')
    .digest('hex')

  return {
    ...headers,
    authorization:
      `${ALGORITHM} Credential=${credentials.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
}

/**
 * Sign a URL, so document bytes never pass through this process.
 *
 * `host` is the only signed header. Anything more has to be reproduced by
 * whoever follows the link — a browser, which sends what it likes — and a
 * signature that depends on the client's `User-Agent` is a signature that
 * fails on Tuesdays.
 */
export function presignUrl(
  input: {
    readonly method: string
    readonly origin: string
    readonly path: string
    readonly query?: Readonly<Record<string, string>>
    readonly expiresInSeconds: number
  },
  credentials: SigV4Credentials,
  now: Date,
): string {
  const { amzDate, dateStamp } = stamps(now)
  const scope = `${dateStamp}/${credentials.region}/${SERVICE}/aws4_request`
  const host = new URL(input.origin).host

  const query: Record<string, string> = {
    ...input.query,
    'X-Amz-Algorithm': ALGORITHM,
    'X-Amz-Credential': `${credentials.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(input.expiresInSeconds),
    'X-Amz-SignedHeaders': 'host',
  }

  const canonical = [
    input.method,
    input.path,
    canonicalQuery(query),
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n')

  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonical)].join('\n')
  const signature = createHmac(
    'sha256',
    signingKey(credentials.secretAccessKey, dateStamp, credentials.region),
  )
    .update(stringToSign, 'utf8')
    .digest('hex')

  const origin = input.origin.replace(/\/$/, '')
  return `${origin}${input.path}?${canonicalQuery(query)}&X-Amz-Signature=${signature}`
}

/* -------------------------------------------------------------------------
   Storage keys.
   ------------------------------------------------------------------------- */

/**
 * `assets.storage_key` is documented as `<driver>:<bucket>/<key>` and declared
 * opaque to the application. `put` writes that form, because a bare key is
 * ambiguous the first time a deployment has two buckets and no way to tell
 * which row belongs to which.
 *
 * Reads accept the bare form as well. The demo seed writes
 * `demo/<reference>/<code>.pdf`, and rewriting seeded rows to satisfy a parser
 * would be the wrong direction of accommodation.
 */
export function qualifyKey(bucket: string, key: string): string {
  return `s3:${bucket}/${key}`
}

export function parseStorageKey(storageKey: string): { bucket?: string; key: string } {
  const match = /^([a-z0-9]+):([^/]+)\/(.+)$/.exec(storageKey)
  if (!match) return { key: storageKey.replace(/^\/+/, '') }
  return { bucket: match[2], key: match[3]! }
}

/** A retired object keeps its path, one prefix deeper. */
export function retiredKey(key: string): string {
  return `retired/${key}`
}

export class FileStoreError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'FileStoreError'
  }
}

/**
 * Something already lives at that key, and `put` will not replace it — NEW-10.
 *
 * Every store refuses to overwrite. The bucket holds a customer's live
 * documents and may be shared by more than one deployment (a staging copy, a
 * re-seeded database whose references start again at 00001), and an
 * unconditional PUT let any of them silently replace another's issued bill of
 * lading. A refusal is loud and recoverable; a replaced original is neither.
 */
export class FileExistsError extends FileStoreError {
  constructor(key: string) {
    super(`refusing to overwrite ${key}: an object already exists there`, 412)
    this.name = 'FileExistsError'
  }
}

/**
 * The random part of a storage key: 48 bits, hex, short enough to read.
 *
 * Keys stay human-readable (branch, reference, kind, version) because an
 * operator with bucket access finds a shipment's files by browsing; this is
 * what makes two deployments, or two runs of one, never name the same object.
 */
export function storageNonce(): string {
  return randomBytes(6).toString('hex')
}

/**
 * Put under a key with a fresh random component, retrying a refused one.
 *
 * A clash on 48 random bits means something is wrong rather than unlucky, so
 * three attempts is generous; the third refusal is thrown.
 */
export async function putUnique(
  store: FileStore,
  keyFor: (nonce: string) => string,
  body: Buffer,
  contentType: string,
): Promise<StoredFile> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await store.put(keyFor(storageNonce()), body, contentType)
    } catch (error) {
      if (!(error instanceof FileExistsError) || attempt >= 3) throw error
    }
  }
}

/* -------------------------------------------------------------------------
   The S3 adapter.
   ------------------------------------------------------------------------- */

export interface S3Options {
  readonly endpoint: string
  readonly bucket: string
  readonly region: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
  /**
   * Bucket in the path (`endpoint/bucket/key`) rather than in the host
   * (`bucket.endpoint/key`). True for MinIO and for R2's S3 endpoint, false
   * for AWS proper, which has deprecated path style.
   */
  readonly forcePathStyle: boolean
  /** Injected so the signing tests are not a function of the wall clock. */
  readonly clock?: () => Date
}

/** SigV4's own ceiling. A week-old link is a leak, not a convenience. */
export const MAX_EXPIRY_SECONDS = 604_800

export function s3FileStore(options: S3Options): FileStore {
  const clock = options.clock ?? (() => new Date())
  const credentials: SigV4Credentials = {
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    region: options.region,
  }

  const base = new URL(options.endpoint)
  const origin = options.forcePathStyle
    ? `${base.protocol}//${base.host}`
    : `${base.protocol}//${options.bucket}.${base.host}`
  const host = new URL(origin).host

  /** Where an object sits, encoded, in whichever addressing style is in use. */
  const objectPath = (key: string): string =>
    options.forcePathStyle
      ? `/${uriEncode(options.bucket)}/${encodePath(key)}`
      : `/${encodePath(key)}`

  /**
   * Read a key the application handed us.
   *
   * A qualified key naming a *different* bucket is refused rather than quietly
   * read from this one. That mismatch means the row was written by a deployment
   * pointed somewhere else, and serving whatever happens to sit at the same
   * path here is worse than failing.
   */
  const resolveKey = (storageKey: string): string => {
    const parsed = parseStorageKey(storageKey)
    if (parsed.bucket && parsed.bucket !== options.bucket) {
      throw new FileStoreError(
        `storage key names bucket "${parsed.bucket}" but this store is bound to "${options.bucket}"`,
      )
    }
    return parsed.key
  }

  const send = async (
    method: string,
    key: string,
    init: { body?: Buffer; headers?: Record<string, string> } = {},
  ): Promise<Response> => {
    const path = objectPath(key)

    const headers = signRequest(
      {
        method,
        path,
        headers: { host, ...init.headers },
        payloadHash: sha256Hex(init.body ?? ''),
      },
      credentials,
      clock(),
    )

    /*
      A timeout, for the reason the FX adapter has one: this runs inside a
      request somebody is waiting on, and object storage that has stopped
      answering must fail rather than hold the connection open until something
      further up the chain gives up first.
    */
    const response = await fetch(`${origin}${path}`, {
      method,
      headers,
      body: init.body,
      signal: AbortSignal.timeout(30_000),
    })

    if (!response.ok) {
      // S3 errors are XML. `Code` and `Message` are the two fields every
      // implementation of this protocol agrees on.
      const text = await response.text().catch(() => '')
      const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1] ?? String(response.status)
      const message = /<Message>([^<]+)<\/Message>/.exec(text)?.[1] ?? response.statusText
      throw new FileStoreError(`${method} ${key} failed: ${code} — ${message}`, response.status)
    }

    return response
  }

  return {
    key: 's3',

    async put(
      key: string,
      body: Buffer,
      contentType: string,
      putOptions?: { readonly ifExists?: 'refuse' | 'keep' },
    ): Promise<StoredFile> {
      const target = resolveKey(key)
      try {
        /*
          A conditional write: `If-None-Match: *` makes the store refuse with
          412 when the key already exists, atomically, which a HEAD-then-PUT
          could not (two writers both see "absent"). AWS S3 and Cloudflare R2
          both honour it. A 409 is S3's answer to two conditional writes of one
          key in flight at once, and means the same thing to the caller.
        */
        await send('PUT', target, {
          body,
          headers: {
            'content-type': contentType,
            'content-length': String(body.byteLength),
            'if-none-match': '*',
          },
        })
      } catch (error) {
        const clash =
          error instanceof FileStoreError && (error.status === 412 || error.status === 409)
        if (!clash) throw error
        if (putOptions?.ifExists !== 'keep') throw new FileExistsError(target)
      }

      return {
        storageKey: qualifyKey(options.bucket, target),
        byteSize: body.byteLength,
        checksum: sha256Hex(body),
      }
    },

    async get(key: string): Promise<Buffer> {
      const response = await send('GET', resolveKey(key))
      return Buffer.from(await response.arrayBuffer())
    },

    signedUrl(
      key: string,
      expiresInSeconds: number,
      options?: { readonly downloadFilename?: string },
    ): Promise<string> {
      if (
        !Number.isInteger(expiresInSeconds) ||
        expiresInSeconds <= 0 ||
        expiresInSeconds > MAX_EXPIRY_SECONDS
      ) {
        return Promise.reject(
          new FileStoreError(
            `expiry must be a whole number of seconds between 1 and ${MAX_EXPIRY_SECONDS}, got ${expiresInSeconds}`,
          ),
        )
      }

      /*
        The filename travels as a signed query parameter.

        S3 and everything that imitates it honour `response-content-disposition`
        on a GET, and because it is inside the signature nobody holding the link
        can rename the file on its way to a customer. Quotes are stripped rather
        than escaped: a quote in a header value is a header injection waiting
        for a careless proxy, and no shipping document needs one.
      */
      const query = options?.downloadFilename
        ? {
            'response-content-disposition': `attachment; filename="${options.downloadFilename.replace(/["\\\r\n]/g, '')}"`,
          }
        : undefined

      return Promise.resolve(
        presignUrl(
          { method: 'GET', origin, path: objectPath(resolveKey(key)), query, expiresInSeconds },
          credentials,
          clock(),
        ),
      )
    },

    async retire(key: string): Promise<void> {
      const target = resolveKey(key)
      if (target.startsWith('retired/')) return

      /*
        Copy first, delete second.

        The other order loses the file outright if the second call fails; this
        order at worst leaves a duplicate, and a duplicate is something a person
        can look at afterwards and decide about.
      */
      await send('PUT', retiredKey(target), {
        headers: {
          'x-amz-copy-source': `/${options.bucket}/${encodePath(target)}`,
          'x-amz-metadata-directive': 'COPY',
        },
      })
      await send('DELETE', target)
    },
  }
}

/* -------------------------------------------------------------------------
   The in-process adapter.
   ------------------------------------------------------------------------- */

/**
 * Files in a `Map`, for tests and for a developer who has not started MinIO.
 *
 * A real implementation of the port rather than a stub: retirement moves the
 * key exactly as the S3 driver does, so a test asserting that a retired file no
 * longer resolves is asserting the same thing under both. `signedUrl` returns a
 * `data:` URL, which is honest — there is no server to sign against, and a
 * plausible-looking `https` URL that 404s would waste somebody's afternoon.
 */
export function memoryFileStore(): FileStore & { readonly contents: Map<string, Buffer> } {
  const contents = new Map<string, Buffer>()
  const types = new Map<string, string>()

  const resolve = (storageKey: string): string => parseStorageKey(storageKey).key

  return {
    key: 'memory',
    contents,

    put(
      key: string,
      body: Buffer,
      contentType: string,
      options?: { readonly ifExists?: 'refuse' | 'keep' },
    ): Promise<StoredFile> {
      const target = resolve(key)
      // The same refusal as the S3 driver's conditional write, so a test of
      // a caller means the same thing under both.
      if (contents.has(target)) {
        if (options?.ifExists !== 'keep') return Promise.reject(new FileExistsError(target))
      } else {
        contents.set(target, body)
        types.set(target, contentType)
      }
      return Promise.resolve({
        storageKey: qualifyKey('memory', target),
        byteSize: body.byteLength,
        checksum: sha256Hex(body),
      })
    },

    get(key: string): Promise<Buffer> {
      const found = contents.get(resolve(key))
      if (!found) return Promise.reject(new FileStoreError(`no such key: ${key}`, 404))
      return Promise.resolve(found)
    },

    signedUrl(key: string): Promise<string> {
      const target = resolve(key)
      const found = contents.get(target)
      if (!found) return Promise.reject(new FileStoreError(`no such key: ${key}`, 404))
      const type = types.get(target) ?? 'application/octet-stream'
      return Promise.resolve(`data:${type};base64,${found.toString('base64')}`)
    },

    retire(key: string): Promise<void> {
      const target = resolve(key)
      const found = contents.get(target)
      if (found) {
        contents.set(retiredKey(target), found)
        types.set(retiredKey(target), types.get(target) ?? 'application/octet-stream')
        contents.delete(target)
        types.delete(target)
      }
      return Promise.resolve()
    },
  }
}
