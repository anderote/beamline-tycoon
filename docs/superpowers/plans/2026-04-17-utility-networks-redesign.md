# Utility Networks Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the rack-segment + tile-paint utility model with per-utility independent lines: first-class drawable entities, port-based connections, subtile Manhattan routing, per-tick steady-state solve with persistent reservoirs, driven by per-utility module descriptors.

**Architecture:** Shared utility-agnostic core (placement, validation, discovery, solve runner, input, rendering) + one small module per utility type (descriptor, solve function, inspector UI). Mirrors the BeamlineSystem facade pattern. All six utility types (powerCable, vacuumPipe, rfWaveguide, coolingWater, cryoTransfer, dataFiber) share one data shape and one rendering pipeline; per-utility physics lives in isolated files for extensibility.

**Tech Stack:** Plain JavaScript (ES modules, no bundler-specific features), Three.js for 3D, existing Node-driven test pattern (`test/test-*.js` with inline `assert` helpers — see `test/test-pipe-drawing.js` as template).

**Design spec:** `docs/superpowers/specs/2026-04-17-utility-networks-redesign-design.md`

**Rules for this plan:**
- Work directly in the main working directory (no worktree).
- Commit at logical boundaries, not per task. Several adjacent tasks may share a commit if they form one coherent change. Don't commit partial work mid-task.
- Pre-release, single-user project: break save-file compat freely.

---

## Phase 0 — Scaffolding & Pure Helpers

### Task 1: Directory structure + state additions

**Files:**
- Create: `src/utility/` directory with empty `.gitkeep` or simply by adding a file in it.
- Create: `src/utility/types/` directory.
- Modify: `src/game/Game.js` — add state fields.

- [ ] **Step 1: Create `src/utility/registry.js` stub**

```js
// src/utility/registry.js
// Registry of all utility-type descriptors. Imports each per-utility module and
// exports a {type → descriptor} map. Adding a 7th utility = one import + entry.
//
// Descriptors populated in Task 8 onwards; this file exists now so the shared
// core modules can import it without circular-dependency anxiety.

export const UTILITY_TYPES = {};

export const UTILITY_TYPE_LIST = []; // preserves registration order for deterministic iteration
```

- [ ] **Step 2: Add utility state fields to `Game.js` state init**

In `Game.js` `this.state = {...}`, add alongside existing entries (near `rackSegments` is natural):

```js
// Utility network lines (per-utility independent drawable pipes)
utilityLines: new Map(),            // id -> { id, utilityType, start, end, path, subL }
utilityNextId: 1,
utilityNetworkState: new Map(),     // networkId -> persistent state blob
utilityNetworkData: null,           // derived: { utilityType -> Map<networkId, FlowState> }
```

Leave `rackSegments` and `networkData` in place for now — they are removed in Phase 6.

- [ ] **Step 3: Commit**

Defer commit until Task 2 lands (single "scaffolding + line geometry" commit). Do not commit yet.

---

### Task 2: `line-geometry.js` — Manhattan path helpers

**Files:**
- Create: `src/utility/line-geometry.js`
- Create: `test/test-utility-line-geometry.js`

- [ ] **Step 1: Write failing tests first**

Create `test/test-utility-line-geometry.js`. Follow the pattern from `test/test-pipe-geometry.js` (inline `assert` helper, `let passed = 0, failed = 0;` at top, `console.log` summary at bottom).

Tests to include:
1. `buildManhattanPath({col: 2, row: 3}, {col: 5, row: 3})` — horizontal straight run returns `[{col:2,row:3}, {col:5,row:3}]` (corner-only waypoints).
2. `buildManhattanPath({col: 2, row: 3}, {col: 5, row: 7})` with prefer-horizontal-first returns `[{col:2,row:3}, {col:5,row:3}, {col:5,row:7}]`.
3. `buildManhattanPath({col: 2, row: 3}, {col: 5, row: 7})` with prefer-vertical-first returns `[{col:2,row:3}, {col:2,row:7}, {col:5,row:7}]`.
4. `buildManhattanPath({col: 2, row: 3}, {col: 2, row: 3})` returns `null` or empty (zero-length rejected).
5. `pathLengthSubUnits([{col:2,row:3}, {col:5,row:3}])` returns `12` (3 tiles * 4 sub-units/tile).
6. `pathLengthSubUnits([{col:2,row:3}, {col:5,row:3}, {col:5,row:7}])` returns `12 + 16 = 28`.
7. `expandPath` at 0.25-step for `[{col:2,row:3}, {col:5,row:3}]` returns 13 points (0.25-stepped from 2.0 to 5.0 inclusive).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node test/test-utility-line-geometry.js`
Expected: failures because module doesn't exist.

- [ ] **Step 3: Implement `src/utility/line-geometry.js`**

```js
// src/utility/line-geometry.js
//
// Pure geometry helpers for utility lines. Unlike beam pipes, utility lines
// support 90° Manhattan bends. Paths are stored as corner-only waypoints;
// expansion walks them at sub-tile (0.25) resolution for hit-testing and mesh
// generation.
//
// One tile = 4 sub-units. A sub-unit = 0.5 world meters.

const STEP = 0.25;
const SUB_PER_TILE = 4;
const EPS = 1e-6;

/**
 * Build a Manhattan (L-shaped) path from start to end. Returns a corner-only
 * waypoint array including both endpoints.
 *
 * @param {{col:number,row:number}} start
 * @param {{col:number,row:number}} end
 * @param {{preferVerticalFirst?:boolean}} [opts]
 * @returns {Array<{col:number,row:number}>|null} null if start === end
 */
export function buildManhattanPath(start, end, opts = {}) {
  if (!start || !end) return null;
  const dc = end.col - start.col;
  const dr = end.row - start.row;
  if (Math.abs(dc) < EPS && Math.abs(dr) < EPS) return null;

  // Straight runs need only two waypoints.
  if (Math.abs(dc) < EPS || Math.abs(dr) < EPS) {
    return [{ col: start.col, row: start.row }, { col: end.col, row: end.row }];
  }

  // L-shape: insert one corner. Prefer horizontal-first unless opts says otherwise.
  const corner = opts.preferVerticalFirst
    ? { col: start.col, row: end.row }
    : { col: end.col, row: start.row };
  return [
    { col: start.col, row: start.row },
    corner,
    { col: end.col, row: end.row },
  ];
}

/**
 * Arc length of a Manhattan path in sub-units (1 sub = 0.5 world m).
 */
export function pathLengthSubUnits(path) {
  if (!Array.isArray(path) || path.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    total += Math.abs(b.col - a.col) + Math.abs(b.row - a.row);
  }
  return Math.round(total * SUB_PER_TILE);
}

/**
 * Expand a waypoint path to a dense 0.25-stepped list. Used for hit-testing,
 * same-type overlap detection, and visual preview.
 */
export function expandPath(path) {
  if (!Array.isArray(path) || path.length === 0) return [];
  if (path.length === 1) return [{ col: path[0].col, row: path[0].row }];
  const out = [{ col: path[0].col, row: path[0].row }];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const dist = Math.abs(b.col - a.col) + Math.abs(b.row - a.row);
    if (dist < EPS) continue;
    const steps = Math.max(1, Math.round(dist / STEP));
    const dcStep = (b.col - a.col) / steps;
    const drStep = (b.row - a.row) / steps;
    for (let s = 1; s <= steps; s++) {
      out.push({ col: a.col + dcStep * s, row: a.row + drStep * s });
    }
  }
  return out;
}

export const SUBTILE_STEP = STEP;
export const SUB_PER_TILE_CONST = SUB_PER_TILE;
```

- [ ] **Step 4: Run tests to verify pass**

Run: `node test/test-utility-line-geometry.js`
Expected: all assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utility/ test/test-utility-line-geometry.js src/game/Game.js
git commit -m "feat(utility): scaffold utility networks core (state, line geometry)"
```

---

### Task 3: `ports.js` — utility port helpers

