// Reproducible opening measurement and static research/stock-design audit.
// Native mode uses the production Python physics via Game's public engine seam.
// This is a fixed-layout observation, not a synthetic full-career player.
import './balance-env.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { preparePhysicsRequest } from '../src/beamline/physics.js';
import { evaluate, checkBands } from './eval-design.mjs';
import { computeBeamlineRevenueBreakdown } from '../src/game/economy.js';
import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { SCENARIOS } from '../src/data/scenarios.js';
import { launchScenario } from '../src/game/scenario-launch.js';
import { RESEARCH } from '../src/data/research.js';
import { COMPONENTS } from '../src/data/components.js';
import { STOCK_DESIGNS } from '../src/data/stock-designs.js';
import { getResearchSpeedMultiplier } from '../src/game/research.js';

const native = process.argv.includes('--native');
const hireScientist = process.argv.includes('--hire-scientist');
const ticks = Number(process.argv.find(a => a.startsWith('--ticks='))?.split('=')[1] || 600);
assert(Number.isInteger(ticks) && ticks >= 100);
const failures = [];
const engine = native ? {
  isReady: () => true,
  computeAsync: async (payload, effects) => {
    try {
      const request = preparePhysicsRequest(payload, effects);
      // Keep world ids for the cavity writeback; normalization is only a cache key.
      request.payload.forEach((element, index) => { element.id = request.ids[index]; });
      return JSON.parse(execFileSync('python3', ['-c',
        'import sys,json; from beam_physics.gameplay import compute_beam_for_game; p,e=json.load(sys.stdin); print(compute_beam_for_game(json.dumps(p),json.dumps(e)))'],
      { input: JSON.stringify([request.payload, request.effects]), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
    } catch (error) { failures.push(error.message); throw error; }
  },
} : undefined;
const game = new Game(new BeamlineRegistry(), { seed: 20260907, physicsEngine: engine });
assert(launchScenario(game, SCENARIOS.find(s => s.id === 'minorLab')));
const initial = {
  resources: { ...game.state.resources }, staff: { ...game.state.staff },
  placeables: game.state.placeables.length, utilityLines: game.state.utilityLines.size,
  beamlines: game.registry.getAll().map(e => ({ id: e.id, type: e.typeId })),
};
if (hireScientist) assert(game.hireStaff('scientist'), 'Scientist hire must succeed');
let firstBeamTick = null, firstDataTick = null;
const checkpoints = [];
for (let t = 1; t <= ticks; t++) {
  game.tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(failures.length, 0, 'Native physics must not silently fall back');
  for (const entry of game.registry.getAll()) {
    if (entry.status !== 'running') game.toggleBeam(entry.id);
  }
  if (firstBeamTick === null && game.state.beamOn) firstBeamTick = t;
  if (firstDataTick === null && game.state.resources.data > 0) firstDataTick = t;
  if (t % 100 === 0) {
    checkpoints.push({ tick: t, resources: { ...game.state.resources },
      economy: game.getEconomySnapshot().snapshot, data: game.state.dataSystemSnapshot,
      running: game.registry.getAll().filter(e => e.status === 'running').length,
      beams: game.registry.getAll().map(e => ({ type: e.typeId,
        energy: e.beamState.beamEnergy, current: e.beamState.beamCurrent,
        quality: e.beamState.beamQuality, alive: e.beamState.physicsAlive,
        serviceRevenue: e.beamState.serviceRevenue })),
    });
  }
}
assert.equal(failures.length, 0, 'Native physics must not silently fall back');
assert(firstBeamTick !== null, 'Opening must start before interpreting its economy');
assert(game.state.infraCanRun, 'Opening must have serviceable infrastructure');

function closure(ids, found = new Set()) {
  for (const id of ids) {
    if (!id || found.has(id)) continue;
    assert(RESEARCH[id], `Unknown research ${id}`);
    found.add(id);
    const req = RESEARCH[id].requires;
    closure(Array.isArray(req) ? req : req ? [req] : [], found);
  }
  return found;
}
function costs(ids) {
  return [...ids].reduce((out, id) => {
    const r = RESEARCH[id];
    out.funding += r.cost.funding || 0;
    out.data += r.cost.data || 0;
    out.reputation = Math.max(out.reputation, r.cost.reputation || 0);
    out.baseSeconds += r.duration;
    return out;
  }, { funding: 0, data: 0, reputation: 0, baseSeconds: 0 });
}
const visible = Object.values(RESEARCH).filter(r => !r.hidden);
const designs = STOCK_DESIGNS.map(d => {
  const requirements = d.components.flatMap(c => {
    const r = COMPONENTS[c.type]?.requires;
    return Array.isArray(r) ? r : r ? [r] : [];
  });
  const gates = closure(requirements);
  const measured = process.argv.includes('--stock-native') ? evaluate(d) : null;
  if (measured) assert(!measured.error, `${d.id}: ${measured.error}`);
  return { id: d.id, type: d.typeId,
    ...(measured ? { measured, bandCheck: checkBands(d, measured),
      idealGrossRevenue: computeBeamlineRevenueBreakdown(d.typeId, measured, d.components) } : {}),
    hardwareOnly: d.components.reduce((sum, c) => sum + (COMPONENTS[c.type]?.cost?.funding || 0), 0),
    researchNodes: gates.size, research: costs(gates) };
});
console.log(JSON.stringify({ physics: native ? 'native Python' : 'JS fallback', ticks,
  policy: `Start available beams; ${hireScientist ? 'hire one scientist initially' : 'no hiring'}; no building, research, repair or refill automation.`,
  initial, firstBeamTick, firstDataTick, checkpoints,
  objectives: game.state.completedObjectives,
  labs: game.state.zoneConnectivity,
  research: { nodes: visible.length, totals: costs(visible.map(r => r.id)),
    availableAtOpening: visible.filter(r => game.isResearchAvailable(r.id)).map(r => ({
      id: r.id, cost: r.cost, speedMultiplier: getResearchSpeedMultiplier(r.id, game.state),
    })) }, designs,
}, null, 2));
