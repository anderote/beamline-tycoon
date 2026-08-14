// src/renderer3d/builders/cryo-builder.js
//
// Role-bucket builders for the cryogenic plant — the helium refrigeration
// chain that stands behind every SRF cavity in the building. All items are
// floor-standing modules (placement: 'module').
//
// These are the most expensive objects in the game, so they get the most
// silhouette. The camera is a 2:1 dimetric ortho, which means the reader sees
// a roof and two walls and essentially no fine detail: what has to carry is
// the overall massing — a tall instrumented tower reads as a cold box, a long
// horizontal cylinder on posts reads as a cryomodule, a low chunky skid with
// one vertical vessel on it reads as a compressor. Detail-bucket geometry is
// there for the zoomed-in view and is deliberately never load-bearing.
//
// Conventions match component-builder.js:
//   - Origin at footprint center, y = 0 at floor.
//   - 1 sub-tile = 0.5 m, so a gridW×gridH module is (gridW/2) m × (gridH/2) m.
//   - Long axis is +Z (gridH); +X is the module's width (gridW).
//   - THREE is a CDN global — do NOT import it.
//
// None of these components carry a `faces` decal any more: a ROLE_BUILDERS
// entry short-circuits the fallback mesh path, so `faces` would be dead config.

import { applyTiledBoxUVs, applyTiledCylinderUVs } from '../uv-utils.js';

const SEGS = 16;

function pushT(bucket, geom, matrix) {
  geom.applyMatrix4(matrix);
  bucket.push(geom);
}
function trans(x, y, z) {
  return new THREE.Matrix4().makeTranslation(x, y, z);
}
function rotX(angle) {
  return new THREE.Matrix4().makeRotationX(angle);
}
function rotZ(angle) {
  return new THREE.Matrix4().makeRotationZ(angle);
}

function makeBuckets() {
  return { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };
}

// ── Small shared primitives ─────────────────────────────────────────

/** Upright box. */
function box(b, role, w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  applyTiledBoxUVs(g, w, h, d);
  pushT(b[role], g, trans(x, y, z));
}

/** Upright cylinder, centred at (x, y, z). */
function cyl(b, role, r, h, x, y, z, segs = SEGS) {
  const g = new THREE.CylinderGeometry(r, r, h, segs);
  applyTiledCylinderUVs(g, r, h, segs);
  pushT(b[role], g, trans(x, y, z));
}

/** Cylinder lying along Z. */
function cylZ(b, role, r, len, x, y, z, segs = SEGS) {
  const g = new THREE.CylinderGeometry(r, r, len, segs);
  applyTiledCylinderUVs(g, r, len, segs);
  pushT(b[role], g, new THREE.Matrix4().multiplyMatrices(trans(x, y, z), rotX(Math.PI / 2)));
}

/** Cylinder lying along X. */
function cylX(b, role, r, len, x, y, z, segs = SEGS) {
  const g = new THREE.CylinderGeometry(r, r, len, segs);
  applyTiledCylinderUVs(g, r, len, segs);
  pushT(b[role], g, new THREE.Matrix4().multiplyMatrices(trans(x, y, z), rotZ(Math.PI / 2)));
}

/** Truncated cone (dished head), narrow end up. */
function cone(b, role, rTop, rBase, h, x, y, z, segs = SEGS) {
  const g = new THREE.CylinderGeometry(rTop, rBase, h, segs);
  applyTiledCylinderUVs(g, Math.max(rTop, rBase), h, segs);
  pushT(b[role], g, trans(x, y, z));
}

/** Dished head on a horizontal vessel, capping the ±Z end. */
function coneZ(b, role, rTop, rBase, h, x, y, z, zSign, segs = SEGS) {
  const g = new THREE.CylinderGeometry(rTop, rBase, h, segs);
  applyTiledCylinderUVs(g, Math.max(rTop, rBase), h, segs);
  pushT(b[role], g, new THREE.Matrix4().multiplyMatrices(
    trans(x, y, z), rotX(zSign * Math.PI / 2)));
}

