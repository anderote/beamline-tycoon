// src/game/utility-gate.js
//
// Per-tick utility gating policy: run the network solve, synthesize the hard
// errors the solver can't see (unconnected sinks have no network; staffing is
// not a utility), then derive state.infraBlockers / infraCanRun /
// nodeQualities. Game.tick() calls run() once per tick; everything else is
// internal.
//
// The gate's input is every utility ENDPOINT (listUtilityEndpoints), not
// state.placeables: components with role 'placement' live in pipe.placements,
// so keying off placeables meant cavities, quads, BPMs and cryomodules were
// wirable but never checked — and, absent from nodeQualities, ran at the
// consumer's 1.0 default. Never wiring outscored wiring badly.
//
// DI mirrors SolveRunner: constructor takes {state, solveRunner, getPorts}.
// Deliberately no rng: the gate (staffing included, since staff-professions-3
// Task 4) must be a pure function of state, never a dice roll — see
// operatorCoverage's own doc comment. Callers may still pass an `rng` option
// (several tests do); it is accepted and ignored rather than stored, so
// nothing inside this class can ever be tempted to read it.

import { findUnconnectedSinks } from '../utility/network-discovery.js';
import { listUtilityEndpoints } from '../utility/utility-endpoints.js';
import { getUtilityPortsV2 } from '../data/utility-ports-v2.js';
import { COMPONENTS } from '../data/components.js';
import { getStationIndex } from './staff/stations.js';
import { getNavGrid, isReachable } from './staff/nav.js';

// Utilities whose unwired sinks hard-block the beam. Everything a component
// physically cannot run without: no wall power, no beam vacuum, no RF drive,
// no cooling for a magnet, no cryo for an SRF cavity. dataFiber is
// deliberately NOT here — it is modelled as a soft derate (dataQuality scales
// data income via Game._dataConnectivityFactor), so an unwired BPM costs
// money rather than tripping the machine.
const HARD_REQUIRED_UTILS = [
  // hvCable is hard-required too: a distribution panel with no feeder behind
  // it powers nothing, so an unwired hv_in is every bit as fatal as an unwired
  // machine — and reporting it AT THE PANEL is the only way the player finds
  // out why a whole bank of machines went dark.
  'hvCable',
  'powerCable', 'vacuumPipe', 'rfWaveguide', 'coolingWater', 'cryoTransfer',
];
// Exported because this map IS the utility -> blocker-code contract: the
// advisor generates one advice rule per entry, so a utility added here gets
// advice for free and can never drift from the blocker that produced it.
export const UNCONNECTED_CODES = {
  hvCable:      'hv_unconnected',
  powerCable:   'power_unconnected',
  vacuumPipe:   'vacuum_unconnected',
  rfWaveguide:  'rf_unconnected',
  coolingWater: 'cooling_unconnected',
  cryoTransfer: 'cryo_unconnected',
};

// Every utility the gate tracks, hard-required or not. The unwired-sink sweep
// runs over ALL of these so panels can report wiring truthfully; only the
// HARD_REQUIRED subset is turned into beam-tripping blockers. Without the
// wider sweep an unwired dataFiber sink would be indistinguishable from a
// wired one, since it produces no blocker by design.
const ALL_GATED_UTILS = [...HARD_REQUIRED_UTILS, 'dataFiber'];

// Shape: { [placeableId]: { powerQuality, rfQuality, coolingQuality,
//   cryoQuality, vacuumQuality, dataQuality } }. Physics backend reads the
// individual keys; JS consumers read e.g. .dataQuality. A missing utility
// means the component declares no sink for it and defaults to 1.0 (full
// quality) on the consumer side — a declared sink is ALWAYS present, at 0 if
// nothing solved it (see _aggregateNodeQualities).
//
// Exported because this map IS the utility-type -> quality-field contract:
// anything reading nodeQualities (panels deciding "is this beamline
// connected?", the physics bridge) has to key off the same table the gate
// wrote with, not a hand-copied one.
export const UTILITY_TO_QUALITY_FIELD = {
  hvCable:      'hvQuality',
  powerCable:   'powerQuality',
  rfWaveguide:  'rfQuality',
  coolingWater: 'coolingQuality',
  cryoTransfer: 'cryoQuality',
  vacuumPipe:   'vacuumQuality',
  dataFiber:    'dataQuality',
};

