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
import { computeElectricalSinkDemands } from './electrical-demand.js';

function cloneDefaults(defaults) {
  if (defaults == null) return {};
  // structuredClone is available in modern Node. Fall back to JSON if not.
  if (typeof structuredClone === 'function') return structuredClone(defaults);
  try { return JSON.parse(JSON.stringify(defaults)); } catch (_) { return {}; }
}

// Solve passes an orphaned network's persistent state is held before being
// dropped. Long enough that a delete-and-redraw round trip (which re-mints the
// same content-hashed id) recovers it, short enough that abandoned entries
// don't accumulate in every save. ~5 minutes of wall clock at the 1 Hz tick.
const ORPHAN_GRACE_PASSES = 300;

/**
 * One claimant's share of a persistent-state entry after a network split.
 * Numeric fields are extensive quantities (reservoir contents), so they are
 * divided by `share`; anything else is carried over as-is. __portKeys is
 * dropped — the next solve() rewrites it from the live network's ports.
 */
function splitPersistentState(entry, share, intensiveFields = []) {
  const intensive = new Set(intensiveFields);
  const out = {};
  for (const [k, v] of Object.entries(entry)) {
    if (k === '__portKeys' || k === '__orphanedAt') continue;
    out[k] = typeof v === 'number' && !intensive.has(k) ? v * share : v;
  }
  return out;
}

export class SolveRunner {
  constructor(opts = {}) {
    this.state = opts.state;
    this.registry = opts.registry || { types: {}, list: [] };
    this.emit = opts.emit || (() => {});
    this.portLookup = opts.portLookup || null;
    this.getDefinition = opts.getDefinition || (() => null);

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
      // Topology changed: carry persistent state across re-hashed network
      // ids and drop entries whose networks no longer exist.
      this._reconcilePersistentState(networksByType);
    }
    this.stats.solvePasses++;

    // Publish the discovery output (Map<utilityType, Network[]>, each network
    // carrying id + lineIds) so consumers — notably the renderer's error-glow
    // mapping — can reuse it instead of re-running discovery. Derived like
    // utilityNetworkData: never serialized, repopulated every solve pass.
    state.utilityNetworks = networksByType;

