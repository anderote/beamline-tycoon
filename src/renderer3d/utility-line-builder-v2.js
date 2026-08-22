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
import { universalBusLane } from '../utility/universal-bus-layout.js';
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
const UNIVERSAL_BUS_DECK_Y = 0.70;
const UNIVERSAL_BUS_HALF_WIDTH = 0.36;

// Material cache keyed by (utilityType, errorStatus) — 'ok' | 'soft' | 'hard'.
// Keeps identical materials shared across lines for the same descriptor+state.
const _matCache = new Map();
const _jacketMatCache = new Map();
const _hardwareMatCache = new Map();
let _utilitySupportMaterial = null;
let _universalBusMaterial = null;
const _universalBusPreviewMaterials = new Map();

function matKey(utilityType, errorStatus) {
  return `${utilityType}|${errorStatus || 'ok'}`;
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
      const rail = buildRectSegment(
        new THREE.Vector3(a.x + ox * side, a.y + 0.06, a.z + oz * side),
        new THREE.Vector3(b.x + ox * side, b.y + 0.06, b.z + oz * side),
        0.06, 0.16, material,
      );
      if (rail) group.add(rail);
    }
    const rungCount = Math.max(1, Math.floor(length));
    for (let rung = 0; rung <= rungCount; rung++) {
      const t = rung / rungCount;
      const x = a.x + dx * t, z = a.z + dz * t;
      const crossbar = buildRectSegment(
        new THREE.Vector3(x - ox * 1.25, a.y, z - oz * 1.25),
        new THREE.Vector3(x + ox * 1.25, a.y, z + oz * 1.25),
        0.055, 0.045, material,
      );
      if (crossbar) group.add(crossbar);
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
export function getLineMaterial(utilityType, errorStatus) {
  const flowState = errorStatus || 'ok';
  const key = matKey(utilityType, flowState);
  if (_matCache.has(key)) return _matCache.get(key);
  const descriptor = UTILITY_TYPES[utilityType];
  const color = descriptor?.color || '#ffffff';
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.4,
    metalness: 0.3,
  });
  if (FLOW_PARAMS[utilityType]) patchFlowMaterial(mat, utilityType, flowState);
  _matCache.set(key, shared(mat));
  return mat;
}

// Same status-gated flow as getLineMaterial, applied to the jacket too — a
// cryo line frosts on the OUTSIDE, so the jacket carrying its own baseGlow
// (rather than just standing between the viewer and the core's) is the
// physically-grounded read, and see buildLineGroup's BLOOM_LAYER handling for
// why the jacket has to bloom too or it occludes the core it's wrapping.
function getJacketMaterial(utilityType, errorStatus) {
  const flowState = errorStatus || 'ok';
  const key = matKey(utilityType, flowState);
  if (_jacketMatCache.has(key)) return _jacketMatCache.get(key);
  const descriptor = UTILITY_TYPES[utilityType];
  const color = descriptor?.color || '#ffffff';
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.5, metalness: 0.1,
    transparent: true, opacity: 0.35,
  });
  if (FLOW_PARAMS[utilityType]) patchFlowMaterial(mat, utilityType, flowState);
  _jacketMatCache.set(key, shared(mat));
  return mat;
}

// Elbow flanges and guide collars are hardware, not flowing contents. Keeping
// them on a separate metallic material makes every joint legible even when the
// service body is dark or carrying an emissive flow pulse.
function getLineHardwareMaterial(utilityType) {
  if (_hardwareMatCache.has(utilityType)) return _hardwareMatCache.get(utilityType);
  const color = utilityType === 'vacuumPipe' ? '#c4c9cc'
    : utilityType === 'rfWaveguide' ? '#b9783f'
      : (UTILITY_TYPES[utilityType]?.color || '#aaaaaa');
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.26,
    metalness: 0.78,
  });
  _hardwareMatCache.set(utilityType, shared(mat));
  return mat;
}

