// src/renderer3d/builders/vacuum-builder.js
//
// Role-bucket builders for vacuum infrastructure components.
// Attachment builders (gauges, gate valve) mount on the beam pipe.
// Pump builders are floor-standing equipment.
//
// Conventions match component-builder.js / diagnostic-builder.js:
//   - Beam axis along local +Z at y = BEAM_HEIGHT.
//   - Origin is footprint center at floor level (y = 0).
//   - 1 sub-tile = 0.5 m.
//   - THREE is a CDN global — do NOT import it.

import { applyTiledBoxUVs, applyTiledCylinderUVs } from '../uv-utils.js';
import { buildBeamPipeSegment } from './diagnostic-builder.js';

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

function makeBuckets() {
  return { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [], glow: [] };
}

// ── Attachment builders (gauges + gate valve) ───────────────────────

/**
 * Pirani Gauge — 1×1 pipe attachment.
 * Small gauge tube rising from beam pipe with a readout head on top.
 */
export function _buildPiraniGaugeRoles() {
  const b = makeBuckets();
  buildBeamPipeSegment(b, 1);

  // Connection nipple at pipe surface
  const nipR = 0.05, nipH = 0.025;
  {
    const g = new THREE.CylinderGeometry(nipR, nipR, nipH, 8);
    applyTiledCylinderUVs(g, nipR, nipH, 8);
    pushT(b.detail, g, trans(0, BEAM_HEIGHT + PIPE_R + nipH / 2, 0));
  }

  // Thin gauge tube
  const tubeR = 0.025, tubeH = 0.14;
  {
    const g = new THREE.CylinderGeometry(tubeR, tubeR, tubeH, 8);
    applyTiledCylinderUVs(g, tubeR, tubeH, 8);
    pushT(b.pipe, g, trans(0, BEAM_HEIGHT + PIPE_R + nipH + tubeH / 2, 0));
  }

  // Readout head
  const headW = 0.06, headH = 0.045, headD = 0.06;
  {
    const g = new THREE.BoxGeometry(headW, headH, headD);
    applyTiledBoxUVs(g, headW, headH, headD);
    pushT(b.accent, g, trans(0, BEAM_HEIGHT + PIPE_R + nipH + tubeH + headH / 2, 0));
  }

  return b;
}

/**
 * Cold Cathode Gauge — 1×1 pipe attachment.
 * Wider cylindrical body with a permanent magnet ring and electronics head.
 */
export function _buildColdCathodeGaugeRoles() {
  const b = makeBuckets();
  buildBeamPipeSegment(b, 1);

  // Base flange
  const flangeR = 0.065, flangeH = 0.02;
  {
    const g = new THREE.CylinderGeometry(flangeR, flangeR, flangeH, SEGS);
    applyTiledCylinderUVs(g, flangeR, flangeH, SEGS);
    pushT(b.detail, g, trans(0, BEAM_HEIGHT + PIPE_R + flangeH / 2, 0));
  }

  // Gauge body cylinder
  const bodyR = 0.055, bodyH = 0.17;
  const bodyBase = BEAM_HEIGHT + PIPE_R + flangeH;
  {
    const g = new THREE.CylinderGeometry(bodyR, bodyR, bodyH, SEGS);
    applyTiledCylinderUVs(g, bodyR, bodyH, SEGS);
    pushT(b.pipe, g, trans(0, bodyBase + bodyH / 2, 0));
  }

  // Permanent magnet ring around the body
  const magR = bodyR + 0.025, magTube = 0.02;
  {
    const g = new THREE.TorusGeometry(magR, magTube, 8, SEGS);
    pushT(b.iron, g, trans(0, bodyBase + bodyH * 0.4, 0));
  }

  // Electronics connector head
  const headR = 0.04, headH = 0.04;
  {
    const g = new THREE.CylinderGeometry(headR, headR, headH, 8);
    applyTiledCylinderUVs(g, headR, headH, 8);
    pushT(b.accent, g, trans(0, bodyBase + bodyH + headH / 2, 0));
  }

  return b;
}

/**
 * Bayard-Alpert Gauge — 1×1 pipe attachment.
 * Thin tubular glass envelope with internal grid filament, topped by
 * an electronics connector.
 */
