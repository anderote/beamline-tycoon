// src/renderer3d/wildflower-builder.js
// Scatters small 3D flowers across grass cells as two InstancedMeshes
// (stem + bloom). Per-cell count, position jitter, color, scale, and
// rotation all derive from the cell's existing hash so rebuilds are
// deterministic. THREE is a CDN global — do NOT import it.
//
// The pure helper `computeFlowerInstancesForCell` has NO Three.js
// dependencies so it can be unit-tested under plain Node. The Three.js
// class below is only instantiated in the browser by `ThreeRenderer`.

import { sampleCornersAt } from '../game/terrain.js';

/** Meadow palette (flat ground) — yellow-biased mixed wildflowers. */
const MEADOW_PALETTE = [
  0xffe14d, 0xf2f2f2, 0xffe14d, 0xff8fa3,
  0xc58df5, 0xffe14d, 0xe84a4a, 0x7db9ff,
];
/** Hollow palette — moisture-loving blues, violets, and whites. */
const HOLLOW_PALETTE = [
  0x7db9ff, 0xc58df5, 0xf2f2f2, 0x8ecfff,
  0xbb8bff, 0xffe14d, 0xc8b4ff, 0x9abaf5,
];
/** Hilltop palette — alpine purples and whites with the occasional yellow. */
const HILLTOP_PALETTE = [
  0xc58df5, 0xf2f2f2, 0xe5b4ff, 0xffe14d,
  0xbb8bff, 0xf2f2f2, 0xc58df5, 0xffd17a,
];

const STEM_COLOR = 0x2d6b2d;

/**
 * Clamp a number to [lo, hi].
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 */
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Pure per-cell flower generator. Returns an array of flower descriptors —
 * positions are expressed in tile units centered on `(col, row)` (offsets
 * are ±0.4 of a tile). The builder is responsible for converting these to
 * world-space coordinates.
 *
 * No Three.js dependencies — safe to import from plain Node tests.
 *
 * @param {number} col
 * @param {number} row
 * @param {number} hash  32-bit integer hash for the cell
 * @param {number} brightness  terrain brightness in [-1, 1]
 * @param {?{nw:number,ne:number,se:number,sw:number}} [corners=null]
 *   Per-corner tile heights in world meters (already scaled). When null,
 *   the tile is treated as flat at y=0. The minimum corner Y drives
 *   density/palette banding (hollows vs hilltops), and the full corner
 *   set is bilinearly sampled to give each instance its own terrain Y.
 * @returns {Array<{x:number,y:number,z:number,scale:number,rotY:number,colorHex:number}>}
 */
export function computeFlowerInstancesForCell(col, row, hash, brightness, corners = null) {
  const c = corners || { nw: 0, ne: 0, se: 0, sw: 0 };
  const minCornerY = Math.min(c.nw, c.ne, c.se, c.sw);
  // Flowers need sunlight (brightness gate) and then express at different
  // densities by elevation:
  //   - Sunlit flat meadows get a base meadow bloom.
  //   - Sunlit hollows (moist lowlands) bloom densest, with a blue/violet palette.
  //   - Sunlit hilltops bloom lightly with an alpine palette.
  const brightGate = clamp((brightness - 0.1) * 2.0, 0, 1);    // ramps in above b≈0.1
  const hollowDepth = Math.max(0, -minCornerY);                // 0..~2m
  const hilltopRise = Math.max(0, minCornerY);                 // 0..~3.5m
  const meadowTerm  = brightGate * 0.5;
  const hollowTerm  = hollowDepth * 0.9 * brightGate;
  const hilltopTerm = Math.min(1, hilltopRise * 0.3) * brightGate * 0.5;
  const density = clamp(meadowTerm + hollowTerm + hilltopTerm, 0, 0.95);
  const hash01 = (hash & 0xFFFF) / 0xFFFF;
  const n = Math.floor(hash01 * density * 3);

  // Elevation bands select the palette — boundaries chosen to keep palette
  // assignment stable across the mostly-flat terrain (which is meant to
  // read as meadow) while clearly flipping in hollows/hilltops.
  let palette;
  if (minCornerY <= -0.4) palette = HOLLOW_PALETTE;
  else if (minCornerY >= 1.0) palette = HILLTOP_PALETTE;
  else palette = MEADOW_PALETTE;

  const instances = [];
  for (let i = 0; i < n; i++) {
    // Derive a per-flower 32-bit hash from the cell hash + index.
    // The `| 0` coerces to signed 32-bit. We use `>>> 0` when unpacking
    // bytes to stay in unsigned territory.
    const fh = (Math.imul(hash, 0x27d4eb2d) + Math.imul(i, 0x9e3779b9)) | 0;
    const ufh = fh >>> 0;

    const offX   = ((ufh         & 0xFF) / 255 - 0.5) * 0.8;   // ±0.4
    const offZ   = (((ufh >>> 8)  & 0xFF) / 255 - 0.5) * 0.8;
    const colorIdx = (ufh >>> 16) & 0x7;
    const scale  = 0.8 + (((ufh >>> 19) & 0xF) / 15) * 0.5;     // 0.8..1.3
    const rotY   = (((ufh >>> 23) & 0xFF) / 255) * 2 * Math.PI;

    const u = offX + 0.5;
    const v = offZ + 0.5;
    const y = sampleCornersAt(c, u, v);

    instances.push({
      x: col + offX,
      y,
      z: row + offZ,
      scale,
      rotY,
      colorHex: palette[colorIdx],
    });
  }
  return instances;
}

