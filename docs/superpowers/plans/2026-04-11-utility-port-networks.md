# Utility Port Networks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace tile-based pip rendering for utility connections with explicit ports on components/infrastructure, 3D pipe geometry on floor networks, and Z-shaped last-meter routing between them.

**Architecture:** Add `utilityPorts` to component/infrastructure data definitions. Create a new `utility-port-builder.js` for port stub geometry. Rewrite `connection-builder.js` to render floor-level pipe runs with correct profiles and Z-route geometry from floor to ports. Extend `world-snapshot.js` to compute port positions and connection routing data.

**Tech Stack:** Three.js (CDN global), existing material/UV utility system, existing network discovery.

**Spec:** `docs/superpowers/specs/2026-04-11-utility-port-networks-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/data/utility-ports.js` | Create | Port assignment table and helper to look up ports for any component/infra ID |
| `src/renderer3d/utility-port-builder.js` | Create | Generates port stub meshes on component side faces |
| `src/renderer3d/utility-pipe-builder.js` | Create | Replaces ConnectionBuilder — renders floor pipe runs + Z-routes |
| `src/renderer3d/world-snapshot.js` | Modify | Add `buildUtilityRouting()` — computes port positions, connection sides, floor pipe segments |
| `src/renderer3d/ThreeRenderer.js` | Modify | Wire up new builders, replace `_refreshConnections()` |
| `src/renderer3d/component-builder.js` | Modify | Call utility-port-builder when creating component meshes |
| `src/renderer3d/equipment-builder.js` | Modify | Call utility-port-builder when creating equipment meshes |
| `src/renderer3d/connection-builder.js` | Delete | Replaced by utility-pipe-builder.js |
| `src/data/beamline-components.raw.js` | No change | `requiredConnections` already present — port data lives in utility-ports.js |
| `src/data/infrastructure.raw.js` | No change | Same — port data centralized in utility-ports.js |

---

## Task 1: Port Assignment Data Module

**Files:**
- Create: `src/data/utility-ports.js`

This module is the single source of truth for which components get which utility ports and where they sit on the side face. It's a pure data module with one lookup function — no rendering.

- [ ] **Step 1: Create port assignment table**