// ── Cold boxes ──────────────────────────────────────────────────────
//
// The 4 K and 2 K boxes are siblings on the same 2.0 m × 4.0 m × 2.5 m plate,
// and the pair has to read as a ladder rung rather than a palette swap: the
// 2 K unit costs nearly twice as much and does the harder job. Since the tile
// envelope is identical, the difference is carried by how much of it each one
// fills. The 4 K box uses a 1.64 m skid, a r = 0.62 tower and two expanders,
// topping out at 2.22 m. The 2 K box uses the full 1.90 m skid, a r = 0.80
// tower, three expanders at 2.46 m — and, crucially, a feature the 4 K plant
// does not have at all: the sub-atmospheric cold-compressor string and its fat
// suction header, which is the actual machinery of getting below 4.2 K.

/**
 * 4K Cold Box — 4×8 floor module, subH 5.
 *
 * A vacuum-jacketed refrigerator tower over the -Z half of the plate with two
 * turbine expanders on its head, and a liquid-helium distribution can over the
 * +Z half fed by a jacketed transfer line.
 *
 * Footprint 2.0 m (X) × 4.0 m (Z), height 2.5 m. Extremes: the control cabinet
 * at x = -0.83 and the skid at x = 0.82 / z = ±1.82, and the turbine instrument
 * cap at y = 2.22.
 */
export function _buildColdBox4KRoles() {
  const b = makeBuckets();

  // Skid — deliberately inset from the tile edge so the 2 K box next door
  // reads as the bigger machine.
  box(b, 'stand', 1.64, 0.10, 3.64, 0, 0.05, 0);
  for (const cz of [-1.45, -0.45, 0.55, 1.55]) {
    box(b, 'stand', 1.64, 0.10, 0.14, 0, 0.15, cz);
  }

  // ── Refrigerator tower ──
  const towZ = -1.05, towR = 0.62, towH = 1.40;
  const towTop = 0.10 + towH;                 // 1.50
  cyl(b, 'iron', towR, towH, 0, 0.10 + towH / 2, towZ);
  // Support skirt
  cyl(b, 'stand', towR + 0.04, 0.12, 0, 0.16, towZ);
  // Jacket weld bands — the tell that this is vacuum-jacketed, not a tank
  for (const by of [0.46, 0.86, 1.26]) {
    cyl(b, 'detail', towR + 0.025, 0.05, 0, by, towZ);
  }
  // Head flange, then the dished top head
  cyl(b, 'detail', towR + 0.045, 0.05, 0, towTop - 0.02, towZ);
  cone(b, 'iron', 0.20, towR, 0.24, 0, towTop + 0.12, towZ);
  const headTop = towTop + 0.24;              // 1.74

  // Two turbine expanders on the head
  for (const tx of [-0.26, 0.26]) {
    cyl(b, 'pipe', 0.15, 0.24, tx, headTop + 0.12, towZ);          // housing
    cyl(b, 'detail', 0.09, 0.16, tx, headTop + 0.32, towZ);        // brake head
    cyl(b, 'accent', 0.05, 0.08, tx, headTop + 0.44, towZ, 8);     // instrument cap
    // Cold return leg down the tower's +Z face
    cyl(b, 'copper', 0.05, 0.80, tx, 1.14, towZ + towR + 0.05, 8);
  }

  // Relief stack off the head shoulder
  cyl(b, 'accent', 0.045, 0.36, 0, headTop + 0.18, towZ - 0.34, 8);

  // Warm-end interface block where the compressor line lands
  box(b, 'iron', 0.66, 0.52, 0.58, -0.42, 0.36, 0.20);
  cylZ(b, 'copper', 0.09, 0.40, -0.42, 0.48, -0.24, 8);

  // ── Jacketed transfer line, tower to distribution can ──
  cyl(b, 'pipe', 0.12, 0.58, 0.50, 0.74, -0.44);                   // riser
  cylZ(b, 'pipe', 0.12, 1.90, 0.50, 1.00, 0.52);
  for (const wz of [-0.20, 0.44, 1.08]) {
    cylZ(b, 'detail', 0.14, 0.05, 0.50, 1.00, wz);
  }

  // ── Liquid-helium distribution can ──
  const canZ = 1.32, canR = 0.34, canH = 0.80;
  cyl(b, 'pipe', canR, canH, -0.05, 0.10 + canH / 2, canZ);
  cyl(b, 'stand', canR + 0.05, 0.10, -0.05, 0.15, canZ);
  cone(b, 'pipe', 0.10, canR, 0.16, -0.05, 0.98, canZ);
  // Valve stems with handwheels on the can head
  for (const vx of [-0.20, 0.10]) {
    cyl(b, 'detail', 0.032, 0.26, vx, 1.19, canZ, 8);
    cyl(b, 'accent', 0.09, 0.03, vx, 1.335, canZ, 8);
  }
  // Bayonet outlets off both sides of the can
  for (const s of [-1, 1]) {
    cylX(b, 'pipe', 0.09, 0.18, -0.05 + s * 0.43, 0.62, canZ, 8);
    cylX(b, 'detail', 0.115, 0.03, -0.05 + s * 0.525, 0.62, canZ, 8);
  }

  // Control cabinet against the -X rail
  box(b, 'accent', 0.14, 0.85, 0.70, -0.76, 0.525, -0.60);

  return b;
}

