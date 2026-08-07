import { ZONES } from '../../data/facility.js';
import { FLOORS } from '../../data/structure.js';

function lastBad(game) {
  const e = (game.state.log ?? []).find(x => x.type === 'bad');
  return e ? e.msg : 'unknown';
}

export function buildRoom(game, { zone, rect }) {
  const z = ZONES[zone];
  if (!z) return { ok: false, reason: `unknown zone ${zone}` };
  const [x0, y0, x1, y1] = rect;
  const minC = Math.min(x0, x1), maxC = Math.max(x0, x1);
  const minR = Math.min(y0, y1), maxR = Math.max(y0, y1);
  const reqFloor = z.requiredFloor;
  let ok = game.placeInfraRect(minC, minR, maxC, maxR, 'concrete');
  if (!ok) return { ok: false, reason: lastBad(game) };
  ok = game.placeInfraRect(minC, minR, maxC, maxR, reqFloor);
  if (!ok) return { ok: false, reason: lastBad(game) };
  ok = game.placeZoneRect(minC, minR, maxC, maxR, zone);
  if (!ok) return { ok: false, reason: lastBad(game) };
  const placed = (maxC - minC + 1) * (maxR - minR + 1);
  return { ok: true, placed, zone, rect };
}

export function buildHallway(game, { path }) {
  if (!Array.isArray(path) || path.length === 0) return { ok: false, reason: 'empty path' };
  for (const pt of path) {
    const ok = game.placeInfraTile(pt.col, pt.row, 'hallway');
    if (!ok) return { ok: false, reason: lastBad(game), at: pt };
  }
  return { ok: true, len: path.length };
}

export function placeFurnishing(game, { type, col, row, subCol = 0, subRow = 0, dir = 0 }) {
  const id = game.placePlaceable({ type, col, row, subCol, subRow, dir });
  if (!id) return { ok: false, reason: lastBad(game) };
  return { ok: true, id };
}

export function buildBeamline(game, { source = 'source', target = 'faradayCup', path, placements = [] }) {
  for (let c = path[0].col; c <= path[path.length - 1].col; c++) {
    const d = game._decorationAtTile?.(c, path[0].row);
    if (d) game.removeDecoration(c, path[0].row, { skipRefund: true });
  }
  const srcId = game.beamline.placeJunction({ type: source, col: path[0].col, row: path[0].row, dir: 3 });
  if (!srcId) return { ok: false, reason: lastBad(game), step: 'source' };
  const farId = game.beamline.placeJunction({ type: target, col: path[path.length - 1].col, row: path[path.length - 1].row, dir: 3 });
  if (!farId) return { ok: false, reason: lastBad(game), step: 'target' };
  const pipeId = game.beamline.drawPipe({ junctionId: srcId, portName: 'exit' }, { junctionId: farId, portName: 'entry' }, path);
  if (!pipeId) return { ok: false, reason: lastBad(game), step: 'pipe' };
  const pids = [];
  for (const pl of placements) {
    const pid = game.beamline.placeOnPipe(pipeId, { type: pl.type, position: pl.position ?? pl.at ?? 0.5, mode: 'snap' });
    if (!pid) return { ok: false, reason: lastBad(game), step: `placement ${pl.type}` };
    pids.push(pid);
  }
  return { ok: true, srcId, farId, pipeId, placements: pids };
}

export function buildInfra(game, { type, path }) {
  for (const pt of path) {
    const ok = game.placeInfraTile ? game.placeInfraTile(pt.col, pt.row, type) : false;
    if (ok) continue;
    const id = game.placePlaceable({ type, col: pt.col, row: pt.row });
    if (!id) return { ok: false, reason: lastBad(game), at: pt };
  }
  return { ok: true };
}

export function hireStaff(game, idx = 0) {
  const cands = game.state.candidates;
  if (!cands || cands.length === 0) {
    const ok = game.hireStaff ? game.hireStaff({ role: 'operator' }) : false;
    return ok ? { ok: true } : { ok: false, reason: lastBad(game) };
  }
  const m = game.hireCandidate ? game.hireCandidate(idx) : null;
  if (!m) return { ok: false, reason: lastBad(game) };
  return { ok: true, id: m.id, name: m.name };
}

export function doTick(game, n = 1) {
  for (let i = 0; i < n; i++) game.tick();
  return { ok: true, tick: game.state.tick };
}

export function doResearch(game, id) {
  const ok = game.research ? game.research(id) : false;
  if (!ok) return { ok: false, reason: lastBad(game) };
  return { ok: true };
}
