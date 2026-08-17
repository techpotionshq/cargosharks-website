/**
 * Money — Architecture §6, README "Conventions that are load-bearing".
 *
 * "KWD carries three decimals, so a global `toFixed(2)` corrupts every Kuwaiti
 * amount in the system."
 *
 * That is the single most expensive regression available in this codebase and
 * it is invisible to every other test: `toFixed(2)` on a KWD amount produces a
 * number that looks entirely reasonable and is wrong by up to a fils on every
 * line, compounding across an invoice. It renders, it aligns, it sums. Only an
 * assertion about the *number of decimal places* catches it.
 *
 * The scan is over several finance screens rather than one because the
 * dashboard tiles use compact notation above 10,000 by design — an assertion
 * pinned to a single screen would be pinned to that formatting choice.
 */

import { expect, test } from '@playwright/test'
import { MODE } from './support/harness'

// Every register these assertions read is one of the ones still missing a
// fixture branch, so the check is only meaningful against `db:seed-demo`.
test.skip(MODE !== 'full', 'the finance registers require a database — run with E2E_MODE=full')

/** `Intl` with `en-GB` and KWD renders "KWD 1,284.000". */
const KWD_THREE_DECIMALS = /KWD\s*[\d,]+\.\d{3}(?!\d)/
const KWD_TWO_DECIMALS = /KWD\s*[\d,]+\.\d{2}(?!\d)/

const FINANCE_ROUTES = ['/invoices', '/finance', '/jobs', '/quotes']

test('renders KWD with three decimal places', async ({ page }) => {
  const seen: string[] = []

  for (const route of FINANCE_ROUTES) {
    await page.goto(route, { waitUntil: 'domcontentloaded' })
    const body = await page.locator('body').innerText()

    // A two-decimal KWD amount anywhere is the bug, and it is worth failing on
    // the moment it appears rather than only when no correct amount is found.
    expect(
      KWD_TWO_DECIMALS.test(body),
      `${route} rendered a KWD amount with two decimals — see the money convention in README`,
    ).toBe(false)

    if (KWD_THREE_DECIMALS.test(body)) seen.push(route)
  }

  expect(
    seen.length,
    `no KWD amount was rendered at full precision on any of ${FINANCE_ROUTES.join(', ')}`,
  ).toBeGreaterThan(0)
})

/**
 * Arabic forces Western digits via `-u-nu-latn` (`lib/format.ts`), because an
 * amount in Eastern Arabic numerals is unreadable to the half of the office
 * that works in English and unparseable by everything downstream.
 */
test('renders Western digits in Arabic', async ({ page, context, baseURL }) => {
  await context.addCookies([
    { name: 'qabandi_locale', value: 'ar', url: baseURL ?? 'http://localhost:3100' },
  ])
  await page.goto('/invoices', { waitUntil: 'domcontentloaded' })

  const body = await page.locator('body').innerText()
  expect(body, 'Eastern Arabic numerals reached the interface').not.toMatch(/[٠-٩]/)
})
