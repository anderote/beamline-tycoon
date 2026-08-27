// Builds a bounded far-LOD mesh from the largest primitives in an authored
// model. THREE is provided as a global by the renderer entry point.

const DEFAULT_MIN_PARTS = 1;
const DEFAULT_MAX_PARTS = 5;
const DEFAULT_MIN_PRIMITIVES = 18;
const DEFAULT_COVERAGE_TARGET = 0.76;
const VOLUME_WEIGHT = 0.72;
const SILHOUETTE_WEIGHT = 1 - VOLUME_WEIGHT;
const CHARACTERISTIC_COLOR_ROLES = new Set([
  'accent', 'copper', 'glow', 'coldWater', 'hotWater',
]);

function footprintBudgets(footprintArea, minParts, maxParts, maxPrimitives) {
  const span = Math.sqrt(Math.max(0, footprintArea));
  return {
    minGroups: minParts ?? DEFAULT_MIN_PARTS,
    maxGroups: maxParts ?? Math.min(8, DEFAULT_MAX_PARTS + Math.floor(span / 3)),
    maxPrimitives: maxPrimitives
      ?? Math.min(36, Math.max(DEFAULT_MIN_PRIMITIVES, 12 + Math.round(span * 3))),
  };
}

function footprintCoverageTarget(footprintArea, configuredTarget) {
  if (Number.isFinite(configuredTarget)) {
    return Math.max(0, Math.min(1, configuredTarget));
  }
  // A large facility-scale machine earns a little more descriptive geometry.
  // The logarithm keeps that increase bounded instead of making a 10 m plant
  // effectively render its full near model.
  return Math.min(0.9,
    DEFAULT_COVERAGE_TARGET + Math.log2(1 + Math.max(0, footprintArea)) * 0.015);
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
  const geometricVolume = size.x * size.y * size.z;
  if (!Number.isFinite(geometricVolume)) return null;
  return { part, index, apparentArea, geometricVolume, size };
}

/**
 * Select the largest authored primitives for a facility-scale model.
 *
 * Logical groups are ranked by the fraction of authored bounding-box volume
 * and projected silhouette area they explain. We then keep the smallest set
 * that reaches a footprint-scaled cumulative coverage target. A model whose
 * form is one dominant vessel can therefore keep one group, while a machine
 * whose form is distributed across several magnets, tanks, or ribs retains
 * those groups together. Repeated/rotated copies remain one logical group.
 */
