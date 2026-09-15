import { defineConfig } from 'vitest/config'

/**
 * Its own config, like every other package's.
 *
 * Without one, vitest walks up to the workspace root, finds the composed
 * config there and resolves its `projects` list relative to *this* directory —
 * so the package fails at startup looking for `packages/brand/packages/core`.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
})
