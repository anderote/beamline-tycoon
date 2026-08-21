import { Box3, Matrix4, Vector3 } from 'three/webgpu';

const EPSILON_VOLUME = 1e-7;
const EDGE_WELD_SCALE = 1e5;
const DEFAULT_DENSITY = 500;
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _cross = new Vector3();
const _centroid = new Vector3();
const _relative = new Matrix4();
const _rootInverse = new Matrix4();

export const MATERIAL_DENSITIES_KG_M3 = Object.freeze({
  staff: 985,
  furnishing: 180,
  decoration: 350,
  equipment: 780,
  beamline: 1200,
  steel: 7850,
  aluminum: 2700,
  concrete: 2400,
  wood: 650,
  plastic: 950,
});

export function densityForKind(kind) {
  return MATERIAL_DENSITIES_KG_M3[kind] || DEFAULT_DENSITY;
}

function visibleGeometry(mesh) {
  if (!mesh?.isMesh || !mesh.geometry?.attributes?.position) return false;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return !materials.length || materials.some((material) => material?.visible !== false);
}

/**
 * Visit the triangles of one shell. `range` is a {start, count} window into
 * the geometry's index (or, unindexed, into its vertices); omit it for the
 * whole geometry.
 */
function triangleIndices(geometry, visit, range = null) {
  const position = geometry.attributes.position;
  const index = geometry.index;
  if (index) {
    const start = range ? range.start : 0;
    const end = Math.min(index.count, range ? range.start + range.count : index.count);
    for (let i = start; i + 2 < end; i += 3) {
      visit(index.getX(i), index.getX(i + 1), index.getX(i + 2), position);
    }
  } else {
    const start = range ? range.start : 0;
    const end = Math.min(position.count, range ? range.start + range.count : position.count);
    for (let i = start; i + 2 < end; i += 3) visit(i, i + 1, i + 2, position);
  }
}

/**
 * The shells inside one mesh. Normally a mesh IS one shell, but renderers that
 * bake several authored parts into a single BufferGeometry to save draw calls
 * (see equipment-builder's static-part merging) publish the index range of
 * each original part as `geometry.userData.shellRanges`. Integrating those
 * ranges separately keeps a merged prop measuring exactly like the loose parts
 * it replaced: two boxes stacked flush share an edge, so the union's edges are
 * counted four times and the whole merged mesh would otherwise fail the
 * watertightness test and collapse to its bounding box.
 */
function shellRanges(geometry) {
  const declared = geometry.userData?.shellRanges;
  if (!Array.isArray(declared) || declared.length === 0) return [null];
  return declared;
}

function weldedVertexKey(point) {
  return `${Math.round(point.x * EDGE_WELD_SCALE)},${Math.round(point.y * EDGE_WELD_SCALE)},${Math.round(point.z * EDGE_WELD_SCALE)}`;
}

function countEdge(edges, a, b) {
  if (a === b) return;
  const key = a < b ? `${a}|${b}` : `${b}|${a}`;
  edges.set(key, (edges.get(key) || 0) + 1);
}

/**
 * Measure a rendered Object3D as a collection of uniformly-dense closed mesh
 * shells. Each mesh is integrated independently so oppositely wound parts do
 * not cancel one another. Open/degenerate art falls back to its local AABB.
 *
 * `massKg` means “this object weighs this much”; density is then derived from
 * the measured volume. Without it, mass is derived from the requested density.
 */
