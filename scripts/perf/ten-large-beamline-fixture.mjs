// Deterministic large-facility fixture shared by the performance benchmark and
// its contract test. This intentionally lives under scripts/, not src/: it is
// development instrumentation, not authored game content.

import '../balance-env.mjs';

import { BeamlineRegistry } from '../../src/beamline/BeamlineRegistry.js';
import { seedComponentParams } from '../../src/beamline/component-params.js';
import { layoutDesign } from '../../src/beamline/design-layout.js';
import { COMPONENTS } from '../../src/data/components.js';
import { BEAMLINE_TYPES } from '../../src/data/beamline-types.js';
import { PLACEABLES } from '../../src/data/placeables/index.js';
import { STOCK_DESIGNS } from '../../src/data/stock-designs.js';
import { Game } from '../../src/game/Game.js';
import { Placeable } from '../../src/game/Placeable.js';

export const TEN_LARGE_BEAMLINE_COUNT = 10;
export const TEN_LARGE_DESIGN_ID = 'blackhole-pev';

function beamPortName(type, preferredName) {
  const ports = COMPONENTS[type]?.ports || {};
  const beamPorts = Object.entries(ports).filter(([, port]) => !port?.utility);
  const preferred = beamPorts.find(([name]) => name === preferredName)
    || beamPorts.find(([name]) => name.startsWith(preferredName));
  return preferred?.[0] || beamPorts[0]?.[0] || null;
}

function moduleInstance(item, id, col, row, dir = 3) {
  const def = PLACEABLES[item.type];
  if (!def) throw new Error(`Benchmark design references unknown module ${item.type}`);
  return {
    id,
    type: item.type,
    category: 'beamline',
    kind: 'beamline',
    col,
    row,
    subCol: 0,
    subRow: 0,
    dir,
    params: seedComponentParams(item.type, item.params),
    cells: new Placeable(def).footprintCells(col, row, 0, 0, dir),
  };
}

/**
 * Build the exact topology produced by a stock design: one source junction,
 * one face-to-face pipe carrying every role-'placement' component, and one
 * endpoint junction. Copies are arranged as parallel lines so all ten can fit
 * inside one camera view in a later browser benchmark.
 */
export function buildLargeBeamlineScenario({
  count = TEN_LARGE_BEAMLINE_COUNT,
  designId = TEN_LARGE_DESIGN_ID,
} = {}) {
  const design = STOCK_DESIGNS.find(candidate => candidate.id === designId);
  if (!design) throw new Error(`Unknown benchmark stock design ${designId}`);

  const { sequence, discardedLeading, discardedTrailing } = layoutDesign(design);
  if (discardedLeading.length || discardedTrailing.length) {
    throw new Error(`${designId} has unplaceable leading/trailing hardware`);
  }
  const moduleItems = sequence.filter(item => item.kind === 'module');
  const pipeItems = sequence.filter(item => item.kind === 'pipe');
  if (moduleItems.length !== 2 || pipeItems.length !== 1) {
    throw new Error(`${designId} benchmark expects module -> pipe -> module topology`);
  }

  const [sourceItem, endpointItem] = moduleItems;
  const pipeItem = pipeItems[0];
  const sourceTrackLength = sourceItem.trackLen || Math.ceil(sourceItem.subL / 4);
  const placeables = [];
  const beamPipes = [];
  const rowSpacing = 4;
  const rowOrigin = -Math.floor(count / 2) * rowSpacing;
  const sourceCol = -Math.floor((sourceTrackLength + pipeItem.tiles) / 2);
  const endpointCol = sourceCol + sourceTrackLength + pipeItem.tiles;

  for (let copy = 0; copy < count; copy++) {
    const row = rowOrigin + copy * rowSpacing;
    const source = moduleInstance(sourceItem, `bench-source-${copy}`, sourceCol, row);
    const endpoint = moduleInstance(endpointItem, `bench-endpoint-${copy}`, endpointCol, row);
    placeables.push(source, endpoint);

    const startCol = sourceCol + sourceTrackLength - 0.5;
    const endCol = endpointCol - 0.5;
    beamPipes.push({
      id: `bench-pipe-${copy}`,
      start: {
        junctionId: source.id,
        portName: beamPortName(source.type, 'exit'),
      },
      end: {
        junctionId: endpoint.id,
        portName: beamPortName(endpoint.type, 'entry'),
      },
      // DesignPlacer stores face-to-face sparse waypoints. The renderer and
      // placement projection deliberately accept this shape directly.
      path: [{ col: startCol, row }, { col: endCol, row }],
      subL: pipeItem.subL,
      placements: pipeItem.attachments.map((attachment, index) => ({
        id: `bench-placement-${copy}-${index}`,
        type: attachment.type,
        position: attachment.position,
        subL: attachment.subL,
        params: seedComponentParams(attachment.type, attachment.params),
      })),
    });
  }

  const maxCol = Math.max(Math.abs(sourceCol), Math.abs(endpointCol)) + 4;
  const maxRow = Math.max(Math.abs(rowOrigin), Math.abs(rowOrigin + (count - 1) * rowSpacing)) + 4;

  return {
    design,
    layout: { sequence, sourceCol, endpointCol, pipeTiles: pipeItem.tiles },
    mapHalfExtent: Math.ceil(Math.max(maxCol, maxRow)),
    data: {
      floors: [], zones: [], walls: [], wallOverlays: [], doors: [], windows: [],
      placeables, placeableNextId: 1,
      beamPipes, beamPipeNextId: count + 1,
      placementNextId: count * pipeItem.attachments.length,
      utilityLines: [], utilityNextId: 1,
      cornerHeights: new Map(),
    },
  };
}

/** Construct a real Game around the fixture and prepare all lines to tick. */
export async function createLargeBeamlineBenchmarkGame(options = {}) {
  const scenario = buildLargeBeamlineScenario(options);
  const registry = new BeamlineRegistry();
  const game = new Game(registry, { seed: 0x10be_a111 });
  game.applyScenario(scenario.data);
  game.state.mapHalfExtent = scenario.mapHalfExtent;

  const type = BEAMLINE_TYPES[scenario.design.typeId];
  for (const entry of registry.getAll()) {
    entry.typeId = scenario.design.typeId;
    entry.beamState.machineType = type?.machineType || entry.beamState.machineType;
    entry.status = 'running';
  }

  // This benchmark isolates the cost of ten working beamlines. Their utility
  // networks get a separate fixture later; allowing the ordinary gate to trip
  // every line here would skip the per-running-line tick path we need to time.
  game.utilityGate.run = () => {
    game.state.infraBlockers = [];
    game.state.infraCanRun = true;
  };
  game.state.infraBlockers = [];
  game.state.infraCanRun = true;
  game.state.paused = true; // direct benchmark ticks must never autosave
  game.state.staffMembers = [];
  game.state.staffCandidates = [];
  game.state.staff = Object.fromEntries(Object.keys(game.state.staff || {}).map(key => [key, 0]));
  game.recalcAllBeamlines();

  // applyScenario emits beamlineChanged, whose coalesced recalculation runs in
  // a microtask. Let it settle before a caller starts its stopwatch.
  await Promise.resolve();

  return {
    game,
    registry,
    design: scenario.design,
    layout: scenario.layout,
    expectedHardware: scenario.design.components.length * registry.getAll().length,
  };
}
