// test/test-utility-line-tap.js — branching off an existing line.
//
// Network discovery has always merged lines that share a subtile (the spatial
// union pass), so T-joins were fully supported by the sim and simply
// unreachable from input: the drag only snapped to ports, and a drag that
// ended on a trunk was rejected for overlapping it. Every branch therefore had
// to be drawn all the way back to the source, which is why a wired facility
// looked like a starburst.
//
// A tap is an OPEN end that lands on another line's subtile. The one thing it
// changes in validation is a single-point overlap exemption, so the tests that
// matter are the ones proving that exemption stays one point wide.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { UtilityLineInputController } from '../src/input/UtilityLineInputController.js';
import { validateDrawLine } from '../src/utility/line-drawing.js';
import { discoverNetworks, makeDefaultPortLookup } from '../src/utility/network-discovery.js';
import { gridToIso } from '../src/renderer/grid.js';
import { portWorldPosition } from '../src/utility/ports.js';
import { findUtilityEndpoint } from '../src/utility/utility-endpoints.js';
import { roundedCableTilePath } from '../src/utility/soft-cable.js';
import { expandPath } from '../src/utility/line-geometry.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// A package chiller north of a pipe carrying four quadrupoles — the same shape as
// the run-wiring fixture, so the two gestures are compared on one world.
function makeGame() {
  const g = new Game(new BeamlineRegistry(), { seed: 11 });
  g.state.resources.funding = 1e9;
  g.state.placeables.push({
    id: 'src_1', type: 'packageChiller', kind: 'infrastructure',
    category: 'infrastructure', col: 1, row: 1, subCol: 0, subRow: 0, dir: 0,
  });
  g.state.beamPipes.push({
    id: 'bp_1', subL: 80, start: null, end: null,
    path: [{ col: 0, row: 5 }, { col: 20, row: 5 }],
    placements: [0.1, 0.3, 0.5, 0.7].map((position, i) => ({
      id: `pl_${i + 1}`, type: 'quadrupole', position, subL: 2, params: {},
    })),
  });
  g._logs = [];
  g.log = (m, kind) => g._logs.push(`[${kind}] ${m}`);
  if (g.utilityLineSystem) g.utilityLineSystem.log = g.log;
  return g;
}

function portTile(game, id, portName) {
  const ep = findUtilityEndpoint(game.state, id);
  const p = portWorldPosition(ep, COMPONENTS[ep.type], portName);
  return { col: p.x / 2, row: p.z / 2 };
}

function ctrlFor(game, utilityType = 'coolingWater') {
  const c = new UtilityLineInputController({ game, renderer: {} });
  c.setUtilityType(utilityType);
  return c;
}

function drag(game, from, to, utilityType = 'coolingWater') {
  const ctrl = ctrlFor(game, utilityType);
  const a = gridToIso(from.col, from.row);
  const b = gridToIso(to.col, to.row);
  ctrl.onMouseDown(a.x, a.y, 0, {});
  ctrl.onMouseMove((a.x + b.x) / 2, (a.y + b.y) / 2, {});
  ctrl.onMouseMove(b.x, b.y, {});
  ctrl.onMouseUp(b.x, b.y, 0, {});
  return ctrl;
}

function dataLines(game) {
  return Array.from(game.state.utilityLines.values())
    .filter(line => line.utilityType === 'dataFiber');
}

function coolingLines(game) {
  return Array.from(game.state.utilityLines.values())
    .filter(l => l.utilityType === 'coolingWater');
}

// The trunk every case here branches off: chiller → a cold distribution
// header. Keeping the backbone clear of the paired hot/cold ports on beamline
// equipment makes this a tap-selection fixture rather than a port-priority
// fixture (port priority is asserted separately below).
function withTrunk() {
  const game = makeGame();
  game.state.placeables.push({
    id: 'tap_header', type: 'coolingManifold', kind: 'infrastructure',
    category: 'infrastructure', col: 12, row: 1, subCol: 0, subRow: 0, dir: 0,
  });
  drag(game, portTile(game, 'src_1', 'cool_out_a'),
    portTile(game, 'tap_header', 'cold_1'));
  const trunk = coolingLines(game)[0];
  return { game, trunk };
}

