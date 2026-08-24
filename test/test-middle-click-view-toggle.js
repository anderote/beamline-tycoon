// Middle-click camera contract: ordinary pointer jitter remains a click, a
// real drag keeps free orbit, and the click changes elevation without changing
// the live compass heading.

import { readFileSync } from 'node:fs';

import {
  InputHandler,
  CAMERA_DRAG_THRESHOLD_PX,
  isCameraDrag,
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
assert(CAMERA_DRAG_THRESHOLD_PX === 4, 'camera drag threshold is a small 4px jitter allowance');
assert(!isCameraDrag(origin, { x: 103, y: 102 }), 'sub-threshold mouse jitter remains a click');
assert(isCameraDrag(origin, { x: 104, y: 100 }), 'movement at the threshold starts free orbit');
assert(isCameraDrag(origin, { x: 103, y: 103 }), 'diagonal movement uses true pixel distance');

console.log('\n=== Command-drag camera gesture ===\n');

const previousWindow = globalThis.window;
const windowHandlers = {};
globalThis.window = {
  addEventListener(type, fn) { (windowHandlers[type] ||= []).push(fn); },
};
const canvas = {
  handlers: {},
  style: {},
  addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); },
};
const calls = [];
const handler = Object.assign(Object.create(InputHandler.prototype), {
  renderer: {
    app: { canvas },
    ui: { _dismissConnectionGuide() {} },
    startFreeOrbit() { calls.push('start'); },
    orbitBy(dx, dy) { calls.push(['orbit', dx, dy]); },
    endFreeOrbit() { calls.push('end'); },
    toggleViewMode() { calls.push('toggle'); },
  },
  game: {},
  activeTool: null,
  isFreeOrbiting: false,
  freeOrbitButton: null,
  freeOrbitToggleOnClick: false,
  freeOrbitStart: { x: 0, y: 0 },
  freeOrbitLast: { x: 0, y: 0 },
  freeOrbitDragged: false,
  isPanning: false,
  _hideDragCostTooltip() {},
  _deferredUtilityPortDrag: { release() {}, update() { return null; }, begin() {} },
  _handleClick() { calls.push('click'); },
});
InputHandler.prototype._bindMouse.call(handler);
const fire = (type, event) => canvas.handlers[type].forEach((fn) => fn(event));

let prevented = false;
fire('mousedown', {
  button: 0, metaKey: true, clientX: 100, clientY: 100,
  preventDefault() { prevented = true; },
});
assert(prevented && handler.isFreeOrbiting && handler.freeOrbitButton === 0,
  'Command + left press reserves the camera gesture');
fire('mousemove', { clientX: 103, clientY: 100 });
assert(calls.length === 0, 'Command + left movement below the threshold remains pending');
fire('mousemove', { clientX: 104, clientY: 100 });
assert(calls[0] === 'start' && calls[1]?.[0] === 'orbit',
  'Command + left movement at the threshold starts free orbit');
fire('mouseup', { button: 0, target: canvas });
assert(calls.at(-1) === 'end' && !calls.includes('toggle') && !calls.includes('click'),
  'Command-drag ends free orbit without toggling elevation or selecting');

calls.length = 0;
fire('mousedown', {
  button: 0, metaKey: true, clientX: 100, clientY: 100,
  preventDefault() {},
});
fire('mouseup', { button: 0, target: canvas });
assert(calls.length === 0, 'Command-click is consumed without changing the view or selecting');

calls.length = 0;
fire('mousedown', {
  button: 1, metaKey: false, clientX: 100, clientY: 100,
  preventDefault() {},
});
fire('mouseup', { button: 1, target: canvas });
assert(calls.length === 1 && calls[0] === 'toggle',
  'a middle click keeps its existing elevation-toggle action');
globalThis.window = previousWindow;

console.log('\n=== Elevation toggle preserves live yaw ===\n');

assert(toggledViewMode('iso') === 'steep', 'isometric toggles to steep');
assert(toggledViewMode('steep') === 'top', 'steep toggles to top-down');
assert(toggledViewMode('top') === 'iso', 'top-down toggles to isometric');

// Headless wiring check. Browser automation is owner-gated, so guard the DOM
// event boundary by ensuring the on-canvas release selects the click path.
const inputSource = readFileSync(new URL('../src/input/InputHandler.js', import.meta.url), 'utf8');
const rendererSource = readFileSync(new URL('../src/renderer3d/ThreeRenderer.js', import.meta.url), 'utf8');
assert(inputSource.includes("this._finishCameraGesture({ allowClickAction: true })"),
  'an on-canvas middle release opts into the elevation toggle');
assert(rendererSource.includes('this.setViewMode(toggledViewMode(currentMode));'),
  'the elevation toggle omits a destination yaw and therefore keeps setViewMode\'s live yaw');
assert(rendererSource.includes("this.viewMode === 'custom'"),
  'a custom elevation joins the nearest preferred-elevation cycle on click');
assert(rendererSource.includes('let toYaw = fromYaw;'),
  'setViewMode preserves the exact current heading when no yaw is supplied');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
