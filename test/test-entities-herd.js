import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createHerd,
  startleHerd,
  tickHerd,
  tickEntity,
} from '../src/game/entities/herd.js';
import { spawnHerd } from '../src/game/entities/spawner.js';
import { entitiesTick } from '../src/game/entities/index.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function assertApprox(a, b, msg, eps = 1e-6) {
  assert.ok(Math.abs(a - b) < eps, `${msg}: expected ~${b}, got ${a}`);
}

const DEER = {
  spookRadius: 6.0,
  cursorSpookRadius: 4.0,
  cursorSpookDwell: 0.5,
  grazeChance: 0.02,
  grazeDurationRange: [3, 8],
};

const MAP_BOUNDS = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };

function makeHerd(overrides = {}) {
  return createHerd({
    id: 'h1',
    type: 'deer',
    entityIds: ['e1'],
    center: { x: 0, z: 0 },
    ...overrides,
  });
}

function makeEntity(overrides = {}) {
  return {
    id: 'e1',
    type: 'deer',
    herdId: 'h1',
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, z: 0 },
    heading: 0,
    state: 'wander',
    stateTimer: 0,
    animPhase: 0,
    ...overrides,
  };
}

// ─── Task 5: createHerd ──────────────────────────────────────────────────────

test('createHerd: returns calm herd with expected defaults', () => {
  const herd = createHerd({ id: 'h1', type: 'deer', entityIds: ['e1'], center: { x: 5, z: 10 } });
  assert.equal(herd.state, 'calm');
  assert.equal(herd.alarmTimer, 0);
  assert.equal(herd.exitTarget, null);
  assert.equal(herd.cursorDwellTimer, 0);
  assert.deepEqual(herd.wanderTarget, { x: 5, z: 10 });
});

test('createHerd: id, type, entityIds preserved', () => {
  const herd = createHerd({ id: 'myHerd', type: 'deer', entityIds: ['a', 'b'], center: { x: 0, z: 0 } });
  assert.equal(herd.id, 'myHerd');
  assert.equal(herd.type, 'deer');
  assert.deepEqual(herd.entityIds, ['a', 'b']);
});

// ─── Task 5: startleHerd ────────────────────────────────────────────────────

test('startleHerd: sets state=alarmed and alarmTimer=10', () => {
  const herd = makeHerd();
  startleHerd(herd, { x: 5, z: 0 }, MAP_BOUNDS, DEER);
  assert.equal(herd.state, 'alarmed');
  assert.equal(herd.alarmTimer, 10);
});

test('startleHerd: exitTarget is nearest map edge to herd center', () => {
  // center at (0,0) in [-50,50]x[-50,50]; all edges equidistant — pick any stable result
  const herd = makeHerd({ center: { x: 0, z: 0 } });
  startleHerd(herd, { x: 0, z: 0 }, MAP_BOUNDS, DEER);
  assert.ok(herd.exitTarget !== null, 'exitTarget should be set');
});

test('startleHerd: center near minX edge → exitTarget.x ≈ minX', () => {
  const herd = makeHerd({ center: { x: -45, z: 0 } });
  startleHerd(herd, { x: -45, z: 0 }, MAP_BOUNDS, DEER);
  // Nearest edge is minX=-50, projection is (-50, 0)
  assertApprox(herd.exitTarget.x, -50, 'exitTarget.x should be -50');
  assertApprox(herd.exitTarget.z, 0, 'exitTarget.z should be 0');
});

test('startleHerd: center near maxZ edge → exitTarget.z ≈ maxZ', () => {
  const herd = makeHerd({ center: { x: 0, z: 45 } });
  startleHerd(herd, { x: 0, z: 45 }, MAP_BOUNDS, DEER);
  assertApprox(herd.exitTarget.z, 50, 'exitTarget.z should be 50');
  assertApprox(herd.exitTarget.x, 0, 'exitTarget.x should be 0');
});

test('startleHerd: idempotent — second call does not reset timer or exitTarget', () => {
  const herd = makeHerd({ center: { x: -45, z: 0 } });
  startleHerd(herd, { x: -45, z: 0 }, MAP_BOUNDS, DEER);
  const savedTarget = { ...herd.exitTarget };
  // Manually decay timer to simulate partial alarm
  herd.alarmTimer = 7;
  // Second startle
  startleHerd(herd, { x: 10, z: 0 }, MAP_BOUNDS, DEER);
  assert.equal(herd.alarmTimer, 7, 'timer should not be reset');
  assert.deepEqual(herd.exitTarget, savedTarget, 'exitTarget should not change');
});

// ─── Task 5: tickHerd — alarm timer ─────────────────────────────────────────

