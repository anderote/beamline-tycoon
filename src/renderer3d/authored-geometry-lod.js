// Builds a bounded far-LOD mesh from the largest primitives in an authored
// model. THREE is provided as a global by the renderer entry point.

const DEFAULT_MIN_PARTS = 3;
const DEFAULT_MAX_PARTS = 5;
const DEFAULT_FOOTPRINT_AREA_RATIO = 0.025;
const DEFAULT_LARGEST_PART_RATIO = 0.08;

function partMetrics(part, index) {
  const geometry = part?.geometry;
  const position = geometry?.attributes?.position;
  if (!position?.count) return null;
  geometry.computeBoundingBox();
  const size = new THREE.Vector3();
  geometry.boundingBox.getSize(size);
  // Sum of the three projected bounding-box faces. This is a closer proxy for
  // dimetric screen size than volume: long pipes and broad thin plates remain
  // important even though their enclosed volume is small.
  const apparentArea = size.x * size.y + size.x * size.z + size.y * size.z;
  if (!Number.isFinite(apparentArea)) return null;
  const selectionScore = apparentArea * Math.max(0, part.importance ?? 1);
  return { part, index, apparentArea, selectionScore, size };
}

/**
 * Select the largest authored primitives for a facility-scale model.
 *
 * The footprint cutoff prevents tiny bolts and fittings from consuming the
 * budget on a large machine. The relative cutoff adapts to components whose
 * authored model is intentionally much smaller than its reservation. We keep
 * at least three pieces when available and never more than five by default.
 */
export function selectLargestAuthoredParts(parts, {
  footprintArea = 1,
  minParts = DEFAULT_MIN_PARTS,
  maxParts = DEFAULT_MAX_PARTS,
  footprintAreaRatio = DEFAULT_FOOTPRINT_AREA_RATIO,
  largestPartRatio = DEFAULT_LARGEST_PART_RATIO,
} = {}) {
  const ranked = (parts || [])
    .map(partMetrics)
    .filter(Boolean)
    .sort((a, b) => b.selectionScore - a.selectionScore || a.index - b.index);
  if (ranked.length === 0) return [];

  const floor = Math.max(0, footprintArea) * footprintAreaRatio;
  const relative = ranked[0].selectionScore * largestPartRatio;
  const cutoff = Math.max(floor, relative);
  const required = Math.min(Math.max(0, minParts), ranked.length, maxParts);
  const selected = ranked.filter(metric => metric.selectionScore >= cutoff).slice(0, maxParts);
  for (let index = selected.length; index < required; index++) selected.push(ranked[index]);
  return selected.map(metric => metric.part);
}

/**
 * Merge selected authored primitives into one vertex-coloured BufferGeometry.
 * Input geometries are not disposed; ownership remains with the caller.
 */
export function buildAuthoredGeometryLod(parts, options = {}) {
  const selected = selectLargestAuthoredParts(parts, options);
  if (selected.length === 0) return null;

  const positions = [];
  const normals = [];
  const colors = [];
  const roles = [];
  const names = [];

  for (const part of selected) {
    const source = part.geometry;
    const geometry = source.index ? source.toNonIndexed() : source;
    const position = geometry.attributes?.position;
    if (!position) {
      if (geometry !== source) geometry.dispose?.();
      continue;
    }
    let normal = geometry.attributes?.normal;
    if (!normal) {
      geometry.computeVertexNormals();
      normal = geometry.attributes.normal;
    }
    const color = part.color?.isColor
      ? part.color
      : new THREE.Color(part.color ?? 0x778899);
    for (const value of position.array) positions.push(value);
    for (const value of normal.array) normals.push(value);
    for (let index = 0; index < position.count; index++) {
      colors.push(color.r, color.g, color.b);
    }
    roles.push(part.role || 'body');
    names.push(part.name || part.role || 'body');
    if (geometry !== source) geometry.dispose?.();
  }
  if (positions.length === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.userData.farSilhouetteKind = 'authored-largest-parts';
  geometry.userData.farPartRoles = [...new Set(roles)];
  geometry.userData.farPartCount = roles.length;
  geometry.userData.farSourcePartCount = options.sourcePartCount ?? parts.length;
  geometry.userData.farSelectedPartNames = names;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