    // HV must solve before branch power so panels receive same-tick feeder
    // quality. Their upstream draw, however, is the connected downstream load
    // rather than nameplate rating. Resolve that topology-only quantity before
    // either electrical solver runs to avoid a circular solve-order dependency.
    state.electricalSinkDemands = computeElectricalSinkDemands(networksByType);

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
          result = descriptor.solve(network, persistent, worldState, {
            getDefinition: this.getDefinition,
            networksByType,
          }) || {};
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
          const next = result.nextPersistentState;
          // Record port membership alongside the descriptor's state so
          // _reconcilePersistentState can match an orphaned entry to its
          // successor network after a topology edit re-hashes the id.
          next.__portKeys = network.ports.map(p => `${p.placeableId}:${p.portName}`);
          state.utilityNetworkState.set(network.id, next);
        }
        if (Array.isArray(result.errors)) allErrors.push(...result.errors);
      }
    }

    return { errors: allErrors };
  }

  /**
   * Persistent-state continuity across topology edits. Network ids are
   * content-hashed from port membership, so wiring one extra sink into a
   * cooling loop mints a new id; without migration the drained reservoir
   * entry would be abandoned (and re-solved from persistentStateDefaults —
   * a full reservoir for free) while the orphan stayed in
   * state.utilityNetworkState and every save forever. Here, right after a
   * fresh discovery: (1) any network with no persisted state claims the
   * orphaned entry of its utility type whose recorded __portKeys overlap
   * its own ports the most; (2) an orphan claimed by several networks (its
   * network was cut in two) is split between them in proportion to how much
   * of it each claimant inherited, so a reservoir is divided rather than
   * duplicated; (3) all remaining orphans are pruned.
   */
  _reconcilePersistentState(networksByType) {
    const stateMap = this.state && this.state.utilityNetworkState;
    if (!stateMap || typeof stateMap.get !== 'function') return;

    const liveIds = new Set();
    for (const nets of networksByType.values()) {
      for (const n of nets) {
        liveIds.add(n.id);
        // Back from limbo: this id is wired again, so clear its grace clock.
        const back = stateMap.get(n.id);
        if (back && back.__orphanedAt != null) delete back.__orphanedAt;
      }
    }
    const orphanIds = [];
    for (const id of stateMap.keys()) {
      if (!liveIds.has(id)) orphanIds.push(id);
    }
    if (orphanIds.length === 0) return;

    // (1)+(2) Route each orphan's contents into the live networks that
    // inherited its ports, weighted by how many each took. One successor
    // takes the entry whole (plain re-hash); several share it (the network
    // was cut); several orphans landing on one successor are summed (two
    // networks were joined). Reservoir contents therefore survive a topology
    // edit intact — never minted, never silently dropped.
    const inherited = new Map(); // netId -> accumulated persistent state
    const inheritedType = new Map(); // netId -> utility type (for the cap below)
    const inheritedNetwork = new Map(); // netId -> live network (for dynamic caps)
    const claimed = new Set();   // orphan ids a live network inherited from
    const addShare = (netId, entry, share, intensiveFields = []) => {
      const intensive = new Set(intensiveFields);
      const part = splitPersistentState(entry, share, intensiveFields);
      const cur = inherited.get(netId);
      if (!cur) { inherited.set(netId, part); return; }
      for (const [k, v] of Object.entries(part)) {
        if (typeof v === 'number' && intensive.has(k)) {
          // Temperature and similar state are intensive: splitting does not
          // halve them, and joining keeps the conservative (worst/highest)
          // value instead of summing two baths into an impossible 9 K one.
          cur[k] = typeof cur[k] === 'number' ? Math.max(cur[k], v) : v;
        } else if (typeof v === 'number') {
          cur[k] = (typeof cur[k] === 'number' ? cur[k] : 0) + v;
        }
        else if (cur[k] === undefined) cur[k] = v;
      }
    };

    for (const [utilityType, nets] of networksByType) {
      const typePrefix = `net_${utilityType}_`;
      const intensiveFields = this.registry.types?.[utilityType]?.persistentIntensiveFields || [];
      const successors = nets
        .filter(n => !stateMap.has(n.id))
        .map(n => ({
          id: n.id,
          portKeys: new Set((n.ports || []).map(p => `${p.placeableId}:${p.portName}`)),
        }));
      if (successors.length === 0) continue;
      for (const oid of orphanIds) {
        if (!oid.startsWith(typePrefix)) continue;
        const entry = stateMap.get(oid);
        if (entry == null) continue;
        const recorded = entry.__portKeys || [];
        const shares = [];
        let total = 0;
        for (const s of successors) {
          let overlap = 0;
          for (const k of recorded) if (s.portKeys.has(k)) overlap++;
          if (overlap > 0) { shares.push({ id: s.id, overlap }); total += overlap; }
        }
        for (const s of shares) {
          addShare(s.id, entry, s.overlap / total, intensiveFields);
          inheritedType.set(s.id, utilityType);
          inheritedNetwork.set(s.id, nets.find(n => n.id === s.id));
        }
        if (shares.length > 0) claimed.add(oid);
      }
    }

    for (const [netId, entry] of inherited) {
      // Reservoir contents are extensive but CAPPED. Summing on join is right
      // for a split-then-rejoin round trip (the halves add back up to what was
      // there), but joining two INDEPENDENTLY seeded loops — e.g. linking two
      // chillers, which line-drawing allows because source ports are exempt
      // from port_taken — produced up to N x RESERVOIR_MAX_L in one reservoir.
      // refillCost() then computed a negative `missing` and returned null, so
      // the Refill button vanished and the loop ran proportionally longer
      // between refills than the economy is tuned for. persistentStateDefaults
      // IS a full reservoir, so it doubles as the per-field ceiling.
      const descriptor = this.registry.types?.[inheritedType.get(netId)];
      const network = inheritedNetwork.get(netId);
      let bounded = entry;
      if (typeof descriptor?.boundPersistentState === 'function') {
        bounded = descriptor.boundPersistentState(entry, network) || entry;
      }
      const defaults = descriptor?.persistentStateDefaults;
      if (defaults && bounded === entry) {
        for (const [k, cap] of Object.entries(defaults)) {
          if (typeof cap === 'number' && typeof entry[k] === 'number' && entry[k] > cap) {
            entry[k] = cap;
          }
        }
      }
      stateMap.set(netId, bounded);
    }

    // (3) Prune orphans whose contents were copied out above. An orphan that
    // NO live network inherited had all of its lines deleted rather than
    // rerouted — dropping it immediately meant redrawing those lines re-minted
    // the network from persistentStateDefaults, i.e. a full reservoir for two
    // free clicks (utility lines cost nothing to add or remove, and a refill
    // is $5,760 of coolant / $24,000 of LHe at the UtilityInspector). Ids are
    // content-hashed from port membership, so holding the entry for a grace
    // window makes the redraw re-adopt the DRAINED state it left behind.
    for (const oid of orphanIds) {
      if (claimed.has(oid)) { stateMap.delete(oid); continue; }
      const entry = stateMap.get(oid);
      if (entry && typeof entry === 'object') {
        if (entry.__orphanedAt == null) entry.__orphanedAt = this.stats.solvePasses;
        if (this.stats.solvePasses - entry.__orphanedAt < ORPHAN_GRACE_PASSES) continue;
      }
      stateMap.delete(oid);
    }
  }
}

export default SolveRunner;
