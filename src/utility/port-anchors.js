// src/utility/port-anchors.js
//
// Where a utility port is in THREE dimensions.
//
// `portWorldPosition` (ports.js) answers the sim's question: which point on the
// footprint edge does this port own. Everything drawn then had to invent its
// own height on top of that — the available-port dots at PIPE_Y + 0.3, the
// unwired pins on a stem from PIPE_Y, the cables terminating at PIPE_Y — none
// of which relate to the model. The result was dots floating over floor tiles
// and cables stopping in mid-air beside equipment that had no visible
// connectors at all.
//
// This module is the single answer to "where does the connector go", used by
// the markers, the fittings and the cable ends alike:
//
//   portAnchor3D(placeable, def, portName)
//     → { x, y, z, out: {x, z}, standoff } | null
//
// The anchor is presentation, and only presentation. The sim keeps reading
// `portWorldPosition`, which is unchanged — topology, snapping, pathing and
// pricing cannot notice anything here.
//
// What the anchor adds is that it is measured against the MODEL rather than
// the footprint. The footprint of an on-pipe part is the reserved beam
// corridor, which is far wider than the machine: a cryomodule reserves ±1.0 m
// but draws a cryostat of about ±0.45 m, so a footprint-edge connector floated
// half a metre out on bare floor. So the anchor is resolved in the component's
// unrotated local frame — lateral distance from the axis, offset along the
// machine, height — and rotated by `dir` at the end:
//
//   lat    authored → raycast surface at the port's height → model bounds →
//          footprint half-extent (the old number, and the headless answer)
//   along  authored → the port's own `offsetAlong` lerped across the model's
//          measured length → 0 (centred, the headless answer)
//   y      authored → mid-shell from the model bounds → DEFAULT_ANCHOR_Y
//
// Both measurements come from the renderer, injected rather than imported so
// this module stays usable headless — in tests and in any code path without
// THREE. With neither provider registered every step falls through to its last
// option, and x/z come back byte-identical to `portWorldPosition`. That
// fallback is a contract, not an accident: it is what keeps the node suite and
// every headless path seeing exactly the sim's numbers.

import {
  portApproachVec,
  portLocalAxis,
  placeableCenterWorld,
  footprintHalfExtents,
  rotateLocalOffset,
  getPortSpec,
  portWorldPosition,
} from './ports.js';
import { portAnchorOverride } from '../data/utility-port-anchors.js';

// Used when nothing knows better: roughly waist height on a person-sized
// device, and above the cable plane so a riser always rises.
export const DEFAULT_ANCHOR_Y = 0.8;

// Derived anchors sit at this fraction of the model's height — mid-shell,
// which is where a connector plate lives on most equipment.
const DERIVED_HEIGHT_FRACTION = 0.55;

// A derived anchor is clamped into this band: never underground, never on a
// roof where a cable would have to climb a cryostat to reach it.
const MIN_ANCHOR_Y = 0.35;
const MAX_ANCHOR_Y = 2.0;

// How far the connector stands off the shell, in metres, before the extra the
// override table may add.
const BASE_STANDOFF = 0.06;

// A measured surface closer to the axis than this is a bad measurement, not a
// tiny machine — a ray that slipped through a gap and hit the beam pipe, say.
// Keep the connector out where a hand could reach it.
const MIN_LATERAL = 0.05;

let _boundsProvider = null;
let _measureProvider = null;

// `${type}:${portName}` → { lat, along, y }, all in local metres. Resolving a
// mount instantiates the model, so it happens once per type and is remembered;
// re-registering either provider throws the lot away, because the answers were
// computed from what the old providers said.
const _mountCache = new Map();

/**
 * Register the model-bounds source. The renderer calls this at startup with
 * component-builder's `getModelBounds`; without it, derivation is skipped and
 * every unauthored port takes DEFAULT_ANCHOR_Y at the footprint edge.
 *
 * @param {(type: string) => {minX, maxX, minY, maxY, minZ, maxZ}|null} fn
 */
export function setModelBoundsProvider(fn) {
  _boundsProvider = typeof fn === 'function' ? fn : null;
  _mountCache.clear();
}

/**
 * Register the shell-measurement source: component-builder's
 * `measureShellSurfaces`. Without it the lateral offset falls back to the
 * model's bounding box and then to the footprint.
 *
 * @param {(type: string, requests: Array<object>) => Map<string, number|null>} fn
 */
