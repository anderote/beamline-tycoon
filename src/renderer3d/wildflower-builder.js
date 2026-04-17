// src/renderer3d/wildflower-builder.js
// Renders an ambient scatter of flower dot-decals across grass cells as a
// single InstancedMesh. Per-cell count, position jitter, color, scale, and
// rotation all derive from the cell's existing hash so rebuilds are
// deterministic. THREE is a CDN global — do NOT import it.
//
// The pure helper `computeFlowerInstancesForCell` has NO Three.js
// dependencies so it can be unit-tested under plain Node. The Three.js
// class below is only instantiated in the browser by `ThreeRenderer`;
// its dependency on the procedural-decals module is resolved lazily via
// a guarded dynamic import so this file can still be imported in a
// headless test runner.

/** Meadow palette — yellow repeated (indices 0/2/5) to bias toward yellow. */
const FLOWER_PALETTE = [
  0xffe14d, 0xf2f2f2, 0xffe14d, 0xff8fa3,
  0xc58df5, 0xffe14d, 0xe84a4a, 0x7db9ff,
];

// Lazy-loaded shared texture module. Only imported in a browser-like
// environment so that plain Node imports (for unit-testing the pure helper
// below) don't pull in THREE-dependent code. The dynamic import runs at
// module-load time in the browser thanks to top-level `await`.
let _procDecalTextures = null;
if (typeof document !== 'undefined' && typeof THREE !== 'undefined') {
  try {
    const mod = await import('./materials/decals.js');
    _procDecalTextures = mod.PROC_DECAL_TEXTURES;
  } catch (err) {
    // If the decals module fails to load for any reason, the class rebuild
    // will no-op rather than crash the whole renderer. Log so a broken
    // import doesn't silently disable the wildflower layer.
    console.warn('[wildflower-builder] failed to load decals.js:', err);
  }
}

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
 * @returns {Array<{x:number,y:number,z:number,scale:number,rotY:number,colorHex:number}>}
 */
export function computeFlowerInstancesForCell(col, row, hash, brightness) {
  // Meadow-clump density: flowers only appear where terrain brightness
  // exceeds ~0.25 (the peaks of bright terrain blobs). Below threshold =
  // zero flowers, so flowers cluster in discrete meadows instead of
  // scattering uniformly across every grass cell.
  const density = clamp((brightness - 0.25) * 2.0, 0, 0.9);
  const hash01 = (hash & 0xFFFF) / 0xFFFF;
  const n = Math.floor(hash01 * density * 3);

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

    instances.push({
      x: col + offX,
      y: 0,
      z: row + offZ,
      scale,
      rotY,
      colorHex: FLOWER_PALETTE[colorIdx],
    });
  }
  return instances;
}

/**
 * Renders the wildflower layer as a single InstancedMesh. Mirrors the
 * lifecycle shape of other renderer builders: `add(parent)` attaches to a
 * Three.js Group/Scene, `rebuild(snapshot)` rebuilds from a world snapshot,
 * `dispose()` removes from the parent and disposes owned geometry/material.
 *
 * The shared radial-dot texture is a module-level singleton
 * (`PROC_DECAL_TEXTURES.flower_dot`) and is NOT disposed here.
 */
export class WildflowerBuilder {
  constructor() {
    this._parent = null;
    this._mesh = null;
  }

  /**
   * Attach the builder to a parent Group/Scene. The mesh itself is created
   * on the first call to `rebuild()`.
   */
  add(parent) {
    this._parent = parent;
  }

  /**
   * Rebuild the InstancedMesh from the current terrain snapshot.
   * Disposes the previous mesh if one exists.
   */
  rebuild(snapshot) {
    this._disposeMesh();
    if (!this._parent) return;
    if (!_procDecalTextures) return; // decals module unavailable (e.g. in tests)
    const terrain = snapshot?.terrain ?? [];
    if (terrain.length === 0) return;

    const geo = new THREE.PlaneGeometry(0.2, 0.2);
    geo.rotateX(-Math.PI / 2); // lie flat on XZ plane

    const mat = new THREE.MeshBasicMaterial({
      map: _procDecalTextures.flower_dot,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
    });

    // Upper bound: at most 3 flowers per cell (floor(density*3)).
    const maxCount = terrain.length * 3;
    const mesh = new THREE.InstancedMesh(geo, mat, maxCount);
    mesh.matrixAutoUpdate = false;

    // Three.js doesn't auto-create the per-instance color buffer; allocate
    // it up-front so setColorAt works from instance 0.
    mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(maxCount * 3),
      3
    );

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    let idx = 0;

    for (const cell of terrain) {
      const flowers = computeFlowerInstancesForCell(
        cell.col, cell.row, cell.hash, cell.brightness
      );
      for (const f of flowers) {
        // Tile units -> world units. Terrain builder places cell centers
        // at (col*2+1, 0, row*2+1); flowers sit at +0.01 y to avoid
        // z-fighting with the grass plane.
        dummy.position.set(f.x * 2 + 1, 0.01, f.z * 2 + 1);
        dummy.rotation.set(0, f.rotY, 0);
        dummy.scale.set(f.scale, f.scale, f.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(idx, dummy.matrix);
        color.setHex(f.colorHex);
        mesh.setColorAt(idx, color);
        idx++;
      }
    }

    mesh.count = idx;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    this._parent.add(mesh);
    this._mesh = mesh;
  }

  /**
   * Remove the mesh from the parent and dispose its geometry and material.
   * Does NOT dispose the shared `flower_dot` texture — that's a
   * module-level singleton.
   */
  dispose() {
    this._disposeMesh();
    this._parent = null;
  }

  _disposeMesh() {
    if (!this._mesh) return;
    if (this._parent) this._parent.remove(this._mesh);
    this._mesh.geometry.dispose();
    this._mesh.material.dispose();
    this._mesh = null;
  }
}
