// src/renderer3d/builders/source-machine-builder.js
// Purpose-built role geometry for large beam sources and injector assemblies.
// Beam exits run toward local +Z at the shared 1 m axis height.
// THREE is a CDN global — do NOT import it.

import { applyTiledBoxUVs, applyTiledCylinderUVs } from '../uv-utils.js';
import {
  BEAM_AXIS_HEIGHT as BEAM_HEIGHT,
  BEAM_PIPE_RADIUS as PIPE_R,
  BEAM_FLANGE_RADIUS as FLANGE_R,
  BEAM_FLANGE_WIDTH as FLANGE_H,
} from '../../beamline/visual-geometry.js';

const SEGS = 16;

function buckets() {
  return { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };
}

function push(bucket, geometry, matrix) {
  geometry.applyMatrix4(matrix);
  bucket.push(geometry);
}

function translation(x = 0, y = 0, z = 0) {
  return new THREE.Matrix4().makeTranslation(x, y, z);
}

function composed(position, rotation) {
  return new THREE.Matrix4().multiplyMatrices(position, rotation);
}

function box(bucket, w, h, l, { x = 0, y = BEAM_HEIGHT, z = 0, rotY = 0 } = {}) {
  const g = new THREE.BoxGeometry(w, h, l);
  applyTiledBoxUVs(g, w, h, l);
  const t = translation(x, y, z);
  if (!rotY) push(bucket, g, t);
  else push(bucket, g, composed(t, new THREE.Matrix4().makeRotationY(rotY)));
}

function cylY(bucket, r, h, { x = 0, y = BEAM_HEIGHT, z = 0, segs = SEGS } = {}) {
  const g = new THREE.CylinderGeometry(r, r, h, segs);
  applyTiledCylinderUVs(g, r, h, segs);
  push(bucket, g, translation(x, y, z));
}

function cylZ(bucket, r, l, { x = 0, y = BEAM_HEIGHT, z = 0, segs = SEGS, rTop = r } = {}) {
  const g = new THREE.CylinderGeometry(rTop, r, l, segs);
  applyTiledCylinderUVs(g, (r + rTop) / 2, l, segs);
  push(bucket, g, composed(
    translation(x, y, z),
    new THREE.Matrix4().makeRotationX(Math.PI / 2),
  ));
}

function cylX(bucket, r, l, { x = 0, y = BEAM_HEIGHT, z = 0, segs = SEGS } = {}) {
  const g = new THREE.CylinderGeometry(r, r, l, segs);
  applyTiledCylinderUVs(g, r, l, segs);
  push(bucket, g, composed(
    translation(x, y, z),
    new THREE.Matrix4().makeRotationZ(Math.PI / 2),
  ));
}

function torus(bucket, major, tube, {
  x = 0, y = BEAM_HEIGHT, z = 0, rotX = 0, rotY = 0,
} = {}) {
  const g = new THREE.TorusGeometry(major, tube, 8, 24);
  const rotation = new THREE.Matrix4();
  if (rotX) rotation.multiply(new THREE.Matrix4().makeRotationX(rotX));
  if (rotY) rotation.multiply(new THREE.Matrix4().makeRotationY(rotY));
  push(bucket, g, composed(translation(x, y, z), rotation));
}

function sphere(bucket, r, { x = 0, y = BEAM_HEIGHT, z = 0, sx = 1, sy = 1, sz = 1 } = {}) {
  const g = new THREE.SphereGeometry(r, SEGS, 10);
  g.scale(sx, sy, sz);
  push(bucket, g, translation(x, y, z));
}

function segment(bucket, a, b, r, segs = 10) {
  const from = new THREE.Vector3(...a);
  const to = new THREE.Vector3(...b);
  const delta = to.clone().sub(from);
  const length = delta.length();
  if (length < 1e-6) return;
  const g = new THREE.CylinderGeometry(r, r, length, segs);
  applyTiledCylinderUVs(g, r, length, segs);
  const rotation = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    delta.normalize(),
  );
  const matrix = new THREE.Matrix4().compose(
    from.add(to).multiplyScalar(0.5),
    rotation,
    new THREE.Vector3(1, 1, 1),
  );
  push(bucket, g, matrix);
}

