// src/renderer3d/builders/cooling-builder.js
//
// Role-bucket builders for cooling infrastructure.
// All items are floor-standing modules (placement: 'module').
//
// Conventions match component-builder.js:
//   - Origin at footprint center, y = 0 at floor.
//   - 1 sub-tile = 0.5 m.
//   - THREE is a CDN global — do NOT import it.

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

function makeBuckets() {
  return { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };
}

// ── Cryogenics ──────────────────────────────────────────────────────

/**
 * LN2 Dewar — 2×2 floor module, subH 4 (2.0 m tall).
 * Classic stainless vacuum-jacketed cylinder with a domed top,
 * fill/vent ports, pressure gauge, and a level indicator strip.
 */
export function _buildLN2DewarRoles() {
  const b = makeBuckets();

  // Footprint 1.0 m × 1.0 m, height 2.0 m

  // Base ring / feet
  const baseR = 0.42, baseH = 0.06;
  {
    const g = new THREE.CylinderGeometry(baseR, baseR, baseH, SEGS);
    applyTiledCylinderUVs(g, baseR, baseH, SEGS);
    pushT(b.stand, g, trans(0, baseH / 2, 0));
  }

  // Main vessel body — tall cylinder
  const vesselR = 0.38, vesselH = 1.60;
  {
    const g = new THREE.CylinderGeometry(vesselR, vesselR, vesselH, SEGS);
    applyTiledCylinderUVs(g, vesselR, vesselH, SEGS);
    pushT(b.pipe, g, trans(0, baseH + vesselH / 2, 0));
  }

  // Domed top cap (half-sphere approximated by a squat cone)
  {
    const g = new THREE.CylinderGeometry(0.08, vesselR, 0.18, SEGS);
    applyTiledCylinderUVs(g, vesselR, 0.18, SEGS);
    pushT(b.pipe, g, trans(0, baseH + vesselH + 0.09, 0));
  }

  // Fill/vent port — short pipe on top
  {
    const portR = 0.04, portH = 0.10;
    const g = new THREE.CylinderGeometry(portR, portR, portH, 8);
    applyTiledCylinderUVs(g, portR, portH, 8);
    pushT(b.detail, g, trans(0.12, baseH + vesselH + 0.18 + portH / 2, 0));
  }

  // Pressure relief valve — smaller port offset
  {
    const prR = 0.025, prH = 0.07;
    const g = new THREE.CylinderGeometry(prR, prR, prH, 6);
    applyTiledCylinderUVs(g, prR, prH, 6);
    pushT(b.accent, g, trans(-0.10, baseH + vesselH + 0.18 + prH / 2, 0.05));
  }

  // Level indicator strip on the side — thin tall box
  {
    const sW = 0.03, sH = vesselH * 0.7, sD = 0.01;
    const g = new THREE.BoxGeometry(sW, sH, sD);
    applyTiledBoxUVs(g, sW, sH, sD);
    pushT(b.accent, g, trans(vesselR + 0.005, baseH + vesselH * 0.45, 0));
  }

  // Liquid withdrawal valve at bottom side
  {
    const valveR = 0.03, valveL = 0.10;
    const g = new THREE.CylinderGeometry(valveR, valveR, valveL, 8);
    applyTiledCylinderUVs(g, valveR, valveL, 8);
    const m = new THREE.Matrix4().multiplyMatrices(
      trans(vesselR + valveL / 2, baseH + 0.15, 0),
      new THREE.Matrix4().makeRotationZ(-Math.PI / 2),
    );
    pushT(b.detail, g, m);
  }

  return b;
}

/**
 * Cryocooler — 2×2 floor module, subH 4 (2.0 m tall).
 * Box-shaped compressor unit on the bottom with a cylindrical cold
 * head rising from the top center. Helium flex lines on the side.
 */
