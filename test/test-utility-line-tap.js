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

function ctrlFor(game) {
  const c = new UtilityLineInputController({ game, renderer: {} });
  c.setUtilityType('coolingWater');
  return c;
}

function drag(game, from, to) {
  const ctrl = ctrlFor(game);
  const a = gridToIso(from.col, from.row);
  const b = gridToIso(to.col, to.row);
  ctrl.onMouseDown(a.x, a.y, 0, {});
  ctrl.onMouseMove((a.x + b.x) / 2, (a.y + b.y) / 2, {});
  ctrl.onMouseMove(b.x, b.y, {});
  ctrl.onMouseUp(b.x, b.y, 0, {});
  return ctrl;
}

function coolingLines(game) {
  return Array.from(game.state.utilityLines.values())
    .filter(l => l.utilityType === 'coolingWater');
}

// The trunk every case here branches off: chiller → the first quad.
function withTrunk() {
  const game = makeGame();
  drag(game, portTile(game, 'src_1', 'cool_out_a'), portTile(game, 'pl_1', 'cool_in'));
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

const trunkMid = (trunk) => longestSegment(trunk.path).mid;

console.log('\n--- 1. The cursor can grab a line, and ports still win ---');
{
  const { game, trunk } = withTrunk();
  assert(!!trunk, 'a trunk to branch off');
  const ctrl = ctrlFor(game);
  // A point on the trunk, well away from either of its ports.
  const mid = trunkMid(trunk);
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

console.log('\n--- 2. A drag onto the trunk commits, and joins its network ---');
{
  const { game, trunk } = withTrunk();
  const mid = trunkMid(trunk);
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
  assert(keys.includes('src_1') && keys.includes('pl_1') && keys.includes('pl_2'),
    `the source now feeds both quads (${keys.join(',')})`);
}

console.log('\n--- 3. The exemption is exactly one point wide ---');
{
  const { game, trunk } = withTrunk();
  // Work off the trunk's longest segment, so "along it" and "away from it" are
  // both a full tile of cable rather than one sub-unit.
  const seg = longestSegment(trunk.path);
  assert(seg && seg.len >= 1, `the trunk has a segment to run along (${seg && seg.len})`);
  const mid = seg.mid;
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
  const mid = trunkMid(trunk);
  const iso = gridToIso(mid.col, mid.row);
  const ctrl = new UtilityLineInputController({ game, renderer: {} });
  ctrl.setUtilityType('powerCable');
  ctrl.onHover(iso.x, iso.y);
  assert(!ctrl.hoverPort || !ctrl.hoverPort.tap,
    'a power-cable drag does not offer to tap a cooling-water line');
}

console.log('\n--- 5. LCW skid outlets share one 25 kW internal header ---');
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
  assert(skidSources.length === 3 && capacity === 25,
    `the shared outlets expose 25 kW once, not per socket (got ${capacity} kW)`);
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
