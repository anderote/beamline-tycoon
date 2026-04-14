// src/renderer3d/builders/optics-builder.js
//
// Role-bucket builders for beam-optics manipulation components:
// aperture, velocity selector, pepper-pot emittance filter.
//
// Conventions match component-builder.js and diagnostic-builder.js:
//   - Beam axis runs along local +Z at y = BEAM_HEIGHT.
//   - Origin is footprint center at floor level (y = 0).
//   - 1 sub-tile = 0.5 m.
//   - THREE is a CDN global — do NOT import it.

import { applyTiledBoxUVs, applyTiledCylinderUVs } from '../uv-utils.js';

const SUB_UNIT    = 0.5;
const BEAM_HEIGHT = 1.0;
const PIPE_R      = 0.08;
const FLANGE_R    = 0.16;
const FLANGE_H    = 0.045;
const SEGS        = 16;

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

function mul(...mats) {
  let r = mats[0].clone();
  for (let i = 1; i < mats.length; i++) r.multiply(mats[i]);
  return r;
}

function makeBuckets() {
  return { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };
}

function buildPipeSegment(buckets, subL) {
  const len = subL * SUB_UNIT;
  const g = new THREE.CylinderGeometry(PIPE_R, PIPE_R, len, SEGS);
  applyTiledCylinderUVs(g, PIPE_R, len, SEGS);
  pushT(buckets.pipe, g, mul(trans(0, BEAM_HEIGHT, 0), rotX(Math.PI / 2)));
}

function buildFlanges(buckets, halfLen) {
  for (const sign of [-1, 1]) {
    const g = new THREE.CylinderGeometry(FLANGE_R, FLANGE_R, FLANGE_H, SEGS);
    applyTiledCylinderUVs(g, FLANGE_R, FLANGE_H, SEGS);
    pushT(buckets.detail, g, mul(trans(0, BEAM_HEIGHT, sign * halfLen), rotX(Math.PI / 2)));
  }
}

// ── Aperture ────────────────────────────────────────────────────────
// subL=1 subW=2 subH=3 → 0.5m long, 1m wide, 1.5m tall
// Two adjustable jaw blocks flanking the beam, held in a rectangular frame.
export function _buildApertureRoles() {
  const buckets = makeBuckets();
  const halfLen = 0.25;

  buildPipeSegment(buckets, 1);
  buildFlanges(buckets, halfLen);

  // Jaw frame — rectangular housing around the beam axis
  const frameW = 0.80;
  const frameH = 0.70;
  const frameD = 0.18;
  const wallT  = 0.06;

  // Top and bottom bars of the frame
  for (const ySign of [-1, 1]) {
    const g = new THREE.BoxGeometry(frameW, wallT, frameD);
    applyTiledBoxUVs(g, frameW, wallT, frameD);
    pushT(buckets.iron, g, trans(0, BEAM_HEIGHT + ySign * (frameH / 2 - wallT / 2), 0));
  }
  // Left and right uprights
  for (const xSign of [-1, 1]) {
    const innerH = frameH - 2 * wallT;
    const g = new THREE.BoxGeometry(wallT, innerH, frameD);
    applyTiledBoxUVs(g, wallT, innerH, frameD);
    pushT(buckets.iron, g, trans(xSign * (frameW / 2 - wallT / 2), BEAM_HEIGHT, 0));
  }

  // Two jaw blocks — copper-colored slabs that narrow the beam aperture
  const jawW = 0.12;
  const jawH = 0.28;
  const jawD = 0.14;
  const jawGap = PIPE_R + 0.03;
  for (const xSign of [-1, 1]) {
    const g = new THREE.BoxGeometry(jawW, jawH, jawD);
    applyTiledBoxUVs(g, jawW, jawH, jawD);
    pushT(buckets.copper, g, trans(xSign * (jawGap + jawW / 2), BEAM_HEIGHT, 0));
  }

  // Actuator rods — thin bars extending from each jaw upward through the frame
  for (const xSign of [-1, 1]) {
    const rodR = 0.02;
    const rodH = 0.22;
    const g = new THREE.CylinderGeometry(rodR, rodR, rodH, 8);
    applyTiledCylinderUVs(g, rodR, rodH, 8);
    pushT(buckets.detail, g, trans(xSign * (jawGap + jawW / 2), BEAM_HEIGHT + jawH / 2 + rodH / 2, 0));
  }

  // Support pedestal
  const sBaseH = 0.05;
  const sColW = 0.20;
  const sColD = 0.14;
  const sColH = BEAM_HEIGHT - frameH / 2 - sBaseH;
  {
    const base = new THREE.BoxGeometry(sColW + 0.10, sBaseH, sColD + 0.04);
    applyTiledBoxUVs(base, sColW + 0.10, sBaseH, sColD + 0.04);
    pushT(buckets.stand, base, trans(0, sBaseH / 2, 0));
    if (sColH > 0.04) {
      const col = new THREE.BoxGeometry(sColW, sColH, sColD);
      applyTiledBoxUVs(col, sColW, sColH, sColD);
      pushT(buckets.stand, col, trans(0, sBaseH + sColH / 2, 0));
    }
  }

  return buckets;
}