test('tickHerd: alarmed herd decrements alarmTimer by dt', () => {
  const herd = makeHerd();
  startleHerd(herd, { x: 0, z: 0 }, MAP_BOUNDS, DEER);
  assert.equal(herd.alarmTimer, 10);
  const members = [makeEntity()];
  tickHerd(herd, members, 1.0, { mapBounds: MAP_BOUNDS, cursorPos: null, recentPlacements: [], species: DEER });
  assertApprox(herd.alarmTimer, 9.0, 'alarmTimer should be 9 after dt=1');
});

test('tickHerd: alarmTimer reaching zero transitions back to calm', () => {
  const herd = makeHerd();
  startleHerd(herd, { x: 0, z: 0 }, MAP_BOUNDS, DEER);
  const members = [makeEntity()];
  const ctx = { mapBounds: MAP_BOUNDS, cursorPos: null, recentPlacements: [], species: DEER };
  // Advance enough to drain timer
  tickHerd(herd, members, 10.0, ctx);
  assert.equal(herd.state, 'calm');
  assert.equal(herd.exitTarget, null);
  assertApprox(herd.alarmTimer, 0, 'alarmTimer should be 0 when calm');
});

test('tickHerd: calm herd stays calm with no triggers', () => {
  const herd = makeHerd();
  const members = [makeEntity()];
  tickHerd(herd, members, 1.0, { mapBounds: MAP_BOUNDS, cursorPos: null, recentPlacements: [], species: DEER });
  assert.equal(herd.state, 'calm');
});

// ─── Task 6: cursor dwell trigger ───────────────────────────────────────────

test('tickHerd: cursor within radius for dt=0.6 (>dwell 0.5) → alarms herd', () => {
  const herd = makeHerd();
  // Member at (0,0), cursor at (1,1) — distance ~1.41, within cursorSpookRadius=4
  const members = [makeEntity({ pos: { x: 0, y: 0, z: 0 } })];
  const ctx = { mapBounds: MAP_BOUNDS, cursorPos: { x: 1, z: 1 }, recentPlacements: [], species: DEER };
  tickHerd(herd, members, 0.6, ctx);
  assert.equal(herd.state, 'alarmed');
});

test('tickHerd: cursor in radius for dt=0.3 then out of radius → does NOT alarm, dwellTimer reset', () => {
  const herd = makeHerd();
  const members = [makeEntity({ pos: { x: 0, y: 0, z: 0 } })];
  // First tick: cursor nearby
  tickHerd(herd, members, 0.3, { mapBounds: MAP_BOUNDS, cursorPos: { x: 1, z: 1 }, recentPlacements: [], species: DEER });
  assert.equal(herd.state, 'calm', 'should still be calm after 0.3s');
  // Second tick: cursor far away
  tickHerd(herd, members, 0.3, { mapBounds: MAP_BOUNDS, cursorPos: { x: 999, z: 999 }, recentPlacements: [], species: DEER });
  assert.equal(herd.state, 'calm', 'should still be calm after cursor left');
  assertApprox(herd.cursorDwellTimer, 0, 'cursorDwellTimer should be 0 after cursor left radius');
});

test('tickHerd: cursor in radius for two ticks of dt=0.3 → alarms on second tick', () => {
  const herd = makeHerd();
  const members = [makeEntity({ pos: { x: 0, y: 0, z: 0 } })];
  const ctx = { mapBounds: MAP_BOUNDS, cursorPos: { x: 1, z: 1 }, recentPlacements: [], species: DEER };
  // First tick: accumulate 0.3
  tickHerd(herd, members, 0.3, ctx);
  assert.equal(herd.state, 'calm', 'should be calm after first tick');
  // Second tick: total 0.6 > 0.5 threshold
  tickHerd(herd, members, 0.3, ctx);
  assert.equal(herd.state, 'alarmed', 'should be alarmed after second tick');
});

test('tickHerd: cursor well outside cursorSpookRadius → no dwell accumulation', () => {
  const herd = makeHerd();
  const members = [makeEntity({ pos: { x: 0, y: 0, z: 0 } })];
  // cursor at (100, 0), way outside radius 4
  const ctx = { mapBounds: MAP_BOUNDS, cursorPos: { x: 100, z: 0 }, recentPlacements: [], species: DEER };
  tickHerd(herd, members, 1.0, ctx);
  assert.equal(herd.state, 'calm');
  assertApprox(herd.cursorDwellTimer, 0, 'dwellTimer stays 0 when cursor far away');
});

// ─── Task 7: construction-startle via recentPlacements ──────────────────────

