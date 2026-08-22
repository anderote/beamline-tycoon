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
  return {
    accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [],
    coldWater: [], hotWater: [],
  };
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

// ── Helium recovery chain ───────────────────────────────────────────

/**
 * He Recovery Header — 1×4 floor module, subH 2 (1.0 m tall).
 *
 * A vacuum-jacketed return manifold on short stands, running the long axis of
 * the tile with branch stubs off both sides for the cryomodule relief lines.
 * It reads as plumbing, because that is what it is.
 *
 * Footprint 0.5 m (X) × 2.0 m (Z): nothing may pass x = ±0.25 or z = ±1.00,
 * which is tight. The jacket is r = 0.14 and the branch stubs reach x = ±0.24.
 */
export function _buildHeRecoveryHeaderRoles() {
  const b = makeBuckets();

  // jacketL leaves room for the end caps: 0.88 + 0.10 lands them at z = 0.98,
  // inside the 1.00 half-tile.
  const jacketR = 0.14, jacketL = 1.76, axisY = 0.62;

  // Stands — three short posts under the run.
  for (const sz of [-0.72, 0, 0.72]) {
    const sw = 0.14, sh = axisY - jacketR, sd = 0.12;
    const g = new THREE.BoxGeometry(sw, sh, sd);
    applyTiledBoxUVs(g, sw, sh, sd);
    pushT(b.stand, g, trans(0, sh / 2, sz));
  }
  // Ground rail tying the stands together
  {
    const rw = 0.16, rh = 0.05, rd = 1.70;
    const g = new THREE.BoxGeometry(rw, rh, rd);
    applyTiledBoxUVs(g, rw, rh, rd);
    pushT(b.stand, g, trans(0, rh / 2, 0));
  }

  // The header itself — outer vacuum jacket along Z.
  {
    const g = new THREE.CylinderGeometry(jacketR, jacketR, jacketL, SEGS);
    applyTiledCylinderUVs(g, jacketR, jacketL, SEGS);
    pushT(b.pipe, g, new THREE.Matrix4().multiplyMatrices(
      trans(0, axisY, 0), rotX(Math.PI / 2)));
  }
  // Jacket end caps
  for (const zSign of [-1, 1]) {
    const g = new THREE.CylinderGeometry(0.05, jacketR, 0.10, SEGS);
    applyTiledCylinderUVs(g, jacketR, 0.10, SEGS);
    pushT(b.pipe, g, new THREE.Matrix4().multiplyMatrices(
      trans(0, axisY, zSign * (jacketL / 2 + 0.05)),
      rotX(zSign * Math.PI / 2)));
  }

  // Jacket weld bands — the giveaway that this is vacuum-jacketed line rather
  // than bare pipe.
  for (const zOff of [-0.62, -0.21, 0.21, 0.62]) {
    const bandR = jacketR + 0.015, bandL = 0.05;
    const g = new THREE.CylinderGeometry(bandR, bandR, bandL, SEGS);
    applyTiledCylinderUVs(g, bandR, bandL, SEGS);
    pushT(b.detail, g, new THREE.Matrix4().multiplyMatrices(
      trans(0, axisY, zOff), rotX(Math.PI / 2)));
  }

  // Branch stubs — where each cryomodule's relief line ties in. Alternating
  // sides, and short: x = ±0.24 is the whole budget on this tile.
  for (let i = 0; i < 4; i++) {
    const zOff = -0.66 + i * 0.44;
    const xSign = i % 2 === 0 ? 1 : -1;
    const stubR = 0.045, stubL = 0.11;
    const g = new THREE.CylinderGeometry(stubR, stubR, stubL, 8);
    applyTiledCylinderUVs(g, stubR, stubL, 8);
    pushT(b.detail, g, new THREE.Matrix4().multiplyMatrices(
      trans(xSign * (jacketR + stubL / 2 - 0.015), axisY, zOff),
      new THREE.Matrix4().makeRotationZ(Math.PI / 2)));
    // Blank flange on the stub end
    const fR = 0.06, fL = 0.02;
    const gf = new THREE.CylinderGeometry(fR, fR, fL, 8);
    applyTiledCylinderUVs(gf, fR, fL, 8);
    pushT(b.accent, gf, new THREE.Matrix4().multiplyMatrices(
      trans(xSign * 0.235, axisY, zOff),
      new THREE.Matrix4().makeRotationZ(Math.PI / 2)));
  }

  // Relief stack off the top — the header still has to be able to blow.
  {
    const rR = 0.035, rL = 0.20;
    const g = new THREE.CylinderGeometry(rR, rR, rL, 8);
    applyTiledCylinderUVs(g, rR, rL, 8);
    pushT(b.accent, g, trans(0, axisY + jacketR + rL / 2, -0.44));
  }

  return b;
}

/**
 * He Gas Bag — 3×3 floor module, subH 4 (2.0 m tall).
 *
 * A rubberised balloon slumped inside a steel cage. The soft body is a stack
 * of cylinder slices with an oblate profile — widest at mid-height, sagging
 * over the bottom rail — which is what makes it read as fabric rather than a
 * pressure vessel.
 *
 * Footprint 1.5 m (X) × 1.5 m (Z), height 2.0 m: the cage posts sit at ±0.68
 * with 0.08 section, so their outer face lands at ±0.72, and the bag's widest
 * slice is r = 0.62 — clear of the cage on every side.
 */
export function _buildHeGasBagRoles() {
  const b = makeBuckets();

  // Base plate
  const baseW = 1.44, baseH = 0.06, baseD = 1.44;
  {
    const g = new THREE.BoxGeometry(baseW, baseH, baseD);
    applyTiledBoxUVs(g, baseW, baseH, baseD);
    pushT(b.stand, g, trans(0, baseH / 2, 0));
  }

  // Cage — four corner posts and a rail at top and mid-height.
  const postH = 1.86;
  for (const px2 of [-0.68, 0.68]) {
    for (const pz of [-0.68, 0.68]) {
      const pw = 0.08;
      const g = new THREE.BoxGeometry(pw, postH, pw);
      applyTiledBoxUVs(g, pw, postH, pw);
      pushT(b.stand, g, trans(px2, baseH + postH / 2, pz));
    }
  }
  for (const railY of [baseH + 0.95, baseH + postH - 0.04]) {
    for (const pz of [-0.68, 0.68]) {
      const rw = 1.44, rh = 0.06, rd = 0.06;
      const g = new THREE.BoxGeometry(rw, rh, rd);
      applyTiledBoxUVs(g, rw, rh, rd);
      pushT(b.stand, g, trans(0, railY, pz));
    }
    for (const px2 of [-0.68, 0.68]) {
      const rw = 0.06, rh = 0.06, rd = 1.44;
      const g = new THREE.BoxGeometry(rw, rh, rd);
      applyTiledBoxUVs(g, rw, rh, rd);
      pushT(b.stand, g, trans(px2, railY, 0));
    }
  }

  // The bag. Slice radii trace a fat teardrop: narrow where it is lashed to
  // the base ring, widest just above half height, rounded over the top.
  const SLICES = [
    { y: 0.10, r: 0.30 },
    { y: 0.28, r: 0.48 },
    { y: 0.50, r: 0.58 },
    { y: 0.74, r: 0.62 },
    { y: 0.98, r: 0.62 },
    { y: 1.20, r: 0.58 },
    { y: 1.40, r: 0.50 },
    { y: 1.56, r: 0.36 },
    { y: 1.66, r: 0.18 },
  ];
  for (let i = 0; i < SLICES.length - 1; i++) {
    const lo = SLICES[i], hi = SLICES[i + 1];
    const h = hi.y - lo.y;
    const g = new THREE.CylinderGeometry(hi.r, lo.r, h, SEGS);
    applyTiledCylinderUVs(g, Math.max(lo.r, hi.r), h, SEGS);
    pushT(b.iron, g, trans(0, baseH + lo.y + h / 2, 0));
  }

  // Lashing ring where the fabric clamps to the inlet spool
  {
    const rR = 0.32, rH = 0.05;
    const g = new THREE.CylinderGeometry(rR, rR, rH, SEGS);
    applyTiledCylinderUVs(g, rR, rH, SEGS);
    pushT(b.detail, g, trans(0, baseH + 0.10, 0));
  }

  // Inlet spool from the header, up through the base plate
  {
    const sR = 0.09, sH = 0.14;
    const g = new THREE.CylinderGeometry(sR, sR, sH, SEGS);
    applyTiledCylinderUVs(g, sR, sH, SEGS);
    pushT(b.pipe, g, trans(0, baseH + sH / 2, 0));
  }
  // Feed line running out the -Z face at ankle height
  {
    const fR = 0.07, fL = 0.55;
    const g = new THREE.CylinderGeometry(fR, fR, fL, SEGS);
    applyTiledCylinderUVs(g, fR, fL, SEGS);
    pushT(b.pipe, g, new THREE.Matrix4().multiplyMatrices(
      trans(0, baseH + fR, -0.42), rotX(Math.PI / 2)));
  }

  // Contents tell-tale: a weighted cable over the top rail. Bag position IS
  // the inventory gauge on a real plant.
  {
    const cR = 0.012, cL = 0.70;
    const g = new THREE.CylinderGeometry(cR, cR, cL, 6);
    applyTiledCylinderUVs(g, cR, cL, 6);
    pushT(b.accent, g, trans(0.68, baseH + postH - 0.38, 0.34));
  }
  {
    const wR = 0.05, wH = 0.10;
    const g = new THREE.CylinderGeometry(wR, wR, wH, 8);
    applyTiledCylinderUVs(g, wR, wH, 8);
    pushT(b.accent, g, trans(0.68, baseH + postH - 0.78, 0.34));
  }

  return b;
}

/**
 * He Purifier — 2×3 floor module, subH 4 (2.0 m tall).
 *
 * Two charcoal adsorber beds standing side by side on a skid with a smaller
 * drier vessel ahead of them, a switching valve manifold between the beds and
 * a regeneration vent stack. Two beds because one is always regenerating.
 *
 * Footprint 1.0 m (X) × 1.5 m (Z): the beds sit at x = ±0.24 with r = 0.20,
 * so their outer face lands at 0.44.
 */
