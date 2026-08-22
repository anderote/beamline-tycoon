// test/test-designer-move-reanchor.js — the two primitives downstream
// displacement runs on: BeamlineSystem.moveJunction (via Game.movePlaceable)
// and UtilityLineSystem.reanchorLine.
//
// The point of a move primitive is that the placeable's ID SURVIVES. Utility
// lines, beam-pipe start/end refs and the beamline registry all anchor to the
// id, so a "make room for this module" edit implemented as remove-then-place
// would silently unwire the machine it was rearranging.
//
// Part A — moveJunction, against a real Game so the sub-grid occupancy path
// is the real one:
//   A1. id survives; pose updated; old cells freed, new cells claimed.
//   A2. a move that overlaps its OWN old footprint is allowed (self-cells are
//       not collisions).
//   A3. no money changes hands in either direction.
//   A4. state.beamPipes is not touched.
//   A5. utility lines keep pointing at the placeable (no onPlaceableRemoved).
//   A6. refusal onto an occupied destination leaves EVERYTHING untouched and
//       emits nothing.
//   A7. destination tiles are flattened; dir is preserved when omitted and
//       applied when given.
//
// Part B — reanchorLine, against a fixture state so the geometry is exact:
//   B1. perpendicular slide keeps the line intact (path translated, endpoints
//       preserved) and emits utilityLinesChanged.
//   B2. a two-point line sliding along its own axis stays a straight run.
//   B3. a slide past the old terminal bend remains connected.
//   B4. a line anchored to the same placeable at BOTH ends moves both legs.
//   B5. a line with both ends on one moved placeable stays connected.
//   B6. an unrelated / unknown line is reported as not re-anchored, with no
//       mutation and no event.
//   B7. flexible lines have no move leash; fabricated rigid lines retain one.
//   B8. exact off-grid model anchors cannot make a flexible line disconnect.
//   B9. moving one end of a legacy zero-length line seeds visible geometry.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { PLACEABLES } from '../src/data/placeables/index.js';
import {
  UtilityLineSystem,
  utilityLineMoveStrainLimit,
} from '../src/utility/UtilityLineSystem.js';
import { getTileCorners } from '../src/game/terrain.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

// Game talks to localStorage; back it with a Map for Node.
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

// ---------------------------------------------------------------------------
// Part A helpers.
// ---------------------------------------------------------------------------

const JUNCTION = 'dipole'; // 2x2 sub-units: small enough to park two of them
                           // on neighbouring tiles of the starter map.

function makeGame(seed) {
  const g = new Game(new BeamlineRegistry(), { seed });
  g.state.resources.funding = 1e9;
  // Task 5 (staff-professions-3): a beamline junction now also costs spares
  // (ceil(fundingCost/5000), see Game._placePlaceableInner) — fund this the
  // same way funding above is, so this file's placements are gated only by
  // the things it's actually testing, not incidentally by the spares economy.
  g.state.resources.spares = 1e9;
  return g;
}

function cellKey(c) { return `${c.col},${c.row},${c.subCol},${c.subRow}`; }

/** First tile origin (subCol/subRow 0) where `type`'s footprint is clear. */
function findFreeTile(g, type, skip = 0) {
  const def = PLACEABLES[type];
  let seen = 0;
  for (let col = 6; col < 60; col++) {
    for (let row = 6; row < 60; row++) {
      const cells = def.footprintCells(col, row, 0, 0, 0);
      if (!cells.every(c => !g.state.subgridOccupied[cellKey(c)])) continue;
      // Keep candidates a whole tile apart so two of them can never share a
      // footprint cell regardless of sub-offsets.
      if (seen++ < skip) continue;
      return { col, row };
    }
  }
  throw new Error('no free tile found for ' + type);
}

function occupancySnapshot(g) {
  return JSON.stringify(g.state.subgridOccupied);
}

function poseOf(p) {
  return JSON.stringify({ col: p.col, row: p.row, subCol: p.subCol, subRow: p.subRow, dir: p.dir });
}

