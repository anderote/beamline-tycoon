// src/renderer3d/builders/optics-builder.js
//
// Role-bucket builders for beam-optics manipulation components:
// solenoid, collimator, aperture, velocity selector, pepper-pot emittance
// filter, and sextupole.
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

function buildTorus(bucket, majorRadius, tubeRadius, {
  x = 0, y = BEAM_HEIGHT, z = 0, rotateX = 0, rotateY = 0,
} = {}) {
  const g = new THREE.TorusGeometry(majorRadius, tubeRadius, 8, 20);
  const rotation = new THREE.Matrix4();
  if (rotateX) rotation.multiply(new THREE.Matrix4().makeRotationX(rotateX));
  if (rotateY) rotation.multiply(new THREE.Matrix4().makeRotationY(rotateY));
  pushT(bucket, g, mul(trans(x, y, z), rotation));
}

function buildPedestals(buckets, zPositions, topY, { width = 0.24, depth = 0.16 } = {}) {
  const baseH = 0.05;
  const colH = Math.max(0.04, topY - baseH);
  for (const z of zPositions) {
    const base = new THREE.BoxGeometry(width + 0.14, baseH, depth + 0.06);
    applyTiledBoxUVs(base, width + 0.14, baseH, depth + 0.06);
    pushT(buckets.stand, base, trans(0, baseH / 2, z));

    const col = new THREE.BoxGeometry(width, colH, depth);
    applyTiledBoxUVs(col, width, colH, depth);
    pushT(buckets.stand, col, trans(0, baseH + colH / 2, z));
  }
}

function buildBox(bucket, w, h, l, {
  x = 0, y = BEAM_HEIGHT, z = 0, rotateX = 0, rotateY = 0, rotateZ = 0,
} = {}) {
  const g = new THREE.BoxGeometry(w, h, l);
  applyTiledBoxUVs(g, w, h, l);
  const rotation = new THREE.Matrix4();
  if (rotateX) rotation.multiply(new THREE.Matrix4().makeRotationX(rotateX));
  if (rotateY) rotation.multiply(new THREE.Matrix4().makeRotationY(rotateY));
  if (rotateZ) rotation.multiply(new THREE.Matrix4().makeRotationZ(rotateZ));
  pushT(bucket, g, mul(trans(x, y, z), rotation));
}

function buildCylX(bucket, radius, length, {
  x = 0, y = BEAM_HEIGHT, z = 0, segs = SEGS,
} = {}) {
  const g = new THREE.CylinderGeometry(radius, radius, length, segs);
  applyTiledCylinderUVs(g, radius, length, segs);
  pushT(bucket, g, mul(trans(x, y, z), rotZ(Math.PI / 2)));
}

function buildCylZ(bucket, radius, length, {
  x = 0, y = BEAM_HEIGHT, z = 0, segs = SEGS,
} = {}) {
  const g = new THREE.CylinderGeometry(radius, radius, length, segs);
  applyTiledCylinderUVs(g, radius, length, segs);
  pushT(bucket, g, mul(trans(x, y, z), rotX(Math.PI / 2)));
}

function buildSegment(bucket, a, b, radius, segs = 10) {
  const from = new THREE.Vector3(...a);
  const to = new THREE.Vector3(...b);
  const delta = to.clone().sub(from);
  const length = delta.length();
  if (length < 1e-6) return;
  const g = new THREE.CylinderGeometry(radius, radius, length, segs);
  applyTiledCylinderUVs(g, radius, length, segs);
  const rotation = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    delta.normalize(),
  );
  pushT(bucket, g, new THREE.Matrix4().compose(
    from.add(to).multiplyScalar(0.5),
    rotation,
    new THREE.Vector3(1, 1, 1),
  ));
}

function buildSideFlange(bucket, x, z = 0) {
  buildCylX(bucket, FLANGE_R, FLANGE_H, { x, z });
}

