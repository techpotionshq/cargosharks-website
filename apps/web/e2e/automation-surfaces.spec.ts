/**
 * Yesterday's automation surfaces, on the fixtures the demo runs on.
 *
 * `routes.spec.ts` already proves every screen renders without a console error,
 * which is what catches a broken client component. This is the other half: that
 * the new controls are actually *present* where an operator reaches them — the
 * covering-note editor on a draft quotation, the automation strip and the rate
 * comparison on an enquiry, and the notification bell in the header. All of it
 * against `QABANDI_PILOT_FIXTURES=1`, so it needs no database.
 */

import { test, expect } from '@playwright/test'
import { LOCALE_COOKIE, collectPageErrors } from './support/harness'

/** The one draft quotation on the fixture board — 316's revision in progress. */
const DRAFT_QUOTE = '/quotes/quote-316'
/** The enquiry the model read, which carries proposals and rate requests. */
const READ_ENQUIRY = '/enquiries/enq-318'

test.describe('the covering-note editor', () => {
  test('is offered on a draft quotation, in English', async ({ page }) => {
    const errors = collectPageErrors(page)

    await page.goto(DRAFT_QUOTE)

    await expect(page.getByText('Covering note', { exact: true })).toBeVisible()
    // The model drafts, the coordinator saves — both controls, per language.
    await expect(page.getByRole('button', { name: 'Draft with the model' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save note' }).first()).toBeVisible()

    expect(errors, 'the draft quotation logged browser errors').toEqual([])
  })

  test('is offered in Arabic too', async ({ page, context }) => {
    await context.addCookies([
      { name: LOCALE_COOKIE, value: 'ar', domain: 'localhost', path: '/' },
    ])

    await page.goto(DRAFT_QUOTE)

    await expect(page.getByText('خطاب مرافق')).toBeVisible()
  })
})

test.describe('the enquiry the model read', () => {
  test('shows the automation-activity strip and the one-click fill', async ({ page }) => {
    const errors = collectPageErrors(page)

    await page.goto(READ_ENQUIRY)

    // The strip leads with its label; the fixture enquiry is mid-automation.
    await expect(page.getByText('Automation', { exact: true })).toBeVisible()
    // The one-click fill accepts every open suggestion at once.
    await expect(page.getByRole('button', { name: /Accept all/ })).toBeVisible()

    expect(errors, 'the enquiry logged browser errors').toEqual([])
  })

  test('shows the rate comparison and the request-rates picker', async ({ page }) => {
    await page.goto(READ_ENQUIRY)

    // A heading, not getByText — the dialog title "Request rates from agents"
    // contains this string and would otherwise collide under strict mode.
    await expect(page.getByRole('heading', { name: 'Rates from agents', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Request rates' })).toBeVisible()
  })
})

test.describe('the notification bell', () => {
  test('is in the operations header', async ({ page }, testInfo) => {
    // The header chrome collapses on a phone; the bell is desktop furniture.
    test.skip(testInfo.project.name === 'mobile', 'header bell is desktop chrome')

    await page.goto('/dashboard')

    await expect(page.locator('summary[aria-label*="Notifications"]')).toBeVisible()
  })
})