```js
// src/data/utility-ports.js
//
// Utility port assignments for beamline components and infrastructure.
// Ports sit on lateral side faces, mirrored on both sides.
// `offset` is 0→1 along the side face (0 = back, 1 = front).

export const UTILITY_PORT_PROFILES = {
  powerCable:   { color: 0x44cc44, radius: 0.02,  shape: 'round',       label: 'pwr'  },
  coolingWater: { color: 0x4488ff, radius: 0.04,  shape: 'round',       label: 'cool' },
  cryoTransfer: { color: 0x44aacc, radius: 0.06,  shape: 'round',       label: 'cryo' },
  rfWaveguide:  { color: 0xcc4444, width: 0.05, height: 0.035, shape: 'rect', label: 'RF' },
  dataFiber:    { color: 0xeeeeee, radius: 0.01,  shape: 'round',       label: 'data' },
  vacuumPipe:   { color: 0x888888, radius: 0.06,  shape: 'round',       label: 'vac'  },
};

const BEAMLINE_PORTS = {
  // Source
  source:              [{ type: 'powerCable', offset: 0.3 }],

  // Optics
  dipole:              [{ type: 'powerCable', offset: 0.3 }, { type: 'coolingWater', offset: 0.7 }],
  quadrupole:          [{ type: 'powerCable', offset: 0.3 }, { type: 'coolingWater', offset: 0.7 }],
  sextupole:           [{ type: 'powerCable', offset: 0.3 }, { type: 'coolingWater', offset: 0.7 }],
  splitter:            [{ type: 'powerCable', offset: 0.5 }],
  velocitySelector:    [{ type: 'powerCable', offset: 0.5 }],

  // RF — normal conducting
  rfq:                 [{ type: 'powerCable', offset: 0.2 }, { type: 'coolingWater', offset: 0.5 }, { type: 'rfWaveguide', offset: 0.8 }],
  pillboxCavity:       [{ type: 'powerCable', offset: 0.3 }, { type: 'rfWaveguide', offset: 0.7 }],
  rfCavity:            [{ type: 'powerCable', offset: 0.2 }, { type: 'coolingWater', offset: 0.5 }, { type: 'rfWaveguide', offset: 0.8 }],
  sbandStructure:      [{ type: 'powerCable', offset: 0.2 }, { type: 'coolingWater', offset: 0.5 }, { type: 'rfWaveguide', offset: 0.8 }],

  // RF — superconducting
  halfWaveResonator:   [{ type: 'powerCable', offset: 0.2 }, { type: 'cryoTransfer', offset: 0.5 }, { type: 'rfWaveguide', offset: 0.8 }],
  spokeCavity:         [{ type: 'powerCable', offset: 0.2 }, { type: 'cryoTransfer', offset: 0.5 }, { type: 'rfWaveguide', offset: 0.8 }],
  ellipticalSrfCavity: [{ type: 'powerCable', offset: 0.2 }, { type: 'cryoTransfer', offset: 0.5 }, { type: 'rfWaveguide', offset: 0.8 }],
  cryomodule:          [{ type: 'powerCable', offset: 0.2 }, { type: 'cryoTransfer', offset: 0.5 }, { type: 'rfWaveguide', offset: 0.8 }],

  // Diagnostics
  bpm:                 [{ type: 'powerCable', offset: 0.3 }, { type: 'dataFiber', offset: 0.7 }],
  screen:              [{ type: 'powerCable', offset: 0.3 }, { type: 'dataFiber', offset: 0.7 }],
  ict:                 [{ type: 'powerCable', offset: 0.3 }, { type: 'dataFiber', offset: 0.7 }],
  wireScanner:         [{ type: 'powerCable', offset: 0.3 }, { type: 'dataFiber', offset: 0.7 }],

  // Endpoints
  faradayCup:          [{ type: 'powerCable', offset: 0.3 }, { type: 'dataFiber', offset: 0.7 }],
  beamStop:            [{ type: 'coolingWater', offset: 0.5 }],
  detector:            [{ type: 'powerCable', offset: 0.15 }, { type: 'coolingWater', offset: 0.45 }, { type: 'dataFiber', offset: 0.75 }],
  target:              [{ type: 'coolingWater', offset: 0.3 }, { type: 'dataFiber', offset: 0.7 }],
};

const INFRA_OUTPUT_PORTS = {
  substation:          [{ type: 'powerCable', offset: 0.5 }],
  powerPanel:          [{ type: 'powerCable', offset: 0.5 }],
  magnetron:           [{ type: 'rfWaveguide', offset: 0.5 }],
  solidStateAmp:       [{ type: 'rfWaveguide', offset: 0.5 }],
  twt:                 [{ type: 'rfWaveguide', offset: 0.5 }],
  pulsedKlystron:      [{ type: 'rfWaveguide', offset: 0.5 }],
  cwKlystron:          [{ type: 'rfWaveguide', offset: 0.5 }],
  iot:                 [{ type: 'rfWaveguide', offset: 0.5 }],
  multibeamKlystron:   [{ type: 'rfWaveguide', offset: 0.5 }],
  highPowerSSA:        [{ type: 'rfWaveguide', offset: 0.5 }],
  gyrotron:            [{ type: 'rfWaveguide', offset: 0.5 }],
  lcwSkid:             [{ type: 'coolingWater', offset: 0.5 }],
  chiller:             [{ type: 'coolingWater', offset: 0.5 }],
  coolingTower:        [{ type: 'coolingWater', offset: 0.5 }],
  coldBox4K:           [{ type: 'cryoTransfer', offset: 0.5 }],
  coldBox2K:           [{ type: 'cryoTransfer', offset: 0.5 }],
  roughingPump:        [{ type: 'vacuumPipe', offset: 0.5 }],
  turboPump:           [{ type: 'vacuumPipe', offset: 0.5 }],
  ionPump:             [{ type: 'vacuumPipe', offset: 0.5 }],
  negPump:             [{ type: 'vacuumPipe', offset: 0.5 }],
  tiSubPump:           [{ type: 'vacuumPipe', offset: 0.5 }],
  rackIoc:             [{ type: 'dataFiber', offset: 0.5 }],
  timingSystem:        [{ type: 'dataFiber', offset: 0.5 }],
  networkSwitch:       [{ type: 'dataFiber', offset: 0.5 }],
  archiver:            [{ type: 'dataFiber', offset: 0.5 }],
  bpmElectronics:      [{ type: 'dataFiber', offset: 0.5 }],
  blmReadout:          [{ type: 'dataFiber', offset: 0.5 }],
  llrfController:      [{ type: 'dataFiber', offset: 0.5 }],
  patchPanel:          [{ type: 'dataFiber', offset: 0.5 }],
};

export function getUtilityPorts(id) {
  return BEAMLINE_PORTS[id] || INFRA_OUTPUT_PORTS[id] || [];
}

export function isInfraOutput(id) {
  return id in INFRA_OUTPUT_PORTS;
}
```

- [ ] **Step 2: Verify module loads**

Run: open the game in a browser, check console for import errors.

- [ ] **Step 3: Commit**

```bash
git add src/data/utility-ports.js
git commit -m "feat: add utility port assignment data module"
```

---

## Task 2: Utility Port Stub Builder

**Files:**
- Create: `src/renderer3d/utility-port-builder.js`

Generates small colored stub meshes (cylinders for round, boxes for rectangular) on the side faces of components. Called during component/equipment mesh construction. Returns a THREE.Group of stubs to add to the component wrapper.