// ── Velocity Selector ───────────────────────────────────────────────
// subL=2 subW=2 subH=2 → 1m long, 1m wide, 1m tall
// Spinning drum with helical slits inside a cylindrical housing,
// with a motor drive on top.
export function _buildVelocitySelectorRoles() {
  const buckets = makeBuckets();
  const magL = 1.0;
  const halfLen = magL / 2;

  buildPipeSegment(buckets, 2);
  buildFlanges(buckets, halfLen);

  // Main cylindrical housing — drum containing the helical slits
  const housingR = 0.28;
  const housingL = 0.70;
  {
    const g = new THREE.CylinderGeometry(housingR, housingR, housingL, SEGS);
    applyTiledCylinderUVs(g, housingR, housingL, SEGS);
    pushT(buckets.accent, g, mul(trans(0, BEAM_HEIGHT, 0), rotX(Math.PI / 2)));
  }

  // End plates on the housing
  for (const sign of [-1, 1]) {
    const plateR = housingR + 0.02;
    const plateH = 0.03;
    const g = new THREE.CylinderGeometry(plateR, plateR, plateH, SEGS);
    applyTiledCylinderUVs(g, plateR, plateH, SEGS);
    pushT(buckets.detail, g, mul(trans(0, BEAM_HEIGHT, sign * (housingL / 2 + plateH / 2)), rotX(Math.PI / 2)));
  }

  // Motor housing on top — vertical cylinder
  {
    const motorR = 0.10;
    const motorH = 0.30;
    const g = new THREE.CylinderGeometry(motorR, motorR, motorH, SEGS);
    applyTiledCylinderUVs(g, motorR, motorH, SEGS);
    pushT(buckets.iron, g, trans(0, BEAM_HEIGHT + housingR + motorH / 2, 0));
  }

  // Motor cap
  {
    const capR = 0.13;
    const capH = 0.03;
    const g = new THREE.CylinderGeometry(capR, capR, capH, SEGS);
    applyTiledCylinderUVs(g, capR, capH, SEGS);
    pushT(buckets.detail, g, trans(0, BEAM_HEIGHT + housingR + 0.30 + capH / 2, 0));
  }

  // HV connection box on the side (for electric field plates)
  {
    const boxW = 0.14;
    const boxH = 0.12;
    const boxD = 0.20;
    const g = new THREE.BoxGeometry(boxW, boxH, boxD);
    applyTiledBoxUVs(g, boxW, boxH, boxD);
    pushT(buckets.copper, g, trans(housingR + boxW / 2, BEAM_HEIGHT, 0));
  }

  // Support pedestals
  const sBaseH = 0.05;
  const sColW = 0.20;
  const sColD = 0.16;
  const sColH = BEAM_HEIGHT - housingR - sBaseH;
  for (const zSign of [-1, 1]) {
    const zPos = zSign * (housingL / 2 - sColD / 2 - 0.04);
    const base = new THREE.BoxGeometry(sColW + 0.10, sBaseH, sColD + 0.04);
    applyTiledBoxUVs(base, sColW + 0.10, sBaseH, sColD + 0.04);
    pushT(buckets.stand, base, trans(0, sBaseH / 2, zPos));
    if (sColH > 0.04) {
      const col = new THREE.BoxGeometry(sColW, sColH, sColD);
      applyTiledBoxUVs(col, sColW, sColH, sColD);
      pushT(buckets.stand, col, trans(0, sBaseH + sColH / 2, zPos));
    }
  }

  return buckets;
}

