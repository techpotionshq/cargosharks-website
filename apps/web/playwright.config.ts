/**
 * End-to-end configuration — Architecture §13.
 *
 * `apps/web/package.json` has carried a `test:e2e` script pointing at
 * Playwright since before Playwright was installed. This is the config that
 * script always implied.
 *
 * The suite runs against `QABANDI_PILOT_FIXTURES=1`, which is the decision
 * that makes end-to-end coverage cheap enough to keep: session resolution
 * short-circuits to one internal principal holding every permission, and every
 * screen renders from the seeded pilot dataset. No database, no container, no
 * seeding step, no auth fixture, and nothing to leak between runs — the same
 * property that lets the day-15 rehearsal run in a room with no network lets
 * CI run the whole interface in about a minute.
 *
 * It is the *real* query path either way. `lib/pilot/source.ts` chooses the
 * source one branch earlier, so these tests exercise the same components,
 * layouts and formatting that a database-backed deployment does.
 */

import { defineConfig, devices } from '@playwright/test'
import { STORAGE_STATE } from './e2e/support/harness'

const PORT = Number(process.env.E2E_PORT ?? 3100)

/*
  `localhost`, not `127.0.0.1`, and the difference is not cosmetic.

  `next dev` serves its chunks and HMR socket with a cross-origin check against
  the host it was started on. Driving the same server through `127.0.0.1`
  trips it: every `/_next/static/…` request is blocked, React never hydrates,
  and the page still renders perfectly — because the HTML is server-rendered.

  So a suite that only asserts on markup passes, and the first test that needs
  a *working form* times out with no error on the page. That is exactly how the
  sign-in step failed, and it is worth stating because it means the offline
  suite's green run was partly evidence about static HTML rather than about the
  application working.
*/
const BASE_URL = `http://localhost:${PORT}`

/** `E2E_MODE=full` runs against a seeded database; anything else runs offline. */
const FULL = process.env.E2E_MODE === 'full'

export default defineConfig({
  testDir: './e2e',
  // Every spec here is read-only against fixtures, so nothing serialises.
  fullyParallel: true,
  // A `test.only` left in a branch should fail the pipeline, not narrow it.
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }], ['list']] : [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Kuwait, so a rendered date in a test matches a rendered date in Kuwait.
    timezoneId: 'Asia/Kuwait',
  },

  projects: [
    /*
      Sign-in runs once, before anything else, and only in full mode.

      Offline mode authenticates nobody — the pilot session is a
      short-circuit — so the setup project skips itself and the dependency
      costs nothing. In full mode every other project loads the storage state
      it wrote, which is the difference between a suite that tests the product
      and one that tests the sign-in redirect twenty-six times.
    */
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], ...(FULL ? { storageState: STORAGE_STATE } : {}) },
      dependencies: ['setup'],
    },
    // SRS §11 defers native apps on the grounds that "R1's mobile browser
    // experience covers field capture". That claim is worth a project.
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], ...(FULL ? { storageState: STORAGE_STATE } : {}) },
      dependencies: ['setup'],
    },
  ],

  webServer: {
    // CI builds first and serves the production output, because half of what
    // these tests protect — RTL, brand tokens, server components — behaves
    // differently under `next dev`.
    // `next` directly rather than the package scripts, which hard-code 3000:
    // appending a second `--port` to them is ambiguous, and the suite needs a
    // port of its own so it never collides with a running `pnpm dev`.
    command: `pnpm exec next ${process.env.CI ? 'start' : 'dev'} --port ${PORT}`,
    // The readiness probe, deliberately not `/`.
    //
    // `/` redirects to `/dashboard`, and Playwright follows it and requires a
    // status under 400 — so in offline mode the whole suite failed to start
    // with "Timed out waiting for webServer" while the server was up and
    // serving perfectly well. `/track` is public, needs no session and no
    // database, and answers 200 in both modes: it tests that the server is
    // listening rather than that one particular screen is finished.
    url: `${BASE_URL}/track`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // `full` runs against Postgres with `db:seed-demo` loaded and covers
      // every route; the default runs on fixtures alone and covers the subset
      // that works with no database. `e2e/support/harness.ts` holds the lists.
      ...(FULL
        ? { E2E_MODE: 'full' }
        : {
            QABANDI_PILOT_FIXTURES: '1',
            // Named explicitly rather than inherited: fixtures are refused in
            // production against a configured database, and a stray
            // DATABASE_URL in a developer's shell would otherwise turn this
            // suite red for a reason that has nothing to do with the code.
            DATABASE_URL: '',
            /*
              The service, cleared for exactly the same reason.

              `api/assistant` answers 503 immediately when SERVICE_URL is unset
              and otherwise spends up to fifteen seconds trying to reach it. A
              developer whose `.env.local` names a service they are not running
              gets nine assistant failures that CI — where the variable is
              unset — never sees. Found by running this suite locally after the
              assistant screens joined the offline sweep.
            */
            SERVICE_URL: '',
            INTERNAL_API_SECRET: '',
          }),
    },
  },
})