- [ ] **Step 1: Create the port stub builder**

```js
// src/renderer3d/utility-port-builder.js
//
// Builds colored port stub meshes on component lateral side faces.
// THREE is a CDN global — do NOT import it.

import { getUtilityPorts, UTILITY_PORT_PROFILES } from '../data/utility-ports.js';

const STUB_LENGTH = 0.15;
const PORT_Y = 0.5;
const SEGS = 8;

const _matCache = {};

function getPortMaterial(connType) {
  if (_matCache[connType]) return _matCache[connType];
  const profile = UTILITY_PORT_PROFILES[connType];
  if (!profile) return null;
  const mat = new THREE.MeshStandardMaterial({
    color: profile.color,
    roughness: 0.4,
    metalness: 0.3,
  });
  _matCache[connType] = mat;
  return mat;
}

function createStubGeometry(connType) {
  const profile = UTILITY_PORT_PROFILES[connType];
  if (!profile) return null;
  if (profile.shape === 'rect') {
    return new THREE.BoxGeometry(STUB_LENGTH, profile.height, profile.width);
  }
  return new THREE.CylinderGeometry(profile.radius, profile.radius, STUB_LENGTH, SEGS);
}

/**
 * Build port stubs for a component.
 * @param {string} compId — component or infrastructure ID
 * @param {number} sideHalfW — half-width of the component along X (lateral axis), in world units
 * @param {number} sideLength — length of the component along Z (beam axis), in world units
 * @returns {THREE.Group|null} — group of stub meshes, or null if no ports
 */
export function buildPortStubs(compId, sideHalfW, sideLength) {
  const ports = getUtilityPorts(compId);
  if (!ports || ports.length === 0) return null;

  const group = new THREE.Group();

  for (const port of ports) {
    const profile = UTILITY_PORT_PROFILES[port.type];
    if (!profile) continue;

    const geo = createStubGeometry(port.type);
    if (!geo) continue;
    const mat = getPortMaterial(port.type);

    const zPos = (port.offset - 0.5) * sideLength;

    for (const side of [-1, 1]) {
      const stub = new THREE.Mesh(geo, mat);
      stub.matrixAutoUpdate = false;

      const xPos = side * (sideHalfW + STUB_LENGTH / 2);

      if (profile.shape === 'rect') {
        stub.position.set(xPos, PORT_Y, zPos);
      } else {
        stub.position.set(xPos, PORT_Y, zPos);
        stub.rotation.z = Math.PI / 2;
      }
      stub.updateMatrix();
      group.add(stub);
    }
  }

  return group.children.length > 0 ? group : null;
}
```

- [ ] **Step 2: Verify module loads**

