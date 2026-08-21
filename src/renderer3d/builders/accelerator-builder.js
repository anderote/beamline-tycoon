// src/renderer3d/builders/accelerator-builder.js
// Dedicated role geometry for catalogue accelerating structures that predate
// the parametric RF ladder. Beam runs along local +Z at y = 1 m.
// THREE is a CDN global — do NOT import it.

import { applyTiledBoxUVs, applyTiledCylinderUVs } from '../uv-utils.js';

const BEAM_HEIGHT = 1.0;
const PIPE_R = 0.08;
const FLANGE_R = 0.16;
const FLANGE_H = 0.045;
const SEGS = 16;

function buckets() {
  return { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };
}

function push(bucket, geometry, matrix) {
  geometry.applyMatrix4(matrix);
  bucket.push(geometry);
}

function trans(x = 0, y = 0, z = 0) {
  return new THREE.Matrix4().makeTranslation(x, y, z);
}

function box(bucket, w, h, l, { x = 0, y = BEAM_HEIGHT, z = 0 } = {}) {
  const g = new THREE.BoxGeometry(w, h, l);
  applyTiledBoxUVs(g, w, h, l);
  push(bucket, g, trans(x, y, z));
}

function cylY(bucket, r, h, { x = 0, y = BEAM_HEIGHT, z = 0, segs = SEGS } = {}) {
  const g = new THREE.CylinderGeometry(r, r, h, segs);
  applyTiledCylinderUVs(g, r, h, segs);
  push(bucket, g, trans(x, y, z));
}

function cylZ(bucket, r, l, {
  x = 0, y = BEAM_HEIGHT, z = 0, segs = SEGS, rTop = r,
} = {}) {
  const g = new THREE.CylinderGeometry(rTop, r, l, segs);
  applyTiledCylinderUVs(g, (r + rTop) / 2, l, segs);
  const rotation = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  push(bucket, g, new THREE.Matrix4().multiplyMatrices(trans(x, y, z), rotation));
}

function cylX(bucket, r, l, { x = 0, y = BEAM_HEIGHT, z = 0, segs = SEGS } = {}) {
  const g = new THREE.CylinderGeometry(r, r, l, segs);
  applyTiledCylinderUVs(g, r, l, segs);
  const rotation = new THREE.Matrix4().makeRotationZ(Math.PI / 2);
  push(bucket, g, new THREE.Matrix4().multiplyMatrices(trans(x, y, z), rotation));
}

function torus(bucket, major, tube, { x = 0, y = BEAM_HEIGHT, z = 0 } = {}) {
  const g = new THREE.TorusGeometry(major, tube, 8, 20);
  push(bucket, g, trans(x, y, z));
}

function sphere(bucket, radius, {
  x = 0, y = BEAM_HEIGHT, z = 0, sx = 1, sy = 1, sz = 1,
} = {}) {
  const g = new THREE.SphereGeometry(radius, SEGS, 10);
  g.scale(sx, sy, sz);
  push(bucket, g, trans(x, y, z));
}

function beamPipe(b, length) {
  cylZ(b.pipe, PIPE_R, length);
  for (const sign of [-1, 1]) cylZ(b.detail, FLANGE_R, FLANGE_H, { z: sign * length / 2 });
}

function pedestal(b, z, topY, width = 0.25, depth = 0.18) {
  const baseH = 0.06;
  const colH = Math.max(0.05, topY - baseH);
  box(b.stand, width + 0.18, baseH, depth + 0.08, { y: baseH / 2, z });
  box(b.stand, width, colH, depth, { y: baseH + colH / 2, z });
}

function spread(count, span, centre = 0) {
  return Array.from({ length: count }, (_, i) =>
    centre - span / 2 + ((i + 0.5) / count) * span);
}

