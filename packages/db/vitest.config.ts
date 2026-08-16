import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    environment: 'node',
    // RLS tests open real connections and run serially against one database.
    fileParallelism: false,
    testTimeout: 30_000,
  },
})
