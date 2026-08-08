// test/test-uihost-passthrough.js — the UIHost ⇄ renderer property seam.
//
// UIHost owns the HUD methods but stores nothing: PASS_THROUGH_PROPS is the
// explicit list of fields whose reads/writes delegate to the renderer. Any
// field the HUD reads as `this.x` while other layers write it as
// `renderer.x` must be on that list.
//
// Regression: `_facilityGroup` (the Facility Labs/Rooms tab toggle) was not,
// so main.js's `renderer._facilityGroup = restoredCat.group` landed on a dead
// renderer field, the HUD kept seeing undefined, and the toggle reset to
// 'labs' on every load.

import { UIHost } from '../src/ui/UIHost.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// Fields the HUD reads off `this` but other layers set on the renderer.
const REQUIRED = [
  'game', 'activeMode', 'buildMode',
  'wallVisibilityMode', '_cutawayHoverKey', '_transparentHoverKey',
  '_facilityGroup',
];

console.log('\n--- Pass-through props delegate to the renderer ---\n');

for (const prop of REQUIRED) {
  const desc = Object.getOwnPropertyDescriptor(UIHost.prototype, prop);
  assert(desc && typeof desc.get === 'function' && typeof desc.set === 'function',
    `${prop} is a pass-through accessor`);
}

{
  const renderer = {};
  const ui = new UIHost(renderer);

  // A write through the renderer is visible to the UI layer...
  renderer._facilityGroup = 'rooms';
  assert(ui._facilityGroup === 'rooms', 'renderer write is visible as ui._facilityGroup');
  // ...and a write from the UI layer lands on the renderer.
  ui._facilityGroup = 'labs';
  assert(renderer._facilityGroup === 'labs', 'ui write lands on renderer._facilityGroup');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