// One-metre industrial S-band skid: compact copper cells, a side magnetron
// coupler, cooling rails, and a stout support base.
export function _buildIndustrialLinacRoles() {
  const b = buckets();
  const length = 1.0;
  beamPipe(b, length);

  const cellCentres = spread(5, 0.62);
  for (const z of cellCentres) {
    sphere(b.copper, 0.23, { z, sz: 0.62 });
    cylZ(b.detail, 0.255, 0.025, { z });
  }
  for (const sign of [-1, 1]) {
    cylZ(b.accent, 0.28, 0.12, { z: sign * 0.37 });
  }

  // Rectangular waveguide transformer and a pair of water headers.
  box(b.accent, 0.20, 0.18, 0.26, { x: -0.34, y: BEAM_HEIGHT + 0.05, z: -0.18 });
  box(b.detail, 0.05, 0.23, 0.31, { x: -0.465, y: BEAM_HEIGHT + 0.05, z: -0.18 });
  for (const x of [-0.18, 0.18]) {
    cylZ(b.pipe, 0.032, 0.70, { x, y: BEAM_HEIGHT - 0.31 });
    for (const z of cellCentres) cylY(b.iron, 0.016, 0.13, { x, y: BEAM_HEIGHT - 0.245, z, segs: 8 });
  }
  pedestal(b, -0.26, BEAM_HEIGHT - 0.30, 0.22, 0.16);
  pedestal(b, 0.26, BEAM_HEIGHT - 0.30, 0.22, 0.16);
  return b;
}

// Alvarez drift-tube linac: the drift tubes and alternating stems are left
// exposed inside an open tank frame so the increasing cell length is visible.
export function _buildDtlRoles() {
  const b = buckets();
  const length = 3.0;
  beamPipe(b, length);

  const tubeCentres = [-1.13, -0.80, -0.42, 0.02, 0.52, 1.08];
  const tubeLengths = [0.22, 0.27, 0.32, 0.38, 0.44, 0.50];
  for (let i = 0; i < tubeCentres.length; i++) {
    const z = tubeCentres[i];
    const tubeLength = tubeLengths[i];
    cylZ(b.copper, 0.23, tubeLength, { z });
    const sign = i % 2 ? 1 : -1;
    const stemLength = 0.40;
    cylY(b.copper, 0.045, stemLength, {
      y: BEAM_HEIGHT + sign * (0.23 + stemLength / 2),
      z,
      segs: 10,
    });
  }

  // Four longitudinal tank rails and end hoops imply the vacuum tank without
  // hiding the drift-tube sequence inside an opaque cylinder.
  for (const x of [-0.40, 0.40]) {
    cylZ(b.iron, 0.045, 2.72, { x, y: BEAM_HEIGHT });
  }
  for (const y of [BEAM_HEIGHT - 0.40, BEAM_HEIGHT + 0.40]) {
    cylZ(b.iron, 0.045, 2.72, { y });
  }
  for (const z of [-1.34, 1.34]) torus(b.accent, 0.40, 0.055, { z });
  box(b.accent, 0.30, 0.24, 0.42, { x: -0.58, y: 1.12, z: -0.78 });
  cylX(b.detail, 0.055, 0.25, { x: -0.43, y: 1.12, z: -0.78, segs: 10 });

  for (const z of [-1.05, 0, 1.05]) pedestal(b, z, BEAM_HEIGHT - 0.45, 0.30, 0.22);
  return b;
}

// Eight-cell TESLA module: a visible niobium cavity string, warm end cans,
// one coupler per cavity, and a full-length helium header.
export function _buildCryomoduleRoles() {
  const b = buckets();
  const length = 8.0;
  beamPipe(b, length);

  const cellCentres = spread(8, 6.25);
  for (const z of cellCentres) {
    sphere(b.pipe, 0.34, { z, sz: 0.72 });
    cylZ(b.detail, 0.375, 0.045, { z });

    // Fundamental-power coupler: coax neck into a rectangular transformer.
    cylX(b.copper, 0.055, 0.20, { x: -0.43, z, segs: 10 });
    box(b.accent, 0.18, 0.22, 0.24, { x: -0.62, z });
    box(b.detail, 0.05, 0.27, 0.29, { x: -0.735, z });
  }

  // Warm end cans and tapered transitions down to the standard beam tube.
  for (const sign of [-1, 1]) {
    cylZ(b.accent, 0.42, 0.55, { z: sign * 3.47 });
    cylZ(b.iron, 0.42, 0.34, {
      z: sign * 3.87,
      rTop: sign > 0 ? 0.18 : 0.42,
    });
  }

  // Helium gas return header and drop legs to every second cavity.
  cylZ(b.pipe, 0.10, 7.05, { x: 0.45, y: 1.50 });
  for (const z of cellCentres.filter((_, i) => i % 2 === 0)) {
    cylY(b.detail, 0.040, 0.28, { x: 0.45, y: 1.36, z, segs: 8 });
  }
  for (const z of [-2.8, -0.9, 0.9, 2.8]) pedestal(b, z, BEAM_HEIGHT - 0.42, 0.30, 0.24);

  return b;
}
