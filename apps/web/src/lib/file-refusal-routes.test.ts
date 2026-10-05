/**
 * The file routes when the service cannot be reached — live run 6.
 *
 * Each route answered a failed render with the `render_failed` page, but a
 * service that was down or timed out made `fetch` throw before the status was
 * read, and the reader got a bare 500 with an empty body. These stub `fetch`
 * to throw as an unreachable host and a timeout do, and expect the same 502
 * refusal a failed render gets. No database: the routes stop at the service.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/session', () => ({
  getSession: async () => ({
    actor: {
      principalId: '00000000-0000-7000-8000-0000000000e1',
      type: 'user' as const,
      branchIds: [],
      customerId: null,
      partnerId: null,
      ip: null,
    },
  }),
}))
vi.mock('@/lib/download-access', () => ({ mayDownload: () => true }))
vi.mock('@/lib/pilot/source', () => ({ usePilotFixtures: () => false }))
vi.mock('next-intl/server', () => ({
  getLocale: async () => 'en',
  getRequestConfig: (config: unknown) => config,
  getTranslations: async (namespace: string) => (key: string) => `${namespace}.${key}`,
}))

const ID = '00000000-0000-7000-8000-00000000f00d'

const invoice = await import('@/app/api/invoices/[id]/pdf/route')
const quote = await import('@/app/api/quotes/[id]/pdf/route')
const manifest = await import('@/app/api/consolidations/[id]/manifest/route')
const jobDocument = await import('@/app/api/jobs/[id]/documents/[kind]/route')

const calls: [string, () => Promise<Response>][] = [
  [
    'invoice',
    () =>
      invoice.GET(new Request(`http://app.test/api/invoices/${ID}/pdf`), {
        params: Promise.resolve({ id: ID }),
      }),
  ],
  [
    'quotation',
    () =>
      quote.GET(new Request(`http://app.test/api/quotes/${ID}/pdf`), {
        params: Promise.resolve({ id: ID }),
      }),
  ],
  [
    'manifest',
    () =>
      manifest.GET(new Request(`http://app.test/api/consolidations/${ID}/manifest`), {
        params: Promise.resolve({ id: ID }),
      }),
  ],
  [
    'job document',
    () =>
      jobDocument.GET(new Request(`http://app.test/api/jobs/${ID}/documents/delivery_order`), {
        params: Promise.resolve({ id: ID, kind: 'delivery_order' }),
      }),
  ],
]

describe('a file route whose service cannot be reached', () => {
  const saved = { url: process.env.SERVICE_URL, secret: process.env.INTERNAL_API_SECRET }
  beforeAll(() => {
    process.env.SERVICE_URL = 'http://service.test'
    process.env.INTERNAL_API_SECRET = 'test-secret'
    // The route logs why; the test does not need to read it.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })
  afterAll(() => {
    process.env.SERVICE_URL = saved.url
    process.env.INTERNAL_API_SECRET = saved.secret
    vi.restoreAllMocks()
  })

  for (const [name, call] of calls) {
    it(`answers a refused connection to the ${name} render with render_failed`, async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED') })
        }),
      )
      const response = await call()
      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({ error: 'render_failed' })
    })

    it(`answers a timed-out ${name} render with render_failed`, async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
        }),
      )
      const response = await call()
      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({ error: 'render_failed' })
    })
  }
})