export function _buildBAGaugeRoles() {
  const b = makeBuckets();
  buildBeamPipeSegment(b, 1);

  // Base flange
  const flangeR = 0.05, flangeH = 0.02;
  {
    const g = new THREE.CylinderGeometry(flangeR, flangeR, flangeH, SEGS);
    applyTiledCylinderUVs(g, flangeR, flangeH, SEGS);
    pushT(b.detail, g, trans(0, BEAM_HEIGHT + PIPE_R + flangeH / 2, 0));
  }

  // Glass-like tubular envelope
  const envR = 0.032, envH = 0.20;
  const envBase = BEAM_HEIGHT + PIPE_R + flangeH;
  {
    const g = new THREE.CylinderGeometry(envR, envR, envH, SEGS);
    applyTiledCylinderUVs(g, envR, envH, SEGS);
    pushT(b.pipe, g, trans(0, envBase + envH / 2, 0));
  }

  // Internal grid/filament wire
  const gridR = 0.012, gridH = 0.11;
  {
    const g = new THREE.CylinderGeometry(gridR, gridR, gridH, 6);
    applyTiledCylinderUVs(g, gridR, gridH, 6);
    pushT(b.copper, g, trans(0, envBase + 0.04 + gridH / 2, 0));
  }

  // Connector head
  const headW = 0.045, headH = 0.03, headD = 0.045;
  {
    const g = new THREE.BoxGeometry(headW, headH, headD);
    applyTiledBoxUVs(g, headW, headH, headD);
    pushT(b.accent, g, trans(0, envBase + envH + headH / 2, 0));
  }

  return b;
}

/**
 * Gate Valve — 1×1 pipe attachment.
 * Flat rectangular valve body straddling the beam pipe with a tall
 * pneumatic actuator cylinder on top. CF flanges on both Z faces.
 */
export function _buildGateValveRoles() {
  const b = makeBuckets();
  buildBeamPipeSegment(b, 1);

  // Valve body — flat box centered on beam axis
  const bodyW = 0.28, bodyH = 0.26, bodyD = 0.07;
  {
    const g = new THREE.BoxGeometry(bodyW, bodyH, bodyD);
    applyTiledBoxUVs(g, bodyW, bodyH, bodyD);
    pushT(b.iron, g, trans(0, BEAM_HEIGHT, 0));
  }

  // CF flanges at ±Z faces of valve body
  for (const zSign of [-1, 1]) {
    const g = new THREE.CylinderGeometry(FLANGE_R, FLANGE_R, FLANGE_H, SEGS);
    applyTiledCylinderUVs(g, FLANGE_R, FLANGE_H, SEGS);
    const m = new THREE.Matrix4().multiplyMatrices(
      trans(0, BEAM_HEIGHT, zSign * (bodyD / 2 + FLANGE_H / 2)),
      rotX(Math.PI / 2),
    );
    pushT(b.detail, g, m);
  }

  // Pneumatic actuator cylinder rising from top of valve body
  const actR = 0.055, actH = 0.32;
  {
    const g = new THREE.CylinderGeometry(actR, actR, actH, SEGS);
    applyTiledCylinderUVs(g, actR, actH, SEGS);
    pushT(b.accent, g, trans(0, BEAM_HEIGHT + bodyH / 2 + actH / 2, 0));
  }

  // Air supply fitting on the side of actuator
  {
    const fitR = 0.012, fitL = 0.045;
    const g = new THREE.CylinderGeometry(fitR, fitR, fitL, 6);
    applyTiledCylinderUVs(g, fitR, fitL, 6);
    const m = new THREE.Matrix4().multiplyMatrices(
      trans(actR + fitL / 2, BEAM_HEIGHT + bodyH / 2 + actH * 0.7, 0),
      new THREE.Matrix4().makeRotationZ(-Math.PI / 2),
    );
    pushT(b.detail, g, m);
  }

  return b;
}

// ── Floor pump builders ─────────────────────────────────────────────

/**
 * Roughing Pump — 2×1 floor module.
 * Motor cylinder at one end, scroll/rotary-vane housing at the other,
 * with exhaust and inlet ports on top. Sits on a base plate.
 */
