// src/renderer3d/wall-batcher.js
// Collapses the per-piece wall meshes WallBuilder authors into a handful of
// THREE.BatchedMesh draw calls — the same trick floor-builder.js plays for
// floor tiles, and the same one decoration-builder.js already plays for trees
// and shrubs (see _buildPlantBatches).
//
// Why BatchedMesh rather than one merged BufferGeometry per material:
//
//   * Per-instance frustum culling and, for transparent materials, per-instance
//     BACK-TO-FRONT SORTING are done by BatchedMesh.onBeforeRender. A plain
//     merge would fix triangle order at build time, which visibly changes how
//     ghosted walls (the default 'transparent' wall view) blend where they
//     overlap. Within one batch the draw order is exactly what N separate
//     meshes would have produced.
//   * A raycast against a BatchedMesh reports `batchId`, so per-wall identity
//     survives batching if it is ever needed.
//
// Per-face paint: a painted wall is a BoxGeometry carrying a six-entry
// material array so the two rooms either side can differ (see WallBuilder's
// faceMaterial). A BatchedMesh draws one material, so such a mesh is split
// along its geometry groups — one sub-geometry per distinct material, each
// landing in that material's own bucket. The face-to-material assignment is
// preserved exactly; only the packaging changes.
//
// THREE is a CDN global — do NOT import it.

/**
 * True when the ambient THREE actually implements BatchedMesh.
 *
 * The builder-level unit tests stub THREE with a Proxy that answers every
 * unknown property with a generic class, so `typeof THREE.BatchedMesh ===
 * 'function'` is not enough to tell a real three.js from a stub. Probing the
 * prototype for a method the stub cannot fake is. Those harnesses then keep
 * the historical one-mesh-per-piece scene graph they assert against.
 */
export function canBatchWalls() {
  return typeof THREE !== 'undefined'
    && typeof THREE.BatchedMesh === 'function'
    && typeof THREE.BatchedMesh.prototype?.addGeometry === 'function'
    && typeof THREE.BufferGeometry === 'function';
}

/**
 * Index subset of `geo` covering only `groups`, sharing the source's vertex
 * attributes. Sharing is safe because BatchedMesh copies attribute data into
 * its own buffers at addGeometry time; the subset is discarded right after.
 *
 * The reserved vertex count therefore stays the full box (24 verts) for a
 * two-triangle face. That waste is bounded and tiny — a painted wall costs
 * three 24-vertex reservations instead of one — and it keeps this helper from
 * having to renumber indices.
 *
 * @param {THREE.BufferGeometry} geo
 * @param {Array<{start:number,count:number}>} groups
 * @returns {THREE.BufferGeometry}
 */
function indexSubset(geo, groups) {
  const index = geo.getIndex();
  let total = 0;
  for (const g of groups) total += g.count;
  const IndexArray = index.array.constructor;
  const out = new IndexArray(total);
  let o = 0;
  for (const g of groups) {
    for (let i = 0; i < g.count; i++) out[o++] = index.getX(g.start + i);
  }
  const sub = new THREE.BufferGeometry();
  for (const name of Object.keys(geo.attributes)) {
    sub.setAttribute(name, geo.attributes[name]);
  }
  sub.setIndex(new THREE.BufferAttribute(out, 1));
  sub.computeBoundingBox();
  sub.computeBoundingSphere();
  return sub;
}

/**
 * Accumulates authored wall meshes and emits one BatchedMesh per
 * (material, castShadow, receiveShadow, renderOrder) signature.
 *
 * Usage mirrors the mesh path it replaces:
 *   batcher.add(mesh);           // instead of parentGroup.add(mesh)
 *   batcher.flush(parentGroup);  // once, at the end of the build
 */
export class WallBatcher {
  constructor() {
    /** signature -> { material, castShadow, receiveShadow, renderOrder, entries } */
    this._buckets = new Map();
    /** Sub-geometries this batcher allocated and must dispose after flush. */
    this._scratch = [];
  }

  /**
   * Queue an authored wall piece. The mesh must already have its local matrix
   * composed (every WallBuilder emit site sets matrixAutoUpdate = false and
   * calls updateMatrix()), because that matrix becomes the batch instance
   * transform verbatim.
   * @param {THREE.Mesh} mesh
   */
  add(mesh) {
    const geo = mesh.geometry;
    if (!geo || !geo.attributes?.position || !geo.getIndex?.()) return false;

    if (Array.isArray(mesh.material)) {
      // Group the box's six face groups by the material each one resolves to,
      // so a wall painted the same colour on both faces still costs one entry
      // in that paint's bucket rather than two.
      const byMaterial = new Map();
      const groups = geo.groups?.length ? geo.groups : null;
      if (!groups) return false;
      for (const group of groups) {
        const mat = mesh.material[group.materialIndex];
        if (!mat) continue;
        let list = byMaterial.get(mat);
        if (!list) { list = []; byMaterial.set(mat, list); }
        list.push(group);
      }
      if (byMaterial.size === 0) return false;
      for (const [mat, faceGroups] of byMaterial) {
        const sub = indexSubset(geo, faceGroups);
        this._scratch.push(sub);
        this._push(mesh, mat, sub);
      }
      return true;
    }

    if (!mesh.material) return false;
    this._push(mesh, mesh.material, geo);
    return true;
  }

