#!/usr/bin/env node
// scripts/free-test-port.mjs — reclaim a *pinned* browser-test vite port.
//
// Playwright's `webServer` teardown does not fire when the run is SIGKILLed
// or the outer process times out, so the detached vite it spawned survives
// and the next run dies on `strictPort` with "Port N is already in use".
//
// Killing the holder is only ever safe when the port was pinned by hand
// (BT_TEST_PORT): that says "this port is mine", so anything squatting on it
// is my own leak. On the default path the port is auto-selected from a free
// one (see scripts/test-port.mjs), a leak cannot block anybody, and killing
// the listener would mean killing a *live* run belonging to another session.
// That is precisely the bug this file used to cause, so the unconditional
// reclaim is gone.
//
// Only the resolved test port is ever touched; the game's own dev server lives
// on 8000 and is never a target.

import { holders, resolveTestPort } from './test-port.mjs';

function sleep(ms) {
  // Synchronous: this runs from playwright.config.mjs's module body, which is
  // evaluated before anything the runner can await.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function freeTestPort(port, { quiet = false } = {}) {
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
// A no-op unless BT_TEST_PORT is pinned — see the header.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { port, explicit } = resolveTestPort();
  if (explicit) freeTestPort(port);
}
