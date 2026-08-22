// src/renderer3d/utility-line-builder-v2.js
//
// Renders new-system (Phase 4) utility lines from state.utilityLines with
// per-descriptor geometry. Distinct from the legacy utility-pipe-builder.js
// which renders rack-paint segments — Phase 6 will delete the legacy file.
//
// Geometry strategy: for each line, walk the waypoint polyline in 3D, pinning
// the first and last waypoints to the actual port world positions so lines
// visually meet equipment. Between waypoints we emit straight cylinder /
// box segments per descriptor geometryStyle. A per-line cache keyed on
// (descriptor, waypoint-hash, endpoint-hash) avoids rebuilding unchanged lines.
//
// THREE is loaded as a CDN global — do NOT import it.

import { COMPONENTS } from '../data/components.js';
import { portWorldPosition, availablePorts as availablePortsFor } from '../utility/ports.js';
import { portAnchor3D } from '../utility/port-anchors.js';
import { UTILITY_TYPES, UTILITY_TYPE_LIST, utilityLineHeight } from '../utility/registry.js';
import {
  UNIVERSAL_BUS_DECK_Y,
  UNIVERSAL_BUS_HALF_WIDTH_METERS,
  UNIVERSAL_BUS_LANE_LIST,
  UNIVERSAL_RACK_TOP_Y,
  universalBusLane,
} from '../utility/universal-bus-layout.js';
import { UTILITY_LINE_Y } from '../utility/line-geometry.js';
import { FLOW_PARAMS, patchFlowMaterial, bakeRunDistanceUVs, bakeRunDistanceFromPositionZ } from './utility-flow.js';
import { BLOOM_LAYER } from './glow-pipeline.js';
import { computeLineOrientations } from '../utility/line-orientation.js';
import {
  draggedCablePath,
  isHvCableTensionAnchor,
  isSoftCable,
  relaxedCableControlPoints,
  softCableBendRadiusMeters,
  softCableControlPoints,
  tautCableControlPoints,
} from '../utility/soft-cable.js';
import {
  utilitySupportFrames,
  waveguideDropProfile,
  waveguideTransitionPoints,
} from './waveguide-presentation.js';
import { portWaterCircuit, waterCircuitColor } from '../utility/water-circuits.js';

// DEFAULT line centerline height. Per-utility heights come from
// utilityLineHeight (registry): a power cord lies on the floor while a vacuum
// pipe rides at working height. Owned by line-geometry because the height is
// also the plane the utility TOOL has to pick against — the cursor is
// projected onto the ground at y=0, so a tool that draws at 0.5 m and picks at
// 0 m puts its geometry a fixed 15-25 px up-screen of the mouse under the iso
// camera. Kept here for the marker fallbacks, which are not per-line.
const PIPE_Y = UTILITY_LINE_Y;
const SEGS = 12;     // cylinder radial segments
const FLEXIBLE_RELAX_DURATION_SECONDS = 0.9;
const UNIVERSAL_BUS_HALF_WIDTH = UNIVERSAL_BUS_HALF_WIDTH_METERS;

// Material cache keyed by (utilityType, errorStatus) — 'ok' | 'soft' | 'hard'.
// Keeps identical materials shared across lines for the same descriptor+state.
const _matCache = new Map();
const _jacketMatCache = new Map();
const _cryostatJacketMatCache = new Map();
const _cryostatBandMatCache = new Map();
const _hardwareMatCache = new Map();
let _utilitySupportMaterial = null;
let _universalBusMaterial = null;
const _universalBusPreviewMaterials = new Map();

function utilityCircuitColor(utilityType, waterCircuit = null) {
  const descriptor = UTILITY_TYPES[utilityType];
  if ((utilityType === 'waterSupplyPipe' || utilityType === 'coolingWater')
      && waterCircuit) {
    return waterCircuitColor(waterCircuit, descriptor?.color || '#ffffff');
  }
  return descriptor?.color || '#ffffff';
}

function matKey(utilityType, errorStatus, waterCircuit = null) {
  return `${utilityType}|${errorStatus || 'ok'}|${waterCircuit || '-'}`;
}

// Every cached material is tagged shared so the disposers can tell it apart
// from a per-build material: shared materials outlive any one group and must
// NOT be disposed on group teardown; anything untagged is owned by its group
// and must be disposed with it or its GPU program/buffers leak.
function shared(mat) {
  mat.userData.__shared = true;
  return mat;
}

function universalBusMaterial() {
  if (!_universalBusMaterial) {
    _universalBusMaterial = shared(new THREE.MeshStandardMaterial({
      color: 0x7d8790, roughness: 0.38, metalness: 0.82,
    }));
  }
  return _universalBusMaterial;
}

function universalBusPreviewMaterial(valid = true) {
  const key = valid ? 'valid' : 'blocked';
  if (_universalBusPreviewMaterials.has(key)) return _universalBusPreviewMaterials.get(key);
  const color = valid ? 0xaab5bc : 0xff4f38;
  const material = shared(new THREE.MeshStandardMaterial({
    color, roughness: 0.3, metalness: 0.72,
    transparent: true, opacity: 0.72,
    emissive: color, emissiveIntensity: valid ? 0.12 : 0.35,
  }));
  _universalBusPreviewMaterials.set(key, material);
  return material;
}

function buildUniversalBusPreview(points, valid = true) {
  const group = new THREE.Group();
  group.userData = { isUtilityLinePreview: true, isUniversalUtilityBusPreview: true };
  const material = universalBusPreviewMaterial(valid);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-4) continue;
    const ox = -dz / length * UNIVERSAL_BUS_HALF_WIDTH;
    const oz = dx / length * UNIVERSAL_BUS_HALF_WIDTH;
    for (const side of [-1, 1]) {
      for (const y of [UNIVERSAL_BUS_DECK_Y, UNIVERSAL_RACK_TOP_Y]) {
        const rail = buildRectSegment(
          new THREE.Vector3(a.x + ox * side, y, a.z + oz * side),
          new THREE.Vector3(b.x + ox * side, y, b.z + oz * side),
          0.045, 0.07, material,
        );
        if (rail) group.add(rail);
      }
    }
    const frameCount = Math.max(1, Math.floor(length));
    for (let frame = 0; frame <= frameCount; frame++) {
      const t = frame / frameCount;
      const x = a.x + dx * t, z = a.z + dz * t;
      for (const side of [-1, 1]) {
        const post = buildRectSegment(
          new THREE.Vector3(x + ox * side, 0.03, z + oz * side),
          new THREE.Vector3(x + ox * side, UNIVERSAL_RACK_TOP_Y, z + oz * side),
          0.045, 0.045, material,
        );
        if (post) group.add(post);
      }
      for (const lane of UNIVERSAL_BUS_LANE_LIST) {
        const crossbar = buildRectSegment(
          new THREE.Vector3(x - ox, lane.runY - 0.10, z - oz),
          new THREE.Vector3(x + ox, lane.runY - 0.10, z + oz),
          0.04, 0.04, material,
        );
        if (crossbar) group.add(crossbar);
      }
    }
  }
  return group.children.length > 0 ? group : null;
}

// A line's colour is its UTILITY, always and only.
//
// Faults used to recolour the pipe — an amber emissive over green renders as
// solid yellow, which reads as "this is a different kind of pipe" rather than
// "this run is faulted", and the blend lands on a different hue for each of
// the six utilities so there is nothing to learn. Motion carries the line
// state, while compact issue markers live over the affected sink ports and
// the hover tooltip explains the cause. Electrical flow is now a surface-only
// colour variation; other utilities may still use emissive flow.
// patchFlowMaterial (utility-flow.js) uses errorStatus to select a flowState —
// 'ok' | 'soft' | 'hard' — so a faulted run keeps its colour but stutters,
// dims or stops, which is why the cache key below is per-status again: this
// is a distinct material variant, just not a distinct colour.
export function getLineMaterial(utilityType, errorStatus, waterCircuit = null) {
  const flowState = errorStatus || 'ok';
  const key = matKey(utilityType, flowState, waterCircuit);
  if (_matCache.has(key)) return _matCache.get(key);
  const color = utilityCircuitColor(utilityType, waterCircuit);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.4,
    metalness: 0.3,
  });
  if (FLOW_PARAMS[utilityType]) {
    patchFlowMaterial(mat, utilityType, flowState, color);
  }
  _matCache.set(key, shared(mat));
  return mat;
}

// Same status-gated flow as getLineMaterial, applied to the jacket too — a
// cryo line frosts on the OUTSIDE, so the jacket carrying its own baseGlow
// (rather than just standing between the viewer and the core's) is the
// physically-grounded read, and see buildLineGroup's BLOOM_LAYER handling for
// why the jacket has to bloom too or it occludes the core it's wrapping.
function getJacketMaterial(utilityType, errorStatus, waterCircuit = null) {
  const flowState = errorStatus || 'ok';
  const key = matKey(utilityType, flowState, waterCircuit);
  if (_jacketMatCache.has(key)) return _jacketMatCache.get(key);
  const color = utilityCircuitColor(utilityType, waterCircuit);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.5, metalness: 0.1,
    transparent: true, opacity: 0.35,
  });
  if (FLOW_PARAMS[utilityType]) {
    patchFlowMaterial(mat, utilityType, flowState, color);
  }
  _jacketMatCache.set(key, shared(mat));
  return mat;
}

// A transfer-line cryostat is read from the outside: an opaque stainless
// vacuum vessel, not a visible cyan process tube inside a clear sleeve. The
// restrained flow patch puts a cold-blue sheen on the metal without changing
// its material identity. Hardware and identification bands remain unanimated.
function getCryostatJacketMaterial(utilityType, errorStatus) {
  const flowState = errorStatus || 'ok';
  const key = `${utilityType}|${flowState}`;
  if (_cryostatJacketMatCache.has(key)) return _cryostatJacketMatCache.get(key);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#b8c4c9'),
    roughness: 0.22,
    metalness: 0.86,
  });
  patchFlowMaterial(mat, utilityType, flowState, '#8de7f2');
  _cryostatJacketMatCache.set(key, shared(mat));
  return mat;
}

function getCryostatBandMaterial(errorStatus) {
  const key = errorStatus || 'ok';
  if (_cryostatBandMatCache.has(key)) return _cryostatBandMatCache.get(key);
  const hard = key === 'hard' || key === 'off';
  const color = hard ? '#42616b' : '#2387a5';
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.31,
    metalness: 0.48,
    emissive: new THREE.Color(color),
    emissiveIntensity: hard ? 0 : key === 'soft' ? 0.06 : 0.11,
  });
  _cryostatBandMatCache.set(key, shared(mat));
  return mat;
}

// Elbow flanges and guide collars are hardware, not flowing contents. Keeping
// them on a separate metallic material makes every joint legible even when the
// service body is dark or carrying an emissive flow pulse.
function getLineHardwareMaterial(utilityType, waterCircuit = null) {
  const key = `${utilityType}|${waterCircuit || '-'}`;
  if (_hardwareMatCache.has(key)) return _hardwareMatCache.get(key);
  const color = utilityType === 'vacuumPipe' ? '#c4c9cc'
    : utilityType === 'cryoTransfer' ? '#c7d0d3'
    : utilityType === 'rfWaveguide' ? '#b9783f'
      : utilityCircuitColor(utilityType, waterCircuit);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.26,
    metalness: 0.78,
  });
  _hardwareMatCache.set(key, shared(mat));
  return mat;
}

function getUtilitySupportMaterial() {
  if (_utilitySupportMaterial) return _utilitySupportMaterial;
  _utilitySupportMaterial = shared(new THREE.MeshStandardMaterial({
    color: 0x99aabb,
    roughness: 0.3,
    metalness: 0.5,
  }));
  return _utilitySupportMaterial;
}

// Convert a tile-coord waypoint to 3D world (x,z). 1 tile = 2 world meters,
// matching the game's col*2 / row*2 world placement.
function tileToWorld(pt) {
  return { x: pt.col * 2, z: pt.row * 2 };
}

// Move one routed terminal onto its measured connector without changing the
// Manhattan shape of the rest of the run. The neighboring corner slides on
// the perpendicular axis, exactly as a drafting tool moves an orthogonal
// connector: endpoint and corner move together, the next leg stays put.
//
// This matters for lines saved before drawing began routing from model anchors.
// Their endpoint can be metres away on an on-pipe component's reserved
// footprint. Appending a bridge to that old point removes the diagonal but
// leaves a conspicuous rectangular loop; sliding the terminal collapses it.
function alignTerminalToTarget(points, which, target) {
  if (!target || points.length < 3) return false;
  const t = which === 'start' ? 0 : points.length - 1;
  const nb = which === 'start' ? 1 : points.length - 2;
  const endpoint = points[t];
  const neighbor = points[nb];
  const dx = Math.abs(neighbor.x - endpoint.x);
  const dz = Math.abs(neighbor.z - endpoint.z);
  if (dx < 1e-6 && dz < 1e-6) return false;
  if (dx > 1e-6 && dz > 1e-6) return false;

  endpoint.x = target.x;
  endpoint.z = target.z;
  if (dx > 1e-6) neighbor.z = target.z;
  else neighbor.x = target.x;
  return true;
}

// A saved straight run has only two waypoints, so alignTerminalToTarget cannot
// slide a neighboring corner independently at either end. Rebuild that tiny
// route between the two measured landing points instead. This removes the
// footprint-edge backtracking that otherwise makes two facing waveguide
// launchers fold through each other before joining the nominal straight run.
function alignTwoPointRunToTargets(points, startTarget, endTarget, runY) {
  if (!Array.isArray(points) || points.length !== 2) return false;
  const originalStart = points[0];
  const originalEnd = points[1];
  const startsAlongX = Math.abs(originalEnd.x - originalStart.x)
    >= Math.abs(originalEnd.z - originalStart.z);
  const start = startTarget || originalStart;
  const end = endTarget || originalEnd;
  const rebuilt = [new THREE.Vector3(start.x, runY, start.z)];
  const differsX = Math.abs(end.x - start.x) > 1e-6;
  const differsZ = Math.abs(end.z - start.z) > 1e-6;
  if (differsX && differsZ) {
    rebuilt.push(startsAlongX
      ? new THREE.Vector3(end.x, runY, start.z)
      : new THREE.Vector3(start.x, runY, end.z));
  }
  rebuilt.push(new THREE.Vector3(end.x, runY, end.z));
  points.splice(0, points.length, ...rebuilt);
  return true;
}

function anchorFor(ref, placeablesById) {
  if (!ref || !placeablesById) return null;
  const rec = placeablesById.get(ref.placeableId);
  if (!rec) return null;
  return portAnchor3D(rec, COMPONENTS[rec.type], ref.portName);
}

function anchorTip(anchor) {
  if (!anchor) return null;
  const out = anchor.out || { x: 0, y: 0, z: 0 };
  const standoff = anchor.standoff || 0;
  return {
    x: anchor.x + out.x * standoff,
    y: anchor.y + (out.y || 0) * standoff,
    z: anchor.z + out.z * standoff,
  };
}

// A top-facing fitting cannot use the ordinary port riser: dropping at the
// anchor's X/Z sends the line vertically through the equipment. Its simulation
// port remains on an authored footprint side, which is the presentation-only
// landing point for a vertical leg outside the cabinet or vessel.
function topPortSideDropLanding(ref, placeablesById, anchor) {
  if (!ref || !placeablesById || !anchor) return null;
  if (!anchor.out || anchor.out.y < 0.5) return null;
  const rec = placeablesById.get(ref.placeableId);
  const def = rec && COMPONENTS[rec.type];
  const landing = rec && def ? portWorldPosition(rec, def, ref.portName) : null;
  return landing ? { x: landing.x, z: landing.z } : null;
}

/** HV spans shed drawn slack when either end is held by tensioning hardware. */
export function isTensionedHvCable(line, placeablesById) {
  if (line?.utilityType !== 'hvCable') return false;
  if (line.tensioned === true) return true;
  if (!placeablesById) return false;
  return [line.start, line.end].some(ref => {
    const endpoint = ref ? placeablesById.get(ref.placeableId) : null;
    return isHvCableTensionAnchor(COMPONENTS[endpoint?.type], ref?.portName);
  });
}

function waveguideDropOptions(descriptor) {
  return {
    launchMeters: descriptor?.dropLaunchMeters,
    minRampMeters: descriptor?.dropMinRampMeters,
    maxRampMeters: descriptor?.dropMaxRampMeters,
    runPerRise: descriptor?.dropRunPerRise,
  };
}

function attachWaveguideTransitions(points, startAnchor, endAnchor, runY, descriptor) {
  if (!Array.isArray(points) || points.length === 0) return points;
  const opts = waveguideDropOptions(descriptor);
  const startDrop = waveguideDropProfile(startAnchor, runY, opts);
  const endDrop = waveguideDropProfile(endAnchor, runY, opts);
  const alignedShortRun = alignTwoPointRunToTargets(
    points,
    startDrop?.landing || startAnchor,
    endDrop?.landing || endAnchor,
    runY,
  );
  if (!alignedShortRun) {
    alignTerminalToTarget(points, 'start', startDrop?.landing || startAnchor);
    alignTerminalToTarget(points, 'end', endDrop?.landing || endAnchor);
  }

  const startRunPoint = points[0];
  const endRunPoint = points[points.length - 1];
  if (startDrop) {
    const transition = waveguideTransitionPoints(startAnchor, runY, startRunPoint, opts)
      .map(point => new THREE.Vector3(point.x, point.y, point.z));
    if (transition.length > 0) points.splice(0, 1, ...transition.reverse());
  }
  if (endDrop && points.length > 0) {
    const transition = waveguideTransitionPoints(endAnchor, runY, endRunPoint, opts)
      .map(point => new THREE.Vector3(point.x, point.y, point.z));
    if (transition.length > 0) points.splice(points.length - 1, 1, ...transition);
  }
  return points;
}

