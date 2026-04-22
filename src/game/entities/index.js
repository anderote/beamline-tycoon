// Entity tick orchestrator — wires the entity subsystem into the game loop.
// Called once per game tick from Game.tick().

import { ENTITIES } from '../../data/entities.js';
import { sampleSurfaceYAt, sampleGroundTypeAt } from '../terrain.js';
import {
  sumForces,
  WEIGHTS_WANDER,
  WEIGHTS_GRAZE,
  WEIGHTS_FLEE,
} from './steering.js';
import { tickHerd, tickEntity } from './herd.js';
import { checkDespawn, despawnHerd, maintainHerdCount } from './spawner.js';

const deerSpecies = ENTITIES.deer;

// ─── Select weight table for entity state ────────────────────────────────────

function weightsForState(entityState) {
  if (entityState === 'flee')  return WEIGHTS_FLEE;
  if (entityState === 'graze') return WEIGHTS_GRAZE;
  return WEIGHTS_WANDER;
}

// ─── Main tick ───────────────────────────────────────────────────────────────

export function entitiesTick(game) {
  // Deer disabled for now — skip all spawning/ticking.
  return;
  // eslint-disable-next-line no-unreachable
  const { state } = game;
  const dt = 1.0; // one tick = one game second

  // 1. Build worldSampler bound to current state
  const worldSampler = {
    sampleHeight(x, z) {
      return sampleSurfaceYAt(state, x, z);
    },
    sampleGroundType(x, z) {
      return sampleGroundTypeAt(state, x, z);
    },
    isOccupied(x, z) {
      const col = Math.floor(x / 2);
      const row = Math.floor(z / 2);
      const subCol = Math.max(0, Math.min(3, Math.floor((x - col * 2) / 0.5)));
      const subRow = Math.max(0, Math.min(3, Math.floor((z - row * 2) / 0.5)));
      return !!state.subgridOccupied[`${col},${row},${subCol},${subRow}`];
    },
  };

  // 2. Map bounds (each tile = 2 world units)
  const mapBounds = {
    minX: 0,
    maxX: state.mapCols * 2,
    minZ: 0,
    maxZ: state.mapRows * 2,
  };

  // 3. Diff placeables to detect new ones since last tick
  const currentIds = new Set(state.placeables.map(p => p.id));
  const recentPlacements = [];

  if (state._entitiesLastPlaceableIds !== null) {
    // Find IDs that exist now but didn't before
    for (const p of state.placeables) {
      if (!state._entitiesLastPlaceableIds.has(p.id)) {
        // Compute world-space center of the placed item
        const cx = (p.col + 0.5) * 2;
        const cz = (p.row + 0.5) * 2;
        recentPlacements.push({ x: cx, z: cz });
      }
    }

    // Startle herds if new placements are nearby — handled inside tickHerd
  }
  // Update the cached ID set
  state._entitiesLastPlaceableIds = currentIds;

  // 4. Read cursor world position from inputHandler
  const cursorPos = game.inputHandler?._hoverWorld ?? null;

  // 5 & 6. Tick each herd and its entities
  for (const herd of state.herds) {
    const members = herd.entityIds.map(id => state.entities.find(e => e.id === id)).filter(Boolean);

    // Tick herd state machine (alarm timers, cursor dwell, construction startle)
    tickHerd(herd, members, dt, { mapBounds, cursorPos, recentPlacements, species: deerSpecies });

    // Tick each entity
    for (const entity of members) {
      const neighbors = members.filter(m => m.id !== entity.id);
      const weights = weightsForState(entity.state);

      // Tick entity state machine (wander/graze/flee transitions)
      const isOnGrass = (() => {
        const gt = worldSampler.sampleGroundType(entity.pos.x, entity.pos.z);
        return gt === 'grass' || gt === 'wildgrass' || gt === 'tallgrass' || gt === null;
      })();
      tickEntity(entity, herd, deerSpecies, dt, { rng: Math.random, isOnGrass });

      // Compute velocity via steering forces
      const vel = sumForces(entity, herd, neighbors, worldSampler, deerSpecies, weights, entity.state, Math.random);
      entity.vel = vel;

      // Integrate position
      entity.pos.x += vel.x * dt;
      entity.pos.z += vel.z * dt;

      // Update Y to terrain surface
      entity.pos.y = sampleSurfaceYAt(state, entity.pos.x, entity.pos.z);

      // Update heading with turn-rate cap (max π radians per tick)
      if (Math.abs(vel.x) > 1e-10 || Math.abs(vel.z) > 1e-10) {
        const desiredHeading = Math.atan2(vel.x, vel.z);
        let delta = desiredHeading - entity.heading;
        // Wrap delta to [-π, π]
        while (delta >  Math.PI) delta -= 2 * Math.PI;
        while (delta < -Math.PI) delta += 2 * Math.PI;
        // Cap turn rate
        const MAX_TURN = Math.PI;
        if (delta >  MAX_TURN) delta =  MAX_TURN;
        if (delta < -MAX_TURN) delta = -MAX_TURN;
        entity.heading += delta;
      }

      // stateTimer advance is handled by tickEntity; no double-increment here
    }
  }

  // 7. Despawn alarmed herds that have fled to the map edge.
  // Only check herds that were in alarmed state — calm herds spawn at the
  // edge and walk inward, so checking despawn for them would fire immediately.
  const herdsCopy = state.herds.slice();
  for (const herd of herdsCopy) {
    if (herd.state === 'alarmed' && checkDespawn(state, herd, mapBounds, 1.0)) {
      despawnHerd(state, herd.id);
    }
  }

  // 8. Maintain herd count (respawn if below target)
  const cooldown = maintainHerdCount(
    state,
    deerSpecies,
    worldSampler,
    Math.random,
    mapBounds,
    2,
    state._herdRespawnCooldown ?? 0,
    dt,
  );
  state._herdRespawnCooldown = cooldown;
}