export function _buildRoughingPumpRoles() {
  const b = makeBuckets();

  // Base plate
  const baseW = 0.44, baseH = 0.04, baseD = 0.88;
  {
    const g = new THREE.BoxGeometry(baseW, baseH, baseD);
    applyTiledBoxUVs(g, baseW, baseH, baseD);
    pushT(b.stand, g, trans(0, baseH / 2, 0));
  }

  // Motor — cylinder at -Z end
  const motorR = 0.14, motorL = 0.28;
  {
    const g = new THREE.CylinderGeometry(motorR, motorR, motorL, SEGS);
    applyTiledCylinderUVs(g, motorR, motorL, SEGS);
    const m = new THREE.Matrix4().multiplyMatrices(
      trans(0, baseH + motorR, -0.24),
      rotX(Math.PI / 2),
    );
    pushT(b.iron, g, m);
  }

  // Pump housing — box at +Z end
  const pumpW = 0.34, pumpH = 0.32, pumpD = 0.42;
  {
    const g = new THREE.BoxGeometry(pumpW, pumpH, pumpD);
    applyTiledBoxUVs(g, pumpW, pumpH, pumpD);
    pushT(b.accent, g, trans(0, baseH + pumpH / 2, 0.16));
  }

  // Exhaust port on top of housing
  {
    const exR = 0.035, exH = 0.07;
    const g = new THREE.CylinderGeometry(exR, exR, exH, 8);
    applyTiledCylinderUVs(g, exR, exH, 8);
    pushT(b.detail, g, trans(0.08, baseH + pumpH + exH / 2, 0.16));
  }

  // Inlet flange on top
  {
    const inR = 0.055, inH = 0.025;
    const g = new THREE.CylinderGeometry(inR, inR, inH, SEGS);
    applyTiledCylinderUVs(g, inR, inH, SEGS);
    pushT(b.pipe, g, trans(-0.07, baseH + pumpH + inH / 2, 0.16));
  }

  return b;
}

/**
 * Shared 2×1-subtile cart frame. The outermost wheel and handle vertices stay
 * inside X ±0.25 m and Z ±0.5 m so the rendered shell matches placement.
 */
function buildCompactPumpCartFrame(b) {
  {
    const g = new THREE.BoxGeometry(0.46, 0.06, 0.92);
    applyTiledBoxUVs(g, 0.46, 0.06, 0.92);
    pushT(b.stand, g, trans(0, 0.17, 0));
  }
  for (const x of [-0.205, 0.205]) {
    for (const z of [-0.38, 0.38]) {
      const g = new THREE.CylinderGeometry(0.07, 0.07, 0.05, 10);
      applyTiledCylinderUVs(g, 0.07, 0.05, 10);
      pushT(b.detail, g, new THREE.Matrix4().multiplyMatrices(
        trans(x, 0.09, z), rotZ(Math.PI / 2),
      ));
    }
  }
  for (const x of [-0.19, 0.19]) {
    const g = new THREE.BoxGeometry(0.025, 1.0, 0.025);
    applyTiledBoxUVs(g, 0.025, 1.0, 0.025);
    pushT(b.stand, g, trans(x, 0.73, -0.43));
  }
  {
    const g = new THREE.CylinderGeometry(0.02, 0.02, 0.38, 8);
    applyTiledCylinderUVs(g, 0.02, 0.38, 8);
    pushT(b.stand, g, new THREE.Matrix4().multiplyMatrices(
      trans(0, 1.23, -0.43), rotZ(Math.PI / 2),
    ));
  }
}

/**
 * Four-Pump Roughing Cart — four miniature dry-pump cartridges in a compact
 * two-level rack. The stacked layout preserves all four visible stages while
 * fitting the cart into the same 2×1-subtile service slot as a single pump.
 */
