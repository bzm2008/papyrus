import { defineConfig, devices } from '@playwright/test'

/**
 * The browser bridge E2E suite uses a small Vite server so that every test
 * exercises a real Chromium document with an ordinary HTTP origin.
 */
export default defineConfig({
  testDir: './apps/browser-bridge/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'dot' : 'line',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4178',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite --config apps/browser-bridge/e2e/vite.config.ts --host 127.0.0.1 --port 4178',
    url: 'http://127.0.0.1:4178/ordinary.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
