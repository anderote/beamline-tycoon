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
import { UTILITY_LINE_Y } from '../utility/line-geometry.js';
import { FLOW_PARAMS, patchFlowMaterial, bakeRunDistanceUVs, bakeRunDistanceFromPositionZ } from './utility-flow.js';
import { BLOOM_LAYER } from './glow-pipeline.js';
import { computeLineOrientations } from '../utility/line-orientation.js';
import {
  draggedCablePath,
  isSoftCable,
  relaxedCableControlPoints,
  softCableBendRadiusMeters,
  softCableControlPoints,
} from '../utility/soft-cable.js';

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

// Material cache keyed by (utilityType, errorStatus) — 'ok' | 'soft' | 'hard'.
// Keeps identical materials shared across lines for the same descriptor+state.
const _matCache = new Map();
const _jacketMatCache = new Map();

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

// A line's colour is its UTILITY, always and only.
//
// Faults used to recolour the pipe — an amber emissive over green renders as
// solid yellow, which reads as "this is a different kind of pipe" rather than
// "this run is faulted", and the blend lands on a different hue for each of
// the six utilities so there is nothing to learn. The fault is a SYMBOL now
// (buildFaultMark, below): a red X struck over the run, one shape that means
// the same thing on every colour of pipe. Motion carries the fault instead
// (patchFlowMaterial, utility-flow.js): errorStatus selects a flowState —
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
function alignTerminalToAnchor(points, which, anchor) {
  if (!anchor || points.length < 3) return false;
  const t = which === 'start' ? 0 : points.length - 1;
  const nb = which === 'start' ? 1 : points.length - 2;
  const endpoint = points[t];
  const neighbor = points[nb];
  const dx = Math.abs(neighbor.x - endpoint.x);
  const dz = Math.abs(neighbor.z - endpoint.z);
  if (dx < 1e-6 && dz < 1e-6) return false;
  if (dx > 1e-6 && dz > 1e-6) return false;

  endpoint.x = anchor.x;
  endpoint.z = anchor.z;
  if (dx > 1e-6) neighbor.z = anchor.z;
  else neighbor.x = anchor.x;
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
  const out = anchor.out || { x: 0, z: 0 };
  const standoff = anchor.standoff || 0;
  return {
    x: anchor.x + out.x * standoff,
    y: anchor.y,
    z: anchor.z + out.z * standoff,
  };
}

