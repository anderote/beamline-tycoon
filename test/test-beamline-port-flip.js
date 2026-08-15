// M-key utility-port mirroring for all placeable hardware. Beam entry/exit
// ports must remain fixed: this is a routing/layout option, not an optics
// mutation. F remains the placement rotation key.

import { BeamlineTool } from '../src/input/beamline-tool.js';
import { InputHandler } from '../src/input/InputHandler.js';
import { PlaceableTool } from '../src/input/placement-tools.js';
import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
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

globalThis.localStorage ||= { getItem() { return null; }, setItem() {}, removeItem() {} };

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

console.log('\n=== F rotates beamline hardware; M mirrors its utility ports ===\n');
{
  const tool = new BeamlineTool('source');
  let prevented = 0, previews = 0, toast = '', renderedDir = -1;
  const input = {
    activeTool: tool,
    armedPlaceableId: 'source',
    game: { _designPlacer: null },
    placementDir: 0,
    dipoleBendDir: 'right',
    placementPortsFlipped: true,
    selectedParamOverrides: null,
    _showToast: (message) => { toast = message; },
    _updatePlaceablePreview: () => { previews++; },
    _toolCtx: null,
  };
  const renderer = {
    setBuildMode() {}, _portMarkersDirty: false,
    updatePlacementDir: (dir) => { renderedDir = dir; },
    updateCursorBendDir() {},
  };
  input.renderer = renderer;
  input._toolCtx = { input, renderer };
  input._toolConsumed = InputHandler.prototype._toolConsumed;
  input._handleMirrorPortsKey = InputHandler.prototype._handleMirrorPortsKey;
  const ctx = input._toolCtx;
  tool.onEnter(ctx);
  assert(input.placementPortsFlipped === false, 'arming a component starts from its authored port layout');

  const priorWindow = globalThis.window;
  const priorDocument = globalThis.document;
  let keydown = null;
  globalThis.window = { addEventListener(type, fn) { if (type === 'keydown') keydown = fn; } };
  globalThis.document = {
    addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; },
  };
  InputHandler.prototype._bindKeyboard.call(input);
  const keyEvent = key => ({
    key, target: { tagName: 'BODY' }, shiftKey: false,
    ctrlKey: false, metaKey: false, altKey: false,
    preventDefault: () => { prevented++; },
  });
  keydown(keyEvent('f'));
  assert(input.placementDir === 1 && renderedDir === 1,
    'F rotates an armed beamline component instead of mirroring its ports');
  assert(input.placementPortsFlipped === false, 'F leaves the utility-port side unchanged');
  const dirAfterF = input.placementDir;
  keydown(keyEvent('m'));
  assert(input.placementPortsFlipped === true && input.placementDir === dirAfterF,
    'M mirrors utility ports without rotating the component');
  assert(prevented === 2 && previews === 2 && /mirrored/.test(toast),
    'F and M refresh the preview and M reports the mirrored side');
  if (priorWindow === undefined) delete globalThis.window;
  else globalThis.window = priorWindow;
  if (priorDocument === undefined) delete globalThis.document;
  else globalThis.document = priorDocument;
}

console.log('\n=== M applies to infrastructure and equipment placeables too ===\n');
{
  let previews = 0;
  const input = {
    armedPlaceableId: 'magnetron',
    placementPortsFlipped: true,
    renderer: { _portMarkersDirty: false },
    _updatePlaceablePreview: () => { previews++; },
    _showToast() {},
  };
  const tool = new PlaceableTool('facility', 'magnetron');
  tool.onEnter({ input });
  assert(input.placementPortsFlipped === false,
    'arming infrastructure starts from its authored utility-port layout');
  const consumed = InputHandler.prototype._handleMirrorPortsKey.call(input, {
    key: 'm', ctrlKey: false, metaKey: false, altKey: false, preventDefault() {},
  });
  assert(consumed && input.placementPortsFlipped === true && previews === 1,
    'M mirrors an infrastructure object through the shared placement path');
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

console.log('\n=== free-placed infrastructure persists its mirrored side ===\n');
{
  const game = new Game(new BeamlineRegistry(), { seed: 20260814 });
  game.state.resources.funding = 1e9;
  let id = false;
  for (let row = 2; row < 45 && !id; row++) {
    for (let col = 2; col < 45 && !id; col++) {
      id = game.placePlaceable({
        type: 'magnetron', col, row, subCol: 0, subRow: 0,
        portsFlipped: true, free: true, silent: true,
      });
    }
  }
  const placed = id && game.getPlaceable(id);
  assert(placed?.kind === 'infrastructure' && placed.portsFlipped === true,
    'an infrastructure placement stores the M-selected mirrored layout');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
