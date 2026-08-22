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
      Sixty rather than thirty, for the reason `apps/web` already documents.

      Thirty was chosen against a database on localhost. Against one across a
      network a fixture-heavy worker test — seed a clock, accrue it, read the
      ledger back — is a dozen round trips and reaches half a minute without
      anything being wrong. Against the shared development server the suite
      failed twenty-two tests, every one of them reporting exactly 30000ms.
      That the number never varies is the tell: it is the timeout firing, not
      the code hanging.

      Still a backstop against a query that has genuinely stopped, not a
      performance assertion. If these need to be fast, the fix is a database on
      localhost, not a smaller number here.
    */
    testTimeout: 60_000,
    // Fixtures are inserted over the same link as the assertions; the default
    // ten seconds is a timeout on the network, not on the code under test.
    hookTimeout: 60_000,
  },
})
