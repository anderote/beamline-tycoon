import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  CONTEXT_WINDOW_SIZE_STORAGE_KEY,
  clampContextWindowSize,
  contextWindowSizeKey,
  persistContextWindowSize,
  readContextWindowSize,
} from '../src/ui/context-window-size.js';

const values = new Map();
const storage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
};

assert.equal(contextWindowSizeKey('bl-bl-17'), 'beamline');
assert.equal(contextWindowSizeKey('equip-placed_981'), 'equipment');
assert.equal(contextWindowSizeKey('staff-staff_12'), 'staff-inspector');
assert.equal(contextWindowSizeKey('util-line-line_44'), 'utility-line');
assert.equal(contextWindowSizeKey('economy'), 'economy');

assert.equal(persistContextWindowSize('beamline', { width: 812.4, height: 603.6 }, { storage }), true);
assert.deepEqual(readContextWindowSize('beamline', {
  storage, viewport: { width: 1400, height: 900 },
}), { width: 812, height: 604 }, 'saved dimensions round-trip for a later window session');

persistContextWindowSize('equipment', { width: 5000, height: 5000 }, { storage });
assert.deepEqual(readContextWindowSize('equipment', {
  storage, viewport: { width: 1024, height: 768 },
}), { width: 1016, height: 760 }, 'restored sizes are capped to the current viewport');
assert.deepEqual(clampContextWindowSize({ width: 20, height: 40 }), {
  width: 220, height: 140,
}, 'tiny saved dimensions cannot make a window unusable');
assert.equal(persistContextWindowSize('bad', { width: NaN, height: 200 }, { storage }), false);

const saved = JSON.parse(values.get(CONTEXT_WINDOW_SIZE_STORAGE_KEY));
assert.deepEqual(Object.keys(saved).sort(), ['beamline', 'equipment'],
  'invalid writes do not damage existing window preferences');

values.set(CONTEXT_WINDOW_SIZE_STORAGE_KEY, '{broken json');
assert.equal(readContextWindowSize('beamline', { storage }), null,
  'corrupt local preferences safely fall back to default sizing');

const contextSource = readFileSync(new URL('../src/ui/ContextWindow.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
assert(contextSource.includes("el.classList.add('ctx-resizable')")
  && contextSource.includes('persistContextWindowSize(this._sizeKey'),
  'the shared ContextWindow base enables and persists resizing for every window family');
assert(css.includes('resize:both') && css.includes('.ctx-resize-grip'),
  'the shared window chrome exposes a visible native resize corner');

console.log('Context-window size persistence: all assertions passed');
