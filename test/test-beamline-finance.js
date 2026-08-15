// Regression: component costs are resource objects, so adding `comp.cost`
// directly rendered "$0[object Object]" in the Beamline Finance tab.

import { COMPONENTS } from '../src/data/components.js';
import { BeamlineWindow } from '../src/ui/BeamlineWindow.js';

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log('  PASS:', message); }
  else { failed++; console.log('  FAIL:', message); }
}

console.log('\n=== Beamline finance formatting ===\n');

const beamlineId = 'finance-test';
const types = ['source', 'quadrupole'];
const expected = types.reduce((sum, type) => sum + (COMPONENTS[type].cost.funding || 0), 0);
const el = { innerHTML: '' };
const windowLike = {
  beamlineId,
  game: {
    registry: {
      get: id => id === beamlineId ? { beamState: {} } : null,
    },
    state: {
      placeables: [
        ...types.map(type => ({ type, beamlineId })),
        { type: 'source', beamlineId: 'another-beamline' },
      ],
    },
  },
};

BeamlineWindow.prototype._renderFinance.call(windowLike, el);

assert(el.innerHTML.includes(`$${expected.toLocaleString()}`),
  `Build Cost renders the summed funding amount ($${expected.toLocaleString()})`);
assert(!el.innerHTML.includes('[object Object]'),
  'Finance markup never stringifies a resource-cost object');
assert(el.innerHTML.includes('>2</div>'),
  'the component count remains scoped to this beamline');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
