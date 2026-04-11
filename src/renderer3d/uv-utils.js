// src/renderer3d/uv-utils.js
// Pure functions that rewrite UV attributes on Box/Cylinder geometries
// so each face's UV span is proportional to its world-space dimensions.
// THREE is a CDN global — do NOT import it.
//
// World-space -> UV: u = world_dimension / METERS_PER_TILE.
// METERS_PER_TILE is derived from TEXEL_SCALE in materials/index.js
// (32 texels/m × 64 texels/tile = 2m). Hard-coded here to avoid a cycle;
// keep in sync with TEXEL_SCALE.

const METERS_PER_TILE = 2.0;

/**
 * Rewrite the UV attribute on a non-indexed THREE.BoxGeometry so each
 * face's UVs span the face's world-space dimensions / METERS_PER_TILE.
 *
 * THREE.BoxGeometry vertex order is fixed: 6 faces in the order
 * [+X, -X, +Y, -Y, +Z, -Z], each face having 4 verts. Each face's
 * default UVs are:
 *   v0: (0, 1)   v1: (1, 1)
 *   v2: (0, 0)   v3: (1, 0)
 * We replace those with (0, vSpan), (uSpan, vSpan), (0, 0), (uSpan, 0).
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {number} width  size along X (m)
 * @param {number} height size along Y (m)
 * @param {number} depth  size along Z (m)
 */
export function applyTiledBoxUVs(geometry, width, height, depth) {
  const uv = geometry.attributes.uv;
  if (!uv) return;
  const arr = uv.array;
  const u_w = width / METERS_PER_TILE;
  const u_h = height / METERS_PER_TILE;
  const u_d = depth / METERS_PER_TILE;
  // [uSpan, vSpan] per face, in default BoxGeometry order
  const spans = [
    [u_d, u_h],  // +X face: U=depth, V=height
    [u_d, u_h],  // -X face
    [u_w, u_d],  // +Y face: U=width, V=depth
    [u_w, u_d],  // -Y face
    [u_w, u_h],  // +Z face: U=width, V=height
    [u_w, u_h],  // -Z face
  ];
  for (let face = 0; face < 6; face++) {
    const [uSpan, vSpan] = spans[face];
    const off = face * 8;
    arr[off + 0] = 0;     arr[off + 1] = vSpan;
    arr[off + 2] = uSpan; arr[off + 3] = vSpan;
    arr[off + 4] = 0;     arr[off + 5] = 0;
    arr[off + 6] = uSpan; arr[off + 7] = 0;
  }
  uv.needsUpdate = true;
}

/**
 * Rewrite the UV attribute on a THREE.CylinderGeometry so the side wall
 * tiles by circumference (U) and height (V). Cap UVs are scaled
 * uniformly from their default [0..1] disk layout.
 *
 * THREE.CylinderGeometry default vertex layout (radialSegments = N):
 *   - Side: (N+1) × 2 verts (top ring then bottom ring), default UVs
 *     U = i / N, V = 1 (top) / 0 (bottom).
 *   - Top cap: (N+2) verts. Bottom cap: (N+2) verts.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {number} radius
 * @param {number} height
 * @param {number} radialSegments  must match the geometry's segments
 */
export function applyTiledCylinderUVs(geometry, radius, height, radialSegments) {
  const uv = geometry.attributes.uv;
  if (!uv) return;
  const arr = uv.array;
  const circumference = 2 * Math.PI * radius;
  const uSpan = circumference / METERS_PER_TILE;
  const vSpan = height / METERS_PER_TILE;
  const N = radialSegments;
  const sideVerts = (N + 1) * 2;
  // Side: top ring first, then bottom ring (THREE convention)
  for (let i = 0; i <= N; i++) {
    const u = (i / N) * uSpan;
    arr[i * 2 + 0] = u;
    arr[i * 2 + 1] = vSpan; // top
    const j = (N + 1) + i;
    arr[j * 2 + 0] = u;
    arr[j * 2 + 1] = 0;     // bottom
  }
  // Caps: scale default [0..1] disk UVs around (0.5, 0.5) by full diameter.
  const capScale = (2 * radius) / METERS_PER_TILE;
  for (let i = sideVerts; i < arr.length / 2; i++) {
    const ux = arr[i * 2 + 0];
    const uy = arr[i * 2 + 1];
    arr[i * 2 + 0] = (ux - 0.5) * capScale;
    arr[i * 2 + 1] = (uy - 0.5) * capScale;
  }
  uv.needsUpdate = true;
}