Open the game in a browser, check console for import errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer3d/utility-port-builder.js
git commit -m "feat: add utility port stub builder"
```

---

## Task 3: Integrate Port Stubs into Component Builder

**Files:**
- Modify: `src/renderer3d/component-builder.js` — `_createObject()` method (~line 2135) and imports

Add port stubs to every beamline component mesh during construction.

- [ ] **Step 1: Add import**

At the top of `component-builder.js`, after existing imports, add:

```js
import { buildPortStubs } from './utility-port-builder.js';
```

- [ ] **Step 2: Add port stubs in `_createObject()`**

In `ComponentBuilder._createObject()` (~line 2135), after the visual mesh is added to the wrapper group but before the hitbox, add port stub creation. The component's lateral half-width is `(compDef.subW || compDef.gridW || 2) * SUB_UNIT / 2` and side length is `(compDef.subL || compDef.gridH || 2) * SUB_UNIT`. Find the section where the wrapper group is assembled (after `wrapper.add(visual)` around line 2150) and add:

```js
const portStubs = buildPortStubs(
  compDef.id,
  ((compDef.subW || compDef.gridW || 2) * SUB_UNIT) / 2,
  (compDef.subL || compDef.gridH || 2) * SUB_UNIT,
);
if (portStubs) wrapper.add(portStubs);
```

- [ ] **Step 3: Test visually**

Open the game, place a component that has utility ports (e.g. an RF cavity or quadrupole). Verify colored stubs appear on both lateral sides at ~0.5m height. Stubs should be visible as small colored protrusions.

- [ ] **Step 4: Commit**

```bash
git add src/renderer3d/component-builder.js
git commit -m "feat: render utility port stubs on beamline components"
```

---

## Task 4: Integrate Port Stubs into Equipment Builder

**Files:**
- Modify: `src/renderer3d/equipment-builder.js` — `build()` method and imports

Add port stubs to infrastructure equipment meshes.

- [ ] **Step 1: Add import**

At the top of `equipment-builder.js`, after existing imports:

```js
import { buildPortStubs } from './utility-port-builder.js';
```

- [ ] **Step 2: Add port stubs in `build()`**

In `EquipmentBuilder.build()`, after each equipment mesh is positioned and added to the parent group (around line 200, inside the per-equipment loop), add port stub creation using the equipment's dimensions:

```js
const portStubs = buildPortStubs(
  comp.id,
  ((def.subW || def.gridW || 2) * SUB_UNIT) / 2,
  (def.subL || def.gridH || 2) * SUB_UNIT,
);
if (portStubs) {
  portStubs.position.copy(wrapper.position);
  portStubs.rotation.copy(wrapper.rotation);
  parentGroup.add(portStubs);
}
```

Note: exact integration depends on whether equipment uses a wrapper group pattern (check the build loop structure). If equipment meshes are added directly, create a wrapper or add the port stubs group as a sibling at the same position/rotation.

- [ ] **Step 3: Test visually**

Place infrastructure equipment with output ports (e.g. substation, chiller, klystron). Verify colored stubs appear on both sides.

- [ ] **Step 4: Commit**

```bash
git add src/renderer3d/equipment-builder.js
git commit -m "feat: render utility port stubs on infrastructure equipment"
```

---

## Task 5: Utility Routing Data in World Snapshot

**Files:**
- Modify: `src/renderer3d/world-snapshot.js` — add `buildUtilityRouting()` function

This function computes everything the pipe renderer needs: floor pipe segments with direction/junction info, and per-component port connection state (which side is connected, Z-route endpoints).

- [ ] **Step 1: Add imports**

At the top of `world-snapshot.js`:

```js
import { getUtilityPorts, UTILITY_PORT_PROFILES, isInfraOutput } from '../data/utility-ports.js';
```

- [ ] **Step 2: Add `buildUtilityRouting()` function**

Add after the existing `buildConnections()` function (~line 208):

```js
function buildUtilityRouting(game) {
  const connections = game.state.connections;
  if (!connections || connections.size === 0) return { floorSegments: [], portRoutes: [] };

  const connSet = (col, row) => connections.get(`${col},${row}`) || new Set();

  // ── Floor segments ──
  // For each connection tile, determine which directions have same-type neighbors.
  // This tells the pipe renderer how to draw straight runs, corners, and junctions.
  const floorSegments = [];
  for (const [key, typeSet] of connections) {
    const [col, row] = key.split(',').map(Number);
    for (const type of typeSet) {
      const neighbors = {
        north: connSet(col, row - 1).has(type),
        south: connSet(col, row + 1).has(type),
        west:  connSet(col - 1, row).has(type),
        east:  connSet(col + 1, row).has(type),
      };
      floorSegments.push({ col, row, type, neighbors });
    }
  }

  // ── Port routes (last-meter connections) ──
  // For each beamline component and infrastructure equipment that has utility ports,
  // check if an adjacent tile carries the matching connection type.
  const portRoutes = [];

  // Gather all placed components: beamline nodes + infrastructure placeables
  const placeables = [];

  // Beamline registry nodes
  for (const entry of game.registry.getAll()) {
    for (const node of entry.beamline.getAllNodes()) {
      const def = node.compDef || node;
      if (!def.id) continue;
      const tiles = node.tiles || [{ col: node.col, row: node.row }];
      placeables.push({
        id: def.id,
        col: node.col,
        row: node.row,
        dir: node.dir ?? 0,
        tiles,
        subW: def.subW || def.gridW || 2,
        subL: def.subL || def.gridH || 2,
      });
    }
  }

  // Infrastructure placeables
  const infraPlaceables = game.state.placeables || [];
  for (const p of infraPlaceables) {
    if (p.category === 'equipment' || p.mode === 'infra') {
      const def = p.def || p;
      if (!def.id) continue;
      placeables.push({
        id: def.id,
        col: p.col,
        row: p.row,
        dir: p.dir ?? 0,
        tiles: p.tiles || [{ col: p.col, row: p.row }],
        subW: def.subW || def.gridW || 2,
        subL: def.subL || def.gridH || 2,
      });
    }
  }

  for (const comp of placeables) {
    const ports = getUtilityPorts(comp.id);
    if (!ports || ports.length === 0) continue;

    // Determine the component's lateral sides in world coords.
    // dir 0 = facing +Z (front), left side = -X, right side = +X
    // dir 1 = facing -X, left side = -Z, right side = +Z
    // dir 2 = facing -Z, left side = +X, right side = -X
    // dir 3 = facing +X, left side = +Z, right side = -Z
    //
    // For each port, check if a tile adjacent to the component's left or right side
    // carries the matching connection type.

    const tileSet = new Set(comp.tiles.map(t => `${t.col},${t.row}`));

    // Find tiles adjacent to left side and right side
    const leftAdj = new Set();
    const rightAdj = new Set();
    for (const t of comp.tiles) {
      const leftOffset = [[-1,0],[0,-1],[1,0],[0,1]][comp.dir];
      const rightOffset = [[1,0],[0,1],[-1,0],[0,-1]][comp.dir];
      const lk = `${t.col + leftOffset[0]},${t.row + leftOffset[1]}`;
      const rk = `${t.col + rightOffset[0]},${t.row + rightOffset[1]}`;
      if (!tileSet.has(lk)) leftAdj.add(lk);
      if (!tileSet.has(rk)) rightAdj.add(rk);
    }

    for (const port of ports) {
      let connectedSide = null;

      // Check left side adjacency
      for (const k of leftAdj) {
        const [ac, ar] = k.split(',').map(Number);
        if (connSet(ac, ar).has(port.type)) { connectedSide = 'left'; break; }
      }
      // Check right side if left didn't match
      if (!connectedSide) {
        for (const k of rightAdj) {
          const [ac, ar] = k.split(',').map(Number);
          if (connSet(ac, ar).has(port.type)) { connectedSide = 'right'; break; }
        }
      }

      portRoutes.push({
        compId: comp.id,
        col: comp.col,
        row: comp.row,
        dir: comp.dir,
        portType: port.type,
        portOffset: port.offset,
        subW: comp.subW,
        subL: comp.subL,
        connectedSide,
      });
    }
  }

  return { floorSegments, portRoutes };
}
```

- [ ] **Step 3: Add to snapshot export**

In `buildWorldSnapshot()` (~line 308), add to the returned object:

```js
utilityRouting: buildUtilityRouting(game),
```

- [ ] **Step 4: Test data**

Add a temporary `console.log(snap.utilityRouting)` in `ThreeRenderer._refreshConnections()` to verify the data shape. Place an RF cavity next to a floor network with powerCable + coolingWater + rfWaveguide tiles. Confirm `portRoutes` shows `connectedSide: 'left'` or `'right'` for the matching ports and `null` for unconnected ones. Then remove the console.log.

- [ ] **Step 5: Commit**

```bash
git add src/renderer3d/world-snapshot.js
git commit -m "feat: compute utility routing data in world snapshot"
```

---

## Task 6: Floor Pipe Geometry Renderer

**Files:**
- Create: `src/renderer3d/utility-pipe-builder.js`

Replaces `ConnectionBuilder`. Renders floor-level pipe runs with correct profiles (round, rectangular, jacketed) and side-by-side layout when multiple types share a tile. Also renders Z-route geometry for connected ports.

- [ ] **Step 1: Create the builder with floor pipe rendering**

```js
// src/renderer3d/utility-pipe-builder.js
//
// Renders floor-level utility pipe runs and Z-route connections to component ports.
// THREE is a CDN global — do NOT import it.

