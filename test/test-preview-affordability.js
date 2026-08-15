// test/test-preview-affordability.js — the placement ghost must not read as
// valid when the player can't pay for it.
//
// canPlace() only checks footprint collision + walls, but every commit path
// also rejects on cost: Game._placePlaceableInner, BeamlineSystem.placeJunction
// (via placePlaceable) and BeamlineSystem.placeOnPipe. So a green ghost over a
// geometrically-clear tile promised a placement that just logged "Can't afford
// X!". Preview validity now folds in affordability, reported separately from
// the geometric verdict so the ghost can tint "too expensive" apart from
// "blocked".

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { PLACEABLES } from '../src/data/placeables/index.js';
import { canPlace, previewPlacement, snapForPlaceable } from '../src/game/placement.js';
import { InputHandler } from '../src/input/InputHandler.js';
import { BeamlineInputController } from '../src/input/BeamlineInputController.js';
import { tileCenterIso } from '../src/renderer/grid.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

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
  // Fix round 3 (staff-professions-3, task 5): on-pipe attachment ghosts now
  // also quote/check spares (componentCostFor, closing the "green ghost, red
  // click" gap InputHandler.js/BeamlineInputController.js had even after
  // BeamlineSystem.placeOnPipe itself started charging spares) — fund this
  // the same generous way funding above is, so this file's "with funds"
  // scenarios are gated only by what they're actually testing.
  g.state.resources.spares = 1e9;
  return g;
}

// Find a tile where the placeable's footprint is geometrically clear —
// generated scenery occupies plenty of them.
function findClearTile(game, placeable) {
  for (let row = 2; row < 40; row++) {
    for (let col = 2; col < 40; col++) {
      const iso = tileCenterIso(col, row);
      const snap = snapForPlaceable(iso.x, iso.y, placeable, 0);
      if (canPlace(game, placeable, snap.col, snap.row, snap.subCol, snap.subRow, 0).ok) {
        return { col, row, iso, snap };
      }
    }
  }
  return null;
}

console.log('\n=== 1. previewPlacement separates geometry from money ===\n');

{
  const g = makeGame(101);
  const pl = PLACEABLES.labBench;
  const spot = findClearTile(g, pl);
  assertOk(spot, 'setup: found a tile with a clear lab bench footprint');

  const { col, row, subCol, subRow } = spot.snap;
  const rich = previewPlacement(g, pl, col, row, subCol, subRow, 0);
  assertOk(rich.ok && rich.affordable && rich.reason === null,
    'a clear tile with funds previews as valid');

  g.state.resources.funding = pl.cost.funding - 1;
  const broke = previewPlacement(g, pl, col, row, subCol, subRow, 0);
  assertOk(broke.ok === false, 'the same tile previews as INVALID one unit short of the cost');
  assertOk(broke.reason === 'unaffordable',
    `the refusal is reported as unaffordable (got ${broke.reason})`);
  assertOk(broke.affordable === false && broke.blockedCells.length === 0 && !broke.wallBlocked,
    'the geometry is still reported clear — only the ledger refused');

  // canPlace itself must stay purely geometric; the tint and the log both
  // depend on telling the two apart.
  assertOk(canPlace(g, pl, col, row, subCol, subRow, 0).ok === true,
    'canPlace stays geometry-only and still reports ok when broke');

  // And the commit really does refuse, i.e. the preview was right.
  const placed = g.placePlaceable({ type: 'labBench', col, row, subCol, subRow, dir: 0 });
  assertOk(!placed, 'the commit path rejects the placement the preview called invalid');
}

console.log('\n=== 2. The hover ghost is flagged unaffordable ===\n');

// InputHandler needs a DOM to construct, so drive its prototype methods on a
// record carrying only the members the preview paths touch (same approach as
// test-input-tools.js).
function makeRenderer() {
  return {
    ghosts: [],       // renderPlaceableGhost calls: { hover, ok, reason }
    batches: [],      // renderPlaceableGhosts calls: the list
    _clearPreview() {},
    renderPlaceableGhost(hover, ok, reason = null) {
      this.ghosts.push({ hover: { ...hover }, ok, reason });
    },
    renderPlaceableGhosts(list) { this.batches.push(list); },
    clearDragPreview() {},
  };
}

