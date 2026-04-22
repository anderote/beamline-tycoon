import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  separate,
  seekHerdCenter,
  align,
  wanderJitter,
  terrainBias,
  labAversion,
  seekExit,
  avoidObstacles,
  sumForces,
  WEIGHTS_WANDER,
  WEIGHTS_GRAZE,
  WEIGHTS_FLEE,
} from '../src/game/entities/steering.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function mag({ x, z }) {
  return Math.sqrt(x * x + z * z);
}

function approx(a, b, eps = 1e-9) {
  return Math.abs(a - b) < eps;
}

function assertApprox(a, b, msg, eps = 1e-6) {
  assert.ok(Math.abs(a - b) < eps, `${msg}: expected ~${b}, got ${a}`);
}

function assertZeroVec(v, msg) {
  assert.ok(
    approx(v.x, 0) && approx(v.z, 0),
    `${msg}: expected zero vector, got {x:${v.x}, z:${v.z}}`
  );
}

const DEER = {
  walkSpeed: 1.2,
  fleeSpeed: 4.0,
  minSpacing: 1.0,
  herdCohesionRadius: 4.0,
  wanderJitterStrength: 0.15,
  terrainBiasStrength: 0.3,
  labAversionRadius: 3.0,
  maxSteepness: 1.0,
};

// ─── Task 2: separate ────────────────────────────────────────────────────────

test('separate: no neighbors → zero vector', () => {
  const entity = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, z: 0 } };
  const v = separate(entity, [], DEER);
  assertZeroVec(v, 'separate with no neighbors');
});

test('separate: neighbor exactly at minSpacing → zero vector', () => {
  const entity = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, z: 0 } };
  const neighbor = { pos: { x: DEER.minSpacing, y: 0, z: 0 } };
  const v = separate(entity, [neighbor], DEER);
  assertZeroVec(v, 'separate at exact minSpacing');
});

test('separate: neighbor beyond minSpacing → zero vector', () => {
  const entity = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, z: 0 } };
  const neighbor = { pos: { x: DEER.minSpacing + 0.5, y: 0, z: 0 } };
  const v = separate(entity, [neighbor], DEER);
  assertZeroVec(v, 'separate beyond minSpacing');
});

test('separate: neighbor to the east → force points west', () => {
  const entity = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, z: 0 } };
  const neighbor = { pos: { x: 0.5, y: 0, z: 0 } }; // east, inside minSpacing
  const v = separate(entity, [neighbor], DEER);
  assert.ok(v.x < 0, `x should be negative (west), got ${v.x}`);
  assertApprox(v.z, 0, 'z should be zero');
});

test('separate: closer neighbor → larger magnitude', () => {
  const entity = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, z: 0 } };
  const close = { pos: { x: 0.2, y: 0, z: 0 } };
  const far = { pos: { x: 0.8, y: 0, z: 0 } };
  const vClose = separate(entity, [close], DEER);
  const vFar = separate(entity, [far], DEER);
  assert.ok(mag(vClose) > mag(vFar), `closer neighbor should produce larger force: ${mag(vClose)} vs ${mag(vFar)}`);
});

test('separate: two neighbors on opposite sides → forces cancel toward zero', () => {
  const entity = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, z: 0 } };
  const n1 = { pos: { x: 0.4, y: 0, z: 0 } };
  const n2 = { pos: { x: -0.4, y: 0, z: 0 } };
  const v = separate(entity, [n1, n2], DEER);
  assertApprox(v.x, 0, 'symmetric separation cancels', 1e-6);
});

// ─── Task 2: seekHerdCenter ──────────────────────────────────────────────────

test('seekHerdCenter: entity inside cohesion radius → zero vector', () => {
  const entity = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, z: 0 } };
  const herd = { center: { x: 1.0, z: 0.0 } }; // 1 unit away, < cohesionRadius 4
  const v = seekHerdCenter(entity, herd, DEER);
  assertZeroVec(v, 'seekHerdCenter inside radius');
});

test('seekHerdCenter: entity at center → zero vector', () => {
  const entity = { pos: { x: 5, y: 0, z: 5 }, vel: { x: 0, z: 0 } };
  const herd = { center: { x: 5, z: 5 } };
  const v = seekHerdCenter(entity, herd, DEER);
  assertZeroVec(v, 'seekHerdCenter at center');
});

