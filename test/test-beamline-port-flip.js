// F-key utility-port mirroring for beamline placement. Beam entry/exit ports
// must remain fixed: this is a routing/layout option, not an optics mutation.

import { BeamlineTool } from '../src/input/beamline-tool.js';
import { COMPONENTS } from '../src/data/components.js';
import { findSlot } from '../src/beamline/pipe-placements.js';
import { listUtilityEndpoints } from '../src/utility/utility-endpoints.js';
import {
  portApproachVec,
  portSide,
  portWorldPosition,
} from '../src/utility/ports.js';

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

const def = {
  subW: 4,
  subL: 8,
  ports: {
    entry: { side: 'back' },
    pwr_in: { utility: 'powerCable', side: 'left', offsetAlong: 0.25 },
  },
};
const normal = { id: 'm1', type: 'fake', col: 3, row: 4, subCol: 0, subRow: 0, dir: 0 };
const flipped = { ...normal, portsFlipped: true };

console.log('\n=== utility geometry mirrors; beam geometry does not ===\n');
assert(portSide(def, 'pwr_in', 0, false) === 'W', 'authored utility port starts on the left/west face');
assert(portSide(def, 'pwr_in', 0, true) === 'E', 'flipped utility port moves to the opposite face');
assert(portSide(def, 'entry', 0, true) === 'N', 'beam entry stays on its authored face');

const a = portWorldPosition(normal, def, 'pwr_in');
const b = portWorldPosition(flipped, def, 'pwr_in');
const centerX = normal.col * 2 + def.subW * 0.25;
const centerZ = normal.row * 2 + def.subL * 0.25;
assert(Math.abs((a.x + b.x) / 2 - centerX) < 1e-9
    && Math.abs((a.z + b.z) / 2 - centerZ) < 1e-9,
  'flipped position is the point opposite the authored connector across the component center');
const av = portApproachVec(normal, def, 'pwr_in');
const bv = portApproachVec(flipped, def, 'pwr_in');
assert(av.dCol === -bv.dCol && av.dRow === -bv.dRow,
  'utility routing leaves the flipped connector in the opposite direction');

console.log('\n=== F toggles the armed beamline placement state ===\n');
{
  const tool = new BeamlineTool('source');
  let prevented = 0, previews = 0, toast = '';
  const input = {
    placementPortsFlipped: true,
    selectedParamOverrides: null,
    _showToast: (message) => { toast = message; },
    _updatePlaceablePreview: () => { previews++; },
  };
  const renderer = { setBuildMode() {}, _portMarkersDirty: false };
  const ctx = { input, renderer };
  tool.onEnter(ctx);
  assert(input.placementPortsFlipped === false, 'arming a component starts from its authored port layout');
  const consumed = tool.onKey({ key: 'f', preventDefault: () => { prevented++; } }, ctx);
  assert(consumed && input.placementPortsFlipped === true, 'F flips utility ports and consumes the key');
  assert(prevented === 1 && previews === 1 && /flipped/.test(toast),
    'F refreshes the preview and reports the new side');
}

console.log('\n=== pipe-mounted components retain the flip in endpoint state ===\n');
{
  const pipe = {
    id: 'bp1', subL: 20,
    path: [{ col: 0, row: 0 }, { col: 0, row: 10 }],
    placements: [],
  };
  const placed = findSlot(pipe, {
    type: 'buncher', requestedPosition: 0.2, subL: COMPONENTS.buncher.subL,
    mode: 'snap', idGenerator: () => 'pl1', params: {}, portsFlipped: true,
  });
  assert(placed.ok && placed.placements[0].portsFlipped === true,
    'the pipe placement record stores the selected flip');
  pipe.placements = placed.placements;
  const endpoint = listUtilityEndpoints({ placeables: [], beamPipes: [pipe] })[0];
  assert(endpoint?.portsFlipped === true,
    'the synthesized utility endpoint carries the flip into routing/rendering');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
