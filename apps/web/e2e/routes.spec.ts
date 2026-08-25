/**
 * The route sweep.
 *
 * The cheapest test with real value: every screen the product ships is
 * reachable, renders a heading, and throws nothing in the browser. It is the
 * test that would have caught most of what a manual click-through catches, on
 * every commit, in both a desktop and a mobile viewport.
 *
 * `SETTINGS_ROUTES` are separated only because they are gated on permissions
 * the pilot principal happens to hold in full — worth stating, because a
 * future change to that principal's grants should fail here loudly rather than
 * quietly reduce what the suite covers.
 */

import { expect, test } from '@playwright/test'
import {
  DETAIL_ROUTES,
  MODE,
  NEEDS_DATABASE,
  OPS_ROUTES,
  SETTINGS_ROUTES,
  openFirstRecordAndAssertHealthy,
  readRouteManifest,
  unswept,
  visitAndAssertHealthy,
} from './support/harness'

/**
 * The gap, checked rather than declared.
 *
 * `NEEDS_DATABASE` is a list of routes this suite skips offline, which makes a
 * stale entry invisible by construction — and it went stale badly: twenty
 * registers were listed as needing a database while every one of their queries
 * already had a fixture branch, so a third of the product sat unswept over four
 * reads that had been written in the wrong file.
 *
 * These two tests close that loop. The first fails when a listed route renders
 * anyway, which is the signal to delete the entry and let the sweep have it.
 * The second fails when a screen exists that no list mentions, which is how
 * `/reports`, `/settings/api-keys` and `/settings/mailboxes` shipped unswept.
 */
test.describe('offline coverage gap', () => {
  test.skip(MODE === 'full', 'every route is covered against a database')

  for (const [route, reason] of Object.entries(NEEDS_DATABASE)) {
    test(`${route} still needs a database — ${reason}`, async ({ page }) => {
      // A detail route is named by its register here; there is no id to visit,
      // so the claim can only be checked on the board it is opened from.
      const path = route.replace('/:id', '')
      const response = await page.goto(path, { waitUntil: 'domcontentloaded' })

      expect(
        response?.status(),
        `${route} renders with no database — delete its NEEDS_DATABASE entry and add it to the sweep`,
      ).toBeGreaterThan(399)
    })
  }
})

/**
 * Every screen the application serves is in a list, or is a stated exclusion.
 *
 * The route manifest is the build's own answer to "what does this app serve",
 * so it cannot drift from the code the way a hand-written array does. Three
 * screens had already slipped past the arrays in `harness.ts` before this
 * existed.
 */
test('sweeps every screen the build serves', async () => {
  const manifest = await readRouteManifest()
  test.skip(manifest.length === 0, 'no build output to read — run `next build` first')

  expect(
    unswept(manifest),
    'screens the sweep has never heard of — add them to harness.ts, or to NOT_SWEPT with a reason',
  ).toEqual([])
})

test.describe('operations routes', () => {
  for (const route of OPS_ROUTES) {
    test(`renders ${route}`, async ({ page }, testInfo) => {
      await visitAndAssertHealthy(page, route, testInfo)
    })
  }
})

test.describe('settings routes', () => {
  for (const route of SETTINGS_ROUTES) {
    test(`renders ${route}`, async ({ page }, testInfo) => {
      await visitAndAssertHealthy(page, route, testInfo)
    })
  }
})

/**
 * The registers prove a board renders. These prove a record opens.
 *
 * A board draws summary rows; a detail page draws the cards, dialogs and
 * client boundaries that summary rows never touch. Everything that made the
 * job file throw for anyone holding `job.update` lived on that side of the
 * line, and the sweep above walked past it eighteen times a run.
 */
test.describe('detail routes', () => {
  for (const register of DETAIL_ROUTES) {
    test(`opens a record from ${register}`, async ({ page }, testInfo) => {
      await openFirstRecordAndAssertHealthy(page, register, testInfo)
    })
  }
})

test.describe('customer and partner surfaces', () => {
  test('renders the customer portal', async ({ page }, testInfo) => {
    await visitAndAssertHealthy(page, '/portal', testInfo)
  })

  test('renders the public tracking page without a session', async ({ browser }, testInfo) => {
    // A fresh context: the tracking page is the one surface that must work for
    // someone who has never signed in, and reusing the suite's context would
    // hide a dependency on the session that is there in every other test.
    const context = await browser.newContext()
    const page = await context.newPage()
    await visitAndAssertHealthy(page, '/track', testInfo)
    await context.close()
  })
})
