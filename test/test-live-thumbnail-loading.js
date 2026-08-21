// Live palette thumbnails must hydrate without requiring a pointer or keyboard
// event. Browser automation is owner-gated, so protect this initialization
// boundary with a headless wiring check.

import { readFileSync } from 'node:fs';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) { passed++; console.log('  PASS:', message); }
  else { failed++; console.log('  FAIL:', message); }
}

const source = readFileSync(
  new URL('../src/renderer3d/ThreeRenderer.js', import.meta.url),
  'utf8',
);
const afterFirstFrame = source.slice(
  source.indexOf('    this._animate();'),
  source.indexOf('    this._physicsPresentation.scheduleInit(this.scene);'),
);

assert(
  afterFirstFrame.includes('loadLegacyThumbnailRenderer().then((ready) => {'),
  'the live thumbnail renderer starts automatically after the first playable frame',
);
assert(
  afterFirstFrame.includes('if (ready && this._refreshPalette) this._refreshPalette();'),
  'the active palette redraws when live thumbnail rendering becomes available',
);
assert(
  !/addEventListener\(['"](?:pointerenter|pointerdown|focusin)['"]/.test(afterFirstFrame),
  'thumbnail hydration is not gated on palette interaction',
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
