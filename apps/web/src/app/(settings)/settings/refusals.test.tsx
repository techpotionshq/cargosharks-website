/**
 * Every settings page refuses a role without its permission politely — run 5,
 * R5.
 *
 * `/settings/api-keys` threw `assertCan`'s ForbiddenError at an operations
 * manager who typed the URL, and they got the "Something went wrong" page.
 * Each page here is called as Next calls it, with a staff session holding no
 * administration keys at all, and must either render a refusal or answer
 * *not found* (Next's `notFound()` throws a marked error the router turns into
 * the 404 page). Anything else thrown is the crash this guards against.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'

const harness = vi.hoisted(() => ({ session: null as unknown }))
vi.mock('@/lib/session', () => ({
  getSession: async () => harness.session,
  requireSession: async () => harness.session,
}))
vi.mock('next-intl/server', () => ({
  getLocale: async () => 'en',
  getTimeZone: async () => 'Asia/Kuwait',
  getRequestConfig: (config: unknown) => config,
  getTranslations: async (namespace: string) => {
    const t = (key: string) => `${namespace}.${key}`
    return Object.assign(t, { has: () => true, rich: t, markup: t, raw: t })
  },
}))

beforeAll(() => {
  delete process.env.DATABASE_URL
  process.env.QABANDI_PILOT_FIXTURES = '1'
})

/** An operations manager's kind of session: plenty of keys, none of them `admin.*`. */
harness.session = {
  actor: {
    principalId: '00000000-0000-7000-8000-0000000000a1',
    type: 'internal',
    branchIds: ['00000000-0000-7000-8000-00000000b001'],
    customerId: null,
    partnerId: null,
    ip: null,
  },
  principal: {
    id: '00000000-0000-7000-8000-0000000000a1',
    nameEn: 'Noura',
    nameAr: 'نورة',
    email: 'noura@qabandi.test',
    locale: 'en',
    timezone: 'Asia/Kuwait',
  },
  permissions: new Set(['job.read', 'job.update', 'enquiry.assign', 'quote.send']),
  branchRoles: new Map(),
  branchPermissions: new Map(),
  requiresTwoFactor: false,
}

const PAGES = [
  'api-keys',
  'notifications',
  'audit',
  'users',
  'brand',
  'mailboxes',
  'integrations',
  'intake-agent',
  'support',
  'branches',
  'whatsapp-numbers',
] as const

const props = { searchParams: Promise.resolve({}), params: Promise.resolve({}) }

/** Next marks `notFound()` with this digest; the router renders the 404 page. */
const isNotFound = (error: unknown) =>
  typeof (error as { digest?: unknown })?.digest === 'string' &&
  (error as { digest: string }).digest.startsWith('NEXT_HTTP_ERROR_FALLBACK;404')

describe.each(PAGES)('/settings/%s without its permission', (page) => {
  it('refuses politely rather than crashing', async () => {
    const module = (await import(`./${page}/page.tsx`)) as {
      default: (p: typeof props) => Promise<ReactElement>
    }
    let element: ReactElement | null = null
    try {
      element = await module.default(props)
    } catch (error) {
      expect(isNotFound(error), String(error)).toBe(true)
      return
    }
    // Rendered: it must be the refusal, naming what is missing.
    expect(renderToStaticMarkup(element)).toMatch(/\.forbidden/)
  })
})