/** Flexible cord/hose centreline, including true-height fitting endpoints. */
export function buildSoftCableWorldPoints(line, placeablesById, previewAnchors = null) {
  const laidTrace = Array.isArray(line.cablePath) && line.cablePath.length >= 2
    ? line.cablePath
    : line.path;
  const runY = utilityLineHeight(line.utilityType, line.routeHeightMeters);
  const start = anchorTip(previewAnchors?.start || anchorFor(line.start, placeablesById));
  const end = anchorTip(previewAnchors?.end || anchorFor(line.end, placeablesById));
  if (isTensionedHvCable(line, placeablesById)) {
    const first = laidTrace?.[0];
    const last = laidTrace?.[laidTrace.length - 1];
    const tautStart = start || (first ? { x: first.col * 2, y: runY, z: first.row * 2 } : null);
    const tautEnd = end || (last ? { x: last.col * 2, y: runY, z: last.row * 2 } : null);
    return tautCableControlPoints(tautStart, tautEnd)
      .map(point => new THREE.Vector3(point.x, point.y, point.z));
  }
  const trace = draggedCablePath(laidTrace, {
    start: start ? { col: start.x / 2, row: start.z / 2 } : null,
    end: end ? { col: end.x / 2, row: end.z / 2 } : null,
  });
  return softCableControlPoints(trace, {
    start,
    end,
    groundY: runY,
    bendRadiusMeters: softCableBendRadiusMeters(line.utilityType),
  })
    .map(point => new THREE.Vector3(point.x, point.y, point.z));
}

// Build 3D points for a line's polyline, with orthogonal tails into anchored
// ports. Returns an array of THREE.Vector3.
export function buildWorldPoints(line, placeablesById, tapAnchors = null) {
  const points = [];
  const path = line.path || [];
  if (path.length === 0) return points;
  const runY = utilityLineHeight(line.utilityType, line.routeHeightMeters);
  for (const pt of path) {
    const w = tileToWorld(pt);
    points.push(new THREE.Vector3(w.x, runY, w.z));
  }
  // New lines already route from the measured connector. Legacy lines route
  // from the logical footprint edge; collapse that old terminal detour before
  // adding the vertical riser. Three-point L routes are safe too: the shared
  // corner absorbs the start's row and the end's column (or vice versa).
  const startAnchor = anchorFor(line.start, placeablesById) || tapAnchors?.start || null;
  const endAnchor = anchorFor(line.end, placeablesById) || tapAnchors?.end || null;
  const descriptor = UTILITY_TYPES[line.utilityType] || {};
  if (line.utilityType === 'rfWaveguide') {
    return attachWaveguideTransitions(points, startAnchor, endAnchor, runY, descriptor);
  }
  const startSideDrop = topPortSideDropLanding(
    line.start, placeablesById, startAnchor);
  const endSideDrop = topPortSideDropLanding(
    line.end, placeablesById, endAnchor);
  const alignedShortRun = (startSideDrop || endSideDrop)
    && alignTwoPointRunToTargets(
      points,
      startSideDrop || startAnchor,
      endSideDrop || endAnchor,
      runY,
    );
  if (!alignedShortRun) {
    alignTerminalToTarget(points, 'start', startSideDrop || startAnchor);
    alignTerminalToTarget(points, 'end', endSideDrop || endAnchor);
  }

  // At each end the floor run reaches the connector's X/Z, climbs the device,
  // and steps out into its fitting. Two-point legacy lines cannot slide a
  // corner without moving their opposite endpoint, so portRiser retains its
  // orthogonal boundary bridge as a narrow fallback for that one shape.
  const startRunPoint = points[0];
  const endRunPoint = points[points.length - 1];
  const startRiser = line.start
    ? portRiser(
        line.start, placeablesById, runY, startRunPoint, startAnchor, startSideDrop)
    : busTapRiser(tapAnchors?.start, runY, startRunPoint);
  if (startRiser) points.splice(0, 1, ...startRiser.slice().reverse());
  const endRiser = line.end
    ? portRiser(
        line.end, placeablesById, runY, endRunPoint, endAnchor, endSideDrop)
    : busTapRiser(tapAnchors?.end, runY, endRunPoint);
  if (endRiser && points.length > 0) points.splice(points.length - 1, 1, ...endRiser);
  return points;
}

// The rack's logical tap is an open line endpoint, but its visible socket sits
// on a vertical service slot. Give branches the same orthogonal transition a
// component port receives so the pipe visibly plugs into the populated lane.
function busTapRiser(anchor, runY, runPoint) {
  if (!anchor || !runPoint) return null;
  const out = [new THREE.Vector3(runPoint.x, runY, runPoint.z)];
  if (Math.abs(runPoint.x - anchor.x) > 1e-6) {
    out.push(new THREE.Vector3(anchor.x, runY, runPoint.z));
  }
  if (Math.abs(runPoint.z - anchor.z) > 1e-6) {
    out.push(new THREE.Vector3(anchor.x, runY, anchor.z));
  }
  if (Math.abs(anchor.y - runY) > 1e-6) {
    out.push(new THREE.Vector3(anchor.x, anchor.y, anchor.z));
  }
  return out;
}

// The orthogonal tail that takes a cable from its floor-route endpoint into
// the visible connector on the model shell:
//
//   route endpoint → along footprint edge → inward to shell
//                  → up to anchor → out into fitting
//
// New paths start at the anchor already. The edge step remains as a fallback
// for a two-point legacy path, whose only other vertex cannot be moved without
// shifting its opposite endpoint. It reconciles that mismatch without a
// diagonal or a U-turn through the old endpoint.
// Ordered run-first; the start end reverses it.
function portRiser(
  ref, placeablesById, runY, runPoint, resolvedAnchor, sideDropLanding = null,
) {
  if (!ref || !placeablesById) return null;
  const rec = placeablesById.get(ref.placeableId);
  if (!rec) return null;
  const def = COMPONENTS[rec.type];
  const anchor = resolvedAnchor || portAnchor3D(rec, def, ref.portName);
  if (!anchor) return null;
  const out = anchor.out || { x: 0, y: 0, z: 0 };
  const d = anchor.standoff || 0;
  const logical = runPoint || new THREE.Vector3(anchor.x, runY, anchor.z);
  const tail = [];
  const pushDistinct = (x, y, z) => {
    const prev = tail[tail.length - 1];
    if (prev && Math.abs(prev.x - x) < 1e-6
      && Math.abs(prev.y - y) < 1e-6
      && Math.abs(prev.z - z) < 1e-6) return;
    tail.push(new THREE.Vector3(x, y, z));
  };

  pushDistinct(logical.x, runY, logical.z);
  if (sideDropLanding && out.y > 0.5) {
    // Ordered run-first: rise outside the footprint, cross above the roof, and
    // terminate at the top fitting. Reversing this list at a start port
    // naturally produces the requested "out to the side, then down" shape.
    const tipY = anchor.y + out.y * d;
    pushDistinct(logical.x, tipY, logical.z);
    pushDistinct(anchor.x, tipY, logical.z);
    pushDistinct(anchor.x, tipY, anchor.z);
    return tail;
  }
  // Move tangentially while still on the footprint boundary, then radially
  // inward to the shell. `out` is cardinal, so every emitted leg changes one
  // coordinate only. The boundary route also keeps the bridge out from under
  // the equipment until it is lined up with the physical connector.
  if (Math.abs(out.x) > Math.abs(out.z)) {
    pushDistinct(logical.x, runY, anchor.z);
  } else if (Math.abs(out.z) > 0) {
    pushDistinct(anchor.x, runY, logical.z);
  }
  pushDistinct(anchor.x, runY, anchor.z);
  if (Math.abs(anchor.y - runY) > 1e-6) {
    pushDistinct(anchor.x, anchor.y, anchor.z);
  }
  if (d > 0) {
    pushDistinct(
      anchor.x + out.x * d,
      anchor.y + (out.y || 0) * d,
      anchor.z + out.z * d,
    );
  }
  return tail;
}

// One cylinder segment between two 3D points. Orients along the segment.
// `runDist`, when given, is `{ start, end }` absolute distance (metres) along
// the whole polyline this segment belongs to — baked into the geometry's
// uv.y so a flow-patched material's pulse reads continuous source→sink
// across every segment of the run, not reset to 0..1 at each waypoint.
function buildCylinderSegment(p0, p1, radius, material, runDist) {
  const dir = new THREE.Vector3().subVectors(p1, p0);
  const len = dir.length();
  if (len < 1e-4) return null;
  const geo = new THREE.CylinderGeometry(radius, radius, len, SEGS);
  if (runDist) bakeRunDistanceUVs(geo, runDist.start, runDist.end);
  const mesh = new THREE.Mesh(geo, material);
  // CylinderGeometry is Y-aligned; rotate so Y→(p1-p0).
  const mid = new THREE.Vector3().addVectors(p0, p1).multiplyScalar(0.5);
  mesh.position.copy(mid);
  const up = new THREE.Vector3(0, 1, 0);
  const n = dir.clone().normalize();
  const quat = new THREE.Quaternion().setFromUnitVectors(up, n);
  mesh.quaternion.copy(quat);
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

// Three slim data cables carried inside one routed envelope. On the ordinary
// floor run the strands stack vertically, which keeps the same offsets through
// every plan-view corner and makes all three silhouettes visible from the
// isometric camera. Short vertical port risers spread them laterally instead
// so an offset never points along the segment it is meant to separate.
function fiberBundleOffsets(p0, p1, spacing) {
  const vertical = Math.abs(p1.y - p0.y)
    > Math.hypot(p1.x - p0.x, p1.z - p0.z);
  return vertical
    ? [-spacing, 0, spacing].map(x => ({ x, y: 0, z: 0 }))
    : [-spacing, 0, spacing].map(y => ({ x: 0, y, z: 0 }));
}

function buildFiberBundleSegment(p0, p1, descriptor, material, runDist) {
  const strandRadius = descriptor?.bundleStrandRadiusMeters || 0.008;
  const spacing = descriptor?.bundleSpacingMeters || strandRadius * 1.75;
  const group = new THREE.Group();
  let count = 0;
  for (const [index, offset] of fiberBundleOffsets(p0, p1, spacing).entries()) {
    const a = new THREE.Vector3(p0.x + offset.x, p0.y + offset.y, p0.z + offset.z);
    const b = new THREE.Vector3(p1.x + offset.x, p1.y + offset.y, p1.z + offset.z);
    const strand = buildCylinderSegment(a, b, strandRadius, material, runDist);
    if (!strand) continue;
    strand.userData.isUtilityLineSegment = true;
    strand.userData.fiberBundleStrand = index;
    group.add(strand);
    count++;
  }
  if (count === 0) return null;
  group.userData.isUtilityLineSegment = true;
  group.userData.isFiberBundle = true;
  return group;
}

// One continuous flexible sheath. TubeGeometry's uv.x advances along the
// spline (uv.y goes around its circumference), so copy that distance into
// uv.y for the existing travelling-power shader.
function buildFlexibleCableGeometry(points, radius, reversed = false, floorY = null) {
  if (points.length < 2 || !THREE.CatmullRomCurve3 || !THREE.TubeGeometry) return null;
  const spline = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
  // Catmull-Rom can undershoot between a descending control point and a run
  // of floor-level points. Clamp the evaluated centreline, not just its
  // controls, so a pooled cable's sheath never clips through the deck.
  let curve = spline;
  if (Number.isFinite(floorY) && THREE.Curve) {
    curve = new THREE.Curve();
    curve.getPoint = (t, target = new THREE.Vector3()) => {
      spline.getPoint(t, target);
      target.y = Math.max(floorY, target.y);
      return target;
    };
  }
  let length = 0;
  for (let i = 1; i < points.length; i++) length += points[i - 1].distanceTo(points[i]);
  const tubularSegments = Math.max(16, Math.min(512, Math.ceil(length * 8)));
  const geometry = new THREE.TubeGeometry(curve, tubularSegments, radius, 8, false);
  const uv = geometry.attributes?.uv;
  if (uv?.array) {
    for (let i = 0; i < uv.array.length; i += 2) {
      const t = uv.array[i];
      uv.array[i + 1] = reversed ? length * (1 - t) : length * t;
    }
    uv.needsUpdate = true;
  }
  return geometry;
}

function buildFlexibleCable(points, radius, material, reversed = false, floorY = null) {
  const geometry = buildFlexibleCableGeometry(points, radius, reversed, floorY);
  if (!geometry) return null;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.isFlexibleUtilityCable = true;
  mesh.userData.flexibleControlPoints = points.map(point => point.clone());
  return mesh;
}

// One box segment between two 3D points for rectangular waveguide geometry.
// `runDist`, when given, is baked via bakeRunDistanceFromPositionZ — NOT
// bakeRunDistanceUVs; see that function's doc comment in utility-flow.js for
// why a BoxGeometry needs its own vertex-position-based bake rather than the
// cylinder's uv-rescale.
function buildRectSegment(p0, p1, width, height, material, runDist) {
  const dir = new THREE.Vector3().subVectors(p1, p0);
  const len = dir.length();
  if (len < 1e-4) return null;
  // Orient the long axis along +z of the box then rotate it to match dir.
  const geo = new THREE.BoxGeometry(width, height, len);
  if (runDist) bakeRunDistanceFromPositionZ(geo, runDist.start, runDist.end);
  const mesh = new THREE.Mesh(geo, material);
  const mid = new THREE.Vector3().addVectors(p0, p1).multiplyScalar(0.5);
  mesh.position.copy(mid);
  const forward = new THREE.Vector3(0, 0, 1);
  const n = dir.clone().normalize();
  const quat = new THREE.Quaternion().setFromUnitVectors(forward, n);
  mesh.quaternion.copy(quat);
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

function cornerBendInfo(prev, at, next, descriptor) {
  const incoming = new THREE.Vector3().subVectors(at, prev);
  const outgoing = new THREE.Vector3().subVectors(next, at);
  const inLen = incoming.length(), outLen = outgoing.length();
  if (inLen < 1e-4 || outLen < 1e-4) return null;
  incoming.normalize();
  outgoing.normalize();
  const dot = incoming.x * outgoing.x + incoming.y * outgoing.y + incoming.z * outgoing.z;
  if (dot > 0.9999 || dot < -0.9999) return null;
  // Rectangular formed elbows below carry a stable broad-wall orientation
  // only for deck-level turns. A sloped or vertical transition instead uses
  // the compact butt-joint fallback in buildCornerJoint. Treating that
  // fallback as a formed bend used to trim both adjoining guide sections by
  // up to miterLengthMeters, while the small joint covered only the immediate
  // waypoint. The uncovered trim read as a literal air gap on both sides.
  if (descriptor?.geometryStyle === 'rectWaveguide'
    && (Math.abs(incoming.y) > 1e-4 || Math.abs(outgoing.y) > 1e-4)) return null;
  const authored = descriptor?.bendStyle === 'mitered'
    ? descriptor?.miterLengthMeters || 0
    : descriptor?.bendRadiusMeters || 0;
  if (!(authored > 0)) return null;
  // Keep a short visible straight on both sides even on legacy routes whose
  // stored legs predate the service's current bend-radius rule.
  const trim = Math.min(authored, inLen * 0.44, outLen * 0.44);
  if (!(trim > 1e-4)) return null;
  return {
    incoming,
    outgoing,
    trim,
    start: new THREE.Vector3(at.x - incoming.x * trim, at.y - incoming.y * trim, at.z - incoming.z * trim),
    end: new THREE.Vector3(at.x + outgoing.x * trim, at.y + outgoing.y * trim, at.z + outgoing.z * trim),
    at,
  };
}

function trimmedSegment(points, index, descriptor) {
  let start = points[index].clone();
  let end = points[index + 1].clone();
  if (index > 0) {
    const bend = cornerBendInfo(points[index - 1], points[index], points[index + 1], descriptor);
    if (bend) start = bend.end;
  }
  if (index + 1 < points.length - 1) {
    const bend = cornerBendInfo(points[index], points[index + 1], points[index + 2], descriptor);
    if (bend) end = bend.start;
  }
  return { start, end };
}

function elbowCurve(info) {
  if (!info || !THREE.CubicBezierCurve3) return null;
  // Cubic approximation of a quarter circle: the 0.5522848 tangent factor is
  // the standard near-exact Bezier representation of a 90-degree arc.
  const tangent = info.trim * 0.5522847498;
  const c1 = new THREE.Vector3(
    info.start.x + info.incoming.x * tangent,
    info.start.y + info.incoming.y * tangent,
    info.start.z + info.incoming.z * tangent,
  );
  const c2 = new THREE.Vector3(
    info.end.x - info.outgoing.x * tangent,
    info.end.y - info.outgoing.y * tangent,
    info.end.z - info.outgoing.z * tangent,
  );
  return new THREE.CubicBezierCurve3(info.start, c1, c2, info.end);
}

function buildRoundSweepElbow(info, radius, material) {
  if (!THREE.TubeGeometry) return null;
  const curve = elbowCurve(info);
  if (!curve) return null;
  const geo = new THREE.TubeGeometry(curve, 10, radius, SEGS, false);
  const mesh = new THREE.Mesh(geo, material);
  mesh.userData = { isUtilityJoint: true, isUtilitySweepElbow: true, bendRadius: info.trim };
  return mesh;
}

// Rectangular sweep for the H-plane bends that dominate floor-routed
// waveguide. Four cross-section vertices are carried along the same circular
// centreline as the vacuum elbow, producing a continuous hollow-duct silhouette
// instead of hiding two butt-jointed boxes inside a cube.
function buildRectSweepElbow(info, width, height, material) {
  if (!THREE.BufferGeometry || !THREE.Float32BufferAttribute) return null;
  // Deck bends stay horizontal. Port riser bends use the compact fallback
  // below; keeping their guide frame explicit avoids a twist at vertical.
  if (Math.abs(info.incoming.y) > 1e-4 || Math.abs(info.outgoing.y) > 1e-4) return null;
  const curve = elbowCurve(info);
  if (!curve) return null;
  const steps = 10;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = curve.getPoint(t);
    const tangent = curve.getTangent(t).normalize();
    const sideX = -tangent.z;
    const sideZ = tangent.x;
    const distance = info.trim * Math.PI * 0.5 * t;
    for (const [side, up, u] of [[-1, -1, 0], [1, -1, 1], [1, 1, 1], [-1, 1, 0]]) {
      positions.push(
        p.x + sideX * width * 0.5 * side,
        p.y + height * 0.5 * up,
        p.z + sideZ * width * 0.5 * side,
      );
      uvs.push(u, distance);
    }
    if (i === steps) continue;
    const a = i * 4, b = (i + 1) * 4;
    for (let face = 0; face < 4; face++) {
      const n = (face + 1) % 4;
      indices.push(a + face, b + face, b + n, a + face, b + n, a + n);
    }
  }
  // End plates close the copper guide body; the equipment port fitting hides
  // the seam where a run terminates, while elbow collars hide these seams.
  indices.push(0, 2, 1, 0, 3, 2);
  const last = steps * 4;
  indices.push(last, last + 1, last + 2, last, last + 2, last + 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.userData = { isUtilityJoint: true, isUtilitySweepElbow: true, bendRadius: info.trim };
  return mesh;
}

// Compact H-plane waveguide elbow with a true 45-degree miter face. The
// centreline turns by 90 degrees at `at`; in that bend plane, the guide body is
// a concave L whose outside corner is cut on the diagonal through the
// centreline. Extruding that outline by the guide height leaves planar faces
// and crisp edges instead of approximating the bend with a rounded sweep.
function buildRectMiterElbow(info, width, height, material) {
  if (!THREE.BufferGeometry || !THREE.Float32BufferAttribute || !THREE.ShapeUtils) return null;
  // Deck bends stay horizontal. Port riser bends retain the compact joint
  // fallback below because the straight rectangular sections use different
  // roll frames on a horizontal-to-vertical turn.
  if (Math.abs(info.incoming.y) > 1e-4 || Math.abs(info.outgoing.y) > 1e-4) return null;

  const halfWidth = width * 0.5;
  if (info.trim <= halfWidth + 1e-4) return null;
  const normal = new THREE.Vector3().crossVectors(info.incoming, info.outgoing);
  if (normal.lengthSq() < 1e-8) return null;
  normal.normalize();

  // Coordinates are in the bend plane: a follows the incoming leg and b the
  // outgoing leg. The (-half,-half) -> (+half,+half) edge is the miter face;
  // (-half,+half) is the inside re-entrant corner.
  const contour = [
    new THREE.Vector2(-info.trim, -halfWidth),
    new THREE.Vector2(-halfWidth, -halfWidth),
    new THREE.Vector2(halfWidth, halfWidth),
    new THREE.Vector2(halfWidth, info.trim),
    new THREE.Vector2(-halfWidth, info.trim),
    new THREE.Vector2(-halfWidth, halfWidth),
    new THREE.Vector2(-info.trim, halfWidth),
  ];
  const capTriangles = THREE.ShapeUtils.triangulateShape(contour, []);
  if (!capTriangles.length) return null;

  const positions = [];
  const uvs = [];
  const indices = [];
  const halfHeight = height * 0.5;
  const worldPoint = (point, offset) => new THREE.Vector3(
    info.at.x + info.incoming.x * point.x + info.outgoing.x * point.y + normal.x * offset,
    info.at.y + info.incoming.y * point.x + info.outgoing.y * point.y + normal.y * offset,
    info.at.z + info.incoming.z * point.x + info.outgoing.z * point.y + normal.z * offset,
  );
  const pushVertex = (point, offset, u, v) => {
    const world = worldPoint(point, offset);
    positions.push(world.x, world.y, world.z);
    uvs.push(u, v);
    return positions.length / 3 - 1;
  };

  // Duplicate vertices between caps and side faces so computed normals stay
  // flat and the miter reads as fabricated sheet-metal rather than a soft
  // bevel. The contour is counter-clockwise in the incoming/outgoing basis.
  for (const triangle of capTriangles) {
    const top = triangle.map(i => pushVertex(contour[i], halfHeight, contour[i].x, contour[i].y));
    indices.push(top[0], top[1], top[2]);
    const bottom = triangle.map(i => pushVertex(contour[i], -halfHeight, contour[i].x, contour[i].y));
    indices.push(bottom[0], bottom[2], bottom[1]);
  }
  for (let i = 0; i < contour.length; i++) {
    const next = (i + 1) % contour.length;
    const edgeLength = contour[i].distanceTo(contour[next]);
    const base = positions.length / 3;
    pushVertex(contour[i], -halfHeight, 0, 0);
    pushVertex(contour[next], -halfHeight, edgeLength, 0);
    pushVertex(contour[next], halfHeight, edgeLength, height);
    pushVertex(contour[i], halfHeight, 0, height);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, material);
  mesh.userData = {
    isUtilityJoint: true,
    isUtilityMiterElbow: true,
    miterAngle: 45,
    miterLength: info.trim,
  };
  return mesh;
}

function buildCryostatBayonet(point, direction, descriptor, material, errorStatus) {
  if (!THREE.TorusGeometry) return null;
  const axis = direction.clone().normalize();
  const radius = descriptor.pipeRadiusMeters || 0.06;
  const jacketRadius = radius * (descriptor.jacketRadiusScale || 1.6);
  const halfLength = Math.max(0.09, radius * 1.65);
  const group = new THREE.Group();
  group.position.copy(point);
  group.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1), axis));

  const body = buildCylinderSegment(
    new THREE.Vector3(0, 0, -halfLength),
    new THREE.Vector3(0, 0, halfLength),
    jacketRadius * 1.08,
    material,
  );
  if (body) {
    body.userData.cryostatPart = 'bayonet-body';
    group.add(body);
  }

  // Five narrow convolutions give the joint a recognizable short expansion
  // bellows. They sit proud of the vacuum vessel but remain inside the two
  // heavier end collars.
  const convolutionTube = Math.max(0.006, radius * 0.105);
  for (let index = -2; index <= 2; index++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(jacketRadius * 1.055, convolutionTube, 6, 16),
      material,
    );
    ring.position.z = index * halfLength * 0.28;
    ring.userData = {
      cryostatPart: 'bellows-convolution',
      cryostatBellowsIndex: index + 2,
    };
    group.add(ring);
  }

  for (const side of [-1, 1]) {
    const collar = new THREE.Mesh(
      new THREE.TorusGeometry(jacketRadius * 1.06, radius * 0.16, 7, 18),
      material,
    );
    collar.position.z = side * halfLength * 0.82;
    collar.userData.cryostatPart = 'bayonet-collar';
    group.add(collar);
  }

  const bandHalfLength = Math.max(0.012, radius * 0.22);
  const band = buildCylinderSegment(
    new THREE.Vector3(0, 0, -bandHalfLength),
    new THREE.Vector3(0, 0, bandHalfLength),
    jacketRadius * 1.17,
    getCryostatBandMaterial(errorStatus),
  );
  if (band) {
    band.userData.cryostatPart = 'identification-band';
    group.add(band);
  }

  group.userData = {
    isUtilityJoint: true,
    isUtilityFitting: true,
    isCryostatBayonet: true,
    fittingStyle: 'cryoBayonet',
  };
  return group;
}