// Physical per-sink quantities carried alongside the 0-1 quality scalars.
//
// The scalars say how well a sink is served; these say WHAT it is served with,
// which is what the device-physics model needs. A cavity's gradient depends on
// watts of RF and kelvin of helium, not on an abstract fraction — see
// beam_physics/srf.py.
//
// `field` is the name on nodeQualities (and so on infraQuality); `flowKey` is
// the per-sink map the utility solver publishes on its flowState; `worst` is
// the fail-closed value for a declared-but-unsolved sink, chosen so that
// forgetting to wire something is never better than wiring it badly.
export const UTILITY_PHYSICAL_FIELDS = [
  { utility: 'rfWaveguide',  field: 'rfPowerW',        flowKey: 'perSinkPower',    worst: 0, reduce: 'min' },
  { utility: 'cryoTransfer', field: 'cryoTempK',       flowKey: 'perSinkTemp',     worst: 300, reduce: 'max' },
  { utility: 'coolingWater', field: 'coolingDeltaT',   flowKey: 'perSinkDeltaT',   worst: 100, reduce: 'max' },
  { utility: 'vacuumPipe',   field: 'vacuumPressure',  flowKey: 'perSinkPressure', worst: 1013, reduce: 'max' },
];

/**
 * Quality fields a component type declares a SINK for, as an object of zeros —
 * the fail-closed floor for that type. Returns null when the type declares no
 * sinks at all, which is the "not applicable" case: absent field means the
 * consumer's 1.0 default applies, and that must stay distinct from "declared
 * this sink and never wired it" (quality 0).
 *
 * Exported for Game's physics bridge, which needs the same floor without
 * depending on the gate having run.
 */
const _floorCache = new Map();
export function declaredSinkQualityFloor(type) {
  if (_floorCache.has(type)) return _floorCache.get(type);
  const floor = sinkQualityFloorFrom(getUtilityPortsV2(type));
  _floorCache.set(type, floor);
  return floor;
}

// portTable -> {qualityField: 0, ...} or null. Split out so the gate can run
// it over its injected getPorts (tests supply fake tables) while
// declaredSinkQualityFloor runs it over the real registry.
function sinkQualityFloorFrom(portTable) {
  let floor = null;
  for (const spec of Object.values(portTable || {})) {
    if (!spec || spec.role !== 'sink') continue;
    const field = UTILITY_TO_QUALITY_FIELD[spec.utility];
    if (field) {
      if (!floor) floor = {};
      floor[field] = 0;
    }
    // Physical quantities fail closed to their WORST value, which is not
    // always zero: no RF is 0 W, but no cooling is a hot cavity (300 K) and no
    // pumping is atmosphere (1013 mbar). Zeroing those would read as "perfectly
    // cold" and "perfect vacuum" — the exact inversion this floor exists to
    // prevent.
    for (const phys of UTILITY_PHYSICAL_FIELDS) {
      if (phys.utility !== spec.utility) continue;
      if (!floor) floor = {};
      floor[phys.field] = phys.worst;
    }
  }
  return floor;
}

// --- Beam staffing: coverage, not "does anyone happen to be working" -------
//
// Task 4 of staff-professions-3 (jobs-and-gates). The gate used to ask "does
// ANY operator have status 'working', assigned (or unassigned-and-so-
// defaulted) to the Control Room" — true the instant an operator was hired,
// whether or not they had ever set foot near a console. Now it asks "is
// someone actually SEATED, running the beam" — member.job.jobType ===
// 'runBeam' && member.job.phase === 'work', the job runner's own signal for
// "arrived and working" (see jobRunner.js's header comment on phase).

// Distinct physical beamlines the coverage formula has to staff: one per
// source junction (beamline-components.raw.js's `isSource` flag — the same
// "how many beamlines does this facility have" signal the New Beamline
// tooling and test-scenarios.js already key off). Deliberately NOT
// _computeTopology's broader `beamlineCount` (every category==='beamline'
// endpoint — every cavity/quad/BPM/cryomodule on every pipe, easily dozens
// for a single real beamline): that count answers "is there a beamline in
// this facility at all" (see run()'s own `beamlineCount > 0` guard, which
// keeps using it), not "how many lines need an operator's attention" — using
// it here would turn "hire one more operator" into "hire fifteen more".
function countBeamlines(state) {
  let n = 0;
  for (const p of (state.placeables || [])) {
    if (COMPONENTS[p.type]?.isSource) n++;
  }
  return n;
}