/**
 * 2K Cold Box — 4×8 floor module, subH 5.
 *
 * The same plate as the 4 K box, filled. A fatter, taller refrigerator tower
 * with three turbine expanders, plus the machinery that actually makes 2 K:
 * a string of four cold compressors of increasing size on a common cold header
 * and the sub-atmospheric suction line they pull through.
 *
 * Footprint 2.0 m (X) × 4.0 m (Z), height 2.5 m. Extremes: the control cabinet
 * at x = -0.95 and the skid at x = 0.95 / z = ±1.95, and the turbine instrument
 * cap at y = 2.46.
 */
export function _buildColdBox2KRoles() {
  const b = makeBuckets();

  // Full-plate skid with cross members
  box(b, 'stand', 1.90, 0.14, 3.90, 0, 0.07, 0);
  for (const cz of [-1.45, -0.55, 0.55, 1.45]) {
    box(b, 'stand', 1.90, 0.12, 0.16, 0, 0.20, cz);
  }

  // ── Refrigerator tower ──
  const towZ = -1.05, towR = 0.80, towH = 1.68;
  const towTop = 0.14 + towH;                 // 1.82
  cyl(b, 'iron', towR, towH, 0, 0.14 + towH / 2, towZ);
  cyl(b, 'stand', towR + 0.05, 0.14, 0, 0.21, towZ);
  for (const by of [0.50, 0.92, 1.34, 1.72]) {
    cyl(b, 'detail', towR + 0.03, 0.06, 0, by, towZ);
  }
  cone(b, 'iron', 0.26, towR, 0.26, 0, towTop + 0.13, towZ);
  const headTop = towTop + 0.26;              // 2.08

  // Three turbine expanders — the 4 K box has two.
  for (const tx of [-0.42, 0, 0.42]) {
    cyl(b, 'pipe', 0.16, 0.22, tx, headTop + 0.11, towZ);
    cyl(b, 'detail', 0.10, 0.10, tx, headTop + 0.27, towZ);
    cyl(b, 'accent', 0.055, 0.06, tx, headTop + 0.35, towZ, 8);
    // Cold return legs down the tower's +Z face
    cyl(b, 'copper', 0.06, 0.95, tx, 1.30, towZ + towR + 0.06, 8);
  }
  // Relief stacks on the head shoulder, where the cone is still wide enough
  for (const rx of [-0.58, 0.58]) {
    cyl(b, 'accent', 0.05, 0.40, rx, 2.13, towZ, 8);
  }

  // ── Sub-atmospheric cold-compressor string ──
  // Four stages in series, each bigger than the last because the gas is
  // expanding as the pressure drops. This is the 2 K plant's signature and
  // the 4 K box has no equivalent.
  const strX = 0.42;
  box(b, 'iron', 0.72, 0.22, 1.96, strX, 0.25, 0.78);
  const stages = [
    { z: 0.00, r: 0.20 },
    { z: 0.52, r: 0.23 },
    { z: 1.04, r: 0.26 },
    { z: 1.56, r: 0.29 },
  ];
  for (const st of stages) {
    cyl(b, 'pipe', st.r, 0.44, strX, 0.58, st.z);                  // impeller can
    cyl(b, 'iron', st.r * 0.75, 0.34, strX, 0.97, st.z);           // drive motor
    cyl(b, 'accent', st.r * 0.5, 0.06, strX, 1.17, st.z, 8);       // top flange
    cyl(b, 'copper', 0.08, 0.24, strX, 1.22, st.z, 8);             // riser to header
  }

  // Sub-atmospheric suction header — fat because the gas is at 30 mbar.
  cylZ(b, 'pipe', 0.20, 2.86, strX, 1.42, 0.30);
  for (const wz of [-0.80, -0.10, 0.60, 1.30]) {
    cylZ(b, 'detail', 0.225, 0.06, strX, 1.42, wz);
  }

  // ── Liquid-helium distribution can on the -X side ──
  const canX = -0.48, canZ = 0.95, canR = 0.42, canH = 1.10;
  cyl(b, 'pipe', canR, canH, canX, 0.14 + canH / 2, canZ);
  cyl(b, 'stand', canR + 0.05, 0.12, canX, 0.20, canZ);
  cone(b, 'pipe', 0.12, canR, 0.20, canX, 1.34, canZ);
  for (const vz of [-0.24, 0.24]) {
    for (const vx of [-0.20, 0.20]) {
      cyl(b, 'detail', 0.04, 0.30, canX + vx, 1.59, canZ + vz, 8);
      cyl(b, 'accent', 0.10, 0.035, canX + vx, 1.7575, canZ + vz, 8);
    }
  }

  // Warm-return line to the compressor house, at ankle height
  cylZ(b, 'copper', 0.10, 3.20, -0.72, 0.30, 0);
  // Control cabinet
  box(b, 'accent', 0.16, 1.00, 0.80, -0.87, 0.64, -0.90);
  // Instrument rack on the skid, +X side
  box(b, 'accent', 0.12, 0.60, 0.44, 0.88, 0.44, -1.55);

  return b;
}

