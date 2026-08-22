// src/renderer3d/waveguide-presentation.js
//
// Pure presentation math for routed rectangular RF waveguide. The utility
// graph stores a 2D Manhattan centreline; this module turns the last few
// metres at a real connector into the fabricated 3D shape a waveguide shop
// would build:
//
//   floor run -> orthogonal floor reconciliation -> sloped rise -> flange
//
// It also lays out support frames along sufficiently long deck runs. Keeping
// this math free of THREE makes arbitrary port heights/offsets testable without
// a renderer and keeps the simulation path, cost and topology untouched.

const EPS = 1e-6;

function finite(v) { return Number.isFinite(v); }

function finitePoint(point) {
  return !!point && finite(point.x) && finite(point.y) && finite(point.z);
}

function pushDistinct(points, point) {
  if (!finitePoint(point)) return;
  const prev = points[points.length - 1];
  if (prev
    && Math.abs(prev.x - point.x) < EPS
    && Math.abs(prev.y - point.y) < EPS
    && Math.abs(prev.z - point.z) < EPS) return;
  points.push({ x: point.x, y: point.y, z: point.z });
}

function horizontalOut(anchor) {
  const x = finite(anchor?.out?.x) ? anchor.out.x : 0;
  const z = finite(anchor?.out?.z) ? anchor.out.z : 0;
  const length = Math.hypot(x, z);
  return length > EPS ? { x: x / length, z: z / length } : null;
}

/**
 * The three authored points of a flange-to-deck dogleg.
 *
 * `tip` is the visible end of the connector fitting. `upper` gives the guide
 * enough straight length to clear the equipment shell before it changes
 * elevation. `landing` is the low end of the sloped section and therefore the
 * point the 2D floor route should approach.
 */
export function waveguideDropProfile(anchor, runY, opts = {}) {
  if (!anchor || !finite(anchor.x) || !finite(anchor.y) || !finite(anchor.z)
    || !finite(runY)) return null;
  const out = horizontalOut(anchor);
  if (!out) return null;

  const standoff = finite(anchor.standoff) ? Math.max(0, anchor.standoff) : 0;
  const launch = finite(opts.launchMeters) ? Math.max(0, opts.launchMeters) : 0.28;
  const minRamp = finite(opts.minRampMeters) ? Math.max(0, opts.minRampMeters) : 0.35;
  const maxRamp = finite(opts.maxRampMeters)
    ? Math.max(minRamp, opts.maxRampMeters) : 1.35;
  const runPerRise = finite(opts.runPerRise) ? Math.max(0.1, opts.runPerRise) : 1;
  const rise = anchor.y - runY;
  const ramp = Math.abs(rise) < EPS
    ? 0
    : Math.min(maxRamp, Math.max(minRamp, Math.abs(rise) * runPerRise));

  const tip = {
    x: anchor.x + out.x * standoff,
    y: anchor.y,
    z: anchor.z + out.z * standoff,
  };
  const upper = {
    x: tip.x + out.x * launch,
    y: tip.y,
    z: tip.z + out.z * launch,
  };
  const landing = {
    x: upper.x + out.x * ramp,
    y: runY,
    z: upper.z + out.z * ramp,
  };
  return { tip, upper, landing, out, ramp };
}

/**
 * Build one complete run-first connector transition as plain `{x,y,z}`
 * points. The floor reconciliation is Manhattan even when a legacy path ends
 * at the old footprint edge; the only intentionally diagonal piece is the
 * fabricated sloped drop between `landing` and `upper`.
 */
export function waveguideTransitionPoints(anchor, runY, runPoint, opts = {}) {
  if (!finitePoint(runPoint)) return [];
  const profile = waveguideDropProfile(anchor, runY, opts);
  if (!profile) return [];

  const points = [];
  pushDistinct(points, { x: runPoint.x, y: runY, z: runPoint.z });

  // Reconcile on the deck before rising. Move along the port-normal axis
  // first so an old footprint-edge endpoint clears the equipment before any
  // tangential correction. This also handles measured anchors whose along
  // offset is not represented by a legacy two-point path.
  if (Math.abs(profile.out.x) >= Math.abs(profile.out.z)) {
    pushDistinct(points, { x: profile.landing.x, y: runY, z: runPoint.z });
  } else {
    pushDistinct(points, { x: runPoint.x, y: runY, z: profile.landing.z });
  }
  pushDistinct(points, profile.landing);
  pushDistinct(points, profile.upper);
  pushDistinct(points, profile.tip);
  return points;
}

function floorSegment(a, b, floorY, tolerance) {
  if (!finitePoint(a) || !finitePoint(b)) return null;
  if (Math.abs(a.y - floorY) > tolerance || Math.abs(b.y - floorY) > tolerance) return null;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  if (length < EPS) return null;
  return { a, b, length, direction: { x: dx / length, y: 0, z: dz / length } };
}

