// Simulation-owned staff movement at subtile resolution.
//
// The game publishes StaffMember.fromNode; renderers may interpolate toward
// it, but must never author position or job phase. Job travel and soft idle
// wandering both use this coordinator so headless and rendered games run the
// same staffing simulation.

import { getNavGrid, findPath, isReachable } from './nav.js';
import {
  levelOf, parseTileKey, subtileKey, withLevel,
} from '../storeys.js';

export const STAFF_TRAVEL_SUBTILES_PER_TICK = 2;

const WANDER_RADIUS_TILES = 6;
const WANDER_TRIES = 16;
const WANDER_WAIT_MIN_TICKS = 2;
const WANDER_WAIT_SPAN_TICKS = 5;
const ZONE_WANDER_BIAS = 0.7;
const SUBTILE_ORDER = [
  [1, 1], [2, 2], [1, 2], [2, 1],
  [0, 0], [3, 3], [0, 3], [3, 0],
  [0, 1], [1, 0], [2, 3], [3, 2],
  [0, 2], [2, 0], [1, 3], [3, 1],
];

function nodeKey(node) {
  return subtileKey(
    node.col, node.row, node.subCol, node.subRow, levelOf(node),
  );
}

function copyNode(node) {
  return node ? withLevel({
    col: node.col, row: node.row, subCol: node.subCol, subRow: node.subRow,
  }, levelOf(node)) : null;
}

export function sameStaffNode(a, b) {
  return !!a && !!b
    && a.col === b.col && a.row === b.row
    && a.subCol === b.subCol && a.subRow === b.subRow
    && levelOf(a) === levelOf(b);
}

function tileKeysForZone(state, zoneId) {
  if (!zoneId) return [];
  return Object.keys(state.zoneOccupied || {})
    .filter(key => state.zoneOccupied[key] === zoneId)
    .sort();
}

function firstPassableInTiles(nav, keys) {
  for (const key of keys) {
    const { col, row, level } = parseTileKey(key);
    if (!Number.isFinite(col) || !Number.isFinite(row)) continue;
    for (const [subCol, subRow] of SUBTILE_ORDER) {
      const node = withLevel({ col, row, subCol, subRow }, level);
      if (nav.passable.has(nodeKey(node))) return node;
    }
  }
  return null;
}

function fallbackSpawn(nav, state) {
  const floorKeys = Object.keys(state.infraOccupied || {}).sort();
  const onFloor = firstPassableInTiles(nav, floorKeys);
  if (onFloor) return onFloor;

  const half = Number.isFinite(state.mapHalfExtent) ? state.mapHalfExtent : 30;
  for (let radius = 0; radius <= half; radius++) {
    for (let col = -radius; col <= radius; col++) {
      for (const row of radius === 0 ? [0] : [-radius, radius]) {
        const candidate = firstPassableInTiles(nav, [`${col},${row}`]);
        if (candidate) return candidate;
      }
    }
    for (let row = -radius + 1; row <= radius - 1; row++) {
      for (const col of [-radius, radius]) {
        const candidate = firstPassableInTiles(nav, [`${col},${row}`]);
        if (candidate) return candidate;
      }
    }
  }
  return null;
}

/** Resolve a member's authoritative starting node exactly once. */
export function ensureStaffPosition(state, member) {
  const nav = getNavGrid(state);
  if (member.fromNode && nav.passable.has(nodeKey(member.fromNode))) {
    return member.fromNode;
  }

  const zoneNode = firstPassableInTiles(
    nav,
    tileKeysForZone(state, member.assignment?.zoneId),
  );
  const node = zoneNode || fallbackSpawn(nav, state);
  member.fromNode = copyNode(node);
  member._staffMotion = null;
  return member.fromNode;
}

export function clearStaffMotion(member) {
  member._staffMotion = null;
}

/** Whether the next travel step must pay for a fresh A* route. */
export function staffTravelNeedsRoute(state, member, destination, kind = 'job') {
  const from = ensureStaffPosition(state, member);
  if (!from || !destination || sameStaffNode(from, destination)) return false;
  const motion = member._staffMotion;
  return !motion || motion.kind !== kind
    || motion.navRevision !== (state.navRevision || 0)
    || !sameStaffNode(motion.destination, destination);
}

function rebuildMotion(state, member, destination, kind) {
  const from = ensureStaffPosition(state, member);
  if (!from || !destination) return null;
  const nav = getNavGrid(state);
  const path = findPath(nav, from, destination);
  if (!path) return null;
  const motion = {
    kind,
    destination: copyNode(destination),
    path,
    pathIndex: 0,
    navRevision: state.navRevision || 0,
  };
  member._staffMotion = motion;
  return motion;
}

/**
 * Advance one member toward a destination. Returns
 * `{ arrived, moved, blocked }` and updates member.fromNode in the sim.
 */