import { UTILITY_PORT_PROFILES } from '../data/utility-ports.js';

const FLOOR_Y = 0.05;
const PORT_Y = 0.5;
const STUB_OUT = 0.15;
const SEGS = 8;

// Size order for side-by-side layout: largest on outside, smallest in center.
// sortForSideBySide() interleaves: largest alternates left/right, smallest ends up in the middle.
const SIZE_ORDER = ['cryoTransfer', 'vacuumPipe', 'rfWaveguide', 'coolingWater', 'powerCable', 'dataFiber'];

const _matCache = {};

function getMat(connType) {
  if (_matCache[connType]) return _matCache[connType];
  const p = UTILITY_PORT_PROFILES[connType];
  if (!p) return null;
  _matCache[connType] = new THREE.MeshStandardMaterial({
    color: p.color, roughness: 0.5, metalness: 0.3,
  });
  return _matCache[connType];
}

function pipeRadius(connType) {
  const p = UTILITY_PORT_PROFILES[connType];
  if (!p) return 0.02;
  return p.radius || Math.max(p.width, p.height) / 2;
}

function createPipeSegment(connType, length) {
  const p = UTILITY_PORT_PROFILES[connType];
  if (p.shape === 'rect') {
    return new THREE.BoxGeometry(length, p.height, p.width);
  }
  return new THREE.CylinderGeometry(p.radius, p.radius, length, SEGS);
}

function lateralOffset(types, index) {
  // Side-by-side: center the group, each pipe offset by its diameter + small gap
  let totalWidth = 0;
  const widths = types.map(t => {
    const p = UTILITY_PORT_PROFILES[t];
    return p.shape === 'rect' ? p.width : (p.radius * 2);
  });
  const gap = 0.01;
  for (let i = 0; i < widths.length; i++) totalWidth += widths[i] + (i > 0 ? gap : 0);
  let x = -totalWidth / 2;
  for (let i = 0; i <= index; i++) x += widths[i] / 2 + (i > 0 ? gap + widths[i] / 2 : 0);
  return x - widths[index] / 2 + widths[index] / 2; // center of pipe i
}

export class UtilityPipeBuilder {
  constructor() {
    this._meshes = [];
  }