test('tickHerd: recentPlacement within spookRadius of member → alarms herd', () => {
  const herd = makeHerd();
  const members = [makeEntity({ pos: { x: 0, y: 0, z: 0 } })];
  // placement at (3, 0) — within spookRadius=6
  const ctx = { mapBounds: MAP_BOUNDS, cursorPos: null, recentPlacements: [{ x: 3, z: 0 }], species: DEER };
  tickHerd(herd, members, 0.1, ctx);
  assert.equal(herd.state, 'alarmed');
});

test('tickHerd: recentPlacement outside spookRadius → no alarm', () => {
  const herd = makeHerd();
  const members = [makeEntity({ pos: { x: 0, y: 0, z: 0 } })];
  // placement at (20, 0) — outside spookRadius=6
  const ctx = { mapBounds: MAP_BOUNDS, cursorPos: null, recentPlacements: [{ x: 20, z: 0 }], species: DEER };
  tickHerd(herd, members, 0.1, ctx);
  assert.equal(herd.state, 'calm');
});

test('tickHerd: already alarmed + new recentPlacement → idempotent (timer unchanged)', () => {
  const herd = makeHerd();
  startleHerd(herd, { x: 0, z: 0 }, MAP_BOUNDS, DEER);
  herd.alarmTimer = 5;
  const members = [makeEntity({ pos: { x: 0, y: 0, z: 0 } })];
  const ctx = { mapBounds: MAP_BOUNDS, cursorPos: null, recentPlacements: [{ x: 1, z: 0 }], species: DEER };
  tickHerd(herd, members, 0.1, ctx);
  // Timer should have decremented (0.1), not reset to 10
  assertApprox(herd.alarmTimer, 4.9, 'timer decrements, not reset to 10');
});

// ─── Task 7: tickEntity — flee when herd alarmed ────────────────────────────

test('tickEntity: alarmed herd → entity transitions to flee regardless of prior state', () => {
  const herd = makeHerd();
  herd.state = 'alarmed';
  herd.exitTarget = { x: 50, z: 0 };
  const entity = makeEntity({ state: 'graze' });
  tickEntity(entity, herd, DEER, 0.1, { rng: Math.random, isOnGrass: true });
  assert.equal(entity.state, 'flee');
  assertApprox(entity.stateTimer, 0, 'stateTimer reset on transition to flee');
});

test('tickEntity: alarmed herd → wander entity also becomes flee', () => {
  const herd = makeHerd();
  herd.state = 'alarmed';
  herd.exitTarget = { x: 50, z: 0 };
  const entity = makeEntity({ state: 'wander' });
  tickEntity(entity, herd, DEER, 0.1, { rng: Math.random, isOnGrass: true });
  assert.equal(entity.state, 'flee');
});

test('tickEntity: alarmed herd → already-flee entity stays flee, stateTimer accumulates', () => {
  const herd = makeHerd();
  herd.state = 'alarmed';
  const entity = makeEntity({ state: 'flee', stateTimer: 1.0 });
  tickEntity(entity, herd, DEER, 0.5, { rng: Math.random, isOnGrass: false });
  assert.equal(entity.state, 'flee');
  assertApprox(entity.stateTimer, 1.5, 'stateTimer accumulates while already in flee');
});

// ─── Task 7: tickEntity — wander → graze ────────────────────────────────────

test('tickEntity: calm + wander + on grass + rng=1.0 (above any threshold) → transitions to graze', () => {
  const herd = makeHerd();
  // grazeChance=0.02, dt=1.0 → threshold=0.02. rng always returns 0.0 < 0.02 → graze
  const entity = makeEntity({ state: 'wander' });
  let callCount = 0;
  const rng = () => { callCount++; return 0.0; }; // always triggers graze
  tickEntity(entity, herd, DEER, 1.0, { rng, isOnGrass: true });
  assert.equal(entity.state, 'graze', 'should transition to graze with rng=0.0');
  assertApprox(entity.stateTimer, 0, 'stateTimer reset on graze entry');
  assert.ok(entity.grazeDuration !== undefined, 'grazeDuration should be set on graze entry');
});

test('tickEntity: calm + wander + on grass + rng=1.0 (never triggers) → stays wander', () => {
  const herd = makeHerd();
  const entity = makeEntity({ state: 'wander' });
  const rng = () => 1.0; // never below any threshold
  tickEntity(entity, herd, DEER, 1.0, { rng, isOnGrass: true });
  assert.equal(entity.state, 'wander', 'should stay wander when rng is high');
});

test('tickEntity: calm + wander + NOT on grass → stays wander regardless of rng', () => {
  const herd = makeHerd();
  const entity = makeEntity({ state: 'wander' });
  const rng = () => 0.0; // would trigger graze on grass
  tickEntity(entity, herd, DEER, 1.0, { rng, isOnGrass: false });
  assert.equal(entity.state, 'wander', 'should not graze off grass');
});