function buildServiceFitting(point, direction, descriptor, material, errorStatus = 'ok') {
  if (!point || !direction || !descriptor?.fittingStyle) return null;
  if (descriptor.fittingStyle === 'cryoBayonet') {
    return buildCryostatBayonet(point, direction, descriptor, material, errorStatus);
  }
  const radius = descriptor.pipeRadiusMeters || 0.04;
  const depth = descriptor.fittingStyle === 'waveguideFlange' ? 0.055 : 0.045;
  const half = direction.clone().normalize().multiplyScalar(depth * 0.5);
  const a = new THREE.Vector3(point.x - half.x, point.y - half.y, point.z - half.z);
  const b = new THREE.Vector3(point.x + half.x, point.y + half.y, point.z + half.z);
  let mesh;
  if (descriptor.fittingStyle === 'waveguideFlange') {
    mesh = buildRectSegment(a, b, radius * 2.65, radius * 1.95, material);
  } else if (THREE.TorusGeometry) {
    const geo = new THREE.TorusGeometry(radius * 1.38, radius * 0.22, 6, 14);
    mesh = new THREE.Mesh(geo, material);
    mesh.position.copy(point);
    const forward = new THREE.Vector3(0, 0, 1);
    mesh.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(forward, direction.clone().normalize()));
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
  } else {
    mesh = buildCylinderSegment(a, b, radius * 1.62, material);
  }
  if (mesh) mesh.userData = {
    ...mesh.userData,
    isUtilityJoint: true,
    isUtilityFitting: true,
    fittingStyle: descriptor.fittingStyle,
  };
  return mesh;
}

function addInlineCouplers(
  group, start, end, descriptor, material, errorStatus = 'ok', fittingPoints = null,
) {
  const spacing = descriptor?.couplerSpacingMeters;
  if (!(spacing > 0)) return [];
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  if (length < spacing * 1.35) return [];
  direction.normalize();
  // Centre the regular pattern on the segment so two adjacent couplers never
  // bunch against a corner flange.
  const count = Math.floor(length / spacing);
  const step = length / (count + 1);
  const points = [];
  for (let i = 1; i <= count; i++) {
    const point = new THREE.Vector3(
      start.x + direction.x * step * i,
      start.y + direction.y * step * i,
      start.z + direction.z * step * i,
    );
    const fitting = buildServiceFitting(
      point, direction, descriptor, material, errorStatus);
    if (fitting) {
      group.add(fitting);
      points.push(point);
      if (Array.isArray(fittingPoints)) fittingPoints.push(point.clone());
    }
  }
  return points;
}

function addCryostatIdentificationBands(group, start, end, descriptor, material) {
  const spacing = descriptor?.identificationBandSpacingMeters;
  if (!(spacing > 0)) return;
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  if (length < spacing * 0.75) return;
  direction.normalize();
  const count = Math.max(1, Math.floor(length / spacing));
  const step = length / (count + 1);
  const radius = (descriptor.pipeRadiusMeters || 0.06)
    * (descriptor.jacketRadiusScale || 1.6) * 1.025;
  const halfWidth = 0.022;
  for (let index = 1; index <= count; index++) {
    const distance = step * index;
    const point = new THREE.Vector3(
      start.x + direction.x * distance,
      start.y + direction.y * distance,
      start.z + direction.z * distance,
    );
    const band = buildCylinderSegment(
      new THREE.Vector3(
        point.x - direction.x * halfWidth,
        point.y - direction.y * halfWidth,
        point.z - direction.z * halfWidth,
      ),
      new THREE.Vector3(
        point.x + direction.x * halfWidth,
        point.y + direction.y * halfWidth,
        point.z + direction.z * halfWidth,
      ),
      radius,
      material,
    );
    if (!band) continue;
    band.userData = {
      isCryostatIdentificationBand: true,
      cryostatPart: 'identification-band',
    };
    group.add(band);
  }
}

// Low H-frame saddle under one supported rigid-service span. The frame is
// built in a +Z local run direction, then turned onto the actual segment. Its
// top bar touches the underside of the guide, pipe, or outer cryogenic jacket;
// feet always remain on y=0 and the legs fill the measured gap between them.
function buildUtilitySupport(frame, descriptor, utilityType, materialOverride = null) {
  if (!frame?.point || !frame?.direction) return null;
  const radius = descriptor?.pipeRadiusMeters || 0.05;
  const style = descriptor?.geometryStyle || 'cylinder';
  const jacketScale = descriptor?.jacketRadiusScale || 1.6;
  const bodyHalfWidth = style === 'jacketedCylinder' ? radius * jacketScale : radius;
  const bodyHalfHeight = style === 'rectWaveguide' ? radius * 0.7 : bodyHalfWidth;
  const centerlineY = frame.point.y;
  const footH = 0.025;
  const barH = 0.032;
  const barTop = centerlineY - bodyHalfHeight - 0.006;
  const barBottom = barTop - barH;
  if (barBottom <= footH + 0.015) return null;

  const material = materialOverride || getUtilitySupportMaterial();
  const support = new THREE.Group();
  const saddleWidth = Math.max(0.24, bodyHalfWidth * 4.5);
  const depth = 0.13;
  const foot = new THREE.Mesh(
    new THREE.BoxGeometry(saddleWidth + 0.10, footH, depth + 0.07), material);
  foot.position.y = footH * 0.5;
  foot.userData.utilitySupportPart = 'foot';
  support.add(foot);

  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(saddleWidth + 0.04, barH, depth), material);
  bar.position.y = barBottom + barH * 0.5;
  bar.userData.utilitySupportPart = 'saddle';
  support.add(bar);

  const legH = barBottom - footH;
  const legOffset = saddleWidth * 0.5 - 0.035;
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, legH, 0.055), material);
    leg.position.set(side * legOffset, footH + legH * 0.5, 0);
    leg.userData.utilitySupportPart = 'leg';
    support.add(leg);
  }

  if (descriptor?.presentationStyle === 'cryostatLine' && THREE.TorusGeometry) {
    const shoeH = 0.034;
    const shoe = new THREE.Mesh(
      new THREE.BoxGeometry(bodyHalfWidth * 1.65, shoeH, depth * 0.72), material);
    shoe.position.y = barTop + shoeH * 0.5;
    shoe.userData = {
      utilitySupportPart: 'cryostat-shoe',
      cryostatPart: 'insulated-pipe-shoe',
    };
    support.add(shoe);
    const clamp = new THREE.Mesh(
      new THREE.TorusGeometry(bodyHalfWidth * 1.045, 0.011, 6, 18), material);
    clamp.position.y = centerlineY;
    clamp.userData = {
      utilitySupportPart: 'cryostat-clamp',
      cryostatPart: 'vacuum-jacket-clamp',
    };
    support.add(clamp);
  }

  support.position.set(frame.point.x, 0, frame.point.z);
  support.rotation.y = Math.atan2(frame.direction.x, frame.direction.z);
  support.userData = {
    isUtilitySupport: true,
    utilityType,
    runLength: frame.runLength,
    centerlineHeight: centerlineY,
    legHeight: legH,
    groundY: 0,
  };
  return support;
}

function addUtilitySupports(
  group, points, descriptor, utilityType, materialOverride = null, routeHeightMeters = null,
) {
  const spacing = descriptor?.supportSpacingMeters;
  const minimum = descriptor?.supportMinimumRunMeters;
  if (!(spacing > 0) || !(minimum > 0)) return;
  const runY = utilityLineHeight(utilityType, routeHeightMeters);
  const frames = utilitySupportFrames(points, {
    floorY: runY,
    spacingMeters: spacing,
    minimumRunMeters: minimum,
  });
  for (const frame of frames) {
    const support = buildUtilitySupport(
      frame, descriptor, utilityType, materialOverride,
    );
    if (support) group.add(support);
  }
}

function supportStationKey(frame) {
  const axis = Math.abs(frame.direction.x) >= Math.abs(frame.direction.z) ? 'x' : 'z';
  return `${Math.round(frame.point.x * 1000)}:${Math.round(frame.point.z * 1000)}:${axis}`;
}

