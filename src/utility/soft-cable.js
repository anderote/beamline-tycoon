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

/**
 * Pull a laid cable trace along with one or both of its terminal fittings.
 *
 * Each interior sample receives a blend of the two endpoint displacements,
 * weighted by its arc-length position along the original trace. This is the
 * quasi-static shape a loose cable assumes while a connected machine is
 * carried: the plug stays attached, the far plug stays pinned, and the slack
 * between them sweeps across the floor instead of leaving a single stretched
 * first segment behind.
 */
export function draggedCablePath(path, { start = null, end = null } = {}) {
  const clean = sanitizeCablePath(path);
  if (clean.length < 2) return clean;
  const first = clean[0];
  const last = clean[clean.length - 1];
  const startTarget = start && Number.isFinite(start.col) && Number.isFinite(start.row)
    ? start : first;
  const endTarget = end && Number.isFinite(end.col) && Number.isFinite(end.row)
    ? end : last;
  const startDelta = {
    col: startTarget.col - first.col,
    row: startTarget.row - first.row,
  };
  const endDelta = {
    col: endTarget.col - last.col,
    row: endTarget.row - last.row,
  };
  const distances = [0];
  for (let i = 1; i < clean.length; i++) {
    distances[i] = distances[i - 1] + Math.hypot(
      clean[i].col - clean[i - 1].col,
      clean[i].row - clean[i - 1].row,
    );
  }
  const total = distances[distances.length - 1];
  const moved = clean.map((point, index) => {
    const t = total > EPS ? distances[index] / total : index / (clean.length - 1);
    return {
      col: point.col + startDelta.col * (1 - t) + endDelta.col * t,
      row: point.row + startDelta.row * (1 - t) + endDelta.row * t,
    };
  });
  moved[0] = { col: startTarget.col, row: startTarget.row };
  moved[moved.length - 1] = { col: endTarget.col, row: endTarget.row };
  return moved;
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

function pointDistance3D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Settle a sampled flexible-line centreline as a position-based rope.
 *
 * Both terminal fittings and every section already resting on the deck are
 * fixed. Suspended spans keep their traced cable length, fall under gravity,
 * and repeatedly satisfy distance + bend constraints until sharp floating
 * kinks relax into a smooth hanging curve. Returned points are plain objects
 * so this remains deterministic and testable without Three.js.
 */
export function relaxedCableControlPoints(points, {
  floorY = 0.03,
  iterations = 140,
  constraintPasses = 5,
  gravityStep = 0.018,
  bendStiffness = 0.12,
} = {}) {
  if (!Array.isArray(points)) return [];
  const settled = points
    .filter(point => point && Number.isFinite(point.x)
      && Number.isFinite(point.y) && Number.isFinite(point.z))
    .map(point => ({ x: point.x, y: point.y, z: point.z }));
  if (settled.length < 3) return settled;

  const original = settled.map(point => ({ ...point }));
  const fixed = settled.map((point, index) => index === 0
    || index === settled.length - 1
    || point.y <= floorY + 1e-5);

  // Redistribute each supported span's original length evenly across its
  // samples. Uniform rest lengths remove sampling-density elbows while keeping
  // exactly the slack the player's drawn route purchased.
  const restLengths = new Array(settled.length - 1).fill(0);
  const supports = [];
  for (let i = 0; i < fixed.length; i++) if (fixed[i]) supports.push(i);
  for (let support = 0; support < supports.length - 1; support++) {
    const from = supports[support];
    const to = supports[support + 1];
    let spanLength = 0;
    for (let i = from; i < to; i++) spanLength += pointDistance3D(original[i], original[i + 1]);
    const segmentLength = spanLength / Math.max(1, to - from);
    for (let i = from; i < to; i++) restLengths[i] = segmentLength;
  }

  const restoreSupports = () => {
    for (let i = 0; i < settled.length; i++) {
      if (!fixed[i]) continue;
      settled[i].x = original[i].x;
      settled[i].y = original[i].y;
      settled[i].z = original[i].z;
    }
  };

  const count = Math.max(1, Math.floor(iterations));
  const passes = Math.max(1, Math.floor(constraintPasses));
  for (let iteration = 0; iteration < count; iteration++) {
    // Gravity supplies the motive force. A small Laplacian bend constraint
    // damps zigzags without pinning the rope to its original lateral trace.
    const bendTargets = settled.map(point => ({ x: point.x, y: point.y, z: point.z }));
    for (let i = 1; i < settled.length - 1; i++) {
      if (fixed[i]) continue;
      const previous = settled[i - 1];
      const point = settled[i];
      const next = settled[i + 1];
      bendTargets[i].x = point.x + ((previous.x + next.x) * 0.5 - point.x) * bendStiffness;
      bendTargets[i].y = point.y + ((previous.y + next.y) * 0.5 - point.y) * bendStiffness
        - gravityStep;
      bendTargets[i].z = point.z + ((previous.z + next.z) * 0.5 - point.z) * bendStiffness;
    }
    for (let i = 1; i < settled.length - 1; i++) {
      if (fixed[i]) continue;
      settled[i] = bendTargets[i];
      settled[i].y = Math.max(floorY, settled[i].y);
    }

    for (let pass = 0; pass < passes; pass++) {
      // Alternate direction so neither fitting gets a systematic bias.
      const forward = (iteration + pass) % 2 === 0;
      for (let step = 0; step < restLengths.length; step++) {
        const i = forward ? step : restLengths.length - 1 - step;
        const a = settled[i];
        const b = settled[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        const distance = Math.hypot(dx, dy, dz);
        const rest = restLengths[i];
        if (!(distance > EPS) || !(rest > EPS)) continue;
        const error = (distance - rest) / distance;
        const aFree = !fixed[i];
        const bFree = !fixed[i + 1];
        if (!aFree && !bFree) continue;
        const aShare = aFree ? (bFree ? 0.5 : 1) : 0;
        const bShare = bFree ? (aFree ? 0.5 : 1) : 0;
        if (aShare) {
          a.x += dx * error * aShare;
          a.y = Math.max(floorY, a.y + dy * error * aShare);
          a.z += dz * error * aShare;
        }
        if (bShare) {
          b.x -= dx * error * bShare;
          b.y = Math.max(floorY, b.y - dy * error * bShare);
          b.z -= dz * error * bShare;
        }
      }
      restoreSupports();
    }
  }
  restoreSupports();
  return settled;
}