// ==========================================================================
// A1: id survives, pose updated, cells swapped.
// ==========================================================================
console.log('\n--- A1: moveJunction keeps the id and swaps its cells ---');
{
  const g = makeGame(11);
  const from = findFreeTile(g, JUNCTION, 0);
  const id = g.beamline.placeJunction({ type: JUNCTION, col: from.col, row: from.row, dir: 0 });
  assert(typeof id === 'string', `junction placed (got ${id})`);

  const oldCells = g.getPlaceable(id).cells.map(cellKey);
  const to = findFreeTile(g, JUNCTION, 3);
  const before = g.state.placeables.length;

  const ok = g.beamline.moveJunction(id, { col: to.col, row: to.row, subCol: 0, subRow: 0 });
  assert(ok === true, 'moveJunction returned true');

  const p = g.getPlaceable(id);
  assert(!!p, 'placeable still exists under the SAME id');
  assert(p.col === to.col && p.row === to.row, `pose updated (${p.col},${p.row})`);
  assert(g.state.placeables.length === before, 'no placeable created or destroyed');
  assert(g.state.placeableIndex[id] !== undefined, 'index still resolves the id');

  const stillClaimed = oldCells.filter(k => g.state.subgridOccupied[k]);
  assert(stillClaimed.length === 0, `old cells freed (${stillClaimed.length} left)`);
  const claimed = p.cells.every(c => {
    const occ = g.state.subgridOccupied[cellKey(c)];
    return occ && occ.id === id && occ.kind === 'beamline';
  });
  assert(claimed, 'new cells claimed with {id, kind}');
}

// ==========================================================================
// A2: a move overlapping its own old footprint is allowed.
// ==========================================================================
console.log('\n--- A2: self-overlapping slide is not a collision ---');
{
  const g = makeGame(12);
  const from = findFreeTile(g, JUNCTION, 0);
  const id = g.beamline.placeJunction({ type: JUNCTION, col: from.col, row: from.row, dir: 0 });
  // One sub-unit along: the new footprint shares half its cells with the old.
  const ok = g.beamline.moveJunction(id, {
    col: from.col, row: from.row, subCol: 1, subRow: 0,
  });
  assert(ok === true, 'one-sub-unit slide accepted');
  assert(g.getPlaceable(id).subCol === 1, 'subCol advanced to 1');
}

// ==========================================================================
// A3 / A4 / A5: no money, no pipes, no unwiring.
// ==========================================================================
console.log('\n--- A3-A5: a move is not a purchase, a pipe edit, or a rewire ---');
{
  const g = makeGame(13);
  const from = findFreeTile(g, JUNCTION, 0);
  const id = g.beamline.placeJunction({ type: JUNCTION, col: from.col, row: from.row, dir: 0 });

  // A pipe hanging off the junction, and a utility line wired to it. Both
  // anchor by id, which is exactly what the primitive has to preserve.
  // dipole's exit faces 'left' (west at dir 0), so the run leaves along -col.
  const pipeId = g.beamline.drawPipe(
    { junctionId: id, portName: 'exit' }, null,
    [{ col: from.col, row: from.row }, { col: from.col - 3, row: from.row }],
  );
  g.state.utilityLines.set('ul_test', {
    id: 'ul_test', utilityType: 'powerCable',
    start: { placeableId: id, portName: 'pwr_in' },
    end: null,
    path: [{ col: 0, row: 0 }, { col: 1, row: 0 }],
  });

  const fundingBefore = g.state.resources.funding;
  const pipesBefore = JSON.stringify(g.state.beamPipes);
  const to = findFreeTile(g, JUNCTION, 3);

  assert(g.beamline.moveJunction(id, { col: to.col, row: to.row }) === true, 'move applied');

  assert(g.state.resources.funding === fundingBefore,
    `funding unchanged (${fundingBefore} → ${g.state.resources.funding})`);
  assert(JSON.stringify(g.state.beamPipes) === pipesBefore, 'state.beamPipes untouched');
  const line = g.state.utilityLines.get('ul_test');
  assert(line && line.start && line.start.placeableId === id,
    'utility line still anchored to the moved placeable');
  assert(typeof pipeId === 'string', 'pipe existed to be left alone');
}