// Co-located rigid services are independent networks but share one physical
// rack. Building a complete H-frame for every line puts coincident feet and
// uprights on top of each other (and produces visible z-fighting). One rack
// instead owns a shelf beneath each occupied service datum.
function buildStackedUtilitySupport(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  if (entries.length === 1) {
    const entry = entries[0];
    const support = buildUtilitySupport(
      entry.frame, entry.descriptor, entry.utilityType);
    if (support) support.userData.lineIds = [...entry.lineIds];
    return support;
  }

  const material = getUtilitySupportMaterial();
  const shelves = [];
  for (const entry of entries) {
    const radius = entry.descriptor?.pipeRadiusMeters || 0.05;
    const style = entry.descriptor?.geometryStyle || 'cylinder';
    const jacketScale = entry.descriptor?.jacketRadiusScale || 1.6;
    const bodyHalfWidth = style === 'jacketedCylinder' ? radius * jacketScale : radius;
    const bodyHalfHeight = style === 'rectWaveguide' ? radius * 0.7 : bodyHalfWidth;
    shelves.push({
      y: entry.frame.point.y - bodyHalfHeight - 0.006,
      bodyHalfWidth,
      utilityTypes: [entry.utilityType],
      lineIds: [...entry.lineIds],
      centerlineHeight: entry.frame.point.y,
      presentationStyle: entry.descriptor?.presentationStyle || null,
    });
  }
  shelves.sort((a, b) => a.y - b.y);

  // If two joined fragments happen to schedule a support at the same station,
  // collapse their identical shelf instead of rendering duplicate steel.
  const uniqueShelves = [];
  for (const shelf of shelves) {
    const existing = uniqueShelves.find(item => Math.abs(item.y - shelf.y) < 1e-5);
    if (existing) {
      existing.bodyHalfWidth = Math.max(existing.bodyHalfWidth, shelf.bodyHalfWidth);
      existing.utilityTypes.push(...shelf.utilityTypes);
      existing.lineIds.push(...shelf.lineIds);
    } else uniqueShelves.push(shelf);
  }

  const support = new THREE.Group();
  const footH = 0.025;
  const barH = 0.032;
  const saddleWidth = Math.max(
    0.52,
    ...uniqueShelves.map(shelf => shelf.bodyHalfWidth * 4.5),
  );
  const depth = 0.13;
  const foot = new THREE.Mesh(
    new THREE.BoxGeometry(saddleWidth + 0.10, footH, depth + 0.07), material);
  foot.position.y = footH * 0.5;
  foot.userData.utilitySupportPart = 'foot';
  support.add(foot);

  for (const shelf of uniqueShelves) {
    const barBottom = shelf.y - barH;
    if (barBottom <= footH + 0.015) continue;
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(saddleWidth + 0.04, barH, depth), material);
    bar.position.y = barBottom + barH * 0.5;
    bar.userData = {
      utilitySupportPart: 'saddle',
      utilityTypes: [...new Set(shelf.utilityTypes)],
      centerlineHeight: shelf.centerlineHeight,
    };
    support.add(bar);
    if (shelf.presentationStyle === 'cryostatLine' && THREE.TorusGeometry) {
      const shoe = new THREE.Mesh(
        new THREE.BoxGeometry(shelf.bodyHalfWidth * 1.65, 0.034, depth * 0.72), material);
      shoe.position.y = shelf.y + 0.017;
      shoe.userData = {
        utilitySupportPart: 'cryostat-shoe',
        cryostatPart: 'insulated-pipe-shoe',
      };
      support.add(shoe);
      const clamp = new THREE.Mesh(
        new THREE.TorusGeometry(shelf.bodyHalfWidth * 1.045, 0.011, 6, 18), material);
      clamp.position.y = shelf.centerlineHeight;
      clamp.userData = {
        utilitySupportPart: 'cryostat-clamp',
        cryostatPart: 'vacuum-jacket-clamp',
      };
      support.add(clamp);
    }
  }

  const top = Math.max(...uniqueShelves.map(shelf => shelf.y - barH));
  const legH = top - footH;
  const legOffset = saddleWidth * 0.5 - 0.035;
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, legH, 0.055), material);
    leg.position.set(side * legOffset, footH + legH * 0.5, 0);
    leg.userData.utilitySupportPart = 'leg';
    support.add(leg);
  }

  const first = entries[0];
  const utilityTypes = [...new Set(entries.map(entry => entry.utilityType))];
  const lineIds = [...new Set(entries.flatMap(entry => [...entry.lineIds]))];
  support.position.set(first.frame.point.x, 0, first.frame.point.z);
  support.rotation.y = Math.atan2(first.frame.direction.x, first.frame.direction.z);
  support.userData = {
    isUtilitySupport: true,
    isRigidUtilityRack: true,
    utilityType: 'rigidUtilityStack',
    utilityTypes,
    lineIds,
    centerlineHeights: uniqueShelves.map(shelf => shelf.centerlineHeight),
    stackedServiceCount: uniqueShelves.length,
    legHeight: legH,
    groundY: 0,
  };
  return support;
}

// --- Elbows -------------------------------------------------------------
//
// Straight segments butt-joined at a waypoint leave a notch on the OUTSIDE of
// every bend and a self-overlap on the inside, which is what made the runs read
// as a chain of separate rods rather than as one pipe. Service descriptors can
// replace that overlap with authored sweep or miter geometry; generic lines
// still receive a small joint body that fills the notch.

// A bend is only a bend if the direction actually changes. Paths carry
// redundant collinear waypoints — a straight run is stored tile by tile, and a
// riser whose port happens to sit at exactly the run height degenerates to a
// straight tail — and a joint on each of those would string beads along the run
// every two metres.
const COLLINEAR_DOT = 0.9999;

// Joints are sized a hair over the pipe they join. A joint at exactly the pipe
// radius is tangent to the segment walls, so the two surfaces are coplanar
// along the seam and z-fight; 5% is well under a millimetre on a 4 cm cable —
// invisible as a bulge, but enough to keep the joint strictly outside.
const JOINT_SWELL = 1.05;

// The elbow at ONE interior waypoint. `radius` is the radius of the body being
// jointed, so a jacketed line calls this twice (core, then jacket) exactly as
// the segment builder emits two cylinders.
function buildCornerJoint(prev, at, next, style, radius, material, descriptor = null) {
  // Done in scalars rather than through Vector3: this runs for every waypoint
  // of every line in the hall on each rebuild, and most of them turn out to be
  // collinear and bail here, so it would be three throwaway vectors per miss.
  const ix = at.x - prev.x, iy = at.y - prev.y, iz = at.z - prev.z;
  const ox = next.x - at.x, oy = next.y - at.y, oz = next.z - at.z;
  const inLen = Math.hypot(ix, iy, iz), outLen = Math.hypot(ox, oy, oz);
  if (inLen < 1e-4 || outLen < 1e-4) return null;
  const cosTurn = (ix * ox + iy * oy + iz * oz) / (inLen * outLen);
  if (cosTurn > COLLINEAR_DOT) return null;

  if (style === 'fiberBundle') {
    const strandRadius = descriptor?.bundleStrandRadiusMeters || 0.008;
    const spacing = descriptor?.bundleSpacingMeters || strandRadius * 1.75;
    const bothHorizontal = Math.abs(iy) < 1e-4 && Math.abs(oy) < 1e-4;
    if (bothHorizontal) {
      const joint = new THREE.Group();
      for (const [index, y] of [-spacing, 0, spacing].entries()) {
        const strandJoint = new THREE.Mesh(
          new THREE.SphereGeometry(strandRadius * JOINT_SWELL, 8, 6), material);
        strandJoint.position.set(at.x, at.y + y, at.z);
        strandJoint.userData.fiberBundleStrand = index;
        strandJoint.userData.isUtilityJoint = true;
        joint.add(strandJoint);
      }
      joint.userData.isUtilityJoint = true;
      joint.userData.isFiberBundle = true;
      return joint;
    }
    // A compact shared boot hides the small orientation change where a
    // horizontal bundle turns up toward an equipment port.
    const boot = new THREE.Mesh(
      new THREE.SphereGeometry(radius * JOINT_SWELL, 10, 8), material);
    boot.position.copy(at);
    boot.userData.isUtilityJoint = true;
    boot.userData.isFiberBundleBoot = true;
    return boot;
  }

  const bend = cornerBendInfo(prev, at, next, descriptor);
  if (bend) {
    let formed;
    if (style === 'rectWaveguide' && descriptor?.bendStyle === 'mitered') {
      formed = buildRectMiterElbow(bend, radius * 2, radius * 1.4, material);
    } else if (style === 'rectWaveguide') {
      formed = buildRectSweepElbow(bend, radius * 2, radius * 1.4, material);
    } else {
      formed = buildRoundSweepElbow(bend, radius, material);
    }
    if (formed) return formed;
  }

  let geo;
  if (style === 'rectWaveguide') {
    // A sphere on a waveguide would read as a ball joint welded onto a duct.
    // The cube is the duct's own cross-section swept through the corner: its
    // width across BOTH horizontal axes and its height vertically, which is
    // exactly the bounding box of the two butt-jointed segments on a
    // grid-aligned bend — including the riser's horizontal→vertical one, where
    // the vertical segment lies with its height axis horizontal.
    geo = new THREE.BoxGeometry(
      radius * 2 * JOINT_SWELL, radius * 1.4 * JOINT_SWELL, radius * 2 * JOINT_SWELL);
  } else {
    // Deliberately coarser than the end caps: there is one of these per bend on
    // every run in the hall, and a sphere this small is three or four pixels of
    // silhouette at working zoom.
    geo = new THREE.SphereGeometry(radius * JOINT_SWELL, 10, 8);
  }
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.copy(at);
  // A joint is not a flow segment: it carries no baked run-distance, so
  // anything walking the group to reason about direction along the run has to
  // be able to tell it apart from the segments it sits between. On a
  // rectWaveguide the joint is itself a box, so geometry type alone won't do.
  mesh.userData.isUtilityJoint = true;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

// Open-end cap materials, one per utility type (shared across lines).
const _openCapMatCache = new Map();
function getOpenCapMaterial(utilityType) {
  if (_openCapMatCache.has(utilityType)) return _openCapMatCache.get(utilityType);
  const descriptor = UTILITY_TYPES[utilityType];
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: new THREE.Color(descriptor?.color || '#ffffff'),
    emissiveIntensity: 0.45, roughness: 0.2, metalness: 0.2,
    transparent: true, opacity: 0.70,
  });
  _openCapMatCache.set(utilityType, shared(mat));
  return mat;
}

/** Preserve the visible rope shape when a new target solve changes sampling. */
function resampleControlPoints(points, count) {
  if (!Array.isArray(points) || points.length < 2 || count < 2) return null;
  if (points.length === count) return points.map(point => point.clone());
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    cumulative[i] = cumulative[i - 1] + points[i - 1].distanceTo(points[i]);
  }
  const total = cumulative[cumulative.length - 1];
  if (!(total > 1e-9)) return Array.from({ length: count }, () => points[0].clone());
  const out = [];
  let segment = 0;
  for (let i = 0; i < count; i++) {
    const distance = total * i / (count - 1);
    while (segment < cumulative.length - 2 && cumulative[segment + 1] < distance) segment++;
    const span = cumulative[segment + 1] - cumulative[segment];
    const t = span > 1e-9 ? (distance - cumulative[segment]) / span : 0;
    out.push(points[segment].clone().lerp(points[segment + 1], t));
  }
  return out;
}

/** Visible socket position for a branch explicitly joined to a bus backbone. */
function busTapAnchor(line, which, lineById) {
  const targetId = line?.tapLineIds?.[which];
  const backbone = targetId ? lineById?.get(targetId) : null;
  if (backbone?.manifold?.type !== 'universalUtilityBus') return null;
  const path = backbone.path || [];
  const branchPath = line.path || [];
  if (path.length < 2 || branchPath.length < 1) return null;
  const first = path[0], last = path[path.length - 1];
  const dx = last.col - first.col, dz = last.row - first.row;
  const length = Math.hypot(dx, dz) || 1;
  const lane = universalBusLane(backbone.utilityType);
  const offset = lane?.portLateral ?? lane?.lateral ?? 0;
  const endpoint = which === 'start' ? branchPath[0] : branchPath[branchPath.length - 1];
  return {
    x: endpoint.col * 2 - dz / length * offset,
    y: lane?.portY ?? 0.95,
    z: endpoint.row * 2 + dx / length * offset,
  };
}

const BUS_SPAN_SAG_OPTIONS = Object.freeze({
  sampleSpacing: 0.18,
  sagRatio: 0.04,
  minSag: 0.045,
  maxSag: 0.14,
});

function tensionedBusSpanPoints(supports) {
  const points = [];
  for (let index = 0; index < supports.length - 1; index++) {
    const span = tautCableControlPoints(
      supports[index], supports[index + 1], BUS_SPAN_SAG_OPTIONS,
    ).map(point => new THREE.Vector3(point.x, point.y, point.z));
    if (span.length === 0) continue;
    if (points.length > 0) span.shift();
    points.push(...span);
  }
  return points;
}

/**
 * Build one fixed-height support point at every universal-bus post, with a
 * shallow gravity bow in each intervening span. The bus path remains the
 * topology authority; authored taps are only the physical post locations.
 */
export function buildSuspendedUniversalBusWorldPoints(line) {
  const lane = universalBusLane(line?.utilityType);
  const path = line?.path || [];
  if (line?.manifold?.type !== 'universalUtilityBus'
    || lane?.supportMode !== 'tensioned-span' || path.length < 2) return [];

  const startWorld = tileToWorld(path[0]);
  const endWorld = tileToWorld(path[path.length - 1]);
  const dx = endWorld.x - startWorld.x;
  const dz = endWorld.z - startWorld.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return [];
  const ux = dx / length;
  const uz = dz / length;
  const candidates = [
    { distance: 0, point: new THREE.Vector3(startWorld.x, lane.runY, startWorld.z) },
  ];
  for (const tap of line.manifold.taps || []) {
    const raw = tap?.point || tap;
    if (!raw || !Number.isFinite(raw.col) || !Number.isFinite(raw.row)) continue;
    const x = (raw.col + (raw.subCol || 0) / 4) * 2;
    const z = (raw.row + (raw.subRow || 0) / 4) * 2;
    const distance = (x - startWorld.x) * ux + (z - startWorld.z) * uz;
    if (distance < -1e-5 || distance > length + 1e-5) continue;
    const projectedX = startWorld.x + ux * Math.max(0, Math.min(length, distance));
    const projectedZ = startWorld.z + uz * Math.max(0, Math.min(length, distance));
    if (Math.hypot(x - projectedX, z - projectedZ) > 0.05) continue;
    candidates.push({
      distance: Math.max(0, Math.min(length, distance)),
      point: new THREE.Vector3(projectedX, lane.runY, projectedZ),
    });
  }
  candidates.push({
    distance: length,
    point: new THREE.Vector3(endWorld.x, lane.runY, endWorld.z),
  });
  candidates.sort((a, b) => a.distance - b.distance);
  const supports = candidates.filter((candidate, index, list) =>
    index === 0 || candidate.distance - list[index - 1].distance > 1e-5)
    .map(candidate => candidate.point);
  return tensionedBusSpanPoints(supports);
}

