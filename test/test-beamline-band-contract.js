import assert from 'node:assert/strict';
import { isWithinBeamlineBand } from '../src/data/beamline-types.js';
import { computeEndpointService } from '../src/game/endpoint-economy.js';
import { checkBands } from '../scripts/eval-design.mjs';
import { getStockDesign } from '../src/data/stock-designs.js';

// Proton rest-mass subtraction can report 70 MeV as 0.07000000000000006.
assert(isWithinBeamlineBand(0.07000000000000006, [0.015, 0.07]));
assert(!isWithinBeamlineBand(0.070000001, [0.015, 0.07]));
assert(!isWithinBeamlineBand(NaN, [0.015, 0.07]));
assert(!isWithinBeamlineBand(Infinity, [0.015, 0.07]));
assert(!isWithinBeamlineBand(0, [0.015, 0.07]));
assert(isWithinBeamlineBand(0.07, [null, 0.07]));
assert(isWithinBeamlineBand(1, [0.07, null]));

// The displayed/evaluated band and billed hard ceiling must use the same rule.
const nodes = [{ type: 'xRayConverterStation' }];
const beam = { beamEnergy: 0.012000000000000002, beamCurrent: 30, beamQuality: 1 };
assert(computeEndpointService('ebeamProcessing', beam, nodes).revenue > 0);
assert(checkBands(getStockDesign('ebeam-crosslinker'), beam).ok);
const overLimit = { ...beam, beamEnergy: 0.01200001 };
assert.equal(computeEndpointService('ebeamProcessing', overLimit, nodes).revenue, 0);
assert(!checkBands(getStockDesign('ebeam-crosslinker'), overLimit).ok);
console.log('Beamline band contracts passed');
