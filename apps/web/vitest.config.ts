import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Two test runners live in this package and they must not collect each other's
 * files.
 *
 * Vitest's default `include` matches `**\/*.spec.ts`, which is exactly what
 * Playwright names its specs — so without this, `pnpm test` loads `e2e/` and
 * fails with "Playwright Test did not expect test.describe() to be called
 * here", which reads like a version conflict and is really a glob collision.
 *
 * Unit tests are `*.test.ts` beside the code; end-to-end tests are `*.spec.ts`
 * under `e2e/` and belong to `pnpm test:e2e`.
 */
export default defineConfig({
  /**
   * `@/` is the application's own import prefix, declared in `tsconfig.json`.
   *
   * Vitest does not read `compilerOptions.paths` — TypeScript resolves it for
   * the editor and the build, and the test runner needs telling separately.
   * Without this, any test of a module that imports `@/lib/…` fails to resolve
   * rather than fails to pass, which reads as a missing file and is really a
   * missing alias.
   */
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      /*
        `server-only` throws on import outside a server bundle, which is the
        whole point of it — but Vitest is neither server nor client bundle, so
        the real package fails every suite that touches a query module. The
        stub keeps the marker inert here without weakening it in the build.
      */
      'server-only': fileURLToPath(new URL('./src/lib/testing/server-only.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['e2e/**', 'node_modules/**', '.next/**'],
    environment: 'node',
    /*
      Long enough for a real database on the other end of a network.

      Most suites in this package are `describe.skipIf(!enabled)` blocks that
      insert fixtures and assert over them against `TEST_DATABASE_URL`, exactly
      like `apps/service` — which sets 30s for this reason. This package
      inherited Vitest's 5s default, and against anything but a database on
      localhost the result was three or four failures per run, a *different*
      three or four each time, all at exactly 5000ms. That is indistinguishable
      from flaky code until you notice the number never varies, and it trains
      people to re-run a suite until it passes.

      The timeout is a backstop against a hung query, not a performance
      assertion. Against a database on another continent a fixture-heavy test
      — open a lane, raise an enquiry, load a rate card, price it, read the
      result — is fifteen round trips and runs to twenty seconds without
      anything being wrong. Sixty gives that room and still catches a query
      that has genuinely stopped.
    */
    testTimeout: 60_000,
    // Fixtures are inserted over the same link as the assertions, so the hooks
    // need the same allowance as the tests.
    hookTimeout: 60_000,
  },
})