export function geometryMassProperties(root, options = {}) {
  if (!root) throw new TypeError('geometryMassProperties requires an Object3D root');
  root.updateWorldMatrix?.(true, true);
  _rootInverse.copy(root.matrixWorld).invert();

  const bounds = new Box3().makeEmpty();
  const weightedCentroid = new Vector3();
  let volume = 0;
  let meshCount = 0;
  let triangleCount = 0;
  let closedMeshCount = 0;
  let fallbackMeshCount = 0;
  let usedBoundsFallback = false;

  root.traverse((mesh) => {
    if (!visibleGeometry(mesh)) return;
    meshCount++;
    _relative.multiplyMatrices(_rootInverse, mesh.matrixWorld);
    for (const range of shellRanges(mesh.geometry)) {
      let signedVolume = 0;
      const signedCentroid = new Vector3();
      const meshBounds = new Box3().makeEmpty();
      const edges = new Map();

      triangleIndices(mesh.geometry, (ia, ib, ic, position) => {
        _a.fromBufferAttribute(position, ia).applyMatrix4(_relative);
        _b.fromBufferAttribute(position, ib).applyMatrix4(_relative);
        _c.fromBufferAttribute(position, ic).applyMatrix4(_relative);
        meshBounds.expandByPoint(_a);
        meshBounds.expandByPoint(_b);
        meshBounds.expandByPoint(_c);
        bounds.expandByPoint(_a);
        bounds.expandByPoint(_b);
        bounds.expandByPoint(_c);
        const ka = weldedVertexKey(_a);
        const kb = weldedVertexKey(_b);
        const kc = weldedVertexKey(_c);
        countEdge(edges, ka, kb);
        countEdge(edges, kb, kc);
        countEdge(edges, kc, ka);
        const tetraVolume = _a.dot(_cross.crossVectors(_b, _c)) / 6;
        signedVolume += tetraVolume;
        _centroid.copy(_a).add(_b).add(_c).multiplyScalar(tetraVolume / 4);
        signedCentroid.add(_centroid);
        triangleCount++;
      }, range);

      // A non-zero signed tetrahedron sum alone does not prove enclosure: an
      // open, off-origin triangle soup can also produce a plausible-looking
      // pseudo-volume. Welding coincident seam vertices and requiring every
      // undirected edge exactly twice distinguishes closed authored shells from
      // open/non-manifold art before its volume is trusted.
      const closed = edges.size > 0 && [...edges.values()].every((count) => count === 2);
      if (closed && Math.abs(signedVolume) > EPSILON_VOLUME) {
        const shellVolume = Math.abs(signedVolume);
        signedCentroid.multiplyScalar(1 / signedVolume);
        weightedCentroid.addScaledVector(signedCentroid, shellVolume);
        volume += shellVolume;
        closedMeshCount++;
      } else if (!meshBounds.isEmpty()) {
        usedBoundsFallback = true;
        fallbackMeshCount++;
        const meshSize = meshBounds.getSize(new Vector3());
        const fallbackVolume = meshSize.x * meshSize.y * meshSize.z;
        if (fallbackVolume > EPSILON_VOLUME) {
          weightedCentroid.addScaledVector(meshBounds.getCenter(new Vector3()), fallbackVolume);
          volume += fallbackVolume;
        }
      }
    }
  });

  if (bounds.isEmpty()) {
    bounds.min.set(-0.05, -0.05, -0.05);
    bounds.max.set(0.05, 0.05, 0.05);
  }

  const size = bounds.getSize(new Vector3());
  const boundsVolume = Math.max(EPSILON_VOLUME, size.x * size.y * size.z);
  if (!(volume > EPSILON_VOLUME)) {
    volume = boundsVolume;
    bounds.getCenter(weightedCentroid);
    usedBoundsFallback = true;
  } else {
    weightedCentroid.multiplyScalar(1 / volume);
  }

  const requestedMass = Number(options.massKg);
  const requestedDensity = Number(options.densityKgM3);
  const densityKgM3 = requestedMass > 0
    ? requestedMass / volume
    : (requestedDensity > 0 ? requestedDensity : densityForKind(options.kind));
  const massKg = requestedMass > 0 ? requestedMass : Math.max(0.05, densityKgM3 * volume);

  // A stable box approximation of the visual shell's principal inertia. The
  // exact integrated volume/COM above drives weight and torque application;
  // this conservative tensor avoids pathological inertia from decorative
  // non-manifold triangles while preserving each object's measured scale.
  const inertia = new Vector3(
    massKg * (size.y * size.y + size.z * size.z) / 12,
    massKg * (size.x * size.x + size.z * size.z) / 12,
    massKg * (size.x * size.x + size.y * size.y) / 12,
  );
  inertia.set(Math.max(inertia.x, 1e-5), Math.max(inertia.y, 1e-5), Math.max(inertia.z, 1e-5));

  return {
    volumeM3: volume,
    densityKgM3,
    massKg,
    centerOfMass: weightedCentroid.clone(),
    principalInertia: inertia,
    bounds,
    size,
    boundsVolumeM3: boundsVolume,
    meshCount,
    closedMeshCount,
    fallbackMeshCount,
    triangleCount,
    usedBoundsFallback,
  };
}