export function advanceStaffTravel(
  state,
  member,
  destination,
  kind = 'job',
  { allowRouteStart = true } = {},
) {
  const from = ensureStaffPosition(state, member);
  if (!from || !destination) return {
    arrived: false, moved: false, blocked: true, deferred: false,
  };
  if (sameStaffNode(from, destination)) {
    clearStaffMotion(member);
    return { arrived: true, moved: false, blocked: false, deferred: false };
  }

  const revision = state.navRevision || 0;
  let motion = member._staffMotion;
  if (!motion || motion.kind !== kind || motion.navRevision !== revision
      || !sameStaffNode(motion.destination, destination)) {
    if (!allowRouteStart) {
      return { arrived: false, moved: false, blocked: false, deferred: true };
    }
    motion = rebuildMotion(state, member, destination, kind);
  }
  if (!motion) return {
    arrived: false, moved: false, blocked: true, deferred: false,
  };

  const startNode = copyNode(member.fromNode);
  const startIndex = motion.pathIndex;
  const nextIndex = Math.min(
    motion.path.length - 1,
    motion.pathIndex + STAFF_TRAVEL_SUBTILES_PER_TICK,
  );
  motion.pathIndex = nextIndex;
  member.fromNode = copyNode(motion.path[nextIndex]);
  if (nextIndex > startIndex) {
    member._staffPresentation = {
      sequence: (member._staffPresentation?.sequence || 0) + 1,
      kind,
      navRevision: revision,
      tick: state.tick || 0,
      // At most three nodes at today's speed: the prior authoritative node
      // plus the one/two traversed nodes. This is enough for exact corner
      // interpolation without serializing or retaining an entire A* result.
      nodes: [startNode, ...motion.path.slice(startIndex + 1, nextIndex + 1)]
        .filter(Boolean)
        .map(copyNode),
    };
  }
  const arrived = nextIndex >= motion.path.length - 1;
  if (arrived) clearStaffMotion(member);
  return { arrived, moved: true, blocked: false, deferred: false };
}

function hashText(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function fallbackRandom(game, member, salt) {
  const tick = game.state?.tick || 0;
  let x = (hashText(member.id || 'staff') ^ tick ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  return (x >>> 0) / 4294967296;
}

function randomValue(game, member, salt) {
  // Ambient route choice must not perturb the facility RNG stream used by
  // wear, incidents and discoveries. It is still deterministic per member,
  // tick and sampling salt.
  return fallbackRandom(game, member, salt);
}

function chooseWanderDestination(game, member) {
  const state = game.state;
  const from = ensureStaffPosition(state, member);
  if (!from) return null;
  const nav = getNavGrid(state);
  const zoneKeys = tileKeysForZone(state, member.assignment?.zoneId);

  for (let attempt = 0; attempt < WANDER_TRIES; attempt++) {
    let node;
    const useZone = zoneKeys.length > 0
      && randomValue(game, member, attempt * 5) < ZONE_WANDER_BIAS;
    if (useZone) {
      const key = zoneKeys[Math.floor(randomValue(game, member, attempt * 5 + 1) * zoneKeys.length) % zoneKeys.length];
      const { col, row, level } = parseTileKey(key);
      node = withLevel({
        col, row,
        subCol: Math.floor(randomValue(game, member, attempt * 5 + 2) * 4),
        subRow: Math.floor(randomValue(game, member, attempt * 5 + 3) * 4),
      }, level);
    } else {
      node = withLevel({
        col: from.col + Math.round((randomValue(game, member, attempt * 5 + 1) * 2 - 1) * WANDER_RADIUS_TILES),
        row: from.row + Math.round((randomValue(game, member, attempt * 5 + 2) * 2 - 1) * WANDER_RADIUS_TILES),
        subCol: Math.floor(randomValue(game, member, attempt * 5 + 3) * 4),
        subRow: Math.floor(randomValue(game, member, attempt * 5 + 4) * 4),
      }, levelOf(from));
    }
    if (!sameStaffNode(from, node) && isReachable(nav, from, node)) return node;
  }
  return null;
}

/** Advance safe, jobless ambient wandering by one simulation tick. */
export function staffWanderNeedsRoute(member) {
  const current = member?._staffMotion;
  if (!current) return true;
  if (current.kind === 'wander-wait') return current.waitTicks <= 1;
  return current.kind !== 'wander';
}

export function tickStaffWander(game, member, { allowRouteStart = true } = {}) {
  ensureStaffPosition(game.state, member);
  const current = member._staffMotion;
  if (current?.kind === 'wander-wait') {
    current.waitTicks--;
    if (current.waitTicks > 0) return false;
    clearStaffMotion(member);
  }

  let motion = member._staffMotion;
  if (!motion || motion.kind !== 'wander') {
    if (!allowRouteStart) return false;
    const destination = chooseWanderDestination(game, member);
    if (!destination) return false;
    motion = rebuildMotion(game.state, member, destination, 'wander');
    if (!motion) return false;
  }

  const result = advanceStaffTravel(
    game.state,
    member,
    motion.destination,
    'wander',
    { allowRouteStart },
  );
  if (result.arrived) {
    member._staffMotion = {
      kind: 'wander-wait',
      waitTicks: WANDER_WAIT_MIN_TICKS
        + Math.floor(randomValue(game, member, 101) * WANDER_WAIT_SPAN_TICKS),
    };
  }
  return result.moved;
}