function buildLineGroup(
  line, placeablesById, errorStatus, flowState, reversed, pointOverride = null,
  joinedOpenEnds = null, tapAnchors = null, includeSupports = true,
) {
  const descriptor = UTILITY_TYPES[line.utilityType];
  if (!descriptor) return null;
  const busChannel = line.manifold?.type === 'universalUtilityBus';
  const busLane = busChannel ? universalBusLane(line.utilityType) : null;
  const suspendedBusChannel = busLane?.supportMode === 'tensioned-span';
  // A manifold is fabricated infrastructure even when its carried utility is
  // ordinarily a loose cable. Bus posts are the exception: flexible services
  // remain flexible and are held at their lane height by each post.
  const flexible = (isSoftCable(line.utilityType) && !line.manifold)
    || suspendedBusChannel;
  const points = pointOverride || (suspendedBusChannel
    ? buildSuspendedUniversalBusWorldPoints(line)
    : flexible
      ? buildSoftCableWorldPoints(line, placeablesById, tapAnchors)
      : buildWorldPoints(line, placeablesById, tapAnchors));
  if (points.length < 2) return null;
  let busOffsetX = 0, busOffsetZ = 0;
  let busPortOffsetX = 0, busPortOffsetZ = 0;
  if (busChannel) {
    const offset = busLane?.lateral ?? 0;
    const first = points[0], last = points[points.length - 1];
    const dx = last.x - first.x, dz = last.z - first.z;
    const length = Math.hypot(dx, dz) || 1;
    busOffsetX = -dz / length * offset;
    busOffsetZ = dx / length * offset;
    busPortOffsetX = -dz / length * (busLane?.portLateral ?? offset);
    busPortOffsetZ = dx / length * (busLane?.portLateral ?? offset);
    for (const point of points) {
      point.x += busOffsetX;
      point.z += busOffsetZ;
      if (!suspendedBusChannel) point.y = busLane?.runY ?? 0.79;
    }
  }

  const group = new THREE.Group();
  const runY = busChannel
    ? (busLane?.runY ?? utilityLineHeight(line.utilityType, line.routeHeightMeters))
    : utilityLineHeight(line.utilityType, line.routeHeightMeters);
  group.userData = {
    lineId: line.id,
    utilityType: line.utilityType,
    routeHeightMeters: runY,
    errorStatus: errorStatus || 'ok',
    flowState: flowState || 'ok',
    ...(descriptor.presentationStyle ? {
      presentationStyle: descriptor.presentationStyle,
    } : {}),
    ...(busChannel ? {
      isUniversalUtilityBus: true,
      busId: line.manifold.busId,
      channelSlot: busLane?.slot ?? line.manifold.slot,
      busLaneTier: busLane?.tier || null,
      suspendedBetweenPosts: suspendedBusChannel,
    } : {}),
  };
  const radius = (descriptor.pipeRadiusMeters || 0.04)
    * (busChannel ? 0.85 : line.manifold ? 2.35 : 1);
  const mat = getLineMaterial(line.utilityType, flowState, line.waterCircuit);
  const hardwareMat = getLineHardwareMaterial(line.utilityType, line.waterCircuit);
  const style = descriptor.geometryStyle || 'cylinder';
  const cryostatPresentation = descriptor.presentationStyle === 'cryostatLine';
  const cryostatJacketMat = cryostatPresentation
    ? getCryostatJacketMaterial(line.utilityType, flowState) : null;
  const cryostatBandMat = cryostatPresentation
    ? getCryostatBandMaterial(flowState) : null;
  const cryoColdSpots = [];
  const addCryoColdSpot = point => {
    if (!cryostatPresentation || !point) return;
    if (cryoColdSpots.some(existing => {
      const dx = existing.x - point.x;
      const dy = existing.y - point.y;
      const dz = existing.z - point.z;
      return dx * dx + dy * dy + dz * dz < 1e-6;
    })) return;
    cryoColdSpots.push(point.clone());
  };
  const flow = FLOW_PARAMS[line.utilityType];
  const flowing = !!flow && flowState !== 'off';
  // Electrical lines keep their animated colour variation in ordinary PBR
  // shading. Only utilities whose flow is actually emissive enter the bloom
  // pass; otherwise a non-emissive cable could still acquire a false halo.
  const emissiveFlow = flowing && flow.emissive !== false;

  // Segment lengths up front so a reversed run can be baked in one pass too
  // (see below) rather than needing a second walk once the total is known.
  const segLens = [];
  let totalLen = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const d = points[i].distanceTo(points[i + 1]);
    segLens.push(d);
    totalLen += d;
  }

  // Accumulated distance along the polyline, in metres — each segment gets
  // its own [start, end) window baked into its geometry (see
  // buildCylinderSegment / bakeRunDistanceUVs) so the pulse is continuous
  // across waypoints instead of restarting at 0..1 per segment.
  //
  // `reversed` (from computeLineOrientations — see build()/_buildOrientationMap)
  // is about NETWORK TOPOLOGY, not draw order: line.start is where the
  // player happened to click first, which is not necessarily the source
  // side. points[] still walks start->end (buildWorldPoints), so a reversed
  // line keeps that walk but flips which end reads as distance 0 — the
  // physical direction energy travels is source->sink either way.
  let runDistCum = 0;
  const flexibleMesh = flexible
    ? buildFlexibleCable(points, radius, mat, reversed, suspendedBusChannel ? null : runY)
    : null;
  if (flexibleMesh) {
    if (suspendedBusChannel) flexibleMesh.userData.isUniversalUtilityBusSuspendedSpan = true;
    if (emissiveFlow) flexibleMesh.layers.enable(BLOOM_LAYER);
    group.add(flexibleMesh);
  }
  for (let i = 0; !flexibleMesh && i < points.length - 1; i++) {
    const trimmed = trimmedSegment(points, i, descriptor);
    const a = trimmed.start;
    const b = trimmed.end;
    const segLen = segLens[i];
    const fwdStart = runDistCum;
    const fwdEnd = runDistCum + segLen;
    runDistCum = fwdEnd;
    const runDist = reversed
      ? { start: totalLen - fwdEnd, end: totalLen - fwdStart }
      : { start: fwdStart, end: fwdEnd };
    let mesh = null;
    if (style === 'rectWaveguide') {
      // Baked too — via bakeRunDistanceFromPositionZ, not bakeRunDistanceUVs;
      // see that function's doc comment in utility-flow.js for why a
      // BoxGeometry needs a different source (vertex position, not uv).
      mesh = buildRectSegment(a, b, radius * 2, radius * 1.4, mat, runDist);
    } else if (style === 'fiberBundle') {
      mesh = buildFiberBundleSegment(a, b, descriptor, mat, runDist);
    } else if (cryostatPresentation) {
      // A real transfer line presents one opaque vacuum vessel to the room.
      // The process/return channels and multilayer insulation are sealed
      // inside, so exposing a glowing cyan core would make the line read like
      // clear hose rather than cryogenic plant.
      const jacketRadius = radius * (descriptor.jacketRadiusScale || 1.6);
      mesh = buildCylinderSegment(a, b, jacketRadius, cryostatJacketMat, runDist);
      if (mesh) mesh.userData.isCryostatVacuumJacket = true;
      addCryostatIdentificationBands(group, a, b, descriptor, cryostatBandMat);
    } else if (style === 'jacketedCylinder') {
      // Inner opaque cylinder + translucent outer jacket — both baked off the
      // same runDist so a flow-patched jacket stays in phase with its core.
      mesh = buildCylinderSegment(a, b, radius, mat, runDist);
      const jacketMat = getJacketMaterial(
        line.utilityType, flowState, line.waterCircuit);
      const jacket = buildCylinderSegment(a, b, radius * 1.6, jacketMat, runDist);
      if (jacket) {
        // The darken pass (glow-pipeline.js) swaps any non-bloom object's
        // material for opaque black before the bloom-only render. A
        // transparent jacket left off BLOOM_LAYER would go opaque black in
        // that pass and hide the glowing core it wraps — putting the jacket
        // on BLOOM_LAYER too keeps it rendering (and, per getJacketMaterial,
        // glowing) normally in the bloom pass instead of occluding.
        if (emissiveFlow) jacket.layers.enable(BLOOM_LAYER);
        group.add(jacket);
      }
    } else {
      mesh = buildCylinderSegment(a, b, radius, mat, runDist);
    }
    if (mesh) {
      // Publish an explicit boundary between the utility's traversable run and
      // decorative hardware (joints, couplers, and RF support frames).  Tests
      // and presentation effects must not infer that role from geometry type.
      mesh.userData.isUtilityLineSegment = true;
      if (emissiveFlow) mesh.layers.enable(BLOOM_LAYER);
      group.add(mesh);
    }
    if (descriptor.fittingStyle) {
      addInlineCouplers(
        group, a, b, descriptor, hardwareMat, flowState,
        cryostatPresentation ? cryoColdSpots : null,
      );
    }
  }

  if (!busChannel && includeSupports) {
    addUtilitySupports(
      group, points, descriptor, line.utilityType, null, line.routeHeightMeters);
  }

  // Elbows at every INTERIOR waypoint. The two terminal points are excluded on
  // purpose: they either disappear into a port fitting or carry an open-end
  // cap, and a joint there would be a bead hanging off the tip of the run. The
  // riser corners — under the port, and again where the tail steps out along
  // the port normal — are interior waypoints of this same polyline, so they get
  // their elbows from this loop with no special case.
  const jointJacketMat = style === 'jacketedCylinder' && !cryostatPresentation
    ? getJacketMaterial(line.utilityType, flowState, line.waterCircuit) : null;
  for (let i = 1; !flexible && i < points.length - 1; i++) {
    const prev = points[i - 1], at = points[i], next = points[i + 1];
    const jointRadius = cryostatPresentation
      ? radius * (descriptor.jacketRadiusScale || 1.6) : radius;
    const jointMaterial = cryostatPresentation ? cryostatJacketMat : mat;
    const joint = buildCornerJoint(
      prev, at, next, style, jointRadius, jointMaterial, descriptor);
    if (joint) group.add(joint);
    if (jointJacketMat) {
      const jacketJoint = buildCornerJoint(
        prev, at, next, style, radius * 1.6, jointJacketMat, descriptor);
      if (jacketJoint) group.add(jacketJoint);
    }
    const bend = cornerBendInfo(prev, at, next, descriptor);
    if (bend && descriptor.fittingStyle) {
      const entry = buildServiceFitting(
        bend.start, bend.incoming, descriptor, hardwareMat, flowState);
      const exit = buildServiceFitting(
        bend.end, bend.outgoing, descriptor, hardwareMat, flowState);
      if (entry) group.add(entry);
      if (exit) group.add(exit);
      if (entry) addCryoColdSpot(bend.start);
      if (exit) addCryoColdSpot(bend.end);
    }
  }

  // Authored cryogenic endpoints terminate in visible demountable bayonets.
  // Open construction ends keep the conspicuous generic cap instead.
  if (cryostatPresentation && line.start && points.length >= 2) {
    const direction = new THREE.Vector3().subVectors(points[1], points[0]).normalize();
    const fitting = buildServiceFitting(
      points[0], direction, descriptor, hardwareMat, flowState);
    if (fitting) {
      fitting.userData.isCryostatTerminalFitting = true;
      group.add(fitting);
      addCryoColdSpot(points[0]);
    }
  }
  if (cryostatPresentation && line.end && points.length >= 2) {
    const last = points.length - 1;
    const direction = new THREE.Vector3().subVectors(points[last], points[last - 1]).normalize();
    const fitting = buildServiceFitting(
      points[last], direction, descriptor, hardwareMat, flowState);
    if (fitting) {
      fitting.userData.isCryostatTerminalFitting = true;
      group.add(fitting);
      addCryoColdSpot(points[last]);
    }
  }

  // Open-end indicators: a small contrasting disc at any endpoint that
  // isn't anchored to a port. Signals "this side isn't wired up yet."
  const openCapMat = getOpenCapMaterial(line.utilityType);
  if (!busChannel && !line.start && !joinedOpenEnds?.start && points.length > 0) {
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.35, 10, 8),
      openCapMat,
    );
    cap.position.copy(points[0]);
    cap.userData.isUtilityOpenCap = true;
    group.add(cap);
  }
  if (!busChannel && !line.end && !joinedOpenEnds?.end && points.length > 0) {
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.35, 10, 8),
      openCapMat,
    );
    cap.position.copy(points[points.length - 1]);
    cap.userData.isUtilityOpenCap = true;
    group.add(cap);
  }
  // Every authored rack access point becomes a real, utility-coloured socket
  // on each populated lane. Topology remains the backbone plus explicit
  // branch taps, but the player can now see exactly where another source or
  // sink can be plugged into this utility's shared network.
  if (line.manifold?.taps?.length) {
    for (const tap of line.manifold.taps) {
      const point = tap?.point;
      if (!point) continue;
      const x = (point.col + (point.subCol || 0) / 4) * 2 + busOffsetX;
      const z = (point.row + (point.subRow || 0) / 4) * 2 + busOffsetZ;
      const baseY = busChannel ? (busLane?.runY ?? runY) : runY;
      const portTopY = busChannel ? (busLane?.portY ?? runY) : runY + 0.12;
      const port = new THREE.Group();
      port.userData = {
        isUtilityManifoldTap: true,
        isUniversalUtilityBusPort: busChannel,
        utilityType: line.utilityType,
        busId: line.manifold.busId || null,
        channelSlot: busLane?.slot ?? line.manifold.slot ?? null,
        tapId: tap.id || null,
      };
      const portX = busChannel ? x + busPortOffsetX : x;
      const portZ = busChannel ? z + busPortOffsetZ : z;
      if (suspendedBusChannel) {
        // The rack shelf sits 0.10 m below the lane centreline. Bridge that
        // deliberate clearance with a visible hanger so each parabolic span
        // reads as mechanically pinned here, not merely crossing a post.
        const tensionSupport = buildCylinderSegment(
          new THREE.Vector3(x, baseY - 0.08, z),
          new THREE.Vector3(x, baseY, z),
          Math.max(0.014, radius * 0.36), hardwareMat,
        );
        if (tensionSupport) {
          tensionSupport.userData.isUniversalUtilityBusTensionSupport = true;
          group.add(tensionSupport);
        }
      }
      const stem = buildCylinderSegment(
        new THREE.Vector3(x, baseY, z),
        new THREE.Vector3(portX, portTopY, portZ),
        Math.max(0.018, radius * 0.48), hardwareMat,
      );
      if (stem) port.add(stem);
      if (style === 'rectWaveguide') {
        const direction = new THREE.Vector3(
          busChannel ? busPortOffsetX : 0,
          busChannel ? 0 : portTopY - baseY,
          busChannel ? busPortOffsetZ : 0,
        ).normalize();
        const socket = buildRectSegment(
          new THREE.Vector3(portX, portTopY, portZ).addScaledVector(direction, -0.035),
          new THREE.Vector3(portX, portTopY, portZ).addScaledVector(direction, 0.035),
          Math.max(0.1, radius * 2.5), Math.max(0.075, radius * 1.9), hardwareMat,
        );
        if (socket) port.add(socket);
      } else {
        const socketRadius = Math.max(0.04, radius * 1.32);
        const direction = new THREE.Vector3(
          busChannel ? busPortOffsetX : 0,
          busChannel ? 0 : portTopY - baseY,
          busChannel ? busPortOffsetZ : 0,
        ).normalize();
        const socket = buildCylinderSegment(
          new THREE.Vector3(portX, portTopY, portZ).addScaledVector(direction, -0.025),
          new THREE.Vector3(portX, portTopY, portZ).addScaledVector(direction, 0.025),
          socketRadius, hardwareMat,
        );
        if (socket) port.add(socket);
      }
      group.add(port);
    }
  }
  // A branch endpoint that lands on a trunk is a tee, not a dangling glowing
  // ball. Its collar is deliberately the same fitting vocabulary as an elbow
  // so the network reads as assembled hardware from any camera angle.
  for (const which of ['start', 'end']) {
    if (!joinedOpenEnds?.[which] || points.length < 2) continue;
    const index = which === 'start' ? 0 : points.length - 1;
    const neighbor = which === 'start' ? 1 : points.length - 2;
    const direction = new THREE.Vector3().subVectors(points[index], points[neighbor]).normalize();
    const fitting = buildServiceFitting(
      points[index], direction, descriptor, hardwareMat, flowState);
    if (fitting) {
      fitting.userData.isUtilityTeeFitting = true;
      group.add(fitting);
      addCryoColdSpot(points[index]);
    }
  }

  const visualEffects = [];
  // The animated material is the only visible flow treatment. Publish only an
  // invisible, bounded light-proxy path for utilities that illuminate nearby
  // surfaces; VisualEffectSystem must never add travelling crest geometry or
  // projected floor circles over utility lines.
  if (flowing && flow.light !== false) {
    const effectPoints = reversed ? points.slice().reverse() : points;
    visualEffects.push({
      id: `utility-flow:${line.id}`,
      kind: 'pathPulse',
      path: effectPoints.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      color: flow.color || utilityCircuitColor(line.utilityType, line.waterCircuit),
      speed: flow.speed,
      period: flow.period,
      crest: false,
      groundSpill: false,
      state: flowState || 'ok',
      light: {
        intensity: flow.lightIntensity ?? 0.16,
        distance: flow.lightDistance ?? 1.55,
        daylightFloor: flow.daylightFloor ?? 0.25,
      },
    });
  }

  const ambientPath = points.map((p) => ({ x: p.x, y: p.y, z: p.z }));
  if (line.utilityType === 'cryoTransfer') {
    if (cryoColdSpots.length > 0) {
      visualEffects.push({
        id: `cryo-mist:${line.id}`,
        kind: 'ambientMist',
        path: cryoColdSpots.map((p) => ({ x: p.x, y: p.y, z: p.z })),
        source: 'cryostat-fittings',
        emitterMode: 'points',
        color: '#dceff5',
        particlesPerEmitter: 1,
        cycle: 6.4,
        activeFraction: flowState === 'soft' ? 0.28 : 0.18,
        rise: 0.30,
        drift: 0.12,
        radius: 0.085,
      });
    }
  } else if (line.utilityType === 'coolingWater') {
    visualEffects.push({
      id: `cooling-drips:${line.id}`,
      kind: 'ambientDrip',
      path: ambientPath,
      color: '#78bfff',
      spacing: 2.4,
      cycle: 3.2,
      fallDuration: 1.0,
      radius: 0.022,
      floorY: 0.025,
    });
  }
  if (visualEffects.length > 0) group.userData.visualEffects = visualEffects;

  return group;
}

// --- Preview (during drag) ---------------------------------------------

// Cached translucent materials for the draw preview, keyed by utility type.
const _previewMatCache = new Map();
function getPreviewMaterial(utilityType, valid = true, waterCircuit = null) {
  const key = `${utilityType}|${valid ? 'valid' : 'blocked'}|${waterCircuit || '-'}`;
  if (_previewMatCache.has(key)) return _previewMatCache.get(key);
  const color = valid ? utilityCircuitColor(utilityType, waterCircuit) : '#ff4f38';
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.3, metalness: 0.1,
    transparent: true, opacity: valid ? 0.55 : 0.72,
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.35,
  });
  _previewMatCache.set(key, shared(mat));
  return mat;
}