function exitPipe(b, halfLength, innerZ, { x = 0, y = BEAM_HEIGHT } = {}) {
  const length = halfLength - innerZ;
  if (length > 0.001) cylZ(b.pipe, PIPE_R, length, { x, y, z: innerZ + length / 2 });
  cylZ(b.detail, FLANGE_R, FLANGE_H, { x, y, z: halfLength });
}

function pedestal(b, z, topY, { x = 0, width = 0.34, depth = 0.26 } = {}) {
  const baseH = 0.07;
  const colH = Math.max(0.05, topY - baseH);
  box(b.stand, width + 0.22, baseH, depth + 0.10, { x, y: baseH / 2, z });
  box(b.stand, width, colH, depth, { x, y: baseH + colH / 2, z });
}

function spread(count, span, centre = 0) {
  return Array.from({ length: count }, (_, i) =>
    centre - span / 2 + ((i + 0.5) / count) * span);
}

function buildCyclotron({ footprint, bodyR, bodyH, coilR, serviceCount, shieldRing = false }) {
  const b = buckets();
  const halfLength = footprint / 2;
  const bodyY = 0.48 + bodyH / 2;

  // Horizontal iron pole/yoke stack: cyclotrons are broad pancakes, not
  // upright tanks. Copper coils circle the pole gap above and below it.
  cylY(b.iron, bodyR, bodyH, { y: bodyY, segs: 24 });
  for (const sign of [-1, 1]) {
    const y = bodyY + sign * (bodyH / 2 + 0.08);
    torus(b.copper, coilR, 0.10, { y, rotX: Math.PI / 2 });
    cylY(b.detail, bodyR + 0.06, 0.07, { y: bodyY + sign * bodyH / 2, segs: 24 });
  }

  // Opposed RF dees and central pole cap remain visible above the yoke.
  for (const sign of [-1, 1]) {
    box(b.accent, bodyR * 0.78, 0.16, bodyR * 0.95, {
      x: sign * bodyR * 0.40,
      y: bodyY + bodyH / 2 + 0.18,
    });
  }
  cylY(b.iron, bodyR * 0.24, 0.22, { y: bodyY + bodyH / 2 + 0.20, segs: 20 });

  if (shieldRing) {
    torus(b.accent, bodyR + 0.17, 0.12, { y: bodyY, rotX: Math.PI / 2 });
  }

  // Extraction channel leaves the forward rim tangentially and reaches the
  // authored +Z source port at the footprint edge.
  const extractStart = Math.min(bodyR * 0.72, halfLength - 0.35);
  segment(b.pipe,
    [bodyR * 0.25, BEAM_HEIGHT, extractStart - 0.30],
    [0, BEAM_HEIGHT, extractStart], PIPE_R);
  exitPipe(b, halfLength, extractStart);

  // Vacuum/cooling services cluster on the rear-left quadrant.
  for (let i = 0; i < serviceCount; i++) {
    const angle = Math.PI * (0.78 + i * 0.12);
    const x = Math.cos(angle) * bodyR * 0.82;
    const z = Math.sin(angle) * bodyR * 0.82;
    cylY(b.pipe, 0.07, 0.46 + i * 0.04, { x, y: bodyY + bodyH / 2 + 0.23, z, segs: 10 });
    cylY(b.accent, 0.12, 0.08, { x, y: bodyY + bodyH / 2 + 0.48 + i * 0.04, z, segs: 10 });
  }

  for (const z of [-bodyR * 0.58, bodyR * 0.58]) {
    for (const x of [-bodyR * 0.48, bodyR * 0.48]) {
      pedestal(b, z, 0.48, { x, width: 0.34, depth: 0.28 });
    }
  }
  return b;
}

