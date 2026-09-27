import { defineConfig } from '@playwright/test'

const baseURL = 'http://127.0.0.1:4179'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.pw.js',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 2,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'Europe/Istanbul',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
    { name: 'mobile-chromium', use: { browserName: 'chromium', viewport: { width: 360, height: 780 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
    { name: 'mobile-webkit', use: { browserName: 'webkit', viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: `VITE_ADREEM_API_URL=${baseURL} pnpm dev --host 127.0.0.1 --port 4179 --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