function buildPreviewLine(preview) {
  if (!preview || !Array.isArray(preview.path) || preview.path.length < 2) return null;
  const descriptor = UTILITY_TYPES[preview.utilityType];
  if (!descriptor) return null;
  const busLane = preview.busLane ? universalBusLane(preview.utilityType) : null;
  const suspendedBusLane = busLane?.supportMode === 'tensioned-span';
  const previewY = preview.rack ? 0.72
    : (busLane?.runY ?? utilityLineHeight(preview.utilityType, preview.routeHeightMeters));
  const flexible = suspendedBusLane || (!preview.rack && !preview.manifold && !busLane
    && isSoftCable(preview.utilityType)
    && Array.isArray(preview.cablePath) && preview.cablePath.length >= 2);
  let points = flexible && !suspendedBusLane
    ? buildSoftCableWorldPoints({
        utilityType: preview.utilityType,
        path: preview.path,
        cablePath: preview.cablePath,
        start: null,
        end: null,
        tensioned: preview.tensioned === true,
      }, null, { start: preview.startAnchor, end: preview.endAnchor })
    : preview.path.map(p => {
        const w = tileToWorld(p);
      return new THREE.Vector3(w.x, previewY, w.z);
    });
  if (busLane && points.length >= 2) {
    const first = points[0], last = points[points.length - 1];
    const dx = last.x - first.x, dz = last.z - first.z;
    const length = Math.hypot(dx, dz) || 1;
    const offsetX = -dz / length * busLane.lateral;
    const offsetZ = dx / length * busLane.lateral;
    for (const point of points) {
      point.x += offsetX;
      point.z += offsetZ;
      point.y = busLane.runY;
    }
    if (suspendedBusLane) points = tensionedBusSpanPoints(points);
  }
  if (!flexible && !busLane && preview.utilityType === 'rfWaveguide'
    && preview.endpointTransitions !== false) {
    attachWaveguideTransitions(
      points, preview.startAnchor, preview.endAnchor, previewY, descriptor);
  }
  const group = new THREE.Group();
  group.userData = {
    isUtilityLinePreview: true,
    routeHeightMeters: previewY,
  };
  if (preview.rack) return buildUniversalBusPreview(points, preview.valid !== false);
  const radius = preview.rack ? 0.13
    : (descriptor.pipeRadiusMeters || 0.04)
      * (busLane ? 0.85 : preview.manifold ? 2.58 : 1.1);
  const style = descriptor.geometryStyle || 'cylinder';
  const cryostatPresentation = descriptor.presentationStyle === 'cryostatLine';
  const renderedRadius = cryostatPresentation
    ? radius * (descriptor.jacketRadiusScale || 1.6) : radius;
  const previewState = preview.valid === false ? 'hard' : 'ok';
  const mat = getPreviewMaterial(
    preview.utilityType, preview.valid !== false, preview.waterCircuit);
  const hardwareMat = getLineHardwareMaterial(
    preview.utilityType, preview.waterCircuit);
  const flexibleMesh = flexible
    ? buildFlexibleCable(points, radius, mat, false, suspendedBusLane ? null : previewY)
    : null;
  if (flexibleMesh) {
    if (suspendedBusLane) flexibleMesh.userData.isUniversalUtilityBusSuspendedSpan = true;
    group.add(flexibleMesh);
  }
  for (let i = 0; !flexibleMesh && i < points.length - 1; i++) {
    const trimmed = trimmedSegment(points, i, descriptor);
    const a = trimmed.start, b = trimmed.end;
    let mesh = null;
    if (style === 'rectWaveguide') {
      mesh = buildRectSegment(a, b, radius * 2, radius * 1.4, mat);
    } else if (style === 'fiberBundle') {
      mesh = buildFiberBundleSegment(a, b, descriptor, mat);
    } else {
      mesh = buildCylinderSegment(a, b, renderedRadius, mat);
    }
    if (mesh) {
      if (cryostatPresentation) mesh.userData.isCryostatVacuumJacket = true;
      group.add(mesh);
    }
    if (cryostatPresentation) {
      addCryostatIdentificationBands(group, a, b, descriptor, mat);
      addInlineCouplers(group, a, b, descriptor, hardwareMat, previewState);
    }
  }
  if (!flexible && !busLane) {
    addUtilitySupports(
      group, points, descriptor, preview.utilityType, mat, preview.routeHeightMeters);
  }
  for (let i = 1; !flexible && i < points.length - 1; i++) {
    const prev = points[i - 1], at = points[i], next = points[i + 1];
    const joint = buildCornerJoint(
      prev, at, next, style, renderedRadius, mat, descriptor);
    if (joint) group.add(joint);
    const bend = cornerBendInfo(prev, at, next, descriptor);
    if (bend && descriptor.fittingStyle) {
      const entry = buildServiceFitting(
        bend.start, bend.incoming, descriptor, hardwareMat, previewState);
      const exit = buildServiceFitting(
        bend.end, bend.outgoing, descriptor, hardwareMat, previewState);
      if (entry) group.add(entry);
      if (exit) group.add(exit);
    }
  }
  // Flexible/open generic utilities keep waypoint beads for hand feedback.
  // Services with physical fittings show their actual elbows and collars
  // instead, even when their placement rules are deliberately forgiving.
  const sphereMat = mat;
  const markerPoints = flexible ? [points[0], points[points.length - 1]]
    : (descriptor.fittingStyle
        ? [points[0], points[points.length - 1]] : points);
  for (const p of markerPoints) {
    const sg = new THREE.SphereGeometry(renderedRadius * 1.2, 10, 8);
    const sm = new THREE.Mesh(sg, sphereMat);
    sm.position.copy(p);
    group.add(sm);
  }
  return group;
}

// --- Port indicators ---------------------------------------------------
//
// When a utility-line tool is armed (controller utilityType !== null), render
// a small colored sphere at every available port of that utility type, so the
// player can see where to click. The sphere at the cursor-nearest port gets
// brightened (larger + higher emissive) as hover feedback. Spheres for the
// starting-port (once draw has begun) are omitted since they aren't valid
// endpoints anyway.

// Port-marker materials, keyed by (color, brightened) — shared across the
// marker set, which is torn down and rebuilt on every world event while a
// utility-line tool is armed (at least 1 Hz via 'tick').
const _portMarkerMatCache = new Map();
function getPortMarkerMaterial(color, brightened) {
  const key = `${color}|${brightened ? 1 : 0}`;
  if (_portMarkerMatCache.has(key)) return _portMarkerMatCache.get(key);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    emissive: new THREE.Color(color),
    emissiveIntensity: brightened ? 1.0 : 0.5,
    transparent: true,
    opacity: brightened ? 0.95 : 0.7,
    depthTest: false,
  });
  _portMarkerMatCache.set(key, shared(mat));
  return mat;
}

// What to draw a utility's INTERACTIVE markers in. Normally the utility's own
// colour — identity matters — but a descriptor may override it when its cable
// colour is unusable as UI. HV feeders are black so they read as trunk on the
// hall floor; black port dots on dark equipment would be invisible.
function markerColorFor(descriptor, waterCircuit = null) {
  if ((descriptor?.type === 'waterSupplyPipe' || descriptor?.type === 'coolingWater')
      && waterCircuit) {
    return utilityCircuitColor(descriptor.type, waterCircuit);
  }
  return (descriptor && (descriptor.markerColor || descriptor.color)) || '#ffff88';
}

// Dot radii in world metres (1 tile = 2 m). Deliberately small: a marker sits
// on every available port of the armed utility, so at facility scale dozens are
// on screen at once — they have to read as a hint about where the cursor can
// grab, not as objects in the world. Hover is the only one allowed to be
// conspicuous, and it is exactly one.
const PORT_DOT_R = 0.07;
const PORT_DOT_R_HOVER = 0.12;

// `anchor` is a portAnchor3D result: the dot sits ON the connector, standing
// the same distance proud of the shell as the fitting does, rather than at an
// invented height over the floor tile the port's footprint edge touches.
function buildPortMarker(anchor, color, brightened) {
  const r = brightened ? PORT_DOT_R_HOVER : PORT_DOT_R;
  const geo = new THREE.SphereGeometry(r, 10, 8);
  const mat = getPortMarkerMaterial(color, brightened);
  const mesh = new THREE.Mesh(geo, mat);
  const out = anchor.out || { x: 0, y: 0, z: 0 };
  const d = (anchor.standoff || 0) + r;
  mesh.position.set(
    anchor.x + out.x * d,
    (anchor.y != null ? anchor.y : PIPE_Y + 0.3) + (out.y || 0) * d,
    anchor.z + out.z * d,
  );
  mesh.renderOrder = 999;
  mesh.userData = { isUtilityPortMarker: true };
  return mesh;
}

// Back-compat: hover marker wraps the brightened variant. The controller hands
// over the port's identity, so the anchor is resolved here rather than being
// carried through the input layer (which has no business knowing heights).
function buildHoverMarker(hoverPort) {
  if (!hoverPort || !hoverPort.worldPos) return null;
  const descriptor = hoverPort.utilityType ? UTILITY_TYPES[hoverPort.utilityType] : null;
  const color = markerColorFor(descriptor, hoverPort.waterCircuit);
  // Tapping a trunk and grabbing a port are different commitments — one makes
  // a T-join on an existing run, the other claims a connector — so they must
  // not look alike. A ring around the line reads as "join here".
  if (hoverPort.tap) {
    return buildTapMarker(
      hoverPort.worldPos,
      color,
      utilityLineHeight(hoverPort.utilityType, hoverPort.routeHeightMeters),
    );
  }
  const anchor = hoverPort.anchor || { ...hoverPort.worldPos, y: PIPE_Y + 0.3 };
  return buildPortMarker(anchor, color, true);
}

function buildTapMarker(worldPos, color, runY) {
  const geo = new THREE.TorusGeometry(PORT_DOT_R_HOVER, PORT_DOT_R_HOVER * 0.28, 6, 14);
  const mesh = new THREE.Mesh(geo, getPortMarkerMaterial(color, true));
  mesh.position.set(worldPos.x, runY, worldPos.z);
  mesh.rotation.x = Math.PI / 2;           // lie flat around the run
  mesh.renderOrder = 999;
  mesh.userData = { isUtilityTapMarker: true };
  return mesh;
}

// --- Sink-port issue markers -------------------------------------------
//
// The pipe and its port affordances share one utility identity. A compact
// exclamation point uses that same port-marker hue: partial service is a
// subdued shade, while zero service / hard failure uses the full-bright hue.
// A thin vertical leader starts at the exact 3D port anchor so the glyph reads
// as belonging to that connector rather than floating over the general area.

const ISSUE_MARK_RISE = 0.42;
const ISSUE_DOT_RADIUS = 0.05;
const ISSUE_SHADE = { warning: 0.68, critical: 1 };
const ISSUE_EMISSIVE = { warning: 0.5, critical: 0.95 };

function shadeHexColor(color, scale) {
  const match = /^#([0-9a-f]{6})$/i.exec(color || '');
  if (!match) return color;
  const value = Number.parseInt(match[1], 16);
  const channel = shift => Math.max(0, Math.min(255,
    Math.round(((value >> shift) & 0xff) * scale)));
  return `#${[channel(16), channel(8), channel(0)]
    .map(n => n.toString(16).padStart(2, '0')).join('')}`;
}

const _issueMatCache = new Map();
function getIssueMarkerMaterial(utilityType, severity, waterCircuit = null) {
  const key = `${utilityType}|${waterCircuit || '-'}|${severity}`;
  if (_issueMatCache.has(key)) return _issueMatCache.get(key);
  const descriptor = UTILITY_TYPES[utilityType];
  const portColor = markerColorFor(descriptor, waterCircuit);
  const color = shadeHexColor(portColor, ISSUE_SHADE[severity] ?? 1);
  const emissiveBase = ISSUE_EMISSIVE[severity] ?? ISSUE_EMISSIVE.critical;
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    emissive: new THREE.Color(color),
    emissiveIntensity: emissiveBase,
    roughness: 0.25, metalness: 0.1,
    transparent: true, opacity: severity === 'warning' ? 0.82 : 0.96,
    depthTest: false,
  });
  mat.userData.issueEmissiveBase = emissiveBase;
  _issueMatCache.set(key, shared(mat));
  return mat;
}

function buildUtilityPortIssueMarker(mark) {
  const mat = getIssueMarkerMaterial(mark.utilityType, mark.severity, mark.waterCircuit);
  const g = new THREE.Group();
  const footY = Number.isFinite(mark.y) ? mark.y : PIPE_Y;
  const leaderHeight = ISSUE_MARK_RISE - ISSUE_DOT_RADIUS;
  const leader = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, leaderHeight, 6), mat);
  leader.position.set(0, leaderHeight / 2, 0);
  leader.renderOrder = 1001;
  g.add(leader);

  const dotY = ISSUE_MARK_RISE;
  const dot = new THREE.Mesh(new THREE.SphereGeometry(ISSUE_DOT_RADIUS, 8, 6), mat);
  dot.position.set(0, dotY, 0);
  dot.renderOrder = 1001;
  g.add(dot);

  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.22, 0.055), mat);
  bar.position.set(0, dotY + 0.18, 0);
  bar.renderOrder = 1001;
  g.add(bar);

  g.position.set(mark.x, footY, mark.z);
  g.userData = {
    isUtilityPortIssueMarker: true,
    placeableId: mark.placeableId,
    portName: mark.portName,
    utilityType: mark.utilityType,
    waterCircuit: mark.waterCircuit || null,
    severity: mark.severity,
  };
  return g;
}

// --- Main builder -------------------------------------------------------

export class UtilityLineBuilderV2 {
  constructor() {
    // line.id → Group. Rebuilt on utilityLinesChanged; reused when unchanged.
    this._lineGroups = new Map();
    // (line.id → hash string) to detect path/descriptor changes.
    this._lineHashes = new Map();
    this._busGroups = new Map();
    this._busHashes = new Map();
    this._rigidSupportGroup = null;
    this._rigidSupportHash = null;
    this._focusLineIds = null;
    // line.id → one short-lived interpolation from the just-drawn hand shape
    // to its deterministic, gravity-settled rope solve.
    this._relaxations = new Map();
    // While equipment is carried, flexible runs keep a tiny damped-spring
    // state so their middle lags behind the pinned fittings and catches up.
    // This is transient renderer state only; the committed cable remains the
    // deterministic relaxed solve stored by the game.
    this._draggedPlaceableId = null;
    this._dragCableStates = new Map();
    this._dragLineIds = new Set();
    // Existing lines loaded with the scene start already settled. Only lines
    // appearing after the first build perform the visible relaxation.
    this._hasBuiltOnce = false;
    // Preview / hover layers. The preview is content-keyed (see setPreview) —
    // a run-wiring drag makes it far too big to rebuild per frame.
    this._previewObject = null;
    this._previewSig = null;
    this._hoverObject = null;
    this._hoverSig = null;
    // `${placeableId}:${portName}` → portAnchor3D, filled by setAvailablePorts
    // and read by setHoverPort (which is given an identity, not a record).
    this._anchorByKey = new Map();
    // Sink-port issue markers + the signature that guards their rebuild.
    this._issueGroup = null;
    this._issueSig = null;
  }

