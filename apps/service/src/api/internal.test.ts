/**
 * The guard on `/internal`.
 *
 * Worth its own test because of what is behind it: this prefix authenticates
 * the *caller* by shared secret and then acts as whatever principal the caller
 * names. A leaked secret plus a publicly routable prefix is every branch's
 * data, and the control that prevents it has historically lived in a proxy
 * config — one checkbox away from being lost on a redeploy.
 *
 * These assertions are what stop that control being quietly removed from the
 * code as well.
 */

import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SECRET = 'test-internal-secret'

vi.mock('../config', () => ({
  config: {
    INTERNAL_API_SECRET: SECRET,
    INTERNAL_API_TRUST_PROXY: false,
    WEB_URL: 'http://localhost:3000',
  },
}))

/*
  The route module pulls in Chromium, the storage driver and the database
  through its handlers. None of that is under test here — the hook runs before
  any of it — so the heavy edges are stubbed and the real hook is exercised.
*/
vi.mock('../adapters/index', () => ({
  adapters: () => ({ fileStore: { key: 'memory' } }),
  sendMail: vi.fn(),
  smtpOptions: () => ({}),
}))
vi.mock('../adapters/file-store', () => ({ FileStoreError: class extends Error {} }))
vi.mock('../pdf/documents', () => ({
  DocumentNotFoundError: class extends Error {},
  renderInvoicePdf: vi.fn(),
}))
vi.mock('../pdf/job-documents', () => ({
  JOB_DOCUMENT_KINDS: ['house_bill'],
  renderJobDocumentPdf: vi.fn(),
  renderManifestPdf: vi.fn(),
}))
vi.mock('../pdf/store', () => ({ storeJobDocument: vi.fn() }))
vi.mock('../accounting/export', () => ({
  ExportError: class extends Error {},
  buildAccountingExport: vi.fn(),
  voidAccountingExport: vi.fn(),
}))
/*
  The real exports, with only the connection stubbed.

  These tests exercise the auth hook, which runs before any handler, so nothing
  here reaches the database. The mock still has to satisfy every *named import*
  the route's handler graph pulls from `@qabandi/db` at load time — a set that
  grows whenever a handler gains a table (a covering-note handler added
  `locations`, and the old `{ db, principals }` stub stopped resolving). Spreading
  the actual module resolves them all and keeps `db` — the connection — inert, so
  the guard is tested without a database and without chasing the import list.
*/
vi.mock('@qabandi/db', async () => {
  const actual = await vi.importActual<typeof import('@qabandi/db')>('@qabandi/db')
  return { ...actual, db: {} }
})

const { internalApi } = await import('./internal')

let app: FastifyInstance

beforeEach(async () => {
  app = Fastify({ logger: false })
  await app.register(internalApi, { prefix: '/internal' })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const call = (headers: Record<string, string>) =>
  app.inject({
    method: 'POST',
    url: '/internal/documents/invoice/00000000-0000-0000-0000-000000000000',
    headers,
    payload: { actor: { principalId: 'p', type: 'system' } },
  })

describe('reaching the internal API through a proxy', () => {
  /*
    404, not 403. A prefix that answers "forbidden" has confirmed it exists and
    is worth attacking — the same reasoning as FR-ID-04 applies to a route as
    much as to a row.
  */
  it.each([
    ['x-forwarded-for', '203.0.113.9'],
    ['x-forwarded-host', 'svc.example.com'],
    ['x-forwarded-proto', 'https'],
    ['forwarded', 'for=203.0.113.9;proto=https'],
  ])('refuses a request carrying %s, as not found', async (header, value) => {
    const response = await call({ 'x-internal-secret': SECRET, [header]: value })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'not_found' })
  })

  it('refuses before checking the secret, so a valid secret does not help', async () => {
    const withSecret = await call({ 'x-internal-secret': SECRET, 'x-forwarded-for': '1.2.3.4' })
    const withoutSecret = await call({ 'x-forwarded-for': '1.2.3.4' })

    expect(withSecret.statusCode).toBe(404)
    expect(withoutSecret.statusCode).toBe(404)
  })
})

describe('reaching it over the private network', () => {
  it('still refuses a wrong secret', async () => {
    const response = await call({ 'x-internal-secret': 'wrong' })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'unauthenticated' })
  })

  it('refuses a missing secret', async () => {
    expect((await call({})).statusCode).toBe(401)
  })

  /*
    Past the hook. The handler then refuses on its own terms — the actor here
    is well-formed, so this reaches the mocked renderer and comes back as a
    render failure rather than a 401 or a 404 from the hook.
  */
  it('admits a correct secret with no forwarding headers', async () => {
    const response = await call({ 'x-internal-secret': SECRET })

    expect(response.statusCode).not.toBe(401)
    expect(response.statusCode).not.toBe(404)
  })

  it('refuses a call that names no actor', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/documents/invoice/00000000-0000-0000-0000-000000000000',
      headers: { 'x-internal-secret': SECRET },
      payload: {},
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'no_actor' })
  })
})
