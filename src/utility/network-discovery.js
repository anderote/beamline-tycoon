// src/utility/network-discovery.js
//
// Union-find over port keys to compute connected-component networks per
// utility type. Network IDs are a deterministic FNV-1a hash of the sorted
// port-key list — stable across ticks for unchanged topology.
//
// A port key is `${placeableId}:${portName}` — the stable identity of a port
// across a line's start/end references. Two ports end up in the same network
// iff a line connects them (directly or transitively).
//
// Port specs are resolved via an injected `portLookup(placeableId, portName)`
// function so tests can supply fake port tables without touching COMPONENTS.
// `makeDefaultPortLookup(state)` returns a runtime lookup that consults
// COMPONENTS; use it from Game.js once Phase 3 adds utility ports to real
// component defs.

import { COMPONENTS } from '../data/components.js';
import { UTILITY_TYPES } from './registry.js';
import { getPortSpec } from './ports.js';
import { expandPath } from './line-geometry.js';
import { listUtilityEndpoints } from './utility-endpoints.js';

function portKey(ref) { return `${ref.placeableId}:${ref.portName}`; }

// FNV-1a 32-bit hash. Keeps network ids 8 hex chars long — short but stable.
function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

class DSU {
  constructor() { this.parent = new Map(); }
  add(x) { if (!this.parent.has(x)) this.parent.set(x, x); }
  find(x) {
    this.add(x);
    let p = this.parent.get(x);
    while (p !== x) {
      const gp = this.parent.get(p);
      this.parent.set(x, gp);
      x = p;
      p = gp;
    }
    return x;
  }
  union(a, b) {
    this.add(a); this.add(b);
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

// ---------------------------------------------------------------------------
// Distribution buses.
//
// On-pipe components (role 'placement': cavities, quads, BPMs, cryomodules)
// are wired INDIVIDUALLY — that is the high-fidelity model and it is not
// negotiable. A FODO cell is a dozen quadrupoles, so without a bulk affordance
// the player draws a dozen identical stubs. A distribution bus is that
// affordance: a placeable that, once ONE line of its utility reaches it,
// stands in for the stub to every on-pipe sink of that utility it covers.
//
// Coverage is deliberately bounded twice:
//   1. ONE pipe segment — the segment carrying the nearest covered sink. A bus
//      never bridges two beamlines, so a facility with three pipes needs at
//      least three buses per utility.
//   2. A reach in grid cells (`params.serviceRadius` on the bus port, 1 cell =
//      2 m). Segments are arbitrarily long, so without a radius one bus would
//      answer a whole beamline and the placement question would evaporate.
// Together those are what make "how many buses, and where" the actual decision.
//
// The bus adds NO capacity: the sinks it covers land in the same network as
// the source feeding it, so the source still has to carry their total demand.
// ---------------------------------------------------------------------------

const DEFAULT_BUS_SERVICE_RADIUS = 8; // grid cells; ports normally declare it

function footprintSub(def, dir) {
  const subL = (def && def.subL) || 2;
  const subW = (def && def.subW) || 2;
  const d = ((((dir | 0) % 4) + 4) % 4);
  const rotated = (d === 1 || d === 3);
  return { col: rotated ? subL : subW, row: rotated ? subW : subL };
}

// Footprint center in GRID CELLS. Same formula as ports.portWorldPosition's
// cx/cz (which works in world units, 1 cell = 2), so a bus and a placement are
// measured from the same point. Placement records carry subCol/subRow of
// -footprint/2, which recenters them onto their pipe sample point.
function endpointCenter(rec, def) {
  const f = footprintSub(def, rec.dir || 0);
  return {
    col: (rec.col || 0) + ((rec.subCol || 0) + f.col / 2) * 0.25,
    row: (rec.row || 0) + ((rec.subRow || 0) + f.row / 2) * 0.25,
  };
}

/**
 * Which on-pipe sink ports each distribution bus covers.
 *
 * Pure: takes the flattened endpoint list (state.placeables + pipe placements,
 * i.e. listUtilityEndpoints) and a port-table lookup, so both discovery and
 * the unconnected-sink report can call it with their own lookup and agree.
 * Wiring is NOT considered here — a bus covers the same sinks whether or not
 * a line has reached it; callers decide what an unwired bus means.
 *
 * @param {Array<Placeable|PlacementRecord>} endpoints
 * @param {(type: string) => Object} getPorts  type → {portName: spec}
 * @param {(type: string) => Object} [getDef]  type → def (for subL/subW)
 * @returns {Map<string, Map<string, string[]>>} busId → utility → sorted port keys
 */
export function computeBusService(endpoints, getPorts, getDef = t => COMPONENTS[t]) {
  const out = new Map();
  if (!endpoints || typeof getPorts !== 'function') return out;

  const buses = [];       // { id, utility, radius, center }
  const pipeSinks = [];   // { portKey, utility, pipeId, center }
  const seenBus = new Set();
  for (const rec of endpoints) {
    if (!rec || !rec.id) continue;
    const ports = getPorts(rec.type) || {};
    let center = null;
    for (const [portName, spec] of Object.entries(ports)) {
      if (!spec || !spec.utility) continue;
      const isBus = !!spec.bus && spec.role === 'pass';
      const isPipeSink = spec.role === 'sink' && !!rec.isPlacement && !!rec.pipeId;
      if (!isBus && !isPipeSink) continue;
      if (center === null) center = endpointCenter(rec, getDef(rec.type));
      if (isBus) {
        // One bus node per (placeable, utility) — the four side ports are the
        // same electrical/hydraulic node, not four buses.
        const k = `${rec.id}|${spec.utility}`;
        if (seenBus.has(k)) continue;
        seenBus.add(k);
        buses.push({
          id: rec.id,
          utility: spec.utility,
          radius: (spec.params && spec.params.serviceRadius) || DEFAULT_BUS_SERVICE_RADIUS,
          center,
        });
      } else {
        pipeSinks.push({
          portKey: `${rec.id}:${portName}`,
          utility: spec.utility,
          pipeId: rec.pipeId,
          center,
        });
      }
    }
  }
  if (buses.length === 0 || pipeSinks.length === 0) return out;

  const EPS2 = 1e-9;
  for (const bus of buses) {
    const r2 = bus.radius * bus.radius;
    const inRange = [];
    for (const s of pipeSinks) {
      if (s.utility !== bus.utility) continue;
      const dc = s.center.col - bus.center.col;
      const dr = s.center.row - bus.center.row;
      const d2 = dc * dc + dr * dr;
      if (d2 > r2 + EPS2) continue;
      inRange.push({ portKey: s.portKey, pipeId: s.pipeId, d2 });
    }
    if (inRange.length === 0) continue;
    // The nearest covered sink picks the ONE segment this bus attaches to.
    // Ties break on pipe id then port key so the choice never depends on
    // endpoint enumeration order (network ids are hashed from it).
    let best = inRange[0];
    for (const c of inRange) {
      if (c.d2 < best.d2 - EPS2) { best = c; continue; }
      if (c.d2 > best.d2 + EPS2) continue;
      if (c.pipeId < best.pipeId
          || (c.pipeId === best.pipeId && c.portKey < best.portKey)) best = c;
    }
    const served = inRange
      .filter(c => c.pipeId === best.pipeId)
      .map(c => c.portKey)
      .sort();
    let perUtil = out.get(bus.id);
    if (!perUtil) { perUtil = new Map(); out.set(bus.id, perUtil); }
    perUtil.set(bus.utility, served);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Adjacency bridging.
//
// Components that physically touch share the utility with no line between them:
// power one quadrupole in a packed string and the whole string is powered, bolt
// a turbo onto a roughing pump and they are one pumping stack. The alternative
// is a stub per component even when the player has already expressed the
// connection by putting them against each other, which reads as busywork rather
// than as a decision.
//
// It is bounded three ways:
//   1. Per utility — descriptors opt in with `bridgesAdjacent`. RF and cryo do
//      not: a waveguide and a jacketed LHe line are real objects you have to
//      run, and pushing two cryostats together does not conjure one.
//   2. A cluster is inert until a line reaches it. Adjacency spreads a supply
//      that exists; it never invents one, and an unwired block of touching
//      components still reports every sink as unconnected.
//   3. A component that declares BOTH a source and a sink of the same utility
//      (every dataFiber device with data_in + data_out) is a boundary and never
//      bridges that utility — otherwise its own output would satisfy its own
//      input, and a rack of them would need no supply at all.
// ---------------------------------------------------------------------------

// Largest gap that still counts as touching, in sub-units (1 = 0.25 tile =
// 0.5 m). Flush contact is the intent; the slack is there so a placement that
// lands one sub-unit shy of its neighbour still reads as "next to it" to the
// player, who is looking at sprites rather than at footprint arithmetic.
export const ADJ_MAX_GAP_SUB = 1;

const ADJ_EPS = 1e-9;

// Footprint as a sub-unit AABB. Same origin convention as endpointCenter: an
// on-pipe placement carries subCol/subRow of -footprint/2, which recenters it
// onto its pipe sample point.
function endpointBox(rec, def) {
  const f = footprintSub(def, rec.dir || 0);
  const c0 = (rec.col || 0) * 4 + (rec.subCol || 0);
  const r0 = (rec.row || 0) * 4 + (rec.subRow || 0);
  return { c0, c1: c0 + f.col, r0, r1: r0 + f.row };
}

// Gap between two intervals: >0 apart, 0 flush, <0 overlapping.
function axisGap(a0, a1, b0, b1) {
  return Math.max(a0 - b1, b0 - a1);
}

function boxesAdjacent(a, b) {
  const gapC = axisGap(a.c0, a.c1, b.c0, b.c1);
  const gapR = axisGap(a.r0, a.r1, b.r0, b.r1);
  if (gapC > ADJ_MAX_GAP_SUB + ADJ_EPS || gapR > ADJ_MAX_GAP_SUB + ADJ_EPS) return false;
  // Corner contact is not adjacency — one axis has to genuinely overlap, or two
  // components meeting at a diagonal would count as bolted together.
  return gapC < -ADJ_EPS || gapR < -ADJ_EPS;
}

/**
 * Which endpoints each endpoint physically touches.
 *
 * Pure: takes the flattened endpoint list (listUtilityEndpoints) so discovery
 * and the unconnected-sink report can build the same graph. Utility types are
 * not consulted here — this is geometry; who bridges over it is decided by the
 * caller.
 *
 * @returns {Map<string, string[]>} endpoint id → touching ids, sorted
 */
export function computeAdjacency(endpoints, getDef = t => COMPONENTS[t]) {
  const out = new Map();
  const entries = [];
  for (const rec of endpoints || []) {
    if (!rec || !rec.id) continue;
    entries.push({ id: rec.id, box: endpointBox(rec, getDef(rec.type)) });
  }
  // Bucket by tile column so a facility with hundreds of endpoints doesn't cost
  // a full pairwise sweep on every topology change.
  const buckets = new Map();
  for (const e of entries) {
    const from = Math.floor((e.box.c0 - ADJ_MAX_GAP_SUB) / 4);
    const to = Math.floor((e.box.c1 + ADJ_MAX_GAP_SUB) / 4);
    for (let t = from; t <= to; t++) {
      let arr = buckets.get(t);
      if (!arr) { arr = []; buckets.set(t, arr); }
      arr.push(e);
    }
  }
  const link = (a, b) => {
    let arr = out.get(a);
    if (!arr) { arr = []; out.set(a, arr); }
    if (!arr.includes(b)) arr.push(b);
  };
  for (const arr of buckets.values()) {
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        if (arr[i].id === arr[j].id) continue;
        if (!boxesAdjacent(arr[i].box, arr[j].box)) continue;
        link(arr[i].id, arr[j].id);
        link(arr[j].id, arr[i].id);
      }
    }
  }
  for (const arr of out.values()) arr.sort();
  return out;
}

/**
 * The port keys `placeableId` contributes to an adjacency cluster of
 * `utilityType`, or [] when it does not bridge: it carries no port of that
 * utility, or it is a converter (source AND sink of the same utility).
 */
function bridgeablePortKeys(listPorts, placeableId, utilityType) {
  const ports = (listPorts(placeableId) || [])
    .filter(({ spec }) => spec && spec.utility === utilityType);
  if (ports.length === 0) return [];
  const roles = new Set(ports.map(({ spec }) => spec.role));
  if (roles.has('source') && roles.has('sink')) return [];
  return ports.map(({ name }) => `${placeableId}:${name}`);
}

/**
 * Build the default portLookup backed by COMPONENTS and every utility
 * endpoint in the world — state.placeables AND the components living on beam
 * pipes (see utility-endpoints.js). Indexing placeables alone hid the sink
 * ports of every role:'placement' module, which is where all cryoTransfer
 * sinks and most rfWaveguide sinks live.
 *
 * Returns a function with three attachments used by `discoverNetworks`:
 * `.listPorts(placeableId)` enumerates a placeable's ports,
 * `.busTargets(placeableId, utilityType)` reports the on-pipe sink port keys a
 * distribution bus covers (see computeBusService), and `.neighbors(placeableId)`
 * reports the endpoints it physically touches (see computeAdjacency).
 */
export function makeDefaultPortLookup(state) {
  const endpoints = listUtilityEndpoints(state);
  const byId = new Map();
  for (const e of endpoints) byId.set(e.id, e);
  const busService = computeBusService(
    endpoints, t => (COMPONENTS[t] && COMPONENTS[t].ports) || null);
  const adjacency = computeAdjacency(endpoints);
  const lookup = function (placeableId, portName) {
    const placeable = byId.get(placeableId);
    if (!placeable) return null;
    const def = COMPONENTS[placeable.type];
    return getPortSpec(def, portName);
  };
  lookup.listPorts = function (placeableId) {
    const placeable = byId.get(placeableId);
    if (!placeable) return [];
    const def = COMPONENTS[placeable.type];
    if (!def || !def.ports) return [];
    return Object.entries(def.ports).map(([name, spec]) => ({ name, spec }));
  };
  lookup.busTargets = function (placeableId, utilityType) {
    const perUtil = busService.get(placeableId);
    return (perUtil && perUtil.get(utilityType)) || [];
  };
  lookup.neighbors = function (placeableId) {
    return adjacency.get(placeableId) || [];
  };
  return lookup;
}

/**
 * Discover networks for a single utility type.
 *
 * Pass-through ports on the same placeable (same utility type) are
 * auto-united so that a distribution panel's input and output end up in the
 * same network without requiring an explicit line between them.
 *
 * @param {string} utilityType
 * @param {Iterable<UtilityLine>} lines
 * @param {((placeableId: string, portName: string) => PortSpec | null) &
 *         { listPorts?: (placeableId: string) => Array<{name: string, spec: PortSpec}> }
 *        } portLookup
 * @returns {Array<Network>}
 */
export function discoverNetworks(utilityType, lines, portLookup) {
  const dsu = new DSU();
  const allPortKeys = new Set();
  const lineArr = [];
  const touchedPlaceables = new Set();
  // placeableId → one port key a line actually landed on. Adjacency bridging
  // anchors to THAT key rather than to any same-utility port of the placeable,
  // so a device with two independent ports of this utility doesn't get its two
  // sides shorted together by a bridge.
  const touchedAnchor = new Map();
  const lineNodeKey = id => `line:${id}`;

  // Collect same-type lines. Each line becomes a node in the DSU so that
  // lines with null endpoints still participate (spatial union below ties
  // them together when they share subtiles).
  const iter = lines && typeof lines.values === 'function' ? lines.values() : (lines || []);
  for (const line of iter) {
    if (!line || line.utilityType !== utilityType) continue;
    lineArr.push(line);
    const ln = lineNodeKey(line.id);
    dsu.add(ln);
    if (line.start) {
      const a = portKey(line.start);
      allPortKeys.add(a);
      dsu.union(ln, a);
      touchedPlaceables.add(line.start.placeableId);
      if (!touchedAnchor.has(line.start.placeableId)) touchedAnchor.set(line.start.placeableId, a);
    }
    if (line.end) {
      const b = portKey(line.end);
      allPortKeys.add(b);
      dsu.union(ln, b);
      touchedPlaceables.add(line.end.placeableId);
      if (!touchedAnchor.has(line.end.placeableId)) touchedAnchor.set(line.end.placeableId, b);
    }
  }

  // Spatial union: lines that meet END-ON merge. A run that ENDS on another
  // run is a tee — the two are one network. A run that CROSSES another mid-span
  // is not: one passes over the other, and merging them would silently wire
  // together two networks that only happen to share a floor tile.
  //
  // Line-drawing enforces the same distinction geometrically (a crossing must
  // be perpendicular and interior to both; an end-on contact is legal only for
  // a utility that allows taps), so by the time geometry reaches here, an
  // endpoint contact is always a deliberate join.
  const subtileToLines = new Map();
  for (const line of lineArr) {
    const expanded = expandPath(line.path || []);
    for (let i = 0; i < expanded.length; i++) {
      const pt = expanded[i];
      const key = `${Math.round(pt.col * 4)}/${Math.round(pt.row * 4)}`;
      let arr = subtileToLines.get(key);
      if (!arr) { arr = []; subtileToLines.set(key, arr); }
      arr.push({ id: line.id, terminal: i === 0 || i === expanded.length - 1 });
    }
  }
  for (const hits of subtileToLines.values()) {
    if (hits.length < 2) continue;
    for (let a = 0; a < hits.length; a++) {
      for (let b = a + 1; b < hits.length; b++) {
        if (hits[a].id === hits[b].id) continue;
        // At least one of the two has to END here for this to be a join.
        if (!hits[a].terminal && !hits[b].terminal) continue;
        dsu.union(lineNodeKey(hits[a].id), lineNodeKey(hits[b].id));
      }
    }
  }

  // For every placeable that a line touches, unite all of its pass-through
  // ports that carry this utility — they're logically continuous within the
  // device (a distribution panel, manifold, switch, etc.). Also pull those
  // extra port keys into allPortKeys so they show up in the final network.
  if (portLookup && typeof portLookup.listPorts === 'function') {
    for (const pid of touchedPlaceables) {
      const ports = portLookup.listPorts(pid) || [];
      const passNames = [];
      const sourceNames = [];
      for (const { name, spec } of ports) {
        if (!spec) continue;
        if (spec.utility !== utilityType) continue;
        if (spec.role === 'pass') passNames.push(name);
        else if (spec.role === 'source') sourceNames.push(name);
      }
      // Pass-through ports: logically continuous within the device.
      if (passNames.length >= 2) {
        const keys = passNames.map(n => `${pid}:${n}`);
        for (const k of keys) allPortKeys.add(k);
        for (let i = 1; i < keys.length; i++) dsu.union(keys[0], keys[i]);
      }
      // A multi-outlet device is ONE busbar, not N independent supplies. The
      // four sockets on a distribution panel are the same bar behind the
      // faceplate, so they share one network and one rating — each outlet
      // declares rating/N and uniting them here is what adds back up to the
      // panel's rating. Without this a 4-way panel would read as four separate
      // full-rating supplies and quadruple the facility's capacity.
      if (sourceNames.length >= 2) {
        const keys = sourceNames.map(n => `${pid}:${n}`);
        for (const k of keys) allPortKeys.add(k);
        for (let i = 1; i < keys.length; i++) dsu.union(keys[0], keys[i]);
      }
    }
  }

  // Distribution buses: a bus that a line of this utility actually reaches
  // pulls every on-pipe sink it covers into the same network, so one run
  // serves a whole cell instead of one stub per component. An unwired bus is
  // absent from touchedPlaceables and therefore inert.
  if (portLookup && typeof portLookup.busTargets === 'function'
      && typeof portLookup.listPorts === 'function') {
    for (const pid of touchedPlaceables) {
      const busNames = (portLookup.listPorts(pid) || [])
        .filter(({ spec }) => spec && spec.bus && spec.role === 'pass'
                              && spec.utility === utilityType)
        .map(({ name }) => name);
      if (busNames.length === 0) continue;
      const targets = portLookup.busTargets(pid, utilityType) || [];
      if (targets.length === 0) continue;
      const anchor = `${pid}:${busNames[0]}`;
      allPortKeys.add(anchor);
      for (const n of busNames) {
        const k = `${pid}:${n}`;
        allPortKeys.add(k);
        dsu.union(anchor, k);
      }
      for (const t of targets) {
        allPortKeys.add(t);
        dsu.union(anchor, t);
      }
    }
  }

  // Adjacency bridging: from every placeable a line reaches, flood out over
  // touching components and pull their ports of this utility into the same
  // network. Seeded from touchedPlaceables only, so a cluster no line reaches
  // stays out of the DSU entirely and is still reported unconnected.
  if (UTILITY_TYPES[utilityType] && UTILITY_TYPES[utilityType].bridgesAdjacent
      && portLookup && typeof portLookup.neighbors === 'function'
      && typeof portLookup.listPorts === 'function') {
    const keysOf = (pid) => bridgeablePortKeys(
      (id) => portLookup.listPorts(id), pid, utilityType);
    const visited = new Set();
    // Sorted so the cluster anchor doesn't depend on line iteration order —
    // network ids hash the port-key set, which must be stable across ticks.
    for (const seed of Array.from(touchedPlaceables).sort()) {
      if (visited.has(seed)) continue;
      const seedKeys = keysOf(seed);
      if (seedKeys.length === 0) continue;   // converter, or carries no such port
      const anchor = touchedAnchor.get(seed) || seedKeys[0];
      const queue = [seed];
      visited.add(seed);
      while (queue.length > 0) {
        const cur = queue.shift();
        for (const k of keysOf(cur)) {
          allPortKeys.add(k);
          dsu.union(anchor, k);
        }
        for (const nb of portLookup.neighbors(cur)) {
          if (visited.has(nb) || keysOf(nb).length === 0) continue;
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
  }

  // Group by root. Port keys and line-node keys may collide into the same
  // group. Lines without port anchors (fully open) still produce a group
  // (inert, solved as a no-op).
  const groups = new Map();
  for (const k of allPortKeys) {
    const r = dsu.find(k);
    if (!groups.has(r)) groups.set(r, { portKeys: new Set(), lineIds: [] });
    groups.get(r).portKeys.add(k);
  }
  for (const line of lineArr) {
    const r = dsu.find(lineNodeKey(line.id));
    if (!groups.has(r)) groups.set(r, { portKeys: new Set(), lineIds: [] });
    groups.get(r).lineIds.push(line.id);
  }

  const networks = [];
  for (const g of groups.values()) {
    if (g.portKeys.size === 0 && g.lineIds.length === 0) continue;
    const sortedKeys = Array.from(g.portKeys).sort();
    // Networks with at least one port derive their ID from sorted port keys
    // (stable across topology changes that don't disturb port membership).
    // Fully open-ended networks derive from sorted line IDs so they still
    // have a stable handle for persistent state.
    const idSeed = sortedKeys.length > 0
      ? sortedKeys.join('|')
      : 'open:' + g.lineIds.slice().sort().join('|');
    const id = `net_${utilityType}_${hashString(idSeed)}`;
    const ports = [];
    const sources = [];
    const sinks = [];
    for (const k of sortedKeys) {
      const idx = k.indexOf(':');
      const placeableId = k.slice(0, idx);
      const portName = k.slice(idx + 1);
      const spec = portLookup(placeableId, portName);
      if (!spec) continue;
      const entry = {
        placeableId,
        portName,
        role: spec.role || 'pass',
        params: spec.params || {},
      };
      ports.push(entry);
      if (spec.role === 'source') {
        sources.push({
          portKey: k,
          placeableId,
          portName,
          capacity: (spec.params && spec.params.capacity) || 0,
          params: spec.params || {},
        });
      } else if (spec.role === 'sink') {
        sinks.push({
          portKey: k,
          placeableId,
          portName,
          demand: (spec.params && spec.params.demand) || 0,
          params: spec.params || {},
        });
      }
    }
    networks.push({ id, utilityType, lineIds: g.lineIds, ports, sources, sinks });
  }
  return networks;
}

/**
 * Report sink ports on `placeables` that no line of their utility touches.
 * The solver only sees networks that have lines — a sink with zero incident
 * lines never appears in any network — so "unconnected" is a topology fact
 * that has to come from here, not from solve results.
 *
 * `getPorts(placeableType)` returns the `{portName: spec}` table for a
 * component type (e.g. getUtilityPortsV2). Order of the returned reports is
 * utility-major, then placeable order, then port-table order.
 *
 * `placeables` must be the flattened endpoint list (listUtilityEndpoints), not
 * state.placeables: on-pipe placements are where most sinks live, and it is
 * also what computeBusService needs to resolve bus coverage.
 *
 * @param {Array<Placeable>} placeables
 * @param {Iterable<UtilityLine>|Map} utilityLines
 * @param {(placeableType: string) => Object} getPorts
 * @param {string[]} utilities - utility types to check
 * @returns {Array<{placeableId, placeableType, portName, utility}>}
 */
export function findUnconnectedSinks(placeables, utilityLines, getPorts, utilities) {
  const wanted = new Set(utilities);
  const connected = new Set(); // `${utilityType}|${placeableId}:${portName}`
  const iter = utilityLines && typeof utilityLines.values === 'function'
    ? utilityLines.values() : (utilityLines || []);
  for (const line of iter) {
    if (!line || !wanted.has(line.utilityType)) continue;
    if (line.start) connected.add(`${line.utilityType}|${portKey(line.start)}`);
    if (line.end) connected.add(`${line.utilityType}|${portKey(line.end)}`);
  }

  // A distribution bus that a line has actually reached stands in for the
  // per-component stub to every on-pipe sink it covers — otherwise the gate
  // would keep reporting sinks the solver is already serving through the bus,
  // and the bus would buy the player nothing.
  const typeById = new Map();
  for (const p of placeables || []) if (p && p.id) typeById.set(p.id, p.type);

  const busService = computeBusService(placeables, getPorts);
  if (busService.size > 0) {
    for (const [busId, perUtil] of busService) {
      const ports = getPorts(typeById.get(busId)) || {};
      for (const [util, servedKeys] of perUtil) {
        if (!wanted.has(util)) continue;
        const wired = Object.entries(ports).some(([portName, spec]) =>
          spec && spec.bus && spec.role === 'pass' && spec.utility === util
          && connected.has(`${util}|${busId}:${portName}`));
        if (!wired) continue;
        for (const k of servedKeys) connected.add(`${util}|${k}`);
      }
    }
  }

  // Adjacency bridging, mirrored from discoverNetworks: a sink the solver is
  // already feeding through a bridge must not be reported unconnected, or the
  // gate would trip the beam on a component that is demonstrably running (and
  // the pin markers would sit over it forever).
  const adjacency = computeAdjacency(placeables);
  const listPortsFor = (id) => Object.entries(getPorts(typeById.get(id)) || {})
    .map(([name, spec]) => ({ name, spec }));
  for (const util of utilities) {
    if (!(UTILITY_TYPES[util] && UTILITY_TYPES[util].bridgesAdjacent)) continue;
    const keysOf = (pid) => bridgeablePortKeys(listPortsFor, pid, util);
    const visited = new Set();
    const queue = [];
    for (const p of placeables || []) {
      if (!p || !p.id || visited.has(p.id)) continue;
      if (keysOf(p.id).some(k => connected.has(`${util}|${k}`))) {
        visited.add(p.id);
        queue.push(p.id);
      }
    }
    while (queue.length > 0) {
      const cur = queue.shift();
      for (const k of keysOf(cur)) connected.add(`${util}|${k}`);
      for (const nb of adjacency.get(cur) || []) {
        if (visited.has(nb) || keysOf(nb).length === 0) continue;
        visited.add(nb);
        queue.push(nb);
      }
    }
  }

  const out = [];
  for (const util of utilities) {
    for (const p of placeables || []) {
      const ports = getPorts(p.type) || {};
      for (const [portName, spec] of Object.entries(ports)) {
        if (!spec || spec.utility !== util || spec.role !== 'sink') continue;
        if (!connected.has(`${util}|${p.id}:${portName}`)) {
          out.push({ placeableId: p.id, placeableType: p.type, portName, utility: util });
        }
      }
    }
  }
  return out;
}

/**
 * Discover networks for every utility type in `utilityTypeList`, returning a
 * Map<utilityType, Array<Network>>. Lines of other types are filtered out
 * per-type by `discoverNetworks`.
 */
export function discoverAll(utilityLines, portLookup, utilityTypeList) {
  const out = new Map();
  for (const utilityType of utilityTypeList) {
    out.set(utilityType, discoverNetworks(utilityType, utilityLines, portLookup));
  }
  return out;
}
