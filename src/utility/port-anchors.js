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
// x/z are byte-identical to portWorldPosition — the sim does not move. y is
// authored (src/data/utility-port-anchors.js) or derived from the component's
// model bounds. `out` is the port's outward normal, and `standoff` how far a
// connector should stand proud of the shell along it.
//
// Model bounds come from the renderer (only the mesh knows how tall a thing
// is), injected rather than imported so this module stays usable headless — in
// tests and in any code path that runs without THREE, every port falls back to
// the neutral height below.

import { portWorldPosition, portApproachVec } from './ports.js';
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

let _boundsProvider = null;

/**
 * Register the model-bounds source. The renderer calls this at startup with
 * component-builder's `getModelBounds`; without it, derivation is skipped and
 * every unauthored port takes DEFAULT_ANCHOR_Y.
 *
 * @param {(type: string) => {minY, maxY}|null} fn
 */
export function setModelBoundsProvider(fn) {
  _boundsProvider = typeof fn === 'function' ? fn : null;
}

function derivedY(type) {
  if (!_boundsProvider) return null;
  const bounds = _boundsProvider(type);
  if (!bounds || !Number.isFinite(bounds.maxY) || bounds.maxY <= 0) return null;
  const y = bounds.maxY * DERIVED_HEIGHT_FRACTION;
  return Math.min(MAX_ANCHOR_Y, Math.max(MIN_ANCHOR_Y, y));
}

/**
 * The 3D anchor of one port, or null when the port has no resolvable position
 * (unknown port name, no side, missing def).
 */
export function portAnchor3D(placeable, def, portName) {
  const pos = portWorldPosition(placeable, def, portName);
  if (!pos) return null;
  const vec = portApproachVec(placeable, def, portName);
  // Path coords are (col, row) = (x/2, z/2), so an outward normal of one tile
  // step is one unit in each — direction only, magnitude comes from standoff.
  const out = vec ? { x: vec.dCol, z: vec.dRow } : { x: 0, z: 0 };

  const type = placeable && placeable.type;
  const override = type ? portAnchorOverride(type, portName) : null;
  const y = (override && Number.isFinite(override.y))
    ? override.y
    : (derivedY(type) ?? DEFAULT_ANCHOR_Y);
  const standoff = BASE_STANDOFF + ((override && override.out) || 0);

  // x/z are the sim's port point exactly — a consumer that wants to stand
  // proud of the shell adds `out * standoff` itself, so nothing here can drift
  // away from what snapping and pathing believe.
  return { x: pos.x, y, z: pos.z, out, standoff };
}

export default portAnchor3D;
