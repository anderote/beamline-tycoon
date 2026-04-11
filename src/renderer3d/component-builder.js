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
export function getAccentMaterial(compType, colorHex) {
  const key = compType + '|' + colorHex.toString(16).padStart(6, '0');
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
  for (const role of ROLES) {
    const tplMesh = template[role];
    if (!tplMesh) continue;
    const mat = role === 'accent'
      ? getAccentMaterial(compType, accentColorHex)
      : SHARED_MATERIALS[role];
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

// ── Role-based builders (template pattern) ──────────────────────────
// These return BufferGeometry buckets rather than assembled Groups.
// Individual primitives are built, positioned via a Matrix4, and baked
// into the geometry so they can be merged per role.

function _pushTransformed(bucket, geom, matrix) {
  geom.applyMatrix4(matrix);
  bucket.push(geom);
}

/**
 * Build the role buckets for a quadrupole magnet.
 *
 * Physical layout (1m x 1m x 1.5m, beam along local +Z):
 *   - 4 painted iron yoke slabs forming a square frame
 *   - 4 dark iron pole tips pointing inward
 *   - 4 copper coil rings wrapped around the poles
 *   - Bolts at the yoke corners (detail LOD)
 *   - Beam pipe straight through the center
 */
function _buildQuadrupoleRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], detail: [] };
  const m4 = new THREE.Matrix4();

  const yokeOuter = 0.55;       // half width of the square yoke
  const wall = 0.14;            // yoke slab thickness
  const magL = 0.9;             // length along beam axis

  // --- Painted yoke slabs (accent role) ---
  // Each slab: [x, y, width, height]
  const slabs = [
    [0,  yokeOuter - wall / 2, yokeOuter * 2, wall],   // top
    [0, -yokeOuter + wall / 2, yokeOuter * 2, wall],   // bottom
    [ yokeOuter - wall / 2, 0, wall, yokeOuter * 2],   // right
    [-yokeOuter + wall / 2, 0, wall, yokeOuter * 2],   // left
  ];
  for (const [x, y, w, h] of slabs) {
    const g = new THREE.BoxGeometry(w, h, magL);
    m4.makeTranslation(x, BEAM_HEIGHT + y, 0);
    _pushTransformed(buckets.accent, g, m4);
  }

  // --- Dark iron pole tips (iron role) ---
  // Each pole points inward along (dx, dy). Exactly one of dx/dy is nonzero.
  const poleLen = 0.28;
  const poleHalf = 0.13;
  const poles = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  for (const [dx, dy] of poles) {
    const g = new THREE.BoxGeometry(
      dx !== 0 ? poleLen : poleHalf * 2,
      dy !== 0 ? poleLen : poleHalf * 2,
      magL * 0.85
    );
    const off = yokeOuter - wall - poleLen / 2;
    m4.makeTranslation(dx * off, BEAM_HEIGHT + dy * off, 0);
    _pushTransformed(buckets.iron, g, m4);
  }

  // --- Copper coils wrapping each pole base (copper role) ---
  // Torus oriented so its hole aligns with the pole axis.
  for (const [dx, dy] of poles) {
    const g = new THREE.TorusGeometry(poleHalf + 0.05, 0.05, 10, 24);
    m4.identity();
    // Rotate torus ring so its axis matches the pole (default is Z-axis).
    if (dx !== 0) {
      // pole axis along X
      m4.makeRotationY(Math.PI / 2);
    } else {
      // pole axis along Y
      m4.makeRotationX(Math.PI / 2);
    }
    const trans = new THREE.Matrix4().makeTranslation(
      dx * (yokeOuter - wall - poleLen / 2 - 0.06),
      BEAM_HEIGHT + dy * (yokeOuter - wall - poleLen / 2 - 0.06),
      0
    );
    const full = new THREE.Matrix4().multiplyMatrices(trans, m4);
    _pushTransformed(buckets.copper, g, full);
  }

  // --- Beam pipe through the center (pipe role) ---
  const pipeL = magL + 0.4; // slightly longer than the magnet to meet neighbors
  const pipeGeom = new THREE.CylinderGeometry(PIPE_R, PIPE_R, pipeL, SEGS);
  m4.identity();
  m4.makeRotationX(Math.PI / 2);
  const pipeT = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, 0);
  const pipeFull = new THREE.Matrix4().multiplyMatrices(pipeT, m4);
  _pushTransformed(buckets.pipe, pipeGeom, pipeFull);

  // --- Bolts at yoke corners (detail role, LOD-hidden) ---
  const boltOffsets = [
    [ yokeOuter - 0.05,  yokeOuter - 0.05],
    [-yokeOuter + 0.05,  yokeOuter - 0.05],
    [ yokeOuter - 0.05, -yokeOuter + 0.05],
    [-yokeOuter + 0.05, -yokeOuter + 0.05],
  ];
  for (const [x, y] of boltOffsets) {
    for (const sign of [-1, 1]) {
      const g = new THREE.BoxGeometry(0.05, 0.05, 0.03);
      m4.makeTranslation(x, BEAM_HEIGHT + y, sign * (magL / 2 + 0.015));
      _pushTransformed(buckets.detail, g, m4);
    }
  }

  return buckets;
}

