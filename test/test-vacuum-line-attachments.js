// Vacuum instruments mount continuously along drawn vacuum utility runs.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { getUtilityPortsV2 } from '../src/data/utility-ports-v2.js';
import { listUtilityEndpoints, findUtilityEndpoint } from '../src/utility/utility-endpoints.js';
import { portWorldPosition } from '../src/utility/ports.js';
import {
  projectOntoUtilityLine, utilityAttachmentPose,
} from '../src/utility/line-attachments.js';
import { buildWorldSnapshot } from '../src/renderer3d/world-snapshot.js';
import { InputHandler } from '../src/input/InputHandler.js';
import { BeamlineTool } from '../src/input/beamline-tool.js';
import { gridToIso } from '../src/renderer/grid.js';
import { utilityLineHeight } from '../src/utility/registry.js';

let passed = 0, failed = 0;
function assert(condition, message) {
  if (condition) { passed++; console.log('  PASS:', message); }
  else { failed++; console.log('  FAIL:', message); }
}

console.log('\n=== 1. Utility-run projection is continuous and bend-aware ===\n');
{
  const line = { path: [{ col: 1, row: 2 }, { col: 5, row: 2 }, { col: 5, row: 6 }] };
  const hit = projectOntoUtilityLine(line, 3.25, 2.18);
  assert(Math.abs(hit.col - 3.25) < 1e-9 && hit.row === 2,
    'cursor projects to an arbitrary point between path vertices');
  assert(hit.dir === 1, 'horizontal run rotates the instrument along the run');
  const bendSide = utilityAttachmentPose(line, 0.75);
  assert(bendSide.col === 5 && Math.abs(bendSide.row - 4) < 1e-9,
    'stored normalized position resolves correctly beyond a bend');
  assert(bendSide.dir === 0, 'vertical run keeps the authored orientation');
}

console.log('\n=== 2. The new vacuum supply ladder is real catalog data ===\n');
{
  assert(COMPONENTS.roughingPumpCart?.energyCost === 2,
    'roughing cart is a placeable bank of four dry pumps');
  assert(COMPONENTS.roughingPumpCart?.subW === 1
      && COMPONENTS.roughingPumpCart?.subL === 2
      && COMPONENTS.roughingPumpCart?.subH === 3,
    'roughing cart occupies the compact 1×2×3-subtile envelope');
  assert(getUtilityPortsV2('roughingPumpCart').vac_out.params.roughingSpeed === 60,
    'roughing cart exposes four times the single-pump backing capacity');
  assert(COMPONENTS.turboPumpCart?.energyCost === 4,
    'turbo cart is a placeable bank of four turbomolecular pumps');
  assert(COMPONENTS.turboPumpCart?.subW === 1
      && COMPONENTS.turboPumpCart?.subL === 2
      && COMPONENTS.turboPumpCart?.subH === 3,
    'turbo cart occupies the compact 1×2×3-subtile envelope');
  assert(getUtilityPortsV2('turboPumpCart').vac_out.params.highVacSpeed === 1200
      && getUtilityPortsV2('turboPumpCart').vac_out.params.backingDemand === 60,
    'turbo cart combines four high-vac stages and needs one roughing cart');
  assert(COMPONENTS.vacuumCart?.energyCost === 3,
    'mobile cart is a placeable integrated pumping package');
  assert(COMPONENTS.vacuumCart?.subW === 2
      && COMPONENTS.vacuumCart?.subL === 2
      && COMPONENTS.vacuumCart?.subH === 3,
    'mobile cart uses exactly twice either dedicated cart footprint');
  assert(getUtilityPortsV2('vacuumCart').vac_out.params.pumpSpeed === 330,
    'cart capacity equals two 15 L/s roughing stages plus one 300 L/s turbo');
  assert(getUtilityPortsV2('highCapacityVacuumStation').vac_out.params.pumpSpeed === 3000,
    'large station delivers the authored 3,000 L/s capacity');
  assert(COMPONENTS.highCapacityVacuumStation.requires === 'differentialPumping',
    'large station is gated by the appropriate research');
}

