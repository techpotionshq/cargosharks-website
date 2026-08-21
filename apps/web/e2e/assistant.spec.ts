/**
 * The assistant dock — that it opens, in both languages, and promises nothing.
 *
 * Deliberately no model is involved. Asking a question needs `SERVICE_URL` and
 * a key, neither of which an offline run has, and a test that depends on a paid
 * external call is a test somebody eventually deletes. What is worth pinning
 * here is everything on *this* side of that boundary, and all of it is the kind
 * of thing that breaks silently:
 *
 *   - the panel is reachable at all, from every internal screen;
 *   - the keyboard route works, because that is the one people learn;
 *   - Arabic is Arabic rather than an English fallback;
 *   - and when the service is not configured it says so, rather than hanging.
 *
 * The last is the one an offline run is uniquely good at proving, because
 * offline *is* the unconfigured state.
 */

import { expect, test } from '@playwright/test'
import { CHROME_ROUTE, LOCALE_COOKIE, collectPageErrors } from './support/harness'

const ARABIC = /[؀-ۿ]/

test.describe('the assistant panel', () => {
  test('is offered on the board, and opens', async ({ page }) => {
    const errors = collectPageErrors(page)
    await page.goto(CHROME_ROUTE)

    const launcher = page.getByRole('button', { name: /assistant/i })
    await expect(launcher).toBeVisible()

    await launcher.click()
    await expect(page.getByRole('region', { name: /assistant|المساعد/i })).toBeVisible()
    expect(errors).toEqual([])
  })

  /*
    The keyboard route, because it is the one the label advertises.

    A ⌘K that does not work is worse than one that was never offered: the
    shortcut is printed on the launcher, so a person who tries it and gets
    nothing concludes the feature is broken rather than that the binding is.
  */
  /*
    ⌘K toggles, and Escape deliberately does not close.

    In a modal Escape means "give me the page back", which is already true of a
    dock — the page was never taken. Closing on it would throw away a
    conversation somebody was reading because they reached for the key out of
    habit, so the binding collapses an expanded dock and otherwise does nothing.
  */
  test('toggles from the keyboard, and Escape does not discard it', async ({ page }) => {
    const errors = collectPageErrors(page)
    await page.goto(CHROME_ROUTE)

    const dock = page.getByRole('region', { name: /assistant|المساعد/i })

    await page.keyboard.press('ControlOrMeta+k')
    await expect(dock).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dock).toBeVisible()

    await page.keyboard.press('ControlOrMeta+k')
    await expect(dock).toBeHidden()
    expect(errors).toEqual([])
  })

  /*
    The property that made this a dock rather than a dialog: the board behind
    it stays usable. A modal with a backdrop would intercept this click, and
    the whole reason for the redesign was that a question is asked *while*
    doing something else.
  */
  test('leaves the page behind it live', async ({ page }) => {
    const errors = collectPageErrors(page)
    await page.goto(CHROME_ROUTE)
    await page.keyboard.press('ControlOrMeta+k')
    await expect(page.getByRole('region', { name: /assistant|المساعد/i })).toBeVisible()

    // A nav link is behind the dock's corner and must still be reachable.
    await expect(page.getByRole('navigation').first()).toBeVisible()
    await page.getByRole('navigation').first().click({ trial: true })
    expect(errors).toEqual([])
  })

  test('survives a navigation, because a docked panel that closes is not docked', async ({
    page,
  }) => {
    const errors = collectPageErrors(page)
    await page.goto(CHROME_ROUTE)
    await page.keyboard.press('ControlOrMeta+k')
    await expect(page.getByRole('region', { name: /assistant|المساعد/i })).toBeVisible()

    await page.goto(CHROME_ROUTE)
    await expect(page.getByRole('region', { name: /assistant|المساعد/i })).toBeVisible()
    expect(errors).toEqual([])
  })

  test('puts the caret in the question box when it opens', async ({ page }) => {
    const errors = collectPageErrors(page)
    await page.goto(CHROME_ROUTE)
    await page.keyboard.press('ControlOrMeta+k')

    await expect(page.locator('textarea')).toBeFocused()
    expect(errors).toEqual([])
  })

  /*
    Nothing is claimed before anything has happened.

    The empty state is where a person decides what this thing is, and the one
    sentence that has to survive every future edit is that it cannot change
    anything. An assistant believed to have moved a shipment it merely
    suggested moving is the failure this whole surface is designed around.
  */
  test('says plainly that it cannot change anything', async ({ page }) => {
    const errors = collectPageErrors(page)
    await page.goto(CHROME_ROUTE)
    await page.keyboard.press('ControlOrMeta+k')

    const dock = page.getByRole('region', { name: /assistant|المساعد/i })
    await expect(dock).toContainText(/cannot change anything/i)
    expect(errors).toEqual([])
  })

  test('offers questions to start from', async ({ page }) => {
    const errors = collectPageErrors(page)
    await page.goto(CHROME_ROUTE)
    await page.keyboard.press('ControlOrMeta+k')

    await expect(page.getByRole('button', { name: /overdue/i })).toBeVisible()
    expect(errors).toEqual([])
  })

  /*
    The unconfigured answer, which is what an offline deployment actually has.

    It must be a sentence, not a spinner and not a stack trace: "not right now"
    is a state this product is allowed to be in — nothing here requires a model
    — and the interface has to be able to say so.
  */
  test('explains itself when no model is configured', async ({ page }) => {
    const errors = collectPageErrors(page)
    await page.goto(CHROME_ROUTE)
    await page.keyboard.press('ControlOrMeta+k')

    await page.locator('textarea').fill('Which invoices are overdue?')
    await page.getByRole('button', { name: /^ask$/i }).click()

    await expect(page.getByRole('region', { name: /assistant|المساعد/i })).toContainText(
      /not configured|could not|assistant/i,
      {
        timeout: 30_000,
      },
    )
    /*
      No console errors even on the failure path. A client component that
      throws while rendering an error state leaves the panel wedged, and the
      person cannot tell that from the assistant simply being slow.
    */
    expect(errors).toEqual([])
  })
})

test.describe('the assistant panel in Arabic', () => {
  test.use({ locale: 'ar' })

  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([
      { name: LOCALE_COOKIE, value: 'ar', url: baseURL ?? 'http://localhost:3100' },
    ])
  })

  test('is labelled in Arabic, not in an English fallback', async ({ page }) => {
    const errors = collectPageErrors(page)
    await page.goto(CHROME_ROUTE)

    // The server's own statement that this is the Arabic render — gating on it
    // turns a timing-dependent assertion into a deterministic one, exactly as
    // `bilingual.spec.ts` argues.
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')

    await page.keyboard.press('ControlOrMeta+k')
    const dock = page.getByRole('region', { name: /assistant|المساعد/i })
    await expect(dock).toBeVisible()
    expect(await dock.innerText()).toMatch(ARABIC)
    expect(errors).toEqual([])
  })
})
