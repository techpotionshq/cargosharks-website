import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Its own config, like every other package's.
 *
 * Without one, vitest walks up to the workspace root, finds the composed
 * config there and resolves its `projects` list relative to *this* directory —
 * so `pnpm test` failed at startup looking for `apps/landing/packages/core`.
 * `packages/brand` hit the same thing and has the same fix.
 */
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
})
