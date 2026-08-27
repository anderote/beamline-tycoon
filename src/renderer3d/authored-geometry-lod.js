// Builds a bounded far-LOD mesh from the largest primitives in an authored
// model. THREE is provided as a global by the renderer entry point.

const DEFAULT_MIN_PARTS = 3;
const DEFAULT_MAX_PARTS = 5;
const DEFAULT_FOOTPRINT_AREA_RATIO = 0.025;
const DEFAULT_LARGEST_PART_RATIO = 0.08;
const DEFAULT_MIN_PRIMITIVES = 18;
const CHARACTERISTIC_COLOR_ROLES = new Set([
  'accent', 'copper', 'glow', 'coldWater', 'hotWater',
]);

function footprintBudgets(footprintArea, minParts, maxParts, maxPrimitives) {
  const span = Math.sqrt(Math.max(0, footprintArea));
  return {
    minGroups: minParts ?? Math.min(5, DEFAULT_MIN_PARTS + Math.floor(span / 3)),
    maxGroups: maxParts ?? Math.min(8, DEFAULT_MAX_PARTS + Math.floor(span / 3)),
    maxPrimitives: maxPrimitives
      ?? Math.min(36, Math.max(DEFAULT_MIN_PRIMITIVES, 12 + Math.round(span * 3))),
  };
}

function quantizedDimension(value) {
  return Math.round(Math.max(0, value) * 1000) / 1000;
}

function partGroupKey(metric) {
  if (metric.part.groupKey != null) return String(metric.part.groupKey);
  const geometry = metric.part.geometry;
  const dimensions = [metric.size.x, metric.size.y, metric.size.z]
    .map(quantizedDimension)
    .sort((a, b) => a - b)
    .join('x');
  const positions = geometry.attributes?.position?.count || 0;
  const indices = geometry.index?.count || 0;
  // Role keeps differently coloured/materialed assemblies separate. Sorted
  // dimensions make rotated copies of one authored primitive share a group,
  // so a symmetric magnet, rib bank, or twin pump is retained as a unit.
  return `${metric.part.role || 'body'}|${positions}|${indices}|${dimensions}`;
}

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
 * at least three logical groups when available, scaling to eight for the
 * largest footprints while retaining a separate primitive ceiling.
 */
export function selectLargestAuthoredPartGroups(parts, {
  footprintArea = 1,
  minParts = undefined,
  maxParts = undefined,
  maxPrimitives = undefined,
  footprintAreaRatio = DEFAULT_FOOTPRINT_AREA_RATIO,
  largestPartRatio = DEFAULT_LARGEST_PART_RATIO,
  requiredGroupKeys = [],
} = {}) {
  const metrics = (parts || [])
    .map(partMetrics)
    .filter(Boolean);
  if (metrics.length === 0) return [];

  const grouped = new Map();
  for (const metric of metrics) {
    const key = partGroupKey(metric);
    let group = grouped.get(key);
    if (!group) {
      group = { key, parts: [], metrics: [], index: metric.index };
      grouped.set(key, group);
    }
    group.parts.push(metric.part);
    group.metrics.push(metric);
  }
  const ranked = [...grouped.values()].map(group => {
    const largest = Math.max(...group.metrics.map(metric => metric.selectionScore));
    // Repetition is visual evidence of an authored assembly, but grows
    // sub-linearly so rows of bolts cannot outrank a machine's main vessel.
    const repetition = 1 + Math.log2(group.parts.length) * 0.55;
    return { ...group, selectionScore: largest * repetition };
  }).sort((a, b) => b.selectionScore - a.selectionScore || a.index - b.index);

  const floor = Math.max(0, footprintArea) * footprintAreaRatio;
  const relative = ranked[0].selectionScore * largestPartRatio;
  const cutoff = Math.max(floor, relative);
  const budgets = footprintBudgets(footprintArea, minParts, maxParts, maxPrimitives);
  const maximum = Math.min(Math.max(0, budgets.maxGroups), ranked.length);
  const required = Math.min(Math.max(0, budgets.minGroups), maximum);
  const selected = [];
  let primitiveCount = 0;
  const trySelect = (group, requiredGroup = false) => {
    if (!group || selected.includes(group) || selected.length >= maximum) return false;
    if (!requiredGroup && primitiveCount > 0
        && primitiveCount + group.parts.length > budgets.maxPrimitives) return false;
    selected.push(group);
    primitiveCount += group.parts.length;
    return true;
  };
  // Some repeated primitives form one defining authored assembly even when
  // their individual projected areas are modest (a magnet's four poles, for
  // example). Builders may name those assemblies and require them here. This
  // still copies the original primitives; it does not introduce proxy shapes.
  for (const key of requiredGroupKeys) {
    trySelect(ranked.find(group => group.key === key), true);
  }
  for (const group of ranked) {
    if (group.selectionScore < cutoff) continue;
    trySelect(group);
  }
  for (const group of ranked) {
    if (selected.length >= required) break;
    trySelect(group, true);
  }

  // A modest but characteristic painted/copper/screen assembly can be more
  // identifying than the fifth neutral plate. Preserve one such group when
  // it is materially large, replacing only a duplicated-role selection.
  const roleOf = group => group.parts[0]?.role || 'body';
  for (const role of CHARACTERISTIC_COLOR_ROLES) {
    if (selected.some(group => roleOf(group) === role)) continue;
    const candidate = ranked.find(group => roleOf(group) === role);
    if (!candidate || candidate.selectionScore < cutoff * 0.75) continue;
    if (selected.length < maximum && trySelect(candidate)) continue;
    const roleTallies = new Map();
    for (const group of selected) {
      roleTallies.set(roleOf(group), (roleTallies.get(roleOf(group)) || 0) + 1);
    }
    const victim = selected
      .filter(group => (roleTallies.get(roleOf(group)) || 0) > 1)
      .sort((a, b) => a.selectionScore - b.selectionScore || b.index - a.index)[0];
    if (!victim || candidate.selectionScore < victim.selectionScore * 0.25) continue;
    const nextPrimitiveCount = primitiveCount - victim.parts.length + candidate.parts.length;
    if (nextPrimitiveCount > budgets.maxPrimitives) continue;
    selected[selected.indexOf(victim)] = candidate;
    primitiveCount = nextPrimitiveCount;
  }
  return selected;
}

/** Return the original primitives in the selected logical assemblies. */
export function selectLargestAuthoredParts(parts, options = {}) {
  return selectLargestAuthoredPartGroups(parts, options)
    .flatMap(group => group.parts);
}

/**
 * Merge selected authored primitives into one vertex-coloured BufferGeometry.
 * Input geometries are not disposed; ownership remains with the caller.
 */
export function buildAuthoredGeometryLod(parts, options = {}) {
  const selectedGroups = Array.isArray(options.preselectedGroupKeys)
    ? options.preselectedGroupKeys.map(key => ({
        key,
        parts: parts.filter(part => part.groupKey === key),
      })).filter(group => group.parts.length > 0)
    : selectLargestAuthoredPartGroups(parts, options);
  const selected = selectedGroups.flatMap(group => group.parts);
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
  geometry.userData.farPartCount = selectedGroups.length;
  geometry.userData.farPrimitiveCount = roles.length;
  geometry.userData.farSourcePartCount = options.sourcePartCount ?? parts.length;
  geometry.userData.farSelectedPartNames = names;
  geometry.userData.farSelectedGroupNames = selectedGroups.map(group => group.key);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
