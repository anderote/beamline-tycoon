// Spawner module: edge wildness scoring, herd spawn/despawn/respawn.
// All functions are pure or operate on injected state. rng is always injected.

import { createHerd } from './herd.js';

// ─── Ground type scoring ──────────────────────────────────────────────────────

const WILD_TYPES = new Set(['grass', 'wildgrass', 'tallgrass']);
const PAVED_TYPES = new Set(['concrete', 'asphalt', 'pavement', 'stone', 'tile']);

// Score a single ground type sample: 1.0 wild, 0.0 paved, 0.5 unknown/null.
function scoreGroundType(type) {
  if (!type) return 0.5;
  if (WILD_TYPES.has(type)) return 1.0;
  if (PAVED_TYPES.has(type)) return 0.0;
  return 0.5;
}

// ─── Task 8: scoreEdgeTile ────────────────────────────────────────────────────

// Returns a wildness score [0,1] for a tile at (x,z) by sampling a square window
// of radius `windowRadius`. Samples at (x+dx, z+dz) for dx,dz ∈ {-r, 0, r}
// (or just the centre point when windowRadius=0).
export function scoreEdgeTile(x, z, worldSampler, windowRadius) {
  const offsets = windowRadius === 0
    ? [0]
    : [-windowRadius, 0, windowRadius];

  let total = 0;
  let count = 0;
  for (const dx of offsets) {
    for (const dz of offsets) {
      const type = worldSampler.sampleGroundType(x + dx, z + dz);
      total += scoreGroundType(type);
      count++;
    }
  }
  return total / count;
}

// ─── Task 8: pickSpawnPoint ───────────────────────────────────────────────────

// Samples 8 evenly-spaced candidate points along each of the four map edges
// (32 total), scores each via scoreEdgeTile, filters out candidates within
// minDistance of any avoidNear point, keeps top quartile by score, and picks
// one uniformly via rng(). Returns null if no valid candidate exists.
export function pickSpawnPoint(mapBounds, worldSampler, avoidNear, minDistance, rng) {
  const { minX, maxX, minZ, maxZ } = mapBounds;
  const SAMPLES_PER_EDGE = 8;

  // Generate 8 evenly-spaced points along each edge.
  // t ∈ {0/7, 1/7, ..., 7/7} to include both corners.
  const candidates = [];
  for (let i = 0; i < SAMPLES_PER_EDGE; i++) {
    const t = i / (SAMPLES_PER_EDGE - 1);
    candidates.push({ x: minX + t * (maxX - minX), z: minZ }); // north edge
    candidates.push({ x: minX + t * (maxX - minX), z: maxZ }); // south edge
    candidates.push({ x: minX, z: minZ + t * (maxZ - minZ) }); // west edge
    candidates.push({ x: maxX, z: minZ + t * (maxZ - minZ) }); // east edge
  }

  // Score each candidate.
  const scored = candidates.map(pt => ({
    pt,
    score: scoreEdgeTile(pt.x, pt.z, worldSampler, 1),
  }));

  // Filter by minDistance from avoidNear.
  const valid = scored.filter(({ pt }) => {
    if (minDistance <= 0) return true;
    return avoidNear.every(near => {
      const dx = pt.x - near.x;
      const dz = pt.z - near.z;
      return Math.sqrt(dx * dx + dz * dz) >= minDistance;
    });
  });

  if (valid.length === 0) return null;

  // Sort descending by score and keep top quartile (at least 1).
  valid.sort((a, b) => b.score - a.score);
  const keepCount = Math.max(1, Math.floor(valid.length / 4));
  const pool = valid.slice(0, keepCount);

  // Pick uniformly via rng.
  const idx = Math.floor(rng() * pool.length);
  return pool[Math.min(idx, pool.length - 1)].pt;
}

// ─── Task 9: spawnHerd ────────────────────────────────────────────────────────

