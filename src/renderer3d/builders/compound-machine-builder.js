// src/renderer3d/builders/compound-machine-builder.js
//
// Role-bucket builders for the self-contained electrostatic accelerators.
// Beam exits on local +Z at y=BEAM_HEIGHT; y=0 is the floor.
// THREE is a CDN global — do NOT import it.

import { applyTiledBoxUVs, applyTiledCylinderUVs } from '../uv-utils.js';
import {
  BEAM_AXIS_HEIGHT as BEAM_HEIGHT,
  BEAM_PIPE_RADIUS as PIPE_R,
  BEAM_FLANGE_RADIUS as FLANGE_R,
} from '../../beamline/visual-geometry.js';

const SEGS = 16;

function buckets() {
  return { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };
}

function push(bucket, geometry, {
  x = 0, y = 0, z = 0,
  rx = 0, ry = 0, rz = 0,
  sx = 1, sy = 1, sz = 1,
} = {}) {
  geometry.applyMatrix4(new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  ));
  bucket.push(geometry);
}

function box(bucket, w, h, l, pose) {
  const g = new THREE.BoxGeometry(w, h, l);
  applyTiledBoxUVs(g, w, h, l);
  push(bucket, g, pose);
}

function cylinder(bucket, radius, height, pose, axis = 'y', segs = SEGS) {
  const g = new THREE.CylinderGeometry(radius, radius, height, segs);
  applyTiledCylinderUVs(g, radius, height, segs);
  const rotated = { ...pose };
  if (axis === 'x') rotated.rz = Math.PI / 2;
  if (axis === 'z') rotated.rx = Math.PI / 2;
  push(bucket, g, rotated);
}

// TorusGeometry's hole points along +Z by default.
function torus(bucket, major, tube, pose, axis = 'z') {
  const rotated = { ...pose };
  if (axis === 'y') rotated.rx = Math.PI / 2;
  if (axis === 'x') rotated.ry = Math.PI / 2;
  push(bucket, new THREE.TorusGeometry(major, tube, 8, 24), rotated);
}

/**
 * Van de Graaff compound accelerator.
 *
 * The domed SF6 vessel contains a visible belt housing. A horizontal stack of
 * grading rings then carries the beam to the front port, preserving the
 * iconic electrostatic-generator silhouette while making the gameplay port
 * direction unambiguous.
 */
export function _buildVanDeGraaffRoles() {
  const b = buckets();

  // Low steel skid: the 2 m × 3 m footprint stays visibly open around the
  // machine instead of reading as one solid fallback crate.
  for (const x of [-0.72, 0.72]) {
    box(b.stand, 0.14, 0.10, 2.45, { x, y: 0.05, z: -0.12 });
  }
  for (const z of [-1.18, 0.83]) {
    box(b.stand, 1.58, 0.08, 0.15, { y: 0.11, z });
  }

  // SF6 pressure vessel: cylindrical middle with squashed spherical end caps.
  // The upper bright terminal dome is the visual signature at gameplay zoom.
  cylinder(b.accent, 0.62, 1.36, { y: 1.16, z: -0.48 });
  for (const y of [0.48, 1.84]) {
    push(b.accent, new THREE.SphereGeometry(0.62, SEGS, 10), {
      y, z: -0.48, sy: 0.40,
    });
  }
  push(b.iron, new THREE.SphereGeometry(0.37, SEGS, 10), {
    y: 2.16, z: -0.48, sy: 0.82,
  });
  for (const y of [0.66, 1.17, 1.68]) {
    torus(b.iron, 0.62, 0.035, { y, z: -0.48 }, 'y');
  }

  // Rubber-belt housing and rollers, exposed on the left side of the tank.
  box(b.detail, 0.18, 1.08, 0.22, { x: -0.66, y: 1.17, z: -0.48 });
  box(b.copper, 0.035, 0.78, 0.13, { x: -0.765, y: 1.17, z: -0.48 });
  for (const y of [0.74, 1.60]) {
    cylinder(b.copper, 0.12, 0.24, { x: -0.72, y, z: -0.48 }, 'z', 12);
  }

  // Evacuated acceleration/extraction column. Alternating dark ceramic
  // sleeves and copper grading rings expose the machine's operating principle.
  cylinder(b.pipe, PIPE_R, 1.40, { y: BEAM_HEIGHT, z: 0.80 }, 'z');
  for (const z of [0.22, 0.43, 0.64, 0.85, 1.06, 1.27]) {
    cylinder(b.detail, 0.17, 0.13, { y: BEAM_HEIGHT, z }, 'z', 12);
    torus(b.copper, 0.185, 0.032, { y: BEAM_HEIGHT, z });
  }
  cylinder(b.pipe, FLANGE_R, 0.08, { y: BEAM_HEIGHT, z: 1.46 }, 'z');

  // Two slim cradles keep the extraction stack from appearing to float.
  for (const z of [0.42, 1.14]) {
    box(b.stand, 0.48, 0.07, 0.20, { y: 0.035, z });
    box(b.stand, 0.08, 0.91, 0.12, { y: 0.49, z });
  }

  return b;
}