// ── Helium compressor ───────────────────────────────────────────────

/**
 * Helium Compressor — 4×6 floor module, subH 4.
 *
 * An oil-flooded screw compressor skid: a big TEFC motor coupled through a
 * guard to the screw body along -X, and the oil system along +X — separator
 * vessel, aftercooler, and the suction line coming back from the plant. Chunky
 * and floor-hugging on purpose: this is the only piece of the cryo plant that
 * is warm, dirty and mechanical, and it should not look like a cold box.
 *
 * Footprint 2.0 m (X) × 3.0 m (Z), height 2.0 m. Extremes: the suction line at
 * x = 0.97, the skid at x = -0.95 / z = ±1.45, and the separator relief valve
 * at y = 1.82.
 */
export function _buildHeCompressorRoles() {
  const b = makeBuckets();

  // ── Heavy skid ──
  box(b, 'stand', 1.90, 0.12, 2.90, 0, 0.06, 0);
  for (const rx of [-0.85, 0.85]) {
    box(b, 'stand', 0.16, 0.16, 2.90, rx, 0.20, 0);
  }
  for (const cz of [-1.20, 0, 1.20]) {
    box(b, 'stand', 1.90, 0.12, 0.16, 0, 0.18, cz);
  }
  // Anti-vibration feet
  for (const fx of [-0.78, 0.78]) {
    for (const fz of [-1.28, 1.28]) {
      box(b, 'iron', 0.20, 0.06, 0.20, fx, 0.03, fz);
    }
  }

  // ── Motor / compressor train along -X ──
  const trainX = -0.44, axisY = 0.72;
  // Motor — the biggest single mass on the skid
  cylZ(b, 'iron', 0.40, 1.05, trainX, axisY, -0.80);
  for (let i = 0; i < 6; i++) {
    cylZ(b, 'detail', 0.43, 0.05, trainX, axisY, -1.25 + i * 0.18);
  }
  coneZ(b, 'iron', 0.24, 0.40, 0.12, trainX, axisY, -1.385, -1);
  coneZ(b, 'iron', 0.26, 0.40, 0.10, trainX, axisY, -0.325, 1);
  // Terminal box and motor feet
  box(b, 'accent', 0.26, 0.18, 0.34, trainX, 1.21, -0.80);
  for (const fz of [-1.10, -0.50]) {
    box(b, 'stand', 0.62, 0.28, 0.16, trainX, 0.26, fz);
  }
  // Coupling guard
  box(b, 'detail', 0.44, 0.44, 0.26, trainX, axisY, -0.13);
  // Screw compressor body + inlet housing
  cylZ(b, 'iron', 0.30, 0.72, trainX, axisY, 0.36);
  box(b, 'iron', 0.56, 0.58, 0.30, trainX, 0.66, 0.87);
  // Slide-valve actuator on top of the rotor casing
  cyl(b, 'accent', 0.08, 0.22, trainX, 1.13, 0.36, 8);
  // Discharge riser out the +Z end, then across to the separator
  cyl(b, 'copper', 0.10, 0.62, trainX, 1.03, 0.80, 8);
  cylX(b, 'copper', 0.10, 0.94, -0.01, 1.34, 0.80, 8);

  // ── Oil separator ──
  const sepX = 0.46, sepZ = 0.80, sepR = 0.38, sepH = 1.24;
  cyl(b, 'pipe', sepR, sepH, sepX, 0.12 + sepH / 2, sepZ);
  cyl(b, 'stand', sepR + 0.04, 0.14, sepX, 0.19, sepZ);
  cone(b, 'pipe', 0.12, sepR, 0.20, sepX, 1.46, sepZ);
  cyl(b, 'accent', 0.05, 0.26, sepX, 1.69, sepZ, 8);              // relief valve
  box(b, 'accent', 0.03, 0.34, 0.08, sepX + sepR + 0.02, 0.55, sepZ);  // sight glass
  cylX(b, 'copper', 0.05, 0.14, sepX - sepR - 0.07, 0.30, sepZ, 8);    // oil drain
  // Separator to aftercooler
  cylZ(b, 'copper', 0.09, 1.20, sepX, 0.98, 0.00);

  // ── Aftercooler ──
  const acZ = -0.86;
  box(b, 'iron', 0.62, 0.72, 0.66, sepX, 0.48, acZ);
  for (let i = 0; i < 6; i++) {
    box(b, 'detail', 0.66, 0.60, 0.03, sepX, 0.48, acZ - 0.26 + i * 0.105);
  }
  box(b, 'detail', 0.66, 0.08, 0.70, sepX, 0.88, acZ);
  for (const hy of [0.30, 0.68]) {
    cylX(b, 'copper', 0.06, 0.66, sepX, hy, acZ - 0.37, 8);
  }

  // ── Suction line back from the plant, plus its filter ──
  cylZ(b, 'copper', 0.11, 2.60, 0.86, 0.30, 0);
  cyl(b, 'pipe', 0.16, 0.60, 0.80, 0.72, 1.10);
  cone(b, 'pipe', 0.06, 0.16, 0.12, 0.80, 1.08, 1.10);

  // Control panel on the -X rail
  box(b, 'accent', 0.14, 0.90, 0.60, -0.88, 0.57, 1.00);

  return b;
}

