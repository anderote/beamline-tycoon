// test/test-utility-placement-endpoints.js — components carried on beam pipes
// are utility endpoints.
//
// Beamline modules with role 'placement' (cavities, quadrupoles, BPMs,
// cryomodules) live in pipe.placements, not state.placeables. The utility
// system indexed state.placeables only, so their declared sink ports were
// invisible everywhere: discovery never saw them, validateDrawLine rejected
// them as endpoints, and the port hit-test could not hover them. Since every
// cryoTransfer sink in the game is a 'placement', the cryo plant had nothing
// to serve and the quench path was unreachable; accelerating structures always
// got infraQuality 1.0 because no placement id could enter nodeQualities.
//
//   1. listUtilityEndpoints includes pipe placements, positioned so their
//      ports resolve to world coordinates.
//   2. discoverNetworks resolves a placement port into a real sink.
//   3. validateDrawLine accepts a placement as a line endpoint.
//   4. Every cryoTransfer/rfWaveguide sink type is reachable (they are all
//      'placement' modules).
//   5. End-to-end on the shipped scenario: wiring an RF source to a cavity's
//      rf_in puts the placement into state.nodeQualities.
//   6. Removing a placement detaches the lines that were wired to it.

import { COMPONENTS } from '../src/data/components.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';
import {
  listUtilityEndpoints,
  makeUtilityEndpointIndex,
  findUtilityEndpoint,
} from '../src/utility/utility-endpoints.js';
import { discoverNetworks, makeDefaultPortLookup } from '../src/utility/network-discovery.js';
import { validateDrawLine } from '../src/utility/line-drawing.js';
import { portWorldPosition } from '../src/utility/ports.js';

globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS:', msg); }
  else { failed++; console.log('  FAIL:', msg); }
}

// A straight west→east pipe carrying one buncher (pwr_in / rf_in / vac_in),
// plus a magnetron placeable to feed it.
function makeState() {
  return {
    placeables: [
      { id: 'in_1', type: 'magnetron', kind: 'infrastructure', category: 'infrastructure',
        col: 0, row: 4, subCol: 0, subRow: 0, dir: 0 },
    ],
    beamPipes: [
      { id: 'bp_1', subL: 40, path: [{ col: 0, row: 0 }, { col: 10, row: 0 }],
        placements: [{ id: 'pl_1', type: 'buncher', position: 0.2, subL: 4, params: {} }] },
    ],
    utilityLines: new Map(),
  };
}

console.log('\n--- 1. Pipe placements are utility endpoints ---');
{
  const state = makeState();
  const endpoints = listUtilityEndpoints(state);
  assert(endpoints.length === 2, `placeables + placements listed (got ${endpoints.length})`);

  const pl = findUtilityEndpoint(state, 'pl_1');
  assert(pl && pl.type === 'buncher', 'the placement resolves by id');
  assert(pl && pl.isPlacement && pl.pipeId === 'bp_1', 'it carries its pipe id');

  const wp = portWorldPosition(pl, COMPONENTS.buncher, 'rf_in');
  assert(wp && Number.isFinite(wp.x) && Number.isFinite(wp.z),
    `its rf_in port has a world position (got ${JSON.stringify(wp)})`);
  // The record is centered on the pipe sample point, so the port sits within
  // half a footprint of it.
  assert(wp && Math.abs(wp.x - pl.col * 2) <= 4,
    'the port sits on the placement, not a footprint away from it');

  assert(makeUtilityEndpointIndex(state).get('pl_1') != null, 'the index contains it too');
  assert(findUtilityEndpoint(state, 'nope') === null, 'unknown ids still resolve to null');
}

console.log('\n--- 2. Discovery resolves placement ports into sinks ---');
{
  const state = makeState();
  state.utilityLines.set('ul_1', {
    id: 'ul_1', utilityType: 'rfWaveguide',
    start: { placeableId: 'in_1', portName: 'rf_out' },
    end: { placeableId: 'pl_1', portName: 'rf_in' },
    path: [{ col: 0, row: 4 }, { col: 2, row: 0 }],
  });
  const nets = discoverNetworks('rfWaveguide', state.utilityLines, makeDefaultPortLookup(state));
  assert(nets.length === 1, `one rfWaveguide network (got ${nets.length})`);
  const net = nets[0];
  assert(net.sources.length === 1, `the magnetron is a source (got ${net.sources.length})`);
  assert(net.sinks.length === 1 && net.sinks[0].placeableId === 'pl_1',
    `the placement is a sink (got ${JSON.stringify(net.sinks.map(s => s.portKey))})`);
  assert(net.sinks[0].demand > 0, 'the sink carries its declared demand');
}

console.log('\n--- 3. validateDrawLine accepts a placement endpoint ---');
{
  const state = makeState();
  // rf_in is on the buncher's 'right' side; with the pipe running west→east
  // the placement's dir is 1, so the port faces south — approach from +row.
  const pl = findUtilityEndpoint(state, 'pl_1');
  const wp = portWorldPosition(pl, COMPONENTS.buncher, 'rf_in');
  const tile = { col: wp.x / 2, row: wp.z / 2 };
  const res = validateDrawLine(state, {
    utilityType: 'rfWaveguide',
    start: null,
    end: { placeableId: 'pl_1', portName: 'rf_in' },
    path: [{ col: tile.col, row: tile.row + 2 }, tile],
  });
  assert(res.ok, `a line can terminate on a placement port (got ${res.reason || 'ok'})`);

  const bad = validateDrawLine(state, {
    utilityType: 'rfWaveguide',
    start: null,
    end: { placeableId: 'pl_1', portName: 'not_a_port' },
    path: [{ col: tile.col, row: tile.row + 2 }, tile],
  });
  assert(!bad.ok, 'an undeclared port on a placement is still rejected');
}