console.log('\n=== 3. The armed placement tool finds and previews vacuum runs ===\n');
{
  assert(['piraniGauge', 'coldCathodeGauge', 'baGauge'].every(
    type => COMPONENTS[type]?.utilityMount === 'vacuumPipe',
  ), 'every vacuum gauge declares the vacuum-run mounting capability');

  const line = {
    id: 'ul_preview', utilityType: 'vacuumPipe',
    path: [{ col: 1, row: 2 }, { col: 5, row: 2 }], attachments: [],
  };
  let ghost = null;
  const input = Object.create(InputHandler.prototype);
  input.game = {
    state: { utilityLines: new Map([[line.id, line]]), beamPipes: [], resources: { funding: 1e9 } },
    canAfford: () => true,
  };
  input.renderer = {
    renderAttachmentGhost: (...args) => { ghost = args; },
    renderPlacementGridOnly: () => {},
  };
  const cursor = gridToIso(3.2, 2.12);
  const hit = input._snapAttachmentToUtilityLine('piraniGauge', cursor.x, cursor.y);
  assert(hit?.line.id === line.id && Math.abs(hit.proj.col - 3.2) < 1e-9,
    'instrument tool snaps to the nearest arbitrary point on a vacuum run');
  assert(input._snapAttachmentToUtilityLine('gateValve', cursor.x, cursor.y) === null,
    'beamline hardware that is not an instrument remains beam-pipe-only');
  input._updateAttachmentPreview('piraniGauge', cursor.x, cursor.y);
  assert(ghost?.[4] === true && ghost?.[7]?.worldX === hit.proj.worldX,
    'green placement ghost renders at the exact utility-run mount pose');

  // Clicking an elevated pipe projects to a different point on the ground
  // plane. The visible mesh hit must win so every rendered pipe section is an
  // easy gauge target instead of requiring the player to hunt below it.
  input.renderer.raycastUtilityLine = (_x, _y, tolerancePx) => ({
    lineId: line.id,
    utilityType: 'vacuumPipe',
    worldPos: { x: 6.4, z: 4.1 },
    tolerancePx,
  });
  input.game.state.utilityLines.set('ul_ground_projection', {
    id: 'ul_ground_projection', utilityType: 'vacuumPipe',
    path: [{ col: 7, row: 8 }, { col: 9, row: 8 }], attachments: [],
  });
  const farGround = gridToIso(8, 8);
  const picked = input._snapAttachmentToUtilityLine(
    'piraniGauge', farGround.x, farGround.y, 200, 120,
  );
  assert(picked?.line.id === line.id
      && Math.abs(picked.proj.worldX - 6.4) < 1e-9
      && picked.proj.worldZ === 4,
    'visible elevated pipe geometry selects the exact section under the cursor');
}

console.log('\n=== 4. A palette-tool click mounts the gauge at the cursor ===\n');
{
  const game = new Game(new BeamlineRegistry());
  game.sandboxMode = false;
  game.state.resources.funding = 5_000_000;
  const line = {
    id: 'ul_click', utilityType: 'vacuumPipe',
    path: [{ col: 1, row: 2 }, { col: 5, row: 2 }], attachments: [],
    start: null, end: null,
  };
  game.state.utilityLines.set(line.id, line);

  const cursor = gridToIso(3.2, 2.12);
  const renderer = { screenToWorld: () => cursor };
  const input = Object.create(InputHandler.prototype);
  input.game = game;
  input.renderer = renderer;
  input.placementDir = 0;
  input.selectedParamOverrides = null;

  const tool = new BeamlineTool('piraniGauge');
  const consumed = tool.onClick(
    { clientX: 20, clientY: 30 },
    { input, game, renderer },
  );
  const mounted = line.attachments[0];
  const pose = mounted && utilityAttachmentPose(line, mounted);
  assert(consumed === true && mounted?.type === 'piraniGauge',
    'the normal palette tool consumes a click and creates a line attachment');
  assert(Math.abs(pose?.worldX - 6.4) < 1e-9 && Math.abs(pose?.worldZ - 4) < 1e-9,
    'the committed gauge lands at the arbitrary cursor projection, not a path vertex');

  game.undo();
  assert(game.state.utilityLines.get('ul_click')?.attachments?.length === 0,
    'the click is one undoable placement gesture');
}

