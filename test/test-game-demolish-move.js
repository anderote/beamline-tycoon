// test/test-game-demolish-move.js — regressions around removal and movement.
//
//   1. demolishTarget('beamlineWhole') must refund exactly 50% of each
//      module's cost. (Regression: removePlaceable ALSO refunded 50% per
//      module on top of the accumulated whole-beamline refund → 100% back,
//      free rebuild/demolish loops.)
//   2. removePlaceable on a beamline placeable with attached beam pipes must
//      emit 'beamlineChanged'. (Regression: only 'placeableChanged' fired,
//      whose renderer path never refreshes beam-pipe meshes — deleted pipes
//      lingered as unclickable ghosts.)
//   3. Game.movePlaceable: moving a component through the same validated
//      primitive as MoveTool must rebuild placeable.cells and the
//      subgridOccupied claims. (Regression: the tool once called a nonexistent
//      rebuild method, leaving stale targeting and allowing overlaps.)
//   4. Game._batchEvents: removeInfraRect must coalesce per-tile emits into
//      one 'infrastructureChanged'. (Regression: an N-tile rect triggered N
//      full terrain rebuilds inside one mouseup.)
//   6. demolishTarget('beampipeSection'): Game's half of the section cut —
//      dispatch, delegation of a whole-pipe cut to removeBeamPipe (the only
//      path that refunds on-pipe hardware and releases its utility
//      endpoints), and all-or-nothing refusal when a placement is in the way.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PLACEABLES } from '../src/data/placeables/index.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';

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
function assertOk(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

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

// Find a clear spot for a placeable of the given type on the starter map.
function placeSomewhere(g, type) {
  for (let row = 2; row < 60; row += 3) {
    for (let col = 2; col < 60; col += 3) {
      const id = g.placePlaceable({ type, col, row });
      if (id) return { id, col, row };
    }
  }
  return null;
}

console.log('\n=== 1. Whole-beamline demolish refunds 50%, not 100% ===\n');

{
  const g = makeGame(42);
  const placed = placeSomewhere(g, 'source');
  assertOk(placed, 'placed a source module');
  const entry = g.registry.getBySourceId(placed.id);
  assertOk(entry, 'source placement created a registry beamline');

  const cost = PLACEABLES.source.cost.funding;
  const before = g.state.resources.funding;
  const ok = g.demolishTarget({ kind: 'beamlineWhole', beamlineId: entry.id });
  assertOk(ok, 'demolishTarget beamlineWhole succeeded');
  const refund = g.state.resources.funding - before;
  assertOk(refund === Math.floor(cost * 0.5),
    `refund is exactly 50% of cost (got $${refund}, expected $${Math.floor(cost * 0.5)})`);
  assertOk(!g.state.placeables.some(p => p.id === placed.id),
    'module removed from state');
}

console.log('\n=== 2. Pruning attached pipes emits beamlineChanged ===\n');

{
  const g = makeGame(42);
  const placed = placeSomewhere(g, 'source');
  assertOk(placed, 'placed a source module');
  // Attach a pipe directly (mirrors what pipe drawing stores): removal must
  // prune it and tell the renderer to refresh pipe meshes.
  g.state.beamPipes.push({
    id: 'pipe_test_1',
    start: { junctionId: placed.id, port: 'exit' },
    end: null,
    path: [{ col: placed.col, row: placed.row }, { col: placed.col + 3, row: placed.row }],
    subL: 12,
    placements: [],
  });
  const events = [];
  g.on((ev) => events.push(ev));
  g.removePlaceable(placed.id);
  assertOk(!g.state.beamPipes.some(p => p.id === 'pipe_test_1'),
    'attached pipe pruned from state');
  assertOk(events.includes('beamlineChanged'),
    `'beamlineChanged' emitted so the renderer refreshes pipe meshes (got: ${events.join(',')})`);

  // Control: removing a pipe-less beamline placeable does not force the
  // full beamline refresh.
  const placed2 = placeSomewhere(g, 'source');
  const events2 = [];
  g.on((ev) => events2.push(ev));
  g.removePlaceable(placed2.id);
  assertOk(!events2.includes('beamlineChanged'),
    'no beamlineChanged when no pipes were pruned');
}

console.log('\n=== 3. Moving a component rebuilds cells + subgrid claims ===\n');

{
  const g = makeGame(42);
  const placed = placeSomewhere(g, 'source');
  assertOk(placed, 'placed a source module');
  const placeable = g.getPlaceable(placed.id);
  const oldCells = placeable.cells.map(c => `${c.col},${c.row},${c.subCol},${c.subRow}`);

  // Mirror MoveTool._placeMovedObject's validated drop.
  const nCol = placed.col + 10, nRow = placed.row + 10;
  assertOk(g.movePlaceable(placed.id, { col: nCol, row: nRow }),
    'move primitive accepts a clear destination');
  g._deriveBeamGraph();
  g.recalcAllBeamlines();

  assertOk(placeable.cells.every(c => c.col >= nCol && c.row >= nRow),
    'placeable.cells rederived at the new position');
  assertOk(oldCells.every(k => !g.state.subgridOccupied[k]),
    'old subgrid claims released');
  assertOk(placeable.cells.every(c => {
    const occ = g.state.subgridOccupied[`${c.col},${c.row},${c.subCol},${c.subRow}`];
    return occ && occ.id === placed.id;
  }), 'new subgrid cells claimed by the moved placeable');

  // Overlapping placement on top of the moved component must now be refused.
  const overlapping = g.placePlaceable({ type: 'source', col: nCol, row: nRow });
  assertOk(overlapping === false || overlapping == null,
    'placement on top of the moved component is refused');
}

console.log('\n=== 4. removeInfraRect coalesces per-tile emits ===\n');

{
  const g = makeGame(42);
  // Lay a 4x4 concrete pad (placeInfraRect emits once itself).
  let placedTiles = 0;
  for (let c = 2; c < 6; c++)
    for (let r = 2; r < 6; r++)
      if (g.placeInfraTile(c, r, 'concrete')) placedTiles++;
  assertOk(placedTiles === 16, `pad placed (${placedTiles}/16 tiles)`);

  const counts = {};
  g.on((ev) => { counts[ev] = (counts[ev] || 0) + 1; });
  g.removeInfraRect(2, 2, 5, 5);
  assertOk((counts.infrastructureChanged || 0) === 1,
    `one infrastructureChanged for the whole rect (got ${counts.infrastructureChanged})`);
  assertOk(!g.state.infraOccupied['3,3'], 'rect actually removed the floor');
}

console.log('\n=== 5. removeZoneTile refunds furnishings without corrupting funding ===\n');

// Regression: the refund was Math.floor(def.cost * 0.5) but every furnishing
// def carries an object cost ({funding: N}) → NaN funding forever; and the
// furnishings were spliced out of the derived state.zoneFurnishings array,
// which _syncLegacyPlaceableState immediately rebuilt from state.placeables,
// so the furnishing survived on a zoneless tile.
{
  const g = makeGame(42);
  let spot = null;
  for (let row = 2; row < 40 && !spot; row++) {
    for (let col = 2; col < 40 && !spot; col++) {
      if (!g.placeInfraTile(col, row, 'concrete')) continue;
      if (!g.placeInfraTile(col, row, 'officeFloor')) continue;
      if (!g.placeZoneTile(col, row, 'officeSpace')) continue;
      const id = g.placePlaceable({ type: 'desk', col, row, subCol: 0, subRow: 0 });
      if (id) spot = { col, row, id };
    }
  }
  assertOk(spot, 'setup: desk placed on an office-zone tile');

  const fundingBefore = g.state.resources.funding;
  assertOk(g.removeZoneTile(spot.col, spot.row), 'zone tile removed');
  assertOk(Number.isFinite(g.state.resources.funding),
    `funding stays a number (got ${g.state.resources.funding})`);
  const deskCost = PLACEABLES.desk.cost.funding;
  assertOk(g.state.resources.funding === fundingBefore + Math.floor(deskCost * 0.5),
    `furnishing refunded at 50% (got ${g.state.resources.funding - fundingBefore}, want ${Math.floor(deskCost * 0.5)})`);
  assertOk(!g.getPlaceable(spot.id), 'the furnishing is really gone from state.placeables');
  assertOk(g.state.zoneFurnishings.length === 0, 'derived furnishing list is empty');
}

console.log('\n=== 6. placeInfraRect coalesces decoration-clearing emits ===\n');

// Regression: paving a rect over a grove called removeDecoration per tile, and
// every removePlaceable emitted 'placeableChanged' — one full renderer
// decoration teardown+rebuild per tree inside a single mouseup.
{
  const g = makeGame(42);
  // Find the 8x8 rect with the most decorations on it.
  let best = { col: 0, row: 0, trees: 0 };
  for (let col = 2; col < 50; col += 4) {
    for (let row = 2; row < 50; row += 4) {
      let trees = 0;
      for (const p of g.state.placeables) {
        if (p.category !== 'decoration') continue;
        if (p.col >= col && p.col <= col + 7 && p.row >= row && p.row <= row + 7) trees++;
      }
      if (trees > best.trees) best = { col, row, trees };
    }
  }
  assertOk(best.trees > 1, `setup: found a rect with ${best.trees} decorations`);

  const counts = {};
  g.on((ev) => { counts[ev] = (counts[ev] || 0) + 1; });
  g.placeInfraRect(best.col, best.row, best.col + 7, best.row + 7, 'concrete');
  assertOk((counts.placeableChanged || 0) <= 1,
    `at most one placeableChanged for the whole rect (got ${counts.placeableChanged || 0}, cleared ${best.trees} decorations)`);
  assertOk((counts.infrastructureChanged || 0) === 1,
    `one infrastructureChanged for the whole rect (got ${counts.infrastructureChanged})`);
  assertOk(g.state.infraOccupied[`${best.col},${best.row}`] === 'concrete',
    'the rect was actually paved');
}

console.log('\n=== 5. Move pick-up detaches utility lines ===\n');

{
  // Regression: liftPlaceable spliced the placeable out without calling
  // utilityLineSystem.onPlaceableRemoved, and the drop re-inserts through
  // placePlaceable with a FRESH id — so every line attached to a moved
  // chiller/pump kept pointing at a dead id, in state and in every save.
  // The port then vanished from network discovery while the line kept
  // drawing as if connected.
  const g = makeGame(46);
  const placed = placeSomewhere(g, 'chiller');
  assertOk(placed, 'setup: placed a chiller (a coolingWater source)');

  g.state.utilityLines.set('ul_test', {
    id: 'ul_test',
    utilityType: 'coolingWater',
    start: { placeableId: placed.id, portName: 'cool_out' },
    end: null,
    path: [{ col: placed.col, row: placed.row }, { col: placed.col + 2, row: placed.row }],
  });

  const snap = g.liftPlaceable(placed.id);
  assertOk(snap, 'pick-up lifted the chiller');
  const line = g.state.utilityLines.get('ul_test');
  assertOk(line && line.start === null,
    'the attached line endpoint was detached, not left pointing at the dead id');
  assertOk(!g.serialize().includes(placed.id),
    'no dangling reference to the lifted id survives into the save');
}

console.log('\n=== 6. demolishTarget beampipeSection cuts by the sub-unit ===\n');

{
  // Section cutting is BeamlineSystem's job (covered in
  // test-beamline-system-splice.js); what is under test here is Game's half:
  // dispatch through demolishTarget, delegation of a whole-pipe cut to
  // removeBeamPipe, and rebuilding the beam graph so physics stops solving a
  // lattice that no longer exists.
  const g = makeGame(42);
  const placed = placeSomewhere(g, 'source');
  const pipe = {
    id: 'pipe_sec_1',
    start: { junctionId: placed.id, portName: 'exit' },
    end: null,
    path: [{ col: placed.col, row: placed.row }, { col: placed.col + 4, row: placed.row }],
    subL: 16,
    placements: [],
  };
  g.state.beamPipes.push(pipe);

  // Interior cut → two pipes, both open at the hole.
  const fundingBefore = g.state.resources.funding;
  const ok = g.demolishTarget({
    kind: 'beampipeSection', pipeId: 'pipe_sec_1', fromSub: 8, toSub: 9,
  });
  assertOk(ok, 'demolishTarget beampipeSection succeeded');
  assertOk(!g.state.beamPipes.some(p => p.id === 'pipe_sec_1'),
    'the original pipe id is gone — an interior cut mints two stubs');
  assertOk(g.state.beamPipes.length === 2,
    `one pipe became two (got ${g.state.beamPipes.length})`);
  const [head, tail] = g.state.beamPipes;
  assertOk(head.start && head.start.junctionId === placed.id,
    'the head stub keeps the source attachment');
  assertOk(head.end === null && tail.start === null,
    'both faces of the hole are open ends');
  assertOk(g.state.resources.funding > fundingBefore,
    'the offcut was refunded');

  // Cutting a stub end to end delegates to removeBeamPipe rather than
  // leaving a zero-length pipe behind.
  const gone = g.demolishTarget({
    kind: 'beampipeSection', pipeId: tail.id, fromSub: 0, toSub: tail.subL,
  });
  assertOk(gone, 'a whole-pipe section cut succeeded');
  assertOk(!g.state.beamPipes.some(p => p.id === tail.id),
    'the whole-pipe cut removed the pipe outright');

  // A cut through mounted hardware is refused outright — nothing partial.
  head.placements = [{ id: 'pl_test', type: 'bpm', position: 0.5, subL: 2, params: {} }];
  const before = JSON.stringify(g.state.beamPipes);
  const refused = g.demolishTarget({
    kind: 'beampipeSection', pipeId: head.id, fromSub: 4, toSub: 5,
  });
  assertOk(refused === false, `cutting through a placement returns false (got ${refused})`);
  assertOk(JSON.stringify(g.state.beamPipes) === before,
    'a refused cut leaves every pipe untouched');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