export function _buildCyclotron30Roles() {
  return buildCyclotron({
    footprint: 4.0,
    bodyR: 1.28,
    bodyH: 0.72,
    coilR: 1.03,
    serviceCount: 2,
  });
}

export function _buildCyclotron70Roles() {
  return buildCyclotron({
    footprint: 5.0,
    bodyR: 1.65,
    bodyH: 0.90,
    coilR: 1.34,
    serviceCount: 3,
  });
}

export function _buildCyclotron230Roles() {
  return buildCyclotron({
    footprint: 6.0,
    bodyR: 2.05,
    bodyH: 1.00,
    coilR: 1.68,
    serviceCount: 4,
    shieldRing: true,
  });
}

export function _buildProtonLinacFrontEndRoles() {
  const b = buckets();
  const halfLength = 9.0;

  // Ion source and extraction column at the upstream end.
  cylZ(b.iron, 0.44, 1.1, { z: -7.85 });
  cylZ(b.detail, 0.51, 0.08, { z: -8.38 });
  for (const z of [-7.45, -7.15]) torus(b.copper, 0.37, 0.055, { z });
  cylZ(b.pipe, PIPE_R, 1.1, { z: -6.65 });

  // RFQ: a long copper vane tank with frequent cell rings.
  const rfqStart = -6.1;
  const rfqEnd = -2.25;
  cylZ(b.copper, 0.42, rfqEnd - rfqStart, { z: (rfqStart + rfqEnd) / 2 });
  for (const z of spread(12, rfqEnd - rfqStart - 0.18, (rfqStart + rfqEnd) / 2)) {
    cylZ(b.detail, 0.46, 0.035, { z });
  }

  // Medium-beta accelerating chain: four independently powered tanks whose
  // increasing cell length reads as a beam gaining speed down the line.
  const tankCentres = [-1.25, 0.35, 2.15, 4.15, 6.20];
  for (let i = 0; i < tankCentres.length; i++) {
    const z = tankCentres[i];
    const radius = 0.46 + i * 0.045;
    const length = 1.15 + i * 0.13;
    cylZ(i < 2 ? b.copper : b.accent, radius, length, { z });
    for (const sign of [-1, 1]) cylZ(b.detail, radius + 0.045, 0.06, { z: z + sign * length / 2 });
    box(b.accent, 0.44, 0.22, 0.32, {
      x: -(radius + 0.24),
      y: BEAM_HEIGHT + 0.08,
      z,
    });
    pedestal(b, z, BEAM_HEIGHT - radius, { width: 0.28, depth: 0.30 });
  }

  // Continuous beam tube and a cryogenic/service header tie the purchased
  // front-end section into one machine rather than a row of unrelated cans.
  cylZ(b.pipe, PIPE_R, 16.1, { z: 0.55 });
  cylZ(b.pipe, 0.09, 12.8, { x: 0.78, y: 1.62, z: 1.15, segs: 10 });
  for (const z of tankCentres) {
    segment(b.pipe, [0.78, 1.62, z], [0.48, 1.35, z], 0.045, 8);
  }
  exitPipe(b, halfLength, 7.55);
  pedestal(b, -7.85, BEAM_HEIGHT - 0.44, { width: 0.30, depth: 0.30 });
  pedestal(b, -4.2, BEAM_HEIGHT - 0.42, { width: 0.30, depth: 0.30 });
  return b;
}