// The longest segment of a run, and its midpoint. Every case here wants "a
// point on the trunk well away from either of its ports", and the middle
// WAYPOINT is not that: a route's waypoint list is corners only, and its
// corners cluster wherever the ports made it turn. Taking the middle of its
// longest leg says what the tests actually mean, whatever shape the router
// picked.
function longestSegment(path) {
  let best = null;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const len = Math.abs(b.col - a.col) + Math.abs(b.row - a.row);
    if (best && len <= best.len) continue;
    best = {
      len,
      mid: { col: (a.col + b.col) / 2, row: (a.row + b.row) / 2 },
      axis: Math.abs(b.col - a.col) > Math.abs(b.row - a.row)
        ? { col: 1, row: 0 } : { col: 0, row: 1 },
    };
  }
  return best;
}

const trunkMid = (trunk) => {
  const visible = trunk.cablePath?.length >= 2
    ? trunk.cablePath
    : expandPath(trunk.path || []);
  return longestSegment(visible).mid;
};

function hittableTrunkPoint(game, trunk, ctrl = ctrlFor(game)) {
  const visible = trunk.cablePath?.length >= 2
    ? trunk.cablePath : expandPath(trunk.path || []);
  for (let i = 0; i < visible.length - 1; i++) {
    const a = visible[i], b = visible[i + 1];
    for (const t of [0.5, 0.25, 0.75]) {
      const point = {
        col: a.col + (b.col - a.col) * t,
        row: a.row + (b.row - a.row) * t,
      };
      const iso = gridToIso(point.col, point.row);
      ctrl.onHover(iso.x, iso.y);
      if (ctrl.hoverPort?.tap && ctrl.hoverPort.lineId === trunk.id) return point;
    }
  }
  return trunkMid(trunk);
}

console.log('\n--- 1. The cursor can grab a line, and ports still win ---');
{
  const { game, trunk } = withTrunk();
  assert(!!trunk, 'a trunk to branch off');
  const ctrl = ctrlFor(game);
  // A point on the trunk, well away from either of its ports.
  const mid = hittableTrunkPoint(game, trunk, ctrl);
  const iso = gridToIso(mid.col, mid.row);
  ctrl.onHover(iso.x, iso.y);
  const hov = ctrl.hoverPort;
  assert(hov && hov.tap === true && hov.lineId === trunk.id,
    `hovering the trunk offers a tap on it (${hov ? (hov.tap ? hov.lineId : 'port') : 'nothing'})`);

  // ...but a port under the cursor still wins, even though the trunk ends there.
  const portPt = portTile(game, 'pl_2', 'cool_in');
  const pIso = gridToIso(portPt.col, portPt.row);
  ctrl.onHover(pIso.x, pIso.y);
  assert(ctrl.hoverPort && !ctrl.hoverPort.tap && ctrl.hoverPort.placeableId === 'pl_2',
    'a port under the cursor still wins over a nearby line');
}

console.log('\n--- 1b. A rigid run is one continuous, forgiving magnetic target ---');
{
  const game = makeGame();
  const lineId = game.utilityLineSystem.addLine({
    utilityType: 'rfWaveguide', start: null, end: null,
    path: [{ col: 2, row: 12 }, { col: 12, row: 12 }],
  });
  const ctrl = new UtilityLineInputController({ game, renderer: {} });
  ctrl.setUtilityType('rfWaveguide');

  // This is 0.55 tiles off the guide: outside the old 0.4-tile pickup, but
  // still close enough to read as aiming at a thick fabricated service.
  const iso = gridToIso(7.37, 12.55);
  ctrl.onHover(iso.x, iso.y);
  const hover = ctrl.hoverPort;
  assert(hover?.tap === true && hover.lineId === lineId,
    'the full RF segment attracts a nearby free-drag endpoint');
  assert(hover && Math.abs(hover.worldPos.x / 2 - 7.25) < 1e-9
      && Math.abs(hover.worldPos.z / 2 - 12) < 1e-9,
    `the contact projects onto the quarter-tile topology grid (${JSON.stringify(
      hover?.worldPos)})`);
}

