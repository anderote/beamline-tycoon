import { COMPONENTS } from '../data/components.js';
import { FLOORS, WALL_TYPES, DOOR_TYPES } from '../data/structure.js';
import { ZONES, ZONE_TIER_THRESHOLDS, ZONE_FURNISHINGS, itemMatchesZone } from '../data/facility.js';
import { RESEARCH, RESEARCH_PHYSICS_EFFECT_KEYS } from '../data/research.js';
import { PARAM_DEFS } from '../beamline/component-physics.js';
import { seedComponentParams } from '../beamline/component-params.js';
import { BeamPhysics } from '../beamline/physics.js';
import { buildPhysicsElements } from '../beamline/physics-payload.js';
import { makeDefaultBeamState } from '../beamline/BeamlineRegistry.js';
import { getBeamlineType } from '../data/beamline-types.js';
import { flattenPath } from '../beamline/flattener.js';
import { moduleBeamAxis, axisMatchesDirection } from '../beamline/module-axis.js';
import { BeamlineSystem, pipeRefund } from '../beamline/BeamlineSystem.js';
import { METRES_PER_SUB } from '../beamline/pipe-geometry.js';
import { UtilityLineSystem } from '../utility/UtilityLineSystem.js';
import { UtilityRegistry } from '../utility/registry.js';
import { SolveRunner } from '../utility/solve-runner.js';
import { UtilityGate, declaredSinkQualityFloor } from './utility-gate.js';
import {
  edgeKey, parseEdgeKey, findWallKey, findEdgeKey, isMirroredKey,
  clampDoorOff, defaultDoorOff, mirrorDoorOff,
} from './edge-keys.js';
import { getUtilityPortsV2 } from '../data/utility-ports-v2.js';
import { StaffMember } from './staff/StaffMember.js';
import { tickStaffMember, deriveStaffCounts, staffHireCost, createStaffMember } from './staff/staffSystem.js';
import { PROFESSIONS } from '../data/professions.js';

import { DECORATIONS, computeMoraleMultiplier, getReputationTier } from '../data/decorations.js';
import { PLACEABLES } from '../data/placeables/index.js';

import {
  computeSystemStats, computeTickIncomeBreakdown, computeBeamIncomeBreakdown,
  computeTickUpkeep,
} from './economy.js';
import {
  hardwareNodeCount, beamlineUptime, facilityUptime, billedDataRate,
} from './aggregates.js';
import * as research from './research.js';
import { checkObjectives } from './objectives.js';
import { findStackTarget, collapsePlan } from './stacking.js';
import { canPlace } from './placement.js';
import { generateStartingMap, generateAnnulus, DEFAULT_MAP_HALF_EXTENT } from './map-generator.js';
import { nextLandParcel } from '../data/land.js';
import { serializeCornerHeights, deserializeCornerHeights, setTileCorners } from './terrain.js';

// Every game.state key that persists in saves. Everything else on state is
// derived — occupancy/index maps, aggregate beam stats, morale, systemStats,
// nodeQualities, mainBeamState, ... — and is recomputed on load()/tick().
// When adding a state field, list it here unless it can be rebuilt from the
// others. Map-backed fields (cornerHeights, utilityLines, utilityNetworkState)
// are converted to entry arrays in serialize().
const SERIALIZED_FIELDS = [
  // resources / progression
  'resources', 'completedResearch', 'activeResearch', 'researchProgress',
  'completedObjectives', 'discoveries', 'tick', 'timeOfDay', 'paused', 'speed', 'log',
  'tutorialDismissed', 'welcomeSeen',
  // staff
  'staffCosts', 'staffMembers', 'staffNextId', 'staffCandidates',
  // world / terrain
  'seed', 'terrainSeed', 'terrainBlobs', 'mapHalfExtent', 'floors', 'cornerHeights',
  'zones', 'walls', 'doors',
  // facility + placement
  'facilityEquipment', 'facilityGrid', 'facilityNextId',
  'zoneFurnishings', 'zoneFurnishingSubgrids', 'zoneFurnishingNextId',
  'placeables', 'placeableNextId',
  'beamPipes', 'beamPipeNextId', 'placementNextId', 'placementMode',
  // utilities
  'utilityLines', 'utilityNextId', 'utilityNetworkState',
  // designer library
  'savedDesigns', 'savedDesignNextId',
];

// State the sim owns, which undo/redo must not rewind. The tick loop keeps
// running while the player builds, so restoring these from a snapshot taken
// N ticks ago would erase N ticks of clock, research, objectives, staff
// needs and log along with the build. `resources` is reconciled separately
// (see _syncResourceLedger): undo restores the snapshot's balance plus every
// non-gesture credit/debit since, so a build's cost comes back without also
// reclaiming the upkeep the facility paid while the build stood.
// `savedDesigns` is not sim state but is equally outside the undo model: the
// designer library saves/deletes outside any gesture (no commitGesture), so
// restoring it would silently destroy a design saved after the last snapshot
// (and resurrect one deleted after it).
const UNDO_PRESERVED_FIELDS = [
  'tick', 'timeOfDay', 'paused', 'speed', 'log',
  'activeResearch', 'researchProgress', 'completedResearch',
  'completedObjectives', 'discoveries',
  'staffCosts', 'staffMembers', 'staffNextId', 'staffCandidates',
  'savedDesigns', 'savedDesignNextId',
];

// Per-beamline sim accumulators on registry entries. Same rule as
// UNDO_PRESERVED_FIELDS, one level down: the registry snapshot has to be
// restored (entry creation/deletion is gesture state) but these fields are
// the sim's, not the gesture's. Rewinding componentHealth would make Ctrl+Z
// a free repair of the whole facility, and rewinding beamOnTicks under a
// preserved state.tick permanently corrupts uptimeFraction.
const BEAMSTATE_PRESERVED_FIELDS = [
  'componentHealth', 'beamOnTicks', 'continuousBeamTicks',
  'totalBeamHours', 'totalDataCollected', 'uptimeFraction',
];

// Stand-in log used while building an undo snapshot (see _snapshot).
const EMPTY_LOG = [];

// The state fields a Beamline Designer apply can touch, and therefore
// everything snapshotBeamlineState()/restoreBeamlineState() must round-trip.
// A deliberate subset of SERIALIZED_FIELDS: the plan places and removes
// junctions, draws/splices pipes and their placements, disturbs utility
// lines, and spends funding — nothing else. The id counters ride along so a
// rolled-back apply leaves no hole in id space, exactly as undo rewinds them.
// cornerHeights is in the list because placing a junction auto-flattens the
// terrain under its footprint (see _placePlaceableInner): without it, an apply
// that placed one junction and then failed on the next op rolled the junction
// back but left a permanent flat scar in the hillside where it briefly stood,
// with nothing on the map to explain it and no undo entry that predates it.
const BEAMLINE_TX_FIELDS = [
  'resources',
  'placeables', 'placeableNextId',
  'beamPipes', 'beamPipeNextId', 'placementNextId',
  'utilityLines', 'utilityNextId',
  'cornerHeights',
];

// Samples of net-per-tick kept for the economy panel's sparkline. Fixed, so a
// long game cannot grow the buffer; ~5 minutes of sim at 1 tick/s.
const ECONOMY_HISTORY_MAX = 300;

// Metres of dead s-axis inserted between independent source machines in
// state.beamline, so an element at the very start of machine B can never tie
// with the last envelope sample of machine A during nearest-s lookups.
const BEAM_GRAPH_SOURCE_GAP_M = 1;

// The single day/night clock. state.timeOfDay advances by 1/DAY_LENGTH_TICKS
// every tick (see tick(), near TICK_MS in the constructor), so at
// TICK_MS = 1000 this is a 4-minute day at 1x speed, scaling for free with
// game.state.speed since the tick interval itself is what speed scales.
// 240 is deliberately the period the sim already ran isNight on
// (`tick % 240`) before this refactor, so staff-needs pacing is unchanged.
// The renderer (ThreeRenderer._updateSunCycle) reads timeOfDay instead of
// keeping its own wall-clock sun — this is the one clock now.
export const DAY_LENGTH_TICKS = 240;

// tick() derives timeOfDay from state.tick as
// `((tick + TIME_OF_DAY_PHASE_OFFSET_TICKS) % DAY_LENGTH_TICKS) / DAY_LENGTH_TICKS`
// rather than accumulating `+= 1/DAY_LENGTH_TICKS` on every tick. The two
// are mathematically the same clock, but repeated float addition of
// 1/240 (not exactly representable in binary) drifts by the time it
// reaches the isNightAt boundaries — verified to land one tick early/late
// at ticks 120/240/360/... — which is exactly the phase shift this
// refactor promises not to introduce. Recomputing from the exact integer
// tick every time is immune to that: it lands on exactly 0.25/0.5/0.75 at
// the ticks that matter, because those quotients (60/240, 120/240,
// 180/240) are themselves exactly representable in binary. The offset is
// 1/4 of a day so a fresh game (tick 0) starts at timeOfDay 0.25 — the
// value that reproduces the pre-refactor `(tick % 240) >= 120` phase
// exactly (see the state.timeOfDay initializer and isNightAt below).
const TIME_OF_DAY_PHASE_OFFSET_TICKS = DAY_LENGTH_TICKS / 4;

// Pure: true for the half of the day centred on midnight. timeOfDay is a
// float in [0, 1) where 0 = midnight and 0.5 = noon.
export function isNightAt(timeOfDay) {
  return timeOfDay < 0.25 || timeOfDay >= 0.75;
}