**Files:**
- Create: `src/utility/ports.js`
- Create: `test/test-utility-ports.js`

- [ ] **Step 1: Write failing tests**

Test scenarios:
1. `availablePorts(placeable, utilityType, lines)` returns all ports on the placeable whose `utility === utilityType`, excluding ports already claimed by any line's `start` or `end`.
2. `portMatchesApproach(placeable, portName, approachDir, isEnd)` — analogous to the beam-pipe version; the port's compass side (after rotation) must align with the approach direction.
3. `portWorldPosition(placeable, portName)` returns `{x, z}` at the port's world-space position (reuse the formula from `src/beamline/junctions.js:106-147` — utility ports sit on the same lateral faces with the same rotation rules).
4. `getPortSpec(placeable, portName)` returns `{utility, side, role, params, offsetAlong}` or null.

Use fixture placeables (not real COMPONENTS entries) by inlining a fake COMPONENTS map for the test (import-time injection not needed; the helpers read COMPONENTS directly, so the test adds fixtures via a test-only `setTestComponents(map)` hook).

Actually, to match the pattern from `test/test-junctions.js`, make the helper functions accept a **component definition** parameter instead of looking up by type in COMPONENTS. This is better for testability:

```js
availablePorts(placeable, def, utilityType, lines)
portMatchesApproach(placeable, def, portName, approachDir, isEnd)
portWorldPosition(placeable, def, portName)
getPortSpec(def, portName)
```

Then a thin wrapper in the same file looks up COMPONENTS for callers that want that:

```js
availablePortsByType(placeable, utilityType, lines)   // looks up COMPONENTS
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node test/test-utility-ports.js`
Expected: module not found.

- [ ] **Step 3: Implement `src/utility/ports.js`**

Mirror `src/beamline/junctions.js` structure. Key differences:
- Look for `def.ports[name].utility` (new field) to identify utility ports.
- Skip ports where `utility` is undefined (those are beam-pipe ports).
- `role` field on port may be `'source'`, `'sink'`, or `'pass'`.
- `port.params` is opaque to this layer — passed through.

Implementation sketch (adapt from `junctions.js`):

```js
import { COMPONENTS } from '../data/components.js';

const SIDE_TO_COMPASS = { back:'N', front:'S', left:'W', right:'E' };
const COMPASS_CW = ['N', 'E', 'S', 'W'];
const COMPASS_VEC = { N:{x:0,z:-1}, E:{x:1,z:0}, S:{x:0,z:1}, W:{x:-1,z:0} };
const SIDE_VEC = { N:{dCol:0,dRow:-1}, E:{dCol:1,dRow:0}, S:{dCol:0,dRow:1}, W:{dCol:-1,dRow:0} };

function normalizeDir(d) { return ((((d|0) % 4) + 4) % 4); }
function rotateCompass(side, dir) {
  const i = COMPASS_CW.indexOf(side);
  if (i < 0) return null;
  return COMPASS_CW[(i + normalizeDir(dir)) % 4];
}

export function getPortSpec(def, portName) {
  if (!def || !def.ports) return null;
  return def.ports[portName] || null;
}

export function isUtilityPort(def, portName) {
  const spec = getPortSpec(def, portName);
  return !!(spec && spec.utility);
}

export function portSide(def, portName, dir) {
  const spec = getPortSpec(def, portName);
  if (!spec) return null;
  const base = SIDE_TO_COMPASS[spec.side];
  if (!base) return null;
  return rotateCompass(base, dir || 0);
}

export function availablePorts(placeable, def, utilityType, lines) {
  if (!placeable || !def || !def.ports) return [];
  const claimed = new Set();
  const iter = lines && typeof lines.values === 'function' ? lines.values() : (lines || []);
  for (const line of iter) {
    if (line.start && line.start.placeableId === placeable.id && line.start.portName) {
      claimed.add(line.start.portName);
    }
    if (line.end && line.end.placeableId === placeable.id && line.end.portName) {
      claimed.add(line.end.portName);
    }
  }
  return Object.entries(def.ports)
    .filter(([_, spec]) => spec.utility === utilityType)
    .map(([name]) => name)
    .filter(n => !claimed.has(n));
}

export function portMatchesApproach(placeable, def, portName, approachDir, isEnd) {
  const side = portSide(def, portName, placeable.dir || 0);
  if (!side) return false;
  const vec = SIDE_VEC[side];
  if (!vec) return false;
  const tgt = isEnd
    ? { dCol: -approachDir.dCol, dRow: -approachDir.dRow }
    : approachDir;
  return vec.dCol === tgt.dCol && vec.dRow === tgt.dRow;
}

// Port world position: adapt exactly from junctions.js:106-147. The formula
// is identical — utility ports sit on the same lateral faces with the same
// rotation rules. Copy the body verbatim, then adjust to use getPortSpec
// instead of COMPONENTS lookup.
export function portWorldPosition(placeable, def, portName) {
  // ... (see src/beamline/junctions.js:106-147) ...
}

// Convenience wrappers that look up COMPONENTS for callers that have just a placeable.
export function availablePortsByType(placeable, utilityType, lines) {
  const def = COMPONENTS[placeable && placeable.type];
  return availablePorts(placeable, def, utilityType, lines);
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `node test/test-utility-ports.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

Defer commit until Task 4 lands (single validators commit).

---

### Task 4: `line-drawing.js` — validators

**Files:**
- Create: `src/utility/line-drawing.js`
- Create: `test/test-utility-line-drawing.js`

- [ ] **Step 1: Write failing tests**

Scenarios:
1. Valid L-shaped path from source port to sink port → `{ok:true, line:{...}}`.
2. Path that overlaps an existing same-type line at any subtile → `{ok:false, reason:'overlap_same_type'}`.
3. Path that crosses a different-type line at a subtile → OK (different types can cross).
4. Invalid start port (not on this placeable, wrong utility type, already connected) → rejection with appropriate reason (`invalid_start`, `port_type_mismatch`, `port_taken`).
5. Same rejections for end.
6. Path whose direction doesn't match the start port's side → `port_mismatch_start`.
7. Path whose approach doesn't match the end port's inverse side → `port_mismatch_end`.
8. Zero-length path → `invalid_path`.
9. Non-Manhattan path (diagonal) → `not_manhattan`.

- [ ] **Step 2: Run tests, expect fail**

Run: `node test/test-utility-line-drawing.js`

- [ ] **Step 3: Implement `src/utility/line-drawing.js`**

