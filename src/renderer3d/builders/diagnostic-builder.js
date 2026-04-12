// src/renderer3d/builders/diagnostic-builder.js
//
// Role-bucket builders for the four starter beamline diagnostics.
// Each builder returns a bucket object keyed by material role
// (accent/iron/copper/pipe/stand/detail) whose values are arrays of
// BufferGeometry already transformed into component-local space.
//
// Conventions (shared with component-builder.js):
//   - Beam axis runs along local +Z at y = BEAM_HEIGHT.
//   - Origin is the footprint center at floor level (y = 0).
//   - 1 sub-tile = 0.5 m. A device with subL = N has length N * 0.5 m
//     along Z, centered at z = 0.
//   - THREE is a CDN global — do NOT import it.
//
// Builders are registered in component-builder.js by importing them
// into the ROLE_BUILDERS map.

import { applyTiledBoxUVs, applyTiledCylinderUVs } from '../uv-utils.js';

// Geometry constants shared across diagnostic builders. Kept in sync
// with the values in component-builder.js so the beam pipe reads as
// continuous when diagnostics are placed between other components.
const SUB_UNIT    = 0.5;
const BEAM_HEIGHT = 1.0;
const PIPE_R      = 0.08;
const FLANGE_R    = 0.16;
const FLANGE_H    = 0.045;
const SEGS        = 16;

// Transform a geometry in place and push it into a bucket. Matches the
// _pushTransformed helper in component-builder.js.
function pushT(bucket, geom, matrix) {
  geom.applyMatrix4(matrix);
  bucket.push(geom);
}

// Make a translation matrix. Small helper to avoid repetition.
function trans(x, y, z) {
  return new THREE.Matrix4().makeTranslation(x, y, z);
}

// Make a rotation-X matrix (used to lie cylinders horizontal along Z).
function rotX(angle) {
  return new THREE.Matrix4().makeRotationX(angle);
}

/**
 * Build a straight beam pipe segment spanning the full length of the
 * component's footprint along +Z. Pushes one geometry into the `pipe`
 * bucket. All four diagnostic builders call this first.
 *
 * @param {Record<string, THREE.BufferGeometry[]>} buckets
 * @param {number} subL  Length in sub-tiles (e.g. 1 = 0.5 m).
 */
export function buildBeamPipeSegment(buckets, subL) {
  const len = subL * SUB_UNIT;
  const g = new THREE.CylinderGeometry(PIPE_R, PIPE_R, len, SEGS);
  applyTiledCylinderUVs(g, PIPE_R, len, SEGS);
  // CylinderGeometry is Y-aligned by default; rotate so it runs along Z.
  const m = new THREE.Matrix4().multiplyMatrices(
    trans(0, BEAM_HEIGHT, 0),
    rotX(Math.PI / 2),
  );
  pushT(buckets.pipe, g, m);
}

/**
 * BPM — 1×1 footprint. Low cylindrical block on the beam pipe with
 * four SMA-style button feedthroughs at 45° and a thin coax tail.
 * Pipe-mounted, no floor stand.
 *
 * Accent: electronics green (applied by the accent material cache).
 */
export function _buildBPMRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };

  // Shared straight beam pipe spanning the whole 0.5 m footprint.
  buildBeamPipeSegment(buckets, 1);

  // Main button block — cylinder concentric with the pipe.
  const blockR = 0.12;
  const blockL = 0.30;
  {
    const g = new THREE.CylinderGeometry(blockR, blockR, blockL, SEGS);
    applyTiledCylinderUVs(g, blockR, blockL, SEGS);
    const m = new THREE.Matrix4().multiplyMatrices(
      trans(0, BEAM_HEIGHT, 0),
      rotX(Math.PI / 2),
    );
    pushT(buckets.accent, g, m);
  }

  // Four button feedthroughs at 45° intervals in the transverse plane,
  // projecting radially outward from the block surface. Each is a short
  // cylinder whose long axis is the radial direction.
  const buttonR = 0.02;
  const buttonL = 0.06;
  const buttonCenterRadius = blockR + buttonL / 2 - 0.005; // slight embed
  for (let i = 0; i < 4; i++) {
    const theta = Math.PI / 4 + (i * Math.PI / 2); // 45, 135, 225, 315 deg
    const dx = Math.cos(theta) * buttonCenterRadius;
    const dy = Math.sin(theta) * buttonCenterRadius;

    const g = new THREE.CylinderGeometry(buttonR, buttonR, buttonL, 8);
    applyTiledCylinderUVs(g, buttonR, buttonL, 8);

    // Default Y-up cylinder — rotate around Z so its long axis points
    // in the (dx, dy) direction. The rotation angle is (theta - 90°)
    // because Y rotated by (theta-90°) lands on direction theta.
    const rZ = new THREE.Matrix4().makeRotationZ(theta - Math.PI / 2);
    const tr = trans(dx, BEAM_HEIGHT + dy, 0);
    const m  = new THREE.Matrix4().multiplyMatrices(tr, rZ);
    pushT(buckets.detail, g, m);
  }

  // Coax signal tail exiting the top of the block (straight up).
  {
    const tailR = 0.015;
    const tailL = 0.10;
    const g = new THREE.CylinderGeometry(tailR, tailR, tailL, 8);
    applyTiledCylinderUVs(g, tailR, tailL, 8);
    const m = trans(0, BEAM_HEIGHT + blockR + tailL / 2, 0);
    pushT(buckets.detail, g, m);
  }

  return buckets;
}

/**
 * ICT (Integrating Current Transformer) — 1×1 footprint. A toroidal ring
 * wrapping the beam pipe with a single coax signal tail. Pipe-mounted,
 * no floor stand. Silhouette must be clearly distinct from BPM's block.
 *
 * Uses the `copper` role (no accent tint) since the toroid is visually
 * a copper winding.
 */
export function _buildICTRoles() {
  /** @type {Record<string, THREE.BufferGeometry[]>} */
  const buckets = { accent: [], iron: [], copper: [], pipe: [], stand: [], detail: [] };

  buildBeamPipeSegment(buckets, 1);

  // Toroid wrapping the pipe. TorusGeometry defaults to lying in the XY
  // plane with its hole axis along Z — that's what we want, since the
  // beam runs along +Z in component-local space.
  const torusRadius = 0.14;
  const torusTube   = 0.04;
  {
    const g = new THREE.TorusGeometry(torusRadius, torusTube, 12, SEGS);
    const m = trans(0, BEAM_HEIGHT, 0);
    pushT(buckets.copper, g, m);
  }

  // Coax signal tail exiting the top of the torus.
  {
    const tailR = 0.015;
    const tailL = 0.12;
    const g = new THREE.CylinderGeometry(tailR, tailR, tailL, 8);
    applyTiledCylinderUVs(g, tailR, tailL, 8);
    const m = trans(0, BEAM_HEIGHT + torusRadius + torusTube + tailL / 2, 0);
    pushT(buckets.detail, g, m);
  }

  return buckets;
}