// ── Injection Septum ────────────────────────────────────────────────
// Three real beam ports: the stored-beam channel crosses left-to-right while
// the injected line enters from -Z and merges across a thin copper septum.
export function _buildInjectionSeptumRoles() {
  const b = makeBuckets();
  const half = 0.5;

  buildCylX(b.pipe, PIPE_R, 1.0);
  buildCylZ(b.pipe, PIPE_R, 0.32, { x: -0.16, z: -0.34 });
  buildSegment(b.pipe,
    [-0.16, BEAM_HEIGHT, -0.18],
    [0.12, BEAM_HEIGHT, 0], PIPE_R);
  buildSideFlange(b.detail, -half);
  buildSideFlange(b.detail, half);
  buildCylZ(b.detail, FLANGE_R, FLANGE_H, { x: -0.16, z: -half });

  for (const sign of [-1, 1]) {
    buildBox(b.accent, 0.72, 0.10, 0.58, {
      y: BEAM_HEIGHT + sign * 0.30,
      z: -0.02,
    });
    buildBox(b.copper, 0.46, 0.055, 0.50, {
      y: BEAM_HEIGHT + sign * 0.21,
      z: -0.02,
    });
  }
  buildBox(b.iron, 0.10, 0.50, 0.58, { x: 0.31, z: -0.02 });
  buildBox(b.copper, 0.035, 0.40, 0.50, {
    x: -0.055,
    z: -0.055,
    rotateY: -0.48,
  });
  buildBox(b.detail, 0.15, 0.18, 0.22, {
    x: 0.35,
    y: BEAM_HEIGHT + 0.38,
    z: 0.10,
  });
  buildPedestals(b, [-0.20, 0.20], BEAM_HEIGHT - 0.35, { width: 0.18, depth: 0.12 });
  return b;
}

// ── Combined-function magnet ────────────────────────────────────────
// The asymmetric stepped pole faces expose its field gradient instead of
// borrowing the ordinary dipole silhouette.
export function _buildCombinedFunctionMagnetRoles() {
  const b = makeBuckets();
  const halfLength = 1.0;
  buildPipeSegment(b, 4);
  buildFlanges(b, halfLength);

  for (const sign of [-1, 1]) {
    buildBox(b.accent, 0.82, 0.11, 1.72, { y: BEAM_HEIGHT + sign * 0.35 });
    for (let i = 0; i < 4; i++) {
      const z = -0.63 + i * 0.42;
      const poleW = 0.28 + i * 0.055;
      buildBox(b.iron, poleW, 0.16, 0.34, {
        y: BEAM_HEIGHT + sign * 0.20,
        z,
      });
      buildBox(b.copper, poleW + 0.10, 0.045, 0.30, {
        y: BEAM_HEIGHT + sign * 0.285,
        z,
      });
    }
  }
  for (const x of [-0.36, 0.36]) buildBox(b.accent, 0.10, 0.60, 1.72, { x });
  buildBox(b.detail, 0.18, 0.20, 0.34, {
    x: 0.39,
    y: BEAM_HEIGHT + 0.44,
    z: -0.52,
  });
  buildPedestals(b, [-0.65, 0.65], BEAM_HEIGHT - 0.405, { width: 0.22, depth: 0.18 });
  return b;
}

