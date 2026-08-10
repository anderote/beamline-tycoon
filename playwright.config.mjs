// playwright.config.mjs — browser-level test run (`npm run test:browser`).
//
// Boots a throwaway vite dev server on BT_TEST_PORT (8123 by default, chosen
// to stay clear of the 8000 the game's own `npm run dev` uses) and drives the
// real app in headless Chromium with a software WebGL backend. Playwright owns
// the server's lifetime on pass, fail and Ctrl-C; a SIGKILLed or timed-out run
// leaks it, which the freeTestPort call below cleans up on the next start.
//
// Deliberately NOT part of `npm test`: see test/browser/README-coverage.md.

import { defineConfig } from '@playwright/test';
import { SWIFTSHADER_ARGS } from './test/browser/helpers.mjs';
import { freeTestPort } from './scripts/free-test-port.mjs';

const PORT = Number(process.env.BT_TEST_PORT || 8123);
const BASE = `http://localhost:${PORT}`;

// Reclaim the port before webServer tries to bind it. A run that was SIGKILLed
// or timed out leaves its vite behind — Playwright's teardown never ran — and
// `strictPort` would then fail the whole next run.
//
// Playwright re-loads this config in every worker process, and killing the
// server from a worker would take down the run it belongs to. Two independent
// guards keep this to the runner's first load: workers get TEST_WORKER_INDEX,
// and they inherit the env we stamp here.
if (process.env.TEST_WORKER_INDEX === undefined && !process.env.BT_TEST_PORT_FREED) {
  process.env.BT_TEST_PORT_FREED = '1';
  freeTestPort(PORT);
}

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
  // Worst observed single spec is palette-arm at 7.4 min, and software-GL cost
  // swings ~2x with machine load, so the cap is set well clear of it — a spec
  // that hits 15 min is hung, not busy.
  timeout: 900_000,
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
    // The binary directly, not `npx vite`: one less process between Playwright
    // and the server it has to kill on teardown.
    command: `node_modules/.bin/vite --config test/browser/vite.test.config.mjs`,
    url: `${BASE}/`,
    // Never adopt a stray server on this port — it may be a plain `vite` with
    // HMR live, which is exactly what this config exists to avoid.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