// Add 1 to every operator's coverage when the Control Room is Tier 3+ —
// better consoles, more screens, one operator watching more of the machine
// at once (see zoneConnectivity's own tier semantics, Game.js).
const CONSOLE_TIER_BONUS_THRESHOLD = 3;

/**
 * `{ covered, capacity, operators }` — whether the facility's operators, as
 * currently seated and working, can cover every beamline it has.
 *
 * `operators` is exactly the set contributing to `capacity`: staff whose
 * profession is 'operator', whose `status` is 'working' (NOT e.g. 'resting'
 * off a stress breakdown — see below), AND whose job is `{ jobType:
 * 'runBeam', phase: 'work' }` right now. Travelling to a console, eating,
 * idle, or simply not an operator at all — none of those count, on purpose:
 * an operator mid-meal is not at the console, so the beam is not covered no
 * matter how content their morale bar looks (see task-4-brief.md's
 * carry-forward item 2 — this is a deliberate behavior change from the old
 * gate, which only checked `status === 'working'` and nothing else).
 *
 * The `status === 'working'` half of that guard matters on its own: a
 * stress-breakdown operator (`status: 'resting'`, staffSystem.js's own
 * mechanism — a different thing from the `rest` JOB TYPE, which leaves
 * `status` at 'working' throughout) can still be holding a stale `job:
 * {jobType:'runBeam', phase:'work'}` from before the breakdown, since
 * nothing on that path abandons it. Without this check they'd count as full
 * coverage while an eating/resting-on-a-JOB operator counts zero — the same
 * "not actually at the console" fact, scored two different ways.
 *
 * Per-operator coverage is `1 + floor(skills.operating / 4)` — a green
 * (skill 0) operator covers exactly one beamline, a maxed one (skill 10, +2)
 * covers three — plus the console-tier bonus above.
 *
 * Deterministic: no rng anywhere in this function or its callers. Compare
 * the deleted `_hasActiveOperator`, whose `mood === 'stressed' && rng() <
 * 0.3` random rejection made the same state produce different blockers from
 * one tick to the next — not legible, and not what the gate exists for.
 */
export function operatorCoverage(state) {
  const tierBonus = (state.zoneConnectivity?.controlRoom?.tier || 0) >= CONSOLE_TIER_BONUS_THRESHOLD ? 1 : 0;
  const operators = (state.staffMembers || []).filter(m =>
    m.profession === 'operator' && m.status === 'working'
    && m.job?.jobType === 'runBeam' && m.job?.phase === 'work');
  const capacity = operators.reduce((sum, m) => {
    const skill = m.skills?.operating ?? 0;
    return sum + 1 + Math.floor(skill / 4) + tierBonus;
  }, 0);
  const beamlineCount = countBeamlines(state);
  return { covered: capacity >= beamlineCount, capacity, operators };
}

// Must match Game.js's DAY_LENGTH_TICKS (240) — duplicated rather than
// imported to avoid a circular import (Game.js imports this module). Keep
// this in sync if DAY_LENGTH_TICKS ever changes; jobRunner.js's own
// SUBTILE_UNIT/SLOWEST_PAWN_SPEED duplication (from StaffPawns.js) is the
// same trade for the same reason.
const DAY_LENGTH_TICKS = 240;
const BEAM_HOURS_TICK_INTERVAL = DAY_LENGTH_TICKS / 24; // ticks per in-game hour

export class UtilityGate {
  constructor(opts = {}) {
    this.state = opts.state;
    this.solveRunner = opts.solveRunner;
    this.getPorts = opts.getPorts;
    // Player-facing message sink. Soft errors used to reach console.warn and
    // nowhere else, so an overloaded network announced itself ONLY by
    // recolouring its cables — a signal with no legend and no explanation.
    this.log = opts.log || (() => {});
    this._lastErrHash = '';
    this._loggedSoft = new Set();
    // The sim tick this.tick last accrued beamHours for — see
    // _accrueBeamHours's own doc comment. null (not 0) so tick 0 itself
    // still accrues once.
    this._lastBeamHourTick = null;
    // Topology cache — the unconnected-sink report AND the declared-sink
    // floor are pure topology (endpoints x port tables x lines), so both ride
    // the SolveRunner's topologyRevision: recomputed only when the revision
    // moved (or when the injected solveRunner has no revision at all, e.g.
    // test fakes — then it recomputes every tick, the old behavior).
    // Endpoints now include pipe placements, so this must never go per-tick.
    this._topoCache = null;
    this._topoRev = -1;
  }