export function _buildRoughingPumpCartRoles() {
  const b = makeBuckets();
  buildCompactPumpCartFrame(b);

  // Two rack shelves carry a front/rear pump pair on each level.
  for (const y of [0.29, 0.66]) {
    const g = new THREE.BoxGeometry(0.36, 0.035, 0.78);
    applyTiledBoxUVs(g, 0.36, 0.035, 0.78);
    pushT(b.stand, g, trans(0, y, 0));
  }

  // Four dry-pump modules: two along the cart on each of two levels.
  for (const y of [0.42, 0.79]) {
    for (const z of [-0.27, 0.27]) {
      const motor = new THREE.CylinderGeometry(0.075, 0.075, 0.16, 12);
      applyTiledCylinderUVs(motor, 0.075, 0.16, 12);
      pushT(b.iron, motor, new THREE.Matrix4().multiplyMatrices(
        trans(0, y, z - 0.07), rotX(Math.PI / 2),
      ));
      const housing = new THREE.BoxGeometry(0.28, 0.18, 0.18);
      applyTiledBoxUVs(housing, 0.28, 0.18, 0.18);
      pushT(b.accent, housing, trans(0, y, z + 0.08));
    }
  }

  // Common header and four risers converge on one right-side connection.
  {
    const g = new THREE.CylinderGeometry(0.035, 0.035, 0.72, 12);
    applyTiledCylinderUVs(g, 0.035, 0.72, 12);
    pushT(b.pipe, g, new THREE.Matrix4().multiplyMatrices(
      trans(0.18, 0.98, 0), rotX(Math.PI / 2),
    ));
  }
  for (const z of [-0.30, -0.10, 0.10, 0.30]) {
    const g = new THREE.CylinderGeometry(0.018, 0.018, 0.20, 8);
    applyTiledCylinderUVs(g, 0.018, 0.20, 8);
    pushT(b.pipe, g, trans(0.12, 0.88, z));
  }
  {
    const g = new THREE.CylinderGeometry(0.08, 0.08, 0.05, 12);
    applyTiledCylinderUVs(g, 0.08, 0.05, 12);
    pushT(b.detail, g, new THREE.Matrix4().multiplyMatrices(
      trans(0.225, 0.98, 0.24), rotZ(Math.PI / 2),
    ));
  }

  return b;
}

/**
 * Turbo Pump — 1×1 floor module.
 * Tall cylindrical body: motor section at bottom, turbo blades above,
 * intake flange on top, side exhaust for the backing pump line.
 */
export function _buildTurboPumpRoles() {
  const b = makeBuckets();

  // Base plate
  const baseW = 0.38, baseH = 0.04, baseD = 0.38;
  {
    const g = new THREE.BoxGeometry(baseW, baseH, baseD);
    applyTiledBoxUVs(g, baseW, baseH, baseD);
    pushT(b.stand, g, trans(0, baseH / 2, 0));
  }

  // Motor section — wider cylinder at bottom
  const motorR = 0.13, motorH = 0.30;
  {
    const g = new THREE.CylinderGeometry(motorR, motorR, motorH, SEGS);
    applyTiledCylinderUVs(g, motorR, motorH, SEGS);
    pushT(b.iron, g, trans(0, baseH + motorH / 2, 0));
  }

  // Turbo section — narrower, taller stainless body
  const turboR = 0.11, turboH = 0.55;
  {
    const g = new THREE.CylinderGeometry(turboR, turboR, turboH, SEGS);
    applyTiledCylinderUVs(g, turboR, turboH, SEGS);
    pushT(b.pipe, g, trans(0, baseH + motorH + turboH / 2, 0));
  }

  // Accent ring at motor-turbo junction
  {
    const ringR = motorR + 0.015, ringH = 0.025;
    const g = new THREE.CylinderGeometry(ringR, ringR, ringH, SEGS);
    applyTiledCylinderUVs(g, ringR, ringH, SEGS);
    pushT(b.accent, g, trans(0, baseH + motorH + ringH / 2, 0));
  }

  // Top intake flange
  {
    const g = new THREE.CylinderGeometry(FLANGE_R, FLANGE_R, FLANGE_H, SEGS);
    applyTiledCylinderUVs(g, FLANGE_R, FLANGE_H, SEGS);
    pushT(b.detail, g, trans(0, baseH + motorH + turboH + FLANGE_H / 2, 0));
  }

  // Side exhaust port (backing pump connection)
  {
    const exR = 0.035, exL = 0.07;
    const g = new THREE.CylinderGeometry(exR, exR, exL, 8);
    applyTiledCylinderUVs(g, exR, exL, 8);
    const m = new THREE.Matrix4().multiplyMatrices(
      trans(motorR + exL / 2, baseH + motorH * 0.5, 0),
      new THREE.Matrix4().makeRotationZ(-Math.PI / 2),
    );
    pushT(b.detail, g, m);
  }

  return b;
}