console.log('\n--- 1c. Water runs use a tighter pickup halo than data cable ---');
{
  const game = makeGame();
  for (const [utilityType, row] of [
    ['coolingWater', 14],
    ['waterSupplyPipe', 16],
  ]) {
    const lineId = game.utilityLineSystem.addLine({
      utilityType, start: null, end: null,
      path: [{ col: 2, row }, { col: 12, row }],
    });
    const ctrl = ctrlFor(game, utilityType);

    let iso = gridToIso(7.25, row + 0.25);
    ctrl.onHover(iso.x, iso.y);
    assert(ctrl.hoverPort?.tap === true && ctrl.hoverPort.lineId === lineId,
      `${utilityType} still attracts a deliberately close endpoint`);

    iso = gridToIso(7.25, row + 0.4);
    ctrl.onHover(iso.x, iso.y);
    assert(!ctrl.hoverPort,
      `${utilityType} leaves a nearby parallel routing lane unsnapped`);
  }

  const dataLineId = game.utilityLineSystem.addLine({
    utilityType: 'dataFiber', start: null, end: null,
    path: [{ col: 2, row: 18 }, { col: 12, row: 18 }],
  });
  const dataCtrl = ctrlFor(game, 'dataFiber');
  const dataIso = gridToIso(7.25, 18.55);
  dataCtrl.onHover(dataIso.x, dataIso.y);
  assert(dataCtrl.hoverPort?.tap === true && dataCtrl.hoverPort.lineId === dataLineId,
    'data cable retains the shared forgiving pickup halo');
}

console.log('\n--- 1d. A broad cryo jacket gets a cryo-specific pickup halo ---');
{
  const game = makeGame();
  const lineId = game.utilityLineSystem.addLine({
    utilityType: 'cryoTransfer', start: null, end: null,
    path: [{ col: 2, row: 16 }, { col: 12, row: 16 }],
  });
  const ctrl = new UtilityLineInputController({ game, renderer: {} });
  ctrl.setUtilityType('cryoTransfer');

  // Farther than the shared 0.65-tile halo, but still visually aimed at the
  // much broader vacuum-jacketed service. The saved join itself remains on
  // the trunk's quarter-tile topology point.
  const iso = gridToIso(7.37, 16.8);
  ctrl.onHover(iso.x, iso.y);
  const hover = ctrl.hoverPort;
  assert(hover?.tap === true && hover.lineId === lineId,
    'a nearby cryo endpoint is pulled onto the existing transfer line');
  assert(hover && Math.abs(hover.worldPos.x / 2 - 7.25) < 1e-9
      && Math.abs(hover.worldPos.z / 2 - 16) < 1e-9,
    `the generous hover still commits an exact on-line contact (${JSON.stringify(
      hover?.worldPos)})`);
}

console.log('\n--- 1e. Stacked water headers snap to the requested circuit ---');
{
  const game = makeGame();
  game.state.utilityLines.set('cold-header', {
    id: 'cold-header', utilityType: 'waterSupplyPipe', waterCircuit: 'cold',
    start: null, end: null,
    routeHeightMeters: 0.6,
    path: [{ col: 5, row: 5 }, { col: 10, row: 5 }],
  });
  game.state.utilityLines.set('hot-header', {
    id: 'hot-header', utilityType: 'waterSupplyPipe', waterCircuit: 'hot',
    start: null, end: null,
    routeHeightMeters: 0.9,
    path: [{ col: 5, row: 5 }, { col: 10, row: 5 }],
  });
  const ctrl = ctrlFor(game, 'waterSupplyPipe');
  const cursor = gridToIso(7.5, 5);
  const cold = ctrl.nearestLine(cursor.x, cursor.y, 0.65, null, 'cold');
  const hot = ctrl.nearestLine(cursor.x, cursor.y, 0.65, null, 'hot');
  assert(cold?.lineId === 'cold-header' && hot?.lineId === 'hot-header',
    'a stacked header tap resolves by circuit instead of insertion order or height');

  const renderer = {
    raycastUtilityLine: () => ({
      lineId: 'hot-header', utilityType: 'waterSupplyPipe',
    }),
    screenToWorldAtHeight: () => cursor,
  };
  const hitCtrl = new UtilityLineInputController({ game, renderer });
  hitCtrl.setUtilityType('waterSupplyPipe');
  const hotTap = hitCtrl._snapToNearest(cursor.x, cursor.y, { x: 100, y: 100 });
  assert(hotTap?.lineId === 'hot-header' && hotTap.waterCircuit === 'hot',
    'a mesh-selected stacked pipe carries its temperature circuit into the new draw');
}