console.log('\n--- 4. Every cryo/RF sink type is reachable ---');
{
  // All four cryoTransfer sinks are role 'placement'; if placements were not
  // endpoints, the cryo plant could be built but would serve nothing.
  const sinkTypes = { cryoTransfer: [], rfWaveguide: [] };
  for (const [id, def] of Object.entries(COMPONENTS)) {
    for (const spec of Object.values(def.ports || {})) {
      if (spec.role === 'sink' && sinkTypes[spec.utility]) sinkTypes[spec.utility].push(id);
    }
  }
  for (const [utility, ids] of Object.entries(sinkTypes)) {
    assert(ids.length > 0, `${utility} has sink components (${ids.length})`);
    const placementOnly = ids.filter(id => COMPONENTS[id].role === 'placement');
    // The state below carries one of each on a pipe; all must be discoverable.
    const state = {
      placeables: [],
      beamPipes: [{
        id: 'bp_1', subL: 4 * placementOnly.length + 4,
        path: [{ col: 0, row: 0 }, { col: 40, row: 0 }],
        placements: placementOnly.map((type, i) => ({
          id: `pl_${i + 1}`, type, position: i / (placementOnly.length + 1), subL: 4, params: {},
        })),
      }],
      utilityLines: new Map(),
    };
    const index = makeUtilityEndpointIndex(state);
    const missing = placementOnly.filter((_, i) => !index.has(`pl_${i + 1}`));
    assert(missing.length === 0,
      `all ${placementOnly.length} role:'placement' ${utility} sinks are endpoints`);
  }
}

console.log('\n--- 5. Scenario end-to-end: quality reaches a placement ---');
{
  const { Game } = await import('../src/game/Game.js');
  const { BeamlineRegistry } = await import('../src/beamline/BeamlineRegistry.js');
  const { SCENARIOS } = await import('../src/data/scenarios.js');
  const { wireUtility } = await import('../src/data/scenarios/scenario-wiring.js');

  const realWarn = console.warn, realLog = console.log;
  console.warn = () => {};
  console.log = () => {};
  let cavityId = null, qualities = null;
  try {
    const scenario = SCENARIOS.find(s => s.id === 'smallBeamlineFacility');
    const game = new Game(new BeamlineRegistry(), { seed: 5 });
    game.state.resources.funding = 1e9;
    game.applyScenario(scenario.generator());
    scenario.setup(game);
    game.recalcAllBeamlines();

    const cavity = listUtilityEndpoints(game.state)
      .find(e => e.isPlacement && COMPONENTS[e.type]?.ports?.rf_in);
    cavityId = cavity && cavity.id;

    let srcId = null;
    for (let d = 2; d < 8 && !srcId; d++) {
      srcId = game.placePlaceable({
        type: 'magnetron', col: Math.round(cavity.col) + d, row: Math.round(cavity.row) + 3,
      });
    }
    wireUtility(game, 'rfWaveguide', { id: srcId, port: 'rf_out' }, { id: cavityId, port: 'rf_in' });
    for (let i = 0; i < 3; i++) game.tick();
    qualities = game.state.nodeQualities || {};
  } finally {
    console.warn = realWarn;
    console.log = realLog;
  }

  assert(cavityId != null, `found an RF-consuming placement on the shipped pipe (${cavityId})`);
  assert(qualities && qualities[cavityId] != null,
    `the wired placement appears in nodeQualities (keys: ${Object.keys(qualities || {}).join(', ')})`);
  assert(qualities?.[cavityId]?.rfQuality !== undefined,
    'it carries an rfQuality, which physics reads as infraQuality');
}

console.log('\n--- 6. Removing a placement detaches its lines ---');
{
  const { Game } = await import('../src/game/Game.js');
  const { BeamlineRegistry } = await import('../src/beamline/BeamlineRegistry.js');
  const g = new Game(new BeamlineRegistry(), { seed: 8 });
  g.state.resources.funding = 1e9;
  g.state.beamPipes.push({
    id: 'bp_x', subL: 40, path: [{ col: 0, row: 0 }, { col: 10, row: 0 }],
    placements: [{ id: 'pl_x', type: 'buncher', position: 0.2, subL: 4, params: {} }],
  });
  g.state.utilityLines.set('ul_x', {
    id: 'ul_x', utilityType: 'rfWaveguide',
    start: { placeableId: 'pl_x', portName: 'rf_in' }, end: null,
    path: [{ col: 2, row: 2 }, { col: 2, row: 0 }],
  });
  g.removeAttachment('bp_x', 'pl_x');
  assert(g.state.utilityLines.get('ul_x').start === null,
    'removing a placement nulls the endpoint that referenced it');
  assert(!g.serialize().includes('pl_x'),
    'no dangling placement reference survives into the save');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