/**
 * Cockcroft-Walton voltage-multiplier set.
 *
 * Six open decks, paired capacitor cans and crossed rectifier links make the
 * cascade readable from every camera quadrant. A compact ion-source chamber
 * sits at beam height on the front of the tower.
 */
export function _buildCockcroftWaltonRoles() {
  const b = buckets();

  // Broad base and low rectifier cabinets establish the full 3 m width.
  box(b.stand, 2.65, 0.16, 2.30, { y: 0.08, z: -0.20 });
  box(b.accent, 2.32, 0.42, 1.48, { y: 0.37, z: -0.43 });
  for (const x of [-0.78, 0, 0.78]) {
    box(b.detail, 0.035, 0.30, 0.05, { x, y: 0.37, z: 0.335 });
  }

  // Open four-post high-voltage tower and its six equipotential decks.
  for (const x of [-1.02, 1.02]) {
    for (const z of [-0.88, 0.02]) {
      box(b.iron, 0.09, 2.30, 0.09, { x, y: 1.66, z });
    }
  }
  const deckY = [0.64, 1.05, 1.46, 1.87, 2.28, 2.69];
  for (const y of deckY) {
    box(b.accent, 2.22, 0.055, 1.16, { y, z: -0.43 });
    torus(b.iron, 0.29, 0.025, { y: y + 0.045, z: -0.43 }, 'y');
  }

  // Paired capacitor cans and their copper end rings form the two banks.
  for (let i = 0; i < deckY.length - 1; i++) {
    const y = (deckY[i] + deckY[i + 1]) / 2;
    for (const x of [-0.67, 0.67]) {
      cylinder(b.copper, 0.115, 0.36, { x, y, z: -0.43 }, 'y', 12);
      torus(b.copper, 0.115, 0.018, { x, y: y - 0.17, z: -0.43 }, 'y');
      torus(b.copper, 0.115, 0.018, { x, y: y + 0.17, z: -0.43 }, 'y');
    }
  }

  // Alternating diode links produce the multiplier ladder instead of another
  // generic tower silhouette.
  const braceSpan = 1.18;
  const braceRise = 0.31;
  const braceLength = Math.hypot(braceSpan, braceRise);
  const braceAngle = Math.atan2(braceRise, braceSpan);
  for (let i = 0; i < deckY.length - 1; i++) {
    const y = (deckY[i] + deckY[i + 1]) / 2;
    box(b.detail, braceLength, 0.045, 0.055, {
      y, z: -0.18, rz: (i % 2 === 0 ? 1 : -1) * braceAngle,
    });
  }

  // Top terminal and corona halo cap the cascade without hiding the open
  // structure. The full silhouette stays under the authored 3 m click volume.
  push(b.iron, new THREE.SphereGeometry(0.27, SEGS, 10), {
    y: 2.79, z: -0.43, sx: 1.45, sy: 0.72, sz: 1.45,
  });
  torus(b.copper, 0.50, 0.035, { y: 2.78, z: -0.43 }, 'y');

  // Integrated duoplasmatron/extraction can and the +Z beamline exit.
  cylinder(b.accent, 0.27, 0.56, { y: BEAM_HEIGHT, z: 0.55 }, 'z');
  for (const z of [0.30, 0.79]) {
    torus(b.copper, 0.29, 0.045, { y: BEAM_HEIGHT, z });
  }
  cylinder(b.pipe, PIPE_R, 0.72, { y: BEAM_HEIGHT, z: 1.14 }, 'z');
  cylinder(b.pipe, FLANGE_R, 0.08, { y: BEAM_HEIGHT, z: 1.46 }, 'z');
  box(b.stand, 0.54, 0.07, 0.50, { y: 0.035, z: 0.56 });
  box(b.stand, 0.09, 0.82, 0.12, { y: 0.45, z: 0.56 });

  return b;
}
