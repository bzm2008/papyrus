import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
    // The app store and mocked fetch gateway are process-global by design.
    // Running files concurrently lets account tests reset another file's
    // active Scallion session midway through a contract test.
    fileParallelism: false,
  },
})
