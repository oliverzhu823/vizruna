import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e-web',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:57400',
  },
  webServer: {
    command: 'node scripts/run-vizruna-web-e2e-server.mjs',
    url: 'http://127.0.0.1:57400/',
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
