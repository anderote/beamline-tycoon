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

/**
 * Build the default portLookup backed by state.placeables + COMPONENTS.
 * Phase 3 will add utility `ports` fields to the real components so this path
 * becomes productive; for now it's ready to be used when COMPONENTS is
 * extended.
 *
 * Returns a function with a `.listPorts(placeableId)` attachment used by
 * `discoverNetworks` to enumerate pass-through ports on a placeable.
 */
export function makeDefaultPortLookup(state) {
  const byId = new Map();
  for (const p of (state && state.placeables) || []) byId.set(p.id, p);
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
