// test/test-lighting-power.js — lighting draw folds into the single power
// aggregate, not a second summation.
//
// Task 3 gave every lighting fixture def an energyCost in kW. This test
// pins lightingEnergyDraw(state) as the one place that gets summed, and
// checks it is actually folded into facilityEnergyDraw — the function the
// electricity bill (economy.js:181) and the power panel's utilization
// (economy.js:546) both read. If a future edit re-derives lighting draw
// inline at either call site, this is the test that should catch the drift.

import { PLACEABLES } from '../src/data/placeables/index.js';
import {
  lightingEnergyDraw, facilityEnergyDraw, equipmentEnergyDraw, beamlineEnergyDraw,
} from '../src/game/aggregates.js';

let passed = 0, failed = 0;
function assertOk(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

const mk = (placeables, extra = {}) => ({
  placeables, totalEnergyCost: 0, ...extra,
});
const p = (type, id) => ({ id, type, category: 'decoration', kind: 'decoration' });

console.log('\n=== 1. No fixtures: zero draw, no regression ===\n');

{
  const state = mk([]);
  assertOk(lightingEnergyDraw(state) === 0, 'no fixtures placed: lightingEnergyDraw is 0');
  const preExisting = equipmentEnergyDraw(state) + beamlineEnergyDraw(state);
  assertOk(near(facilityEnergyDraw(state), preExisting),
    'facilityEnergyDraw is unchanged from equipment + beamline when there is no lighting');
}

console.log('\n=== 2. Placed fixtures sum into both accessors ===\n');

{
  const lamppost = PLACEABLES.lamppost;
  const highMast = PLACEABLES.highMastLight;
  assertOk(!!lamppost?.light && lamppost.energyCost > 0, 'sanity: lamppost is a lit fixture with energyCost');
  assertOk(!!highMast?.light && highMast.energyCost > 0, 'sanity: highMastLight is a lit fixture with energyCost');

  const state = mk([
    p('lamppost', 1),
    p('lamppost', 2),
    p('highMastLight', 3),
  ]);
  const expected = lamppost.energyCost * 2 + highMast.energyCost;
  assertOk(near(lightingEnergyDraw(state), expected),
    `two lampposts + one high mast sum to ${expected} kW`);

  const other = equipmentEnergyDraw(state) + beamlineEnergyDraw(state);
  assertOk(near(facilityEnergyDraw(state), other + expected),
    'facilityEnergyDraw includes the lighting sum');
}

console.log('\n=== 3. Wall fixtures (state.wallFixtures) count alongside tile-placed ones ===\n');

{
  const sconce = PLACEABLES.wallSconce;
  assertOk(!!sconce?.light && sconce.energyCost > 0, 'sanity: wallSconce is a lit fixture with energyCost');

  // Absent store: must not throw, must contribute 0.
  const stateAbsent = mk([p('lamppost', 1)]);
  assertOk(!('wallFixtures' in stateAbsent), 'sanity: wallFixtures is genuinely absent here');
  const drawAbsent = lightingEnergyDraw(stateAbsent);
  assertOk(near(drawAbsent, PLACEABLES.lamppost.energyCost),
    'absent state.wallFixtures does not throw and contributes 0');

  // Empty store: same result as absent.
  const stateEmpty = mk([p('lamppost', 1)], { wallFixtures: {} });
  assertOk(near(lightingEnergyDraw(stateEmpty), drawAbsent),
    'empty state.wallFixtures matches the absent case');

  // Populated store: sums alongside placeables.
  const stateBoth = mk([p('lamppost', 1)], {
    wallFixtures: {
      '4,4,N': { type: 'wallSconce' },
      '4,5,N': { type: 'wallSconce' },
    },
  });
  const expected = PLACEABLES.lamppost.energyCost + sconce.energyCost * 2;
  assertOk(near(lightingEnergyDraw(stateBoth), expected),
    `one lamppost + two wall sconces sum to ${expected} kW`);
  assertOk(near(facilityEnergyDraw(stateBoth),
    equipmentEnergyDraw(stateBoth) + beamlineEnergyDraw(stateBoth) + expected),
    'facilityEnergyDraw includes wall fixtures too');
}

console.log('\n=== 4. Decorations without a light block contribute nothing ===\n');

{
  const oakTree = PLACEABLES.oakTree;
  assertOk(!!oakTree && !oakTree.light, 'sanity: oakTree is a decoration with no light block');

  const state = mk([p('oakTree', 1), p('oakTree', 2)]);
  assertOk(lightingEnergyDraw(state) === 0, 'two oak trees contribute 0 kW of lighting draw');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
