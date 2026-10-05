/**
 * Registers page, and their figures are counts — live run 5, R8 to R10.
 *
 * Run 5 found the jobs board stopped at a hundred shipments with a "Live"
 * tile reading 100 against 336 (R9), the customers register stopped at two
 * hundred (R10), and the documents register was 105 rows with no way to
 * narrow them. Every register now pages through `ui/pager.tsx`; these tests
 * walk the one register whose pilot dataset is longer than a page (documents,
 * 105 rows) to its last page, and check that the board's tile and the pager
 * beneath it agree.
 *
 * R8 is here too: bulk import's "Check the file" reset the Branch picker, so
 * "Import N" then did nothing. On fixtures the import itself is refused in
 * words ("needs a database"), which is exactly the evidence that the request
 * was sent with a branch — the bug was that nothing was sent at all.
 */

import { expect, test } from '@playwright/test'
import { LOCALE_COOKIE, collectPageErrors } from './support/harness'

/** The pager's range line: "51–100 of 105". */
const range = (page: import('@playwright/test').Page) => page.locator('[data-pager-range]').first()

test.describe('register paging', () => {
  test('walks the documents register to its last page', async ({ page }) => {
    const errors = collectPageErrors(page)
    await page.goto('/documents', { waitUntil: 'domcontentloaded' })

    await expect(range(page)).toHaveText(/^1–50 of 105$/)
    await expect(page.locator('table tbody tr')).toHaveCount(50)

    await page.getByRole('link', { name: 'Next' }).first().click()
    await expect(page).toHaveURL(/\/documents\?page=2$/)
    await expect(range(page)).toHaveText(/^51–100 of 105$/)

    await page.getByRole('link', { name: 'Next' }).first().click()
    await expect(range(page)).toHaveText(/^101–105 of 105$/)
    await expect(page.locator('table tbody tr')).toHaveCount(5)
    // The last page offers no further page.
    await expect(page.locator('a[rel="next"]')).toHaveCount(0)

    await page.getByRole('link', { name: 'Previous' }).first().click()
    await expect(range(page)).toHaveText(/^51–100 of 105$/)
    expect(errors).toEqual([])
  })

  test('searches the documents register and counts only the matches', async ({ page }) => {
    await page.goto('/documents', { waitUntil: 'domcontentloaded' })
    const reference = (await page.locator('table tbody tr td a').first().innerText()).trim()

    // The register's own box, not the topbar's.
    const box = page.getByPlaceholder('Shipment, customer or document type')
    await box.fill(reference)
    await box.press('Enter')
    await expect(page).toHaveURL(/\/documents\?q=/)

    const text = (await range(page).innerText()).trim()
    const total = Number(/of (\d+)$/.exec(text)?.[1])
    expect(total).toBeGreaterThan(0)
    expect(total).toBeLessThan(105)
    await expect(page.locator('table tbody tr')).toHaveCount(total)
    for (const cell of await page.locator('table tbody tr td:first-child a').allInnerTexts()) {
      expect(cell.trim()).toBe(reference)
    }
  })

  test('keeps the filter on the next page', async ({ page }) => {
    await page.goto('/documents?state=draft', { waitUntil: 'domcontentloaded' })
    const next = page.locator('a[rel="next"]')
    // Whether drafts span two pages is the dataset's business; if they do, the
    // link must carry the filter with it.
    if ((await next.count()) > 0) {
      await expect(next.first()).toHaveAttribute('href', '/documents?state=draft&page=2')
    }
  })

  test('counts the Live tile over every live shipment, as the pager does', async ({ page }) => {
    await page.goto('/jobs', { waitUntil: 'domcontentloaded' })
    const text = (await range(page).innerText()).trim()
    const total = /of (\d+)$/.exec(text)?.[1]
    expect(total).toBeDefined()
    // The tile's figure, read from the tile whose label is "Live": the same
    // number the pager reports, where it used to be the page's length.
    const tile = page
      .locator('p', { hasText: /^Live$/ })
      .first()
      .locator('xpath=../..')
      .locator('span.numeric')
      .first()
    await expect(tile).toHaveText(total!)
  })

  test('points a bookmark past the end back to the last page', async ({ page }) => {
    await page.goto('/documents?page=9', { waitUntil: 'domcontentloaded' })
    await expect(range(page)).toHaveText(/Page 9 is past the end/)
    await expect(page.locator('a[rel="prev"]').first()).toHaveAttribute('href', '/documents?page=3')
  })
})

test.describe('register paging in Arabic', () => {
  test.use({ locale: 'ar' })

  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([
      { name: LOCALE_COOKIE, value: 'ar', url: baseURL ?? 'http://localhost:3100' },
    ])
  })

  test('words the pager in Arabic', async ({ page }) => {
    await page.goto('/documents', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(range(page)).toContainText('من')
    await expect(page.getByRole('link', { name: 'التالي' }).first()).toBeVisible()
  })
})

test.describe('bulk import keeps the branch — R8', () => {
  const sheet = {
    name: 'customers.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      ['Customer code,Legal name (English),Country', 'E2E-R8-1,Registers Test Trading,KW'].join(
        '\n',
      ),
    ),
  }

  test('imports after a check without choosing the branch again', async ({ page }) => {
    await page.goto('/imports?kind=customers', { waitUntil: 'networkidle' })
    const branch = page.locator('select#branchId')
    const chosen = await branch.locator('option').nth(1).getAttribute('value')
    expect(chosen).toBeTruthy()

    await page.locator('input[type="file"][name="file"]').setInputFiles(sheet)
    await branch.selectOption(chosen!)
    await page.getByRole('button', { name: 'Check the file' }).click()
    await expect(page.getByText('Ready to import').first()).toBeVisible()

    // The bug: the check put the picker back to "Choose a branch".
    await expect(branch).toHaveValue(chosen!)

    await page.getByRole('button', { name: /^Import\b/ }).click()
    // On fixtures the import is refused in words — proof that it was sent.
    await expect(page.getByText(/needs a database/i).first()).toBeVisible()
  })

  test('says so, in words, when Import is pressed with no branch', async ({ page }) => {
    await page.goto('/imports?kind=customers', { waitUntil: 'networkidle' })
    const branch = page.locator('select#branchId')
    const chosen = await branch.locator('option').nth(1).getAttribute('value')

    await page.locator('input[type="file"][name="file"]').setInputFiles(sheet)
    await branch.selectOption(chosen!)
    await page.getByRole('button', { name: 'Check the file' }).click()
    await expect(page.getByText('Ready to import').first()).toBeVisible()

    await branch.selectOption('')
    await page.getByRole('button', { name: /^Import\b/ }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Choose a branch.' })).toBeVisible()
    await expect(branch).toHaveAttribute('aria-invalid', 'true')
    // Nothing was sent: the refusal is the screen's, not the server's.
    await expect(page.getByText(/needs a database/i)).toHaveCount(0)
  })
})