function makeInput(game, renderer, armedId) {
  const input = {
    game, renderer,
    hoverPlaceable: null,
    selectedPlaceableVariant: 0,
    placementDir: 0,
    lastMouseWorldX: 0,
    lastMouseWorldY: 0,
    linePlaceStartWorld: null,
    linePlaceHovers: [],
    linePlaceSpacingSub: new Map(),
    beamlineController: { onHover() {} },
    get armedPlaceableId() { return armedId; },
  };
  for (const m of ['_updatePlaceablePreview', '_updateLinePlacePreview']) {
    input[m] = InputHandler.prototype[m];
  }
  return input;
}

{
  const g = makeGame(102);
  const pl = PLACEABLES.labBench;
  const spot = findClearTile(g, pl);
  const renderer = makeRenderer();
  const input = makeInput(g, renderer, 'labBench');
  input.lastMouseWorldX = spot.iso.x;
  input.lastMouseWorldY = spot.iso.y;

  input._updatePlaceablePreview();
  const rich = renderer.ghosts[renderer.ghosts.length - 1];
  assertOk(rich && rich.ok === true && rich.reason == null,
    'ghost is valid on a clear tile with funds');

  g.state.resources.funding = 0;
  renderer.ghosts.length = 0;
  input._updatePlaceablePreview();
  const broke = renderer.ghosts[renderer.ghosts.length - 1];
  assertOk(broke && broke.ok === false,
    'ghost is invalid on the SAME clear tile with no funds');
  assertOk(broke && broke.reason === 'unaffordable',
    `ghost carries the unaffordable reason for the tint (got ${broke && broke.reason})`);
}

console.log('\n=== 3. Move previews ignore only the object being moved ===\n');

{
  const g = makeGame(105);
  const pl = PLACEABLES.flowerBed;
  const origin = findClearTile(g, pl);
  const id = g.placePlaceable({
    type: 'flowerBed', ...origin.snap, dir: 0, free: true, silent: true,
  });
  const entry = g.getPlaceable(id);
  assertOk(!!entry, 'setup: placed an object that remains in state while selected for moving');

  const renderer = makeRenderer();
  const input = makeInput(g, renderer, 'flowerBed');
  input.activeTool = {
    kind: 'move',
    payload: { kind: 'selectedPlaceable', placeableId: id, type: 'flowerBed' },
  };
  input.lastMouseWorldX = origin.iso.x;
  input.lastMouseWorldY = origin.iso.y;
  input._updatePlaceablePreview();
  assertOk(renderer.ghosts.at(-1)?.ok === true,
    'a moving object does not block its ghost on its own current footprint');

  const foreign = findClearTile(g, pl);
  const foreignId = g.placePlaceable({
    type: 'flowerBed', ...foreign.snap, dir: 0, free: true, silent: true,
  });
  assertOk(!!foreignId, 'setup: placed a foreign blocker');
  renderer.ghosts.length = 0;
  input.lastMouseWorldX = foreign.iso.x;
  input.lastMouseWorldY = foreign.iso.y;
  input._updatePlaceablePreview();
  assertOk(renderer.ghosts.at(-1)?.ok === false
      && renderer.ghosts.at(-1)?.reason === 'blocked',
  'self-exclusion still treats every other object as a blocker');
}

console.log('\n=== 4. Line placement previews only what the budget covers ===\n');

{
  const g = makeGame(103);
  const pl = PLACEABLES.flowerBed;
  const spot = findClearTile(g, pl);
  const renderer = makeRenderer();
  const input = makeInput(g, renderer, 'flowerBed');

  // Drag a long line from the clear tile; the budget covers 3 beds.
  const AFFORDABLE = 3;
  g.state.resources.funding = pl.cost.funding * AFFORDABLE;
  input.linePlaceStartWorld = { x: spot.iso.x, y: spot.iso.y };
  const end = tileCenterIso(spot.col + 12, spot.row);
  input._updateLinePlacePreview(end.x, end.y);

  const list = renderer.batches[renderer.batches.length - 1] || [];
  const valid = list.filter(h => h.valid);
  assertOk(list.length > AFFORDABLE,
    `setup: the drag produced more ghosts (${list.length}) than the budget covers`);
  assertOk(valid.length <= AFFORDABLE,
    `no more valid ghosts than the funds cover (got ${valid.length}, budget ${AFFORDABLE})`);
  assertOk(list.some(h => !h.valid && h.reason === 'unaffordable'),
    'the ghosts past the budget are flagged unaffordable, not silently green');

  // The commit filters on `valid`, so what the preview showed is what the
  // funds actually buy.
  const before = g.state.placeables.length;
  for (const h of valid) {
    g.placePlaceable({
      type: h.hover.id, col: h.hover.col, row: h.hover.row,
      subCol: h.hover.subCol, subRow: h.hover.subRow, dir: h.hover.dir,
    });
  }
  assertOk(g.state.placeables.length - before === valid.length,
    'every ghost the preview called valid was actually affordable at commit');
}

