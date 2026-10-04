/**
 * Nothing is drawn outside the box it belongs to.
 *
 * The product owner's report was "lines are going out of containers", and the
 * route sweep could not have caught a single instance of it: the suspend
 * warning ran 300px out of its dialog, the tariff card collapsed to a sliver
 * on a phone and drew its table over the card below, and a quotation's price
 * ran out of its tile, all on screens that rendered, had a heading and threw
 * nothing. `findSpills` asks the layout where every line of text and every
 * painted box actually landed, against the cell, card, badge or dialog that
 * should hold it.
 *
 * Both projects (desktop and a phone) and both languages, because every one
 * of those bugs showed at one width or in one direction and not the other.
 *
 * Not every screen: the records, the screens that have had a spill, and the
 * dialogs most often opened. The full sweep, every route and every dialog in
 * both languages at both widths, took twenty minutes when this was written,
 * which is too slow for every commit; this is the part that runs in about a
 * minute and still covers the shared components (`Card`, `Metric`,
 * `TableShell`, `Modal`, `Lane`) the rest of the product is built from.
 */

import { expect, test, type Page } from '@playwright/test'
import { DETAIL_ROUTES, LOCALE_COOKIE } from './support/harness'
import { findSpills } from './support/overflow'

const SCREENS = ['/dashboard', '/reference', '/settings/users', '/portal'] as const

/** Screens whose dialogs are opened and measured too. */
const WITH_DIALOGS = new Set<string>(['/settings/users', '/jobs'])

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready)
}

async function assertNoSpills(page: Page, label: string) {
  await settle(page)
  expect(await page.evaluate(findSpills, null), `${label}: drawn outside its container`).toEqual([])
}

/**
 * Opens every dialog on the page in turn and measures it.
 *
 * Through `showModal()` rather than the trigger: a trigger can sit in a menu
 * or a row that needs a hover to reach, and what is being tested is the
 * dialog's layout, not the way to it. Each one is closed before the next.
 */
async function assertDialogsHold(page: Page, label: string) {
  const count = await page.locator('dialog').count()
  for (let index = 0; index < count; index++) {
    const title = await page.evaluate((i) => {
      const dialog = document.querySelectorAll('dialog')[i]!
      dialog.setAttribute('data-overflow-check', '')
      dialog.showModal()
      // The entrance animation starts at opacity 0, and `findSpills` skips
      // what cannot be seen; measured mid-fade, every dialog passed.
      for (const animation of dialog.getAnimations({ subtree: true })) animation.finish()
      return dialog.querySelector('h2')?.textContent?.trim() ?? `dialog ${i + 1}`
    }, index)
    expect(
      await page.evaluate(findSpills, 'dialog[data-overflow-check]'),
      `${label}, "${title}": drawn outside its container`,
    ).toEqual([])
    await page.evaluate(() => {
      const dialog = document.querySelector('dialog[data-overflow-check]') as HTMLDialogElement
      dialog.close()
      dialog.removeAttribute('data-overflow-check')
    })
  }
}

for (const locale of ['en', 'ar'] as const) {
  test.describe(`overflow, ${locale}`, () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await context.addCookies([
        { name: LOCALE_COOKIE, value: locale, url: baseURL ?? 'http://localhost:3100' },
      ])
    })

    for (const screen of SCREENS) {
      test(`${screen} holds its content`, async ({ page }) => {
        await page.goto(screen, { waitUntil: 'load' })
        await assertNoSpills(page, `${screen} (${locale})`)
        if (WITH_DIALOGS.has(screen)) await assertDialogsHold(page, `${screen} (${locale})`)
      })
    }

    for (const register of DETAIL_ROUTES) {
      test(`the first record on ${register} holds its content`, async ({ page }) => {
        await page.goto(register, { waitUntil: 'domcontentloaded' })
        const href = await page.locator(`a[href^="${register}/"]`).first().getAttribute('href')
        expect(href, `${register} linked no record`).toBeTruthy()
        await page.goto(href!, { waitUntil: 'load' })
        await assertNoSpills(page, `${href} (${locale})`)
        if (WITH_DIALOGS.has(register)) await assertDialogsHold(page, `${href} (${locale})`)
      })
    }
  })
}
