// Freeform presentation geometry for flexible cords and hoses.
//
// Power, HV and cooling remain ordinary utility networks. Their hidden `path`
// is still the grid-routed topology path, while `cablePath` records the
// player's unsnapped mouse trace. This module owns the latter so input,
// pricing, hit testing and rendering agree about the flexible run actually
// visible on the floor.

export const SOFT_CABLE_TYPES = Object.freeze(['powerCable', 'hvCable', 'coolingWater']);
export const FREEFORM_TOPOLOGY_TYPES = Object.freeze(['coolingWater']);
export const SOFT_CABLE_MAX_POINTS = 1024;

const SOFT_SET = new Set(SOFT_CABLE_TYPES);
const FREEFORM_TOPOLOGY_SET = new Set(FREEFORM_TOPOLOGY_TYPES);
const EPS = 1e-6;

export function isSoftCable(utilityType) {
  return SOFT_SET.has(utilityType);
}

/** True when the visible freehand route, rather than its hidden grid route, joins networks. */
export function usesFreeformTopology(utilityType) {
  return FREEFORM_TOPOLOGY_SET.has(utilityType);
}

/** Loose electrical cords may cross; plumbed hoses retain overlap/tap rules. */
export function softCableSkipsOverlap(utilityType) {
  return isSoftCable(utilityType) && !usesFreeformTopology(utilityType);
}

/** Copy a finite freeform tile path, removing coincident samples. */
export function sanitizeCablePath(path, maxPoints = SOFT_CABLE_MAX_POINTS) {
  if (!Array.isArray(path)) return [];
  const out = [];
  for (const raw of path) {
    if (!raw || !Number.isFinite(raw.col) || !Number.isFinite(raw.row)) continue;
    const point = { col: raw.col, row: raw.row };
    const previous = out[out.length - 1];
    if (previous && Math.hypot(point.col - previous.col, point.row - previous.row) < EPS) continue;
    if (out.length < maxPoints) out.push(point);
    else out[out.length - 1] = point;
  }
  return out;
}

/** Euclidean freeform length in the game's quarter-tile sub-units. */
export function cablePathLengthSubUnits(path) {
  const clean = sanitizeCablePath(path);
  let tiles = 0;
  for (let i = 1; i < clean.length; i++) {
    tiles += Math.hypot(
      clean[i].col - clean[i - 1].col,
      clean[i].row - clean[i - 1].row,
    );
  }
  return tiles * 4;
}

function planarLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  }
  return total;
}

/**
 * Convert the player's planar trace into a gravity-shaped 3D centreline.
 *
 * Short, taut runs hang in the air with a shallow bow. Added mouse-trace
 * length increases slack until the middle reaches `groundY`; from there the
 * remaining control points naturally pool along the traced S-curve.
 * Returned points are plain objects so the physics of the shape is testable
 * without Three.js.
 */
export function softCableControlPoints(path, {
  start = null,
  end = null,
  groundY = 0.03,
  sampleSpacing = 0.24,
  maxSamples = 192,
} = {}) {
  const clean = sanitizeCablePath(path);
  if (clean.length < 2) return [];

  const planar = clean.map(point => ({ x: point.col * 2, z: point.row * 2 }));
  if (start) planar[0] = { x: start.x, z: start.z };
  if (end) planar[planar.length - 1] = { x: end.x, z: end.z };

  const cumulative = [0];
  for (let i = 1; i < planar.length; i++) {
    cumulative.push(cumulative[i - 1] + Math.hypot(
      planar[i].x - planar[i - 1].x,
      planar[i].z - planar[i - 1].z,
    ));
  }
  const length = cumulative[cumulative.length - 1];
  if (length < EPS) return [];

  const count = Math.max(8, Math.min(maxSamples, Math.ceil(length / sampleSpacing) + 1));
  const sampled = [];
  let segment = 1;
  for (let i = 0; i < count; i++) {
    const distance = length * i / (count - 1);
    while (segment < cumulative.length - 1 && cumulative[segment] < distance) segment++;
    const a = planar[segment - 1];
    const b = planar[segment];
    const span = cumulative[segment] - cumulative[segment - 1];
    const u = span > EPS ? (distance - cumulative[segment - 1]) / span : 0;
    sampled.push({
      x: a.x + (b.x - a.x) * u,
      z: a.z + (b.z - a.z) * u,
    });
  }

  const startY = Number.isFinite(start?.y) ? start.y : groundY;
  const endY = Number.isFinite(end?.y) ? end.y : groundY;
  const chord = Math.hypot(
    sampled[sampled.length - 1].x - sampled[0].x,
    sampled[sampled.length - 1].z - sampled[0].z,
  );
  const slack = Math.max(0, planarLength(planar) - chord);
  // A little bow is always visible; deliberate extra length makes it pool.
  const sagDepth = Math.min(3.0, 0.12 + length * 0.055 + slack * 0.55);
  for (let i = 0; i < sampled.length; i++) {
    const t = i / (sampled.length - 1);
    const supportY = startY + (endY - startY) * t;
    const gravity = sagDepth * Math.pow(Math.sin(Math.PI * t), 0.72);
    sampled[i].y = Math.max(groundY, supportY - gravity);
  }
  sampled[0].y = startY;
  sampled[sampled.length - 1].y = endY;
  return sampled;
}