  /**
   * Run one gating pass: solve utility networks, merge synthesized hard
   * errors, write state.infraBlockers / infraCanRun / nodeQualities.
   * Solver exceptions are trapped — a broken descriptor must not kill tick().
   */
  run() {
    const state = this.state;
    if (!state || !this.solveRunner) return;
    try {
      // The whole state, not a {tick} stub: descriptors reach the world through
      // this argument (endpointsById reads worldState.placeables /
      // .beamPipes). With only a tick on it, vacuumPipe.solve saw no endpoints
      // at all — isBaked was permanently false and beam-pipe outgassing
      // permanently zero, so bakeout was a purchasable upgrade that did nothing
      // and every vacuum network pumped down more easily than the model says.
      // The solver unit tests pass a real state, which is why it never showed.
      // `state` already carries `tick`, so worldState.tick readers are
      // unaffected.
      const result = this.solveRunner.runSolve(state);
      const errs = Array.isArray(result && result.errors) ? result.errors : [];
      const hardErrs = errs.filter(e => e && e.severity === 'hard');
      const softErrs = errs.filter(e => e && e.severity === 'soft');

      // Unconnected-sink detection lives in network-discovery (topology
      // knowledge); here we only map reports onto the hard-error shape.
      // Topology-only computation → reuse the cached report until the
      // solver's topology revision moves. Endpoints change only via
      // place/remove (of a placeable OR a pipe placement), which also bumps
      // the revision.
      const rev = this.solveRunner.topologyRevision;
      if (rev === undefined || this._topoCache == null || this._topoRev !== rev) {
        this._topoCache = this._computeTopology();
        this._topoRev = rev;
      }
      const { unconnected, unwiredSinks, declaredFloors, beamlineCount } = this._topoCache;

      for (const u of unconnected) {
        hardErrs.push({
          severity: 'hard',
          code: UNCONNECTED_CODES[u.utility],
          message: `${u.placeableType} ${u.portName} not connected to ${u.utility}`,
          location: { placeableId: u.placeableId, portName: u.portName },
          fromUnconnectedCheck: true,
        });
      }

      // RimWorld-like staffing: beamlines need enough operators actually
      // SEATED and running the beam, not merely on the roster (see
      // operatorCoverage's own doc comment). `beamlineCount` here is the
      // topology sweep's broad "is there a beamline in this facility at
      // all" count (unchanged) — operatorCoverage computes its own, narrower
      // "how many DISTINCT beamlines need staffing" count for the capacity
      // comparison itself.
      const coverage = operatorCoverage(state);
      if (beamlineCount > 0 && !coverage.covered) {
        hardErrs.push({
          severity: 'hard',
          code: 'beam_unstaffed',
          message: this._unstaffedMessage(),
          location: { zoneId: 'controlRoom' },
          fromStaffingCheck: true,
        });
      }

      // The utility solve + the two synthesized checks are the only sources of
      // infraBlockers. Hard errors block the beam; soft errors are logged but
      // non-fatal.
      state.infraBlockers = hardErrs.map(e => ({
        ...e,
        fromUtilitySolve: true,
        reason: e.message || e.code || 'Utility fault',
      }));
      state.infraCanRun = hardErrs.length === 0;

      // Accrue AFTER infraCanRun is final, and only when it's true: beamHours
      // is meant to record time the beam actually ran, not time a seated
      // operator happened to be at their console while an UNRELATED fault
      // (unwired power, a quenched cavity, the staffing gate itself) held
      // the whole facility down. `beamlineCount > 0` mirrors the same guard
      // the blocker above uses — no beamline, nothing to accrue.
      if (beamlineCount > 0 && state.infraCanRun) {
        this._accrueBeamHours(coverage.operators);
      }

      state.nodeQualities = this._aggregateNodeQualities(declaredFloors);
      // Wiring topology, published alongside the qualities it can't be
      // recovered from: a declared sink always carries a quality field, so
      // "has a field" means "needs this utility", never "is wired to it".
      state.unwiredSinks = unwiredSinks;

      this._dedupLog(hardErrs, softErrs);
    } catch (e) {
      console.error('[UtilityGate] utility solve error:', e);
    }
  }

