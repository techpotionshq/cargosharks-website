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
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['e2e/**', 'node_modules/**', '.next/**'],
    environment: 'node',
  },
})