export function _buildCryocoolerRoles() {
  const b = makeBuckets();

  // Base frame
  const baseW = 0.85, baseH = 0.05, baseD = 0.85;
  {
    const g = new THREE.BoxGeometry(baseW, baseH, baseD);
    applyTiledBoxUVs(g, baseW, baseH, baseD);
    pushT(b.stand, g, trans(0, baseH / 2, 0));
  }

  // Compressor unit — large box
  const compW = 0.75, compH = 0.90, compD = 0.75;
  {
    const g = new THREE.BoxGeometry(compW, compH, compD);
    applyTiledBoxUVs(g, compW, compH, compD);
    pushT(b.iron, g, trans(0, baseH + compH / 2, 0));
  }

  // Cold head pedestal — shorter cylinder above compressor
  const pedR = 0.18, pedH = 0.40;
  {
    const g = new THREE.CylinderGeometry(pedR, pedR, pedH, SEGS);
    applyTiledCylinderUVs(g, pedR, pedH, SEGS);
    pushT(b.pipe, g, trans(0, baseH + compH + pedH / 2, 0));
  }

  // Cold finger — narrow cylinder on top of pedestal
  const fingerR = 0.06, fingerH = 0.45;
  {
    const g = new THREE.CylinderGeometry(fingerR, fingerR, fingerH, SEGS);
    applyTiledCylinderUVs(g, fingerR, fingerH, SEGS);
    pushT(b.copper, g, trans(0, baseH + compH + pedH + fingerH / 2, 0));
  }

  // Flange ring at cold head base
  {
    const fR = pedR + 0.04, fH = 0.03;
    const g = new THREE.CylinderGeometry(fR, fR, fH, SEGS);
    applyTiledCylinderUVs(g, fR, fH, SEGS);
    pushT(b.detail, g, trans(0, baseH + compH + fH / 2, 0));
  }

  // Helium flex line on the side — two small horizontal pipes
  for (let i = 0; i < 2; i++) {
    const lineR = 0.02, lineL = 0.12;
    const g = new THREE.CylinderGeometry(lineR, lineR, lineL, 6);
    applyTiledCylinderUVs(g, lineR, lineL, 6);
    const m = new THREE.Matrix4().multiplyMatrices(
      trans(compW / 2 + lineL / 2, baseH + compH * 0.6 + i * 0.12, 0),
      new THREE.Matrix4().makeRotationZ(-Math.PI / 2),
    );
    pushT(b.accent, g, m);
  }

  return b;
}

/**
 * LN2 Pre-cooler — 3×2 floor module, subH 4 (2.0 m tall).
 * Heat exchanger: tall finned box with pipe manifolds on top and
 * inlet/outlet stubs on the sides.
 */
export function _buildLN2PrecoolerRoles() {
  const b = makeBuckets();

  // Base frame
  const baseW = 0.88, baseH = 0.05, baseD = 1.35;
  {
    const g = new THREE.BoxGeometry(baseW, baseH, baseD);
    applyTiledBoxUVs(g, baseW, baseH, baseD);
    pushT(b.stand, g, trans(0, baseH / 2, 0));
  }

  // Main heat exchanger body
  const bodyW = 0.78, bodyH = 1.40, bodyD = 1.20;
  {
    const g = new THREE.BoxGeometry(bodyW, bodyH, bodyD);
    applyTiledBoxUVs(g, bodyW, bodyH, bodyD);
    pushT(b.pipe, g, trans(0, baseH + bodyH / 2, 0));
  }

  // Pipe manifold on top — horizontal cylinder along Z
  {
    const mR = 0.08, mL = bodyD * 0.8;
    const g = new THREE.CylinderGeometry(mR, mR, mL, SEGS);
    applyTiledCylinderUVs(g, mR, mL, SEGS);
    const m = new THREE.Matrix4().multiplyMatrices(
      trans(0.15, baseH + bodyH + mR + 0.02, 0),
      rotX(Math.PI / 2),
    );
    pushT(b.copper, g, m);
  }

  // Second manifold
  {
    const mR = 0.06, mL = bodyD * 0.8;
    const g = new THREE.CylinderGeometry(mR, mR, mL, SEGS);
    applyTiledCylinderUVs(g, mR, mL, SEGS);
    const m = new THREE.Matrix4().multiplyMatrices(
      trans(-0.15, baseH + bodyH + mR + 0.02, 0),
      rotX(Math.PI / 2),
    );
    pushT(b.accent, g, m);
  }

  // Side inlet/outlet stubs (±Z faces)
  for (const zSign of [-1, 1]) {
    const stubR = 0.05, stubL = 0.10;
    const g = new THREE.CylinderGeometry(stubR, stubR, stubL, 8);
    applyTiledCylinderUVs(g, stubR, stubL, 8);
    const m = new THREE.Matrix4().multiplyMatrices(
      trans(0, baseH + bodyH * 0.5, zSign * (bodyD / 2 + stubL / 2)),
      rotX(Math.PI / 2),
    );
    pushT(b.detail, g, m);
  }

  return b;
}

