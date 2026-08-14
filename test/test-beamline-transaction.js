// test/test-beamline-transaction.js — Game.snapshotBeamlineState() /
// restoreBeamlineState() as an all-or-nothing rollback for the Beamline
// Designer's Apply.
//
// Apply executes an ordered op list through BeamlineSystem /
// UtilityLineSystem, and any op in it can fail halfway. What the player must
// never see is half a beamline — some modules placed, the pipes meant to join
// them missing. So the contract under test is: snapshot, mutate the map
// arbitrarily, restore, and every field the plan can touch is byte-identical
// to the pre-mutation state.
//
// Test scenarios:
//   1. Round-trip: place a junction, draw a pipe, attach an on-pipe
//      placement, add a utility line and spend funding, then restore — the
//      whole transaction projection (placeables, beamPipes, utilityLines,
//      resources, id counters, subgridOccupied, placeableIndex,
//      cornerHeights) matches.
//   2. Occupancy specifically: the rolled-back junction's sub-grid cells are
//      free again, with the record shape they had before, not the shape a
//      rebuild from placeables would have produced.
//   3. The snapshot is not aliased: mutating a placeable's params in place
//      after the snapshot is still rolled back.
//   4. Scope: state OUTSIDE the transaction (floors, the clock, staff) is
//      deliberately left alone by a rollback.
//   5. Restore emits placeableChanged + beamlineChanged + utilityLinesChanged
//      and marks the utility topology dirty — a skipped emit leaves the
//      rolled-back geometry on screen as unclickable ghosts.
//   6. A missing / unreadable blob returns false and touches nothing, so a
//      caller that lost its snapshot fails loudly rather than wiping the map.
//   7. Terrain: placing a junction auto-flattens the ground under its
//      footprint, so a rollback that skipped the heightmap would leave a
//      permanent flat scar in the hillside where the junction briefly stood.

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { setTileCorners, getTileCorners, serializeCornerHeights } from '../src/game/terrain.js';

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

// The starter map generates flat, so nothing in it would exercise the terrain
// half of the transaction — the heightmap would be empty before and after and
// every rollback would pass by accident. Raise the whole build area one step
// so any placement's auto-flatten leaves a scar with something to restore.
function raiseBuildArea(g) {
  for (let row = 0; row < 42; row++) {
    for (let col = 0; col < 40; col++) {
      setTileCorners(g.state, col, row, { nw: 1, ne: 1, se: 1, sw: 1 });
    }
  }
}

// The transaction's field set, projected to comparable strings — one entry
// per field so a failure names the field that drifted instead of dumping the
// whole facility. utilityLines and cornerHeights are Maps, so they project as
// entries the same way serialize() persists them.
function txProjection(g) {
  const s = g.state;
  return {
    resources: JSON.stringify(s.resources),
    placeables: JSON.stringify(s.placeables),
    placeableNextId: JSON.stringify(s.placeableNextId),
    beamPipes: JSON.stringify(s.beamPipes),
    beamPipeNextId: JSON.stringify(s.beamPipeNextId),
    placementNextId: JSON.stringify(s.placementNextId),
    utilityLines: JSON.stringify(Array.from(s.utilityLines.entries())),
    utilityNextId: JSON.stringify(s.utilityNextId),
    cornerHeights: JSON.stringify(serializeCornerHeights(s.cornerHeights)),
    subgridOccupied: JSON.stringify(s.subgridOccupied),
    placeableIndex: JSON.stringify(s.placeableIndex),
  };
}

function assertProjectionEqual(before, after, label) {
  const drifted = Object.keys(before).filter(k => before[k] !== after[k]);
  assert(drifted.length === 0,
    `${label}: every transaction field restored${drifted.length ? ' (drifted: ' + drifted.join(', ') + ')' : ''}`);
}

// The physics recalc 'beamlineChanged' schedules runs in a microtask and
// writes derived state; drain it so each projection is taken against a
// settled world rather than mid-flight.
const settle = () => new Promise(r => setTimeout(r, 0));

// Find a free spot for a junction of the given type by scanning the starter
// map — the map generator litters it with terrain decorations, so a fixed
// coordinate is not reliably clear.
function placeJunctionSomewhere(g, type) {
  for (let row = 2; row < 40; row += 2) {
    for (let col = 2; col < 34; col += 2) {
      const id = g.beamline.placeJunction({ type, col, row, subCol: 0, subRow: 0, dir: 0 });
      if (id) return { id, col, row };
    }
  }
  return null;
}