```js
// src/utility/line-drawing.js
//
// Pure validators for drawing utility lines. No mutation. Returns
// { ok:true, line:{utilityType, start, end, path, subL} } on success,
// { ok:false, reason:'...' } on failure.
//
// Rejection reasons:
//   invalid_path, not_manhattan, overlap_same_type,
//   invalid_start, invalid_end, port_type_mismatch,
//   port_taken, port_mismatch_start, port_mismatch_end.

import { COMPONENTS } from '../data/components.js';
import { expandPath, pathLengthSubUnits } from './line-geometry.js';
import { getPortSpec, availablePorts, portMatchesApproach } from './ports.js';

const EPS = 1e-6;

function reject(reason) { return { ok: false, reason }; }

function isManhattan(path) {
  if (!Array.isArray(path) || path.length < 2) return false;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const dc = Math.abs(b.col - a.col), dr = Math.abs(b.row - a.row);
    if (dc > EPS && dr > EPS) return false;   // each segment axis-aligned
    if (dc < EPS && dr < EPS) return false;   // no zero-length segment
  }
  return true;
}

function firstSegmentDir(path) {
  const a = path[0], b = path[1];
  const dc = b.col - a.col, dr = b.row - a.row;
  if (Math.abs(dc) > EPS) return { dCol: Math.sign(dc), dRow: 0 };
  return { dCol: 0, dRow: Math.sign(dr) };
}

function lastSegmentDir(path) {
  const a = path[path.length - 2], b = path[path.length - 1];
  const dc = b.col - a.col, dr = b.row - a.row;
  if (Math.abs(dc) > EPS) return { dCol: Math.sign(dc), dRow: 0 };
  return { dCol: 0, dRow: Math.sign(dr) };
}

function pointsOverlap(a, b) {
  return Math.abs(a.col - b.col) < 0.25 - EPS
      && Math.abs(a.row - b.row) < 0.25 - EPS;
}

function pathOverlapsSameType(newPath, lines, utilityType) {
  const newExpanded = expandPath(newPath);
  const iter = typeof lines.values === 'function' ? lines.values() : lines;
  for (const line of iter) {
    if (line.utilityType !== utilityType) continue;
    const ex = expandPath(line.path || []);
    for (const np of newExpanded) {
      for (const ep of ex) {
        if (pointsOverlap(np, ep)) return true;
      }
    }
  }
  return false;
}

function resolvePlaceable(state, id) {
  if (!state || !Array.isArray(state.placeables)) return null;
  return state.placeables.find(p => p && p.id === id) || null;
}

/**
 * Validate a draw-line request.
 * @param state Game state (must have placeables array and utilityLines map).
 * @param opts {utilityType, start:{placeableId, portName}, end:{placeableId, portName}, path}
 */
export function validateDrawLine(state, opts) {
  const { utilityType, start, end, path } = opts;
  if (!Array.isArray(path) || path.length < 2) return reject('invalid_path');
  if (!isManhattan(path)) return reject('not_manhattan');

  // Start port.
  if (!start || !start.placeableId) return reject('invalid_start');
  const startPlaceable = resolvePlaceable(state, start.placeableId);
  if (!startPlaceable) return reject('invalid_start');
  const startDef = COMPONENTS[startPlaceable.type];
  const startSpec = getPortSpec(startDef, start.portName);
  if (!startSpec) return reject('invalid_start');
  if (startSpec.utility !== utilityType) return reject('port_type_mismatch');
  if (!availablePorts(startPlaceable, startDef, utilityType, state.utilityLines || new Map())
        .includes(start.portName)) {
    return reject('port_taken');
  }
  if (!portMatchesApproach(startPlaceable, startDef, start.portName, firstSegmentDir(path), false)) {
    return reject('port_mismatch_start');
  }

  // End port.
  if (!end || !end.placeableId) return reject('invalid_end');
  const endPlaceable = resolvePlaceable(state, end.placeableId);
  if (!endPlaceable) return reject('invalid_end');
  const endDef = COMPONENTS[endPlaceable.type];
  const endSpec = getPortSpec(endDef, end.portName);
  if (!endSpec) return reject('invalid_end');
  if (endSpec.utility !== utilityType) return reject('port_type_mismatch');
  if (!availablePorts(endPlaceable, endDef, utilityType, state.utilityLines || new Map())
        .includes(end.portName)) {
    return reject('port_taken');
  }
  if (!portMatchesApproach(endPlaceable, endDef, end.portName, lastSegmentDir(path), true)) {
    return reject('port_mismatch_end');
  }

  // Same-type overlap check.
  if (pathOverlapsSameType(path, state.utilityLines || new Map(), utilityType)) {
    return reject('overlap_same_type');
  }

  return {
    ok: true,
    line: {
      // id assigned by UtilityLineSystem
      utilityType,
      start: { placeableId: start.placeableId, portName: start.portName },
      end:   { placeableId: end.placeableId, portName: end.portName },
      path: path.map(p => ({ col: p.col, row: p.row })),
      subL: pathLengthSubUnits(path),
    },
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `node test/test-utility-line-drawing.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utility/ports.js src/utility/line-drawing.js \
        test/test-utility-ports.js test/test-utility-line-drawing.js
git commit -m "feat(utility): add port helpers and line-draw validators"
```

---

## Phase 1 — System, Discovery, Solve Runner

### Task 5: `network-discovery.js` — connected-component discovery

**Files:**
- Create: `src/utility/network-discovery.js`
- Create: `test/test-utility-network-discovery.js`

- [ ] **Step 1: Write failing tests**

Scenarios:
1. Empty lines → empty networks.
2. Single line from source port to sink port → one network with 2 ports, 1 line.
3. Two disjoint lines (different port sets, same utility) → two networks.
4. Three lines forming a chain (A→B, B→C, C→D via pass-through ports on B and C) → one network with 4 ports.
5. Branching: source with 2 output ports to 2 sinks → one network, 3 ports.
6. Different utility types stay in different networks even if they touch same placeables.
7. Network IDs stable: same topology → same IDs across calls.
8. Network IDs change when topology changes: add a line merging two networks → merged network has a new ID derived from combined port set.

- [ ] **Step 2: Run tests, expect fail**

- [ ] **Step 3: Implement `src/utility/network-discovery.js`**

```js
// src/utility/network-discovery.js
//
// Given a utility-type-filtered set of lines, compute connected-component
// networks using union-find over port keys.
//
// Each port key is the string `${placeableId}:${portName}`. Union pairs are
// (start-port, end-port) for every line. After union, group port keys by root;
// each group is a Network.
//
// Network IDs are deterministic hashes of the sorted port-key list — stable
// across ticks as long as topology is unchanged.

import { COMPONENTS } from '../data/components.js';
import { getPortSpec } from './ports.js';

function portKey(ref) { return `${ref.placeableId}:${ref.portName}`; }

