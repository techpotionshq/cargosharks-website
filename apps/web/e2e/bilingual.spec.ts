/**
 * Bilingual and RTL — SRS §10.2, Architecture §11.
 *
 * "Retrofitting RTL produces a worse result, so R1.3 is a translation and
 * review gate, not a rebuild." That claim is only true for as long as nobody
 * ships a `ml-4`. These tests are what keeps it true: they assert the document
 * actually flips, and that the flip reaches layout rather than stopping at the
 * text.
 *
 * The conventions check in `pnpm lint` catches logical-property violations in
 * source. This catches the ones that arrive through a dependency, a computed
 * class name, or an inline style — which lint cannot see.
 */

import { expect, test } from '@playwright/test'
import { CHROME_ROUTE, LOCALE_COOKIE, OPS_ROUTES, collectPageErrors } from './support/harness'

const ARABIC = /[؀-ۿ]/

test.describe('Arabic', () => {
  test.use({ locale: 'ar' })

  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([
      { name: LOCALE_COOKIE, value: 'ar', url: baseURL ?? 'http://localhost:3100' },
    ])
  })

  test('sets dir=rtl on the document', async ({ page }) => {
    await page.goto(CHROME_ROUTE)
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
  })

  test('renders Arabic copy, not English fallbacks', async ({ page }) => {
    await page.goto(CHROME_ROUTE)

    /*
      Wait for the document to declare itself Arabic before reading the
      heading.

      `innerText` is a one-shot read with no retry, so under a parallel run it
      could sample the page mid-navigation and compare an English heading that
      was about to be replaced. The `dir` attribute is the server's own
      statement that this render is the Arabic one — gating on it turns a
      timing-dependent assertion into a deterministic one, and it fails just as
      loudly if the locale genuinely does not take effect.
    */
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')

    // `toHaveText` polls, unlike `innerText`.
    await expect(page.locator('h1').first(), 'the page heading fell back to English').toHaveText(
      ARABIC,
    )
  })

  /**
   * The assertion that catches a physical margin.
   *
   * Under `dir=rtl` the sidebar must sit on the right. A component written
   * with `ml-`/`mr-` instead of `ms-`/`me-` renders identically in English and
   * wrongly here, and no screenshot of the English build would show it.
   */
  test('lays the chrome out right-to-left', async ({ page }) => {
    await page.goto(CHROME_ROUTE)

    const direction = await page.evaluate(() => getComputedStyle(document.body).direction)
    expect(direction).toBe('rtl')

    const nav = page.locator('nav').first()
    if (await nav.isVisible()) {
      const navBox = await nav.boundingBox()
      const viewport = page.viewportSize()
      if (navBox && viewport) {
        const navCentre = navBox.x + navBox.width / 2
        expect(
          navCentre,
          'the navigation is on the left under dir=rtl — a physical margin has crept in',
        ).toBeGreaterThan(viewport.width / 2)
      }
    }
  })

  /** Every screen survives the flip, not only the dashboard. */
  for (const route of OPS_ROUTES) {
    test(`renders ${route} in Arabic`, async ({ page }) => {
      const errors = collectPageErrors(page)
      const response = await page.goto(route, { waitUntil: 'domcontentloaded' })
      expect(response?.status()).toBeLessThan(400)
      await expect(page.locator('h1').first()).toBeVisible()
      expect(errors, `${route} logged browser errors in Arabic`).toEqual([])
    })
  }
})

test.describe('English', () => {
  test('sets dir=ltr on the document', async ({ page }) => {
    await page.goto(CHROME_ROUTE)
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  })
})
