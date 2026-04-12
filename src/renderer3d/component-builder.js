// src/renderer3d/component-builder.js
// Builds Three.js meshes for beamline components from world snapshot data.
// THREE is a CDN global — do NOT import it.

import { COMPONENTS } from '../data/components.js';
import { MATERIALS } from './materials/index.js';
import { applyTiledBoxUVs, applyTiledCylinderUVs } from './uv-utils.js';
import {
  _buildBPMRoles,
  _buildICTRoles,
  _buildScreenRoles,
} from './builders/diagnostic-builder.js';

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

function _mat(color, roughness = 0.5, metalness = 0.3, textureName = 'metal_painted_white') {
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
function _buildDipoleRoles() { return _buildCClampRoles(true); }
ROLE_BUILDERS.dipole = _buildDipoleRoles;

/**
 * Proper 4-pole quadrupole magnet, diamond-rotated around the beam axis.
 *
 * The whole yoke+poles+coils assembly is rotated 45° about Z (the beam
 * axis), so the square steel return yoke sits as a diamond with a vertex
 * pointing straight down — the orientation you commonly see on real
 * beamlines where the magnet rests on a pedestal cradling the lower
 * vertex. Pole tips project radially toward the beam pipe at cardinal
 * angles (top/bottom/left/right) after the 45° rotation — i.e., they
 * start life at 45°/135°/225°/315° in the unrotated frame.
 *
 * Footprint: 1m along X, 1m along Y (diameter of the diamond), 1m along Z.
 */
function _buildQuadrupoleRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };
  const m4 = new THREE.Matrix4();

  const magL  = 1.0;   // full tile depth along beam (+Z) so neighbors butt flush
  const zRot  = Math.PI / 4; // diamond rotation around the beam axis

  // Apply the diamond rotation to any (x, y) offset in the unrotated
  // square frame. We build the yoke/poles/coils in an axis-aligned frame
  // (simpler math) and push them into buckets with this rotation baked in
  // so the merged geometry is already in the correct diamond orientation.
  function pushRotated(bucket, geom, localX, localY, zOff, extraRotZ = 0) {
    // Box's local axes: +X right, +Y up, +Z along beam. After rotating by
    // (zRot + extraRotZ) around Z, a local +Y originally pointing "up" in
    // the unrotated frame points outward toward one of the diamond faces.
    const rot = new THREE.Matrix4().makeRotationZ(zRot + extraRotZ);
    const cx =  Math.cos(zRot) * localX - Math.sin(zRot) * localY;
    const cy =  Math.sin(zRot) * localX + Math.cos(zRot) * localY;
    const trans = new THREE.Matrix4().makeTranslation(cx, BEAM_HEIGHT + cy, zOff);
    _pushTransformed(bucket, geom, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // --- Square iron return yoke (accent) ---
  // Built as 4 slabs forming a hollow square of outer half-extent `yokeOuter`
  // and inner half-extent `yokeInner`. After the 45° rotation it reads as a
  // hollow diamond. Pole tips extend inward from the midpoints of each side,
  // so (unrotated) we leave the midpoints of each slab open for the poles to
  // plug into seamlessly.
  const yokeOuter = 0.48;
  const wall      = 0.14;
  const slabLen   = 2 * yokeOuter; // full side of the square
  // Top and bottom slabs
  for (const sign of [1, -1]) {
    const g = new THREE.BoxGeometry(slabLen, wall, magL);
    applyTiledBoxUVs(g, slabLen, wall, magL);
    pushRotated(buckets.accent, g, 0, sign * (yokeOuter - wall / 2), 0);
  }
  // Left and right slabs (shorter so they don't overlap top/bottom)
  for (const sign of [1, -1]) {
    const shortLen = slabLen - 2 * wall;
    const g = new THREE.BoxGeometry(wall, shortLen, magL);
    applyTiledBoxUVs(g, wall, shortLen, magL);
    pushRotated(buckets.accent, g, sign * (yokeOuter - wall / 2), 0, 0);
  }

  // --- Four iron pole tips ---
  // In the unrotated frame, one pole per side of the square pointing toward
  // the centre. After rotation they sit at top/bottom/left/right around the
  // beam pipe. Each pole is a box whose "long" axis is radial.
  const poleTipR   = PIPE_R + 0.04;          // air gap between tip and beam pipe
  const poleBaseR  = yokeOuter - wall;       // pole root at inner yoke face
  const poleLen    = poleBaseR - poleTipR;
  const poleW      = 0.28;                    // tangential width
  // Top/bottom poles: Y is the radial direction
  for (const sign of [1, -1]) {
    const g = new THREE.BoxGeometry(poleW, poleLen, magL);
    applyTiledBoxUVs(g, poleW, poleLen, magL);
    pushRotated(buckets.iron, g, 0, sign * (poleTipR + poleLen / 2), 0);
  }
  // Left/right poles: X is the radial direction — use a sideways box
  for (const sign of [1, -1]) {
    const g = new THREE.BoxGeometry(poleLen, poleW, magL);
    applyTiledBoxUVs(g, poleLen, poleW, magL);
    pushRotated(buckets.iron, g, sign * (poleTipR + poleLen / 2), 0, 0);
  }

  // --- Copper racetrack coils (one pair of long bars per pole) ---
  // Two parallel bars per pole, flanking the pole tangentially, running the
  // full magnet length along Z. Chunky enough to read as wound copper.
  const coilBarW   = 0.10;                  // cross-section width
  const coilBarH   = poleLen * 0.85;
  const coilTanOff = poleW / 2 + coilBarW / 2 + 0.005;
  const coilRadC   = poleTipR + poleLen / 2; // radial centre matches pole
  for (const sign of [1, -1]) {
    for (const tSign of [-1, 1]) {
      // Top/bottom poles: radial = Y, tangential = X
      {
        const g = new THREE.BoxGeometry(coilBarW, coilBarH, magL);
        applyTiledBoxUVs(g, coilBarW, coilBarH, magL);
        pushRotated(buckets.copper, g, tSign * coilTanOff, sign * coilRadC, 0);
      }
      // Left/right poles: radial = X, tangential = Y — swap box dims
      {
        const g = new THREE.BoxGeometry(coilBarH, coilBarW, magL);
        applyTiledBoxUVs(g, coilBarH, coilBarW, magL);
        pushRotated(buckets.copper, g, sign * coilRadC, tSign * coilTanOff, 0);
      }
    }
  }

  // --- Straight beam pipe through the centre (pipe) ---
  {
    const g = new THREE.CylinderGeometry(PIPE_R, PIPE_R, magL, SEGS);
    applyTiledCylinderUVs(g, PIPE_R, magL, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, 0);
    _pushTransformed(buckets.pipe, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // --- Pedestal supports (stand) ---
  // The diamond's lowest point is at y = BEAM_HEIGHT - yokeOuter*sqrt(2).
  // We cradle the lower V-faces of the diamond with two angled pedestals at
  // each Z end. For simplicity, use a wide flat base plate at floor level
  // plus a central column rising to just under the lower vertex.
  const diamondBottomY = BEAM_HEIGHT - yokeOuter * Math.SQRT2;
  const sBaseH = 0.06;
  const sColW  = 0.26;
  const sColD  = 0.18;
  const sColH  = Math.max(0.04, diamondBottomY - sBaseH);
  for (const zSign of [-1, 1]) {
    const zPos = zSign * (magL / 2 - sColD / 2 - 0.04);
    const baseW = sColW + 0.2;
    const baseD = sColD + 0.06;
    const base = new THREE.BoxGeometry(baseW, sBaseH, baseD);
    applyTiledBoxUVs(base, baseW, sBaseH, baseD);
    const bt = new THREE.Matrix4().makeTranslation(0, sBaseH / 2, zPos);
    _pushTransformed(buckets.stand, base, bt);
    if (sColH > 0.05) {
      const col = new THREE.BoxGeometry(sColW, sColH, sColD);
      applyTiledBoxUVs(col, sColW, sColH, sColD);
      const ct = new THREE.Matrix4().makeTranslation(0, sBaseH + sColH / 2, zPos);
      _pushTransformed(buckets.stand, col, ct);
    }
  }

  return buckets;
}
ROLE_BUILDERS.quadrupole = _buildQuadrupoleRoles;

/**
 * Bellows Section — 1 m long (2 sub-units) corrugated vacuum coupling.
 *
 * A stack of torus rings produces the accordion silhouette. Flanges at
 * both tile edges so it sits flush between neighboring components. No
 * support stand — bellows normally hangs between its neighbors.
 */
function _buildBellowsRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };

  const tileHalf  = 0.5;                    // ±0.5 m from tile centre (1 m tile)
  const flangeZ   = tileHalf - FLANGE_H / 2;
  const bellowsL  = 2 * (tileHalf - FLANGE_H - 0.04); // leave a small stub to the flanges
  const ringInner = PIPE_R;                  // inner bore radius
  const ringOuter = PIPE_R * 2.4;            // outer accordion radius
  const tube      = (ringOuter - ringInner) / 2;
  const ringCentR = ringInner + tube;
  const ringCount = 11;
  const ringSpacing = bellowsL / ringCount;
  const ringSegs  = 10;
  const tubeSegs  = 12;

  // Thin smooth inner sleeve so the vacuum space is visibly a closed tube
  // rather than seeing straight through the gaps between rings.
  {
    const g = new THREE.CylinderGeometry(PIPE_R * 0.98, PIPE_R * 0.98, bellowsL + 0.01, SEGS);
    applyTiledCylinderUVs(g, PIPE_R * 0.98, bellowsL, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, 0);
    _pushTransformed(buckets.pipe, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // Corrugation rings — TorusGeometry default lies in XY plane (axis +Z),
  // which is exactly the beam axis, so no rotation is needed.
  for (let i = 0; i < ringCount; i++) {
    const t = (i + 0.5) / ringCount;         // 0..1 along the bellows span
    const z = -bellowsL / 2 + t * bellowsL;
    const g = new THREE.TorusGeometry(ringCentR, tube, tubeSegs, ringSegs);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, z);
    _pushTransformed(buckets.pipe, g, trans);
  }

  // CF flanges at both tile edges — standard sizes so the bellows butts
  // flush against drift pipes or magnets on either side.
  for (const sign of [-1, 1]) {
    const g = new THREE.CylinderGeometry(FLANGE_R, FLANGE_R, FLANGE_H, SEGS);
    applyTiledCylinderUVs(g, FLANGE_R, FLANGE_H, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, sign * flangeZ);
    _pushTransformed(buckets.detail, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  return buckets;
}
ROLE_BUILDERS.bellows = _buildBellowsRoles;
ROLE_BUILDERS.bpm = _buildBPMRoles;
ROLE_BUILDERS.ict = _buildICTRoles;
ROLE_BUILDERS.screen = _buildScreenRoles;

/**
 * RFQ (Radio-Frequency Quadrupole) — long copper accelerating structure.
 *
 * Physically the thing is a chunky horizontal cavity vessel with tuning
 * plungers poking out the top, an RF drive waveguide coming in from the
 * side, and multiple support pedestals underneath. Footprint in sub-units:
 * subW=4, subL=6 → 2 m × 3 m; the beam runs along the long axis (+Z).
 */
function _buildRFQRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };

  const magL    = 3.0;     // full component length along beam
  const bodyR   = 0.55;    // outer radius of the main copper body
  const bodyL   = magL - 2 * FLANGE_H - 0.1;
  const ribR    = bodyR + 0.05;
  const ribH    = 0.06;
  const ribCount = 5;

  // Main copper body — one long cylinder along +Z
  {
    const g = new THREE.CylinderGeometry(bodyR, bodyR, bodyL, SEGS);
    applyTiledCylinderUVs(g, bodyR, bodyL, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, 0);
    _pushTransformed(buckets.copper, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // Rib rings — slightly wider short cylinders suggesting segment joints
  for (let i = 0; i < ribCount; i++) {
    const t = (i + 0.5) / ribCount;
    const z = -bodyL / 2 + t * bodyL;
    const g = new THREE.CylinderGeometry(ribR, ribR, ribH, SEGS);
    applyTiledCylinderUVs(g, ribR, ribH, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, z);
    _pushTransformed(buckets.copper, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // Tuning plungers — short vertical piston stubs along the top centre line
  const plungerCount = 8;
  const plungerR = 0.09;
  const plungerH = 0.35;
  const plungerBaseY = BEAM_HEIGHT + bodyR;
  for (let i = 0; i < plungerCount; i++) {
    const t = (i + 0.5) / plungerCount;
    const z = -bodyL / 2 + t * bodyL;
    // Body
    const g = new THREE.CylinderGeometry(plungerR, plungerR, plungerH, SEGS);
    applyTiledCylinderUVs(g, plungerR, plungerH, SEGS);
    const trans = new THREE.Matrix4().makeTranslation(0, plungerBaseY + plungerH / 2, z);
    _pushTransformed(buckets.iron, g, trans);
    // Cap flange at the top of each plunger
    const capGeo = new THREE.CylinderGeometry(plungerR * 1.4, plungerR * 1.4, 0.035, SEGS);
    applyTiledCylinderUVs(capGeo, plungerR * 1.4, 0.035, SEGS);
    const capTrans = new THREE.Matrix4().makeTranslation(0, plungerBaseY + plungerH + 0.018, z);
    _pushTransformed(buckets.detail, capGeo, capTrans);
  }

  // RF drive waveguide — rectangular stub sticking out the -X side near
  // the upstream (-Z) end, ending in a flanged coupling box.
  {
    const wgW = 0.34, wgH = 0.18, wgL = 0.5;
    const wgZ = -bodyL / 2 + 0.6;
    const wgX = -(bodyR + wgL / 2);
    const g = new THREE.BoxGeometry(wgL, wgH, wgW);
    applyTiledBoxUVs(g, wgL, wgH, wgW);
    const trans = new THREE.Matrix4().makeTranslation(wgX, BEAM_HEIGHT, wgZ);
    _pushTransformed(buckets.accent, g, trans);
    // End-cap flange block
    const capW = 0.42, capH = 0.26, capL = 0.06;
    const capG = new THREE.BoxGeometry(capL, capH, capW);
    applyTiledBoxUVs(capG, capL, capH, capW);
    const capTrans = new THREE.Matrix4().makeTranslation(wgX - wgL / 2 - capL / 2, BEAM_HEIGHT, wgZ);
    _pushTransformed(buckets.detail, capG, capTrans);
  }

  // End flanges + beam pipe stubs reaching to the tile edges (±magL/2)
  const tileEdge = magL / 2;
  for (const sign of [-1, 1]) {
    const stubStart = bodyL / 2;
    const stubL = tileEdge - stubStart;
    if (stubL > 0.001) {
      const g = new THREE.CylinderGeometry(PIPE_R, PIPE_R, stubL, SEGS);
      applyTiledCylinderUVs(g, PIPE_R, stubL, SEGS);
      const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
      const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, sign * (stubStart + stubL / 2));
      _pushTransformed(buckets.pipe, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
    }
    const fg = new THREE.CylinderGeometry(FLANGE_R, FLANGE_R, FLANGE_H, SEGS);
    applyTiledCylinderUVs(fg, FLANGE_R, FLANGE_H, SEGS);
    const frot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const ftrans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, sign * tileEdge);
    _pushTransformed(buckets.detail, fg, new THREE.Matrix4().multiplyMatrices(ftrans, frot));
  }

  // Four support pedestals evenly spaced under the cavity
  const supportCount = 4;
  const sBaseH = 0.06;
  const sColW  = 0.24;
  const sColD  = 0.2;
  const sColH  = BEAM_HEIGHT - bodyR - sBaseH;
  for (let i = 0; i < supportCount; i++) {
    const t = (i + 0.5) / supportCount;
    const zPos = -bodyL / 2 + t * bodyL;
    const baseW = sColW + 0.18;
    const baseD = sColD + 0.06;
    const base = new THREE.BoxGeometry(baseW, sBaseH, baseD);
    applyTiledBoxUVs(base, baseW, sBaseH, baseD);
    const bt = new THREE.Matrix4().makeTranslation(0, sBaseH / 2, zPos);
    _pushTransformed(buckets.stand, base, bt);
    const col = new THREE.BoxGeometry(sColW, sColH, sColD);
    applyTiledBoxUVs(col, sColW, sColH, sColD);
    const ct = new THREE.Matrix4().makeTranslation(0, sBaseH + sColH / 2, zPos);
    _pushTransformed(buckets.stand, col, ct);
  }

  return buckets;
}
ROLE_BUILDERS.rfq = _buildRFQRoles;

/**
 * NC RF Cavity (rfCavity) — multi-cell standing-wave copper structure.
 *
 * Six chunky copper cells strung along the beam like beads — the visual
 * signature of a standing-wave structure. Each cell carries its own small
 * tuning plunger; a single RF drive waveguide feeds the middle cell.
 * Footprint: subW=4, subL=6 → 2 m × 3 m, beam along +Z.
 */
function _buildRFCavityRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };

  const magL      = 3.0;
  const cellCount = 6;
  const cellR     = 0.5;
  const gapR      = 0.32;                  // waist between cells (narrower)
  const gapL      = 0.04;
  const cellL     = (magL - 0.2) / cellCount - gapL;
  const cellTrainL = cellCount * cellL + (cellCount - 1) * gapL;
  const cellZ0    = -cellTrainL / 2 + cellL / 2;

  // Beads-on-a-string cells
  for (let i = 0; i < cellCount; i++) {
    const zc = cellZ0 + i * (cellL + gapL);
    const g = new THREE.CylinderGeometry(cellR, cellR, cellL, SEGS);
    applyTiledCylinderUVs(g, cellR, cellL, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, zc);
    _pushTransformed(buckets.copper, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }
  // Narrow waist sections bridging each cell pair
  for (let i = 0; i < cellCount - 1; i++) {
    const zc = cellZ0 + i * (cellL + gapL) + cellL / 2 + gapL / 2;
    const g = new THREE.CylinderGeometry(gapR, gapR, gapL + 0.01, SEGS);
    applyTiledCylinderUVs(g, gapR, gapL, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, zc);
    _pushTransformed(buckets.copper, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // One small tuning plunger per cell, on top centre line
  const plungerR = 0.07, plungerH = 0.22;
  const plungerY = BEAM_HEIGHT + cellR;
  for (let i = 0; i < cellCount; i++) {
    const zc = cellZ0 + i * (cellL + gapL);
    const g = new THREE.CylinderGeometry(plungerR, plungerR, plungerH, SEGS);
    applyTiledCylinderUVs(g, plungerR, plungerH, SEGS);
    const trans = new THREE.Matrix4().makeTranslation(0, plungerY + plungerH / 2, zc);
    _pushTransformed(buckets.iron, g, trans);
    const capGeo = new THREE.CylinderGeometry(plungerR * 1.4, plungerR * 1.4, 0.03, SEGS);
    applyTiledCylinderUVs(capGeo, plungerR * 1.4, 0.03, SEGS);
    const capTrans = new THREE.Matrix4().makeTranslation(0, plungerY + plungerH + 0.015, zc);
    _pushTransformed(buckets.detail, capGeo, capTrans);
  }

  // Single RF drive waveguide into the middle cell, from +X side
  {
    const wgW = 0.32, wgH = 0.18, wgL = 0.5;
    const wgZ = 0;
    const wgX = cellR + wgL / 2;
    const g = new THREE.BoxGeometry(wgL, wgH, wgW);
    applyTiledBoxUVs(g, wgL, wgH, wgW);
    const trans = new THREE.Matrix4().makeTranslation(wgX, BEAM_HEIGHT, wgZ);
    _pushTransformed(buckets.accent, g, trans);
    const capW = 0.4, capH = 0.26, capL = 0.06;
    const capG = new THREE.BoxGeometry(capL, capH, capW);
    applyTiledBoxUVs(capG, capL, capH, capW);
    const capTrans = new THREE.Matrix4().makeTranslation(wgX + wgL / 2 + capL / 2, BEAM_HEIGHT, wgZ);
    _pushTransformed(buckets.detail, capG, capTrans);
  }

  // End pipe stubs + CF flanges at tile edges
  const tileEdge = magL / 2;
  for (const sign of [-1, 1]) {
    const stubStart = cellTrainL / 2;
    const stubL = tileEdge - stubStart;
    if (stubL > 0.001) {
      const g = new THREE.CylinderGeometry(PIPE_R, PIPE_R, stubL, SEGS);
      applyTiledCylinderUVs(g, PIPE_R, stubL, SEGS);
      const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
      const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, sign * (stubStart + stubL / 2));
      _pushTransformed(buckets.pipe, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
    }
    const fg = new THREE.CylinderGeometry(FLANGE_R, FLANGE_R, FLANGE_H, SEGS);
    applyTiledCylinderUVs(fg, FLANGE_R, FLANGE_H, SEGS);
    const frot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const ftrans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, sign * tileEdge);
    _pushTransformed(buckets.detail, fg, new THREE.Matrix4().multiplyMatrices(ftrans, frot));
  }

  // Three support pedestals
  const sBaseH = 0.06;
  const sColW  = 0.24;
  const sColD  = 0.18;
  const sColH  = BEAM_HEIGHT - cellR - sBaseH;
  for (const t of [0.15, 0.5, 0.85]) {
    const zPos = -cellTrainL / 2 + t * cellTrainL;
    const baseW = sColW + 0.18;
    const baseD = sColD + 0.06;
    const base = new THREE.BoxGeometry(baseW, sBaseH, baseD);
    applyTiledBoxUVs(base, baseW, sBaseH, baseD);
    _pushTransformed(buckets.stand, base, new THREE.Matrix4().makeTranslation(0, sBaseH / 2, zPos));
    const col = new THREE.BoxGeometry(sColW, sColH, sColD);
    applyTiledBoxUVs(col, sColW, sColH, sColD);
    _pushTransformed(buckets.stand, col, new THREE.Matrix4().makeTranslation(0, sBaseH + sColH / 2, zPos));
  }

  return buckets;
}
ROLE_BUILDERS.rfCavity = _buildRFCavityRoles;

/**
 * S-band Structure — normal-conducting traveling-wave copper linac.
 *
 * Visually distinct from rfCavity: a long smooth copper tube densely
 * populated with thin disk rings (disk-loaded TW structure), with a
 * prominent coupler cell at each end and RF waveguides on opposite
 * sides — input upstream, output downstream. Footprint: 2 m × 3 m.
 */
function _buildSbandStructureRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };

  const magL    = 3.0;
  const bodyR   = 0.4;
  const couplerR = 0.52;
  const couplerL = 0.28;
  const bodyL   = magL - 2 * couplerL - 0.1;

  // Smooth copper body tube
  {
    const g = new THREE.CylinderGeometry(bodyR, bodyR, bodyL, SEGS);
    applyTiledCylinderUVs(g, bodyR, bodyL, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, 0);
    _pushTransformed(buckets.copper, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // Disk rings — dense, thin, slightly protruding
  const diskCount = 22;
  const diskR = bodyR + 0.03;
  const diskH = 0.025;
  for (let i = 0; i < diskCount; i++) {
    const t = (i + 0.5) / diskCount;
    const z = -bodyL / 2 + t * bodyL;
    const g = new THREE.CylinderGeometry(diskR, diskR, diskH, SEGS);
    applyTiledCylinderUVs(g, diskR, diskH, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, z);
    _pushTransformed(buckets.copper, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // Large coupler cells at each end (bulkier than the body)
  for (const sign of [-1, 1]) {
    const zc = sign * (bodyL / 2 + couplerL / 2);
    const g = new THREE.CylinderGeometry(couplerR, couplerR, couplerL, SEGS);
    applyTiledCylinderUVs(g, couplerR, couplerL, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, zc);
    _pushTransformed(buckets.copper, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // RF waveguides — input on -X side at the upstream coupler, output on
  // +X side at the downstream coupler (opposite sides is the standard TW
  // layout so the power flow is obvious).
  const wgW = 0.3, wgH = 0.17, wgL = 0.48;
  const endZ = bodyL / 2 + couplerL / 2;
  for (const side of [{ x: -1, z: -1 }, { x: 1, z: 1 }]) {
    const wgX = side.x * (couplerR + wgL / 2);
    const wgZ = side.z * endZ;
    const g = new THREE.BoxGeometry(wgL, wgH, wgW);
    applyTiledBoxUVs(g, wgL, wgH, wgW);
    _pushTransformed(buckets.accent, g, new THREE.Matrix4().makeTranslation(wgX, BEAM_HEIGHT, wgZ));
    const capW = 0.38, capH = 0.25, capL = 0.06;
    const capG = new THREE.BoxGeometry(capL, capH, capW);
    applyTiledBoxUVs(capG, capL, capH, capW);
    const capX = wgX + side.x * (wgL / 2 + capL / 2);
    _pushTransformed(buckets.detail, capG, new THREE.Matrix4().makeTranslation(capX, BEAM_HEIGHT, wgZ));
  }

  // Beam pipe stubs + flanges at tile edges
  const tileEdge = magL / 2;
  for (const sign of [-1, 1]) {
    const stubStart = bodyL / 2 + couplerL;
    const stubL = tileEdge - stubStart;
    if (stubL > 0.001) {
      const g = new THREE.CylinderGeometry(PIPE_R, PIPE_R, stubL, SEGS);
      applyTiledCylinderUVs(g, PIPE_R, stubL, SEGS);
      const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
      const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, sign * (stubStart + stubL / 2));
      _pushTransformed(buckets.pipe, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
    }
    const fg = new THREE.CylinderGeometry(FLANGE_R, FLANGE_R, FLANGE_H, SEGS);
    applyTiledCylinderUVs(fg, FLANGE_R, FLANGE_H, SEGS);
    const frot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const ftrans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, sign * tileEdge);
    _pushTransformed(buckets.detail, fg, new THREE.Matrix4().multiplyMatrices(ftrans, frot));
  }

  // Four support pedestals along the length
  const sBaseH = 0.06;
  const sColW  = 0.22;
  const sColD  = 0.18;
  const sColH  = BEAM_HEIGHT - couplerR - sBaseH;
  for (const t of [0.1, 0.38, 0.62, 0.9]) {
    const zPos = -magL / 2 + t * magL;
    const baseW = sColW + 0.16;
    const baseD = sColD + 0.06;
    const base = new THREE.BoxGeometry(baseW, sBaseH, baseD);
    applyTiledBoxUVs(base, baseW, sBaseH, baseD);
    _pushTransformed(buckets.stand, base, new THREE.Matrix4().makeTranslation(0, sBaseH / 2, zPos));
    const col = new THREE.BoxGeometry(sColW, sColH, sColD);
    applyTiledBoxUVs(col, sColW, sColH, sColD);
    _pushTransformed(buckets.stand, col, new THREE.Matrix4().makeTranslation(0, sBaseH + sColH / 2, zPos));
  }

  return buckets;
}
ROLE_BUILDERS.sbandStructure = _buildSbandStructureRoles;

/**
 * Half-Wave Resonator — superconducting single-cell cryomodule.
 *
 * Vertical rectangular cryostat that stands on the floor and rises
 * above the beam axis, wrapped in external stiffener ridges. A fat
 * side RF coupler punches through the vessel at beam height and a
 * cryo transfer port rises from the top plate. Footprint: subW=2,
 * subL=2 → 1 m × 1 m, so the beam pipe (X=0) lands on a subtile
 * boundary.
 */
function _buildHalfWaveResonatorRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };

  const tileHalf    = 0.5;                   // ±0.5 m along beam (1 m tile)
  const vesselW     = 0.82;                  // X extent
  const vesselL     = 0.88;                  // Z extent (along beam)
  const vesselBot   = 0.06;                  // clear the floor slightly
  const vesselTop   = 1.85;                  // rises ~0.85 m above the beam
  const vesselH     = vesselTop - vesselBot;
  const vesselY     = vesselBot + vesselH / 2;

  // Main stainless cryostat body (pipe role → brushed metal).
  {
    const g = new THREE.BoxGeometry(vesselW, vesselH, vesselL);
    applyTiledBoxUVs(g, vesselW, vesselH, vesselL);
    _pushTransformed(buckets.pipe, g, new THREE.Matrix4().makeTranslation(0, vesselY, 0));
  }

  // External stiffener ridges — thin horizontal flange rings that wrap
  // the vessel on all four sides. Placed symmetrically around the beam
  // axis so the vessel reads as ribbed.
  const ridgeTh = 0.05;
  const ridgeGrow = 0.08;
  const ridgeYs = [0.32, 0.68, 1.04, 1.40, 1.72];
  for (const y of ridgeYs) {
    const g = new THREE.BoxGeometry(vesselW + ridgeGrow, ridgeTh, vesselL + ridgeGrow);
    applyTiledBoxUVs(g, vesselW + ridgeGrow, ridgeTh, vesselL + ridgeGrow);
    _pushTransformed(buckets.detail, g, new THREE.Matrix4().makeTranslation(0, y, 0));
  }

  // Thick top plate (bolted lid)
  {
    const plateW = vesselW + 0.16;
    const plateL = vesselL + 0.16;
    const plateH = 0.09;
    const g = new THREE.BoxGeometry(plateW, plateH, plateL);
    applyTiledBoxUVs(g, plateW, plateH, plateL);
    _pushTransformed(buckets.pipe, g, new THREE.Matrix4().makeTranslation(0, vesselTop + plateH / 2, 0));
  }

  // Baseplate foot (sits on the floor)
  {
    const footW = vesselW + 0.14;
    const footL = vesselL + 0.14;
    const footH = 0.06;
    const g = new THREE.BoxGeometry(footW, footH, footL);
    applyTiledBoxUVs(g, footW, footH, footL);
    _pushTransformed(buckets.stand, g, new THREE.Matrix4().makeTranslation(0, footH / 2, 0));
  }

  // Fat side RF coupler (accent) emerging through the vessel at beam height.
  {
    const cW = 0.26;   // Z extent (along beam) — short coupler
    const cH = 0.26;   // Y extent
    const cL = 0.42;   // X extent (how far it sticks out)
    const g = new THREE.BoxGeometry(cL, cH, cW);
    applyTiledBoxUVs(g, cL, cH, cW);
    _pushTransformed(buckets.accent, g, new THREE.Matrix4().makeTranslation(vesselW / 2 + cL / 2, BEAM_HEIGHT, 0));
    // Outer flange cap
    const capL = 0.05;
    const capG = new THREE.BoxGeometry(capL, cH * 1.25, cW * 1.25);
    applyTiledBoxUVs(capG, capL, cH * 1.25, cW * 1.25);
    _pushTransformed(buckets.detail, capG, new THREE.Matrix4().makeTranslation(vesselW / 2 + cL + capL / 2, BEAM_HEIGHT, 0));
  }

  // Top liquid-helium / cryo transfer port rising from the lid.
  {
    const portR = 0.09, portH = 0.32;
    const lidTop = vesselTop + 0.09;
    const g = new THREE.CylinderGeometry(portR, portR, portH, SEGS);
    applyTiledCylinderUVs(g, portR, portH, SEGS);
    _pushTransformed(buckets.pipe, g, new THREE.Matrix4().makeTranslation(0, lidTop + portH / 2, 0));
    const capGeo = new THREE.CylinderGeometry(portR * 1.5, portR * 1.5, 0.04, SEGS);
    applyTiledCylinderUVs(capGeo, portR * 1.5, 0.04, SEGS);
    _pushTransformed(buckets.detail, capGeo, new THREE.Matrix4().makeTranslation(0, lidTop + portH + 0.02, 0));
  }

  // Beam pipe passes straight through the vessel along Z at beam height.
  {
    const g = new THREE.CylinderGeometry(PIPE_R, PIPE_R, 2 * tileHalf, SEGS);
    applyTiledCylinderUVs(g, PIPE_R, 2 * tileHalf, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, 0);
    _pushTransformed(buckets.pipe, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }
  // CF flanges at tile edges
  for (const sign of [-1, 1]) {
    const fg = new THREE.CylinderGeometry(FLANGE_R, FLANGE_R, FLANGE_H, SEGS);
    applyTiledCylinderUVs(fg, FLANGE_R, FLANGE_H, SEGS);
    const frot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const ftrans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, sign * tileHalf);
    _pushTransformed(buckets.detail, fg, new THREE.Matrix4().multiplyMatrices(ftrans, frot));
  }

  return buckets;
}
ROLE_BUILDERS.halfWaveResonator = _buildHalfWaveResonatorRoles;

/**
 * Spoke Cavity — superconducting multi-spoke cryomodule.
 *
 * Vertical rectangular cryostat, taller and longer than the HWR. Two
 * side-mounted RF couplers punch out through the vessel at beam height
 * and two cryo transfer ports rise from the top plate. External
 * stiffener ridges wrap the vessel. Footprint: subW=2, subL=4 → 1 m × 2 m;
 * the beam pipe (X=0) lands on a subtile boundary.
 */
function _buildSpokeCavityRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };

  const magL      = 2.0;                   // tile length along beam (2 m tile)
  const tileEdge  = magL / 2;
  const vesselW   = 0.88;                  // X extent
  const vesselL   = magL - 0.14;           // Z extent (along beam)
  const vesselBot = 0.06;
  const vesselTop = 2.00;                  // rises ~1 m above the beam
  const vesselH   = vesselTop - vesselBot;
  const vesselY   = vesselBot + vesselH / 2;

  // Main cryostat body.
  {
    const g = new THREE.BoxGeometry(vesselW, vesselH, vesselL);
    applyTiledBoxUVs(g, vesselW, vesselH, vesselL);
    _pushTransformed(buckets.pipe, g, new THREE.Matrix4().makeTranslation(0, vesselY, 0));
  }

  // External stiffener ridges (horizontal flange rings).
  const ridgeTh = 0.05;
  const ridgeGrow = 0.08;
  const ridgeYs = [0.32, 0.68, 1.04, 1.40, 1.76];
  for (const y of ridgeYs) {
    const g = new THREE.BoxGeometry(vesselW + ridgeGrow, ridgeTh, vesselL + ridgeGrow);
    applyTiledBoxUVs(g, vesselW + ridgeGrow, ridgeTh, vesselL + ridgeGrow);
    _pushTransformed(buckets.detail, g, new THREE.Matrix4().makeTranslation(0, y, 0));
  }

  // A pair of vertical stiffener strips running the full height on the
  // two broad (±Z) faces — suggests welded box construction.
  const stripW = 0.04, stripD = 0.03;
  for (const zSign of [-1, 1]) {
    for (const xOff of [-vesselW * 0.3, vesselW * 0.3]) {
      const g = new THREE.BoxGeometry(stripW, vesselH, stripD);
      applyTiledBoxUVs(g, stripW, vesselH, stripD);
      _pushTransformed(buckets.detail, g, new THREE.Matrix4().makeTranslation(
        xOff, vesselY, zSign * (vesselL / 2 + stripD / 2)));
    }
  }

  // Top plate
  {
    const plateW = vesselW + 0.16;
    const plateL = vesselL + 0.16;
    const plateH = 0.09;
    const g = new THREE.BoxGeometry(plateW, plateH, plateL);
    applyTiledBoxUVs(g, plateW, plateH, plateL);
    _pushTransformed(buckets.pipe, g, new THREE.Matrix4().makeTranslation(0, vesselTop + plateH / 2, 0));
  }

  // Baseplate foot
  {
    const footW = vesselW + 0.14;
    const footL = vesselL + 0.14;
    const footH = 0.06;
    const g = new THREE.BoxGeometry(footW, footH, footL);
    applyTiledBoxUVs(g, footW, footH, footL);
    _pushTransformed(buckets.stand, g, new THREE.Matrix4().makeTranslation(0, footH / 2, 0));
  }

  // Two side RF couplers (accent) punching through +X at beam height,
  // spaced along Z so each spoke cell gets its own drive.
  const couplerZs = [-vesselL * 0.25, vesselL * 0.25];
  for (const zc of couplerZs) {
    const cW = 0.26, cH = 0.26, cL = 0.42;
    const g = new THREE.BoxGeometry(cL, cH, cW);
    applyTiledBoxUVs(g, cL, cH, cW);
    _pushTransformed(buckets.accent, g, new THREE.Matrix4().makeTranslation(vesselW / 2 + cL / 2, BEAM_HEIGHT, zc));
    const capL = 0.05;
    const capG = new THREE.BoxGeometry(capL, cH * 1.25, cW * 1.25);
    applyTiledBoxUVs(capG, capL, cH * 1.25, cW * 1.25);
    _pushTransformed(buckets.detail, capG, new THREE.Matrix4().makeTranslation(vesselW / 2 + cL + capL / 2, BEAM_HEIGHT, zc));
  }

  // Two cryo transfer ports on top, offset along Z from the couplers.
  const cryoZs = [-vesselL * 0.32, vesselL * 0.32];
  const lidTop = vesselTop + 0.09;
  for (const zc of cryoZs) {
    const portR = 0.09, portH = 0.32;
    const g = new THREE.CylinderGeometry(portR, portR, portH, SEGS);
    applyTiledCylinderUVs(g, portR, portH, SEGS);
    _pushTransformed(buckets.pipe, g, new THREE.Matrix4().makeTranslation(0, lidTop + portH / 2, zc));
    const capGeo = new THREE.CylinderGeometry(portR * 1.5, portR * 1.5, 0.04, SEGS);
    applyTiledCylinderUVs(capGeo, portR * 1.5, 0.04, SEGS);
    _pushTransformed(buckets.detail, capGeo, new THREE.Matrix4().makeTranslation(0, lidTop + portH + 0.02, zc));
  }

  // Beam pipe passes straight through the vessel along Z at beam height.
  {
    const g = new THREE.CylinderGeometry(PIPE_R, PIPE_R, 2 * tileEdge, SEGS);
    applyTiledCylinderUVs(g, PIPE_R, 2 * tileEdge, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, 0);
    _pushTransformed(buckets.pipe, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }
  // CF flanges at tile edges
  for (const sign of [-1, 1]) {
    const fg = new THREE.CylinderGeometry(FLANGE_R, FLANGE_R, FLANGE_H, SEGS);
    applyTiledCylinderUVs(fg, FLANGE_R, FLANGE_H, SEGS);
    const frot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const ftrans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, sign * tileEdge);
    _pushTransformed(buckets.detail, fg, new THREE.Matrix4().multiplyMatrices(ftrans, frot));
  }

  return buckets;
}
ROLE_BUILDERS.spokeCavity = _buildSpokeCavityRoles;

/**
 * Pillbox Cavity — single-cell normal-conducting RF cavity.
 *
 * Footprint: subW=3, subL=2 → 1.5 m × 1 m. Short chunky copper cell with
 * prominent end flanges, a top RF coupler and a bottom pickup probe, and
 * a pair of cooling water tubes running along the sides.
 */
function _buildPillboxCavityRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };

  const tileHalf = 0.5;                   // ±0.5 m along beam (1 m tile in Z)
  const cellR    = 0.4;
  const cellL    = 0.56;                  // main cell length along beam
  const shoulderR = cellR + 0.05;
  const shoulderL = 0.06;

  // Main copper cell body
  {
    const g = new THREE.CylinderGeometry(cellR, cellR, cellL, SEGS);
    applyTiledCylinderUVs(g, cellR, cellL, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, 0);
    _pushTransformed(buckets.copper, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // Shoulder rings at each cell end — slightly wider, step-in profile
  for (const sign of [-1, 1]) {
    const g = new THREE.CylinderGeometry(shoulderR, shoulderR, shoulderL, SEGS);
    applyTiledCylinderUVs(g, shoulderR, shoulderL, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, sign * (cellL / 2 + shoulderL / 2));
    _pushTransformed(buckets.copper, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // Beam pipe stubs + CF end flanges reaching to the tile edges
  for (const sign of [-1, 1]) {
    const stubStart = cellL / 2 + shoulderL;
    const stubL = tileHalf - stubStart;
    if (stubL > 0.001) {
      const g = new THREE.CylinderGeometry(PIPE_R, PIPE_R, stubL, SEGS);
      applyTiledCylinderUVs(g, PIPE_R, stubL, SEGS);
      const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
      const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, sign * (stubStart + stubL / 2));
      _pushTransformed(buckets.pipe, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
    }
    const fg = new THREE.CylinderGeometry(FLANGE_R, FLANGE_R, FLANGE_H, SEGS);
    applyTiledCylinderUVs(fg, FLANGE_R, FLANGE_H, SEGS);
    const frot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const ftrans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, sign * tileHalf);
    _pushTransformed(buckets.detail, fg, new THREE.Matrix4().multiplyMatrices(ftrans, frot));
  }

  // Top RF coupler — chunky cylindrical stub with a flange cap
  {
    const couplerR = 0.1, couplerH = 0.3;
    const g = new THREE.CylinderGeometry(couplerR, couplerR, couplerH, SEGS);
    applyTiledCylinderUVs(g, couplerR, couplerH, SEGS);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT + cellR + couplerH / 2, 0);
    _pushTransformed(buckets.copper, g, trans);
    // Coax-style cap: wider flat disk
    const capGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.04, SEGS);
    applyTiledCylinderUVs(capGeo, 0.16, 0.04, SEGS);
    const capTrans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT + cellR + couplerH + 0.02, 0);
    _pushTransformed(buckets.detail, capGeo, capTrans);
  }

  // Bottom pickup probe — smaller stub on the underside
  {
    const probeR = 0.055, probeH = 0.18;
    const g = new THREE.CylinderGeometry(probeR, probeR, probeH, SEGS);
    applyTiledCylinderUVs(g, probeR, probeH, SEGS);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT - cellR - probeH / 2, 0);
    _pushTransformed(buckets.detail, g, trans);
  }

  // Cooling water tubes — two thin copper tubes running along the cell on
  // each side (±X), curving up to small bosses on top. Modeled here as a
  // horizontal bar + a small vertical elbow stub at each end.
  {
    const tubeR = 0.025;
    const tubeY = BEAM_HEIGHT + 0.02;
    const tubeX = cellR + tubeR + 0.01;
    const tubeL = cellL + 2 * shoulderL;
    for (const xSign of [-1, 1]) {
      // Horizontal run along Z
      const hg = new THREE.CylinderGeometry(tubeR, tubeR, tubeL, 10);
      applyTiledCylinderUVs(hg, tubeR, tubeL, 10);
      const hrot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
      const htrans = new THREE.Matrix4().makeTranslation(xSign * tubeX, tubeY, 0);
      _pushTransformed(buckets.detail, hg, new THREE.Matrix4().multiplyMatrices(htrans, hrot));
      // Small vertical elbow at each end
      for (const zSign of [-1, 1]) {
        const eg = new THREE.CylinderGeometry(tubeR, tubeR, 0.12, 10);
        applyTiledCylinderUVs(eg, tubeR, 0.12, 10);
        const etrans = new THREE.Matrix4().makeTranslation(xSign * tubeX, tubeY + 0.06, zSign * tubeL / 2);
        _pushTransformed(buckets.detail, eg, etrans);
      }
    }
  }

  // Support pedestals at both Z ends — simple two-column style
  const sBaseH = 0.06;
  const sColW  = 0.1;
  const sColD  = 0.16;
  const sColX  = 0.24;
  const sTopY  = BEAM_HEIGHT - cellR - 0.02;
  const sColH  = sTopY - sBaseH;
  for (const zSign of [-1, 1]) {
    const zPos = zSign * (cellL / 2 - sColD / 2);
    const baseW = sColX * 2 + sColW + 0.12;
    const baseD = sColD + 0.04;
    const base = new THREE.BoxGeometry(baseW, sBaseH, baseD);
    applyTiledBoxUVs(base, baseW, sBaseH, baseD);
    const bt = new THREE.Matrix4().makeTranslation(0, sBaseH / 2, zPos);
    _pushTransformed(buckets.stand, base, bt);
    for (const side of [-1, 1]) {
      const col = new THREE.BoxGeometry(sColW, sColH, sColD);
      applyTiledBoxUVs(col, sColW, sColH, sColD);
      const ct = new THREE.Matrix4().makeTranslation(side * sColX, sBaseH + sColH / 2, zPos);
      _pushTransformed(buckets.stand, col, ct);
    }
  }

  return buckets;
}
ROLE_BUILDERS.pillboxCavity = _buildPillboxCavityRoles;

/**
 * 9-cell Elliptical SRF Cavity (ellipticalSrfCavity) — TESLA/XFEL-style
 * superconducting niobium cavity in its helium jacket.
 *
 * Nine elliptical cells strung along the beam axis (peak cell diameter
 * ~210 mm at 1.3 GHz, 115 mm cell period), flanked by short beam tubes.
 * The whole active length (~1.04 m) sits inside a stainless helium vessel
 * with stiffener ridges, a prominent coaxial fundamental-power coupler at
 * one end, a pickup probe at the opposite end, and a liquid-helium transfer
 * port rising from the top. Footprint: subW=2, subL=3 → 1 m × 1.5 m, beam
 * along +Z through X=0.
 */
function _buildEllipticalSrfCavityRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };

  const magL    = 1.5;                       // subL=3 → 1.5 m
  const tileEdge = magL / 2;

  // Nine elliptical cells — scaled spheres for a rounded bead profile.
  // 1.3 GHz TESLA cell geometry: ~210 mm peak diameter, ~115 mm period.
  const cellCount = 9;
  const cellPeakR = 0.16;                    // peak radius of each cell
  const cellPeriod = 0.12;                   // centre-to-centre spacing
  const activeL   = cellCount * cellPeriod;  // ~1.08 m
  const cellZ0    = -activeL / 2 + cellPeriod / 2;
  const cellHalfZ = cellPeriod * 0.60;       // half-length of the ellipsoid (slight overlap at irises)

  for (let i = 0; i < cellCount; i++) {
    const zc = cellZ0 + i * cellPeriod;
    // Sphere scaled to an ellipsoid: waist radius cellPeakR, long half-axis along Z.
    const g = new THREE.SphereGeometry(1, SEGS, Math.max(8, Math.floor(SEGS / 2)));
    g.scale(cellPeakR, cellPeakR, cellHalfZ);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, zc);
    _pushTransformed(buckets.pipe, g, trans);
  }

  // Iris necks between cells — narrow cylinders at each cell junction.
  // Real iris radius ~35 mm (much smaller than cell waist).
  const irisR = 0.055;
  const irisL = 0.015;
  for (let i = 0; i < cellCount - 1; i++) {
    const zc = cellZ0 + (i + 0.5) * cellPeriod;
    const g = new THREE.CylinderGeometry(irisR, irisR, irisL, SEGS);
    applyTiledCylinderUVs(g, irisR, irisL, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, zc);
    _pushTransformed(buckets.pipe, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // End group beam tubes bridging the outermost cells to the module edges.
  const endTubeR = irisR + 0.02;
  for (const sign of [-1, 1]) {
    const innerZ = sign * (activeL / 2);
    const outerZ = sign * (tileEdge - 0.05);
    const tubeL  = Math.abs(outerZ - innerZ);
    if (tubeL > 0.001) {
      const g = new THREE.CylinderGeometry(endTubeR, endTubeR, tubeL, SEGS);
      applyTiledCylinderUVs(g, endTubeR, tubeL, SEGS);
      const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
      const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, (innerZ + outerZ) / 2);
      _pushTransformed(buckets.pipe, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
    }
  }

  // Helium jacket — stainless vessel enclosing the cavity string. Rendered
  // as stiffener rings (open between rings) so the cells stay visible.
  const jacketR = cellPeakR + 0.08;
  const ringL   = 0.035;
  const ringCount = 6;
  for (let i = 0; i < ringCount; i++) {
    const t = i / (ringCount - 1);
    const zr = -activeL / 2 + 0.03 + t * (activeL - 0.06);
    const g = new THREE.CylinderGeometry(jacketR, jacketR, ringL, SEGS);
    applyTiledCylinderUVs(g, jacketR, ringL, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, zr);
    _pushTransformed(buckets.detail, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // End-cap plates of the helium vessel at each end of the cell string.
  const endCapR = jacketR + 0.02;
  const endCapL = 0.04;
  for (const sign of [-1, 1]) {
    const zc = sign * (activeL / 2 + endCapL / 2);
    const g = new THREE.CylinderGeometry(endCapR, endCapR, endCapL, SEGS);
    applyTiledCylinderUVs(g, endCapR, endCapL, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, zc);
    _pushTransformed(buckets.pipe, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // Fundamental-power coupler (FPC) — fat coaxial feed entering from +X at
  // the upstream end. Coaxial outer, then a flared waveguide-to-coax box,
  // then a bolted flange cap.
  const fpcZ = -activeL / 2 + cellPeriod * 0.6;
  {
    const coaxR = 0.09;
    const coaxL = 0.30;
    const coaxX = jacketR + coaxL / 2;
    const g = new THREE.CylinderGeometry(coaxR, coaxR, coaxL, SEGS);
    applyTiledCylinderUVs(g, coaxR, coaxL, SEGS);
    const rot = new THREE.Matrix4().makeRotationZ(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(coaxX, BEAM_HEIGHT, fpcZ);
    _pushTransformed(buckets.accent, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
    // Waveguide transformer box at the outer end
    const boxW = 0.26, boxH = 0.22, boxL = 0.18;
    const boxX = coaxX + coaxL / 2 + boxL / 2;
    const bg = new THREE.BoxGeometry(boxL, boxH, boxW);
    applyTiledBoxUVs(bg, boxL, boxH, boxW);
    _pushTransformed(buckets.accent, bg, new THREE.Matrix4().makeTranslation(boxX, BEAM_HEIGHT, fpcZ));
    // Outer flange cap
    const capL = 0.05;
    const capG = new THREE.BoxGeometry(capL, boxH * 1.15, boxW * 1.15);
    applyTiledBoxUVs(capG, capL, boxH * 1.15, boxW * 1.15);
    _pushTransformed(buckets.detail, capG, new THREE.Matrix4().makeTranslation(boxX + boxL / 2 + capL / 2, BEAM_HEIGHT, fpcZ));
  }

  // Pickup probe — small coaxial sensor at the downstream end, −X side.
  {
    const pR = 0.04, pL = 0.22;
    const pX = -(jacketR + pL / 2);
    const pZ = activeL / 2 - cellPeriod * 0.6;
    const g = new THREE.CylinderGeometry(pR, pR, pL, SEGS);
    applyTiledCylinderUVs(g, pR, pL, SEGS);
    const rot = new THREE.Matrix4().makeRotationZ(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(pX, BEAM_HEIGHT, pZ);
    _pushTransformed(buckets.detail, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // Liquid-helium transfer port — vertical stub rising from the top of the
  // helium jacket near the centre.
  {
    const portR = 0.07, portH = 0.40;
    const portY = BEAM_HEIGHT + jacketR + portH / 2;
    const g = new THREE.CylinderGeometry(portR, portR, portH, SEGS);
    applyTiledCylinderUVs(g, portR, portH, SEGS);
    _pushTransformed(buckets.pipe, g, new THREE.Matrix4().makeTranslation(0, portY, 0));
    // Flange cap on top
    const capR = portR * 1.5;
    const capH = 0.04;
    const capG = new THREE.CylinderGeometry(capR, capR, capH, SEGS);
    applyTiledCylinderUVs(capG, capR, capH, SEGS);
    _pushTransformed(buckets.detail, capG, new THREE.Matrix4().makeTranslation(0, portY + portH / 2 + capH / 2, 0));
  }

  // Beam-pipe stubs + CF flanges at the tile edges.
  for (const sign of [-1, 1]) {
    const stubStart = tileEdge - 0.05;
    const stubL = 0.05;
    const g = new THREE.CylinderGeometry(PIPE_R, PIPE_R, stubL, SEGS);
    applyTiledCylinderUVs(g, PIPE_R, stubL, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, sign * (stubStart + stubL / 2));
    _pushTransformed(buckets.pipe, g, new THREE.Matrix4().multiplyMatrices(trans, rot));

    const fg = new THREE.CylinderGeometry(FLANGE_R, FLANGE_R, FLANGE_H, SEGS);
    applyTiledCylinderUVs(fg, FLANGE_R, FLANGE_H, SEGS);
    const frot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const ftrans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, sign * tileEdge);
    _pushTransformed(buckets.detail, fg, new THREE.Matrix4().multiplyMatrices(ftrans, frot));
  }

  // Two support pedestals carrying the jacket.
  const sBaseH = 0.06;
  const sColW  = 0.22;
  const sColD  = 0.18;
  const sColH  = BEAM_HEIGHT - jacketR - sBaseH;
  for (const t of [0.22, 0.78]) {
    const zPos = -magL / 2 + t * magL;
    const baseW = sColW + 0.16;
    const baseD = sColD + 0.06;
    const base = new THREE.BoxGeometry(baseW, sBaseH, baseD);
    applyTiledBoxUVs(base, baseW, sBaseH, baseD);
    _pushTransformed(buckets.stand, base, new THREE.Matrix4().makeTranslation(0, sBaseH / 2, zPos));
    const col = new THREE.BoxGeometry(sColW, sColH, sColD);
    applyTiledBoxUVs(col, sColW, sColH, sColD);
    _pushTransformed(buckets.stand, col, new THREE.Matrix4().makeTranslation(0, sBaseH + sColH / 2, zPos));
  }

  return buckets;
}
ROLE_BUILDERS.ellipticalSrfCavity = _buildEllipticalSrfCavityRoles;

// Registry: component type id → builder function (legacy path for builders
// that still return a fully-assembled THREE.Group rather than role buckets).
const DETAIL_BUILDERS = {
  source: _buildSource,
  drift: _buildDrift,
};

/**
 * Create a transparent ghost version of a beamline component for placement preview.
 * Returns a THREE.Group with all meshes set to transparent + green edge wireframe.
 */
/**
 * Returns true if a component type renders with its internal origin
 * already at the floor (y=0). True for: role/detail-builder components
 * (they bake BEAM_HEIGHT into their geometry) AND parts-list items
 * (each part is positioned with its y=0 on the floor). Fallback single-
 * box items return false — callers must offset by h/2 to un-bury them.
 */
export function isDetailedComponent(compType, compDef) {
  if (!!ROLE_BUILDERS[compType] || !!DETAIL_BUILDERS[compType]) return true;
  if (compDef && Array.isArray(compDef.parts) && compDef.parts.length > 0) return true;
  return false;
}

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
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();

  // Thumbnail lighting: bright, neutral, no floor. Ambient carries most
  // of the brightness so every face is readable; a strong key from the
  // upper-left and two softer fills round off the form.
  scene.add(new THREE.AmbientLight(0xffffff, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(-5, 8, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.55);
  fill.position.set(6, 3, -4);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.4);
  rim.position.set(0, -4, -2);
  scene.add(rim);

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

  // Frame an orthographic isometric camera tightly around the bounds.
  // In true iso projection (camera at (d,d,d) looking at origin) an AABB
  // of size (sx, sy, sz) projects to a screen rectangle of size
  //   width  = (sx + sz) / sqrt(2)
  //   height = (sx + 2*sy + sz) / sqrt(6)
  // Use that to pick a half-frame that wraps the model with a small pad.
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const bSize = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(bSize.x, bSize.y, bSize.z);
  const projW = (bSize.x + bSize.z) / Math.SQRT2;
  const projH = (bSize.x + 2 * bSize.y + bSize.z) / Math.sqrt(6);
  const halfFrame = Math.max(projW, projH) * 0.55;  // half-dimension + ~10% pad

  const isoDist = maxDim * 4;
  const camera = new THREE.OrthographicCamera(
    -halfFrame, halfFrame, halfFrame, -halfFrame, 0.1, 100,
  );
  camera.position.set(
    center.x + isoDist,
    center.y + isoDist,
    center.z + isoDist,
  );
  camera.lookAt(center);

  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL('image/png');
  _thumbCache.set(compType, dataUrl);

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
    // Parts path: build a Group from the declarative part list. Part
    // coords are SUBTILE units, centered on the footprint, y is the
    // BOTTOM of the part relative to the floor. Matches equipment-
    // builder's parts logic so ghost previews render identically.
    if (Array.isArray(compDef.parts) && compDef.parts.length > 0) {
      const group = new THREE.Group();
      const baseColor = compDef.spriteColor ?? 0x888888;
      for (const part of compDef.parts) {
        const pw = (part.w || 1) * SUB_UNIT;
        const ph = (part.h || 1) * SUB_UNIT;
        const pl = (part.l || 1) * SUB_UNIT;
        const geo = new THREE.BoxGeometry(pw, ph, pl);
        applyTiledBoxUVs(geo, pw, ph, pl);
        const mat = new THREE.MeshStandardMaterial({
          color: part.color ?? baseColor,
          roughness: 0.7, metalness: 0.15,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(
          (part.x || 0) * SUB_UNIT,
          ((part.y || 0) + (part.h || 1) / 2) * SUB_UNIT,
          (part.z || 0) * SUB_UNIT,
        );
        group.add(mesh);
      }
      return group;
    }

    // Visual dims override footprint dims when authored — lets a benchtop
    // instrument occupy a full subtile slot but render at realistic scale.
    const vSubW = compDef.visualSubW ?? compDef.subW ?? 2;
    const vSubH = compDef.visualSubH ?? compDef.subH ?? 2;
    const vSubL = compDef.visualSubL ?? compDef.subL ?? 2;
    const w = vSubW * SUB_UNIT;
    const h = vSubH * SUB_UNIT;
    const l = vSubL * SUB_UNIT;

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
      // Parts-list items also place themselves with y=0 on the floor.
      const isDetailed = isDetailedComponent(type, compDef);

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
