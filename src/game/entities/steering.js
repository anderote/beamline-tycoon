// Pure steering force functions. All return {x, z} vectors.
// Entities are plain objects with pos:{x,y,z}, vel:{x,z}, heading:number.
// worldSampler: { sampleHeight(x,z), sampleGroundType(x,z), isOccupied(x,z) }

// ─── vector helpers (local, not exported) ───────────────────────────────────

function len(v) {
  return Math.sqrt(v.x * v.x + v.z * v.z);
}

function normalize(v) {
  const l = len(v);
  if (l < 1e-10) return { x: 0, z: 0 };
  return { x: v.x / l, z: v.z / l };
}

function scale(v, s) {
  return { x: v.x * s, z: v.z * s };
}

function add(a, b) {
  return { x: a.x + b.x, z: a.z + b.z };
}

function sub(a, b) {
  return { x: a.x - b.x, z: a.z - b.z };
}

function clampMag(v, max) {
  const l = len(v);
  if (l <= max || l < 1e-10) return v;
  return scale(v, max / l);
}

// ─── Task 2: Core flocking forces ───────────────────────────────────────────

/**
 * Returns a repulsion vector away from any neighbor within species.minSpacing.
 * Magnitude grows as distance shrinks (inversely proportional to distance).
 */
export function separate(entity, neighbors, species) {
  let force = { x: 0, z: 0 };
  for (const neighbor of neighbors) {
    const dx = entity.pos.x - neighbor.pos.x;
    const dz = entity.pos.z - neighbor.pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist >= species.minSpacing || dist < 1e-10) continue;
    const strength = (species.minSpacing - dist) / species.minSpacing;
    const dir = normalize({ x: dx, z: dz });
    force = add(force, scale(dir, strength));
  }
  return force;
}

/**
 * Returns a vector pulling entity toward herd.center when it is outside
 * species.herdCohesionRadius. Magnitude scales with excess distance.
 */
export function seekHerdCenter(entity, herd, species) {
  const dx = herd.center.x - entity.pos.x;
  const dz = herd.center.z - entity.pos.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist <= species.herdCohesionRadius) return { x: 0, z: 0 };
  const excess = dist - species.herdCohesionRadius;
  const dir = normalize({ x: dx, z: dz });
  return scale(dir, excess);
}

/**
 * Returns a vector nudging entity's velocity toward the mean neighbor velocity.
 * Magnitude is the magnitude of the delta between mean-neighbor-vel and entity.vel.
 */
export function align(entity, neighbors) {
  if (neighbors.length === 0) return { x: 0, z: 0 };
  let sumX = 0, sumZ = 0;
  for (const n of neighbors) {
    sumX += n.vel.x;
    sumZ += n.vel.z;
  }
  const meanVel = { x: sumX / neighbors.length, z: sumZ / neighbors.length };
  return sub(meanVel, entity.vel);
}

// ─── Task 3: Wander and bias forces ─────────────────────────────────────────

const SOFTNESS = {
  grass: 1.0,
  wildgrass: 1.0,
  tallgrass: 0.9,
  dirt: 0.5,
  concrete: 0.0,
};

function groundSoftness(type) {
  return SOFTNESS[type] ?? 0.5;
}

/**
 * Returns a small random jitter vector. Uses injected rng() → [0,1).
 * Magnitude is at most species.wanderJitterStrength.
 */
export function wanderJitter(entity, species, rng) {
  // rng() gives [0,1). Map to [-1,1) for each axis.
  const x = (rng() * 2 - 1);
  const z = (rng() * 2 - 1);
  return clampMag({ x, z }, species.wanderJitterStrength);
}

/**
 * Returns a bias vector toward softer ground types (grass > dirt > concrete).
 * Samples four cardinal points one tile away and weights by signed softness.
 */
export function terrainBias(entity, species, worldSampler) {
  const px = entity.pos.x;
  const pz = entity.pos.z;
  const sN = groundSoftness(worldSampler.sampleGroundType(px, pz - 1)) - 0.5; // north (−z)
  const sS = groundSoftness(worldSampler.sampleGroundType(px, pz + 1)) - 0.5; // south (+z)
  const sE = groundSoftness(worldSampler.sampleGroundType(px + 1, pz)) - 0.5; // east (+x)
  const sW = groundSoftness(worldSampler.sampleGroundType(px - 1, pz)) - 0.5; // west (−x)
  const vx = sE - sW;
  const vz = sS - sN; // +z is south; positive sS pulls south (+z)
  return scale({ x: vx, z: vz }, species.terrainBiasStrength);
}

/**
 * Returns a repulsion vector away from occupied cells within labAversionRadius.
 * Probes along the heading direction at increasing distances; repulsion falls off
 * linearly with distance from entity.
 */
export function labAversion(entity, species, worldSampler) {
  const radius = species.labAversionRadius;
  const px = entity.pos.x;
  const pz = entity.pos.z;
  const hx = Math.cos(entity.heading);
  const hz = Math.sin(entity.heading);

  // Step outward from entity along heading; stop at first occupied cell
  for (let r = 0.5; r <= radius; r += 0.5) {
    const sx = px + hx * r;
    const sz = pz + hz * r;
    if (worldSampler.isOccupied(sx, sz)) {
      const strength = Math.max(0, (radius - r) / radius);
      const away = normalize({ x: px - sx, z: pz - sz });
      return scale(away, strength + 0.5); // +0.5 ensures non-zero at edge of radius
    }
  }

  return { x: 0, z: 0 };
}

/**
 * Returns a vector toward herd.exitTarget scaled to species.fleeSpeed magnitude.
 */
