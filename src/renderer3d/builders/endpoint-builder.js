// src/renderer3d/builders/endpoint-builder.js
// 3D role-based builders for beamline endpoint components:
// Faraday Cup, Beam Stop, Detector, Target.
// THREE is a CDN global — do NOT import it.

import { applyTiledBoxUVs, applyTiledCylinderUVs } from '../uv-utils.js';

const SEGS       = 16;
const BEAM_HEIGHT = 1.0;
const PIPE_R      = 0.08;
const FLANGE_R    = 0.16;
const FLANGE_H    = 0.045;
const SUB_UNIT    = 0.5;

function _pushTransformed(bucket, geom, matrix) {
  geom.applyMatrix4(matrix);
  bucket.push(geom);
}

function _makeBuckets() {
  return { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };
}

// ── Helper: standard entry flange + pipe stub at -Z tile edge ────────
// Endpoints only have a beam entry on the back face (-Z).
function _addEntryFlange(buckets, tileHalfZ, stubStart) {
  const m4 = new THREE.Matrix4();
  const stubL = tileHalfZ - stubStart;
  if (stubL > 0.001) {
    const g = new THREE.CylinderGeometry(PIPE_R, PIPE_R, stubL, SEGS);
    applyTiledCylinderUVs(g, PIPE_R, stubL, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, -(stubStart + stubL / 2));
    _pushTransformed(buckets.pipe, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }
  const fg = new THREE.CylinderGeometry(FLANGE_R, FLANGE_R, FLANGE_H, SEGS);
  applyTiledCylinderUVs(fg, FLANGE_R, FLANGE_H, SEGS);
  const frot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  const ftrans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, -tileHalfZ);
  _pushTransformed(buckets.detail, fg, new THREE.Matrix4().multiplyMatrices(ftrans, frot));
}

