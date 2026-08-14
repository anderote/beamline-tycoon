// scripts/test-port.mjs — the one place that decides which port the browser
// tests use.
//
// The port used to be a fixed 8123, and every entry point into the suite
// reclaimed it by killing whatever was listening. That is correct for one
// developer and fatal for several: with a dozen agent sessions sharing this
// checkout, starting a run SIGKILLed a *live* run's vite and the victim then
// failed every remaining spec on ERR_CONNECTION_REFUSED. `reuseExistingServer:
// false` plus `strictPort: true` made it unrecoverable rather than a hiccup.
//
// So the default path no longer shares a port and no longer kills:
//
//   * BT_TEST_PORT set   — honour it exactly, and keep the reclaim-by-killing
//     behaviour. Someone who names a port has said they own it, and a leftover
//     server on it is theirs to take back.
//   * BT_TEST_PORT unset — scan 8123..8199 for a port nobody is listening on
//     and take the first free one. Nothing is ever killed.
//
// Port 8000 is outside the range on purpose: that is the game's own
// `npm run dev` server and it is never a candidate and never a target.

import { execFileSync } from 'node:child_process';

const FIRST_PORT = 8123;
const LAST_PORT = 8199;
const SPAN = LAST_PORT - FIRST_PORT + 1;

// Set by playwright.config.mjs once the runner has picked a port, so that the
// vite child and the test workers bind/talk to that same port instead of each
// re-running the scan and disagreeing. Deliberately NOT BT_TEST_PORT: a worker
// that inherited a stamped BT_TEST_PORT would read it as "the user pinned this
// port" and feel entitled to kill the holder — which is the server of the very
// run the worker belongs to.
export const RESOLVED_ENV_VAR = 'BT_TEST_PORT_RESOLVED';

/** PIDs listening on `port`, or [] when nothing holds it. */
export function holders(port) {
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

/**
 * Decide the port for this process.
 *
 * Returns `{ port, explicit }`. `explicit` is true only when a human set
 * BT_TEST_PORT; it is the sole licence to kill anything, so nothing this
 * module stamps for its own children may ever set it.
 *
 * Probing is synchronous because the first caller is playwright.config.mjs's
 * module body, which is evaluated before the runner can await anything.
 */
export function resolveTestPort() {
  if (process.env.BT_TEST_PORT) {
    return { port: Number(process.env.BT_TEST_PORT), explicit: true };
  }
  // Already decided upstream (worker process, or the vite the runner spawned).
  if (process.env[RESOLVED_ENV_VAR]) {
    return { port: Number(process.env[RESOLVED_ENV_VAR]), explicit: false };
  }

  // Start the scan at a pid-derived offset. Two sessions probing in the same
  // millisecond both see the whole range as free, so scanning from a fixed
  // start would hand them the same port and one of them would lose the bind.
  // Different pids start at different candidates, which makes the collision
  // window a coincidence rather than the default.
  const start = process.pid % SPAN;
  for (let i = 0; i < SPAN; i++) {
    const port = FIRST_PORT + ((start + i) % SPAN);
    if (!holders(port).length) return { port, explicit: false };
  }
  throw new Error(
    `no free port in ${FIRST_PORT}..${LAST_PORT} — every one has a listener. ` +
    `Close some test servers, or set BT_TEST_PORT to a port you want reclaimed.`
  );
}
