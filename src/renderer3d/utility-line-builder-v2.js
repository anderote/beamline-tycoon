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
import { UTILITY_TYPES, UTILITY_TYPE_LIST } from '../utility/registry.js';
import { UTILITY_LINE_Y } from '../utility/line-geometry.js';

// Line centerline height above ground. Owned by line-geometry because it is
// also the plane the utility TOOL has to pick against: the cursor is projected
// onto the ground at y=0, so a tool that draws at 0.5 m and picks at 0 m puts
// its geometry a fixed 15-25 px up-screen of the mouse under the iso camera.
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

function getLineMaterial(utilityType, errorStatus) {
  const key = matKey(utilityType, errorStatus);
  if (_matCache.has(key)) return _matCache.get(key);
  const descriptor = UTILITY_TYPES[utilityType];
  const color = descriptor?.color || '#ffffff';
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.4,
    metalness: 0.3,
  });
  if (errorStatus === 'hard') {
    mat.emissive = new THREE.Color(0xff2222);
    mat.emissiveIntensity = 0.7;
  } else if (errorStatus === 'soft') {
    mat.emissive = new THREE.Color(0xffaa22);
    mat.emissiveIntensity = 0.5;
  }
  _matCache.set(key, shared(mat));
  return mat;
}

function getJacketMaterial(utilityType, errorStatus) {
  const key = matKey(utilityType, errorStatus);
  if (_jacketMatCache.has(key)) return _jacketMatCache.get(key);
  const descriptor = UTILITY_TYPES[utilityType];
  const color = descriptor?.color || '#ffffff';
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.5, metalness: 0.1,
    transparent: true, opacity: 0.35,
  });
  if (errorStatus === 'hard') {
    mat.emissive = new THREE.Color(0xff2222);
    mat.emissiveIntensity = 0.6;
  } else if (errorStatus === 'soft') {
    mat.emissive = new THREE.Color(0xffaa22);
    mat.emissiveIntensity = 0.4;
  }
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
  for (const pt of path) {
    const w = tileToWorld(pt);
    points.push(new THREE.Vector3(w.x, PIPE_Y, w.z));
  }
  // Pin each anchored end to its port and give it a riser: the run stays at
  // PIPE_Y until it is under the port, then climbs the device and steps out
  // into the connector. Without this the cable stopped half a metre off the
  // floor beside the equipment, which is what made wiring look like annotation
  // rather than plumbing.
  const startRiser = portRiser(line.start, placeablesById);
  if (startRiser) points.splice(0, 1, ...startRiser.slice().reverse());
  const endRiser = portRiser(line.end, placeablesById);
  if (endRiser && points.length > 0) points.splice(points.length - 1, 1, ...endRiser);
  return points;
}

// The 3-point tail that takes a cable from the run height into a port's
// connector: under the port at PIPE_Y → up to the anchor → out along the port's
// normal. Ordered run-first; the start end reverses it.
function portRiser(ref, placeablesById) {
  if (!ref || !placeablesById) return null;
  const rec = placeablesById.get(ref.placeableId);
  if (!rec) return null;
  const def = COMPONENTS[rec.type];
  const anchor = portAnchor3D(rec, def, ref.portName);
  if (!anchor) return null;
  const out = anchor.out || { x: 0, z: 0 };
  const d = anchor.standoff || 0;
  const tail = [new THREE.Vector3(anchor.x, PIPE_Y, anchor.z)];
  if (Math.abs(anchor.y - PIPE_Y) > 1e-6) {
    tail.push(new THREE.Vector3(anchor.x, anchor.y, anchor.z));
  }
  if (d > 0) {
    tail.push(new THREE.Vector3(anchor.x + out.x * d, anchor.y, anchor.z + out.z * d));
  }
  return tail;
}

// One cylinder segment between two 3D points. Orients along the segment.
function buildCylinderSegment(p0, p1, radius, material) {
  const dir = new THREE.Vector3().subVectors(p1, p0);
  const len = dir.length();
  if (len < 1e-4) return null;
  const geo = new THREE.CylinderGeometry(radius, radius, len, SEGS);
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
function buildRectSegment(p0, p1, width, height, material) {
  const dir = new THREE.Vector3().subVectors(p1, p0);
  const len = dir.length();
  if (len < 1e-4) return null;
  // Orient the long axis along +z of the box then rotate it to match dir.
  const geo = new THREE.BoxGeometry(width, height, len);
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

function buildLineGroup(line, placeablesById, errorStatus) {
  const descriptor = UTILITY_TYPES[line.utilityType];
  if (!descriptor) return null;
  const points = buildWorldPoints(line, placeablesById);
  if (points.length < 2) return null;

  const group = new THREE.Group();
  group.userData = { lineId: line.id, utilityType: line.utilityType, errorStatus: errorStatus || 'ok' };
  const radius = descriptor.pipeRadiusMeters || 0.04;
  const mat = getLineMaterial(line.utilityType, errorStatus);
  const style = descriptor.geometryStyle || 'cylinder';

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    let mesh = null;
    if (style === 'rectWaveguide') {
      mesh = buildRectSegment(a, b, radius * 2, radius * 1.4, mat);
    } else if (style === 'jacketedCylinder') {
      // Inner opaque cylinder + translucent outer jacket.
      mesh = buildCylinderSegment(a, b, radius, mat);
      const jacketMat = getJacketMaterial(line.utilityType, errorStatus);
      const jacket = buildCylinderSegment(a, b, radius * 1.6, jacketMat);
      if (jacket) group.add(jacket);
    } else {
      mesh = buildCylinderSegment(a, b, radius, mat);
    }
    if (mesh) group.add(mesh);
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
  const points = preview.path.map(p => {
    const w = tileToWorld(p);
    return new THREE.Vector3(w.x, PIPE_Y, w.z);
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
  const color = descriptor?.color || '#ffff88';
  // Tapping a trunk and grabbing a port are different commitments — one makes
  // a T-join on an existing run, the other claims a connector — so they must
  // not look alike. A ring around the line reads as "join here".
  if (hoverPort.tap) return buildTapMarker(hoverPort.worldPos, color);
  const anchor = hoverPort.anchor || { ...hoverPort.worldPos, y: PIPE_Y + 0.3 };
  return buildPortMarker(anchor, color, true);
}

function buildTapMarker(worldPos, color) {
  const geo = new THREE.TorusGeometry(PORT_DOT_R_HOVER, PORT_DOT_R_HOVER * 0.28, 6, 14);
  const mesh = new THREE.Mesh(geo, getPortMarkerMaterial(color, true));
  mesh.position.set(worldPos.x, PIPE_Y, worldPos.z);
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
    const iter = typeof lines.values === 'function' ? lines.values() : lines;
    for (const line of iter) {
      if (!line || !line.id) continue;
      seen.add(line.id);
      const errorStatus = errorByLineId.get(line.id) || 'ok';
      const hash = this._hashLine(line, placeablesById) + '|' + errorStatus;
      const prevHash = this._lineHashes.get(line.id);
      if (prevHash === hash && this._lineGroups.has(line.id)) continue;
      // Rebuild: remove old, add new.
      const old = this._lineGroups.get(line.id);
      if (old) {
        parentGroup.remove(old);
        this._disposeGroup(old);
      }
      const group = buildLineGroup(line, placeablesById, errorStatus);
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
    const color = desc?.color || '#ffff88';
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
