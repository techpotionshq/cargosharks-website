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
 * The two ways this product can be stood up, and what each one is *for*.
 *
 * `offline` — `QABANDI_PILOT_FIXTURES=1`, no database at all. This is the
 * hosted public demo, and the mode that proves the rehearsal claim: the whole
 * interface on a laptop with nothing provisioned. Every route in the lists
 * below renders here.
 *
 * `full` — Postgres 18, `db:migrate`, `db:seed`, `db:seed-demo`. This is how a
 * *customer's own* instance is provisioned before their branding and their data
 * go in. It is the mode that exercises the SQL, which is the half the fixtures
 * cannot check.
 *
 * The two lists were different until the offline gap was closed. They are the
 * same list now, and `routes.spec.ts` keeps them that way — see
 * `NEEDS_DATABASE` below, which is empty and is *checked* to be honest rather
 * than trusted.
 */
export type Mode = 'offline' | 'full'

export const MODE: Mode = process.env.E2E_MODE === 'full' ? 'full' : 'offline'

/** Every internal screen, as the sidebar groups it. */
const ALL_OPS_ROUTES = [
  '/dashboard',
  '/search',
  '/enquiries',
  '/quotes',
  '/jobs',
  '/consolidations',
  '/customs',
  '/exceptions',
  '/documents',
  '/assistant',
  '/finance',
  '/invoices',
  '/payments',
  // In the operations nav since the payables work landed, and never swept —
  // found while adding the detail routes below, and the same kind of gap.
  '/payables',
  '/settlements',
  '/rates',
  '/customers',
  // The creation form is a screen in its own right and was never swept: it is
  // the one page in the register whose fields, selects and reference options
  // all render before any record exists.
  '/customers/new',
  '/partners',
  '/locations',
  '/reference',
  '/imports',
  // The margin report. Absent from this sweep until the fixture pass found it
  // 500ing offline — added with a slice the lists had never heard of, which is
  // the drift `unswept()` in `routes.spec.ts` now fails on.
  '/reports',
] as const

const ALL_SETTINGS_ROUTES = [
  '/settings',
  '/settings/users',
  '/settings/branches',
  '/settings/audit',
  '/settings/support',
  '/settings/integrations',
  '/settings/notifications',
  '/settings/brand',
  // Both shipped after the lists were last touched and neither was ever swept.
  '/settings/api-keys',
  '/settings/mailboxes',
] as const

/**
 * Registers whose rows open a record, named by the register rather than by a
 * path — a detail URL needs an id, and the two datasets do not share one, so
 * the row is found on the board and followed.
 *
 * Until this list existed the suite never opened a record at all. That is how a
 * job file that threw on every render sat in `main`: `/jobs` was green
 * throughout, because the throw is in a card the board does not draw.
 *
 * Worth stating plainly, because it is the assertion that does the work here:
 * a thrown page is not caught by the heading check. `app/error.tsx` renders an
 * `h1` of its own, so the boundary looks exactly like a healthy screen to
 * everything except `collectPageErrors`.
 */
const ALL_DETAIL_ROUTES = [
  '/enquiries',
  '/quotes',
  '/jobs',
  '/consolidations',
  '/invoices',
  '/payables',
  '/settlements',
  '/customers',
  '/partners',
] as const

/**
 * Screens that still require a database in fixture mode, with the read that
 * makes it so.
 *
 * **Empty, and kept empty by a test rather than by good intentions.** Every
 * entry here is a route `routes.spec.ts` skips offline, so a wrong entry is
 * invisible — which is exactly what happened: this map named twenty register
 * queries that had a `usePilotFixtures()` branch all along, and the real cause
 * was four reads written in `ui/dialogs.tsx` and `ledger/unbilled.ts` instead
 * of in a slice's `queries.ts`. Twenty-nine route checks sat skipped for months
 * over four functions.
 *
 * So the list is now checked in both directions and neither check is optional:
 *
 *   - **A route named here must actually fail offline.** `routes.spec.ts`
 *     visits it and fails if it renders — otherwise a route that quietly gains
 *     a fixture branch stays skipped forever, which is how this got to twenty.
 *   - **A route not named here must render offline**, which is just the sweep.
 *
 * Adding an entry is therefore a deliberate, tested claim about the code, and
 * `scripts/check-fixtures.mjs` refuses the omission that would need one.
 */
export const NEEDS_DATABASE: Record<string, string> = {}

export const OPS_ROUTES: readonly string[] = ALL_OPS_ROUTES.filter((r) => !(r in NEEDS_DATABASE))

