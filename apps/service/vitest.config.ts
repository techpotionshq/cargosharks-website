import { defineConfig } from 'vitest/config'

/**
 * The service's own suite configuration.
 *
 * Without this file `pnpm --filter @qabandi/service test` walked up to the
 * workspace config, read its `projects` list relative to `apps/service`, and
 * died on "references a non-existing file: apps/service/packages/core". The
 * worker tests therefore ran in exactly one place — a root `vitest run` — and
 * `pnpm test` failed at this package for a reason that had nothing to do with
 * any test in it.
 *
 * `fileParallelism` is off and the timeout is generous because these suites
 * talk to a real database, serially, like the RLS ones (§5).
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    environment: 'node',
    fileParallelism: false,
    /*
      A hundred and twenty rather than sixty, and this is the second time the
      same number has had to move for the same reason.

      Thirty was chosen against a database on localhost. Against one across a
      network a fixture-heavy worker test — seed a clock, accrue it, read the
      ledger back — is a dozen round trips and reaches half a minute without
      anything being wrong. Against the shared development server the suite
      failed twenty-two tests, every one of them reporting exactly 30000ms.
      That the number never varies is the tell: it is the timeout firing, not
      the code hanging.

      Sixty then held until `notification-dispatch.test.ts`, and **this number
      does not fix that one** — it is raised because sixty is demonstrably too
      tight on this link, not because a hundred and twenty is enough.

      What was measured, so nobody has to measure it twice. The link to the
      shared development server is 270ms per round trip and 2.2s to open a
      connection, against a pool that drops an idle connection after ten
      seconds. Run alone, the three customer-expansion tests in that file pass
      in about seventy-eight seconds each. Run with the rest of the file they
      exceed whatever the limit is — sixty, then a hundred and twenty — so the
      cost is not a fixed per-test price but something that degrades as the run
      goes on, most likely connection churn against `idleTimeoutMillis`. The
      same tests take under a second against the container in CI, which is why
      the pipeline is green and a developer's run is not.

      Worth knowing what a timeout here costs beyond the one red test: a
      dispatch abandoned mid-flight keeps running and leaves its deliveries
      `queued`, and the next test's `flush` claims them — they are older, so
      they sort first. Two timeouts produced two further failures in tests that
      were working perfectly, asserting on a message that belonged to a run
      that never finished. One cause, four red tests.

      Still a backstop against a query that has genuinely stopped, not a
      performance assertion. If these need to be fast — or to pass — the fix is
      a database on localhost (`pnpm db:up`), not a bigger number here.
    */
    testTimeout: 120_000,
    // Fixtures are inserted over the same link as the assertions; the default
    // ten seconds is a timeout on the network, not on the code under test.
    // `beforeAll` in the worker suites builds a whole world over that link.
    hookTimeout: 120_000,
  },
})
