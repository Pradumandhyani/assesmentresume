import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 180000,
  expect: { timeout: 15000 },
  reporter: 'list',
  outputDir: 'artifacts/e2e-results',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: 'node backend/node_modules/tsx/dist/cli.mjs test/support/start-step2.mjs',
    // One bootstrap owns the API, student, and admin servers and the ephemeral database.
    url: 'http://127.0.0.1:3001/api/v1/auth/csrf',
    timeout: 120000,
    reuseExistingServer: false,
  },
});