// ==========================================================================
// A6: refusal changes nothing at all.
// ==========================================================================
console.log('\n--- A6: refused move leaves state untouched ---');
{
  const g = makeGame(14);
  const a = findFreeTile(g, JUNCTION, 0);
  const idA = g.beamline.placeJunction({ type: JUNCTION, col: a.col, row: a.row, dir: 0 });
  const b = findFreeTile(g, JUNCTION, 3);
  const idB = g.beamline.placeJunction({ type: JUNCTION, col: b.col, row: b.row, dir: 0 });
  assert(typeof idB === 'string', 'second junction placed as the obstacle');

  const poseBefore = poseOf(g.getPlaceable(idA));
  const cellsBefore = JSON.stringify(g.getPlaceable(idA).cells);
  const occBefore = occupancySnapshot(g);
  const fundingBefore = g.state.resources.funding;

  const events = [];
  const unsub = g.on((ev) => events.push(ev));
  const ok = g.beamline.moveJunction(idA, { col: b.col, row: b.row, subCol: 0, subRow: 0 });
  unsub();

  assert(ok === false, 'move onto an occupied destination refused');
  assert(poseOf(g.getPlaceable(idA)) === poseBefore, 'pose untouched');
  assert(JSON.stringify(g.getPlaceable(idA).cells) === cellsBefore, 'cells untouched');
  assert(occupancySnapshot(g) === occBefore, 'subgridOccupied untouched');
  assert(g.state.resources.funding === fundingBefore, 'funding untouched');
  assert(!events.includes('placeableChanged') && !events.includes('beamlineChanged'),
    `no events emitted (got ${JSON.stringify(events)})`);

  // ...and a successful move DOES emit both.
  const events2 = [];
  const unsub2 = g.on((ev) => events2.push(ev));
  const c = findFreeTile(g, JUNCTION, 6);
  assert(g.beamline.moveJunction(idA, { col: c.col, row: c.row }) === true, 'legal move accepted');
  unsub2();
  assert(events2.includes('placeableChanged'), 'placeableChanged emitted');
  assert(events2.includes('beamlineChanged'), 'beamlineChanged emitted');

  // A junction that does not exist is a refusal, not a crash.
  assert(g.beamline.moveJunction('bl_nope', { col: c.col, row: c.row }) === false,
    'unknown id refused');
  assert(g.beamline.moveJunction(idA, { col: NaN, row: 3 }) === false,
    'non-finite destination refused');
}

// ==========================================================================
// A7: terrain flattening and dir handling.
// ==========================================================================
console.log('\n--- A7: destination is flattened; dir kept unless given ---');
{
  const g = makeGame(15);
  const from = findFreeTile(g, JUNCTION, 0);
  const id = g.beamline.placeJunction({ type: JUNCTION, col: from.col, row: from.row, dir: 2 });
  const to = findFreeTile(g, JUNCTION, 3);
  // Raise the destination so the flatten has something to do.
  g.state.cornerHeights.set(`${to.col},${to.row}`, Int8Array.from([3, 3, 3, 3]));

  assert(g.beamline.moveJunction(id, { col: to.col, row: to.row }) === true, 'move applied');
  const corners = getTileCorners(g.state, to.col, to.row);
  assert(corners.nw === 0 && corners.ne === 0 && corners.se === 0 && corners.sw === 0,
    `destination tile flattened (got ${JSON.stringify(corners)})`);
  assert(g.getPlaceable(id).dir === 2, 'dir preserved when the pose omits it');

  const to2 = findFreeTile(g, JUNCTION, 6);
  g.beamline.moveJunction(id, { col: to2.col, row: to2.row, dir: 1 });
  assert(g.getPlaceable(id).dir === 1, 'dir applied when the pose carries it');
}

// ---------------------------------------------------------------------------
// Part B: reanchorLine against a fixture state.
//
// Same shape as test-utility-line-system.js: two utility types are irrelevant
// here, what matters is that ports face a known direction so the validator's
// approach check is exercised for real.
// ---------------------------------------------------------------------------