export function _buildHePurifierRoles() {
  const b = makeBuckets();

  // Skid
  const baseW = 0.94, baseH = 0.07, baseD = 1.44;
  {
    const g = new THREE.BoxGeometry(baseW, baseH, baseD);
    applyTiledBoxUVs(g, baseW, baseH, baseD);
    pushT(b.stand, g, trans(0, baseH / 2, 0));
  }

  const bedR = 0.20, bedH = 1.15, bedZ = -0.32;
  for (const bx of [-0.24, 0.24]) {
    // Adsorber vessel
    {
      const g = new THREE.CylinderGeometry(bedR, bedR, bedH, SEGS);
      applyTiledCylinderUVs(g, bedR, bedH, SEGS);
      pushT(b.pipe, g, trans(bx, baseH + bedH / 2, bedZ));
    }
    // Dished head
    {
      const g = new THREE.CylinderGeometry(0.07, bedR, 0.14, SEGS);
      applyTiledCylinderUVs(g, bedR, 0.14, SEGS);
      pushT(b.pipe, g, trans(bx, baseH + bedH + 0.07, bedZ));
    }
    // Cold-end insulation collar — the beds run at 80 K
    {
      const cR = bedR + 0.03, cH = 0.30;
      const g = new THREE.CylinderGeometry(cR, cR, cH, SEGS);
      applyTiledCylinderUVs(g, cR, cH, SEGS);
      pushT(b.detail, g, trans(bx, baseH + 0.30, bedZ));
    }
    // Inlet elbow off the top head
    {
      const eR = 0.04, eL = 0.20;
      const g = new THREE.CylinderGeometry(eR, eR, eL, 8);
      applyTiledCylinderUVs(g, eR, eL, 8);
      pushT(b.copper, g, trans(bx, baseH + bedH + 0.14 + eL / 2, bedZ));
    }
  }

  // Switching valve manifold between the beds — the thing that flips which
  // bed is on line and which is regenerating.
  {
    const mR = 0.05, mL = 0.44;
    const g = new THREE.CylinderGeometry(mR, mR, mL, 8);
    applyTiledCylinderUVs(g, mR, mL, 8);
    pushT(b.copper, g, new THREE.Matrix4().multiplyMatrices(
      trans(0, baseH + bedH + 0.30, bedZ),
      new THREE.Matrix4().makeRotationZ(Math.PI / 2)));
  }
  for (const vx of [-0.24, 0.24]) {
    const vR = 0.055, vH = 0.10;
    const g = new THREE.CylinderGeometry(vR, vR, vH, 8);
    applyTiledCylinderUVs(g, vR, vH, 8);
    pushT(b.accent, g, trans(vx, baseH + bedH + 0.35, bedZ));
  }

  // Molecular-sieve drier ahead of the beds — shorter, fatter, warm.
  {
    const dR = 0.24, dH = 0.62, dZ = 0.42;
    const g = new THREE.CylinderGeometry(dR, dR, dH, SEGS);
    applyTiledCylinderUVs(g, dR, dH, SEGS);
    pushT(b.iron, g, trans(0, baseH + dH / 2, dZ));
    // Moisture analyser head
    const aR = 0.05, aH = 0.12;
    const ga = new THREE.CylinderGeometry(aR, aR, aH, 8);
    applyTiledCylinderUVs(ga, aR, aH, 8);
    pushT(b.accent, ga, trans(0.10, baseH + dH + aH / 2, dZ));
  }

  // Regeneration vent stack — where the contaminant actually leaves.
  {
    const sR = 0.045, sH = 1.60;
    const g = new THREE.CylinderGeometry(sR, sR, sH, 8);
    applyTiledCylinderUVs(g, sR, sH, 8);
    pushT(b.detail, g, trans(-0.40, baseH + sH / 2, 0.14));
  }
  {
    const cR = 0.07, cH = 0.10;
    const g = new THREE.CylinderGeometry(cR, cR, cH, 8);
    applyTiledCylinderUVs(g, cR, cH, 8);
    pushT(b.accent, g, trans(-0.40, baseH + 1.60 + cH / 2, 0.14));
  }

  // Purity readout cabinet on the +X side
  {
    const cW = 0.08, cH = 0.34, cD = 0.26;
    const g = new THREE.BoxGeometry(cW, cH, cD);
    applyTiledBoxUVs(g, cW, cH, cD);
    pushT(b.accent, g, trans(0.44, baseH + 0.50, 0.30));
  }

  return b;
}

/**
 * He Liquefier — 4×5 floor module, subH 6 (3.0 m tall).
 *
 * The endgame of the chain, and the largest thing in it: an insulated cold box
 * with two turbine expanders on its roof, a horizontal storage dewar on
 * saddles alongside, and warm-end process piping between them.
 *
 * Footprint 2.0 m (X) × 2.5 m (Z), height 3.0 m. Widest features are the cold
 * box at x = ±0.85 and the dewar's saddles at z = 1.12; the turbine stacks top
 * out at y = 2.86.
 */
