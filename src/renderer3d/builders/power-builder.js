// src/renderer3d/builders/power-builder.js
//
// Role-bucket builders for Power / Electrical infrastructure.
// Floor-standing equipment — origin is footprint center at floor level (y = 0).
//
// Conventions match rf-builder.js:
//   - 1 sub-tile = 0.5 m.
//   - THREE is a CDN global — do NOT import it.

import { applyTiledBoxUVs, applyTiledCylinderUVs } from '../uv-utils.js';
import {
  DISTRIBUTION_FRONT_TERMINAL_LAYOUTS,
  DISTRIBUTION_OUTPUT_LAYOUTS,
  DISTRIBUTION_TOP_INPUT_LAYOUTS,
} from '../../data/distribution-output-layout.js';
import { POWER_HV_INPUT_MOUNTS } from '../../data/utility-port-anchors.js';

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
  return { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [], glow: [] };
}

function addBox(bucket, w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  applyTiledBoxUVs(g, w, h, d);
  pushT(bucket, g, trans(x, y, z));
}

function addCylinder(bucket, r, h, x, y, z, matrix = null, segs = 10) {
  const g = new THREE.CylinderGeometry(r, r, h, segs);
  applyTiledCylinderUVs(g, r, h, segs);
  pushT(bucket, g, matrix || trans(x, y, z));
}

// Transformer primary feeders terminate at the metal cap of a vertical roof
// bushing. The authored anchor table shares the same mount coordinate so the
// rendered cable lands on the hardware instead of on the enclosure shell.
function addVerticalHvInputBushing(b, mount, baseY) {
  const capH = 0.035;
  const ceramicTop = mount.y - capH;
  const stemH = Math.max(0.10, ceramicTop - baseY);
  const stemY = baseY + stemH / 2;
  addCylinder(b.accent, 0.030, stemH,
    mount.localX, stemY, mount.localZ, null, SEGS);
  for (const fraction of [0.24, 0.52, 0.80]) {
    addCylinder(b.accent, 0.065, 0.018,
      mount.localX, baseY + stemH * fraction, mount.localZ, null, SEGS);
  }
  addCylinder(b.copper, 0.045, capH,
    mount.localX, mount.y - capH / 2, mount.localZ, null, SEGS);
}

// Distribution gear keeps one insulated HV inlet on top. Branch circuits
// terminate in short horizontal glands on the front, sharing the exact layout
// used by the authored cable anchors.
function addDistributionTerminals(b, type) {
  const inputLayout = DISTRIBUTION_TOP_INPUT_LAYOUTS[type];
  const outputs = DISTRIBUTION_FRONT_TERMINAL_LAYOUTS[type];
  if (!inputLayout || !outputs) return;

  addVerticalHvInputBushing(b, POWER_HV_INPUT_MOUNTS[type], inputLayout.roofY);
  for (const { x, y, z } of outputs) {
    const collarLength = 0.025;
    const capLength = 0.04;
    addCylinder(b.accent, 0.041, collarLength, x, y, z, new THREE.Matrix4().multiplyMatrices(
      trans(x, y, z - capLength - collarLength / 2),
      rotX(Math.PI / 2),
    ), SEGS);
    addCylinder(b.copper, 0.030, capLength, x, y, z, new THREE.Matrix4().multiplyMatrices(
      trans(x, y, z - capLength / 2),
      rotX(Math.PI / 2),
    ), SEGS);
  }
}

