// Pure fixture-light projection math. No THREE imports: painted pools, real
// spots, volumetric proxies, and Node tests all consume the same calculation.

import {
  wallFixtureFaceOffset,
  wallFixturePose,
} from '../game/wall-fixture-geometry.js';

// Preserve this module's public API while the geometry itself stays in the
// dependency-neutral home shared with placement and utility ports.
export { wallFixtureFaceOffset, wallFixturePose };

const DEG2RAD = Math.PI / 180;
const EPS = 1e-6;
const MAX_HALF_ANGLE = Math.PI / 2 - 1e-3;
const DEFAULT_AIMED_FULL_ANGLE_DEG = 30;
const AIMED_BOUNDARY_SAMPLES = 48;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function normalize(v) {
  const len = Math.hypot(v.x, v.y, v.z);
  if (!(len > EPS)) return { x: 0, y: -1, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function isAimedFixture(def) {
  // Wall luminaires are directional even when their authored shape is
  // "point": their reflector faces away from the mounting plane, so treating
  // them as a centred downlight wastes half the cone inside the wall.
  return def?.mount === 'wall' || (
    (def?.mount === 'ground' || def?.mount === 'surface')
    && def?.light?.shape === 'cone'
  );
}

export function aimYaw(dir = 0) {
  return -((dir || 0) * (Math.PI / 2));
}

export function aimVector(yaw = 0) {
  const x = Math.cos(yaw);
  const z = -Math.sin(yaw);
  return {
    x: Math.abs(x) < EPS ? 0 : x,
    z: Math.abs(z) < EPS ? 0 : z,
  };
}

/** Local +Z rotated by yaw — the outward face of wall-fixture geometry. */
export function wallAimVector(yaw = 0) {
  const x = Math.sin(yaw);
  const z = Math.cos(yaw);
  return {
    x: Math.abs(x) < EPS ? 0 : x,
    z: Math.abs(z) < EPS ? 0 : z,
  };
}

export function lightPoolRadius(light) {
  const radius = light?.poolRadius ?? light?.radius ?? 0;
  return Number.isFinite(radius) && radius > 0 ? radius : 0;
}

/** World-space floor height below a fixture group origin. */
export function fixtureFloorY(def, originY = 0) {
  if (def?.mount === 'ground' || def?.mount === 'surface') return originY;
  const mountHeight = def?.light?.mountY ?? def?.light?.emitterY ?? 0;
  return originY - mountHeight;
}

/** World-space group-origin height for a fixture placed on a floor. */
export function fixtureMountY(def, floorY = 0) {
  if (def?.mount === 'ground' || def?.mount === 'surface') return floorY;
  const mountHeight = def?.mountY ?? def?.light?.mountY ?? def?.light?.emitterY ?? 0;
  return floorY + mountHeight;
}

function footprintFromBounds(points, emitter, fallbackRadius = 0) {
  if (!points.length) {
    return {
      rx: fallbackRadius,
      rz: fallbackRadius,
      offsetX: 0,
      offsetZ: 0,
      minX: emitter.x - fallbackRadius,
      maxX: emitter.x + fallbackRadius,
      minZ: emitter.z - fallbackRadius,
      maxZ: emitter.z + fallbackRadius,
    };
  }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  return {
    rx: Math.max(0, (maxX - minX) / 2),
    rz: Math.max(0, (maxZ - minZ) / 2),
    offsetX: cx - emitter.x,
    offsetZ: cz - emitter.z,
    minX, maxX, minZ, maxZ,
  };
}

function projectAimedCone(emitter, floorY, direction, halfAngle, maxGroundRange) {
  let right = normalize({ x: -direction.z, y: 0, z: direction.x });
  if (Math.hypot(right.x, right.z) < EPS) right = { x: 1, y: 0, z: 0 };
  const upAroundCone = normalize(cross(right, direction));
  const ca = Math.cos(halfAngle);
  const sa = Math.sin(halfAngle);
  const points = [];
  let maxSlant = 0;

  for (let i = 0; i < AIMED_BOUNDARY_SAMPLES; i++) {
    const phi = (i / AIMED_BOUNDARY_SAMPLES) * Math.PI * 2;
    const cp = Math.cos(phi), sp = Math.sin(phi);
    const radial = {
      x: right.x * cp + upAroundCone.x * sp,
      y: right.y * cp + upAroundCone.y * sp,
      z: right.z * cp + upAroundCone.z * sp,
    };
    const ray = normalize({
      x: direction.x * ca + radial.x * sa,
      y: direction.y * ca + radial.y * sa,
      z: direction.z * ca + radial.z * sa,
    });
    if (ray.y >= -EPS) continue;
    let t = (floorY - emitter.y) / ray.y;
    if (!(t > 0) || !Number.isFinite(t)) continue;
    const horizontal = t * Math.hypot(ray.x, ray.z);
    if (horizontal > maxGroundRange) t *= maxGroundRange / horizontal;
    points.push({ x: emitter.x + ray.x * t, y: floorY, z: emitter.z + ray.z * t });
    maxSlant = Math.max(maxSlant, t);
  }
  return { points, maxSlant };
}

/**
 * Resolve one fixture into a physically coherent real-spot packet and the
 * ground footprint used by the painted spill underneath it.
 *
 * `origin` is the already-mounted fixture group's world origin. For wall and
 * overhead fixtures that origin is above the floor; for ground fixtures it is
 * on the floor. `yaw` follows the renderer's existing -dir*90 convention.
 */
export function fixtureLightProjection(def, { origin = {}, yaw = 0 } = {}) {
  const light = def?.light || {};
  const ox = Number.isFinite(origin.x) ? origin.x : 0;
  const oy = Number.isFinite(origin.y) ? origin.y : 0;
  const oz = Number.isFinite(origin.z) ? origin.z : 0;
  const floorY = fixtureFloorY(def, oy);
  const supported = def?.mount === 'ground' || def?.mount === 'surface';
  const nominalEmitterY = supported
    ? floorY + (light.emitterY ?? 0)
    : oy;
  const sourceOffsetY = Number.isFinite(light.sourceOffsetY) ? light.sourceOffsetY : 0;
  const emitterY = nominalEmitterY + sourceOffsetY;
  const emitterHeight = Math.max(EPS, emitterY - floorY);
  const emitter = { x: ox, y: floorY + emitterHeight, z: oz };
  const poolRadius = lightPoolRadius(light);
  const aimed = isAimedFixture(def);

  if (!(poolRadius > 0)) {
    const target = { x: emitter.x, y: floorY, z: emitter.z };
    return {
      aimed,
      floorY,
      emitter,
      target,
      direction: { x: 0, y: -1, z: 0 },
      distance: Math.max(0.25, emitterHeight),
      halfAngle: EPS,
      penumbra: clamp(light.penumbra ?? 0.55, 0, 1),
      poolRadius: 0,
      groundFootprint: footprintFromBounds([], emitter, 0),
    };
  }

  if (!aimed) {
    const halfAngle = clamp(Math.atan2(poolRadius, emitterHeight), EPS, MAX_HALF_ANGLE);
    const target = { x: emitter.x, y: floorY, z: emitter.z };
    const distance = Math.max(0.25, Math.hypot(poolRadius, emitterHeight) * 1.08);
    return {
      aimed,
      floorY,
      emitter,
      target,
      direction: { x: 0, y: -1, z: 0 },
      distance,
      halfAngle,
      penumbra: clamp(light.penumbra ?? 0.65, 0, 1),
      poolRadius,
      groundFootprint: footprintFromBounds([], emitter, poolRadius),
    };
  }

  const wallMounted = def?.mount === 'wall';
  const aim = wallMounted ? wallAimVector(yaw) : aimVector(yaw);
  const targetDistance = Math.max(
    0.05,
    light.targetDistance ?? poolRadius * (wallMounted ? 0.36 : 0.55),
  );
  const target = {
    x: emitter.x + aim.x * targetDistance,
    y: floorY,
    z: emitter.z + aim.z * targetDistance,
  };
  const direction = normalize({
    x: target.x - emitter.x,
    y: target.y - emitter.y,
    z: target.z - emitter.z,
  });
  const fullAngleDeg = light.wallBeamAngleDeg
    ?? light.beamAngleDeg
    ?? light.coneDeg
    ?? (wallMounted ? 96 : DEFAULT_AIMED_FULL_ANGLE_DEG);
  const halfAngle = clamp((fullAngleDeg * DEG2RAD) / 2, EPS, MAX_HALF_ANGLE);
  // Near-horizontal authored cones can otherwise project to infinity. The
  // cap is intentionally data-relative and becomes part of both render paths.
  const maxGroundRange = Math.max(
    targetDistance + 0.25,
    light.maxGroundRange ?? poolRadius * 2.2,
  );
  const projected = projectAimedCone(emitter, floorY, direction, halfAngle, maxGroundRange);
  projected.points.push(target);
  const footprint = footprintFromBounds(projected.points, emitter, poolRadius * 0.25);
  const targetSlant = Math.hypot(target.x - emitter.x, emitterHeight, target.z - emitter.z);
  const distance = Math.max(0.25, targetSlant, projected.maxSlant) * 1.05;

  return {
    aimed,
    floorY,
    emitter,
    target,
    direction,
    distance,
    halfAngle,
    penumbra: clamp(light.penumbra ?? 0.55, 0, 1),
    poolRadius,
    groundFootprint: footprint,
  };
}
