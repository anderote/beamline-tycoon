// src/renderer3d/beam-visual-path.js
//
// Turn flattened beamline order into the routed polyline the visual travels.
// The simulation already tells us which pipe is traversed next; preserving its
// stored waypoint order makes the packets visibly take every real bend.

export function beamVisualPath(flattened = [], beamPipes = []) {
  const pipesById = new Map((beamPipes || []).map(pipe => [pipe.id, pipe]));
  const points = [];
  const seen = new Set();
  let lastModuleId = null;

  const append = (pt) => {
    if (!pt) return;
    const prev = points[points.length - 1];
    if (prev && prev.col === pt.col && prev.row === pt.row) return;
    points.push({ col: pt.col, row: pt.row });
  };

  for (const element of flattened) {
    if (element.kind === 'module') {
      lastModuleId = element.id;
      continue;
    }
    const pipeId = element.pipeId;
    if (!pipeId || seen.has(pipeId)) continue;
    const pipe = pipesById.get(pipeId);
    if (!pipe?.path?.length) continue;
    seen.add(pipeId);
    const forward = pipe.start?.junctionId === lastModuleId
      || pipe.end?.junctionId !== lastModuleId;
    const path = forward ? pipe.path : pipe.path.slice().reverse();
    for (const point of path) append(point);
  }
  return points;
}
