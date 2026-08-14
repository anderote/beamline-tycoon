// playwright.config.mjs — browser-level test run (`npm run test:browser`).
//
// Boots a throwaway vite dev server on a free port in 8123..8199 (clear of the
// 8000 the game's own `npm run dev` uses) and drives the real app in headless
// Chromium with a software WebGL backend. Playwright owns the server's
// lifetime on pass, fail and Ctrl-C; a SIGKILLed or timed-out run leaks it,
// but a leak on an auto-selected port blocks nothing — the next run simply
// picks a different one. See scripts/test-port.mjs for why the port is no
// longer fixed and no longer reclaimed by force.
//
// Deliberately NOT part of `npm test`: see test/browser/README-coverage.md.

import { defineConfig } from '@playwright/test';
import { SWIFTSHADER_ARGS } from './test/browser/helpers.mjs';
import { freeTestPort } from './scripts/free-test-port.mjs';
import { resolveTestPort, RESOLVED_ENV_VAR } from './scripts/test-port.mjs';

const { port: PORT, explicit } = resolveTestPort();
const BASE = `http://localhost:${PORT}`;

// The port has to survive into two kinds of child process: the vite that
// `webServer` spawns (it reads the same module to decide what to bind) and the
// test workers (they re-load this very config). Both inherit the env as it
// stands when they are forked, and both are forked after this module body
// runs, so stamping it here is enough. It goes in RESOLVED_ENV_VAR rather than
// BT_TEST_PORT precisely so that a child cannot mistake an auto-selected port
// for a human-pinned one and start killing on the strength of it.
process.env[RESOLVED_ENV_VAR] = String(PORT);

// Reclaim only a *pinned* port (BT_TEST_PORT). A run that was SIGKILLed or
// timed out leaves its vite behind — Playwright's teardown never ran — and
// `strictPort` would then fail the whole next run on that same pinned port.
// An auto-selected port is never reclaimed: the listener there is far more
// likely to be another session's live run than our own corpse.
//
// Playwright re-loads this config in every worker process, and killing the
// server from a worker would take down the run it belongs to. Two independent
// guards keep this to the runner's first load: workers get TEST_WORKER_INDEX,
// and they inherit the BT_TEST_PORT_FREED we stamp here. (A worker on the
// default path never gets this far anyway — `explicit` is false for it,
// because RESOLVED_ENV_VAR, not BT_TEST_PORT, is what it inherited.)
if (explicit && process.env.TEST_WORKER_INDEX === undefined && !process.env.BT_TEST_PORT_FREED) {
  process.env.BT_TEST_PORT_FREED = '1';
  freeTestPort(PORT);
}

if (process.env.TEST_WORKER_INDEX === undefined) {
  console.log(`[test-port] using :${PORT}${explicit ? ' (pinned via BT_TEST_PORT)' : ''}`);
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