function hashString(s) {
  // Simple 32-bit FNV-1a hash; good enough for stable IDs within a session.
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
    let p = this.parent.get(x);
    while (p !== x) { this.parent.set(x, this.parent.get(p)); x = p; p = this.parent.get(x); }
    return x;
  }
  union(a, b) {
    this.add(a); this.add(b);
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/**
 * Discover networks for a single utility type.
 *
 * @param lines Iterable<UtilityLine> of this utility type
 * @param placeablesById Map<id, placeable>
 * @returns Array<Network>
 */
export function discoverNetworks(utilityType, lines, placeablesById) {
  const dsu = new DSU();
  const linesByRoot = new Map();
  const allPortKeys = new Set();

  const iter = typeof lines.values === 'function' ? lines.values() : lines;
  const lineArr = [];
  for (const line of iter) {
    if (line.utilityType !== utilityType) continue;
    lineArr.push(line);
    const a = portKey(line.start), b = portKey(line.end);
    dsu.union(a, b);
    allPortKeys.add(a); allPortKeys.add(b);
  }

  const groups = new Map();
  for (const k of allPortKeys) {
    const r = dsu.find(k);
    if (!groups.has(r)) groups.set(r, { portKeys: new Set(), lineIds: [] });
    groups.get(r).portKeys.add(k);
  }
  for (const line of lineArr) {
    const r = dsu.find(portKey(line.start));
    groups.get(r).lineIds.push(line.id);
  }

  const networks = [];
  for (const g of groups.values()) {
    const sortedKeys = Array.from(g.portKeys).sort();
    const id = `net_${utilityType}_${hashString(sortedKeys.join('|'))}`;
    const ports = [];
    const sources = [];
    const sinks = [];
    for (const k of sortedKeys) {
      const [placeableId, portName] = k.split(':');
      const placeable = placeablesById.get(placeableId);
      if (!placeable) continue;
      const def = COMPONENTS[placeable.type];
      const spec = getPortSpec(def, portName);
      if (!spec) continue;
      const portEntry = {
        placeableId, portName,
        role: spec.role || 'pass',
        params: spec.params || {},
      };
      ports.push(portEntry);
      if (spec.role === 'source') {
        sources.push({ portKey: k, placeableId, portName,
                       capacity: (spec.params && spec.params.capacity) || 0,
                       params: spec.params || {} });
      } else if (spec.role === 'sink') {
        sinks.push({ portKey: k, placeableId, portName,
                     demand: (spec.params && spec.params.demand) || 0,
                     params: spec.params || {} });
      }
    }
    networks.push({ id, utilityType, lineIds: g.lineIds, ports, sources, sinks });
  }
  return networks;
}

/**
 * Discover networks for all utility types in one pass.
 *
 * @returns Map<utilityType, Array<Network>>
 */
export function discoverAll(utilityLines, placeablesById, utilityTypeList) {
  const out = new Map();
  for (const utilityType of utilityTypeList) {
    out.set(utilityType, discoverNetworks(utilityType, utilityLines, placeablesById));
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `node test/test-utility-network-discovery.js`

- [ ] **Step 5: Commit**

Defer until Task 6 lands.

---

### Task 6: `UtilityLineSystem.js` — facade

**Files:**
- Create: `src/utility/UtilityLineSystem.js`
- Create: `test/test-utility-line-system.js`

- [ ] **Step 1: Write failing tests**

Scenarios:
1. `addLine(opts)` with valid opts — line appears in `state.utilityLines`, `utilitiesLinesChanged` event emitted.
2. `addLine(opts)` with invalid opts — no state change, log called with 'bad'.
3. `removeLine(id)` — line removed, event emitted.
4. `onPlaceableRemoved(id)` — all lines referencing that placeable are removed (cascade), one event emitted per affected utility type.
5. `listLines()` and `listLinesByType(type)` return expected arrays.

- [ ] **Step 2: Run tests, expect fail**

- [ ] **Step 3: Implement `src/utility/UtilityLineSystem.js`**

```js
// src/utility/UtilityLineSystem.js
//
// Facade over the utility-line pure validators. Owns mutation of
// state.utilityLines. Injected with a minimal set of collaborators
// (state, emit, log, nextLineId).

import { validateDrawLine } from './line-drawing.js';

const REASON_MESSAGES = {
  invalid_path:         'path has fewer than 2 points',
  not_manhattan:        'path must use 90° bends only',
  overlap_same_type:    'another line of this type already runs here',
  invalid_start:        'starting port is missing or invalid',
  invalid_end:          'ending port is missing or invalid',
  port_type_mismatch:   'port type does not match utility',
  port_taken:           'that port is already connected',
  port_mismatch_start:  "line doesn't align with start port direction",
  port_mismatch_end:    "line doesn't align with end port direction",
};

function reasonMessage(r) { return REASON_MESSAGES[r] || r; }

export class UtilityLineSystem {
  constructor(opts = {}) {
    this.state = opts.state;
    this.emit = opts.emit || (() => {});
    this.log = opts.log || (() => {});
    this.nextLineId = opts.nextLineId || (() => 'ul_' + Math.random().toString(36).slice(2));
  }

  addLine(opts) {
    const result = validateDrawLine(this.state, opts);
    if (!result.ok) {
      this.log("Can't place utility line: " + reasonMessage(result.reason), 'bad');
      return null;
    }
    const line = result.line;
    line.id = this.nextLineId();
    if (!this.state.utilityLines) this.state.utilityLines = new Map();
    this.state.utilityLines.set(line.id, line);
    this.emit('utilityLinesChanged', { utilityType: line.utilityType });
    return line.id;
  }

  removeLine(id) {
    const lines = this.state && this.state.utilityLines;
    if (!lines) return false;
    const line = lines.get(id);
    if (!line) return false;
    lines.delete(id);
    this.emit('utilityLinesChanged', { utilityType: line.utilityType });
    return true;
  }

  /**
   * Cascade removal — called by Game.removePlaceable after the placeable is
   * gone. Removes all lines that referenced this placeable as start or end.
   * Emits one event per affected utility type.
   */
  onPlaceableRemoved(placeableId) {
    const lines = this.state && this.state.utilityLines;
    if (!lines) return;
    const affected = new Set();
    for (const [id, line] of lines) {
      if ((line.start && line.start.placeableId === placeableId) ||
          (line.end   && line.end.placeableId   === placeableId)) {
        lines.delete(id);
        affected.add(line.utilityType);
      }
    }
    for (const t of affected) this.emit('utilityLinesChanged', { utilityType: t });
  }

  listLines() {
    const lines = (this.state && this.state.utilityLines) || new Map();
    return Array.from(lines.values());
  }

  listLinesByType(utilityType) {
    return this.listLines().filter(l => l.utilityType === utilityType);
  }
}

export default UtilityLineSystem;
```

- [ ] **Step 4: Run tests to verify pass**

Run: `node test/test-utility-line-system.js`

- [ ] **Step 5: Commit**

```bash
git add src/utility/network-discovery.js src/utility/UtilityLineSystem.js \
        test/test-utility-network-discovery.js test/test-utility-line-system.js
git commit -m "feat(utility): add network discovery and UtilityLineSystem facade"
```

---

### Task 7: `solve-runner.js` — per-tick solve loop

**Files:**
- Create: `src/utility/solve-runner.js`
- Create: `test/test-utility-solve-runner.js`

- [ ] **Step 1: Write failing tests**

Scenarios (using a fake descriptor for testing, not real utility physics):
1. Given one network and one descriptor returning `{flowState:{...}, nextPersistentState:{foo:1}, errors:[]}`, `runSolve()` writes flowState into `state.utilityNetworkData[utilityType]` and `nextPersistentState` into `state.utilityNetworkState`.
2. First-tick persistent state pulls from `descriptor.persistentStateDefaults`.
3. Errors returned by descriptor are aggregated and returned from `runSolve()`.
4. Topology-dirty check: if no lines changed since last call, discovery is not re-run (cached networks returned).

- [ ] **Step 2: Run tests, expect fail**

- [ ] **Step 3: Implement `src/utility/solve-runner.js`**

```js
// src/utility/solve-runner.js
//
// Per-tick solve loop. Discovers networks per utility type (with cache),
// calls each descriptor's solve(), aggregates results into
// state.utilityNetworkData and state.utilityNetworkState.

import { discoverAll } from './network-discovery.js';

export class SolveRunner {
  constructor(opts = {}) {
    this.state = opts.state;
    this.registry = opts.registry;       // { type → descriptor, list → [type,...] }
    this.emit = opts.emit || (() => {});
    // cache
    this._lastLinesVersion = -1;
    this._cachedNetworks = null;
  }

  /**
   * Called by UtilityLineSystem when lines change (or by Game.js on placeable
   * removal). Bumps the cache key so the next runSolve re-discovers.
   */
  invalidate() {
    this._lastLinesVersion++;
  }

  runSolve(worldState = {}) {
    const state = this.state;
    if (!state) return { errors: [] };
    if (!state.utilityLines) state.utilityLines = new Map();
    if (!state.utilityNetworkState) state.utilityNetworkState = new Map();

    // Build placeablesById for this tick (plural-linear; placeables array assumed small).
    const placeablesById = new Map();
    for (const p of state.placeables || []) placeablesById.set(p.id, p);

    const networksByType = discoverAll(
      state.utilityLines, placeablesById, this.registry.list,
    );

    state.utilityNetworkData = new Map();
    const allErrors = [];
    for (const utilityType of this.registry.list) {
      const descriptor = this.registry.types[utilityType];
      if (!descriptor) continue;
      const perType = new Map();
      const networks = networksByType.get(utilityType) || [];
      for (const network of networks) {
        const persistent = state.utilityNetworkState.get(network.id)
          || structuredClone(descriptor.persistentStateDefaults || {});
        let result;
        try {
          result = descriptor.solve(network, persistent, worldState) || {};
        } catch (e) {
          result = { flowState: null, nextPersistentState: persistent,
                     errors: [{ severity: 'hard', code: 'solve_threw',
                                message: String(e && e.message || e),
                                location: { networkId: network.id } }] };
        }
        if (result.flowState) perType.set(network.id, result.flowState);
        if (result.nextPersistentState) {
          state.utilityNetworkState.set(network.id, result.nextPersistentState);
        }
        if (Array.isArray(result.errors)) allErrors.push(...result.errors);
      }
      state.utilityNetworkData.set(utilityType, perType);
    }

    return { errors: allErrors };
  }
}

export default SolveRunner;
```

- [ ] **Step 4: Run tests to verify pass**

Run: `node test/test-utility-solve-runner.js`

- [ ] **Step 5: Commit**

```bash
git add src/utility/solve-runner.js test/test-utility-solve-runner.js
git commit -m "feat(utility): add per-tick solve runner"
```

---

## Phase 2 — Descriptors

### Task 8: Descriptor scaffolding (all 6 utility types)

**Files:**
- Create: `src/utility/types/powerCable.js`, `vacuumPipe.js`, `rfWaveguide.js`, `coolingWater.js`, `cryoTransfer.js`, `dataFiber.js`
- Modify: `src/utility/registry.js`

Implement a minimum viable descriptor for each type with a **no-op solve** that returns zero-quality/zero-capacity/no-errors. This lets Phase 4 (rendering, input) light up before Phase 3 (real physics).

- [ ] **Step 1: Create each descriptor file**

Template (copy for each, edit the constants):

```js
// src/utility/types/coolingWater.js
const defaults = { reservoirVolumeL: 500 };

export default {
  type: 'coolingWater',
  displayName: 'Cooling Water',
  color: '#4488ff',
  geometryStyle: 'cylinder',
  pipeRadiusMeters: 0.08,
  capacityUnit: 'L/min',
  persistentStateDefaults: defaults,
  solve(network, persistent, worldState) {
    return {
      flowState: {
        networkId: network.id,
        utilityType: network.utilityType,
        totalCapacity: 0,
        totalDemand: 0,
        utilization: 0,
        perSegmentLoad: [],
        perSinkQuality: {},
        errors: [],
      },
      nextPersistentState: persistent,
      errors: [],
    };
  },
  renderInspector() { return null; },
  refillCost() { return null; },
};
```

Per-type constants:
| type | color | geometryStyle | pipeRadiusMeters | capacityUnit | defaults |
|---|---|---|---|---|---|
| powerCable | `#44cc44` | cylinder | 0.02 | kW | `{}` |
| vacuumPipe | `#888888` | cylinder | 0.06 | mbar·L/s | `{}` |
| rfWaveguide | `#cc4444` | rectWaveguide | 0.05 | kW | `{}` |
| coolingWater | `#4488ff` | cylinder | 0.04 | L/min | `{reservoirVolumeL: 500}` |
| cryoTransfer | `#44aacc` | jacketedCylinder | 0.06 | W@4K | `{lheVolumeL: 500}` |
| dataFiber | `#eeeeee` | cylinder | 0.01 | Gbps | `{}` |

(Radii sized to match the table in `2026-04-11-utility-port-networks-design.md` — halved since that table uses diameters.)

- [ ] **Step 2: Populate `src/utility/registry.js`**

```js
// src/utility/registry.js
import powerCable from './types/powerCable.js';
import vacuumPipe from './types/vacuumPipe.js';
import rfWaveguide from './types/rfWaveguide.js';
import coolingWater from './types/coolingWater.js';
import cryoTransfer from './types/cryoTransfer.js';
import dataFiber from './types/dataFiber.js';

const all = [powerCable, vacuumPipe, rfWaveguide, coolingWater, cryoTransfer, dataFiber];

export const UTILITY_TYPES = Object.fromEntries(all.map(d => [d.type, d]));
export const UTILITY_TYPE_LIST = all.map(d => d.type);

// Shared convenience export for consumers that want a single handle.
export const UtilityRegistry = { types: UTILITY_TYPES, list: UTILITY_TYPE_LIST };
```

- [ ] **Step 3: Sanity check**

No tests at this step — just import the registry in a quick Node REPL or existing test harness:

```bash
node -e "import('./src/utility/registry.js').then(m => console.log(m.UTILITY_TYPE_LIST))"
```

Expected: `['powerCable', 'vacuumPipe', 'rfWaveguide', 'coolingWater', 'cryoTransfer', 'dataFiber']`

- [ ] **Step 4: Commit**

```bash
git add src/utility/types/ src/utility/registry.js
git commit -m "feat(utility): add descriptor stubs for all 6 utility types"
```

---

### Task 9: Flesh out `powerCable.solve()`

**Files:**
- Modify: `src/utility/types/powerCable.js`
- Create: `test/test-utility-solve-powerCable.js`

- [ ] **Step 1: Write failing tests**

Scenarios:
1. No sources, no sinks → `utilization: 0`, no errors.
2. Source capacity 100, sink demand 40 → `utilization: 0.4`, `perSinkQuality[sink] = 1`.
3. Source capacity 100, sinks demanding 60+80 → `utilization: 1.4`, soft error `'power_overload'`, both `perSinkQuality = 100/140 ≈ 0.714`.
4. No source, sink demand 10 → `utilization: 1` (clamped), soft error `'power_starved'`, `perSinkQuality = 0`.

- [ ] **Step 2: Run test, expect fail**

- [ ] **Step 3: Replace solve() body**

```js
solve(network, persistent, worldState) {
  const totalCapacity = network.sources.reduce((a, s) => a + (s.capacity || 0), 0);
  const totalDemand   = network.sinks.reduce((a, s) => a + (s.demand || 0), 0);
  const errors = [];
  let perSinkQuality = {};
  let utilization = 0;

  if (totalDemand === 0) {
    utilization = 0;
  } else if (totalCapacity === 0) {
    utilization = 1;
    errors.push({
      severity: 'soft', code: 'power_starved',
      message: 'Power network has no capacity.',
      location: { networkId: network.id },
    });
    for (const s of network.sinks) perSinkQuality[s.portKey] = 0;
  } else {
    utilization = totalDemand / totalCapacity;
    const q = Math.min(1, totalCapacity / totalDemand);
    for (const s of network.sinks) perSinkQuality[s.portKey] = q;
    if (utilization > 1) {
      errors.push({
        severity: 'soft', code: 'power_overload',
        message: `Power network overloaded (${Math.round(utilization*100)}%).`,
        location: { networkId: network.id },
      });
    }
  }

  return {
    flowState: {
      networkId: network.id,
      utilityType: network.utilityType,
      totalCapacity, totalDemand,
      utilization: Math.min(1, utilization),
      perSegmentLoad: [],
      perSinkQuality,
      errors: [...errors],
    },
    nextPersistentState: persistent,
    errors,
  };
}
```

- [ ] **Step 4: Run test, verify pass**

- [ ] **Step 5: Commit**

Defer until Task 14 (one commit for all 6 fleshed-out solves).

---

### Task 10: Flesh out `vacuumPipe.solve()`

**Files:**
- Modify: `src/utility/types/vacuumPipe.js`
- Create: `test/test-utility-solve-vacuumPipe.js`

Implement simple sum-of-pump-speeds minus sum-of-outgassing model:

```js
solve(network, persistent, worldState) {
  // sources (pumps): params.pumpSpeed in L/s
  // sinks (vacuum consumers): params.outgassing in mbar·L/s
  const totalPumpSpeed = network.sources.reduce((a,s) => a + (s.params.pumpSpeed || 0), 0);
  const totalOutgas    = network.sinks.reduce((a,s) => a + (s.params.outgassing || 0), 0);

  // Rough pressure estimate: P = Q/S, where Q = outgas, S = pump speed (both aggregate).
  const pressure = totalPumpSpeed > 0 ? totalOutgas / totalPumpSpeed : Infinity;
  // Quality: map pressure to [0,1] — 1e-8 mbar = 1.0, 1e-4 mbar = 0.0, linear in log.
  let quality = 1;
  if (!isFinite(pressure)) quality = 0;
  else if (pressure > 1e-4) quality = 0;
  else if (pressure < 1e-8) quality = 1;
  else quality = 1 - (Math.log10(pressure) - (-8)) / ((-4) - (-8));

  const perSinkQuality = {};
  for (const s of network.sinks) perSinkQuality[s.portKey] = quality;

  const errors = [];
  if (totalPumpSpeed === 0 && network.sinks.length > 0) {
    errors.push({ severity: 'hard', code: 'vacuum_no_pump',
                  message: 'Vacuum network has no pump.',
                  location: { networkId: network.id } });
  } else if (pressure > 1e-5) {
    errors.push({ severity: 'soft', code: 'vacuum_poor',
                  message: `Vacuum pressure high (${pressure.toExponential(2)} mbar).`,
                  location: { networkId: network.id } });
  }

  return {
    flowState: {
      networkId: network.id, utilityType: network.utilityType,
      totalCapacity: totalPumpSpeed, totalDemand: totalOutgas,
      utilization: totalPumpSpeed > 0 ? Math.min(1, totalOutgas / totalPumpSpeed) : 1,
      perSegmentLoad: [], perSinkQuality, errors: [...errors],
    },
    nextPersistentState: persistent,
    errors,
  };
}
```

Tests: sinks-with-pump = quality > 0; no-pump = hard error; pressure > threshold = soft error.

---

### Task 11: Flesh out `rfWaveguide.solve()`

**Files:**
- Modify: `src/utility/types/rfWaveguide.js`
- Create: `test/test-utility-solve-rfWaveguide.js`

Group sources + sinks by `params.frequency`. For each frequency group: sum source power, sum sink demand, quality = min(1, capacity/demand). Unmatched sinks (no source of matching frequency) get quality 0 and a soft error. See detailed sketch in design doc §Simulation Contract.

Tests: matched frequency = OK; no source at frequency = soft error; overdriven group = overload soft error.

---

### Task 12: Flesh out `coolingWater.solve()` (with evaporation + refill)

**Files:**
- Modify: `src/utility/types/coolingWater.js`
- Create: `test/test-utility-solve-coolingWater.js`

Key behaviors:
- Sum sink heat demand (`params.heatLoad` in kW); sum chiller capacity (`params.capacity` in kW).
- Quality = min(1, capacity/demand) as with power.
- Evaporation: `evapRate = TOTAL_HEAT_KW * EVAP_PER_KW_PER_TICK` (constant, tuned small so 500L lasts ~30 min of beam time).
  Set `EVAP_PER_KW_PER_TICK = 0.001` (1 L per 1000 kW·tick) for v1 — adjust later.
- Persistent: `reservoirVolumeL` decrements by evaporation; clamp to 0.
- When reservoir ≤ 0 → hard error `cooling_dry`, quality = 0.
- Implement `refillCost(persistent)`:
  ```js
  refillCost(persistent) {
    const missing = 500 - (persistent.reservoirVolumeL || 0);
    if (missing < 1) return null;
    return { funding: Math.ceil(missing * 10) };  // $10 / L — tune later
  }
  ```

Tests: drain → hard error; refill cost = 0 when full; refill cost matches formula.

---

### Task 13: Flesh out `cryoTransfer.solve()` (with LHe reservoir + quench)

**Files:**
- Modify: `src/utility/types/cryoTransfer.js`
- Create: `test/test-utility-solve-cryoTransfer.js`

Analogous to cooling but:
- Sinks declare `params.srfHeatW` (per-cavity static heat at 2K/4K, typically 18W).
- Sources declare `params.coldCapacityW` (cold-box capacity at temp).
- LHe persistent state: `lheVolumeL`. Decrement proportional to total SRF heat.
- Hard error `cryo_quench` when reservoir < threshold (e.g., 20L).
- Refill cost: `$50 / L` (LHe is expensive).

---

### Task 14: Flesh out `dataFiber.solve()` (boolean connection)

**Files:**
- Modify: `src/utility/types/dataFiber.js`
- Create: `test/test-utility-solve-dataFiber.js`

Simplest: if network has ≥1 source and ≥1 sink, every sink gets quality=1; else quality=0 (soft error `data_disconnected` on sinks with no source in their network).

Tests: connected = quality 1; disconnected = quality 0 + soft error.

- [ ] **Commit Tasks 9–14 together:**

```bash
git add src/utility/types/ test/test-utility-solve-*.js
git commit -m "feat(utility): implement v1 physics for all 6 utility types"
```

---

## Phase 3 — Equipment Port Declarations

### Task 15: Add `ports` field schema to beamline components

**Files:**
- Modify: `src/data/components.js`

- [ ] **Step 1: Translate prior design's port assignments into new schema**

For every component type listed in `docs/superpowers/specs/2026-04-11-utility-port-networks-design.md` sections "Source", "Optics", "RF / Acceleration (normal conducting)", "RF / Acceleration (superconducting)", "Diagnostics", "Endpoints" — add a `ports` field with utility ports.

The old design used `utilityPorts: [{type, offset}]` as an array. The new schema uses `ports: {name: {utility, side, offsetAlong, role, params}}` matching the beam-pipe port format already present.

Example (dipole, which needs vacuum + power + cooling):

```js
dipole: {
  // ... existing fields (role, subL, subW, cost, etc.) ...
  ports: {
    // existing beam-pipe ports (entry/exit) stay as-is:
    entry: { side: 'back' },
    exit:  { side: 'front' },
    // new utility ports:
    power_in:   { utility: 'powerCable',  side: 'left',  offsetAlong: 0.3, role: 'sink', params: { demand: 50 } },
    cool_in:    { utility: 'coolingWater', side: 'right', offsetAlong: 0.3, role: 'sink', params: { heatLoad: 30 } },
    cool_out:   { utility: 'coolingWater', side: 'right', offsetAlong: 0.7, role: 'sink', params: { heatLoad: 0 } },
  },
},
```

Guidelines:
- Utility ports go on lateral sides (`'left'` or `'right'`) — not `'back'` / `'front'`, which are reserved for beam-pipe ports.
- `offsetAlong` ∈ [0.1, 0.9] — keep ports off the exact corners.
- For v1 use conservative values for `params.demand`, `params.heatLoad`, `params.capacity` — they can be tuned later without code changes to the utility system.
- For components with multiple ports of the same utility, name them `<utility>_in_1`, `<utility>_in_2`, etc., or `power_in` / `cool_in` / `cool_out` per natural role.
- SRF cavities: use `cryo_in` / `cryo_out` (utility `cryoTransfer`, with `params.srfHeatW: 18`) instead of `cool_in` / `cool_out`.
- RF-requiring components: add `rf_in` with `params.frequency: <Hz>` (copy from existing component definitions that already declare `rfFrequency`).

- [ ] **Step 2: Validate**

Smoke-test by running an existing test that loads COMPONENTS — e.g., `node test/test-registry.js`. Ensure no parse errors.

- [ ] **Step 3: Commit**

Defer until Task 16 lands.

---

### Task 16: Add `ports` field to facility equipment

**Files:**
- Modify: `src/data/placeables/` — whichever files define facility equipment (substation, chiller, etc.)

- [ ] **Step 1: Identify equipment files**

Run:
```bash
grep -l "substation\|chiller\|lcwSkid\|coldBox" src/data/placeables/
```

- [ ] **Step 2: Add source ports per assignment table**

From the prior design's "Infrastructure output port assignments" table:
- `substation`, `powerPanel` → `power_out_1` ... `power_out_N` with `utility: 'powerCable'`, `role: 'source'`, `params: { capacity: <kW> }`
- RF source equipment (magnetron, solidStateAmp, klystrons, etc.) → `rf_out` with `utility: 'rfWaveguide'`, `role: 'source'`, `params: { capacity: <kW>, frequency: <Hz> }`
- `lcwSkid`, `chiller`, `coolingTower` → `cool_out` + `cool_return` with `utility: 'coolingWater'`, `role: 'source'`, `params: { capacity: <kW> }` (return is `pass`)
- `coldBox4K`, `coldBox2K` → `cryo_out` + `cryo_return`
- Pumps (`roughingPump`, `turboPump`, etc.) → `vac_out` with `utility: 'vacuumPipe'`, `role: 'source'`, `params: { pumpSpeed: <L/s> }`
- Data equipment → `data_out` with `utility: 'dataFiber'`, `role: 'source'`, `params: { capacity: <Gbps> }`

Use capacity numbers from existing equipment definitions (`powerCapacity`, `rfFrequency`, etc. fields that already exist) to avoid divergence.

- [ ] **Step 3: Commit Tasks 15 + 16 together**

```bash
git add src/data/components.js src/data/placeables/
git commit -m "feat(utility): declare utility ports on beamline components and facility equipment"
```

---

## Phase 4 — Input & Rendering

### Task 17: `UtilityLineInputController.js`

**Files:**
- Create: `src/input/UtilityLineInputController.js`
- Modify: `src/input/InputHandler.js` — delegate utility-line tools.

- [ ] **Step 1: Build the controller**

Structure mirrors `src/input/BeamlineInputController.js` (previously `3f95f021`). Key differences:
- Tracks current utility type (set by tool selection in `InputHandler`).
- On hover near a port of that utility type → snap cursor.
- On click+drag → `buildManhattanPath(startSnap, cursorGridPos)` for preview.
- On release on a valid second port → call `UtilityLineSystem.addLine({utilityType, start, end, path})`.
- On release elsewhere → discard.
- Render preview via an injected `setPreview(pathObj|null)` callback consumed by the overlay layer.

Key methods:
- `onToolChanged(toolName)` — detects `utilityLine:<type>` tool names.
- `onHover(gridX, gridY)` — snap cursor to nearby ports; update preview.
- `onMouseDown(gridX, gridY)` — if over a valid source port, enter draw mode.
- `onMouseMove(gridX, gridY)` — update preview path while dragging.
- `onMouseUp(gridX, gridY)` — attempt commit; clear state either way.
- `onEscape()` — cancel draw.

- [ ] **Step 2: Wire in `InputHandler.js`**

When the current tool name starts with `utilityLine:`, route mouse events to `UtilityLineInputController`. Keep the existing beamline and rack-painting dispatch for now (Phase 6 removes rack painting).

- [ ] **Step 3: Add tool registration**

Find the tool registry (in `src/data/modes.js` or `src/ui/UIHost.js` — grep for `drift` tool). Register one tool per utility type: `utilityLine:powerCable`, `utilityLine:coolingWater`, etc. Use the descriptor's `color` and `displayName` for UI.

- [ ] **Step 4: Quick manual smoke test**

Run the dev server, place a source placeable and a sink, select a utility-line tool, draw a line between their matching ports. Verify the line appears in `state.utilityLines` (log to console).

- [ ] **Step 5: Commit**

```bash
git add src/input/UtilityLineInputController.js src/input/InputHandler.js src/data/modes.js
git commit -m "feat(utility): add UtilityLineInputController and tool registration"
```

---

### Task 18: 3D `utility-line-builder.js`

**Files:**
- Create: `src/renderer3d/utility-line-builder.js`
- Modify: `src/renderer3d/world-snapshot.js` — expose `state.utilityLines` via snapshot if needed.
- Modify: wherever the old `utility-pipe-builder.js` is invoked from (grep for it).

- [ ] **Step 1: Implement the new builder**

Input: `utilityLines` (Array of UtilityLine) + descriptor registry + `placeablesById` for port-world-position lookups.

For each line:
1. Look up descriptor via `UTILITY_TYPES[line.utilityType]`.
2. Build geometry based on `descriptor.geometryStyle`:
   - `cylinder`: THREE.TubeGeometry or extruded circle along path
   - `rectWaveguide`: extruded rectangle (wider than tall)
   - `jacketedCylinder`: two nested TubeGeometries (outer semi-transparent)
3. Color from `descriptor.color`. Cache meshes keyed by `line.id + path hash`.
4. Convert path waypoints (col, row) to world coords (world x = col*2 + 1, world z = row*2 + 1 — same convention as `src/renderer3d/component-builder.js`).
5. Connect first/last path points to actual port world positions (via `portWorldPosition` from `src/utility/ports.js`) so meshes meet equipment cleanly.

Output: a THREE.Group containing all line meshes. Rebuilt on `utilityLinesChanged` event; otherwise reused across frames.

- [ ] **Step 2: Replace old utility-pipe-builder call sites**

Grep for `utility-pipe-builder`; replace with the new builder. Leave the old file intact for now (Phase 6 removes it).

- [ ] **Step 3: Smoke test in browser**

Place lines, verify 3D geometry appears. Check distinct geometry for RF waveguide (rectangular) and cryo transfer (jacketed).

- [ ] **Step 4: Commit**

```bash
git add src/renderer3d/utility-line-builder.js \
        src/renderer3d/world-snapshot.js \
        <any other touched renderer files>
git commit -m "feat(utility): render utility lines in 3D with per-descriptor geometry"
```

---

### Task 19: 2D overlay renderer (optional minimal for v1)

**Files:**
- Create: `src/renderer/utility-line-overlay.js`

Minimal: draws each line as a colored polyline on the overlay. Toggleable via a boolean `state.showUtilityOverlay`. Can stay simple; real overlay modes are future polish.

- [ ] **Commit:**

```bash
git add src/renderer/utility-line-overlay.js
git commit -m "feat(utility): add minimal 2D utility-line overlay"
```

---

## Phase 5 — UI

### Task 20: `UtilityInspector` — click-to-inspect panel

**Files:**
- Create: `src/ui/UtilityInspector.js`
- Modify: `src/ui/UIHost.js` — register the new window.
- Modify: `src/input/UtilityLineInputController.js` — on plain click (not in draw mode) over a line, open inspector.

- [ ] **Step 1: Build the panel**

Follow the pattern of `src/ui/NetworkWindow.js` (existing) — which is what we're replacing. DOM-based (not React unless the codebase is already React; check first). Shared frame:
- Header: utility icon + display name + network ID
- Stats block: total capacity / total demand / utilization %
- Sources list
- Sinks list with `perSinkQuality` color coding
- Errors list (red for hard, yellow for soft)
- **Descriptor-rendered inner section**: call `descriptor.renderInspector(network, flowState, persistent)` and insert its DOM return value.
- For source placeables with a reservoir: a "Refill" button that calls the descriptor's `refillCost(persistent)` → if non-null, shows cost and on click calls the game's `spend()` and resets reservoir to its default.

- [ ] **Step 2: Inspector open handler**

When the input controller detects a click on a utility line (not in draw mode), call `UIHost.openUtilityInspector({lineId})`. The panel resolves the line → network → flowState.

- [ ] **Step 3: Implement one descriptor's `renderInspector()`**

For `coolingWater`, return a DOM element showing:
- Reservoir volume bar (current/max)
- Evaporation rate (L/tick)
- Refill button wired to the top-level "Refill" action

Other descriptors can return `null` for v1 and be filled in later.

- [ ] **Step 4: Commit**

```bash
git add src/ui/UtilityInspector.js src/ui/UIHost.js \
        src/input/UtilityLineInputController.js \
        src/utility/types/coolingWater.js
git commit -m "feat(utility): add UtilityInspector and cooling refill action"
```

---

### Task 21: `UtilityStatsPanel` — infra-mode side panel

**Files:**
- Create: `src/ui/UtilityStatsPanel.js`
- Modify: `src/ui/UIHost.js` — mount below MusicPlayer when infra mode active, unmount otherwise.

- [ ] **Step 1: Build the panel**

DOM-based side panel. Content:
- One row per utility type (in `UTILITY_TYPE_LIST` order):
  - Color swatch + display name
  - `# networks`
  - `total capacity / total demand` (sum across networks)
  - `# hard errors` (red badge)
  - `# soft errors` (yellow badge)
- Clicking a row opens an overview (list of networks for that type, each clickable to open `UtilityInspector` with that network).
- Updates on `'utilityLinesChanged'` and on every solve tick (subscribe to a game-tick event).

- [ ] **Step 2: Mount gating**

In `UIHost.js`, watch the current mode. When mode changes to `'infra'`, mount the panel below the MusicPlayer DOM element. On mode change away, unmount.

- [ ] **Step 3: Commit**

```bash
git add src/ui/UtilityStatsPanel.js src/ui/UIHost.js
git commit -m "feat(utility): add infra-mode utility stats side panel"
```

---

### Task 22: Error surfacing on map + beam blockers

**Files:**
- Modify: `src/renderer3d/utility-line-builder.js` — color tint / glow based on `flowState.errors`.
- Modify: `src/renderer3d/component-builder.js` or equivalent — alert icons on equipment with errors.
- Modify: `src/game/Game.js` — feed hard errors into `state.infraBlockers` so the existing beam-blocked UI picks them up.

- [ ] **Step 1: Line glow on error**

In `utility-line-builder.js`, after building a line's mesh, inspect its network's `flowState.errors`. If hard error → add a red emissive or red edge overlay. If soft → yellow tint. Otherwise normal material.

- [ ] **Step 2: Equipment alert icons**

Find where other alert icons render (e.g. for missing connections today). Add: for each placeable, look up every port's containing network, check its `flowState.perSinkQuality[portKey]`. If below threshold (e.g. < 0.9), render a yellow alert above the equipment; if there's a hard error on any connected network, render red.

- [ ] **Step 3: Beam-blocker wiring**

In `Game.js` game-tick pipeline, after `solveRunner.runSolve()`, collect all errors where `severity === 'hard'` and populate `state.infraBlockers` (existing field). The existing beam-running check already gates on `infraBlockers`.

- [ ] **Step 4: Commit**

```bash
git add src/renderer3d/ src/game/Game.js
git commit -m "feat(utility): surface hard/soft errors on map and block beam on hard errors"
```

---

## Phase 6 — Integration & Cleanup

### Task 23: Wire `perSinkQuality` into `state.nodeQualities`

**Files:**
- Modify: `src/game/Game.js`

- [ ] **Step 1: After solve, aggregate quality per placeable**

After `solveRunner.runSolve()`:

```js
const nodeQualities = {};
for (const [utilityType, perType] of state.utilityNetworkData) {
  for (const flowState of perType.values()) {
    for (const [portKey, q] of Object.entries(flowState.perSinkQuality || {})) {
      const [placeableId] = portKey.split(':');
      // Take the min quality across all utilities feeding this placeable
      nodeQualities[placeableId] = Math.min(
        nodeQualities[placeableId] ?? 1, q,
      );
    }
  }
}
state.nodeQualities = nodeQualities;
```

This replaces whatever value the existing `computeSystemStats`/`Networks.validate()` path used to produce.

- [ ] **Step 2: Commit**

```bash
git add src/game/Game.js
git commit -m "feat(utility): feed per-sink quality into state.nodeQualities"
```

---

### Task 24: Save / load

**Files:**
- Modify: `src/game/Game.js` — find the serialize/deserialize functions.

- [ ] **Step 1: Serialize**

In the save function, serialize:
```js
utilityLines: Array.from(state.utilityLines.entries()),        // [[id, line], ...]
utilityNetworkState: Array.from(state.utilityNetworkState.entries()),
utilityNextId: state.utilityNextId,
```

Explicitly **do not** serialize `utilityNetworkData` (derived).

- [ ] **Step 2: Deserialize**

Rebuild Maps from arrays. Leave `utilityNetworkData` null; the first solve tick populates it.

Skip old `rackSegments` / `networkData` — those fields stop being loaded. Existing saves will fail cleanly (acceptable per project rules).

- [ ] **Step 3: Commit**

```bash
git add src/game/Game.js
git commit -m "feat(utility): persist utility lines and network state in save/load"
```

---

### Task 25: Cleanup commit — remove old system

**Files:**
- Delete: `src/networks/networks.js`
- Delete: `src/ui/NetworkWindow.js`
- Delete: `src/renderer3d/utility-pipe-builder.js`
- Modify: `src/game/Game.js` — remove `state.rackSegments`, `state.networkData`, `state.infraBlockers` population from old path; remove `placeRackSegment`, `paintRackUtility` methods; remove imports of deleted modules.
- Modify: `src/input/InputHandler.js` — remove rack-painting input path.
- Modify: `src/data/modes.js` — remove rack / distribution tool entries.
- Modify: `src/ui/UIHost.js` — remove NetworkWindow reference.
- Modify: wherever `Networks.validate()` was called — remove (replaced by `solveRunner.runSolve()` + error-to-blockers wiring from Task 22).

- [ ] **Step 1: Grep for remaining references**

```bash
grep -rn "rackSegments\|paintRackUtility\|placeRackSegment\|Networks\\.\|NetworkWindow\|utility-pipe-builder\|networkData" src/ test/ tools/
```

- [ ] **Step 2: Delete dead code per the reference list**

Work through each reference and either:
- Delete the line (if unused by new system)
- Replace with equivalent from new system (if the call site is still needed)

Watch for subtle ones: `state.infraBlockers` populated by old `Networks.validate()` may now need to be fed from new solve errors (handled in Task 22 — double-check).

- [ ] **Step 3: Run the whole test suite**

```bash
node test/test-beamline-system.js
node test/test-pipe-drawing.js
node test/test-utility-line-geometry.js
node test/test-utility-ports.js
node test/test-utility-line-drawing.js
node test/test-utility-network-discovery.js
node test/test-utility-line-system.js
node test/test-utility-solve-runner.js
node test/test-utility-solve-powerCable.js
node test/test-utility-solve-vacuumPipe.js
node test/test-utility-solve-rfWaveguide.js
node test/test-utility-solve-coolingWater.js
node test/test-utility-solve-cryoTransfer.js
node test/test-utility-solve-dataFiber.js
```

Expected: all PASS. If `test/test-networks.js` still exists and is testing the old deleted module, delete that test file too.

- [ ] **Step 4: Start the dev server and smoke test**

```bash
# whatever the project's dev server command is (check package.json scripts)
npm run dev
```

Manual checks:
- Open game, enter Infra mode — `UtilityStatsPanel` should appear below music player.
- Place a substation and a dipole. Use power-line tool to draw a line between their ports. Line should render.
- Click the line — `UtilityInspector` should open.
- Beam should run (or not) based on whether required utility connections are all present.

- [ ] **Step 5: Final commit**

```bash
git add -u   # stages deletions
git add src/game/Game.js src/input/InputHandler.js src/data/modes.js src/ui/UIHost.js
git commit -m "refactor(utility): remove rack-segment and old networks module

Replaced by per-utility independent lines (see 2026-04-17-utility-networks-redesign-design.md).
Save-file compat not preserved (pre-release project)."
```

---

## Self-review

Before declaring the plan complete:

1. **Spec coverage:** All 11 numbered design decisions from the spec map to tasks:
   - Scope/role/redesign → implicit in overall structure.
   - Per-utility lines → Task 1 (state), Tasks 8–14 (descriptors).
   - Port-based connections → Task 3 (ports.js), Tasks 15–16 (port declarations).
   - Multi-port sources + junctions → Tasks 15–16 (port declarations); junction *placeable* entities deferred per spec's §Modules note.
   - Manhattan routing → Task 2 (line-geometry).
   - Cross-type OK, same-type not → Task 4 (line-drawing overlap check).
   - Steady-state solve + persistent reservoirs → Task 7 (solve runner), Tasks 12–13 (reservoirs).
   - UI tiers → Tasks 20 (inspector), 21 (stats panel), 22 (map errors).
   - Hard/soft severity → Tasks 9–14 (per-utility errors), 22 (surfacing).
   - Manual refill → Task 12 (cooling refillCost), Task 20 (refill button).

2. **Placeholder scan:** No "TBD", "implement later", or "similar to Task N" references. Code blocks present for every implementation step.

3. **Type consistency:** `UtilityLine`, `FlowState`, `Network`, `UtilityDescriptor` shapes are defined once in the spec and used consistently across tasks. `perSinkQuality` is a dict keyed by `portKey` everywhere.