function drawPipeSomewhere(g) {
  for (let row = 3; row < 40; row += 2) {
    for (let col = 2; col < 30; col += 2) {
      const id = g.beamline.drawPipe(null, null, [{ col, row }, { col: col + 4, row }]);
      if (id) return id;
    }
  }
  return null;
}

// ==========================================================================
// Test 1 + 2: full round-trip over a substantial mutation.
// ==========================================================================
console.log('\n--- Test 1: snapshot -> mutate -> restore round-trips ---');
{
  const g = makeGame(42);
  raiseBuildArea(g);
  // Pre-existing beamline geometry, so the rollback has to preserve state it
  // did not create as well as undo state it did.
  const seedPipe = drawPipeSomewhere(g);
  assert(!!seedPipe, 'setup: a pre-existing pipe exists before the snapshot');
  await settle();

  const before = txProjection(g);
  const snapshot = g.snapshotBeamlineState();

  // --- the "apply" ---
  const junction = placeJunctionSomewhere(g, 'dipole');
  assert(!!junction, 'mutation: junction placed');
  const newPipe = drawPipeSomewhere(g);
  assert(!!newPipe, 'mutation: pipe drawn');
  const placement = g.beamline.placeOnPipe(newPipe, {
    type: 'bpm', position: 0.5, mode: 'snap',
  });
  assert(!!placement, 'mutation: on-pipe placement attached');
  const line = g.utilityLineSystem.addLine({
    utilityType: 'powerCable',
    start: null,
    end: null,
    path: [{ col: 20, row: 20 }, { col: 24, row: 20 }],
  });
  assert(!!line, 'mutation: utility line added');
  g.state.resources.funding -= 250000;   // an op paying its own way
  await settle();

  const after = txProjection(g);
  const changedFields = Object.keys(before).filter(k => before[k] !== after[k]);
  assert(changedFields.length === Object.keys(before).length,
    `mutation touched every transaction field (${changedFields.length} of ${Object.keys(before).length})`);

  // --- the rollback ---
  const ok = g.restoreBeamlineState(snapshot);
  assert(ok === true, 'restoreBeamlineState returns true');
  await settle();
  assertProjectionEqual(before, txProjection(g), 'rollback');

  console.log('\n--- Test 2: sub-grid occupancy after rollback ---');
  const stillClaimed = Object.entries(g.state.subgridOccupied)
    .filter(([, v]) => v && v.id === junction.id);
  assert(stillClaimed.length === 0,
    'the rolled-back junction claims no sub-grid cells');
  assert(g.state.placeableIndex[junction.id] === undefined,
    'the rolled-back junction is out of placeableIndex');
  assert(!g.state.placeables.some(p => p.id === junction.id),
    'the rolled-back junction is out of state.placeables');
  // The starter map's records carry `category` (they came from
  // _rebuildPlaceableIndex) while the placement path writes {id, kind} only.
  // Restoring verbatim keeps that distinction; rebuilding on restore would
  // have rewritten every record in the facility.
  const sample = Object.values(g.state.subgridOccupied)[0];
  assert(sample && 'category' in sample,
    'untouched occupancy records keep their original shape (not rebuilt)');
  assert(g.state.beamPipes.length === 1 && g.state.beamPipes[0].id === seedPipe,
    'pre-existing pipe survives the rollback, new pipe does not');
}

// ==========================================================================
// Test 3: the snapshot cannot be aliased by later mutation.
// ==========================================================================
console.log('\n--- Test 3: snapshot is a deep copy ---');
{
  const g = makeGame(7);
  const junction = placeJunctionSomewhere(g, 'buncher');
  assert(!!junction, 'setup: junction placed');
  await settle();

  const snapshot = g.snapshotBeamlineState();
  const before = txProjection(g);

  // In-place edits are the alias hazard: a shallow snapshot would hold the
  // same objects the ops mutate, so the rollback would restore the mutation.
  const entry = g.state.placeables.find(p => p.id === junction.id);
  const paramKey = Object.keys(entry.params)[0];
  assert(!!paramKey, 'setup: junction carries at least one param to edit');
  entry.params[paramKey] = 999;
  entry.dir = 2;
  g.state.beamPipes.push({ id: 'bp_bogus', start: null, end: null, path: [], placements: [] });
  assert(txProjection(g).placeables !== before.placeables, 'in-place edit landed');

  g.restoreBeamlineState(snapshot);
  await settle();
  assertProjectionEqual(before, txProjection(g), 'in-place edits');
  const restored = g.state.placeables.find(p => p.id === junction.id);
  assert(restored && restored.params[paramKey] !== 999 && restored.dir === 0,
    'in-place param/dir edits are rolled back');
}

