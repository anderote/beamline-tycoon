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

/**
 * Build the default portLookup backed by COMPONENTS and every utility
 * endpoint in the world — state.placeables AND the components living on beam
 * pipes (see utility-endpoints.js). Indexing placeables alone hid the sink
 * ports of every role:'placement' module, which is where all cryoTransfer
 * sinks and most rfWaveguide sinks live.
 *
 * Returns a function with two attachments used by `discoverNetworks`:
 * `.listPorts(placeableId)` enumerates a placeable's ports, and
 * `.busTargets(placeableId, utilityType)` reports the on-pipe sink port keys a
 * distribution bus covers (see computeBusService).
 */
export function makeDefaultPortLookup(state) {
  const endpoints = listUtilityEndpoints(state);
  const byId = new Map();
  for (const e of endpoints) byId.set(e.id, e);
  const busService = computeBusService(
    endpoints, t => (COMPONENTS[t] && COMPONENTS[t].ports) || null);
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
    }
    if (line.end) {
      const b = portKey(line.end);
      allPortKeys.add(b);
      dsu.union(ln, b);
      touchedPlaceables.add(line.end.placeableId);
    }
  }

  // Spatial union: lines that share ANY subtile (0.25-precision) merge. This
  // handles line-to-line joins (a trunk running past a branch) regardless of
  // whether either endpoint is a port or an open end.
  const subtileToLines = new Map();
  for (const line of lineArr) {
    const expanded = expandPath(line.path || []);
    for (const pt of expanded) {
      const key = `${Math.round(pt.col * 4)}/${Math.round(pt.row * 4)}`;
      let arr = subtileToLines.get(key);
      if (!arr) { arr = []; subtileToLines.set(key, arr); }
      arr.push(line.id);
    }
  }
  for (const ids of subtileToLines.values()) {
    if (ids.length < 2) continue;
    const first = lineNodeKey(ids[0]);
    for (let i = 1; i < ids.length; i++) dsu.union(first, lineNodeKey(ids[i]));
  }

  // For every placeable that a line touches, unite all of its pass-through
  // ports that carry this utility — they're logically continuous within the
  // device (a distribution panel, manifold, switch, etc.). Also pull those
  // extra port keys into allPortKeys so they show up in the final network.
  if (portLookup && typeof portLookup.listPorts === 'function') {
    for (const pid of touchedPlaceables) {
      const ports = portLookup.listPorts(pid) || [];
      const passNames = [];
      for (const { name, spec } of ports) {
        if (!spec) continue;
        if (spec.utility !== utilityType) continue;
        if (spec.role === 'pass') passNames.push(name);
      }
      if (passNames.length < 2) continue;
      const keys = passNames.map(n => `${pid}:${n}`);
      for (const k of keys) allPortKeys.add(k);
      for (let i = 1; i < keys.length; i++) dsu.union(keys[0], keys[i]);
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
  const busService = computeBusService(placeables, getPorts);
  if (busService.size > 0) {
    const typeById = new Map();
    for (const p of placeables || []) if (p && p.id) typeById.set(p.id, p.type);
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