export function _buildHeLiquefierRoles() {
  const b = makeBuckets();

  // Skid under the whole assembly
  const baseW = 1.92, baseH = 0.09, baseD = 2.42;
  {
    const g = new THREE.BoxGeometry(baseW, baseH, baseD);
    applyTiledBoxUVs(g, baseW, baseH, baseD);
    pushT(b.stand, g, trans(0, baseH / 2, 0));
  }

  // Cold box — the insulated tower. Sits toward -Z, leaving the +Z strip for
  // the dewar.
  // cbH is set by the turbine stack above it: 0.09 skid + 2.10 + 0.08 roof
  // plate + 0.34 turbine + 0.22 brake head + 0.12 instrument cap = 2.95, under
  // the 3.00 m envelope.
  const cbW = 1.70, cbH = 2.10, cbD = 1.20, cbZ = -0.55;
  {
    const g = new THREE.BoxGeometry(cbW, cbH, cbD);
    applyTiledBoxUVs(g, cbW, cbH, cbD);
    pushT(b.iron, g, trans(0, baseH + cbH / 2, cbZ));
  }
  // Roof plate
  {
    const rW = 1.80, rH = 0.08, rD = 1.30;
    const g = new THREE.BoxGeometry(rW, rH, rD);
    applyTiledBoxUVs(g, rW, rH, rD);
    pushT(b.detail, g, trans(0, baseH + cbH + rH / 2, cbZ));
  }
  // Vertical stiffeners on the cold box faces
  for (const sx of [-0.56, 0, 0.56]) {
    const sW = 0.10, sH = cbH, sD = 0.06;
    const g = new THREE.BoxGeometry(sW, sH, sD);
    applyTiledBoxUVs(g, sW, sH, sD);
    pushT(b.stand, g, trans(sx, baseH + sH / 2, cbZ - (cbD / 2 + sD / 2)));
  }

  const roofY = baseH + cbH + 0.08;

  // Two turbine expanders on the roof — this is what makes it a liquefier
  // rather than a storage tank.
  for (const tx of [-0.44, 0.44]) {
    // Turbine housing
    {
      const tR = 0.22, tH = 0.34;
      const g = new THREE.CylinderGeometry(tR, tR, tH, SEGS);
      applyTiledCylinderUVs(g, tR, tH, SEGS);
      pushT(b.pipe, g, trans(tx, roofY + tH / 2, cbZ));
    }
    // Brake/oil head on top
    {
      const hR = 0.13, hH = 0.22;
      const g = new THREE.CylinderGeometry(hR, hR, hH, SEGS);
      applyTiledCylinderUVs(g, hR, hH, SEGS);
      pushT(b.detail, g, trans(tx, roofY + 0.34 + hH / 2, cbZ));
    }
    // Instrument cap
    {
      const cR = 0.06, cH = 0.12;
      const g = new THREE.CylinderGeometry(cR, cR, cH, 8);
      applyTiledCylinderUVs(g, cR, cH, 8);
      pushT(b.accent, g, trans(tx, roofY + 0.56 + cH / 2, cbZ));
    }
    // Cold return leg down the cold box face
    {
      const lR = 0.055, lH = 0.90;
      const g = new THREE.CylinderGeometry(lR, lR, lH, 8);
      applyTiledCylinderUVs(g, lR, lH, 8);
      pushT(b.copper, g, trans(tx, roofY - lH / 2, cbZ + cbD / 2 + 0.06));
    }
  }

  // Joule-Thomson valve station between the turbines
  {
    const vR = 0.09, vH = 0.26;
    const g = new THREE.CylinderGeometry(vR, vR, vH, 8);
    applyTiledCylinderUVs(g, vR, vH, 8);
    pushT(b.accent, g, trans(0, roofY + vH / 2, cbZ - 0.34));
  }

  // Storage dewar — horizontal vessel on saddles, along X.
  const dewR = 0.40, dewL = 1.50, dewZ = 0.72;
  const dewY = baseH + 0.34 + dewR;
  {
    const g = new THREE.CylinderGeometry(dewR, dewR, dewL, SEGS);
    applyTiledCylinderUVs(g, dewR, dewL, SEGS);
    pushT(b.pipe, g, new THREE.Matrix4().multiplyMatrices(
      trans(0, dewY, dewZ), new THREE.Matrix4().makeRotationZ(Math.PI / 2)));
  }
  for (const xSign of [-1, 1]) {
    const g = new THREE.CylinderGeometry(0.06, dewR, 0.16, SEGS);
    applyTiledCylinderUVs(g, dewR, 0.16, SEGS);
    pushT(b.pipe, g, new THREE.Matrix4().multiplyMatrices(
      trans(xSign * (dewL / 2 + 0.08), dewY, dewZ),
      new THREE.Matrix4().makeRotationZ(-xSign * Math.PI / 2)));
  }
  // Saddles
  for (const sx of [-0.50, 0.50]) {
    const sW = 0.14, sH = 0.34, sD = 0.36;
    const g = new THREE.BoxGeometry(sW, sH, sD);
    applyTiledBoxUVs(g, sW, sH, sD);
    pushT(b.stand, g, trans(sx, baseH + sH / 2, dewZ));
  }
  // Liquid level and relief on top of the dewar
  {
    const rR = 0.045, rH = 0.20;
    const g = new THREE.CylinderGeometry(rR, rR, rH, 8);
    applyTiledCylinderUVs(g, rR, rH, 8);
    pushT(b.accent, g, trans(0.30, dewY + dewR + rH / 2, dewZ));
  }
  {
    const gR = 0.06, gH = 0.09;
    const g = new THREE.CylinderGeometry(gR, gR, gH, 8);
    applyTiledCylinderUVs(g, gR, gH, 8);
    pushT(b.accent, g, trans(-0.30, dewY + dewR + gH / 2, dewZ));
  }

  // Warm-end process piping tying cold box to dewar
  for (const px2 of [-0.62, 0.62]) {
    const pR = 0.06, pL = 0.60;
    const g = new THREE.CylinderGeometry(pR, pR, pL, 8);
    applyTiledCylinderUVs(g, pR, pL, 8);
    pushT(b.copper, g, new THREE.Matrix4().multiplyMatrices(
      trans(px2, baseH + 0.42, 0.06), rotX(Math.PI / 2)));
  }

  // Control cabinet against the cold box, +X face
  {
    const cW = 0.12, cH = 0.80, cD = 0.50;
    const g = new THREE.BoxGeometry(cW, cH, cD);
    applyTiledBoxUVs(g, cW, cH, cD);
    pushT(b.accent, g, trans(cbW / 2 + cW / 2, baseH + cH / 2, cbZ - 0.20));
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
 * Fan-Coil Cooler — 1×2 floor module, subH 2 (1.0 m tall).
 * The bottom rung of the cooling ladder and the only one with no
 * refrigeration in it: a finned water-to-air coil, a squirrel-cage blower
 * behind it, and a discharge grille. Read the silhouette as "no compressor,
 * no basin" — that is what separates it from the package chiller next to it
 * in the palette.
 */
export function _buildFanCoilCoolerRoles() {
  const b = makeBuckets();

  // Footprint 0.5 m (X) × 1.0 m (Z), height 1.0 m.
  const baseW = 0.44, baseH = 0.05, baseD = 0.88;

  // Skid base
  {
    const g = new THREE.BoxGeometry(baseW, baseH, baseD);
    applyTiledBoxUVs(g, baseW, baseH, baseD);
    pushT(b.stand, g, trans(0, baseH / 2, 0));
  }

  // Sheet-metal cabinet
  const cabW = 0.40, cabH = 0.78, cabD = 0.80;
  {
    const g = new THREE.BoxGeometry(cabW, cabH, cabD);
    applyTiledBoxUVs(g, cabW, cabH, cabD);
    pushT(b.iron, g, trans(0, baseH + cabH / 2, 0));
  }

  // Fin stack over the coil half (-Z end) — thin vertical plates proud of
  // the cabinet face so the coil reads as finned tube, not a blank box.
  for (let i = 0; i < 7; i++) {
    const finW = 0.02, finH = 0.46, finD = 0.30;
    const g = new THREE.BoxGeometry(finW, finH, finD);
    applyTiledBoxUVs(g, finW, finH, finD);
    pushT(b.copper, g, trans(cabW / 2 + 0.01, baseH + 0.42, -0.34 + i * 0.055));
  }

  // Coil supply/return headers running along the fin stack. Radius and
  // offset are picked so the outermost surface lands at x = 0.235 — inside
  // the 0.25 m half-tile, since a 1-wide module has no room to spare.
  for (const y of [baseH + 0.20, baseH + 0.64]) {
    const hR = 0.025, hL = 0.40;
    const g = new THREE.CylinderGeometry(hR, hR, hL, 8);
    applyTiledCylinderUVs(g, hR, hL, 8);
    const m = new THREE.Matrix4().multiplyMatrices(
      trans(cabW / 2 + 0.01, y, -0.20),
      rotX(Math.PI / 2),
    );
    pushT(b.pipe, g, m);
  }

  // Blower housing at the +Z end
  {
    const houR = 0.16, houH = 0.34;
    const g = new THREE.CylinderGeometry(houR, houR, houH, SEGS);
    applyTiledCylinderUVs(g, houR, houH, SEGS);
    const m = new THREE.Matrix4().multiplyMatrices(
      trans(0, baseH + 0.42, 0.28),
      rotX(Math.PI / 2),
    );
    pushT(b.detail, g, m);
  }

  // Discharge grille bars on the +Z face
  for (let i = 0; i < 4; i++) {
    const barW = 0.30, barH = 0.02, barD = 0.02;
    const g = new THREE.BoxGeometry(barW, barH, barD);
    applyTiledBoxUVs(g, barW, barH, barD);
    pushT(b.accent, g, trans(0, baseH + 0.30 + i * 0.08, cabD / 2 + 0.01));
  }

  // Hose connections at the base — this thing plumbs in with two hoses.
  for (const xOff of [-0.10, 0.10]) {
    const sR = 0.03, sL = 0.08;
    const g = new THREE.CylinderGeometry(sR, sR, sL, 6);
    applyTiledCylinderUVs(g, sR, sL, 6);
    const m = new THREE.Matrix4().multiplyMatrices(
      trans(xOff, baseH + 0.12, -(cabD / 2 + sL / 2)),
      rotX(Math.PI / 2),
    );
    pushT(b.pipe, g, m);
  }

  return b;
}

/**
 * Package Chiller — 2×2 floor module, subH 3 (1.5 m tall).
 * One skid, one refrigerant circuit: scroll compressor, brazed-plate
 * evaporator, a buffer tank, and a single air-cooled condenser fan on the
 * roof. The roof fan is the tell that this one actually refrigerates.
 */
export function _buildPackageChillerRoles() {
  const b = makeBuckets();

  // Footprint 1.0 m × 1.0 m, height 1.5 m.
  const baseW = 0.88, baseH = 0.08, baseD = 0.88;

  // Structural skid frame — a chiller like this ships bolted to one.
  {
    const g = new THREE.BoxGeometry(baseW, baseH, baseD);
    applyTiledBoxUVs(g, baseW, baseH, baseD);
    pushT(b.stand, g, trans(0, baseH / 2, 0));
  }

  // Main cabinet. Shallower than the skid and pushed to -Z so the buffer
  // tank can sit beside it on the same frame and still be visible — the
  // whole silhouette has to fit inside 1.0 m × 1.0 m.
  const cabW = 0.80, cabH = 1.05, cabD = 0.56, cabZ = -0.14;
  {
    const g = new THREE.BoxGeometry(cabW, cabH, cabD);
    applyTiledBoxUVs(g, cabW, cabH, cabD);
    pushT(b.iron, g, trans(0, baseH + cabH / 2, cabZ));
  }

  // Scroll compressor — squat cylinder standing on the skid, half-exposed
  // out the -X side the way a service panel leaves it.
  {
    const compR = 0.15, compH = 0.42;
    const g = new THREE.CylinderGeometry(compR, compR, compH, SEGS);
    applyTiledCylinderUVs(g, compR, compH, SEGS);
    pushT(b.detail, g, trans(-(cabW / 2 - 0.06), baseH + compH / 2 + 0.04, cabZ - 0.10));
  }

  // Brazed-plate evaporator — a stack of thin plates on the +X side
  for (let i = 0; i < 6; i++) {
    const plW = 0.02, plH = 0.34, plD = 0.20;
    const g = new THREE.BoxGeometry(plW, plH, plD);
    applyTiledBoxUVs(g, plW, plH, plD);
    pushT(b.copper, g, trans(cabW / 2 + 0.01, baseH + 0.30, cabZ - 0.14 + i * 0.055));
  }

  // Buffer tank — horizontal cylinder lying on the skid on the +Z side,
  // where the shallow cabinet left room for it.
  const tankR = 0.13, tankZ = 0.28;
  {
    const tankL = 0.56;
    const g = new THREE.CylinderGeometry(tankR, tankR, tankL, SEGS);
    applyTiledCylinderUVs(g, tankR, tankL, SEGS);
    const m = new THREE.Matrix4().multiplyMatrices(
      trans(0, baseH + tankR + 0.03, tankZ),
      new THREE.Matrix4().makeRotationZ(Math.PI / 2),
    );
    pushT(b.pipe, g, m);
  }
  // Saddle supports under the tank
  for (const xOff of [-0.20, 0.20]) {
    const sW = 0.06, sH = 0.06, sD = 0.16;
    const g = new THREE.BoxGeometry(sW, sH, sD);
    applyTiledBoxUVs(g, sW, sH, sD);
    pushT(b.stand, g, trans(xOff, baseH + sH / 2, tankZ));
  }

  // Condenser fan shroud on the roof, over the cabinet
  const roofY = baseH + cabH;
  {
    const shR = 0.26, shH = 0.10;
    const g = new THREE.CylinderGeometry(shR, shR, shH, SEGS);
    applyTiledCylinderUVs(g, shR, shH, SEGS);
    pushT(b.detail, g, trans(0, roofY + shH / 2, cabZ));
  }

  // Fan hub + blades
  {
    const hubR = 0.07, hubH = 0.06;
    const g = new THREE.CylinderGeometry(hubR, hubR, hubH, SEGS);
    applyTiledCylinderUVs(g, hubR, hubH, SEGS);
    pushT(b.accent, g, trans(0, roofY + 0.10 + hubH / 2, cabZ));
  }
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    const bladeW = 0.40, bladeH = 0.015, bladeD = 0.09;
    const g = new THREE.BoxGeometry(bladeW, bladeH, bladeD);
    applyTiledBoxUVs(g, bladeW, bladeH, bladeD);
    const m = new THREE.Matrix4().multiplyMatrices(
      trans(0, roofY + 0.12, cabZ),
      new THREE.Matrix4().makeRotationY(angle),
    );
    pushT(b.detail, g, m);
  }

  // Six independently routable process-water branches: four on the primary
  // +X header, two on the opposite header. They all share the same 5 kW loop.
  for (const [side, offsets] of [[1, [-0.30, -0.10, 0.10, 0.30]], [-1, [-0.18, 0.18]]]) {
    for (const zOff of offsets) {
      const pR = 0.04, pL = 0.08;
      const g = new THREE.CylinderGeometry(pR, pR, pL, 8);
      applyTiledCylinderUVs(g, pR, pL, 8);
      pushT(b.pipe, g, new THREE.Matrix4().multiplyMatrices(
        trans(side * (baseW / 2 + pL / 2), baseH + 0.28, zOff),
        new THREE.Matrix4().makeRotationZ(-side * Math.PI / 2),
      ));
    }
  }

  // Control panel on the -Z face
  {
    const cW = 0.26, cH = 0.30, cD = 0.06;
    const g = new THREE.BoxGeometry(cW, cH, cD);
    applyTiledBoxUVs(g, cW, cH, cD);
    pushT(b.accent, g, trans(0.16, baseH + 0.72, cabZ - (cabD / 2 + cD / 2)));
  }

  return b;
}

/**
 * Dual-Circuit Chiller — 3×3 floor module, subH 3 (1.5 m tall).
 * The silhouette has to say "two of everything": two cabinets split by a
 * visible seam, two compressors, two roof fans, two supply/return pairs and
 * two control panels. That redundancy is the entire reason this rung exists
 * over the single-circuit package chiller below it.
 *
 * Footprint 1.5 m × 1.5 m, so nothing may pass x = ±0.75 or z = ±0.75.
 * Widest features: the evaporator plate stacks at x = ±0.69 and the control
 * panels at z = -0.72.
 */
export function _buildDualCircuitChillerRoles() {
  const b = makeBuckets();

  // Common skid — both circuits ship bolted to one frame.
  const baseW = 1.38, baseH = 0.08, baseD = 1.38;
  {
    const g = new THREE.BoxGeometry(baseW, baseH, baseD);
    applyTiledBoxUVs(g, baseW, baseH, baseD);
    pushT(b.stand, g, trans(0, baseH / 2, 0));
  }

  // Two cabinets with a 0.10 m seam down the middle. Shallower than the skid
  // and pushed to -Z, leaving the +Z strip clear for the compressors.
  const cabW = 0.62, cabH = 0.92, cabD = 1.00, cabZ = -0.16;
  const CIRCUITS = [-0.36, 0.36];
  for (const cx of CIRCUITS) {
    const g = new THREE.BoxGeometry(cabW, cabH, cabD);
    applyTiledBoxUVs(g, cabW, cabH, cabD);
    pushT(b.iron, g, trans(cx, baseH + cabH / 2, cabZ));
  }

  // Shared water manifold riser in the seam — the two circuits chill
  // different loops but they leave through the same set of headers.
  {
    const mR = 0.05, mH = 1.06;
    const g = new THREE.CylinderGeometry(mR, mR, mH, SEGS);
    applyTiledCylinderUVs(g, mR, mH, SEGS);
    pushT(b.pipe, g, trans(0, baseH + mH / 2, cabZ));
  }

  const roofY = baseH + cabH;
  for (const cx of CIRCUITS) {
    // Condenser fan shroud
    {
      const shR = 0.27, shH = 0.10;
      const g = new THREE.CylinderGeometry(shR, shR, shH, SEGS);
      applyTiledCylinderUVs(g, shR, shH, SEGS);
      pushT(b.detail, g, trans(cx, roofY + shH / 2, cabZ));
    }
    // Fan hub
    {
      const hubR = 0.07, hubH = 0.06;
      const g = new THREE.CylinderGeometry(hubR, hubR, hubH, SEGS);
      applyTiledCylinderUVs(g, hubR, hubH, SEGS);
      pushT(b.accent, g, trans(cx, roofY + 0.10 + hubH / 2, cabZ));
    }
    // Fan blades — swept radius 0.21, so cx ± 0.21 = 0.57, well inside.
    for (let i = 0; i < 4; i++) {
      const bladeW = 0.42, bladeH = 0.015, bladeD = 0.09;
      const g = new THREE.BoxGeometry(bladeW, bladeH, bladeD);
      applyTiledBoxUVs(g, bladeW, bladeH, bladeD);
      const m = new THREE.Matrix4().multiplyMatrices(
        trans(cx, roofY + 0.12, cabZ),
        new THREE.Matrix4().makeRotationY((i / 4) * Math.PI * 2),
      );
      pushT(b.detail, g, m);
    }

    // Scroll compressor standing on the skid ahead of its cabinet
    const compR = 0.14, compH = 0.38, compZ = 0.48;
    {
      const g = new THREE.CylinderGeometry(compR, compR, compH, SEGS);
      applyTiledCylinderUVs(g, compR, compH, SEGS);
      pushT(b.detail, g, trans(cx, baseH + compH / 2, compZ));
    }
    // Discharge line off the top of the compressor
    {
      const dR = 0.035, dL = 0.22;
      const g = new THREE.CylinderGeometry(dR, dR, dL, 8);
      applyTiledCylinderUVs(g, dR, dL, 8);
      pushT(b.copper, g, trans(cx, baseH + compH + dL / 2, compZ));
    }

    // Brazed-plate evaporator stack on the outboard face. Outermost surface
    // lands at |x| = 0.69, inside the 0.75 m half-tile.
    const outX = cx + Math.sign(cx) * (cabW / 2 + 0.01);
    for (let i = 0; i < 6; i++) {
      const plW = 0.02, plH = 0.30, plD = 0.18;
      const g = new THREE.BoxGeometry(plW, plH, plD);
      applyTiledBoxUVs(g, plW, plH, plD);
      pushT(b.copper, g, trans(outX, baseH + 0.40, cabZ - 0.15 + i * 0.06));
    }

    // Control panel on the -Z face — two setpoints, two keypads.
    {
      const cW = 0.24, cH = 0.28, cD = 0.06;
      const g = new THREE.BoxGeometry(cW, cH, cD);
      applyTiledBoxUVs(g, cW, cH, cD);
      pushT(b.accent, g, trans(cx, baseH + 0.60, cabZ - (cabD / 2 + cD / 2)));
    }
  }

  // Both refrigerant circuits feed one six-branch process-water header for
  // routing: four branches on +X, two on -X. Capacity remains one 175 kW
  // nameplate even when every branch is connected.
  for (const [side, offsets] of [[1, [-0.50, -0.17, 0.17, 0.50]], [-1, [-0.25, 0.25]]]) {
    for (const zOff of offsets) {
      const pR = 0.04, pL = 0.10;
      const g = new THREE.CylinderGeometry(pR, pR, pL, 8);
      applyTiledCylinderUVs(g, pR, pL, 8);
      pushT(b.pipe, g, new THREE.Matrix4().multiplyMatrices(
        trans(side * (0.67 + pL / 2), 0.54, zOff),
        new THREE.Matrix4().makeRotationZ(-side * Math.PI / 2),
      ));
    }
  }

  return b;
}

/**
 * Dry Cooler Bank — 3×6 floor module, subH 4 (2.0 m tall).
 * Long, low and open: a raised steel frame on legs, a pair of V-configuration
 * finned coils along its length, and a row of three axial fans pulling air up
 * through them. No basin and no fill pack — the tell that this rejects to air
 * rather than evaporating water, which is why the tower still outranks it.
 *
 * Footprint 1.5 m (X) × 3.0 m (Z): nothing may pass x = ±0.75 or z = ±1.50.
 * Widest features: the adiabatic spray headers at x = ±0.63 and the water
 * headers at z = -1.36.
 */
export function _buildDryCoolerBankRoles() {
  const b = makeBuckets();

  const legH = 0.80, deckY = legH + 0.05;

  // Legs — three pairs down the length, so the bank reads as elevated with
  // clear air under it.
  for (const lx of [-0.55, 0.55]) {
    for (const lz of [-1.15, 0, 1.15]) {
      const lw = 0.10, ld = 0.10;
      const g = new THREE.BoxGeometry(lw, legH, ld);
      applyTiledBoxUVs(g, lw, legH, ld);
      pushT(b.stand, g, trans(lx, legH / 2, lz));
    }
    // Longitudinal tie between the legs
    const tW = 0.08, tH = 0.08, tD = 2.30;
    const g = new THREE.BoxGeometry(tW, tH, tD);
    applyTiledBoxUVs(g, tW, tH, tD);
    pushT(b.stand, g, trans(lx, 0.22, 0));
  }

  // Deck the coils sit on
  {
    const dW = 1.30, dH = 0.10, dD = 2.70;
    const g = new THREE.BoxGeometry(dW, dH, dD);
    applyTiledBoxUVs(g, dW, dH, dD);
    pushT(b.stand, g, trans(0, deckY, 0));
  }

  // V-coils — two slabs leaning in toward each other. Rotated ±25° about Z,
  // a 0.70 × 0.05 slab reaches 0.328 in X, so centring at ±0.32 lands the
  // outer edge at 0.65.
  const coilTilt = 25 * Math.PI / 180;
  const coilY = deckY + 0.40;
  for (const side of [-1, 1]) {
    const cW = 0.70, cH = 0.05, cD = 2.50;
    const g = new THREE.BoxGeometry(cW, cH, cD);
    applyTiledBoxUVs(g, cW, cH, cD);
    const m = new THREE.Matrix4().multiplyMatrices(
      trans(side * 0.32, coilY, 0),
      new THREE.Matrix4().makeRotationZ(side * coilTilt),
    );
    pushT(b.copper, g, m);
  }
  // Fin-pack banding across each coil, so the slab reads as finned tube
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const fW = 0.72, fH = 0.03, fD = 0.03;
      const g = new THREE.BoxGeometry(fW, fH, fD);
      applyTiledBoxUVs(g, fW, fH, fD);
      const m = new THREE.Matrix4().multiplyMatrices(
        trans(side * 0.32, coilY + 0.045, -1.00 + i * 0.50),
        new THREE.Matrix4().makeRotationZ(side * coilTilt),
      );
      pushT(b.pipe, g, m);
    }
  }

  // Plenum deck closing the top of the V, carrying the fans
  const plenumY = 1.45;
  {
    const pW = 1.30, pH = 0.06, pD = 2.70;
    const g = new THREE.BoxGeometry(pW, pH, pD);
    applyTiledBoxUVs(g, pW, pH, pD);
    pushT(b.iron, g, trans(0, plenumY, 0));
  }

  // Three axial fans along the length
  for (const fz of [-0.90, 0, 0.90]) {
    {
      const shR = 0.34, shH = 0.14;
      const g = new THREE.CylinderGeometry(shR, shR, shH, SEGS);
      applyTiledCylinderUVs(g, shR, shH, SEGS);
      pushT(b.detail, g, trans(0, plenumY + 0.03 + shH / 2, fz));
    }
    {
      const hubR = 0.08, hubH = 0.06;
      const g = new THREE.CylinderGeometry(hubR, hubR, hubH, SEGS);
      applyTiledCylinderUVs(g, hubR, hubH, SEGS);
      pushT(b.accent, g, trans(0, plenumY + 0.16 + hubH / 2, fz));
    }
    for (let i = 0; i < 4; i++) {
      const bladeW = 0.56, bladeH = 0.015, bladeD = 0.12;
      const g = new THREE.BoxGeometry(bladeW, bladeH, bladeD);
      applyTiledBoxUVs(g, bladeW, bladeH, bladeD);
      const m = new THREE.Matrix4().multiplyMatrices(
        trans(0, plenumY + 0.18, fz),
        new THREE.Matrix4().makeRotationY((i / 4) * Math.PI * 2 + 0.3),
      );
      pushT(b.detail, g, m);
    }
    // Finger guard over each fan
    for (let i = 0; i < 3; i++) {
      const gW = 0.62, gH = 0.02, gD = 0.02;
      const g = new THREE.BoxGeometry(gW, gH, gD);
      applyTiledBoxUVs(g, gW, gH, gD);
      pushT(b.accent, g, trans(0, plenumY + 0.26, fz - 0.18 + i * 0.18));
    }
  }

  // Adiabatic pre-cool spray headers running the length just below the coil
  // faces — the thing that buys back capacity on a hot afternoon.
  for (const sx of [-0.60, 0.60]) {
    const sR = 0.03, sL = 2.40;
    const g = new THREE.CylinderGeometry(sR, sR, sL, 8);
    applyTiledCylinderUVs(g, sR, sL, 8);
    const m = new THREE.Matrix4().multiplyMatrices(
      trans(sx, deckY + 0.20, 0),
      rotX(Math.PI / 2),
    );
    pushT(b.pipe, g, m);
    // Nozzle stubs pointing up into the coil
    for (let i = 0; i < 5; i++) {
      const nR = 0.02, nL = 0.08;
      const ng = new THREE.CylinderGeometry(nR, nR, nL, 6);
      applyTiledCylinderUVs(ng, nR, nL, 6);
      pushT(b.accent, ng, trans(sx, deckY + 0.20 + nL / 2 + 0.02, -1.00 + i * 0.50));
    }
  }

  // Water supply/return headers across the -Z end, with risers up to the coil
  for (const y of [0.50, 0.68]) {
    const hR = 0.06, hL = 1.20;
    const g = new THREE.CylinderGeometry(hR, hR, hL, SEGS);
    applyTiledCylinderUVs(g, hR, hL, SEGS);
    const m = new THREE.Matrix4().multiplyMatrices(
      trans(0, y, -1.30),
      new THREE.Matrix4().makeRotationZ(Math.PI / 2),
    );
    pushT(b.pipe, g, m);
  }
  for (const rx of [-0.45, 0.45]) {
    const rR = 0.05, rL = 0.60;
    const g = new THREE.CylinderGeometry(rR, rR, rL, 8);
    applyTiledCylinderUVs(g, rR, rL, 8);
    pushT(b.pipe, g, trans(rx, 0.68 + rL / 2, -1.30));
  }

  // Fan-control / VFD panel on the -Z end frame
  {
    const cW = 0.30, cH = 0.36, cD = 0.08;
    const g = new THREE.BoxGeometry(cW, cH, cD);
    applyTiledBoxUVs(g, cW, cH, cD);
    pushT(b.accent, g, trans(0, 0.55, -(1.30 + cD / 2)));
  }

  return b;
}

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