  build(utilityRouting, parentGroup) {
    this.dispose(parentGroup);
    if (!utilityRouting) return;

    const { floorSegments, portRoutes } = utilityRouting;

    this._buildFloorPipes(floorSegments, parentGroup);
    this._buildZRoutes(portRoutes, parentGroup);
  }

  _buildFloorPipes(segments, parentGroup) {
    // Group segments by tile
    const tileMap = new Map();
    for (const seg of segments) {
      const key = `${seg.col},${seg.row}`;
      if (!tileMap.has(key)) tileMap.set(key, []);
      tileMap.get(key).push(seg);
    }

    for (const [key, segs] of tileMap) {
      const [col, row] = key.split(',').map(Number);
      const cx = col * 2 + 1;
      const cz = row * 2 + 1;

      // Sort by pipe size for side-by-side layout
      const sorted = segs.sort((a, b) =>
        SIZE_ORDER.indexOf(a.type) - SIZE_ORDER.indexOf(b.type)
      );

      const types = sorted.map(s => s.type);

      for (let i = 0; i < sorted.length; i++) {
        const seg = sorted[i];
        const mat = getMat(seg.type);
        if (!mat) continue;

        const latOff = lateralOffset(types, i);

        // Draw pipe segments for each active direction
        const { north, south, east, west } = seg.neighbors;
        const hasNS = north || south;
        const hasEW = east || west;

        // Default: if no neighbors, draw a short marker
        if (!north && !south && !east && !west) {
          const geo = createPipeSegment(seg.type, 0.3);
          const mesh = new THREE.Mesh(geo, mat);
          mesh.matrixAutoUpdate = false;
          mesh.position.set(cx + latOff, FLOOR_Y, cz);
          if (UTILITY_PORT_PROFILES[seg.type].shape !== 'rect') {
            mesh.rotation.z = Math.PI / 2;
          }
          mesh.updateMatrix();
          parentGroup.add(mesh);
          this._meshes.push(mesh);
          continue;
        }

        // N-S run
        if (hasNS) {
          const halfLen = 1.0; // half-tile in world coords
          const startZ = north ? cz - halfLen : cz;
          const endZ = south ? cz + halfLen : cz;
          const length = endZ - startZ;
          if (length > 0.01) {
            const geo = createPipeSegment(seg.type, length);
            const mesh = new THREE.Mesh(geo, mat);
            mesh.matrixAutoUpdate = false;
            if (UTILITY_PORT_PROFILES[seg.type].shape === 'rect') {
              mesh.position.set(cx + latOff, FLOOR_Y, (startZ + endZ) / 2);
              mesh.rotation.y = Math.PI / 2;
            } else {
              mesh.rotation.x = Math.PI / 2;
              mesh.position.set(cx + latOff, FLOOR_Y, (startZ + endZ) / 2);
            }
            mesh.updateMatrix();
            parentGroup.add(mesh);
            this._meshes.push(mesh);
          }
        }

        // E-W run
        if (hasEW) {
          const halfLen = 1.0;
          const startX = west ? cx - halfLen : cx;
          const endX = east ? cx + halfLen : cx;
          const length = endX - startX;
          if (length > 0.01) {
            const geo = createPipeSegment(seg.type, length);
            const mesh = new THREE.Mesh(geo, mat);
            mesh.matrixAutoUpdate = false;
            if (UTILITY_PORT_PROFILES[seg.type].shape === 'rect') {
              mesh.position.set((startX + endX) / 2, FLOOR_Y, cz + latOff);
            } else {
              mesh.rotation.z = Math.PI / 2;
              mesh.position.set((startX + endX) / 2, FLOOR_Y, cz + latOff);
            }
            mesh.updateMatrix();
            parentGroup.add(mesh);
            this._meshes.push(mesh);
          }
        }
      }
    }
  }