console.log('\n--- 2. A drag onto the trunk commits, and joins its network ---');
{
  const { game, trunk } = withTrunk();
  const mid = hittableTrunkPoint(game, trunk);
  const before = coolingLines(game).length;

  drag(game, portTile(game, 'pl_2', 'cool_in'), { col: mid.col, row: mid.row });

  const lines = coolingLines(game);
  assert(lines.length === before + 1,
    `the branch committed (got ${lines.length - before}`
    + `${game._logs.length ? ' — ' + game._logs.join(' | ') : ''})`);

  const branch = lines.find(l => l.id !== trunk.id);
  assert(branch && branch.start && branch.start.placeableId === 'pl_2',
    'anchored on the component at the far end');
  assert(branch && branch.end === null,
    'and open at the tap end — a tap is a join, not an endpoint reference');

  const nets = discoverNetworks('coolingWater', game.state.utilityLines,
    makeDefaultPortLookup(game.state));
  const withBoth = nets.filter(n => n.lineIds.includes(trunk.id) && n.lineIds.includes(branch.id));
  assert(withBoth.length === 1,
    `trunk and branch solve as ONE network (got ${withBoth.length})`);
  const keys = withBoth[0] ? withBoth[0].ports.map(p => p.placeableId) : [];
  assert(keys.includes('src_1') && keys.includes('tap_header') && keys.includes('pl_2'),
    `the source, header, and branch load share one network (${keys.join(',')})`);
}

console.log('\n--- 2b. Flexible data cables retain peer-bus taps ---');
{
  const game = new Game(new BeamlineRegistry(), { seed: 12 });
  game.state.resources.funding = 1e9;
  game.state.placeables.push(
    { id: 'gateway', type: 'serverRack', col: 2, row: 2, subCol: 0, subRow: 0, dir: 0 },
    { id: 'display', type: 'monitorBank', col: 10, row: 2, subCol: 0, subRow: 0, dir: 0 },
    { id: 'console', type: 'operatorConsole', col: 6, row: 8, subCol: 0, subRow: 0, dir: 0 },
  );

  drag(
    game,
    portTile(game, 'gateway', 'data_out'),
    portTile(game, 'display', 'data_in'),
    'dataFiber',
  );
  const trunk = dataLines(game)[0];
  assert(trunk?.cablePath?.length >= 2,
    'the committed data trunk stores the freehand flexible route');

  const mid = longestSegment(
    roundedCableTilePath(trunk.cablePath, trunk.utilityType),
  ).mid;
  const tapController = ctrlFor(game, 'dataFiber');
  const tapIso = gridToIso(mid.col, mid.row);
  tapController.onHover(tapIso.x, tapIso.y);
  assert(tapController.hoverPort?.tap === true
      && tapController.hoverPort.lineId === trunk.id,
    `the visible data cable offers a trunk tap (${JSON.stringify(tapController.hoverPort)})`);
  drag(game, portTile(game, 'console', 'data_in'), mid, 'dataFiber');
  const branch = dataLines(game).find(line => line.id !== trunk.id);
  assert([branch?.tapLineIds?.start, branch?.tapLineIds?.end].includes(trunk.id),
    `the flexible branch persists a named tap onto the data trunk (${JSON.stringify(
      branch?.tapLineIds)})`);

  const networks = discoverNetworks(
    'dataFiber', game.state.utilityLines, makeDefaultPortLookup(game.state));
  const peerIds = new Set(networks[0]?.ports.map(port => port.placeableId));
  assert(networks.length === 1
      && ['gateway', 'display', 'console'].every(id => peerIds.has(id)),
    `the tapped cables form one three-device peer network (${[...peerIds].join(',')})`);
}

