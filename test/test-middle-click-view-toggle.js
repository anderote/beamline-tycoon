// Middle-click camera contract: ordinary pointer jitter remains a click, a
// real drag keeps free orbit, and the click changes elevation without changing
// the live compass heading.

import { readFileSync } from 'node:fs';

import {
  MIDDLE_CAMERA_DRAG_THRESHOLD_PX,
  isMiddleCameraDrag,
} from '../src/input/InputHandler.js';
import {
  toggledViewMode,
} from '../src/renderer3d/free-orbit-math.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.log(`  FAIL: ${msg}`); }
}

console.log('\n=== Middle-button click versus drag ===\n');

const origin = { x: 100, y: 100 };
assert(MIDDLE_CAMERA_DRAG_THRESHOLD_PX === 4, 'camera drag threshold is a small 4px jitter allowance');
assert(!isMiddleCameraDrag(origin, { x: 103, y: 102 }), 'sub-threshold mouse jitter remains a click');
assert(isMiddleCameraDrag(origin, { x: 104, y: 100 }), 'movement at the threshold starts free orbit');
assert(isMiddleCameraDrag(origin, { x: 103, y: 103 }), 'diagonal movement uses true pixel distance');

console.log('\n=== Elevation toggle preserves live yaw ===\n');

assert(toggledViewMode('iso') === 'top', 'isometric toggles to top-down');
assert(toggledViewMode('top') === 'iso', 'top-down toggles to isometric');

// Headless wiring check. Browser automation is owner-gated, so guard the DOM
// event boundary by ensuring the on-canvas release selects the click path.
const inputSource = readFileSync(new URL('../src/input/InputHandler.js', import.meta.url), 'utf8');
const rendererSource = readFileSync(new URL('../src/renderer3d/ThreeRenderer.js', import.meta.url), 'utf8');
assert(inputSource.includes("this._finishMiddleCameraGesture({ toggleClick: true })"),
  'an on-canvas middle release opts into the elevation toggle');
assert(rendererSource.includes('this.setViewMode(toggledViewMode(this.viewMode));'),
  'the elevation toggle omits a destination yaw and therefore keeps setViewMode\'s live yaw');
assert(rendererSource.includes('let toYaw = fromYaw;'),
  'setViewMode preserves the exact current heading when no yaw is supplied');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
