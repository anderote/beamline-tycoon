// src/renderer3d/builders/power-builder.js
//
// Role-bucket builders for Power / Electrical infrastructure.
// Floor-standing equipment — origin is footprint center at floor level (y = 0).
//
// Conventions match rf-builder.js:
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
function rotY(angle) {
  return new THREE.Matrix4().makeRotationY(angle);
}
function rotZ(angle) {
  return new THREE.Matrix4().makeRotationZ(angle);
}

function makeBuckets() {
  return { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };
}

// ── HV Transformer ────────────────────────────────────────────────
// Oil-filled power transformer: 2.0m L × 1.5m W × 2.0m H
export function _buildHVTransformerRoles() {
  const b = makeBuckets();

  // Base frame with rail channels
  const baseH = 0.12;
  {
    const g = new THREE.BoxGeometry(1.3, baseH, 1.8);
    applyTiledBoxUVs(g, 1.3, baseH, 1.8);
    pushT(b.stand, g, trans(0, baseH / 2, 0));
  }
  // Wheel trucks (4 wheels)
  const wheelR = 0.06, wheelH = 0.04;
  for (const xOff of [-0.5, 0.5]) {
    for (const zOff of [-0.7, 0.7]) {
      const g = new THREE.CylinderGeometry(wheelR, wheelR, wheelH, 8);
      applyTiledCylinderUVs(g, wheelR, wheelH, 8);
      pushT(b.stand, g, new THREE.Matrix4().multiplyMatrices(
        trans(xOff, wheelR, zOff),
        rotZ(Math.PI / 2),
      ));
    }
  }

  // Main oil tank
  const tankW = 1.1, tankH = 1.2, tankD = 1.5;
  const tankBase = baseH;
  {
    const g = new THREE.BoxGeometry(tankW, tankH, tankD);
    applyTiledBoxUVs(g, tankW, tankH, tankD);
    pushT(b.iron, g, trans(0, tankBase + tankH / 2, 0));
  }

  // Radiator fin banks on two sides (5 fins each)
  const finW = 0.03, finH = 0.9, finD = 0.6;
  for (const xSign of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const zOff = -0.3 + i * 0.15;
      const g = new THREE.BoxGeometry(finW, finH, finD);
      applyTiledBoxUVs(g, finW, finH, finD);
      pushT(b.detail, g, trans(xSign * (tankW / 2 + finW / 2 + 0.01), tankBase + tankH * 0.45, zOff));
    }
  }

  // 3 HV bushings on top
  const bushR = 0.06, bushH = 0.5;
  for (let i = 0; i < 3; i++) {
    const zOff = -0.35 + i * 0.35;
    // Ceramic insulator
    const g = new THREE.CylinderGeometry(bushR, bushR * 1.2, bushH, SEGS);
    applyTiledCylinderUVs(g, bushR, bushH, SEGS);
    pushT(b.accent, g, trans(0, tankBase + tankH + bushH / 2, zOff));
    // Steel cap on top
    const cg = new THREE.CylinderGeometry(bushR + 0.02, bushR + 0.02, 0.03, SEGS);
    applyTiledCylinderUVs(cg, bushR + 0.02, 0.03, SEGS);
    pushT(b.copper, cg, trans(0, tankBase + tankH + bushH + 0.015, zOff));
  }

  // Conservator tank on top (small horizontal cylinder)
  {
    const consR = 0.1, consH = 0.8;
    const g = new THREE.CylinderGeometry(consR, consR, consH, SEGS);
    applyTiledCylinderUVs(g, consR, consH, SEGS);
    pushT(b.pipe, g, new THREE.Matrix4().multiplyMatrices(
      trans(0.35, tankBase + tankH + consR + 0.02, 0),
      rotZ(Math.PI / 2),
    ));
  }

  // Pipe from conservator down to tank
  {
    const pR = 0.025, pH = 0.15;
    const g = new THREE.CylinderGeometry(pR, pR, pH, 8);
    applyTiledCylinderUVs(g, pR, pH, 8);
    pushT(b.pipe, g, trans(0.35, tankBase + tankH + pH / 2 - 0.02, -0.2));
  }

  return b;
}