test('seekHerdCenter: entity outside radius → points toward center', () => {
  const entity = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, z: 0 } };
  const herd = { center: { x: 10, z: 0 } }; // 10 units east, > cohesionRadius 4
  const v = seekHerdCenter(entity, herd, DEER);
  assert.ok(v.x > 0, `x should be positive (east), got ${v.x}`);
  assertApprox(v.z, 0, 'z should be zero');
});

test('seekHerdCenter: farther entity → larger magnitude', () => {
  const e1 = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, z: 0 } };
  const e2 = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, z: 0 } };
  const herd1 = { center: { x: 6, z: 0 } };
  const herd2 = { center: { x: 12, z: 0 } };
  const v1 = seekHerdCenter(e1, herd1, DEER);
  const v2 = seekHerdCenter(e2, herd2, DEER);
  assert.ok(mag(v2) > mag(v1), `farther entity gets larger pull: ${mag(v2)} vs ${mag(v1)}`);
});

// ─── Task 2: align ───────────────────────────────────────────────────────────

test('align: no neighbors → zero vector', () => {
  const entity = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 1, z: 0 } };
  const v = align(entity, []);
  assertZeroVec(v, 'align with no neighbors');
});

test('align: neighbors moving same direction → zero vector', () => {
  const entity = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 1, z: 0 } };
  const n1 = { vel: { x: 1, z: 0 } };
  const n2 = { vel: { x: 1, z: 0 } };
  const v = align(entity, [n1, n2]);
  assertZeroVec(v, 'align when already aligned');
});

test('align: all neighbors moving north, entity moving east → force points north', () => {
  const entity = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 1, z: 0 } };
  const n1 = { vel: { x: 0, z: 1 } };
  const n2 = { vel: { x: 0, z: 1 } };
  const v = align(entity, [n1, n2]);
  assert.ok(v.z > 0, `z should be positive (north), got ${v.z}`);
  assert.ok(v.x < 0 || approx(v.x, 0), `x should be zero or negative (away from east), got ${v.x}`);
});

test('align: single neighbor moving in opposite direction → force is large', () => {
  const entity = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 1, z: 0 } };
  const neighbor = { vel: { x: -1, z: 0 } };
  const v = align(entity, [neighbor]);
  assert.ok(mag(v) > 0, `force should be non-zero, got ${mag(v)}`);
  assert.ok(v.x < 0, `x should be negative, got ${v.x}`);
});

test('align: magnitude proportional to velocity delta', () => {
  const entity = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, z: 0 } };
  const smallDelta = [{ vel: { x: 0.5, z: 0 } }];
  const largeDelta = [{ vel: { x: 2.0, z: 0 } }];
  const v1 = align(entity, smallDelta);
  const v2 = align(entity, largeDelta);
  assert.ok(mag(v2) > mag(v1), `larger velocity delta → larger align force: ${mag(v2)} vs ${mag(v1)}`);
});

// ─── Task 3: wanderJitter ────────────────────────────────────────────────────

test('wanderJitter: magnitude ≤ wanderJitterStrength', () => {
  const entity = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, z: 0 }, heading: 0 };
  // Multiple rng seeds
  for (let seed = 0; seed < 20; seed++) {
    let n = seed * 0.05;
    const rng = () => { n = (n * 9301 + 49297) % 233280 / 233280; return n; };
    const v = wanderJitter(entity, DEER, rng);
    assert.ok(
      mag(v) <= DEER.wanderJitterStrength + 1e-9,
      `magnitude ${mag(v)} exceeds wanderJitterStrength ${DEER.wanderJitterStrength}`
    );
  }
});

test('wanderJitter: deterministic with fixed rng', () => {
  const entity = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, z: 0 }, heading: 0 };
  let calls = 0;
  const seqRng = () => [0.8, 0.3, 0.9, 0.1][calls++ % 4];
  const v1 = wanderJitter(entity, DEER, seqRng);
  calls = 0;
  const v2 = wanderJitter(entity, DEER, seqRng);
  assertApprox(v1.x, v2.x, 'x is deterministic');
  assertApprox(v1.z, v2.z, 'z is deterministic');
});