export function selectLargestAuthoredPartGroups(parts, {
  footprintArea = 1,
  minParts = undefined,
  maxParts = undefined,
  maxPrimitives = undefined,
  coverageTarget = undefined,
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
  const rawGroups = [...grouped.values()].map(group => ({
    ...group,
    geometricVolume: group.metrics.reduce((sum, metric) => sum + metric.geometricVolume, 0),
    apparentArea: group.metrics.reduce((sum, metric) => sum + metric.apparentArea, 0),
    importance: Math.max(...group.parts.map(part => Math.max(0, part.importance ?? 1))),
    bounds: group.metrics.reduce((box, metric) => box.union(metric.part.geometry.boundingBox),
      new THREE.Box3()),
  }));
  const totalVolume = rawGroups.reduce((sum, group) => sum + group.geometricVolume, 0) || 1;
  const totalArea = rawGroups.reduce((sum, group) => sum + group.apparentArea, 0) || 1;
  const scored = rawGroups.map(group => ({
    ...group,
    selectionScore: (
      VOLUME_WEIGHT * (group.geometricVolume / totalVolume)
      + SILHOUETTE_WEIGHT * (group.apparentArea / totalArea)
    ) * group.importance,
  }));
  const totalScore = scored.reduce((sum, group) => sum + group.selectionScore, 0) || 1;
  const ranked = scored.map(group => ({
    ...group,
    coverageShare: group.selectionScore / totalScore,
  })).sort((a, b) => b.selectionScore - a.selectionScore || a.index - b.index);

  const targetCoverage = footprintCoverageTarget(footprintArea, coverageTarget);
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
  let covered = selected.reduce((sum, group) => sum + group.coverageShare, 0);
  for (const group of ranked) {
    if (selected.length >= required && covered >= targetCoverage) break;
    if (trySelect(group)) covered += group.coverageShare;
  }
  for (const group of ranked) {
    if (selected.length >= required) break;
    if (trySelect(group, true)) covered += group.coverageShare;
  }

  // Cumulative volume can miss a thin top cap, exhaust, side tank, or long
  // beam pipe whose small mass materially changes the outline. Grow the bounds
  // of the selected set toward the full authored bounds, but only with groups
  // that carry a non-trivial share of the model and fit the same hard budgets.
  const selectedBounds = new THREE.Box3();
  for (const group of selected) selectedBounds.union(group.bounds);
  const fullBounds = rawGroups.reduce((box, group) => box.union(group.bounds), new THREE.Box3());
  const fullSize = fullBounds.getSize(new THREE.Vector3());
  const outlinePool = ranked.filter(group => !selected.includes(group)
    && group.coverageShare >= 0.002);
  while (outlinePool.length > 0 && selected.length < maximum) {
    const candidates = outlinePool.map(group => ({
      group,
      extension: (
        Math.max(0, selectedBounds.min.x - group.bounds.min.x) / Math.max(0.001, fullSize.x)
        + Math.max(0, group.bounds.max.x - selectedBounds.max.x) / Math.max(0.001, fullSize.x)
        + Math.max(0, selectedBounds.min.y - group.bounds.min.y) / Math.max(0.001, fullSize.y)
        + Math.max(0, group.bounds.max.y - selectedBounds.max.y) / Math.max(0.001, fullSize.y)
        + Math.max(0, selectedBounds.min.z - group.bounds.min.z) / Math.max(0.001, fullSize.z)
        + Math.max(0, group.bounds.max.z - selectedBounds.max.z) / Math.max(0.001, fullSize.z)
      ),
    })).sort((a, b) => b.extension - a.extension
      || b.group.selectionScore - a.group.selectionScore);
    const best = candidates[0];
    if (!best || best.extension < 0.02) break;
    outlinePool.splice(outlinePool.indexOf(best.group), 1);
    if (trySelect(best.group)) selectedBounds.union(best.group.bounds);
  }

  // A modest but characteristic painted/copper/screen assembly can be more
  // identifying than the fifth neutral plate. Preserve one such group when
  // it is materially large, replacing only a duplicated-role selection.
  const roleOf = group => group.parts[0]?.role || 'body';
  for (const role of CHARACTERISTIC_COLOR_ROLES) {
    if (selected.some(group => roleOf(group) === role)) continue;
    const candidate = ranked.find(group => roleOf(group) === role);
    if (!candidate || candidate.coverageShare < 0.002) continue;
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

function partMaterials(part) {
  const source = part.materials ?? part.material;
  if (Array.isArray(source)) return source;
  return source ? [source] : [];
}

function fallbackPartColor(part) {
  return part.color?.isColor
    ? part.color
    : new THREE.Color(part.color ?? 0x778899);
}

/**
 * Bake the same colour inputs used by the near mesh into the far geometry.
 *
 * A Mesh can carry more than one material through BufferGeometry groups, and
 * an authored geometry can additionally carry per-vertex colours. Flattening
 * either case to `material[0]` (or to one average colour) makes a multicolour
 * object visibly repaint itself at the LOD boundary. The far batches use one
 * white vertex-colour material, so resolve those inputs per vertex here.
 */
function appendPartColors(target, part, geometry) {
  const position = geometry.attributes.position;
  const sourceColors = geometry.attributes.color;
  const materials = partMaterials(part);
  const fallback = fallbackPartColor(part);
  const materialByVertex = new Int32Array(position.count);
  materialByVertex.fill(-1);
  for (const group of geometry.groups || []) {
    const end = Math.min(position.count, group.start + group.count);
    for (let index = Math.max(0, group.start); index < end; index++) {
      materialByVertex[index] = group.materialIndex ?? 0;
    }
  }

  for (let index = 0; index < position.count; index++) {
    const materialIndex = materialByVertex[index] >= 0 ? materialByVertex[index] : 0;
    const material = materials[materialIndex] || materials[0] || null;
    const base = material?.color?.isColor ? material.color : fallback;
    let r = base.r;
    let g = base.g;
    let b = base.b;
    // This is exactly how Three combines Mesh material tint and geometry
    // vertex colours. Respect vertexColors=false so dormant colour attributes
    // do not unexpectedly alter the far presentation.
    if (sourceColors && (!material || material.vertexColors === true)) {
      r *= sourceColors.getX(index);
      g *= sourceColors.getY(index);
      b *= sourceColors.getZ(index);
    }
    target.push(r, g, b);
  }
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
    for (const value of position.array) positions.push(value);
    for (const value of normal.array) normals.push(value);
    appendPartColors(colors, part, geometry);
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