/**
 * Turbo Pump Cart — four compact vertical turbo stages sharing a mobile frame
 * and high-conductance header. It is a high-vacuum stage only: the separate
 * 60 L/s backing requirement remains visible in the simulation and catalogue.
 */
export function _buildTurboPumpCartRoles() {
  const b = makeBuckets();
  buildCompactPumpCartFrame(b);

  for (const x of [-0.10, 0.10]) {
    for (const z of [-0.22, 0.22]) {
      const motor = new THREE.CylinderGeometry(0.085, 0.085, 0.22, 12);
      applyTiledCylinderUVs(motor, 0.085, 0.22, 12);
      pushT(b.iron, motor, trans(x, 0.41, z));

      const turbo = new THREE.CylinderGeometry(0.068, 0.068, 0.45, 12);
      applyTiledCylinderUVs(turbo, 0.068, 0.45, 12);
      pushT(b.pipe, turbo, trans(x, 0.745, z));

      const ring = new THREE.CylinderGeometry(0.095, 0.095, 0.025, 12);
      applyTiledCylinderUVs(ring, 0.095, 0.025, 12);
      pushT(b.accent, ring, trans(x, 0.5325, z));

      const flange = new THREE.CylinderGeometry(0.105, 0.105, 0.035, 12);
      applyTiledCylinderUVs(flange, 0.105, 0.035, 12);
      pushT(b.detail, flange, trans(x, 0.9875, z));

      const branchL = 0.18 - x;
      const branch = new THREE.CylinderGeometry(0.018, 0.018, branchL, 8);
      applyTiledCylinderUVs(branch, 0.018, branchL, 8);
      pushT(b.pipe, branch, new THREE.Matrix4().multiplyMatrices(
        trans(x + branchL / 2, 0.88, z), rotZ(Math.PI / 2),
      ));
    }
  }

  {
    const g = new THREE.CylinderGeometry(0.035, 0.035, 0.72, 12);
    applyTiledCylinderUVs(g, 0.035, 0.72, 12);
    pushT(b.pipe, g, new THREE.Matrix4().multiplyMatrices(
      trans(0.18, 0.90, 0), rotX(Math.PI / 2),
    ));
  }
  {
    const g = new THREE.CylinderGeometry(0.08, 0.08, 0.05, 12);
    applyTiledCylinderUVs(g, 0.08, 0.05, 12);
    pushT(b.detail, g, new THREE.Matrix4().multiplyMatrices(
      trans(0.225, 0.90, 0.24), rotZ(Math.PI / 2),
    ));
  }

  return b;
}

/**
 * Mobile Vacuum Cart — two dry backing pumps and one turbo on a wheeled frame.
 * The silhouette intentionally exposes all three stages so the catalogue item
 * reads as an integrated pumping stack rather than a generic cabinet.
 */