test('wanderJitter: non-zero output with typical rng values', () => {
  const entity = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, z: 0 }, heading: 0 };
  const rng = () => 0.9; // both axes biased positive
  const v = wanderJitter(entity, DEER, rng);
  assert.ok(mag(v) > 0, `should return non-zero vector, got ${mag(v)}`);
});

// ─── Task 3: terrainBias ─────────────────────────────────────────────────────

test('terrainBias: grass north, concrete south → biased toward north (−z)', () => {
  const entity = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, z: 0 }, heading: 0 };
  const sampler = {
    sampleHeight: () => 0,
    // north is −z; south is +z (z < 0 = north of entity at z=0)
    sampleGroundType: (x, z) => z < 0 ? 'grass' : 'concrete',
    isOccupied: () => false,
  };
  const v = terrainBias(entity, DEER, sampler);
  assert.ok(v.z < 0, `z should be negative (northward), got ${v.z}`);
});

test('terrainBias: uniform grass → near-zero magnitude', () => {
  const entity = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, z: 0 }, heading: 0 };
  const sampler = {
    sampleHeight: () => 0,
    sampleGroundType: () => 'grass',
    isOccupied: () => false,
  };
  const v = terrainBias(entity, DEER, sampler);
  assertApprox(mag(v), 0, 'uniform grass → near-zero', 1e-6);
});

test('terrainBias: grass east, concrete west → biased toward east (+x)', () => {
  const entity = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, z: 0 }, heading: 0 };
  const sampler = {
    sampleHeight: () => 0,
    sampleGroundType: (x, z) => x > 0 ? 'grass' : 'concrete',
    isOccupied: () => false,
  };
  const v = terrainBias(entity, DEER, sampler);
  assert.ok(v.x > 0, `x should be positive (east), got ${v.x}`);
});

test('terrainBias: scaled by terrainBiasStrength', () => {
  const entity = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, z: 0 }, heading: 0 };
  const sampler = {
    sampleHeight: () => 0,
    sampleGroundType: (x, z) => z < 0 ? 'grass' : 'concrete',
    isOccupied: () => false,
  };
  const speciesLow = { ...DEER, terrainBiasStrength: 0.1 };
  const speciesHigh = { ...DEER, terrainBiasStrength: 1.0 };
  const vLow = terrainBias(entity, speciesLow, sampler);
  const vHigh = terrainBias(entity, speciesHigh, sampler);
  assert.ok(mag(vHigh) > mag(vLow), `higher strength → larger force: ${mag(vHigh)} vs ${mag(vLow)}`);
});

// ─── Task 3: labAversion ─────────────────────────────────────────────────────

test('labAversion: occupied cell to the east → force points west', () => {
  const entity = {
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, z: 0 },
    heading: 0, // facing east (+x)
  };
  const sampler = {
    sampleHeight: () => 0,
    sampleGroundType: () => 'grass',
    isOccupied: (x, z) => x > 0 && Math.abs(z) < 1, // occupied to the east
  };
  const v = labAversion(entity, DEER, sampler);
  assert.ok(v.x < 0, `x should be negative (west), got ${v.x}`);
});

test('labAversion: no occupied cells → zero vector', () => {
  const entity = {
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, z: 0 },
    heading: 0,
  };
  const sampler = {
    sampleHeight: () => 0,
    sampleGroundType: () => 'grass',
    isOccupied: () => false,
  };
  const v = labAversion(entity, DEER, sampler);
  assertZeroVec(v, 'labAversion with no occupied cells');
});

test('labAversion: occupied cell beyond labAversionRadius → zero vector', () => {
  const entity = {
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, z: 0 },
    heading: 0,
  };
  const farRadius = DEER.labAversionRadius + 5;
  const sampler = {
    sampleHeight: () => 0,
    sampleGroundType: () => 'grass',
    isOccupied: (x, z) => Math.sqrt(x * x + z * z) > farRadius,
  };
  const v = labAversion(entity, DEER, sampler);
  assertZeroVec(v, 'labAversion beyond radius');
});

// ─── Task 3: seekExit ────────────────────────────────────────────────────────