export const SETTINGS_ROUTES: readonly string[] = ALL_SETTINGS_ROUTES.filter(
  (r) => !(r in NEEDS_DATABASE),
)

/**
 * The registers a record is opened from, in both modes.
 *
 * Offline until the fixture pass this was empty — every register a row could be
 * clicked on was itself listed as needing a database, so the detail pages went
 * unswept in the mode CI runs on every commit.
 */
export const DETAIL_ROUTES: readonly string[] = ALL_DETAIL_ROUTES.filter(
  (r) => !(`${r}/:id` in NEEDS_DATABASE),
)

/** Every route, whatever the mode — the denominator for the coverage check. */
export const ALL_ROUTES: readonly string[] = [
  ...ALL_OPS_ROUTES,
  ...ALL_SETTINGS_ROUTES,
  ...ALL_DETAIL_ROUTES.map((register) => `${register}/:id`),
]

/**
 * Route segments the sweep is not expected to cover, so `unswept()` can tell a
 * genuinely missed screen from one that could never be in a list.
 *
 * Everything here is either not a screen (`/api`, `/webhooks`), reachable only
 * with a token or a reference number (`/track`, `/reset-password`), or a
 * different audience's entry point tested by its own spec rather than by the
 * internal sweep (`/portal`, `/agent`, `/sign-in`).
 */
const NOT_SWEPT = [
  '/api',
  '/webhooks',
  '/track',
  '/sign-in',
  '/reset-password',
  '/forgot-password',
  '/portal',
  '/agent',
  /*
    Both halves of the second factor — FR-ID-06.

    Not swept for the same reason `/sign-in` is not: they are reachable only
    from a state the sweep does not hold. `/two-factor` needs the short-lived
    challenge cookie Better Auth issues to an account that has TOTP, and the
    sweep signs in as one that does not. `/two-factor/enrol` needs a principal
    whose role demands a second factor *and* who has not enrolled — and in
    fixture mode there is no `auth_user` at all, so both redirect rather than
    render. Listing them here says that plainly instead of leaving a screen the
    manifest knows about and the sweep has never heard of.
  */
  '/two-factor',
  '/', // redirects to /dashboard
] as const

/**
 * The routes the build says it serves.
 *
 * `app-path-routes-manifest.json` is written by `next build`, so it is the
 * application's own account of itself rather than a second list somebody has to
 * remember to update. Returns empty when there is no build output — a developer
 * running the suite against `next dev` should not fail on a file that only
 * exists after a build, and CI always builds first.
 */
export async function readRouteManifest(): Promise<string[]> {
  const { readFile } = await import('node:fs/promises')
  const { join } = await import('node:path')

  try {
    const raw = await readFile(join(process.cwd(), '.next/app-path-routes-manifest.json'), 'utf8')
    return [...new Set(Object.values(JSON.parse(raw) as Record<string, string>))]
      .filter((route) => !route.startsWith('/_'))
      .sort()
  } catch {
    return []
  }
}

/**
 * Screens the application serves that no list above mentions.
 *
 * `/reports`, `/settings/api-keys` and `/settings/mailboxes` all shipped
 * without ever reaching this file, and nothing noticed because a sweep can only
 * fail on routes it knows about. Reading the route manifest closes that: a new
 * screen is in the sweep or it is a deliberate exclusion, and there is no third
 * state.
 */
export function unswept(manifestRoutes: readonly string[]): string[] {
  const known = new Set<string>(ALL_ROUTES)
  return manifestRoutes
    .filter((route) => !known.has(route))
    .filter(
      (route) => !NOT_SWEPT.some((prefix) => route === prefix || route.startsWith(`${prefix}/`)),
    )
    .filter((route) => !route.includes('[')) // a detail route, covered by DETAIL_ROUTES
    .sort()
}

/**
 * One internal screen wearing the full chrome — sidebar, language switch,
 * theme switch — for the tests that are about the frame rather than the
 * contents.
 *
 * `/dashboard` in both modes now. It used to fall back offline to whichever
 * route happened to render, which was `/imports` — so the RTL, brand-token and
 * assistant suites all ran against the thinnest screen in the product while
 * reporting that they had checked the chrome.
 */