// ==========================================================================
// Test 4: the rollback is scoped — it leaves non-transaction state alone.
// ==========================================================================
console.log('\n--- Test 4: rollback scope ---');
{
  const g = makeGame(11);
  await settle();
  const snapshot = g.snapshotBeamlineState();

  const tickBefore = g.state.tick;
  g.state.tick += 25;
  const staffBefore = g.state.staffMembers.length;
  const floorsBefore = g.state.floors.length;
  let placed = 0;
  for (let col = 3; col < 12 && placed < 2; col++) {
    if (g.placeInfraTile(col, 30, 'concrete')) placed++;
  }
  assert(placed > 0, 'setup: floor tiles placed between snapshot and restore');

  g.restoreBeamlineState(snapshot);
  await settle();

  assert(g.state.tick === tickBefore + 25,
    'the clock is not rewound (Apply is not a gesture boundary)');
  assert(g.state.floors.length === floorsBefore + placed,
    'floors are outside the transaction and survive the rollback');
  assert(g.state.staffMembers.length === staffBefore, 'staff are untouched');
}

// ==========================================================================
// Test 5: restore emits everything the renderers and the solver need.
// ==========================================================================
console.log('\n--- Test 5: restore emits ---');
{
  const g = makeGame(13);
  await settle();
  const snapshot = g.snapshotBeamlineState();
  drawPipeSomewhere(g);

  const seen = [];
  g.on((ev) => seen.push(ev));
  const revBefore = g.solveRunner.topologyRevision;
  g.restoreBeamlineState(snapshot);

  for (const ev of ['placeableChanged', 'beamlineChanged', 'utilityLinesChanged']) {
    assert(seen.includes(ev), `restore emits '${ev}'`);
  }
  assert(g.solveRunner.topologyRevision > revBefore,
    'restore marks the utility network discovery dirty');
  assert(g.state.utilityNetworkData === null && g.state.utilityNetworks === null,
    'derived utility caches from the half-applied state are dropped');
  await settle();
}

// ==========================================================================
// Test 6: a bad blob is refused rather than applied.
// ==========================================================================
console.log('\n--- Test 6: bad snapshots are refused ---');
{
  const g = makeGame(17);
  // Non-flat ground here too: a restore that rehydrated the heightmap before
  // validating the blob would wipe the terrain on its way to returning false.
  raiseBuildArea(g);
  drawPipeSomewhere(g);
  await settle();
  const before = txProjection(g);

  for (const [label, blob] of [
    ['null', null],
    ['empty object', {}],
    ['non-string payload', { payload: { state: {} } }],
    ['unparseable payload', { payload: '{not json' }],
  ]) {
    assert(g.restoreBeamlineState(blob) === false, `restore(${label}) returns false`);
  }
  assertProjectionEqual(before, txProjection(g), 'refused restores');
}

// ==========================================================================
// Test 7: terrain flattened by a rolled-back placement is put back.
// ==========================================================================
console.log('\n--- Test 7: terrain under a rolled-back junction ---');
{
  const g = makeGame(23);
  raiseBuildArea(g);
  await settle();

  const snapshot = g.snapshotBeamlineState();
  const revBefore = g.state.cornerHeightsRevision;

  const junction = placeJunctionSomewhere(g, 'dipole');
  assert(!!junction, 'setup: junction placed on raised ground');
  const scarred = getTileCorners(g.state, junction.col, junction.row);
  assert(scarred.nw === 0 && scarred.ne === 0 && scarred.se === 0 && scarred.sw === 0,
    'placing the junction flattened the ground under its footprint');
  await settle();

  assert(g.restoreBeamlineState(snapshot) === true, 'restore returns true');
  await settle();

  const healed = getTileCorners(g.state, junction.col, junction.row);
  assert(healed.nw === 1 && healed.ne === 1 && healed.se === 1 && healed.sw === 1,
    'the hillside is back at its pre-apply height, not left as a flat scar');
  // The heightmap persists as [col,row,nw,ne,se,sw] tuples; leaving it in that
  // form would make the first getTileCorners() after a rollback throw.
  assert(g.state.cornerHeights instanceof Map,
    'cornerHeights is rehydrated as a Map, not left as the serialized array');
  // Monotonic renderer cache key: rewinding it to the snapshot's value would
  // leave the terrain mesh builders convinced nothing had changed, so the
  // flattened ground would stay on screen after the rollback.
  assert(g.state.cornerHeightsRevision > revBefore,
    'the revision counter moves forward so terrain meshes rebuild');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