console.log('\n=== 5. Beamline junction + on-pipe ghosts respect the ledger ===\n');

function makeBeamlineRenderer() {
  return {
    ghosts: [],       // renderPlaceableGhost: junctions
    attachments: [],  // renderAttachmentGhost: on-pipe placements
    gridOnly: [],     // renderPlacementGridOnly: no pipe under the cursor
    renderPlaceableGhost(hover, ok, reason = null) { this.ghosts.push({ hover, ok, reason }); },
    renderAttachmentGhost(col, row, type, dir, valid, reason = null) {
      this.attachments.push({ col, row, type, dir, valid, reason });
    },
    renderPlacementGridOnly(col, row, hint = null) { this.gridOnly.push({ col, row, hint }); },
  };
}

{
  const g = makeGame(104);
  const pl = PLACEABLES.source;
  const spot = findClearTile(g, pl);
  const renderer = makeBeamlineRenderer();
  const c = new BeamlineInputController({
    game: g, renderer, inputHandler: { placementDir: 0, selectedParamOverrides: null },
  });

  c.onHover(spot.iso.x, spot.iso.y, 'source');
  assertOk(renderer.ghosts.at(-1)?.ok === true, 'junction ghost is valid with funds');

  g.state.resources.funding = 0;
  c.onHover(spot.iso.x, spot.iso.y, 'source');
  const broke = renderer.ghosts.at(-1);
  assertOk(broke?.ok === false && broke?.reason === 'unaffordable',
    `junction ghost is invalid + flagged unaffordable when broke (got ${broke?.reason})`);
}

{
  // On-pipe placement: a hand-built straight pipe with no existing placements,
  // so the slot is always geometrically free and only cost can refuse.
  const def = COMPONENTS.quadrupole;
  const pipe = {
    id: 'bp_1', subL: 40, placements: [],
    path: [{ col: 6, row: 6 }, { col: 16, row: 6 }],
  };
  const state = { beamPipes: [pipe], placementMode: 'snap' };
  const renderer = makeBeamlineRenderer();
  let funding = def.cost.funding;
  // Fix round 3: the on-pipe ghost now also quotes/checks spares
  // (componentCostFor) — fund it generously here too (1e9, same as
  // makeGame's own funding line does for the real-Game scenarios above),
  // so `funding` stays the only knob this fake canAfford's two scenarios
  // actually turn.
  let spares = 1e9;
  const game = {
    state,
    canAfford: (cost) => Object.entries(cost).every(([r, a]) => {
      if (r === 'funding') return funding >= a;
      if (r === 'spares') return spares >= a;
      return 0 >= a;
    }),
  };
  const c = new BeamlineInputController({
    game, renderer, inputHandler: { placementDir: 0, selectedParamOverrides: null },
  });

  // Cursor on the pipe's midpoint. _cursorWorldXZ converts iso → world by way
  // of isoToGridFloat, so feed it the iso position of that tile.
  const on = tileCenterIso(11, 6);
  c.onHover(on.x, on.y, 'quadrupole');
  assertOk(renderer.attachments.at(-1)?.valid === true,
    'on-pipe ghost is valid over a free stretch with funds');

  funding = def.cost.funding - 1;
  c.onHover(on.x, on.y, 'quadrupole');
  const broke = renderer.attachments.at(-1);
  assertOk(broke?.valid === false && broke?.reason === 'unaffordable',
    `on-pipe ghost is invalid + flagged unaffordable when broke (got ${broke?.reason})`);

  // B5: away from any pipe the tool used to show a bare grid with no cue that
  // the component needs a pipe at all.
  const off = tileCenterIso(11, 20);
  c.onHover(off.x, off.y, 'quadrupole');
  assertOk(renderer.gridOnly.at(-1)?.hint === 'needs-pipe',
    'off-pipe hover asks the renderer for the needs-a-pipe cue');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