function getUtilitySupportMaterial() {
  if (_utilitySupportMaterial) return _utilitySupportMaterial;
  _utilitySupportMaterial = shared(new THREE.MeshStandardMaterial({
    color: 0x465158,
    roughness: 0.42,
    metalness: 0.72,
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

/** HV spans shed drawn slack when either end is held by tensioning hardware. */
export function isTensionedHvCable(line, placeablesById) {
  if (line?.utilityType !== 'hvCable') return false;
  if (line.tensioned === true) return true;
  if (!placeablesById) return false;
  return [line.start, line.end].some(ref => {
    const endpoint = ref ? placeablesById.get(ref.placeableId) : null;
    return isHvCableTensionAnchor(COMPONENTS[endpoint?.type]);
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
  alignTerminalToTarget(points, 'start', startAnchor);
  alignTerminalToTarget(points, 'end', endAnchor);

  // At each end the floor run reaches the connector's X/Z, climbs the device,
  // and steps out into its fitting. Two-point legacy lines cannot slide a
  // corner without moving their opposite endpoint, so portRiser retains its
  // orthogonal boundary bridge as a narrow fallback for that one shape.
  const startRunPoint = points[0];
  const endRunPoint = points[points.length - 1];
  const startRiser = line.start
    ? portRiser(line.start, placeablesById, runY, startRunPoint, startAnchor)
    : busTapRiser(tapAnchors?.start, runY, startRunPoint);
  if (startRiser) points.splice(0, 1, ...startRiser.slice().reverse());
  const endRiser = line.end
    ? portRiser(line.end, placeablesById, runY, endRunPoint, endAnchor)
    : busTapRiser(tapAnchors?.end, runY, endRunPoint);
  if (endRiser && points.length > 0) points.splice(points.length - 1, 1, ...endRiser);
  return points;
}

// The rack's logical tap is an open line endpoint, but its visible socket is
// raised above the tray. Give rigid branches the same orthogonal rise that a
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
function portRiser(ref, placeablesById, runY, runPoint, resolvedAnchor) {
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

function buildServiceFitting(point, direction, descriptor, material) {
  if (!point || !direction || !descriptor?.fittingStyle) return null;
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

function addInlineCouplers(group, start, end, descriptor, material) {
  const spacing = descriptor?.couplerSpacingMeters;
  if (!(spacing > 0)) return;
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  if (length < spacing * 1.35) return;
  direction.normalize();
  // Centre the regular pattern on the segment so two adjacent couplers never
  // bunch against a corner flange.
  const count = Math.floor(length / spacing);
  const step = length / (count + 1);
  for (let i = 1; i <= count; i++) {
    const point = new THREE.Vector3(
      start.x + direction.x * step * i,
      start.y + direction.y * step * i,
      start.z + direction.z * step * i,
    );
    const fitting = buildServiceFitting(point, direction, descriptor, material);
    if (fitting) group.add(fitting);
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
  const bodyHalfWidth = style === 'jacketedCylinder' ? radius * 1.6 : radius;
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
  const offset = lane?.lateral ?? 0;
  const endpoint = which === 'start' ? branchPath[0] : branchPath[branchPath.length - 1];
  return {
    x: endpoint.col * 2 - dz / length * offset,
    y: lane?.portY ?? 0.95,
    z: endpoint.row * 2 + dx / length * offset,
  };
}

function buildLineGroup(
  line, placeablesById, errorStatus, reversed, pointOverride = null, joinedOpenEnds = null,
  tapAnchors = null,
) {
  const descriptor = UTILITY_TYPES[line.utilityType];
  if (!descriptor) return null;
  const busChannel = line.manifold?.type === 'universalUtilityBus';
  // A manifold is fabricated infrastructure even when its carried utility is
  // ordinarily a loose cable. Render it as a rigid, visibly heavier trunk.
  const flexible = isSoftCable(line.utilityType) && !line.manifold;
  const points = pointOverride || (flexible
    ? buildSoftCableWorldPoints(line, placeablesById, tapAnchors)
    : buildWorldPoints(line, placeablesById, tapAnchors));
  if (points.length < 2) return null;
  let busOffsetX = 0, busOffsetZ = 0;
  const busLane = busChannel ? universalBusLane(line.utilityType) : null;
  if (busChannel) {
    const offset = busLane?.lateral ?? 0;
    const first = points[0], last = points[points.length - 1];
    const dx = last.x - first.x, dz = last.z - first.z;
    const length = Math.hypot(dx, dz) || 1;
    busOffsetX = -dz / length * offset;
    busOffsetZ = dx / length * offset;
    for (const point of points) {
      point.x += busOffsetX;
      point.z += busOffsetZ;
      point.y = busLane?.runY ?? 0.79;
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
    ...(busChannel ? {
      isUniversalUtilityBus: true,
      busId: line.manifold.busId,
      channelSlot: line.manifold.slot,
      busLaneTier: busLane?.tier || null,
    } : {}),
  };
  const radius = (descriptor.pipeRadiusMeters || 0.04)
    * (busChannel ? 0.85 : line.manifold ? 2.35 : 1);
  const mat = getLineMaterial(line.utilityType, errorStatus);
  const hardwareMat = getLineHardwareMaterial(line.utilityType);
  const style = descriptor.geometryStyle || 'cylinder';
  const flow = FLOW_PARAMS[line.utilityType];
  const flowing = !!flow;
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
    ? buildFlexibleCable(points, radius, mat, reversed, runY)
    : null;
  if (flexibleMesh) {
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
    } else if (style === 'jacketedCylinder') {
      // Inner opaque cylinder + translucent outer jacket — both baked off the
      // same runDist so a flow-patched jacket stays in phase with its core.
      mesh = buildCylinderSegment(a, b, radius, mat, runDist);
      const jacketMat = getJacketMaterial(line.utilityType, errorStatus);
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
    if (descriptor.fittingStyle) addInlineCouplers(group, a, b, descriptor, hardwareMat);
  }

  if (!busChannel) {
    addUtilitySupports(
      group, points, descriptor, line.utilityType, null, line.routeHeightMeters);
  }

  // Elbows at every INTERIOR waypoint. The two terminal points are excluded on
  // purpose: they either disappear into a port fitting or carry an open-end
  // cap, and a joint there would be a bead hanging off the tip of the run. The
  // riser corners — under the port, and again where the tail steps out along
  // the port normal — are interior waypoints of this same polyline, so they get
  // their elbows from this loop with no special case.
  const jointJacketMat = style === 'jacketedCylinder'
    ? getJacketMaterial(line.utilityType, errorStatus) : null;
  for (let i = 1; !flexible && i < points.length - 1; i++) {
    const prev = points[i - 1], at = points[i], next = points[i + 1];
    const joint = buildCornerJoint(prev, at, next, style, radius, mat, descriptor);
    if (joint) group.add(joint);
    if (jointJacketMat) {
      const jacketJoint = buildCornerJoint(
        prev, at, next, style, radius * 1.6, jointJacketMat, descriptor);
      if (jacketJoint) group.add(jacketJoint);
    }
    const bend = cornerBendInfo(prev, at, next, descriptor);
    if (bend && descriptor.fittingStyle) {
      const entry = buildServiceFitting(bend.start, bend.incoming, descriptor, hardwareMat);
      const exit = buildServiceFitting(bend.end, bend.outgoing, descriptor, hardwareMat);
      if (entry) group.add(entry);
      if (exit) group.add(exit);
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
      const baseY = busChannel ? (busLane?.runY ?? 0.79) : runY;
      const portTopY = busChannel ? (busLane?.portY ?? 0.95) : runY + 0.12;
      const port = new THREE.Group();
      port.userData = {
        isUtilityManifoldTap: true,
        isUniversalUtilityBusPort: busChannel,
        utilityType: line.utilityType,
        busId: line.manifold.busId || null,
        channelSlot: line.manifold.slot ?? null,
        tapId: tap.id || null,
      };
      const stem = buildCylinderSegment(
        new THREE.Vector3(x, baseY, z),
        new THREE.Vector3(x, portTopY, z),
        Math.max(0.018, radius * 0.48), hardwareMat,
      );
      if (stem) port.add(stem);
      if (style === 'rectWaveguide') {
        const socket = new THREE.Mesh(
          new THREE.BoxGeometry(Math.max(0.1, radius * 2.5), 0.045,
            Math.max(0.075, radius * 1.9)),
          hardwareMat,
        );
        socket.position.set(x, portTopY, z);
        port.add(socket);
      } else {
        const socketRadius = Math.max(0.04, radius * 1.32);
        const socket = new THREE.Mesh(
          new THREE.CylinderGeometry(socketRadius, socketRadius, 0.04, 12),
          hardwareMat,
        );
        socket.position.set(x, portTopY, z);
        port.add(socket);
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
    const fitting = buildServiceFitting(points[index], direction, descriptor, hardwareMat);
    if (fitting) {
      fitting.userData.isUtilityTeeFitting = true;
      group.add(fitting);
    }
  }

  // The animated material is the only visible flow treatment. Publish only an
  // invisible, bounded light-proxy path for utilities that illuminate nearby
  // surfaces; VisualEffectSystem must never add travelling crest geometry or
  // projected floor circles over utility lines.
  if (flowing && flow.light !== false) {
    const effectPoints = reversed ? points.slice().reverse() : points;
    group.userData.visualEffects = [{
      id: `utility-flow:${line.id}`,
      kind: 'pathPulse',
      path: effectPoints.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      color: flow.color || descriptor.color || '#ffffff',
      speed: flow.speed,
      period: flow.period,
      crest: false,
      groundSpill: false,
      state: errorStatus || 'ok',
      light: {
        intensity: flow.lightIntensity ?? 0.16,
        distance: flow.lightDistance ?? 1.55,
        daylightFloor: flow.daylightFloor ?? 0.25,
      },
    }];
  }

  return group;
}

// --- Preview (during drag) ---------------------------------------------

// Cached translucent materials for the draw preview, keyed by utility type.
const _previewMatCache = new Map();
function getPreviewMaterial(utilityType, valid = true) {
  const key = `${utilityType}|${valid ? 'valid' : 'blocked'}`;
  if (_previewMatCache.has(key)) return _previewMatCache.get(key);
  const descriptor = UTILITY_TYPES[utilityType];
  const color = valid ? (descriptor?.color || '#ffffff') : '#ff4f38';
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
  const previewY = preview.rack ? 0.72
    : utilityLineHeight(preview.utilityType, preview.routeHeightMeters);
  const flexible = !preview.rack && !preview.manifold && isSoftCable(preview.utilityType)
    && Array.isArray(preview.cablePath) && preview.cablePath.length >= 2;
  const points = flexible
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
  if (!flexible && preview.utilityType === 'rfWaveguide'
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
    : (descriptor.pipeRadiusMeters || 0.04) * (preview.manifold ? 2.58 : 1.1);
  const style = descriptor.geometryStyle || 'cylinder';
  const mat = getPreviewMaterial(preview.utilityType, preview.valid !== false);
  const hardwareMat = getLineHardwareMaterial(preview.utilityType);
  const flexibleMesh = flexible
    ? buildFlexibleCable(points, radius, mat, false, previewY)
    : null;
  if (flexibleMesh) group.add(flexibleMesh);
  for (let i = 0; !flexibleMesh && i < points.length - 1; i++) {
    const trimmed = trimmedSegment(points, i, descriptor);
    const a = trimmed.start, b = trimmed.end;
    let mesh = null;
    if (style === 'rectWaveguide') {
      mesh = buildRectSegment(a, b, radius * 2, radius * 1.4, mat);
    } else if (style === 'fiberBundle') {
      mesh = buildFiberBundleSegment(a, b, descriptor, mat);
    } else {
      mesh = buildCylinderSegment(a, b, radius, mat);
    }
    if (mesh) group.add(mesh);
  }
  if (!flexible) {
    addUtilitySupports(
      group, points, descriptor, preview.utilityType, mat, preview.routeHeightMeters);
  }
  for (let i = 1; !flexible && i < points.length - 1; i++) {
    const prev = points[i - 1], at = points[i], next = points[i + 1];
    const joint = buildCornerJoint(prev, at, next, style, radius, mat, descriptor);
    if (joint) group.add(joint);
    const bend = cornerBendInfo(prev, at, next, descriptor);
    if (bend && descriptor.fittingStyle) {
      const entry = buildServiceFitting(bend.start, bend.incoming, descriptor, hardwareMat);
      const exit = buildServiceFitting(bend.end, bend.outgoing, descriptor, hardwareMat);
      if (entry) group.add(entry);
      if (exit) group.add(exit);
    }
  }
  // Flexible/open generic utilities keep waypoint beads for hand feedback.
  // Services with physical fittings show their actual elbows and collars
  // instead, even when their placement rules are deliberately forgiving.
  const sphereMat = mat;
  const markerPoints = flexible ? [points[0], points[points.length - 1]]
    : (descriptor.fittingStyle || descriptor.routingProfile === 'rigid'
        ? [points[0], points[points.length - 1]] : points);
  for (const p of markerPoints) {
    const sg = new THREE.SphereGeometry(radius * 1.2, 10, 8);
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
function markerColorFor(descriptor) {
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
  const color = markerColorFor(descriptor);
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
function getIssueMarkerMaterial(utilityType, severity) {
  const key = `${utilityType}|${severity}`;
  if (_issueMatCache.has(key)) return _issueMatCache.get(key);
  const descriptor = UTILITY_TYPES[utilityType];
  const portColor = markerColorFor(descriptor);
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
  const mat = getIssueMarkerMaterial(mark.utilityType, mark.severity);
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
   *        errorStatus from state.utilityNetworkData. Optional for tests.
   */
  build(utilityLines, placeablesById, parentGroup, opts = {}) {
    const seen = new Set();
    const lines = utilityLines || new Map();
    const errorByLineId = opts.state ? this._buildErrorMap(opts.state) : new Map();
    const orientationByLineId = opts.state ? this._buildOrientationMap(opts.state, lines) : new Map();
    const records = typeof lines.values === 'function' ? Array.from(lines.values()) : Array.from(lines);
    const lineById = new Map(records.map(line => [line?.id, line]));
    const installedLineIds = new Set(records.map(line => line?.id).filter(Boolean));
    for (const line of records) {
      if (!line || !line.id) continue;
      seen.add(line.id);
      const errorStatus = errorByLineId.get(line.id) || 'ok';
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
      const hash = this._hashLine(line, placeablesById) + '|' + errorStatus + '|'
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
      if (isSoftCable(line.utilityType)) {
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
            reversed,
            joinedOpenEnds,
            parentGroup,
          };
        }
      }
      const group = buildLineGroup(
        line, placeablesById, errorStatus, reversed, pointOverride, joinedOpenEnds, tapAnchors);
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
    this._buildUtilityBuses(opts.state?.utilityBuses || [], parentGroup);
    this._hasBuiltOnce = true;
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
      const y = UNIVERSAL_BUS_DECK_Y;
      for (let i = 0; i < bus.path.length - 1; i++) {
        const aw = tileToWorld(bus.path[i]), bw = tileToWorld(bus.path[i + 1]);
        const a = new THREE.Vector3(aw.x, y, aw.z);
        const b = new THREE.Vector3(bw.x, y, bw.z);
        const dx = b.x - a.x, dz = b.z - a.z;
        const length = Math.hypot(dx, dz) || 1;
        const ox = -dz / length * UNIVERSAL_BUS_HALF_WIDTH;
        const oz = dx / length * UNIVERSAL_BUS_HALF_WIDTH;
        for (const side of [-1, 1]) {
          group.add(buildRectSegment(
            new THREE.Vector3(a.x + ox * side, y + 0.06, a.z + oz * side),
            new THREE.Vector3(b.x + ox * side, y + 0.06, b.z + oz * side),
            0.06, 0.16, material,
          ));
        }
        const rungCount = Math.max(1, Math.floor(length));
        for (let rung = 0; rung <= rungCount; rung++) {
          const t = rung / rungCount;
          const x = a.x + dx * t, z = a.z + dz * t;
          group.add(buildRectSegment(
            new THREE.Vector3(x - ox * 1.04, y - 0.04, z - oz * 1.04),
            new THREE.Vector3(x + ox * 1.04, y - 0.04, z + oz * 1.04),
            0.055, 0.045, material,
          ));
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
          const rod = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.62, 0.045), material);
          rod.position.set(vertical ? w.x + lateral : w.x, 0.31,
            vertical ? w.z : w.z + lateral);
          hanger.add(rod);
          const foot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.18), material);
          foot.position.set(vertical ? w.x + lateral : w.x, 0.02,
            vertical ? w.z : w.z + lateral);
          hanger.add(foot);
        }
        const trapeze = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.045, 0.055), material);
        trapeze.position.set(w.x, 0.64, w.z);
        if (vertical) trapeze.rotation.y = Math.PI / 2;
        hanger.add(trapeze);
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
        (Number.isFinite(preview.routeHeightMeters)
          ? preview.routeHeightMeters.toFixed(3) : 'default') + '|' +
        preview.path.map(p => `${p.col},${p.row},${p.subCol ?? 0},${p.subRow ?? 0}`).join(';') + '|'
        + (preview.cablePath || []).map(p => `${p.col},${p.row}`).join(';') + '|'
        + (preview.endpointTransitions === false ? 'flat|' : 'drops|')
        + (preview.rack ? 'rack|' : 'line|')
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
    const anchor = key ? this._anchorByKey.get(key) : null;
    const resolved = anchor ? { ...hoverPort, anchor } : hoverPort;
    const point = resolved?.anchor || resolved?.worldPos || resolved;
    const sig = key
      ? `${key}|${point?.x ?? ''},${point?.y ?? ''},${point?.z ?? ''}|${resolved?.routeHeightMeters ?? ''}`
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
   */
  setAvailablePorts(utilityType, placeables, utilityLines, hoverPort, drawStart, parentGroup) {
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
    const color = markerColorFor(desc);
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
        const key = `${placeable.id}:${name}`;
        const anchor = portAnchor3D(placeable, def, name);
        if (!anchor) continue;
        // Cached for setHoverPort, which is handed a port identity by the
        // controller and has no endpoint record of its own to resolve against.
        this._anchorByKey.set(key, anchor);
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
   * @param {Array<{placeableId,portName,utilityType,severity,x,y,z}>} marks
   *        world positions resolved by the caller (this builder only draws).
   * @param {THREE.Group} parentGroup
   *
   * Signature-guarded: the caller may hand the same set every tick and only
   * a changed set costs a rebuild. Returns true when it rebuilt.
   */
  setUtilityPortIssueMarkers(marks, parentGroup) {
    const list = marks || [];
    const sig = list.map(m => `${m.placeableId}:${m.portName}:${m.utilityType}:${m.severity}:`
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
    return `${line.utilityType}|${routeHeightStr}|${pathStr}|${cableStr}|${tapStr}|${manifoldStr}|${startStr}|${endStr}`;
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