console.log('\n=== 5. Gauges mount, render, save, wire, and refund as line equipment ===\n');
{
  const game = new Game(new BeamlineRegistry());
  game.sandboxMode = false;
  game.state.resources.funding = 5_000_000;
  const vacuumLine = {
    id: 'ul_vac', utilityType: 'vacuumPipe',
    path: [{ col: 1, row: 2 }, { col: 5, row: 2 }],
    routeHeightMeters: 1.14,
    start: null, end: null,
  };
  game.state.utilityLines.set(vacuumLine.id, vacuumLine);

  const before = game.state.resources.funding;
  const id = game.addUtilityAttachment('ul_vac', 'coldCathodeGauge', 0.25);
  assert(!!id && vacuumLine.attachments?.[0]?.id === id,
    'a compatible gauge is stored on its vacuum line');
  assert(game.state.resources.funding === before - COMPONENTS.coldCathodeGauge.cost.funding,
    'mounting charges the instrument cost once');

  const endpoint = findUtilityEndpoint(game.state, id);
  const expectedPose = utilityAttachmentPose(vacuumLine, 0.25);
  assert(endpoint?.isUtilityAttachment === true,
    'line-mounted gauge participates in utility endpoint discovery');
  assert(endpoint.worldX === expectedPose.worldX && endpoint.worldZ === expectedPose.worldZ,
    'endpoint coordinates match the exact point on the utility run');
  assert(!!portWorldPosition(endpoint, COMPONENTS.coldCathodeGauge, 'pwr_in'),
    'powered gauges expose a connectable power plug at the mounted position');
  assert(listUtilityEndpoints(game.state).some(e => e.id === id),
    'the flattened endpoint list includes the gauge');

  const snap = buildWorldSnapshot(game, { only: ['pipeAttachments'] });
  const rendered = snap.pipeAttachments.find(a => a.id === id);
  assert(rendered?.utilityLineId === 'ul_vac',
    'renderer snapshot identifies the owning utility run');
  assert(Math.abs(rendered.yOffset - (utilityLineHeight('vacuumPipe') - 1)) < 1e-9,
    'gauge mounting spool follows the fixed vacuum service datum');

  const afterFirst = game.state.resources.funding;
  const idCounterBeforeOverlap = game.state.placementNextId;
  const overlap = game.addUtilityAttachment('ul_vac', 'piraniGauge', 0.255);
  assert(overlap === null && game.state.resources.funding === afterFirst,
    'overlapping instruments are refused without charging');
  assert(game.state.placementNextId === idCounterBeforeOverlap,
    'a refused mount is a true undo-safe no-op and does not consume an id');

  const save = JSON.parse(game.serialize());
  const savedLine = save.state.utilityLines.find(([lineId]) => lineId === 'ul_vac')?.[1];
  assert(savedLine?.attachments?.[0]?.id === id,
    'nested line instruments survive serialization');
  assert(savedLine?.routeHeightMeters === vacuumLine.routeHeightMeters
      && utilityLineHeight('vacuumPipe', savedLine.routeHeightMeters)
        === utilityLineHeight('vacuumPipe'),
    'legacy saved elevations survive harmlessly but cannot override the fixed datum');

  game.state.utilityLines.set('ul_power', {
    id: 'ul_power', utilityType: 'powerCable', path: [{ col: 2, row: 2 }, { col: 2, row: 3 }],
    start: { placeableId: id, portName: 'pwr_in' }, end: null,
  });
  const paid = COMPONENTS.coldCathodeGauge.cost.funding;
  const fundsBeforeRemove = game.state.resources.funding;
  assert(game.removeUtilityAttachment('ul_vac', id), 'mounted gauge can be demolished');
  assert(game.state.resources.funding === fundsBeforeRemove + Math.floor(paid * 0.5),
    'demolition returns the standard 50% refund');
  assert(game.state.utilityLines.get('ul_power').start === null,
    'removing the gauge safely dangles its connected power cable');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
