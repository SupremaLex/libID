import { defineConfig, devices } from '@playwright/test'

// Browser contexts isolate popup/worker state; the shared harness serves static bytes.
// CI also separates engines onto independent runners.
export default defineConfig({
  testDir: './e2e',
  workers: 2,
  fullyParallel: true,
  timeout: 60_000,
  reporter: 'list',
  // Traces are kept only for failures, which CI uploads.
  use: { ignoreHTTPSErrors: true, trace: 'retain-on-failure' },
  webServer: {
    command: 'node e2e/build.mjs && node e2e/server.mjs',
    url: 'https://popup.localhost:4583/health',
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ['--ignore-certificate-errors'] },
      },
    },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // WebKit can stall a navigation that switches browsing context group (#121,
    // https://bugs.webkit.org/show_bug.cgi?id=327297); a retried pass is still reported as flaky.
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, retries: 1 },
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 7'],
        launchOptions: { args: ['--ignore-certificate-errors'] },
      },
    },
    { name: 'mobile-webkit', use: { ...devices['iPhone 15'] }, retries: 1 },
  ],
})