console.log('\n--- 3. The exemption is exactly one point wide ---');
{
  const { game, trunk } = withTrunk();
  // Work off the trunk's longest segment, so "along it" and "away from it" are
  // both a full tile of cable rather than one sub-unit.
  const seg = longestSegment(trunk.path);
  assert(seg && seg.len >= 1, `the trunk has a segment to run along (${seg && seg.len})`);
  const mid = {
    col: Math.round(seg.mid.col * 4) / 4,
    row: Math.round(seg.mid.row * 4) / 4,
  };
  const perp = { col: seg.axis.row, row: seg.axis.col };

  // A path that RUNS ALONG the trunk and ends on it. Overlap must still
  // reject: a tap is a T-join at a point, not a licence to lay cable down an
  // existing run.
  {
    const along = [
      { col: mid.col, row: mid.row },
      { col: mid.col + seg.axis.col, row: mid.row + seg.axis.row },
    ];
    const res = validateDrawLine(game.state, {
      utilityType: 'coolingWater', start: null, end: null, path: along,
      tapLineIds: { start: trunk.id, end: trunk.id },
    });
    assert(!res.ok && res.reason === 'overlap_same_type',
      `running along the trunk still rejects (got ${res.ok ? 'ok' : res.reason})`);
  }

  // And the exemption does not extend to OTHER lines: naming line A does not
  // license overlapping line B.
  const branchPath = [
    { col: mid.col, row: mid.row },
    { col: mid.col + perp.col * 2, row: mid.row + perp.row * 2 },
  ];
  const okTap = validateDrawLine(game.state, {
    utilityType: 'coolingWater', start: null, end: null, path: branchPath,
    tapLineIds: { start: trunk.id, end: null },
  });
  assert(okTap.ok, `a clean tap validates (got ${okTap.ok ? 'ok' : okTap.reason})`);
  const noTap = validateDrawLine(game.state, {
    utilityType: 'coolingWater', start: null, end: null, path: branchPath,
  });
  assert(!noTap.ok && noTap.reason === 'overlap_same_type',
    `the same path without the tap is refused (got ${noTap.ok ? 'ok' : noTap.reason})`);
  const wrongLine = validateDrawLine(game.state, {
    utilityType: 'coolingWater', start: null, end: null, path: branchPath,
    tapLineIds: { start: 'ul_does_not_exist', end: null },
  });
  assert(!wrongLine.ok,
    `naming a different line does not license the overlap (got ${wrongLine.ok ? 'ok' : wrongLine.reason})`);
}

console.log('\n--- 4. A line of another utility is not tappable ---');
{
  const { game, trunk } = withTrunk();
  const mid = hittableTrunkPoint(game, trunk);
  const iso = gridToIso(mid.col, mid.row);
  const ctrl = new UtilityLineInputController({ game, renderer: {} });
  ctrl.setUtilityType('powerCable');
  ctrl.onHover(iso.x, iso.y);
  assert(!ctrl.hoverPort || !ctrl.hoverPort.tap,
    'a power-cable drag does not offer to tap a cooling-water line');
}

console.log('\n--- 5. LCW skid connections share one 25 kW internal header ---');
{
  const state = {
    placeables: [
      { id: 'lcw_1', type: 'lcwSkid', col: 1, row: 1, subCol: 0, subRow: 0, dir: 0 },
      { id: 'load_1', type: 'source', col: 6, row: 1, subCol: 0, subRow: 0, dir: 0 },
      { id: 'load_2', type: 'source', col: 6, row: 4, subCol: 0, subRow: 0, dir: 0 },
      { id: 'load_3', type: 'source', col: 6, row: 7, subCol: 0, subRow: 0, dir: 0 },
    ],
    beamPipes: [],
    utilityLines: new Map([
      ['lcw_a', { id: 'lcw_a', utilityType: 'coolingWater',
        start: { placeableId: 'lcw_1', portName: 'cool_out' },
        end: { placeableId: 'load_1', portName: 'cool_in' },
        path: [{ col: 2, row: 1 }, { col: 5, row: 1 }] }],
      ['lcw_b', { id: 'lcw_b', utilityType: 'coolingWater',
        start: { placeableId: 'lcw_1', portName: 'cool_out_2' },
        end: { placeableId: 'load_2', portName: 'cool_in' },
        path: [{ col: 2, row: 2 }, { col: 5, row: 4 }] }],
      ['lcw_c', { id: 'lcw_c', utilityType: 'coolingWater',
        start: { placeableId: 'lcw_1', portName: 'cool_out_3' },
        end: { placeableId: 'load_3', portName: 'cool_in' },
        path: [{ col: 2, row: 3 }, { col: 5, row: 7 }] }],
    ]),
  };
  const nets = discoverNetworks(
    'coolingWater', state.utilityLines, makeDefaultPortLookup(state),
  );
  assert(nets.length === 1 && nets[0].sinks.length === 3,
    'three physical LCW outlets feed three loads through one network');
  const skidSources = nets[0]?.sources.filter(source => source.placeableId === 'lcw_1') || [];
  const capacity = skidSources.reduce((sum, source) => sum + (source.params?.capacity || 0), 0);
  assert(skidSources.length === 4 && Math.abs(capacity - 25) < 1e-9,
    `the shared outlets expose 25 kW once, not per socket (got ${capacity} kW)`);
}

