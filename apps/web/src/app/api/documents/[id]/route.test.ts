/**
 * Who may download which document — A12, A17, U3.
 *
 * The route checked only `released_at`, so a customer holding the id of a
 * superseded bill, or of an internal-only document type on their own job,
 * could download it. These run the real lookup against a real database as a
 * customer contact, and stop at the point the route would ask the service to
 * sign a link (which is not configured here, and says so).
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const harness = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/session', () => ({ getSession: async () => harness.session }))
vi.mock('next-intl/server', () => ({
  getLocale: async () => 'en',
  getRequestConfig: (config: unknown) => config,
  getTranslations: async (namespace: string) => (key: string) => `${namespace}.${key}`,
}))

const { assets, documentTypes, documents, systemActor, withActor } = await import('@qabandi/db')
const { CUSTOMER, HOME_BRANCH, HOME_JOB, world } = await import('@/lib/testing/fixtures')
const { GET } = await import('./route')

const customerSession = {
  actor: {
    principalId: '00000000-0000-7000-8000-0000000000e1',
    type: 'customer_contact' as const,
    branchIds: [],
    customerId: CUSTOMER,
    partnerId: null,
    ip: null,
  },
}

const call = (id: string, accept = 'application/json') =>
  GET(new Request(`http://app.test/api/documents/${id}`, { headers: { accept } }), {
    params: Promise.resolve({ id }),
  })

async function documentWith(over: {
  released?: boolean
  superseded?: boolean
  visibleType?: boolean
}): Promise<string> {
  return withActor(systemActor(), async (tx) => {
    const code = `DL-${randomUUID().slice(0, 8)}`
    const [type] = await tx
      .insert(documentTypes)
      .values({
        code,
        nameEn: 'Download test',
        nameAr: 'اختبار التنزيل',
        category: 'test',
        isCustomerVisible: over.visibleType ?? true,
      })
      .returning({ id: documentTypes.id })
    const insertDocument = async (suffix: string, released: boolean) => {
      const [asset] = await tx
        .insert(assets)
        .values({
          branchId: HOME_BRANCH,
          storageKey: `memory:test/${code}${suffix}`,
          fileName: `${code}${suffix}.pdf`,
          contentType: 'application/pdf',
          byteSize: 1,
        })
        .returning({ id: assets.id })
      const [doc] = await tx
        .insert(documents)
        .values({
          jobId: HOME_JOB,
          documentTypeId: type!.id,
          assetId: asset!.id,
          releasedAt: released ? new Date() : null,
        })
        .returning({ id: documents.id })
      return doc!.id
    }

    const id = await insertDocument('', over.released !== false)
    if (over.superseded) {
      const successor = await insertDocument('-v2', true)
      await tx.update(documents).set({ supersededById: successor }).where(eq(documents.id, id))
    }
    return id
  })
}

describe.skipIf(!enabled)('downloading a document', () => {
  beforeAll(async () => {
    await world()
    harness.session = customerSession
    delete process.env.SERVICE_URL
  })

  it('gives a customer a released, current, customer-visible document', async () => {
    const id = await documentWith({})
    // Past the checks: the only thing missing is the signing service.
    expect((await call(id)).status).toBe(503)
  })

  it('refuses a customer a superseded version', async () => {
    expect((await call(await documentWith({ superseded: true }))).status).toBe(404)
  })

  it('refuses a customer a document type marked internal', async () => {
    expect((await call(await documentWith({ visibleType: false }))).status).toBe(404)
  })

  it('refuses a customer a draft', async () => {
    expect((await call(await documentWith({ released: false }))).status).toBe(404)
  })

  it('answers a malformed id with not found rather than a 500', async () => {
    expect((await call('not-a-uuid')).status).toBe(404)
  })

  /** U3: a browser following the link gets a page, not `{"error":…}`. */
  it('shows a person a page rather than raw JSON', async () => {
    const response = await call('not-a-uuid', 'text/html,application/xhtml+xml')
    expect(response.headers.get('content-type')).toContain('text/html')
    const html = await response.text()
    expect(html).toContain('fileRefusal.not_found.title')
    expect(html).not.toContain('{"error"')
  })
})
