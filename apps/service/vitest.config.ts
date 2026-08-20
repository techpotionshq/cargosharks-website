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
    testTimeout: 30_000,
    // Fixtures are inserted over the same link as the assertions; the default
    // ten seconds is a timeout on the network, not on the code under test.
    hookTimeout: 30_000,
  },
})