test('tickEntity: wander→graze assigns grazeDuration from grazeDurationRange', () => {
  const herd = makeHerd();
  const entity = makeEntity({ state: 'wander' });
  // rng returns 0.5 → grazeDuration = 3 + 0.5*(8-3) = 5.5
  const rng = () => 0.5;
  // Force graze by making grazeChance=1.0 and dt=1.0 → threshold=1.0, rng=0.5 < 1.0
  const speciesHighChance = { ...DEER, grazeChance: 1.0 };
  tickEntity(entity, herd, speciesHighChance, 1.0, { rng, isOnGrass: true });
  assert.equal(entity.state, 'graze');
  // First rng call is for graze check, second is for grazeDuration
  assertApprox(entity.grazeDuration, 5.5, 'grazeDuration = lerp(3,8,0.5)');
});

// ─── Task 7: tickEntity — graze → wander ────────────────────────────────────

test('tickEntity: graze + stateTimer exceeds grazeDuration → transitions to wander', () => {
  const herd = makeHerd();
  const entity = makeEntity({ state: 'graze', stateTimer: 4.9, grazeDuration: 5.0 });
  tickEntity(entity, herd, DEER, 0.2, { rng: Math.random, isOnGrass: true });
  assert.equal(entity.state, 'wander', 'should transition back to wander after grazeDuration');
  assertApprox(entity.stateTimer, 0, 'stateTimer reset on wander entry');
  assert.equal(entity.grazeDuration, undefined, 'grazeDuration cleared on graze exit');
});

test('tickEntity: graze + stateTimer not yet at grazeDuration → stays graze', () => {
  const herd = makeHerd();
  const entity = makeEntity({ state: 'graze', stateTimer: 1.0, grazeDuration: 5.0 });
  tickEntity(entity, herd, DEER, 0.5, { rng: Math.random, isOnGrass: true });
  assert.equal(entity.state, 'graze', 'should stay in graze');
  assertApprox(entity.stateTimer, 1.5, 'stateTimer advances while grazing');
});

test('tickEntity: stateTimer increments by dt in wander state', () => {
  const herd = makeHerd();
  const entity = makeEntity({ state: 'wander', stateTimer: 2.0 });
  const rng = () => 1.0; // no transition
  tickEntity(entity, herd, DEER, 0.3, { rng, isOnGrass: false });
  assertApprox(entity.stateTimer, 2.3, 'stateTimer should increment by dt in wander');
});

// ─── Task 10: entitiesTick integration smoke test ───────────────────────────

// Minimal fake game object that satisfies entitiesTick's requirements.
function makeFakeGame() {
  const state = {
    mapCols: 20,
    mapRows: 20,
    cornerHeights: new Map(), // flat terrain (all zeros)
    floors: [],
    infraOccupied: {},
    subgridOccupied: {},
    placeables: [],
    entities: [],
    herds: [],
    _entitiesLastPlaceableIds: null,
    _herdRespawnCooldown: 0,
  };
  return { state, inputHandler: null };
}

test('entitiesTick smoke: runs without throwing on minimal game stub', () => {
  const game = makeFakeGame();
  // Manually spawn a herd so there is something to tick
  const worldSampler = {
    sampleHeight: () => 0,
    sampleGroundType: () => null,
    isOccupied: () => false,
  };
  const mapBounds = { minX: 0, maxX: 40, minZ: 0, maxZ: 40 };
  const rng = Math.random;
  spawnHerd(game.state, { ...DEER }, worldSampler, rng, mapBounds);

  assert.equal(game.state.herds.length, 1, 'herd should exist after manual spawn');
  assert.ok(game.state.entities.length >= 3, 'at least 3 entities after spawn');

  // Snapshot initial positions
  const initialPositions = game.state.entities.map(e => ({ x: e.pos.x, z: e.pos.z }));

  // Run 5 ticks
  for (let i = 0; i < 5; i++) {
    assert.doesNotThrow(() => entitiesTick(game), `tick ${i} should not throw`);
  }

  // The original herd should still exist (not despawned — entities start near
  // edge but calm herds are never despawned; maintainHerdCount may add more).
  assert.ok(game.state.herds.length >= 1, 'at least one herd should exist after 5 ticks');

  // At least one entity should have moved from its initial position
  const moved = game.state.entities.some((e, i) => {
    const init = initialPositions[i];
    return Math.abs(e.pos.x - init.x) > 1e-10 || Math.abs(e.pos.z - init.z) > 1e-10;
  });
  assert.ok(moved, 'at least one entity should have moved after 5 ticks');
});
