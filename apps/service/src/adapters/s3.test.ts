/**
 * The signing, and the two behaviours around it that can be wrong quietly.
 *
 * A wrong signature fails loudly and immediately, which makes it the *easy*
 * failure — except that hand-rolled SigV4 has to be right before anything else
 * about this adapter can be trusted, so it is pinned here against the vectors
 * AWS publishes in the S3 signing documentation. Those vectors carry a known
 * secret, a fixed clock and a known-good signature; if the canonicalisation
 * drifts by one byte the expected hex stops matching.
 *
 * The rest is the pair of things that would *not* announce themselves: a
 * retirement that deletes instead of copying, and a storage key from another
 * bucket being served out of this one.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  memoryFileStore,
  parseStorageKey,
  presignUrl,
  qualifyKey,
  s3FileStore,
  signRequest,
  type SigV4Credentials,
} from './s3'

/** The credentials AWS uses throughout its own signing examples. */
const EXAMPLE: SigV4Credentials = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
}

const EXAMPLE_DATE = new Date('2013-05-24T00:00:00Z')

describe('SigV4, against the published vectors', () => {
  /**
   * "Example: GET Object" — a ranged read of `test.txt` from `examplebucket`,
   * virtual-host addressed, signed with an `Authorization` header.
   */
  it('signs a header-authenticated GET', () => {
    const headers = signRequest(
      {
        method: 'GET',
        path: '/test.txt',
        headers: { host: 'examplebucket.s3.amazonaws.com', range: 'bytes=0-9' },
        payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      },
      EXAMPLE,
      EXAMPLE_DATE,
    )

    expect(headers.authorization).toContain(
      'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    )
    expect(headers.authorization).toContain(
      'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date',
    )
    expect(headers['x-amz-date']).toBe('20130524T000000Z')
  })

  /**
   * "Example: PUT Object" — the one whose key contains a `$`, which is exactly
   * the character that separates a correct URI encoder from a plausible one.
   */
  it('signs a header-authenticated PUT with an escaped key', () => {
    const body = Buffer.from('Welcome to Amazon S3.')

    const headers = signRequest(
      {
        method: 'PUT',
        path: '/test%24file.text',
        headers: {
          host: 'examplebucket.s3.amazonaws.com',
          date: 'Fri, 24 May 2013 00:00:00 GMT',
          'x-amz-storage-class': 'REDUCED_REDUNDANCY',
        },
        payloadHash: '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072',
      },
      EXAMPLE,
      EXAMPLE_DATE,
    )

    expect(body.toString()).toBe('Welcome to Amazon S3.')
    expect(headers.authorization).toContain(
      'Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd',
    )
  })

  /**
   * "Example: GET Object" using query parameters — the presigned form, which
   * is the one this adapter actually leans on for downloads.
   */
  it('presigns a URL', () => {
    const url = presignUrl(
      {
        method: 'GET',
        origin: 'https://examplebucket.s3.amazonaws.com',
        path: '/test.txt',
        expiresInSeconds: 86_400,
      },
      EXAMPLE,
      EXAMPLE_DATE,
    )

    expect(url).toContain(
      'X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    )
    expect(url).toContain('X-Amz-Expires=86400')
    expect(url).toContain('X-Amz-SignedHeaders=host')
    // The credential scope is URL-encoded, slashes included.
    expect(url).toContain(
      'X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request',
    )
  })
})

describe('storage keys', () => {
  it('round-trips the documented qualified form', () => {
    expect(parseStorageKey(qualifyKey('qabandi-docs', 'jobs/AQ-1/hbl.pdf'))).toEqual({
      bucket: 'qabandi-docs',
      key: 'jobs/AQ-1/hbl.pdf',
    })
  })

  /** The demo seed writes bare keys and is not going to be rewritten. */
  it('accepts a bare key', () => {
    expect(parseStorageKey('demo/AQ-2601-0001/HBL.pdf')).toEqual({
      key: 'demo/AQ-2601-0001/HBL.pdf',
    })
  })
})

/* ------------------------------------------------------------------------ */

interface Call {
  readonly method: string
  readonly url: string
  readonly headers: Record<string, string>
}

/** A `fetch` that records what was asked of it and answers whatever it is told. */
function stubFetch(responder: (call: Call) => Response = () => new Response('')): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', (input: string, init: RequestInit = {}) => {
    const call: Call = {
      method: init.method ?? 'GET',
      url: String(input),
      headers: Object.fromEntries(
        Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [
          k.toLowerCase(),
          v,
        ]),
      ),
    }
    calls.push(call)
    return Promise.resolve(responder(call))
  })
  return calls
}