  /**
   * Rebuild committed-line meshes. Iterates state.utilityLines and adds one
   * Group per line to parentGroup. Lines whose hash hasn't changed are reused.
   *
   * @param {Map<string, UtilityLine>} utilityLines
   * @param {Map<string, Placeable>} placeablesById
   * @param {THREE.Group} parentGroup
   * @param {object} [opts]
   * @param {object} [opts.state] - game state; used to compute per-line
   *        error and energized states from state.utilityNetworkData.
   */
  build(utilityLines, placeablesById, parentGroup, opts = {}) {
    const seen = new Set();
    const lines = utilityLines || new Map();
    const errorByLineId = opts.state ? this._buildErrorMap(opts.state) : new Map();
    const energizedRfLineIds = opts.state
      ? this._buildEnergizedRfLineIds(opts.state) : new Set();
    const orientationByLineId = opts.state ? this._buildOrientationMap(opts.state, lines) : new Map();
    const records = typeof lines.values === 'function' ? Array.from(lines.values()) : Array.from(lines);
    const lineById = new Map(records.map(line => [line?.id, line]));
    const installedLineIds = new Set(records.map(line => line?.id).filter(Boolean));
    for (const line of records) {
      if (!line || !line.id) continue;
      seen.add(line.id);
      const errorStatus = errorByLineId.get(line.id) || 'ok';
      // RF glow represents a real energized field, not merely the presence of
      // copper waveguide. Solver output is the source of truth: an unpowered,
      // disconnected, or frequency-incompatible source publishes zero
      // capacity, so the guide remains ordinary dark metal even if its
      // diagnostic severity is only soft.
      const flowState = line.utilityType === 'rfWaveguide'
        && !energizedRfLineIds.has(line.id) ? 'off' : errorStatus;
      // Draw order (line.start -> line.end) isn't necessarily source -> sink
      // — computeLineOrientations resolves that from network topology.
      // Included in the hash: rewiring a network (a new source appearing, a
      // tap moving) has to rebuild every line whose orientation flips, same
      // as errorStatus already does for fault transitions.
      const reversed = orientationByLineId.get(line.id) || false;
      const tapAnchors = {
        start: busTapAnchor(line, 'start', lineById),
        end: busTapAnchor(line, 'end', lineById),
      };
      const tapAnchorHash = ['start', 'end'].map(which => {
        const anchor = tapAnchors[which];
        return anchor ? `${anchor.x},${anchor.y},${anchor.z}` : '-';
      }).join(':');
      const hash = this._hashLine(line, placeablesById) + '|' + errorStatus + '|' + flowState + '|'
        + (reversed ? 'rev' : 'fwd') + '|' + tapAnchorHash;
      const prevHash = this._lineHashes.get(line.id);
      if (prevHash === hash && this._lineGroups.has(line.id)) continue;
      const isNewLine = prevHash === undefined;
      const isDraggedLine = !!this._draggedPlaceableId
        && (line.start?.placeableId === this._draggedPlaceableId
          || line.end?.placeableId === this._draggedPlaceableId);
      if (isDraggedLine) this._dragLineIds.add(line.id);
      this._relaxations.delete(line.id);
      // Rebuild: remove old, add new.
      const old = this._lineGroups.get(line.id);
      let oldControlPoints = null;
      old?.traverse(object => {
        if (!oldControlPoints && object.userData?.isFlexibleUtilityCable) {
          oldControlPoints = object.userData.flexibleControlPoints?.map(point => point.clone()) || null;
        }
      });
      if (old) {
        parentGroup.remove(old);
        this._disposeGroup(old);
      }
      let pointOverride = null;
      let relaxation = null;
      const joinedOpenEnds = {
        start: !!line.tapLineIds?.start && installedLineIds.has(line.tapLineIds.start),
        end: !!line.tapLineIds?.end && installedLineIds.has(line.tapLineIds.end),
      };
      // Ordinary flexible runs settle from the player's freehand trace. A
      // universal-bus channel instead gets its deterministic post-to-post
      // spans inside buildLineGroup; running it through the floor-rope solve
      // here would erase those intermediate mechanical supports.
      if (isSoftCable(line.utilityType) && !line.manifold) {
        const initialPoints = buildSoftCableWorldPoints(line, placeablesById, tapAnchors);
        const tensioned = isTensionedHvCable(line, placeablesById);
        const floorY = utilityLineHeight(line.utilityType);
        const bendRadius = softCableBendRadiusMeters(line.utilityType);
        const finalPoints = (tensioned ? initialPoints : relaxedCableControlPoints(initialPoints, {
          floorY,
          bendStiffness: 0.08 + Math.min(0.08, bendRadius * 0.1),
        }).map(point => new THREE.Vector3(point.x, point.y, point.z)));
        const previousDrag = this._dragCableStates.get(line.id);
        const previousPoints = previousDrag?.points || oldControlPoints;
        const dragPoints = isDraggedLine
          ? resampleControlPoints(previousPoints, finalPoints.length) : null;
        const dragAnimate = isDraggedLine && dragPoints && dragPoints.length >= 3;
        if (dragAnimate) {
          // The fittings never visually detach from the carried ghost. Only
          // interior rope particles retain momentum and trail the cursor.
          dragPoints[0].copy(finalPoints[0]);
          dragPoints[dragPoints.length - 1].copy(finalPoints[finalPoints.length - 1]);
          pointOverride = dragPoints;
          const velocities = previousDrag?.velocities?.length === dragPoints.length
            ? previousDrag.velocities
            : dragPoints.map(() => new THREE.Vector3());
          this._dragCableStates.set(line.id, {
            points: dragPoints,
            targetPoints: finalPoints,
            velocities,
            floorY,
            radius: UTILITY_TYPES[line.utilityType]?.pipeRadiusMeters || 0.04,
            reversed,
            settled: false,
            group: null,
          });
        } else if (!isDraggedLine) {
          this._dragCableStates.delete(line.id);
        }
        const animate = !tensioned && !dragAnimate && this._hasBuiltOnce && isNewLine
          && initialPoints.length === finalPoints.length && initialPoints.length >= 3;
        if (!dragAnimate) pointOverride = animate ? initialPoints : finalPoints;
        if (animate) {
          relaxation = {
            elapsed: 0,
            duration: FLEXIBLE_RELAX_DURATION_SECONDS,
            initialPoints,
            finalPoints,
            floorY,
            radius: UTILITY_TYPES[line.utilityType]?.pipeRadiusMeters || 0.04,
            line,
            placeablesById,
            errorStatus,
            flowState,
            reversed,
            joinedOpenEnds,
            parentGroup,
          };
        }
      }
      const group = buildLineGroup(
        line, placeablesById, errorStatus, flowState, reversed,
        pointOverride, joinedOpenEnds, tapAnchors, false);
      if (group) {
        parentGroup.add(group);
        this._lineGroups.set(line.id, group);
        this._lineHashes.set(line.id, hash);
        if (relaxation) this._relaxations.set(line.id, { ...relaxation, group });
        const dragState = this._dragCableStates.get(line.id);
        if (dragState && isDraggedLine) dragState.group = group;
      } else {
        this._lineGroups.delete(line.id);
        this._lineHashes.delete(line.id);
      }
    }
    // Remove groups for lines that no longer exist.
    for (const id of [...this._lineGroups.keys()]) {
      if (!seen.has(id)) {
        const g = this._lineGroups.get(id);
        parentGroup.remove(g);
        this._disposeGroup(g);
        this._lineGroups.delete(id);
        this._lineHashes.delete(id);
        this._relaxations.delete(id);
        this._dragCableStates.delete(id);
      }
    }
    this._buildRigidUtilitySupports(records, placeablesById, lineById, parentGroup);
    this._buildUtilityBuses(opts.state?.utilityBuses || [], parentGroup);
    this._applyFocus();
    this._hasBuiltOnce = true;
  }

  _setGroupFocusDimmed(group, dimmed) {
    group?.traverse?.(object => {
      if (!object.material) return;
      const current = Array.isArray(object.material) ? object.material : [object.material];
      if (dimmed) {
        if (!object.userData._focusBaseMaterials) {
          object.userData._focusBaseMaterials = current;
          object.userData._focusDimMaterials = current.map(material => {
            const clone = material.clone();
            clone.transparent = true;
            clone.opacity = Math.min(material.opacity ?? 1, 0.12);
            clone.depthWrite = false;
            return clone;
          });
        }
        object.material = Array.isArray(object.material)
          ? object.userData._focusDimMaterials
          : object.userData._focusDimMaterials[0];
      } else if (object.userData._focusBaseMaterials) {
        for (const material of object.userData._focusDimMaterials || []) material.dispose?.();
        object.material = Array.isArray(object.material)
          ? object.userData._focusBaseMaterials
          : object.userData._focusBaseMaterials[0];
        delete object.userData._focusBaseMaterials;
        delete object.userData._focusDimMaterials;
      }
    });
  }

  _applyFocus() {
    const focus = this._focusLineIds;
    const focusedBusIds = new Set();
    for (const [lineId, group] of this._lineGroups) {
      const isFocused = !focus || focus.has(lineId);
      this._setGroupFocusDimmed(group, !isFocused);
      if (isFocused && group.userData?.busId) focusedBusIds.add(group.userData.busId);
    }
    for (const [busId, group] of this._busGroups) {
      this._setGroupFocusDimmed(group, !!focus && !focusedBusIds.has(busId));
    }
    if (this._rigidSupportGroup) {
      const lineIds = this._rigidSupportGroup.userData?.lineIds || [];
      this._setGroupFocusDimmed(
        this._rigidSupportGroup,
        !!focus && !lineIds.some(lineId => focus.has(lineId)),
      );
    }
  }

  _buildRigidUtilitySupports(records, placeablesById, lineById, parentGroup) {
    const rigid = records.filter(line => {
      const descriptor = UTILITY_TYPES[line?.utilityType];
      return line?.id && !line.manifold && descriptor?.fixedRouteHeight === true
        && descriptor.supportSpacingMeters > 0
        && descriptor.supportMinimumRunMeters > 0;
    });
    const hash = rigid.map(line => this._hashLine(line, placeablesById)).sort().join('|');
    if (hash === this._rigidSupportHash && this._rigidSupportGroup) {
      // A changed fault/flow state can rebuild a line group while the rack
      // hash stays stable. Keep racks after line groups in scene order so
      // render consumers never mistake support geometry for the rebuilt line.
      parentGroup.remove(this._rigidSupportGroup);
      parentGroup.add(this._rigidSupportGroup);
      return;
    }
    if (this._rigidSupportGroup) {
      parentGroup.remove(this._rigidSupportGroup);
      this._disposeGroup(this._rigidSupportGroup);
      this._rigidSupportGroup = null;
    }
    this._rigidSupportHash = hash;
    if (rigid.length === 0) return;

    const stations = new Map();
    for (const line of rigid) {
      const descriptor = UTILITY_TYPES[line.utilityType];
      const tapAnchors = {
        start: busTapAnchor(line, 'start', lineById),
        end: busTapAnchor(line, 'end', lineById),
      };
      const points = buildWorldPoints(line, placeablesById, tapAnchors);
      const runY = utilityLineHeight(line.utilityType, line.routeHeightMeters);
      const frames = utilitySupportFrames(points, {
        floorY: runY,
        spacingMeters: descriptor.supportSpacingMeters,
        minimumRunMeters: descriptor.supportMinimumRunMeters,
      });
      for (const frame of frames) {
        const key = supportStationKey(frame);
        const list = stations.get(key) || [];
        const sameShelf = list.find(entry =>
          entry.utilityType === line.utilityType
          && Math.abs(entry.frame.point.y - frame.point.y) < 1e-5);
        if (sameShelf) sameShelf.lineIds.add(line.id);
        else list.push({
          frame,
          descriptor,
          utilityType: line.utilityType,
          lineIds: new Set([line.id]),
        });
        stations.set(key, list);
      }
    }

    const group = new THREE.Group();
    const allLineIds = new Set();
    for (const entries of stations.values()) {
      const support = buildStackedUtilitySupport(entries);
      if (!support) continue;
      for (const lineId of support.userData.lineIds || []) allLineIds.add(lineId);
      group.add(support);
    }
    group.userData = {
      isRigidUtilitySupportGroup: true,
      lineIds: [...allLineIds],
    };
    parentGroup.add(group);
    this._rigidSupportGroup = group;
  }

  /** Keep the utility runs serving a selected beamline fully opaque. */
  setFocus(lineIds = null) {
    this._focusLineIds = lineIds == null ? null : new Set(lineIds);
    this._applyFocus();
  }