/**
 * LCW Skid — 2×4 floor module, subH 3 (1.5 m tall).
 * Plumbing on a frame, not a cabinet. A duty/standby centrifugal pump pair
 * sits on plinths at the -Z end, water climbs through a bag filter and a DI
 * cartridge vessel down the centreline, and two headers on posts run the full
 * length at high level with handwheel isolation valves standing off them.
 * Nothing is enclosed — you can see every joint — which is exactly what
 * separates this from the chillers either side of it in the catalogue.
 *
 * Footprint 1.0 m (X) × 2.0 m (Z): nothing may pass x = ±0.50 or z = ±1.00.
 * Widest features: the header outlet flanges at x = ±0.48 and the gauge board
 * dials at z = +0.978.
 */
export function _buildLcwSkidRoles() {
  const b = makeBuckets();

  const headerY = 1.09;

  // Skid deck and its two longitudinal channel rails.
  {
    const dW = 0.94, dH = 0.06, dD = 1.92;
    const g = new THREE.BoxGeometry(dW, dH, dD);
    applyTiledBoxUVs(g, dW, dH, dD);
    pushT(b.stand, g, trans(0, dH / 2, 0));
  }
  for (const rx of [-0.38, 0.38]) {
    const rW = 0.12, rH = 0.10, rD = 1.92;
    const g = new THREE.BoxGeometry(rW, rH, rD);
    applyTiledBoxUVs(g, rW, rH, rD);
    pushT(b.stand, g, trans(rx, 0.06 + rH / 2, 0));
  }

  // Duty/standby pump pair at the -Z end: plinth, TEFC motor lying along Z,
  // volute ahead of it, suction stub down to the deck, and a discharge riser
  // climbing to the header on that pump's own side.
  for (const pumpX of [-0.22, 0.22]) {
    {
      const pW = 0.30, pH = 0.12, pD = 0.46;
      const g = new THREE.BoxGeometry(pW, pH, pD);
      applyTiledBoxUVs(g, pW, pH, pD);
      pushT(b.stand, g, trans(pumpX, 0.06 + pH / 2, -0.50));
    }
    {
      const mR = 0.11, mL = 0.34;
      const g = new THREE.CylinderGeometry(mR, mR, mL, SEGS);
      applyTiledCylinderUVs(g, mR, mL, SEGS);
      pushT(b.iron, g, new THREE.Matrix4().multiplyMatrices(
        trans(pumpX, 0.30, -0.60), rotX(Math.PI / 2),
      ));
    }
    {
      const vR = 0.13, vH = 0.18;
      const g = new THREE.CylinderGeometry(vR, vR, vH, SEGS);
      applyTiledCylinderUVs(g, vR, vH, SEGS);
      pushT(b.detail, g, trans(pumpX, 0.27, -0.32));
    }
    {
      const sR = 0.05, sH = 0.10;
      const g = new THREE.CylinderGeometry(sR, sR, sH, 8);
      applyTiledCylinderUVs(g, sR, sH, 8);
      pushT(b.pipe, g, trans(pumpX, 0.13, -0.32));
    }
    {
      const dR = 0.045, dH = 0.72;
      const g = new THREE.CylinderGeometry(dR, dR, dH, 8);
      applyTiledCylinderUVs(g, dR, dH, 8);
      pushT(b.pipe, g, trans(pumpX, 0.36 + dH / 2, -0.32));
    }
    {
      const eR = 0.045, eL = 0.16;
      const g = new THREE.CylinderGeometry(eR, eR, eL, 8);
      applyTiledCylinderUVs(g, eR, eL, 8);
      pushT(b.pipe, g, new THREE.Matrix4().multiplyMatrices(
        trans(Math.sign(pumpX) * 0.26, headerY, -0.32),
        new THREE.Matrix4().makeRotationZ(Math.PI / 2),
      ));
    }
  }

  // Bag filter housing on the centreline, swing-bolt lid on top.
  {
    const fR = 0.115, fH = 0.54;
    const g = new THREE.CylinderGeometry(fR, fR, fH, SEGS);
    applyTiledCylinderUVs(g, fR, fH, SEGS);
    pushT(b.pipe, g, trans(0, 0.06 + fH / 2, 0.14));
  }
  {
    const lR = 0.135, lH = 0.05;
    const g = new THREE.CylinderGeometry(lR, lR, lH, SEGS);
    applyTiledCylinderUVs(g, lR, lH, SEGS);
    pushT(b.detail, g, trans(0, 0.625, 0.14));
  }

  // DI cartridge vessel — the tall one, with a resistivity band round it.
  {
    const vR = 0.15, vH = 0.84;
    const g = new THREE.CylinderGeometry(vR, vR, vH, SEGS);
    applyTiledCylinderUVs(g, vR, vH, SEGS);
    pushT(b.pipe, g, trans(0, 0.06 + vH / 2, 0.62));
  }
  {
    const cR = 0.16, cH = 0.05;
    const g = new THREE.CylinderGeometry(cR, cR, cH, SEGS);
    applyTiledCylinderUVs(g, cR, cH, SEGS);
    pushT(b.detail, g, trans(0, 0.925, 0.62));
  }
  {
    const bR = 0.155, bH = 0.06;
    const g = new THREE.CylinderGeometry(bR, bR, bH, SEGS);
    applyTiledCylinderUVs(g, bR, bH, SEGS);
    pushT(b.accent, g, trans(0, 0.70, 0.62));
  }

  // Filter → DI crossover, then DI → supply header.
  {
    const pR = 0.04, pH = 0.14;
    const g = new THREE.CylinderGeometry(pR, pR, pH, 8);
    applyTiledCylinderUVs(g, pR, pH, 8);
    pushT(b.copper, g, trans(0, 0.66, 0.14));
  }
  {
    const pR = 0.04, pL = 0.40;
    const g = new THREE.CylinderGeometry(pR, pR, pL, 8);
    applyTiledCylinderUVs(g, pR, pL, 8);
    pushT(b.copper, g, new THREE.Matrix4().multiplyMatrices(
      trans(0, 0.72, 0.40), rotX(Math.PI / 2),
    ));
  }
  {
    const pR = 0.04, pH = 0.16;
    const g = new THREE.CylinderGeometry(pR, pR, pH, 8);
    applyTiledCylinderUVs(g, pR, pH, 8);
    pushT(b.copper, g, trans(0, 1.03, 0.62));
  }
  {
    const pR = 0.04, pL = 0.32;
    const g = new THREE.CylinderGeometry(pR, pR, pL, 8);
    applyTiledCylinderUVs(g, pR, pL, 8);
    pushT(b.copper, g, new THREE.Matrix4().multiplyMatrices(
      trans(0.15, headerY, 0.62),
      new THREE.Matrix4().makeRotationZ(Math.PI / 2),
    ));
  }

  // Supply and return headers on posts, the full length of the skid.
  for (const hx of [-0.30, 0.30]) {
    for (const pz of [-0.70, 0.70]) {
      const pW = 0.08, pH = 0.98, pD = 0.10;
      const g = new THREE.BoxGeometry(pW, pH, pD);
      applyTiledBoxUVs(g, pW, pH, pD);
      pushT(b.stand, g, trans(hx, 0.06 + pH / 2, pz));
    }
    {
      const hR = 0.065, hL = 1.80;
      const g = new THREE.CylinderGeometry(hR, hR, hL, SEGS);
      applyTiledCylinderUVs(g, hR, hL, SEGS);
      pushT(b.pipe, g, new THREE.Matrix4().multiplyMatrices(
        trans(hx, headerY, 0), rotX(Math.PI / 2),
      ));
    }

    // Two isolation valves per header — body across the run, rising stem,
    // handwheel on top. The handwheels are the tallest thing on the skid.
    for (const vz of [-0.30, 0.55]) {
      {
        const vR = 0.09, vH = 0.11;
        const g = new THREE.CylinderGeometry(vR, vR, vH, SEGS);
        applyTiledCylinderUVs(g, vR, vH, SEGS);
        pushT(b.accent, g, new THREE.Matrix4().multiplyMatrices(
          trans(hx, headerY, vz), rotX(Math.PI / 2),
        ));
      }
      {
        const sR = 0.02, sH = 0.13;
        const g = new THREE.CylinderGeometry(sR, sR, sH, 6);
        applyTiledCylinderUVs(g, sR, sH, 6);
        pushT(b.detail, g, trans(hx, 1.245, vz));
      }
      {
        const wR = 0.085, wH = 0.025;
        const g = new THREE.CylinderGeometry(wR, wR, wH, SEGS);
        applyTiledCylinderUVs(g, wR, wH, SEGS);
        pushT(b.detail, g, trans(hx, 1.32, vz));
      }
    }

  }

  // Four branches on the primary +X header and two opposite. The logical
  // anchors use these exact flange centres; all six share one 25 kW circuit.
  for (const [side, offsets] of [[1, [-0.66, -0.22, 0.22, 0.66]], [-1, [-0.30, 0.30]]]) {
    for (const outletZ of offsets) {
      const cR = 0.05, cL = 0.18;
      const c = new THREE.CylinderGeometry(cR, cR, cL, 8);
      applyTiledCylinderUVs(c, cR, cL, 8);
      pushT(b.pipe, c, new THREE.Matrix4().multiplyMatrices(
        trans(side * 0.39, headerY, outletZ),
        new THREE.Matrix4().makeRotationZ(Math.PI / 2),
      ));

      const fR = 0.075, fH = 0.03;
      const f = new THREE.CylinderGeometry(fR, fR, fH, SEGS);
      applyTiledCylinderUVs(f, fR, fH, SEGS);
      pushT(b.detail, f, new THREE.Matrix4().multiplyMatrices(
        trans(side * 0.465, headerY, outletZ),
        new THREE.Matrix4().makeRotationZ(Math.PI / 2),
      ));
    }
  }

  // Control panel on the -Z end, two status lamps on its face.
  {
    const cW = 0.34, cH = 0.40, cD = 0.08;
    const g = new THREE.BoxGeometry(cW, cH, cD);
    applyTiledBoxUVs(g, cW, cH, cD);
    pushT(b.accent, g, trans(-0.10, 0.72, -0.92));
  }
  for (const lx of [-0.18, -0.02]) {
    const lR = 0.025, lH = 0.02;
    const g = new THREE.CylinderGeometry(lR, lR, lH, 8);
    applyTiledCylinderUVs(g, lR, lH, 8);
    pushT(b.detail, g, new THREE.Matrix4().multiplyMatrices(
      trans(lx, 0.85, -0.965), rotX(Math.PI / 2),
    ));
  }

  // Pressure gauge board on its own post at the +Z end.
  {
    const sW = 0.06, sH = 0.78, sD = 0.06;
    const g = new THREE.BoxGeometry(sW, sH, sD);
    applyTiledBoxUVs(g, sW, sH, sD);
    pushT(b.stand, g, trans(0, 0.06 + sH / 2, 0.93));
  }
  {
    const bW = 0.36, bH = 0.18, bD = 0.04;
    const g = new THREE.BoxGeometry(bW, bH, bD);
    applyTiledBoxUVs(g, bW, bH, bD);
    pushT(b.accent, g, trans(0, 0.85, 0.93));
  }
  for (const gx of [-0.12, 0, 0.12]) {
    const gR = 0.05, gH = 0.025;
    const g = new THREE.CylinderGeometry(gR, gR, gH, SEGS);
    applyTiledCylinderUVs(g, gR, gH, SEGS);
    pushT(b.detail, g, new THREE.Matrix4().multiplyMatrices(
      trans(gx, 0.85, 0.965), rotX(Math.PI / 2),
    ));
  }

  return b;
}