  _push(mesh, material, geometry) {
    const castShadow = mesh.castShadow === true;
    const receiveShadow = mesh.receiveShadow === true;
    const renderOrder = mesh.renderOrder || 0;
    const signature = `${material.id}|${castShadow ? 1 : 0}|${receiveShadow ? 1 : 0}|${renderOrder}`;
    let bucket = this._buckets.get(signature);
    if (!bucket) {
      bucket = { material, castShadow, receiveShadow, renderOrder, entries: [] };
      this._buckets.set(signature, bucket);
    }
    bucket.entries.push({ geometry, matrix: mesh.matrix });
  }

  /**
   * Build the batches and parent them. Returns the created meshes so the
   * caller can track them for teardown.
   * @param {THREE.Group|{add:Function}} parentGroup
   * @returns {THREE.BatchedMesh[]}
   */
  flush(parentGroup) {
    const batches = [];
    for (const bucket of this._buckets.values()) {
      const { entries, material } = bucket;
      if (entries.length === 0) continue;

      let maxVertices = 0;
      let maxIndices = 0;
      for (const entry of entries) {
        maxVertices += entry.geometry.attributes.position.count;
        maxIndices += entry.geometry.getIndex().count;
      }

      const batch = new THREE.BatchedMesh(
        entries.length, maxVertices, Math.max(maxIndices, maxVertices), material,
      );
      batch.name = 'batched-walls';
      batch.castShadow = bucket.castShadow;
      batch.receiveShadow = bucket.receiveShadow;
      batch.renderOrder = bucket.renderOrder;
      batch.userData.wallBatch = true;
      batch.matrixAutoUpdate = false;
      batch.updateMatrix();

      // Draw-range bookkeeping runs once per render() call per batch, so it is
      // only worth paying for where it changes the picture:
      //
      //   * sortObjects — a transparent material blends in draw order, so its
      //     instances must be re-sorted back-to-front every pass, exactly as
      //     the renderer would have sorted the individual meshes. Opaque
      //     batches are depth-tested and need no sort.
      //   * perObjectFrustumCulled — left OFF. The shadow map renders before
      //     onBeforeRender runs for the view camera, so it would reuse ranges
      //     culled against the CAMERA frustum and drop shadows cast by walls
      //     off screen. Walls are ~13% of the scene's triangles; submitting
      //     all of them in one call is cheaper than being clever.
      batch.sortObjects = material.transparent === true;
      batch.perObjectFrustumCulled = false;

      for (const entry of entries) {
        const geometryId = batch.addGeometry(entry.geometry);
        const instanceId = batch.addInstance(geometryId);
        batch.setMatrixAt(instanceId, entry.matrix);
      }
      batch.computeBoundingBox();
      batch.computeBoundingSphere();

      // MUST happen before any draw range is computed — see the helper.
      freezeIndexElementSize(batch.geometry);

      // Prime the multi-draw ranges. The shadow map renders before any
      // onBeforeRender runs for the view camera, so without this the walls
      // cast no shadow for the first frame after every rebuild.
      primeDrawRanges(batch);

      parentGroup.add(batch);
      batches.push(batch);
    }

    for (const geometry of this._scratch) geometry.dispose();
    this._scratch = [];
    this._buckets.clear();
    return batches;
  }
}

/**
 * Widen a batch's index buffer to Uint32 so its element size can never change
 * after draw ranges have been computed from it.
 *
 * BatchedMesh sizes its own index buffer at Uint16 whenever the batch holds
 * 65535 vertices or fewer (BatchedMesh._initializeGeometry), and
 * onBeforeRender turns each geometry's element-space range into a BYTE offset
 * with `index.array.BYTES_PER_ELEMENT`. Meanwhile three's WebGPU backend
 * rewrites every non-normalized Uint16 attribute to Uint32 the first time it
 * uploads it — `WebGPUAttributeUtils.createAttribute` assigns
 * `bufferAttribute.array = new Uint32Array( array )`, mutating the geometry
 * the batch is still reading from.
 *
 * So the element size silently doubles between the first range computation
 * and every draw that follows it. A batch that recomputes its ranges every
 * frame (transparent walls, which sort) corrects itself on the next frame and
 * looks fine; an opaque batch computes ranges exactly once and then draws
 * forever from byte offsets that are half what they should be — each instance
 * renders some other wall's triangles under its own matrix, which is what
 * "walls at the wrong height and orientation" looked like in the 'up' view.
 *
 * Promoting the index up front costs one extra copy of an index buffer the
 * backend was going to widen anyway, and makes the range arithmetic stable.
 * The 0xffff primitive-restart remap three does during its own conversion is
 * not needed here: an index buffer only stays Uint16 when the batch has at
 * most 65535 vertices, so 0xffff is never a valid vertex index in it.
 *
 * @param {THREE.BufferGeometry} geometry
 */
function freezeIndexElementSize(geometry) {
  const index = geometry?.getIndex?.();
  if (!index || !index.array || index.array.BYTES_PER_ELEMENT >= 4) return;
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(index.array), 1));
}

/**
 * Run BatchedMesh.onBeforeRender once with a stand-in camera so the batch has
 * valid draw ranges before its first real render. Frustum culling is off, so
 * the stand-in only has to satisfy the sort path's reads of `matrixWorld`;
 * the resulting order is arbitrary and is replaced on the first real render.
 */
function primeDrawRanges(batch) {
  try {
    const camera = { isArrayCamera: false, matrixWorld: new THREE.Matrix4() };
    batch.onBeforeRender(null, null, camera, batch.geometry, batch.material);
  } catch {
    // A three.js build that reads more of the camera than expected just means
    // one frame of late shadows; never let it break the build.
  }
}
