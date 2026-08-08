// src/ui/esc-stack.js — the single owner of the Escape key.
//
// Everything that wants Esc — modal dialogs, overlays, context windows, the
// game input layer — pushes a handler onto this stack and unsubscribes on
// teardown (makeDraggable-style discipline: keep the returned unsubscribe
// and call it on close). ONE window keydown listener services the key: the
// top handler runs; a handler returning `false` passes to the next one
// down. Handlers push in open order, so the most recently opened UI layer
// wins Esc — no capture-phase races, no cross-module isOpen peeking.
//
// pushEscHandler(fn, { fallback: true }) registers *below* every normal
// handler regardless of construction order. The game input layer's default
// Esc ladder (tool disarm → selection/overlay sweep) lives there, so any
// open dialog/overlay/window beats it.

const stack = [];      // normal handlers; last pushed = topmost
const fallbacks = [];  // always below all normal handlers
let bound = false;

function _onEscKeyDown(e) {
  if (e.key !== 'Escape') return;
  for (const arr of [stack, fallbacks]) {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i](e) !== false) {
        e.preventDefault();
        return;
      }
    }
  }
}

/**
 * Push an Escape handler. Returns an unsubscribe function (idempotent).
 *
 * @param {(e: KeyboardEvent) => (boolean|void)} fn - Return false to pass
 *   the key to the next handler down; any other return consumes it.
 * @param {{ fallback?: boolean }} [opts] - fallback handlers sit below all
 *   normal handlers (the game input layer's default ladder).
 */
export function pushEscHandler(fn, { fallback = false } = {}) {
  if (!bound) {
    window.addEventListener('keydown', _onEscKeyDown);
    bound = true;
  }
  const arr = fallback ? fallbacks : stack;
  arr.push(fn);
  let alive = true;
  return () => {
    if (!alive) return;
    alive = false;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  };
}
