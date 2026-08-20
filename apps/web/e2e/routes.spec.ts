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

import { test } from '@playwright/test'
import {
  ALL_ROUTES,
  DETAIL_ROUTES,
  MODE,
  NEEDS_DATABASE,
  OPS_ROUTES,
  SETTINGS_ROUTES,
  openFirstRecordAndAssertHealthy,
  visitAndAssertHealthy,
} from './support/harness'

/**
 * The gap, stated in the run.
 *
 * A suite that simply omitted these would report "all green" over a third of
 * the product. Skipping them by name means the offline run says exactly what
 * it did not cover and why, and the same file passing in `E2E_MODE=full`
 * covers all of it.
 */
test.describe('offline coverage gap', () => {
  test.skip(MODE === 'full', 'every route is covered against a database')

  for (const route of ALL_ROUTES.filter((r) => r in NEEDS_DATABASE)) {
    // eslint-disable-next-line playwright/no-skipped-test
    test.fixme(`${route} needs a database — ${NEEDS_DATABASE[route]}`, () => {})
  }
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
  test.skip(
    MODE !== 'full',
    'a record has to exist before it can be opened — run with E2E_MODE=full',
  )

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