export function _buildVacuumCartRoles() {
  const b = makeBuckets();

  // Low cart deck and raised push handle.
  {
    const g = new THREE.BoxGeometry(1.72, 0.10, 2.55);
    applyTiledBoxUVs(g, 1.72, 0.10, 2.55);
    pushT(b.stand, g, trans(0, 0.22, 0));
  }
  for (const x of [-0.72, 0.72]) {
    for (const z of [-1.05, 1.05]) {
      const g = new THREE.CylinderGeometry(0.14, 0.14, 0.09, 12);
      applyTiledCylinderUVs(g, 0.14, 0.09, 12);
      const m = new THREE.Matrix4().multiplyMatrices(trans(x, 0.14, z), rotZ(Math.PI / 2));
      pushT(b.detail, g, m);
    }
  }
  for (const x of [-0.72, 0.72]) {
    const g = new THREE.BoxGeometry(0.06, 1.05, 0.06);
    applyTiledBoxUVs(g, 0.06, 1.05, 0.06);
    pushT(b.stand, g, trans(x, 0.77, -1.22));
  }
  {
    const g = new THREE.CylinderGeometry(0.035, 0.035, 1.48, 8);
    applyTiledCylinderUVs(g, 0.035, 1.48, 8);
    const m = new THREE.Matrix4().multiplyMatrices(trans(0, 1.28, -1.22), rotZ(Math.PI / 2));
    pushT(b.stand, g, m);
  }

  // Two horizontally-mounted dry roughing stages.
  for (const x of [-0.48, 0.48]) {
    const motor = new THREE.CylinderGeometry(0.22, 0.22, 0.62, SEGS);
    applyTiledCylinderUVs(motor, 0.22, 0.62, SEGS);
    pushT(b.iron, motor, new THREE.Matrix4().multiplyMatrices(
      trans(x, 0.55, -0.48), rotX(Math.PI / 2),
    ));
    const housing = new THREE.BoxGeometry(0.54, 0.48, 0.60);
    applyTiledBoxUVs(housing, 0.54, 0.48, 0.60);
    pushT(b.accent, housing, trans(x, 0.55, 0.10));
  }

  // Central turbo stage above the common backing manifold.
  {
    const g = new THREE.CylinderGeometry(0.25, 0.25, 0.42, SEGS);
    applyTiledCylinderUVs(g, 0.25, 0.42, SEGS);
    pushT(b.iron, g, trans(0, 0.95, 0.65));
  }
  {
    const g = new THREE.CylinderGeometry(0.20, 0.20, 0.78, SEGS);
    applyTiledCylinderUVs(g, 0.20, 0.78, SEGS);
    pushT(b.pipe, g, trans(0, 1.55, 0.65));
  }
  {
    const g = new THREE.CylinderGeometry(0.32, 0.32, 0.06, SEGS);
    applyTiledCylinderUVs(g, 0.32, 0.06, SEGS);
    pushT(b.detail, g, trans(0, 1.97, 0.65));
  }

  // Common stainless backing manifold, branch legs, and control box.
  {
    const g = new THREE.CylinderGeometry(0.075, 0.075, 1.18, 12);
    applyTiledCylinderUVs(g, 0.075, 1.18, 12);
    pushT(b.pipe, g, new THREE.Matrix4().multiplyMatrices(
      trans(0, 0.92, 0.26), rotZ(Math.PI / 2),
    ));
  }
  for (const x of [-0.48, 0.48]) {
    const g = new THREE.CylinderGeometry(0.045, 0.045, 0.44, 10);
    applyTiledCylinderUVs(g, 0.045, 0.44, 10);
    pushT(b.pipe, g, trans(x, 0.74, 0.26));
  }
  {
    const g = new THREE.BoxGeometry(0.56, 0.66, 0.28);
    applyTiledBoxUVs(g, 0.56, 0.66, 0.28);
    pushT(b.accent, g, trans(0.55, 1.20, -0.82));
  }

  return b;
}

/**
 * High-Capacity Vacuum Station — twin large turbo stacks, roots blowers,
 * manifold, valves, and controls on one building-scale skid.
 */
