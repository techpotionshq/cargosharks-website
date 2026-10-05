/**
 * The vessel position card, in each of its states and both languages.
 *
 * The register-wide checks open the *first* job, which sails on nothing the
 * fixtures follow, so they never draw this card. Here each state is opened by
 * id from `lib/pilot/vessels.ts`: current, stale, never heard, and a
 * name-only suggestion. Each must name its state, say the honest sentence
 * where one is owed, and keep its content inside its frame at phone width in
 * Arabic as well as English.
 *
 * Offline mode only: in full mode the seeded database has no vessels.
 */

import { expect, test } from '@playwright/test'
import { LOCALE_COOKIE, MODE, collectPageErrors } from './support/harness'
import { findSpills } from './support/overflow'

const CASES = [
  { path: '/jobs/job-1046', state: 'current', en: /Last seen .* near Port Klang/, ar: /آخر رصد/ },
  { path: '/jobs/job-1044', state: 'stale', en: /outside receiver coverage/, ar: /خارج نطاق/ },
  {
    path: '/portal/shipments/job-1045',
    state: 'none',
    en: /No recent position/,
    ar: /لا يوجد موقع حديث/,
  },
  { path: '/jobs/job-1048', state: 'none', en: /Only the name matches/, ar: /الاسم فقط مطابق/ },
] as const

for (const locale of ['en', 'ar'] as const) {
  test.describe(`vessel position, ${locale}`, () => {
    test.skip(MODE === 'full', 'the seeded database follows no vessels')

    test.beforeEach(async ({ context, baseURL }) => {
      await context.addCookies([
        { name: LOCALE_COOKIE, value: locale, url: baseURL ?? 'http://localhost:3100' },
      ])
    })

    for (const item of CASES) {
      test(`${item.path} draws the ${item.state} card and holds it`, async ({ page }) => {
        const errors = collectPageErrors(page)
        const response = await page.goto(item.path, { waitUntil: 'load' })
        expect(response?.status()).toBeLessThan(400)

        const card = page.locator('[data-vessel-position]').first()
        await expect(card).toHaveAttribute('data-vessel-position', item.state)
        await expect(card).toContainText(item[locale])

        await page.evaluate(() => document.fonts.ready)
        expect(
          await page.evaluate(findSpills, '[data-vessel-position]'),
          `${item.path} (${locale}): the card draws outside its frame`,
        ).toEqual([])
        expect(errors, `${item.path} logged browser errors`).toEqual([])
      })
    }

    test('the ETA a ship reports is labelled as the ship’s, not ours', async ({ page }) => {
      await page.goto('/jobs/job-1046', { waitUntil: 'load' })
      const card = page.locator('[data-vessel-position]').first()
      await expect(card).toContainText(
        locale === 'en' ? 'ETA reported by the vessel' : 'موعد الوصول الذي تبلغ عنه السفينة',
      )
    })
  })
}