  _buildUtilityBuses(buses, parentGroup) {
    const seen = new Set();
    for (const bus of buses) {
      if (!bus?.id || !Array.isArray(bus.path) || bus.path.length < 2) continue;
      seen.add(bus.id);
      const hash = JSON.stringify([bus.path, bus.taps]);
      if (this._busHashes.get(bus.id) === hash && this._busGroups.has(bus.id)) continue;
      const old = this._busGroups.get(bus.id);
      if (old) { parentGroup.remove(old); this._disposeGroup(old); }
      const group = new THREE.Group();
      const material = universalBusMaterial();
      for (let i = 0; i < bus.path.length - 1; i++) {
        const aw = tileToWorld(bus.path[i]), bw = tileToWorld(bus.path[i + 1]);
        const a = new THREE.Vector3(aw.x, 0, aw.z);
        const b = new THREE.Vector3(bw.x, 0, bw.z);
        const dx = b.x - a.x, dz = b.z - a.z;
        const length = Math.hypot(dx, dz) || 1;
        const ox = -dz / length * UNIVERSAL_BUS_HALF_WIDTH;
        const oz = dx / length * UNIVERSAL_BUS_HALF_WIDTH;
        for (const side of [-1, 1]) {
          for (const railY of [UNIVERSAL_BUS_DECK_Y, UNIVERSAL_RACK_TOP_Y]) {
            const rail = buildRectSegment(
              new THREE.Vector3(a.x + ox * side, railY, a.z + oz * side),
              new THREE.Vector3(b.x + ox * side, railY, b.z + oz * side),
              0.045, 0.07, material,
            );
            if (rail) group.add(rail);
          }
        }
      }
      for (const tap of bus.taps || []) {
        const point = tap.point || tap;
        const w = tileToWorld({
          col: (point.col || 0) + (point.subCol || 0) / 4,
          row: (point.row || 0) + (point.subRow || 0) / 4,
        });
        const vertical = bus.path[0].col === bus.path[bus.path.length - 1].col;
        const hanger = new THREE.Group();
        hanger.userData.isUniversalUtilityBusHanger = true;
        for (const lateral of [-UNIVERSAL_BUS_HALF_WIDTH, UNIVERSAL_BUS_HALF_WIDTH]) {
          const rodHeight = UNIVERSAL_RACK_TOP_Y - 0.04;
          const rod = new THREE.Mesh(new THREE.BoxGeometry(0.045, rodHeight, 0.045), material);
          rod.position.set(vertical ? w.x + lateral : w.x, 0.04 + rodHeight / 2,
            vertical ? w.z : w.z + lateral);
          hanger.add(rod);
          const foot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.18), material);
          foot.position.set(vertical ? w.x + lateral : w.x, 0.02,
            vertical ? w.z : w.z + lateral);
          hanger.add(foot);
        }
        for (const lane of UNIVERSAL_BUS_LANE_LIST) {
          const shelf = new THREE.Mesh(new THREE.BoxGeometry(
            UNIVERSAL_BUS_HALF_WIDTH * 2 + 0.08, 0.04, 0.055), material);
          shelf.position.set(w.x, Math.max(0.10, lane.runY - 0.10), w.z);
          if (vertical) shelf.rotation.y = Math.PI / 2;
          shelf.userData.universalRackSlot = lane.slot;
          hanger.add(shelf);
        }
        group.add(hanger);
      }
      group.userData = { isUniversalUtilityBus: true, busId: bus.id };
      parentGroup.add(group);
      this._busGroups.set(bus.id, group);
      this._busHashes.set(bus.id, hash);
    }
    for (const id of [...this._busGroups.keys()]) {
      if (seen.has(id)) continue;
      const group = this._busGroups.get(id);
      parentGroup.remove(group);
      this._disposeGroup(group);
      this._busGroups.delete(id);
      this._busHashes.delete(id);
    }
  }

  /** Select the one carried placeable whose attached lines receive inertia. */
  setDraggedPlaceableId(placeableId) {
    const next = placeableId || null;
    if (next === this._draggedPlaceableId) return;
    // The last preview pose can equal the newly committed pose. In that case
    // its hash also matches, but its visible rope may still contain transient
    // inertia. Force every previewed line through one final static rebuild.
    for (const lineId of this._dragLineIds) this._lineHashes.delete(lineId);
    this._dragLineIds.clear();
    this._draggedPlaceableId = next;
    this._dragCableStates.clear();
  }

  /**
   * Advance the lightweight damped-spring cable particles used only during a
   * move gesture. Both fittings stay pinned; interior points overshoot just
   * enough to read as mass, then become completely idle when settled.
   * Returns true when any cable newly comes to rest.
   */
  updateDragDynamics(dtSeconds) {
    const dt = Math.min(0.05,
      Number.isFinite(dtSeconds) && dtSeconds > 0 ? dtSeconds : 0);
    if (dt <= 0 || !this._draggedPlaceableId || this._dragCableStates.size === 0) return false;
    let finishedAny = false;
    for (const [lineId, state] of this._dragCableStates) {
      if (state.settled) continue;
      const group = this._lineGroups.get(lineId);
      if (!group || group !== state.group
          || state.points.length !== state.targetPoints.length) continue;
      let maxError = 0;
      let maxSpeed = 0;
      const damping = Math.exp(-7.5 * dt);
      for (let i = 0; i < state.points.length; i++) {
        const point = state.points[i];
        const target = state.targetPoints[i];
        const velocity = state.velocities[i];
        if (i === 0 || i === state.points.length - 1) {
          point.copy(target);
          velocity.set(0, 0, 0);
          continue;
        }
        const dx = target.x - point.x;
        const dy = target.y - point.y;
        const dz = target.z - point.z;
        maxError = Math.max(maxError, Math.hypot(dx, dy, dz));
        velocity.x = (velocity.x + dx * 34 * dt) * damping;
        velocity.y = (velocity.y + dy * 34 * dt) * damping;
        velocity.z = (velocity.z + dz * 34 * dt) * damping;
        point.x += velocity.x * dt;
        point.y = Math.max(state.floorY, point.y + velocity.y * dt);
        point.z += velocity.z * dt;
        maxSpeed = Math.max(maxSpeed, velocity.length());
      }
      if (maxError < 0.002 && maxSpeed < 0.01) {
        state.points.forEach((point, i) => point.copy(state.targetPoints[i]));
        state.velocities.forEach(velocity => velocity.set(0, 0, 0));
        state.settled = true;
        finishedAny = true;
      }
      let mesh = null;
      group.traverse(object => {
        if (!mesh && object.userData?.isFlexibleUtilityCable) mesh = object;
      });
      if (!mesh) continue;
      const geometry = buildFlexibleCableGeometry(
        state.points, state.radius, state.reversed, state.floorY);
      if (!geometry) continue;
      mesh.geometry?.dispose?.();
      mesh.geometry = geometry;
      mesh.userData.flexibleControlPoints = state.points.map(point => point.clone());
    }
    return finishedAny;
  }

  /**
   * Advance newly drawn flexible lines toward their settled rope solve.
   * Returns true only when a line reaches rest, so ThreeRenderer can resync
   * its path-pulse effect once rather than rebuilding effect state per frame.
   */
  updateRelaxations(dtSeconds) {
    const dt = Number.isFinite(dtSeconds) && dtSeconds > 0 ? dtSeconds : 0;
    if (dt <= 0 || this._relaxations.size === 0) return false;
    let finishedAny = false;
    for (const [lineId, state] of [...this._relaxations]) {
      const group = this._lineGroups.get(lineId);
      if (!group || group !== state.group) {
        this._relaxations.delete(lineId);
        continue;
      }
      state.elapsed += Math.min(dt, 0.1);
      const t = Math.min(1, state.elapsed / state.duration);
      // Cubic ease-out reads as a quick release followed by damped settling,
      // with no perpetual wobble once the one-second solve is complete.
      const eased = 1 - Math.pow(1 - t, 3);
      const points = state.initialPoints.map((point, index) => {
        const target = state.finalPoints[index];
        return new THREE.Vector3(
          point.x + (target.x - point.x) * eased,
          Math.max(state.floorY, point.y + (target.y - point.y) * eased),
          point.z + (target.z - point.z) * eased,
        );
      });

      if (t < 1) {
        let mesh = null;
        group.traverse(object => {
          if (!mesh && object.userData?.isFlexibleUtilityCable) mesh = object;
        });
        if (mesh) {
          const geometry = buildFlexibleCableGeometry(
            points, state.radius, state.reversed, state.floorY);
          if (geometry) {
            mesh.geometry?.dispose?.();
            mesh.geometry = geometry;
          }
        }
        continue;
      }

      // Rebuild once at rest so declarative path effects use the final
      // centreline too. Shared materials survive the replacement.
      state.parentGroup.remove(group);
      this._disposeGroup(group);
      const replacement = buildLineGroup(
        state.line,
        state.placeablesById,
        state.errorStatus,
        state.flowState,
        state.reversed,
        state.finalPoints,
        state.joinedOpenEnds,
      );
      if (replacement) {
        state.parentGroup.add(replacement);
        this._lineGroups.set(lineId, replacement);
      } else {
        this._lineGroups.delete(lineId);
        this._lineHashes.delete(lineId);
      }
      this._relaxations.delete(lineId);
      finishedAny = true;
    }
    return finishedAny;
  }

  /**
   * Build a lineId → 'ok' | 'soft' | 'hard' map by joining the sim's
   * published discovery output (state.utilityNetworks: network id → lineIds,
   * written by SolveRunner each solve pass) against the per-network flow
   * results in state.utilityNetworkData. No discovery runs here — the
   * renderer reuses what the utility gate already computed this tick.
   * Used to drive emissive glow on utility lines during error conditions.
   */
  _buildErrorMap(state) {
    const out = new Map();
    if (!state || !state.utilityNetworkData || typeof state.utilityNetworkData.get !== 'function') {
      return out;
    }
    const networksByType = state.utilityNetworks;
    if (!networksByType || typeof networksByType.get !== 'function') return out;
    for (const utilityType of UTILITY_TYPE_LIST) {
      const perType = state.utilityNetworkData.get(utilityType);
      if (!perType || perType.size === 0) continue;
      const nets = networksByType.get(utilityType) || [];
      for (const net of nets) {
        const flow = perType.get(net.id);
        if (!flow || !flow.errors || flow.errors.length === 0) continue;
        const hasHard = flow.errors.some(e => e && e.severity === 'hard');
        const hasSoft = flow.errors.some(e => e && e.severity === 'soft');
        const status = hasHard ? 'hard' : (hasSoft ? 'soft' : 'ok');
        if (status === 'ok') continue;
        for (const lineId of (net.lineIds || [])) {
          // Hard wins over soft if a line is in multiple networks (shouldn't
          // happen for a single utility type but be defensive).
          const cur = out.get(lineId);
          if (cur === 'hard') continue;
          out.set(lineId, status);
        }
      }
    }
    return out;
  }

  /**
   * Return the RF lines whose solved network has usable forward power.
   *
   * This deliberately joins the renderer to the published solver value
   * rather than re-evaluating equipment power feeds. Missing/stale solve data
   * therefore fails closed: a waveguide cannot advertise RF energy until the
   * simulation has actually published non-zero delivered capacity.
   */
  _buildEnergizedRfLineIds(state) {
    const energized = new Set();
    const networks = state?.utilityNetworks?.get?.('rfWaveguide') || [];
    const flowByNetwork = state?.utilityNetworkData?.get?.('rfWaveguide');
    if (!flowByNetwork || typeof flowByNetwork.get !== 'function') return energized;
    for (const network of networks) {
      const flow = flowByNetwork.get(network.id);
      if (!(Number(flow?.totalCapacity) > 0)) continue;
      for (const lineId of network.lineIds || []) energized.add(lineId);
    }
    return energized;
  }

  /**
   * Build a lineId → reversed(boolean) map from network topology, so the
   * flow pulse travels source -> sink regardless of which end the player
   * drew first. Joins the same state.utilityNetworks discovery output
   * _buildErrorMap reads (one pass per utility type, same source), handing
   * each network to computeLineOrientations (src/utility/line-orientation.js)
   * — pure topology, no rendering concern, so the BFS logic lives and is
   * tested there, not in this renderer-facing method.
   *
   * A line with no entry (network has no source, or the line simply wasn't
   * reachable through the line-to-line graph — see line-orientation.js's
   * doc comment on what it deliberately doesn't model) reads as `false`
   * (forward / draw order) by every caller here, same as _buildErrorMap's
   * "no entry = ok" convention.
   *
   * Vacuum is the one reverse-flow utility: the solver's source is the pump,
   * while the visible gas load travels from the chamber back toward it.
   */
  _buildOrientationMap(state, utilityLinesMap) {
    const out = new Map();
    if (!state || !state.utilityNetworks || typeof state.utilityNetworks.get !== 'function') {
      return out;
    }
    for (const utilityType of UTILITY_TYPE_LIST) {
      if (!FLOW_PARAMS[utilityType]) continue;
      const nets = state.utilityNetworks.get(utilityType) || [];
      for (const net of nets) {
        const perNet = computeLineOrientations(net, utilityLinesMap, {
          invertDirection: utilityType === 'vacuumPipe',
        });
        for (const [lineId, reversed] of perNet) out.set(lineId, reversed);
      }
    }
    return out;
  }

  /**
   * Update the draw-mode preview polyline. Called every frame, so it rebuilds
   * only when the preview actually changed: a run-wiring drag produces ~5
   * points per stub, so a 20-quad FODO run is ~100 segments and rebuilding
   * that per rAF is real GC churn for a stationary cursor.
   */
  setPreview(preview, parentGroup) {
    const sig = preview && preview.path && preview.path.length
      ? preview.utilityType + '|' + preview.valid + '|' +
        (preview.waterCircuit || '-') + '|' +
        (Number.isFinite(preview.routeHeightMeters)
          ? preview.routeHeightMeters.toFixed(3) : 'default') + '|' +
        preview.path.map(p => `${p.col},${p.row},${p.subCol ?? 0},${p.subRow ?? 0}`).join(';') + '|'
        + (preview.cablePath || []).map(p => `${p.col},${p.row}`).join(';') + '|'
        + (preview.endpointTransitions === false ? 'flat|' : 'drops|')
        + (preview.rack ? 'rack|' : preview.busLane ? 'bus-lane|' : 'line|')
        + [preview.startAnchor, preview.endAnchor]
          .map(a => a ? `${a.x},${a.y},${a.z}` : '-').join('|')
      : null;
    if (sig === this._previewSig) return false;
    this._previewSig = sig;

    if (this._previewObject) {
      parentGroup.remove(this._previewObject);
      this._disposeObject(this._previewObject);
      this._previewObject = null;
    }
    const obj = buildPreviewLine(preview);
    if (obj) {
      parentGroup.add(obj);
      this._previewObject = obj;
    }
    return true;
  }

  /** Update the hover-port marker. Call every frame. */
  setHoverPort(hoverPort, parentGroup) {
    const key = hoverPort?.busTap
      ? `bus:${hoverPort.busId}`
      : hoverPort?.tap
      ? `tap:${hoverPort.lineId}`
      : hoverPort ? `${hoverPort.placeableId}:${hoverPort.portName}` : null;
    const cached = key ? this._anchorByKey.get(key) : null;
    const resolved = cached ? {
      ...hoverPort,
      anchor: cached.anchor,
      waterCircuit: hoverPort.waterCircuit || cached.waterCircuit,
    } : hoverPort;
    const point = resolved?.anchor || resolved?.worldPos || resolved;
    const sig = key
      ? `${key}|${point?.x ?? ''},${point?.y ?? ''},${point?.z ?? ''}|${resolved?.routeHeightMeters ?? ''}|${resolved?.waterCircuit ?? ''}`
      : null;
    if (sig === this._hoverSig) return false;
    this._hoverSig = sig;
    if (this._hoverObject) {
      parentGroup.remove(this._hoverObject);
      this._disposeObject(this._hoverObject);
      this._hoverObject = null;
    }
    const obj = buildHoverMarker(resolved);
    if (obj) {
      parentGroup.add(obj);
      this._hoverObject = obj;
    }
    return true;
  }

  /**
   * Render port indicators for all available ports of the current utility
   * type so the player can see where to click. Pass `null` for utilityType
   * (or an empty placeables list) to clear.
   *
   * @param {string|null} utilityType
   * @param {Array} placeables state.placeables
   * @param {Map} utilityLines state.utilityLines (used to skip claimed ports)
   * @param {{placeableId, portName}|null} hoverPort currently-snapped port
   * @param {{placeableId, portName}|null} drawStart start-anchor (skip its marker)
   * @param {THREE.Group} parentGroup
   * @param {'cold'|'hot'|null} selectedWaterCircuit palette-selected Water Line variant
   */
  setAvailablePorts(
    utilityType, placeables, utilityLines, hoverPort, drawStart, parentGroup,
    selectedWaterCircuit = null,
  ) {
    // Clear old markers.
    if (this._portMarkerGroup) {
      parentGroup.remove(this._portMarkerGroup);
      this._disposeGroup(this._portMarkerGroup);
      this._portMarkerGroup = null;
    }
    this._anchorByKey.clear();
    if (!utilityType || !placeables || !placeables.length) return;
    const group = new THREE.Group();
    group.userData = { isUtilityPortMarkers: true };
    const desc = UTILITY_TYPES[utilityType];
    const hoverKey = hoverPort
      ? `${hoverPort.placeableId}:${hoverPort.portName}`
      : null;
    const startKey = drawStart
      ? `${drawStart.placeableId}:${drawStart.portName}`
      : null;
    for (const placeable of placeables) {
      const def = COMPONENTS[placeable.type];
      if (!def || !def.ports) continue;
      const avail = availablePortsFor(placeable, def, utilityType, utilityLines);
      for (const name of avail) {
        const waterCircuit = portWaterCircuit(def.ports[name]);
        if (selectedWaterCircuit && waterCircuit
            && waterCircuit !== selectedWaterCircuit) continue;
        const key = `${placeable.id}:${name}`;
        const anchor = portAnchor3D(placeable, def, name);
        if (!anchor) continue;
        const color = markerColorFor(desc, waterCircuit);
        // Cached for setHoverPort, which is handed a port identity by the
        // controller and has no endpoint record of its own to resolve against.
        this._anchorByKey.set(key, { anchor, waterCircuit });
        if (key === startKey) continue; // don't show indicator on start anchor
        const marker = buildPortMarker(anchor, color, key === hoverKey);
        group.add(marker);
      }
    }
    parentGroup.add(group);
    this._portMarkerGroup = group;
  }

  /**
   * Render one exclamation marker per unhealthy sink port.
   *
   * @param {Array<{placeableId,portName,utilityType,waterCircuit,severity,x,y,z}>} marks
   *        world positions resolved by the caller (this builder only draws).
   * @param {THREE.Group} parentGroup
   *
   * Signature-guarded: the caller may hand the same set every tick and only
   * a changed set costs a rebuild. Returns true when it rebuilt.
   */
  setUtilityPortIssueMarkers(marks, parentGroup) {
    const list = marks || [];
    const sig = list.map(m => `${m.placeableId}:${m.portName}:${m.utilityType}:${m.waterCircuit || '-'}:${m.severity}:`
      + `${m.x.toFixed(2)},${(m.y || 0).toFixed(2)},${m.z.toFixed(2)}`).join(';');
    if (sig === this._issueSig && this._issueGroup) return false;
    this._issueSig = sig;
    if (this._issueGroup) {
      parentGroup.remove(this._issueGroup);
      this._disposeGroup(this._issueGroup);
      this._issueGroup = null;
    }
    if (list.length === 0) return true;
    const group = new THREE.Group();
    group.userData = { isUtilityPortIssueMarkers: true };
    for (const m of list) group.add(buildUtilityPortIssueMarker(m));
    parentGroup.add(group);
    this._issueGroup = group;
    return true;
  }

  /**
   * Breathe the marker emissive so the glyphs read as an alert rather than as
   * more scenery. Touches at most one material per utility/severity pair and
   * only while markers exist, so it is safe on the per-frame path.
   */
  pulseUtilityPortIssueMarkers(timeMs) {
    if (!this._issueGroup) return;
    const k = 0.82 + 0.36 * (0.5 + 0.5 * Math.sin(timeMs * 0.005));
    for (const mat of _issueMatCache.values()) {
      mat.emissiveIntensity = (mat.userData.issueEmissiveBase || 0.5) * k;
    }
  }


  dispose(parentGroup) {
    for (const g of this._lineGroups.values()) {
      parentGroup.remove(g);
      this._disposeGroup(g);
    }
    this._lineGroups.clear();
    this._lineHashes.clear();
    for (const group of this._busGroups.values()) {
      parentGroup.remove(group);
      this._disposeGroup(group);
    }
    this._busGroups.clear();
    this._busHashes.clear();
    if (this._rigidSupportGroup) {
      parentGroup.remove(this._rigidSupportGroup);
      this._disposeGroup(this._rigidSupportGroup);
      this._rigidSupportGroup = null;
    }
    this._rigidSupportHash = null;
    this._relaxations.clear();
    this._dragCableStates.clear();
    this._dragLineIds.clear();
    this._draggedPlaceableId = null;
    this._hasBuiltOnce = false;
    if (this._previewObject) {
      parentGroup.remove(this._previewObject);
      this._disposeObject(this._previewObject);
      this._previewObject = null;
    }
    // Must clear with the object: a stale key would make the next identical
    // preview a cache hit and render nothing.
    this._previewSig = null;
    if (this._hoverObject) {
      parentGroup.remove(this._hoverObject);
      this._disposeObject(this._hoverObject);
      this._hoverObject = null;
    }
    this._hoverSig = null;
    if (this._portMarkerGroup) {
      parentGroup.remove(this._portMarkerGroup);
      this._disposeGroup(this._portMarkerGroup);
      this._portMarkerGroup = null;
    }
    if (this._issueGroup) {
      // Markers live in their own scene group, not parentGroup — remove from
      // whichever parent actually holds them.
      this._issueGroup.parent?.remove(this._issueGroup);
      this._disposeGroup(this._issueGroup);
      this._issueGroup = null;
      this._issueSig = null;
    }
  }

  _hashLine(line, placeablesById) {
    // Path + endpoints + utility type. Include port world positions in the
    // hash so the line rebuilds when a connected placeable is moved.
    const pathStr = (line.path || []).map(p => `${p.col},${p.row}`).join(';');
    const routeHeightStr = Number.isFinite(line.routeHeightMeters)
      ? line.routeHeightMeters.toFixed(3) : 'default';
    const waterCircuitStr = line.waterCircuit || '-';
    const cableStr = (line.cablePath || []).map(p => `${p.col},${p.row}`).join(';');
    const tapStr = `${line.tapLineIds?.start || '-'}:${line.tapLineIds?.end || '-'}`;
    // Explicit "open" marker distinguishes a null endpoint (dangling) from
    // an unresolved port lookup — both used to collide on "".
    let startStr = line.start ? '?' : 'open';
    let endStr = line.end ? '?' : 'open';
    // Anchor, not just footprint position: the riser geometry depends on the
    // port's HEIGHT too, so a line must rebuild when that changes (a rotated
    // device, or an anchor that resolved once model bounds were measured).
    if (line.start && placeablesById) {
      const sp = placeablesById.get(line.start.placeableId);
      if (sp) {
        const a = portAnchor3D(sp, COMPONENTS[sp.type], line.start.portName);
        if (a) startStr = `${a.x.toFixed(3)},${a.y.toFixed(3)},${a.z.toFixed(3)}`;
      }
    }
    if (line.end && placeablesById) {
      const ep = placeablesById.get(line.end.placeableId);
      if (ep) {
        const a = portAnchor3D(ep, COMPONENTS[ep.type], line.end.portName);
        if (a) endStr = `${a.x.toFixed(3)},${a.y.toFixed(3)},${a.z.toFixed(3)}`;
      }
    }
    const manifoldStr = line.manifold
      ? `${line.manifold.type || '-'}:${line.manifold.trayFamily || '-'}:`
        + (line.manifold.taps || []).map(t => `${t.point?.col},${t.point?.row},${t.point?.subCol},${t.point?.subRow}`).join(';')
      : '-';
    return `${line.utilityType}|${waterCircuitStr}|${routeHeightStr}|${pathStr}|${cableStr}|${tapStr}|${manifoldStr}|${startStr}|${endStr}`;
  }

  _disposeGroup(group) {
    if (!group) return;
    group.traverse(obj => {
      if (obj.isMesh) {
        if (obj.geometry) obj.geometry.dispose();
        // Cached materials (tagged __shared) are reused across builds and
        // must survive; anything else is owned by this group.
        const m = obj.material;
        if (m && !m.userData?.__shared) m.dispose();
      }
    });
  }

  // Preview / hover teardown. These objects are Groups (buildPreviewLine)
  // or Meshes (buildHoverMarker); traverse() visits the object itself, so
  // _disposeGroup covers both — a bare `obj.geometry` check would silently
  // skip every child of a Group and leak one geometry set per frame while
  // the preview is visible.
  _disposeObject(obj) {
    this._disposeGroup(obj);
  }
}

export default UtilityLineBuilderV2;