  // The blocker text has to name the *actual* cause. Checked
  // most-fundamental-first: no operator hired at all; operators hired but no
  // Operator Console anywhere in the world; a console exists but nothing can
  // currently reach it (walled off, no door); then, with nobody yet seated
  // (active.length === 0) — travelling (transient, "any moment now", not an
  // error), eating/resting (the modern equivalent of the deleted onBreak
  // status — task-4-brief.md's carry-forward item 1), recovering from a
  // stress breakdown, or simply not assigned yet (the instant after pressing
  // Start, before that tick's assignJobs has run); then, with SOMEONE seated
  // but not enough of them — console-starved (every console already has an
  // operator, so hiring more would sit idle; the fix is another console) vs.
  // genuinely short-staffed (a free console exists; hire another operator or
  // promote one already on shift).
  _unstaffedMessage() {
    const state = this.state;
    const operators = (state.staffMembers || []).filter(m => m.profession === 'operator');
    if (operators.length === 0) {
      return 'No operator hired — beam tripped. Hire an operator to staff the Control Room.';
    }

    const stations = getStationIndex(state).byJob.runBeam || [];
    if (stations.length === 0) {
      return 'No Operator Console built — place one in the Control Room; beam tripped.';
    }

    // Reachability: can any hired operator, from wherever they currently
    // stand, actually get to a console? Only meaningful once at least one
    // operator has reported a live position (member.fromNode, written by
    // the renderer as pawns walk) — with none known yet (e.g. the instant
    // after hiring, before a pawn has rendered a frame), skip straight to
    // the travel/break/capacity checks below rather than reporting a false
    // "unreachable".
    const nav = getNavGrid(state);
    let positionKnown = false;
    let reachable = false;
    for (const m of operators) {
      if (!m.fromNode) continue;
      positionKnown = true;
      if (stations.some(ref => isReachable(nav, m.fromNode, ref.node))) { reachable = true; break; }
    }
    if (positionKnown && !reachable) {
      return 'Operator Console unreachable — check for a door or blocked path into the Control Room; beam tripped.';
    }

    // Not destructured as `{ operators: active }` — that literal spelling
    // trips test-staff-rename-sweep.js's grep guard for the old plural
    // staff-count keys (`operators:`), even though this is an unrelated
    // rename-on-destructure. Read the field off the result object instead.
    const coverage = operatorCoverage(state);
    const capacity = coverage.capacity;
    const active = coverage.operators;

    if (active.length === 0) {
      if (operators.some(m => m.job?.phase === 'travel')) {
        return 'Operator on the way to the console — beam will resume once they arrive.';
      }
      if (operators.some(m => m.job?.jobType === 'eat' || m.job?.jobType === 'rest')) {
        return 'Operator eating or resting — beam paused until they return to the console; hire another operator to cover the gap.';
      }
      // operatorCoverage also excludes status !== 'working' (a stress
      // breakdown, staffSystem.js's 'resting' — distinct from the 'rest' JOB
      // TYPE above, which leaves status at 'working'). Give it its own line
      // rather than letting it fall into the generic case below.
      if (operators.some(m => m.status && m.status !== 'working')) {
        return 'Operator recovering from a stress breakdown — beam paused until they return to work.';
      }
      // Hired, a console exists and is reachable, but nobody has been
      // assigned to it yet — most commonly the instant after pressing
      // Start, before that tick's assignJobs has had a chance to run.
      return 'Operator is not at a console yet — beam tripped.';
    }

    // Someone IS seated — the shortfall is either too few CONSOLES (hiring
    // more operators would just leave them with nowhere to sit) or too few
    // OPERATORS (a free console is sitting empty). operatorConsole/
    // monitorBank each declare slots: 1, so stations.length is also the
    // hard ceiling on how many operators can ever be seated at once.
    const beamlineCount = countBeamlines(state);
    if (active.length >= stations.length) {
      return `Every console is staffed (${active.length}) but only ${capacity} of `
        + `${beamlineCount} beamlines are covered — build another Operator Console; `
        + 'hiring more operators won\'t help until they have somewhere to sit.';
    }
    return `${active.length} operator${active.length === 1 ? '' : 's'} `
      + `cover${active.length === 1 ? 's' : ''} ${capacity} of ${beamlineCount} beamlines; `
      + 'hire another or promote one.';
  }