export const CHROME_ROUTE: string = '/dashboard'

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

    /*
      An aborted `/_next/` fetch — and only an aborted one.

      This rule used to excuse *every* failed resource under `/_next/`, which
      is the single place it must not. A chunk that 404s is how React silently
      fails to hydrate, and the header of `playwright.config.ts` records what
      that costs: the page renders perfectly, because the HTML is
      server-rendered, and the first test that needs a working form times out
      with nothing on the screen to explain it. The one place the browser says
      so is the console line this was discarding.

      What is genuine noise is a cancelled request. Next prefetches route
      chunks on hover and on viewport, and a navigation that lands before the
      prefetch does aborts it — the browser logs that whether or not anything
      is wrong. `ERR_ABORTED` means the browser gave up asking, not that the
      server could not answer, so a status code or any other transport error
      goes through and fails the spec.
    */
    if (/net::ERR_ABORTED/i.test(text) && /\/_next\//.test(from)) return

    /*
      The assistant saying it is unavailable, which is an answer, not a fault.

      `api/assistant` has exactly two ways to report that no answer is coming,
      and this suite is built to meet both: 503 where no `SERVICE_URL` is set —
      a fixtures deployment, and the state `assistant.spec.ts` exists to
      prove — and 502 where one is set but the service does not answer, which
      is any developer running the web app on its own. Each renders as a
      sentence in the panel.

      The browser logs every failed fetch to its console itself, whether or not
      the code handled it, so a handled path is indistinguishable from an
      unhandled one *here*. Without this the suite goes red on a screen
      behaving exactly as designed — offline on the 503, in full mode on the
      502.

      Scoped to those two statuses from that one endpoint. A 500 still fails,
      and so does every other route: what is excused is two deliberate answers
      from one path, not "errors from the assistant".
    */
    if (
      /Failed to load resource/i.test(text) &&
      /50[23]/.test(text) &&
      /\/api\/assistant/.test(from)
    ) {
      return
    }

    errors.push(`console: ${text}`)
  })

  page.on('pageerror', (error) => {
    errors.push(`uncaught: ${error.message}`)
  })

  return errors
}

/**
 * Opens the first record on a register and asserts the detail page is healthy.
 *
 * The row is found rather than named, because a detail URL needs an id and the
 * pilot fixtures and the demo dataset do not share one. `a[href^="/jobs/"]` is
 * the whole selector: the registers link their rows and nothing else on a board
 * points below it.
 *
 * The click matters more than a `goto` would. Following the link exercises the
 * client router the way an operator does, and a soft navigation is where a
 * server/client boundary error surfaces as a console line rather than a status
 * code — which is the only trace this class of bug leaves.
 */
export async function openFirstRecordAndAssertHealthy(
  page: Page,
  register: string,
  testInfo?: TestInfo,
): Promise<string> {
  const errors = collectPageErrors(page)

  const board = await page.goto(register, { waitUntil: 'domcontentloaded' })
  expect(board?.status(), `${register} responded ${board?.status()}`).toBeLessThan(400)

  /*
    When there is no row, say what there *was* instead.

    `${register} rendered no record to open` was the whole message for nine
    registers at once, and it is compatible with every cause: no rows in the
    database, rows the principal cannot see, an empty state, an error boundary,
    or rows that render without links. Ruling the first two out took a separate
    database diagnostic and three CI runs, and the message would still have been
    the same afterwards.

    So the failure now carries the page's own account of itself — how many links
    of any kind it holds, what its main region actually says, and anything the
    console reported. That is the difference between "a register is empty" and
    "the register says `No enquiries match this view`", which point at opposite
    fixes and are indistinguishable from the assertion alone.
  */
  const row = page.locator(`a[href^="${register}/"]`).first()
  if (!(await row.count())) {
    const anchors = await page.locator('a').count()
    const main = ((await page.locator('main').first().textContent()) ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 400)
    throw new Error(
      `${register} rendered no record to open — ` +
        `${anchors} link(s) on the page, main reads: ${main || '(empty)'}` +
        (errors.length ? `\nconsole: ${errors.join(' | ')}` : ''),
    )
  }
  await expect(row, `${register} rendered no record to open`).toBeVisible()

  const href = (await row.getAttribute('href')) ?? `${register}/?`
  await row.click()
  await page.waitForURL((url) => url.pathname.startsWith(`${register}/`), { timeout: 15_000 })

  await expect(page.locator('h1').first(), `${href} rendered no h1`).toBeVisible()

  if (testInfo) testInfo.annotations.push({ type: 'record', description: href })

  /*
    The assertion this helper exists for.

    A page that throws during render still answers 200 and still draws an `h1`,
    because `app/error.tsx` has one — so status and heading both pass on a
    screen that is completely broken. The console is the only place the
    difference shows.
  */
  expect(errors, `${href} logged browser errors`).toEqual([])

  return href
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