test('seekExit: no exitTarget → zero vector', () => {
  const entity = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, z: 0 }, heading: 0 };
  const herd = { exitTarget: null };
  const v = seekExit(entity, herd, DEER);
  assertZeroVec(v, 'seekExit with no exitTarget');
});

test('seekExit: exitTarget to the north → force points north (−z)', () => {
  const entity = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, z: 0 }, heading: 0 };
  const herd = { exitTarget: { x: 0, z: -20 } };
  const v = seekExit(entity, herd, DEER);
  assert.ok(v.z < 0, `z should be negative (north), got ${v.z}`);
  assertApprox(v.x, 0, 'x should be zero');
});

test('seekExit: magnitude is species.fleeSpeed', () => {
  const entity = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, z: 0 }, heading: 0 };
  const herd = { exitTarget: { x: 10, z: 5 } };
  const v = seekExit(entity, herd, DEER);
  assertApprox(mag(v), DEER.fleeSpeed, 'magnitude equals fleeSpeed', 1e-6);
});

test('seekExit: direction does not depend on distance to target', () => {
  const entity = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, z: 0 }, heading: 0 };
  const herd1 = { exitTarget: { x: 5, z: 0 } };
  const herd2 = { exitTarget: { x: 50, z: 0 } };
  const v1 = seekExit(entity, herd1, DEER);
  const v2 = seekExit(entity, herd2, DEER);
  // Both should have the same magnitude (fleeSpeed) and same direction (+x)
  assertApprox(v1.x, v2.x, 'x component same for same direction', 1e-6);
  assertApprox(mag(v1), mag(v2), 'magnitude same regardless of distance', 1e-6);
});

// ─── Task 4: avoidObstacles ──────────────────────────────────────────────────

test('avoidObstacles: no obstacle ahead → zero vector', () => {
  const entity = {
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 1, z: 0 },
    heading: 0,
  };
  const sampler = {
    sampleHeight: () => 0,
    sampleGroundType: () => 'grass',
    isOccupied: () => false,
  };
  const v = avoidObstacles(entity, DEER, sampler);
  assertZeroVec(v, 'avoidObstacles with no obstacle');
});

test('avoidObstacles: occupied cell ahead → perpendicular vector', () => {
  const entity = {
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 2, z: 0 },
    heading: 0,
  };
  // Occupied directly ahead along +x; left (+z) side is free
  const sampler = {
    sampleHeight: () => 0,
    sampleGroundType: () => 'grass',
    isOccupied: (x, z) => x > 0.4 && Math.abs(z) < 0.3,
  };
  const v = avoidObstacles(entity, DEER, sampler);
  // Result should be perpendicular to vel (vel is along +x, so perp is ±z)
  assert.ok(mag(v) > 0, 'should return non-zero avoidance vector');
  assertApprox(v.x, 0, 'x should be ~zero (perpendicular to +x vel)', 0.01);
  assert.ok(Math.abs(v.z) > 0.9, `z should be ~±1, got ${v.z}`);
});

test('avoidObstacles: occupied → picks side with free space', () => {
  const entity = {
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 2, z: 0 },
    heading: 0,
  };
  // Occupied ahead AND to the right (+z when vel is +x, right is -z, left is +z)
  // Wait: vel=(1,0), left=CCW=(0,1)=+z, right=CW=(0,-1)=−z
  // Make left (+z) free and right (-z) occupied
  const sampler = {
    sampleHeight: () => 0,
    sampleGroundType: () => 'grass',
    isOccupied: (x, z) => (x > 0.4 && Math.abs(z) < 0.3) || z < -0.2,
  };
  const v = avoidObstacles(entity, DEER, sampler);
  assert.ok(v.z > 0, `should steer left (+z, free side), got z=${v.z}`);
});

test('avoidObstacles: steep slope ahead → perpendicular avoidance', () => {
  const entity = {
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 2, z: 0 },
    heading: 0,
  };
  const sampler = {
    sampleHeight: (x, z) => x > 0.4 ? 5.0 : 0.0, // steep cliff ahead (+x)
    sampleGroundType: () => 'grass',
    isOccupied: () => false,
  };
  const v = avoidObstacles(entity, DEER, sampler);
  assert.ok(mag(v) > 0, 'steep slope should trigger avoidance');
  assertApprox(v.x, 0, 'x should be ~zero (perp to +x vel)', 0.01);
});