export function _buildLwfaStationRoles() {
  const b = buckets();
  const halfLength = 3.0;

  // Plasma capillary and differential-pumping chamber on the beam axis.
  cylZ(b.pipe, 0.22, 1.45, { z: 0.72 });
  for (const z of [0.22, 1.22]) {
    sphere(b.iron, 0.25, { z, sz: 0.62 });
  }
  for (const z of [0.12, 0.72, 1.32]) cylZ(b.detail, 0.28, 0.055, { z });
  cylZ(b.copper, 0.065, 0.82, { z: 0.72, segs: 12 });
  exitPipe(b, halfLength, 1.45);

  // Offset optical table with compressor gratings and a transverse final
  // focusing mirror feeding the capillary entrance.
  box(b.stand, 1.65, 0.12, 4.65, { x: -1.05, y: 0.48, z: -0.15 });
  for (const z of [-1.75, -0.95, -0.15]) {
    box(b.copper, 0.62, 0.055, 0.34, { x: -1.05, y: 0.66, z, rotY: (z + 2) * 0.16 });
    cylY(b.detail, 0.055, 0.22, { x: -1.42, y: 0.61, z, segs: 10 });
  }
  segment(b.copper, [-1.05, 0.72, -1.75], [-1.05, 0.72, -0.1], 0.045, 10);
  segment(b.copper, [-1.05, 0.72, -0.1], [0, BEAM_HEIGHT, 0.12], 0.045, 10);
  sphere(b.detail, 0.19, { x: -0.12, y: 0.96, z: 0.10, sx: 0.35, sy: 1, sz: 1 });

  // Laser controls and vacuum rack occupy the rear of the bay.
  box(b.accent, 0.66, 1.20, 0.72, { x: 1.12, y: 0.60, z: -1.72 });
  for (const y of [0.32, 0.58, 0.84]) box(b.detail, 0.70, 0.035, 0.54, { x: 1.12, y, z: -1.72 });
  for (const z of [-1.6, 0.72, 1.45]) pedestal(b, z, 0.42, { width: 0.30, depth: 0.28 });
  return b;
}

export function _buildPositronSourceRoles() {
  const b = buckets();
  const halfLength = 4.0;

  // Rotating target wheel inside its vacuum chamber.
  const targetZ = -2.55;
  cylZ(b.pipe, 0.46, 0.72, { z: targetZ });
  cylZ(b.detail, 0.53, 0.07, { z: targetZ - 0.36 });
  cylZ(b.copper, 0.31, 0.09, { z: targetZ, segs: 18 });
  cylY(b.iron, 0.11, 0.72, { x: 0.38, y: BEAM_HEIGHT + 0.32, z: targetZ, segs: 12 });

  // Flux concentrator and capture-solenoid winding pack immediately after
  // the target—the unmistakable signature of positron production.
  for (const z of spread(7, 1.30, -1.55)) {
    torus(b.copper, 0.34, 0.052, { z });
  }
  for (const z of [-2.25, -0.85]) torus(b.accent, 0.37, 0.065, { z });

  // Immersed capture linac: a short chain of fat S-band cells.
  for (const z of spread(7, 3.45, 1.25)) {
    sphere(b.copper, 0.28, { z, sz: 0.70 });
    cylZ(b.detail, 0.32, 0.035, { z });
  }
  // The compound source exposes one external RF feed for the capture linac.
  // Give that logical port a real waveguide transformer/window instead of
  // letting its fitting float high on the capture-solenoid silhouette.
  box(b.accent, 0.38, 0.16, 0.24, { x: 0.47, y: BEAM_HEIGHT + 0.05, z: 0 });
  box(b.detail, 0.06, 0.23, 0.31, { x: 0.69, y: BEAM_HEIGHT + 0.05, z: 0 });
  cylZ(b.pipe, PIPE_R, 6.15, { z: 0.72 });
  exitPipe(b, halfLength, 3.30);

  // Side dump for the spent drive electrons and photons.
  segment(b.pipe, [0, BEAM_HEIGHT, -2.05], [0.72, BEAM_HEIGHT, -1.25], 0.065);
  box(b.iron, 0.58, 0.58, 0.90, { x: 1.15, z: -0.88 });
  box(b.accent, 0.64, 0.12, 0.96, { x: 1.15, y: BEAM_HEIGHT + 0.35, z: -0.88 });

  for (const z of [-2.55, -1.45, 0, 1.55, 2.85]) {
    pedestal(b, z, BEAM_HEIGHT - 0.38, { width: 0.26, depth: 0.24 });
  }
  return b;
}