// ── Four-dipole bunch compressor ────────────────────────────────────
export function _buildChicaneRoles() {
  const b = makeBuckets();
  const halfLength = 2.0;
  const points = [
    [0, BEAM_HEIGHT, -halfLength],
    [0, BEAM_HEIGHT, -1.45],
    [-0.50, BEAM_HEIGHT, -0.78],
    [-0.50, BEAM_HEIGHT, 0.78],
    [0, BEAM_HEIGHT, 1.45],
    [0, BEAM_HEIGHT, halfLength],
  ];
  for (let i = 0; i < points.length - 1; i++) {
    buildSegment(b.pipe, points[i], points[i + 1], PIPE_R);
  }
  buildFlanges(b, halfLength);

  const magnets = [
    { x: -0.12, z: -1.27, yaw: -0.46 },
    { x: -0.43, z: -0.73, yaw: -0.46 },
    { x: -0.43, z: 0.73, yaw: 0.46 },
    { x: -0.12, z: 1.27, yaw: 0.46 },
  ];
  for (const m of magnets) {
    for (const sign of [-1, 1]) {
      buildBox(b.accent, 0.66, 0.11, 0.46, {
        x: m.x,
        y: BEAM_HEIGHT + sign * 0.27,
        z: m.z,
        rotateY: m.yaw,
      });
      buildBox(b.copper, 0.42, 0.05, 0.48, {
        x: m.x,
        y: BEAM_HEIGHT + sign * 0.19,
        z: m.z,
        rotateY: m.yaw,
      });
    }
    buildBox(b.iron, 0.10, 0.44, 0.44, {
      x: m.x + 0.28,
      z: m.z,
      rotateY: m.yaw,
    });
    buildPedestals(b, [m.z], BEAM_HEIGHT - 0.33, { width: 0.18, depth: 0.16 });
  }
  buildBox(b.detail, 0.24, 0.18, 0.36, {
    x: 0.69,
    y: BEAM_HEIGHT + 0.20,
    z: 0,
  });
  return b;
}

// ── Undulator ────────────────────────────────────────────────────────
export function _buildUndulatorRoles() {
  const b = makeBuckets();
  const halfLength = 2.5;
  buildPipeSegment(b, 10);
  buildFlanges(b, halfLength);

  const periods = 18;
  for (let i = 0; i < periods; i++) {
    const z = -2.18 + i * (4.36 / (periods - 1));
    const role = i % 2 ? b.accent : b.iron;
    for (const sign of [-1, 1]) {
      buildBox(role, 0.46, 0.12, 0.17, {
        y: BEAM_HEIGHT + sign * 0.18,
        z,
      });
    }
  }
  buildBox(b.iron, 0.66, 0.10, 4.55, { y: BEAM_HEIGHT + 0.38 });
  buildBox(b.iron, 0.66, 0.10, 4.55, { y: BEAM_HEIGHT - 0.38 });
  for (const z of [-2.20, 2.20]) {
    buildBox(b.copper, 0.72, 0.08, 0.16, { y: BEAM_HEIGHT + 0.29, z });
    buildBox(b.copper, 0.72, 0.08, 0.16, { y: BEAM_HEIGHT - 0.29, z });
    buildBox(b.detail, 0.08, 0.78, 0.15, { x: 0.37, z });
  }
  buildPedestals(b, [-1.65, 0, 1.65], BEAM_HEIGHT - 0.43, { width: 0.24, depth: 0.18 });
  return b;
}

// ── Energy degrader and selection line ──────────────────────────────
export function _buildEnergyDegraderRoles() {
  const b = makeBuckets();
  const halfLength = 3.0;
  buildPipeSegment(b, 12);
  buildFlanges(b, halfLength);

  for (const sign of [-1, 1]) {
    buildBox(b.copper, 0.34, 0.28, 0.36, {
      x: sign * 0.21,
      y: BEAM_HEIGHT + sign * 0.15,
      z: -2.20,
      rotateZ: sign * 0.25,
    });
  }
  buildCylX(b.detail, 0.035, 1.25, {
    x: 0,
    y: BEAM_HEIGHT + 0.45,
    z: -2.20,
    segs: 8,
  });
  buildBox(b.accent, 0.32, 0.22, 0.42, {
    x: 0.72,
    y: BEAM_HEIGHT + 0.45,
    z: -2.20,
  });

  for (const [i, z] of [-1.35, -0.48, 0.48, 1.35].entries()) {
    const x = (i < 2 ? -1 : 1) * 0.34;
    for (const sign of [-1, 1]) {
      buildBox(b.accent, 0.70, 0.10, 0.44, {
        x,
        y: BEAM_HEIGHT + sign * 0.26,
        z,
      });
      buildBox(b.copper, 0.44, 0.045, 0.40, {
        x,
        y: BEAM_HEIGHT + sign * 0.18,
        z,
      });
    }
    buildBox(b.iron, 0.10, 0.42, 0.42, {
      x: x + (x < 0 ? -0.30 : 0.30),
      z,
    });
    buildPedestals(b, [z], BEAM_HEIGHT - 0.32, { width: 0.20, depth: 0.16 });
  }

  for (const z of [2.08, 2.52]) {
    for (const sign of [-1, 1]) {
      buildBox(b.iron, 0.16, 0.34, 0.16, { x: sign * 0.20, z });
      buildCylX(b.detail, 0.022, 0.28, { x: sign * 0.38, z, segs: 8 });
    }
    buildBox(b.accent, 0.62, 0.07, 0.20, { y: BEAM_HEIGHT + 0.28, z });
    buildBox(b.accent, 0.62, 0.07, 0.20, { y: BEAM_HEIGHT - 0.28, z });
  }
  return b;
}

