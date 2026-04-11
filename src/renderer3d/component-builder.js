// src/renderer3d/component-builder.js
// Builds Three.js meshes for beamline components from world snapshot data.
// THREE is a CDN global — do NOT import it.

import { COMPONENTS } from '../data/components.js';

const SUB_UNIT = 0.5; // 1 sub-unit = 0.5m in world space
const SEGS = 16;      // cylinder segment count for smooth round shapes

// ── Standard beamline geometry constants ─────────────────────────────
// All components share these so the beam pipe looks continuous when
// components are placed end-to-end.
const BEAM_HEIGHT  = 1.0;   // beam axis height above floor (m) — industry standard ~1m
const PIPE_R       = 0.08;  // beam pipe outer radius (~6.3" OD, typical small-bore vacuum pipe)
const FLANGE_R     = 0.16;  // CF flange radius (~2× pipe radius)
const FLANGE_H     = 0.045; // flange thickness
const PIPE_COLOR   = 0x99aabb;  // stainless steel blue-gray
const FLANGE_COLOR = 0xbbbbbb;  // bright steel
const STAND_COLOR  = 0x555555;  // dark gray support structure

// ── Shared materials (created lazily) ────────────────────────────────

const _matCache = new Map();

function _mat(color, roughness = 0.5, metalness = 0.3) {
  const key = `${color}-${roughness}-${metalness}`;
  if (!_matCache.has(key)) {
    _matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  }
  return _matCache.get(key).clone();
}

// ── Role-based material system ───────────────────────────────────────
// Detail builders that use the new template pattern return meshes
// bucketed into one of these roles. Each role maps to a shared material
// (or a per-color cached material for 'accent').

const ROLES = /** @type {const} */ (['accent', 'iron', 'copper', 'pipe', 'stand', 'detail']);

// Paint-on-iron for the accent role. The color is overridden per beamline;
// this base exists only to be cloned.
const ACCENT_BASE_ROUGHNESS = 0.6;
const ACCENT_BASE_METALNESS = 0.12;

const SHARED_MATERIALS = {
  iron:   new THREE.MeshStandardMaterial({ color: 0x2b2d35, roughness: 0.5,  metalness: 0.4 }),
  copper: new THREE.MeshStandardMaterial({ color: 0xd4721a, roughness: 0.4,  metalness: 0.5 }),
  pipe:   new THREE.MeshStandardMaterial({ color: PIPE_COLOR,  roughness: 0.3,  metalness: 0.5 }),
  stand:  new THREE.MeshStandardMaterial({ color: STAND_COLOR, roughness: 0.7,  metalness: 0.1 }),
  // 'detail' pieces each decide their own material at build time — bolts
  // use a dark steel, small coil rings use copper. We store the bolt one
  // here because it's the most common detail material.
  detail: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7,  metalness: 0.3 }),
};

/** Cache of (componentType + '|' + colorHex) -> MeshStandardMaterial */
const _accentMatCache = new Map();

/**
 * Get or create a painted-metal material for a given component type at a
 * given accent color. Cached so that all placements of the same type on
 * the same beamline share one material instance.
 *
 * The `compType` is part of the key so future components can tweak
 * roughness/metalness per type without affecting others.
 */
function getAccentMaterial(compType, colorHex) {
  const key = compType + '|' + colorHex.toString(16);
  let m = _accentMatCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: colorHex,
      roughness: ACCENT_BASE_ROUGHNESS,
      metalness: ACCENT_BASE_METALNESS,
    });
    _accentMatCache.set(key, m);
  }
  return m;
}

