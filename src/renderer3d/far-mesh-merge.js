// Shared packaging for geometry-derived far LODs. Each catalogue type keeps
// its own selected authored silhouette, then compatible world transforms are
// baked into one ordinary Mesh allocation. This avoids first-use admission
// for dozens of separate GPU buffers without relying on BatchedMesh's special
// multi-draw/indirect path, which can wedge Chrome during a large cold upload.
// THREE is a CDN global — do NOT import it.

/** Stable attribute-layout key used to keep merged inputs compatible. */
export function farGeometryLayoutKey(geometry) {
  const attributes = Object.entries(geometry?.attributes || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, attribute]) => [
      name,
      attribute.itemSize,
      attribute.normalized ? 1 : 0,
      attribute.array?.constructor?.name || '',
    ].join(':'))
    .join('|');
  return `${attributes}|indexed:${geometry?.getIndex?.() ? 1 : 0}`;
}

/** Compact unique colour inventory for diagnostics and catalogue tests. */
export function farGeometryColorTriples(geometry) {
  const color = geometry?.getAttribute?.('color');
  if (!color) return [];
  const unique = new Map();
  for (let index = 0; index < color.count; index++) {
    const triple = [color.getX(index), color.getY(index), color.getZ(index)];
    const key = triple.map(value => value.toFixed(6)).join('|');
    if (!unique.has(key)) unique.set(key, triple);
  }
  return [...unique.values()];
}

/** Map a raycast hit back to the source instance baked into a merged mesh. */
export function mergedFarInstanceIndex(hit) {
  const direct = hit?.batchId ?? hit?.instanceId;
  if (Number.isInteger(direct)) return direct;
  const faceIndex = hit?.faceIndex;
  if (!Number.isInteger(faceIndex)) return null;
  const ranges = hit?.object?.userData?.farTriangleRanges || [];
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const range = ranges[middle];
    if (faceIndex < range.start) high = middle - 1;
    else if (faceIndex >= range.end) low = middle + 1;
    else return range.instanceIndex;
  }
  return null;
}

/**
 * Bake compatible source geometries and transforms into one ordinary mesh.
 * Source geometries remain owned by the caller.
 *
 * @param {Array<{geometry: THREE.BufferGeometry, matrix: THREE.Matrix4}>} entries
 * @param {THREE.Material} material
 * @returns {{mesh: THREE.Mesh, instanceIds: number[]}}
 */
export function createFarMergedMesh(entries, material) {
  if (!entries.length) return null;
  const transformed = entries.map(entry => {
    const geometry = entry.geometry.clone();
    geometry.applyMatrix4(entry.matrix);
    return geometry;
  });
  const attributeNames = Object.keys(transformed[0].attributes);
  const vertexCounts = transformed.map(geometry => geometry.getAttribute('position').count);
  const totalVertices = vertexCounts.reduce((sum, count) => sum + count, 0);
  const merged = new THREE.BufferGeometry();

  for (const name of attributeNames) {
    const sample = transformed[0].getAttribute(name);
    const totalValues = transformed.reduce(
      (sum, geometry) => sum + geometry.getAttribute(name).array.length, 0);
    const values = new sample.array.constructor(totalValues);
    let offset = 0;
    for (const geometry of transformed) {
      const source = geometry.getAttribute(name).array;
      values.set(source, offset);
      offset += source.length;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(
      values, sample.itemSize, sample.normalized,
    ));
  }

  const indexed = !!transformed[0].getIndex();
  if (indexed) {
    const totalIndices = transformed.reduce(
      (sum, geometry) => sum + geometry.getIndex().count, 0);
    const IndexArray = totalVertices > 65535 ? Uint32Array : Uint16Array;
    const indices = new IndexArray(totalIndices);
    let indexOffset = 0;
    let vertexOffset = 0;
    for (let geometryIndex = 0; geometryIndex < transformed.length; geometryIndex++) {
      const index = transformed[geometryIndex].getIndex();
      for (let i = 0; i < index.count; i++) {
        indices[indexOffset++] = index.getX(i) + vertexOffset;
      }
      vertexOffset += vertexCounts[geometryIndex];
    }
    merged.setIndex(new THREE.BufferAttribute(indices, 1));
  }

  const triangleRanges = [];
  let triangleStart = 0;
  for (let instanceIndex = 0; instanceIndex < transformed.length; instanceIndex++) {
    const geometry = transformed[instanceIndex];
    const triangleCount = (geometry.getIndex()?.count
      || geometry.getAttribute('position').count) / 3;
    triangleRanges.push({
      start: triangleStart,
      end: triangleStart + triangleCount,
      instanceIndex,
    });
    triangleStart += triangleCount;
  }
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  for (const geometry of transformed) geometry.dispose?.();

  const mesh = new THREE.Mesh(merged, material);
  mesh.userData.farTriangleRanges = triangleRanges;
  return { mesh, instanceIds: entries.map((_, index) => index) };
}