// ── Orthogonal scanning-magnet pair ─────────────────────────────────
export function _buildScanningMagnetRoles() {
  const b = makeBuckets();
  const halfLength = 1.0;
  buildPipeSegment(b, 4);
  buildFlanges(b, halfLength);

  for (const sign of [-1, 1]) {
    buildBox(b.accent, 0.78, 0.12, 0.58, {
      y: BEAM_HEIGHT + sign * 0.25,
      z: -0.43,
    });
    buildBox(b.copper, 0.54, 0.055, 0.54, {
      y: BEAM_HEIGHT + sign * 0.17,
      z: -0.43,
    });
    buildBox(b.accent, 0.12, 0.78, 0.58, {
      x: sign * 0.25,
      z: 0.43,
    });
    buildBox(b.copper, 0.055, 0.54, 0.54, {
      x: sign * 0.17,
      z: 0.43,
    });
  }
  buildBox(b.iron, 0.11, 0.52, 0.56, { x: 0.34, z: -0.43 });
  buildBox(b.iron, 0.52, 0.11, 0.56, { y: BEAM_HEIGHT + 0.34, z: 0.43 });
  buildBox(b.detail, 0.42, 0.52, 0.54, { x: 0.68, y: 0.92, z: 0 });
  for (const z of [-0.18, 0.18]) {
    buildCylZ(b.copper, 0.032, 0.95, { x: 0.48, y: 1.26, z });
  }
  buildPedestals(b, [-0.43, 0.43], BEAM_HEIGHT - 0.34, { width: 0.22, depth: 0.18 });
  return b;
}

