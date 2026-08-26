import { expect, test as setup } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { MODE, STORAGE_STATE } from './support/harness'
import { totp } from './support/totp'

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

  /*
    The second factor, because the role this account holds demands one.

    `administrator` and `finance` carry `requires_two_factor` (FR-ID-06), and
    the shells send an unenrolled principal to `/two-factor/enrol` before any
    screen renders. So signing in was never enough, and the way that failed is
    worth recording: this step passed, every dependent spec ran, and forty-eight
    of them failed reporting empty registers and a missing assistant panel.
    `db:diagnose` proved the rows were there and readable, which ruled out the
    two obvious causes and left no explanation at all — until the harness was
    made to print what the page actually said, and every register turned out to
    read "Set up two-factor authentication".

    The assertions above could not see it. Sign-in genuinely succeeded, the
    redirect away from `/sign-in` genuinely happened, and the interstitial has
    an `h1` like every other screen, so "authenticated" and "authenticated and
    then stopped at a gate" were indistinguishable.

    Enrolling through the product's own two screens rather than seeding a secret
    into the database: it needs no production code to grow a test-only door, and
    it means the mandatory-2FA path — which `schema/auth.ts` records as having
    once been shipped with a schema that could not have supported it, because
    nothing ever ran the flow — is exercised on every seeded run.
  */
  /*
    Navigated to rather than waited for, which is the race-free half.

    Where sign-in lands is not reliably the enrol screen: the shells render the
    gate *in place* — the failing run showed `/enquiries` answering 200 with
    "Set up two-factor authentication" as its whole main region — so a redirect
    is not guaranteed and `waitForURL` above can resolve on an intermediate hop.
    Asking for the page directly settles it, and costs nothing when there is
    nothing to do: `EnrolPage` redirects to `/dashboard` for a principal whose
    role never required a factor or who already holds one.
  */
  await page.goto('/two-factor/enrol')

  if (new URL(page.url()).pathname.startsWith('/two-factor/enrol')) {
    const enrol = page.locator('form').filter({ has: page.locator('input[name="password"]') })
    await enrol.locator('input[name="password"]').fill(password)
    await enrol.locator('button[type="submit"]').click()

    /*
      The secret in text, behind the "enter it manually" disclosure — the same
      string the QR encodes, and the only way to read it without a camera.

      The `<summary>` has to be clicked first. A closed `<details>` hides its
      content from the accessibility tree, so `toBeVisible()` on the code inside
      it is false however present the string is — which is a failure that reads
      as "enrolment issued no secret" when the secret is right there.
    */
    const disclosure = page
      .locator('details')
      .filter({ has: page.locator('code') })
      .first()
    await disclosure.locator('summary').click()

    const secret = disclosure.locator('code')
    await expect(secret, 'enrolment issued no secret').toBeVisible({ timeout: 15_000 })
    const base32 = ((await secret.textContent()) ?? '').trim()
    expect(base32, 'the issued secret is not base32').toMatch(/^[A-Z2-7\s]+$/i)

    const code = page.locator('input[name="code"]')
    await code.fill(totp(base32))
    await page.locator('form').filter({ has: code }).locator('button[type="submit"]').click()

    await page.waitForURL((url) => !url.pathname.startsWith('/two-factor'), { timeout: 30_000 })
    expect(page.url(), 'the second factor was not accepted').not.toContain('/two-factor')
  }

  mkdirSync(dirname(STORAGE_STATE), { recursive: true })
  await page.context().storageState({ path: STORAGE_STATE })

  // Proves the session survives a fresh navigation, not just the redirect the
  // form performed — which is the thing the other projects actually rely on.
  await page.goto(`${baseURL}/dashboard`)
  await expect(page.locator('h1').first()).toBeVisible()
})