/**
 * Helium Recovery/Storage — 6×3 floor module, subH 4 (2.0 m tall), cylinder.
 * Two horizontal cylindrical storage tanks on a frame with interconnecting
 * piping and a pressure gauge.
 */
export function _buildHeRecoveryRoles() {
  const b = makeBuckets();

  // Support frame / skid base
  const baseW = 1.30, baseH = 0.06, baseD = 2.70;
  {
    const g = new THREE.BoxGeometry(baseW, baseH, baseD);
    applyTiledBoxUVs(g, baseW, baseH, baseD);
    pushT(b.stand, g, trans(0, baseH / 2, 0));
  }

  // Two saddle supports per tank
  const saddleW = 0.10, saddleH = 0.35, saddleD = 0.90;
  for (const xSign of [-0.35, 0.35]) {
    for (const zOff of [-0.70, 0.70]) {
      const g = new THREE.BoxGeometry(saddleW, saddleH, 0.12);
      applyTiledBoxUVs(g, saddleW, saddleH, 0.12);
      pushT(b.stand, g, trans(xSign, baseH + saddleH / 2, zOff));
    }
  }

  // Two horizontal cylindrical tanks
  const tankR = 0.42, tankL = 2.20;
  for (const xOff of [-0.35, 0.35]) {
    const g = new THREE.CylinderGeometry(tankR, tankR, tankL, SEGS);
    applyTiledCylinderUVs(g, tankR, tankL, SEGS);
    const m = new THREE.Matrix4().multiplyMatrices(
      trans(xOff, baseH + 0.35 + tankR, 0),
      rotX(Math.PI / 2),
    );
    pushT(b.pipe, g, m);
  }

  // Hemispherical end caps (approximated as short cones) on ±Z of each tank
  for (const xOff of [-0.35, 0.35]) {
    for (const zSign of [-1, 1]) {
      const g = new THREE.CylinderGeometry(0.05, tankR, 0.15, SEGS);
      applyTiledCylinderUVs(g, tankR, 0.15, SEGS);
      const m = new THREE.Matrix4().multiplyMatrices(
        trans(xOff, baseH + 0.35 + tankR, zSign * (tankL / 2 + 0.075)),
        rotX(zSign * Math.PI / 2),
      );
      pushT(b.pipe, g, m);
    }
  }

  // Interconnect pipe between the two tanks (horizontal along X)
  {
    const pR = 0.04, pL = 0.50;
    const g = new THREE.CylinderGeometry(pR, pR, pL, 8);
    applyTiledCylinderUVs(g, pR, pL, 8);
    const m = new THREE.Matrix4().multiplyMatrices(
      trans(0, baseH + 0.35 + tankR * 2 + 0.04, 0.40),
      new THREE.Matrix4().makeRotationZ(Math.PI / 2),
    );
    pushT(b.detail, g, m);
  }

  // Pressure gauge on top of one tank
  {
    const gR = 0.05, gH = 0.08;
    const g = new THREE.CylinderGeometry(gR, gR, gH, 8);
    applyTiledCylinderUVs(g, gR, gH, 8);
    pushT(b.accent, g, trans(-0.35, baseH + 0.35 + tankR * 2 + gH / 2, -0.30));
  }

  // Relief valve
  {
    const rvR = 0.03, rvH = 0.10;
    const g = new THREE.CylinderGeometry(rvR, rvR, rvH, 6);
    applyTiledCylinderUVs(g, rvR, rvH, 6);
    pushT(b.accent, g, trans(0.35, baseH + 0.35 + tankR * 2 + rvH / 2, 0.50));
  }

  return b;
}