const SRC_DEF = {
  subL: 2, subW: 2,
  ports: { powerOut: { side: 'right', utility: 'powerCable', role: 'source', params: { capacity: 100 } } },
};
const SINK_DEF = {
  subL: 2, subW: 2,
  ports: { powerIn: { side: 'left', utility: 'powerCable', role: 'sink', params: { demand: 50 } } },
};
// One placeable carrying both ends of a line: source on its east face, sink on
// its west face.
const LOOP_DEF = {
  subL: 2, subW: 2,
  ports: {
    powerOut: { side: 'right', utility: 'powerCable', role: 'source', params: { capacity: 100 } },
    powerIn:  { side: 'left',  utility: 'powerCable', role: 'sink',   params: { demand: 50 } },
  },
};

function fixture(utilityType = 'powerCable') {
  const sourceDef = {
    ...SRC_DEF,
    ports: {
      powerOut: { ...SRC_DEF.ports.powerOut, utility: utilityType },
    },
  };
  const sinkDef = {
    ...SINK_DEF,
    ports: {
      powerIn: { ...SINK_DEF.ports.powerIn, utility: utilityType },
    },
  };
  const loopDef = {
    ...LOOP_DEF,
    ports: {
      powerOut: { ...LOOP_DEF.ports.powerOut, utility: utilityType },
      powerIn: { ...LOOP_DEF.ports.powerIn, utility: utilityType },
    },
  };
  const state = {
    placeables: [
      { id: 'src1', type: 'source_rack', category: 'beamline', col: 2, row: 3, subCol: 0, subRow: 0, dir: 0 },
      { id: 'sink1', type: 'sink_rack', category: 'beamline', col: 8, row: 3, subCol: 0, subRow: 0, dir: 0 },
      { id: 'loop1', type: 'loop_rack', category: 'beamline', col: 2, row: 3, subCol: 0, subRow: 0, dir: 0 },
    ],
    utilityLines: new Map(),
    defs: { source_rack: sourceDef, sink_rack: sinkDef, loop_rack: loopDef },
  };
  const events = [];
  const system = new UtilityLineSystem({
    state,
    emit: (ev, data) => events.push({ ev, data }),
    log: () => {},
    nextLineId: () => 'ul_x',
  });
  return { system, state, events };
}

function addRaw(state, line) {
  state.utilityLines.set(line.id, line);
  return line;
}

// ==========================================================================
// B1: perpendicular slide keeps the line.
// ==========================================================================
console.log('\n--- B1: perpendicular slide keeps the line intact ---');
{
  const { system, state, events } = fixture();
  const line = addRaw(state, {
    id: 'l1', utilityType: 'powerCable',
    start: { placeableId: 'src1', portName: 'powerOut' },
    end: { placeableId: 'sink1', portName: 'powerIn' },
    // Leaves src1 east, bends south, arrives at sink1 heading east.
    path: [{ col: 3, row: 3 }, { col: 5, row: 3 }, { col: 5, row: 6 }, { col: 8, row: 6 }],
    cablePath: [
      { col: 3, row: 3 }, { col: 4, row: 4.5 },
      { col: 6, row: 5.5 }, { col: 8, row: 6 },
    ],
  });

  const res = system.reanchorLine('l1', 'src1', { powerOut: { col: 3, row: 5 } });
  assert(res.ok === true, `reanchor succeeded (${JSON.stringify(res)})`);
  assert(line.start && line.start.placeableId === 'src1', 'start endpoint preserved');
  assert(line.end && line.end.placeableId === 'sink1', 'end endpoint preserved');
  assert(line.path[0].col === 3 && line.path[0].row === 5, 'terminal moved to the new port');
  assert(line.path[1].col === 5 && line.path[1].row === 5, 'the bend rode along perpendicular');
  assert(line.path[3].col === 8 && line.path[3].row === 6, 'far end of the path untouched');
  assert(line.cablePath[0].col === 3 && line.cablePath[0].row === 5,
    'the flexible cable plug follows the moved source');
  assert(line.cablePath[1].row > 4.5
      && line.cablePath.at(-1).col === 8 && line.cablePath.at(-1).row === 6,
    'the cable middle is pulled with the moved plug while the opposite plug stays pinned');
  assert(typeof line.subL === 'number' && line.subL > 0, 'subL recomputed');
  const ev = events.find(e => e.ev === 'utilityLinesChanged');
  assert(ev && ev.data.utilityType === 'powerCable', 'utilityLinesChanged carries the type');
}