/** Flexible cord/hose centreline, including true-height fitting endpoints. */
export function buildSoftCableWorldPoints(line, placeablesById, previewAnchors = null) {
  const laidTrace = Array.isArray(line.cablePath) && line.cablePath.length >= 2
    ? line.cablePath
    : line.path;
  const runY = utilityLineHeight(line.utilityType);
  const start = anchorTip(previewAnchors?.start || anchorFor(line.start, placeablesById));
  const end = anchorTip(previewAnchors?.end || anchorFor(line.end, placeablesById));
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
export function buildWorldPoints(line, placeablesById) {
  const points = [];
  const path = line.path || [];
  if (path.length === 0) return points;
  const runY = utilityLineHeight(line.utilityType);
  for (const pt of path) {
    const w = tileToWorld(pt);
    points.push(new THREE.Vector3(w.x, runY, w.z));
  }
  // New lines already route from the measured connector. Legacy lines route
  // from the logical footprint edge; collapse that old terminal detour before
  // adding the vertical riser. Three-point L routes are safe too: the shared
  // corner absorbs the start's row and the end's column (or vice versa).
  const startAnchor = anchorFor(line.start, placeablesById);
  const endAnchor = anchorFor(line.end, placeablesById);
  alignTerminalToAnchor(points, 'start', startAnchor);
  alignTerminalToAnchor(points, 'end', endAnchor);

  // At each end the floor run reaches the connector's X/Z, climbs the device,
  // and steps out into its fitting. Two-point legacy lines cannot slide a
  // corner without moving their opposite endpoint, so portRiser retains its
  // orthogonal boundary bridge as a narrow fallback for that one shape.
  const startRunPoint = points[0];
  const endRunPoint = points[points.length - 1];
  const startRiser = portRiser(line.start, placeablesById, runY, startRunPoint, startAnchor);
  if (startRiser) points.splice(0, 1, ...startRiser.slice().reverse());
  const endRiser = portRiser(line.end, placeablesById, runY, endRunPoint, endAnchor);
  if (endRiser && points.length > 0) points.splice(points.length - 1, 1, ...endRiser);
  return points;
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
  const out = anchor.out || { x: 0, z: 0 };
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
    pushDistinct(anchor.x + out.x * d, anchor.y, anchor.z + out.z * d);
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

// --- Elbows -------------------------------------------------------------
//
// Straight segments butt-joined at a waypoint leave a notch on the OUTSIDE of
// every bend and a self-overlap on the inside, which is what made the runs read
// as a chain of separate rods rather than as one pipe. Rather than mitre the
// segment ends (which would need per-corner geometry and still fails where
// three-way taps meet), we drop a joint body on the waypoint: it fills the
// notch and swallows the overlap, and at these radii that is as much elbow as
// a pipe needs to read as plumbing.

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
function buildCornerJoint(prev, at, next, style, radius, material) {
  // Done in scalars rather than through Vector3: this runs for every waypoint
  // of every line in the hall on each rebuild, and most of them turn out to be
  // collinear and bail here, so it would be three throwaway vectors per miss.
  const ix = at.x - prev.x, iy = at.y - prev.y, iz = at.z - prev.z;
  const ox = next.x - at.x, oy = next.y - at.y, oz = next.z - at.z;
  const inLen = Math.hypot(ix, iy, iz), outLen = Math.hypot(ox, oy, oz);
  if (inLen < 1e-4 || outLen < 1e-4) return null;
  const cosTurn = (ix * ox + iy * oy + iz * oz) / (inLen * outLen);
  if (cosTurn > COLLINEAR_DOT) return null;

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

// --- Fault marks --------------------------------------------------------
//
// A faulted run is struck through with an X. One symbol, drawn the same way
// over all six utility colours, which is the whole point: recolouring the pipe
// made a fault look like a different KIND of pipe, and made it look different
// on every utility. Red for a hard fault (this run is dead — unwired, cut off,
// starved), amber for a soft one (it works, but it is over capacity).
//
// Drawn flat in the ground plane, depth-test off at a high renderOrder, so it
// reads from any view rotation and nothing on the floor can hide it.

const FAULT_MARK_COLORS = { hard: '#ff3322', soft: '#ffaa22' };
const FAULT_MARK_ARM = 0.32;    // half-diagonal of the X, metres
const FAULT_MARK_BAR = 0.075;   // bar thickness

const _faultMarkMatCache = new Map();
function getFaultMarkMaterial(severity) {
  if (_faultMarkMatCache.has(severity)) return _faultMarkMatCache.get(severity);
  const color = FAULT_MARK_COLORS[severity] || FAULT_MARK_COLORS.hard;
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.85,
    roughness: 0.3, metalness: 0.0,
    transparent: true, opacity: 0.95,
    depthTest: false,
  });
  _faultMarkMatCache.set(severity, shared(mat));
  return mat;
}

/** The X itself, centred on `pos` and lying flat. */
function buildFaultMark(pos, severity) {
  const mat = getFaultMarkMaterial(severity);
  const g = new THREE.Group();
  for (const sign of [1, -1]) {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(FAULT_MARK_ARM * 2, FAULT_MARK_BAR * 0.6, FAULT_MARK_BAR),
      mat,
    );
    bar.rotation.y = sign * Math.PI / 4;
    bar.renderOrder = 1002;
    g.add(bar);
  }
  // Clear of the run it marks rather than buried in it — the pipes now lie on
  // the deck, so an X at run height would be half-swallowed by the cable.
  g.position.set(pos.x, pos.y + 0.28, pos.z);
  g.userData = { isUtilityFaultMark: true, severity };
  return g;
}

/**
 * Where to strike the X: the midpoint of the polyline BY LENGTH, so it lands
 * on the run rather than on whichever waypoint happens to be central (a path
 * with a long leg and a short one would otherwise mark the short end).
 */