  _buildZRoutes(portRoutes, parentGroup) {
    for (const route of portRoutes) {
      if (!route.connectedSide) continue;

      const profile = UTILITY_PORT_PROFILES[route.portType];
      if (!profile) continue;
      const mat = getMat(route.portType);

      // Component center in world coords
      const ccx = route.col * 2 + 1;
      const ccz = route.row * 2 + 1;

      // Half-width along the component's lateral axis
      const halfW = (route.subW * 0.5) / 2;

      // Port Z position along component length
      const halfL = (route.subL * 0.5) / 2;
      const portLocalZ = (route.portOffset - 0.5) * (route.subL * 0.5);

      // Determine world-space port position based on direction and connected side
      const sideSign = route.connectedSide === 'left' ? -1 : 1;

      // Rotate offsets based on component direction
      let portWorldX, portWorldZ;
      const cos = [1, 0, -1, 0][route.dir];
      const sin = [0, -1, 0, 1][route.dir];

      const localX = sideSign * (halfW + STUB_OUT);
      const localZ = portLocalZ;

      portWorldX = ccx + localX * cos - localZ * sin;
      portWorldZ = ccz + localX * sin + localZ * cos;

      // Z-route: 3 segments
      // 1. Horizontal stub (already rendered by port-builder, but we extend it)
      // 2. Vertical drop from PORT_Y to FLOOR_Y
      const r = profile.radius || Math.max(profile.width, profile.height) / 2;

      // Vertical segment
      const vertLen = PORT_Y - FLOOR_Y;
      const vertGeo = createPipeSegment(route.portType, vertLen);
      const vertMesh = new THREE.Mesh(vertGeo, mat);
      vertMesh.matrixAutoUpdate = false;
      vertMesh.position.set(portWorldX, FLOOR_Y + vertLen / 2, portWorldZ);
      vertMesh.updateMatrix();
      parentGroup.add(vertMesh);
      this._meshes.push(vertMesh);

      // Horizontal floor run toward the nearest floor network tile
      // Direction is perpendicular to the component side, pointing outward
      const floorDirX = sideSign * cos;
      const floorDirZ = sideSign * sin;
      const floorRunLen = 0.5;

      const floorGeo = createPipeSegment(route.portType, floorRunLen);
      const floorMesh = new THREE.Mesh(floorGeo, mat);
      floorMesh.matrixAutoUpdate = false;

      const fx = portWorldX + floorDirX * floorRunLen / 2;
      const fz = portWorldZ + floorDirZ * floorRunLen / 2;

      if (profile.shape === 'rect') {
        const angle = Math.atan2(floorDirZ, floorDirX);
        floorMesh.rotation.y = -angle;
        floorMesh.position.set(fx, FLOOR_Y, fz);
      } else {
        floorMesh.rotation.z = Math.PI / 2;
        const angle = Math.atan2(floorDirZ, floorDirX);
        floorMesh.rotation.y = -angle;
        floorMesh.position.set(fx, FLOOR_Y, fz);
      }
      floorMesh.updateMatrix();
      parentGroup.add(floorMesh);
      this._meshes.push(floorMesh);
    }
  }