// ─── Task 4: sumForces ───────────────────────────────────────────────────────

test('sumForces: WEIGHTS_GRAZE → zero velocity (all weights zero)', () => {
  const entity = {
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, z: 0 },
    heading: 0,
  };
  const herd = { center: { x: 10, z: 0 }, exitTarget: null };
  const sampler = {
    sampleHeight: () => 0,
    sampleGroundType: () => 'grass',
    isOccupied: () => false,
  };
  const v = sumForces(entity, herd, [], sampler, DEER, WEIGHTS_GRAZE, 'graze', Math.random);
  assertZeroVec(v, 'sumForces in graze state');
});

test('sumForces: result magnitude ≤ walkSpeed in wander state', () => {
  const entity = {
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, z: 0 },
    heading: 0,
  };
  const herd = { center: { x: 20, z: 0 }, exitTarget: null };
  const sampler = {
    sampleHeight: () => 0,
    sampleGroundType: () => 'grass',
    isOccupied: () => false,
  };
  const rng = () => 0.9;
  const v = sumForces(entity, herd, [], sampler, DEER, WEIGHTS_WANDER, 'wander', rng);
  assert.ok(
    mag(v) <= DEER.walkSpeed + 1e-9,
    `magnitude ${mag(v)} exceeds walkSpeed ${DEER.walkSpeed}`
  );
});

test('sumForces: result magnitude ≤ fleeSpeed in flee state', () => {
  const entity = {
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, z: 0 },
    heading: 0,
  };
  const herd = { center: { x: 0, z: 0 }, exitTarget: { x: 100, z: 0 } };
  const sampler = {
    sampleHeight: () => 0,
    sampleGroundType: () => 'grass',
    isOccupied: () => false,
  };
  const v = sumForces(entity, herd, [], sampler, DEER, WEIGHTS_FLEE, 'flee', Math.random);
  assert.ok(
    mag(v) <= DEER.fleeSpeed + 1e-9,
    `magnitude ${mag(v)} exceeds fleeSpeed ${DEER.fleeSpeed}`
  );
});

test('sumForces: known force set with known weights produces expected result', () => {
  // Use trivial scenario: only seekHerdCenter active with weight 1.0
  // entity at (0,0), herd center at (10,0) → distance 10, cohesionRadius 4
  // seekHerdCenter returns (excess=6, dir=(1,0)) → {x:6, z:0}
  // with weight 1.0 → {x:6, z:0}, then clamp to walkSpeed 1.2 → {x:1.2, z:0}
  const weights = { ...WEIGHTS_GRAZE, seekHerdCenter: 1.0 };
  const entity = {
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, z: 0 },
    heading: 0,
  };
  const herd = { center: { x: 10, z: 0 }, exitTarget: null };
  const sampler = {
    sampleHeight: () => 0,
    sampleGroundType: () => 'grass',
    isOccupied: () => false,
  };
  const v = sumForces(entity, herd, [], sampler, DEER, weights, 'wander', Math.random);
  assertApprox(v.x, DEER.walkSpeed, 'clamped to walkSpeed in +x direction', 1e-6);
  assertApprox(v.z, 0, 'z is zero');
});

test('sumForces: WEIGHTS_FLEE uses fleeSpeed cap, not walkSpeed', () => {
  // seekExit with weight 1.0, exit is due east → force = fleeSpeed east
  const entity = {
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, z: 0 },
    heading: 0,
  };
  const herd = { center: { x: 0, z: 0 }, exitTarget: { x: 100, z: 0 } };
  const sampler = {
    sampleHeight: () => 0,
    sampleGroundType: () => 'grass',
    isOccupied: () => false,
  };
  const v = sumForces(entity, herd, [], sampler, DEER, WEIGHTS_FLEE, 'flee', Math.random);
  // seekExit produces fleeSpeed magnitude; clamp doesn't reduce it
  assertApprox(mag(v), DEER.fleeSpeed, 'flee result is exactly fleeSpeed', 1e-6);
  assert.ok(v.x > 0, 'flee force points east (+x)');
});