export function seekExit(entity, herd, species) {
  if (!herd.exitTarget) return { x: 0, z: 0 };
  const dx = herd.exitTarget.x - entity.pos.x;
  const dz = herd.exitTarget.z - entity.pos.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist < 1e-10) return { x: 0, z: 0 };
  return scale({ x: dx / dist, z: dz / dist }, species.fleeSpeed);
}

// ─── Task 4: Obstacle avoidance + force summation ───────────────────────────

const LOOK_AHEAD_SEC = 0.5;

/**
 * Returns a perpendicular avoidance vector when an obstacle (occupied cell or
 * steep slope) is detected at the look-ahead point.
 * Sign chosen toward the side with a free space (probes left and right).
 */
export function avoidObstacles(entity, species, worldSampler) {
  const velLen = len(entity.vel);
  const lookDist = Math.max(velLen * LOOK_AHEAD_SEC, 0.5);

  // Forward probe direction
  let fwdX, fwdZ;
  if (velLen > 1e-10) {
    fwdX = entity.vel.x / velLen;
    fwdZ = entity.vel.z / velLen;
  } else {
    fwdX = Math.cos(entity.heading);
    fwdZ = Math.sin(entity.heading);
  }

  const probeX = entity.pos.x + fwdX * lookDist;
  const probeZ = entity.pos.z + fwdZ * lookDist;

  const heightAtPos = worldSampler.sampleHeight(entity.pos.x, entity.pos.z);
  const heightAtProbe = worldSampler.sampleHeight(probeX, probeZ);
  const heightDelta = Math.abs(heightAtProbe - heightAtPos);

  const blocked =
    worldSampler.isOccupied(probeX, probeZ) ||
    heightDelta > species.maxSteepness;

  if (!blocked) return { x: 0, z: 0 };

  // Perpendicular candidates (left = CCW, right = CW)
  const leftX = -fwdZ;
  const leftZ = fwdX;
  const rightX = fwdZ;
  const rightZ = -fwdX;

  const leftProbeX = entity.pos.x + leftX * lookDist;
  const leftProbeZ = entity.pos.z + leftZ * lookDist;
  const rightProbeX = entity.pos.x + rightX * lookDist;
  const rightProbeZ = entity.pos.z + rightZ * lookDist;

  const leftFree =
    !worldSampler.isOccupied(leftProbeX, leftProbeZ) &&
    Math.abs(worldSampler.sampleHeight(leftProbeX, leftProbeZ) - heightAtPos) <= species.maxSteepness;
  const rightFree =
    !worldSampler.isOccupied(rightProbeX, rightProbeZ) &&
    Math.abs(worldSampler.sampleHeight(rightProbeX, rightProbeZ) - heightAtPos) <= species.maxSteepness;

  // Prefer the free side; if both free or both blocked, pick left
  if (leftFree && !rightFree) return { x: leftX, z: leftZ };
  if (rightFree && !leftFree) return { x: rightX, z: rightZ };
  return { x: leftX, z: leftZ };
}

// ─── Per-state weight tables ─────────────────────────────────────────────────

export const WEIGHTS_WANDER = {
  seekHerdCenter: 0.6,
  seekExit: 0.0,
  separate: 0.6,
  align: 0.2,
  wanderJitter: 0.2,
  avoidObstacles: 1.0,
  terrainBias: 0.2,
  labAversion: 0.6,
};

export const WEIGHTS_GRAZE = {
  seekHerdCenter: 0.0,
  seekExit: 0.0,
  separate: 0.0,
  align: 0.0,
  wanderJitter: 0.0,
  avoidObstacles: 0.0,
  terrainBias: 0.0,
  labAversion: 0.0,
};

export const WEIGHTS_FLEE = {
  seekHerdCenter: 0.0,
  seekExit: 1.0,
  separate: 1.0,
  align: 0.0,
  wanderJitter: 0.0,
  avoidObstacles: 1.0,
  terrainBias: 0.0,
  labAversion: 0.2,
};

/**
 * Sums all steering forces weighted by the provided weights object.
 * Clamps result to walkSpeed (wander/graze) or fleeSpeed (flee).
 *
 * Signature: sumForces(entity, herd, neighbors, worldSampler, species, weights, state, rng)
 */
export function sumForces(entity, herd, neighbors, worldSampler, species, weights, state, rng) {
  const speedCap = state === 'flee' ? species.fleeSpeed : species.walkSpeed;

  let force = { x: 0, z: 0 };

  if (weights.seekHerdCenter) {
    force = add(force, scale(seekHerdCenter(entity, herd, species), weights.seekHerdCenter));
  }
  if (weights.seekExit) {
    force = add(force, scale(seekExit(entity, herd, species), weights.seekExit));
  }
  if (weights.separate) {
    force = add(force, scale(separate(entity, neighbors, species), weights.separate));
  }
  if (weights.align) {
    force = add(force, scale(align(entity, neighbors), weights.align));
  }
  if (weights.wanderJitter && rng) {
    force = add(force, scale(wanderJitter(entity, species, rng), weights.wanderJitter));
  }
  if (weights.avoidObstacles) {
    force = add(force, scale(avoidObstacles(entity, species, worldSampler), weights.avoidObstacles));
  }
  if (weights.terrainBias) {
    force = add(force, scale(terrainBias(entity, species, worldSampler), weights.terrainBias));
  }
  if (weights.labAversion) {
    force = add(force, scale(labAversion(entity, species, worldSampler), weights.labAversion));
  }

  return clampMag(force, speedCap);
}
