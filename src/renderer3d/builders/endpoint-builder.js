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
  _addPedestal(buckets, -0.25, bottomY - 0.04, 0.28, 0.2);
  _addPedestal(buckets, 0.35, bottomY - 0.04, 0.28, 0.2);

  return buckets;
}