// Creates a new herd and 3–5 entities, appending them to state.herds and
// state.entities. IDs are assigned from incrementing counters on state.
// Returns the new herd, or null if no spawn point could be found.
export function spawnHerd(state, species, worldSampler, rng, mapBounds) {
  // Initialise ID counters if not present.
  if (state._herdIdCounter === undefined) state._herdIdCounter = 0;
  if (state._entityIdCounter === undefined) state._entityIdCounter = 0;

  // avoidNear: existing herd centers.
  const avoidNear = state.herds.map(h => h.center);
  const minDistance = 10; // minimum world units between spawn points

  const center = pickSpawnPoint(mapBounds, worldSampler, avoidNear, minDistance, rng);
  if (center === null) return null;

  // Herd size: 3–5.
  const herdSize = 3 + Math.floor(rng() * 3);

  // Assign herd ID.
  const herdId = `herd_${state._herdIdCounter++}`;

  // Create entities.
  const entityIds = [];
  const newEntities = [];
  for (let i = 0; i < herdSize; i++) {
    const entityId = `deer_${state._entityIdCounter++}`;
    entityIds.push(entityId);

    // Cluster within 3 units of center using polar coords.
    const r = rng() * 3;
    const theta = rng() * 2 * Math.PI;
    const posX = center.x + r * Math.cos(theta);
    const posZ = center.z + r * Math.sin(theta);
    const posY = worldSampler?.sampleHeight ? worldSampler.sampleHeight(posX, posZ) : 0;
    newEntities.push({
      id: entityId,
      type: 'deer',
      herdId,
      pos: {
        x: posX,
        y: posY,
        z: posZ,
      },
      vel: { x: 0, z: 0 },
      heading: rng() * 2 * Math.PI,
      state: 'wander',
      stateTimer: 0,
      animPhase: 0,
    });
  }

  // Create herd object.
  const herd = createHerd({ id: herdId, type: 'deer', entityIds, center });

  // Commit to state.
  state.herds.push(herd);
  for (const entity of newEntities) state.entities.push(entity);

  return herd;
}

// ─── Task 9: checkDespawn ─────────────────────────────────────────────────────

// Returns true when ALL herd members are within `threshold` world units of
// any of the four edges of mapBounds.
export function checkDespawn(state, herd, mapBounds, threshold) {
  const { minX, maxX, minZ, maxZ } = mapBounds;

  for (const entityId of herd.entityIds) {
    const entity = state.entities.find(e => e.id === entityId);
    if (!entity) continue; // missing entity is ignored

    const { x, z } = entity.pos;
    const distToWest  = x - minX;
    const distToEast  = maxX - x;
    const distToNorth = z - minZ;
    const distToSouth = maxZ - z;
    const minDistToEdge = Math.min(distToWest, distToEast, distToNorth, distToSouth);

    if (minDistToEdge >= threshold) return false;
  }
  return true;
}

// ─── Task 9: despawnHerd ──────────────────────────────────────────────────────

// Removes the herd with the given ID and all its entities from state.
export function despawnHerd(state, herdId) {
  const herd = state.herds.find(h => h.id === herdId);
  if (!herd) return;

  const entitySet = new Set(herd.entityIds);
  state.herds = state.herds.filter(h => h.id !== herdId);
  state.entities = state.entities.filter(e => !entitySet.has(e.id));
}

// ─── Task 9: maintainHerdCount ────────────────────────────────────────────────

// Manages background respawn to keep herd population near targetCount.
//
// Cooldown semantics: the 30s cooldown starts on the tick a spawn succeeds.
// If spawnHerd returns null (no valid spawn point), the cooldown is NOT reset —
// the next tick will try again immediately.
//
// Returns:
//   - 30 when a spawn occurred this tick
//   - cooldownRemaining - dt when cooldown > 0
//   - 0 when count >= target
export function maintainHerdCount(state, species, worldSampler, rng, mapBounds, targetCount, cooldownRemaining, dt) {
  if (state.herds.length >= targetCount) return 0;
  if (cooldownRemaining > 0) return cooldownRemaining - dt;

  // Attempt spawn.
  const result = spawnHerd(state, species, worldSampler, rng, mapBounds);
  if (result !== null) {
    return 30; // 30s cooldown starts on successful spawn
  }
  // Spawn failed — no cooldown; try again next tick.
  return 0;
}
