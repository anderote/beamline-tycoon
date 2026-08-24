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
import { contentKey } from './content-hash.js';

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
 * Cache key over the builder's actual input: `snapshot.terrain` is the only
 * section flowers spawn from (per-cell col/row/hash/brightness/cornersY all
 * feed instance generation). Exported so tests can prove change detection
 * without a Three.js context.
 * @param {{terrain?: Array<object>}} snapshot
 * @returns {string}
 */
export function computeWildflowerCacheKey(snapshot) {
  return contentKey(snapshot?.terrain ?? []);
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
    this._stemMeshes = [];
    this._bloomMeshes = [];
    this._stemGeometry = null;
    this._bloomGeometry = null;
    this._stemMaterial = null;
    this._bloomMaterial = null;
    this._cacheKey = null;
  }

  /**
   * Attach the builder to a parent Group/Scene. Meshes are created on the
   * first call to `rebuild()`.
   */
  add(parent) {
    this._parent = parent;
  }

  _ensureResources() {
    if (this._stemGeometry) return;
    const stemH = 0.12;
    const stemR = 0.012;
    const bloomR = 0.05;
    this._stemGeometry = new THREE.CylinderGeometry(stemR, stemR, stemH, 4);
    this._stemGeometry.translate(0, stemH / 2, 0);
    this._stemMaterial = new THREE.MeshStandardMaterial({
      color: STEM_COLOR, roughness: 0.85,
    });
    this._bloomGeometry = new THREE.SphereGeometry(bloomR, 6, 4);
    this._bloomGeometry.scale(1, 0.55, 1);
    this._bloomGeometry.translate(0, stemH + bloomR * 0.3, 0);
    this._bloomMaterial = new THREE.MeshStandardMaterial({ roughness: 0.55 });
  }

  /**
   * Rebuild the InstancedMeshes from the current terrain snapshot.
   * No-op when the terrain content is unchanged (content-hash cache), so
   * callers may invoke this unconditionally — e.g. on zone/decoration
   * events that leave the terrain alone — without paying the ~15k-instance
   * rebuild. Disposes previous meshes when a rebuild does happen.
   */
  rebuild(snapshot) {
    if (!this._parent) return;
    if (typeof THREE === 'undefined') return; // test/headless safety
    const newKey = computeWildflowerCacheKey(snapshot);
    if (newKey === this._cacheKey) return;
    this._disposeMeshes();
    this._cacheKey = newKey;
    const terrain = snapshot?.terrain ?? [];
    if (terrain.length === 0) return;

    this._ensureResources();

    // Upper bound: at most 3 flowers per cell.
    const maxCount = terrain.length * 3;
    const stemMesh = new THREE.InstancedMesh(
      this._stemGeometry, this._stemMaterial, maxCount);
    const bloomMesh = new THREE.InstancedMesh(
      this._bloomGeometry, this._bloomMaterial, maxCount);
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
    this._stemMeshes.push(stemMesh);
    this._bloomMeshes.push(bloomMesh);
  }

  /** Add an ownership ring without reallocating flowers on existing land. */
  appendTerrain(terrain, snapshot) {
    if (!this._parent || typeof THREE === 'undefined') return;
    if (this._cacheKey == null) {
      this.rebuild(snapshot);
      return;
    }
    if (terrain?.length) {
      const retainedStems = this._stemMeshes;
      const retainedBlooms = this._bloomMeshes;
      this._stemMeshes = [];
      this._bloomMeshes = [];
      this._stemMesh = null;
      this._bloomMesh = null;
      this._cacheKey = null;
      this.rebuild({ terrain });
      this._stemMeshes = [...retainedStems, ...this._stemMeshes];
      this._bloomMeshes = [...retainedBlooms, ...this._bloomMeshes];
    }
    this._cacheKey = computeWildflowerCacheKey(snapshot);
  }

  dispose() {
    this._disposeMeshes();
    for (const resource of [
      this._stemGeometry, this._bloomGeometry,
      this._stemMaterial, this._bloomMaterial,
    ]) resource?.dispose?.();
    this._stemGeometry = null;
    this._bloomGeometry = null;
    this._stemMaterial = null;
    this._bloomMaterial = null;
    this._parent = null;
    this._cacheKey = null;
  }

  _disposeMeshes() {
    const meshes = new Set([
      ...this._stemMeshes, ...this._bloomMeshes,
      this._stemMesh, this._bloomMesh,
    ]);
    for (const m of meshes) {
      if (!m) continue;
      if (this._parent) this._parent.remove(m);
      if (m.geometry !== this._stemGeometry && m.geometry !== this._bloomGeometry) {
        m.geometry.dispose();
      }
      if (m.material !== this._stemMaterial && m.material !== this._bloomMaterial) {
        m.material.dispose();
      }
      // instanceMatrix/instanceColor live on the mesh, not the geometry —
      // only InstancedMesh.dispose() frees their GPU buffers.
      if (typeof m.dispose === 'function') m.dispose();
    }
    this._stemMesh = null;
    this._bloomMesh = null;
    this._stemMeshes = [];
    this._bloomMeshes = [];
  }
}
