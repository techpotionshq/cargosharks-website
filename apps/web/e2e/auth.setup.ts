import { expect, test as setup } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { MODE, STORAGE_STATE } from './support/harness'

/**
 * Sign in once, reuse the session for every test.
 *
 * Only needed in `full` mode. Offline runs on `QABANDI_PILOT_FIXTURES=1`,
 * where session resolution short-circuits to a pilot principal and there is
 * nothing to authenticate — which is exactly why the offline suite was easy to
 * write and why it hid this gap: the *full* suite was written against the same
 * assumption and would have redirected every route to `/sign-in`.
 *
 * A `setup` project rather than a `beforeAll`: it runs once for the whole run
 * rather than once per worker, and its storage state is a file the other
 * projects load, so nothing races on the login form.
 *
 * The credentials are the ones CI provisions with `db:create-user`. They are a
 * throwaway account in a throwaway database — nothing here is a secret, and
 * making it look like one would only invite someone to reuse a real password.
 */
setup('authenticate', async ({ page, baseURL }) => {
  setup.skip(MODE !== 'full', 'offline mode uses the pilot session')

  const email = process.env.E2E_EMAIL ?? 'e2e@qabandi.test'
  const password = process.env.E2E_PASSWORD ?? 'E2e-Test-Passw0rd!'

  await page.goto('/sign-in')

  /*
    Scoped to the form that owns the email field, and that is not fussiness.

    The sign-in page carries two submit buttons: the language switch in the
    chrome, and this one. A bare `button[type="submit"]` selector matches the
    language switch *first* — so the click silently changed the locale, the
    page reloaded in Arabic, and the run looked exactly like a broken login:
    no session, no error, a full page navigation. It cost an hour and a false
    accusation before the selector was the suspect rather than the product.

    Locating from the field the form is *for* cannot pick the wrong form.
  */
  const form = page.locator('form').filter({ has: page.locator('input[name="email"]') })

  await form.locator('input[name="email"]').fill(email)
  await form.locator('input[name="password"]').fill(password)
  await form.locator('button[type="submit"]').click()

  /*
    Wait for the redirect *away* from sign-in rather than for a fixed path.

    A failed sign-in re-renders the same page with an error, so asserting on
    the URL is what distinguishes "authenticated" from "the form came back".
    Waiting for a dashboard selector instead would pass on any page that
    happened to have it.
  */
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 30_000 })
  expect(page.url(), 'sign-in did not authenticate').not.toContain('/sign-in')

  mkdirSync(dirname(STORAGE_STATE), { recursive: true })
  await page.context().storageState({ path: STORAGE_STATE })

  // Proves the session survives a fresh navigation, not just the redirect the
  // form performed — which is the thing the other projects actually rely on.
  await page.goto(`${baseURL}/dashboard`)
  await expect(page.locator('h1').first()).toBeVisible()
})
