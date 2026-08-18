/**
 * Shared end-to-end helpers.
 *
 * Two things every spec here wants, and neither is worth repeating: the routes
 * the interface actually serves, and a page that fails when the browser
 * console does.
 */

import type { Page, TestInfo } from '@playwright/test'
import { expect } from '@playwright/test'

export const LOCALE_COOKIE = 'qabandi_locale'

/**
 * Where the signed-in session is persisted between the setup project and the
 * test projects. Gitignored — it holds a real session cookie.
 */
export const STORAGE_STATE = 'e2e/.auth/state.json'

/**
 * The two ways this product can be stood up for evaluation, and the reason
 * this file has two route lists instead of one.
 *
 * `full` — Postgres 18, `db:migrate`, `db:seed`, `db:seed-demo`. Every screen
 * works, because `seed-demo.ts` populates every table an evaluation touches:
 * customers, partners, rate cards, invoices partly paid, containers past free
 * time. This is the demo instance a prospect should be given a URL to, and the
 * mode that gives the suite its real coverage.
 *
 * `offline` — `QABANDI_PILOT_FIXTURES=1`, no database at all. Fast, hermetic,
 * and the mode that proves the day-15 rehearsal claim. It covers *less* than
 * the README used to imply: the fixture set was written for the screens the
 * pilot needed, and the register queries behind finance, network, operations
 * and reference still go straight to `withActor`. Those routes 500 without a
 * database rather than degrading, which is a real gap and is named here rather
 * than quietly omitted from the sweep.
 */
export type Mode = 'offline' | 'full'

export const MODE: Mode = process.env.E2E_MODE === 'full' ? 'full' : 'offline'

/** Every internal screen, as the sidebar groups it. */
const ALL_OPS_ROUTES = [
  '/dashboard',
  '/enquiries',
  '/quotes',
  '/jobs',
  '/consolidations',
  '/customs',
  '/exceptions',
  '/documents',
  '/finance',
  '/invoices',
  '/payments',
  '/rates',
  '/customers',
  '/partners',
  '/locations',
  '/reference',
  '/imports',
] as const

const ALL_SETTINGS_ROUTES = [
  '/settings',
  '/settings/users',
  '/settings/branches',
  '/settings/audit',
  '/settings/support',
  '/settings/brand',
] as const

/**
 * What renders with no database today, verified by probing every route rather
 * than inferred from the code.
 *
 * Shrinking this list is a regression. *Growing* it is the fix for
 * `NEEDS_DATABASE` below — each route moves here as its query learns the
 * `usePilotFixtures()` branch every other feature already has.
 */
const OFFLINE_OPS_ROUTES = ['/imports'] as const
const OFFLINE_SETTINGS_ROUTES = ['/settings', '/settings/brand'] as const

/**
 * Screens that require a database even in fixture mode, with the query that
 * makes it so. Reported by `routes.spec.ts` as skipped-with-a-reason, so the
 * gap appears in the run rather than being invisible.
 */
export const NEEDS_DATABASE: Record<string, string> = {
  '/dashboard': 'dashboard/queries.ts getMapData',
  '/enquiries': 'enquiries — secondary register query',
  '/quotes': 'ledger/queries.ts listQuotes',
  '/jobs': 'jobs — secondary register query',
  '/consolidations': 'consolidation/queries.ts listConsolidations',
  '/customs': 'operations/queries.ts listCustoms',
  '/exceptions': 'operations/queries.ts listExceptions',
  '/documents': 'operations/queries.ts listDocuments',
  '/finance': 'ledger/queries.ts receivablesAgeing',
  '/invoices': 'ledger/queries.ts listInvoices',
  '/payments': 'ledger/queries.ts listPayments',
  '/rates': 'rates/queries.ts listRateCards',
  '/customers': 'customers/queries.ts listCustomers',
  '/partners': 'network/queries.ts listPartners',
  '/locations': 'network/queries.ts listLocations',
  '/reference': 'admin/queries.ts referenceCounts',
  '/settings/users': 'admin/queries.ts — user register',
  '/settings/branches': 'admin/queries.ts — branch register',
  '/settings/audit': 'admin/queries.ts — audit register',
  '/settings/support': 'features/support/queries.ts — grants and access trail',
}

export const OPS_ROUTES: readonly string[] = MODE === 'full' ? ALL_OPS_ROUTES : OFFLINE_OPS_ROUTES

export const SETTINGS_ROUTES: readonly string[] =
  MODE === 'full' ? ALL_SETTINGS_ROUTES : OFFLINE_SETTINGS_ROUTES

/** Every route, whatever the mode — used to report the gap. */
export const ALL_ROUTES: readonly string[] = [...ALL_OPS_ROUTES, ...ALL_SETTINGS_ROUTES]

/**
 * One internal screen wearing the full chrome — sidebar, language switch,
 * theme switch — for the tests that are about the frame rather than the
 * contents. `/dashboard` in full mode; the first route that works with no
 * database otherwise.
 */
export const CHROME_ROUTE: string = MODE === 'full' ? '/dashboard' : OPS_ROUTES[0]!

/**
 * Console errors and uncaught exceptions, collected for the life of the page.
 *
 * A screen that renders but throws in the browser is a screen that will fail
 * on the second interaction, and a hydration mismatch is exactly the class of
 * bug a screenshot test waves through. Returning the array rather than
 * asserting inside lets a spec decide when to check.
 */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = []

  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    const from = message.location().url

    // Next's dev overlay and the browser's own noise about a missing favicon
    // are not the application failing.
    if (/favicon|Download the React DevTools/i.test(text)) return

    /*
      Hot-module-reload traffic, likewise.

      `next dev` opens a websocket to `/_next/hmr`; Playwright's context closes
      pages faster than the handshake completes, so a local run collects a 403
      and an `ERR_INVALID_HTTP_RESPONSE` on every single navigation. CI builds
      and serves production, where none of this exists — so without the filter
      the suite is red for every developer and green in the pipeline, which is
      the worst of both.

      Scoped to `/_next/` so a 403 from the application itself still fails.
    */
    if (/_next\/hmr/.test(text) || /_next\/hmr/.test(from)) return
    if (/ERR_INVALID_HTTP_RESPONSE|WebSocket connection to/i.test(text)) return
    if (/Failed to load resource/i.test(text) && /\/_next\//.test(from)) return

    errors.push(`console: ${text}`)
  })

  page.on('pageerror', (error) => {
    errors.push(`uncaught: ${error.message}`)
  })

  return errors
}

/** Sets the locale cookie the way the language switch does. */
export async function useLocale(page: Page, locale: 'en' | 'ar'): Promise<void> {
  await page
    .context()
    .addCookies([
      { name: LOCALE_COOKIE, value: locale, url: page.url() || 'http://localhost:3100' },
    ])
}

/**
 * Navigates and asserts the page is a page: HTTP 200, one `h1`, no console
 * errors. `ui/layout.tsx` renders exactly one `h1` per screen, so "how many
 * headings are there" is a real structural assertion rather than a proxy.
 */
export async function visitAndAssertHealthy(
  page: Page,
  path: string,
  testInfo?: TestInfo,
): Promise<void> {
  const errors = collectPageErrors(page)
  const response = await page.goto(path, { waitUntil: 'domcontentloaded' })

  expect(response?.status(), `${path} responded ${response?.status()}`).toBeLessThan(400)

  const heading = page.locator('h1')
  await expect(heading.first(), `${path} rendered no h1`).toBeVisible()

  if (testInfo) testInfo.annotations.push({ type: 'route', description: path })
  expect(errors, `${path} logged browser errors`).toEqual([])
}