/**
 * Chiller — 3×4 floor module, subH 4 (2.0 m tall).
 * The 300 kW sibling of the Package Chiller, and deliberately built from the
 * same parts list: skid frame, cabinet pushed to -Z, compressors standing in
 * the open strip, an evaporator, roof fans over a condenser, and a control
 * panel on the -Z face. Everything the small one has one of, this has two of
 * — two compressors, two roof fans, condenser coil on both flanks — and the
 * evaporator has grown from a brazed-plate pack into a shell-and-tube barrel
 * with saddles. Seen side by side the package unit is a box with a fan on it,
 * and this is a plant room on a pallet.
 *
 * Footprint 1.5 m (X) × 2.0 m (Z): nothing may pass x = ±0.75 or z = ±1.00.
 * Widest features: the condenser fin banding at x = ±0.74 and the control
 * panel lamps at z = -1.00.
 */
export function _buildChillerRoles() {
  const b = makeBuckets();

  const skidTop = 0.10;
  const cabW = 1.30, cabH = 1.45, cabD = 1.12, cabZ = -0.35;
  const roofY = skidTop + cabH;

  // Structural skid.
  {
    const sW = 1.44, sH = 0.10, sD = 1.94;
    const g = new THREE.BoxGeometry(sW, sH, sD);
    applyTiledBoxUVs(g, sW, sH, sD);
    pushT(b.stand, g, trans(0, sH / 2, 0));
  }

  // Main cabinet, pushed to -Z so the +Z strip stays open for the machinery.
  {
    const g = new THREE.BoxGeometry(cabW, cabH, cabD);
    applyTiledBoxUVs(g, cabW, cabH, cabD);
    pushT(b.iron, g, trans(0, skidTop + cabH / 2, cabZ));
  }
  // Painted band round the cabinet base.
  {
    const bW = 1.32, bH = 0.08, bD = 1.14;
    const g = new THREE.BoxGeometry(bW, bH, bD);
    applyTiledBoxUVs(g, bW, bH, bD);
    pushT(b.accent, g, trans(0, skidTop + 0.06, cabZ));
  }
  // Roof plenum the fans draw through.
  {
    const pW = 1.32, pH = 0.06, pD = 1.14;
    const g = new THREE.BoxGeometry(pW, pH, pD);
    applyTiledBoxUVs(g, pW, pH, pD);
    pushT(b.iron, g, trans(0, roofY + pH / 2, cabZ));
  }

  // Condenser coil on both flanks. The package chiller wears one plate stack
  // on one side; this wears a full-height finned slab on each.
  for (const side of [-1, 1]) {
    {
      const cW = 0.05, cH = 1.16, cD = 1.02;
      const g = new THREE.BoxGeometry(cW, cH, cD);
      applyTiledBoxUVs(g, cW, cH, cD);
      pushT(b.copper, g, trans(side * 0.68, 0.86, cabZ));
    }
    for (let i = 0; i < 6; i++) {
      const fW = 0.08, fH = 0.025, fD = 1.04;
      const g = new THREE.BoxGeometry(fW, fH, fD);
      applyTiledBoxUVs(g, fW, fH, fD);
      pushT(b.pipe, g, trans(side * 0.70, 0.34 + i * 0.20, cabZ));
    }
  }

  // Two condenser fans in a row on the roof.
  const fanTop = roofY + 0.06;
  for (const fz of [-0.62, -0.08]) {
    {
      const shR = 0.27, shH = 0.12;
      const g = new THREE.CylinderGeometry(shR, shR, shH, SEGS);
      applyTiledCylinderUVs(g, shR, shH, SEGS);
      pushT(b.detail, g, trans(0, fanTop + shH / 2, fz));
    }
    {
      const hubR = 0.075, hubH = 0.06;
      const g = new THREE.CylinderGeometry(hubR, hubR, hubH, SEGS);
      applyTiledCylinderUVs(g, hubR, hubH, SEGS);
      pushT(b.accent, g, trans(0, fanTop + 0.12 + hubH / 2, fz));
    }
    // Swept radius sqrt(0.23² + 0.055²) = 0.237, inside the 0.27 shroud.
    for (let i = 0; i < 4; i++) {
      const bladeW = 0.46, bladeH = 0.015, bladeD = 0.11;
      const g = new THREE.BoxGeometry(bladeW, bladeH, bladeD);
      applyTiledBoxUVs(g, bladeW, bladeH, bladeD);
      pushT(b.detail, g, new THREE.Matrix4().multiplyMatrices(
        trans(0, fanTop + 0.165, fz),
        new THREE.Matrix4().makeRotationY((i / 4) * Math.PI * 2 + 0.4),
      ));
    }
    // Finger guard bars over each fan.
    for (let i = 0; i < 3; i++) {
      const gW = 0.52, gH = 0.02, gD = 0.02;
      const g = new THREE.BoxGeometry(gW, gH, gD);
      applyTiledBoxUVs(g, gW, gH, gD);
      pushT(b.accent, g, trans(0, fanTop + 0.24, fz - 0.16 + i * 0.16));
    }
  }

  // Two compressors standing on the skid in the open +Z strip, each with a
  // motor cap, a discharge riser, and a hot-gas run back into the condenser.
  for (const side of [-1, 1]) {
    const cx = side * 0.46;
    {
      const compR = 0.16, compH = 0.60;
      const g = new THREE.CylinderGeometry(compR, compR, compH, SEGS);
      applyTiledCylinderUVs(g, compR, compH, SEGS);
      pushT(b.detail, g, trans(cx, skidTop + compH / 2, 0.58));
    }
    {
      const mR = 0.17, mH = 0.07;
      const g = new THREE.CylinderGeometry(mR, mR, mH, SEGS);
      applyTiledCylinderUVs(g, mR, mH, SEGS);
      pushT(b.iron, g, trans(cx, 0.735, 0.58));
    }
    {
      const dR = 0.045, dH = 0.46;
      const g = new THREE.CylinderGeometry(dR, dR, dH, 8);
      applyTiledCylinderUVs(g, dR, dH, 8);
      pushT(b.copper, g, trans(cx, 0.77 + dH / 2, 0.58));
    }
    {
      const dR = 0.045, dL = 0.42;
      const g = new THREE.CylinderGeometry(dR, dR, dL, 8);
      applyTiledCylinderUVs(g, dR, dL, 8);
      pushT(b.copper, g, new THREE.Matrix4().multiplyMatrices(
        trans(cx, 1.21, 0.37), rotX(Math.PI / 2),
      ));
    }
    // Suction line up out of the barrel and across to this compressor.
    {
      const sR = 0.045, sH = 0.16;
      const g = new THREE.CylinderGeometry(sR, sR, sH, 8);
      applyTiledCylinderUVs(g, sR, sH, 8);
      pushT(b.copper, g, trans(side * 0.24, 0.58, 0.58));
    }
    {
      const sR = 0.045, sL = 0.24;
      const g = new THREE.CylinderGeometry(sR, sR, sL, 8);
      applyTiledCylinderUVs(g, sR, sL, 8);
      pushT(b.copper, g, new THREE.Matrix4().multiplyMatrices(
        trans(side * 0.36, 0.64, 0.58),
        new THREE.Matrix4().makeRotationZ(Math.PI / 2),
      ));
    }
  }

  // Shell-and-tube evaporator barrel across the +Z strip, on saddles.
  {
    const eR = 0.16, eL = 0.62;
    const g = new THREE.CylinderGeometry(eR, eR, eL, SEGS);
    applyTiledCylinderUVs(g, eR, eL, SEGS);
    pushT(b.pipe, g, new THREE.Matrix4().multiplyMatrices(
      trans(0, 0.34, 0.58),
      new THREE.Matrix4().makeRotationZ(Math.PI / 2),
    ));
  }
  for (const side of [-1, 1]) {
    {
      const capR = 0.165, capH = 0.04;
      const g = new THREE.CylinderGeometry(capR, capR, capH, SEGS);
      applyTiledCylinderUVs(g, capR, capH, SEGS);
      pushT(b.detail, g, new THREE.Matrix4().multiplyMatrices(
        trans(side * 0.33, 0.34, 0.58),
        new THREE.Matrix4().makeRotationZ(Math.PI / 2),
      ));
    }
    {
      const sW = 0.14, sH = 0.09, sD = 0.20;
      const g = new THREE.BoxGeometry(sW, sH, sD);
      applyTiledBoxUVs(g, sW, sH, sD);
      pushT(b.stand, g, trans(side * 0.20, skidTop + sH / 2, 0.58));
    }
  }

  // Six independently routable chilled-water branches: four on +X and two
  // on -X, all tied to the same shell-and-tube evaporator internally.
  for (const [side, offsets] of [[1, [-0.72, -0.30, 0.15, 0.60]], [-1, [-0.35, 0.35]]]) {
    for (const zOff of offsets) {
      const wR = 0.06, wL = 0.10;
      const g = new THREE.CylinderGeometry(wR, wR, wL, SEGS);
      applyTiledCylinderUVs(g, wR, wL, SEGS);
      pushT(b.pipe, g, new THREE.Matrix4().multiplyMatrices(
        trans(side * (0.67 + wL / 2), 0.74, zOff),
        new THREE.Matrix4().makeRotationZ(-side * Math.PI / 2),
      ));

      const fR = 0.085, fH = 0.03;
      const f = new THREE.CylinderGeometry(fR, fR, fH, SEGS);
      applyTiledCylinderUVs(f, fR, fH, SEGS);
      pushT(b.detail, f, new THREE.Matrix4().multiplyMatrices(
        trans(side * 0.735, 0.74, zOff),
        new THREE.Matrix4().makeRotationZ(Math.PI / 2),
      ));
    }
  }

  // Control cabinet on the -Z face, with its lamp cluster.
  {
    const cW = 0.44, cH = 0.66, cD = 0.07;
    const g = new THREE.BoxGeometry(cW, cH, cD);
    applyTiledBoxUVs(g, cW, cH, cD);
    pushT(b.accent, g, trans(0.26, 0.90, -0.945));
  }
  for (const lx of [0.14, 0.26, 0.38]) {
    const lR = 0.025, lH = 0.02;
    const g = new THREE.CylinderGeometry(lR, lR, lH, 8);
    applyTiledCylinderUVs(g, lR, lH, 8);
    pushT(b.detail, g, new THREE.Matrix4().multiplyMatrices(
      trans(lx, 1.14, -0.99), rotX(Math.PI / 2),
    ));
  }

  // Service louvres across the rest of the -Z face.
  for (let i = 0; i < 4; i++) {
    const lW = 0.50, lH = 0.03, lD = 0.02;
    const g = new THREE.BoxGeometry(lW, lH, lD);
    applyTiledBoxUVs(g, lW, lH, lD);
    pushT(b.detail, g, trans(-0.30, 0.60 + i * 0.16, -0.92));
  }

  return b;
}

