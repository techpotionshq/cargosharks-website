/**
 * The two things the pilot dataset exists to show — Pilot §3.1.
 *
 * The fixtures are not twenty rows of lorem ipsum. They carry a live customs
 * hold and a demurrage clock that has already written its own charge line,
 * because those are the two moments the product is *for*: PP-06 (clearance
 * invisible) and PP-07 (free time not counted).
 *
 * If a refactor breaks the exception board or the accrual display, the route
 * sweep still passes — every page renders, with a heading, throwing nothing.
 * These are the assertions that notice the product stopped doing its job.
 */

import { expect, test } from '@playwright/test'
import { MODE, collectPageErrors } from './support/harness'

test.describe('boards', () => {
  test.skip(MODE !== 'full', 'the operations registers require a database — run with E2E_MODE=full')

  test('surfaces the live customs hold on the customs board', async ({ page }) => {
    await page.goto('/customs', { waitUntil: 'domcontentloaded' })

    // The fixtures put at least one job in `held`. A board that shows none is
    // either a broken filter or a broken query, and both are silent failures.
    await expect(
      page.getByText(/held/i).first(),
      'the customs board shows no held shipment, but the fixtures contain one',
    ).toBeVisible()
  })

  test('raises the hold as an open exception', async ({ page }) => {
    await page.goto('/exceptions', { waitUntil: 'domcontentloaded' })

    const rows = page.locator('table tbody tr, [role="row"]')
    await expect(
      rows.first(),
      'the exception board is empty, but a held shipment should have raised one',
    ).toBeVisible()
  })

  /**
   * PP-07, stated as a test.
   *
   * The demurrage clock is the feature that pays for itself: free time counted
   * automatically, accruing against the carrier's free days, writing its own
   * charge line. The dashboard names it directly.
   */
  test('shows demurrage accruing on the dashboard', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })

    await expect(
      page.getByText(/demurrage accruing/i),
      'the dashboard no longer reports accruing demurrage',
    ).toBeVisible()
  })

  /**
   * The board is only useful if a row leads somewhere. This is the one
   * navigation test in the suite, and it covers the path every operator walks
   * fifty times a day: board, job, back.
   */
  test('opens a job from the board and shows its reference', async ({ page }) => {
    await page.goto('/jobs', { waitUntil: 'domcontentloaded' })

    /*
      Loose enough to cover both datasets, tight enough to still be a
      reference: the pilot fixtures number jobs `KWI-2026-01041` and the demo
      dataset `KWI-JOB-0001`. A pattern pinned to one of them passes in the
      mode it was written for and fails in the other for no reason worth
      hearing about.
    */
    const jobLink = page.getByRole('link', { name: /[A-Z]{3}-[A-Z0-9]+-\d{4,5}/ }).first()
    await expect(jobLink, 'the jobs board rendered no job links').toBeVisible()

    const reference = (await jobLink.innerText()).trim()
    await jobLink.click()

    await expect(page.locator('h1').first()).toBeVisible()
    await expect(
      page.getByText(reference).first(),
      'the job detail page does not name the job that was opened',
    ).toBeVisible()
  })

  /**
   * Delivery capture, opened rather than merely present.
   *
   * This is the test the job file did not have, and the shape of it is the
   * lesson. `PodCaptureDialog` resolves a permission on the server and hands
   * the modal a trigger; a trigger is a function, a function cannot be
   * serialised across the server/client boundary, and the whole job file fell
   * to the error boundary the moment anyone who could actually capture a
   * delivery opened it. Nothing 500s, nothing is missing from the board, and
   * the console is the only witness — so the console is asserted on.
   *
   * The trigger is required to be visible rather than skipped over when it is
   * absent. It renders only for `job.update`, so a principal reduced to
   * `read_only` would make this test pass while covering nothing at all —
   * which is precisely the state the bug survived in.
   */
  test('opens the delivery capture dialog on a job file', async ({ page }) => {
    const errors = collectPageErrors(page)

    await page.goto('/jobs', { waitUntil: 'domcontentloaded' })
    await page
      .getByRole('link', { name: /[A-Z]{3}-[A-Z0-9]+-\d{4,5}/ })
      .first()
      .click()

    await expect(
      page.getByRole('heading', { name: /proof of delivery/i }),
      'the job file no longer carries the proof-of-delivery card',
    ).toBeVisible()

    const capture = page.getByRole('button', { name: /capture delivery/i })
    await expect(
      capture,
      'no capture trigger — either the dialog is broken, or this run signed in ' +
        'as a principal without job.update and is covering nothing',
    ).toBeVisible()

    await capture.click()

    // The native `<dialog>` only takes the dialog role once `showModal()` has
    // run, so this asserts the client trigger actually fired.
    await expect(page.getByRole('dialog'), 'the capture dialog did not open').toBeVisible()

    expect(errors, 'the job file logged browser errors').toEqual([])
  })
})

/**
 * The public tracking page is the one surface a customer reaches without an
 * account, and the one place a reference lookup must not become an enumeration
 * oracle. It asks for a reference *and* a verifier for that reason.
 */
test('asks for both a reference and a verifier when tracking', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto('/track', { waitUntil: 'domcontentloaded' })

  const inputs = page.locator('input[type="text"], input:not([type])')
  await expect(
    inputs,
    'the tracking form no longer requires a second factor alongside the reference',
  ).toHaveCount(2)

  await context.close()
})
