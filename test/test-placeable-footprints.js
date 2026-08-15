// test/test-placeable-footprints.js — catalogue footprint sanity.
//
// Every placement cell is a real 0.5 m subtile. This does not try to infer
// service clearances from art, but it does pin the audited power footprints
// and verifies that every registered placeable reserves the exact number of
// subtiles its definition advertises at all four rotations.

import { PLACEABLES } from '../src/data/placeables/index.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

console.log('\n--- Registry dimensions use the subtile grid ---');
const invalid = [];
const gridMismatch = [];
const badCellCounts = [];
for (const p of Object.values(PLACEABLES)) {
  if (!Number.isInteger(p.subW) || p.subW < 1
      || !Number.isInteger(p.subL) || p.subL < 1) invalid.push(p.id);
  if ((p.gridW != null && p.gridW !== p.subW)
      || (p.gridH != null && p.gridH !== p.subL)) gridMismatch.push(p.id);
  for (let dir = 0; dir < 4; dir++) {
    const cells = p.footprintCells(2, 3, 1, 2, dir);
    if (cells.length !== p.subW * p.subL) badCellCounts.push(`${p.id}@${dir}`);
  }
}
assert(invalid.length === 0,
  `all placeables have positive integer subtile dimensions (${invalid.join(',') || 'all valid'})`);
assert(gridMismatch.length === 0,
  `legacy grid dimensions agree with subW/subL when present (${gridMismatch.join(',') || 'all agree'})`);
assert(badCellCounts.length === 0,
  `every rotated footprint reserves subW × subL cells (${badCellCounts.join(',') || 'all agree'})`);

console.log('\n--- Audited electrical footprints ---');
const expectedPower = {
  powerPanel: [1, 1],
  sectionDistributionPanel: [2, 1],
  mainDistributionPanel: [3, 2],
  padMountTransformer: [2, 2],
  facilityTransformer: [3, 4],
  hvTransformer: [3, 4],
  gridIntertieTransformer: [4, 6],
  switchgear: [2, 3],
  mcc: [4, 2],
  ups: [3, 2],
  powerBus: [1, 3],
  spiderBox: [1, 1],
};
for (const [id, [w, l]] of Object.entries(expectedPower)) {
  const p = PLACEABLES[id];
  assert(p?.subW === w && p?.subL === l,
    `${id} reserves ${w} × ${l} half-metre subtiles`);
}

console.log('\n--- Wide SRF hardware includes its side couplers ---');
for (const id of ['halfWaveResonator', 'spokeCavity', 'ellipticalSrfCavity']) {
  assert(PLACEABLES[id]?.subW === 3, `${id} reserves a 1.5 m-wide service envelope`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
