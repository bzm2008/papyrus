import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['apps/browser-bridge/src/**/*.test.ts'],
    restoreMocks: true,
  },
})
