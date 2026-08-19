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
  },
})
