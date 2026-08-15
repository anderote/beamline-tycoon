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
// Centreline bend radii in world metres. Branch power cords can tuck around a
// cabinet, cooling hose needs a broader sweep, and the thick armoured HV
// feeder is deliberately the least willing to turn.
export const SOFT_CABLE_BEND_RADIUS_METERS = Object.freeze({
  powerCable: 0.20,
  coolingWater: 0.45,
  hvCable: 0.80,
});

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

export function softCableBendRadiusMeters(utilityType) {
  return SOFT_CABLE_BEND_RADIUS_METERS[utilityType] || 0;
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

function pointSegmentDistance(point, start, end) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length2 = dx * dx + dz * dz;
  if (length2 < EPS) return Math.hypot(point.x - start.x, point.z - start.z);
  const t = Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.z - start.z) * dz) / length2));
  return Math.hypot(
    point.x - (start.x + dx * t),
    point.z - (start.z + dz * t),
  );
}

// Half-subtile input sampling leaves many almost-collinear vertices along a
// straight stroke. Remove only sub-pixel wobble before rounding, otherwise
// every 25 cm sample would cap every utility to the same tiny bend radius.
function simplifyPlanarTrace(points, tolerance = 0.04) {
  if (points.length < 3) return points.map(point => ({ ...point }));
  const out = [{ ...points[0] }];
  for (let i = 1; i < points.length - 1; i++) {
    const previous = out[out.length - 1];
    const point = points[i];
    const next = points[i + 1];
    const incomingX = point.x - previous.x;
    const incomingZ = point.z - previous.z;
    const outgoingX = next.x - point.x;
    const outgoingZ = next.z - point.z;
    const continuesForward = incomingX * outgoingX + incomingZ * outgoingZ >= 0;
    if (continuesForward && pointSegmentDistance(point, previous, next) <= tolerance) continue;
    out.push({ ...point });
  }
  out.push({ ...points[points.length - 1] });
  return out;
}

/**
 * Replace every planar corner with a tangent quadratic arc whose requested
 * radius is capped by the two adjoining segment lengths. The quadratic is a
 * close circular-arc approximation at ordinary cable scales, and unlike a
 * generic spline its turn size is explicitly controlled in metres.
 */
export function roundedCablePlanarPoints(points, bendRadiusMeters, sampleSpacing = 0.12) {
  if (!Array.isArray(points)) return [];
  const clean = points
    .filter(point => point && Number.isFinite(point.x) && Number.isFinite(point.z))
    .map(point => ({ x: point.x, z: point.z }));
  if (clean.length < 3 || !(bendRadiusMeters > EPS)) return clean;

  const route = simplifyPlanarTrace(clean);
  if (route.length < 3) return route;
  const out = [{ ...route[0] }];
  const pushDistinct = (point) => {
    const previous = out[out.length - 1];
    if (previous && Math.hypot(point.x - previous.x, point.z - previous.z) < EPS) return;
    out.push(point);
  };

  for (let i = 1; i < route.length - 1; i++) {
    const previous = route[i - 1];
    const corner = route[i];
    const next = route[i + 1];
    const inX = corner.x - previous.x;
    const inZ = corner.z - previous.z;
    const outX = next.x - corner.x;
    const outZ = next.z - corner.z;
    const inLength = Math.hypot(inX, inZ);
    const outLength = Math.hypot(outX, outZ);
    if (inLength < EPS || outLength < EPS) continue;
    const inUnit = { x: inX / inLength, z: inZ / inLength };
    const outUnit = { x: outX / outLength, z: outZ / outLength };
    const turn = Math.acos(Math.max(-1, Math.min(1,
      inUnit.x * outUnit.x + inUnit.z * outUnit.z)));
    if (turn < 1e-3) {
      pushDistinct({ ...corner });
      continue;
    }

    const requestedCut = bendRadiusMeters * Math.tan(Math.min(Math.PI - 1e-3, turn) / 2);
    const cut = Math.min(requestedCut, inLength * 0.45, outLength * 0.45);
    if (!(cut > EPS)) {
      pushDistinct({ ...corner });
      continue;
    }
    const entry = {
      x: corner.x - inUnit.x * cut,
      z: corner.z - inUnit.z * cut,
    };
    const exit = {
      x: corner.x + outUnit.x * cut,
      z: corner.z + outUnit.z * cut,
    };
    pushDistinct(entry);
    const divisions = Math.max(2, Math.ceil((cut * 2) / Math.max(0.02, sampleSpacing)));
    for (let step = 1; step < divisions; step++) {
      const t = step / divisions;
      const inv = 1 - t;
      pushDistinct({
        x: inv * inv * entry.x + 2 * inv * t * corner.x + t * t * exit.x,
        z: inv * inv * entry.z + 2 * inv * t * corner.z + t * t * exit.z,
      });
    }
    pushDistinct(exit);
  }
  pushDistinct({ ...route[route.length - 1] });
  return out;
}

/** The visible, rounded planar route in tile coordinates for picking/topology. */
export function roundedCableTilePath(path, utilityType) {
  const planar = sanitizeCablePath(path).map(point => ({ x: point.col * 2, z: point.row * 2 }));
  return roundedCablePlanarPoints(planar, softCableBendRadiusMeters(utilityType))
    .map(point => ({ col: point.x / 2, row: point.z / 2 }));
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
  bendRadiusMeters = 0,
} = {}) {
  const clean = sanitizeCablePath(path);
  if (clean.length < 2) return [];

  let planar = clean.map(point => ({ x: point.col * 2, z: point.row * 2 }));
  if (start) planar[0] = { x: start.x, z: start.z };
  if (end) planar[planar.length - 1] = { x: end.x, z: end.z };
  const tracedLength = planarLength(planar);
  planar = roundedCablePlanarPoints(planar, bendRadiusMeters);

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
  const slack = Math.max(0, tracedLength - chord);
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