// ── Disconnect Switch ─────────────────────────────────────────────
// Pole-mounted knife switch: 0.5m × 0.5m × 2.5m H
export function _buildDisconnectSwitchRoles() {
  const b = makeBuckets();

  // Concrete base pad
  {
    const g = new THREE.BoxGeometry(0.35, 0.1, 0.35);
    applyTiledBoxUVs(g, 0.35, 0.1, 0.35);
    pushT(b.stand, g, trans(0, 0.05, 0));
  }

  // Steel post
  const postR = 0.03, postH = 1.6;
  {
    const g = new THREE.CylinderGeometry(postR, postR, postH, 8);
    applyTiledCylinderUVs(g, postR, postH, 8);
    pushT(b.iron, g, trans(0, 0.1 + postH / 2, 0));
  }

  // 3 insulator discs along the post
  const insR = 0.07, insH = 0.04;
  for (let i = 0; i < 3; i++) {
    const y = 0.5 + i * 0.45;
    const g = new THREE.CylinderGeometry(insR, insR, insH, SEGS);
    applyTiledCylinderUVs(g, insR, insH, SEGS);
    pushT(b.accent, g, trans(0, y, 0));
  }

  // Knife blade at top (tilted open position)
  {
    const bladeW = 0.02, bladeH = 0.5, bladeD = 0.03;
    const g = new THREE.BoxGeometry(bladeW, bladeH, bladeD);
    applyTiledBoxUVs(g, bladeW, bladeH, bladeD);
    pushT(b.copper, g, new THREE.Matrix4().multiplyMatrices(
      trans(0, 0.1 + postH + 0.05, 0),
      rotZ(0.4),
    ));
  }

  // Pivot hardware at top of post
  {
    const g = new THREE.CylinderGeometry(0.025, 0.025, 0.05, 8);
    applyTiledCylinderUVs(g, 0.025, 0.05, 8);
    pushT(b.iron, g, trans(0, 0.1 + postH, 0));
  }

  // Ground bar at base
  {
    const g = new THREE.BoxGeometry(0.2, 0.02, 0.02);
    applyTiledBoxUVs(g, 0.2, 0.02, 0.02);
    pushT(b.copper, g, trans(0, 0.2, 0));
  }

  return b;
}

// ── Switchgear Cabinet ────────────────────────────────────────────
// Outdoor metal-clad cabinet: 1.5m L × 1.0m W × 2.0m H
export function _buildSwitchgearRoles() {
  const b = makeBuckets();

  // Base channel frame
  const baseH = 0.1;
  {
    const g = new THREE.BoxGeometry(0.9, baseH, 1.4);
    applyTiledBoxUVs(g, 0.9, baseH, 1.4);
    pushT(b.stand, g, trans(0, baseH / 2, 0));
  }

  // Main enclosure
  const encW = 0.85, encH = 1.7, encD = 1.3;
  {
    const g = new THREE.BoxGeometry(encW, encH, encD);
    applyTiledBoxUVs(g, encW, encH, encD);
    pushT(b.iron, g, trans(0, baseH + encH / 2, 0));
  }

  // Louver vents on both sides
  const ventW = 0.02, ventH = 0.4, ventD = 0.5;
  for (const xSign of [-1, 1]) {
    for (let i = 0; i < 2; i++) {
      const g = new THREE.BoxGeometry(ventW, ventH, ventD);
      applyTiledBoxUVs(g, ventW, ventH, ventD);
      pushT(b.detail, g, trans(
        xSign * (encW / 2 + ventW / 2),
        baseH + encH * 0.3 + i * 0.6,
        0,
      ));
    }
  }

  // 3 bus bar risers on top
  for (let i = 0; i < 3; i++) {
    const zOff = -0.3 + i * 0.3;
    const barR = 0.02, barH = 0.25;
    const g = new THREE.CylinderGeometry(barR, barR, barH, 8);
    applyTiledCylinderUVs(g, barR, barH, 8);
    pushT(b.copper, g, trans(0, baseH + encH + barH / 2, zOff));
    // Insulator at base of riser
    const ig = new THREE.CylinderGeometry(0.035, 0.035, 0.04, SEGS);
    applyTiledCylinderUVs(ig, 0.035, 0.04, SEGS);
    pushT(b.accent, ig, trans(0, baseH + encH + 0.02, zOff));
  }

  return b;
}

