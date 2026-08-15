// scripts/balance-playthrough.mjs — playthrough simulation for the progression
// design pass (Phase 12).
//
// The steady-state runs in balance-sim.mjs answer "what does a facility earn
// per tick". They cannot answer the only question progression tuning cares
// about: HOW LONG DOES A RUN TAKE. This module drives a scripted player through
// a whole game — buying research as it becomes affordable, expanding the
// facility so income actually grows — and reports the tick at which each
// research tier completes.
//
// THE TARGET: a full playthrough to the top of the tech tree should take
// ~28,800 ticks (~8 h of active play at 1x; the speed controls make wall-clock
// shorter). Everything printed here is measured against that number.
//
// Determinism: the Game rng is seeded, the policy is a pure function of state,
// and nothing reads the wall clock. Same seed => same table, every time.

import './balance-env.mjs';
import { Game } from '../src/game/Game.js';
import { BeamlineRegistry } from '../src/beamline/BeamlineRegistry.js';
import { RESEARCH, RESEARCH_LAB_MAP } from '../src/data/research.js';
import { COMPONENTS } from '../src/data/components.js';
import {
  isResearchAvailable, startResearch, getResearchSpeedMultiplier,
  getLabResearchTier, _computeNodeDepth,
} from '../src/game/research.js';
import { SCENARIOS } from '../src/data/scenarios.js';
import { wireUtility } from '../src/data/scenarios/scenario-wiring.js';
import { runWiringCost } from '../src/input/utility-run-wiring.js';
import { createStaffMember } from '../src/game/staff/staffSystem.js';
import { computeTickUpkeep } from '../src/game/economy.js';
import { hardwareNodeCount } from '../src/game/aggregates.js';
import { flattenPath } from '../src/beamline/flattener.js';
import { UTILITY_TYPES } from '../src/utility/registry.js';
import { getStationIndex } from '../src/game/staff/stations.js';
import { MAX_MAP_HALF_EXTENT } from '../src/data/land.js';

export const PLAYTHROUGH_TARGET_TICKS = 28800;

// Nodes the player can never reach are excluded from "top of the tree" so a
// single unreachable node cannot make every run read as infinite. Nothing is
// currently in here; it exists so a tuner can park a known-dead node with a
// label instead of silently capping the run.
const EXCLUDED_NODES = new Set();

export const RESEARCH_IDS = Object.entries(RESEARCH)
  .filter(([id, r]) => !r.hidden && !EXCLUDED_NODES.has(id))
  .map(([id]) => id);

export const NODE_TIER = Object.fromEntries(
  RESEARCH_IDS.map(id => [id, _computeNodeDepth(id)]),
);
export const TIERS = [...new Set(Object.values(NODE_TIER))].sort((a, b) => a - b);

// ---------------------------------------------------------------------------
// Blocker classification. Every tick with no research running is charged to the
// constraint(s) holding up the node closest to startable, so the summary can
// say whether a run is money-bound or reputation-bound rather than just slow.
// ---------------------------------------------------------------------------
export const BLOCKERS = ['funding', 'data', 'reputation', 'labTier'];

function nodeBlockers(id, state) {
  const r = RESEARCH[id];
  const out = [];
  const res = state.resources;
  if ((r.cost.funding || 0) > (res.funding || 0)) out.push('funding');
  if ((r.cost.data || 0) > (res.data || 0)) out.push('data');
  if ((r.cost.reputation || 0) > (res.reputation || 0)) out.push('reputation');
  if (getResearchSpeedMultiplier(id, state) === null) out.push('labTier');
  return out;
}

/**
 * The purchase policy: of everything whose prerequisites are met, take the node
 * that is nearest to startable — fewest unmet constraints, cheapest as the
 * tiebreak. A human plays the tree cheapest-first for the same reason: an
 * affordable node now beats a better node later when only one can be active.
 */