// ── HV Transformer ────────────────────────────────────────────────
// Oil-filled power transformer: 2.0m L × 1.5m W × 2.0m H
export function _buildHVTransformerRoles(includeSecondaryRack = true) {
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

  // The 1.5 MW transformer's four front feeder cables terminate on a real
  // crossarm instead of floating beside the tank.  Keep the metal caps at the
  // authored cable anchors (x = ±0.75/±0.25, y = 1.45, z = 0.82); the renderer
  // can therefore retain the existing cable paths while the terminal row gains
  // a visible support and tower-style ceramic skirts.
  //
  // The facility and grid-intertie tiers currently share this tank builder but
  // have two- and six-outlet layouts, so their registry entries opt out below.
  if (includeSecondaryRack) {
    const rackZ = 0.78;
    const terminalZ = 0.82;

    addBox(b.iron, 1.68, 0.06, 0.08, 0, 1.33, rackZ);
    for (const x of [-0.55, 0.55]) {
      addBox(b.iron, 0.07, 0.14, 0.07, x, 1.26, rackZ - 0.015);
    }

    for (const x of [-0.75, -0.25, 0.25, 0.75]) {
      addCylinder(b.accent, 0.022, 0.07, x, 1.395, terminalZ, null, SEGS);
      for (const y of [1.375, 1.40, 1.425]) {
        addCylinder(b.accent, 0.055, 0.018, x, y, terminalZ, null, SEGS);
      }
      addCylinder(b.copper, 0.035, 0.02, x, 1.44, terminalZ, null, SEGS);
    }
  }

  // The rear-most roof bushing is the shared primary `hv_in` attachment for
  // the HV, facility, and grid-intertie transformer tiers.

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

// ── Compact HV Distributor ─────────────────────────────────────────
// A short 0.5 m-square 1-to-2 cabinet. Its roof carries the heavy inlet while
// its two outgoing feeders land beside the front breaker controls.
export function _buildCompactHvDistributorRoles() {
  const b = makeBuckets();

  const baseH = 0.06;
  const encW = 0.40, encH = 0.80, encD = 0.38;
  const frontZ = encD / 2;

  addBox(b.stand, 0.46, baseH, 0.46, 0, baseH / 2, 0);
  addBox(b.iron, encW, encH, encD, 0, baseH + encH / 2, 0);
  addBox(b.accent, 0.44, 0.035, 0.42, 0, baseH + encH + 0.0175, 0);
  addDistributionTerminals(b, 'compactHvDistributor');

  // Recessed front service door with hinges, gasket and operating handle.
  addBox(b.accent, 0.25, 0.66, 0.025, -0.055, 0.46, frontZ + 0.018);
  for (const sx of [-1, 1]) {
    addBox(b.detail, 0.012, 0.66, 0.012,
      -0.055 + sx * 0.119, 0.46, frontZ + 0.038);
  }
  for (const sy of [-1, 1]) {
    addBox(b.detail, 0.25, 0.012, 0.012,
      -0.055, 0.46 + sy * 0.324, frontZ + 0.038);
  }
  for (const y of [0.27, 0.64]) {
    addCylinder(b.iron, 0.009, 0.045, -0.17, y, frontZ + 0.046);
  }
  addBox(b.iron, 0.024, 0.12, 0.026, 0.045, 0.46, frontZ + 0.052);

  // Two independently wireable output breaker controls and cable glands share
  // the front face.
  for (const { x, y } of DISTRIBUTION_OUTPUT_LAYOUTS.compactHvDistributor) {
    const z = frontZ + 0.018;
    addBox(b.detail, 0.15, 0.15, 0.025, x, y, z);
    addBox(b.pipe, 0.08, 0.035, 0.018, x, y + 0.042, z + 0.023);
  }

  // Compact phase mimic, pilot lamp, side vents and a visible ground bond.
  addBox(b.pipe, 0.12, 0.075, 0.018, -0.065, 0.70, frontZ + 0.042);
  {
    const lamp = new THREE.SphereGeometry(0.014, 8, 6);
    lamp.translate(-0.065, 0.70, frontZ + 0.058);
    b.glow.push(lamp);
  }
  for (const x of [-0.2025, 0.2025]) {
    for (const y of [0.28, 0.43, 0.58]) {
      addBox(b.detail, 0.012, 0.055, 0.18, x, y, 0);
    }
  }
  addBox(b.copper, 0.22, 0.015, 0.022, -0.06, 0.13, -(frontZ + 0.014));

  return b;
}

// ── HV Distributor Box ────────────────────────────────────────────
// Outdoor metal-clad 1-to-4 cabinet: 1.5m L × 1.0m W × 2.0m H. The stable
// content id remains `switchgear`, but the visible hardware states its role.
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

  // Four breaker controls and independently claimable output glands occupy the
  // front. The common HV inlet remains insulated on the roof.
  for (const { x, y } of DISTRIBUTION_OUTPUT_LAYOUTS.switchgear) {
    const z = encD / 2 + 0.025;
    const plate = new THREE.BoxGeometry(0.17, 0.19, 0.035);
    applyTiledBoxUVs(plate, 0.17, 0.19, 0.035);
    pushT(b.detail, plate, trans(x, y, z));
  }

  // Folded roof, front service door and inspection hardware. Keep the right
  // strip clear for the four real output glands above; the left door is the
  // protected breaker compartment an electrician would actually open.
  const frontZ = encD / 2;
  addBox(b.accent, encW + 0.07, 0.045, encD + 0.07,
    0, baseH + encH + 0.022, 0);
  addDistributionTerminals(b, 'switchgear');
  addBox(b.accent, 0.47, 1.44, 0.030,
    -0.14, baseH + encH * 0.51, frontZ + 0.022);
  for (const sx of [-1, 1]) {
    addBox(b.detail, 0.016, 1.44, 0.016,
      -0.14 + sx * 0.227, baseH + encH * 0.51, frontZ + 0.044);
  }
  for (const sy of [-1, 1]) {
    addBox(b.detail, 0.47, 0.016, 0.016,
      -0.14, baseH + encH * 0.51 + sy * 0.712, frontZ + 0.044);
  }
  for (const y of [0.38, 0.92, 1.46]) {
    addCylinder(b.iron, 0.013, 0.07, -0.38, y, frontZ + 0.052);
  }
  // Breaker mimic panel, mimic-bus strip and quarter-turn operating handle.
  addBox(b.pipe, 0.26, 0.18, 0.022,
    -0.18, 1.38, frontZ + 0.054);
  addBox(b.copper, 0.22, 0.018, 0.020,
    -0.18, 1.23, frontZ + 0.056);
  addBox(b.iron, 0.035, 0.22, 0.035,
    0.02, 0.88, frontZ + 0.062);
  for (const x of [-0.25, -0.18, -0.11]) {
    const lamp = new THREE.SphereGeometry(0.018, 8, 6);
    lamp.translate(x, 1.52, frontZ + 0.072);
    b.glow.push(lamp);
  }
  // Bonding strap and lifting eyes make this read as serviceable outdoor
  // metal-clad gear rather than a generic building prop.
  addBox(b.copper, 0.44, 0.020, 0.028,
    -0.12, 0.18, -(frontZ + 0.018));
  for (const x of [-0.28, 0.28]) {
    const eye = new THREE.TorusGeometry(0.045, 0.010, 6, 10);
    eye.rotateX(Math.PI / 2);
    eye.translate(x, baseH + encH + 0.085, 0);
    b.pipe.push(eye);
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

  // Rear primary input gains a full ceramic bushing; the front secondary
  // retains its compact plain riser.
  addVerticalHvInputBushing(
    b,
    POWER_HV_INPUT_MOUNTS.padMountTransformer,
    0.1 + bodyH + 0.04,
  );
  {
    const riserR = 0.03, riserH = 0.2;
    const g = new THREE.CylinderGeometry(riserR, riserR, riserH, 8);
    applyTiledCylinderUVs(g, riserR, riserH, 8);
    pushT(b.copper, g, trans(0, 0.1 + bodyH + 0.04 + riserH / 2, 0.2));
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

  // Eight withdrawable starter/VFD buckets on the front, each with its own
  // handle, name strip, pilot lamp and ventilation slot. This is the visual
  // grammar of a real MCC lineup and mirrors its eight branch circuits.
  const frontZ = encD / 2;
  const bayW = 0.36;
  const bayH = 0.72;
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 4; col++) {
      const x = -0.63 + col * 0.42;
      const y = baseH + 0.48 + row * 0.82;
      addBox(b.accent, bayW, bayH, 0.028, x, y, frontZ + 0.022);
      // Door seam / gasket.
      addBox(b.detail, bayW, 0.014, 0.014,
        x, y + bayH / 2 - 0.007, frontZ + 0.044);
      addBox(b.detail, bayW, 0.014, 0.014,
        x, y - bayH / 2 + 0.007, frontZ + 0.044);
      addBox(b.detail, 0.014, bayH, 0.014,
        x - bayW / 2 + 0.007, y, frontZ + 0.044);
      addBox(b.iron, 0.022, 0.14, 0.026,
        x + bayW * 0.34, y, frontZ + 0.056);
      // Brushed nameplate and lower vent slot.
      addBox(b.pipe, bayW * 0.55, 0.055, 0.016,
        x - bayW * 0.10, y + bayH * 0.31, frontZ + 0.052);
      addBox(b.detail, bayW * 0.56, 0.035, 0.018,
        x - bayW * 0.08, y - bayH * 0.31, frontZ + 0.053);
      const lamp = new THREE.SphereGeometry(0.014, 8, 6);
      lamp.translate(x - bayW * 0.30, y + bayH * 0.18, frontZ + 0.060);
      b.glow.push(lamp);
    }
  }
  // Continuous horizontal bus compartment, roof lip and copper ground bar.
  addBox(b.iron, encW * 0.94, 0.16, 0.030,
    0, baseH + encH - 0.10, frontZ + 0.024);
  addBox(b.accent, encW + 0.05, 0.035, encD + 0.05,
    0, baseH + encH + 0.0175, 0);
  addDistributionTerminals(b, 'mcc');
  addBox(b.copper, encW * 0.78, 0.020, 0.025,
    0, baseH + 0.14, -(frontZ + 0.014));

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
  addDistributionTerminals(b, 'ups');

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

// ── Distribution panels ───────────────────────────────────────────
// Green NEMA-style panels: the player reads the capacity rung from their
// physical scale, rather than from three unrelated cabinet types.
function _buildDistributionPanelRoles({ type, width, height, depth, doorCount }) {
  const b = makeBuckets();
  const baseH = 0.08;

  // A shallow plinth keeps the cabinet off the floor and gives the cable
  // glands somewhere believable to land.
  {
    const g = new THREE.BoxGeometry(width, baseH, depth);
    applyTiledBoxUVs(g, width, baseH, depth);
    pushT(b.stand, g, trans(0, baseH / 2, 0));
  }
  {
    const g = new THREE.BoxGeometry(width, height, depth);
    applyTiledBoxUVs(g, width, height, depth);
    pushT(b.accent, g, trans(0, baseH + height / 2, 0));
  }

  // Folded rain cap and kick plate: the thin overhang and dark toe channel are
  // the silhouette cues of a real NEMA enclosure, rather than a painted box.
  addBox(b.accent, width + 0.055, 0.035, depth + 0.055,
    0, baseH + height + 0.0175, 0);
  addBox(b.iron, width * 0.94, 0.10, depth + 0.025,
    0, baseH + 0.05, 0);

  // Proud, hinged front doors with a gasket frame. Larger rungs have two bays;
  // the compact panel stays a single familiar breaker cabinet.
  const faceZ = depth / 2;
  const doorGap = 0.024;
  const doorSpan = width * 0.90;
  const doorW = (doorSpan - doorGap * (doorCount - 1)) / doorCount;
  const doorH = height * 0.84;
  const doorY = baseH + height * 0.53;
  const doorFaceZ = faceZ + 0.022;
  for (let col = 0; col < doorCount; col++) {
    const doorX = doorCount === 1
      ? 0
      : -doorSpan / 2 + doorW / 2 + col * (doorW + doorGap);
    addBox(b.accent, doorW, doorH, 0.028, doorX, doorY, doorFaceZ);

    // Gasket/frame rails around each door.
    for (const sx of [-1, 1]) {
      addBox(b.detail, 0.014, doorH, 0.014,
        doorX + sx * (doorW / 2 - 0.007), doorY, doorFaceZ + 0.020);
    }
    for (const sy of [-1, 1]) {
      addBox(b.detail, doorW, 0.014, 0.014,
        doorX, doorY + sy * (doorH / 2 - 0.007), doorFaceZ + 0.020);
    }

    // Three hinge barrels on the left and a black quarter-turn latch on the
    // right. These tiny shadows do more to sell a cabinet than extra texture.
    for (const sy of [-0.30, 0, 0.30]) {
      addCylinder(b.iron, 0.011, 0.055,
        doorX - doorW / 2 - 0.006, doorY + sy * doorH, doorFaceZ + 0.028);
    }
    addBox(b.iron, 0.020, 0.13, 0.026,
      doorX + doorW * 0.34, doorY, doorFaceZ + 0.038);
  }

  // Breaker handles and circuit labels follow readable horizontal rows on the
  // control face, with each cable attachment on the same front row.
  const bayW = Math.min(width * 0.18, 0.18);
  const bayH = Math.min(height * 0.09, 0.13);
  for (const { x, y } of DISTRIBUTION_OUTPUT_LAYOUTS[type]) {
    addBox(b.iron, bayW, bayH, 0.022, x, y, doorFaceZ + 0.041);
    addBox(b.pipe, bayW * 0.20, bayH * 0.58, 0.018,
      x - bayW * 0.20, y, doorFaceZ + 0.061);
    addBox(b.stand, bayW * 0.34, bayH * 0.36, 0.014,
      x + bayW * 0.17, y, doorFaceZ + 0.059);
  }

  // Main breaker / metering strip and three restrained pilot lamps. The lamps
  // share the normal night-aware glow role, so they read without becoming UI.
  const headerY = baseH + height * 0.88;
  addBox(b.pipe, width * 0.50, height * 0.075, 0.020,
    -width * 0.10, headerY, doorFaceZ + 0.052);
  addBox(b.iron, width * 0.10, height * 0.11, 0.028,
    width * 0.31, headerY, doorFaceZ + 0.058);
  for (const x of [-0.08, 0, 0.08]) {
    const lamp = new THREE.SphereGeometry(Math.min(0.015, width * 0.025), 8, 6);
    lamp.translate(x - width * 0.12, headerY, doorFaceZ + 0.070);
    b.glow.push(lamp);
  }

  // Side louvers and a visible copper bonding bar keep the box grounded and
  // ventilated. They remain subordinate to the breaker face at game zoom.
  for (const xSign of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      addBox(b.detail, 0.016, 0.020, depth * 0.48,
        xSign * (width / 2 + 0.009), baseH + height * (0.25 + i * 0.055), 0);
    }
  }
  addBox(b.copper, width * 0.58, 0.018, 0.025,
    0, baseH + 0.14, -(depth / 2 + 0.014));

  // A roof entry plate supports the heavier HV inlet insulator. Branch
  // terminals remain on the front beside their corresponding controls.
  {
    const g = new THREE.BoxGeometry(width * 0.72, 0.025, depth * 0.62);
    applyTiledBoxUVs(g, width * 0.72, 0.025, depth * 0.62);
    pushT(b.detail, g, trans(0, baseH + height + 0.013, 0));
  }
  addDistributionTerminals(b, type);
  return b;
}