// ── Helper: pedestal support ─────────────────────────────────────────
function _addPedestal(buckets, zPos, topY, colW = 0.22, colD = 0.16) {
  const sBaseH = 0.06;
  const baseW = colW + 0.16;
  const baseD = colD + 0.06;
  const sColH = Math.max(0.04, topY - sBaseH);

  const base = new THREE.BoxGeometry(baseW, sBaseH, baseD);
  applyTiledBoxUVs(base, baseW, sBaseH, baseD);
  _pushTransformed(buckets.stand, base, new THREE.Matrix4().makeTranslation(0, sBaseH / 2, zPos));

  if (sColH > 0.04) {
    const col = new THREE.BoxGeometry(colW, sColH, colD);
    applyTiledBoxUVs(col, colW, sColH, colD);
    _pushTransformed(buckets.stand, col, new THREE.Matrix4().makeTranslation(0, sBaseH + sColH / 2, zPos));
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Faraday Cup — subW=2, subL=4 → 1m × 2m
//
// A real Faraday cup is a small metal cup inside a vacuum housing that
// collects all beam charge. The current is measured via a BNC feedthrough.
// Visually: cylindrical vacuum housing with a visible copper collector
// cup recessed inside, a thick entry flange, signal feedthrough stubs,
// and a compact stand.
// ═══════════════════════════════════════════════════════════════════════
export function _buildFaradayCupRoles() {
  const buckets = _makeBuckets();
  const m4 = new THREE.Matrix4();

  const tileHalfZ = 1.0; // 2m / 2
  const bodyR = 0.28;
  const bodyL = 1.2;

  // Main vacuum housing — stainless steel cylinder centered on beam
  {
    const g = new THREE.CylinderGeometry(bodyR, bodyR, bodyL, SEGS);
    applyTiledCylinderUVs(g, bodyR, bodyL, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, 0.1);
    _pushTransformed(buckets.pipe, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // End cap (downstream, closed end) — thick plate sealing the cup
  {
    const capL = 0.06;
    const g = new THREE.CylinderGeometry(bodyR + 0.02, bodyR + 0.02, capL, SEGS);
    applyTiledCylinderUVs(g, bodyR + 0.02, capL, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, 0.1 + bodyL / 2 + capL / 2);
    _pushTransformed(buckets.iron, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // Copper collector cup visible inside (slightly recessed from entry end)
  {
    const cupR = 0.16;
    const cupL = 0.5;
    const g = new THREE.CylinderGeometry(cupR, cupR, cupL, SEGS);
    applyTiledCylinderUVs(g, cupR, cupL, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, 0.25);
    _pushTransformed(buckets.copper, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // Entry flange ring (larger, at the upstream end of the housing)
  {
    const flangeR2 = bodyR + 0.06;
    const g = new THREE.CylinderGeometry(flangeR2, flangeR2, 0.05, SEGS);
    applyTiledCylinderUVs(g, flangeR2, 0.05, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, 0.1 - bodyL / 2);
    _pushTransformed(buckets.detail, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // BNC/SMA signal feedthrough stubs — two small cylinders on top
  for (const xOff of [-0.12, 0.12]) {
    const pR = 0.03;
    const pH = 0.18;
    const g = new THREE.CylinderGeometry(pR, pR, pH, 8);
    applyTiledCylinderUVs(g, pR, pH, 8);
    _pushTransformed(buckets.detail, g, new THREE.Matrix4().makeTranslation(xOff, BEAM_HEIGHT + bodyR + pH / 2, 0.2));
    // Small connector cap
    const capG = new THREE.CylinderGeometry(pR * 1.6, pR * 1.6, 0.025, 8);
    applyTiledCylinderUVs(capG, pR * 1.6, 0.025, 8);
    _pushTransformed(buckets.copper, capG, new THREE.Matrix4().makeTranslation(xOff, BEAM_HEIGHT + bodyR + pH + 0.012, 0.2));
  }

  // Bias voltage feedthrough — one stub on side
  {
    const pR = 0.035;
    const pL = 0.15;
    const g = new THREE.CylinderGeometry(pR, pR, pL, 8);
    applyTiledCylinderUVs(g, pR, pL, 8);
    const rot = new THREE.Matrix4().makeRotationZ(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(bodyR + pL / 2, BEAM_HEIGHT, 0.15);
    _pushTransformed(buckets.detail, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // Entry pipe stub + flange
  _addEntryFlange(buckets, tileHalfZ, bodyL / 2 - 0.1);

  // Support pedestal
  _addPedestal(buckets, 0.1, BEAM_HEIGHT - bodyR);

  return buckets;
}

// ═══════════════════════════════════════════════════════════════════════
// Beam Stop — subW=4, subL=4 → 2m × 2m
//
// A real beam stop is a massive water-cooled copper/graphite absorber
// inside heavy iron/concrete shielding. The beam enters through a small
// aperture and dumps into the absorber. Cooling water pipes are prominent.
// ═══════════════════════════════════════════════════════════════════════
export function _buildBeamStopRoles() {
  const buckets = _makeBuckets();
  const m4 = new THREE.Matrix4();

  const tileHalfZ = 1.0;
  const shieldW = 1.6;
  const shieldH = 1.2;
  const shieldL = 1.5;

  // Heavy iron shielding block — the dominant visual
  {
    const g = new THREE.BoxGeometry(shieldW, shieldH, shieldL);
    applyTiledBoxUVs(g, shieldW, shieldH, shieldL);
    _pushTransformed(buckets.iron, g, new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, 0.1));
  }

  // Accent-colored front face plate (beam entry side) with smaller aperture
  {
    const plateW = shieldW + 0.04;
    const plateH = shieldH + 0.04;
    const plateL = 0.06;
    const g = new THREE.BoxGeometry(plateW, plateH, plateL);
    applyTiledBoxUVs(g, plateW, plateH, plateL);
    _pushTransformed(buckets.accent, g, new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, 0.1 - shieldL / 2 - plateL / 2));
  }

  // Copper absorber core visible from top (slightly protruding)
  {
    const coreW = 0.5;
    const coreH = 0.12;
    const coreL = 1.0;
    const g = new THREE.BoxGeometry(coreW, coreH, coreL);
    applyTiledBoxUVs(g, coreW, coreH, coreL);
    _pushTransformed(buckets.copper, g, new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT + shieldH / 2 + coreH / 2, 0.1));
  }

  // Water cooling pipes — two prominent horizontal pipes along the sides
  for (const side of [-1, 1]) {
    const pipeR2 = 0.055;
    const pipeL = shieldL + 0.4;
    const g = new THREE.CylinderGeometry(pipeR2, pipeR2, pipeL, SEGS);
    applyTiledCylinderUVs(g, pipeR2, pipeL, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(
      side * (shieldW / 2 + pipeR2 + 0.02),
      BEAM_HEIGHT + shieldH * 0.25,
      0.1,
    );
    _pushTransformed(buckets.pipe, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // Vertical risers connecting cooling pipes to top
  for (const side of [-1, 1]) {
    const riserR = 0.04;
    const riserH = shieldH * 0.4;
    const g = new THREE.CylinderGeometry(riserR, riserR, riserH, 8);
    applyTiledCylinderUVs(g, riserR, riserH, 8);
    _pushTransformed(buckets.pipe, g, new THREE.Matrix4().makeTranslation(
      side * (shieldW / 2 + 0.055 + 0.02),
      BEAM_HEIGHT + shieldH * 0.25 + riserH / 2 + 0.06,
      0.1 + shieldL / 2 - 0.15,
    ));
  }

  // Warning/accent stripe on front face
  {
    const stripeW = shieldW * 0.6;
    const stripeH = 0.08;
    const stripeL = 0.02;
    const g = new THREE.BoxGeometry(stripeW, stripeH, stripeL);
    applyTiledBoxUVs(g, stripeW, stripeH, stripeL);
    _pushTransformed(buckets.accent, g, new THREE.Matrix4().makeTranslation(
      0, BEAM_HEIGHT + shieldH * 0.3, 0.1 - shieldL / 2 - 0.06 - stripeL / 2,
    ));
  }

  // Entry pipe stub + flange
  _addEntryFlange(buckets, tileHalfZ, shieldL / 2 - 0.1);

  // Two heavy pedestals under the shielding block
  const bottomY = BEAM_HEIGHT - shieldH / 2;
  _addPedestal(buckets, -0.2, bottomY, 0.36, 0.28);
  _addPedestal(buckets, 0.5, bottomY, 0.36, 0.28);

  return buckets;
}

// ═══════════════════════════════════════════════════════════════════════
// Detector — subW=6, subL=12 → 3m × 6m (the big one)
//
// Inspired by real collider detectors (CMS, ATLAS) scaled to game size:
// a large barrel structure with concentric layers — inner tracker,
// calorimeter (accent), iron return yoke. End caps close the barrel.
// Cable trays and service platforms on top. This is the showpiece.
// ═══════════════════════════════════════════════════════════════════════
export function _buildDetectorRoles() {
  const buckets = _makeBuckets();
  const m4 = new THREE.Matrix4();

  const tileHalfZ = 3.0; // 6m / 2
  const barrelL = 4.8;

  // ── Iron return yoke (outermost barrel) ──
  const yokeR = 1.3;
  {
    const g = new THREE.CylinderGeometry(yokeR, yokeR, barrelL, 12);
    applyTiledCylinderUVs(g, yokeR, barrelL, 12);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, 0);
    _pushTransformed(buckets.iron, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // ── Calorimeter layer (accent color — the signature ring) ──
  const caloR = 1.05;
  const caloL = barrelL - 0.2;
  {
    const g = new THREE.CylinderGeometry(caloR, caloR, caloL, 12);
    applyTiledCylinderUVs(g, caloR, caloL, 12);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, 0);
    _pushTransformed(buckets.accent, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // ── Inner tracker barrel (copper/electronics) ──
  const trackerR = 0.55;
  const trackerL = barrelL - 0.6;
  {
    const g = new THREE.CylinderGeometry(trackerR, trackerR, trackerL, 12);
    applyTiledCylinderUVs(g, trackerR, trackerL, 12);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, 0);
    _pushTransformed(buckets.copper, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // ── End caps (both ends) — thick iron discs ──
  const endCapL = 0.25;
  for (const sign of [-1, 1]) {
    const zc = sign * (barrelL / 2 + endCapL / 2);
    const g = new THREE.CylinderGeometry(yokeR, yokeR, endCapL, 12);
    applyTiledCylinderUVs(g, yokeR, endCapL, 12);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, zc);
    _pushTransformed(buckets.iron, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // ── Accent rings segmenting the barrel (octant boundaries) ──
  const ringCount = 5;
  for (let i = 0; i < ringCount; i++) {
    const t = (i + 0.5) / ringCount;
    const z = -barrelL / 2 + t * barrelL;
    const g = new THREE.CylinderGeometry(yokeR + 0.03, yokeR + 0.03, 0.04, 12);
    applyTiledCylinderUVs(g, yokeR + 0.03, 0.04, 12);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, z);
    _pushTransformed(buckets.accent, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // ── Service platforms / cable tray on top ──
  {
    const trayW = 0.8;
    const trayH = 0.06;
    const trayL = barrelL + 0.6;
    const g = new THREE.BoxGeometry(trayW, trayH, trayL);
    applyTiledBoxUVs(g, trayW, trayH, trayL);
    _pushTransformed(buckets.stand, g, new THREE.Matrix4().makeTranslation(
      0, BEAM_HEIGHT + yokeR + trayH / 2, 0,
    ));
  }

  // Cable bundles on the tray
  for (const xOff of [-0.2, 0.2]) {
    const cableR = 0.06;
    const cableL = barrelL + 0.3;
    const g = new THREE.CylinderGeometry(cableR, cableR, cableL, 8);
    applyTiledCylinderUVs(g, cableR, cableL, 8);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(xOff, BEAM_HEIGHT + yokeR + 0.06 + cableR, 0);
    _pushTransformed(buckets.copper, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // ── Entry beam pipe stub + flange (only on back/-Z, it's an endpoint) ──
  {
    const stubStart = barrelL / 2 + endCapL;
    const stubL = tileHalfZ - stubStart;
    if (stubL > 0.001) {
      const g = new THREE.CylinderGeometry(PIPE_R, PIPE_R, stubL, SEGS);
      applyTiledCylinderUVs(g, PIPE_R, stubL, SEGS);
      const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
      const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, -(stubStart + stubL / 2));
      _pushTransformed(buckets.pipe, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
    }
    const fg = new THREE.CylinderGeometry(FLANGE_R, FLANGE_R, FLANGE_H, SEGS);
    applyTiledCylinderUVs(fg, FLANGE_R, FLANGE_H, SEGS);
    const frot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const ftrans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, -tileHalfZ);
    _pushTransformed(buckets.detail, fg, new THREE.Matrix4().multiplyMatrices(ftrans, frot));
  }

  // ── Heavy support cradle (two wide stands) ──
  const bottomY = BEAM_HEIGHT - yokeR;
  _addPedestal(buckets, -barrelL * 0.35, bottomY, 0.5, 0.4);
  _addPedestal(buckets, barrelL * 0.35, bottomY, 0.5, 0.4);
  // Extra middle support for this massive detector
  _addPedestal(buckets, 0, bottomY, 0.4, 0.3);

  return buckets;
}

// ═══════════════════════════════════════════════════════════════════════
// Target — subW=4, subL=4 → 2m × 2m
//
// A fixed-target station: the beam enters a shielded chamber and hits
// a target foil/block. Secondary particles scatter out through a thin
// beam window. Prominent features: shielding, target manipulator on top
// (to swap targets), downstream beam window, cooling lines.
// ═══════════════════════════════════════════════════════════════════════
export function _buildTargetRoles() {
  const buckets = _makeBuckets();
  const m4 = new THREE.Matrix4();

  const tileHalfZ = 1.0;
  const chamberR = 0.45;
  const chamberL = 1.0;

  // Main target vacuum chamber — cylindrical
  {
    const g = new THREE.CylinderGeometry(chamberR, chamberR, chamberL, SEGS);
    applyTiledCylinderUVs(g, chamberR, chamberL, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, 0.05);
    _pushTransformed(buckets.pipe, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // Thick entry flange collar
  {
    const collarR = chamberR + 0.08;
    const g = new THREE.CylinderGeometry(collarR, collarR, 0.07, SEGS);
    applyTiledCylinderUVs(g, collarR, 0.07, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, 0.05 - chamberL / 2);
    _pushTransformed(buckets.detail, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // Downstream end cap with beam window port (accent ring)
  {
    const capR = chamberR + 0.04;
    const capL = 0.08;
    const g = new THREE.CylinderGeometry(capR, capR, capL, SEGS);
    applyTiledCylinderUVs(g, capR, capL, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, 0.05 + chamberL / 2 + capL / 2);
    _pushTransformed(buckets.accent, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // Iron shielding blocks flanking the chamber
  for (const side of [-1, 1]) {
    const shW = 0.3;
    const shH = 0.9;
    const shL = chamberL * 0.7;
    const g = new THREE.BoxGeometry(shW, shH, shL);
    applyTiledBoxUVs(g, shW, shH, shL);
    _pushTransformed(buckets.iron, g, new THREE.Matrix4().makeTranslation(
      side * (chamberR + shW / 2 + 0.02),
      BEAM_HEIGHT,
      0.05,
    ));
  }

  // Target manipulator — vertical assembly on top for swapping target foils
  {
    // Cylindrical guide tube
    const tubeR = 0.07;
    const tubeH = 0.55;
    const g = new THREE.CylinderGeometry(tubeR, tubeR, tubeH, 8);
    applyTiledCylinderUVs(g, tubeR, tubeH, 8);
    _pushTransformed(buckets.pipe, g, new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT + chamberR + tubeH / 2, 0.05));

    // Actuator housing on top
    const actW = 0.18;
    const actH = 0.14;
    const actL = 0.18;
    const ag = new THREE.BoxGeometry(actW, actH, actL);
    applyTiledBoxUVs(ag, actW, actH, actL);
    _pushTransformed(buckets.accent, ag, new THREE.Matrix4().makeTranslation(
      0, BEAM_HEIGHT + chamberR + tubeH + actH / 2, 0.05,
    ));
  }

  // Cooling water lines — two small pipes along the bottom
  for (const side of [-1, 1]) {
    const coolR = 0.035;
    const coolL = chamberL + 0.3;
    const g = new THREE.CylinderGeometry(coolR, coolR, coolL, 8);
    applyTiledCylinderUVs(g, coolR, coolL, 8);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(
      side * 0.25,
      BEAM_HEIGHT - chamberR - coolR - 0.02,
      0.05,
    );
    _pushTransformed(buckets.copper, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // Entry pipe + flange
  _addEntryFlange(buckets, tileHalfZ, chamberL / 2 - 0.05);

  // Two support pedestals
  const bottomY = BEAM_HEIGHT - chamberR;
  _addPedestal(buckets, -0.25, bottomY + 0.1, 0.28, 0.2);
  _addPedestal(buckets, 0.35, bottomY + 0.1, 0.28, 0.2);

  return buckets;
}

// ── Purpose-built endpoint facilities ────────────────────────────────
// These are deliberately not scaled copies of Target/BeamStop.  Endpoints
// are the visible promise of each machine type, so their silhouettes explain
// the work being sold: a test hutch, an irradiation conveyor, a therapy
// gantry, a neutron monolith, and photon-science instruments.
function _addBox(buckets, role, w, h, l, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, l);
  applyTiledBoxUVs(g, w, h, l);
  _pushTransformed(buckets[role], g, new THREE.Matrix4().makeTranslation(x, y, z));
}

function _addXCylinder(buckets, role, r, l, x, y, z, segs = SEGS) {
  const g = new THREE.CylinderGeometry(r, r, l, segs);
  applyTiledCylinderUVs(g, r, l, segs);
  const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  const trans = new THREE.Matrix4().makeTranslation(x, y, z);
  _pushTransformed(buckets[role], g, new THREE.Matrix4().multiplyMatrices(trans, rot));
}

function _addVerticalCylinder(buckets, role, r, h, x, y, z, segs = SEGS) {
  const g = new THREE.CylinderGeometry(r, r, h, segs);
  applyTiledCylinderUVs(g, r, h, segs);
  _pushTransformed(buckets[role], g, new THREE.Matrix4().makeTranslation(x, y, z));
}

function _addFacilityEnvelope(buckets, { halfZ, width, height, length, entryTo, supports = 2 }) {
  _addBox(buckets, 'iron', width, height, length, 0, BEAM_HEIGHT, 0);
  _addBox(buckets, 'accent', width + 0.04, 0.08, length + 0.05, 0, BEAM_HEIGHT + height / 2 + 0.04, 0);
  _addEntryFlange(buckets, halfZ, entryTo);
  const bottomY = BEAM_HEIGHT - height / 2;
  for (let i = 0; i < supports; i++) {
    const z = supports === 1 ? 0 : -length * 0.32 + i * (length * 0.64 / (supports - 1));
    _addPedestal(buckets, z, bottomY, Math.min(0.65, width * 0.22), 0.38);
  }
}

export function _buildMaterialsTestStationRoles() {
  const buckets = _makeBuckets();
  // Small shielded hutch with a visibly raised sample table and camera mast.
  _addFacilityEnvelope(buckets, { halfZ: 1.25, width: 1.65, height: 1.05, length: 2.05, entryTo: 0.95 });
  _addBox(buckets, 'stand', 1.1, 0.08, 0.8, 0, 0.35, 0.2);
  _addVerticalCylinder(buckets, 'copper', 0.18, 0.18, 0, 0.48, 0.2, 12);
  _addBox(buckets, 'detail', 0.42, 0.28, 0.38, 0.42, 0.72, 0.2); // camera / instrument pod
  _addVerticalCylinder(buckets, 'pipe', 0.04, 0.5, -0.42, 0.72, 0.2, 8);
  return buckets;
}

export function _buildXRayConverterStationRoles() {
  const buckets = _makeBuckets();
  const halfZ = 1.5;

  // An open-sided shielding cabinet keeps the conversion line readable:
  // electron pipe -> high-Z target -> collimator -> sample -> detector.
  _addBox(buckets, 'stand', 2.7, 0.14, 2.65, 0, 0.07, 0.05);
  for (const x of [-1.12, 1.12]) {
    _addBox(buckets, 'iron', 0.32, 1.15, 2.35, x, 0.645, 0.05);
    _addBox(buckets, 'accent', 0.04, 0.14, 2.18, x * 1.15, 1.08, 0.05);
  }
  // Three removable roof beams imply the shielding canopy without hiding the
  // process line from the game's elevated isometric camera.
  for (const z of [-0.84, 0.05, 0.94]) {
    _addBox(buckets, 'iron', 2.56, 0.18, 0.28, 0, 1.58, z);
  }
  _addEntryFlange(buckets, halfZ, 0.62);

  // Vacuum target chamber and its water-cooled tungsten/tantalum converter.
  _addXCylinder(buckets, 'pipe', 0.43, 0.62, 0, BEAM_HEIGHT, -0.32);
  _addXCylinder(buckets, 'detail', 0.51, 0.08, 0, BEAM_HEIGHT, -0.62);
  _addXCylinder(buckets, 'copper', 0.32, 0.10, 0, BEAM_HEIGHT, 0.01, 12);

  // A tapered shielding cone limits the broad bremsstrahlung fan before it
  // reaches the product fixture. CylinderGeometry's two radii make the cone
  // visible without adding another renderer helper or content field.
  {
    const length = 0.58;
    const g = new THREE.CylinderGeometry(0.17, 0.36, length, SEGS);
    applyTiledCylinderUVs(g, 0.36, length, SEGS);
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    const trans = new THREE.Matrix4().makeTranslation(0, BEAM_HEIGHT, 0.37);
    _pushTransformed(buckets.iron, g, new THREE.Matrix4().multiplyMatrices(trans, rot));
  }

  // Motorised inspection turntable and flat-panel detector.
  _addVerticalCylinder(buckets, 'stand', 0.42, 0.12, 0, 0.32, 0.74, 12);
  _addVerticalCylinder(buckets, 'accent', 0.32, 0.06, 0, 0.41, 0.74, 12);
  _addBox(buckets, 'detail', 1.45, 1.2, 0.13, 0, 1.0, 1.12);
  _addBox(buckets, 'accent', 1.18, 0.94, 0.04, 0, 1.0, 1.045);

  // External controls and converter cooling headers distinguish this from a
  // passive beam stop even when the beam axis is hidden by the shielding.
  _addBox(buckets, 'detail', 0.42, 0.92, 0.48, -1.28, 0.6, 0.72);
  _addBox(buckets, 'accent', 0.05, 0.35, 0.3, -1.47, 0.73, 0.72);
  for (const x of [0.62, 0.78]) {
    _addXCylinder(buckets, 'copper', 0.045, 1.45, x, 0.48, -0.18, 8);
    _addVerticalCylinder(buckets, 'pipe', 0.04, 0.42, x, 0.69, 0.5, 8);
  }

  return buckets;
}

export function _buildEBeamIrradiationVaultRoles() {
  const buckets = _makeBuckets();
  // Shielding bunker plus a conveyor that clearly runs through the dose cell.
  _addFacilityEnvelope(buckets, { halfZ: 2.5, width: 3.5, height: 1.8, length: 4.25, entryTo: 2.0, supports: 3 });
  _addBox(buckets, 'stand', 1.25, 0.13, 3.7, 0, 0.28, 0.25);
  for (const z of [-1.3, -0.45, 0.4, 1.25]) _addVerticalCylinder(buckets, 'detail', 0.11, 0.16, -0.52, 0.48, z, 10);
  _addBox(buckets, 'accent', 0.75, 0.75, 0.12, 0, 1.0, -2.19); // maze door / warning face
  _addXCylinder(buckets, 'copper', 0.08, 3.8, 0.72, 0.95, 0.2, 10);
  return buckets;
}

export function _buildIsotopeProductionTargetRoles() {
  const buckets = _makeBuckets();
  // Compact target vault: central target chamber, hot-cell transfer cask, and cooling headers.
  _addFacilityEnvelope(buckets, { halfZ: 1.5, width: 2.55, height: 1.45, length: 2.45, entryTo: 1.15 });
  _addXCylinder(buckets, 'pipe', 0.52, 1.25, 0, BEAM_HEIGHT, 0.15);
  _addVerticalCylinder(buckets, 'copper', 0.23, 0.38, 0, BEAM_HEIGHT + 0.62, 0.15, 12);
  _addVerticalCylinder(buckets, 'iron', 0.42, 0.95, 0.78, 0.52, 0.45, 12); // transfer cask dock
  for (const x of [-0.45, 0.45]) _addXCylinder(buckets, 'copper', 0.045, 1.35, x, 0.36, 0.15, 8);
  return buckets;
}

export function _buildRadiationEffectsStationRoles() {
  const buckets = _makeBuckets();
  // Test cave with a broad raster-scanning head over a sample fixture.
  _addFacilityEnvelope(buckets, { halfZ: 2.0, width: 2.75, height: 1.5, length: 3.15, entryTo: 1.48 });
  _addBox(buckets, 'copper', 1.15, 0.12, 0.9, 0, 0.37, 0.25);
  _addBox(buckets, 'accent', 1.35, 0.15, 0.3, 0, 1.62, 0.05); // scanning magnet yoke
  _addBox(buckets, 'accent', 0.3, 0.15, 1.35, 0, 1.62, 0.05);
  _addVerticalCylinder(buckets, 'detail', 0.12, 0.85, 0.82, 0.75, 0.3, 10); // remote camera
  return buckets;
}

export function _buildProtonTherapyGantryRoles() {
  const buckets = _makeBuckets();
  // A large vertical ring is instantly legible as a medical treatment gantry.
  const halfZ = 3.5;
  _addEntryFlange(buckets, halfZ, 1.0);
  _addXCylinder(buckets, 'iron', 2.35, 0.55, 0, BEAM_HEIGHT, 0, 16);
  _addXCylinder(buckets, 'accent', 1.95, 0.64, 0, BEAM_HEIGHT, 0, 16);
  _addXCylinder(buckets, 'pipe', 0.72, 0.75, 0, BEAM_HEIGHT, 0, 16);
  _addBox(buckets, 'stand', 3.7, 0.22, 1.4, 0, 0.11, 0.72); // patient couch
  _addBox(buckets, 'detail', 0.75, 0.18, 2.6, 0, 0.4, 1.4);
  _addBox(buckets, 'accent', 0.22, 0.7, 0.22, -2.0, 1.35, 0);
  _addBox(buckets, 'accent', 0.22, 0.7, 0.22, 2.0, 1.35, 0);
  _addPedestal(buckets, -1.1, 0.2, 0.75, 0.7);
  _addPedestal(buckets, 1.1, 0.2, 0.75, 0.7);
  return buckets;
}

export function _buildSpallationNeutronTargetRoles() {
  const buckets = _makeBuckets();
  // Massive target monolith, moderator vessel, and conspicuous water headers.
  _addFacilityEnvelope(buckets, { halfZ: 3.0, width: 4.4, height: 2.5, length: 4.65, entryTo: 2.18, supports: 3 });
  _addXCylinder(buckets, 'copper', 0.75, 1.35, 0, BEAM_HEIGHT, 0.1, 16);
  _addVerticalCylinder(buckets, 'accent', 1.02, 0.32, 0, BEAM_HEIGHT + 1.42, 0.1, 16);
  for (const x of [-1.85, 1.85]) {
    _addXCylinder(buckets, 'pipe', 0.09, 3.8, x, 1.25, 0.1, 10);
    _addVerticalCylinder(buckets, 'pipe', 0.07, 0.75, x, 0.88, 1.75, 10);
  }
  return buckets;
}

export function _buildPhotonScienceHutchRoles() {
  const buckets = _makeBuckets();
  // Long experimental hutch with an optical table, sample goniometer, and detector arm.
  _addFacilityEnvelope(buckets, { halfZ: 3.0, width: 4.4, height: 1.8, length: 5.1, entryTo: 2.4, supports: 3 });
  _addBox(buckets, 'stand', 2.3, 0.12, 3.6, 0, 0.38, 0.45);
  _addVerticalCylinder(buckets, 'copper', 0.3, 0.22, 0, 0.62, 0.35, 12);
  _addXCylinder(buckets, 'detail', 0.28, 1.25, 1.05, 1.05, 0.35, 12); // detector arm
  _addBox(buckets, 'accent', 0.85, 0.65, 0.65, -0.9, 1.0, -0.85); // monochromator cabinet
  return buckets;
}

export function _buildXfelEndstationRoles() {
  const buckets = _makeBuckets();
  // A more dense hutch: large area detector tower, timing rack, and liquid-jet chamber.
  _addFacilityEnvelope(buckets, { halfZ: 3.0, width: 4.4, height: 2.1, length: 5.05, entryTo: 2.35, supports: 3 });
  _addVerticalCylinder(buckets, 'pipe', 0.48, 1.05, 0, BEAM_HEIGHT + 0.1, 0.2, 16);
  _addBox(buckets, 'accent', 1.55, 1.5, 0.38, 0.92, 1.15, 0.55); // area detector
  _addBox(buckets, 'detail', 0.65, 1.3, 0.55, -1.15, 1.0, -0.6); // timing tool rack
  _addVerticalCylinder(buckets, 'copper', 0.08, 1.25, 0, 2.05, 0.2, 8); // injector
  return buckets;
}

export function _buildEuvCollectorRoles() {
  const buckets = _makeBuckets();
  // Collector chamber with a flared collector cone, metrology cabinets, and large heat exchanger lines.
  _addFacilityEnvelope(buckets, { halfZ: 2.5, width: 4.45, height: 2.1, length: 4.2, entryTo: 1.95, supports: 3 });
  _addXCylinder(buckets, 'pipe', 1.0, 1.85, 0, BEAM_HEIGHT, 0.15, 16);
  _addXCylinder(buckets, 'copper', 0.58, 1.45, 0, BEAM_HEIGHT, 0.35, 16);
  _addBox(buckets, 'accent', 0.85, 1.2, 0.75, -1.42, 0.95, 0.5);
  for (const x of [-1.65, 1.65]) _addXCylinder(buckets, 'copper', 0.1, 3.35, x, 1.35, 0.15, 10);
  return buckets;
}