function polylineMidpoint(points) {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) total += points[i].distanceTo(points[i + 1]);
  if (total === 0) return points[0];
  let walked = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const seg = points[i].distanceTo(points[i + 1]);
    if (walked + seg >= total / 2) {
      const t = seg === 0 ? 0 : (total / 2 - walked) / seg;
      return points[i].clone().lerp(points[i + 1], t);
    }
    walked += seg;
  }
  return points[points.length - 1];
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

function buildLineGroup(line, placeablesById, errorStatus, reversed, pointOverride = null) {
  const descriptor = UTILITY_TYPES[line.utilityType];
  if (!descriptor) return null;
  const flexible = isSoftCable(line.utilityType);
  const points = pointOverride || (flexible
    ? buildSoftCableWorldPoints(line, placeablesById)
    : buildWorldPoints(line, placeablesById));
  if (points.length < 2) return null;

  const group = new THREE.Group();
  group.userData = { lineId: line.id, utilityType: line.utilityType, errorStatus: errorStatus || 'ok' };
  const radius = descriptor.pipeRadiusMeters || 0.04;
  const mat = getLineMaterial(line.utilityType, errorStatus);
  const style = descriptor.geometryStyle || 'cylinder';
  // Only meshes carrying a flow-patched material need to bloom — an untagged
  // (vacuumPipe) run stays off BLOOM_LAYER and the darken pass leaves it
  // exactly as inert as it looks.
  const flowing = !!FLOW_PARAMS[line.utilityType];

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
    ? buildFlexibleCable(points, radius, mat, reversed, utilityLineHeight(line.utilityType))
    : null;
  if (flexibleMesh) {
    if (flowing) flexibleMesh.layers.enable(BLOOM_LAYER);
    group.add(flexibleMesh);
  }
  for (let i = 0; !flexibleMesh && i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
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
        if (flowing) jacket.layers.enable(BLOOM_LAYER);
        group.add(jacket);
      }
    } else {
      mesh = buildCylinderSegment(a, b, radius, mat, runDist);
    }
    if (mesh) {
      if (flowing) mesh.layers.enable(BLOOM_LAYER);
      group.add(mesh);
    }
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
    const joint = buildCornerJoint(prev, at, next, style, radius, mat);
    if (joint) group.add(joint);
    if (jointJacketMat) {
      const jacketJoint = buildCornerJoint(
        prev, at, next, style, radius * 1.6, jointJacketMat);
      if (jacketJoint) group.add(jacketJoint);
    }
  }

  // Open-end indicators: a small contrasting disc at any endpoint that
  // isn't anchored to a port. Signals "this side isn't wired up yet."
  const openCapMat = getOpenCapMaterial(line.utilityType);
  if (!line.start && points.length > 0) {
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.35, 10, 8),
      openCapMat,
    );
    cap.position.copy(points[0]);
    group.add(cap);
  }
  if (!line.end && points.length > 0) {
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.35, 10, 8),
      openCapMat,
    );
    cap.position.copy(points[points.length - 1]);
    group.add(cap);
  }

  // Struck through when its network is faulted. Lives in the line's own group,
  // so it is created, rebuilt and disposed with the line — the hash already
  // carries errorStatus, so a status change rebuilds and the X appears or
  // clears with no separate refresh path.
  if (errorStatus && errorStatus !== 'ok') {
    group.add(buildFaultMark(polylineMidpoint(points), errorStatus));
  }

  // Publish effect INTENT only. VisualEffectSystem owns the scalable drawing
  // strategy (instanced crest + optional pooled real light), so this geometry
  // builder never allocates lights or effect meshes. Utility crests explicitly
  // skip projected floor circles: the cable itself is the visible source and
  // its bounded real-light proxy supplies any nearby surface response.
  if (flowing) {
    const effectPoints = reversed ? points.slice().reverse() : points;
    const flow = FLOW_PARAMS[line.utilityType];
    group.userData.visualEffects = [{
      id: `utility-flow:${line.id}`,
      kind: 'pathPulse',
      path: effectPoints.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      color: flow.color || descriptor.color || '#ffffff',
      speed: flow.speed,
      period: flow.period,
      radius: Math.max(0.040, radius * (style === 'rectWaveguide' ? 1.10 : 1.30)),
      groundSpill: false,
      state: errorStatus || 'ok',
      light: {
        intensity: line.utilityType === 'rfWaveguide' ? 0.26 : 0.16,
        distance: line.utilityType === 'rfWaveguide' ? 2.0 : 1.55,
        daylightFloor: 0.25,
      },
    }];
  }

  return group;
}