  // Every operator currently seated and running the beam accrues
  // member.stats.beamHours once per in-game hour (DAY_LENGTH_TICKS/24 ticks)
  // — the counter Plan 1 declared and the "recovered the beam 47 times"
  // milestone (Task 7) reads from. Ticks, not wall-clock, so this scales
  // correctly with game speed exactly like the rest of the sim clock.
  //
  // Deduped per tick via _lastBeamHourTick: run() is not the only caller of
  // the gate — toggleBeam() calls refreshInfrastructureGate() (== run())
  // synchronously on every click, including while paused (tick frozen). Two
  // calls landing on the same on-the-hour tick used to both accrue, so
  // toggling a beam off/on repeatedly while paused banked beamHours with
  // zero sim time elapsed. This makes the accrual idempotent per tick,
  // matching "once per in-game hour" literally rather than "once per call
  // that happens to land on an hour boundary."
  _accrueBeamHours(operators) {
    const tick = this.state.tick || 0;
    if (tick % BEAM_HOURS_TICK_INTERVAL !== 0) return;
    if (this._lastBeamHourTick === tick) return;
    this._lastBeamHourTick = tick;
    for (const m of operators) {
      if (!m.stats) m.stats = {};
      m.stats.beamHours = (m.stats.beamHours || 0) + 1;
    }
  }

  /**
   * One pass over every utility endpoint in the world — state.placeables AND
   * the components living on beam pipes (listUtilityEndpoints). Indexing
   * placeables alone meant role:'placement' modules (cavities, quads, BPMs,
   * cryomodules) could be wired but were never CHECKED: an SRF cavity with no
   * power produced no blocker and, having no nodeQualities entry, ran at the
   * consumer's 1.0 default — i.e. never wiring scored better than wiring
   * badly.
   *
   * Returns the unconnected-sink report, the per-endpoint fail-closed quality
   * floor, and the beamline-endpoint count the staffing gate keys on.
   */
  _computeTopology() {
    const state = this.state;
    const endpoints = listUtilityEndpoints(state);
    // Sweep every gated utility, then split: blockers take the hard-required
    // subset, `unwiredSinks` keeps them all so UI can distinguish "never wired"
    // from "wired but starved". Both come from one pass because the sweep is
    // the expensive part and it is cached on topologyRevision either way.
    const allUnconnected = findUnconnectedSinks(
      endpoints, state.utilityLines, this.getPorts, ALL_GATED_UTILS);
    const unconnected = allUnconnected.filter(
      u => HARD_REQUIRED_UTILS.includes(u.utility));
    const unwiredSinks = {};
    for (const u of allUnconnected) {
      if (!unwiredSinks[u.placeableId]) unwiredSinks[u.placeableId] = {};
      unwiredSinks[u.placeableId][u.utility] = true;
    }
    const declaredFloors = new Map();
    let beamlineCount = 0;
    for (const e of endpoints) {
      if (e.category === 'beamline') beamlineCount++;
      const floor = sinkQualityFloorFrom(this.getPorts(e.type));
      if (floor) declaredFloors.set(e.id, floor);
    }
    return { unconnected, unwiredSinks, declaredFloors, beamlineCount };
  }