ROLE_BUILDERS.quadrupole = _buildQuadrupoleRoles;

/**
 * Build the role buckets for a dipole bending magnet.
 *
 * Physical layout (3m x 1.5m x 2m, beam along local +Z):
 *   - H-frame painted iron yoke: top slab, bottom slab, two side posts
 *   - Fixed orange accent stripe along the top edge (iron role, not accent)
 *   - Dark iron pole face visible in the gap between coils
 *   - Two copper coil bundles at the ends of the pole gap
 *   - Row of bolts along the visible yoke edge (detail LOD)
 *   - Straight beam pipe through the gap
 *
 * Note: the actual 90-degree beam bend is handled by the beam graph
 * logic, not this geometry — the model is visually straight.
 */
function _buildDipoleRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], detail: [] };
  const m4 = new THREE.Matrix4();

  const yokeW = 1.4;
  const yokeH = 1.6;
  const yokeL = 2.2;
  const wall = 0.22;

  // --- Painted H-frame slabs (accent role) ---
  const slabs = [
    // [w, h, l, x, y, z]
    [yokeW, wall, yokeL, 0,  yokeH / 2 - wall / 2,  0],  // top
    [yokeW, wall, yokeL, 0, -yokeH / 2 + wall / 2,  0],  // bottom
    [wall, yokeH, yokeL, -yokeW / 2 + wall / 2, 0, 0],   // left post
    [wall, yokeH, yokeL,  yokeW / 2 - wall / 2, 0, 0],   // right post
  ];
  for (const [w, h, l, x, y, z] of slabs) {
    const g = new THREE.BoxGeometry(w, h, l);
    m4.makeTranslation(x, BEAM_HEIGHT + y, z);
    _pushTransformed(buckets.accent, g, m4);
  }

  // --- Fixed contrast stripe (iron role — not recolored) ---
  // We want this to stay visible regardless of the accent paint color,
  // so we bucket it as a dark element rather than accent.
  const stripeGeom = new THREE.BoxGeometry(yokeW + 0.02, 0.08, yokeL * 0.9);
  m4.makeTranslation(0, BEAM_HEIGHT + yokeH / 2 + 0.04, 0);
  _pushTransformed(buckets.iron, stripeGeom, m4);

  // --- Dark iron pole face in the gap ---
  const poleFace = new THREE.BoxGeometry(yokeW - wall * 2 - 0.15, 0.4, yokeL - 0.3);
  m4.makeTranslation(0, BEAM_HEIGHT - 0.2, 0);
  _pushTransformed(buckets.iron, poleFace, m4);

  // --- Copper coil bundles at each end of the pole ---
  for (const sign of [-1, 1]) {
    const g = new THREE.BoxGeometry(yokeW - wall * 2 - 0.05, 0.28, 0.18);
    m4.makeTranslation(0, BEAM_HEIGHT + 0.1, sign * (yokeL / 2 - 0.09));
    _pushTransformed(buckets.copper, g, m4);
  }

  // --- Straight beam pipe through the gap ---
  const pipeL = yokeL + 0.6;
  const pipeGeom = new THREE.CylinderGeometry(PIPE_R, PIPE_R, pipeL, SEGS);
  const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, 0);
  const full = new THREE.Matrix4().multiplyMatrices(trans, rot);
  _pushTransformed(buckets.pipe, pipeGeom, full);

  // --- Bolts along the visible upper yoke edge (detail LOD) ---
  for (let i = -2; i <= 2; i++) {
    const g = new THREE.BoxGeometry(0.07, 0.07, 0.04);
    m4.makeTranslation(
      yokeW / 2 + 0.012,
      BEAM_HEIGHT + yokeH / 2 - wall - 0.08,
      i * 0.45
    );
    _pushTransformed(buckets.detail, g, m4);
  }

  return buckets;
}

ROLE_BUILDERS.dipole = _buildDipoleRoles;

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
    const hitGeo = new THREE.BoxGeometry(Math.max(w, 0.8), h, Math.max(l, 0.8));
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