/**
 * Emergency Cooling (UPS) — 2×3 floor module, subH 3 (1.5 m tall).
 * This is insurance, and it has to look like insurance rather than plant: a
 * bank of three battery/inverter cabinets down the -X side, a reserve water
 * tank and a duty/standby pump set down the +X side, a DC conduit tying the
 * two together, and a beacon on the cabinet roof. Nothing here makes cold
 * water — it only keeps existing water moving after the wall supply drops —
 * so there is no compressor, no coil and no fan anywhere in the silhouette,
 * which is the tell against every working unit in the row.
 *
 * The cabinets, cap rail, pump motors, EPO mushroom and beacon dome all sit
 * in the `iron` bucket, and the component carries
 * `textures: { iron: 'metal_painted_red' }`, so the emergency kit reads red
 * without needing a bucket the six-role system does not have.
 *
 * Footprint 1.0 m (X) × 1.5 m (Z): nothing may pass x = ±0.50 or z = ±0.75.
 * Widest features: the tank level strip at x = +0.485 and the housekeeping
 * pad at z = ±0.72.
 */
export function _buildEmergencyCoolingRoles() {
  const b = makeBuckets();

  const padTop = 0.08;

  // Housekeeping pad.
  {
    const pW = 0.94, pH = 0.08, pD = 1.44;
    const g = new THREE.BoxGeometry(pW, pH, pD);
    applyTiledBoxUVs(g, pW, pH, pD);
    pushT(b.stand, g, trans(0, pH / 2, 0));
  }

  // Battery / inverter cabinet bank down the -X side.
  const cabX = -0.26, cabH = 1.02;
  for (const cz of [-0.46, 0, 0.46]) {
    {
      const cW = 0.40, cD = 0.40;
      const g = new THREE.BoxGeometry(cW, cabH, cD);
      applyTiledBoxUVs(g, cW, cabH, cD);
      pushT(b.iron, g, trans(cabX, padTop + cabH / 2, cz));
    }
    // Door latch bar on the +X face.
    {
      const hW = 0.03, hH = 0.20, hD = 0.03;
      const g = new THREE.BoxGeometry(hW, hH, hD);
      applyTiledBoxUVs(g, hW, hH, hD);
      pushT(b.detail, g, trans(-0.045, 0.62, cz));
    }
    // Battery vent louvres near the top of each door.
    for (let i = 0; i < 3; i++) {
      const lW = 0.02, lH = 0.02, lD = 0.30;
      const g = new THREE.BoxGeometry(lW, lH, lD);
      applyTiledBoxUVs(g, lW, lH, lD);
      pushT(b.detail, g, trans(-0.05, 0.88 + i * 0.07, cz));
    }
  }
  // Continuous cap rail over the bank.
  {
    const rW = 0.44, rH = 0.05, rD = 1.40;
    const g = new THREE.BoxGeometry(rW, rH, rD);
    applyTiledBoxUVs(g, rW, rH, rD);
    pushT(b.iron, g, trans(cabX, padTop + cabH + rH / 2, 0));
  }
  // Hazard band across the cabinet fronts.
  {
    const hW = 0.02, hH = 0.10, hD = 1.36;
    const g = new THREE.BoxGeometry(hW, hH, hD);
    applyTiledBoxUVs(g, hW, hH, hD);
    pushT(b.accent, g, trans(-0.045, 0.30, 0));
  }
  // EPO mushroom on the middle cabinet, on its backing plate.
  {
    const pW = 0.02, pH = 0.14, pD = 0.14;
    const g = new THREE.BoxGeometry(pW, pH, pD);
    applyTiledBoxUVs(g, pW, pH, pD);
    pushT(b.accent, g, trans(-0.05, 0.98, 0.20));
  }
  {
    const mR = 0.04, mL = 0.03;
    const g = new THREE.CylinderGeometry(mR, mR, mL, SEGS);
    applyTiledCylinderUVs(g, mR, mL, SEGS);
    pushT(b.iron, g, new THREE.Matrix4().multiplyMatrices(
      trans(-0.04, 0.98, 0.20),
      new THREE.Matrix4().makeRotationZ(Math.PI / 2),
    ));
  }

  // Beacon on the cabinet roof — mast, lamp base, dome.
  {
    const mW = 0.05, mH = 0.16, mD = 0.05;
    const g = new THREE.BoxGeometry(mW, mH, mD);
    applyTiledBoxUVs(g, mW, mH, mD);
    pushT(b.stand, g, trans(cabX, 1.23, 0));
  }
  {
    const lR = 0.07, lH = 0.03;
    const g = new THREE.CylinderGeometry(lR, lR, lH, SEGS);
    applyTiledCylinderUVs(g, lR, lH, SEGS);
    pushT(b.detail, g, trans(cabX, 1.325, 0));
  }
  {
    const dR = 0.06, dH = 0.11;
    const g = new THREE.CylinderGeometry(dR, dR, dH, SEGS);
    applyTiledCylinderUVs(g, dR, dH, SEGS);
    pushT(b.iron, g, trans(cabX, 1.395, 0));
  }

  // Reserve water tank at the -Z end of the +X side.
  const tankX = 0.27, tankZ = -0.42;
  {
    const tR = 0.20, tH = 0.80;
    const g = new THREE.CylinderGeometry(tR, tR, tH, SEGS);
    applyTiledCylinderUVs(g, tR, tH, SEGS);
    pushT(b.pipe, g, trans(tankX, padTop + tH / 2, tankZ));
  }
  {
    const tH = 0.14;
    const g = new THREE.CylinderGeometry(0.06, 0.20, tH, SEGS);
    applyTiledCylinderUVs(g, 0.20, tH, SEGS);
    pushT(b.pipe, g, trans(tankX, 0.95, tankZ));
  }
  {
    const sW = 0.02, sH = 0.56, sD = 0.03;
    const g = new THREE.BoxGeometry(sW, sH, sD);
    applyTiledBoxUVs(g, sW, sH, sD);
    pushT(b.accent, g, trans(0.475, 0.44, tankZ));
  }
  {
    const nR = 0.035, nH = 0.10;
    const g = new THREE.CylinderGeometry(nR, nR, nH, 8);
    applyTiledCylinderUVs(g, nR, nH, 8);
    pushT(b.detail, g, trans(tankX, 1.07, tankZ));
  }
  // Tank outlet feeding the pump suction.
  {
    const oR = 0.045, oL = 0.14;
    const g = new THREE.CylinderGeometry(oR, oR, oL, 8);
    applyTiledCylinderUVs(g, oR, oL, 8);
    pushT(b.pipe, g, new THREE.Matrix4().multiplyMatrices(
      trans(tankX, 0.20, -0.15), rotX(Math.PI / 2),
    ));
  }

  // Duty/standby emergency pump set.
  for (const pz of [0.10, 0.52]) {
    {
      const pW = 0.30, pH = 0.10, pD = 0.26;
      const g = new THREE.BoxGeometry(pW, pH, pD);
      applyTiledBoxUVs(g, pW, pH, pD);
      pushT(b.stand, g, trans(tankX, padTop + pH / 2, pz));
    }
    {
      const mR = 0.085, mL = 0.22;
      const g = new THREE.CylinderGeometry(mR, mR, mL, SEGS);
      applyTiledCylinderUVs(g, mR, mL, SEGS);
      pushT(b.iron, g, new THREE.Matrix4().multiplyMatrices(
        trans(tankX, 0.29, pz + 0.08), rotX(Math.PI / 2),
      ));
    }
    {
      const vR = 0.10, vH = 0.13;
      const g = new THREE.CylinderGeometry(vR, vR, vH, SEGS);
      applyTiledCylinderUVs(g, vR, vH, SEGS);
      pushT(b.detail, g, trans(tankX, 0.26, pz - 0.13));
    }
    {
      const rR = 0.035, rH = 0.42;
      const g = new THREE.CylinderGeometry(rR, rR, rH, 8);
      applyTiledCylinderUVs(g, rR, rH, 8);
      pushT(b.pipe, g, trans(tankX, 0.325 + rH / 2, pz - 0.13));
    }
  }

  // Emergency loop header over the pumps, with its outboard connection.
  {
    const hR = 0.05, hL = 0.62;
    const g = new THREE.CylinderGeometry(hR, hR, hL, SEGS);
    applyTiledCylinderUVs(g, hR, hL, SEGS);
    pushT(b.pipe, g, new THREE.Matrix4().multiplyMatrices(
      trans(tankX, 0.76, 0.20), rotX(Math.PI / 2),
    ));
  }
  {
    const oR = 0.05, oL = 0.16;
    const g = new THREE.CylinderGeometry(oR, oR, oL, 8);
    applyTiledCylinderUVs(g, oR, oL, 8);
    pushT(b.pipe, g, new THREE.Matrix4().multiplyMatrices(
      trans(0.40, 0.76, 0.45),
      new THREE.Matrix4().makeRotationZ(Math.PI / 2),
    ));
  }

  // DC conduit from the inverter bank across to the pump starters.
  {
    const cW = 0.36, cH = 0.06, cD = 0.08;
    const g = new THREE.BoxGeometry(cW, cH, cD);
    applyTiledBoxUVs(g, cW, cH, cD);
    pushT(b.detail, g, trans(0.09, 1.05, 0.60));
  }
  {
    const cW = 0.06, cH = 0.36, cD = 0.08;
    const g = new THREE.BoxGeometry(cW, cH, cD);
    applyTiledBoxUVs(g, cW, cH, cD);
    pushT(b.detail, g, trans(0.25, 0.87, 0.60));
  }

  return b;
}

