// Herd and per-entity state machines for wildlife simulation.
// All mutations are in-place; no return values from tick functions.

// ─── helpers ─────────────────────────────────────────────────────────────────

function dist2d(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

// Returns the nearest point on the four-edge rectangle to (cx, cz).
// Each edge is tested by perpendicular projection, and the closest wins.
function nearestEdgePoint(cx, cz, bounds) {
  const { minX, maxX, minZ, maxZ } = bounds;

  const candidates = [
    { x: minX, z: Math.max(minZ, Math.min(maxZ, cz)) },  // west edge
    { x: maxX, z: Math.max(minZ, Math.min(maxZ, cz)) },  // east edge
    { x: Math.max(minX, Math.min(maxX, cx)), z: minZ },  // north edge
    { x: Math.max(minX, Math.min(maxX, cx)), z: maxZ },  // south edge
  ];

  let best = candidates[0];
  let bestDist = dist2d(cx, cz, best.x, best.z);
  for (let i = 1; i < candidates.length; i++) {
    const d = dist2d(cx, cz, candidates[i].x, candidates[i].z);
    if (d < bestDist) {
      bestDist = d;
      best = candidates[i];
    }
  }
  return best;
}

// ─── Herd factory ────────────────────────────────────────────────────────────

export function createHerd({ id, type, entityIds, center }) {
  return {
    id,
    type,
    entityIds,
    center: { x: center.x, z: center.z },
    state: 'calm',
    alarmTimer: 0,
    exitTarget: null,
    cursorDwellTimer: 0,
    wanderTarget: { x: center.x, z: center.z },
  };
}

// ─── Herd state machine ───────────────────────────────────────────────────────

export function startleHerd(herd, triggerPoint, mapBounds, species) {
  if (herd.state === 'alarmed') return;
  herd.state = 'alarmed';
  herd.alarmTimer = 10;
  herd.exitTarget = nearestEdgePoint(herd.center.x, herd.center.z, mapBounds);
}

// context: { mapBounds, cursorPos, recentPlacements, species }
export function tickHerd(herd, members, dt, context) {
  const { mapBounds, cursorPos, recentPlacements, species } = context;

  // Check construction-startle from recentPlacements before cursor/timer logic
  if (recentPlacements.length > 0) {
    outer: for (const placement of recentPlacements) {
      for (const member of members) {
        if (dist2d(member.pos.x, member.pos.z, placement.x, placement.z) < species.spookRadius) {
          startleHerd(herd, placement, mapBounds, species);
          break outer;
        }
      }
    }
  }

  // Check cursor dwell startle
  if (cursorPos !== null) {
    const cursorNearAny = members.some(
      m => dist2d(m.pos.x, m.pos.z, cursorPos.x, cursorPos.z) < species.cursorSpookRadius
    );
    if (cursorNearAny) {
      herd.cursorDwellTimer += dt;
      if (herd.cursorDwellTimer > species.cursorSpookDwell) {
        startleHerd(herd, cursorPos, mapBounds, species);
      }
    } else {
      herd.cursorDwellTimer = 0;
    }
  } else {
    herd.cursorDwellTimer = 0;
  }

  // Alarm timer
  if (herd.state === 'alarmed') {
    herd.alarmTimer -= dt;
    if (herd.alarmTimer <= 0) {
      herd.alarmTimer = 0;
      herd.state = 'calm';
      herd.exitTarget = null;
    }
  }
}

// ─── Per-entity state machine ─────────────────────────────────────────────────

// context: { rng, isOnGrass }
// rng: () => [0,1)  — injected for deterministic testing
export function tickEntity(entity, herd, species, dt, context) {
  const { rng, isOnGrass } = context;

  if (herd.state === 'alarmed') {
    if (entity.state !== 'flee') {
      entity.state = 'flee';
      entity.stateTimer = 0;
    } else {
      entity.stateTimer += dt;
    }
    return;
  }

  // Calm herd — run per-state logic
  if (entity.state === 'wander') {
    entity.stateTimer += dt;
    if (isOnGrass && rng() < species.grazeChance * dt) {
      entity.state = 'graze';
      entity.stateTimer = 0;
      entity.grazeDuration = species.grazeDurationRange[0] +
        rng() * (species.grazeDurationRange[1] - species.grazeDurationRange[0]);
    }
    return;
  }

  if (entity.state === 'graze') {
    entity.stateTimer += dt;
    if (entity.stateTimer >= entity.grazeDuration) {
      entity.state = 'wander';
      entity.stateTimer = 0;
      delete entity.grazeDuration;
    }
    return;
  }

  // flee → stays in flee during calm (herd controls transition; entity just ticks)
  entity.stateTimer += dt;
}
