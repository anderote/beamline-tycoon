export const MAP_EXTENT = 35;
export const GRID_SIZE = 71;
export function buildObservation(game) {
  const s = game.state ?? game;
  const N = GRID_SIZE, E = MAP_EXTENT;
  const mk = () => Array.from({ length: N }, () => Array(N).fill(0));
  const floorsGrid = mk();
  const zoneGrid = mk();
  const wallMask = mk();
  const infra = s.infraOccupied ?? {};
  for (const k of Object.keys(infra)) {
    const [cs, rs] = k.split(',');
    const x = Number(cs) + E, y = Number(rs) + E;
    if (x >= 0 && x < N && y >= 0 && y < N) floorsGrid[y][x] = infra[k];
  }
  const zones = s.zoneOccupied ?? {};
  for (const k of Object.keys(zones)) {
    const [cs, rs] = k.split(',');
    const x = Number(cs) + E, y = Number(rs) + E;
    if (x >= 0 && x < N && y >= 0 && y < N) zoneGrid[y][x] = zones[k];
  }
  const walls = s.wallOccupied ?? {};
  for (const k of Object.keys(walls)) {
    const p = k.split(',');
    const x = Number(p[0]) + E, y = Number(p[1]) + E;
    if (x >= 0 && x < N && y >= 0 && y < N) wallMask[y][x] = 1;
  }
  const placeables = (s.placeables ?? []).map(p => ({
    id: p.id, type: p.type, col: p.col, row: p.row,
    subCol: p.subCol ?? 0, subRow: p.subRow ?? 0, dir: p.dir ?? 0, kind: p.kind ?? p.category ?? null
  }));
  const beamPipes = (s.beamPipes ?? []).map(b => ({
    id: b.id, path: (b.path ?? []).map(pt => ({ col: pt.col, row: pt.row })),
    start: b.start ?? null, end: b.end ?? null
  }));
  let faults = [];
  if (Array.isArray(s.infraBlockers) && s.infraBlockers.length) {
    faults = s.infraBlockers.map(f => ({
      reason: f.reason ?? f.message ?? f.code ?? String(f),
      code: f.code ?? null, location: f.location ?? null
    }));
  } else if (Array.isArray(s.log) && s.log.length) {
    const bad = s.log.filter(e => e.type === 'bad').slice(0, 8);
    faults = bad.map(e => ({ reason: e.msg, tick: e.tick }));
    if (!faults.length && s.tick % 30 === 0 && s.tick > 0) faults = [{ reason: 'tick_fault_check', tick: s.tick }];
  } else if (s.tick % 30 === 0 && s.tick > 0) {
    faults = [{ reason: 'tick_fault_check', tick: s.tick }];
  }
  const staff = (s.staffMembers ?? []).map(m => ({
    id: m.id, role: m.role, mood: m.mood ?? null, status: m.status ?? null,
    fatigue: m.needs?.fatigue ?? 0, morale: m.needs?.morale ?? 0
  }));
  return {
    tick: s.tick ?? 0,
    resources: { ...(s.resources ?? { funding: 0, reputation: 0, data: 0 }) },
    floorsGrid, zoneGrid, wallMask, placeables, beamPipes, faults, staff,
    researchUnlocked: [...(s.completedResearch ?? [])]
  };
}