// ── Cryomodule housing ──────────────────────────────────────────────

/**
 * Cryomodule Housing — 4×8 floor module, subH 5.
 *
 * The long horizontal vacuum vessel of an SRF cryomodule: a r = 0.68 m
 * cylinder on two support posts, dished heads at each end, beam-line flanges
 * on the axis, and the helium supply/return chimneys standing off the top.
 * The whole read at game zoom is "long tube on legs", which is exactly what a
 * cryomodule looks like on the floor of a linac tunnel.
 *
 * Footprint 2.0 m (X) × 4.0 m (Z), height 2.5 m. Extremes: the vacuum gate
 * valve at x = 0.96, the cable tray at x = -0.94, the beam-pipe stub at
 * z = ±1.95, and the main supply chimney cap at y = 2.30.
 */
export function _buildCryomoduleHousingRoles() {
  const b = makeBuckets();

  const vesR = 0.68, vesL = 3.20, axisY = 1.02;
  const vesTop = axisY + vesR;                 // 1.70

  // ── Support posts ──
  for (const pz of [-1.05, 1.05]) {
    box(b, 'stand', 1.10, 0.08, 0.36, 0, 0.04, pz);
    for (const lx of [-0.40, 0.40]) {
      box(b, 'stand', 0.16, 0.30, 0.24, lx, 0.23, pz);
    }
    // Saddle clamp ring around the vessel
    cylZ(b, 'stand', vesR + 0.05, 0.16, 0, axisY, pz);
  }
  // Floor rails tying the posts together
  for (const rx of [-0.46, 0.46]) {
    box(b, 'stand', 0.12, 0.08, 2.60, rx, 0.04, 0);
  }

  // ── Vacuum vessel ──
  cylZ(b, 'iron', vesR, vesL, 0, axisY, 0);
  for (const zSign of [-1, 1]) {
    cylZ(b, 'detail', vesR + 0.06, 0.06, 0, axisY, zSign * 1.63);
    coneZ(b, 'iron', 0.20, vesR, 0.20, 0, axisY, zSign * 1.70, zSign);
  }
  // Girth stiffeners
  for (const gz of [-1.05, -0.35, 0.35, 1.05]) {
    cylZ(b, 'detail', vesR + 0.03, 0.07, 0, axisY, gz);
  }

  // ── Beam-line interface, both ends ──
  for (const zSign of [-1, 1]) {
    cylZ(b, 'copper', 0.09, 0.20, 0, axisY, zSign * 1.85, 8);
    cylZ(b, 'copper', 0.16, 0.06, 0, axisY, zSign * 1.82, 8);
  }

  // ── Top penetrations ──
  // Main helium supply chimney at mid-span, two smaller return ports either
  // side. These are what mark it as a cryomodule and not a pressure vessel.
  cyl(b, 'detail', 0.24, 0.05, 0, vesTop + 0.01, 0);
  cyl(b, 'pipe', 0.19, 0.44, 0, vesTop + 0.22, 0);
  cyl(b, 'accent', 0.13, 0.16, 0, vesTop + 0.52, 0);
  for (const cz of [-0.80, 0.80]) {
    cyl(b, 'detail', 0.19, 0.05, 0, vesTop + 0.01, cz);
    cyl(b, 'pipe', 0.15, 0.36, 0, vesTop + 0.18, cz);
    cyl(b, 'accent', 0.11, 0.14, 0, vesTop + 0.43, cz);
  }
  // Two-phase return header running the length of the roof
  cylZ(b, 'copper', 0.10, 2.20, 0.36, 2.00, 0);
  for (const sz of [-0.80, 0, 0.80]) {
    cylX(b, 'copper', 0.07, 0.36, 0.18, 2.00, sz, 8);
  }
  // Burst disc
  cyl(b, 'accent', 0.09, 0.26, 0, vesTop + 0.13, 1.40, 8);

  // ── Vacuum pump-out port and its gate valve, +X face ──
  cylX(b, 'pipe', 0.18, 0.28, 0.82, axisY, 1.20, 8);
  box(b, 'iron', 0.12, 0.36, 0.36, 0.90, axisY, 1.20);
  cyl(b, 'accent', 0.05, 0.18, 0.90, axisY + 0.27, 1.20, 8);

  // ── Instrumentation, -X face ──
  for (const iz of [-1.10, -0.30, 0.50]) {
    box(b, 'accent', 0.12, 0.22, 0.30, -0.74, 0.90, iz);
  }
  box(b, 'stand', 0.20, 0.10, 2.80, -0.84, 0.55, 0);

  return b;
}

