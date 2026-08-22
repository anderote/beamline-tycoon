// Pure presentation topology for utility-line fabrication nodes.
//
// Simulation connectivity remains owned by network-discovery.js. This module
// answers the narrower fabrication question the renderer needs: when lines
// meet or diverge, is the visible fitting a coupling, elbow, tee, or four-way
// cross? Keeping that classification free of THREE makes the saved tap and
// shared-header contracts testable at their utility boundary.

const EPS = 1e-7;

function endpoint(line, which) {
  const path = line?.path || [];
  if (path.length === 0) return null;
  return which === 'start' ? path[0] : path[path.length - 1];
}

function directionKey(dx, dz) {
  if (Math.abs(dx) < EPS && Math.abs(dz) < EPS) return null;
  if (Math.abs(dx) >= Math.abs(dz)) return `${dx < 0 ? -1 : 1},0`;
  return `0,${dz < 0 ? -1 : 1}`;
}

function pointOnSegment(point, a, b) {
  const dx = b.col - a.col;
  const dz = b.row - a.row;
  const px = point.col - a.col;
  const pz = point.row - a.row;
  if (Math.abs(dx * pz - dz * px) > EPS) return false;
  const dot = px * dx + pz * dz;
  return dot >= -EPS && dot <= dx * dx + dz * dz + EPS;
}

function hostDirections(line, point) {
  const directions = new Set();
  const path = line?.path || [];
  let matchedVertex = false;
  for (let index = 0; index < path.length; index++) {
    const at = path[index];
    if (Math.abs(at.col - point.col) > EPS || Math.abs(at.row - point.row) > EPS) continue;
    matchedVertex = true;
    for (const neighbor of [path[index - 1], path[index + 1]]) {
      if (!neighbor) continue;
      const direction = directionKey(neighbor.col - at.col, neighbor.row - at.row);
      if (direction) directions.add(direction);
    }
  }
  if (matchedVertex) return directions;

  for (let index = 0; index < path.length - 1; index++) {
    const a = path[index];
    const b = path[index + 1];
    if (!pointOnSegment(point, a, b)) continue;
    const forward = directionKey(b.col - a.col, b.row - a.row);
    const backward = directionKey(a.col - b.col, a.row - b.row);
    if (forward) directions.add(forward);
    if (backward) directions.add(backward);
  }
  return directions;
}

function pointKey(point) {
  return `${Math.round(point.col * 10000)},${Math.round(point.row * 10000)}`;
}

function junctionKind(directions) {
  const degree = directions.length;
  if (degree >= 4) return degree === 4 ? 'cross' : 'manifold';
  if (degree === 3) return 'tee';
  if (degree !== 2) return 'coupling';
  const [ax, az] = directions[0].split(',').map(Number);
  const [bx, bz] = directions[1].split(',').map(Number);
  return ax * bx + az * bz < -0.9 ? 'coupling' : 'elbow';
}

/**
 * Classify branch taps and assign one deterministic rendering owner. Explicit
 * tapLineIds are authoritative; callers may also opt specific utility types
 * into legacy contact inference so old saves receive the same fittings as new
 * lines without rewriting their topology records.
 *
 * @returns {Map<string, {start?: object, end?: object, junctions?: object[]}>}
 *          line id -> endpoint joins plus every fabrication node it crosses.
 */
