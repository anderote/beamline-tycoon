// test/test-game-serialize.js — save-payload whitelist + serializer round-trip.
// serialize() must emit only SERIALIZED_FIELDS (no derived state), a loaded
// game must re-serialize to an identical payload, and registered aux
// serializers must round-trip through save.aux.

import assert from 'node:assert';
import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

// Game.save()/load() talk to localStorage; back it with a Map for Node.
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
  return g;
}

// Place a concrete pad + one equipment placeable somewhere the starter map
// left free (trees occupy scattered tiles, so scan for a spot that works).
function buildSomething(g) {
  let placed = null;
  for (let row = 2; row < 40 && !placed; row += 3) {
    for (let col = 2; col < 40 && !placed; col += 3) {
      let padOk = true;
      for (let dr = 0; dr < 2 && padOk; dr++)
        for (let dc = 0; dc < 2 && padOk; dc++)
          padOk = g.placeInfraTile(col + dc, row + dr, 'concrete');
      if (!padOk) continue;
      const id = g.placePlaceable({ type: 'magnetron', col, row });
      if (id) placed = { col, row, id };
    }
  }
  return placed;
}

console.log('\n=== Save-payload whitelist ===\n');

const gA = makeGame(42);
const placed = buildSomething(gA);
assertOk(placed, 'placed a concrete pad + magnetron on the starter map');
// A fresh Game never proactively runs recomputeZoneConnectivity() at
// construction — it only populates state.zoneConnectivity the first time a
// zone-tile mutation calls it. load()'s own _applyState always DOES call it
// (unconditionally, at the end — see Game.js's own comment there), so
// without this, gA (never recomputed) and gB below (always recomputed via
// load) would disagree on zoneConnectivity for a reason that has nothing to
// do with the round-trip itself. Same call load() makes; this just makes
// both sides of the comparison start from the same place.
gA.recomputeZoneConnectivity();

const payloadA = gA.serialize();
const parsedA = JSON.parse(payloadA);

// Derived fields must not ride along in the payload.
//
// zoneConnectivity is deliberately NOT in this list (coordinator review,
// staff-professions-3 task 6 fix round 1): most of it IS purely derived
// (active/tileCount/tileTier/tier — rebuilt from `zones` on every
// recomputeZoneConnectivity() call), but staffedOutput/peakTier are
// accumulated staffing progress with no other record anywhere in the save.
// Treating the whole object as derived-and-excluded, the way this test used
// to, meant _applyState's own zoneConnectivity={} reset (removed — see
// Game.js's own comment on that) silently wiped a player's staffing history
// on EVERY load, not just undo. See the "zoneConnectivity persistence"
// section below for the dedicated round-trip check.
for (const key of ['systemStats', 'nodeQualities', 'infraBlockers', 'infraCanRun',
                   'infraOccupied', 'zoneOccupied', 'subgridOccupied', 'placeableIndex',
                   'wallOccupied', 'doorOccupied', 'beamline',
                   'mainBeamState', 'physicsEnvelope', 'utilityNetworkData', 'utilityNetworks',
                   'zoneFurnishingBonuses', 'moraleMultiplier', 'cornerHeightsRevision']) {
  assertOk(!(key in parsedA.state), `derived key "${key}" absent from payload`);
}
assertOk('zoneConnectivity' in parsedA.state, 'zoneConnectivity IS present in the payload (it carries accumulated staffing progress, not just derived state)');
assertOk(parsedA.version === 9, 'payload is save version 9');
assertOk(Array.isArray(parsedA.state.placeables) &&
         parsedA.state.placeables.some(p => p.type === 'magnetron'),
         'placed magnetron persists in payload');
assertOk(parsedA.state.floors.some(f => f.type === 'concrete'),
         'placed concrete floor persists in payload');

console.log('\n=== Load round-trip ===\n');

localStorage.setItem('beamlineTycoon', payloadA);
const gB = makeGame(7);   // different seed: load must fully replace starter state
assertOk(gB.load(), 'load() succeeds on a v9 payload');
const parsedB = JSON.parse(gB.serialize());

// load() appends a "Game loaded." log line; everything else must round-trip
// exactly. Compare with the log normalized out, then check it separately.
const logA = parsedA.state.log, logB = parsedB.state.log;
delete parsedA.state.log;
delete parsedB.state.log;
try {
  assert.deepStrictEqual(parsedB, parsedA);
  assertOk(true, 'serialize -> load -> serialize round-trips deeply equal');
} catch (e) {
  assertOk(false, 'serialize -> load -> serialize round-trips deeply equal\n' + e.message);
}
// log() unshifts newest-first and caps at 100, so the loaded log is
// ['Game loaded.', ...saved entries] possibly truncated.
assertOk(logB[0].msg === 'Game loaded.' &&
         JSON.stringify(logB.slice(1)) === JSON.stringify(logA.slice(0, logB.length - 1)),
         'loaded log preserves the saved entries');

console.log('\n=== Staff round-trip ===\n');

console.log('\n=== Legacy inline-attachment migration ===\n');
{
  const legacy = makeGame(42);
  legacy.state.beamPipes = [{
    id: 'bp_legacy_inline', start: null, end: null,
    path: [{ col: 0, row: 0 }, { col: 0, row: 1 }], subL: 4,
    placements: [{ id: 'pl_legacy_bpm', type: 'bpm', position: 0.25, subL: 1, params: {} }],
  }];
  localStorage.setItem('beamlineTycoon', legacy.serialize());
  const migrated = makeGame(7);
  migrated.load();
  const bpm = migrated.state.beamPipes[0]?.placements[0];
  assertOk(bpm?.inline === true,
    'a pre-field BPM is stamped as an inline point slot on load');
  assertOk(bpm?.position === 0.375,
    `migration preserves its old visual centre on the new anchor lattice (got ${bpm?.position})`);
}