// ==========================================================================
// B2: two-point line sliding along its own axis.
// ==========================================================================
console.log('\n--- B2: straight two-point line slides along its axis ---');
{
  const { system, state } = fixture();
  const line = addRaw(state, {
    id: 'l2', utilityType: 'powerCable',
    start: { placeableId: 'src1', portName: 'powerOut' },
    end: { placeableId: 'sink1', portName: 'powerIn' },
    path: [{ col: 3, row: 3 }, { col: 8, row: 3 }],
  });

  const res = system.reanchorLine('l2', 'src1', { powerOut: { col: 4, row: 3 } });
  assert(res.ok === true, `reanchor succeeded (${JSON.stringify(res)})`);
  assert(line.path.length === 2, `still a straight run (${line.path.length} points)`);
  assert(line.path[0].col === 4 && line.path[0].row === 3, 'start slid to the new port');
  assert(line.path[1].col === 8, 'far terminal held');
}

// ==========================================================================
// B3: a slide past the original bend remains connected. Utility fittings no
// longer impose a one-way approach direction.
// ==========================================================================
console.log('\n--- B3: slide past the old bend stays connected ---');
{
  const { system, state, events } = fixture();
  const line = addRaw(state, {
    id: 'l3', utilityType: 'powerCable',
    start: { placeableId: 'src1', portName: 'powerOut' },
    end: { placeableId: 'sink1', portName: 'powerIn' },
    path: [{ col: 3, row: 3 }, { col: 5, row: 3 }, { col: 5, row: 6 }, { col: 8, row: 6 }],
  });
  const res = system.reanchorLine('l3', 'src1', { powerOut: { col: 6, row: 3 } });
  assert(res.ok === true, `reanchor succeeded (${JSON.stringify(res)})`);
  assert(line.start?.placeableId === 'src1', 'moved end remains connected');
  assert(line.end && line.end.placeableId === 'sink1', 'the other end is left alone');
  assert(line.path[0].col === 6 && line.path[0].row === 3, 'path terminal follows the moved fitting');
  assert(state.utilityLines.has('l3'), 'the line itself survives');
  const ev = events.find(e => e.ev === 'utilityLinesChanged');
  assert(ev && ev.data.utilityType === 'powerCable', 'utilityLinesChanged still emitted');
}

// ==========================================================================
// B4: both ends on the same placeable.
// ==========================================================================
console.log('\n--- B4: both ends on one placeable move together ---');
{
  const { system, state } = fixture();
  const line = addRaw(state, {
    id: 'l4', utilityType: 'powerCable',
    start: { placeableId: 'loop1', portName: 'powerOut' },
    end: { placeableId: 'loop1', portName: 'powerIn' },
    // Out the east face, around, back in through the west face heading east.
    path: [
      { col: 3, row: 3 }, { col: 5, row: 3 }, { col: 5, row: 0 },
      { col: 1, row: 0 }, { col: 1, row: 3 }, { col: 2, row: 3 },
    ],
  });

  const res = system.reanchorLine('l4', 'loop1', {
    powerOut: { col: 3, row: 5 },
    powerIn: { col: 2, row: 5 },
  });
  assert(res.ok === true, `both-ends reanchor succeeded (${JSON.stringify(res)})`);
  assert(line.start && line.end, 'both endpoints preserved');
  const p = line.path;
  assert(p[0].col === 3 && p[0].row === 5, 'start terminal moved');
  assert(p[p.length - 1].col === 2 && p[p.length - 1].row === 5, 'end terminal moved');
  assert(p[1].row === 5, 'start-side bend rode along');
  assert(p[p.length - 2].row === 5, 'end-side bend rode along');
}