// ── Pad-Mount Transformer ─────────────────────────────────────────
// Compact green box on concrete pad: 1.0m × 1.0m × 1.5m H
export function _buildPadMountTransformerRoles() {
  const b = makeBuckets();

  // Concrete pad (slightly larger than body)
  {
    const g = new THREE.BoxGeometry(1.0, 0.1, 1.0);
    applyTiledBoxUVs(g, 1.0, 0.1, 1.0);
    pushT(b.stand, g, trans(0, 0.05, 0));
  }

  // Main body — slightly tapered (wider at base)
  const bodyW = 0.8, bodyH = 1.2, bodyD = 0.8;
  {
    const g = new THREE.BoxGeometry(bodyW, bodyH, bodyD);
    applyTiledBoxUVs(g, bodyW, bodyH, bodyD);
    pushT(b.iron, g, trans(0, 0.1 + bodyH / 2, 0));
  }

  // Lid overhang
  {
    const g = new THREE.BoxGeometry(bodyW + 0.06, 0.04, bodyD + 0.06);
    applyTiledBoxUVs(g, bodyW + 0.06, 0.04, bodyD + 0.06);
    pushT(b.iron, g, trans(0, 0.1 + bodyH + 0.02, 0));
  }

  // 2 cable risers on top
  for (const zOff of [-0.2, 0.2]) {
    const riserR = 0.03, riserH = 0.2;
    const g = new THREE.CylinderGeometry(riserR, riserR, riserH, 8);
    applyTiledCylinderUVs(g, riserR, riserH, 8);
    pushT(b.copper, g, trans(0, 0.1 + bodyH + 0.04 + riserH / 2, zOff));
  }

  // Padlock hasp on front (detail)
  {
    const g = new THREE.BoxGeometry(0.06, 0.06, 0.02);
    applyTiledBoxUVs(g, 0.06, 0.06, 0.02);
    pushT(b.detail, g, trans(0, 0.1 + bodyH * 0.6, bodyD / 2 + 0.01));
  }

  // Door seam line (thin detail strip)
  {
    const g = new THREE.BoxGeometry(0.01, bodyH * 0.8, 0.01);
    applyTiledBoxUVs(g, 0.01, bodyH * 0.8, 0.01);
    pushT(b.detail, g, trans(0, 0.1 + bodyH * 0.5, bodyD / 2 + 0.01));
  }

  return b;
}

// ── Motor Control Center ──────────────────────────────────────────
// Tall indoor cabinet: 1.0m L × 2.0m W × 2.0m H
export function _buildMCCRoles() {
  const b = makeBuckets();

  // Base channel
  const baseH = 0.08;
  {
    const g = new THREE.BoxGeometry(1.8, baseH, 0.85);
    applyTiledBoxUVs(g, 1.8, baseH, 0.85);
    pushT(b.stand, g, trans(0, baseH / 2, 0));
  }

  // Main cabinet enclosure
  const encW = 1.7, encH = 1.8, encD = 0.8;
  {
    const g = new THREE.BoxGeometry(encW, encH, encD);
    applyTiledBoxUVs(g, encW, encH, encD);
    pushT(b.iron, g, trans(0, baseH + encH / 2, 0));
  }

  // Cable entry gland plate on top
  {
    const g = new THREE.BoxGeometry(encW * 0.6, 0.03, encD * 0.5);
    applyTiledBoxUVs(g, encW * 0.6, 0.03, encD * 0.5);
    pushT(b.detail, g, trans(0, baseH + encH + 0.015, 0));
  }

  // Cable stub risers through gland plate
  for (let i = 0; i < 4; i++) {
    const xOff = -0.4 + i * 0.27;
    const g = new THREE.CylinderGeometry(0.02, 0.02, 0.1, 8);
    applyTiledCylinderUVs(g, 0.02, 0.1, 8);
    pushT(b.copper, g, trans(xOff, baseH + encH + 0.05, 0));
  }

  return b;
}

// ── UPS / Battery Bank ────────────────────────────────────────────
// Indoor cabinet: 1.5m L × 1.0m W × 2.0m H
export function _buildUPSRoles() {
  const b = makeBuckets();

  // Base channel
  const baseH = 0.08;
  {
    const g = new THREE.BoxGeometry(1.35, baseH, 0.85);
    applyTiledBoxUVs(g, 1.35, baseH, 0.85);
    pushT(b.stand, g, trans(0, baseH / 2, 0));
  }

  // Main cabinet
  const encW = 1.3, encH = 1.8, encD = 0.8;
  {
    const g = new THREE.BoxGeometry(encW, encH, encD);
    applyTiledBoxUVs(g, encW, encH, encD);
    pushT(b.iron, g, trans(0, baseH + encH / 2, 0));
  }

  // Top ventilation grille (raised)
  {
    const g = new THREE.BoxGeometry(encW * 0.8, 0.04, encD * 0.6);
    applyTiledBoxUVs(g, encW * 0.8, 0.04, encD * 0.6);
    pushT(b.detail, g, trans(0, baseH + encH + 0.02, 0));
  }

  // Side ventilation slots
  for (const zSign of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const g = new THREE.BoxGeometry(encW * 0.4, 0.08, 0.015);
      applyTiledBoxUVs(g, encW * 0.4, 0.08, 0.015);
      pushT(b.detail, g, trans(0, baseH + 0.4 + i * 0.5, zSign * (encD / 2 + 0.008)));
    }
  }

  // Battery compartment divider line (visible seam)
  {
    const g = new THREE.BoxGeometry(encW + 0.01, 0.02, encD + 0.01);
    applyTiledBoxUVs(g, encW + 0.01, 0.02, encD + 0.01);
    pushT(b.detail, g, trans(0, baseH + encH * 0.55, 0));
  }

  return b;
}
