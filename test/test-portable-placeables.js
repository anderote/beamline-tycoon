import assert from 'node:assert/strict';
import { PLACEABLES } from '../src/data/placeables/index.js';

const expectedPortable = [
  'oscilloscope', 'signalGenerator', 'spectrumAnalyzer', 'networkAnalyzer',
  'flowMeter', 'leakDetector', 'mirrorMount', 'beamProfiler', 'coffeeMachine',
  'projector', 'phoneUnit',
];

for (const id of expectedPortable) {
  assert.equal(PLACEABLES[id]?.portable, true, `${id} is eligible for physical drop presentation`);
}

assert.equal(PLACEABLES.labBench.portable, false, 'a support bench stays grid-authored');
assert.notEqual(PLACEABLES.source.portable, true, 'beamline hardware is never implicitly portable');

const portable = Object.values(PLACEABLES).filter(def => def.portable === true);
assert.ok(portable.length >= expectedPortable.length, 'the registry exposes a portable subset');
for (const def of portable) {
  assert.ok(def.kind === 'equipment' || def.kind === 'furnishing',
    `${def.id}: portable content stays in the small facility-item families`);
  assert.equal(def.stackable, true,
    `${def.id}: the default portable contract is backed by surface stacking`);
}

console.log(`Portable placeable contract tests passed (${portable.length} portable definitions).`);