/**
 * LCW Manifold — 1×4 floor module, subH 2 (1.0 m tall), hasSurface: false.
 * The cheapest thing in the cooling list and the only one that is not a
 * machine: a supply run and a return run carried on three short stands, with
 * handwheel isolation valves where branches leave and blanked-off tees where
 * they have not been run yet. It must not read as a block — the open air
 * between and under the two runs is the whole point — so the stands are
 * deliberately thin and the runs sit clear above them. Cold supply is blue
 * and hot return is red so the two circuits remain legible at game scale.
 *
 * Footprint 0.5 m (X) × 2.0 m (Z): nothing may pass x = ±0.25 or z = ±1.00.
 * Widest features: the valve bodies at x = ±0.215 and the end flanges at
 * z = ±0.98.
 */
export function _buildCoolingManifoldRoles() {
  const b = makeBuckets();

  const runY = 0.68;
  const SUPPLY_X = -0.13, RETURN_X = 0.13;

  // Three short stands: foot plate, column, cross arm carrying both runs.
  for (const sz of [-0.72, 0, 0.72]) {
    {
      const fW = 0.20, fH = 0.03, fD = 0.16;
      const g = new THREE.BoxGeometry(fW, fH, fD);
      applyTiledBoxUVs(g, fW, fH, fD);
      pushT(b.stand, g, trans(0, fH / 2, sz));
    }
    {
      const cW = 0.09, cH = 0.56, cD = 0.10;
      const g = new THREE.BoxGeometry(cW, cH, cD);
      applyTiledBoxUVs(g, cW, cH, cD);
      pushT(b.stand, g, trans(0, cH / 2, sz));
    }
    {
      const aW = 0.36, aH = 0.06, aD = 0.09;
      const g = new THREE.BoxGeometry(aW, aH, aD);
      applyTiledBoxUVs(g, aW, aH, aD);
      pushT(b.stand, g, trans(0, 0.59, sz));
    }
  }

  // The two runs.
  {
    const hR = 0.06, hL = 1.90;
    const g = new THREE.CylinderGeometry(hR, hR, hL, SEGS);
    applyTiledCylinderUVs(g, hR, hL, SEGS);
    pushT(b.coldWater, g, new THREE.Matrix4().multiplyMatrices(
      trans(SUPPLY_X, runY, 0), rotX(Math.PI / 2),
    ));
  }
  {
    const hR = 0.055, hL = 1.90;
    const g = new THREE.CylinderGeometry(hR, hR, hL, SEGS);
    applyTiledCylinderUVs(g, hR, hL, SEGS);
    pushT(b.hotWater, g, new THREE.Matrix4().multiplyMatrices(
      trans(RETURN_X, runY, 0), rotX(Math.PI / 2),
    ));
  }

  for (const hx of [SUPPLY_X, RETURN_X]) {
    const waterBucket = hx === SUPPLY_X ? b.coldWater : b.hotWater;
    // Blank end flanges — the run terminates here, it does not carry on.
    for (const ez of [-0.965, 0.965]) {
      const fR = 0.085, fH = 0.03;
      const g = new THREE.CylinderGeometry(fR, fR, fH, SEGS);
      applyTiledCylinderUVs(g, fR, fH, SEGS);
      pushT(b.detail, g, new THREE.Matrix4().multiplyMatrices(
        trans(hx, runY, ez), rotX(Math.PI / 2),
      ));
    }

    // Isolation valves at the branch points.
    for (const vz of [-0.62, 0, 0.62]) {
      {
        const vR = 0.085, vH = 0.11;
        const g = new THREE.CylinderGeometry(vR, vR, vH, SEGS);
        applyTiledCylinderUVs(g, vR, vH, SEGS);
        pushT(waterBucket, g, new THREE.Matrix4().multiplyMatrices(
          trans(hx, runY, vz), rotX(Math.PI / 2),
        ));
      }
      {
        const sR = 0.018, sH = 0.11;
        const g = new THREE.CylinderGeometry(sR, sR, sH, 6);
        applyTiledCylinderUVs(g, sR, sH, 6);
        pushT(b.detail, g, trans(hx, 0.82, vz));
      }
      {
        const wR = 0.065, wH = 0.022;
        const g = new THREE.CylinderGeometry(wR, wR, wH, SEGS);
        applyTiledCylinderUVs(g, wR, wH, SEGS);
        pushT(b.detail, g, trans(hx, 0.886, vz));
      }
    }

    // Capped branch tees between the valves — spare taps, blanked off.
    for (const tz of [-0.31, 0.31]) {
      {
        const tR = 0.075, tH = 0.07;
        const g = new THREE.CylinderGeometry(tR, tR, tH, SEGS);
        applyTiledCylinderUVs(g, tR, tH, SEGS);
        pushT(waterBucket, g, new THREE.Matrix4().multiplyMatrices(
          trans(hx, runY, tz), rotX(Math.PI / 2),
        ));
      }
      {
        const sR = 0.035, sH = 0.14;
        const g = new THREE.CylinderGeometry(sR, sR, sH, 8);
        applyTiledCylinderUVs(g, sR, sH, 8);
        pushT(waterBucket, g, trans(hx, 0.79, tz));
      }
      {
        const cR = 0.05, cH = 0.03;
        const g = new THREE.CylinderGeometry(cR, cR, cH, SEGS);
        applyTiledCylinderUVs(g, cR, cH, SEGS);
        pushT(b.detail, g, trans(hx, 0.875, tz));
      }
    }

    // Drain valve pointing down at the -Z end of each run.
    {
      const dR = 0.03, dH = 0.09;
      const g = new THREE.CylinderGeometry(dR, dR, dH, 8);
      applyTiledCylinderUVs(g, dR, dH, 8);
      pushT(waterBucket, g, trans(hx, 0.58, -0.86));
    }
  }

  // Pressure gauge tapped off the supply run.
  {
    const sR = 0.018, sH = 0.09;
    const g = new THREE.CylinderGeometry(sR, sR, sH, 6);
    applyTiledCylinderUVs(g, sR, sH, 6);
    pushT(b.detail, g, trans(SUPPLY_X, 0.78, -0.86));
  }
  {
    const gR = 0.045, gH = 0.02;
    const g = new THREE.CylinderGeometry(gR, gR, gH, SEGS);
    applyTiledCylinderUVs(g, gR, gH, SEGS);
    pushT(b.detail, g, new THREE.Matrix4().multiplyMatrices(
      trans(SUPPLY_X, 0.845, -0.86), rotX(Math.PI / 2),
    ));
  }

  return b;
}
