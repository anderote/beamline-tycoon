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

// Builders are filled in by subsequent tasks.
