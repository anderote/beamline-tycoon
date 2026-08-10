// playwright.config.mjs — browser-level test run (`npm run test:browser`).
//
// Boots a throwaway vite dev server on BT_TEST_PORT (8123 by default, chosen
// to stay clear of the 8000 the game's own `npm run dev` uses) and drives the
// real app in headless Chromium with a software WebGL backend. Playwright
// owns the server's lifetime, so it comes down on pass, fail, or Ctrl-C.
//
// Deliberately NOT part of `npm test`: see test/browser/README-coverage.md.

import { defineConfig } from '@playwright/test';
import { SWIFTSHADER_ARGS } from './test/browser/helpers.mjs';

const PORT = Number(process.env.BT_TEST_PORT || 8123);
const BASE = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './test/browser',
  testMatch: /.*\.spec\.mjs$/,
  // Software GL is CPU-bound and the specs share one dev server; parallel
  // workers just make each other slower and flakier.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Boot alone is ~7s, the smoke walk reloads three times, and
  // render-placement.spec.mjs rebuilds the scene ~200 times under software GL.
  timeout: 600_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    baseURL: BASE,
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: SWIFTSHADER_ARGS },
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
  },
  webServer: {
    // HMR-free config: a page reload pushed by vite while a spec is running
    // destroys its execution context. See test/browser/vite.test.config.mjs.
    command: `npx vite --config test/browser/vite.test.config.mjs`,
    url: `${BASE}/`,
    // Never adopt a stray server on this port — it may be a plain `vite` with
    // HMR live, which is exactly what this config exists to avoid.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
