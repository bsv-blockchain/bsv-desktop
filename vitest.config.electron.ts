import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    pool: 'forks',
    testTimeout: 120_000,
    include: ['test/**/*.test.ts'],
  },
})