// ── Solenoid ──────────────────────────────────────────────────────────
// subL=2 subW=2 subH=2 → 1m long, 1m wide, 1m click volume
// Exposed copper windings around a straight beam tube, retained between
// painted end rings and longitudinal tie rods. The beam axis is baked at 1m,
// so both committed hardware and its placement ghost straddle the pipe.
export function _buildSolenoidRoles() {
  const buckets = makeBuckets();
  const magL = 1.0;
  const halfLen = magL / 2;
  const coilSpan = 0.62;
  const coilMajorR = 0.25;
  const coilTubeR = 0.038;

  buildPipeSegment(buckets, 2);
  buildFlanges(buckets, halfLen);

  // Copper turns are the visual signature: individual toruses leave the bore
  // and beam tube visible instead of presenting another opaque cylinder.
  const turnCount = 8;
  for (let i = 0; i < turnCount; i++) {
    const z = -coilSpan / 2 + (i / (turnCount - 1)) * coilSpan;
    buildTorus(buckets.copper, coilMajorR, coilTubeR, { z });
  }

  // Painted retaining rings and four dark tie rods clamp the winding pack.
  const endZ = coilSpan / 2 + 0.055;
  for (const sign of [-1, 1]) {
    buildTorus(buckets.accent, coilMajorR + 0.015, 0.052, { z: sign * endZ });
  }
  const tieRadius = coilMajorR + coilTubeR + 0.025;
  for (const angle of [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4]) {
    const x = Math.cos(angle) * tieRadius;
    const y = BEAM_HEIGHT + Math.sin(angle) * tieRadius;
    const g = new THREE.CylinderGeometry(0.018, 0.018, 2 * endZ, 8);
    applyTiledCylinderUVs(g, 0.018, 2 * endZ, 8);
    pushT(buckets.iron, g, mul(trans(x, y, 0), rotX(Math.PI / 2)));
  }

  // Side terminal box and copper feedthroughs make this read as a powered
  // focusing magnet rather than a passive spool or vacuum chamber.
  {
    const boxW = 0.16;
    const boxH = 0.18;
    const boxD = 0.24;
    const boxX = 0.37;
    const boxY = BEAM_HEIGHT + 0.18;
    const box = new THREE.BoxGeometry(boxW, boxH, boxD);
    applyTiledBoxUVs(box, boxW, boxH, boxD);
    pushT(buckets.accent, box, trans(boxX, boxY, 0));
    for (const z of [-0.065, 0.065]) {
      const stud = new THREE.CylinderGeometry(0.026, 0.026, 0.12, 8);
      applyTiledCylinderUVs(stud, 0.026, 0.12, 8);
      pushT(buckets.copper, stud, mul(
        trans(boxX - boxW / 2 - 0.055, boxY, z),
        rotZ(Math.PI / 2),
      ));
    }
  }

  // Small stainless cooling header along the opposite side of the coil pack.
  {
    const headerR = 0.026;
    const headerL = coilSpan;
    const g = new THREE.CylinderGeometry(headerR, headerR, headerL, 8);
    applyTiledCylinderUVs(g, headerR, headerL, 8);
    pushT(buckets.detail, g, mul(
      trans(-0.32, BEAM_HEIGHT - 0.14, 0),
      rotX(Math.PI / 2),
    ));
  }

  buildPedestals(buckets, [-0.25, 0.25], BEAM_HEIGHT - (coilMajorR + coilTubeR), {
    width: 0.22,
    depth: 0.14,
  });

  return buckets;
}