// ── Cryogenic valve box ─────────────────────────────────────────────

/**
 * Cryogenic Valve Box — 2×3 floor module, subH 3.
 *
 * Small, but unmistakably cryo hardware rather than an anonymous cube: a
 * vacuum-jacketed can with bayonet connections poking out all four faces,
 * valve stems standing well proud of the lid with handwheels on top, and a
 * relief stack. The stems are the silhouette — a plain box this size vanishes
 * at game zoom, and the stems give it a readable profile.
 *
 * Footprint 1.0 m (X) × 1.5 m (Z), height 1.5 m. Extremes: a side-tap blank
 * flange at x = 0.495, a bayonet nose at z = ±0.74, and the control-valve
 * handwheel at y = 1.435.
 */
export function _buildCryoValveBoxRoles() {
  const b = makeBuckets();

  // Base plate and the jacketed can
  box(b, 'stand', 0.84, 0.06, 1.30, 0, 0.03, 0);
  box(b, 'pipe', 0.72, 0.84, 1.16, 0, 0.48, 0);
  // Corner posts / edge trim
  for (const px2 of [-0.325, 0.325]) {
    for (const pz of [-0.545, 0.545]) {
      box(b, 'stand', 0.07, 0.84, 0.07, px2, 0.48, pz);
    }
  }
  // Lid
  box(b, 'detail', 0.78, 0.06, 1.22, 0, 0.93, 0);

  // ── Valve stems ──
  // Three: two isolation valves and, in the middle, a taller control valve.
  const stems = [
    { z: -0.42, h: 0.24 },
    { z: 0.00, h: 0.30 },
    { z: 0.42, h: 0.24 },
  ];
  for (const st of stems) {
    cyl(b, 'iron', 0.075, 0.14, -0.14, 1.03, st.z, 8);            // bonnet
    cyl(b, 'detail', 0.030, st.h, -0.14, 1.10 + st.h / 2, st.z, 8);
    cyl(b, 'accent', 0.105, 0.035, -0.14, 1.10 + st.h + 0.0175, st.z, 8);
  }

  // ── Bayonet connections ──
  // ±Z faces: the through-line, two lines per face (supply and return).
  for (const zSign of [-1, 1]) {
    for (const bx of [-0.20, 0.20]) {
      cylZ(b, 'pipe', 0.095, 0.16, bx, 0.50, zSign * 0.66, 8);
      cylZ(b, 'detail', 0.12, 0.03, bx, 0.50, zSign * 0.725, 8);
    }
  }
  // +X face: the branch taps that feed the cryomodules on the segment.
  for (const tz of [-0.30, 0.30]) {
    cylX(b, 'pipe', 0.075, 0.12, 0.42, 0.36, tz, 8);
    cylX(b, 'detail', 0.09, 0.025, 0.4825, 0.36, tz, 8);
  }

  // Relief stack and burst disc on the lid
  cyl(b, 'accent', 0.045, 0.30, 0.20, 1.11, -0.34, 8);
  cyl(b, 'accent', 0.08, 0.03, 0.20, 1.275, -0.34, 8);
  // Vacuum pump-out port with a blank flange
  cyl(b, 'detail', 0.05, 0.16, 0.20, 1.04, 0.34, 8);
  cyl(b, 'accent', 0.08, 0.025, 0.20, 1.1325, 0.34, 8);

  // Instrument box on the -X face
  box(b, 'accent', 0.06, 0.26, 0.34, -0.39, 0.50, 0.10);
  // Lifting lugs
  for (const lx of [-0.26, 0.26]) {
    for (const lz of [-0.44, 0.44]) {
      box(b, 'stand', 0.04, 0.10, 0.14, lx, 1.01, lz);
    }
  }

  return b;
}