// ==========================================================================
// B5: both ends remain connected even when the moved source crosses a bend.
// ==========================================================================
console.log('\n--- B5: both-ends reanchor stays connected ---');
{
  const { system, state } = fixture();
  const line = addRaw(state, {
    id: 'l5', utilityType: 'powerCable',
    start: { placeableId: 'loop1', portName: 'powerOut' },
    end: { placeableId: 'loop1', portName: 'powerIn' },
    path: [
      { col: 3, row: 3 }, { col: 5, row: 3 }, { col: 5, row: 0 },
      { col: 1, row: 0 }, { col: 1, row: 3 }, { col: 2, row: 3 },
    ],
  });

  const res = system.reanchorLine('l5', 'loop1', {
    powerOut: { col: 6, row: 3 },
    powerIn: { col: 2, row: 5 },
  });
  assert(res.ok === true, `both-ends reanchor succeeded (${JSON.stringify(res)})`);
  assert(line.start?.placeableId === 'loop1' && line.end?.placeableId === 'loop1', 'both endpoints remain connected');
  assert(line.path[0].col === 6 && line.path[0].row === 3, 'start terminal follows the moved fitting');
  assert(line.path.at(-1).col === 2 && line.path.at(-1).row === 5, 'end terminal follows the moved fitting');
}

// ==========================================================================
// B6: nothing to re-anchor.
// ==========================================================================
console.log('\n--- B6: unknown or unrelated lines are reported, not mutated ---');
{
  const { system, state, events } = fixture();
  const line = addRaw(state, {
    id: 'l6', utilityType: 'powerCable',
    start: { placeableId: 'src1', portName: 'powerOut' },
    end: { placeableId: 'sink1', portName: 'powerIn' },
    path: [{ col: 3, row: 3 }, { col: 8, row: 3 }],
  });

  const miss = system.reanchorLine('nope', 'src1', { powerOut: { col: 3, row: 5 } });
  assert(miss.ok === false && miss.dangled === false, `unknown line reported (${JSON.stringify(miss)})`);

  const other = system.reanchorLine('l6', 'somethingElse', { col: 3, row: 5 });
  assert(other.ok === false && other.dangled === false,
    `unrelated placeable reported (${JSON.stringify(other)})`);
  assert(line.start && line.end, 'endpoints untouched');
  assert(events.length === 0, `no events emitted (got ${events.length})`);
}

// ==========================================================================
// B7: flexible services never pop a plug during a move. Fabricated rigid
// services retain an installed-length leash.
// ==========================================================================
console.log('\n--- B7: flexible lines stay attached at any move distance ---');
{
  assert(utilityLineMoveStrainLimit('hvCable', 20) === Infinity,
    'HV cable has no move-time disconnect threshold');
  assert(utilityLineMoveStrainLimit('coolingWater', 20) === Infinity,
    'cooling-water hose has no move-time disconnect threshold');
  assert(utilityLineMoveStrainLimit('dataFiber', 20) === Infinity,
    'data fiber follows the same flexible-line contract');
  assert(utilityLineMoveStrainLimit('rfWaveguide', 20) < 24,
    'fabricated rigid services keep the conservative leash');
  const { system, state } = fixture();
  const line = addRaw(state, {
    id: 'l7', utilityType: 'powerCable', subL: 20,
    start: { placeableId: 'src1', portName: 'powerOut' },
    end: { placeableId: 'sink1', portName: 'powerIn' },
    path: [{ col: 3, row: 3 }, { col: 8, row: 3 }],
    cablePath: [{ col: 3, row: 3 }, { col: 8, row: 3 }],
  });
  const resilient = system.reanchorLine('l7', 'src1', {
    powerOut: { col: -8, row: 3 },
  });
  assert(resilient.ok === true && line.start?.placeableId === 'src1',
    `a rugged power lead stays attached through a long move (${JSON.stringify(resilient)})`);
  const res = system.reanchorLine('l7', 'src1', {
    powerOut: { col: -30, row: 3 },
  });
  assert(res.ok === true && res.dangled !== true,
    `an extreme flexible pull still commits (${JSON.stringify(res)})`);
  assert(line.start?.placeableId === 'src1' && line.end?.placeableId === 'sink1',
    'both flexible-line endpoint identities survive');
  assert(line.path[0].col === -30 && line.cablePath[0].col === -30,
    'the committed logical and visible traces follow the moved fitting');
  assert(line.subL > 20,
    'the committed flexible length grows to cover the visible moved trace');

  for (const utilityType of ['hvCable', 'coolingWater', 'dataFiber']) {
    const service = fixture(utilityType);
    const flexible = addRaw(service.state, {
      id: `l7_${utilityType}`, utilityType, subL: 20,
      start: { placeableId: 'src1', portName: 'powerOut' },
      end: { placeableId: 'sink1', portName: 'powerIn' },
      path: [{ col: 3, row: 3 }, { col: 8, row: 3 }],
      cablePath: [{ col: 3, row: 3 }, { col: 8, row: 3 }],
    });
    const moved = service.system.reanchorLine(flexible.id, 'src1', {
      powerOut: { col: -30, row: 3 },
    });
    assert(moved.ok === true && flexible.start?.placeableId === 'src1'
        && flexible.end?.placeableId === 'sink1',
    `${utilityType} preserves both endpoints through an extreme move`);
  }

  const rigid = addRaw(state, {
    id: 'l7_rigid', utilityType: 'rfWaveguide', subL: 20,
    start: { placeableId: 'src1', portName: 'powerOut' },
    end: { placeableId: 'sink1', portName: 'powerIn' },
    path: [{ col: 3, row: 3 }, { col: 8, row: 3 }],
  });
  const rigidRes = system.reanchorLine('l7_rigid', 'src1', {
    powerOut: { col: -30, row: 3 },
  });
  assert(rigidRes.dangled === true && rigidRes.reason === 'overstretched'
      && rigid.start === null,
  'an over-limit fabricated service still requires rewiring');
}

