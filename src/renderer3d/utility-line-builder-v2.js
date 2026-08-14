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
import { buildFloorGlowStrip } from './floor-glow.js';

// DEFAULT line centerline height. Per-utility heights come from
// utilityLineHeight (registry): a power cord lies on the floor while a vacuum
// pipe rides at working height. Owned by line-geometry because the height is
// also the plane the utility TOOL has to pick against — the cursor is
// projected onto the ground at y=0, so a tool that draws at 0.5 m and picks at
// 0 m puts its geometry a fixed 15-25 px up-screen of the mouse under the iso
// camera. Kept here for the marker fallbacks, which are not per-line.
const PIPE_Y = UTILITY_LINE_Y;
const SEGS = 12;     // cylinder radial segments

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

// Build 3D points for a line's polyline, with endpoints pinned to port world
// positions. Returns an array of THREE.Vector3.
function buildWorldPoints(line, placeablesById) {
  const points = [];
  const path = line.path || [];
  if (path.length === 0) return points;
  const runY = utilityLineHeight(line.utilityType);
  for (const pt of path) {
    const w = tileToWorld(pt);
    points.push(new THREE.Vector3(w.x, runY, w.z));
  }
  // Pin each anchored end to its port and give it a riser: the run stays at its
  // own height until it is under the port, then climbs the device and steps out
  // into the connector. Without this the cable stopped short beside the
  // equipment, which is what made wiring look like annotation rather than
  // plumbing — and with a floor-level cable the riser IS the drop from the
  // machine down to the deck.
  const startRiser = portRiser(line.start, placeablesById, runY);
  if (startRiser) points.splice(0, 1, ...startRiser.slice().reverse());
  const endRiser = portRiser(line.end, placeablesById, runY);
  if (endRiser && points.length > 0) points.splice(points.length - 1, 1, ...endRiser);
  return points;
}

// The 3-point tail that takes a cable from its run height into a port's
// connector: under the port at runY → up to the anchor → out along the port's
// normal. Ordered run-first; the start end reverses it.
function portRiser(ref, placeablesById, runY) {
  if (!ref || !placeablesById) return null;
  const rec = placeablesById.get(ref.placeableId);
  if (!rec) return null;
  const def = COMPONENTS[rec.type];
  const anchor = portAnchor3D(rec, def, ref.portName);
  if (!anchor) return null;
  const out = anchor.out || { x: 0, z: 0 };
  const d = anchor.standoff || 0;
  const tail = [new THREE.Vector3(anchor.x, runY, anchor.z)];
  if (Math.abs(anchor.y - runY) > 1e-6) {
    tail.push(new THREE.Vector3(anchor.x, anchor.y, anchor.z));
  }
  if (d > 0) {
    tail.push(new THREE.Vector3(anchor.x + out.x * d, anchor.y, anchor.z + out.z * d));
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
    emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.2,
    transparent: true, opacity: 0.9,
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

function buildLineGroup(line, placeablesById, errorStatus, reversed) {
  const descriptor = UTILITY_TYPES[line.utilityType];
  if (!descriptor) return null;
  const points = buildWorldPoints(line, placeablesById);
  if (points.length < 2) return null;

  const group = new THREE.Group();
  group.userData = { lineId: line.id, utilityType: line.utilityType, errorStatus: errorStatus || 'ok' };
  const radius = descriptor.pipeRadiusMeters || 0.04;
  const mat = getLineMaterial(line.utilityType, errorStatus);
  const style = descriptor.geometryStyle || 'cylinder';
  // Only meshes carrying a flow-patched material need to bloom. Every current
  // utility has one; retaining the guard keeps a future intentionally inert
  // descriptor from entering the bloom pass.
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
  for (let i = 0; i < points.length - 1; i++) {
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
  for (let i = 1; i < points.length - 1; i++) {
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
      new THREE.SphereGeometry(radius * 2.0, 12, 10),
      openCapMat,
    );
    cap.position.copy(points[0]);
    group.add(cap);
  }
  if (!line.end && points.length > 0) {
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 2.0, 12, 10),
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

  // Floor glow: a painted pool of light on the deck beneath the run (see
  // floor-glow.js — pipes can't cast real light along their length). Built
  // from the SAME `points`, reversed the SAME way `reversed` already reverses
  // the pipe's own baked run-distance above, so the pool travels source ->
  // sink in lockstep with the pulses on the pipe it sits under rather than
  // drifting out of orientation. Lives in this line's own group, so it is
  // disposed with the line exactly like the fault mark above; returns null
  // for a hard-faulted run or any future intentionally non-flowing utility.
  const floorPoints = reversed ? points.slice().reverse() : points;
  const floorGlow = buildFloorGlowStrip(floorPoints, line.utilityType, errorStatus);
  if (floorGlow) group.add(floorGlow);

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
  const points = preview.path.map(p => {
    const w = tileToWorld(p);
    return new THREE.Vector3(w.x, previewY, w.z);
  });
  const group = new THREE.Group();
  group.userData = { isUtilityLinePreview: true };
  const radius = (descriptor.pipeRadiusMeters || 0.04) * 1.1; // slightly chunkier so it reads
  const style = descriptor.geometryStyle || 'cylinder';
  const mat = getPreviewMaterial(preview.utilityType);
  for (let i = 0; i < points.length - 1; i++) {
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
  for (const p of points) {
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
      // Rebuild: remove old, add new.
      const old = this._lineGroups.get(line.id);
      if (old) {
        parentGroup.remove(old);
        this._disposeGroup(old);
      }
      const group = buildLineGroup(line, placeablesById, errorStatus, reversed);
      if (group) {
        parentGroup.add(group);
        this._lineGroups.set(line.id, group);
        this._lineHashes.set(line.id, hash);
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
      }
    }
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
   * Vacuum is the deliberate inverse: its solver source is the pump, while
   * the visible gas load moves from chambers toward the pump. Rooting the walk
   * at the pump and flipping its answer keeps every branch converging even in
   * a many-chamber manifold.
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
      ? preview.type + '|' + preview.valid + '|' +
        preview.path.map(p => `${p.col},${p.row},${p.subCol ?? 0},${p.subRow ?? 0}`).join(';')
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
    return `${line.utilityType}|${pathStr}|${startStr}|${endStr}`;
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
