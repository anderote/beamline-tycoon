// scripts/balance-env.mjs — the browser surface the Game expects, for headless
// balance runs. Imported for side effects before anything that constructs a
// Game; kept separate from the rate scenarios so the browser shim stays
// reusable and easy to audit.

import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

// Autosave writes through localStorage; back it with a Map.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

// Silence the per-tick console.warn spam from the utility gate while keeping
// real errors visible.
const realWarn = console.warn;
console.warn = (...args) => {
  const s = String(args[0] ?? '');
  if (s.startsWith('[utility]') || s.startsWith('[pipe-draw]')) return;
  realWarn(...args);
};