export function _buildCompactDistributionPanelRoles() {
  return _buildDistributionPanelRoles({
    type: 'powerPanel', width: 0.46, height: 1.35, depth: 0.38, doorCount: 1,
  });
}

export function _buildSectionDistributionPanelRoles() {
  return _buildDistributionPanelRoles({
    type: 'sectionDistributionPanel', width: 1.0, height: 1.65, depth: 0.48, doorCount: 2,
  });
}

export function _buildMainDistributionPanelRoles() {
  return _buildDistributionPanelRoles({
    type: 'mainDistributionPanel', width: 1.45, height: 1.85, depth: 0.52, doorCount: 2,
  });
}

// ── Field distribution ────────────────────────────────────────────
// The busway is a slim overhead raceway rather than another floor cabinet.
export function _buildPowerBusRoles() {
  const b = makeBuckets();
  const railL = 1.42, railW = 0.20, railH = 0.14;
  {
    const g = new THREE.BoxGeometry(railW, railH, railL);
    applyTiledBoxUVs(g, railW, railH, railL);
    pushT(b.accent, g, trans(0, 0.92, 0));
  }
  // Eight real plug-in tap boxes: four along each side, matching the eight
  // individually claimable sockets in utility-ports-v2.
  for (const xSign of [-1, 1]) {
    for (const z of [-0.54, -0.18, 0.18, 0.54]) {
      const g = new THREE.BoxGeometry(0.15, 0.16, 0.18);
      applyTiledBoxUVs(g, 0.15, 0.16, 0.18);
      pushT(b.iron, g, trans(xSign * 0.11, 0.84, z));
      const gland = new THREE.CylinderGeometry(0.028, 0.028, 0.07, 8);
      applyTiledCylinderUVs(gland, 0.028, 0.07, 8);
      pushT(b.copper, gland, new THREE.Matrix4().multiplyMatrices(
        trans(xSign * 0.21, 0.84, z), rotZ(Math.PI / 2),
      ));
    }
  }
  // Hangers make clear that it rides above the beamline rather than blocks it.
  for (const z of [-0.55, 0.55]) {
    const g = new THREE.BoxGeometry(0.035, 0.45, 0.035);
    applyTiledBoxUVs(g, 0.035, 0.45, 0.035);
    pushT(b.stand, g, trans(0, 0.47, z));
  }
  return b;
}