// Regression: the StaffMember constructor used to hard-reset stats.ticksWorked
// and stats.breakdowns to 0 after processing opts, so fromJSON(toJSON())
// silently dropped both — every load and every undo zeroed staff work history.
{
  const { StaffMember } = await import('../src/game/staff/StaffMember.js');
  const m = new StaffMember({ id: 'staff_test', profession: 'operator' });
  m.stats.ticksWorked = 40;
  m.stats.breakdowns = 2;
  const r = StaffMember.fromJSON(m.toJSON());
  assertOk(r.stats.ticksWorked === 40, `fromJSON keeps ticksWorked (got ${r.stats.ticksWorked})`);
  assertOk(r.stats.breakdowns === 2, `fromJSON keeps breakdowns (got ${r.stats.breakdowns})`);

  // End-to-end: a game whose staff has accrued work must round-trip it.
  const gS = makeGame(42);
  const seeded = gS.state.staffMembers[0];
  seeded.stats.ticksWorked = 17;
  seeded.stats.breakdowns = 1;
  localStorage.setItem('beamlineTycoon', gS.serialize());
  const gT = makeGame(7);
  gT.load();
  const loaded = gT.state.staffMembers.find(s => s.id === seeded.id);
  assertOk(loaded && loaded.stats.ticksWorked === 17 && loaded.stats.breakdowns === 1,
           `staff work history survives save->load (got ${loaded && loaded.stats.ticksWorked}/${loaded && loaded.stats.breakdowns})`);
}

console.log('\n=== zoneConnectivity persistence (staffedOutput/peakTier) ===\n');

// Coordinator review, staff-professions-3 task 6 fix round 1: peakTier and
// staffedOutput are accumulated staffing progress (the same category as
// staff work history above, or componentHealth), not re-derivable from
// `zones` alone the way tileCount/tileTier/tier are — a save that dropped
// them would silently re-lock any research gated on that lab (see
// research.js's getLabResearchTier) the moment the player reloaded.
{
  const gZ = makeGame(42);
  // Hand-set rather than staffed up through the real job system — this
  // file's own concern is the serialize/load round-trip, not the ratchet
  // mechanics (see test-science-and-zone-staffing.js for those). tileCount/
  // tileTier/tier/active are deliberately left inconsistent with a real
  // zone (no rfLab tiles exist on this map at all) to prove the point
  // sharply: recomputeZoneConnectivity() overwrites those derived fields
  // fresh from `zones` on load regardless, but staffedOutput/peakTier have
  // no other source to be overwritten FROM, so they must come through
  // exactly as saved.
  gZ.state.zoneConnectivity.rfLab = {
    active: false, tileCount: 0, tileTier: 0, tier: 0,
    staffedOutput: 0.55, peakTier: 3,
  };
  localStorage.setItem('beamlineTycoon', gZ.serialize());

  const gZLoaded = makeGame(7);
  gZLoaded.load();
  const conn = gZLoaded.state.zoneConnectivity.rfLab;
  assertOk(conn?.staffedOutput === 0.55, `staffedOutput survives save->load (got ${conn?.staffedOutput})`);
  assertOk(conn?.peakTier === 3, `peakTier survives save->load (got ${conn?.peakTier})`);
}

console.log('\n=== save() survives broken localStorage ===\n');

// Regression: the tick-driven autosave calls save() unguarded, so headless
// Node drivers (agent env) crashed on tick 30 when localStorage.setItem
// throws / is not a function. save() must swallow persistence failures.
{
  const gE = makeGame(42);
  const realSetItem = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => { throw new TypeError('localStorage.setItem is not a function'); };
  let threw = false;
  try { gE.save(); } catch (_) { threw = true; }
  globalThis.localStorage.setItem = realSetItem;
  assertOk(!threw, 'save() does not throw when localStorage.setItem throws');
}

console.log('\n=== Derived door index rebuilt on load ===\n');

// Regression: _applyState rebuilt infraOccupied/zoneOccupied/wallOccupied but
// never doorOccupied, so after any load() a placed door could not be removed
// (removeDoor early-returns on the missing key) and every doorway read as
// solid wall to room detection.
{
  const gDoor = makeGame(5);
  gDoor.placeWall(5, 5, 'n', 'officeWall');
  assertOk(gDoor.placeDoor(5, 5, 'n', 'doubleDoor'), 'door placed on the wall edge');
  localStorage.setItem('beamlineTycoon', gDoor.serialize());

  const gLoaded = makeGame(5);
  gLoaded.load();
  assertOk(gLoaded.state.doors.length === 1, 'door survived the round-trip');
  assertOk(gLoaded.state.doorOccupied['5,5,n'] === 'doubleDoor',
           'doorOccupied rebuilt from state.doors on load');
  assertOk(gLoaded.removeDoor(5, 5, 'n') === true,
           'a loaded door can still be removed');
}

console.log('\n=== Aux serializers ===\n');

const gC = makeGame(42);
gC.registerSerializer('camera', { save: () => ({ zoom: 2.5, panX: 7 }), load: () => {} });
const parsedC = JSON.parse(gC.serialize());
assertOk(parsedC.aux && parsedC.aux.camera && parsedC.aux.camera.zoom === 2.5,
         'registered section serialized under save.aux');
assertOk(!('camera' in parsedC.state), 'aux sections stay out of save.state');

localStorage.setItem('beamlineTycoon', gC.serialize());
const gD = makeGame(7);
let restored = null;
gD.registerSerializer('camera', { save: () => null, load: (data) => { restored = data; } });
gD.load();
assertOk(restored && restored.zoom === 2.5 && restored.panX === 7,
         'load() dispatches aux section to the registered serializer');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