export function _buildHighCapacityVacuumStationRoles() {
  const b = makeBuckets();
  {
    const g = new THREE.BoxGeometry(2.75, 0.16, 3.72);
    applyTiledBoxUVs(g, 2.75, 0.16, 3.72);
    pushT(b.stand, g, trans(0, 0.08, 0));
  }

  // Twin 1500 L/s turbo stacks.
  for (const x of [-0.78, 0.78]) {
    const motor = new THREE.CylinderGeometry(0.42, 0.42, 0.58, SEGS);
    applyTiledCylinderUVs(motor, 0.42, 0.58, SEGS);
    pushT(b.iron, motor, trans(x, 0.45, 0.72));
    const turbo = new THREE.CylinderGeometry(0.35, 0.35, 1.42, 20);
    applyTiledCylinderUVs(turbo, 0.35, 1.42, 20);
    pushT(b.pipe, turbo, trans(x, 1.45, 0.72));
    const flange = new THREE.CylinderGeometry(0.52, 0.52, 0.09, 20);
    applyTiledCylinderUVs(flange, 0.52, 0.09, 20);
    pushT(b.detail, flange, trans(x, 2.205, 0.72));
  }

  // Roots backing blowers along the rear of the skid.
  for (const x of [-0.72, 0.72]) {
    const housing = new THREE.BoxGeometry(1.02, 0.88, 0.92);
    applyTiledBoxUVs(housing, 1.02, 0.88, 0.92);
    pushT(b.accent, housing, trans(x, 0.64, -0.92));
    for (const dx of [-0.24, 0.24]) {
      const end = new THREE.CylinderGeometry(0.28, 0.28, 0.08, 14);
      applyTiledCylinderUVs(end, 0.28, 0.08, 14);
      pushT(b.iron, end, new THREE.Matrix4().multiplyMatrices(
        trans(x + dx, 0.64, -1.40), rotX(Math.PI / 2),
      ));
    }
  }

  // High-conductance common header and isolation valve wheels.
  {
    const g = new THREE.CylinderGeometry(0.16, 0.16, 2.24, 16);
    applyTiledCylinderUVs(g, 0.16, 2.24, 16);
    pushT(b.pipe, g, new THREE.Matrix4().multiplyMatrices(
      trans(0, 1.02, 1.38), rotZ(Math.PI / 2),
    ));
  }
  for (const x of [-0.78, 0.78]) {
    const g = new THREE.TorusGeometry(0.25, 0.035, 8, 16);
    pushT(b.accent, g, new THREE.Matrix4().multiplyMatrices(
      trans(x, 1.45, 1.38), rotX(Math.PI / 2),
    ));
  }

  // Full-height controls cabinet at one end.
  {
    const g = new THREE.BoxGeometry(0.58, 1.75, 0.72);
    applyTiledBoxUVs(g, 0.58, 1.75, 0.72);
    pushT(b.accent, g, trans(1.08, 1.035, -0.12));
  }
  for (let i = 0; i < 4; i++) {
    const g = new THREE.BoxGeometry(0.36, 0.055, 0.025);
    applyTiledBoxUVs(g, 0.36, 0.055, 0.025);
    pushT(b.glow, g, trans(1.08, 1.52 - i * 0.20, 0.252));
  }

  return b;
}

/**
 * Ion Pump — 2×1 floor module.
 * Flat rectangular body with magnet yokes on ±X sides, HV feedthrough
 * on top, and an intake flange.
 */
export function _buildIonPumpRoles() {
  const b = makeBuckets();

  // Base plate
  const baseW = 0.44, baseH = 0.04, baseD = 0.88;
  {
    const g = new THREE.BoxGeometry(baseW, baseH, baseD);
    applyTiledBoxUVs(g, baseW, baseH, baseD);
    pushT(b.stand, g, trans(0, baseH / 2, 0));
  }

  // Main pump body
  const bodyW = 0.32, bodyH = 0.46, bodyD = 0.68;
  {
    const g = new THREE.BoxGeometry(bodyW, bodyH, bodyD);
    applyTiledBoxUVs(g, bodyW, bodyH, bodyD);
    pushT(b.pipe, g, trans(0, baseH + bodyH / 2, 0));
  }

  // Magnet yokes on ±X sides
  for (const sign of [-1, 1]) {
    const yokeW = 0.05, yokeH = bodyH + 0.03, yokeD = bodyD * 0.75;
    const g = new THREE.BoxGeometry(yokeW, yokeH, yokeD);
    applyTiledBoxUVs(g, yokeW, yokeH, yokeD);
    pushT(b.iron, g, trans(sign * (bodyW / 2 + yokeW / 2), baseH + yokeH / 2, 0));
  }

  // HV feedthrough on top
  {
    const hvR = 0.025, hvH = 0.10;
    const g = new THREE.CylinderGeometry(hvR, hvR, hvH, 8);
    applyTiledCylinderUVs(g, hvR, hvH, 8);
    pushT(b.accent, g, trans(0, baseH + bodyH + hvH / 2, 0));
  }

  // Intake flange on top surface
  {
    const inR = 0.055, inH = 0.02;
    const g = new THREE.CylinderGeometry(inR, inR, inH, SEGS);
    applyTiledCylinderUVs(g, inR, inH, SEGS);
    pushT(b.detail, g, trans(0, baseH + bodyH + inH / 2, 0.18));
  }

  return b;
}