// --- Preview (during drag) ---------------------------------------------

// Cached translucent materials for the draw preview, keyed by utility type.
const _previewMatCache = new Map();
function getPreviewMaterial(utilityType) {
  if (_previewMatCache.has(utilityType)) return _previewMatCache.get(utilityType);
  const descriptor = UTILITY_TYPES[utilityType];
  const color = descriptor?.color || '#ffffff';
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.3, metalness: 0.1,
    transparent: true, opacity: 0.55,
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.35,
  });
  _previewMatCache.set(utilityType, shared(mat));
  return mat;
}

function buildPreviewLine(preview) {
  if (!preview || !Array.isArray(preview.path) || preview.path.length < 2) return null;
  const descriptor = UTILITY_TYPES[preview.utilityType];
  if (!descriptor) return null;
  const previewY = utilityLineHeight(preview.utilityType);
  const flexible = isSoftCable(preview.utilityType)
    && Array.isArray(preview.cablePath) && preview.cablePath.length >= 2;
  const points = flexible
    ? buildSoftCableWorldPoints({
        utilityType: preview.utilityType,
        path: preview.path,
        cablePath: preview.cablePath,
        start: null,
        end: null,
      }, null, { start: preview.startAnchor, end: preview.endAnchor })
    : preview.path.map(p => {
        const w = tileToWorld(p);
        return new THREE.Vector3(w.x, previewY, w.z);
      });
  const group = new THREE.Group();
  group.userData = { isUtilityLinePreview: true };
  const radius = (descriptor.pipeRadiusMeters || 0.04) * 1.1; // slightly chunkier so it reads
  const style = descriptor.geometryStyle || 'cylinder';
  const mat = getPreviewMaterial(preview.utilityType);
  const flexibleMesh = flexible
    ? buildFlexibleCable(points, radius, mat, false, previewY)
    : null;
  if (flexibleMesh) group.add(flexibleMesh);
  for (let i = 0; !flexibleMesh && i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    let mesh = null;
    if (style === 'rectWaveguide') {
      mesh = buildRectSegment(a, b, radius * 2, radius * 1.4, mat);
    } else {
      mesh = buildCylinderSegment(a, b, radius, mat);
    }
    if (mesh) group.add(mesh);
  }
  // Little spheres at waypoints to emphasize the polyline.
  const sphereMat = mat;
  for (const p of flexible ? [points[0], points[points.length - 1]] : points) {
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
  const out = anchor.out || { x: 0, z: 0 };
  const d = (anchor.standoff || 0) + r;
  mesh.position.set(
    anchor.x + out.x * d,
    anchor.y != null ? anchor.y : PIPE_Y + 0.3,
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
    return buildTapMarker(hoverPort.worldPos, color, utilityLineHeight(hoverPort.utilityType));
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

// --- Unwired-sink markers ----------------------------------------------
//
// A component that declares a hard-required sink and has nothing wired to it
// trips the beam (utility-gate HARD_REQUIRED_UTILS). Most such components are
// role:'placement' modules living inside a pipe — a quadrupole with no cooling
// looks exactly like the wired quadrupole next to it, and a FODO cell holds a
// dozen of them. The marker must therefore read at normal zoom without hover:
// a utility-coloured chevron floating above the offending port on a stem, all
// drawn depthTest-off at a high renderOrder so pipe/building geometry can't
// hide it.
//
// Sized as a map pin, not as scenery: at a metre and a half the stems read as
// part of the facility and a wired-up hall turns into a forest of them, so the
// pin sits just clear of the equipment it marks and the chevron is small enough
// that a dozen of them still leave the machines legible.

// How far the chevron floats above the port it is complaining about. The pin
// hangs off the PORT's anchor now, not off a fixed height over the tile, so a
// tall cabinet's pin clears the cabinet and a floor pump's pin sits low.
const UNWIRED_MARK_RISE = 0.7;

const _unwiredMatCache = new Map();
function getUnwiredMarkerMaterial(color) {
  if (_unwiredMatCache.has(color)) return _unwiredMatCache.get(color);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.9,
    roughness: 0.25, metalness: 0.1,
    transparent: true, opacity: 0.95,
    depthTest: false,
  });
  _unwiredMatCache.set(color, shared(mat));
  return mat;
}

// One marker: a down-pointing cone over a thin stem that lands on the port.
function buildUnwiredMarker(mark) {
  const descriptor = UTILITY_TYPES[mark.utilityType];
  const color = descriptor?.color || '#ff4444';
  const mat = getUnwiredMarkerMaterial(color);
  const g = new THREE.Group();

  const footY = Number.isFinite(mark.y) ? mark.y : PIPE_Y;
  const tipY = footY + UNWIRED_MARK_RISE;

  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.26, 6), mat);
  cone.rotation.x = Math.PI;               // apex down, at the stem top
  cone.position.set(0, tipY + 0.13, 0);
  cone.renderOrder = 1001;
  g.add(cone);

  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, UNWIRED_MARK_RISE, 6), mat);
  stem.position.set(0, (tipY + footY) / 2, 0);
  stem.renderOrder = 1001;
  g.add(stem);

  g.position.set(mark.x, 0, mark.z);
  g.userData = { isUnwiredSinkMarker: true, placeableId: mark.id, utilityType: mark.utilityType };
  return g;
}

