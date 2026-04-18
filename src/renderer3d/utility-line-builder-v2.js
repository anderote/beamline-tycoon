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
import { UTILITY_TYPES, UTILITY_TYPE_LIST } from '../utility/registry.js';
import { discoverNetworks, makeDefaultPortLookup } from '../utility/network-discovery.js';

const PIPE_Y = 0.5;  // default line centerline height above ground
const SEGS = 12;     // cylinder radial segments

// Material cache keyed by (utilityType, errorStatus) — 'ok' | 'soft' | 'hard'.
// Keeps identical materials shared across lines for the same descriptor+state.
const _matCache = new Map();
const _jacketMatCache = new Map();

function matKey(utilityType, errorStatus) {
  return `${utilityType}|${errorStatus || 'ok'}`;
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
  _matCache.set(key, mat);
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
  _jacketMatCache.set(key, mat);
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
  // Pin first point to start port world position.
  if (line.start && placeablesById) {
    const sp = placeablesById.get(line.start.placeableId);
    if (sp) {
      const def = COMPONENTS[sp.type];
      const wp = portWorldPosition(sp, def, line.start.portName);
      if (wp) points[0] = new THREE.Vector3(wp.x, PIPE_Y, wp.z);
    }
  }
  // Pin last point to end port world position.
  if (line.end && placeablesById && points.length > 0) {
    const ep = placeablesById.get(line.end.placeableId);
    if (ep) {
      const def = COMPONENTS[ep.type];
      const wp = portWorldPosition(ep, def, line.end.portName);
      if (wp) points[points.length - 1] = new THREE.Vector3(wp.x, PIPE_Y, wp.z);
    }
  }
  return points;
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
  const openCapMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: new THREE.Color(descriptor.color || '#ffffff'),
    emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.2,
    transparent: true, opacity: 0.9,
  });
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
  _previewMatCache.set(utilityType, mat);
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
// When a utility-line tool is armed (selectedUtilityLineTool !== null), render
// a small colored sphere at every available port of that utility type, so the
// player can see where to click. The sphere at the cursor-nearest port gets
// brightened (larger + higher emissive) as hover feedback. Spheres for the
// starting-port (once draw has begun) are omitted since they aren't valid
// endpoints anyway.

function buildPortMarker(worldPos, color, brightened) {
  const r = brightened ? 0.22 : 0.13;
  const intensity = brightened ? 1.0 : 0.55;
  const geo = new THREE.SphereGeometry(r, 12, 10);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    emissive: new THREE.Color(color),
    emissiveIntensity: intensity,
    transparent: true,
    opacity: brightened ? 0.95 : 0.8,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(worldPos.x, PIPE_Y + 0.3, worldPos.z);
  mesh.renderOrder = 999;
  mesh.userData = { isUtilityPortMarker: true };
  return mesh;
}

// Back-compat: hover marker wraps the brightened variant.
function buildHoverMarker(hoverPort) {
  if (!hoverPort || !hoverPort.worldPos) return null;
  const descriptor = hoverPort.utilityType ? UTILITY_TYPES[hoverPort.utilityType] : null;
  const color = descriptor?.color || '#ffff88';
  return buildPortMarker(hoverPort.worldPos, color, true);
}

// --- Main builder -------------------------------------------------------

export class UtilityLineBuilderV2 {
  constructor() {
    // line.id → Group. Rebuilt on utilityLinesChanged; reused when unchanged.
    this._lineGroups = new Map();
    // (line.id → hash string) to detect path/descriptor changes.
    this._lineHashes = new Map();
    // Preview / hover layers — rebuilt every frame they're visible.
    this._previewObject = null;
    this._hoverObject = null;
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
    const errorByLineId = opts.state ? this._buildErrorMap(opts.state, lines) : new Map();
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
   * Build a lineId → 'ok' | 'soft' | 'hard' map. For each utility type we
   * run network discovery once, then map flow errors to member line ids.
   * Used to drive emissive glow on utility lines during error conditions.
   */
  _buildErrorMap(state, utilityLines) {
    const out = new Map();
    if (!state || !state.utilityNetworkData || typeof state.utilityNetworkData.get !== 'function') {
      return out;
    }
    let lookup = null;
    for (const utilityType of UTILITY_TYPE_LIST) {
      const perType = state.utilityNetworkData.get(utilityType);
      if (!perType || perType.size === 0) continue;
      if (!lookup) lookup = makeDefaultPortLookup(state);
      const nets = discoverNetworks(utilityType, utilityLines, lookup);
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

  /** Update the draw-mode preview polyline. Call every frame. */
  setPreview(preview, parentGroup) {
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
  }

  /** Update the hover-port marker. Call every frame. */
  setHoverPort(hoverPort, parentGroup) {
    if (this._hoverObject) {
      parentGroup.remove(this._hoverObject);
      this._disposeObject(this._hoverObject);
      this._hoverObject = null;
    }
    const obj = buildHoverMarker(hoverPort);
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
        if (key === startKey) continue; // don't show indicator on start anchor
        const wp = portWorldPosition(placeable, def, name);
        if (!wp) continue;
        const marker = buildPortMarker(wp, color, key === hoverKey);
        group.add(marker);
      }
    }
    parentGroup.add(group);
    this._portMarkerGroup = group;
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
  }

  _hashLine(line, placeablesById) {
    // Path + endpoints + utility type. Include port world positions in the
    // hash so the line rebuilds when a connected placeable is moved.
    const pathStr = (line.path || []).map(p => `${p.col},${p.row}`).join(';');
    // Explicit "open" marker distinguishes a null endpoint (dangling) from
    // an unresolved port lookup — both used to collide on "".
    let startStr = line.start ? '?' : 'open';
    let endStr = line.end ? '?' : 'open';
    if (line.start && placeablesById) {
      const sp = placeablesById.get(line.start.placeableId);
      if (sp) {
        const wp = portWorldPosition(sp, COMPONENTS[sp.type], line.start.portName);
        if (wp) startStr = `${wp.x.toFixed(3)},${wp.z.toFixed(3)}`;
      }
    }
    if (line.end && placeablesById) {
      const ep = placeablesById.get(line.end.placeableId);
      if (ep) {
        const wp = portWorldPosition(ep, COMPONENTS[ep.type], line.end.portName);
        if (wp) endStr = `${wp.x.toFixed(3)},${wp.z.toFixed(3)}`;
      }
    }
    return `${line.utilityType}|${pathStr}|${startStr}|${endStr}`;
  }

  _disposeGroup(group) {
    if (!group) return;
    group.traverse(obj => {
      if (obj.isMesh) {
        if (obj.geometry) obj.geometry.dispose();
        // Materials are cached and shared across lines — do NOT dispose them.
      }
    });
  }

  _disposeObject(obj) {
    if (!obj) return;
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) obj.material.dispose();
  }
}

export default UtilityLineBuilderV2;
