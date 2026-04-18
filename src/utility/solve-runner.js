// src/utility/solve-runner.js
//
// Per-tick solve loop. Given the current state.utilityLines and a descriptor
// registry, discover networks and call each descriptor's solve() — writing
// flow results to state.utilityNetworkData (per type) and next-tick persistent
// state to state.utilityNetworkState (keyed by network id). Descriptor throws
// are trapped and surfaced as errors[{severity:'hard', code:'solve_threw'}].
//
// Topology-dirty caching is intentionally skipped for v1 — easy enough to add
// later but unnecessary for early iteration.

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

    const portLookup = this.portLookup || makeDefaultPortLookup(state);
    const list = (this.registry && this.registry.list) || [];
    const networksByType = discoverAll(state.utilityLines, portLookup, list);

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