console.log('\n--- 6. Vacuum pipes join pipe-to-pipe at arbitrary mid-span points ---');
{
  const game = makeGame();
  const upperId = game.utilityLineSystem.addLine({
    utilityType: 'vacuumPipe', start: null, end: null,
    path: [{ col: 10, row: 12 }, { col: 20, row: 12 }],
  });
  const lowerId = game.utilityLineSystem.addLine({
    utilityType: 'vacuumPipe', start: null, end: null,
    path: [{ col: 10, row: 18 }, { col: 20, row: 18 }],
  });
  assert(upperId && lowerId, 'two separate vacuum trunks to join');

  const ctrl = new UtilityLineInputController({ game, renderer: {} });
  ctrl.setUtilityType('vacuumPipe');
  const a = gridToIso(14.5, 12);
  const b = gridToIso(14.5, 18);
  ctrl.onMouseDown(a.x, a.y, 0, {});
  ctrl.onMouseMove(b.x, b.y, {});
  ctrl.onMouseUp(b.x, b.y, 0, {});

  const vacuumLines = Array.from(game.state.utilityLines.values())
    .filter(line => line.utilityType === 'vacuumPipe');
  const connector = vacuumLines.find(line => line.id !== upperId && line.id !== lowerId);
  assert(connector?.tapLineIds?.start === upperId
    && connector?.tapLineIds?.end === lowerId,
  'one drag joins the middles of both existing vacuum pipes');

  const networks = discoverNetworks('vacuumPipe', game.state.utilityLines,
    makeDefaultPortLookup(game.state));
  assert(networks.some(network => network.lineIds.includes(upperId)
    && network.lineIds.includes(lowerId) && network.lineIds.includes(connector?.id)),
  `both trunks and their connector become one vacuum network (${JSON.stringify(
    networks.map(network => network.lineIds))})`);
}

console.log('\n--- 7. Cooling, RF and cryogenic runs build named line-to-line tees ---');
{
  for (const utilityType of ['coolingWater', 'rfWaveguide', 'cryoTransfer']) {
    const game = makeGame();
    const upperId = game.utilityLineSystem.addLine({
      utilityType, start: null, end: null,
      path: [{ col: 10, row: 22 }, { col: 20, row: 22 }],
    });
    const lowerId = game.utilityLineSystem.addLine({
      utilityType, start: null, end: null,
      path: [{ col: 10, row: 28 }, { col: 20, row: 28 }],
    });
    const ctrl = new UtilityLineInputController({ game, renderer: {} });
    ctrl.setUtilityType(utilityType);
    const a = gridToIso(15.37, 22.2);
    const b = gridToIso(15.37, 27.8);
    ctrl.onMouseDown(a.x, a.y, 0, {});
    ctrl.onMouseMove(b.x, b.y, {});
    ctrl.onMouseUp(b.x, b.y, 0, {});

    const lines = Array.from(game.state.utilityLines.values())
      .filter(line => line.utilityType === utilityType);
    const connector = lines.find(line => line.id !== upperId && line.id !== lowerId);
    assert(connector?.tapLineIds?.start === upperId
        && connector?.tapLineIds?.end === lowerId,
      `${utilityType} free-drag persists both named tee contacts`);
    const networks = discoverNetworks(
      utilityType, game.state.utilityLines, makeDefaultPortLookup(game.state));
    assert(networks.some(network => [upperId, lowerId, connector?.id]
      .every(id => network.lineIds.includes(id))),
    `${utilityType} joins both trunks into one solved network`);
  }
}

console.log('\n--- 8. Electrical lines still require distribution hardware ---');
{
  for (const utilityType of ['powerCable', 'hvCable']) {
    const game = makeGame();
    game.utilityLineSystem.addLine({
      utilityType, start: null, end: null,
      path: [{ col: 10, row: 34 }, { col: 20, row: 34 }],
    });
    const ctrl = new UtilityLineInputController({ game, renderer: {} });
    ctrl.setUtilityType(utilityType);
    const iso = gridToIso(15, 34);
    ctrl.onHover(iso.x, iso.y);
    assert(!ctrl.hoverPort?.tap,
      `${utilityType} does not expose an improvised line-to-line tee`);
  }
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
