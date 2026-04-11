// src/renderer3d/component-builder.js
// Builds Three.js meshes for beamline components from world snapshot data.
// THREE is a CDN global — do NOT import it.

import { COMPONENTS } from '../data/components.js';
import { MATERIALS } from './materials/index.js';
import { applyTiledBoxUVs, applyTiledCylinderUVs } from './uv-utils.js';

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

function _mat(color, roughness = 0.5, metalness = 0.3, textureName = null) {
  const key = `${color}-${roughness}-${metalness}-${textureName ?? ''}`;
  if (!_matCache.has(key)) {
    const opts = { color, roughness, metalness };
    if (textureName && MATERIALS[textureName]) {
      opts.map = MATERIALS[textureName].map;
    }
    _matCache.set(key, new THREE.MeshStandardMaterial(opts));
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

// SHARED_MATERIALS now derive their .map from MATERIALS but keep their
// own roughness/metalness and color tint. Per-role default texture:
//   iron   -> metal_dark
//   copper -> copper
//   pipe   -> metal_brushed
//   stand  -> metal_painted_white  (tinted dark gray via color)
//   detail -> metal_dark
const SHARED_MATERIALS = {
  iron:   new THREE.MeshStandardMaterial({ map: MATERIALS.metal_dark.map,          color: 0xffffff,    roughness: 0.5, metalness: 0.4 }),
  copper: new THREE.MeshStandardMaterial({ map: MATERIALS.copper.map,              color: 0xffffff,    roughness: 0.4, metalness: 0.5 }),
  pipe:   new THREE.MeshStandardMaterial({ map: MATERIALS.metal_brushed.map,       color: 0xffffff,    roughness: 0.3, metalness: 0.5 }),
  stand:  new THREE.MeshStandardMaterial({ map: MATERIALS.metal_painted_white.map, color: STAND_COLOR, roughness: 0.7, metalness: 0.1 }),
  detail: new THREE.MeshStandardMaterial({ map: MATERIALS.metal_dark.map,          color: 0xffffff,    roughness: 0.7, metalness: 0.3 }),
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
export function getAccentMaterial(compType, colorHex) {
  const key = compType + '|' + colorHex.toString(16).padStart(6, '0');
  let m = _accentMatCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      map: MATERIALS.metal_painted_white.map,  // neutral tintable base
      color: colorHex,
      roughness: ACCENT_BASE_ROUGHNESS,
      metalness: ACCENT_BASE_METALNESS,
    });
    _accentMatCache.set(key, m);
  }
  return m;
}

// ── Template-and-tint infrastructure ────────────────────────────────
// A "role-based" builder returns { accent: [geoms], iron: [geoms], ... }
// where each array holds already-transformed BufferGeometries ready to
// be merged. We merge each role's list once per component type and cache
// the resulting meshes as a "template". Per-placement instantiation then
// creates lightweight Mesh wrappers that share the template's geometry
// and (for non-accent roles) the template's material.

/** @type {Map<string, Record<string, THREE.Mesh>>} */
const _templateCache = new Map();

/**
 * Registry of role-based builders. Unlike DETAIL_BUILDERS (legacy — returns
 * a fully assembled THREE.Group), these return a role bucket object.
 *
 * A builder may omit roles it doesn't use — the template-cache step only
 * processes roles with at least one geometry.
 *
 * @type {Record<string, () => Record<string, THREE.BufferGeometry[]>>}
 */
const ROLE_BUILDERS = {};

/**
 * Build (or fetch) the template for a role-based component type.
 * Returns a map of role -> Mesh. The meshes own merged geometry but use
 * placeholder/shared materials. Callers clone the meshes per placement.
 */
function _getRoleTemplate(compType) {
  if (_templateCache.has(compType)) return _templateCache.get(compType);
  const builder = ROLE_BUILDERS[compType];
  if (!builder) return null;

  const buckets = builder();
  const template = {};
  for (const role of ROLES) {
    const list = buckets[role];
    if (!list || list.length === 0) continue;
    const merged = _mergeGeometries(list);
    // Dispose the source geometries — we own `merged` now.
    for (const g of list) g.dispose();
    const mat = role === 'accent'
      ? SHARED_MATERIALS.pipe // placeholder; replaced per placement
      : SHARED_MATERIALS[role];
    const mesh = new THREE.Mesh(merged, mat);
    mesh.userData.role = role;
    if (role === 'detail') mesh.userData.lod = 'detail';
    template[role] = mesh;
  }

  _templateCache.set(compType, template);
  return template;
}