const store = (overrides: Partial<Parameters<typeof s3FileStore>[0]> = {}) =>
  s3FileStore({
    endpoint: 'https://acct.r2.cloudflarestorage.com',
    bucket: 'qabandi-docs',
    region: 'auto',
    accessKeyId: EXAMPLE.accessKeyId,
    secretAccessKey: EXAMPLE.secretAccessKey,
    forcePathStyle: true,
    clock: () => EXAMPLE_DATE,
    ...overrides,
  })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the S3 driver', () => {
  it('puts an object and reports its size and checksum', async () => {
    const calls = stubFetch()
    const result = await store().put(
      'jobs/AQ-1/hbl.pdf',
      Buffer.from('pdf bytes'),
      'application/pdf',
    )

    expect(calls[0]!.method).toBe('PUT')
    expect(calls[0]!.url).toBe(
      'https://acct.r2.cloudflarestorage.com/qabandi-docs/jobs/AQ-1/hbl.pdf',
    )
    expect(calls[0]!.headers['content-type']).toBe('application/pdf')
    // R2 rejects an unsigned payload on a header-authenticated request.
    expect(calls[0]!.headers['x-amz-content-sha256']).toMatch(/^[0-9a-f]{64}$/)

    expect(result.byteSize).toBe(9)
    expect(result.storageKey).toBe('s3:qabandi-docs/jobs/AQ-1/hbl.pdf')
    // SHA-256 of the body — `assets.checksum` exists for de-duplication and
    // for the integrity check on a restore drill, so it is the file's hash and
    // not the request's.
    expect(result.checksum).toBe('d1cb546b102fab8362de413fdacc187b05be10df72b72db3b3e50b4953f6a555')
  })

  /** Virtual-host addressing puts the bucket in the host, not the path. */
  it('addresses a bucket by host when path style is off', async () => {
    const calls = stubFetch()
    await store({ forcePathStyle: false }).get('jobs/AQ-1/hbl.pdf')

    expect(calls[0]!.url).toBe(
      'https://qabandi-docs.acct.r2.cloudflarestorage.com/jobs/AQ-1/hbl.pdf',
    )
  })

  it('turns an S3 error document into a message worth reading', async () => {
    stubFetch(
      () =>
        new Response(
          '<Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>',
          { status: 404 },
        ),
    )

    await expect(store().get('missing.pdf')).rejects.toThrow(
      /NoSuchKey — The specified key does not exist/,
    )
  })

  /**
   * A row written against a different bucket is refused rather than read from
   * this one. Serving whatever happens to sit at the same path here would be a
   * silent wrong answer, and this failure is the loud version of it.
   */
  it('refuses a storage key belonging to another bucket', async () => {
    stubFetch()
    await expect(store().get('s3:someone-elses-bucket/jobs/AQ-1/hbl.pdf')).rejects.toThrow(
      /bound to "qabandi-docs"/,
    )
  })

  /** Retirement copies before it deletes — see the port's comment on `retire`. */
  it('retires by copying under a prefix and then removing the live key', async () => {
    const calls = stubFetch()
    await store().retire('jobs/AQ-1/hbl.pdf')

    expect(calls.map((c) => c.method)).toEqual(['PUT', 'DELETE'])
    expect(calls[0]!.url).toContain('/qabandi-docs/retired/jobs/AQ-1/hbl.pdf')
    expect(calls[0]!.headers['x-amz-copy-source']).toBe('/qabandi-docs/jobs/AQ-1/hbl.pdf')
    expect(calls[1]!.url).toContain('/qabandi-docs/jobs/AQ-1/hbl.pdf')
  })

  /** An already-retired key is left alone rather than retired twice. */
  it('is idempotent on an already-retired key', async () => {
    const calls = stubFetch()
    await store().retire('retired/jobs/AQ-1/hbl.pdf')
    expect(calls).toEqual([])
  })

  it('refuses an expiry beyond the seven days SigV4 allows', async () => {
    await expect(store().signedUrl('jobs/AQ-1/hbl.pdf', 604_801)).rejects.toThrow(/expiry must be/)
    await expect(store().signedUrl('jobs/AQ-1/hbl.pdf', 0)).rejects.toThrow(/expiry must be/)
  })

  it('signs a download URL without contacting the bucket', async () => {
    const calls = stubFetch()
    const url = await store().signedUrl('jobs/AQ-1/hbl.pdf', 900)

    expect(calls).toEqual([])
    expect(url).toContain('/qabandi-docs/jobs/AQ-1/hbl.pdf?')
    expect(url).toContain('X-Amz-Expires=900')
    expect(url).toMatch(/X-Amz-Signature=[0-9a-f]{64}$/)
  })
})

describe('the memory driver', () => {
  it('round-trips a file', async () => {
    const files = memoryFileStore()
    const stored = await files.put('a/b.txt', Buffer.from('hello'), 'text/plain')

    expect(stored.byteSize).toBe(5)
    expect((await files.get(stored.storageKey)).toString()).toBe('hello')
    expect(await files.signedUrl('a/b.txt', 60)).toBe('data:text/plain;base64,aGVsbG8=')
  })

  /** The same retirement semantics as S3, so a test means the same under both. */
  it('retires a file without destroying it', async () => {
    const files = memoryFileStore()
    await files.put('a/b.txt', Buffer.from('hello'), 'text/plain')
    await files.retire('a/b.txt')

    await expect(files.get('a/b.txt')).rejects.toThrow(/no such key/)
    expect(files.contents.get('retired/a/b.txt')?.toString()).toBe('hello')
  })
})