function _addShadow(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Merge a list of non-indexed BufferGeometries with matching attributes into
 * a single BufferGeometry. Only handles `position` and `normal` attributes
 * (all the primitives we use — Box/Cylinder/Torus/Plane — expose these).
 *
 * Each input geometry is consumed: we assume the caller has already applied
 * any world-space transform via `.applyMatrix4()`. The result is a fresh
 * non-indexed BufferGeometry owning its own buffers.
 *
 * @param {THREE.BufferGeometry[]} geometries
 * @returns {THREE.BufferGeometry}
 */
function _mergeGeometries(geometries) {
  if (geometries.length === 0) {
    return new THREE.BufferGeometry();
  }

  // First pass — make sure every input is non-indexed so we can concat directly.
  const flat = geometries.map(g => g.index ? g.toNonIndexed() : g);

  // Sum sizes.
  let posCount = 0;
  let normCount = 0;
  for (const g of flat) {
    posCount += g.attributes.position.array.length;
    const na = g.attributes.normal;
    if (na) normCount += na.array.length;
  }

  const positions = new Float32Array(posCount);
  const allHaveNormals = flat.every(g => g.attributes.normal);
  const normals = allHaveNormals ? new Float32Array(normCount) : null;

  let posOff = 0;
  let normOff = 0;
  for (const g of flat) {
    positions.set(g.attributes.position.array, posOff);
    posOff += g.attributes.position.array.length;
    if (normals) {
      normals.set(g.attributes.normal.array, normOff);
      normOff += g.attributes.normal.array.length;
    }
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (normals) {
    merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  } else {
    merged.computeVertexNormals();
  }
  return merged;
}

// ── Detailed geometry builders ───────────────────────────────────────
// Each returns a THREE.Group whose local origin is centered at the
// component's footprint center, Y=0 at floor level.
// Beam travels along +Z in local space (rotated later by direction).

function _buildSource() {
  const group = new THREE.Group();
  const bodyColor = 0x557755;   // dark steel-green gun housing
  const insulatorColor = 0xcc8833; // HV insulator (ceramic amber)

  // Main gun housing — centered so beam exit aligns with BEAM_HEIGHT
  const bodyW = 0.9, bodyH = 0.9, bodyL = 1.2;
  const bodyY = BEAM_HEIGHT; // center of body at beam height
  const body = _addShadow(new THREE.Mesh(
    new THREE.BoxGeometry(bodyW, bodyH, bodyL),
    _mat(bodyColor, 0.6, 0.2),
  ));
  body.position.set(0, bodyY, -0.15);
  group.add(body);

  // HV insulator dome on top — a squat cylinder
  const insR = 0.25, insH = 0.3;
  const insulator = _addShadow(new THREE.Mesh(
    new THREE.CylinderGeometry(insR * 0.6, insR, insH, SEGS),
    _mat(insulatorColor, 0.4, 0.05),
  ));
  insulator.position.set(0, bodyY + bodyH / 2 + insH / 2, -0.3);
  group.add(insulator);

  // Beam exit port — standard pipe extending from front face to tile edge
  const portEnd = 1.0; // tile edge
  const portStart = bodyL / 2 - 0.15;
  const portL = portEnd - portStart;
  const port = _addShadow(new THREE.Mesh(
    new THREE.CylinderGeometry(PIPE_R, PIPE_R, portL, SEGS),
    _mat(PIPE_COLOR, 0.3, 0.5),
  ));
  port.rotation.x = Math.PI / 2;
  port.position.set(0, BEAM_HEIGHT, (portStart + portEnd) / 2);
  group.add(port);

  // Flange ring at beam exit — at tile edge so it meets adjacent pipe
  const flange = _addShadow(new THREE.Mesh(
    new THREE.CylinderGeometry(FLANGE_R, FLANGE_R, FLANGE_H, SEGS),
    _mat(FLANGE_COLOR, 0.3, 0.5),
  ));
  flange.rotation.x = Math.PI / 2;
  flange.position.set(0, BEAM_HEIGHT, portEnd);
  group.add(flange);

  // Support legs — four posts under the gun body (one at each corner)
  const legW = 0.08, legH = bodyY - bodyH / 2;
  for (const xOff of [-bodyW / 2 + legW, bodyW / 2 - legW]) {
    for (const zOff of [-0.35, 0.25]) {
      const leg = _addShadow(new THREE.Mesh(
        new THREE.BoxGeometry(legW, legH, legW),
        _mat(STAND_COLOR, 0.7, 0.1),
      ));
      leg.position.set(xOff, legH / 2, zOff);
      group.add(leg);
    }
  }

  // Beam travels along -Z in world space for dir=0 (NE), so flip the model
  // so the beam exit faces -Z instead of +Z.
  group.rotation.y = Math.PI;

  return group;
}

function _buildDrift() {
  const group = new THREE.Group();

  const pipeL = 2.0; // full tile length so adjacent pipes meet flush

  // Main vacuum pipe — standard bore at standard height
  const pipe = _addShadow(new THREE.Mesh(
    new THREE.CylinderGeometry(PIPE_R, PIPE_R, pipeL, SEGS),
    _mat(PIPE_COLOR, 0.3, 0.5),
  ));
  pipe.rotation.x = Math.PI / 2;
  pipe.position.set(0, BEAM_HEIGHT, 0);
  group.add(pipe);

  // CF flanges at each end with bolt holes and bore opening
  for (const sign of [-1, 1]) {
    const flange = _addShadow(new THREE.Mesh(
      new THREE.CylinderGeometry(FLANGE_R, FLANGE_R, FLANGE_H, SEGS),
      _mat(FLANGE_COLOR, 0.3, 0.6),
    ));
    flange.rotation.x = Math.PI / 2;
    flange.position.set(0, BEAM_HEIGHT, sign * pipeL / 2);
    group.add(flange);

    // Dark bore opening on flange face — makes pipe look hollow
    const bore = new THREE.Mesh(
      new THREE.CircleGeometry(PIPE_R * 0.85, SEGS),
      _mat(0x111111, 0.9, 0.0),
    );
    // CircleGeometry faces +Z; flip for -Z end
    if (sign < 0) bore.rotation.y = Math.PI;
    bore.position.set(0, BEAM_HEIGHT, sign * (pipeL / 2 + FLANGE_H / 2 + 0.001));
    bore.userData.lod = 'detail';
    group.add(bore);

    _addBoltHoles(group, 0, BEAM_HEIGHT, sign * pipeL / 2, sign);
  }

  // Support stands — two per tile, each with two legs, foot plate, and crossbars
  _addBeamSupport(group, -0.45); // front support
  _addBeamSupport(group,  0.45); // rear support

  return group;
}

/**
 * Add bolt hole details on a CF flange face.
 * Small dark cylinders arranged in a circle on the flange surface.
 */
function _addBoltHoles(group, x, y, z, sign) {
  const boltCount = 6;
  const boltR = 0.012;
  const boltDepth = 0.02;
  const boltCircleR = (PIPE_R + FLANGE_R) / 2; // midway between pipe and flange edge
  const boltMat = _mat(0x333333, 0.8, 0.2);

  for (let i = 0; i < boltCount; i++) {
    const angle = (i / boltCount) * Math.PI * 2;
    const bx = x + Math.cos(angle) * boltCircleR;
    const by = y + Math.sin(angle) * boltCircleR;
    const bolt = new THREE.Mesh(
      new THREE.CylinderGeometry(boltR, boltR, boltDepth, 6),
      boltMat,
    );
    bolt.rotation.x = Math.PI / 2;
    bolt.position.set(bx, by, z + sign * (FLANGE_H / 2 + 0.001));
    bolt.userData.lod = 'detail'; // only visible when zoomed in
    group.add(bolt);
  }
}

/**
 * Add a realistic beam pipe support at a given Z offset.
 * Two vertical legs extend from floor to above the pipe, with a top crossbar
 * sitting just above the pipe (not intersecting it) and a lower brace near the floor.
 */
function _addBeamSupport(group, zPos) {
  const legW = 0.04;          // leg cross-section
  const legSpacing = 0.28;    // distance between legs (wider than pipe diameter)
  const topOfPipe = BEAM_HEIGHT + PIPE_R;
  const barH = 0.03;          // crossbar thickness
  const barD = 0.04;          // crossbar depth along beam axis
  const legH = topOfPipe + barH; // legs reach up to underside of top crossbar
  const barW = legSpacing + legW; // crossbar spans between leg outsides

  // Two vertical legs — full height from floor to top crossbar
  for (const side of [-1, 1]) {
    const leg = _addShadow(new THREE.Mesh(
      new THREE.BoxGeometry(legW, legH, legW),
      _mat(STAND_COLOR, 0.7, 0.1),
    ));
    leg.position.set(side * legSpacing / 2, legH / 2, zPos);
    group.add(leg);
  }

  // Top crossbar — sits just above the pipe
  const topBar = _addShadow(new THREE.Mesh(
    new THREE.BoxGeometry(barW, barH, barD),
    _mat(STAND_COLOR, 0.7, 0.1),
  ));
  topBar.position.set(0, topOfPipe + barH / 2, zPos);
  group.add(topBar);

  // Bottom crossbar — sits just below the pipe
  const bottomBar = _addShadow(new THREE.Mesh(
    new THREE.BoxGeometry(barW, barH, barD),
    _mat(STAND_COLOR, 0.7, 0.1),
  ));
  bottomBar.position.set(0, BEAM_HEIGHT - PIPE_R - barH / 2, zPos);
  group.add(bottomBar);

  // Lower brace (near floor)
  const lowerBar = _addShadow(new THREE.Mesh(
    new THREE.BoxGeometry(barW, barH, barD),
    _mat(STAND_COLOR, 0.7, 0.1),
  ));
  lowerBar.position.set(0, 0.08, zPos);
  group.add(lowerBar);

  // Small foot plate
  const footW = legSpacing + legW + 0.04;
  const foot = _addShadow(new THREE.Mesh(
    new THREE.BoxGeometry(footW, 0.02, 0.08),
    _mat(STAND_COLOR, 0.7, 0.1),
  ));
  foot.position.set(0, 0.01, zPos);
  group.add(foot);
}

function _buildPillboxCavity() {
  const group = new THREE.Group();
  const cavityColor = 0xbb6633;  // copper

  // Central pillbox — short wide cylinder (the resonant cavity cell)
  const cellR = 0.35, cellL = 0.4;
  const cell = _addShadow(new THREE.Mesh(
    new THREE.CylinderGeometry(cellR, cellR, cellL, SEGS),
    _mat(cavityColor, 0.35, 0.5),
  ));
  cell.rotation.x = Math.PI / 2;
  cell.position.set(0, BEAM_HEIGHT, 0);
  group.add(cell);

  // End caps — slightly wider rings to show the cavity boundary
  for (const sign of [-1, 1]) {
    const cap = _addShadow(new THREE.Mesh(
      new THREE.CylinderGeometry(cellR + 0.03, cellR + 0.03, 0.03, SEGS),
      _mat(0x995522, 0.3, 0.6),
    ));
    cap.rotation.x = Math.PI / 2;
    cap.position.set(0, BEAM_HEIGHT, sign * cellL / 2);
    group.add(cap);
  }

  // Beam pipe stubs in/out — extend to tile edge (±1.0) for flush connection
  const tileEdge = 1.0;
  for (const sign of [-1, 1]) {
    const stubStart = cellL / 2;
    const stubL = tileEdge - stubStart;
    const stub = _addShadow(new THREE.Mesh(
      new THREE.CylinderGeometry(PIPE_R, PIPE_R, stubL, SEGS),
      _mat(PIPE_COLOR, 0.3, 0.5),
    ));
    stub.rotation.x = Math.PI / 2;
    stub.position.set(0, BEAM_HEIGHT, sign * (stubStart + stubL / 2));
    group.add(stub);

    // Standard CF flanges at tile edge
    const flange = _addShadow(new THREE.Mesh(
      new THREE.CylinderGeometry(FLANGE_R, FLANGE_R, FLANGE_H, SEGS),
      _mat(FLANGE_COLOR, 0.3, 0.6),
    ));
    flange.rotation.x = Math.PI / 2;
    flange.position.set(0, BEAM_HEIGHT, sign * tileEdge);
    group.add(flange);
  }

  // RF coupler port on top — a small cylinder stub pointing upward
  const couplerR = 0.08, couplerH = 0.25;
  const coupler = _addShadow(new THREE.Mesh(
    new THREE.CylinderGeometry(couplerR, couplerR, couplerH, SEGS),
    _mat(cavityColor, 0.35, 0.5),
  ));
  coupler.position.set(0, BEAM_HEIGHT + cellR + couplerH / 2, 0);
  group.add(coupler);

  // Coupler flange
  const cFlange = _addShadow(new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.14, 0.03, SEGS),
    _mat(FLANGE_COLOR, 0.3, 0.6),
  ));
  cFlange.position.set(0, BEAM_HEIGHT + cellR + couplerH, 0);
  group.add(cFlange);

  // Support stands — two-leg style with crossbars
  _addBeamSupport(group, -cellL / 2 + 0.05);
  _addBeamSupport(group,  cellL / 2 - 0.05);

  return group;
}