export function setShellMeasureProvider(fn) {
  _measureProvider = typeof fn === 'function' ? fn : null;
  _mountCache.clear();
}

function modelBounds(type) {
  if (!_boundsProvider || !type) return null;
  return _boundsProvider(type) || null;
}

function derivedY(bounds) {
  if (!bounds || !Number.isFinite(bounds.maxY) || bounds.maxY <= 0) return null;
  // Fraction of the model's OWN vertical span, not of the distance from the
  // floor. On-pipe hardware sits on the beam axis a metre up, so `maxY * 0.55`
  // put the anchor below the model entirely and the connector hung in mid-air
  // under it — the most visible case being unauthored RF plant. Falling back
  // to 0 for a missing minY reproduces the old answer for floor-standing
  // equipment, whose minY is 0 anyway.
  const minY = Number.isFinite(bounds.minY) ? Math.max(0, bounds.minY) : 0;
  const y = minY + (bounds.maxY - minY) * DERIVED_HEIGHT_FRACTION;
  return Math.min(MAX_ANCHOR_Y, Math.max(MIN_ANCHOR_Y, y));
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Where along the machine this port sits, in local metres on the axis
 * perpendicular to the one it faces.
 *
 * `offsetAlong` is declared on nearly every port in utility-ports-v2.js and has
 * never been read: 0.5 and 0.8 on the same side of a 8 m cryomodule resolved to
 * the same point. It is a fraction of the machine's own length, so it needs the
 * measured extent to become metres. Headless, use the footprint extent so the
 * answer remains identical to the sim's `portWorldPosition`.
 */
function resolveAlong(spec, override, bounds, perpAxis, halfPerp) {
  let along = 0;
  if (override && Number.isFinite(override.along)) {
    along = override.along;
  } else if (spec && Number.isFinite(spec.offsetAlong) && bounds) {
    const lo = bounds[perpAxis === 'x' ? 'minX' : 'minZ'];
    const hi = bounds[perpAxis === 'x' ? 'maxX' : 'maxZ'];
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) {
      along = lo + (hi - lo) * spec.offsetAlong;
    }
  } else if (spec && Number.isFinite(spec.offsetAlong)) {
    const fraction = clamp(spec.offsetAlong, 0.1, 0.9);
    along = -halfPerp + (halfPerp * 2) * fraction;
  }
  // Never past the footprint: a connector that pokes into the neighbouring
  // tile reads as belonging to whatever is placed there.
  return clamp(along, -halfPerp, halfPerp);
}

/**
 * How far out from the axis the connector bolts on, in local metres.
 * `measured` is the raycast answer for this port, or null.
 */
function resolveLat(override, bounds, measured, axis, sign, halfLat) {
  let lat = null;
  if (override && Number.isFinite(override.lat)) {
    lat = override.lat;
  } else if (Number.isFinite(measured)) {
    lat = measured;
  } else if (bounds) {
    // The box on the port's OWN side: models are centred on the footprint but
    // not always symmetric, and a klystron's gallery on one flank should not
    // push the connector out on the other.
    const edge = sign > 0
      ? bounds[axis === 'x' ? 'maxX' : 'maxZ']
      : bounds[axis === 'x' ? 'minX' : 'minZ'];
    if (Number.isFinite(edge)) lat = Math.abs(edge);
  }
  // The footprint edge is the last resort and the headless answer, and it must
  // survive the clamp untouched — hence min/max rather than any rescaling.
  if (lat == null) lat = halfLat;
  return clamp(lat, MIN_LATERAL, halfLat);
}

/**
 * Resolve and cache the mount for every port on a type at once.
 *
 * One call, one model instantiation: measuring a port one at a time would walk
 * a cryomodule's builder four times over.
 */