// ── Pepper-pot Emittance Filter ─────────────────────────────────────
// subL=1 subW=2 subH=3 → 0.5m long, 1m wide, 1.5m tall
// Thin perforated metal plate in a mounting frame, plus a downstream
// scintillator screen for imaging the beamlets.
export function _buildEmittanceFilterRoles() {
  const buckets = makeBuckets();
  const halfLen = 0.25;

  buildPipeSegment(buckets, 1);
  buildFlanges(buckets, halfLen);

  // Pepper-pot plate — thin disk with holes (rendered as a flat cylinder)
  const plateR = 0.30;
  const plateH = 0.012;
  {
    const g = new THREE.CylinderGeometry(plateR, plateR, plateH, SEGS);
    applyTiledCylinderUVs(g, plateR, plateH, SEGS);
    pushT(buckets.iron, g, mul(trans(0, BEAM_HEIGHT, -0.04), rotX(Math.PI / 2)));
  }

  // Mounting frame — square frame around the plate
  const frameW = 0.70;
  const frameH = 0.70;
  const frameD = 0.06;
  const wallT  = 0.05;
  // Top/bottom bars
  for (const ySign of [-1, 1]) {
    const g = new THREE.BoxGeometry(frameW, wallT, frameD);
    applyTiledBoxUVs(g, frameW, wallT, frameD);
    pushT(buckets.accent, g, trans(0, BEAM_HEIGHT + ySign * (frameH / 2 - wallT / 2), -0.04));
  }
  // Side bars
  for (const xSign of [-1, 1]) {
    const innerH = frameH - 2 * wallT;
    const g = new THREE.BoxGeometry(wallT, innerH, frameD);
    applyTiledBoxUVs(g, wallT, innerH, frameD);
    pushT(buckets.accent, g, trans(xSign * (frameW / 2 - wallT / 2), BEAM_HEIGHT, -0.04));
  }

  // Downstream scintillator screen — thin rectangle offset behind the plate
  {
    const screenW = 0.24;
    const screenH = 0.24;
    const screenD = 0.008;
    const g = new THREE.BoxGeometry(screenW, screenH, screenD);
    applyTiledBoxUVs(g, screenW, screenH, screenD);
    pushT(buckets.copper, g, trans(0, BEAM_HEIGHT, 0.08));
  }

  // Actuator arm — allows inserting/retracting the plate
  {
    const rodR = 0.02;
    const rodH = 0.35;
    const g = new THREE.CylinderGeometry(rodR, rodR, rodH, 8);
    applyTiledCylinderUVs(g, rodR, rodH, 8);
    pushT(buckets.detail, g, trans(0, BEAM_HEIGHT + plateR + rodH / 2, -0.04));
  }

  // Pneumatic cylinder at top of actuator
  {
    const cylR = 0.04;
    const cylH = 0.14;
    const g = new THREE.CylinderGeometry(cylR, cylR, cylH, SEGS);
    applyTiledCylinderUVs(g, cylR, cylH, SEGS);
    pushT(buckets.detail, g, trans(0, BEAM_HEIGHT + plateR + 0.35 + cylH / 2, -0.04));
  }

  // Support pedestal
  const sBaseH = 0.05;
  const sColW = 0.20;
  const sColD = 0.12;
  const sColH = BEAM_HEIGHT - frameH / 2 - sBaseH;
  {
    const base = new THREE.BoxGeometry(sColW + 0.10, sBaseH, sColD + 0.04);
    applyTiledBoxUVs(base, sColW + 0.10, sBaseH, sColD + 0.04);
    pushT(buckets.stand, base, trans(0, sBaseH / 2, 0));
    if (sColH > 0.04) {
      const col = new THREE.BoxGeometry(sColW, sColH, sColD);
      applyTiledBoxUVs(col, sColW, sColH, sColD);
      pushT(buckets.stand, col, trans(0, sBaseH + sColH / 2, 0));
    }
  }

  return buckets;
}

