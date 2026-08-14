// test/test-flood-aim.js — floodLight aim: `dir` persists across placement
// and save/load, and the yaw math is correct and does not silently break.
//
// THREE is a CDN global (see lighting-builder.js / decoration-builder.js
// headers) — this test never calls buildLightFixture or anything else that
// constructs a THREE object. It exercises three things headlessly:
//  1. The pure aim predicate/yaw math lighting-builder.js exports.
//  2. decoration-builder.js's lightingYaw opt-out: a cone-shaped ground
//     fixture (floodLight) must NOT get the deterministic per-seed random
//     yaw ordinary decorations get (see _oakTree's rng-driven yaw at the top
//     of decoration-builder.js); a point fixture (lamppost) may keep it.
//     Stacking random yaw on top of an aim would silently destroy it.
//  3. Real Game state: dir 0-3 survives placement and a serialize -> load
//     round trip, using the existing placePlaceable/serialize/load API
//     (see test-game-serialize.js for the same pattern).

import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import { LIGHTING_DEFS } from '../src/data/placeables/lighting.js';
import { isAimedFixture, aimYaw } from '../src/renderer3d/lighting-builder.js';
import { lightingYaw } from '../src/renderer3d/decoration-builder.js';

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
function ok(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

const floodLight = LIGHTING_DEFS.find(d => d.id === 'floodLight');
const highBay = LIGHTING_DEFS.find(d => d.id === 'highBay');
const lamppost = LIGHTING_DEFS.find(d => d.id === 'lamppost');

console.log('\n=== isAimedFixture: only ground + cone is aimed ===\n');
ok(floodLight && floodLight.mount === 'ground' && floodLight.light.shape === 'cone',
   'floodLight is ground-mounted with a cone shape (sanity check on the def)');
ok(isAimedFixture(floodLight), 'floodLight (ground, cone) is aimed');
ok(!isAimedFixture(lamppost), 'lamppost (ground, point) is not aimed');
ok(highBay && highBay.mount === 'overhead' && highBay.light.shape === 'cone',
   'highBay is overhead with a cone shape (sanity check on the def)');
ok(!isAimedFixture(highBay), 'highBay (overhead, cone) is not aimed — it points straight down, dir does not apply');

console.log('\n=== aimYaw matches the codebase -dir * 90deg convention ===\n');
for (const dir of [0, 1, 2, 3]) {
  ok(aimYaw(dir) === -dir * (Math.PI / 2), `aimYaw(${dir}) === -${dir} * PI/2`);
}

console.log('\n=== lightingYaw opt-out: cone ignores jitter, point may keep it ===\n');
{
  const seeds = [1, 2, 12345, 999999];
  for (const dir of [0, 1, 2, 3]) {
    const rotY = -dir * (Math.PI / 2);
    for (const seed of seeds) {
      ok(lightingYaw(floodLight, rotY, seed) === rotY,
         `floodLight (cone) dir=${dir} seed=${seed}: yaw is exactly the aim, no added jitter`);
    }
  }

  // Point fixture: same rotY inputs, but the seed is *allowed* to move the
  // final yaw away from the pure dir rotation — that's the "may keep it"
  // deterministic jitter ordinary decorations get.
  const rotY = -1 * (Math.PI / 2);
  let anyJittered = false;
  for (const seed of seeds) {
    if (lightingYaw(lamppost, rotY, seed) !== rotY) anyJittered = true;
  }
  ok(anyJittered, 'lamppost (point) yaw is allowed to differ from the pure dir rotation across seeds');

  // Deterministic, not Math.random(): same inputs always give the same yaw.
  ok(lightingYaw(lamppost, rotY, 42) === lightingYaw(lamppost, rotY, 42),
     'lamppost yaw is deterministic for a given seed (repeatable across rebuilds)');
}

console.log('\n=== dir 0-3 persists through placement and a serialize -> load round trip ===\n');

function makeGame(seed) {
  const g = new Game(new BeamlineRegistry(), { seed });
  g.state.resources.funding = 1e9;
  return g;
}

// floodLight is a bare 1x1 ground decoration with no floor/zone requirement,
// so any free subtile works — scan for one the way test-game-serialize.js
// scans for a free pad, just at 1x1 grain.
function findFreeTile(g) {
  for (let row = 2; row < 80; row++) {
    for (let col = 2; col < 80; col++) {
      if (!g.state.subgridOccupied[`${col},${row},0,0`]) return { col, row };
    }
  }
  return null;
}

for (const dir of [0, 1, 2, 3]) {
  const g = makeGame(1);
  const spot = findFreeTile(g);
  ok(spot, `dir=${dir}: found a free tile to place on`);
  if (!spot) continue;

  const id = g.placePlaceable({ type: 'floodLight', col: spot.col, row: spot.row, dir, free: true });
  ok(id, `dir=${dir}: placePlaceable succeeded`);
  if (!id) continue;

  const placed = g.getPlaceable(id);
  ok(placed && placed.dir === dir, `dir=${dir}: placed record carries dir=${dir} (got ${placed && placed.dir})`);

  const payload = g.serialize();
  localStorage.setItem('beamlineTycoon', payload);
  const g2 = makeGame(2); // different seed: load() must fully replace starter state
  ok(g2.load(), `dir=${dir}: load() succeeds on the saved payload`);
  const reloaded = g2.state.placeables.find(p => p.type === 'floodLight' && p.id === id);
  ok(reloaded && reloaded.dir === dir,
     `dir=${dir}: survives serialize -> load round trip (got ${reloaded && reloaded.dir})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