export function utilityLineJunctions(lines, { joinsOnContactTypes = new Set() } = {}) {
  const records = lines && typeof lines.values === 'function'
    ? Array.from(lines.values()) : Array.from(lines || []);
  const byId = new Map(records.filter(Boolean).map(line => [line.id, line]));
  const clusters = new Map();

  function clusterFor(utilityType, point) {
    const key = `${utilityType}|${pointKey(point)}`;
    if (!clusters.has(key)) {
      clusters.set(key, {
        utilityType,
        point: { col: point.col, row: point.row },
        explicitTargetIds: new Set(),
        endpoints: new Map(),
      });
    }
    return clusters.get(key);
  }

  for (const line of records) {
    if (!line?.id) continue;
    for (const which of ['start', 'end']) {
      const targetId = line.tapLineIds?.[which];
      const target = targetId ? byId.get(targetId) : null;
      const point = target ? endpoint(line, which) : null;
      if (!point || target.utilityType !== line.utilityType) continue;
      const cluster = clusterFor(line.utilityType, point);
      cluster.explicitTargetIds.add(targetId);
      cluster.endpoints.set(`${line.id}:${which}`, { line, which });
    }
  }

  // Vacuum lines authored before tapLineIds still join on physical contact in
  // network discovery. Suppress their old bright open-end sphere and fabricate
  // the same tee/cross a newly drawn equivalent receives.
  for (const line of records) {
    if (!line?.id || !joinsOnContactTypes.has(line.utilityType)) continue;
    for (const which of ['start', 'end']) {
      if (line[which] || line.tapLineIds?.[which]) continue;
      const point = endpoint(line, which);
      if (!point) continue;
      const touches = records.some(other => other?.id !== line.id
        && other.utilityType === line.utilityType
        && hostDirections(other, point).size > 0);
      if (!touches) continue;
      clusterFor(line.utilityType, point).endpoints
        .set(`${line.id}:${which}`, { line, which });
    }
  }

  // Shared headers are often authored as overlapping source-to-sink runs. At
  // the waypoint where one run peels away, no endpoint exists and therefore
  // no tapLineIds can name the fitting. The union of local arms is still
  // unambiguous: three directions are a tee, four are a cross. Promote those
  // divergence/intersection nodes into fabrication clusters so the renderer
  // does not leave an ordinary sweep elbow tangent to the header.
  for (const line of records) {
    if (!line?.id || !joinsOnContactTypes.has(line.utilityType)) continue;
    for (const point of (line.path || [])) {
      const incident = records.filter(other => other?.utilityType === line.utilityType
        && hostDirections(other, point).size > 0);
      if (incident.length < 2) continue;
      const directions = new Set();
      for (const other of incident) {
        for (const direction of hostDirections(other, point)) directions.add(direction);
      }
      if (directions.size < 3) continue;
      clusterFor(line.utilityType, point);
    }
  }

  const result = new Map();
  for (const cluster of clusters.values()) {
    const incident = records.filter(line => line?.utilityType === cluster.utilityType
      && hostDirections(line, cluster.point).size > 0);
    const directions = new Set();
    for (const line of incident) {
      for (const direction of hostDirections(line, cluster.point)) directions.add(direction);
    }
    const sortedDirections = [...directions].sort();
    const endpointEntries = [...cluster.endpoints.values()];
    const ownerLineId = incident.map(line => line.id).sort()[0];
    const degree = sortedDirections.length;
    if (degree < 2) continue;
    const kind = junctionKind(sortedDirections);
    const targetLineId = [...cluster.explicitTargetIds].sort()[0]
      || incident.map(line => line.id).filter(id => id !== ownerLineId).sort()[0] || null;
    const base = {
      utilityType: cluster.utilityType,
      targetLineId,
      point: cluster.point,
      directions: sortedDirections,
      degree,
      kind,
      ownerLineId,
      signature: `${targetLineId || '-'}:${pointKey(cluster.point)}:`
        + `${kind}:${sortedDirections.join(';')}:${ownerLineId}`,
    };
    for (const line of incident) {
      if (!result.has(line.id)) result.set(line.id, {});
      const entry = result.get(line.id);
      if (!Array.isArray(entry.junctions)) entry.junctions = [];
      entry.junctions.push({
        ...base,
        renderHardware: line.id === ownerLineId,
      });
    }
    for (const entry of endpointEntries) {
      if (!result.has(entry.line.id)) result.set(entry.line.id, {});
      result.get(entry.line.id)[entry.which] = {
        ...base,
        renderHardware: entry.line.id === ownerLineId,
      };
    }
  }
  return result;
}