// Registry: component type id → builder function
const DETAIL_BUILDERS = {
  source: _buildSource,
  drift: _buildDrift,
  pillboxCavity: _buildPillboxCavity,
};

/**
 * Create a transparent ghost version of a beamline component for placement preview.
 * Returns a THREE.Group with all meshes set to transparent + green edge wireframe.
 */
export function createBeamlineGhost(compType) {
  const compDef = COMPONENTS[compType];
  if (!compDef) return null;

  const builder = DETAIL_BUILDERS[compDef.id];
  let group;
  if (builder) {
    group = builder();
  } else {
    // Fallback box/cylinder
    const w = (compDef.subW || 2) * SUB_UNIT;
    const h = (compDef.subH || 2) * SUB_UNIT;
    const l = (compDef.subL || 2) * SUB_UNIT;
    let geometry;
    if (compDef.geometryType === 'cylinder') {
      const radius = Math.min(w, h) / 2;
      geometry = new THREE.CylinderGeometry(radius, radius, l, 8);
      geometry.rotateZ(Math.PI / 2);
    } else {
      geometry = new THREE.BoxGeometry(w, h, l);
    }
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x888888 }));
    group = new THREE.Group();
    group.add(mesh);
  }

  // Collect meshes first (avoid mutating group during traversal)
  const meshes = [];
  group.traverse((child) => {
    if (child.isMesh) meshes.push(child);
  });

  // Make all meshes transparent and add green wireframe edges
  for (const child of meshes) {
    child.material = child.material.clone();
    child.material.transparent = true;
    child.material.opacity = 0.3;
    child.material.depthWrite = false;
    const wiremat = new THREE.MeshBasicMaterial({
      color: 0x44ff44,
      wireframe: true,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    const wire = new THREE.Mesh(child.geometry, wiremat);
    wire.position.copy(child.position);
    wire.rotation.copy(child.rotation);
    wire.scale.copy(child.scale);
    group.add(wire);
  }

  return group;
}

// ── Thumbnail renderer ──────────────────────────────────────────────
// Renders a small preview image of a 3D component for use in the build menu.
// Uses a temporary WebGL context that is disposed after rendering to avoid
// exhausting the browser's context limit.

const _thumbCache = new Map();

/**
 * Render a component's 3D model to a data URL thumbnail.
 * Returns null if the component has no detailed 3D model.
 */
export function renderComponentThumbnail(compType, size = 64) {
  if (typeof THREE === 'undefined') return null;
  if (_thumbCache.has(compType)) return _thumbCache.get(compType);

  const compDef = COMPONENTS[compType];
  if (!compDef) return null;
  const builder = DETAIL_BUILDERS[compDef.id || compType];
  if (!builder) return null;

  // Create a temporary renderer, render, then dispose immediately
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(size * 2, size * 2);

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(3, 5, 2);
  scene.add(dirLight);

  const model = builder();
  scene.add(model);

  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const bSize = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(bSize.x, bSize.y, bSize.z);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
  const dist = maxDim * 2.2;
  camera.position.set(
    center.x + dist * 0.7,
    center.y + dist * 0.6,
    center.z + dist * 0.7,
  );
  camera.lookAt(center);

  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL('image/png');
  _thumbCache.set(compType, dataUrl);

  // Clean up everything
  model.traverse((child) => {
    if (child.isMesh) {
      child.geometry.dispose();
      child.material.dispose();
    }
  });
  renderer.dispose();

  return dataUrl;
}

// ── ComponentBuilder class ───────────────────────────────────────────

export class ComponentBuilder {
  constructor() {
    // Map from component id -> THREE.Group or THREE.Mesh
    this._meshMap = new Map();
  }

  /**
   * Create a fallback mesh for components without a detail builder.
   */
  _createFallbackMesh(compDef) {
    const w = (compDef.subW || 2) * SUB_UNIT;
    const h = (compDef.subH || 2) * SUB_UNIT;
    const l = (compDef.subL || 2) * SUB_UNIT;

    let geometry;
    if (compDef.geometryType === 'cylinder') {
      const radius = Math.min(w, h) / 2;
      geometry = new THREE.CylinderGeometry(radius, radius, l, 8);
      geometry.rotateZ(Math.PI / 2);
    } else {
      geometry = new THREE.BoxGeometry(w, h, l);
    }

    const color = compDef.spriteColor !== undefined ? compDef.spriteColor : 0x888888;
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.7,
      metalness: 0.1,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  /**
   * Create the 3D object (Group or Mesh) for a given component type.
   * Wraps in a group with an invisible hitbox for easier click detection.
   */
  _createObject(compDef) {
    let visual;
    const builder = DETAIL_BUILDERS[compDef.id];
    if (builder) {
      console.log(`[ComponentBuilder] Using detail builder for: ${compDef.id}`);
      visual = builder();
    } else {
      console.log(`[ComponentBuilder] Using fallback for: ${compDef.id || compDef.name || 'unknown'}`);
      visual = this._createFallbackMesh(compDef);
    }

    // Wrap with invisible hitbox for easier raycasting
    const wrapper = new THREE.Group();
    wrapper.add(visual);

    const w = (compDef.subW || 2) * SUB_UNIT;
    const h = Math.max((compDef.subH || 2) * SUB_UNIT, 1.0);
    const l = (compDef.subL || 2) * SUB_UNIT;
    const hitGeo = new THREE.BoxGeometry(Math.max(w, 0.8), h, Math.max(l, 0.8));
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitbox = new THREE.Mesh(hitGeo, hitMat);
    hitbox.position.y = BEAM_HEIGHT;
    wrapper.add(hitbox);

    return wrapper;
  }

  /**
   * Set opacity on an object (works for both Mesh and Group).
   */
  _setDimmed(obj, dimmed) {
    const opacity = dimmed ? 0.3 : 1.0;
    const transparent = dimmed;
    obj.traverse((child) => {
      if (child.isMesh) {
        child.material.opacity = opacity;
        child.material.transparent = transparent;
      }
    });
  }

  /**
   * Build or update meshes for all components in the snapshot.
   * Removes stale meshes for components no longer present.
   */
  build(componentData, parentGroup) {
    if (!componentData || !parentGroup) return;
    console.log(`[ComponentBuilder] build() called with ${componentData.length} components:`, componentData.map(c => `${c.type}@${c.col},${c.row}`));

    const seen = new Set();

    for (const comp of componentData) {
      const { id, type, col, row, direction, dimmed } = comp;
      seen.add(id);

      const compDef = COMPONENTS[type] || {};
      const subH = compDef.subH || 2;
      const isDetailed = !!DETAIL_BUILDERS[type];

      // Create object if not already in map
      if (!this._meshMap.has(id)) {
        const obj = this._createObject(compDef);
        obj.matrixAutoUpdate = false;
        this._meshMap.set(id, obj);
        parentGroup.add(obj);
      }

      const obj = this._meshMap.get(id);

      // Position: center of sub-tile footprint within the tile.
      // gridW/gridH store sub-cell counts (1 sub-cell = 0.5 world units).
      const gwSub = compDef.gridW || compDef.subW || 4;
      const ghSub = compDef.gridH || compDef.subL || 4;
      const sc = comp.subCol || 0;
      const sr = comp.subRow || 0;
      const x = col * 2 + (sc + gwSub / 2) * SUB_UNIT;
      const z = row * 2 + (sr + ghSub / 2) * SUB_UNIT;
      // Detailed builders place Y=0 at floor; fallbacks center vertically
      const y = isDetailed ? 0 : (subH * SUB_UNIT) / 2;
      obj.position.set(x, y, z);

      // Rotation
      obj.rotation.y = -(direction || 0) * (Math.PI / 2);

      // Dimming
      this._setDimmed(obj, dimmed);

      obj.updateMatrix();
    }

    // Remove stale objects
    for (const [id, obj] of this._meshMap) {
      if (!seen.has(id)) {
        if (obj.parent) obj.parent.remove(obj);
        obj.traverse((child) => {
          if (child.isMesh) {
            child.geometry.dispose();
            child.material.dispose();
          }
        });
        this._meshMap.delete(id);
      }
    }
  }

  /**
   * Dispose all objects and clear the map.
   */
  dispose(parentGroup) {
    for (const [, obj] of this._meshMap) {
      if (parentGroup) parentGroup.remove(obj);
      obj.traverse((child) => {
        if (child.isMesh) {
          child.geometry.dispose();
          child.material.dispose();
        }
      });
    }
    this._meshMap.clear();
  }
}