// A spider box is a portable, one-subtile field junction: one squat case,
// four cable glands, and nothing that visually competes with a panel.
export function _buildSpiderBoxRoles() {
  const b = makeBuckets();
  {
    const g = new THREE.BoxGeometry(0.34, 0.16, 0.34);
    applyTiledBoxUVs(g, 0.34, 0.16, 0.34);
    pushT(b.accent, g, trans(0, 0.12, 0));
  }
  for (const [x, z] of [[0.205, 0], [-0.205, 0], [0, 0.205], [0, -0.205]]) {
    const g = new THREE.CylinderGeometry(0.035, 0.035, 0.09, 8);
    applyTiledCylinderUVs(g, 0.035, 0.09, 8);
    const matrix = new THREE.Matrix4().multiplyMatrices(
      trans(x, 0.12, z), x === 0 ? rotX(Math.PI / 2) : rotZ(Math.PI / 2),
    );
    pushT(b.copper, g, matrix);
  }
  // Hinged weatherproof lid, carry handle and rubber corner guards turn the
  // squat block into the portable field distro box it represents.
  addBox(b.accent, 0.38, 0.025, 0.38, 0, 0.2125, 0);
  addBox(b.detail, 0.30, 0.012, 0.30, 0, 0.228, 0);
  addCylinder(b.detail, 0.012, 0.18, 0, 0.225, -0.185,
    new THREE.Matrix4().multiplyMatrices(trans(0, 0.225, -0.185), rotZ(Math.PI / 2)), 8);
  addBox(b.iron, 0.055, 0.045, 0.025, 0, 0.205, 0.195);
  for (const x of [-0.12, 0.12]) {
    addBox(b.stand, 0.025, 0.11, 0.035, x, 0.285, -0.09);
  }
  addBox(b.stand, 0.265, 0.025, 0.035, 0, 0.34, -0.09);
  for (const x of [-0.17, 0.17]) {
    for (const z of [-0.17, 0.17]) {
      addBox(b.iron, 0.045, 0.08, 0.045, x, 0.10, z);
    }
  }
  addBox(b.pipe, 0.16, 0.012, 0.07, 0, 0.235, 0.06);
  return b;
}