function resolveTypeMounts(type, def, portsFlipped = false) {
  const bounds = modelBounds(type);
  const half = footprintHalfExtents(def);
  const ports = [];
  for (const portName of Object.keys((def && def.ports) || {})) {
    const local = portLocalAxis(def, portName, portsFlipped);
    if (!local) continue;
    const spec = getPortSpec(def, portName);
    const override = type ? portAnchorOverride(type, portName) : null;
    const y = (override && Number.isFinite(override.y))
      ? override.y
      : (derivedY(bounds) ?? DEFAULT_ANCHOR_Y);
    const perpAxis = local.axis === 'x' ? 'z' : 'x';
    const halfPerp = perpAxis === 'x' ? half.x : half.z;
    const along = resolveAlong(spec, override, bounds, perpAxis, halfPerp);
    ports.push({ portName, local, override, y, along });
  }

  let measured = null;
  if (_measureProvider && type && ports.length > 0) {
    const requests = ports.map((p) => ({
      key: p.portName,
      axis: p.local.axis,
      sign: p.local.sign,
      y: p.y,
      along: p.along,
    }));
    measured = _measureProvider(type, requests) || null;
  }

  const mounts = new Map();
  for (const p of ports) {
    const halfLat = p.local.axis === 'x' ? half.x : half.z;
    const hit = measured && typeof measured.get === 'function'
      ? measured.get(p.portName)
      : null;
    const lat = resolveLat(p.override, bounds, hit, p.local.axis, p.local.sign, halfLat);
    const mount = { lat, along: p.along, y: p.y };
    mounts.set(p.portName, mount);
    if (type) _mountCache.set(`${type}:${p.portName}:${portsFlipped ? 1 : 0}`, mount);
  }
  return mounts;
}

function mountFor(type, def, portName, portsFlipped = false) {
  if (type) {
    const hit = _mountCache.get(`${type}:${portName}:${portsFlipped ? 1 : 0}`);
    if (hit) return hit;
  }
  return resolveTypeMounts(type, def, portsFlipped).get(portName) || null;
}

/**
 * The 3D anchor of one port, or null when the port has no resolvable position
 * (unknown port name, no side, missing def).
 */
export function portAnchor3D(placeable, def, portName) {
  if (!placeable || !portName) return null;
  const portsFlipped = placeable.portsFlipped === true;
  const local = portLocalAxis(def, portName, portsFlipped);
  if (!local) return null;
  // Renderer snapshot records mark pipe attachments with null subtile fields,
  // while utility-endpoint records carry `isPlacement` and synthetic negative
  // subtile fields for the simulation geometry. Both describe the same thing:
  // col/row is the attachment's sampled pipe position and the rendered model
  // is centred at the containing tile centre. Recognise both record shapes so
  // presentation anchors do not lose the renderer's +1 m centre offset.
  const onPipe = placeable.isPlacement === true
    || (placeable.subCol == null && placeable.subRow == null);
  const explicitCentre = Number.isFinite(placeable.worldX) && Number.isFinite(placeable.worldZ)
    ? { x: placeable.worldX, z: placeable.worldZ }
    : null;
  const centre = explicitCentre || (onPipe
    ? { x: (placeable.col || 0) * 2 + 1, z: (placeable.row || 0) * 2 + 1 }
    : placeableCenterWorld(placeable, def));
  if (!centre) return null;

  const type = placeable.type;
  const mount = mountFor(type, def, portName, portsFlipped);
  if (!mount) return null;

  // With no renderer geometry to measure, presentation must land exactly on
  // the simulation endpoint. This also preserves the sim's clockwise
  // offsetAlong convention on opposite faces; measured model anchors use
  // their authored local coordinates instead.
  const simFallback = (!_boundsProvider && !_measureProvider && !onPipe)
    ? portWorldPosition(placeable, def, portName)
    : null;

  const vec = portApproachVec(placeable, def, portName);
  // Path coords are (col, row) = (x/2, z/2), so an outward normal of one tile
  // step is one unit in each — direction only, magnitude comes from standoff.
  const out = vec ? { x: vec.dCol, z: vec.dRow } : { x: 0, z: 0 };

  const override = type ? portAnchorOverride(type, portName) : null;
  const standoff = BASE_STANDOFF + ((override && override.out) || 0);

  // Local offset → world: lateral outward along the port's own axis, `along`
  // on the perpendicular one, then the placeable's quarter turns.
  const lat = local.sign * mount.lat;
  const offset = rotateLocalOffset(
    local.axis === 'x' ? { x: lat, z: mount.along } : { x: mount.along, z: lat },
    placeable.dir || 0,
  );

  return {
    x: simFallback ? simFallback.x : centre.x + offset.x,
    y: mount.y + (Number.isFinite(placeable.yOffset) ? placeable.yOffset : 0),
    z: simFallback ? simFallback.z : centre.z + offset.z,
    out,
    standoff,
  };
}

export default portAnchor3D;