  dispose(parentGroup) {
    for (const mesh of this._meshes) {
      parentGroup.remove(mesh);
      mesh.geometry.dispose();
    }
    this._meshes = [];
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer3d/utility-pipe-builder.js
git commit -m "feat: add utility pipe builder with floor runs and Z-routes"
```

---

## Task 7: Wire Up New Builders in ThreeRenderer

**Files:**
- Modify: `src/renderer3d/ThreeRenderer.js` — replace ConnectionBuilder with UtilityPipeBuilder

- [ ] **Step 1: Update imports**

Find the import of `ConnectionBuilder` (search for `connection-builder`). Replace with:

```js
import { UtilityPipeBuilder } from './utility-pipe-builder.js';
```

- [ ] **Step 2: Replace constructor initialization**

Find where `this.connectionBuilder = new ConnectionBuilder()` is created in the constructor. Replace with:

```js
this.utilityPipeBuilder = new UtilityPipeBuilder();
```

- [ ] **Step 3: Update `_refreshConnections()`**

Replace the body of `_refreshConnections()` (~line 2413):

```js
_refreshConnections() {
  const snap = buildWorldSnapshot(this.game);
  this.utilityPipeBuilder.build(snap.utilityRouting, this.connectionGroup);
}
```

- [ ] **Step 4: Update dispose**

Find any `this.connectionBuilder.dispose(...)` calls and replace with `this.utilityPipeBuilder.dispose(...)`.

- [ ] **Step 5: Test visually**

Open the game. Paint some floor connection tiles (powerCable, coolingWater, rfWaveguide). Verify:
- Floor-level 3D pipe geometry appears instead of tiny pips
- Multiple types on the same tile run side by side
- Place an RF cavity adjacent to the network — verify Z-route pipes appear connecting its ports to the floor network

- [ ] **Step 6: Commit**

```bash
git add src/renderer3d/ThreeRenderer.js
git commit -m "feat: wire UtilityPipeBuilder into ThreeRenderer, replacing pips"
```

---

## Task 8: Delete Old Connection Builder

**Files:**
- Delete: `src/renderer3d/connection-builder.js`

- [ ] **Step 1: Verify no remaining references**

Search the codebase for `connection-builder` or `ConnectionBuilder`. The only reference should be the old import in ThreeRenderer (already replaced in Task 7). If any other files import it, update them.

- [ ] **Step 2: Delete the file**

```bash
git rm src/renderer3d/connection-builder.js
```

- [ ] **Step 3: Test**

Open the game, verify no console errors. Place and remove connections, verify rendering still works.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: remove old connection-builder (replaced by utility-pipe-builder)"
```

---

## Task 9: Reduce Beam Pipe Radius

**Files:**
- Modify: `src/renderer3d/ThreeRenderer.js` — `_refreshBeamPipes()` constants

Per the spec, the vacuum beam pipe should be slightly thinner to fit the utility pipe scale hierarchy.

- [ ] **Step 1: Update pipe constants**

In `_refreshBeamPipes()` (~line 2437), change:

```js
const PIPE_RADIUS = 0.08;
```

to:

```js
const PIPE_RADIUS = 0.06;
```

Also update `FLANGE_R` proportionally:

```js
const FLANGE_R = 0.12;
```

Check if there's a second `PIPE_RADIUS` declaration further down (~line 2604 for the beam path rendering). Update that too if present.

- [ ] **Step 2: Test visually**

Open the game with a placed beamline. Verify beam pipes look thinner but still proportional (flanges, stands still look right). Compare with utility pipes to confirm the scale hierarchy: beam pipe > cryo > cooling > RF > power > data.

- [ ] **Step 3: Commit**

```bash
git add src/renderer3d/ThreeRenderer.js
git commit -m "visual: reduce beam pipe radius for utility pipe scale hierarchy"
```

---

## Task 10: Visual Polish and Edge Cases

**Files:**
- Modify: `src/renderer3d/utility-pipe-builder.js`
- Modify: `src/renderer3d/utility-port-builder.js`

Handle edge cases and polish the rendering.

- [ ] **Step 1: Handle pipe attachments**

Pipe attachments (quads, BPMs, etc.) don't have fixed tile positions — they're interpolated along beam pipes. In `world-snapshot.js`'s `buildUtilityRouting()`, also iterate over pipe attachments from `buildPipeAttachments(game)` and add their port routes. The attachment's position comes from the pipe interpolation, not a fixed tile. Add after the main placeables loop:

```js
const pipeAttachments = buildPipeAttachments(game);
for (const att of pipeAttachments) {
  const ports = getUtilityPorts(att.type);
  if (!ports || ports.length === 0) continue;

  const attDef = att.def || att;
  for (const port of ports) {
    // For attachments, check connection tiles adjacent to the interpolated position
    const tileCol = Math.round(att.col);
    const tileRow = Math.round(att.row);

    let connectedSide = null;
    const leftOffset = [[-1,0],[0,-1],[1,0],[0,1]][att.dir ?? 0];
    const rightOffset = [[1,0],[0,1],[-1,0],[0,-1]][att.dir ?? 0];

    const lc = tileCol + leftOffset[0], lr = tileRow + leftOffset[1];
    const rc = tileCol + rightOffset[0], rr = tileRow + rightOffset[1];

    if (connSet(lc, lr).has(port.type)) connectedSide = 'left';
    else if (connSet(rc, rr).has(port.type)) connectedSide = 'right';

    portRoutes.push({
      compId: att.type,
      col: att.col,
      row: att.row,
      dir: att.dir ?? 0,
      portType: port.type,
      portOffset: port.offset,
      subW: attDef.subW || attDef.gridW || 2,
      subL: attDef.subL || attDef.gridH || 2,
      connectedSide,
    });
  }
}
```

- [ ] **Step 2: Verify attachment routing**

Place a quadrupole attachment on a beam pipe, with cooling and power networks adjacent. Verify Z-route pipes appear from the quad's side ports down to the floor network.

- [ ] **Step 3: Handle cryo jacketing visual**

In `utility-pipe-builder.js`, add a special case for `cryoTransfer` pipes to render the vacuum jacket — an outer translucent cylinder around the inner pipe:

In `_buildFloorPipes`, after creating the main pipe mesh for a cryoTransfer segment, add:

```js
if (seg.type === 'cryoTransfer') {
  const jacketGeo = new THREE.CylinderGeometry(
    UTILITY_PORT_PROFILES.cryoTransfer.radius * 1.5,
    UTILITY_PORT_PROFILES.cryoTransfer.radius * 1.5,
    length, SEGS
  );
  const jacketMat = new THREE.MeshStandardMaterial({
    color: 0x1a3340, roughness: 0.6, metalness: 0.1, transparent: true, opacity: 0.5,
  });
  const jacket = new THREE.Mesh(jacketGeo, jacketMat);
  jacket.matrixAutoUpdate = false;
  jacket.position.copy(mesh.position);
  jacket.rotation.copy(mesh.rotation);
  jacket.updateMatrix();
  parentGroup.add(jacket);
  this._meshes.push(jacket);
}
```

- [ ] **Step 4: Test full scene**

Build a representative scene: source → quad → RF cavity → cryomodule → beam stop. Add power, cooling, RF, cryo, and data networks adjacent. Verify:
- All port stubs visible on both sides of every component
- Connected ports have Z-route pipes to floor
- Floor pipes run side by side with correct colors and sizes
- Cryo pipes have visible jacket
- No console errors

- [ ] **Step 5: Commit**

```bash
git add src/renderer3d/utility-pipe-builder.js src/renderer3d/utility-port-builder.js src/renderer3d/world-snapshot.js
git commit -m "feat: attachment port routing, cryo jacket visual, edge case handling"
```