/**
 * NEG Pump (activation controller) — 1×1 floor module.
 * The actual getter is a coating inside the beam pipe; this is the
 * controller box that drives the activation current.
 */
export function _buildNEGPumpRoles() {
  const b = makeBuckets();

  // Base plate
  const baseW = 0.34, baseH = 0.03, baseD = 0.34;
  {
    const g = new THREE.BoxGeometry(baseW, baseH, baseD);
    applyTiledBoxUVs(g, baseW, baseH, baseD);
    pushT(b.stand, g, trans(0, baseH / 2, 0));
  }

  // Controller box body
  const boxW = 0.26, boxH = 0.50, boxD = 0.26;
  {
    const g = new THREE.BoxGeometry(boxW, boxH, boxD);
    applyTiledBoxUVs(g, boxW, boxH, boxD);
    pushT(b.accent, g, trans(0, baseH + boxH / 2, 0));
  }

  // Front panel indicator/display strip
  {
    const sW = boxW * 0.7, sH = 0.07, sD = 0.008;
    const g = new THREE.BoxGeometry(sW, sH, sD);
    applyTiledBoxUVs(g, sW, sH, sD);
    pushT(b.glow, g, trans(0, baseH + boxH * 0.72, boxD / 2 + sD / 2));
  }

  // Cable connector on top
  {
    const connR = 0.025, connH = 0.035;
    const g = new THREE.CylinderGeometry(connR, connR, connH, 8);
    applyTiledCylinderUVs(g, connR, connH, 8);
    pushT(b.iron, g, trans(0, baseH + boxH + connH / 2, 0));
  }

  return b;
}

/**
 * Ti Sublimation Pump — 1×1 floor module.
 * Cylindrical vacuum chamber with three Ti filament feedthroughs
 * projecting from the top flange and a power connector on the side.
 */
export function _buildTiSubPumpRoles() {
  const b = makeBuckets();

  // Base plate
  const baseW = 0.34, baseH = 0.03, baseD = 0.34;
  {
    const g = new THREE.BoxGeometry(baseW, baseH, baseD);
    applyTiledBoxUVs(g, baseW, baseH, baseD);
    pushT(b.stand, g, trans(0, baseH / 2, 0));
  }

  // Main cylindrical pump chamber
  const chamR = 0.13, chamH = 0.48;
  {
    const g = new THREE.CylinderGeometry(chamR, chamR, chamH, SEGS);
    applyTiledCylinderUVs(g, chamR, chamH, SEGS);
    pushT(b.pipe, g, trans(0, baseH + chamH / 2, 0));
  }

  // Top flange
  const fR = chamR + 0.025, fH = 0.025;
  {
    const g = new THREE.CylinderGeometry(fR, fR, fH, SEGS);
    applyTiledCylinderUVs(g, fR, fH, SEGS);
    pushT(b.detail, g, trans(0, baseH + chamH + fH / 2, 0));
  }

  // Three Ti filament feedthroughs through the top flange
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const feedR = 0.018, feedH = 0.09;
    const dx = Math.cos(angle) * chamR * 0.5;
    const dz = Math.sin(angle) * chamR * 0.5;
    const g = new THREE.CylinderGeometry(feedR, feedR, feedH, 6);
    applyTiledCylinderUVs(g, feedR, feedH, 6);
    pushT(b.copper, g, trans(dx, baseH + chamH + fH + feedH / 2, dz));
  }

  // Power connector on the side
  {
    const cW = 0.055, cH = 0.055, cD = 0.035;
    const g = new THREE.BoxGeometry(cW, cH, cD);
    applyTiledBoxUVs(g, cW, cH, cD);
    pushT(b.accent, g, trans(chamR + cD / 2, baseH + chamH * 0.6, 0));
  }

  return b;
}