  // Aggregate perSinkQuality → nodeQualities (see UTILITY_TO_QUALITY_FIELD),
  // then fail closed: every declared sink with no solved quality resolves to
  // 0, not to the 1.0 an absent field means. `declaredFloors` only lists
  // utilities a component actually declares a sink for, so "not applicable"
  // (no such sink) stays absent and unpenalised.
  _aggregateNodeQualities(declaredFloors) {
    const nodeQualities = {};
    const data = this.state.utilityNetworkData;
    for (const [utilityType, perType] of (data || [])) {
      const qualityField = UTILITY_TO_QUALITY_FIELD[utilityType];
      if (!qualityField) continue;
      for (const flow of perType.values()) {
        const map = flow.perSinkQuality || {};
        for (const portKey of Object.keys(map)) {
          const q = map[portKey];
          const colonIdx = portKey.indexOf(':');
          const placeableId = colonIdx >= 0 ? portKey.slice(0, colonIdx) : portKey;
          if (!nodeQualities[placeableId]) nodeQualities[placeableId] = {};
          // If multiple networks of the same utility feed this placeable,
          // take the minimum (worst-case feed).
          const prior = nodeQualities[placeableId][qualityField];
          nodeQualities[placeableId][qualityField] =
            prior === undefined ? q : Math.min(prior, q);
        }
      }

      // Physical quantities alongside the scalar. Same worst-case-wins rule,
      // but the direction depends on the quantity: less RF power is worse,
      // while a HIGHER temperature or pressure is worse.
      for (const phys of UTILITY_PHYSICAL_FIELDS) {
        if (phys.utility !== utilityType) continue;
        for (const flow of perType.values()) {
          const map = flow[phys.flowKey] || {};
          for (const portKey of Object.keys(map)) {
            const v = map[portKey];
            if (typeof v !== 'number') continue;
            const colonIdx = portKey.indexOf(':');
            const placeableId = colonIdx >= 0 ? portKey.slice(0, colonIdx) : portKey;
            if (!nodeQualities[placeableId]) nodeQualities[placeableId] = {};
            const prior = nodeQualities[placeableId][phys.field];
            nodeQualities[placeableId][phys.field] = prior === undefined
              ? v
              : (phys.reduce === 'max' ? Math.max(prior, v) : Math.min(prior, v));
          }
        }
      }
      // Also expose cryo-quench as a boolean on the placeable so the
      // Python backend can convert SRF cavities to drift.
      if (utilityType === 'cryoTransfer') {
        for (const flow of perType.values()) {
          if (!flow.quenched) continue;
          const map = flow.perSinkQuality || {};
          for (const portKey of Object.keys(map)) {
            const colonIdx = portKey.indexOf(':');
            const placeableId = colonIdx >= 0 ? portKey.slice(0, colonIdx) : portKey;
            if (!nodeQualities[placeableId]) nodeQualities[placeableId] = {};
            nodeQualities[placeableId].cryoQuenched = true;
          }
        }
      }
    }
    for (const [placeableId, floor] of (declaredFloors || [])) {
      let entry = nodeQualities[placeableId];
      if (!entry) entry = nodeQualities[placeableId] = {};
      // Use the floor's own value, not a blanket 0 — physical quantities fail
      // closed to 300 K / 1013 mbar, and zeroing them would mean "ice cold"
      // and "perfect vacuum" for a sink that was never wired.
      for (const field of Object.keys(floor)) {
        if (typeof entry[field] !== 'number') entry[field] = floor[field];
      }
    }
    return nodeQualities;
  }

  // Console-warn only when the error-count signature changes, so a persistent
  // fault doesn't spam every tick.
  _dedupLog(hardErrs, softErrs) {
    // Soft errors are the ones the player never hears about: they do not block
    // the beam, so nothing in the HUD claims them, and the only trace was the
    // amber pulse on the affected run. Announce each distinct one once, and
    // forget it when it clears so a re-overload speaks again.
    const seen = new Set();
    for (const e of softErrs) {
      const key = `${e.code}|${e.location?.networkId || ''}`;
      seen.add(key);
      if (this._loggedSoft.has(key)) continue;
      this._loggedSoft.add(key);
      this.log(e.message || e.code, 'warn');
    }
    for (const key of [...this._loggedSoft]) {
      if (!seen.has(key)) this._loggedSoft.delete(key);
    }

    const hash = `${hardErrs.length}|${softErrs.length}`;
    if (hash !== this._lastErrHash && (hardErrs.length || softErrs.length)) {
      this._lastErrHash = hash;
      if (hardErrs.length) {
        console.warn('[utility] hard errors:', hardErrs.map(e => e.code + ':' + (e.message || '')));
      }
      if (softErrs.length) {
        console.warn('[utility] soft errors:', softErrs.map(e => e.code + ':' + (e.message || '')));
      }
    } else if (hash === '0|0') {
      this._lastErrHash = hash;
    }
  }
}

export default UtilityGate;
