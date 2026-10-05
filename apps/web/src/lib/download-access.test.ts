/**
 * Every file route refuses the roles its page refuses — run 5, R4.
 *
 * The invoice PDF answered any staff member in the branch while the invoice
 * page refused all but finance and management. Each case below calls the real
 * route handler with a session the page would turn away, and expects the same
 * *not found* the page gives. No database: the refusal has to come before the
 * route asks one, and an allowed caller is shown reaching the pilot's
 * "not available" answer instead, which is how far a route gets without one.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/session', () => ({ getSession: async () => harness.session }))
vi.mock('next-intl/server', () => ({
  getLocale: async () => 'en',
  getRequestConfig: (config: unknown) => config,
  getTranslations: async (namespace: string) => (key: string) => `${namespace}.${key}`,
}))

beforeAll(() => {
  delete process.env.DATABASE_URL
  process.env.QABANDI_PILOT_FIXTURES = '1'
})

const ID = '01a10abc-bfcd-722e-99e6-96458d763006'
const BRANCH = '00000000-0000-7000-8000-00000000b001'

type ActorType = 'internal' | 'customer_contact' | 'agent_contact'

/** A session as `getSession` builds one, holding exactly these permissions. */
function sessionOf(type: ActorType, permissions: readonly string[] = []) {
  return {
    actor: {
      principalId: '00000000-0000-7000-8000-0000000000a1',
      type,
      branchIds: type === 'internal' ? [BRANCH] : [],
      customerId: type === 'customer_contact' ? '00000000-0000-7000-8000-0000000000c1' : null,
      partnerId: type === 'agent_contact' ? '00000000-0000-7000-8000-0000000000d1' : null,
      ip: null,
    },
    permissions: new Set(permissions),
    branchRoles: new Map(),
    branchPermissions: new Map(),
    requiresTwoFactor: false,
  }
}

/*
  What the seed gives the roles run 5 used: read-only, coordinator, sales and
  customs broker hold `job.read` and none of the finance keys.
*/
const READ_ONLY = sessionOf('internal', ['job.read'])
const FINANCE = sessionOf('internal', ['job.read', 'receivable.read', 'report.read'])
const CUSTOMER = sessionOf('customer_contact')
const AGENT = sessionOf('agent_contact')

const request = (path: string) => new Request(`http://localhost${path}`)
const params = <T extends object>(value: T) => ({ params: Promise.resolve(value) })

async function status(session: unknown, call: () => Promise<Response>): Promise<number> {
  harness.session = session
  return (await call()).status
}

describe('the invoice PDF', async () => {
  const { GET } = await import('../app/api/invoices/[id]/pdf/route')
  const call = () => GET(request(`/api/invoices/${ID}/pdf`), params({ id: ID }))

  it('refuses staff the invoice page refuses', async () => {
    expect(await status(READ_ONLY, call)).toBe(404)
  })

  it('refuses an agent contact, whose shell shows no invoices', async () => {
    expect(await status(AGENT, call)).toBe(404)
  })

  it('lets finance and the customer through to the render', async () => {
    expect(await status(FINANCE, call)).toBe(501)
    expect(await status(CUSTOMER, call)).toBe(501)
  })
})

describe('the quote PDF', async () => {
  const { GET } = await import('../app/api/quotes/[id]/pdf/route')
  const call = () => GET(request(`/api/quotes/${ID}/pdf`), params({ id: ID }))

  it('refuses an agent contact', async () => {
    expect(await status(AGENT, call)).toBe(404)
  })

  it('serves any staff member, as the quote page does, and the customer', async () => {
    expect(await status(READ_ONLY, call)).toBe(501)
    expect(await status(CUSTOMER, call)).toBe(501)
  })
})

describe('a job document preview', async () => {
  const { GET } = await import('../app/api/jobs/[id]/documents/[kind]/route')
  const call = () =>
    GET(request(`/api/jobs/${ID}/documents/house_bill`), params({ id: ID, kind: 'house_bill' }))

  it('refuses a customer or agent contact a draft rendered from the live job', async () => {
    expect(await status(CUSTOMER, call)).toBe(404)
    expect(await status(AGENT, call)).toBe(404)
  })

  it('serves staff, who see the preview links on the job page', async () => {
    expect(await status(READ_ONLY, call)).toBe(501)
  })
})

describe('the consolidation manifest', async () => {
  const { GET } = await import('../app/api/consolidations/[id]/manifest/route')
  const call = () => GET(request(`/api/consolidations/${ID}/manifest`), params({ id: ID }))

  it('refuses anyone outside the ops shell', async () => {
    expect(await status(CUSTOMER, call)).toBe(404)
    expect(await status(AGENT, call)).toBe(404)
  })

  it('serves staff', async () => {
    expect(await status(READ_ONLY, call)).toBe(501)
  })
})

describe('an asset', async () => {
  const { GET } = await import('../app/api/assets/[id]/route')
  const call = () => GET(request(`/api/assets/${ID}`), params({ id: ID }))

  it('refuses a customer or agent contact before asking the database', async () => {
    expect(await status(CUSTOMER, call)).toBe(404)
    expect(await status(AGENT, call)).toBe(404)
  })
})

describe('the margin export', async () => {
  const { GET } = await import('../app/api/reports/margin.csv/route')
  const call = () => GET(request('/api/reports/margin.csv'))

  it('refuses a role without report.read, as the reports page does', async () => {
    expect(await status(READ_ONLY, call)).toBe(403)
  })
})

describe('the audit export', async () => {
  const { GET } = await import('../app/api/audit.csv/route')
  const call = () => GET(request('/api/audit.csv'))

  it('refuses anyone without admin.audit.read, as the audit page does', async () => {
    expect(await status(FINANCE, call)).toBe(403)
  })
})

describe('an import template', async () => {
  const { GET } = await import('../app/api/templates/[kind]/route')
  const call = () =>
    GET(request('/api/templates/open-receivables'), params({ kind: 'open-receivables' }))

  it('refuses a role the imports page would not offer that kind to', async () => {
    expect(await status(READ_ONLY, call)).toBe(404)
  })
})