// --- Main builder -------------------------------------------------------

export class UtilityLineBuilderV2 {
  constructor() {
    // line.id → Group. Rebuilt on utilityLinesChanged; reused when unchanged.
    this._lineGroups = new Map();
    // (line.id → hash string) to detect path/descriptor changes.
    this._lineHashes = new Map();
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
    // `${placeableId}:${portName}` → portAnchor3D, filled by setAvailablePorts
    // and read by setHoverPort (which is given an identity, not a record).
    this._anchorByKey = new Map();
    // Unwired-sink markers + the signature that guards their rebuild.
    this._unwiredGroup = null;
    this._unwiredSig = null;
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
    const iter = typeof lines.values === 'function' ? lines.values() : lines;
    for (const line of iter) {
      if (!line || !line.id) continue;
      seen.add(line.id);
      const errorStatus = errorByLineId.get(line.id) || 'ok';
      // Draw order (line.start -> line.end) isn't necessarily source -> sink
      // — computeLineOrientations resolves that from network topology.
      // Included in the hash: rewiring a network (a new source appearing, a
      // tap moving) has to rebuild every line whose orientation flips, same
      // as errorStatus already does for fault transitions.
      const reversed = orientationByLineId.get(line.id) || false;
      const hash = this._hashLine(line, placeablesById) + '|' + errorStatus + '|' + (reversed ? 'rev' : 'fwd');
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
      if (isSoftCable(line.utilityType)) {
        const initialPoints = buildSoftCableWorldPoints(line, placeablesById);
        const floorY = utilityLineHeight(line.utilityType);
        const bendRadius = softCableBendRadiusMeters(line.utilityType);
        const finalPoints = relaxedCableControlPoints(initialPoints, {
          floorY,
          bendStiffness: 0.08 + Math.min(0.08, bendRadius * 0.1),
        }).map(point => new THREE.Vector3(point.x, point.y, point.z));
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
        const animate = !dragAnimate && this._hasBuiltOnce && isNewLine
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
            parentGroup,
          };
        }
      }
      const group = buildLineGroup(
        line, placeablesById, errorStatus, reversed, pointOverride);
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
    this._hasBuiltOnce = true;
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

