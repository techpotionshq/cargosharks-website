/**
 * Every part of the staff app can be reached from the screen you are on.
 *
 * Two launch-blocking faults, each a place nobody could get to and nothing
 * said so:
 *
 *   - At 1280x720 the sidebar's four open groups ran about 440px past the
 *     bottom of their column, and Finance was the group below the fold —
 *     finance staff read its absence as "no access". The sidebar now folds,
 *     and the test is that the Finance heading is *on screen*, not merely in
 *     the DOM, and that it opens onto Invoices.
 *   - A phone had a strip of 21 pills and no search, settings, tracking or
 *     sign-out at all. The test is that sign-out is reachable from the menu
 *     sheet, in both languages, and that the strip opens scrolled to the
 *     current screen.
 *
 * Both run against fixtures, like the rest of the offline suite.
 */

import { expect, test, type Page } from '@playwright/test'
import { CHROME_ROUTE, LOCALE_COOKIE, collectPageErrors } from './support/harness'

/** In the viewport, top to bottom and side to side — not just attached. */
async function expectOnScreen(page: Page, selector: ReturnType<Page['locator']>) {
  await expect(selector).toBeVisible()
  const box = await selector.boundingBox()
  const viewport = page.viewportSize()
  expect(box, 'element has a box').not.toBeNull()
  expect(viewport).not.toBeNull()
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height)
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width)
}

/** Hydrated, so the menu's and the sidebar's handlers are attached. */
async function gotoHydrated(page: Page, path: string) {
  await page.goto(path)
  await page.locator('next-route-announcer').waitFor({ state: 'attached' })
}

for (const locale of ['en', 'ar'] as const) {
  // A prefix: a folded section adds its hidden alarm count to its name.
  const FINANCE = locale === 'ar' ? /^المالية/ : /^finance/i
  const INVOICES = locale === 'ar' ? 'الفواتير' : 'Invoices'
  const SIGN_OUT = locale === 'ar' ? 'تسجيل الخروج' : 'Sign out'
  const MENU = locale === 'ar' ? 'القائمة' : 'Menu'

  test.describe(`navigation (${locale})`, () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await context.addCookies([
        { name: LOCALE_COOKIE, value: locale, url: baseURL ?? 'http://localhost:3100' },
      ])
    })

    test('Finance is on screen at 1280x720, and opens onto Invoices', async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name === 'mobile', 'the sidebar is desktop chrome')
      await page.setViewportSize({ width: 1280, height: 720 })
      const errors = collectPageErrors(page)
      await gotoHydrated(page, CHROME_ROUTE)

      const finance = page.getByRole('button', { name: FINANCE })
      await expectOnScreen(page, finance)

      await finance.click()
      await expect(finance).toHaveAttribute('aria-expanded', 'true')
      const invoices = page.getByRole('link', { name: INVOICES, exact: true }).first()
      await invoices.scrollIntoViewIfNeeded()
      await expectOnScreen(page, invoices)

      // Opening a Finance screen opens its section without being asked.
      await gotoHydrated(page, '/invoices')
      await expect(page.getByRole('button', { name: FINANCE })).toHaveAttribute(
        'aria-expanded',
        'true',
      )
      expect(errors).toEqual([])
    })

    test('sign-out is reachable on a phone, from the menu', async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'mobile', 'the menu is phone chrome')
      const errors = collectPageErrors(page)
      await gotoHydrated(page, CHROME_ROUTE)

      const menu = page.getByRole('button', { name: MENU, exact: true })
      await expectOnScreen(page, menu)
      await menu.click()

      const sheet = page.getByRole('dialog', { name: MENU })
      await expect(sheet).toBeVisible()
      await expectOnScreen(page, sheet.getByRole('button', { name: SIGN_OUT }))
      // Search is in the sheet too; the top bar's box is `sm:` and up.
      await expect(sheet.getByRole('searchbox')).toBeVisible()
      await expect(sheet.locator('a[href="/track"]')).toBeVisible()

      // Choosing a screen closes the sheet over the new one.
      await sheet.getByRole('link', { name: INVOICES, exact: true }).click()
      await page.waitForURL('**/invoices')
      await expect(sheet).toBeHidden()
      expect(errors).toEqual([])
    })

    test('the phone strip opens scrolled to the current screen', async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'mobile', 'the strip is phone chrome')
      // Payables is near the end of 21 pills, well past the first viewport.
      await gotoHydrated(page, '/payables')
      // The sidebar is display:none here and the sheet is closed, so the one
      // visible "you are here" is the strip's.
      const current = page.locator('a[aria-current="page"]:visible')
      await expect(current).toHaveCount(1)
      await expectOnScreen(page, current)
    })
  })
}