// Per-component override material cache. Key: compType + '|' + role + '|' + textureName.
// Each entry mirrors a role's SHARED_MATERIAL but swaps the .map to a
// different MATERIALS entry while preserving the role's color/roughness/metalness.
const _overrideRoleMatCache = new Map();

function _getOverrideRoleMaterial(compType, role, textureName) {
  const key = `${compType}|${role}|${textureName}`;
  let m = _overrideRoleMatCache.get(key);
  if (m) return m;
  const base = SHARED_MATERIALS[role];
  const tex = MATERIALS[textureName];
  if (!base || !tex) return base ?? null;
  m = new THREE.MeshStandardMaterial({
    map: tex.map,
    color: base.color.clone(),
    roughness: base.roughness,
    metalness: base.metalness,
  });
  _overrideRoleMatCache.set(key, m);
  return m;
}

/**
 * Instantiate a placed component from its role template. Returns a Group
 * containing one Mesh per role, where meshes share the template's merged
 * geometry and a cached material. Cheap to call repeatedly.
 *
 * @param {string} compType
 * @param {number} accentColorHex
 * @returns {THREE.Group|null} null if no role builder exists for this type
 */
function _instantiateRoleTemplate(compType, accentColorHex) {
  const template = _getRoleTemplate(compType);
  if (!template) return null;

  const group = new THREE.Group();
  // Resolve per-role material, honoring an optional per-component override.
  const compDef = COMPONENTS[compType];
  const overrides = (compDef && compDef.textures) || null;
  for (const role of ROLES) {
    const tplMesh = template[role];
    if (!tplMesh) continue;
    let mat;
    if (role === 'accent') {
      mat = getAccentMaterial(compType, accentColorHex);
    } else if (overrides && overrides[role]) {
      mat = _getOverrideRoleMaterial(compType, role, overrides[role]);
    } else {
      mat = SHARED_MATERIALS[role];
    }
    const mesh = new THREE.Mesh(tplMesh.geometry, mat);
    mesh.userData.role = role;
    if (role === 'detail') {
      mesh.userData.lod = 'detail';
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    } else {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    group.add(mesh);
  }
  return group;
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
  let uvCount = 0;
  for (const g of flat) {
    posCount += g.attributes.position.array.length;
    const na = g.attributes.normal;
    if (na) normCount += na.array.length;
    const ua = g.attributes.uv;
    if (ua) uvCount += ua.array.length;
  }

  const positions = new Float32Array(posCount);
  const allHaveNormals = flat.every(g => g.attributes.normal);
  const normals = allHaveNormals ? new Float32Array(normCount) : null;
  const allHaveUVs = flat.every(g => g.attributes.uv);
  const uvs = allHaveUVs ? new Float32Array(uvCount) : null;

  let posOff = 0;
  let normOff = 0;
  let uvOff = 0;
  for (const g of flat) {
    positions.set(g.attributes.position.array, posOff);
    posOff += g.attributes.position.array.length;
    if (normals) {
      normals.set(g.attributes.normal.array, normOff);
      normOff += g.attributes.normal.array.length;
    }
    if (uvs) {
      uvs.set(g.attributes.uv.array, uvOff);
      uvOff += g.attributes.uv.array.length;
    }
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (normals) {
    merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  } else {
    merged.computeVertexNormals();
  }
  if (uvs) {
    merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
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
  const bodyGeo = new THREE.BoxGeometry(bodyW, bodyH, bodyL);
  applyTiledBoxUVs(bodyGeo, bodyW, bodyH, bodyL);
  const body = _addShadow(new THREE.Mesh(bodyGeo, _mat(bodyColor, 0.6, 0.2)));
  body.position.set(0, bodyY, -0.15);
  group.add(body);

  // HV insulator dome on top — a squat cylinder
  const insR = 0.25, insH = 0.3;
  const insulatorGeo = new THREE.CylinderGeometry(insR * 0.6, insR, insH, SEGS);
  applyTiledCylinderUVs(insulatorGeo, insR, insH, SEGS);
  const insulator = _addShadow(new THREE.Mesh(insulatorGeo, _mat(insulatorColor, 0.4, 0.05)));
  insulator.position.set(0, bodyY + bodyH / 2 + insH / 2, -0.3);
  group.add(insulator);

  // Beam exit port — standard pipe extending from front face to tile edge
  const portEnd = 1.0; // tile edge
  const portStart = bodyL / 2 - 0.15;
  const portL = portEnd - portStart;
  const portGeo = new THREE.CylinderGeometry(PIPE_R, PIPE_R, portL, SEGS);
  applyTiledCylinderUVs(portGeo, PIPE_R, portL, SEGS);
  const port = _addShadow(new THREE.Mesh(portGeo, _mat(PIPE_COLOR, 0.3, 0.5)));
  port.rotation.x = Math.PI / 2;
  port.position.set(0, BEAM_HEIGHT, (portStart + portEnd) / 2);
  group.add(port);

  // Flange ring at beam exit — at tile edge so it meets adjacent pipe
  const sourceFlangeGeo = new THREE.CylinderGeometry(FLANGE_R, FLANGE_R, FLANGE_H, SEGS);
  applyTiledCylinderUVs(sourceFlangeGeo, FLANGE_R, FLANGE_H, SEGS);
  const flange = _addShadow(new THREE.Mesh(sourceFlangeGeo, _mat(FLANGE_COLOR, 0.3, 0.5)));
  flange.rotation.x = Math.PI / 2;
  flange.position.set(0, BEAM_HEIGHT, portEnd);
  group.add(flange);

  // Support legs — four posts under the gun body (one at each corner)
  const legW = 0.08, legH = bodyY - bodyH / 2;
  for (const xOff of [-bodyW / 2 + legW, bodyW / 2 - legW]) {
    for (const zOff of [-0.35, 0.25]) {
      const srcLegGeo = new THREE.BoxGeometry(legW, legH, legW);
      applyTiledBoxUVs(srcLegGeo, legW, legH, legW);
      const leg = _addShadow(new THREE.Mesh(srcLegGeo, _mat(STAND_COLOR, 0.7, 0.1)));
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
  const driftPipeGeo = new THREE.CylinderGeometry(PIPE_R, PIPE_R, pipeL, SEGS);
  applyTiledCylinderUVs(driftPipeGeo, PIPE_R, pipeL, SEGS);
  const pipe = _addShadow(new THREE.Mesh(driftPipeGeo, _mat(PIPE_COLOR, 0.3, 0.5)));
  pipe.rotation.x = Math.PI / 2;
  pipe.position.set(0, BEAM_HEIGHT, 0);
  group.add(pipe);

  // CF flanges at each end with bolt holes and bore opening
  for (const sign of [-1, 1]) {
    const driftFlangeGeo = new THREE.CylinderGeometry(FLANGE_R, FLANGE_R, FLANGE_H, SEGS);
    applyTiledCylinderUVs(driftFlangeGeo, FLANGE_R, FLANGE_H, SEGS);
    const flange = _addShadow(new THREE.Mesh(driftFlangeGeo, _mat(FLANGE_COLOR, 0.3, 0.6)));
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
    const boltGeo = new THREE.CylinderGeometry(boltR, boltR, boltDepth, 6);
    applyTiledCylinderUVs(boltGeo, boltR, boltDepth, 6);
    const bolt = new THREE.Mesh(boltGeo, boltMat);
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
    const supportLegGeo = new THREE.BoxGeometry(legW, legH, legW);
    applyTiledBoxUVs(supportLegGeo, legW, legH, legW);
    const leg = _addShadow(new THREE.Mesh(supportLegGeo, _mat(STAND_COLOR, 0.7, 0.1)));
    leg.position.set(side * legSpacing / 2, legH / 2, zPos);
    group.add(leg);
  }

  // Top crossbar — sits just above the pipe
  const topBarGeo = new THREE.BoxGeometry(barW, barH, barD);
  applyTiledBoxUVs(topBarGeo, barW, barH, barD);
  const topBar = _addShadow(new THREE.Mesh(topBarGeo, _mat(STAND_COLOR, 0.7, 0.1)));
  topBar.position.set(0, topOfPipe + barH / 2, zPos);
  group.add(topBar);

  // Bottom crossbar — sits just below the pipe
  const bottomBarGeo = new THREE.BoxGeometry(barW, barH, barD);
  applyTiledBoxUVs(bottomBarGeo, barW, barH, barD);
  const bottomBar = _addShadow(new THREE.Mesh(bottomBarGeo, _mat(STAND_COLOR, 0.7, 0.1)));
  bottomBar.position.set(0, BEAM_HEIGHT - PIPE_R - barH / 2, zPos);
  group.add(bottomBar);

  // Lower brace (near floor)
  const lowerBarGeo = new THREE.BoxGeometry(barW, barH, barD);
  applyTiledBoxUVs(lowerBarGeo, barW, barH, barD);
  const lowerBar = _addShadow(new THREE.Mesh(lowerBarGeo, _mat(STAND_COLOR, 0.7, 0.1)));
  lowerBar.position.set(0, 0.08, zPos);
  group.add(lowerBar);

  // Small foot plate
  const footW = legSpacing + legW + 0.04;
  const footGeo = new THREE.BoxGeometry(footW, 0.02, 0.08);
  applyTiledBoxUVs(footGeo, footW, 0.02, 0.08);
  const foot = _addShadow(new THREE.Mesh(footGeo, _mat(STAND_COLOR, 0.7, 0.1)));
  foot.position.set(0, 0.01, zPos);
  group.add(foot);
}

function _buildPillboxCavity() {
  const group = new THREE.Group();
  const cavityColor = 0xbb6633;  // copper

  // Central pillbox — short wide cylinder (the resonant cavity cell)
  const cellR = 0.35, cellL = 0.4;
  const cellGeo = new THREE.CylinderGeometry(cellR, cellR, cellL, SEGS);
  applyTiledCylinderUVs(cellGeo, cellR, cellL, SEGS);
  const cell = _addShadow(new THREE.Mesh(cellGeo, _mat(cavityColor, 0.35, 0.5)));
  cell.rotation.x = Math.PI / 2;
  cell.position.set(0, BEAM_HEIGHT, 0);
  group.add(cell);

  // End caps — slightly wider rings to show the cavity boundary
  for (const sign of [-1, 1]) {
    const capGeo = new THREE.CylinderGeometry(cellR + 0.03, cellR + 0.03, 0.03, SEGS);
    applyTiledCylinderUVs(capGeo, cellR + 0.03, 0.03, SEGS);
    const cap = _addShadow(new THREE.Mesh(capGeo, _mat(0x995522, 0.3, 0.6)));
    cap.rotation.x = Math.PI / 2;
    cap.position.set(0, BEAM_HEIGHT, sign * cellL / 2);
    group.add(cap);
  }

  // Beam pipe stubs in/out — extend to tile edge (±1.0) for flush connection
  const tileEdge = 1.0;
  for (const sign of [-1, 1]) {
    const stubStart = cellL / 2;
    const stubL = tileEdge - stubStart;
    const stubGeo = new THREE.CylinderGeometry(PIPE_R, PIPE_R, stubL, SEGS);
    applyTiledCylinderUVs(stubGeo, PIPE_R, stubL, SEGS);
    const stub = _addShadow(new THREE.Mesh(stubGeo, _mat(PIPE_COLOR, 0.3, 0.5)));
    stub.rotation.x = Math.PI / 2;
    stub.position.set(0, BEAM_HEIGHT, sign * (stubStart + stubL / 2));
    group.add(stub);

    // Standard CF flanges at tile edge
    const pillboxFlangeGeo = new THREE.CylinderGeometry(FLANGE_R, FLANGE_R, FLANGE_H, SEGS);
    applyTiledCylinderUVs(pillboxFlangeGeo, FLANGE_R, FLANGE_H, SEGS);
    const flange = _addShadow(new THREE.Mesh(pillboxFlangeGeo, _mat(FLANGE_COLOR, 0.3, 0.6)));
    flange.rotation.x = Math.PI / 2;
    flange.position.set(0, BEAM_HEIGHT, sign * tileEdge);
    group.add(flange);
  }

  // RF coupler port on top — a small cylinder stub pointing upward
  const couplerR = 0.08, couplerH = 0.25;
  const couplerGeo = new THREE.CylinderGeometry(couplerR, couplerR, couplerH, SEGS);
  applyTiledCylinderUVs(couplerGeo, couplerR, couplerH, SEGS);
  const coupler = _addShadow(new THREE.Mesh(couplerGeo, _mat(cavityColor, 0.35, 0.5)));
  coupler.position.set(0, BEAM_HEIGHT + cellR + couplerH / 2, 0);
  group.add(coupler);

  // Coupler flange
  const cFlangeGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.03, SEGS);
  applyTiledCylinderUVs(cFlangeGeo, 0.14, 0.03, SEGS);
  const cFlange = _addShadow(new THREE.Mesh(cFlangeGeo, _mat(FLANGE_COLOR, 0.3, 0.6)));
  cFlange.position.set(0, BEAM_HEIGHT + cellR + couplerH, 0);
  group.add(cFlange);

  // Support stands — two-leg style with crossbars
  _addBeamSupport(group, -cellL / 2 + 0.05);
  _addBeamSupport(group,  cellL / 2 - 0.05);

  return group;
}

// ── Role-based builders (template pattern) ──────────────────────────
// These return BufferGeometry buckets rather than assembled Groups.
// Individual primitives are built, positioned via a Matrix4, and baked
// into the geometry so they can be merged per role.

function _pushTransformed(bucket, geom, matrix) {
  geom.applyMatrix4(matrix);
  bucket.push(geom);
}

/**
 * Build the role buckets for a C-clamp magnet. The C opens toward local
 * -X. Dipoles use `bentPipe: true`, which routes the internal beam pipe
 * as an L (entry on local -Z, exit on local -X), visually showing the
 * 90° bend toward the open side of the C. Quadrupoles share the same
 * yoke/coils/supports as a placeholder but keep a straight pipe.
 *
 * Physical layout (1m × 1m × 1m, beam along local +Z):
 *   - C-shaped painted iron clamp: a spine on +X with top and bottom arms
 *     extending toward -X, forming a gap the beam pipe passes through.
 *   - Two rectangular copper coil bars on the inner faces of the arms,
 *     running the full length of the magnet.
 *   - Beam pipe: straight for quads, L-shaped 90° bend for dipoles.
 *   - Simple pedestal supports at each end: foot plate with two columns
 *     rising to the underside of the bottom arm.
 */
function _buildCClampRoles(bentPipe) {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };
  const m4 = new THREE.Matrix4();

  // 1-tile footprint: 2×2 sub-units (1m) in both X and Z.
  const yokeOuter = 0.4;    // half-extent of the yoke in X and Y
  const wall      = 0.12;   // yoke slab thickness
  const magL      = 1.0;    // full tile depth — adjacent quads touch face-to-face
  const backX     = yokeOuter - wall / 2;    // X center of the C's spine (+X side)
  const armY      = yokeOuter - wall / 2;    // Y offset of the top/bottom arm centers
  const armW      = 2 * yokeOuter - wall;    // X span of the arms (stops at spine's inner face)
  const armCx     = -wall / 2;               // X center of the arms

  // --- Painted yoke (accent role) ---
  // Spine: vertical slab on +X
  {
    const g = new THREE.BoxGeometry(wall, 2 * yokeOuter, magL);
    applyTiledBoxUVs(g, wall, 2 * yokeOuter, magL);
    m4.makeTranslation(backX, BEAM_HEIGHT, 0);
    _pushTransformed(buckets.accent, g, m4);
  }
  // Top and bottom arms: horizontal slabs forming the C's jaws
  for (const sign of [1, -1]) {
    const g = new THREE.BoxGeometry(armW, wall, magL);
    applyTiledBoxUVs(g, armW, wall, magL);
    m4.makeTranslation(armCx, BEAM_HEIGHT + sign * armY, 0);
    _pushTransformed(buckets.accent, g, m4);
  }

  // --- Copper coils (copper role) ---
  // Two rectangular copper bars sitting on the inner faces of the top and
  // bottom arms, running the full length of the magnet.
  const coilW = 0.26;
  const coilH = 0.1;
  const coilYOff = yokeOuter - wall - coilH / 2;
  for (const sign of [1, -1]) {
    const g = new THREE.BoxGeometry(coilW, coilH, magL);
    applyTiledBoxUVs(g, coilW, coilH, magL);
    m4.makeTranslation(armCx, BEAM_HEIGHT + sign * coilYOff, 0);
    _pushTransformed(buckets.copper, g, m4);
  }

  // --- Beam pipe through the C gap (pipe role) ---
  if (bentPipe) {
    // Dipole: L-shaped 90° bend. Entry half runs from the yoke's back
    // face (local -Z) to the centre; exit half runs from the centre out
    // to the open side of the C (local -X). Each half is magL/2 long so
    // the full arc sits inside the yoke footprint.
    const halfL = magL / 2;
    // Entry segment along +Z (cylinder default axis is +Y, rotate X +90°)
    {
      const g = new THREE.CylinderGeometry(PIPE_R, PIPE_R, halfL, SEGS);
      applyTiledCylinderUVs(g, PIPE_R, halfL, SEGS);
      const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
      const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, -halfL / 2);
      _pushTransformed(buckets.pipe, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
    }
    // Exit segment along -X (rotate Z +90° — the cylinder axis becomes the X axis)
    {
      const g = new THREE.CylinderGeometry(PIPE_R, PIPE_R, halfL, SEGS);
      applyTiledCylinderUVs(g, PIPE_R, halfL, SEGS);
      const rot = new THREE.Matrix4().makeRotationZ(Math.PI / 2);
      const trans = new THREE.Matrix4().makeTranslation(-halfL / 2, BEAM_HEIGHT, 0);
      _pushTransformed(buckets.pipe, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
    }
    // Small spherical joint at the bend corner to hide the seam
    {
      const g = new THREE.SphereGeometry(PIPE_R, SEGS, SEGS);
      m4.makeTranslation(0, BEAM_HEIGHT, 0);
      _pushTransformed(buckets.pipe, g, m4);
    }
  } else {
    // Quadrupole (placeholder): straight pipe through the centre.
    const pipeGeom = new THREE.CylinderGeometry(PIPE_R, PIPE_R, magL, SEGS);
    applyTiledCylinderUVs(pipeGeom, PIPE_R, magL, SEGS);
    m4.identity();
    m4.makeRotationX(Math.PI / 2);
    const pipeT = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, 0);
    const pipeFull = new THREE.Matrix4().multiplyMatrices(pipeT, m4);
    _pushTransformed(buckets.pipe, pipeGeom, pipeFull);
  }

  // --- Pedestal supports (stand role) ---
  // Simple pedestal at each end: wide foot plate with two thin columns
  // rising to the underside of the bottom arm.
  const sBaseH = 0.06;
  const sColW  = 0.1;
  const sColD  = 0.16;
  const sColX  = 0.24;
  const sTopY  = BEAM_HEIGHT - yokeOuter;   // bottom face of the C's bottom arm
  const sColH  = sTopY - sBaseH;
  for (const zSign of [-1, 1]) {
    const zPos = zSign * (magL / 2 - sColD / 2 - 0.04);
    const baseW = sColX * 2 + sColW + 0.12;
    const baseD = sColD + 0.04;
    const base = new THREE.BoxGeometry(baseW, sBaseH, baseD);
    applyTiledBoxUVs(base, baseW, sBaseH, baseD);
    m4.makeTranslation(0, sBaseH / 2, zPos);
    _pushTransformed(buckets.stand, base, m4);
    for (const side of [-1, 1]) {
      const col = new THREE.BoxGeometry(sColW, sColH, sColD);
      applyTiledBoxUVs(col, sColW, sColH, sColD);
      m4.makeTranslation(side * sColX, sBaseH + sColH / 2, zPos);
      _pushTransformed(buckets.stand, col, m4);
    }
  }

  return buckets;
}

// Dipole: C-clamp with an L-shaped beam pipe (bent toward the open side).
// Quadrupole: same yoke as a placeholder, straight pipe through the centre.
// Distinct builder functions so the role-template cache gives each variant
// its own merged geometry.
function _buildDipoleRoles() { return _buildCClampRoles(true); }
function _buildQuadrupoleRoles() { return _buildCClampRoles(false); }
ROLE_BUILDERS.dipole = _buildDipoleRoles;
ROLE_BUILDERS.quadrupole = _buildQuadrupoleRoles;

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
      applyTiledCylinderUVs(geometry, radius, l, 8);
      geometry.rotateZ(Math.PI / 2);
    } else {
      geometry = new THREE.BoxGeometry(w, h, l);
      applyTiledBoxUVs(geometry, w, h, l);
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

  // Prefer role builders (template-based); fall back to legacy detail builders.
  const hasRole = !!ROLE_BUILDERS[compDef.id || compType];
  const legacyBuilder = DETAIL_BUILDERS[compDef.id || compType];
  if (!hasRole && !legacyBuilder) return null;

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(size * 2, size * 2);

  const scene = new THREE.Scene();

  // Match game lighting: warm ambient, cool-key sun from upper-left-back,
  // cool fill from front-right, plus a neutral floor so GI bounces aren't
  // pure black.
  scene.add(new THREE.AmbientLight(0xfff5e6, 0.55));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(-6, 10, -4);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x88aaff, 0.25);
  fill.position.set(6, 4, 6);
  scene.add(fill);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 6),
    new THREE.MeshStandardMaterial({ color: 0x262a48, roughness: 0.9, metalness: 0.0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // Build the model. Role-based builders get the default APS-red accent;
  // legacy builders return their own fully assembled group.
  const defaultAccent = 0xc62828;
  let model;
  if (hasRole) {
    model = _instantiateRoleTemplate(compDef.id || compType, defaultAccent);
  } else {
    model = legacyBuilder();
  }
  scene.add(model);

  // Frame the camera around the model's bounding box.
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

  // Clean up — note we do NOT dispose template geometries (they're cached).
  // We only dispose the per-thumbnail materials we created (floor).
  floor.geometry.dispose();
  floor.material.dispose();
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
      applyTiledCylinderUVs(geometry, radius, l, 8);
      geometry.rotateZ(Math.PI / 2);
    } else {
      geometry = new THREE.BoxGeometry(w, h, l);
      applyTiledBoxUVs(geometry, w, h, l);
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
   *
   * Prefers the role-based template path if a builder is registered; falls
   * back to the legacy DETAIL_BUILDERS (source/drift/pillbox); finally
   * falls back to a generic fallback mesh.
   */
  _createObject(compDef, accentColorHex = 0xc62828) {
    const compType = compDef.id;
    let visual = null;

    if (ROLE_BUILDERS[compType]) {
      visual = _instantiateRoleTemplate(compType, accentColorHex);
    }

    if (!visual) {
      const legacyBuilder = DETAIL_BUILDERS[compType];
      if (legacyBuilder) {
        visual = legacyBuilder();
      } else {
        visual = this._createFallbackMesh(compDef);
      }
    }

    // Wrap with invisible hitbox for easier raycasting
    const wrapper = new THREE.Group();
    wrapper.add(visual);

    const w = (compDef.subW || 2) * SUB_UNIT;
    const h = Math.max((compDef.subH || 2) * SUB_UNIT, 1.0);
    const l = (compDef.subL || 2) * SUB_UNIT;
    const hitW = Math.max(w, 0.8), hitL = Math.max(l, 0.8);
    const hitGeo = new THREE.BoxGeometry(hitW, h, hitL);
    applyTiledBoxUVs(hitGeo, hitW, h, hitL);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitbox = new THREE.Mesh(hitGeo, hitMat);
    hitbox.position.y = BEAM_HEIGHT;
    wrapper.add(hitbox);

    return wrapper;
  }

  /**
   * Set opacity on an object (works for both Mesh and Group).
   *
   * Role-tagged meshes share their material across every placement, so
   * we can't mutate the shared material directly — we'd dim everything.
   * For those we clone once per mesh on first dim and cache the clone on
   * userData, swapping between shared and clone as the dim state toggles.
   */
  _setDimmed(obj, dimmed) {
    const opacity = dimmed ? 0.3 : 1.0;
    obj.traverse((child) => {
      if (!child.isMesh) return;
      const role = child.userData.role;
      if (role) {
        // Shared material — clone-on-dim so we never mutate the shared one.
        if (dimmed) {
          if (!child.userData._dimMat) {
            const clone = child.material.clone();
            clone.transparent = true;
            clone.opacity = opacity;
            child.userData._dimMat = clone;
            child.userData._baseMat = child.material;
          }
          child.material = child.userData._dimMat;
        } else if (child.userData._baseMat) {
          child.material = child.userData._baseMat;
        }
      } else {
        // Legacy / fallback meshes own their own material.
        child.material.opacity = opacity;
        child.material.transparent = dimmed;
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
      // Both legacy DETAIL_BUILDERS and new ROLE_BUILDERS bake BEAM_HEIGHT
      // into their geometry, so their wrappers should sit at y=0.
      const isDetailed = !!DETAIL_BUILDERS[type] || !!ROLE_BUILDERS[type];

      // Create object if not already in map
      if (!this._meshMap.has(id)) {
        const accent = comp.accentColor ?? 0xc62828;
        const obj = this._createObject(compDef, accent);
        obj.matrixAutoUpdate = false;
        obj.userData.beamlineId = comp.beamlineId || null;
        obj.userData.compType = type;
        obj.userData.pipeId = comp.pipeId || null;
        this._meshMap.set(id, obj);
        parentGroup.add(obj);
      }

      const obj = this._meshMap.get(id);

      // Position: center of sub-tile footprint within the tile.
      // gridW/gridH store sub-cell counts (1 sub-cell = 0.5 world units).
      // Pipe attachments are an exception: their col/row are interpolated
      // float coordinates along a pipe path, so we center the mesh directly
      // on that point (col*2+1, row*2+1) regardless of the component's
      // sub-tile footprint. subCol === null is the marker set by
      // world-snapshot's buildPipeAttachments.
      const gwRaw = compDef.gridW || compDef.subW || 4;
      const ghRaw = compDef.gridH || compDef.subL || 4;
      // snapForPlaceable swaps w/h for dir 1/3 when computing the top-left
      // subtile origin, so the render center must swap too or committed
      // meshes will drift from the reserved subcells.
      const swap = (direction === 1 || direction === 3);
      const gwSub = swap ? ghRaw : gwRaw;
      const ghSub = swap ? gwRaw : ghRaw;
      let x, z;
      if (comp.subCol == null && comp.subRow == null) {
        x = col * 2 + 1;
        z = row * 2 + 1;
      } else {
        const sc = comp.subCol || 0;
        const sr = comp.subRow || 0;
        x = col * 2 + (sc + gwSub / 2) * SUB_UNIT;
        z = row * 2 + (sr + ghSub / 2) * SUB_UNIT;
      }
      // Detailed builders place Y=0 at floor; fallbacks center vertically
      const y = isDetailed ? 0 : (subH * SUB_UNIT) / 2;
      obj.position.set(x, y, z);

      // Rotation
      obj.rotation.y = -(direction || 0) * (Math.PI / 2);

      // Dimming
      this._setDimmed(obj, dimmed);

      obj.updateMatrix();
    }

    // Remove stale objects. Role-tagged meshes share merged template
    // geometry and shared materials with every other placement of the
    // same type, so we must NOT dispose them — only dispose the per-dim
    // material clone (if any) and the hitbox, plus legacy/fallback meshes
    // which own their geometry & material outright.
    for (const [id, obj] of this._meshMap) {
      if (!seen.has(id)) {
        if (obj.parent) obj.parent.remove(obj);
        this._disposeWrapper(obj);
        this._meshMap.delete(id);
      }
    }
  }

  /**
   * Dispose a wrapper without touching shared template resources.
   * Only disposes:
   *   - per-wrapper dim material clones (`child.userData._dimMat`)
   *   - the hitbox geometry and material (owned per wrapper)
   *   - legacy / fallback meshes that have no role tag (they own their own)
   */
  _disposeWrapper(obj) {
    obj.traverse((child) => {
      if (!child.isMesh) return;
      if (child.userData._dimMat) {
        child.userData._dimMat.dispose();
        child.userData._dimMat = null;
      }
      if (child.userData.role) {
        // Shared — do not dispose geometry or base material.
        return;
      }
      // Legacy/fallback mesh or hitbox — owned geometry/material, safe.
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
  }

  /**
   * Dispose all objects and clear the map.
   */
  dispose(parentGroup) {
    for (const [, obj] of this._meshMap) {
      if (parentGroup) parentGroup.remove(obj);
      this._disposeWrapper(obj);
    }
    this._meshMap.clear();
  }
}