// ==========================================================================
// B8: measured connector anchors need not land exactly on the compatibility
// grid. The freeform trace keeps the exact point while the logical route snaps.
// ==========================================================================
console.log('\n--- B8: exact model anchors cannot disconnect flexible lines ---');
{
  const { system, state } = fixture();
  const line = addRaw(state, {
    id: 'l8', utilityType: 'powerCable', subL: 20,
    start: { placeableId: 'src1', portName: 'powerOut' },
    end: { placeableId: 'sink1', portName: 'powerIn' },
    path: [{ col: 3, row: 3 }, { col: 8, row: 3 }],
    cablePath: [{ col: 3, row: 3 }, { col: 8, row: 3 }],
  });
  const res = system.reanchorLine('l8', 'src1', {
    powerOut: { col: 4.13, row: 3.07 },
  });
  assert(res.ok === true && line.start?.placeableId === 'src1',
    `an off-grid model anchor remains connected (${JSON.stringify(res)})`);
  assert(line.cablePath[0].col === 4.13 && line.cablePath[0].row === 3.07,
    'the visible flexible trace retains the exact fitting position');
  assert(line.path[0].col === 4.25 && line.path[0].row === 3,
    'the compatibility path independently stays on the quarter-tile grid');
}

// ==========================================================================
// B9: old co-located connections stored duplicate endpoints. The soft-path
// sanitizer collapses those, so moving one fitting must seed a new span.
// ==========================================================================
console.log('\n--- B9: moving a zero-length flexible line creates a real span ---');
{
  const { system, state } = fixture();
  const line = addRaw(state, {
    id: 'l9', utilityType: 'powerCable', subL: 0,
    start: { placeableId: 'src1', portName: 'powerOut' },
    end: { placeableId: 'sink1', portName: 'powerIn' },
    path: [{ col: 3, row: 3 }, { col: 3, row: 3 }],
    cablePath: [{ col: 3, row: 3 }, { col: 3, row: 3 }],
  });
  const res = system.reanchorLine('l9', 'src1', {
    powerOut: { col: -4, row: 3 },
  });
  assert(res.ok === true && line.start?.placeableId === 'src1',
    'the zero-length legacy connection stays attached');
  assert(line.cablePath.length >= 2
      && line.cablePath[0].col === -4 && line.cablePath.at(-1).col === 3,
  'the committed cable grows a visible span between its fittings');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
