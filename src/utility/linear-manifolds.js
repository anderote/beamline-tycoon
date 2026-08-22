// Continuous utility carriers.
//
// A linear manifold is the utility equivalent of a beam pipe: the player
// chooses two points, the carrier is fabricated between them, and fittings
// are generated at a regular pitch.  This module deliberately contains no
// Game/Input/renderer imports.  It is the shared geometry and pricing
// contract that those layers can consume without each inventing a slightly
// different meaning for "a manifold run".

export const LINEAR_MANIFOLD_DEFAULTS = Object.freeze({
  tapSpacingSubtiles: 4,
  minLengthSubtiles: 4,
  maxLengthSubtiles: 256,
  costPerSubtile: 0,
  trayFamily: 'utility-tray',
});

function finiteInt(value, fallback = 0) {
  return Number.isFinite(value) ? Math.round(value) : fallback;
}

function normalizePoint(point) {
  return {
    col: finiteInt(point?.col),
    row: finiteInt(point?.row),
    subCol: finiteInt(point?.subCol),
    subRow: finiteInt(point?.subRow),
  };
}

function subPoint(point) {
  const p = normalizePoint(point);
  return { x: p.col * 4 + p.subCol, z: p.row * 4 + p.subRow };
}

function pointFromSub(x, z) {
  const col = Math.floor(x / 4);
  const row = Math.floor(z / 4);
  return {
    col, row,
    subCol: x - col * 4,
    subRow: z - row * 4,
  };
}

function samePoint(a, b) { return a.x === b.x && a.z === b.z; }

/**
 * Snap a drag to one orthogonal run.  The dominant axis wins; ties are
 * deterministic (X first), matching the beamline drawing convention.
 */
export function snapLinearManifoldPath(start, end, { axis = null } = {}) {
  const a = subPoint(start);
  const b = subPoint(end);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const chosen = axis === 'z' || axis === 'row'
    ? 'z'
    : axis === 'x' || axis === 'col'
      ? 'x'
      : Math.abs(dx) >= Math.abs(dz) ? 'x' : 'z';
  const target = { x: chosen === 'x' ? b.x : a.x, z: chosen === 'z' ? b.z : a.z };
  return { axis: chosen, start: pointFromSub(a.x, a.z), end: pointFromSub(target.x, target.z) };
}

function rangeInclusive(first, last, step) {
  const direction = Math.sign(last - first);
  if (!direction || step <= 0) return [first];
  const out = [first];
  for (let value = first + direction * step;
       direction > 0 ? value < last : value > last;
       value += direction * step) out.push(value);
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/** Generate evenly spaced backbone coordinates, always including both ends. */
export function manifoldTapCoordinates(start, end, options = {}) {
  const snapped = snapLinearManifoldPath(start, end, options);
  const a = subPoint(snapped.start);
  const b = subPoint(snapped.end);
  const step = Math.max(1, finiteInt(options.tapSpacingSubtiles,
    LINEAR_MANIFOLD_DEFAULTS.tapSpacingSubtiles));
  const values = snapped.axis === 'x'
    ? rangeInclusive(a.x, b.x, step).map(x => ({ x, z: a.z }))
    : rangeInclusive(a.z, b.z, step).map(z => ({ x: a.x, z }));
  return { ...snapped, points: values.map(p => pointFromSub(p.x, p.z)) };
}

function mergeSpec(def, options) {
  return { ...LINEAR_MANIFOLD_DEFAULTS, ...(def?.linearManifold || {}), ...(options || {}) };
}

/**
 * Build the serializable plan consumed by a future commit command.  Port
 * names are stable under reversal: tap_000 is the first physical fitting in
 * the drawn direction, while every fitting also exposes left/right or
 * front/back branch ports.  `backbone` is one continuous pass conductor.
 */
export function planLinearManifold({ type, def, start, end, axis, ...options } = {}) {
  const spec = mergeSpec(def, { ...options, axis });
  const geometry = manifoldTapCoordinates(start, end, spec);
  const delta = geometry.axis === 'x'
    ? Math.abs(geometry.end.subCol + geometry.end.col * 4
      - (geometry.start.subCol + geometry.start.col * 4))
    : Math.abs(geometry.end.subRow + geometry.end.row * 4
      - (geometry.start.subRow + geometry.start.row * 4));
  const lengthSubtiles = delta;
  const valid = lengthSubtiles >= spec.minLengthSubtiles
    && lengthSubtiles <= spec.maxLengthSubtiles;
  const taps = geometry.points.map((point, index) => ({
    index,
    id: `${type || 'manifold'}:tap_${String(index).padStart(3, '0')}`,
    point,
    backbonePort: `backbone_${String(index).padStart(3, '0')}`,
    branchPort: `tap_${String(index).padStart(3, '0')}`,
  }));
  return {
    type: type || null,
    utility: spec.utility || null,
    trayFamily: spec.trayFamily,
    axis: geometry.axis,
    start: geometry.start,
    end: geometry.end,
    lengthSubtiles,
    tapSpacingSubtiles: spec.tapSpacingSubtiles,
    taps,
    cost: { funding: Math.max(0, lengthSubtiles * (spec.costPerSubtile || 0)) },
    valid,
    reason: valid ? null : lengthSubtiles < spec.minLengthSubtiles ? 'too_short' : 'too_long',
  };
}

/** Dynamic port contract for a placed manifold instance. */
export function linearManifoldPortSpec(instance, def, portName) {
  if (!instance?.linearManifold || !def?.linearManifold || !portName) return null;
  if (portName === 'backbone') {
    return { utility: def.linearManifold.utility, role: 'pass', through: true, bus: true };
  }
  const tap = (instance.linearManifold.taps || []).find(t => t.branchPort === portName);
  if (!tap) return null;
  return {
    utility: def.linearManifold.utility,
    role: 'pass',
    bus: true,
    params: { serviceRadius: def.linearManifold.serviceRadius || 0 },
  };
}

export function isLinearManifold(def) {
  return !!(def && def.linearManifold && def.linearManifold.utility);
}