function chooseNode(state) {
  let best = null;
  for (const id of RESEARCH_IDS) {
    if (state.completedResearch.includes(id)) continue;
    if (!isResearchAvailable(id, state)) continue;
    const blockers = nodeBlockers(id, state);
    const cost = RESEARCH[id].cost.funding || 0;
    if (!best || blockers.length < best.blockers.length
      || (blockers.length === best.blockers.length && cost < best.cost)) {
      best = { id, blockers, cost };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Facility expansion. Income is quality * (base + perNode * nodeCount) plus
// data fees, so growth means more hardware on more running beamlines. The
// ladder below is what a player actually does with a surplus, in the order they
// do it, and every step is CHARGED at catalogue price.
// ---------------------------------------------------------------------------

/** The starter facility a run begins from — also what the wiring measurement
 *  below builds its scratch line on, so both see the same world. */
function newFacility(seed) {
  const scenario = SCENARIOS.find(s => s.id === 'smallBeamlineFacility');
  const game = new Game(new BeamlineRegistry(), { seed });
  game.applyScenario(scenario.generator());
  scenario.setup(game);
  game.recalcAllBeamlines();
  return withInstantArrival(game);
}

// Headless sim, no renderer to report pawn arrival (that's StaffPawns.js's
// job — see jobRunner.js's own header comment on job.phase), so every
// game.tick() call here also instantly completes any in-flight walk. Real
// walks are short relative to a 400k-tick playthrough; this just keeps the
// walk itself out of what the sim is measuring, the same way the operator
// seeded at game start is assumed to already be at their post.
//
// Also sets member.fromNode = job.destNode on that same flip — staff-
// professions-3 balance fix round 3 discovered this shim never did, so
// member.fromNode stayed undefined for every staff member for the entire
// run. jobRunner.js's findStation (stations.js) hard-bails the instant
// fromNode is falsy (`if (!fromNode) return null;`), so tryTakeNeedJob's
// deadlock branch fired unconditionally forever, for everyone, regardless
// of how many cafeteria/rest stations existed — this was invisible before
// round 3 (the deadlock guard kept every operator productively seated
// either way, and unservicedPenalty had no mechanical consequence yet), but
// round 3's operatorCoverage capacity cap made it fatal: every operator's
// capacity permanently pinned at 1 within ~160 ticks of hire, wiping out
// the skill-based coverage surplus this ladder's 1-operator-per-beamline
// hiring ratio relies on, cascading into permanent beam_unstaffed and (once
// income stopped) cooling_dry. A real renderer updates BOTH phase and
// position when a pawn arrives; this shim only ever did the first half.
function withInstantArrival(game) {
  const rawTick = game.tick.bind(game);
  game.tick = (...args) => {
    const result = rawTick(...args);
    for (const m of (game.state.staffMembers || [])) {
      if (m.job && m.job.phase === 'travel') {
        m.job.phase = 'work';
        if (m.job.destNode) m.fromNode = m.job.destNode;
      }
    }
    return result;
  };
  return game;
}

// Lab tiles + benches. Cheap, and the only thing that lifts the research speed
// table off its blocked rows (`late` needs tier 1, `final` needs tier 2), so
// this is always the first thing bought.
const LAB_KIT = {
  opticsLab:      ['labBench', 'mirrorMount', 'photodetector', 'polarizer', 'beamProfiler'],
  coolingLab:     ['labBench', 'pipeRack', 'flowMeter', 'coolantPump', 'heatExchanger'],
  diagnosticsLab: ['labBench', 'scopeStation', 'wireScannerBench', 'bpmTestFixture', 'daqRack'],
  machineShop:    ['labBench', 'toolCabinet', 'drillPress', 'millingMachine', 'weldingStation'],
  rfLab:          ['oscilloscope', 'signalGenerator', 'spectrumAnalyzer', 'networkAnalyzer', 'labBench'],
  vacuumLab:      ['gasManifold', 'leakDetector', 'pumpCart', 'testChamber', 'rga'],
};

// Zone tier 3 needs 16 tiles (ZONE_TIER_THRESHOLDS), furnishing tier 3 needs 5
// items (FURNISHING_TIER_THRESHOLDS), and the lab tier is the min of the two.
const LAB_TILES = 16;

// Where each new lab block goes: a 16-tile (8x2) slab in the annex strip north
// of the building, one block per lab, laid west to east.
const LAB_ORIGIN_ROW = -8;

function buildLab(game, zoneType, index) {
  const col0 = -8 + (index % 2) * 9;
  const row0 = LAB_ORIGIN_ROW - Math.floor(index / 2) * 3;
  let painted = 0;
  for (let i = 0; i < LAB_TILES; i++) {
    const c = col0 + (i % 8);
    const r = row0 + Math.floor(i / 8);
    if (game.placeFacilityZoneBrushTile(c, r, zoneType)) painted++;
  }
  let furnished = 0;
  const kit = LAB_KIT[zoneType] || [];
  for (let i = 0; i < kit.length; i++) {
    const ok = game.placePlaceable({
      type: kit[i], col: col0 + (i % 8), row: row0 + Math.floor(i / 8),
      subCol: 1, subRow: 1, dir: 0, silent: true,
    });
    if (ok) furnished++;
  }
  return { painted, furnished };
}

// ---------------------------------------------------------------------------
// One more beamline. Two grades, same topology:
//
//   'cup'      source -> faradayCup. ~$3M. The bread-and-butter capacity buy —
//              eight more hardware nodes earning beam income, a trickle of data.
//   'detector' source -> detector.   ~$53M. The detector alone is $50M — a
//              thirteenth of the whole tech tree — for 10x a faradayCup's data
//              rate. Measured, that is not a trade any run wants: data blocks
//              under 2% of ticks even on cup lines only, so DETECTOR_EVERY
//              defaults to 0 and this grade exists to be re-measured, not used.
//
// Everything on the pipe runs at 162.5 MHz (pillbox cavities and a buncher),
// so it is ONE RF network and one VHF-covering solid-state amp serves all of
// it — the same reason the shipped starter facility uses one. Cost is derived from the catalogue,
// never hardcoded: placements run `free` and the caller is charged the recipe
// total, which makes the buy atomic (no half-built line when a wire fails).
// ---------------------------------------------------------------------------
const LINE_ON_PIPE = [
  ['buncher', 0.08], ['pillboxCavity', 0.25], ['pillboxCavity', 0.40],
  ['pillboxCavity', 0.55], ['quadrupole', 0.72], ['bpm', 0.88],
];
// Plant differs by grade because the end station does. A faradayCup asks for
// 1 kW, no cooling and 1 unit of data; a detector asks for 120 kW, 60 kW of
// cooling and 40 units of data — past the 400 kW switchgear, past the lcwSkid's
// 100 kW loop and four times the rackIoc's fiber capacity all at once.
const LINE_PLANT = {
  cup: {
    supply: 'hvTransformer', cooling: 'lcwSkid', endData: 'rackIoc',
    extra: ['solidStateAmp', 'roughingPump', 'turboPump', 'powerBus',
      'vacuumManifold', 'vacuumManifold', 'waveguideManifold'],
  },
  detector: {
    supply: 'hvTransformer', cooling: 'chiller', endData: 'networkSwitch',
    extra: ['solidStateAmp', 'rackIoc', 'roughingPump', 'turboPump', 'powerBus',
      'vacuumManifold', 'vacuumManifold', 'waveguideManifold'],
  },
};

/** Catalogue price of the recipe's components, wiring excluded. */
export function beamlineHardwareCost(grade) {
  const plant = LINE_PLANT[grade] || LINE_PLANT.cup;
  const parts = ['source', grade === 'detector' ? 'detector' : 'faradayCup',
    ...LINE_ON_PIPE.map(p => p[0]),
    plant.supply, 'switchgear', plant.cooling, plant.endData, ...plant.extra];
  return parts.reduce((s, t) => s + (COMPONENTS[t]?.cost?.funding || 0), 0);
}

// A line costs more than its catalogue: utility lines are priced per sub-unit
// (costPerSubUnit on each descriptor) and the drift pipe is priced per tile, so
// a model that charged components alone would under-price every expansion in
// the run — by ~18% on the cup recipe.
//
// Both are fixed for the recipe: every placement in buildBeamline is relative
// to `row`, so the paths are the same shape whichever row the line lands on.
// That makes them measurable instead of hand-maintained constants that silently
// drift the first time the recipe changes — the first call builds the line once
// on a scratch facility and reads back what it committed (wiring) and what it
// drew from the till (pipe).
const _measuredByGrade = new Map();
function measureBuild(grade) {
  if (!_measuredByGrade.has(grade)) {
    const game = newFacility(1);
    const before = game.state.resources.funding;
    const built = buildBeamline(game, 10, grade);
    _measuredByGrade.set(grade, {
      wiring: built ? built.wiringCost : 0,
      pipe: built ? before - game.state.resources.funding : 0,
    });
  }
  return _measuredByGrade.get(grade);
}

/** Descriptor price of the utility lines the recipe wires. */
export function beamlineWiringCost(grade) { return measureBuild(grade).wiring; }

/** What buildBeamline draws from the till itself — the drift pipe (placements
 *  run `free`, so this is pipeCost and nothing else). */
export function beamlinePipeCost(grade) { return measureBuild(grade).pipe; }

/** What one more beamline costs a player, all in: hardware, pipe and wiring. */
export function beamlineRecipeCost(grade) {
  return beamlineHardwareCost(grade) + beamlinePipeCost(grade) + beamlineWiringCost(grade);
}

/**
 * Build one beamline at `row`. Placements run `free` and the caller pays
 * beamlineHardwareCost + the returned wiringCost; the pipe charges itself
 * through drawPipe. Returns null on any failure so the ladder can stop rather
 * than keep paying for lines that never come up green — otherwise
 * `{src, end, pipe, wiringCost}`, where wiringCost is what the lines this call
 * committed would be charged through the drawing gesture.
 */
export function buildBeamline(game, row, grade = 'cup') {
  const opts = { free: true, silent: true };
  const endType = grade === 'detector' ? 'detector' : 'faradayCup';
  const src = game.beamline.placeJunction({ type: 'source', col: -6, row, dir: 3, ...opts });
  const end = game.beamline.placeJunction({ type: endType, col: 6, row, dir: 3, ...opts });
  if (!src || !end) return null;
  const pipe = game.beamline.drawPipe(
    { junctionId: src, portName: 'exit' },
    { junctionId: end, portName: 'entry' },
    [{ col: -6, row }, { col: 6, row }],
  );
  if (!pipe) return null;

  const onPipe = LINE_ON_PIPE.map(([type, position]) =>
    game.beamline.placeOnPipe(pipe, { type, position, mode: 'snap', ...opts }));
  if (onPipe.some(x => !x)) return null;
  const quad = onPipe[4];
  const bpm = onPipe[5];

  // Service row two north of the line, distribution row hard against it — the
  // shipped starter layout, shifted. One power bus spans the run; vacuum
  // manifolds only reach 5 cells, so the run takes two.
  const plant = LINE_PLANT[grade] || LINE_PLANT.cup;
  const place = (type, col, r) => game.placePlaceable({ type, col, row: r, ...opts });
  const supply = place(plant.supply, -8, row - 2);
  const gear  = place('switchgear', -5, row - 2);
  const cool  = place(plant.cooling, -3, row - 2);
  const ssa   = place('solidStateAmp', 0, row - 2);
  const ioc   = place('rackIoc', 3, row - 2);
  const pump  = place('roughingPump', 4, row - 2);
  // Detector lines take a second data source: the detector alone asks for 40
  // units of fiber and a rackIoc carries 10, so the switch serves the end
  // station and the IOC keeps the BPM.
  const endData = plant.endData === 'rackIoc' ? ioc : place(plant.endData, 2, row - 2);
  const pwrBus = place('powerBus', 0, row - 1);
  const vacW   = place('vacuumManifold', -3, row - 1);
  const vacE   = place('vacuumManifold', 3, row - 1);
  const wgBus  = place('waveguideManifold', -2, row - 1);
  const turbo  = place('turboPump', 5, row - 1);
  if (!supply || !gear || !cool || !ssa || !ioc || !pump || !endData || !pwrBus || !vacW
    || !vacE || !wgBus || !turbo) return null;

  // Priced through the same runWiringCost the drawing gesture commits with, off
  // the length that actually landed — a rejected wire costs nothing here too.
  let wiringCost = 0;
  const wire = (util, from, to) => {
    const id = wireUtility(game, util, from, to);
    if (!id) return id;
    const line = game.state.utilityLines.get(id);
    wiringCost += (runWiringCost(util, line ? line.subL : 0) || {}).funding || 0;
    return id;
  };
  // Supply -> main switchgear -> distribution -> branch circuits. One HV feeder into an MCC,
  // whose eight sockets carry the line's loads; a ninth load (a separate data
  // end-station) takes a second panel, which is the shape of the decision the
  // chain creates.
  const powered = [[src, 'pwr_in'], [end, 'pwr_in'], [cool, 'pwr_in'],
    [ssa, 'pwr_in'], [ioc, 'pwr_in'], [pump, 'pwr_in'], [turbo, 'pwr_in'],
    [pwrBus, 'pwr_in']];
  if (endData !== ioc) powered.push([endData, 'pwr_in']);
  const panels = [];
  wire('hvCable', { id: supply, port: 'hv_out_1' }, { id: gear, port: 'hv_in' });
  for (let i = 0; i < Math.ceil(powered.length / 8); i++) {
    const panel = place('mcc', -6 + i * 2, row - 3);
    if (!panel) return null;
    panels.push(panel);
    wire('hvCable', { id: gear, port: `hv_out_${i + 1}` }, { id: panel, port: 'hv_in' });
  }
  powered.forEach(([id, port], i) => {
    const panel = panels[Math.floor(i / 8)];
    wire('powerCable', { id: panel, port: `pwr_out_${(i % 8) + 1}` }, { id, port });
  });
  // Both pumps land on the one vacuum network: pump speed sums across a
  // network, so the turbo backs the whole line and not just the end station.
  for (const [id, port] of [[src, 'vac_in'], [end, 'vac_in'],
    [vacW, 'bus_left'], [vacE, 'bus_left']]) {
    wire('vacuumPipe', { id: pump, port: 'vac_out' }, { id, port });
  }
  wire('vacuumPipe', { id: turbo, port: 'vac_out' }, { id: vacE, port: 'bus_right' });
  wire('rfWaveguide', { id: ssa, port: 'rf_out' }, { id: wgBus, port: 'bus_left' });
  wire('coolingWater', { id: cool, port: 'cool_out' }, { id: src, port: 'cool_in' });
  wire('coolingWater', { id: cool, port: 'cool_out' }, { id: quad, port: 'cool_in' });
  if (grade === 'detector') {
    wire('coolingWater', { id: cool, port: 'cool_out' }, { id: end, port: 'cool_in' });
  }
  wire('dataFiber', { id: endData, port: 'data_out' }, { id: end, port: 'data_in' });
  wire('dataFiber', { id: ioc, port: 'data_out' }, { id: bpm, port: 'data_in' });
  return { src, end, pipe, wiringCost };
}

function hireStaff(game, roles) {
  const state = game.state;
  for (const role of roles) {
    const m = createStaffMember(role, `staff_${state.staffNextId++}`, state.tick, game.rng);
    if (role === 'operator') {
      m.assignment.zoneId = 'controlRoom';
      // Stagger shifts so fatigue breaks alternate instead of tripping the beam
      // in sync.
      m.needs.fatigue = 0.5 * (state.staffMembers.length % 2);
      // One operator needs one console to actually sit at: the new beam gate
      // (task-4-brief.md) only counts an operator toward coverage while
      // phase:'work' on a runBeam job, and jobRunner offers at most one
      // runBeam job per free console SLOT — so hiring operators without also
      // building them somewhere to sit caps this facility's coverage at
      // whatever the starter scenario's one console can hold, no matter how
      // many more beamlines get added. The starter scenario already ships
      // one console for the seeded starting operator; this covers every
      // operator hired after that.
      ensureOperatorConsole(game);
    }
    state.staffMembers.push(m);
  }
  game._syncStaffCounts();
  // staff-professions-3 balance fix round 3: an unserviced operator
  // (jobRunner.js's unservicedPenalty) now caps beam-coverage capacity at 1
  // regardless of skill (utility-gate.js's operatorCoverage) — deliberately,
  // to make amenities load-bearing on the one job that earns money. That
  // exposed a SEPARATE, pre-existing bug this call works around rather than
  // fixes (out of this task's file scope — flagged in the balance report):
  // smallBeamlineFacility's own scenario "cafeteria"
  // (src/data/scenarios/smallBeamlineFacility.js) never resolves as a real
  // station at all. Its chairs are placed a whole TILE away from the
  // diningTable at a flat subCol:1/subRow:1 (every scenario furnishing uses
  // that same generic offset), not at any of diningTable's real per-anchor
  // seat offsets (stations.js) — so getStationIndex(state).byJob.eat is
  // EMPTY for this scenario, and always has been; nothing before this round
  // ever depended on it being real. Ditto rest — the scenario places no
  // toolChest/workCart at all. Before round 3 this was invisible (the
  // deadlock guard kept every staffer productively seated regardless); now
  // it silently caps every operator's capacity at 1 forever, the instant
  // their fatigue first crosses threshold (~tick 160, deterministic) with
  // nowhere to go, wiping out the skill-based coverage surplus this ladder
  // was tuned to accumulate. Building REAL, functional amenities here —
  // scaled to staff count — is this script's version of "the balance report
  // Beam telling the player to build a cafeteria" actually building one.
  ensureAmenities(game, state.staffMembers.length);
  // Balance fix round 6: see ensureDataStations' own comment — one daqRack
  // per scientist on payroll, or headcount scaling is cosmetic.
  const scientistCount = state.staffMembers.filter(m => m.profession === 'scientist').length;
  ensureDataStations(game, Math.max(1, scientistCount));
}

// Balance fix round 3 discovered (and fixes here) a second, independent bug:
// the nav grid is bounded to state.mapHalfExtent (30 for this scenario, i.e.
// col/row in [-30, 30] — see src/game/staff/nav.js) but placePlaceable
// itself enforces no such bound, so a single unbroken strip that grows one
// row (or column) per item — as the original ensureOperatorConsole did,
// `row: existing * 4` — silently walks OFF THE NAVIGABLE MAP after about 8
// items (8 * 4 = 32 > 30) and everything placed past that point is
// permanently unreachable from anywhere, forever, for a reason that has
// nothing to do with staffing or amenities: it simply isn't on the map
// stations.js's reachability graph knows about. Before round 3 this was
// ALSO invisible (member.fromNode was never populated at all — see
// withInstantArrival's own comment above — so eligibleFor/findStation
// skipped every reachability check unconditionally, out-of-bounds or not).
// Fixed by wrapping every dedicated strip into a bounded grid that never
// leaves roughly [-29, 29] regardless of count, instead of one strip that
// grows without limit.
function wrappedGridPosition(origin, index, colSpacing, rowSpacing, perRow) {
  return {
    col: origin.col + (index % perRow) * colSpacing,
    row: origin.row + Math.floor(index / perRow) * rowSpacing,
  };
}

// Consoles: origin near the map's own corner, wrapping every 12 columns (12
// * 4 = 48 wide, comfortably inside the +/-29 safe margin) — up to 12 rows
// of 12 (144 consoles) before this would ever wrap into the cafeteria band
// below, far more than a 24-line run hires.
const CONSOLE_ORIGIN = { col: -29, row: -29 };
const CONSOLE_PER_ROW = 12;

// Placed in its own dedicated strip, well clear of the beamline rows and lab
// blocks the rest of the ladder uses, so it never collides with them. Free —
// this rides the STAFF_STEP_BUDGET readiness gate the hire itself already
// passed, rather than adding a second itemized budget step for a $25k item.
function ensureOperatorConsole(game) {
  const state = game.state;
  const existing = state.placeables.filter(p => p.type === 'operatorConsole').length;
  const { col, row } = wrappedGridPosition(CONSOLE_ORIGIN, existing, 4, 3, CONSOLE_PER_ROW);
  // Charged like every other capital item in this ladder (labs, beamline
  // hardware, wiring) — a console is real equipment ($25k, facility-room-
  // furnishings.raw.js), not a free side effect of hiring. free:true here
  // used to leave every console after the starter's own unbilled, up to
  // 24 * $25k = $600k invisible to the run's economy over a full playthrough.
  const ok = game.placePlaceable({ type: 'operatorConsole', col, row, subCol: 0, subRow: 0, dir: 0, silent: true });
  if (!ok) console.error('[ensureOperatorConsole] placement failed', { existing, col, row });
}

// Own dedicated, NARROW column bands starting at col 20 — structurally
// clear of everything else this ladder ever builds: the beam hall and its
// service/distribution rows never leave roughly col -8..8 regardless of how
// far south a given line's ROW marches (buildBeamline's row parameter only
// ever moves the line, never its own column band), labs stay within col
// -8..8 too (LAB_ORIGIN_ROW's own layout), and the console grid — despite
// starting at the same col -29 origin — never exceeds col +15 even at 144
// consoles (12/row * 4 spacing). Growing almost entirely in ROWS instead
// (only 2 items per row here, cols 20/25) sidesteps all of that, rather
// than trying to out-guess exactly how wide any of those footprints are.
//
// Round 3 originally placed these at positive rows (CAFETERIA row 0, REST
// row 20, both starting at col -29 like the console grid) — which walked
// straight into the beam hall's service rows as the ladder built more
// lines (a beamline's service row sits at line row - 2, a col range wide
// enough to collide with a col -29-origin grid), and
// ensureCafeteriaSeats/ensureRestStations' own retry loop (below) papered
// over it by trying the next cell, silently burning most of
// MAX_AMENITY_PLACEMENT_ATTEMPTS on every single call instead of ever
// finding clear ground. REST_ORIGIN's row (100) is deliberately far above
// CAFETERIA_ORIGIN's own row range so the two grids can never collide with
// EACH OTHER either, without having to reason about exactly how many rows
// either one will end up needing. Both loops call ensureMapHalfExtent
// (below) before every placement attempt now, so growing into these large
// row values is never itself an out-of-bounds problem — see that
// function's own comment.
//
// Both are charged real funding (diningTable $400 + 4x cafeteriaChair $50,
// toolChest $3,000) — cheap against STAFF_STEP_BUDGET, same "real
// equipment, not a free side effect" reasoning as ensureOperatorConsole
// above.
//
// Roughly one seat and one rest slot per TWO staff — modest, not maximal:
// the failure this round actually hit was REACHABILITY (stations placed off
// the navigable map, or in the starter scenario's own sealed building — see
// hireStaff's comment), not contention, once that was fixed. Still generous
// enough that contention (every seat reserved by someone else, not merely
// absent — jobRunner.js's allReservedByOthers) stays rare, since it too
// engages unservicedPenalty and this script's goal is isolating the
// coverage-cap measurement, not exercising contention on top of it.
const CAFETERIA_ORIGIN = { col: 20, row: -29 };
const CAFETERIA_PER_ROW = 2;
const REST_ORIGIN = { col: 20, row: 100 };
const REST_PER_ROW = 2;
const SEATS_PER_STAFF = 0.5;
const REST_SLOTS_PER_STAFF = 0.5;
// Own band, col 40+ — clear of every other dedicated grid in this file
// (console -29..+15, cafeteria/rest col 20-29, labs/beam-hall col -8..9).
// See ensureDataStations' own comment for why this exists at all.
const DATA_ORIGIN = { col: 40, row: -29 };
const DATA_PER_ROW = 3;

function ensureAmenities(game, staffCount) {
  ensureCafeteriaSeats(game, Math.max(4, Math.ceil(staffCount * SEATS_PER_STAFF)));
  ensureRestStations(game, Math.max(1, Math.ceil(staffCount * REST_SLOTS_PER_STAFF)));
}

// Balance fix round 6: LAB_KIT's diagnosticsLab kit places exactly one
// daqRack (facility-lab-furnishings.raw.js, jobs: ['takeData'], slots: 1)
// and NO other kit item in any lab carries 'takeData' in its jobs list
// (opticsLab's own takeData-capable item, opticalTable, isn't in its kit at
// all). That means the entire facility, at any scientist headcount, has
// exactly ONE concurrent takeData work slot — measured live, scaling
// scientist headcount 1:1 with beamlines (i%2 flat cadence -> one per line)
// did not move the data-blocked figure at all, because only one of however
// many scientists were on payroll could ever actually be working takeData
// at once; the rest were fully idle, paid, and pointless. This is the exact
// same "hired without anywhere to work" shape as the cafeteria/rest bug
// fixed in balance round 3/4 (see hireStaff's own comment) — headcount
// alone was never going to fix it.
//
// takeData work is still facility-wide, but functional data hardware now has
// an authored home: DAQ racks belong in a Control Room or Diagnostics Lab.
// These ride their own dedicated Control Room grid rather than overflowing
// diagnosticsLab's fixed 16-tile footprint. Painting each exact rack footprint
// also keeps this benchmark on the same construction path as a real player.
//
// One daqRack per scientist: takeData is a scientist's entire job, not an
// occasional need like eating or resting, so under-provisioning here directly
// caps throughput 1:1 rather than merely causing occasional contention.
function ensureDataStations(game, stationsNeeded) {
  const state = game.state;
  let index = state.placeables.filter(p => p.type === 'daqRack').length;
  let attempts = 0;
  while ((getStationIndex(state).byJob.takeData || []).length < stationsNeeded) {
    if (attempts++ >= MAX_AMENITY_PLACEMENT_ATTEMPTS) {
      console.error('[ensureDataStations] gave up after too many failed placements', {
        stationsNeeded, realStations: (getStationIndex(state).byJob.takeData || []).length,
      });
      return;
    }
    const { col, row } = wrappedGridPosition(DATA_ORIGIN, index, 3, 4, DATA_PER_ROW);
    index++;
    ensureMapHalfExtent(game, Math.max(Math.abs(col), Math.abs(row)) + 5);
    const rackCells = COMPONENTS.daqRack.footprintCells(col, row, 0, 0, 0);
    for (const cell of rackCells) {
      game.placeFacilityZoneBrushTile(cell.col, cell.row, 'controlRoom');
    }
    const ok = game.placePlaceable({ type: 'daqRack', col, row, subCol: 0, subRow: 0, dir: 0, silent: true });
    if (!ok) console.error('[ensureDataStations] placement failed (will retry at the next grid cell)', { col, row });
  }
}

// Safety bound on ensureCafeteriaSeats/ensureRestStations' own retry loops
// (below) — a grid cell can collide with something else already placed
// (the beam hall, a lab block, an earlier table's own chairs) and
// placePlaceable just fails silently; without a cap a run of bad luck could
// spin forever instead of giving up with a loud, diagnosable error.
const MAX_AMENITY_PLACEMENT_ATTEMPTS = 500;

// One diningTable seats 4 (station.slots, facility-room-furnishings.raw.js)
// — but ONLY when a chair resolves each of its four anchors at the exact
// subtile offset diningTable declares (stations.js's seat-matching), so this
// places the same four-chair recipe test-staff-economy.js's own
// placeDiningTable helper verified against the real station index, not the
// scenario's own broken flat-offset convention (see hireStaff's comment).
//
// Balance fix round 4 fixed two bugs here, both found by an independent
// review of the round-3 diff:
//   - "how many seats already exist" used to count `diningTable` PLACEABLES,
//     not real, resolved `eat` STATION REFS (getStationIndex(state).byJob.
//     eat). smallBeamlineFacility ships exactly one diningTable — the one
//     that resolves to ZERO working seats (its own chairs are placed at the
//     wrong subtile offset — see hireStaff's own comment) — so
//     `existingTables` read 1 on a facility with ZERO real seats, and this
//     function built NOTHING AT ALL until staff count made
//     `Math.ceil(staffCount * SEATS_PER_STAFF)` exceed 4, i.e. staff >= 9.
//     Every hire before that point was permanently unserviced from ~tick
//     160 with no seat ever built for them.
//   - A table whose chairs PARTLY failed to place (a collision on one of
//     the four, not the table itself) used to still count as "one more
//     table" toward the seat total forever, silently under-provisioning by
//     up to 3 seats per such table with no way to ever notice or correct
//     for it.
// Fixed by driving the loop off the real station-ref count directly,
// re-read after every placement attempt (placePlaceable bumps navRevision
// on success, which getStationIndex's own cache keys off, so this sees a
// freshly-placed table's real seats immediately) — a partially-failed table
// simply doesn't move the count, and the loop just tries the next grid
// cell instead of trusting the attempt.
function ensureCafeteriaSeats(game, seatsNeeded) {
  const state = game.state;
  let tableIndex = state.placeables.filter(p => p.type === 'diningTable').length;
  let attempts = 0;
  while ((getStationIndex(state).byJob.eat || []).length < seatsNeeded) {
    if (attempts++ >= MAX_AMENITY_PLACEMENT_ATTEMPTS) {
      console.error('[ensureCafeteriaSeats] gave up after too many failed placements', {
        seatsNeeded, realSeats: (getStationIndex(state).byJob.eat || []).length,
      });
      return;
    }
    const { col, row } = wrappedGridPosition(CAFETERIA_ORIGIN, tableIndex, 5, 4, CAFETERIA_PER_ROW);
    tableIndex++;
    // +5: clearance past the table's own footprint plus its chairs, which
    // extend a couple of subtiles beyond (col, row) itself.
    ensureMapHalfExtent(game, Math.max(Math.abs(col), Math.abs(row)) + 5);
    const okTable = game.placePlaceable({ type: 'diningTable', col, row, subCol: 0, subRow: 0, dir: 0, silent: true });
    const okChairs = [
      game.placePlaceable({ type: 'cafeteriaChair', col, row, subCol: 0, subRow: 3, dir: 0, silent: true }),
      game.placePlaceable({ type: 'cafeteriaChair', col, row: row - 1, subCol: 1, subRow: 2, dir: 2, silent: true }),
      game.placePlaceable({ type: 'cafeteriaChair', col: col - 1, row, subCol: 2, subRow: 0, dir: 1, silent: true }),
      game.placePlaceable({ type: 'cafeteriaChair', col, row, subCol: 3, subRow: 1, dir: 3, silent: true }),
    ];
    if (!okTable || okChairs.some(ok => !ok)) {
      console.error('[ensureCafeteriaSeats] placement failed (will retry at the next grid cell)', { col, row, okTable, okChairs });
    }
  }
}

// toolChest (station.jobs: ['rest'], seated: 'never' — facility-lab-
// furnishings.raw.js): a single free-standing anchor, no seat-matching
// needed, so counting placeables IS counting real stations here — unlike
// diningTable there's no seat-matching step that can silently fail. Still
// driven off the real station-ref count (not placeable count) for the same
// reason as ensureCafeteriaSeats: consistency, and so a failed placement
// (grid-cell collision) doesn't get miscounted as a success either.
function ensureRestStations(game, stationsNeeded) {
  const state = game.state;
  let index = state.placeables.filter(p => p.type === 'toolChest').length;
  let attempts = 0;
  while ((getStationIndex(state).byJob.rest || []).length < stationsNeeded) {
    if (attempts++ >= MAX_AMENITY_PLACEMENT_ATTEMPTS) {
      console.error('[ensureRestStations] gave up after too many failed placements', {
        stationsNeeded, realStations: (getStationIndex(state).byJob.rest || []).length,
      });
      return;
    }
    const { col, row } = wrappedGridPosition(REST_ORIGIN, index, 4, 3, REST_PER_ROW);
    index++;
    ensureMapHalfExtent(game, Math.max(Math.abs(col), Math.abs(row)) + 5);
    const ok = game.placePlaceable({ type: 'toolChest', col, row, subCol: 0, subRow: 0, dir: 0, silent: true });
    if (!ok) console.error('[ensureRestStations] placement failed (will retry at the next grid cell)', { col, row });
  }
}

// Labs are painted through the real (charging) brush; their price is small and
// variable, so the gate is a flat allowance rather than a derived total.
const LAB_STEP_BUDGET = 150_000;
// A hire is a recurring salary, not a capital cost — the gate is the cash
// cushion a player wants before adding one to the payroll.
const STAFF_STEP_BUDGET = 250_000;

// How many beamlines a run will build before the ladder is exhausted, and how
// often one of them carries a detector.
//
// DETECTOR_EVERY is 0 — no detector lines — because as measured, data is not a
// binding resource: cheap faradayCup lines already out-earn the tree's 2,683
// total data cost several times over, while a detector line costs $53.3M
// against a facility that nets four figures a tick. Set `detectors: N` on
// runPlaythrough (or pass --detectors=N) to put one back every Nth line and see
// what it does; the recipe is maintained either way.
//
// Beamline row layout — named here (not just inlined at the one call site
// that used to hardcode `10 + i * 6`) so MAX_LINES below can be derived from
// it instead of guessed.
const FIRST_LINE_ROW = 10;
// "Six rows apart so each gets its own service and distribution rows" — see
// buildBeamline's own header comment. Not just a margin: a line's real
// footprint (buildBeamline's own placements) spans row-3 (the mcc panel) to
// about row+2 (the tallest on-pipe/distribution element), a ~5-row height,
// so 6 rows is close to the minimum spacing that keeps consecutive lines
// from colliding with EACH OTHER — tightening it is not free room to spend
// on more lines, unlike the margin below.
const BEAMLINE_ROW_SPACING = 6;
// Clearance past a line's own `row` for ensureMapHalfExtent (balance fix
// round 4/5) — covers the same row-3..row+2 footprint above plus a little
// slack for column width/subtile rounding, not a padded guess.
const BEAMLINE_ROW_MARGIN = 4;
// Balance fix round 5: MAX_LINES used to be a flat 24 with no relationship
// to the map this ladder actually has to fit on. Round 4's free map-grow
// masked that entirely (it grew the map to whatever a 24-line ladder
// needed, 160, well past what a player could ever buy); round 5 caps that
// grow at the real MAX_MAP_HALF_EXTENT (120, src/data/land.js — the
// import above), so the ladder now has to fit lines within the site a
// player could actually own. Derived from the layout constants above
// rather than hand-picked, so it stays correct if the row spacing, the
// margin, or the map cap ever move. At the current numbers this floors to
// 18 lines (19 beamlines total with the starter) — down from 24 (25
// total). The tree still completes in full within that (see this task's
// balance report for the measured tick count); this is a genuine finding
// about the ladder's own geometry, not a workaround.
const MAX_LINES = Math.floor((MAX_MAP_HALF_EXTENT - FIRST_LINE_ROW - BEAMLINE_ROW_MARGIN) / BEAMLINE_ROW_SPACING) + 1;
const DETECTOR_EVERY = 0;

// Operating cushion held back from every capacity buy. Roughly a thousand ticks
// of late-game upkeep — enough that one expansion cannot put the facility into
// the red on the next payroll.
const CASH_FLOOR = 500_000;
// Longest a player will sit on their hands saving for the next rung. Beyond
// this the step is left pending and research gets the money instead.
const SAVE_HORIZON = 3000;
// Window over which net income is measured for that decision.
const RATE_WINDOW = 500;
// Grace ticks a fresh beamline gets before an unstaffed gate counts as a
// real stall — see the pendingGateCheck handling in the run loop below.
const GATE_CHECK_GRACE_TICKS = 20;

// Balance fix round 4 (addendum): buildBeamline's own row (10 + i*6, "march
// south") already exceeds the default map bound (mapHalfExtent 30, i.e. rows
// in [-30, 30]) by the 4th line and reaches row 148 by the 24th —
// Game.placePlaceable enforces no such bound itself (unlike the real UI
// path, DesignPlacer.js, which refuses off-site placement), so every line
// past the map's edge was silently placing components no technician could
// ever reach — cosmetic while nothing targeted them, but target-addressed
// repair jobs land on these same components now (995856b8/380a8583).
//
// Grown here directly rather than through the real Game.buyLand() land
// economy: that ladder is priced for the LATE, collider-tier game
// ($500M-$15B, src/data/land.js) and would swallow this playthrough's
// entire ~$582M research budget the first time a line needed more room —
// never what that ladder was for. This is a free, harness-only grow (the
// same "free: true" convention every placement in this file already uses),
// not a simulation of the real purchase. Chosen over wrapping the beamline
// layout into a 2D grid (the same approach ensureCafeteriaSeats/
// ensureRestStations use) because buildBeamline places many things at
// column offsets relative to one fixed row; giving it a second, column
// dimension would touch far more of this file's own least-tested code than
// widening a single number does. `_markNavDirty` is already reached into
// directly elsewhere in this file (hireStaff calls `_syncStaffCounts`) —
// same convention, not a new one.
//
// Balance fix round 5: capped at MAX_MAP_HALF_EXTENT (imported, not
// hardcoded) — round 4's free grow had no ceiling and reached 160 for a
// 25-line ladder, a footprint bigger than the largest map a player can
// ever actually buy (120, the last real land parcel — src/data/land.js).
// That wasn't just skipping a cost, it was measuring pacing on a facility
// shape that cannot exist in the real game. The free-grow DECISION (bypass
// buyLand's price) still stands; only the ceiling is new. See MAX_LINES
// below for the real consequence: this ladder's own 6-rows-apart beamline
// spacing cannot fit 25 lines under this cap, so the line count is reduced
// instead of the cap being raised.
function ensureMapHalfExtent(game, requiredHalfExtent) {
  const state = game.state;
  const capped = Math.min(requiredHalfExtent, MAX_MAP_HALF_EXTENT);
  if ((state.mapHalfExtent || 0) >= capped) return;
  state.mapHalfExtent = capped;
  game._markNavDirty();
}

/**
 * The expansion ladder, in the order a player climbs it. Each step declares a
 * `budget` (the funds that must be on hand before it is attempted, over and
 * above the research reserve) and an `apply` that returns false if the build
 * could not be completed.
 */
function buildLadder(detectorEvery = DETECTOR_EVERY, maxLines = MAX_LINES) {
  const steps = [];
  // Labs first, always: they cost a rounding error and lab TILES/BENCHES are
  // a hard ceiling on the research speed table (getLabResearchTier's own
  // Math.min(tier, furnTier), research.js) — necessary, but no longer
  // sufficient on their own. Balance fix round 6: since Task 6, `tier` (and
  // the `peakTier` research gating actually reads) is also ratcheted by
  // engineers accruing labWork output in the zone — a fully-tiled, fully-
  // benched lab with nobody ever staffing it still sits at tier 0 forever.
  // The staff step below (which now hires an engineer every line, not zero)
  // is what actually keeps this ceiling from being the permanent floor.
  const labs = ['opticsLab', 'diagnosticsLab', 'machineShop', 'coolingLab', 'rfLab', 'vacuumLab'];
  labs.forEach((zoneType, i) => {
    steps.push({
      kind: 'lab', label: `lab:${zoneType}`, budget: LAB_STEP_BUDGET,
      apply: (game) => !!buildLab(game, zoneType, i).painted,
    });
  });
  // Beamlines march south, six rows apart so each gets its own service and
  // distribution rows.
  for (let i = 0; i < maxLines; i++) {
    const grade = detectorEvery > 0 && (i + 1) % detectorEvery === 0 ? 'detector' : 'cup';
    const cost = beamlineRecipeCost(grade);
    // Staff BEFORE beamline: the operator's coverage has to already exist
    // the instant a new beamline comes online, or the facility trips
    // beam_unstaffed the moment it's built (operatorCoverage.capacity
    // couldn't possibly cover a beamline count it hasn't caught up to yet —
    // see task-4-brief.md's new gate). The staff step is cheap
    // (STAFF_STEP_BUDGET) and gets bought well before the much larger
    // beamline recipe cost, so by the time a run affords line N+1, its
    // operator has been on payroll for a while — no gap.
    steps.push({
      kind: 'staff', label: `staff:line${i + 2}`, budget: STAFF_STEP_BUDGET,
      apply: (game) => {
        // Balance fix round 6: engineer and scientist both hired every line
        // now, not the old i%2-alternating scientist-only-every-other-line
        // cadence. Two independent findings forced this, neither tunable
        // away by adjusting the ratio downward:
        //
        // - Zero engineers were ever hired before this round (only
        //   operator/technician/scientist were in this list) — Task 6 made
        //   lab zone tier (and therefore getLabResearchTier's peakTier,
        //   research.js) depend on engineers actually accruing labWork
        //   output. With none hired, staffedOutput sat at 0 for every lab
        //   forever, live tier 0, peakTier 0, no matter how many lab tiles
        //   or benches existed. See buildLadder's own lab-step comment
        //   above, corrected this round for the same reason.
        // - 54b124ad divided takeData's facility-wide total by running-
        //   beamline count, closing a quadratic free-scaling bug (total
        //   data used to multiply with beamline count from a FIXED
        //   scientist headcount). That fix makes total data output
        //   independent of beamline count by design — a scientist can only
        //   take data in one place — so a hiring cadence tuned against the
        //   old free multiplier (one scientist per two lines) now falls
        //   further behind the tree's data cost with every line built
        //   instead of keeping pace with it.
        //
        // One of each per line is the same cadence operator/technician
        // already use, not a guessed multiplier — see the 30,000-tick
        // measurement in this round's report for what it actually costs in
        // upkeep and whether the ladder still affords it.
        hireStaff(game, ['operator', 'technician', 'engineer', 'scientist']);
        return true;
      },
    });
    steps.push({
      kind: 'beamline', label: `line${i + 2}:${grade}`, budget: cost,
      apply: (game) => {
        const row = FIRST_LINE_ROW + i * BEAMLINE_ROW_SPACING;
        // BEAMLINE_ROW_MARGIN: buildBeamline's own service/distribution rows
        // (see its own header comment, and MAX_LINES' comment above for the
        // real row-3..row+2 span this covers) extend past `row` itself — a
        // flat margin keeps every one of a line's placements inside bounds,
        // not just its source/end junctions. ensureMapHalfExtent itself caps
        // at MAX_MAP_HALF_EXTENT regardless of what's requested here — this
        // is sized to stay under that cap for every line MAX_LINES allows,
        // not to rely on the cap to bail it out.
        ensureMapHalfExtent(game, row + BEAMLINE_ROW_MARGIN);
        const built = buildBeamline(game, row, grade);
        if (!built) return false;
        // Charged on the wiring this row actually committed rather than the
        // measurement the budget gated on, so a row that ever routes
        // differently pays the difference instead of quietly diverging.
        game.state.resources.funding -= beamlineHardwareCost(grade) + built.wiringCost;
        return true;
      },
    });
  }
  return steps;
}

// ---------------------------------------------------------------------------
// Reservoir auto-refill — the player pressing the UtilityInspector button.
// Lives here and is imported by balance-sim.mjs so both the rate runs and the
// playthrough refill on exactly the same trigger.
// ---------------------------------------------------------------------------
const REFILL_TRIGGER = {
  coolingWater: (p) => (p?.reservoirVolumeL ?? Infinity) < 100,
  cryoTransfer: (p) => (p?.lheVolumeL ?? Infinity) < 60,
};

/** Returns dollars spent this call. */
export function autoRefill(game) {
  const state = game.state;
  let spent = 0;
  const nets = state.utilityNetworks;
  if (!nets) return 0;
  for (const [utilityType, networks] of nets) {
    const desc = UTILITY_TYPES[utilityType];
    const trigger = REFILL_TRIGGER[utilityType];
    if (!desc || !trigger || typeof desc.refillCost !== 'function') continue;
    for (const net of networks) {
      const persistent = state.utilityNetworkState.get(net.id);
      if (!persistent || !trigger(persistent)) continue;
      const cost = desc.refillCost(persistent);
      if (!cost || !cost.funding) continue;
      if (state.resources.funding < cost.funding) continue;
      state.resources.funding -= cost.funding;
      spent += cost.funding;
      state.utilityNetworkState.set(net.id, { ...persistent, ...desc.persistentStateDefaults });
    }
  }
  return spent;
}

// The billed hardware population across every RUNNING line — the exact same
// accessor Game._tickBeamline pays on, so the trajectory column and the income
// cannot disagree.
function hardwareCount(game) {
  let n = 0;
  for (const entry of game.registry.getAll()) {
    if (entry.status !== 'running' || !entry.sourceId) continue;
    n += hardwareNodeCount(flattenPath(game.state, entry.sourceId));
  }
  return n;
}

function startAllBeams(game) {
  for (const entry of game.registry.getAll()) {
    if (entry.status !== 'running') game.toggleBeam(entry.id);
  }
}

// ---------------------------------------------------------------------------
// The run.
// ---------------------------------------------------------------------------

/**
 * Drive a scripted player from the starter facility to the top of the tree.
 *
 * @param {object} opts
 * @param {number} opts.seed          rng seed (determinism)
 * @param {number} opts.maxTicks      hard stop; a run that hits it is reported
 *                                    as UNFINISHED rather than silently capped
 * @param {number} opts.sampleEvery   trajectory sample interval
 * @param {boolean} opts.expand       run the facility-expansion ladder
 * @param {number} opts.maxLines      cap on beamlines the ladder may add
 * @param {number} opts.detectors     put a detector line every Nth rung (0 = none)
 * @returns {object} the progression record (see printPlaythrough)
 */
export function runPlaythrough({
  seed = 909, maxTicks = 400_000, sampleEvery = 2000, expand = true,
  detectors = DETECTOR_EVERY, maxLines = MAX_LINES,
} = {}) {
  const game = newFacility(seed);
  // Objectives are NOT pre-completed here (the steady-state runs do that to
  // keep one-time story money out of a per-tick rate). Milestone grants are
  // progression income and a playthrough has to feel them.
  game.tick();
  startAllBeams(game);

  const state = game.state;
  const ladder = expand ? buildLadder(detectors, maxLines) : [];
  let ladderIdx = 0;
  let ladderStalled = null;
  let startsSinceExpansion = 1;   // labs come first, before any research starts
  let pendingGateCheck = null;

  const completedAt = {};            // research id -> tick
  const tierCompletedAt = {};        // depth -> tick
  const expansionsAt = [];           // { tick, label, funding }
  const samples = [];                // trajectory rows
  const blockedTicks = Object.fromEntries(BLOCKERS.map(b => [b, 0]));
  let idleTicks = 0;                 // ticks with nothing running at all
  let refillSpent = 0;
  let upkeepSpent = 0;
  let researchSpent = 0;
  let expansionSpent = 0;
  let beamOnTicks = 0;
  // Balance fix round 4: state.beamOn only ever asks "is ANY line running" —
  // it stayed true for the entire ~24,000-tick stall this round's headline
  // bug caused, because line 1 kept running while lines 2-4 sat built,
  // staffed, and off. Tracked separately here as the FRACTION of registered
  // beamlines actually running each tick.
  //
  // Balance fix round 5: the WHOLE-RUN average of that fraction ALSO missed
  // the stall — round 4's own fix landed at runningLineFraction 91.2% on a
  // reconstructed pre-fix run (comfortably over the 0.8 bar the assertion
  // used), because a ~24,000-tick deficit dilutes across a ~470,000
  // line-tick run. True instantaneously ("4 registered, 1 running reads as
  // 25%"), false once averaged over the whole run. Tracked here as a
  // WINDOWED minimum instead — the worst LINE_UPTIME_WINDOW_TICKS-tick
  // stretch of the run, not the overall mean — which reads 33.3% on the
  // same reconstructed pre-fix run and is what test-progression.js's
  // assertion now reads.
  let runningLineTicks = 0;
  let registeredLineTicks = 0;
  const LINE_UPTIME_WINDOW_TICKS = 2000;
  let windowRunningLineTicks = 0;
  let windowRegisteredLineTicks = 0;
  let windowStartTick = 0;
  let minWindowLineFraction = 1; // vacuously "fine" until a real window is scored
  let lastCompletedCount = 0;
  let lastCompletionTick = state.tick;
  let longestGap = null;
  let windowStartFunds = state.resources.funding;
  // Trailing net income, refreshed every RATE_WINDOW ticks. The expansion
  // policy needs a rate to decide what is worth saving for, and it has to be
  // measured rather than assumed — that is the whole point of the sim.
  let netRate = 0;
  let rateWindowStart = state.resources.funding;
  let rateWindowTick = state.tick;
  let windowSpend = 0;

  const startFunding = state.resources.funding;
  const remaining = () => RESEARCH_IDS.filter(id => !state.completedResearch.includes(id)).length;

  let t = 0;
  for (; t < maxTicks && remaining() > 0; t++) {
    game.tick();
    upkeepSpent += computeTickUpkeep(state).total;
    refillSpent += autoRefill(game);
    if (state.beamOn) beamOnTicks++;
    {
      const entries = game.registry.getAll();
      if (entries.length) {
        const running = entries.filter(e => e.status === 'running').length;
        registeredLineTicks += entries.length;
        runningLineTicks += running;
        windowRegisteredLineTicks += entries.length;
        windowRunningLineTicks += running;
      }
      if (t - windowStartTick + 1 >= LINE_UPTIME_WINDOW_TICKS) {
        if (windowRegisteredLineTicks > 0) {
          minWindowLineFraction = Math.min(minWindowLineFraction, windowRunningLineTicks / windowRegisteredLineTicks);
        }
        windowRunningLineTicks = 0;
        windowRegisteredLineTicks = 0;
        windowStartTick = t + 1;
      }
    }

    if (pendingGateCheck) {
      if (state.infraCanRun) {
        // The gate cleared (the new beamline's staffing/utility race
        // resolved), but that only means the FACILITY can run — it says
        // nothing about whether this specific new line is actually running.
        // toggleBeam correctly refuses on a one-tick registration race
        // ("Press Start again once they are at the console"), and nothing
        // upstream of this loop ever presses Start again. Without this call
        // a newly-built line sits registered, staffed, gate-clear, and OFF
        // — invisible to state.infraCanRun (which only asks "could a beam
        // run here", not "is one") — paying full payroll against the
        // income of however many OTHER lines are actually lit. Balance fix
        // round 4: this was the real cause of a run reading as a
        // ~24,000-tick "stall" that wasn't a stall at all (infraCanRun was
        // true 99.3% of the time) — the ladder kept buying and staffing
        // lines 2-4 while never turning any of them on.
        startAllBeams(game);
        pendingGateCheck = null;
      } else if (state.tick >= pendingGateCheck.deadline) {
        // Grace period (GATE_CHECK_GRACE_TICKS) expired and the facility is
        // STILL down — that is a real stall, not just staffing latency. A
        // freshly hired operator needs jobRunner to assign them (their
        // runBeam job is capped at the currently-RUNNING beamline count —
        // see jobRunner.js's capsFor — so they cannot even be offered the
        // job until THIS beamline is already live) and then "arrive"
        // (withInstantArrival flips phase on the tick AFTER assignment) —
        // one tick of unavoidable lag a real player's operator would also
        // need to physically walk over. Checking on the very next tick (the
        // old behavior) flagged that ordinary lag as a stall on every single
        // beamline rung once operators had to be individually seated.
        const codes = [...new Set((state.infraBlockers || []).map(b => b.code))];
        pendingGateCheck.gate = codes.join(',') || 'unknown';
        ladderStalled = `${pendingGateCheck.label} (gate: ${pendingGateCheck.gate})`;
        pendingGateCheck = null;
      }
    }

    if (state.tick - rateWindowTick >= RATE_WINDOW) {
      // Discretionary spend is added back: the rate has to answer "how fast can
      // I save", and lumping a research purchase into it would report a
      // profitable facility as loss-making for a whole window.
      netRate = (state.resources.funding - rateWindowStart + windowSpend)
        / (state.tick - rateWindowTick);
      rateWindowStart = state.resources.funding;
      rateWindowTick = state.tick;
      windowSpend = 0;
    }

    // Record completions (tickResearch pushes onto completedResearch).
    if (state.completedResearch.length !== lastCompletedCount) {
      for (const id of state.completedResearch) {
        if (completedAt[id] === undefined) completedAt[id] = state.tick;
      }
      lastCompletedCount = state.completedResearch.length;
      // A dead patch — a long span where nothing finishes — is what a
      // progression pass is trying to eliminate, so measure the worst one.
      if (state.tick - lastCompletionTick > (longestGap?.ticks ?? 0)) {
        longestGap = { ticks: state.tick - lastCompletionTick, from: lastCompletionTick, to: state.tick };
      }
      lastCompletionTick = state.tick;
      for (const tier of TIERS) {
        if (tierCompletedAt[tier] !== undefined) continue;
        const ids = RESEARCH_IDS.filter(id => NODE_TIER[id] === tier);
        if (ids.every(id => completedAt[id] !== undefined)) tierCompletedAt[tier] = state.tick;
      }
    }

    // --- the one budget decision ---
    //
    // Research and capacity draw on the same pot, so the policy has to say who
    // gets it. One for science, one for capacity: after each research start the
    // player owes a capacity buy, and until it is paid they SAVE for it rather
    // than starting another node. Neither half alone produces a playable
    // curve — capacity-first buys beamlines forever (a line is cheaper than a
    // mid-tree node and pays for itself), research-first leaves income flat and
    // never affords the tree.
    const step = (!ladderStalled && ladderIdx < ladder.length) ? ladder[ladderIdx] : null;
    // Labs and hires are rounding-error purchases that gate everything else;
    // they are never something to save up for. Nor is a step the facility
    // cannot reach inside SAVE_HORIZON ticks at its current rate — hoarding for
    // a step twenty thousand ticks out is not what a player does, and it turns
    // one expensive rung into a total research stall.
    const saveable = step && step.kind === 'beamline' && startsSinceExpansion >= 1
      && step.budget <= state.resources.funding + Math.max(0, netRate) * SAVE_HORIZON;
    const owed = saveable ? step.budget + CASH_FLOOR : 0;

    const pick = state.activeResearch ? null : chooseNode(state);
    if (pick) {
      const affordable = pick.blockers.length === 0;
      const savingUp = owed > 0 && state.resources.funding - pick.cost < owed;
      if (affordable && !savingUp) {
        const before = state.resources.funding;
        if (startResearch(pick.id, state, () => {})) {
          researchSpent += before - state.resources.funding;
          windowSpend += before - state.resources.funding;
          startsSinceExpansion++;
        } else { idleTicks++; }
      } else {
        // Saving for capacity is a funding block on the research ladder — a
        // player staring at a node they could buy but shouldn't is still a
        // player not researching, and the summary must say so.
        for (const b of (affordable ? ['funding'] : pick.blockers)) blockedTicks[b]++;
        idleTicks++;
      }
    }

    if (step) {
      const cheap = step.kind !== 'beamline';
      if ((cheap || startsSinceExpansion >= 1)
        && state.resources.funding - CASH_FLOOR >= step.budget) {
        const before = state.resources.funding;
        const ok = step.apply(game);
        const spent = before - state.resources.funding;
        expansionSpent += spent;
        windowSpend += spent;
        ladderIdx++;
        if (!cheap) startsSinceExpansion = 0;
        const record = {
          tick: state.tick, label: step.label, ok, gate: null,
          spent, funding: state.resources.funding,
        };
        expansionsAt.push(record);
        if (ok && step.kind === 'beamline') {
          game.recalcAllBeamlines();
          game.refreshInfrastructureGate();
          startAllBeams(game);
          // infraCanRun is FACILITY-wide, not per line: one badly fed component
          // on a new build stops every beam in the place. Read it within a
          // short grace window (the gate needs a solve with the beams
          // actually on, and — since staff-professions-3 — a newly hired
          // operator needs a tick to be assigned plus a tick to "arrive",
          // see the pendingGateCheck handling above) rather than three
          // thousand ticks later when the funds curve inverts.
          pendingGateCheck = { ...record, deadline: state.tick + GATE_CHECK_GRACE_TICKS };
        }
        // A failed build leaves half-wired hardware that the gate will hold the
        // whole facility down on. Stop climbing rather than compound it — and
        // say so, because a stalled ladder invalidates the run's income curve.
        if (!ok) ladderStalled = step.label;
      }
    }

    if (state.tick % sampleEvery === 0) {
      samples.push({
        tick: state.tick,
        funding: state.resources.funding,
        reputation: state.resources.reputation,
        data: state.resources.data,
        done: state.completedResearch.length,
        netPerTick: (state.resources.funding - windowStartFunds) / sampleEvery,
        beamQuality: state.beamQuality ?? 0,
        // Total hardware across every beamline, not state.beamline (which is
        // only the aggregate flattening of the selected one) — income scales
        // with this, so a trajectory that quotes one line hides the growth.
        nodes: hardwareCount(game),
        lines: game.registry.getAll().length,
        blockers: (state.infraBlockers || []).length,
      });
      windowStartFunds = state.resources.funding;
    }
  }
  // Score the trailing partial window too (the loop can end mid-window,
  // either hitting maxTicks or finishing research early) — a stall in the
  // last few hundred ticks of a run must not go unscored just because it
  // never reached a full LINE_UPTIME_WINDOW_TICKS.
  if (windowRegisteredLineTicks > 0) {
    minWindowLineFraction = Math.min(minWindowLineFraction, windowRunningLineTicks / windowRegisteredLineTicks);
  }

  return {
    seed, maxTicks, expand, detectors, maxLines,
    totalTicks: t,
    linesBuilt: game.registry.getAll().length,
    hardwareNodes: hardwareCount(game),
    // Lab tier drives RESEARCH_SPEED_TABLE: tier 0 runs research at 4x the
    // duration and blocks depth-5+ outright. A run that never notices its labs
    // are tier 0 is measuring the wrong game.
    labTiers: Object.fromEntries(
      [...new Set(Object.values(RESEARCH_LAB_MAP))]
        .map(lab => [lab, getLabResearchTier(lab, state)])),
    finished: remaining() === 0,
    completedAt, tierCompletedAt, expansionsAt, samples, blockedTicks, ladderStalled,
    longestGap,
    idleTicks, beamOnTicks,
    runningLineTicks, registeredLineTicks,
    // The fraction of registered beamlines actually running, averaged over
    // every tick that had at least one registered — see runningLineTicks'
    // own comment above for why this is a different (and stricter) number
    // than beamOnTicks/totalTicks. Kept for diagnostics/reporting, but NOT
    // what test-progression.js asserts on — see minWindowLineFraction,
    // which is (balance fix round 5's own finding: this whole-run average
    // is still too forgiving to catch a real multi-thousand-tick stall).
    runningLineFraction: registeredLineTicks > 0 ? runningLineTicks / registeredLineTicks : 0,
    // The worst LINE_UPTIME_WINDOW_TICKS-tick window's own running-line
    // fraction, not the whole-run average — see this record's own
    // "Balance fix round 5" comment above for why the average isn't
    // sensitive enough. This is what test-progression.js actually asserts.
    minWindowLineFraction,
    refillSpent, upkeepSpent, researchSpent, expansionSpent,
    remainingNodes: RESEARCH_IDS.filter(id => !state.completedResearch.includes(id)),
    // Net income per tick over the whole run: after upkeep and refills, BEFORE
    // discretionary spend. This is the rate the tree has to be priced against —
    // a trailing window that happens to contain a $8M research purchase says
    // nothing about what the facility earns.
    incomeRate: t > 0
      ? (state.resources.funding - startFunding + researchSpent + expansionSpent) / t : 0,
    startFunding,
    finalFunding: state.resources.funding,
    finalReputation: state.resources.reputation,
    finalData: state.resources.data,
    finalNodeCount: state.beamline?.length ?? 0,
    researchTotalFunding: RESEARCH_IDS.reduce((s, id) => s + (RESEARCH[id].cost.funding || 0), 0),
  };
}

// ---------------------------------------------------------------------------
// Reporting.
// ---------------------------------------------------------------------------
const money = (n) => '$' + Math.round(n).toLocaleString();

export function printPlaythrough(rec, log = console.log) {
  log(`\n=== D: playthrough to the top of the tree (seed ${rec.seed}, ` +
    (rec.expand ? `up to ${rec.maxLines} extra lines` : 'no expansion') +
    `${rec.detectors ? `, detector every ${rec.detectors}` : ''}) ===`);

  // Tier == prerequisite depth in the RESEARCH DAG. Nothing in the game gates
  // on it, so completion is NOT monotone in tier — a cheap depth-5 node lands
  // before an expensive depth-3 one. "ideal @" is where the tier would finish
  // if the run spent its funding budget evenly across the target span; it is
  // the number to tune the costs against.
  log('\n-- research tier completion (tier = prerequisite depth, not a gate) --');
  log('tier | nodes | first @ | last @ |  vs target | ideal @ | funding cost');
  log('-----+-------+---------+--------+------------+---------+-------------');
  const treeCost = rec.researchTotalFunding || 1;
  let cumCost = 0;
  for (const tier of TIERS) {
    const ids = RESEARCH_IDS.filter(id => NODE_TIER[id] === tier);
    const at = rec.tierCompletedAt[tier];
    const cost = ids.reduce((s, id) => s + (RESEARCH[id].cost.funding || 0), 0);
    cumCost += cost;
    const times = ids.map(id => rec.completedAt[id]).filter(x => x !== undefined);
    const first = times.length ? Math.min(...times) : undefined;
    const ideal = Math.round(PLAYTHROUGH_TARGET_TICKS * cumCost / treeCost);
    log(
      String(tier).padStart(4) + ' | ' +
      String(ids.length).padStart(5) + ' | ' +
      (first === undefined ? '--' : String(first)).padStart(7) + ' | ' +
      (at === undefined ? 'NEVER' : String(at)).padStart(6) + ' | ' +
      (at === undefined ? '--' : (at / PLAYTHROUGH_TARGET_TICKS).toFixed(2) + 'x').padStart(10) + ' | ' +
      String(ideal).padStart(7) + ' | ' +
      money(cost).padStart(12));
  }
  if (rec.longestGap) {
    log(`\n  longest stretch with no research completed: ${rec.longestGap.ticks} ticks ` +
      `(t=${rec.longestGap.from}..${rec.longestGap.to}) — ` +
      `${(100 * rec.longestGap.ticks / Math.max(1, rec.totalTicks)).toFixed(1)}% of the run in one dead patch`);
  }

  log('\n-- trajectory --');
  log('tick   | funding       | net/tick | rep    | data    | research | lines | hw | quality');
  log('-------+---------------+----------+--------+---------+----------+-------+----+--------');
  for (const s of rec.samples) {
    log(
      String(s.tick).padStart(6) + ' | ' +
      money(s.funding).padStart(13) + ' | ' +
      s.netPerTick.toFixed(1).padStart(8) + ' | ' +
      s.reputation.toFixed(1).padStart(6) + ' | ' +
      Math.round(s.data).toLocaleString().padStart(7) + ' | ' +
      `${s.done}/${RESEARCH_IDS.length}`.padStart(8) + ' | ' +
      String(s.lines).padStart(5) + ' | ' +
      String(s.nodes).padStart(2) + ' | ' +
      s.beamQuality.toFixed(2).padStart(7));
  }

  if (rec.expansionsAt.length) {
    log('\n-- facility expansion --');
    for (const e of rec.expansionsAt) {
      log(`  t=${String(e.tick).padStart(6)}  ${e.label.padEnd(18)} ${e.ok ? 'ok  ' : 'FAIL'} ` +
        `spent ${money(e.spent).padStart(12)}  left ${money(e.funding).padStart(14)}` +
        (e.gate ? `  GATE DOWN: ${e.gate}` : ''));
    }
  }

  log('\n-- where the run was blocked --');
  const totalBlocked = Object.values(rec.blockedTicks).reduce((a, b) => a + b, 0);
  for (const b of BLOCKERS) {
    const n = rec.blockedTicks[b];
    log(`  ${b.padEnd(11)} ${String(n).padStart(8)} ticks  ` +
      `(${rec.totalTicks ? (100 * n / rec.totalTicks).toFixed(1) : '0.0'}% of run)`);
  }
  log(`  ${'idle'.padEnd(11)} ${String(rec.idleTicks).padStart(8)} ticks  ` +
    `(${rec.totalTicks ? (100 * rec.idleTicks / rec.totalTicks).toFixed(1) : '0.0'}% of run — no research running)`);
  log(`  beam on     ${String(rec.beamOnTicks).padStart(8)} ticks  ` +
    `(${rec.totalTicks ? (100 * rec.beamOnTicks / rec.totalTicks).toFixed(1) : '0.0'}% of run)`);
  if (totalBlocked === 0 && rec.idleTicks > 0) {
    log('  NOTE: idle ticks with no blocker charged = lab gate or start refusal.');
  }

  log('\n-- spend --');
  log(`  income/tick ${money(rec.incomeRate).padStart(14)}  net of upkeep and refills, before research/expansion`);
  log(`  research    ${money(rec.researchSpent).padStart(14)}  of ${money(rec.researchTotalFunding)} in the tree`);
  log(`  expansion   ${money(rec.expansionSpent).padStart(14)}`);
  log(`  upkeep      ${money(rec.upkeepSpent).padStart(14)}`);
  log(`  refills     ${money(rec.refillSpent).padStart(14)}`);

  log('\n-- verdict --');
  if (rec.ladderStalled) {
    log(`  EXPANSION STALLED at "${rec.ladderStalled}" — the income curve past that point is not real.`);
  }
  if (!rec.finished) {
    log(`  UNFINISHED after ${rec.totalTicks.toLocaleString()} ticks. ` +
      `${rec.remainingNodes.length} nodes left: ${rec.remainingNodes.slice(0, 8).join(', ')}` +
      (rec.remainingNodes.length > 8 ? ', …' : ''));
  }
  const ratio = rec.totalTicks / PLAYTHROUGH_TARGET_TICKS;
  log(`  total ticks     ${rec.totalTicks.toLocaleString()}` + (rec.finished ? '' : ' (hit the cap)'));
  log(`  target          ${PLAYTHROUGH_TARGET_TICKS.toLocaleString()}`);
  log(`  ratio           ${ratio.toFixed(2)}x target ` +
    `— ${ratio > 1 ? `${ratio.toFixed(1)}x TOO SLOW` : `${(1 / ratio).toFixed(1)}x TOO FAST`}`);
  log(`  final funds     ${money(rec.finalFunding)}   rep ${rec.finalReputation.toFixed(1)}   ` +
    `data ${Math.round(rec.finalData).toLocaleString()}`);
  log(`  facility        ${rec.linesBuilt} beamlines, ${rec.hardwareNodes} billed hardware nodes`);
  log(`  lab tiers       ` + Object.entries(rec.labTiers)
    .map(([lab, tier]) => `${lab}=${tier}`).join(' ') +
    '  (tier 0 = depth-5+ research blocked outright, and 4x duration on the rest)');
  return rec;
}

/**
 * Sweep the expansion cap. The single biggest lever on run length is how much
 * hardware the player is allowed to build, because beam income is linear in
 * node count with no diminishing return — so one table is worth more to a tuner
 * than one number. `--sweep` prints it.
 */
export function runSweep({
  lineCounts = [0, 2, 4, 8, 16, 24], seed = 909, maxTicks = 120_000,
} = {}, log = console.log) {
  log(`\n=== D-sweep: run length vs how far the player is allowed to build (seed ${seed}) ===`);
  log(`target ${PLAYTHROUGH_TARGET_TICKS.toLocaleString()} ticks · ` +
    `tree costs ${money(RESEARCH_IDS.reduce((s, id) => s + (RESEARCH[id].cost.funding || 0), 0))}\n`);
  log('extra lines | tree done |    ticks | ratio | income/tick | blocked on');
  log('------------+-----------+----------+-------+-------------+------------');
  const out = [];
  for (const n of lineCounts) {
    const rec = runPlaythrough({ seed, maxTicks, maxLines: n, sampleEvery: 2000, expand: true });
    const worst = BLOCKERS
      .map(b => [b, rec.blockedTicks[b]])
      .sort((a, b) => b[1] - a[1])
      .filter(([, v]) => v > 0)
      .map(([b, v]) => `${b} ${(100 * v / Math.max(1, rec.totalTicks)).toFixed(0)}%`)
      .join(' ') || 'nothing';
    log(
      String(n).padStart(11) + ' | ' +
      `${RESEARCH_IDS.length - rec.remainingNodes.length}/${RESEARCH_IDS.length}`.padStart(9) + ' | ' +
      (rec.totalTicks.toLocaleString() + (rec.finished ? '' : '+')).padStart(8) + ' | ' +
      (rec.finished ? (rec.totalTicks / PLAYTHROUGH_TARGET_TICKS).toFixed(2) : '  --').padStart(5) + ' | ' +
      Math.round(rec.incomeRate).toLocaleString().padStart(11) + ' | ' +
      worst);
    out.push(rec);
  }
  return out;
}