// mulberry32 — small fast seeded PRNG. All sim randomness flows through
// game.rng so two Games built with the same seed evolve identically.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Game {
  constructor(registry, options = {}) {
    this.registry = registry;

    // Deterministic sim RNG. Only the seed is persisted (state.seed) — a
    // loaded game restarts the stream, it does not resume mid-stream.
    const seed = options.seed ?? Date.now();
    this.rng = mulberry32(seed);

    this.editingBeamlineId = null;
    this.selectedBeamlineId = null;

    // The New Beamline picker's answer, waiting for a source to be placed.
    // Registry entries are minted lazily by _ensureBeamlineForSourcePlaceable,
    // so the picker cannot hand its choice straight to createBeamline — it
    // parks it here and the next source placement consumes it, exactly once.
    // Deliberately NOT persisted: it is a half-finished gesture, not state.
    this.pendingBeamlineTypeId = null;

    // Dev mode — unlimited funding, ignores staff/build costs.
    // Persisted in localStorage, toggled via window.dev.enable() / .disable().
    this.devMode = (() => {
      try {
        if (typeof window !== 'undefined' && window.location?.search.includes('dev=1')) return true;
        return localStorage.getItem('beamlineTycoon.devMode') === '1';
      } catch (_) { return false; }
    })();

    // Sandbox mode — nothing is charged, but the balance is REAL. Distinct
    // from devMode, which pins funding at 1e12 and so hides what the facility
    // actually earns. Here income, upkeep accounting, research and every
    // physics consequence run normally and prices are still displayed; the
    // debits simply do not land. Persisted the same way devMode is.
    this.sandboxMode = (() => {
      try {
        if (typeof window !== 'undefined' && window.location?.search.includes('sandbox=1')) return true;
        return localStorage.getItem('beamlineTycoon.sandboxMode') === '1';
      } catch (_) { return false; }
    })();

    this.state = {
      // spares starts at 50 so a fresh facility can absorb a few repairs
      // before a machine shop exists. Nothing produces or consumes it yet —
      // machinists produce it and repairs consume it in a later plan.
      resources: { funding: 5000000, reputation: 0, data: 0, spares: 50 },
      beamline: [],    // aggregate of all beamline nodes (populated by _updateAggregateBeamline)
      completedResearch: [],
      activeResearch: null,
      researchProgress: 0,
      completedObjectives: [],
      discoveries: 0,
      tick: 0,
      // The single day/night clock — see DAY_LENGTH_TICKS/isNightAt above.
      // Matches what tick() computes for tick 0, i.e. 0.25 (dawn): the
      // value that reproduces the pre-refactor `(tick % 240) >= 120` phase
      // exactly (tick 0..119 day, 120..239 night, repeat).
      timeOfDay: TIME_OF_DAY_PHASE_OFFSET_TICKS / DAY_LENGTH_TICKS,
      // Tick-loop control. speed only changes real-time tick rate;
      // 1 tick = 1 sim-second at any speed, so tick-modulo logic is untouched.
      paused: false,
      speed: 1,        // 1 | 2 | 4
      log: [],
      // Staffing — counts are derived from staffMembers (RimWorld-like individuals)
      staff: Object.fromEntries(Object.keys(PROFESSIONS).map(id => [id, id === 'operator' ? 1 : 0])),
      staffCosts: Object.fromEntries(Object.keys(PROFESSIONS).map(id => [id, PROFESSIONS[id].baseSalary])), // $/tick — tuned for MVP drain
      staffMembers: [], // StaffMember[] — individual pawns
      staffNextId: 1,
      staffCandidates: [], // hiring pool (3 offered)
      // Half-side of the square map, in tiles: the site is
      // |col| <= mapHalfExtent, |row| <= mapHalfExtent. Saved, and growable —
      // the player buys it a parcel at a time (see buyLand and
      // src/data/land.js), because the top-tier machines are limited by
      // straight-run length rather than by money. Every map bound in the game
      // reads this; nothing holds a copy.
      mapHalfExtent: DEFAULT_MAP_HALF_EXTENT,
      // Infrastructure tiles (paths, concrete pads)
      floors: [],       // [{ type, col, row }]
      infraOccupied: {},        // "col,row" -> type
      // Per-corner terrain heights (RCT2-style). Sparse: absent tile = flat.
      cornerHeights: new Map(),   // "col,row" -> Int8Array(4): [nw, ne, se, sw]
      cornerHeightsRevision: 0,   // bumped by every mutation; renderer cache key
      // Zone overlays
      zones: [],                // [{ type, col, row }]
      zoneOccupied: {},         // "col,row" -> zoneType
      zoneConnectivity: {},     // zoneType -> { active: bool, tileCount: int, tier: int }
      // Facility equipment (off-beamline support systems)
      facilityEquipment: [],      // [{ id, type, col, row }]
      facilityGrid: {},           // "col,row" -> equipment id
      facilityNextId: 1,
      // Zone furnishings (purchasable items placed in zones)
      zoneFurnishings: [],           // [{ id, type, col, row, subCol, subRow, rotated }]
      zoneFurnishingSubgrids: {},    // "col,row" -> [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]]
      zoneFurnishingNextId: 1,
      // Derived (not saved): every placed item with a ZONE_FURNISHINGS def,
      // room furnishings AND lab equipment. Zone tiering + zone effects read
      // this; zoneFurnishings above is the furnishing-only render view.
      zoneItems: [],
      // Unified placement system
      placeables: [],              // [{ id, type, category, col, row, subCol, subRow, rotated, dir, params, cells }]
      placeableIndex: {},           // id -> index in placeables array
      subgridOccupied: {},          // "col,row,subCol,subRow" -> { id, category }
      placeableNextId: 1,
      // Beam pipe connections (drawn between module ports)
      beamPipes: [],                // [{ id, start: {junctionId, portName}|null, end: {junctionId, portName}|null, path: [{col,row}], subL, placements: [{id, type, position, params}] }]
      beamPipeNextId: 1,
      placementNextId: 0,           // monotonic id source for pipe placements (BeamlineSystem)
      placementMode: 'snap',        // 'snap' | 'insert' | 'replace' — current pipe-placement UX mode
      // Walls (per-tile edge-based, like RCT2 fences)
      walls: [],              // [{ type, col, row, edge }]  edge = 'n'|'e'|'s'|'w'
      wallOccupied: {},       // "col,row,edge" -> wallType
      // Doors (edge-based, like walls)
      doors: [],              // [{ type, col, row, edge }]  edge = 'e' | 's'
      doorOccupied: {},       // "col,row,edge" -> doorType
      // Utility network lines (per-utility independent drawable pipes)
      utilityLines: new Map(),
      utilityNextId: 1,
      utilityNetworkState: new Map(),
      utilityNetworkData: null,
      utilityNetworks: null,   // derived: discovery output published by solveRunner
      // System-level infrastructure stats (computed by computeSystemStats)
      systemStats: null,
      // What the last tick actually charged, and the net-per-tick window
      // behind it. Derived: written by tick(), never serialized (absent from
      // SERIALIZED_FIELDS), cleared on load. Read via getEconomySnapshot().
      economySnapshot: null,
      economyHistory: [],
      infraBlockers: [],          // blockers from solve-runner
      infraCanRun: true,          // true if no blockers
      // Saved beamline designs
      savedDesigns: [],
      savedDesignNextId: 1,
      // Designer session state (persisted for reload)
      designerState: null,
      // Tutorial
      tutorialDismissed: false,
    };

    this.listeners = [];
    // Event coalescing for batch mutations (see _batchEvents): while set,
    // emit() collects events here instead of dispatching them.
    this._eventBatch = null;
    // Pluggable save sections (see registerSerializer). key -> {save, load}
    this._serializers = new Map();
    this.tickInterval = null;
    this.TICK_MS = 1000;
    this._started = false;   // start() called and not stop()ped; pause keeps this true

    // Undo/redo stacks of full serialize() payloads (JSON strings, each
    // roughly the size of a save file). 20 deep is comfortably cheap —
    // even a large facility save is well under 1 MB, so worst case is a
    // few tens of MB of strings, and old snapshots are dropped past the cap.
    this._undoStack = [];
    this._redoStack = [];
    this._UNDO_MAX = 20;
    // Resource accounting for undo (see _syncResourceLedger): running total
    // of every credit/debit undo must NOT reverse, plus the balance as of
    // the last attribution boundary.
    this._resourceLedger = {};
    this._resourceMark = { ...this.state.resources };
    // Open-gesture nesting depth (see beginGesture). Only the outermost
    // gesture owns a snapshot; inner ones join it rather than pushing their
    // own, so a tool that calls a Game method which itself commits a gesture
    // still produces exactly one undo entry.
    this._gestureDepth = 0;

    // Reservoir top-ups charged since the last economy snapshot. Refills are
    // event costs, not per-tick ones, so they are booked when charged (see
    // chargeReservoirRefill) and swept into the next tick's snapshot.
    this._refillsCharged = 0;

    // Generate terrain brightness blobs (multimodal 2D gaussian)
    this.state.seed = seed;
    this.state.terrainSeed = seed;
    this.state.terrainBlobs = this._generateTerrainBlobs(this.state.terrainSeed);

    // Apply natural starter map (trees clumped on dark soil).
    const starter = generateStartingMap(
      this.state.terrainSeed, this.state.terrainBlobs, this.state.mapHalfExtent);
    this.state.floors = starter.floors;
    this.state.zones = starter.zones;
    this.state.walls = starter.walls;
    this.state.doors = starter.doors;
    this.state.placeables = starter.placeables;
    this.state.placeableNextId = starter.placeableNextId;
    this.state.cornerHeights = starter.cornerHeights;
    // Mirror starter floors (meadow wildgrass/tallgrass) into the
    // infraOccupied index. Placement code keys "is there already a floor
    // here?" off this map — leaving it empty made meadow tiles invisible to
    // replacement, so placing a pad left the grass floor entry (and its 3D
    // tufts) lingering under the new floor. Scenario load and deserialize
    // already rebuild this index; the fresh-map path must too.
    for (const tile of this.state.floors)
      this.state.infraOccupied[tile.col + ',' + tile.row] = tile.type;
    this._rebuildPlaceableIndex();

    // Dev-only shape-invariant check: catches any lingering legacy pipe shape
    // (pre-B2 migration). Warn only — don't hard-throw because old saves from
    // localStorage may still reach this point.
    if (this.state?.beamPipes) {
      for (const p of this.state.beamPipes) {
        if ('fromId' in p || 'toId' in p || 'attachments' in p) {
          console.warn('[Game] Pipe with legacy shape:', p.id);
        }
      }
    }

    // BeamlineSystem owns mutations for junctions, pipes, and pipe-placements.
    // skipBeamlineRoute on placePlaceable avoids recursion back into the
    // role-based routing branch in _placePlaceableInner.
    this.beamline = new BeamlineSystem({
      state: this.state,
      emit: this.emit.bind(this),
      log: this.log.bind(this),
      spend: this.spend.bind(this),
      canAfford: this.canAfford.bind(this),
      isUnlocked: this.isComponentUnlocked.bind(this),
      placePlaceable: (opts) => this._placePlaceableInner(opts, { skipBeamlineRoute: true }),
      removePlaceable: (id) => this._removePlaceableRaw(id),
      movePlaceable: (id, pose) => this.movePlaceable(id, pose),
      // Late-bound: utilityLineSystem is constructed just below.
      onPlacementRemoved: (id) => this.utilityLineSystem?.onPlaceableRemoved(id),
      nextPipeId: () => 'bp_' + this.state.beamPipeNextId++,
      nextPlacementId: () => 'pl_' + (this.state.placementNextId = (this.state.placementNextId || 0) + 1),
    });

    // UtilityLineSystem owns mutations for state.utilityLines (new-system
    // utility lines with v2 port schema). Emits 'utilityLinesChanged' on
    // every successful add/remove so the 3D renderer can rebuild meshes.
    this.utilityLineSystem = new UtilityLineSystem({
      state: this.state,
      emit: this.emit.bind(this),
      log: this.log.bind(this),
      nextLineId: () => 'ul_' + (this.state.utilityNextId = (this.state.utilityNextId || 1) + 1),
    });

    // SolveRunner computes per-network flow state each tick. Network
    // discovery is cached on a topology revision: the listener below bumps it
    // on every topology mutation seam, and load/undo/redo bump it in
    // _applyState (they replace state.utilityLines wholesale).
    this.solveRunner = new SolveRunner({
      state: this.state,
      registry: UtilityRegistry,
    });

    // Topology-dirty seam. All utilityLines mutations flow through
    // UtilityLineSystem (addLine / removeLine / onPlaceableRemoved), which
    // emits 'utilityLinesChanged'; all placeable mutations flow through
    // _placePlaceableInner / removePlaceable / _removePlaceableRaw, which emit
    // 'placeableChanged'; every pipe/placement mutation in BeamlineSystem
    // emits 'beamlineChanged'. On-pipe placements are utility endpoints too
    // (utility/utility-endpoints.js), so a pipe edit changes the utility
    // topology just like a placeable does — without this the discovery cache
    // kept serving a network that still carried a deleted placement's demand.
    // All three are user-action-rate, so bumping on every one of them costs at
    // most one extra discovery per action.
    //
    // 'beamlineChanged' also schedules the per-beamline physics recalc. Pipe
    // draw/extend/remove and on-pipe placement changes previously only reached
    // _recalcMainBeamGraph (state.mainBeamState), never _recalcSingleBeamline,
    // so every registry entry's beamState — the thing _tickBeamline bills
    // income and data off — stayed frozen at its makeDefaultBeamState() values
    // for the rest of the session.
    this.on((event) => {
      if (event === 'utilityLinesChanged' || event === 'placeableChanged'
          || event === 'beamlineChanged') {
        this.solveRunner.markTopologyDirty();
      }
      if (event === 'beamlineChanged') {
        this.schedulePhysicsRecalc();
      }
    });

    // UtilityGate wraps the per-tick solve with the gating policy (unconnected
    // sinks, staffing, infraBlockers, nodeQualities). rng is a delegating
    // closure — load() reassigns this.rng, so don't capture the function.
    this.utilityGate = new UtilityGate({
      state: this.state,
      solveRunner: this.solveRunner,
      getPorts: getUtilityPortsV2,
      rng: () => this.rng(),
      log: (msg, kind) => this.log(msg, kind),
    });
    // Signature of the nodeQualities the last full physics pass was built
    // against (see _syncPhysicsToNodeQualities). '' is the signature of "no
    // solved qualities at all", so a world with nothing to propagate never
    // triggers a first-tick recalc.
    this._nodeQualitySig = '';

    // RimWorld-like staff: seed one operator pawn if none exists
    this._ensureStaffSeed();
  }

  _ensureStaffSeed() {
    if (!this.state.staffMembers) this.state.staffMembers = [];
    if (this.state.staffMembers.length === 0) {
      const m = createStaffMember('operator', `staff_${this.state.staffNextId++}`, this.state.tick, this.rng);
      m.assignment.zoneId = 'controlRoom';
      this.state.staffMembers.push(m);
      this.state.staff = deriveStaffCounts(this.state.staffMembers);
      // seed hiring pool
      this._refreshStaffCandidates();
    }
  }

  _refreshStaffCandidates() {
    const professions = Object.keys(PROFESSIONS);
    this.state.staffCandidates = [];
    for (let i = 0; i < 3; i++) {
      const profession = professions[Math.floor(this.rng() * professions.length)];
      const m = createStaffMember(profession, `cand_${this.state.staffNextId++}`, this.state.tick, this.rng);
      // candidates are not yet in staffMembers
      this.state.staffCandidates.push(m);
    }
  }

  // Rebuild placeableIndex + subgridOccupied from current state.placeables.
  // Shared by applyScenario and the starter-map wiring.
  _rebuildPlaceableIndex() {
    this.state.placeableIndex = {};
    this.state.subgridOccupied = {};
    for (let i = 0; i < this.state.placeables.length; i++) {
      const entry = this.state.placeables[i];
      this.state.placeableIndex[entry.id] = i;
      if (entry.cells && !entry.stackParentId) {
        for (const cell of entry.cells) {
          this.state.subgridOccupied[cell.col + ',' + cell.row + ',' + cell.subCol + ',' + cell.subRow] = { id: entry.id, kind: entry.kind, category: entry.category };
        }
      }
    }
  }

  _generateTerrainBlobs(seed) {
    // Seeded PRNG (simple LCG)
    let s = seed | 0;
    const rand = () => { s = (s * 1664525 + 1013904223) | 0; return (s >>> 0) / 4294967296; };
    const blobs = [];
    // Large slow-rolling blobs (broad landscape variation). These drive the
    // backbone of elevation AND color — boosted so dark patterns dominate.
    const largeCt = 8 + Math.floor(rand() * 6);
    for (let i = 0; i < largeCt; i++) {
      blobs.push({
        cx: (rand() - 0.5) * 200,
        cy: (rand() - 0.5) * 200,
        sx: 15 + rand() * 30,
        sy: 15 + rand() * 30,
        angle: rand() * Math.PI,
        brightness: (rand() * 2 - 1) * 1.2,
      });
    }
    // Medium blobs (patches of lighter/darker grass)
    const medCt = 14 + Math.floor(rand() * 8);
    for (let i = 0; i < medCt; i++) {
      blobs.push({
        cx: (rand() - 0.5) * 160,
        cy: (rand() - 0.5) * 160,
        sx: 5 + rand() * 12,
        sy: 5 + rand() * 12,
        angle: rand() * Math.PI,
        brightness: (rand() * 2 - 1) * 1.7,
      });
    }
    // Small tight blobs (individual spots, puddles of color)
    const smallCt = 20 + Math.floor(rand() * 14);
    for (let i = 0; i < smallCt; i++) {
      blobs.push({
        cx: (rand() - 0.5) * 140,
        cy: (rand() - 0.5) * 140,
        sx: 2 + rand() * 5,
        sy: 2 + rand() * 5,
        angle: rand() * Math.PI,
        brightness: (rand() * 2 - 1) * 2.0,
      });
    }
    return blobs;
  }

  // === LAND ===

  /** The parcel currently on offer, or null once the ladder runs out. The UI
   *  reads this to price the button; buyLand re-derives it rather than trusting
   *  a caller-supplied parcel. */
  getNextLandParcel() {
    return nextLandParcel(this.state.mapHalfExtent);
  }

  /**
   * Buy the next parcel of land, growing the map by 60 tiles per side.
   *
   * The map is the one constraint the player cannot engineer around. A linear
   * collider must not bend — synchrotron loss goes as E^4/rho, so folding the
   * beam radiates away the energy the last thirty placements bought it — which
   * means the tier-5 and tier-6 machines are limited by how long a straight
   * line the site can hold, not by money-for-hardware. Selling that ground is
   * how the late game gets a cash sink that buys progress.
   *
   * The new ring's terrain is generated here and kept in placeables like any
   * other decoration; only `mapHalfExtent` is a new saved field. generateAnnulus
   * is position-hashed off terrainSeed precisely so this cannot disturb what is
   * already on the ground — see the note above it.
   *
   * Runs inside a gesture so the purchase is one undo entry: the extent and the
   * ground that arrived with it rewind together, or neither does. Returns
   * `{ ok, reason?, parcel? }` — the caller is a button that has to say why.
   */
  buyLand() {
    const parcel = this.getNextLandParcel();
    if (!parcel) return { ok: false, reason: 'There is no more land to buy.' };
    if (!this.canAfford({ funding: parcel.cost })) {
      return { ok: false, reason: `${parcel.name} costs $${parcel.cost.toLocaleString()}.` };
    }
    return this.commitGesture({ mutate: () => this._buyLandInner(parcel) });
  }

  _buyLandInner(parcel) {
    const from = this.state.mapHalfExtent;
    // Charged through chargeConstruction like every other build-time debit, so
    // sandbox mode has exactly one place to suppress (see setSandboxMode).
    this.chargeConstruction(parcel.cost);
    const { placeables, placeableNextId } = generateAnnulus(
      this.state.terrainSeed, this.state.terrainBlobs,
      from, parcel.halfExtent, this.state.placeableNextId,
    );
    this.state.placeables.push(...placeables);
    this.state.placeableNextId = placeableNextId;
    this.state.mapHalfExtent = parcel.halfExtent;
    // The new decorations have to reach subgridOccupied, or the player can
    // build straight through the trees that just appeared.
    this._rebuildPlaceableIndex();
    this.log(`${parcel.name} — the site is now ${parcel.tilesPerSide}×${parcel.tilesPerSide} tiles.`, 'good');
    this.emit('mapExpanded');
    // Two events because two things changed and the renderer rebuilds them
    // from different handlers: the ground itself is wider
    // ('infrastructureChanged' → _refreshTerrain) and there are trees on it
    // that were not there a frame ago ('decorationsChanged').
    this.emit('infrastructureChanged');
    this.emit('decorationsChanged');
    this.emit('resourcesChanged');
    return { ok: true, parcel };
  }

  /** Subscribe to game events. Returns an unsubscribe function. */
  on(fn) { this.listeners.push(fn); return () => this.off(fn); }
  off(fn) {
    const idx = this.listeners.indexOf(fn);
    if (idx !== -1) this.listeners.splice(idx, 1);
  }
  emit(event, data) {
    if (this._eventBatch) { this._eventBatch.set(event, data); return; }
    this.listeners.forEach(fn => fn(event, data));
  }

  /**
   * Coalesce emits while `fn` runs. Per-tile helpers (removeInfraTile,
   * removeZoneTile, removePlaceable, ...) each emit their own events, so a
   * rect sweep would otherwise trigger a full renderer rebuild per tile.
   * Events are deduped by name (last data wins, first-seen order) and
   * dispatched once after `fn` returns. Nested calls flush at the outermost
   * batch. Listeners re-read state, so dedup is safe: log lines still land
   * in state.log, and the UI re-renders from state on the single dispatch.
   */
  _batchEvents(fn) {
    if (this._eventBatch) return fn(); // nested — outer batch flushes
    this._eventBatch = new Map();
    let result;
    try {
      result = fn();
    } finally {
      const batch = this._eventBatch;
      this._eventBatch = null;
      for (const [event, data] of batch) this.emit(event, data);
    }
    return result;
  }

  log(msg, type = '') {
    this.state.log.unshift({ msg, type, tick: this.state.tick });
    if (this.state.log.length > 100) this.state.log.length = 100;
    this.emit('log', { msg, type });
  }

  setDevMode(on) {
    this.devMode = !!on;
    try { localStorage.setItem('beamlineTycoon.devMode', this.devMode ? '1' : '0'); } catch (_) {}
    if (this.devMode) {
      this.state.resources.funding = 1e12;
      this.log('DEV MODE ON — unlimited funding', 'good');
    } else {
      this.log('DEV MODE OFF', '');
    }
    this.emit('resourcesChanged');
  }

  // === UNDO / GESTURES ===

  // Undo works on full-state snapshots: a gesture captures _snapshot()
  // (everything a save captures — placeables, beamPipes, terrain, utility
  // lines, registry, ... — minus the log and the host aux sections), and
  // undo()/redo() restore it via restoreSnapshot(). Every user gesture that
  // mutates the world goes through commitGesture()/beginGesture(), which are
  // the ONLY places allowed to touch the undo stacks; Game mutation methods
  // never push (they also run programmatically from scenario generation,
  // BeamlineSystem, load).
  //
  // These parts of the payload are deliberately not restored:
  //   - the message log (snapshots are taken log-free, see _snapshot)
  //   - sim progress (UNDO_PRESERVED_FIELDS + the resource ledger below,
  //     plus BEAMSTATE_PRESERVED_FIELDS on each registry entry)
  //   - the RNG stream position (see _applyState) — rewinding it would let
  //     undo/redo re-roll wear failures and discoveries
  //   - the designer library (savedDesigns), which is saved outside any
  //     gesture and so has no undo entry of its own

  /**
   * Snapshot payload for the undo stacks, and the thing gestures diff to
   * decide whether anything happened. Everything non-semantic is left out,
   * because anything in here is both stored AND compared:
   *   - the message log: Ctrl+Z must not delete log lines, and leaving it in
   *     made every logged rejection ("Need $252 for 9 tiles!") read as a
   *     mutation;
   *   - the host aux sections (camera, probe pins, designer session):
   *     restoreSnapshot deliberately never dispatches them, so they are dead
   *     weight in the payload, and a gesture that only moved the camera or
   *     closed the designer session read as a mutation.
   */
  _snapshot() {
    return this.serialize({ includeLog: false, includeAux: false });
  }

  /** An undo/redo stack entry: the snapshot plus the resource ledger it was
   *  taken against (see _syncResourceLedger). */
  _makeUndoEntry() {
    return {
      payload: this._snapshot(),
      ledger: { ...this._resourceLedger },
      // The New Beamline pick is session intent, not saved-game state, so it
      // is deliberately absent from serialize() — but it still has to rewind.
      // _ensureBeamlineForSourcePlaceable consumes it the moment a source
      // lands, and a placement that then fails and rolls back used to leave it
      // spent: the retry minted an UNTYPED beamline, with an unfiltered
      // palette, from one misclick. Carrying it on the entry keeps it out of
      // the save file and still restores it with the state it belonged to.
      pendingBeamlineTypeId: this.pendingBeamlineTypeId,
    };
  }

  /**
   * Fold resource drift since the last mark into _resourceLedger — the
   * running total of credits/debits undo must NOT reverse (tick income and
   * upkeep, hires, research spend). Called at every point where attribution
   * can change: gesture start and undo/redo.
   */
  _syncResourceLedger() {
    const res = this.state.resources || {};
    for (const k of new Set([...Object.keys(res), ...Object.keys(this._resourceMark)])) {
      this._resourceLedger[k] = (this._resourceLedger[k] || 0)
        + ((res[k] || 0) - (this._resourceMark[k] || 0));
    }
    this._resourceMark = { ...res };
  }

  /** Attribute the resource drift since the mark to the gesture that just
   *  ended (drop it from the ledger) rather than to the simulation. */
  _closeUndoGesture() {
    this._resourceMark = { ...this.state.resources };
  }

  /** Push a completed gesture's snapshot. The one place that writes the
   *  undo stack; a new gesture always invalidates redo. */
  _pushUndoEntry(entry) {
    this._undoStack.push(entry);
    if (this._undoStack.length > this._UNDO_MAX) this._undoStack.shift();
    this._redoStack.length = 0;
  }

  /**
   * Open a gesture: take the "before" snapshot and mark the resource
   * attribution boundary. Returns a handle:
   *
   *   commit()  — push the snapshot iff semantic state actually changed
   *   abandon() — close without pushing
   *
   * Nested opens join the outer gesture — the inner handle is inert — so a
   * tool path that calls a Game method which itself opens a gesture still
   * produces exactly one undo entry for the one user action.
   */
  beginGesture() {
    if (this._gestureDepth > 0) {
      this._gestureDepth++;
      const close = () => { this._gestureDepth--; return false; };
      return { commit: close, abandon: close, nested: true };
    }
    this._gestureDepth = 1;
    this._syncResourceLedger();
    const entry = this._makeUndoEntry();
    let closed = false;
    const end = (push) => {
      if (closed) return false;
      closed = true;
      this._gestureDepth = 0;
      const changed = push && this._snapshot() !== entry.payload;
      if (changed) this._pushUndoEntry(entry);
      // Everything spent between open and close belongs to this gesture, not
      // to the ledger, so undo refunds it.
      this._closeUndoGesture();
      return changed;
    };
    return {
      commit: () => end(true),
      abandon: () => end(false),
      nested: false,
    };
  }

  /**
   * The single entry point for a mutating user gesture. It owns the ordering
   * the input layer kept getting wrong, in this order and no other:
   *
   *   1. validate — runs before anything is charged, mutated or snapshotted.
   *      Return false / { ok: false, reason } to reject; a `reason` string is
   *      logged. A rejected gesture charges nothing, mutates nothing, pushes
   *      no undo entry and leaves the redo stack alone.
   *   2. charge  — `cost` is deducted exactly once, here, and only for
   *      mutations that do NOT price themselves (most Game.place* methods
   *      do; passing `cost` for those double-charges). Refunded if the
   *      mutation then reports failure.
   *   3. mutate  — the state change.
   *   4. snapshot — pushed only if step 3 changed semantic state, so a
   *      gesture that did nothing can neither evict real undo history nor
   *      clobber the redo stack.
   *
   * Returns the mutation's result, or undefined when the gesture was
   * rejected before it ran.
   *
   * @param {object}   spec
   * @param {function} [spec.validate] () => boolean | { ok, reason }
   * @param {object|function} [spec.cost] resource cost, or () => cost
   * @param {function} spec.mutate   () => result
   * @param {function} [spec.failed] (result) => boolean; drives the refund
   */
  commitGesture({ validate, cost, mutate, failed } = {}) {
    if (typeof mutate !== 'function') return undefined;

    // 1. Validate.
    if (typeof validate === 'function') {
      const v = validate();
      const ok = (v != null && typeof v === 'object') ? v.ok !== false : !!v;
      if (!ok) {
        const reason = (v && typeof v === 'object') ? v.reason : null;
        if (reason) this.log(reason, 'bad');
        return undefined;
      }
    }

    // 2. Charge — before the mutation, exactly once, and never twice for the
    //    same gesture (a nested commitGesture charges its own cost only).
    const costs = typeof cost === 'function' ? cost() : cost;
    if (costs) {
      if (!this.canAfford(costs)) {
        this.log('Insufficient funds!', 'bad');
        return undefined;
      }
    }

    const gesture = this.beginGesture();
    let result;
    let refund = !!costs;   // cleared once the mutation reports success
    try {
      if (costs) this.spend(costs);
      result = mutate();
      const didFail = typeof failed === 'function'
        ? failed(result)
        : (result === false || result === null);
      refund = refund && didFail;
    } finally {
      // 3b. The mutation refused (or threw) after being charged — give it
      //     back before the snapshot diff runs, so the gesture is a no-op.
      if (refund) {
        for (const [r, a] of Object.entries(costs)) this.state.resources[r] += a;
      }
      // 4. Snapshot.
      gesture.commit();
    }
    return result;
  }

  /**
   * Shorthand for the degenerate gesture — no separate validation step, no
   * caller-supplied cost (the mutation prices itself). Exactly equivalent to
   * commitGesture({ mutate: fn }); kept because most commit paths and the
   * UI layer have nothing to validate.
   */
  _withUndo(fn) {
    return this.commitGesture({ mutate: fn });
  }

  undo() {
    if (this._undoStack.length === 0) {
      this.log('Nothing to undo', 'info');
      return;
    }
    this._syncResourceLedger();
    const entry = this._undoStack.pop();
    this._redoStack.push(this._makeUndoEntry());
    this.restoreSnapshot(entry);
    this.log('Undo', 'info');
  }

  redo() {
    if (this._redoStack.length === 0) {
      this.log('Nothing to redo', 'info');
      return;
    }
    this._syncResourceLedger();
    const entry = this._redoStack.pop();
    // Push directly, not via _pushUndoEntry — that clears the redo stack.
    this._undoStack.push(this._makeUndoEntry());
    this.restoreSnapshot(entry);
    this.log('Redo', 'info');
  }

  // === PLACEMENT ===

  /**
   * Sandbox mode: build anything without being charged for it.
   *
   * Deliberately narrow — it suppresses SPENDING only. Income, upkeep,
   * research, reputation and every physics consequence still run exactly as in
   * a normal game, and prices are still displayed, because the point is to
   * design machines without the capital grind rather than to disable the
   * economy. Upkeep is not exempt: a sandbox facility still pays its
   * electricity bill, so an over-provisioned build still reads as expensive.
   */
  setSandboxMode(on) {
    this.sandboxMode = !!on;
    try { localStorage.setItem('beamlineTycoon.sandboxMode', this.sandboxMode ? '1' : '0'); } catch (_) {}
    this.log(this.sandboxMode
      ? 'SANDBOX MODE ON — nothing is charged. Income still accrues.'
      : 'SANDBOX MODE OFF — costs are charged normally.', 'good');
    this.emit('resourcesChanged');
  }

  canAfford(costs) {
    if (this.sandboxMode) return true;
    for (const [r, a] of Object.entries(costs))
      if ((this.state.resources[r] || 0) < a) return false;
    return true;
  }

  spend(costs) {
    if (this.sandboxMode) return;
    for (const [r, a] of Object.entries(costs)) this.state.resources[r] -= a;
  }

  /**
   * Charge a construction cost in funding. Every build-time funding debit goes
   * through here rather than writing `resources.funding -=` directly, so
   * sandbox mode has ONE place to suppress and cannot be leaked by a code path
   * that decrements the balance itself. Recurring upkeep deliberately does NOT
   * use this — see setSandboxMode.
   */
  chargeConstruction(amount) {
    if (this.sandboxMode) return;
    this.state.resources.funding -= amount;
  }

  /**
   * Charge a reservoir top-up (the UtilityInspector Refill button). Event
   * cost rather than per-tick upkeep, so it is recorded here — at the one
   * place it is charged — and swept into the next tick's snapshot under
   * upkeep.refills. Anything that pays for a refill must go through this, or
   * the panel reports a cost the player never paid, or misses one they did.
   */
  chargeReservoirRefill(costs) {
    this.spend(costs);
    this._refillsCharged += (costs?.funding || 0);
  }

  isComponentUnlocked(comp) {
    if (comp.unlocked) return true;
    if (!comp.requires) return true;   // no requirement = available by default
    if (Array.isArray(comp.requires)) {
      return comp.requires.every(req => this.state.completedResearch.includes(req));
    }
    return this.state.completedResearch.includes(comp.requires);
  }

  // === FLOORS ===

  placeInfraTile(col, row, infraType, variant = 0) {
    const infra = FLOORS[infraType];
    if (!infra) return false;
    const key = col + ',' + row;
    const existing = this.state.infraOccupied[key];
    // For orientable tiles of the same type, toggle orientation for free
    if (existing === infraType && infra.orientable) {
      const existingTile = this.state.floors.find(t => t.col === col && t.row === row);
      if (existingTile) {
        existingTile.orientation = existingTile.orientation ? 0 : 1;
        this.emit('infrastructureChanged');
      }
      return true;
    }
    // Same type but different variant — update variant for free
    if (existing === infraType) {
      const existingTile = this.state.floors.find(t => t.col === col && t.row === row);
      if (existingTile && existingTile.variant !== variant) {
        existingTile.variant = variant;
        this.emit('infrastructureChanged');
      }
      return true;
    }
    // Check foundation requirement
    if (infra.requiresFoundation) {
      const existingTile = this.state.floors.find(t => t.col === col && t.row === row);
      const baseType = existingTile?.foundation || existing;
      if (baseType !== infra.requiresFoundation) {
        this.log(`${infra.name} requires ${FLOORS[infra.requiresFoundation]?.name || infra.requiresFoundation}!`, 'bad');
        return false;
      }
    }
    // Auto-remove any decoration (including trees) — include removal cost.
    // Destruction, not dismantle: skip the normal 50% refund.
    // Surfaces flagged `preservesDecorations` (natural grass variants) place
    // under trees instead of clearing them.
    const tileCost = infra.variantCosts?.[variant] ?? infra.cost;
    let totalCost = tileCost;
    const existingDec = infra.preservesDecorations ? null : this._decorationAtTile(col, row);
    if (existingDec) {
      const def = DECORATIONS[existingDec.type];
      totalCost += def ? (def.removeCost || 0) : 0;
    }
    if (this.state.resources.funding < totalCost) return false;
    if (existingDec) this.removeDecoration(col, row, { skipRefund: true });
    // Track foundation for surface tiles placed on top of a foundation
    let foundation = null;
    if (infra.requiresFoundation && existing) {
      const existingTile = this.state.floors.find(t => t.col === col && t.row === row);
      foundation = existingTile?.foundation || existing;
    }
    if (existing) {
      // Replace existing floor - remove old tile first
      this.state.floors = this.state.floors.filter(
        t => !(t.col === col && t.row === row)
      );
      // Remove zone on this tile since floor is changing
      const hadZone = this.state.zoneOccupied?.[key];
      if (hadZone) {
        delete this.state.zoneOccupied[key];
        this.state.zones = this.state.zones.filter(z => !(z.col === col && z.row === row));
      }
    }

    this.chargeConstruction(totalCost);
    const tileEntry = { type: infraType, col, row, variant };
    if (foundation) tileEntry.foundation = foundation;
    this.state.floors.push(tileEntry);
    this.state.infraOccupied[key] = infraType;
    // Concrete pad excavates hills / fills hollows to y=0 under its footprint.
    if (infraType === 'concrete') {
      setTileCorners(this.state, col, row, { nw: 0, ne: 0, se: 0, sw: 0 });
    }
    if (infraType === 'hallway') {
      this.recomputeZoneConnectivity();
    }
    this.validateInfrastructure();
    return true;
  }

  /**
   * Cost-only computation for a rectangular infra drag. Returns
   * { newTiles, totalCost, skippedNoFoundation } so the UI can show cost
   * during drag without mutating state. Shares logic with placeInfraRect.
   */
  computeInfraRectCost(startCol, startRow, endCol, endRow, infraType, variant = 0) {
    const infra = FLOORS[infraType];
    if (!infra) return { newTiles: 0, totalCost: 0, skippedNoFoundation: 0 };
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    const tileCost = infra.variantCosts?.[variant] ?? infra.cost;
    let totalCost = 0;
    let newTiles = 0;
    let skippedNoFoundation = 0;
    for (let c = minCol; c <= maxCol; c++) {
      for (let r = minRow; r <= maxRow; r++) {
        const tileKey = c + ',' + r;
        const existing = this.state.infraOccupied[tileKey];
        // Same type + same variant: skip entirely (no cost, no action).
        if (existing === infraType && !infra.orientable) {
          const existingTile = this.state.floors.find(t => t.col === c && t.row === r);
          if (!existingTile || existingTile.variant === variant) continue;
          newTiles++;
          continue;
        }
        if (existing === infraType && infra.orientable) { newTiles++; continue; }
        if (infra.requiresFoundation) {
          const existingTile = this.state.floors.find(t => t.col === c && t.row === r);
          const baseType = existingTile?.foundation || existing;
          if (baseType !== infra.requiresFoundation) { skippedNoFoundation++; continue; }
        }
        newTiles++;
        totalCost += tileCost;
        if (!infra.preservesDecorations) {
          const existingDec = this._decorationAtTile(c, r);
          if (existingDec) {
            const def = DECORATIONS[existingDec.type];
            totalCost += def ? (def.removeCost || 0) : 0;
          }
        }
      }
    }
    return { newTiles, totalCost, skippedNoFoundation };
  }

  /**
   * Cost-only computation for a line (hallway) placement. Returns
   * { newTiles, totalCost, skippedNoFoundation }.
   */
  computeInfraLineCost(path, infraType, variant = 0) {
    const infra = FLOORS[infraType];
    if (!infra || !path || path.length === 0) return { newTiles: 0, totalCost: 0, skippedNoFoundation: 0 };
    const tileCost = infra.variantCosts?.[variant] ?? infra.cost;
    let totalCost = 0;
    let newTiles = 0;
    let skippedNoFoundation = 0;
    const seen = new Set();
    for (const pt of path) {
      const k = pt.col + ',' + pt.row;
      if (seen.has(k)) continue;
      seen.add(k);
      const existing = this.state.infraOccupied[k];
      if (existing === infraType) {
        const existingTile = this.state.floors.find(t => t.col === pt.col && t.row === pt.row);
        if (!existingTile || existingTile.variant === variant) continue;
        newTiles++;
        continue;
      }
      if (infra.requiresFoundation) {
        const existingTile = this.state.floors.find(t => t.col === pt.col && t.row === pt.row);
        const baseType = existingTile?.foundation || existing;
        if (baseType !== infra.requiresFoundation) { skippedNoFoundation++; continue; }
      }
      newTiles++;
      totalCost += tileCost;
    }
    return { newTiles, totalCost, skippedNoFoundation };
  }

  placeInfraRect(startCol, startRow, endCol, endRow, infraType, variant = 0, orientationOverride = null) {
    const infra = FLOORS[infraType];
    if (!infra) return false;

    const tileCostForVariant = infra.variantCosts?.[variant] ?? infra.cost;

    // Orientable tiles: use the caller's override (F-key rotation) if given,
    // otherwise auto-detect from the drag rectangle's aspect ratio.
    const orientation = infra.orientable
      ? (orientationOverride != null
          ? orientationOverride
          : (Math.abs(endCol - startCol) >= Math.abs(endRow - startRow) ? 0 : 1))
      : 0;

    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);

    const { newTiles, totalCost, skippedNoFoundation } = this.computeInfraRectCost(
      startCol, startRow, endCol, endRow, infraType, variant,
    );
    if (newTiles === 0) {
      if (skippedNoFoundation > 0) {
        this.log(`${infra.name} requires ${FLOORS[infra.requiresFoundation]?.name || infra.requiresFoundation}!`, 'bad');
      }
      return true;
    }
    if (this.state.resources.funding < totalCost) {
      this.log(`Need $${totalCost} for ${newTiles} tiles!`, 'bad');
      return false;
    }

    // Place all tiles. Batched: paving over a grove removes one decoration
    // per tile, and each removal emits 'placeableChanged' — which costs the
    // renderer a full teardown + rebuild of every decoration group. Mirrors
    // removeInfraRect's sweep; the post-loop 'infrastructureChanged' is
    // deduped into the same single dispatch.
    let placed = 0;
    this._batchEvents(() => {
      for (let c = minCol; c <= maxCol; c++) {
        for (let r = minRow; r <= maxRow; r++) {
          const key = c + ',' + r;
          const existing = this.state.infraOccupied[key];
          // Same-type orientable: just update orientation for free
          if (existing === infraType && infra.orientable) {
            const existingTile = this.state.floors.find(t => t.col === c && t.row === r);
            if (existingTile) existingTile.orientation = orientation;
            placed++;
            continue;
          }
          // Same type — update variant for free if it differs, otherwise skip
          if (existing === infraType) {
            const existingTile = this.state.floors.find(t => t.col === c && t.row === r);
            if (existingTile && existingTile.variant !== variant) {
              existingTile.variant = variant;
              placed++;
            }
            continue;
          }
          if (infra.requiresFoundation) {
            const existingTile = this.state.floors.find(t => t.col === c && t.row === r);
            const baseType = existingTile?.foundation || existing;
            if (baseType !== infra.requiresFoundation) continue;
          }
          // Auto-remove any decoration (including trees). Charge the tree's
          // removeCost on top of the tile cost; destruction skips the normal
          // 50% refund so the actual spend matches the preview total.
          // Natural grass variants set preservesDecorations: trees stay.
          let perTileExtra = 0;
          const existingDec = infra.preservesDecorations ? null : this._decorationAtTile(c, r);
          if (existingDec) {
            const decDef = DECORATIONS[existingDec.type];
            perTileExtra = decDef ? (decDef.removeCost || 0) : 0;
            this.removeDecoration(c, r, { skipRefund: true });
          }
          // Track foundation for surface tiles
          let foundation = null;
          if (infra.requiresFoundation && existing) {
            const existingTile = this.state.floors.find(t => t.col === c && t.row === r);
            foundation = existingTile?.foundation || existing;
          }
          if (existing) {
            // Replace existing floor - remove old tile
            this.state.floors = this.state.floors.filter(
              t => !(t.col === c && t.row === r)
            );
            // Remove zone on this tile since floor is changing
            if (this.state.zoneOccupied?.[key]) {
              delete this.state.zoneOccupied[key];
              this.state.zones = this.state.zones.filter(z => !(z.col === c && z.row === r));
            }
          }
          this.chargeConstruction(tileCostForVariant + perTileExtra);
          const tileEntry = { type: infraType, col: c, row: r, variant };
          if (foundation) tileEntry.foundation = foundation;
          if (orientation) tileEntry.orientation = orientation;
          this.state.floors.push(tileEntry);
          this.state.infraOccupied[key] = infraType;
          // Concrete pad excavates hills / fills hollows to y=0 under its footprint.
          if (infraType === 'concrete') {
            setTileCorners(this.state, c, r, { nw: 0, ne: 0, se: 0, sw: 0 });
          }
          placed++;
        }
      }

      if (placed > 0) {
        this.log(`Placed ${placed} ${infra.name} tiles ($${placed * tileCostForVariant})`, 'good');
        this.emit('infrastructureChanged');
        // Hallway changes affect zone connectivity
        if (infraType === 'hallway') {
          this.recomputeZoneConnectivity();
          this.emit('zonesChanged');
        }
        this.validateInfrastructure();
      }
    });
    return placed > 0;
  }

  removeInfraTile(col, row) {
    const key = col + ',' + row;
    if (!this.state.infraOccupied[key]) return false;
    const idx = this.state.floors.findIndex(t => t.col === col && t.row === row);
    if (idx === -1) return false;

    // Removing flooring also removes any zone on that tile
    if (this.state.zoneOccupied[key]) {
      this.removeZoneTile(col, row);
    }

    const tile = this.state.floors[idx];
    const foundation = tile.foundation;
    this.state.floors.splice(idx, 1);
    const wasHallway = this.state.infraOccupied[key] === 'hallway';

    // If the tile had a foundation, revert to the foundation type
    if (foundation) {
      this.state.floors.push({ type: foundation, col, row, variant: tile.variant });
      this.state.infraOccupied[key] = foundation;
    } else {
      delete this.state.infraOccupied[key];
    }

    if (wasHallway) {
      this.recomputeZoneConnectivity();
      this.emit('zonesChanged');
    }

    this.emit('infrastructureChanged');
    this.validateInfrastructure();
    return true;
  }

  // === WALLS (PER-TILE EDGE) ===

  placeWall(col, row, edge, wallType, variant = 0) {
    const wt = WALL_TYPES[wallType];
    if (!wt) return false;
    const segCost = wt.variantCosts?.[variant] ?? wt.cost;
    const key = `${col},${row},${edge}`;
    if (this.state.wallOccupied[key] === wallType) {
      // Same type — just update the variant for free.
      const existing = this.state.walls.find(
        w => w.col === col && w.row === row && w.edge === edge
      );
      if (existing && (existing.variant ?? 0) !== variant) {
        existing.variant = variant;
      }
      return true;
    }
    if (this.state.wallOccupied[key]) {
      // Replace existing wall on this edge
      this.state.walls = this.state.walls.filter(
        w => !(w.col === col && w.row === row && w.edge === edge)
      );
    }
    if (this.state.resources.funding < segCost) return false;
    this.chargeConstruction(segCost);
    const wallEntry = { type: wallType, col, row, edge };
    if (variant) wallEntry.variant = variant;
    this.state.walls.push(wallEntry);
    this.state.wallOccupied[key] = wallType;
    return true;
  }

  placeWallPath(path, wallType, variant = 0) {
    const wt = WALL_TYPES[wallType];
    if (!wt) return false;
    const segCost = wt.variantCosts?.[variant] ?? wt.cost;
    let placed = 0;
    for (const pt of path) {
      const key = `${pt.col},${pt.row},${pt.edge}`;
      if (this.state.wallOccupied[key] === wallType) {
        const existing = this.state.walls.find(
          w => w.col === pt.col && w.row === pt.row && w.edge === pt.edge
        );
        if (existing && (existing.variant ?? 0) !== variant) {
          existing.variant = variant;
          placed++;
        }
        continue;
      }
      if (this.state.resources.funding < segCost) break;
      if (this.state.wallOccupied[key]) {
        this.state.walls = this.state.walls.filter(
          w => !(w.col === pt.col && w.row === pt.row && w.edge === pt.edge)
        );
      }
      this.chargeConstruction(segCost);
      const wallEntry = { type: wallType, col: pt.col, row: pt.row, edge: pt.edge };
      if (variant) wallEntry.variant = variant;
      this.state.walls.push(wallEntry);
      this.state.wallOccupied[key] = wallType;
      placed++;
    }
    if (placed > 0) {
      this.log(`Placed ${placed} ${wt.name} segments ($${placed * segCost})`, 'good');
      this.emit('wallsChanged');
    }
    return placed > 0;
  }

  removeWall(col, row, edge) {
    const key = `${col},${row},${edge}`;
    const wallType = this.state.wallOccupied[key];
    if (!wallType) return false;
    const wt = WALL_TYPES[wallType];
    if (wt) this.state.resources.funding += Math.floor(wt.cost * 0.5);
    this.state.walls = this.state.walls.filter(
      w => !(w.col === col && w.row === row && w.edge === edge)
    );
    delete this.state.wallOccupied[key];
    // Remove any orphaned door on this edge. The door may be recorded under
    // either spelling of the edge (see edge-keys.js), so resolve before
    // deleting — an unresolved lookup used to strand the door on a wall that
    // no longer exists.
    const doorKey = findEdgeKey(this.state.doorOccupied, col, row, edge);
    if (doorKey) {
      const dt = DOOR_TYPES[this.state.doorOccupied[doorKey]];
      if (dt) this.state.resources.funding += Math.floor(dt.cost * 0.5);
      this.state.doors = this.state.doors.filter(d => edgeKey(d.col, d.row, d.edge) !== doorKey);
      delete this.state.doorOccupied[doorKey];
      this.emit('doorsChanged');
    }
    this.emit('wallsChanged');
    return true;
  }

  // === DOORS (EDGE-BASED) ===
  //
  // A door hangs on a wall, and the wall is stored under ONE of the two keys
  // that name its edge ("5,5,n" and "5,4,s" are the same edge — see
  // edge-keys.js). Doors are always stored at the key the WALL uses, because
  // the renderer's wall-builder matches a door to its wall by exact key.
  // A door placed from the far side therefore gets its col/row/edge — and its
  // `off` — rewritten into the wall's frame before it is recorded.

  /**
   * Resolve a door placement request against the wall it needs. Returns
   * { key, col, row, edge, off } in the WALL's frame, or null if no wall.
   * `off` is the subtile offset of the opening from the edge's first-listed
   * corner (n: NW->NE, e: NE->SE, s: SE->SW, w: SW->NW).
   */
  _resolveDoorSite(col, row, edge, dt, off) {
    const key = findWallKey(this.state.wallOccupied, col, row, edge);
    if (!key) return null;
    const site = parseEdgeKey(key);
    const wanted = clampDoorOff(dt, off ?? defaultDoorOff(dt));
    return {
      key,
      col: site.col,
      row: site.row,
      edge: site.edge,
      // The two spellings run in opposite directions along the edge.
      off: isMirroredKey(key, col, row, edge) ? mirrorDoorOff(wanted, dt) : wanted,
    };
  }

  /** Apply variant/off to an already-placed door. Returns true if it changed. */
  _updateDoorRecord(key, variant, off) {
    const existing = this.state.doors.find(d => edgeKey(d.col, d.row, d.edge) === key);
    if (!existing) return false;
    let changed = false;
    if (existing.variant !== variant) { existing.variant = variant; changed = true; }
    if (existing.off !== off) { existing.off = off; changed = true; }
    return changed;
  }

  placeDoor(col, row, edge, doorType, variant = 0, off = null) {
    const dt = DOOR_TYPES[doorType];
    if (!dt) return false;
    const site = this._resolveDoorSite(col, row, edge, dt, off);
    if (!site) {
      this.log(`No wall on that edge — a ${dt.name} has to hang on a wall`, 'bad');
      return false;
    }
    if (this.state.doorOccupied[site.key] === doorType) {
      // Same door, same edge: re-placing nudges variant / opening position.
      if (this._updateDoorRecord(site.key, variant, site.off)) this.emit('doorsChanged');
      return true;
    }
    if (this.state.doorOccupied[site.key]) {
      this.state.doors = this.state.doors.filter(d => edgeKey(d.col, d.row, d.edge) !== site.key);
    }
    if (this.state.resources.funding < dt.cost) {
      this.log(`Not enough funding for a ${dt.name} ($${dt.cost})`, 'bad');
      return false;
    }
    this.chargeConstruction(dt.cost);
    this.state.doors.push({
      type: doorType, col: site.col, row: site.row, edge: site.edge, variant, off: site.off,
    });
    this.state.doorOccupied[site.key] = doorType;
    this.emit('doorsChanged');
    return true;
  }

  /**
   * Place a door on every edge in `path`. Each point may carry its own `off`
   * (subtile offset of the opening); the `off` argument is the fallback for
   * points that don't. Skips are summarized in one log line, never silent.
   */
  placeDoorPath(path, doorType, variant = 0, off = null) {
    const dt = DOOR_TYPES[doorType];
    if (!dt) return false;
    let placed = 0;
    let updated = 0;
    let noWall = 0;
    let brokeOnFunding = false;
    for (const pt of path) {
      const site = this._resolveDoorSite(pt.col, pt.row, pt.edge, dt, pt.off ?? off);
      if (!site) { noWall++; continue; }
      if (this.state.doorOccupied[site.key] === doorType) {
        if (this._updateDoorRecord(site.key, variant, site.off)) updated++;
        continue;
      }
      if (this.state.resources.funding < dt.cost) { brokeOnFunding = true; break; }
      if (this.state.doorOccupied[site.key]) {
        this.state.doors = this.state.doors.filter(d => edgeKey(d.col, d.row, d.edge) !== site.key);
      }
      this.chargeConstruction(dt.cost);
      this.state.doors.push({
        type: doorType, col: site.col, row: site.row, edge: site.edge, variant, off: site.off,
      });
      this.state.doorOccupied[site.key] = doorType;
      placed++;
    }
    if (placed > 0) {
      this.log(`Placed ${placed} ${dt.name} segment${placed > 1 ? 's' : ''} ($${placed * dt.cost})`, 'good');
    }
    if (noWall > 0) {
      this.log(`Skipped ${noWall} ${dt.name} segment${noWall > 1 ? 's' : ''} — no wall on that edge`, 'bad');
    }
    if (brokeOnFunding) {
      this.log(`Ran out of funding for the rest of the ${dt.name} run ($${dt.cost} each)`, 'bad');
    }
    if (placed > 0 || updated > 0) this.emit('doorsChanged');
    return placed > 0 || updated > 0;
  }

  removeDoor(col, row, edge) {
    const key = findEdgeKey(this.state.doorOccupied, col, row, edge);
    if (!key) return false;
    const doorType = this.state.doorOccupied[key];
    const dt = DOOR_TYPES[doorType];
    if (dt) this.state.resources.funding += Math.floor(dt.cost * 0.5);
    this.state.doors = this.state.doors.filter(d => edgeKey(d.col, d.row, d.edge) !== key);
    delete this.state.doorOccupied[key];
    this.emit('doorsChanged');
    return true;
  }

  // === ZONES ===

  placeZoneTile(col, row, zoneType) {
    const zone = ZONES[zoneType];
    if (!zone) return false;
    const key = col + ',' + row;
    // Must have the right flooring underneath
    const floor = this.state.infraOccupied[key];
    if (floor !== zone.requiredFloor) return false;
    // Overwrite existing zone if different type; skip if same type
    if (this.state.zoneOccupied[key]) {
      if (this.state.zoneOccupied[key] === zoneType) return false;
      this.removeZoneTile(col, row);
    }

    this.state.zones.push({ type: zoneType, col, row });
    this.state.zoneOccupied[key] = zoneType;
    this.recomputeZoneConnectivity();
    this.emit('zonesChanged');
    return true;
  }

  placeZoneRect(startCol, startRow, endCol, endRow, zoneType) {
    const zone = ZONES[zoneType];
    if (!zone) return false;

    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);

    let placed = 0;
    for (let c = minCol; c <= maxCol; c++) {
      for (let r = minRow; r <= maxRow; r++) {
        const key = c + ',' + r;
        const floor = this.state.infraOccupied[key];
        if (floor !== zone.requiredFloor) continue;
        if (this.state.zoneOccupied[key] === zoneType) continue;
        if (this.state.zoneOccupied[key]) {
          // Overwrite existing zone
          const idx = this.state.zones.findIndex(z => z.col === c && z.row === r);
          if (idx !== -1) this.state.zones.splice(idx, 1);
          delete this.state.zoneOccupied[key];
        }

        this.state.zones.push({ type: zoneType, col: c, row: r });
        this.state.zoneOccupied[key] = zoneType;
        placed++;
      }
    }

    if (placed > 0) {
      this.log(`Assigned ${placed} ${zone.name} tiles`, 'good');
      this.recomputeZoneConnectivity();
      this.emit('zonesChanged');
    } else {
      const floorName = FLOORS[zone.requiredFloor]?.name || zone.requiredFloor;
      this.log(`${zone.name} needs ${floorName} underneath`, 'bad');
    }
    return placed > 0;
  }

  // === FACILITY ZONE BRUSH (auto floor+zone) ===
  // Facility brush: drag to paint a zone _and_ its required floor in one
  // stroke. Each tile is handled atomically — missing concrete foundations
  // are placed first, then the surface, then the zone overlay. This is the
  // 3-minute path helper: new players no longer need a separate
  // Structure → Flooring step before painting Facility zones.

  _ensureFloorForBrush(col, row, requiredFloor) {
    const key = col + ',' + row;
    if (this.state.infraOccupied[key] === requiredFloor) return true;
    const def = FLOORS[requiredFloor];
    if (!def) return false;
    // If the surface needs a concrete foundation, ensure it exists first.
    if (def.requiresFoundation) {
      const need = def.requiresFoundation;
      const existing = this.state.infraOccupied[key];
      let hasFoundation = existing === need;
      if (!hasFoundation) {
        const tile = this.state.floors.find(t => t.col === col && t.row === row);
        if (tile && tile.foundation === need) hasFoundation = true;
      }
      if (!hasFoundation) {
        // Place foundation; if it fails (funding) abort this tile.
        const ok = this.placeInfraTile(col, row, need, 0);
        if (!ok) return false;
        // After placing foundation, the tile's infraOccupied is now 'need'.
        // Fall through to place the surface on top.
        // placeInfraTile for the surface will handle replacing foundation.
      }
    }
    if (this.state.infraOccupied[key] === requiredFloor) return true;
    return this.placeInfraTile(col, row, requiredFloor, 0);
  }

  /**
   * Single-tile brush: ensure floor then paint zone.
   * Returns true if the zone was newly painted.
   */
  placeFacilityZoneBrushTile(col, row, zoneType) {
    const zone = ZONES[zoneType];
    if (!zone) return false;
    const key = col + ',' + row;
    if (this.state.zoneOccupied[key] === zoneType) return false;
    // Ensure floor exists — auto-place if missing.
    if (this.state.infraOccupied[key] !== zone.requiredFloor) {
      const ok = this._ensureFloorForBrush(col, row, zone.requiredFloor);
      if (!ok) {
        // If floor placement failed (e.g. insufficient funds), don't paint zone.
        if (this.state.infraOccupied[key] !== zone.requiredFloor) return false;
      }
    }
    // Overwrite different zone type.
    if (this.state.zoneOccupied[key] && this.state.zoneOccupied[key] !== zoneType) {
      this.removeZoneTile(col, row);
    }
    if (this.state.zoneOccupied[key] === zoneType) return false;
    this.state.zones.push({ type: zoneType, col, row });
    this.state.zoneOccupied[key] = zoneType;
    this.recomputeZoneConnectivity();
    this.emit('zonesChanged');
    // Infrastructure may have changed due to auto floor.
    this.emit('infrastructureChanged');
    return true;
  }

  /**
   * Rectangular brush: auto-places floor+zone across the drag rect.
   * Returns true if at least one tile was painted.
   */
  placeFacilityZoneBrushRect(startCol, startRow, endCol, endRow, zoneType) {
    const zone = ZONES[zoneType];
    if (!zone) return false;
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    let placed = 0;
    let infraChanged = false;
    for (let c = minCol; c <= maxCol; c++) {
      for (let r = minRow; r <= maxRow; r++) {
        const key = c + ',' + r;
        if (this.state.zoneOccupied[key] === zoneType) continue;
        const beforeFloor = this.state.infraOccupied[key];
        if (beforeFloor !== zone.requiredFloor) {
          const ok = this._ensureFloorForBrush(c, r, zone.requiredFloor);
          if (!ok && this.state.infraOccupied[key] !== zone.requiredFloor) continue;
          if (this.state.infraOccupied[key] !== beforeFloor) infraChanged = true;
        }
        if (this.state.zoneOccupied[key] && this.state.zoneOccupied[key] !== zoneType) {
          const idx = this.state.zones.findIndex(z => z.col === c && z.row === r);
          if (idx !== -1) this.state.zones.splice(idx, 1);
          delete this.state.zoneOccupied[key];
        }
        if (this.state.zoneOccupied[key] === zoneType) continue;
        this.state.zones.push({ type: zoneType, col: c, row: r });
        this.state.zoneOccupied[key] = zoneType;
        placed++;
      }
    }
    if (placed > 0) {
      this.log(`Assigned ${placed} ${zone.name} tiles (auto-floored)`, 'good');
      this.recomputeZoneConnectivity();
      this.emit('zonesChanged');
      if (infraChanged) this.emit('infrastructureChanged');
      this.validateInfrastructure();
    }
    return placed > 0;
  }

  /**
   * Cost preview for the facility brush rect — sums floor costs for tiles
   * that lack the required floor plus any needed concrete foundations.
   * Zones themselves are free.
   */
  computeFacilityBrushCost(startCol, startRow, endCol, endRow, zoneType) {
    const zone = ZONES[zoneType];
    if (!zone) return { newTiles: 0, totalCost: 0 };
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);
    let newTiles = 0;
    let totalCost = 0;
    for (let c = minCol; c <= maxCol; c++) {
      for (let r = minRow; r <= maxRow; r++) {
        const key = c + ',' + r;
        if (this.state.zoneOccupied[key] === zoneType) continue;
        newTiles++;
        const requiredFloor = zone.requiredFloor;
        if (this.state.infraOccupied[key] === requiredFloor) continue;
        const def = FLOORS[requiredFloor];
        if (!def) continue;
        const tileCost = def.variantCosts?.[0] ?? def.cost;
        if (def.requiresFoundation) {
          const need = def.requiresFoundation;
          const existing = this.state.infraOccupied[key];
          let hasFoundation = existing === need;
          if (!hasFoundation) {
            const tile = this.state.floors.find(t => t.col === c && t.row === r);
            if (tile && tile.foundation === need) hasFoundation = true;
          }
          if (!hasFoundation) {
            const fDef = FLOORS[need];
            totalCost += fDef.variantCosts?.[0] ?? fDef.cost;
          }
          totalCost += tileCost;
        } else {
          totalCost += tileCost;
        }
      }
    }
    return { newTiles, totalCost };
  }

  removeZoneRect(startCol, startRow, endCol, endRow) {
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);

    let removed = 0;
    for (let c = minCol; c <= maxCol; c++) {
      for (let r = minRow; r <= maxRow; r++) {
        const key = c + ',' + r;
        if (this.state.zoneOccupied[key]) {
          const idx = this.state.zones.findIndex(z => z.col === c && z.row === r);
          if (idx !== -1) {
            this.state.zones.splice(idx, 1);
            delete this.state.zoneOccupied[key];
            removed++;
          }
        }
      }
    }
    if (removed > 0) {
      this.log(`Cleared ${removed} zone tiles`, 'info');
      this.recomputeZoneConnectivity();
      this.emit('zonesChanged');
    }
    return removed > 0;
  }

  removeInfraRect(startCol, startRow, endCol, endRow) {
    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);

    // Batch: removeInfraTile emits 'infrastructureChanged' (and possibly
    // 'zonesChanged') per tile, each triggering a full terrain rebuild in
    // the renderer. Coalesce to one emit per event for the whole rect,
    // mirroring placeInfraRect's single post-loop emit.
    let removed = 0;
    this._batchEvents(() => {
      for (let c = minCol; c <= maxCol; c++) {
        for (let r = minRow; r <= maxRow; r++) {
          if (this.removeInfraTile(c, r)) removed++;
        }
      }
    });
    if (removed > 0) {
      this.log(`Removed ${removed} floor tiles`, 'info');
    }
    return removed > 0;
  }

  removeZoneTile(col, row) {
    const key = col + ',' + row;
    if (!this.state.zoneOccupied[key]) return false;
    const idx = this.state.zones.findIndex(z => z.col === col && z.row === row);
    if (idx !== -1) {
      this.state.zones.splice(idx, 1);
      delete this.state.zoneOccupied[key];
      // Remove ALL furnishings on this tile. These are ordinary placeables
      // (state.zoneFurnishings is a derived view rebuilt from state.placeables
      // by _syncLegacyPlaceableState), so they must go through removePlaceable:
      // splicing the derived array leaves the furnishing alive, and the def's
      // `cost` is an object ({funding: N}) — refunding it as a scalar produced
      // NaN funding. _batchEvents coalesces the per-furnishing emits.
      const tileFurnishingIds = this.state.zoneFurnishings
        .filter(e => e.col === col && e.row === row)
        .map(e => e.id);
      this._batchEvents(() => {
        for (const id of tileFurnishingIds) this.removePlaceable(id);
        this._syncLegacyPlaceableState();
        this.recomputeZoneConnectivity();
        this.emit('zonesChanged');
      });
      return true;
    }
    return false;
  }

  // Flood-fill from Control Room through hallways to determine zone connectivity
  recomputeZoneConnectivity() {
    const connectivity = {};
    for (const zoneType of Object.keys(ZONES)) {
      connectivity[zoneType] = { active: false, tileCount: 0, tier: 0 };
    }

    // Count tiles per zone type
    for (const z of this.state.zones) {
      if (connectivity[z.type]) {
        connectivity[z.type].tileCount++;
      }
    }

    // Compute tier from tile count
    for (const info of Object.values(connectivity)) {
      info.tier = 0;
      for (let t = ZONE_TIER_THRESHOLDS.length - 1; t >= 0; t--) {
        if (info.tileCount >= ZONE_TIER_THRESHOLDS[t]) { info.tier = t + 1; break; }
      }
    }

    // Find all Control Room tiles
    const controlRoomTiles = this.state.zones
      .filter(z => z.type === 'controlRoom')
      .map(z => z.col + ',' + z.row);

    if (controlRoomTiles.length === 0) {
      this.state.zoneConnectivity = connectivity;
      return;
    }

    // Control Room is always active if it exists
    connectivity.controlRoom.active = true;

    // Find all hallway tiles adjacent to Control Room -- seed the flood fill
    const hallwaySet = new Set();
    for (const tile of this.state.floors) {
      if (tile.type === 'hallway') hallwaySet.add(tile.col + ',' + tile.row);
    }

    const visited = new Set();
    const queue = [];

    // Seed: hallway tiles adjacent to any Control Room tile
    for (const crKey of controlRoomTiles) {
      const [cc, cr] = crKey.split(',').map(Number);
      for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nk = (cc + dc) + ',' + (cr + dr);
        if (hallwaySet.has(nk) && !visited.has(nk)) {
          visited.add(nk);
          queue.push(nk);
        }
      }
    }

    // BFS through hallway tiles
    while (queue.length > 0) {
      const cur = queue.shift();
      const [cc, cr] = cur.split(',').map(Number);
      for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nk = (cc + dc) + ',' + (cr + dr);
        if (hallwaySet.has(nk) && !visited.has(nk)) {
          visited.add(nk);
          queue.push(nk);
        }
      }
    }

    // Check each zone: if any tile is adjacent to a reachable hallway tile, it's active
    const zonesByType = {};
    for (const z of this.state.zones) {
      if (!zonesByType[z.type]) zonesByType[z.type] = [];
      zonesByType[z.type].push(z);
    }

    for (const [zoneType, tiles] of Object.entries(zonesByType)) {
      if (zoneType === 'controlRoom') continue; // already active
      for (const tile of tiles) {
        for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nk = (tile.col + dc) + ',' + (tile.row + dr);
          if (visited.has(nk)) {
            connectivity[zoneType].active = true;
            break;
          }
        }
        if (connectivity[zoneType].active) break;
      }
    }

    this.state.zoneConnectivity = connectivity;
  }

  // Lab-floorspace/zone gating for infra builds has been removed: every
  // category is treated as ungated so palette items never show as
  // zone-blocked. Zones themselves still exist for other systems.
  getZoneTierForCategory(_category) {
    return 99;
  }

  // === FACILITY EQUIPMENT ===

  removeFacilityEquipment(equipId) {
    return this.removePlaceable(equipId);
  }

  // === ZONE FURNISHINGS ===

  placeZoneFurnishing(col, row, furnType, subCol, subRow, rotated = false) {
    return this.placePlaceable({
      type: furnType,
      category: 'furnishing',
      col,
      row,
      subCol,
      subRow,
      rotated,
    });
  }

  removeZoneFurnishing(furnId) {
    return this.removePlaceable(furnId);
  }

  // === UNIFIED PLACEMENT SYSTEM ===

  /**
   * Place any item on the unified sub-grid.
   * @param {Object} opts - { type, category, col, row, subCol, subRow, rotated, dir, params }
   *   category: "beamline" | "equipment" | "furnishing"
   * @returns {string|false} The placeable id, or false on failure
   */
  placePlaceable(opts) {
    try { return this._placePlaceableInner(opts); } catch(e) { console.error('[placePlaceable] CRASH:', e); return false; }
  }
  _placePlaceableInner(opts, opts2) {
    const { type, col, row, subCol, subRow, dir = 0, params, variant = 0, free = false, silent = false } = opts;
    const skipBeamlineRoute = !!(opts2 && opts2.skipBeamlineRoute);

    const placeable = PLACEABLES[type];
    if (!placeable) return false;
    const kind = placeable.kind;

    // Route beamline components by their role metadata. Junctions delegate
    // to BeamlineSystem.placeJunction; placements must go through
    // BeamlineSystem.placeOnPipe (the UI controller's job) — reaching here
    // means a placement was routed to free-grid placement, which is invalid.
    // BeamlineSystem callers pass skipBeamlineRoute to avoid recursion back
    // into this branch (they've already resolved routing themselves).
    if (kind === 'beamline' && !skipBeamlineRoute) {
      const def = COMPONENTS[type];
      if (def?.role === 'junction') {
        return this.beamline.placeJunction(opts);
      }
      if (def?.role === 'placement') {
        this.log(`${placeable.name} must be placed on a beampipe`, 'bad');
        return false;
      }
      // Beamline kind without role metadata → fall through to normal placement
      // (defensive; shouldn't happen after A1).
    }

    if (!free && !this.canAfford(placeable.cost)) {
      this.log(`Can't afford ${placeable.name}!`, 'bad');
      return false;
    }

    // --- Stack target resolution ---
    let stackTarget = null;
    if (placeable.stackable) {
      const getEntry = (id) => {
        const idx = this.state.placeableIndex[id];
        return idx !== undefined ? this.state.placeables[idx] : null;
      };
      const getDef = (t) => PLACEABLES[t] || null;
      stackTarget = findStackTarget(
        placeable, col, row, subCol || 0, subRow || 0, dir,
        this.state.subgridOccupied, getEntry, getDef,
      );
    }

    const cells = placeable.footprintCells(col, row, subCol || 0, subRow || 0, dir);
    if (stackTarget) {
      // Stacking — cells are occupied by the ground item, which is expected.
    } else {
      for (const c of cells) {
        const k = c.col + ',' + c.row + ',' + c.subCol + ',' + c.subRow;
        if (this.state.subgridOccupied[k]) {
          this.log('Space occupied!', 'bad');
          return false;
        }
      }
    }

    // Check wall intersection — footprint must not cross any wall edge.
    const wallSet = new Set(cells.map(c => `${c.col},${c.row},${c.subCol},${c.subRow}`));
    for (const c of cells) {
      if (c.subCol === 3) {
        const nk = `${c.col + 1},${c.row},0,${c.subRow}`;
        if (wallSet.has(nk)) {
          if (this.state.wallOccupied[`${c.col},${c.row},e`] ||
              this.state.wallOccupied[`${c.col + 1},${c.row},w`]) {
            this.log('Intersects a wall!', 'bad');
            return false;
          }
        }
      }
      if (c.subRow === 3) {
        const nk = `${c.col},${c.row + 1},${c.subCol},0`;
        if (wallSet.has(nk)) {
          if (this.state.wallOccupied[`${c.col},${c.row},s`] ||
              this.state.wallOccupied[`${c.col},${c.row + 1},n`]) {
            this.log('Intersects a wall!', 'bad');
            return false;
          }
        }
      }
    }

    // Auto-flatten terrain under the footprint. All validation above has
    // passed, so this mutation is committed; failed placements (early
    // returns above) leave the heightmap untouched. Stacked items sit on
    // a parent that already flattened its tiles, but re-flattening to zero
    // is idempotent — no need to special-case.
    {
      const flattenedKeys = new Set();
      for (const c of cells) {
        const tk = c.col + ',' + c.row;
        if (flattenedKeys.has(tk)) continue;
        flattenedKeys.add(tk);
        setTileCorners(this.state, c.col, c.row, { nw: 0, ne: 0, se: 0, sw: 0 });
      }
    }

    // Allocate id.
    const prefix = kind === 'beamline' ? 'bl_'
      : kind === 'infrastructure' ? 'in_'
      : kind === 'furnishing' ? 'fn_'
      : kind === 'decoration' ? 'dc_'
      : 'eq_';
    const id = prefix + this.state.placeableNextId++;

    if (!free) this.spend(placeable.cost);

    const entry = {
      id,
      type,
      category: kind,            // legacy alias for downstream consumers
      kind,
      col,
      row,
      subCol: subCol || 0,
      subRow: subRow || 0,
      dir,
      params: null,
      variant: variant || 0,
      cells,
      placeY: 0,
      stackParentId: null,
      stackChildren: [],
    };

    // Beamline param init (was previously inline; only kind that needs it).
    // The three-step seed now lives in seedComponentParams so this path and
    // BeamlineSystem.placeOnPipe cannot drift apart again — they had, and the
    // pipe path was seeding nothing at all, which ran every on-pipe RF cavity
    // at the Python engine's 1.3 GHz default instead of its catalogue
    // frequency. See src/beamline/component-params.js for the full story.
    // (`placeable` is PLACEABLES[type]; for kind 'beamline' COMPONENTS[type]
    // IS that same overlaid instance, so reading the catalogue inside the
    // helper is the identical object this used to read via `placeable`.)
    if (kind === 'beamline') {
      entry.params = seedComponentParams(type, params);
    }

    this.state.placeables.push(entry);
    this.state.placeableIndex[id] = this.state.placeables.length - 1;

    if (stackTarget) {
      entry.placeY = stackTarget.placeY;
      entry.stackParentId = stackTarget.targetEntry.id;
      // Keep entry.cells populated for stacked items so sibling-collision
      // (canStack) and cursor-anchored descent (findStackTarget) can read the
      // occupied subtiles. subgridOccupied is only populated for ground items
      // (guarded in _rebuildPlaceableIndex and the !stackTarget branch below).
      stackTarget.targetEntry.stackChildren.push(id);
    }

    if (!stackTarget) {
      for (const c of cells) {
        const k = c.col + ',' + c.row + ',' + c.subCol + ',' + c.subRow;
        this.state.subgridOccupied[k] = { id, kind };
      }
    }

    placeable.onPlaced(this, entry);

    if (!silent) this.log(`Built ${placeable.name}`, 'good');

    // For beamline components: create registry entry for sources (needed for
    // beam toggle / BeamlineWindow), update the beam graph ordering, and
    // schedule a physics recalc so the new component affects the beam.
    if (kind === 'beamline') {
      const compDef = COMPONENTS[type];
      if (compDef?.isSource) {
        this._ensureBeamlineForSourcePlaceable(entry);
      }
      this._deriveBeamGraph();
      this.schedulePhysicsRecalc();
    }

    this.computeSystemStats();
    this._syncLegacyPlaceableState();
    this.emit('placeableChanged');
    if (kind === 'equipment') this.emit('facilityChanged');
    if (kind === 'furnishing') this.emit('zonesChanged');
    return id;
  }

  /**
   * Recompute a ground-level placeable's footprint after its col/row/dir
   * were mutated in place (MoveTool component drop): release the old
   * subgrid claims, rederive `cells` from the new position, and claim the
   * new subtiles. Stacked items keep their cells relative to the parent and
   * never own subgrid entries, so they are left alone.
   */
  _rebuildPlaceableCells(entry) {
    if (!entry || entry.stackParentId) return;
    const def = PLACEABLES[entry.type];
    if (!def) return;
    for (const c of (entry.cells || [])) {
      const k = c.col + ',' + c.row + ',' + c.subCol + ',' + c.subRow;
      const occ = this.state.subgridOccupied[k];
      if (occ && occ.id === entry.id) delete this.state.subgridOccupied[k];
    }
    entry.cells = def.footprintCells(
      entry.col, entry.row, entry.subCol || 0, entry.subRow || 0, entry.dir || 0,
    );
    for (const c of entry.cells) {
      const k = c.col + ',' + c.row + ',' + c.subCol + ',' + c.subRow;
      this.state.subgridOccupied[k] = { id: entry.id, kind: entry.kind };
    }
  }

  /**
   * Relocate an already-placed, ground-level placeable to a new pose, KEEPING
   * ITS ID. Returns true on success; on refusal nothing at all is mutated and
   * false comes back after a player-facing log.
   *
   * This exists because remove-then-place is not a move: it mints a new id,
   * and utility lines, beam-pipe start/end refs and the beamline registry all
   * anchor to the id. The designer's downstream-displacement plan slides a
   * whole run of modules along the beamline; done as remove/place it would
   * silently unwire every cavity's cryo and RF feed and orphan every pipe end.
   *
   * Money is deliberately untouched — displacement is not a purchase, and
   * charging (or refunding) here would let a player mint funding by nudging a
   * module back and forth.
   *
   * Occupancy is Game's alone to write (subgridOccupied has exactly one
   * writer), so the primitive lives here rather than in BeamlineSystem, which
   * reaches it through the injected `movePlaceable` callback.
   */
  movePlaceable(placeableId, pose = {}) {
    const idx = this.state.placeableIndex[placeableId];
    if (idx === undefined) return false;
    const entry = this.state.placeables[idx];
    if (!entry) return false;
    const def = PLACEABLES[entry.type];
    if (!def) return false;

    const { col, row } = pose;
    if (!Number.isFinite(col) || !Number.isFinite(row)) {
      this.log(`Can't move ${def.name}: invalid destination`, 'bad');
      return false;
    }
    const subCol = pose.subCol || 0;
    const subRow = pose.subRow || 0;
    const dir = (pose.dir === undefined || pose.dir === null)
      ? (entry.dir || 0)
      : pose.dir;

    // Stacked items don't own their subtiles (the parent does) and a stack
    // parent's children would be left hanging in mid-air over the old spot.
    // Beamline junctions are never stackable, so this only ever fires on a
    // caller pointing the move at the wrong kind of placeable.
    if (entry.stackParentId || (entry.stackChildren || []).length) {
      this.log(`Can't move ${def.name}: it is part of a stack`, 'bad');
      return false;
    }

    const geo = canPlace(this, def, col, row, subCol, subRow, dir);
    // A displacement almost always overlaps its OWN old footprint — a module
    // sliding half a metre down the beamline keeps most of its cells — so
    // cells this very placeable already owns are not collisions. Only a
    // foreign occupant blocks.
    const foreign = geo.blockedCells.filter((c) => {
      const occ = this.state.subgridOccupied[
        c.col + ',' + c.row + ',' + c.subCol + ',' + c.subRow
      ];
      return occ && occ.id !== placeableId;
    });
    if (foreign.length) {
      this.log(`Can't move ${def.name}: space occupied`, 'bad');
      return false;
    }
    if (geo.wallBlocked) {
      this.log(`Can't move ${def.name}: intersects a wall`, 'bad');
      return false;
    }

    entry.col = col;
    entry.row = row;
    entry.subCol = subCol;
    entry.subRow = subRow;
    entry.dir = dir;
    this._rebuildPlaceableCells(entry);

    // Flatten the DESTINATION tiles, and deliberately leave the origin flat.
    // Placement flattens because everything is drawn at y = 0; a module that
    // slid onto a slope without this would be half-buried in the hillside.
    // The origin cannot be un-flattened — the pre-placement heights were never
    // stored, and neighbouring footprints may share those tiles — which is
    // exactly the asymmetry removePlaceable already lives with.
    const flattened = new Set();
    for (const c of entry.cells) {
      const tk = c.col + ',' + c.row;
      if (flattened.has(tk)) continue;
      flattened.add(tk);
      setTileCorners(this.state, c.col, c.row, { nw: 0, ne: 0, se: 0, sw: 0 });
    }

    // No event is emitted here on purpose: one Apply can displace a dozen
    // modules, and the caller (BeamlineSystem.moveJunction) pairs
    // placeableChanged with beamlineChanged for each so the two always arrive
    // together. Emitting from both layers would double every refresh.
    return true;
  }

  /**
   * Remove a placeable by ID. Refunds 50% of cost.
   */
  removePlaceable(placeableId, opts = {}) {
    const idx = this.state.placeableIndex[placeableId];
    if (idx === undefined) return false;

    const entry = this.state.placeables[idx];
    if (!entry) return false;

    const placeable = PLACEABLES[entry.type];
    if (!placeable) return false;

    // --- Stack collapse check ---
    const getEntry = (id) => {
      const idx = this.state.placeableIndex[id];
      return idx !== undefined ? this.state.placeables[idx] : null;
    };
    const getDef = (t) => PLACEABLES[t] || null;

    const updates = collapsePlan(placeableId, getEntry, getDef);

    // 50% refund — skipped when the caller is destroying the placeable
    // (e.g. paving over a tree with concrete).
    if (!opts.skipRefund && placeable.cost) {
      for (const [r, a] of Object.entries(placeable.cost)) {
        this.state.resources[r] += Math.floor(a * 0.5);
      }
    }

    // Lifecycle hook — runs before we clear cells / remove the entry so
    // subclasses (e.g. BeamlineModule) can still see the instance in place.
    placeable.onRemoved(this, entry);

    // Free sub-grid cells — only for ground-level items. Stacked items also
    // carry cells (for sibling-collision tracking) but those subtiles belong
    // to the underlying ground item, not to this entry.
    if (!entry.stackParentId) {
      for (const cell of entry.cells) {
        const cellKey = cell.col + ',' + cell.row + ',' + cell.subCol + ',' + cell.subRow;
        delete this.state.subgridOccupied[cellKey];
      }
    }

    // Apply stack collapse
    if (entry.stackParentId) {
      const parent = getEntry(entry.stackParentId);
      if (parent) {
        parent.stackChildren = parent.stackChildren.filter(cid => cid !== placeableId);
      }
    }
    for (const childId of (entry.stackChildren || [])) {
      const child = getEntry(childId);
      if (child) {
        child.stackParentId = entry.stackParentId || null;
        if (entry.stackParentId) {
          const newParent = getEntry(entry.stackParentId);
          if (newParent && !newParent.stackChildren.includes(childId)) {
            newParent.stackChildren.push(childId);
          }
        }
      }
    }
    for (const u of (updates || [])) {
      const child = getEntry(u.id);
      if (!child) continue;
      child.placeY = u.newPlaceY;
      child.stackParentId = u.newStackParentId;
      if (u.newStackParentId === null && child.placeY === 0) {
        const childDef = getDef(child.type);
        if (childDef) {
          const childCells = childDef.footprintCells(child.col, child.row, child.subCol || 0, child.subRow || 0, child.dir || 0);
          child.cells = childCells;
          for (const c of childCells) {
            const k = c.col + ',' + c.row + ',' + c.subCol + ',' + c.subRow;
            this.state.subgridOccupied[k] = { id: child.id, kind: child.kind };
          }
        }
      }
    }

    // Remove beam pipes connected to this placeable (beamline only).
    // Legacy bridge-merge (reconnecting an incoming/outgoing pair across
    // the removed module) is no longer performed here — BeamlineSystem
    // handles port bookkeeping explicitly via removeJunction + its UI
    // controller, and the flattener tolerates open pipe ends.
    //
    // These go through removeBeamPipe rather than a raw filter on
    // state.beamPipes: it is the only path that pays pipeRefund(), credits
    // 50% of every on-pipe placement, and releases the utility-line endpoints
    // wired to those placements. Filtering here destroyed a pipe full of
    // million-dollar cavities for nothing and left utility lines anchored to
    // ids that existed nowhere in state.
    let removedPipes = false;
    if (entry.category === 'beamline') {
      const connectedPipeIds = this.state.beamPipes
        .filter(p => p.start?.junctionId === placeableId || p.end?.junctionId === placeableId)
        .map(p => p.id);
      for (const pipeId of connectedPipeIds) {
        this.removeBeamPipe(pipeId, { skipRefund: opts.skipRefund, silent: true });
      }
      removedPipes = connectedPipeIds.length > 0;
    }

    // Remove from array
    this.state.placeables.splice(idx, 1);

    // Rebuild index
    this._rebuildPlaceableIndex();

    this.log(`Removed ${placeable.name} (50% refund)`, 'info');

    if (entry.category === 'beamline') {
      this._deriveBeamGraph();
    }

    // Release any utility-line endpoints that referenced this placeable.
    // (Mirrors _removePlaceableRaw — the two paths are parallel, neither
    // delegates to the other, so each must release exactly once.)
    if (this.utilityLineSystem) {
      this.utilityLineSystem.onPlaceableRemoved(placeableId);
    }

    this.computeSystemStats();
    this._syncLegacyPlaceableState();
    this.emit('placeableChanged');
    if (entry.category === 'equipment') this.emit('facilityChanged');
    if (entry.category === 'furnishing') this.emit('zonesChanged');
    // Connected pipes were pruned above; only 'beamlineChanged' triggers the
    // renderer's beam-pipe refresh, so without it the deleted pipes' meshes
    // linger as unclickable ghosts until the next full refresh.
    if (removedPipes) this.emit('beamlineChanged');
    return true;
  }

  /**
   * BeamlineSystem-facing remove: same as removePlaceable but skips the
   * legacy pipe-cleanup step. BeamlineSystem.removeJunction already opens
   * connected pipe ends explicitly before invoking this, so any residual
   * pipe filtering here would double-book the work.
   */
  _removePlaceableRaw(placeableId) {
    const idx = this.state.placeableIndex[placeableId];
    if (idx === undefined) return false;

    const entry = this.state.placeables[idx];
    if (!entry) return false;

    const placeable = PLACEABLES[entry.type];
    if (!placeable) return false;

    const getEntry = (id) => {
      const idx = this.state.placeableIndex[id];
      return idx !== undefined ? this.state.placeables[idx] : null;
    };
    const getDef = (t) => PLACEABLES[t] || null;

    const updates = collapsePlan(placeableId, getEntry, getDef);

    if (placeable.cost) {
      for (const [r, a] of Object.entries(placeable.cost)) {
        this.state.resources[r] += Math.floor(a * 0.5);
      }
    }

    placeable.onRemoved(this, entry);

    // Only ground-level items occupy subgridOccupied — stacked items carry
    // cells for sibling tracking but don't own those subtiles.
    if (!entry.stackParentId) {
      for (const cell of entry.cells) {
        const cellKey = cell.col + ',' + cell.row + ',' + cell.subCol + ',' + cell.subRow;
        delete this.state.subgridOccupied[cellKey];
      }
    }

    if (entry.stackParentId) {
      const parent = getEntry(entry.stackParentId);
      if (parent) {
        parent.stackChildren = parent.stackChildren.filter(cid => cid !== placeableId);
      }
    }
    for (const childId of (entry.stackChildren || [])) {
      const child = getEntry(childId);
      if (child) {
        child.stackParentId = entry.stackParentId || null;
        if (entry.stackParentId) {
          const newParent = getEntry(entry.stackParentId);
          if (newParent && !newParent.stackChildren.includes(childId)) {
            newParent.stackChildren.push(childId);
          }
        }
      }
    }
    for (const u of (updates || [])) {
      const child = getEntry(u.id);
      if (!child) continue;
      child.placeY = u.newPlaceY;
      child.stackParentId = u.newStackParentId;
      if (u.newStackParentId === null && child.placeY === 0) {
        const childDef = getDef(child.type);
        if (childDef) {
          const childCells = childDef.footprintCells(child.col, child.row, child.subCol || 0, child.subRow || 0, child.dir || 0);
          child.cells = childCells;
          for (const c of childCells) {
            const k = c.col + ',' + c.row + ',' + c.subCol + ',' + c.subRow;
            this.state.subgridOccupied[k] = { id: child.id, kind: child.kind };
          }
        }
      }
    }

    this.state.placeables.splice(idx, 1);
    this._rebuildPlaceableIndex();

    this.log(`Removed ${placeable.name} (50% refund)`, 'info');

    if (entry.category === 'beamline') {
      this._deriveBeamGraph();
    }

    // Cascade-remove any utility lines that referenced this placeable.
    if (this.utilityLineSystem) {
      this.utilityLineSystem.onPlaceableRemoved(placeableId);
    }

    this.computeSystemStats();
    this._syncLegacyPlaceableState();
    this.emit('placeableChanged');
    if (entry.category === 'equipment') this.emit('facilityChanged');
    if (entry.category === 'furnishing') this.emit('zonesChanged');
    return true;
  }

  /**
   * Pick up a placeable for move mode: detach it from the world (free its
   * cells, drop it from state/index) and return a snapshot of its data so
   * the caller can re-insert it at a new position with `placePlaceable({
   * free: true, silent: true, ... })`. No refund, no `onRemoved` side
   * effects.
   *
   * Beamline nodes are NOT handled here — they use the placeable move
   * system so attached beam pipes get fixed up.
   */
  liftPlaceable(placeableId) {
    const idx = this.state.placeableIndex[placeableId];
    if (idx === undefined) return null;
    const entry = this.state.placeables[idx];
    if (!entry) return null;
    if (entry.kind === 'beamline') return null;

    for (const cell of entry.cells) {
      const k = cell.col + ',' + cell.row + ',' + cell.subCol + ',' + cell.subRow;
      delete this.state.subgridOccupied[k];
    }

    this.state.placeables.splice(idx, 1);
    this._rebuildPlaceableIndex();

    const snapshot = {
      type: entry.type,
      kind: entry.kind,
      col: entry.col,
      row: entry.row,
      subCol: entry.subCol,
      subRow: entry.subRow,
      dir: entry.dir || 0,
      params: entry.params ? { ...entry.params } : null,
      variant: entry.variant ?? 0,
    };

    // The drop re-inserts through placePlaceable, which mints a NEW id, so
    // any utility line attached here would be left pointing at a dead
    // placeable forever (in state and in every save). Detach them, exactly
    // as removePlaceable does.
    if (this.utilityLineSystem) {
      this.utilityLineSystem.onPlaceableRemoved(placeableId);
    }

    this._syncLegacyPlaceableState();
    this.emit('placeableChanged');
    if (entry.category === 'equipment') this.emit('facilityChanged');
    if (entry.category === 'furnishing') this.emit('zonesChanged');
    return snapshot;
  }

  /**
   * Unified delete entry point. Accepts a `target` produced by
   * InputHandler._findDeletablePlaceable (or constructed by a context menu)
   * and dispatches to the right per-kind remove method. All delete code
   * paths in the UI route through this so refund/log/event/undo are uniform.
   *
   * @param {object} target - { kind, id?, entry?, node?, pipeId?, attachmentId? }
   * @returns {boolean} true if anything was removed
   */
  demolishTarget(target) {
    if (!target) return false;
    switch (target.kind) {
      case 'beamline': {
        if (target.entry) return this.removePlaceable(target.entry.id);
        if (target.node) return this.removePlaceable(target.node.id);
        if (target.id) return this.removePlaceable(target.id);
        return false;
      }
      case 'beamlineWhole': {
        if (!target.beamlineId) return false;
        const entry = this.registry.get(target.beamlineId);
        if (!entry) return false;
        let refund = 0;
        const flat = entry.sourceId ? flattenPath(this.state, entry.sourceId) : [];
        const placeableIdsToRemove = [];
        for (const el of flat) {
          if (el.kind === 'module') {
            const def = COMPONENTS[el.type];
            refund += Math.floor((def?.cost?.funding || 0) * 0.5);
            placeableIdsToRemove.push(el.id);
          }
        }
        // Pipes and their on-pipe placements are part of what the player is
        // demolishing, so they belong in the lump-sum payout. The pipes
        // themselves are torn down by removePlaceable below (which routes
        // through removeBeamPipe, releasing utility endpoints); skipRefund
        // keeps that path from double-crediting what is accumulated here.
        for (const pipe of (this.state.beamPipes || [])) {
          if (!placeableIdsToRemove.includes(pipe.start?.junctionId)
              && !placeableIdsToRemove.includes(pipe.end?.junctionId)) continue;
          refund += pipeRefund(pipe);
          for (const att of (pipe.placements || [])) {
            refund += Math.floor((COMPONENTS[att.type]?.cost?.funding || 0) * 0.5);
          }
        }
        for (const pid of placeableIdsToRemove) {
          // skipRefund: the accumulated 50% `refund` below is the whole
          // payout — removePlaceable's own 50% refund would double it.
          this.removePlaceable(pid, { skipRefund: true });
        }
        this.state.resources.funding += refund;
        if (this.editingBeamlineId === target.beamlineId) this.editingBeamlineId = null;
        if (this.selectedBeamlineId === target.beamlineId) this.selectedBeamlineId = null;
        this.registry.removeBeamline(target.beamlineId);
        this.log(`Demolished beamline (+$${refund.toLocaleString()})`, 'good');
        this.recalcAllBeamlines();
        this.computeSystemStats();
        this.emit('beamlineChanged');
        this.emit('placeableChanged');
        return true;
      }
      case 'beampipe':
        return this.removeBeamPipe(target.pipeId || target.id);
      case 'beampipeSection':
        return this.removeBeamPipeSection(
          target.pipeId || target.id, target.fromSub, target.toSub);
      case 'placement':
        return this.removeAttachment(target.pipeId, target.attachmentId);
      case 'infrastructure':
      case 'equipment':
      case 'furnishing':
      case 'decoration': {
        const id = target.entry?.id || target.id;
        return id ? this.removePlaceable(id) : false;
      }
      default:
        return false;
    }
  }

  /**
   * Remove every placed instance of a given kind. Used by the
   * "delete all furnishings" / "delete all beamline" UI tools.
   */
  removePlaceablesByKind(kind) {
    const ids = this.state.placeables
      .filter(p => p.kind === kind || p.category === kind)
      .map(p => p.id);
    let n = 0;
    for (const id of ids) {
      if (this.removePlaceable(id)) n++;
    }
    return n;
  }

  getPlaceable(id) {
    const idx = this.state.placeableIndex[id];
    return idx !== undefined ? this.state.placeables[idx] : null;
  }

  getPlaceablesByCategory(category) {
    return this.state.placeables.filter(p => p.category === category);
  }

  _syncLegacyPlaceableState() {
    // Keep legacy arrays in sync for renderers/systems not yet migrated
    this.state.facilityEquipment = this.state.placeables.filter(p => p.category === 'equipment');
    this.state.facilityGrid = {};
    for (const eq of this.state.facilityEquipment) {
      this.state.facilityGrid[eq.col + ',' + eq.row] = eq.id;
    }
    this.state.zoneFurnishings = this.state.placeables.filter(p => p.category === 'furnishing');
    this.state.zoneFurnishingSubgrids = this._getLegacyFurnishingSubgrids();
    // Every placed item that has a ZONE_FURNISHINGS def, regardless of kind.
    // The 32 room items (office/controlRoom/cafeteria/meetingRoom) are kind
    // 'furnishing'; the 43 LAB items (optics/rf/vacuum/cooling/diagnostics/
    // machineShop) are kind 'equipment'. state.zoneFurnishings stays the
    // furnishing-only render/hit-test view — the equipment pass in
    // world-snapshot already draws the lab items — but zone tiering and zone
    // EFFECTS must see both, or no research lab can ever rise above tier 0 and
    // every lab item's declared `effects` is dead data.
    this.state.zoneItems = this.state.placeables.filter(p => !!ZONE_FURNISHINGS[p.type]);
  }

  _getLegacyFurnishingSubgrids() {
    const subgrids = {};
    const furnishings = this.state.placeables.filter(p => p.category === 'furnishing');
    for (let i = 0; i < furnishings.length; i++) {
      const entry = furnishings[i];
      const def = ZONE_FURNISHINGS[entry.type];
      if (!def) continue;
      const key = entry.col + ',' + entry.row;
      if (!subgrids[key]) {
        subgrids[key] = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
      }
      const gw = entry.rotated ? (def.gridH || 1) : (def.gridW || 1);
      const gh = entry.rotated ? (def.gridW || 1) : (def.gridH || 1);
      const furnIdx = i + 1;
      for (let r = entry.subRow; r < entry.subRow + gh && r < 4; r++) {
        for (let c = entry.subCol; c < entry.subCol + gw && c < 4; c++) {
          subgrids[key][r][c] = furnIdx;
        }
      }
    }
    return subgrids;
  }

  getPlaceableAtSubgrid(col, row, subCol, subRow) {
    const key = col + ',' + row + ',' + subCol + ',' + subRow;
    const occ = this.state.subgridOccupied[key];
    if (!occ) return null;
    return this.getPlaceable(occ.id);
  }

  // === BEAM PIPE ===

  /**
   * Create a beam pipe. Pipes can be free-standing (fromId/toId null) or
   * connect two beamline modules via named ports.
   * @param {string|null} fromId - placeable id of source-side module, or null
   * @param {string|null} fromPort - port name, or null when fromId is null
   * @param {string|null} toId - placeable id of destination module, or null
   * @param {string|null} toPort - port name, or null when toId is null
   * @param {Array} path - array of {col, row} tile positions along the pipe route
   * @returns {boolean}
   */
  createBeamPipe(fromId, fromPort, toId, toPort, path) {
    return this.beamline.drawPipe(
      fromId ? { junctionId: fromId, portName: fromPort } : null,
      toId   ? { junctionId: toId,   portName: toPort   } : null,
      path,
    );
  }


  /**
   * Add an attachment (inline component) to an existing beam pipe.
   * Kept for compatibility with unmigrated callers; delegates to
   * BeamlineSystem.placeOnPipe with snap mode.
   * @param {string} pipeId - beam pipe ID
   * @param {string} type - component type (must be placement: 'attachment')
   * @param {number} position - 0..1 normalized position along pipe
   * @param {Object} params - optional parameter overrides
   */
  addAttachmentToPipe(pipeId, type, position, params) {
    return this.beamline.placeOnPipe(pipeId, { type, position, params, mode: 'snap' });
  }

  /**
   * Set the current pipe-placement UX mode (used by the placement controller
   * when committing a placement via `BeamlineSystem.placeOnPipe`).
   */
  setPlacementMode(mode) {
    if (mode !== 'snap' && mode !== 'insert' && mode !== 'replace') return;
    this.state.placementMode = mode;
    this.emit('placementModeChanged', mode);
  }

  /**
   * Remove an attachment from a pipe. Delegates to BeamlineSystem, which
   * detaches any utility line that was wired to it via the injected
   * `onPlacementRemoved` hook — placements are utility endpoints (see
   * utility/utility-endpoints.js), so a removed one would otherwise leave
   * lines pointing at a dead id in state and in every save.
   */
  removeAttachment(pipeId, attachmentId) {
    return this.beamline.removeFromPipe(pipeId, attachmentId);
  }

  /**
   * @param {string} pipeId
   * @param {{skipRefund?:boolean, silent?:boolean}} [opts] — `skipRefund`
   *   suppresses the pipe + placement credits (the caller is paying a lump
   *   sum of its own, e.g. the `beamlineWhole` demolish); `silent` suppresses
   *   the log line when the pipe is collateral of a larger demolish.
   */
  removeBeamPipe(pipeId, opts = {}) {
    const idx = this.state.beamPipes.findIndex(p => p.id === pipeId);
    if (idx === -1) return false;

    const pipe = this.state.beamPipes[idx];

    // Refund pipe cost (50%) off the SAME basis drawPipe charged with. The old
    // hand-rolled formula floored the basis at one full tile while the charge
    // floors at 0.25 tiles, so a 0.25-tile stub cost $2,500 and refunded
    // $5,000 — a repeatable money printer off any free port.
    if (!opts.skipRefund) this.state.resources.funding += pipeRefund(pipe);

    // Refund all placements on this pipe (50%), and detach any utility line
    // wired to one — they are utility endpoints, and the pipe is going away.
    for (const att of (pipe.placements || [])) {
      const attDef = COMPONENTS[att.type];
      if (!opts.skipRefund && attDef && attDef.cost) {
        for (const [r, a] of Object.entries(attDef.cost)) {
          this.state.resources[r] += Math.floor(a * 0.5);
        }
      }
      if (this.utilityLineSystem) this.utilityLineSystem.onPlaceableRemoved(att.id);
    }

    this.state.beamPipes.splice(idx, 1);
    if (!opts.silent) this.log('Removed beam pipe (50% refund)', 'info');
    this._deriveBeamGraph();
    this.schedulePhysicsRecalc();
    this.emit('beamlineChanged');
    return true;
  }

  /**
   * Delete sub-units `[fromSub, toSub)` of one pipe — the demolish tool's
   * section cut, at the pipe model's own 0.5 m quantum. A cut that reaches a
   * terminal shortens the run (detaching it from its junction if it was
   * bound); an interior cut leaves two independent pipes with open ends
   * facing the hole.
   *
   * A cut spanning the whole pipe delegates to removeBeamPipe rather than
   * being handled here: that is the only path that also refunds the hardware
   * mounted on the pipe and releases those placements' utility endpoints.
   *
   * @returns {boolean} true if anything was removed
   */
  removeBeamPipeSection(pipeId, fromSub, toSub) {
    const res = this.beamline.removePipeSection(pipeId, fromSub, toSub);
    if (!res) return false;
    if (res.action === 'removeAll') return this.removeBeamPipe(pipeId);

    const metres = (toSub - fromSub) * METRES_PER_SUB;
    this.log(
      `Removed ${metres} m of beam pipe (+$${res.refund.toLocaleString()})`,
      'info',
    );
    // BeamlineSystem emitted 'beamlineChanged' already, but the beam graph is
    // Game's to rebuild: an interior cut turns one run into two, and a
    // terminal cut can orphan a junction port. Skipping this leaves physics
    // solving a lattice that no longer exists.
    this._deriveBeamGraph();
    this.schedulePhysicsRecalc();
    return true;
  }

  /**
   * Derive beam graph from pipe connectivity.
   * Traverses from sources through beam pipes to build ordered component lists.
   * Updates state.beamline for physics simulation.
   *
   * Each source's flattened path is an INDEPENDENT machine. flattenPath()
   * restarts `beamStart` at 0 for every source, so the concatenation used to
   * hand out duplicate s-positions: probe pins on machine B resolved to
   * machine A's envelope samples. Every source after the first is therefore
   * shifted onto its own stretch of the s-axis (`sourceIndex` records which
   * machine an element belongs to, and _recalcMainBeamGraph runs one physics
   * pass per machine rather than treating the concatenation as one lattice).
   */
  _deriveBeamGraph() {
    const beamItems = this.state.placeables.filter(p => p.category === 'beamline');
    const sources = beamItems.filter(p => {
      const def = COMPONENTS[p.type];
      return def && def.isSource;
    });

    const allOrdered = [];
    let sOffset = 0;
    let sourceIndex = 0;
    for (const source of sources) {
      const flat = flattenPath(this.state, source.id);
      if (flat.length === 0) { sourceIndex++; continue; }
      let segEnd = 0;
      // Convert flattener entries to the shape physics expects.
      // Every entry needs: type, subL, stats, params, beamStart, tiles.
      for (const entry of flat) {
        const def = COMPONENTS[entry.type] || COMPONENTS.drift;
        allOrdered.push({
          id: entry.id,
          type: entry.kind === 'drift' ? 'drift' : entry.type,
          col: entry.placeable?.col ?? 0,
          row: entry.placeable?.row ?? 0,
          dir: entry.placeable?.dir ?? 0,
          params: entry.params || {},
          tiles: entry.placeable?.cells?.map(c => ({ col: c.col, row: c.row })) || [],
          beamStart: entry.beamStart + sOffset,
          subL: entry.subL,
          // Pass through stats from the component template so physics can read them
          stats: def ? { ...def.stats } : {},
          isAttachment: entry.kind === 'placement',
          pipeId: entry.pipeId || null,
          sourceIndex,
        });
        segEnd = Math.max(segEnd, (entry.beamStart || 0) + (entry.subL || 0) * 0.5);
      }
      sOffset += segEnd + BEAM_GRAPH_SOURCE_GAP_M;
      sourceIndex++;
    }

    this.state.beamline = allOrdered;
  }

  // === DECORATIONS ===

  /**
   * Returns the placed decoration instance at (col,row), or null. Used by
   * crop/clear/bulldozer code that needs "is there a decoration on this
   * tile?" semantics.
   */
  _decorationAtTile(col, row) {
    for (let sr = 0; sr < 4; sr++) {
      for (let sc = 0; sc < 4; sc++) {
        const k = col + ',' + row + ',' + sc + ',' + sr;
        const occ = this.state.subgridOccupied[k];
        if (!occ || occ.kind !== 'decoration') continue;
        const idx = this.state.placeableIndex[occ.id];
        if (idx === undefined) continue;
        return this.state.placeables[idx];
      }
    }
    return null;
  }

  removeDecoration(col, row, subCol = 0, subRow = 0, opts = {}) {
    // Legacy signature. Look up the instance occupying the tile and route
    // through the unified removePlaceable path.
    if (typeof subCol === 'number' && typeof subRow === 'number' && arguments.length >= 4) {
      const key = col + ',' + row + ',' + subCol + ',' + subRow;
      const occ = this.state.subgridOccupied[key];
      if (occ) return this.removePlaceable(occ.id, opts);
      return false;
    }
    // Two-arg form may pass opts in the third position.
    const options = typeof subCol === 'object' && subCol !== null ? subCol : opts;
    const inst = this._decorationAtTile(col, row);
    if (!inst) return false;
    return this.removePlaceable(inst.id, options);
  }

  hasBlockingDecoration(col, row) {
    const inst = this._decorationAtTile(col, row);
    if (!inst) return false;
    const def = DECORATIONS[inst.type];
    return def ? def.blocksBuild : false;
  }

  _clearNonBlockingDecoration(col, row) {
    const inst = this._decorationAtTile(col, row);
    if (!inst) return;
    const def = DECORATIONS[inst.type];
    if (def && !def.blocksBuild) {
      this.removePlaceable(inst.id);
    }
  }

  // === STATS ===

  /**
   * Lazily create a legacy registry entry for a source placeable so the
   * existing click/window flow (_getNodeAtGrid → registry → BeamlineWindow)
   * can find it. Sources placed via the unified placeable system have no
   * registry representation by default; this bridges the gap. Idempotent.
   *
   * This is also the single point where the New Beamline picker's choice lands
   * in the model: `pendingBeamlineTypeId` is read here, stamped on the entry as
   * `typeId`, and the type's `machineType` becomes the beamState's — the ONLY
   * way a beamline ever gets a machine type other than the plain 'linac'
   * fallback. There used to be a `dcPhotoGun`/`ncRfGun`/`srfGun` → 'photoinjector'
   * branch here; none of those three ids has existed in COMPONENTS for some
   * time, so it was unreachable and is gone.
   */
  _ensureBeamlineForSourcePlaceable(instance) {
    if (!instance) return null;
    const comp = COMPONENTS[instance.type];
    if (!comp?.isSource) return null;
    if (instance.beamlineId && this.registry.get(instance.beamlineId)) {
      return instance.beamlineId;
    }
    const type = this.pendingBeamlineTypeId
      ? getBeamlineType(this.pendingBeamlineTypeId)
      : null;
    const entry = this.registry.createBeamline(
      type ? type.machineType : 'linac',
      instance.id,
      type ? type.id : null,
    );
    instance.beamlineId = entry.id;

    if (type) {
      // Consume the pick, and drop the player straight into editing what they
      // just started so the palette stays filtered to the type they chose.
      this.pendingBeamlineTypeId = null;
      this.editingBeamlineId = entry.id;
      this.selectedBeamlineId = entry.id;
      this.log(`${entry.name} started as a ${type.name}`, 'good');
      this.emit('editModeChanged', entry.id);
    }
    return entry.id;
  }

  /**
   * The BEAMLINE_TYPES id for a beamline, or null if it has none.
   *
   * Reads the registry entry's `typeId` and nothing else. In particular it does
   * NOT infer a type from the component list: inference is what let an
   * undulator on a storage ring pass for an FEL.
   */
  getBeamlineTypeId(beamlineId) {
    const entry = beamlineId ? this.registry.get(beamlineId) : null;
    return entry?.typeId || null;
  }

  /**
   * The type whose palette the player is currently building against.
   *
   * A beamline actually under edit (or merely selected) wins; failing that, the
   * pick made in the New Beamline picker that has not yet been spent on a
   * source. Null means "no type" and the palette shows everything, which is
   * what every pre-picker save and every scenario-authored beamline gets.
   */
  getActiveBeamlineTypeId() {
    return this.getBeamlineTypeId(this.editingBeamlineId)
      || this.getBeamlineTypeId(this.selectedBeamlineId)
      || this.pendingBeamlineTypeId
      || null;
  }

  /**
   * Arm the New Beamline flow: the next source placed becomes a beamline of
   * this type. Passing null clears the pick (free build).
   */
  startNewBeamline(typeId) {
    const type = typeId ? getBeamlineType(typeId) : null;
    this.pendingBeamlineTypeId = type ? type.id : null;
    // Clear the edit/selection focus so getActiveBeamlineTypeId reports the new
    // pick rather than whatever beamline happened to be selected.
    this.editingBeamlineId = null;
    this.selectedBeamlineId = null;
    this.emit('editModeChanged', null);
    return this.pendingBeamlineTypeId;
  }

  /**
   * Tear down the registry entry created for a source placeable.
   */
  _removeBeamlineForSourcePlaceable(instance) {
    if (!instance || !instance.beamlineId) return;
    this.registry.removeBeamline(instance.beamlineId);
    instance.beamlineId = null;
  }

  _openDesignerForBeamline(beamlineId) {
    if (!this._designer) return;
    const entry = this.registry.get(beamlineId);
    if (!entry || !entry.sourceId) return;
    this._designer.openFromSource(entry.sourceId);
  }

  recalcBeamline(beamlineId) {
    if (beamlineId) {
      const entry = this.registry.get(beamlineId);
      if (!entry) return;
      this._ensureNodeQualitiesSolved();
      this._recalcSingleBeamline(entry);
      // Deliberately NOT stamping _nodeQualitySig: only the all-entries pass
      // may claim every beamState was rebuilt against the current qualities.
    } else {
      // Recalc all if no id given (backward compat)
      this.recalcAllBeamlines();
      return;
    }
    this._updateAggregateBeamline();
    this._recalcMainBeamGraph();
    this.validateInfrastructure();
  }

  recalcAllBeamlines() {
    this._ensureNodeQualitiesSolved();
    for (const entry of this.registry.getAll()) {
      this._recalcSingleBeamline(entry);
    }
    this._nodeQualitySig = this._nodeQualitySignature();
    this._updateAggregateBeamline();
    this._recalcMainBeamGraph();
    this.validateInfrastructure();
  }

  /**
   * The physics pass stamps each element's fail-closed `infraQuality` from
   * state.nodeQualities, which ONLY the gate writes — and the gate runs LAST
   * in tick(). On the boot/load path it has never run, so the pass would read
   * an empty map, floor every declared sink to 0 and latch there (nothing
   * re-runs the pass per tick). Solve once so the first pass sees real
   * qualities. No-op afterwards: the gate always leaves an object behind.
   */
  _ensureNodeQualitiesSolved() {
    if (this.state.nodeQualities || !this.utilityGate) return;
    this.utilityGate.run();
  }

  /**
   * Signature of the solved qualities the physics pass consumes. Quantized to
   * 1e-2 so a vacuum pumping down over hundreds of ticks re-runs physics a
   * bounded number of times instead of every tick; keys sorted so network
   * iteration order alone can never look like a change.
   */
  _nodeQualitySignature() {
    const nq = this.state.nodeQualities;
    if (!nq) return '';
    const out = [];
    for (const id of Object.keys(nq).sort()) {
      const entry = nq[id] || {};
      let s = id;
      for (const field of Object.keys(entry).sort()) {
        const v = entry[field];
        s += `|${field}:${typeof v === 'number' ? Math.round(v * 100) : v}`;
      }
      out.push(s);
    }
    return out.join(';');
  }

  /**
   * Re-stamp physics when the solved qualities moved since the last full pass
   * — wiring a starved cavity, a vacuum pumping down, a quench. Called from
   * tick() right after the gate, which is the only writer; without it a
   * player who fixed the wiring saw the blocker clear while the beam stayed
   * at the fail-closed 0 until the next build mutation.
   */
  _syncPhysicsToNodeQualities() {
    if (this._nodeQualitySig === this._nodeQualitySignature()) return;
    this.recalcAllBeamlines();
  }

  // Physics pass for the unified main-map pipe graph. Runs additively on top
  // of the per-registry-entry physics used by designer-placed beamlines.
  // Derives state.beamline from the pipe graph (via _deriveBeamGraph) and
  // runs BeamPhysics.compute() once over the ordered modules + drift + attachments.
  // Result is stored in state.mainBeamState so renderers / HUD can read it
  // without clobbering per-entry beamState data.
  _recalcMainBeamGraph() {
    // _deriveBeamGraph writes the unified ordered list into state.beamline
    // (overwriting the registry-node snapshot _updateAggregateBeamline set).
    this._deriveBeamGraph();
    const ordered = this.state.beamline || [];
    if (ordered.length === 0) {
      this.state.mainBeamState = null;
      return;
    }

    // Contract check: every entry must have a positive subL so physics s-axis is correct
    for (const node of ordered) {
      if (!node.subL || node.subL <= 0) {
        console.warn('[physics] element with bad subL', node);
      }
    }

    // Build physics input from ordered entries. Each entry already has subL
    // in sub-units, params, and the component type. Physics multiplies subL
    // by 0.5 to get metres.
    const toPhysics = (nodes) => nodes.map(node => {
      const def = COMPONENTS[node.type];
      return {
        type: node.type,
        subL: node.subL || (def ? def.subL : 4) || 4,
        stats: def && def.stats ? { ...def.stats } : {},
        params: node.params || {},
      };
    });

    // One lattice per SOURCE. Feeding the concatenation of every source's
    // path to a single compute() made lattice.py treat a mid-lattice source
    // as a bare s-advance (no beam reset) and extract_source_params only ever
    // read the first source — so machine B was computed as a continuation of
    // machine A's exit beam, and the HUD's "peak energy" was A's gain plus
    // B's gain instead of max(A, B).
    const segments = [];
    for (const node of ordered) {
      const idx = node.sourceIndex || 0;
      const seg = segments.find(s => s.index === idx);
      if (seg) seg.nodes.push(node);
      else segments.push({ index: idx, nodes: [node], offset: node.beamStart || 0 });
    }

    // Collect research effects
    const researchEffects = {};
    for (const key of RESEARCH_PHYSICS_EFFECT_KEYS) {
      const v = this.getEffect(key, key.endsWith('Mult') ? 1 : 0);
      researchEffects[key] = v;
    }

    if (!BeamPhysics.isReady()) {
      this.state.mainBeamState = null;
      return;
    }
    const runs = [];
    for (const seg of segments) {
      const res = BeamPhysics.compute(toPhysics(seg.nodes), researchEffects);
      if (res) runs.push({ res, offset: seg.offset });
    }
    if (runs.length === 0) {
      this.state.mainBeamState = null;
      this.emit('physicsUpdated');
      return;
    }

    // Headline state is the strongest machine; production rates are additive
    // across machines. The envelope is the machines' envelopes laid end to end
    // on the same shifted s-axis state.beamline uses, so probe pins (which
    // resolve by nearest `.s` to their element's beamStart) land in their own
    // machine's samples.
    let main;
    if (runs.length === 1) {
      main = runs[0].res;
    } else {
      const best = runs.reduce((a, b) => ((b.res.beamEnergy || 0) > (a.res.beamEnergy || 0) ? b : a));
      main = { ...best.res };
      for (const key of ['dataRate', 'collisionRate', 'photonRate', 'luminosity', 'nDiagnostics']) {
        main[key] = runs.reduce((sum, r) => sum + (r.res[key] || 0), 0);
      }
      main.beamAlive = runs.some(r => r.res.beamAlive);
    }

    const envelope = [];
    for (const { res, offset } of runs) {
      for (const s of (res.envelope || [])) {
        envelope.push(offset ? { ...s, s: (s.s || 0) + offset } : s);
      }
    }
    main.envelope = envelope;
    this.state.mainBeamState = main;
    // Also expose envelope for probe.js, which reads state.physicsEnvelope
    if (envelope.length > 0) {
      this.state.physicsEnvelope = envelope;
    }
    this.emit('physicsUpdated');
  }

  /**
   * Coalesced physics recalc for build-time mutations. Runs the FULL pass
   * (`recalcAllBeamlines` → per-entry `_recalcSingleBeamline`, the aggregate
   * roll-up, `_recalcMainBeamGraph` and `validateInfrastructure`), not just
   * the main-graph half: `_tickBeamline` drives income, data and objectives
   * off `entry.beamState`, which only `_recalcSingleBeamline` ever writes.
   * The microtask guard keeps a multi-mutation gesture (a design placement, a
   * drag-demolish sweep) to one pass.
   */
  schedulePhysicsRecalc() {
    if (this._physicsRecalcPending) return;
    this._physicsRecalcPending = true;
    queueMicrotask(() => {
      this._physicsRecalcPending = false;
      try {
        this.recalcAllBeamlines();
      } catch (e) {
        console.warn('[physics] deferred recalc failed:', e);
      }
    });
  }

  _recalcSingleBeamline(entry) {
    // The type is authoritative over beamState.machineType, and re-asserting it
    // here — before any early return — is what stops the two drifting. A typed
    // beamline can then never be handed a machine type its type disagrees
    // with, whatever a save file or an older code path wrote. Untyped entries
    // keep whatever they carry.
    const blType = entry.typeId ? getBeamlineType(entry.typeId) : null;
    if (blType) entry.beamState.machineType = blType.machineType;

    const ordered = entry.sourceId ? flattenPath(this.state, entry.sourceId) : [];

    // Calculate energy cost and total length from templates
    let tLen = 0, tCost = 0, hasSrc = false;
    const ecm = this.getEffect('energyCostMult', 1);
    for (const el of ordered) {
      const t = COMPONENTS[el.type];
      if (!t) {
        // Flattener drift entries (kind === 'drift') have no `type`. They are
        // still real metres of machine — skipping them made the HUD's
        // "Beamline … m" readout report only the summed component lengths
        // (a 28 m machine displayed as 9.5 m). They draw no power.
        if (el.kind === 'drift') tLen += (el.subL || 0) * 0.5;
        continue;
      }
      tLen += (el.subL || t.subL || 4) * 0.5;
      tCost += (t.energyCost || 0) * ecm;
      if (t.isSource) hasSrc = true;
    }
    entry.beamState.totalLength = tLen;
    entry.beamState.totalEnergyCost = Math.ceil(tCost);

    if (!hasSrc) {
      entry.beamState.beamEnergy = 0;
      entry.beamState.dataRate = 0;
      entry.beamState.beamQuality = 1;
      entry.beamState.luminosity = 0;
      entry.beamState.physicsEnvelope = null;
      return;
    }

    // Build ordered beamline for physics engine — drift passthrough, the
    // computeStats overlay and the fail-closed infraQuality floor all live in
    // physics-payload.js, which documents why each is shaped the way it is.
    const physicsBeamline = buildPhysicsElements(ordered, {
      nodeQualities: this.state.nodeQualities,
    });

    // Gather research effects for physics
    const researchEffects = {};
    for (const key of RESEARCH_PHYSICS_EFFECT_KEYS) {
      const v = this.getEffect(key, key.endsWith('Mult') ? 1 : 0);
      researchEffects[key] = v;
    }
    // Already reconciled against entry.typeId at the top of this method, so
    // this is the type's machineType whenever the beamline has a type.
    researchEffects.machineType = entry.beamState.machineType;

    // Run physics simulation
    this.runPhysicsForBeamline(entry, physicsBeamline, researchEffects);
  }

  _updateAggregateBeamline() {
    // state.beamline is set by _deriveBeamGraph (pipe/placement changes).
    // Don't overwrite it here — just aggregate per-beamline stats from the registry.
    const entries = this.registry.getAll();
    let totalLength = 0, totalEnergyCost = 0;
    let beamOn = false;
    let maxBeamEnergy = 0, maxBeamQuality = 0, maxLuminosity = 0;
    let totalDataCollected = 0, totalBeamHours = 0;
    let maxContinuousBeamTicks = 0, totalBeamOnTicks = 0;
    let felSaturated = false;
    let avgPressure = undefined;
    let finalNormEmittanceX = undefined;
    let finalBunchLength = undefined;

    for (const entry of entries) {
      const bs = entry.beamState;
      totalLength += bs.totalLength || 0;
      totalDataCollected += bs.totalDataCollected || 0;
      totalBeamHours += bs.totalBeamHours || 0;
      totalBeamOnTicks += bs.beamOnTicks || 0;

      if (entry.status === 'running' && this.state.infraCanRun) {
        beamOn = true;
        // Electricity is billed per running beamline (economy.computeTickUpkeep
        // reads state.totalEnergyCost). Summing stopped beamlines too charged
        // an idle machine full power whenever any OTHER beamline ran.
        totalEnergyCost += bs.totalEnergyCost || 0;
        if (bs.continuousBeamTicks > maxContinuousBeamTicks) maxContinuousBeamTicks = bs.continuousBeamTicks;
      } else if (entry.status === 'running' && !this.state.infraCanRun) {
        // Infra fault — reset continuous run, beam is effectively off for objectives
        bs.continuousBeamTicks = 0;
      }
      if (bs.beamEnergy > maxBeamEnergy) maxBeamEnergy = bs.beamEnergy;
      if (bs.beamQuality > maxBeamQuality) maxBeamQuality = bs.beamQuality;
      if (bs.luminosity > maxLuminosity) maxLuminosity = bs.luminosity;
      if (bs.felSaturated) felSaturated = true;
    }

    this.state.totalLength = totalLength;
    this.state.totalEnergyCost = totalEnergyCost;
    this.state.beamOn = beamOn;
    this.state.beamEnergy = maxBeamEnergy;
    this.state.beamQuality = maxBeamQuality;
    this.state.luminosity = maxLuminosity;
    this.state.totalDataCollected = totalDataCollected;
    this.state.totalBeamHours = totalBeamHours;
    this.state.continuousBeamTicks = maxContinuousBeamTicks;
    this.state.beamOnTicks = totalBeamOnTicks;
    this.state.felSaturated = felSaturated;
    // Facility uptime is the MEAN of the per-beamline uptimes, not the sum of
    // beam-on ticks over wall-clock ticks: totalBeamOnTicks accumulates once
    // per beamline, so dividing by state.tick produced a value up to N with N
    // beamlines and let the `highAvailability` objective (>= 0.95) pay out for
    // a facility whose beams were down most of the time. Same accessor the
    // per-beamline figure uses, so the two can't drift apart again.
    this.state.uptimeFraction = facilityUptime(
      entries.map(e => e.beamState), this.state.tick,
    );

    // For single-beamline compat: expose first running beamline's detailed
    // physics. NOTE: avgPressure is deliberately NOT mirrored here — no
    // physics result carries a pressure, so this used to overwrite the value
    // computeSystemStats had produced with `undefined` on every tick, right
    // before checkObjectives ran. computeSystemStats owns state.avgPressure.
    const detailed = entries.find(e => e.status === 'running') || entries[0];
    if (detailed) {
      this.state.finalNormEmittanceX = detailed.beamState.finalNormEmittanceX;
      this.state.finalBunchLength = detailed.beamState.finalBunchLength;
    }
  }

  /**
   * Stamp per-cavity physics results onto their placeables.
   *
   * This is one half of the thermal feedback loop. The physics pass decides
   * what gradient a cavity achieved at the temperature it was given; the
   * cryogenic solver (src/utility/types/cryoTransfer.js) then reads `pDissW`
   * off the placeable on the next tick to work out how much heat the plant has
   * to remove, which sets the temperature the physics pass will see after
   * that. Neither side can be evaluated first, so the loop is closed with a
   * one-tick lag rather than a simultaneous solve.
   *
   * Transient — deliberately not serialised. On load the fields are absent,
   * the solver bills static load only for one tick, and the loop re-converges.
   */
  _writeBackCavityResults(cavities) {
    if (!Array.isArray(cavities) || cavities.length === 0) return;
    // Cavities are role-'placement' modules and live inside pipe.placements,
    // NOT state.placeables — the same trap utility-endpoints.js documents. A
    // placeables-only lookup would find none of them and the thermal loop
    // would never see any dynamic load.
    const byId = new Map();
    for (const p of (this.state.placeables || [])) byId.set(p.id, p);
    for (const pipe of (this.state.beamPipes || [])) {
      for (const att of (pipe.placements || [])) byId.set(att.id, att);
    }
    for (const cav of cavities) {
      if (!cav || !cav.id) continue;
      const inst = byId.get(cav.id);
      if (!inst) continue;
      inst.gradientAchieved = cav.gradientAchieved;
      inst.gradientDemanded = cav.gradientDemanded;
      inst.gradientAchievable = cav.gradientAchievable;
      inst.pDissW = cav.pDissW;
      inst.cavityQ0 = cav.q0;
      inst.reflectedFraction = cav.reflectedFraction;
      inst.quenched = cav.quenched;
    }
  }

  runPhysicsForBeamline(entry, physicsBeamline, researchEffects) {
    if (!BeamPhysics.isReady()) {
      // Physics not loaded yet -- use simple fallback
      this._fallbackStatsForBeamline(entry, physicsBeamline);
      return;
    }

    const result = BeamPhysics.compute(physicsBeamline, researchEffects);
    if (!result) {
      this._fallbackStatsForBeamline(entry, physicsBeamline);
      return;
    }

    // Apply physics results to beamState
    const bs = entry.beamState;
    bs.beamEnergy = result.beamEnergy;
    bs.dataRate = result.dataRate;
    bs.beamQuality = result.beamQuality;
    bs.luminosity = result.luminosity || 0;
    bs.physicsAlive = result.beamAlive;
    bs.beamCurrent = result.beamCurrent;
    bs.totalLossFraction = result.totalLossFraction;
    bs.discoveryChance = result.discoveryChance || 0;
    bs.photonRate = result.photonRate || 0;
    bs.collisionRate = result.collisionRate || 0;
    bs.physicsEnvelope = result.envelope || null;
    // These three are produced by gameplay.py but used to be dropped here,
    // which left the objectives that read them (subMicronEmittance,
    // bunchCompressed, felSaturation) permanently unreachable.
    bs.finalNormEmittanceX = result.finalNormEmittanceX;
    bs.finalBunchLength = result.finalBunchLength;
    bs.felSaturated = !!result.felSaturated;
    this._writeBackCavityResults(result.cavities);

    // If physics says beam tripped, fault this beamline
    if (entry.status === 'running' && !result.beamAlive) {
      entry.status = 'stopped';
      bs.continuousBeamTicks = 0;
      this.log('Beam TRIPPED -- too much loss! Fix your optics.', 'bad');
      this.emit('beamToggled');
    }
  }

  _fallbackStatsForBeamline(entry, physicsBeamline) {
    // Simple stat-summing fallback while Pyodide loads (and the whole model
    // in node — tests, balance-sim, the headless agent env).
    //
    // It must honour `el.infraQuality`, the per-node utility qualities
    // _recalcSingleBeamline attaches: ignoring them made the Phase-6
    // utility-quality → beam-output coupling a no-op everywhere physics
    // isn't loaded, so a facility with every cooling line cut produced
    // bit-identical output to a fully wired one. Mirrors the derates in
    // beam_physics/gameplay.py (energy gain scales with power/RF/cooling/cryo
    // quality; a quenched SRF cavity becomes a drift; poor vacuum widens
    // losses) at this model's coarser resolution. dataQuality is deliberately
    // NOT applied here — _tickBeamline already derates data by it.
    const q01 = (v) => (typeof v === 'number' ? Math.max(0, Math.min(1, v)) : 1);
    let eGain = 0, dRate = 0, bq = 1;
    let worstVacuum = 1;
    for (const el of physicsBeamline) {
      const s = el.stats || {};
      const iq = el.infraQuality || {};
      const gainScale = iq.cryoQuenched === true
        ? 0
        : q01(iq.powerQuality) * q01(iq.rfQuality) * q01(iq.coolingQuality) * q01(iq.cryoQuality);
      if (s.energyGain) eGain += s.energyGain * gainScale;
      if (s.dataRate) dRate += s.dataRate;
      if (s.beamQuality) bq += s.beamQuality;
      if (el.infraQuality) worstVacuum = Math.min(worstVacuum, q01(iq.vacuumQuality));
    }
    // Poor vacuum scatters beam: gameplay.py narrows the aperture by
    // (0.5 + 0.5 * vacuumQuality); apply the same factor to quality here.
    bq *= 0.5 + 0.5 * worstVacuum;
    // Clamp to the same [0, 1] range the real physics path produces
    // (gameplay.py / lattice.py both cap quality at 1.0). Unclamped, each
    // diagnostic/collimation component pushed quality above 1 and every
    // downstream consumer — beam income, data fees, user fees, reputation,
    // research rate — paid a multiplier the physics path can never reach.
    bq = Math.max(0, Math.min(1, bq));
    const bs = entry.beamState;
    bs.beamEnergy = eGain;
    bs.dataRate = dRate * bq;
    bs.beamQuality = bq;
    bs.luminosity = 0;
    bs.physicsAlive = true;
    bs.beamCurrent = 0;
    bs.totalLossFraction = 0;
    bs.discoveryChance = 0;
    bs.photonRate = 0;
    bs.collisionRate = 0;
    bs.physicsEnvelope = null;
  }

  // === BEAM CONTROL ===

  toggleBeam(beamlineId) {
    // Callers without an explicit id (the Space hotkey) get a default: the
    // currently selected beamline, or the only one that exists. Without this
    // the hotkey was a dead affordance that logged "No beamline specified!",
    // naming something the UI never asks the player to specify.
    if (!beamlineId) {
      const all = this.registry.getAll();
      beamlineId = this.selectedBeamlineId
        || (all.length === 1 ? all[0].id : null);
      if (!beamlineId) {
        this.log(all.length ? 'Select a beamline first' : 'No beamline built yet!', 'bad');
        return;
      }
    }
    const entry = this.registry.get(beamlineId);
    if (!entry) {
      this.log('Beamline not found!', 'bad');
      return;
    }

    if (entry.status === 'running') {
      entry.status = 'stopped';
      entry.beamState.continuousBeamTicks = 0;
      this.log('Beam OFF', 'info');
    } else {
      const flat = entry.sourceId ? flattenPath(this.state, entry.sourceId) : [];
      if (!flat.some(el => COMPONENTS[el.type]?.isSource)) {
        this.log('Need a Source!', 'bad'); return;
      }
      // Recompute the gate NOW rather than reading whatever the last tick
      // left behind: validateInfrastructure() only emits, and while the game
      // is paused the tick interval is cleared, so state.infraBlockers can be
      // arbitrarily stale in both directions (refusing a beam over faults the
      // player already fixed, or starting one with the utilities cut).
      this.refreshInfrastructureGate();
      if (!this.state.infraCanRun) {
        const count = this.state.infraBlockers.length;
        this.log(`Cannot start beam: ${count} infrastructure issue${count > 1 ? 's' : ''}`, 'bad');
        for (const b of this.state.infraBlockers.slice(0, 3)) {
          this.log(`  - ${b.reason}`, 'bad');
        }
        if (count > 3) this.log(`  ... and ${count - 3} more`, 'bad');
        return;
      }
      entry.status = 'running';
      this.log('Beam ON!', 'good');
    }
    this.emit('beamToggled');
  }

  // === RESEARCH (delegates to research module) ===

  isResearchAvailable(id) {
    return research.isResearchAvailable(id, this.state);
  }

  startResearch(id) {
    const result = research.startResearch(id, this.state, (msg, type) => this.log(msg, type));
    if (result) this.emit('researchChanged');
    return result;
  }

  getEffect(key, def) {
    return research.getEffect(key, def, this.state.completedResearch);
  }

  getLabResearchTier(labType) {
    return research.getLabResearchTier(labType, this.state);
  }

  getResearchSpeedMultiplier(id) {
    return research.getResearchSpeedMultiplier(id, this.state);
  }

  _computeFinalNodes() {
    return research._computeFinalNodes();
  }

  // === SYSTEM STATS (delegates to economy module) ===

  computeZoneFurnishingBonuses() {
    // Returns { zoneOutput: { zoneType -> totalBonus }, research: { zoneType -> totalBonus } }
    const zoneOutput = {};
    const research = {};

    for (const furn of (this.state.zoneItems || this.state.zoneFurnishings)) {
      const furnDef = ZONE_FURNISHINGS[furn.type];
      if (!furnDef || !furnDef.effects) continue;

      const key = furn.col + ',' + furn.row;
      const tileZone = this.state.zoneOccupied[key];

      // zoneOutput only applies in the preferred zone
      if (furnDef.effects.zoneOutput && itemMatchesZone(furnDef, tileZone)) {
        zoneOutput[tileZone] = (zoneOutput[tileZone] || 0) + furnDef.effects.zoneOutput;
      }

      // research applies in the preferred zone
      if (furnDef.effects.research && itemMatchesZone(furnDef, tileZone)) {
        research[tileZone] = (research[tileZone] || 0) + furnDef.effects.research;
      }
    }

    return { zoneOutput, research };
  }

  _detectRoom(startCol, startRow) {
    const wallOcc = this.state.wallOccupied || {};
    const doorOcc = this.state.doorOccupied || {};
    const room = new Set();
    const queue = [`${startCol},${startRow}`];
    room.add(queue[0]);
    const MAX_TILES = 500;

    const edgeBlocked = (wallKey1, wallKey2, doorKey1, doorKey2) =>
      (wallOcc[wallKey1] || wallOcc[wallKey2]) && !doorOcc[doorKey1] && !doorOcc[doorKey2];

    while (queue.length > 0 && room.size < MAX_TILES) {
      const key = queue.shift();
      const [c, r] = key.split(',').map(Number);

      const eKey = `${c + 1},${r}`;
      if (!room.has(eKey) && !edgeBlocked(`${c},${r},e`, `${c+1},${r},w`, `${c},${r},e`, `${c+1},${r},w`)) {
        room.add(eKey); queue.push(eKey);
      }
      const wKey = `${c - 1},${r}`;
      if (!room.has(wKey) && !edgeBlocked(`${c-1},${r},e`, `${c},${r},w`, `${c-1},${r},e`, `${c},${r},w`)) {
        room.add(wKey); queue.push(wKey);
      }
      const sKey = `${c},${r + 1}`;
      if (!room.has(sKey) && !edgeBlocked(`${c},${r},s`, `${c},${r+1},n`, `${c},${r},s`, `${c},${r+1},n`)) {
        room.add(sKey); queue.push(sKey);
      }
      const nKey = `${c},${r - 1}`;
      if (!room.has(nKey) && !edgeBlocked(`${c},${r-1},s`, `${c},${r},n`, `${c},${r-1},s`, `${c},${r},n`)) {
        room.add(nKey); queue.push(nKey);
      }
    }
    return room;
  }

  computeRoomMorale() {
    const roomMorale = new Map();
    const tileToRoom = {};
    const processed = new Set();

    for (const furn of (this.state.zoneItems || this.state.zoneFurnishings)) {
      const furnDef = ZONE_FURNISHINGS[furn.type];
      if (!furnDef || !furnDef.effects || !furnDef.effects.morale) continue;

      const key = furn.col + ',' + furn.row;
      let room = tileToRoom[key];
      if (!room && !processed.has(key)) {
        room = this._detectRoom(furn.col, furn.row);
        for (const tileKey of room) {
          tileToRoom[tileKey] = room;
          processed.add(tileKey);
        }
      }
      if (!room) continue;

      const roomKey = [...room].sort()[0];
      const current = roomMorale.get(roomKey) || 0;
      roomMorale.set(roomKey, current + furnDef.effects.morale);
    }

    return roomMorale;
  }

  getBeamPhysicsEffects() {
    const results = [];

    for (const furn of (this.state.zoneItems || this.state.zoneFurnishings)) {
      const furnDef = ZONE_FURNISHINGS[furn.type];
      if (!furnDef || !furnDef.effects || !furnDef.effects.beamPhysics) continue;

      const room = this._detectRoom(furn.col, furn.row);

      for (const entry of this.registry.getAll()) {
        for (const node of entry.nodes) {
          for (const tile of (node.tiles || [{ col: node.col, row: node.row }])) {
            const tileKey = tile.col + ',' + tile.row;
            if (room.has(tileKey)) {
              results.push({
                beamlineId: entry.id,
                effects: furnDef.effects.beamPhysics,
                furnishingId: furn.id,
              });
              break;
            }
          }
        }
      }
    }

    return results;
  }

  computeSystemStats() {
    const result = computeSystemStats(this.state);
    this.state.systemStats = result;
    this.state.avgPressure = result.avgPressure;
    const furnBonuses = this.computeZoneFurnishingBonuses();
    this.state.zoneFurnishingBonuses = furnBonuses;
  }

  // === GAME LOOP ===

  start() {
    if (this._started) return;
    this._started = true;
    this.computeSystemStats();
    this.validateInfrastructure();
    this._syncInterval();
    this.log('Welcome to Beamline Tycoon!', 'info');
    this.emit('started');
  }

  // (Re)create the tick interval from state.paused / state.speed. No catch-up
  // accumulator by choice: background-tab throttling slowing the sim is
  // acceptable tycoon behavior.
  _syncInterval() {
    if (this.tickInterval) { clearInterval(this.tickInterval); this.tickInterval = null; }
    if (!this._started || this.state.paused) return;
    this.tickInterval = setInterval(() => this.tick(), this.TICK_MS / (this.state.speed || 1));
  }

  pause() {
    if (this.state.paused) return;
    this.state.paused = true;
    this._syncInterval();
    this.emit('speedChanged');
  }

  resume() {
    if (!this.state.paused) return;
    this.state.paused = false;
    this._syncInterval();
    this.emit('speedChanged');
  }

  togglePause() {
    if (this.state.paused) this.resume(); else this.pause();
  }

  setSpeed(mult) {
    if (mult !== 1 && mult !== 2 && mult !== 4) return;
    if (this.state.speed === mult) return;
    this.state.speed = mult;
    this._syncInterval();
    this.emit('speedChanged');
  }

  stop() {
    if (this.tickInterval) { clearInterval(this.tickInterval); this.tickInterval = null; }
    this._started = false;
  }

  tick() {
    this.state.tick++;
    // Derived from the exact integer tick, not accumulated — see
    // TIME_OF_DAY_PHASE_OFFSET_TICKS above for why.
    this.state.timeOfDay =
      ((this.state.tick + TIME_OF_DAY_PHASE_OFFSET_TICKS) % DAY_LENGTH_TICKS) / DAY_LENGTH_TICKS;

    // Dev mode: keep funding pinned at a huge value. Placed at the top so
    // every cost check inside this tick sees the refilled balance.
    if (this.devMode) {
      this.state.resources.funding = 1e12;
    }

    // Decoration effects
    const decorationInstances = this.state.placeables.filter(p => p.kind === 'decoration');
    this.state.moraleMultiplier = computeMoraleMultiplier(decorationInstances);
    const roomMorale = this.computeRoomMorale();
    let totalFurnishingMorale = 0;
    for (const [, morale] of roomMorale) {
      totalFurnishingMorale += morale;
    }
    this.state.furnishingMorale = totalFurnishingMorale;
    this.state.reputationTier = getReputationTier(decorationInstances.length);

    // === Economy === (tuning knobs live in economy.js ECON)
    //
    // Every term is accumulated here as it is charged and published once, at
    // the end of the tick, as state.economySnapshot. Nothing downstream may
    // re-derive one of these for display: a second derivation of the user fee
    // is how the HUD came to quote it 50x off what was really paid.
    const econ = {
      grant: 0, reputation: 0, beam: 0, dataFees: 0,
      staff: 0, power: 0, pumps: 0,
      // Refills were charged between ticks, not by this one.
      refills: this._refillsCharged,
      beamlines: 0,
    };
    this._refillsCharged = 0;

    const passiveIncome = this.getEffect('passiveFunding', 0);
    const income = computeTickIncomeBreakdown(this.state, passiveIncome);
    econ.grant = income.grant;
    econ.reputation = income.reputation;
    this.state.resources.funding += income.total;

    // === Upkeep === staff salaries + pump service + electricity bill
    // (drain — creates pressure to complete objectives and run the beam)
    const upkeep = computeTickUpkeep(this.state);
    econ.staff = upkeep.staffCost;
    econ.pumps = upkeep.pumpUpkeep;
    econ.power = upkeep.powerBill;
    this.chargeConstruction(upkeep.total);

    // RimWorld-like staff needs loop — individuals get tired/hungry, morale shifts
    // Uses facility tier for cafeteria etc.
    {
      const isNight = isNightAt(this.state.timeOfDay); // driven by the sim clock — see DAY_LENGTH_TICKS
      const cafTier = (this.state.zoneConnectivity?.cafeteria?.tier) || 0;
      let anyChange = false;
      for (const m of (this.state.staffMembers || [])) {
        // ensure StaffMember instance (load from JSON may be plain object)
        if (!(m instanceof StaffMember)) Object.setPrototypeOf(m, StaffMember.prototype);
        const zoneTier = m.assignment?.zoneId ? (this.state.zoneConnectivity?.[m.assignment.zoneId]?.tier || 0) : 0;
        if (tickStaffMember(m, { isNight, cafeteriaTier: cafTier, zoneTier, rng: this.rng })) anyChange = true;
      }
      if (anyChange) this.emit('staffChanged');
      this._syncStaffCounts();
    }

    // Tick all running beamlines
    for (const entry of this.registry.getAll()) {
      if (entry.status === 'running') {
        this._tickBeamline(entry, econ);
      } else {
        entry.beamState.continuousBeamTicks = 0;
        // A stopped beamline earns no data fees; leaving the last running
        // value here would let a panel quote income the player is not paid.
        entry.beamState.effectiveDataRate = 0;
      }

      // Uptime tracking per beamline
      if (this.state.tick > 0) {
        entry.beamState.uptimeFraction = beamlineUptime(entry.beamState, this.state.tick);
      }
    }

    // The last economy term is now known — publish the breakdown before
    // anything else in the tick can be tempted to recompute one.
    this._publishEconomySnapshot(econ);

    // Update aggregate state for objectives/economy/renderers
    this._updateAggregateBeamline();

    // Technician auto-repair (across all beamlines)
    if (this.state.staff.technician > 0 && this.state.tick % 5 === 0) {
      this._autoRepair();
    }

    // Research progress (delegates to research module)
    const researchCompleted = research.tickResearch(
      this.state,
      (msg, type) => this.log(msg, type),
      (id) => this.getResearchSpeedMultiplier(id),
      () => this.recalcAllBeamlines()
    );
    if (researchCompleted) {
      this.emit('researchChanged');
    }

    // Budget crisis check
    if (this.state.resources.funding < -1000) {
      if (this.state.tick % 30 === 0) {
        this.log('BUDGET CRISIS! Operating at a loss.', 'bad');
      }
    }

    // Objectives (delegates to objectives module)
    const completedObjs = checkObjectives(this.state, (msg, type) => this.log(msg, type));
    for (const obj of completedObjs) {
      this.emit('objectiveCompleted', obj);
    }

    // Recompute system-level infrastructure stats
    this.computeSystemStats();

    // Utility gating (src/game/utility-gate.js): run the network solve,
    // synthesize unconnected-sink + staffing hard errors, and derive
    // state.infraBlockers / infraCanRun / nodeQualities.
    this.utilityGate.run();

    // The gate is the only writer of state.nodeQualities and it runs here, at
    // the end of the tick — after the physics pass that reads them. Propagate
    // any change now, or beamState keeps whatever quality the last build
    // mutation happened to see.
    this._syncPhysicsToNodeQualities();

    // Auto-save every 30 ticks. The synchronous serialize+localStorage write
    // is the most expensive thing in a tick, so keep it rare. Skipped while
    // paused: pause() clears the interval so tick() normally never runs
    // paused, but direct drivers (headless env, demo remote-drive, tests) can
    // still call tick() with paused set — don't let those force autosaves.
    // Manual saves (game.save() from UI / save slots) are unaffected.
    if (this.state.tick % 30 === 0 && !this.state.paused) this.save();

    this.emit('tick');
  }

  /**
   * Publish what the tick just charged as state.economySnapshot, and push its
   * net onto the fixed-capacity history window.
   *
   * The terms are the amounts already applied to state.resources.funding, so
   * `net` is the funding movement the tick's income and upkeep caused — not a
   * second opinion about it. Callers display these; they do not recompute
   * them. Both fields are derived: neither is in SERIALIZED_FIELDS, so
   * neither reaches a save or an undo payload.
   */
  _publishEconomySnapshot(econ) {
    const income = {
      grant: econ.grant,
      reputation: econ.reputation,
      beam: econ.beam,
      dataFees: econ.dataFees,
      total: econ.grant + econ.reputation + econ.beam + econ.dataFees,
    };
    const upkeep = {
      staff: econ.staff,
      power: econ.power,
      pumps: econ.pumps,
      refills: econ.refills,
      total: econ.staff + econ.power + econ.pumps + econ.refills,
    };
    this.state.economySnapshot = {
      tick: this.state.tick,
      income,
      upkeep,
      net: income.total - upkeep.total,
      // Beamlines that actually contributed beam income this tick, so the
      // panel can say "across N beamlines" without counting them again.
      contributingBeamlines: econ.beamlines,
    };
    if (!Array.isArray(this.state.economyHistory)) this.state.economyHistory = [];
    const history = this.state.economyHistory;
    history.push(this.state.economySnapshot.net);
    if (history.length > ECONOMY_HISTORY_MAX) {
      history.splice(0, history.length - ECONOMY_HISTORY_MAX);
    }
  }

  /**
   * Read view of the recorded per-tick economy for panels: the last published
   * breakdown, plus the net-per-tick window behind it. `snapshot` is null
   * before the first tick. Read this rather than recomputing an economy term
   * at the display site — the whole point is that the panel shows what was
   * charged.
   */
  getEconomySnapshot() {
    return {
      snapshot: this.state.economySnapshot,
      history: Array.isArray(this.state.economyHistory) ? [...this.state.economyHistory] : [],
      historyCapacity: ECONOMY_HISTORY_MAX,
    };
  }

  /**
   * Mean dataFiber quality over the data-producing nodes of a flattened
   * beamline, in [0,1]. 1.0 when there is nothing to derate (no solved
   * qualities, or no data-producing hardware).
   */
  _dataConnectivityFactor(nodes) {
    if (!this.state.nodeQualities) return 1;
    let totalDataQ = 0;
    let dataNodeCount = 0;
    for (const node of nodes) {
      const comp = COMPONENTS[node.type];
      if (comp && (comp.stats?.dataRate || 0) > 0) {
        const nq = this.state.nodeQualities[node.id];
        // Same fail-closed rule as the physics bridge: a declared but unsolved
        // data sink is 0, a node that declares none is not applicable (1.0).
        const fallback = declaredSinkQualityFloor(node.type)?.dataQuality ?? 1.0;
        totalDataQ += nq && typeof nq.dataQuality === 'number' ? nq.dataQuality : fallback;
        dataNodeCount++;
      }
    }
    return dataNodeCount > 0 ? totalDataQ / dataNodeCount : 1;
  }

  /**
   * @param entry registry entry to bill and advance
   * @param econ  tick()'s accumulator; this beamline's income terms are added
   *              to it as they are credited (see _publishEconomySnapshot)
   */
  _tickBeamline(entry, econ = null) {
    const bs = entry.beamState;

    if (!this.state.infraCanRun) return;

    bs.continuousBeamTicks++;
    bs.beamOnTicks++;

    const blNodes = entry.sourceId ? flattenPath(this.state, entry.sourceId) : [];

    // Funding from running beam (MVP loop closure: beam on = income).
    // Scales with beam quality AND machine size — see economy.js ECON.
    // hardwareNodeCount, never blNodes.length: the flattener also emits a
    // synthetic 'drift' entry per gap between placements, so billing raw
    // entries paid ~$100/tick for every gap — spacing identical hardware
    // further apart minted income at zero cost.
    const nodeCount = hardwareNodeCount(blNodes);

    // Apply data fiber network quality. In the Phase 6 utility model,
    // dataFiber quality is 1.0 when a detector port is connected to an
    // IOC/control-room source through a data-fiber line, and 0 otherwise,
    // so this term alone captures "connected to control room".
    //
    // Derated BEFORE income, not after: billing the raw bs.dataRate paid the
    // player full data fees for a detector whose fiber had been cut, i.e. for
    // science that demonstrably produced no `data` resource that tick. The
    // derated value is published on beamState so panels quote the number the
    // player is actually paid for rather than re-deriving it.
    const connectedDataRate = billedDataRate(bs, this._dataConnectivityFactor(blNodes));
    bs.effectiveDataRate = connectedDataRate;

    const earned = computeBeamIncomeBreakdown(
      connectedDataRate === bs.dataRate ? bs : { ...bs, dataRate: connectedDataRate },
      nodeCount,
    );
    this.state.resources.funding += earned.total;
    if (econ) {
      econ.beam += earned.beam;
      econ.dataFees += earned.dataFees;
      econ.beamlines++;
    }

    // Data from detectors (physics-driven)
    if (connectedDataRate > 0) {
      const sciMult = 1 + this.state.staff.scientist * 0.1;
      const dataGain = connectedDataRate * sciMult;
      this.state.resources.data += dataGain;
      bs.totalDataCollected += dataGain;
    }

    // Photon data from undulators (bonus data, scaled down)
    if (bs.photonRate > 0) {
      const photonData = bs.photonRate * 0.1 * bs.beamQuality;
      this.state.resources.data += photonData;
      bs.totalDataCollected += photonData;
    }

    // User beam hours from photon ports
    const photonPorts = blNodes.filter(c => c.type === 'photonPort');
    if (photonPorts.length > 0 && bs.beamQuality > 0.5) {
      const beamHoursThisTick = photonPorts.length * (1 / 3600); // 1 second = 1/3600 hour
      bs.totalBeamHours += beamHoursThisTick;
      // User fees revenue. Booked under the snapshot's beam term rather than
      // a term of its own: it is beam-on revenue, and leaving it out would
      // make the reported net disagree with the balance on any facility that
      // has a photon port.
      const userFees = photonPorts.length * 2 * bs.beamQuality;
      this.state.resources.funding += userFees;
      if (econ) econ.beam += userFees;
      this.state.resources.reputation += photonPorts.length * 0.001;
    }

    // Discovery chance (physics-driven). The $5k is a one-off reward event,
    // like an objective payout — not a per-tick flow, so it is deliberately
    // outside the economy snapshot, whose terms are rates.
    const dc = bs.discoveryChance || 0;
    if (dc > 0 && this.rng() < dc) {
      this.state.discoveries++;
      this.log('*** PARTICLE DISCOVERY! ***', 'reward');
      this.state.resources.reputation += 10;
      this.state.resources.funding += 5000;
    }

    // Beam quality affects reputation gain passively (scaled, not binary)
    if (this.state.tick % 60 === 0 && bs.beamQuality > 0.3) {
      this.state.resources.reputation += bs.beamQuality * 0.6;
    }

    // Component wear (every 10 ticks)
    if (this.state.tick % 10 === 0) {
      this._applyWearForBeamline(entry);
    }
  }

  // === FLOORS VALIDATION ===
  //
  // Post-Phase 6: the legacy Networks.validate() pipeline is gone. The new
  // utility system is driven by solveRunner in the per-tick loop (see tick()).
  // validateInfrastructure() is kept as a lightweight emit trigger for the
  // handful of call sites that used to rely on it to refresh UI immediately
  // after a placement — they still emit so listeners (palette/window/UI) can
  // react without waiting for the next tick. Any follow-up fault-attribution
  // work happens on the next tick when solveRunner runs.
  validateInfrastructure() {
    this.emit('infrastructureValidated');
  }

  /**
   * Synchronously re-run the utility gate so state.infraCanRun /
   * state.infraBlockers reflect the world as it is right now. Anything that
   * *gates* on those fields (rather than just repainting them) must call this
   * first — tick() is the only other caller, and it does not run while paused.
   */
  refreshInfrastructureGate() {
    if (this.utilityGate) this.utilityGate.run();
    // Same invariant tick() keeps: wherever the gate runs, the physics pass
    // follows it. Without this, starting a beam while paused (toggleBeam
    // refreshes the gate) left every element on the fail-closed floor until
    // the player unpaused.
    this._syncPhysicsToNodeQualities();
    this.emit('infrastructureValidated');
  }

  // === WEAR & REPAIR ===

  _applyWearForBeamline(entry) {
    const blNodes = entry.sourceId ? flattenPath(this.state, entry.sourceId) : [];
    for (const node of blNodes) {
      const t = COMPONENTS[node.type];
      if (!t) continue;
      // Initialize health if needed
      if (entry.beamState.componentHealth[node.id] === undefined) {
        entry.beamState.componentHealth[node.id] = 100;
      }
      // Base wear rate: higher energy cost = more stress
      const baseWear = 0.01 + (t.energyCost || 0) * 0.002;
      // Read from state.placeables, not the legacy state.facilityEquipment
      // view: that array is `placeables.filter(category === 'equipment')` and
      // the MPS is kind (so category) 'infrastructure', so this check was
      // unconditionally false and every component wore at 2x forever — the
      // $1M Machine Protection System had no mechanical effect at all.
      const hasMPS = (this.state.placeables || []).some(p => p.type === 'mps');
      const wearMult = hasMPS ? 1 : 2;
      entry.beamState.componentHealth[node.id] = Math.max(0, entry.beamState.componentHealth[node.id] - baseWear * wearMult);

      // Random failure check below 20% health
      if (entry.beamState.componentHealth[node.id] < 20 && this.rng() < 0.05) {
        entry.beamState.componentHealth[node.id] = 0;
        this.log(`${t.name} FAILED! Repair needed.`, 'bad');
      }
    }
  }

  _autoRepair() {
    // RimWorld-like: technicians assigned to maintenance, efficiency matters
    let repairRate = 0;
    for (const m of (this.state.staffMembers || []).filter(s => s.profession === 'technician' && s.status === 'working')) {
      const tier = m.assignment?.zoneId ? (this.state.zoneConnectivity?.[m.assignment.zoneId]?.tier || 0) : 0;
      // ensure instance
      if (!(m instanceof StaffMember)) Object.setPrototypeOf(m, StaffMember.prototype);
      repairRate += 2 * m.efficiency(tier);
    }
    // fallback to legacy count if no individual pawns (old saves)
    if (repairRate === 0) repairRate = (this.state.staff?.technician || 0) * 2;
    let remaining = repairRate;
    // Iterate all beamlines' elements
    for (const entry of this.registry.getAll()) {
      const elements = entry.sourceId ? flattenPath(this.state, entry.sourceId) : [];
      for (const node of elements) {
        if (remaining <= 0) return;
        const health = entry.beamState.componentHealth[node.id];
        if (health !== undefined && health < 100) {
          const repair = Math.min(remaining, 100 - health);
          entry.beamState.componentHealth[node.id] += repair;
          remaining -= repair;
        }
      }
    }
  }

  getComponentHealth(id) {
    // Search all beamlines for this component's health
    for (const entry of this.registry.getAll()) {
      if (entry.beamState.componentHealth[id] !== undefined) {
        return entry.beamState.componentHealth[id];
      }
    }
    return 100;
  }

  // === STAFFING — RimWorld-like individuals ===
  // Old count-based API kept for tests; new code uses staffMembers.

  _syncStaffCounts() {
    this.state.staff = deriveStaffCounts(this.state.staffMembers || []);
  }

  hireStaffMember(candidateId) {
    const idx = (this.state.staffCandidates || []).findIndex(c => c.id === candidateId);
    if (idx === -1) { this.log('Candidate not found', 'bad'); return false; }
    const cand = this.state.staffCandidates[idx];
    const cost = staffHireCost(cand, this.state.staffCosts);
    if (!this.sandboxMode && this.state.resources.funding < cost) { this.log(`Can't afford hire $${cost}`, 'bad'); return false; }
    this.chargeConstruction(cost);
    const m = new StaffMember({ ...cand, id: `staff_${this.state.staffNextId++}` });
    m.history = [{ tick: this.state.tick, event: 'hired', note: `Hired ${m.name} as ${m.profession}` }];
    this.state.staffMembers.push(m);
    this.state.staffCandidates.splice(idx, 1);
    // refill pool if low
    if (this.state.staffCandidates.length < 2) this._refreshStaffCandidates();
    this._syncStaffCounts();
    this.log(`Hired ${m.name} (${m.profession}) — ${m.traits.join(', ')}`, 'good');
    this.emit('staffChanged');
    return m;
  }

  fireStaffMember(staffId) {
    const idx = (this.state.staffMembers || []).findIndex(s => s.id === staffId);
    if (idx === -1) return false;
    // keep at least one operator
    const operators = this.state.staffMembers.filter(s => s.profession === 'operator');
    const target = this.state.staffMembers[idx];
    if (target.profession === 'operator' && operators.length <= 1) { this.log('Need at least 1 operator!', 'bad'); return false; }
    const removed = this.state.staffMembers.splice(idx, 1)[0];
    this._syncStaffCounts();
    this.log(`Released ${removed.name}`, 'info');
    this.emit('staffChanged');
    return true;
  }

  assignStaff(staffId, zoneId, beamlineId = null) {
    const m = (this.state.staffMembers || []).find(s => s.id === staffId);
    if (!m) return false;
    m.assignment.zoneId = zoneId || null;
    if (beamlineId !== undefined) m.assignment.beamlineId = beamlineId;
    this.emit('staffChanged');
    return true;
  }

  hireStaff(profession) {
    // compat: generate a random member of that profession
    if (!this.state.staff[profession] && this.state.staff[profession] !== 0) return false;
    const hireCost = this.state.staffCosts[profession] * 10; // 10 ticks upfront
    if (!this.sandboxMode && this.state.resources.funding < hireCost) {
      this.log(`Can't afford to hire (need $${hireCost})`, 'bad');
      return false;
    }
    this.chargeConstruction(hireCost);
    const m = createStaffMember(profession, `staff_${this.state.staffNextId++}`, this.state.tick, this.rng);
    this.state.staffMembers.push(m);
    this._syncStaffCounts();
    this.log(`Hired ${m.name} (${m.profession})`, 'good');
    this.emit('staffChanged');
    return true;
  }

  fireStaff(profession) {
    // compat: fire one member of that profession
    const cand = (this.state.staffMembers || []).find(s => s.profession === profession);
    if (!cand) return false;
    if (cand.profession === 'operator' && (this.state.staffMembers.filter(s => s.profession === 'operator').length <= 1)) {
      this.log('Need at least 1 operator!', 'bad');
      return false;
    }
    const idx = this.state.staffMembers.indexOf(cand);
    this.state.staffMembers.splice(idx, 1);
    this._syncStaffCounts();
    this.log(`Released ${profession}`, 'info');
    this.emit('staffChanged');
    return true;
  }

  // === SAVED DESIGNS ===

  addDesign({ name, category, components }) {
    const id = this.state.savedDesignNextId++;
    const now = Date.now();
    this.state.savedDesigns.push({
      id,
      name,
      category: category || 'other',
      components,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  updateDesign(id, updates) {
    const design = this.state.savedDesigns.find(d => d.id === id);
    if (!design) return false;
    if (updates.name !== undefined) design.name = updates.name;
    if (updates.category !== undefined) design.category = updates.category;
    if (updates.components !== undefined) design.components = updates.components;
    design.updatedAt = Date.now();
    return true;
  }

  deleteDesign(id) {
    const idx = this.state.savedDesigns.findIndex(d => d.id === id);
    if (idx < 0) return false;
    this.state.savedDesigns.splice(idx, 1);
    return true;
  }

  getDesign(id) {
    return this.state.savedDesigns.find(d => d.id === id) || null;
  }

  getDesignsByCategory(category) {
    if (!category || category === 'all') return this.state.savedDesigns;
    return this.state.savedDesigns.filter(d => d.category === category);
  }

  // === SCENARIOS ===

  applyScenario(scenarioData) {
    // Apply a generated scenario map to state
    this.state.floors = scenarioData.floors;
    this.state.zones = scenarioData.zones;
    this.state.walls = scenarioData.walls;
    this.state.doors = scenarioData.doors;
    this.state.placeables = scenarioData.placeables;
    this.state.placeableNextId = scenarioData.placeableNextId;
    if (scenarioData.staff) this.state.staff = scenarioData.staff;
    if (scenarioData.resources) Object.assign(this.state.resources, scenarioData.resources);

    // Terrain heights (optional). Hand-written generators pass a Map;
    // editor-exported scenarios pass the serialized array form.
    if (scenarioData.cornerHeights) {
      this.state.cornerHeights = scenarioData.cornerHeights instanceof Map
        ? scenarioData.cornerHeights
        : deserializeCornerHeights(scenarioData.cornerHeights);
      this.state.cornerHeightsRevision++;
    }

    // Beamline pipe graph (optional — editor-exported scenarios). Pipes carry
    // their on-pipe placements; junction modules ride in placeables above.
    this.state.beamPipes = scenarioData.beamPipes || [];
    this.state.beamPipeNextId = scenarioData.beamPipeNextId || 1;
    this.state.placementNextId = scenarioData.placementNextId || 0;

    // Utility lines (optional — editor-exported scenarios). Stored as
    // Map entries [[id, line], ...]; network state is derived per-tick.
    this.state.utilityLines = new Map(scenarioData.utilityLines || []);
    this.state.utilityNextId = scenarioData.utilityNextId || 1;
    this.state.utilityNetworkState = new Map();
    this.state.utilityNetworkData = null;

    // Rebuild lookup tables
    this.state.infraOccupied = {};
    for (const tile of this.state.floors)
      this.state.infraOccupied[tile.col + ',' + tile.row] = tile.type;
    this.state.zoneOccupied = {};
    for (const z of this.state.zones)
      this.state.zoneOccupied[z.col + ',' + z.row] = z.type;
    this.state.wallOccupied = {};
    for (const w of this.state.walls)
      this.state.wallOccupied[`${w.col},${w.row},${w.edge}`] = w.type;
    this.state.doorOccupied = {};
    for (const d of this.state.doors)
      this.state.doorOccupied[`${d.col},${d.row},${d.edge}`] = d.type;
    this._rebuildPlaceableIndex();
    // Placeables were replaced wholesale, so the derived views
    // (facilityEquipment / facilityGrid / zoneFurnishings / zoneItems) have to
    // be rebuilt from them rather than trusted from the payload — zoneItems in
    // particular is not serialized, and the research lab tier reads it.
    this._syncLegacyPlaceableState();

    // Beamline placeables: init default params and (re)create registry
    // entries for sources. Exported placeables may carry beamlineIds from
    // the editor session's registry — those are stale here, so clear them
    // and let _ensureBeamlineForSourcePlaceable mint fresh entries.
    // Drop any half-finished New Beamline pick first: it belongs to the world
    // being replaced, and the first imported source would otherwise eat it.
    this.pendingBeamlineTypeId = null;
    for (const p of this.state.placeables) {
      if (p.category !== 'beamline') continue;
      p.beamlineId = null;
      const defs = PARAM_DEFS[p.type];
      if (defs && !p.params) {
        p.params = {};
        for (const [k, def] of Object.entries(defs)) {
          if (!def.derived) p.params[k] = def.default;
        }
      }
      if (COMPONENTS[p.type]?.isSource) this._ensureBeamlineForSourcePlaceable(p);
    }

    this.recomputeZoneConnectivity();
    // Placeables were replaced wholesale without going through the
    // place/remove seams, so the cached utility-network discovery must be
    // invalidated by hand — BEFORE recalcAllBeamlines, whose first-pass gate
    // solve would otherwise run against the previous world's topology.
    this.solveRunner.markTopologyDirty();
    this.state.nodeQualities = null;
    this.state.unwiredSinks = null;
    this.recalcAllBeamlines();
    this.validateInfrastructure();

    // Nudge renderers: 'beamlineChanged' triggers a full 3D rebuild, and the
    // utility-line mesh builder listens for 'utilityLinesChanged'.
    this.emit('infrastructureChanged');
    this.emit('zonesChanged');
    this.emit('wallsChanged');
    this.emit('doorsChanged');
    this.emit('beamlineChanged');
    if (this.state.utilityLines.size > 0) this.emit('utilityLinesChanged', {});
  }

  // === SAVE / LOAD ===

  // Host layers (renderer camera, probe pins, designer session) persist their
  // own state via named sections: serialize() stores each section's save()
  // result under save.aux[key], load() dispatches the stored section back to
  // load(data). Register before calling load() or the section is ignored.
  registerSerializer(key, { save, load }) {
    this._serializers.set(key, { save, load });
  }

  // Build the save payload string without writing it anywhere.
  // Used by save() (active/autosave key) and the named save-slot system.
  // Undo snapshots pass includeLog/includeAux false — see _snapshot.
  serialize({ includeLog = true, includeAux = true } = {}) {
    const saveState = {};
    for (const key of SERIALIZED_FIELDS) saveState[key] = this.state[key];
    if (!includeLog) saveState.log = EMPTY_LOG;
    // Map-backed fields persist as entry arrays.
    saveState.cornerHeights = serializeCornerHeights(this.state.cornerHeights);
    saveState.utilityLines = Array.from((this.state.utilityLines || new Map()).entries());
    saveState.utilityNetworkState = Array.from((this.state.utilityNetworkState || new Map()).entries());
    saveState.utilityNextId = this.state.utilityNextId || 1;
    const aux = {};
    if (includeAux) {
      for (const [key, s] of this._serializers) aux[key] = s.save();
    }
    return JSON.stringify({
      version: 9,
      state: saveState,
      aux,
      beamlines: this.registry.toJSON(),
    });
  }

  save() {
    // Scenario Editor sessions never touch the active save slot — the
    // editor sets suppressAutosave so the player's real game survives.
    if (this.suppressAutosave) return;
    // Autosave runs from tick(), which headless Node drivers (agent env,
    // balance sims) also call — there localStorage may be missing or
    // non-functional, and persistence must never kill the sim.
    try {
      localStorage.setItem('beamlineTycoon', this.serialize());
    } catch (_) {}
  }

  load() {
    const raw = localStorage.getItem('beamlineTycoon');
    if (!raw) return false;
    try {
      const data = JSON.parse(raw);
      if (!data.version || data.version < 9) {
        localStorage.removeItem('beamlineTycoon');
        return false;
      }

      this._applyState(data);

      // Dispatch host-layer sections back to their registered serializers.
      if (data.aux) {
        for (const [key, s] of this._serializers) {
          if (s.load && key in data.aux) s.load(data.aux[key]);
        }
      }

      this.log('Game loaded.', 'info');
      this.emit('loaded');
      return true;
    } catch (e) { console.error('Save load failed:', e); return false; }
  }

  // Restore an undo entry ({payload, ledger}) in place. Unlike load(), aux
  // sections are deliberately NOT dispatched — camera, probe pins and
  // designer session must not jump on undo — there is no "Game loaded." log
  // line, and sim progress is carried over rather than rewound.
  // Used by undo()/redo().
  restoreSnapshot(entry) {
    const { payload, ledger, pendingBeamlineTypeId } = typeof entry === 'string'
      ? { payload: entry, ledger: null, pendingBeamlineTypeId: undefined }
      : entry;
    this._applyState(JSON.parse(payload), { preserveSim: true, ledgerAt: ledger });
    // Rewind the New Beamline pick with everything else. `undefined` means the
    // entry predates this field (a bare payload string), and leaves it alone.
    if (pendingBeamlineTypeId !== undefined) {
      this.pendingBeamlineTypeId = pendingBeamlineTypeId;
    }
    // The restore itself moved the balance; it is not ledger drift.
    this._closeUndoGesture();
    // The 3D renderer handles 'restored' exactly like 'loaded' (full
    // scene rebuild); host layers hang load-only side effects off 'loaded'.
    this.emit('restored');
  }

  // === BEAMLINE APPLY TRANSACTION ===
  //
  // The Beamline Designer's Apply runs an ordered op list through
  // BeamlineSystem / UtilityLineSystem, and any op in it can fail halfway
  // (a sub-grid cell turns out occupied, a resulting pipe is not a legal
  // straight run, funding runs out mid-list). Without a rollback the player
  // is left holding half a beamline — some modules placed, the pipes meant to
  // join them missing — with no way to tell which half is real and no undo
  // entry that predates the mess. These two methods make Apply
  // all-or-nothing: snapshot, execute, and on any op failing, restore.
  //
  // Deliberately narrower than the undo snapshot. This is not a user gesture
  // boundary, so floors, walls, staff, research and the clock are outside the
  // blob and a rollback must leave them alone. Terrain is the one exception
  // and it is not a judgement call: placement flattens the heightmap itself,
  // so leaving it out would not be "scoped", it would be a leak. The beamline
  // registry is outside it too: rewinding registry entries would rewind the
  // per-entry sim accumulators (componentHealth, beamOnTicks — see
  // BEAMSTATE_PRESERVED_FIELDS), turning a failed apply into a free repair of
  // the whole facility. The planner anchors the source junction and refuses
  // multi-branch runs, so no op it emits can create or destroy a registry
  // entry in the first place.

  /**
   * Capture everything a designer apply can touch, as an opaque blob for
   * restoreBeamlineState(). Serialization goes through serialize() rather
   * than a hand-rolled field copy so exactly one place in the codebase knows
   * how these fields round-trip — notably the utilityLines Map, which
   * persists as an entry array and would otherwise need a second, drifting
   * copy of that conversion. The payload being a string also makes aliasing
   * impossible: nothing mutated after the snapshot can reach into it.
   */
  snapshotBeamlineState() {
    return {
      // includeAux false: camera, probe pins and the designer session are
      // host state a rollback must not touch. includeLog false: an aborted
      // apply must not delete the log lines its own failing ops just wrote
      // explaining why it aborted.
      payload: this.serialize({ includeLog: false, includeAux: false }),
      // subgridOccupied / placeableIndex are derived, so they are absent from
      // the save payload — but they are precisely what a placeJunction op
      // mutates, and a rollback that left them stale would leave the map
      // refusing to build on cells no placeable occupies any more. Copied
      // verbatim rather than rebuilt on restore; see restoreBeamlineState.
      subgridOccupied: JSON.parse(JSON.stringify(this.state.subgridOccupied || {})),
      placeableIndex: { ...(this.state.placeableIndex || {}) },
    };
  }

  /**
   * Roll the beamline-transaction fields back to a snapshotBeamlineState()
   * blob. Returns false and touches nothing if the blob is missing or
   * unreadable, so a caller that lost its snapshot fails loudly rather than
   * wiping the map.
   */
  restoreBeamlineState(snapshot) {
    if (!snapshot || typeof snapshot.payload !== 'string') return false;
    let saved;
    try { saved = JSON.parse(snapshot.payload).state; } catch (_) { return false; }
    if (!saved) return false;

    for (const key of BEAMLINE_TX_FIELDS) this.state[key] = saved[key];
    // utilityLines persisted as an entry array; rehydrate it exactly as
    // _applyState does, or the first .get()/.set() on the restored state
    // throws and the utility layer dies on the rollback rather than the bug.
    this.state.utilityLines = new Map(
      Array.isArray(saved.utilityLines) ? saved.utilityLines : [],
    );
    // Same story for the terrain heightmap, which persists as [col,row,nw,ne,
    // se,sw] tuples. The revision counter is bumped rather than restored: it
    // is a monotonic renderer cache key, not state, and rewinding it to its
    // pre-apply value would leave every terrain mesh builder convinced nothing
    // had changed since the last frame — the un-flattened ground would stay on
    // screen flat until some later edit happened to bump past the old value.
    this.state.cornerHeights = deserializeCornerHeights(saved.cornerHeights || []);
    this.state.cornerHeightsRevision = (this.state.cornerHeightsRevision | 0) + 1;

    // Occupancy is restored from the snapshot rather than rebuilt from the
    // restored placeables, because _rebuildPlaceableIndex() is not a faithful
    // inverse of the incremental claims: it writes {id, kind, category} where
    // the placement path writes {id, kind}. Rebuilding would rewrite every
    // occupancy record in the facility — including cells the transaction never
    // went near — and a rollback would no longer be byte-identical to the
    // pre-apply state, which is the one thing Apply promises.
    this.state.subgridOccupied = JSON.parse(JSON.stringify(snapshot.subgridOccupied || {}));
    this.state.placeableIndex = { ...(snapshot.placeableIndex || {}) };

    // Derived utility state, invalidated the same way and for the same reason
    // _applyState invalidates it after replacing the utilityLines Map
    // wholesale: the cached discovery and the solved qualities describe the
    // half-applied facility that no longer exists, and the physics pass fails
    // closed on nodeQualities. The topology revision itself is bumped by the
    // emits below.
    this.state.utilityNetworkData = null;
    this.state.utilityNetworks = null;
    this.state.nodeQualities = null;
    this.state.unwiredSinks = null;

    // Synchronous derived state that every place/remove path refreshes for
    // itself. Skipping it would leave renderers hit-testing legacy mirrors of
    // placeables the rollback just deleted, and state.beamline ordering the
    // modules of the layout that failed to apply.
    this._syncLegacyPlaceableState();
    this.computeSystemStats();
    this._deriveBeamGraph();

    // All three emits are load-bearing and none subsumes another: the
    // placeable meshes and the beam-pipe meshes rebuild off their own event,
    // and the utility-line mesh builder off the third — a skipped emit leaves
    // the rolled-back geometry on screen as unclickable ghosts. Any one of
    // them marks the utility topology dirty, but only 'beamlineChanged'
    // schedules the physics recalc, without which beamState keeps billing
    // income for a beamline that was never built.
    this.emit('placeableChanged');
    this.emit('beamlineChanged');
    this.emit('utilityLinesChanged', {});
    return true;
  }

  /**
   * Resources to restore for an undo entry: the snapshot's balance plus
   * every non-gesture credit/debit recorded since it was taken. Refunds the
   * undone gesture's spending without clawing back tick income or upkeep.
   */
  _reconcileResources(snapshotResources, ledgerAt) {
    const out = { ...(snapshotResources || {}) };
    if (!ledgerAt) return out;
    for (const k of new Set([...Object.keys(this._resourceLedger), ...Object.keys(ledgerAt)])) {
      out[k] = (out[k] || 0) + ((this._resourceLedger[k] || 0) - (ledgerAt[k] || 0));
    }
    return out;
  }

  // State-application core shared by load() and restoreSnapshot(): assign
  // the saved fields, reseed the RNG, restore the beamline registry, and
  // rebuild every derived index/aggregate. `data` is a parsed serialize()
  // payload ({version, state, aux, beamlines}); aux is ignored here.
  // opts.preserveSim (undo/redo only) keeps UNDO_PRESERVED_FIELDS from the
  // live state and reconciles resources against opts.ledgerAt, so undoing a
  // build made N ticks ago rewinds the build, not N ticks of simulation.
  _applyState(data, opts = {}) {
    let preserved = null;
    let resources = null;
    if (opts.preserveSim) {
      preserved = {};
      for (const f of UNDO_PRESERVED_FIELDS) preserved[f] = this.state[f];
      resources = this._reconcileResources(data.state?.resources, opts.ledgerAt);
    }
    Object.assign(this.state, data.state);
    if (preserved) {
      Object.assign(this.state, preserved);
      this.state.resources = resources;
    }

    // The economy breakdown is derived and unsaved, so a load would otherwise
    // leave the previous session's numbers on screen until the first tick.
    // Undo/redo keeps them: like `tick`, they are sim progress, not gesture
    // state, and the tick that follows overwrites them anyway.
    if (!opts.preserveSim) {
      this.state.economySnapshot = null;
      this.state.economyHistory = [];
      this._refillsCharged = 0;
    }

    // Sanitize loop-control state and resync the interval to the loaded
    // speed (no-op before start()).
    this.state.paused = !!this.state.paused;
    if (![1, 2, 4].includes(this.state.speed)) this.state.speed = 1;
    this._syncInterval();

    // Restart the sim RNG stream from the saved seed (stream position is
    // intentionally not persisted). Undo/redo must NOT reseed: the stream is
    // sim progress like `tick`, and restarting it at position 0 on every
    // Ctrl+Z would let a player re-roll wear failures and discoveries by
    // undoing and redoing a trivial build.
    if (this.state.seed == null) this.state.seed = Date.now();
    if (!opts.preserveSim) this.rng = mulberry32(this.state.seed);

    // Rehydrate per-corner terrain heightmap. Old saves lack the field —
    // treat as empty (fully flat world). Revision always resets to 0 on
    // load so renderer builders rebuild on the first frame.
    this.state.cornerHeights = deserializeCornerHeights(this.state.cornerHeights || []);
    this.state.cornerHeightsRevision = 0;

    // Restore registry from saved beamlines data. The entry set itself is
    // gesture state (placing/removing a source creates/deletes beamlines), so
    // it is always restored — but on undo/redo the sim accumulators carried
    // on each surviving entry are re-overlaid from the live registry
    // afterwards (see BEAMSTATE_PRESERVED_FIELDS).
    if (data.beamlines) {
      const liveBeamStates = opts.preserveSim ? new Map() : null;
      if (liveBeamStates) {
        for (const entry of this.registry.getAll()) liveBeamStates.set(entry.id, entry.beamState);
      }
      this.registry.fromJSON(data.beamlines);
      if (liveBeamStates) {
        for (const entry of this.registry.getAll()) {
          const live = liveBeamStates.get(entry.id);
          if (!live || !entry.beamState) continue;
          for (const f of BEAMSTATE_PRESERVED_FIELDS) {
            if (live[f] !== undefined) entry.beamState[f] = live[f];
          }
        }
      }
    }

    // Migrate old saves: entries without sourceId need one
    for (const entry of this.registry.getAll()) {
      if (!entry.sourceId) {
        const src = this.state.placeables?.find(p =>
          p.beamlineId === entry.id && COMPONENTS[p.type]?.isSource
        );
        if (src) entry.sourceId = src.id;
      }
    }

    // Rebuild infraOccupied
    this.state.infraOccupied = {};
    if (this.state.floors) {
      for (const tile of this.state.floors)
        this.state.infraOccupied[tile.col + ',' + tile.row] = tile.type;
    } else { this.state.floors = []; }
    // Rebuild zoneOccupied
    this.state.zones = this.state.zones || [];
    this.state.zoneOccupied = {};
    for (const z of this.state.zones) {
      this.state.zoneOccupied[z.col + ',' + z.row] = z.type;
    }
    this.state.zoneConnectivity = {};
    this.recomputeZoneConnectivity();
    // Discard legacy connections data from old saves
    delete this.state.connections;
    // Discard legacy rack-segment / networkData from pre-Phase-6 saves.
    delete this.state.rackSegments;
    delete this.state.networkData;

    // Rehydrate new-system utility state (Phase 6 / Task 24).
    this.state.utilityLines = new Map(Array.isArray(this.state.utilityLines) ? this.state.utilityLines : []);
    this.state.utilityNetworkState = new Map(Array.isArray(this.state.utilityNetworkState) ? this.state.utilityNetworkState : []);
    this.state.utilityNextId = this.state.utilityNextId || 1;
    // utilityNetworkData / utilityNetworks are derived; solveRunner
    // repopulates both on first tick. The utilityLines Map was just replaced
    // wholesale, so the cached network discovery is stale — invalidate it.
    this.state.utilityNetworkData = null;
    this.state.utilityNetworks = null;
    // Derived from the solve too, and the physics pass fails closed on it:
    // carrying the pre-load session's map over would stamp a loaded facility
    // with the qualities of the one it replaced.
    this.state.nodeQualities = null;
    this.state.unwiredSinks = null;
    if (this.solveRunner) this.solveRunner.markTopologyDirty();

    // Ensure facility arrays exist
    if (!this.state.facilityEquipment) this.state.facilityEquipment = [];
    if (!this.state.facilityGrid) this.state.facilityGrid = {};
    if (!this.state.facilityNextId) this.state.facilityNextId = 1;

    // Ensure zone furnishing arrays exist
    if (!this.state.zoneFurnishings) this.state.zoneFurnishings = [];
    if (!this.state.zoneFurnishingSubgrids) this.state.zoneFurnishingSubgrids = {};
    if (!this.state.zoneFurnishingNextId) this.state.zoneFurnishingNextId = 1;

    // Ensure unified placement state exists
    if (!this.state.placeables) this.state.placeables = [];
    if (!this.state.placeableIndex) this.state.placeableIndex = {};
    if (!this.state.subgridOccupied) this.state.subgridOccupied = {};
    if (!this.state.placeableNextId) this.state.placeableNextId = 1;
    if (!this.state.beamPipes) this.state.beamPipes = [];
    if (!this.state.beamPipeNextId) this.state.beamPipeNextId = 1;

    // Ensure RimWorld-like staff state exists. Pre-release, no save
    // compatibility: a save with no staffMembers just gets reseeded rather
    // than migrated from any older count-only shape.
    if (!this.state.staffMembers) this.state.staffMembers = [];
    if (!this.state.staffNextId) this.state.staffNextId = 1;
    if (!this.state.staffCandidates) this.state.staffCandidates = [];
    if (this.state.staffMembers.length === 0) this._ensureStaffSeed();
    // Rehydrate plain objects as StaffMember instances
    for (let i = 0; i < this.state.staffMembers.length; i++) {
      const o = this.state.staffMembers[i];
      if (!(o instanceof StaffMember)) this.state.staffMembers[i] = StaffMember.fromJSON(o);
    }
    for (let i = 0; i < (this.state.staffCandidates || []).length; i++) {
      const o = this.state.staffCandidates[i];
      if (!(o instanceof StaffMember)) this.state.staffCandidates[i] = StaffMember.fromJSON(o);
    }
    this._syncStaffCounts();

    // Ensure beam pipes have the B2 shape (start/end refs + placements[]).
    // Saves from before the B2 migration are not supported — any pipe
    // missing the new fields is treated as incomplete.
    if (this.state.beamPipes) {
      for (const pipe of this.state.beamPipes) {
        if (!('start' in pipe)) pipe.start = null;
        if (!('end' in pipe)) pipe.end = null;
        if (!Array.isArray(pipe.placements)) pipe.placements = [];
      }
    }

    // Migrate old format -> unified placeables (if placeables is empty but old arrays have data)
    if (this.state.placeables.length === 0) {
      // Migrate facility equipment
      if (this.state.facilityEquipment && this.state.facilityEquipment.length > 0) {
        for (const eq of this.state.facilityEquipment) {
          const def = COMPONENTS[eq.type];
          const gw = def ? (def.gridW || def.subW || 4) : 4;
          const gh = def ? (def.gridH || def.subL || 4) : 4;
          const id = 'eq_' + this.state.placeableNextId++;
          const cells = [];
          for (let dr = 0; dr < gh; dr++) {
            for (let dc = 0; dc < gw; dc++) {
              cells.push({ col: eq.col + Math.floor(dc / 4), row: eq.row + Math.floor(dr / 4), subCol: dc % 4, subRow: dr % 4 });
            }
          }
          const entry = {
            id, type: eq.type, category: 'equipment',
            col: eq.col, row: eq.row, subCol: 0, subRow: 0,
            rotated: false, dir: null, params: null, cells,
          };
          this.state.placeables.push(entry);
          this.state.placeableIndex[id] = this.state.placeables.length - 1;
          for (const cell of cells) {
            this.state.subgridOccupied[cell.col + ',' + cell.row + ',' + cell.subCol + ',' + cell.subRow] = { id, category: 'equipment' };
          }
        }
      }

      // Migrate zone furnishings
      if (this.state.zoneFurnishings && this.state.zoneFurnishings.length > 0) {
        for (const zf of this.state.zoneFurnishings) {
          const def = ZONE_FURNISHINGS[zf.type];
          const gw = zf.rotated ? (def ? def.gridH : 1) : (def ? def.gridW : 1);
          const gh = zf.rotated ? (def ? def.gridW : 1) : (def ? def.gridH : 1);
          const id = 'fn_' + this.state.placeableNextId++;
          const cells = [];
          for (let dr = 0; dr < gh; dr++) {
            for (let dc = 0; dc < gw; dc++) {
              const sc = (zf.subCol || 0) + dc;
              const sr = (zf.subRow || 0) + dr;
              cells.push({ col: zf.col + Math.floor(sc / 4), row: zf.row + Math.floor(sr / 4), subCol: sc % 4, subRow: sr % 4 });
            }
          }
          const entry = {
            id, type: zf.type, category: 'furnishing',
            col: zf.col, row: zf.row, subCol: zf.subCol || 0, subRow: zf.subRow || 0,
            rotated: zf.rotated || false, dir: null, params: null, cells,
          };
          this.state.placeables.push(entry);
          this.state.placeableIndex[id] = this.state.placeables.length - 1;
          for (const cell of cells) {
            this.state.subgridOccupied[cell.col + ',' + cell.row + ',' + cell.subCol + ',' + cell.subRow] = { id, category: 'furnishing' };
          }
        }
      }
    }

    // Ensure stacking fields have defaults, then rebuild the derived
    // placeableIndex/subgridOccupied maps. Unconditional: the constructor
    // built them from the starter map, which load just replaced.
    for (const entry of this.state.placeables) {
      if (entry.placeY == null) entry.placeY = 0;
      if (!entry.stackParentId) entry.stackParentId = null;
      if (!entry.stackChildren) entry.stackChildren = [];
    }
    this._rebuildPlaceableIndex();

    // Rebuild wall state
    this.state.walls = this.state.walls || [];
    this.state.wallOccupied = {};
    for (const w of this.state.walls) {
      this.state.wallOccupied[`${w.col},${w.row},${w.edge}`] = w.type;
    }
    // Rebuild door edge state. Derived like wallOccupied — without this,
    // placed doors are undeletable after a load and undone doors leave a
    // phantom entry that blocks re-placing on that edge. Room detection
    // (_detectRoom, networks/rooms.js, the renderer's cutaway) reads it too,
    // so a stale index silently walls off every doorway.
    this.state.doors = this.state.doors || [];
    this.state.doorOccupied = {};
    for (const d of this.state.doors) {
      this.state.doorOccupied[`${d.col},${d.row},${d.edge}`] = d.type;
    }

    // Migrate: remove deprecated energy resource
    delete this.state.resources.energy;
    delete this.state.electricalPower;
    delete this.state.maxElectricalPower;

    // Ensure infra validation state exists
    this.state.infraBlockers = this.state.infraBlockers || [];
    this.state.infraCanRun = this.state.infraCanRun !== undefined ? this.state.infraCanRun : true;

    // Ensure saved designs exist
    if (!this.state.savedDesigns) this.state.savedDesigns = [];
    if (!this.state.savedDesignNextId) this.state.savedDesignNextId = 1;
    // Ensure designerState exists
    if (!this.state.designerState) this.state.designerState = null;

    // Initialize params for beamline placeables
    for (const p of (this.state.placeables || [])) {
      if (p.category !== 'beamline') continue;
      const defs = PARAM_DEFS[p.type];
      if (defs && !p.params) {
        p.params = {};
        for (const [k, def] of Object.entries(defs)) {
          if (!def.derived) p.params[k] = def.default;
        }
      }
    }

    // Bridge any source placeables from older saves that don't yet have
    // a registry entry (so clicks can open their beamline window). A pending
    // New Beamline pick belongs to the pre-load session, so it is dropped
    // rather than spent on whichever source happens to come first here.
    this.pendingBeamlineTypeId = null;
    for (const p of this.state.placeables || []) {
      if (p.category !== 'beamline') continue;
      const comp = COMPONENTS[p.type];
      if (!comp?.isSource) continue;
      if (p.beamlineId && this.registry.get(p.beamlineId)) continue;
      this._ensureBeamlineForSourcePlaceable(p);
    }

    // Recompute derived state the whitelist dropped from the save:
    // systemStats/zoneFurnishingBonuses here; beam aggregates, state.beamline
    // and mainBeamState via recalcAllBeamlines(). Per-tick derivations
    // (nodeQualities, moraleMultiplier, infraBlockers) refresh on first tick.
    this.computeSystemStats();
    this.recalcAllBeamlines();
    this.validateInfrastructure();
  }

}