      // Rebuild once at rest so fault marks and declarative path effects use
      // the final centreline too. Shared materials survive the replacement.
      state.parentGroup.remove(group);
      this._disposeGroup(group);
      const replacement = buildLineGroup(
        state.line,
        state.placeablesById,
        state.errorStatus,
        state.reversed,
        state.finalPoints,
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
        preview.path.map(p => `${p.col},${p.row},${p.subCol ?? 0},${p.subRow ?? 0}`).join(';') + '|'
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
    if (this._hoverObject) {
      parentGroup.remove(this._hoverObject);
      this._disposeObject(this._hoverObject);
      this._hoverObject = null;
    }
    const key = hoverPort ? `${hoverPort.placeableId}:${hoverPort.portName}` : null;
    const obj = buildHoverMarker(
      key && this._anchorByKey.has(key)
        ? { ...hoverPort, anchor: this._anchorByKey.get(key) }
        : hoverPort);
    if (obj) {
      parentGroup.add(obj);
      this._hoverObject = obj;
    }
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
   * Render one marker per unwired declared sink.
   *
   * @param {Array<{id,portName,utilityType,x,z}>} marks world positions of the
   *        offending ports, as resolved by the caller (the renderer owns the
   *        endpoint lookup; this builder only draws).
   * @param {THREE.Group} parentGroup
   *
   * Signature-guarded: the caller may hand the same set every tick and only
   * a changed set costs a rebuild. Returns true when it rebuilt.
   */
  setUnwiredSinkMarkers(marks, parentGroup) {
    const list = marks || [];
    const sig = list.map(m => `${m.id}:${m.portName}:${m.utilityType}:`
      + `${m.x.toFixed(2)},${(m.y || 0).toFixed(2)},${m.z.toFixed(2)}`).join(';');
    if (sig === this._unwiredSig && this._unwiredGroup) return false;
    this._unwiredSig = sig;
    if (this._unwiredGroup) {
      parentGroup.remove(this._unwiredGroup);
      this._disposeGroup(this._unwiredGroup);
      this._unwiredGroup = null;
    }
    if (list.length === 0) return true;
    const group = new THREE.Group();
    group.userData = { isUnwiredSinkMarkers: true };
    for (const m of list) group.add(buildUnwiredMarker(m));
    parentGroup.add(group);
    this._unwiredGroup = group;
    return true;
  }

  /**
   * Breathe the marker emissive so the chevrons read as an alert rather than
   * as more scenery. Touches at most one material per utility colour and only
   * while markers exist, so it is safe on the per-frame path.
   */
  pulseUnwiredMarkers(timeMs) {
    if (!this._unwiredGroup) return;
    const k = 0.6 + 0.6 * (0.5 + 0.5 * Math.sin(timeMs * 0.005));
    for (const mat of _unwiredMatCache.values()) mat.emissiveIntensity = k;
  }


  dispose(parentGroup) {
    for (const g of this._lineGroups.values()) {
      parentGroup.remove(g);
      this._disposeGroup(g);
    }
    this._lineGroups.clear();
    this._lineHashes.clear();
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
    if (this._portMarkerGroup) {
      parentGroup.remove(this._portMarkerGroup);
      this._disposeGroup(this._portMarkerGroup);
      this._portMarkerGroup = null;
    }
    if (this._unwiredGroup) {
      // Markers live in their own scene group, not parentGroup — remove from
      // whichever parent actually holds them.
      this._unwiredGroup.parent?.remove(this._unwiredGroup);
      this._disposeGroup(this._unwiredGroup);
      this._unwiredGroup = null;
      this._unwiredSig = null;
    }
  }

  _hashLine(line, placeablesById) {
    // Path + endpoints + utility type. Include port world positions in the
    // hash so the line rebuilds when a connected placeable is moved.
    const pathStr = (line.path || []).map(p => `${p.col},${p.row}`).join(';');
    const cableStr = (line.cablePath || []).map(p => `${p.col},${p.row}`).join(';');
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
    return `${line.utilityType}|${pathStr}|${cableStr}|${startStr}|${endStr}`;
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