// ── Collimator ───────────────────────────────────────────────────────
// subL=2 subW=2 subH=2 → 1m long, 1m wide, 1m click volume
// Four dense jaws close around a square aperture inside a shield frame. Four
// actuator barrels and handwheels make it visibly adjustable and keep it
// distinct from the thinner two-jaw aperture component.
export function _buildCollimatorRoles() {
  const buckets = makeBuckets();
  const magL = 1.0;
  const halfLen = magL / 2;
  const frameOuter = 0.74;
  const frameWall = 0.13;
  const frameDepth = 0.56;

  buildPipeSegment(buckets, 2);
  buildFlanges(buckets, halfLen);

  // Heavy square shielding frame around the beam axis.
  for (const sign of [-1, 1]) {
    const horizontal = new THREE.BoxGeometry(frameOuter, frameWall, frameDepth);
    applyTiledBoxUVs(horizontal, frameOuter, frameWall, frameDepth);
    pushT(buckets.accent, horizontal, trans(
      0,
      BEAM_HEIGHT + sign * (frameOuter / 2 - frameWall / 2),
      0,
    ));

    const vertical = new THREE.BoxGeometry(
      frameWall,
      frameOuter - 2 * frameWall,
      frameDepth,
    );
    applyTiledBoxUVs(vertical, frameWall, frameOuter - 2 * frameWall, frameDepth);
    pushT(buckets.accent, vertical, trans(
      sign * (frameOuter / 2 - frameWall / 2),
      BEAM_HEIGHT,
      0,
    ));
  }

  // Dark face collars keep the shield block legible from the beam direction.
  for (const zSign of [-1, 1]) {
    const z = zSign * (frameDepth / 2 + 0.018);
    for (const ySign of [-1, 1]) {
      const g = new THREE.BoxGeometry(frameOuter + 0.04, 0.035, 0.035);
      applyTiledBoxUVs(g, frameOuter + 0.04, 0.035, 0.035);
      pushT(buckets.iron, g, trans(0, BEAM_HEIGHT + ySign * frameOuter / 2, z));
    }
    for (const xSign of [-1, 1]) {
      const g = new THREE.BoxGeometry(0.035, frameOuter, 0.035);
      applyTiledBoxUVs(g, 0.035, frameOuter, 0.035);
      pushT(buckets.iron, g, trans(xSign * frameOuter / 2, BEAM_HEIGHT, z));
    }
  }

  // Four copper/tungsten-colored jaw blocks stop just outside the vacuum tube.
  const halfGap = PIPE_R + 0.025;
  const jawReach = 0.18;
  const jawFace = 0.28;
  const jawDepth = 0.42;
  for (const sign of [-1, 1]) {
    const sideJaw = new THREE.BoxGeometry(jawReach, jawFace, jawDepth);
    applyTiledBoxUVs(sideJaw, jawReach, jawFace, jawDepth);
    pushT(buckets.copper, sideJaw, trans(
      sign * (halfGap + jawReach / 2),
      BEAM_HEIGHT,
      0,
    ));

    const verticalJaw = new THREE.BoxGeometry(jawFace, jawReach, jawDepth);
    applyTiledBoxUVs(verticalJaw, jawFace, jawReach, jawDepth);
    pushT(buckets.copper, verticalJaw, trans(
      0,
      BEAM_HEIGHT + sign * (halfGap + jawReach / 2),
      0,
    ));
  }

  // Screw actuators and handwheels on all four sides. The side pair rotate
  // around X; the vertical pair rotate around Y.
  const rodLen = 0.20;
  const rodCentre = halfGap + jawReach + rodLen / 2;
  const barrelCentre = frameOuter / 2 + 0.045;
  for (const sign of [-1, 1]) {
    {
      const rod = new THREE.CylinderGeometry(0.022, 0.022, rodLen, 8);
      applyTiledCylinderUVs(rod, 0.022, rodLen, 8);
      pushT(buckets.detail, rod, mul(
        trans(sign * rodCentre, BEAM_HEIGHT, 0),
        rotZ(Math.PI / 2),
      ));
      const barrel = new THREE.CylinderGeometry(0.052, 0.052, 0.11, 12);
      applyTiledCylinderUVs(barrel, 0.052, 0.11, 12);
      pushT(buckets.iron, barrel, mul(
        trans(sign * barrelCentre, BEAM_HEIGHT, 0),
        rotZ(Math.PI / 2),
      ));
      buildTorus(buckets.detail, 0.075, 0.014, {
        x: sign * 0.47,
        rotateY: Math.PI / 2,
      });
    }
    {
      const rod = new THREE.CylinderGeometry(0.022, 0.022, rodLen, 8);
      applyTiledCylinderUVs(rod, 0.022, rodLen, 8);
      pushT(buckets.detail, rod, trans(
        0,
        BEAM_HEIGHT + sign * rodCentre,
        0,
      ));
      const barrel = new THREE.CylinderGeometry(0.052, 0.052, 0.11, 12);
      applyTiledCylinderUVs(barrel, 0.052, 0.11, 12);
      pushT(buckets.iron, barrel, trans(
        0,
        BEAM_HEIGHT + sign * barrelCentre,
        0,
      ));
      buildTorus(buckets.detail, 0.075, 0.014, {
        y: BEAM_HEIGHT + sign * 0.47,
        rotateX: Math.PI / 2,
      });
    }
  }

  buildPedestals(buckets, [-0.19, 0.19], BEAM_HEIGHT - frameOuter / 2, {
    width: 0.24,
    depth: 0.14,
  });

  return buckets;
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