// ── Distribution ────────────────────────────────────────────────────

/**
 * Water Load — 2×1 floor module, subH 2 (1.0 m tall).
 * Cylindrical RF absorber vessel with water inlet/outlet pipes and a
 * waveguide flange on one end.
 */
export function _buildWaterLoadRoles() {
  const b = makeBuckets();

  // Base plate
  const baseW = 0.44, baseH = 0.04, baseD = 0.88;
  {
    const g = new THREE.BoxGeometry(baseW, baseH, baseD);
    applyTiledBoxUVs(g, baseW, baseH, baseD);
    pushT(b.stand, g, trans(0, baseH / 2, 0));
  }

  // Main absorber vessel — horizontal cylinder
  const vesselR = 0.15, vesselL = 0.70;
  {
    const g = new THREE.CylinderGeometry(vesselR, vesselR, vesselL, SEGS);
    applyTiledCylinderUVs(g, vesselR, vesselL, SEGS);
    const m = new THREE.Matrix4().multiplyMatrices(
      trans(0, baseH + vesselR + 0.05, 0),
      rotX(Math.PI / 2),
    );
    pushT(b.pipe, g, m);
  }

  // Waveguide flange on -Z end
  {
    const fW = 0.18, fH = 0.18, fD = 0.03;
    const g = new THREE.BoxGeometry(fW, fH, fD);
    applyTiledBoxUVs(g, fW, fH, fD);
    pushT(b.iron, g, trans(0, baseH + vesselR + 0.05, -(vesselL / 2 + fD / 2)));
  }

  // Water inlet pipe on top
  {
    const pR = 0.025, pH = 0.12;
    const g = new THREE.CylinderGeometry(pR, pR, pH, 6);
    applyTiledCylinderUVs(g, pR, pH, 6);
    pushT(b.accent, g, trans(-0.06, baseH + vesselR * 2 + 0.05 + pH / 2, -0.10));
  }

  // Water outlet pipe on top
  {
    const pR = 0.025, pH = 0.12;
    const g = new THREE.CylinderGeometry(pR, pR, pH, 6);
    applyTiledCylinderUVs(g, pR, pH, 6);
    pushT(b.accent, g, trans(0.06, baseH + vesselR * 2 + 0.05 + pH / 2, 0.10));
  }

  return b;
}

// ── Plant ───────────────────────────────────────────────────────────

/**
 * Cooling Tower — 6×4 floor module, subH 6 (3.0 m tall), cylindrical.
 * Tall open-top tower with louvered base, tapered body, and a large
 * fan housing on top.
 */
export function _buildCoolingTowerRoles() {
  const b = makeBuckets();

  // Concrete/steel base basin
  const basinW = 1.70, basinH = 0.30, basinD = 2.70;
  {
    const g = new THREE.BoxGeometry(basinW, basinH, basinD);
    applyTiledBoxUVs(g, basinW, basinH, basinD);
    pushT(b.stand, g, trans(0, basinH / 2, 0));
  }

  // Tower body — tapered cylinder (wider at top for the fan shroud)
  const botR = 0.80, topR = 1.00, towerH = 2.20;
  {
    const g = new THREE.CylinderGeometry(topR, botR, towerH, SEGS);
    applyTiledCylinderUVs(g, topR, towerH, SEGS);
    pushT(b.iron, g, trans(0, basinH + towerH / 2, 0));
  }

  // Fan shroud ring at top
  {
    const shroudR = topR + 0.06, shroudH = 0.12;
    const g = new THREE.CylinderGeometry(shroudR, shroudR, shroudH, SEGS);
    applyTiledCylinderUVs(g, shroudR, shroudH, SEGS);
    pushT(b.detail, g, trans(0, basinH + towerH + shroudH / 2, 0));
  }

  // Fan hub at center top
  {
    const hubR = 0.18, hubH = 0.10;
    const g = new THREE.CylinderGeometry(hubR, hubR, hubH, SEGS);
    applyTiledCylinderUVs(g, hubR, hubH, SEGS);
    pushT(b.accent, g, trans(0, basinH + towerH + 0.12 + hubH / 2, 0));
  }

  // Fan blades — 4 flat boxes radiating from hub
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    const bladeW = 0.60, bladeH = 0.02, bladeD = 0.14;
    const g = new THREE.BoxGeometry(bladeW, bladeH, bladeD);
    applyTiledBoxUVs(g, bladeW, bladeH, bladeD);
    const rot = new THREE.Matrix4().makeRotationY(angle);
    const tr = trans(0, basinH + towerH + 0.13, 0);
    pushT(b.detail, g, new THREE.Matrix4().multiplyMatrices(tr, rot));
  }

  // Water inlet/outlet pipes on the side of the basin
  for (const zOff of [-0.80, 0.80]) {
    const pR = 0.06, pL = 0.20;
    const g = new THREE.CylinderGeometry(pR, pR, pL, 8);
    applyTiledCylinderUVs(g, pR, pL, 8);
    const m = new THREE.Matrix4().multiplyMatrices(
      trans(basinW / 2 + pL / 2, basinH * 0.5, zOff),
      new THREE.Matrix4().makeRotationZ(-Math.PI / 2),
    );
    pushT(b.pipe, g, m);
  }

  return b;
}

