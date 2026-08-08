// src/game/utility-gate.js
//
// Per-tick utility gating policy: run the network solve, synthesize the hard
// errors the solver can't see (unconnected sinks have no network; staffing is
// not a utility), then derive state.infraBlockers / infraCanRun /
// nodeQualities. Game.tick() calls run() once per tick; everything else is
// internal.
//
// DI mirrors SolveRunner: constructor takes {state, solveRunner, getPorts,
// rng}. `rng` must be a delegating closure (Game reassigns this.rng on load,
// so capturing the function directly would freeze the pre-load stream).

import { findUnconnectedSinks } from '../utility/network-discovery.js';

// MVP: unconnected power/vacuum sinks on beamline modules are hard-required.
// This makes "build line → connect utilities → run" the required tycoon beat.
const HARD_REQUIRED_UTILS = ['powerCable', 'vacuumPipe'];
const UNCONNECTED_CODES = {
  powerCable: 'power_unconnected',
  vacuumPipe: 'vacuum_unconnected',
};

// Shape: { [placeableId]: { powerQuality, rfQuality, coolingQuality,
//   cryoQuality, vacuumQuality, dataQuality } }. Physics backend reads the
// individual keys; JS consumers read e.g. .dataQuality. A missing utility
// defaults to 1.0 (full quality) on the consumer side.
const UTILITY_TO_QUALITY_FIELD = {
  powerCable:   'powerQuality',
  rfWaveguide:  'rfQuality',
  coolingWater: 'coolingQuality',
  cryoTransfer: 'cryoQuality',
  vacuumPipe:   'vacuumQuality',
  dataFiber:    'dataQuality',
};

export class UtilityGate {
  constructor(opts = {}) {
    this.state = opts.state;
    this.solveRunner = opts.solveRunner;
    this.getPorts = opts.getPorts;
    this.rng = opts.rng || Math.random;
    this._lastErrHash = '';
    // Unconnected-sink cache — findUnconnectedSinks is pure topology, so it
    // rides the SolveRunner's topologyRevision: recomputed only when the
    // revision moved (or when the injected solveRunner has no revision at
    // all, e.g. test fakes — then it recomputes every tick, the old behavior).
    this._unconnectedCache = null;
    this._unconnectedRev = -1;
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
      const result = this.solveRunner.runSolve({ tick: state.tick });
      const errs = Array.isArray(result && result.errors) ? result.errors : [];
      const hardErrs = errs.filter(e => e && e.severity === 'hard');
      const softErrs = errs.filter(e => e && e.severity === 'soft');

      const beamlinePlaceables = (state.placeables || []).filter(p => p.category === 'beamline');

      // Unconnected-sink detection lives in network-discovery (topology
      // knowledge); here we only map reports onto the hard-error shape.
      // Topology-only computation → reuse the cached report until the
      // solver's topology revision moves. beamlinePlaceables changes only
      // via place/remove, which also bumps the revision.
      const rev = this.solveRunner.topologyRevision;
      if (rev === undefined || this._unconnectedCache == null || this._unconnectedRev !== rev) {
        this._unconnectedCache = findUnconnectedSinks(
          beamlinePlaceables, state.utilityLines, this.getPorts, HARD_REQUIRED_UTILS);
        this._unconnectedRev = rev;
      }
      for (const u of this._unconnectedCache) {
        hardErrs.push({
          severity: 'hard',
          code: UNCONNECTED_CODES[u.utility],
          message: `${u.placeableType} ${u.portName} not connected to ${u.utility}`,
          location: { placeableId: u.placeableId, portName: u.portName },
          fromUnconnectedCheck: true,
        });
      }

      // RimWorld-like staffing: beamlines need an active operator in controlRoom
      if (beamlinePlaceables.length > 0 && !this._hasActiveOperator()) {
        hardErrs.push({
          severity: 'hard',
          code: 'beam_unstaffed',
          message: 'No active operator in Control Room — beam tripped',
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

      state.nodeQualities = this._aggregateNodeQualities();

      this._dedupLog(hardErrs, softErrs);
    } catch (e) {
      console.error('[UtilityGate] utility solve error:', e);
    }
  }

  _hasActiveOperator() {
    return (this.state.staffMembers || []).some(m => {
      if (m.role !== 'operator') return false;
      if (m.status !== 'working') return false;
      // must be assigned to controlRoom (or no assignment counts as controlRoom for MVP)
      const zoneOk = !m.assignment?.zoneId || m.assignment.zoneId === 'controlRoom';
      if (!zoneOk) return false;
      if (m.needs?.fatigue > 0.85) return false;
      if (m.mood === 'stressed' && this.rng() < 0.3) return false;
      return true;
    });
  }

  // Aggregate perSinkQuality → nodeQualities (see UTILITY_TO_QUALITY_FIELD).
  _aggregateNodeQualities() {
    const nodeQualities = {};
    const data = this.state.utilityNetworkData;
    if (!data) return nodeQualities;
    for (const [utilityType, perType] of data) {
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
    return nodeQualities;
  }

  // Console-warn only when the error-count signature changes, so a persistent
  // fault doesn't spam every tick.
  _dedupLog(hardErrs, softErrs) {
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