function mergeCollinearDeckSegments(segments) {
  const merged = [];
  let distanceAlongRun = 0;
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    const sameDirection = previous
      && previous.direction.x * segment.direction.x
        + previous.direction.z * segment.direction.z > 1 - EPS;
    const joined = previous
      && Math.hypot(previous.b.x - segment.a.x, previous.b.z - segment.a.z) < EPS;
    if (sameDirection && joined) {
      previous.b = segment.b;
      previous.length += segment.length;
    } else {
      merged.push({
        ...segment,
        direction: { ...segment.direction },
        distanceAlongRun,
      });
    }
    distanceAlongRun += segment.length;
  }
  return merged;
}

function worldLatticeSupportFrames(chain, floorY, spacing, phase, runLength) {
  const frames = [];
  const normalizedPhase = ((phase % spacing) + spacing) % spacing;
  for (const segment of mergeCollinearDeckSegments(chain)) {
    const axis = Math.abs(segment.direction.x) >= Math.abs(segment.direction.z) ? 'x' : 'z';
    const start = segment.a[axis];
    const end = segment.b[axis];
    const low = Math.min(start, end);
    const high = Math.max(start, end);
    if (high - low < EPS) continue;

    // Keep stations off connectors and corners. Collinear authored waypoints
    // were merged above, so they cannot accidentally leave a hole in a run.
    let index = Math.ceil((low - normalizedPhase + EPS) / spacing);
    for (let coordinate = normalizedPhase + index * spacing;
      coordinate < high - EPS;
      coordinate = normalizedPhase + (++index) * spacing) {
      const t = (coordinate - start) / (end - start);
      frames.push({
        point: {
          x: segment.a.x + (segment.b.x - segment.a.x) * t,
          y: floorY,
          z: segment.a.z + (segment.b.z - segment.a.z) * t,
        },
        direction: { ...segment.direction },
        distanceAlongRun: segment.distanceAlongRun + segment.length * t,
        runLength,
      });
    }
  }
  return frames;
}

/**
 * Evenly spaced support locations for every long, contiguous deck-level run.
 * The spacing is a maximum span: `count = floor(length / spacing)` and then
 * equal subdivision keeps both end spans shorter than the requested spacing.
 * Rigid service racks can instead opt into a shared world-space lattice so
 * separately authored, partially overlapping lines reuse the same steelwork.
 */
export function utilitySupportFrames(points, opts = {}) {
  if (!Array.isArray(points) || points.length < 2) return [];
  const floorY = finite(opts.floorY) ? opts.floorY : 0;
  const spacing = finite(opts.spacingMeters) ? Math.max(0.25, opts.spacingMeters) : 3;
  const minimum = finite(opts.minimumRunMeters)
    ? Math.max(spacing, opts.minimumRunMeters) : 5;
  const tolerance = finite(opts.heightToleranceMeters)
    ? Math.max(EPS, opts.heightToleranceMeters) : 0.025;
  const worldStationLattice = opts.worldStationLattice === true;
  const stationPhase = finite(opts.stationPhaseMeters)
    ? opts.stationPhaseMeters : spacing * 0.5;
  const frames = [];
  let chain = [];

  const flush = () => {
    if (chain.length === 0) return;
    const total = chain.reduce((sum, segment) => sum + segment.length, 0);
    if (total + EPS >= minimum) {
      if (worldStationLattice) {
        frames.push(...worldLatticeSupportFrames(
          chain, floorY, spacing, stationPhase, total,
        ));
      } else {
        const count = Math.max(1, Math.floor(total / spacing));
        const interval = total / (count + 1);
        let segmentIndex = 0;
        let segmentStart = 0;
        for (let i = 1; i <= count; i++) {
          const distance = interval * i;
          while (segmentIndex < chain.length - 1
            && segmentStart + chain[segmentIndex].length < distance - EPS) {
            segmentStart += chain[segmentIndex].length;
            segmentIndex++;
          }
          const segment = chain[segmentIndex];
          const t = Math.max(0, Math.min(1,
            (distance - segmentStart) / segment.length));
          frames.push({
            point: {
              x: segment.a.x + (segment.b.x - segment.a.x) * t,
              y: floorY,
              z: segment.a.z + (segment.b.z - segment.a.z) * t,
            },
            direction: { ...segment.direction },
            distanceAlongRun: distance,
            runLength: total,
          });
        }
      }
    }
    chain = [];
  };

  for (let i = 0; i < points.length - 1; i++) {
    const segment = floorSegment(points[i], points[i + 1], floorY, tolerance);
    if (segment) chain.push(segment);
    else flush();
  }
  flush();
  return frames;
}

// Compatibility name for the original RF-only caller. Support layout is
// utility-agnostic: any rigid service whose descriptor opts into periodic
// stands uses the same contiguous, deck-level run math.
export const waveguideSupportFrames = utilitySupportFrames;