/**
 * Deionizer / Water Treatment — 3×2 floor module, subH 3 (1.5 m tall).
 * Two resin column cylinders on a steel frame with interconnecting
 * piping and a control box.
 */
export function _buildDeioniserRoles() {
  const b = makeBuckets();

  // Base frame
  const baseW = 0.88, baseH = 0.05, baseD = 1.35;
  {
    const g = new THREE.BoxGeometry(baseW, baseH, baseD);
    applyTiledBoxUVs(g, baseW, baseH, baseD);
    pushT(b.stand, g, trans(0, baseH / 2, 0));
  }

  // Two vertical resin columns
  const colR = 0.16, colH = 1.10;
  for (const zOff of [-0.30, 0.30]) {
    const g = new THREE.CylinderGeometry(colR, colR, colH, SEGS);
    applyTiledCylinderUVs(g, colR, colH, SEGS);
    pushT(b.pipe, g, trans(0, baseH + colH / 2, zOff));
  }

  // Top caps on columns
  for (const zOff of [-0.30, 0.30]) {
    const capR = colR + 0.02, capH = 0.03;
    const g = new THREE.CylinderGeometry(capR, capR, capH, SEGS);
    applyTiledCylinderUVs(g, capR, capH, SEGS);
    pushT(b.detail, g, trans(0, baseH + colH + capH / 2, zOff));
  }

  // Interconnecting pipe on top between columns (horizontal along Z)
  {
    const pR = 0.03, pL = 0.45;
    const g = new THREE.CylinderGeometry(pR, pR, pL, 8);
    applyTiledCylinderUVs(g, pR, pL, 8);
    const m = new THREE.Matrix4().multiplyMatrices(
      trans(0.10, baseH + colH + 0.05, 0),
      rotX(Math.PI / 2),
    );
    pushT(b.copper, g, m);
  }

  // Small control/readout box on the side
  const ctrlW = 0.20, ctrlH = 0.25, ctrlD = 0.12;
  {
    const g = new THREE.BoxGeometry(ctrlW, ctrlH, ctrlD);
    applyTiledBoxUVs(g, ctrlW, ctrlH, ctrlD);
    pushT(b.accent, g, trans(baseW / 2 - ctrlW / 2 - 0.02, baseH + colH * 0.7, 0));
  }

  // Inlet/outlet stubs at base of columns
  for (const zOff of [-0.30, 0.30]) {
    const stubR = 0.035, stubL = 0.10;
    const g = new THREE.CylinderGeometry(stubR, stubR, stubL, 6);
    applyTiledCylinderUVs(g, stubR, stubL, 6);
    const m = new THREE.Matrix4().multiplyMatrices(
      trans(colR + stubL / 2, baseH + 0.15, zOff),
      new THREE.Matrix4().makeRotationZ(-Math.PI / 2),
    );
    pushT(b.detail, g, m);
  }

  return b;
}
