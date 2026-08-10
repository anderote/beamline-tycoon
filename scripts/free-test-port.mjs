#!/usr/bin/env node
// scripts/free-test-port.mjs — reclaim the browser-test vite port.
//
// Playwright's `webServer` teardown does not fire when the run is SIGKILLed
// or the outer process times out, so the detached vite it spawned survives
// and the next run dies on `strictPort` with "Port 8123 is already in use".
// Every entry point into the browser suite calls this first:
//   * `npm run test:browser` via its `pretest:browser` hook
//   * `npx playwright test` via playwright.config.mjs at load time
// so a leaked server is a self-healing condition rather than a manual step.
//
// Only the configured BT_TEST_PORT (8123 by default) is ever touched; the
// game's own dev server lives on 8000 and is never a target.

import { execFileSync } from 'node:child_process';

const PORT = Number(process.env.BT_TEST_PORT || 8123);

/** PIDs listening on `port`, or [] when nothing holds it. */
function holders(port) {
  try {
    // -sTCP:LISTEN so a browser's *client* socket to the port is not a target.
    const out = execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    return [...new Set(out.split('\n').map(s => s.trim()).filter(Boolean).map(Number))];
  } catch {
    return []; // lsof exits 1 when it matches nothing
  }
}

function sleep(ms) {
  // Synchronous: this runs from playwright.config.mjs's module body, which is
  // evaluated before anything the runner can await.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function freeTestPort(port = PORT, { quiet = false } = {}) {
  let pids = holders(port);
  if (!pids.length) return [];

  const killed = [...pids];
  for (const sig of ['SIGTERM', 'SIGKILL']) {
    for (const pid of pids) {
      try { process.kill(pid, sig); } catch { /* already gone */ }
    }
    // vite closes its listener on SIGTERM within a few hundred ms.
    for (let i = 0; i < 20; i++) {
      pids = holders(port);
      if (!pids.length) break;
      sleep(100);
    }
    if (!pids.length) break;
  }

  if (pids.length) {
    throw new Error(`port ${port} still held by ${pids.join(', ')} after SIGKILL`);
  }
  if (!quiet) console.log(`[free-test-port] reclaimed :${port} from pid ${killed.join(', ')}`);
  return killed;
}

// Direct invocation (`node scripts/free-test-port.mjs`, the pretest hook).
if (import.meta.url === `file://${process.argv[1]}`) {
  freeTestPort();
}