/**
 * Renders the wildflower layer as two InstancedMeshes (stem + bloom) sharing
 * one instance matrix per flower. Mirrors the lifecycle shape of other
 * renderer builders: `add(parent)` attaches to a Three.js Group/Scene,
 * `rebuild(snapshot)` rebuilds from a world snapshot, `dispose()` removes
 * them and disposes owned geometry/materials.
 */
export class WildflowerBuilder {
  constructor() {
    this._parent = null;
    this._stemMesh = null;
    this._bloomMesh = null;
  }

  /**
   * Attach the builder to a parent Group/Scene. Meshes are created on the
   * first call to `rebuild()`.
   */
  add(parent) {
    this._parent = parent;
  }

  /**
   * Rebuild the InstancedMeshes from the current terrain snapshot.
   * Disposes previous meshes if present.
   */
  rebuild(snapshot) {
    this._disposeMeshes();
    if (!this._parent) return;
    if (typeof THREE === 'undefined') return; // test/headless safety
    const terrain = snapshot?.terrain ?? [];
    if (terrain.length === 0) return;

    // Base dimensions — per-instance scale further modulates these.
    const STEM_H = 0.12;
    const STEM_R = 0.012;
    const BLOOM_R = 0.05;

    const stemGeo = new THREE.CylinderGeometry(STEM_R, STEM_R, STEM_H, 4);
    // Shift the cylinder so y=0 is its base, not its center — then the per-
    // instance matrix positions the base right on the grass plane.
    stemGeo.translate(0, STEM_H / 2, 0);
    const stemMat = new THREE.MeshStandardMaterial({
      color: STEM_COLOR, roughness: 0.85,
    });

    // Slightly flattened sphere for a disc-like bloom.
    const bloomGeo = new THREE.SphereGeometry(BLOOM_R, 6, 4);
    bloomGeo.scale(1, 0.55, 1);
    bloomGeo.translate(0, STEM_H + BLOOM_R * 0.3, 0);
    const bloomMat = new THREE.MeshStandardMaterial({ roughness: 0.55 });

    // Upper bound: at most 3 flowers per cell.
    const maxCount = terrain.length * 3;
    const stemMesh = new THREE.InstancedMesh(stemGeo, stemMat, maxCount);
    const bloomMesh = new THREE.InstancedMesh(bloomGeo, bloomMat, maxCount);
    stemMesh.matrixAutoUpdate = false;
    bloomMesh.matrixAutoUpdate = false;

    // Per-instance color buffer for blooms (stems share a single color).
    bloomMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(maxCount * 3),
      3
    );

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    let idx = 0;

    for (const cell of terrain) {
      const flowers = computeFlowerInstancesForCell(
        cell.col, cell.row, cell.hash, cell.brightness, cell.cornersY || null
      );
      for (const f of flowers) {
        // Tile units -> world units. Terrain builder places cell centers
        // at (col*2+1, 0, row*2+1). XZ are scaled by the 2-unit tile width;
        // Y comes from `cornersY` and is already in world meters, so it is
        // passed through unscaled. Geometry is pre-translated so y=0 means
        // stem root at ground.
        dummy.position.set(f.x * 2 + 1, f.y, f.z * 2 + 1);
        dummy.rotation.set(0, f.rotY, 0);
        dummy.scale.set(f.scale, f.scale, f.scale);
        dummy.updateMatrix();
        stemMesh.setMatrixAt(idx, dummy.matrix);
        bloomMesh.setMatrixAt(idx, dummy.matrix);
        color.setHex(f.colorHex);
        bloomMesh.setColorAt(idx, color);
        idx++;
      }
    }

    stemMesh.count = idx;
    bloomMesh.count = idx;
    stemMesh.instanceMatrix.needsUpdate = true;
    bloomMesh.instanceMatrix.needsUpdate = true;
    if (bloomMesh.instanceColor) bloomMesh.instanceColor.needsUpdate = true;

    this._parent.add(stemMesh);
    this._parent.add(bloomMesh);
    this._stemMesh = stemMesh;
    this._bloomMesh = bloomMesh;
  }

  dispose() {
    this._disposeMeshes();
    this._parent = null;
  }

  _disposeMeshes() {
    for (const m of [this._stemMesh, this._bloomMesh]) {
      if (!m) continue;
      if (this._parent) this._parent.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
    this._stemMesh = null;
    this._bloomMesh = null;
  }
}
