// src/utility/solve-runner.js
//
// Per-tick solve loop. Given the current state.utilityLines and a descriptor
// registry, discover networks and call each descriptor's solve() — writing
// flow results to state.utilityNetworkData (per type) and next-tick persistent
// state to state.utilityNetworkState (keyed by network id). Descriptor throws
// are trapped and surfaced as errors[{severity:'hard', code:'solve_threw'}].
//
// Topology-dirty caching: network discovery (union-find + spatial join over
// every line) only depends on topology — utilityLines and the port tables of
// placed components. Game bumps `topologyRevision` via markTopologyDirty() on
// every mutation seam (utility-line add/remove/endpoint-null, placeable
// place/remove, load/undo/redo); runSolve() re-runs discoverAll only when the
// revision changed since the last pass and otherwise reuses the cached
// Map<utilityType, Network[]>. Per-network solve() always runs (flows and
// reservoirs change every tick). Safe because network ids are content-hashed
// from sorted port keys (or sorted line ids for open networks) — identical
// topology re-discovers to identical ids, so utilityNetworkState keying is
// unaffected by whether discovery ran from cache or from scratch.

import { discoverAll, makeDefaultPortLookup } from './network-discovery.js';

function cloneDefaults(defaults) {
  if (defaults == null) return {};
  // structuredClone is available in modern Node. Fall back to JSON if not.
  if (typeof structuredClone === 'function') return structuredClone(defaults);
  try { return JSON.parse(JSON.stringify(defaults)); } catch (_) { return {}; }
}

export class SolveRunner {
  constructor(opts = {}) {
    this.state = opts.state;
    this.registry = opts.registry || { types: {}, list: [] };
    this.emit = opts.emit || (() => {});
    this.portLookup = opts.portLookup || null;

    // Topology-dirty cache. `topologyRevision` is bumped by markTopologyDirty()
    // on every topology mutation; discovery re-runs when it differs from
    // `_discoveredRevision`. `stats` is a test/diagnostic instrumentation hook.
    this.topologyRevision = 0;
    this._discoveredRevision = -1;
    this._cachedNetworks = null; // Map<utilityType, Network[]>
    this.stats = { discoveries: 0, solvePasses: 0 };
  }

  /**
   * Invalidate the cached network discovery. Call after any mutation that can
   * change topology: utility-line add/remove, line endpoints nulled by a
   * placeable removal, placeable place/remove, or wholesale state replacement
   * (load / undo / redo).
   */
  markTopologyDirty() {
    this.topologyRevision++;
  }

  /**
   * Run one solve pass across all utility types. Returns `{errors: [...]}`
   * aggregating every descriptor's reported errors plus any `solve_threw`
   * we synthesize from caught exceptions.
   */
  runSolve(worldState = {}) {
    const state = this.state;
    if (!state) return { errors: [] };
    if (!state.utilityLines) state.utilityLines = new Map();
    if (!state.utilityNetworkState) state.utilityNetworkState = new Map();

    const list = (this.registry && this.registry.list) || [];

    // Re-discover only when topology changed since the last pass. The default
    // portLookup snapshots state.placeables, so it must be rebuilt alongside
    // discovery (a placeable mutation always bumps the revision).
    let networksByType = this._cachedNetworks;
    if (networksByType == null || this._discoveredRevision !== this.topologyRevision) {
      const portLookup = this.portLookup || makeDefaultPortLookup(state);
      networksByType = discoverAll(state.utilityLines, portLookup, list);
      this._cachedNetworks = networksByType;
      this._discoveredRevision = this.topologyRevision;
      this.stats.discoveries++;
    }
    this.stats.solvePasses++;

    // Publish the discovery output (Map<utilityType, Network[]>, each network
    // carrying id + lineIds) so consumers — notably the renderer's error-glow
    // mapping — can reuse it instead of re-running discovery. Derived like
    // utilityNetworkData: never serialized, repopulated every solve pass.
    state.utilityNetworks = networksByType;

    state.utilityNetworkData = new Map();
    const allErrors = [];

    for (const utilityType of list) {
      const descriptor = this.registry.types && this.registry.types[utilityType];
      const perType = new Map();
      state.utilityNetworkData.set(utilityType, perType);
      if (!descriptor) continue;

      const networks = networksByType.get(utilityType) || [];
      for (const network of networks) {
        const persisted = state.utilityNetworkState.get(network.id);
        const persistent = persisted != null
          ? persisted
          : cloneDefaults(descriptor.persistentStateDefaults);

        let result;
        try {
          result = descriptor.solve(network, persistent, worldState) || {};
        } catch (e) {
          result = {
            flowState: null,
            nextPersistentState: persistent,
            errors: [{
              severity: 'hard',
              code: 'solve_threw',
              message: String((e && e.message) || e),
              location: { networkId: network.id },
            }],
          };
        }
        if (result.flowState) perType.set(network.id, result.flowState);
        if (result.nextPersistentState !== undefined && result.nextPersistentState !== null) {
          state.utilityNetworkState.set(network.id, result.nextPersistentState);
        }
        if (Array.isArray(result.errors)) allErrors.push(...result.errors);
      }
    }

    return { errors: allErrors };
  }
}

export default SolveRunner;