// ── Sextupole ───────────────────────────────────────────────────────
// subL=2 subW=2 subH=3 → 1m long, 1m wide, 1.5m tall
// Six-pole magnet — hexagonal yoke with six pole tips and racetrack
// coils, similar to the quadrupole but with 6-fold symmetry.
export function _buildSextupoleRoles() {
  const buckets = makeBuckets();

  const magL = 1.0;
  const yokeOuter = 0.44;
  const poleCount = 6;
  const poleTipR = PIPE_R + 0.04;
  const poleBaseR = yokeOuter - 0.08;
  const poleLen = poleBaseR - poleTipR;
  const poleW = 0.16;

  // Hexagonal yoke — rendered as 6 slabs forming the return-iron ring
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3;
    const slabW = 2 * yokeOuter * Math.sin(Math.PI / 6);
    const slabT = 0.10;
    const g = new THREE.BoxGeometry(slabW, slabT, magL);
    applyTiledBoxUVs(g, slabW, slabT, magL);
    const cx = Math.cos(angle) * (yokeOuter - slabT / 2);
    const cy = Math.sin(angle) * (yokeOuter - slabT / 2);
    const r = new THREE.Matrix4().makeRotationZ(angle);
    const t = trans(cx, BEAM_HEIGHT + cy, 0);
    pushT(buckets.accent, g, mul(t, r));
  }

  // Six pole tips pointing radially inward
  for (let i = 0; i < poleCount; i++) {
    const angle = (i * Math.PI) / 3 + Math.PI / 6;
    const g = new THREE.BoxGeometry(poleW, poleLen, magL);
    applyTiledBoxUVs(g, poleW, poleLen, magL);
    const cx = Math.cos(angle) * (poleTipR + poleLen / 2);
    const cy = Math.sin(angle) * (poleTipR + poleLen / 2);
    const r = new THREE.Matrix4().makeRotationZ(angle);
    const t = trans(cx, BEAM_HEIGHT + cy, 0);
    pushT(buckets.iron, g, mul(t, r));
  }

  // Coil pairs flanking each pole tip
  const coilBarW = 0.06;
  const coilBarH = poleLen * 0.75;
  const coilOff = poleW / 2 + coilBarW / 2 + 0.005;
  const coilRadC = poleTipR + poleLen / 2;
  for (let i = 0; i < poleCount; i++) {
    const angle = (i * Math.PI) / 3 + Math.PI / 6;
    for (const tSign of [-1, 1]) {
      const g = new THREE.BoxGeometry(coilBarW, coilBarH, magL);
      applyTiledBoxUVs(g, coilBarW, coilBarH, magL);
      const perpAngle = angle + Math.PI / 2;
      const cx = Math.cos(angle) * coilRadC + Math.cos(perpAngle) * tSign * coilOff;
      const cy = Math.sin(angle) * coilRadC + Math.sin(perpAngle) * tSign * coilOff;
      const r = new THREE.Matrix4().makeRotationZ(angle);
      const t = trans(cx, BEAM_HEIGHT + cy, 0);
      pushT(buckets.copper, g, mul(t, r));
    }
  }

  // Beam pipe through center
  {
    const g = new THREE.CylinderGeometry(PIPE_R, PIPE_R, magL, SEGS);
    applyTiledCylinderUVs(g, PIPE_R, magL, SEGS);
    pushT(buckets.pipe, g, mul(trans(0, BEAM_HEIGHT, 0), rotX(Math.PI / 2)));
  }

  // Pedestal supports
  const sBaseH = 0.06;
  const sColW = 0.22;
  const sColD = 0.16;
  const bottomY = BEAM_HEIGHT - yokeOuter;
  const sColH = Math.max(0.04, bottomY - sBaseH);
  for (const zSign of [-1, 1]) {
    const zPos = zSign * (magL / 2 - sColD / 2 - 0.04);
    const baseW = sColW + 0.14;
    const baseD = sColD + 0.06;
    const base = new THREE.BoxGeometry(baseW, sBaseH, baseD);
    applyTiledBoxUVs(base, baseW, sBaseH, baseD);
    pushT(buckets.stand, base, trans(0, sBaseH / 2, zPos));
    if (sColH > 0.05) {
      const col = new THREE.BoxGeometry(sColW, sColH, sColD);
      applyTiledBoxUVs(col, sColW, sColH, sColD);
      pushT(buckets.stand, col, trans(0, sBaseH + sColH / 2, zPos));
    }
  }

  return buckets;
}
