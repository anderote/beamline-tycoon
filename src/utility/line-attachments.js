// Geometry shared by input, simulation endpoint discovery, and rendering for
// instruments mounted directly on a drawn utility run. Utility-line path
// coordinates are tile units at world x/z = col/row * 2 (unlike beam pipes,
// whose path coordinates identify tile centres and therefore add one metre).

const EPS = 1e-9;

// Supported vacuum-pipe centreline height. Kept here as a tiny cycle-free
// presentation constant so utility-endpoints can describe a line-mounted
// gauge without importing the solver registry through COMPONENTS ->
// validation -> registry -> solver -> endpoint lookup. The vacuum descriptor
// imports this same value for `runHeightMeters`, keeping mounted gauges and
// their supporting line on one physical axis.
export const VACUUM_LINE_MOUNT_Y = 0.24;

function pathMetrics(line) {
  const path = line?.path || [];
  const cumulative = [0];
  for (let i = 1; i < path.length; i++) {
    cumulative.push(cumulative[i - 1] + Math.hypot(
      path[i].col - path[i - 1].col,
      path[i].row - path[i - 1].row,
    ));
  }
  return { path, cumulative, total: cumulative[cumulative.length - 1] || 0 };
}

function directionFor(a, b) {
  return Math.abs(b.col - a.col) >= Math.abs(b.row - a.row) ? 1 : 0;
}

/** Project a tile-coordinate point onto a utility polyline. */
export function projectOntoUtilityLine(line, col, row) {
  const { path, cumulative, total } = pathMetrics(line);
  if (path.length === 0) return null;
  if (path.length === 1 || total < EPS) {
    const p = path[0];
    return {
      position: 0.5, col: p.col, row: p.row,
      worldX: p.col * 2, worldZ: p.row * 2,
      dir: 0, distance: Math.hypot(col - p.col, row - p.row),
      distanceAlong: 0, totalLength: total,
    };
  }

  let best = null;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const dc = b.col - a.col, dr = b.row - a.row;
    const len2 = dc * dc + dr * dr;
    if (len2 < EPS) continue;
    const t = Math.max(0, Math.min(1, ((col - a.col) * dc + (row - a.row) * dr) / len2));
    const pc = a.col + dc * t, pr = a.row + dr * t;
    const distance = Math.hypot(col - pc, row - pr);
    if (!best || distance < best.distance) {
      const distanceAlong = cumulative[i] + Math.sqrt(len2) * t;
      best = {
        position: distanceAlong / total,
        col: pc, row: pr, worldX: pc * 2, worldZ: pr * 2,
        dir: directionFor(a, b), distance, distanceAlong, totalLength: total,
      };
    }
  }
  return best;
}

/** Resolve a stored normalized attachment position back to its line pose. */
export function utilityAttachmentPose(line, attachmentOrPosition) {
  const { path, cumulative, total } = pathMetrics(line);
  if (path.length === 0) return null;
  if (path.length === 1 || total < EPS) {
    const p = path[0];
    return { col: p.col, row: p.row, worldX: p.col * 2, worldZ: p.row * 2, dir: 0 };
  }
  const raw = typeof attachmentOrPosition === 'number'
    ? attachmentOrPosition : attachmentOrPosition?.position;
  const position = Math.max(0, Math.min(1, Number.isFinite(raw) ? raw : 0.5));
  const target = position * total;
  for (let i = 0; i < path.length - 1; i++) {
    if (target > cumulative[i + 1] + EPS) continue;
    const a = path[i], b = path[i + 1];
    const len = cumulative[i + 1] - cumulative[i];
    const t = len > EPS ? (target - cumulative[i]) / len : 0;
    const col = a.col + (b.col - a.col) * t;
    const row = a.row + (b.row - a.row) * t;
    return { col, row, worldX: col * 2, worldZ: row * 2, dir: directionFor(a, b) };
  }
  const last = path[path.length - 1], prev = path[path.length - 2];
  return {
    col: last.col, row: last.row, worldX: last.col * 2, worldZ: last.row * 2,
    dir: directionFor(prev, last),
  };
}
