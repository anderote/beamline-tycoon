# Carrier Rack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace floor-level connection tiles with an elevated carrier rack system at 4m height — a structural framework that players place on a 2x2 grid, then paint utility types onto. Heavy pipes hang below, cables sit in a top tray, and vertical drops connect to component ports.

**Architecture:** Add carrier rack as a new infrastructure placeable with 2x2 footprint. Replace `game.state.connections` with `game.state.rackSegments`. Modify network discovery to flood-fill across rack segment adjacency. Create a new 3D builder for rack structure geometry. Rewrite `utility-pipe-builder.js` to render pipes in rack slots and vertical drops instead of floor-level runs.

**Tech Stack:** Three.js (CDN global), existing placeable/placement system, existing network discovery.

**Spec:** `docs/superpowers/specs/2026-04-11-carrier-rack-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/data/carrier-rack.js` | Create | Rack segment data: cost, slot positions, adjacency helpers |
| `src/renderer3d/rack-builder.js` | Create | 3D geometry for rack structure (supports, rails, tray, junctions) |
| `src/renderer3d/utility-pipe-builder.js` | Rewrite | Render pipes in rack slots + vertical drops (replaces floor-level runs) |
| `src/renderer3d/world-snapshot.js` | Modify | `buildRackSegments()` + `buildUtilityRouting()` reads rack data |
| `src/game/Game.js` | Modify | Replace `connections` Map with `rackSegments` Map, add rack placement/removal/painting methods |
| `src/networks/networks.js` | Modify | Flood-fill on rack segment adjacency instead of floor tiles, vertical overlap for equipment/beamline detection |
| `src/input/InputHandler.js` | Modify | Rack placement mode + utility painting onto rack segments |
| `src/renderer3d/ThreeRenderer.js` | Modify | Add rack builder, rack scene group, refresh cycle |
| `src/data/modes.js` | Modify | Add carrier rack to infra categories |
| `src/input/demolishScopes.js` | Modify | Add rack demolition |

**Unchanged:** `src/data/utility-ports.js`, `src/renderer3d/utility-port-builder.js`, `src/renderer3d/component-builder.js`, `src/renderer3d/equipment-builder.js`

---

## Task 1: Rack Data Module

**Files:**
- Create: `src/data/carrier-rack.js`

Defines rack segment constants, slot positions, and adjacency helpers.

- [ ] **Step 1: Create the data module**

```js
// src/data/carrier-rack.js
//
// Carrier rack data: constants, slot positions, adjacency logic.
// Rack segments are 2x2 tiles (4m × 4m). The anchor is the top-left tile.

export const RACK_HEIGHT = 4.0;
export const RACK_TRAY_HEIGHT = 4.0;
export const RACK_RAIL_HEIGHT = 3.7;
export const RACK_PIPE_CENTER_Y = 3.5;
export const RACK_SUPPORT_WIDTH = 0.1;
export const RACK_SIZE = 2; // tiles per side

export const RACK_COST = { funding: 50000 };

// Fixed slot positions for bottom-rail pipes.
// X offset from rack center, looking down the primary axis.
// Ordered left-to-right: cryo, vacuum, RF, cooling.
export const BOTTOM_SLOTS = {
  cryoTransfer: -0.6,
  vacuumPipe:   -0.2,
  rfWaveguide:   0.2,
  coolingWater:   0.6,
};

// Top tray cable positions (X offset from center).
export const TOP_SLOTS = {
  powerCable: -0.3,
  dataFiber:   0.3,
};

// All slot types (bottom + top) for iteration.
export const ALL_SLOTS = { ...BOTTOM_SLOTS, ...TOP_SLOTS };

/**
 * Get the 4 tile positions occupied by a rack segment anchored at (col, row).
 */
export function rackTiles(col, row) {
  return [
    { col, row },
    { col: col + 1, row },
    { col, row: row + 1 },
    { col: col + 1, row: row + 1 },
  ];
}

/**
 * Get cardinal neighbor anchor positions for a rack segment at (col, row).
 * Neighbors are 2 tiles apart because each segment is 2x2.
 */
export function rackNeighborAnchors(col, row) {
  return {
    north: { col, row: row - RACK_SIZE },
    south: { col, row: row + RACK_SIZE },
    west:  { col: col - RACK_SIZE, row },
    east:  { col: col + RACK_SIZE, row },
  };
}

/**
 * Determine junction type from a set of active neighbor directions.
 * @param {{ north: boolean, south: boolean, east: boolean, west: boolean }} neighbors
 * @returns {'isolated'|'end'|'straight'|'bend'|'tee'|'cross'}
 */
export function junctionType(neighbors) {
  const { north, south, east, west } = neighbors;
  const count = [north, south, east, west].filter(Boolean).length;
  if (count === 0) return 'isolated';
  if (count === 1) return 'end';
  if (count === 4) return 'cross';
  if (count === 3) return 'tee';
  if ((north && south) || (east && west)) return 'straight';
  return 'bend';
}

/**
 * Get the rotation angle (radians) for a rack segment based on its neighbors.
 * Used to orient the 3D geometry correctly.
 */
export function junctionRotation(neighbors) {
  const { north, south, east, west } = neighbors;
  const type = junctionType(neighbors);

  if (type === 'straight') {
    return (east || west) ? 0 : Math.PI / 2;
  }
  if (type === 'end') {
    if (east) return 0;
    if (south) return Math.PI / 2;
    if (west) return Math.PI;
    return -Math.PI / 2;
  }
  if (type === 'bend') {
    if (south && east) return 0;
    if (south && west) return Math.PI / 2;
    if (north && west) return Math.PI;
    return -Math.PI / 2;
  }
  if (type === 'tee') {
    if (!north) return 0;
    if (!west) return Math.PI / 2;
    if (!south) return Math.PI;
    return -Math.PI / 2;
  }
  return 0;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/data/carrier-rack.js
git commit -m "feat: add carrier rack data module"
```

---

## Task 2: Game State — Rack Segments

**Files:**
- Modify: `src/game/Game.js`

Replace `game.state.connections` with `game.state.rackSegments`. Add methods for placing/removing rack segments and painting utilities onto them.

- [ ] **Step 1: Read Game.js to find all connection-related code**

Identify all locations where `this.state.connections` is referenced. Key locations:
- Line 85: initialization (`connections: new Map()`)
- Line 205: undo snapshot
- Line 295: undo restore
- Lines 2161-2188: `placeConnection`, `removeConnection`, `getConnectionsAt`
- Line 3038: `validateInfrastructure` passes connections
- Lines 3461-3466: save serialization
- Lines 3522-3530: load deserialization
- Lines 3745-3748: load deserialization (alternate path)

- [ ] **Step 2: Add rackSegments to state initialization**

Find the state initialization block (~line 85). Add alongside the existing `connections` (keep `connections` for now — remove in a later step after network migration):

```js
rackSegments: new Map(),  // "col,row" -> { utilities: Set<connType> }
```

- [ ] **Step 3: Add rack segment methods**

After the existing `getConnectionsAt()` method (~line 2188), add:

```js
// === CARRIER RACK ===

placeRackSegment(col, row) {
  const key = col + ',' + row;
  if (this.state.rackSegments.has(key)) return false;
  this.state.rackSegments.set(key, { utilities: new Set() });
  this.emit('connectionsChanged');
  return true;
}

removeRackSegment(col, row) {
  const key = col + ',' + row;
  if (!this.state.rackSegments.has(key)) return false;
  this.state.rackSegments.delete(key);
  this.emit('connectionsChanged');
  this.validateInfrastructure();
  return true;
}

paintRackUtility(col, row, connType) {
  const key = col + ',' + row;
  const seg = this.state.rackSegments.get(key);
  if (!seg) return false;
  if (seg.utilities.has(connType)) return false;
  seg.utilities.add(connType);
  this.emit('connectionsChanged');
  this.validateInfrastructure();
  return true;
}

removeRackUtility(col, row, connType) {
  const key = col + ',' + row;
  const seg = this.state.rackSegments.get(key);
  if (!seg) return false;
  if (!seg.utilities.has(connType)) return false;
  seg.utilities.delete(connType);
  this.emit('connectionsChanged');
  this.validateInfrastructure();
  return true;
}

getRackSegment(col, row) {
  return this.state.rackSegments.get(col + ',' + row) || null;
}

getRackSegmentAt(tileCol, tileRow) {
  // Check if any rack segment's 2x2 footprint covers this tile.
  // Rack anchors are at even-aligned positions on a 2x2 grid.
  for (const [key, seg] of this.state.rackSegments) {
    const [c, r] = key.split(',').map(Number);
    if (tileCol >= c && tileCol < c + 2 && tileRow >= r && tileRow < r + 2) {
      return { col: c, row: r, ...seg };
    }
  }
  return null;
}
```

- [ ] **Step 4: Add serialization for rackSegments**

Find the save method (~line 3461). After the connections serialization block, add:

```js
const rackObj = {};
for (const [key, seg] of this.state.rackSegments) {
  rackObj[key] = [...seg.utilities];
}
```

And include `rackSegments: rackObj` in the `saveState` object.

Find the load/restore method (~line 3522). After the connections restoration, add:

```js
if (this.state.rackSegments && !(this.state.rackSegments instanceof Map)) {
  const map = new Map();
  for (const [key, arr] of Object.entries(this.state.rackSegments)) {
    map.set(key, { utilities: new Set(arr) });
  }
  this.state.rackSegments = map;
} else if (!this.state.rackSegments) {
  this.state.rackSegments = new Map();
}
```

Do the same for the alternate load path (~line 3745).

- [ ] **Step 5: Add undo snapshot/restore for rackSegments**

Find the undo snapshot (~line 205). Add:

```js
rackSegments: new Map([...this.state.rackSegments].map(([k, v]) => [k, { utilities: new Set(v.utilities) }])),
```

Find the undo restore (~line 295). Add:

```js
this.state.rackSegments = snap.rackSegments;
```

- [ ] **Step 6: Commit**

```bash
git add src/game/Game.js
git commit -m "feat: add rack segment state management to Game"
```

---

## Task 3: Network Discovery on Rack Segments

**Files:**
- Modify: `src/networks/networks.js`

Change `_discoverType` to flood-fill on rack segment adjacency. Change equipment/beamline finding to use vertical overlap (tiles under the rack's 2x2 footprint).

- [ ] **Step 1: Read networks.js and understand current adjacency logic**

Key functions to modify:
- `_discoverType(state, connType)` (~line 29): flood-fill source changes from `state.connections` to `state.rackSegments`
- `_findAdjacentEquipment(state, tileSet)` (~line 79): adjacency changes from cardinal to vertical overlap
- `_findAdjacentBeamline(state, tileSet)` (~line 108): same change

- [ ] **Step 2: Modify `_discoverType` to use rack segments**

Replace the flood-fill to iterate over rack segments instead of connection tiles. Two rack segments are adjacent if their anchors are exactly 2 apart on one axis (since each is 2x2):

```js
_discoverType(state, connType) {
  const segments = state.rackSegments;
  if (!segments || segments.size === 0) return [];

  // Find all rack segments carrying this connType
  const seeds = [];
  for (const [key, seg] of segments) {
    if (seg.utilities.has(connType)) seeds.push(key);
  }
  if (seeds.length === 0) return [];

  const visited = new Set();
  const networks = [];

  for (const seed of seeds) {
    if (visited.has(seed)) continue;

    // Flood-fill from this seed
    const cluster = [];
    const queue = [seed];
    visited.add(seed);

    while (queue.length > 0) {
      const current = queue.shift();
      const [col, row] = current.split(',').map(Number);
      cluster.push({ col, row });

      // Check 4 cardinal neighbors (2 tiles apart)
      const neighbors = [
        [col, row - 2], [col, row + 2],
        [col - 2, row], [col + 2, row],
      ];
      for (const [nc, nr] of neighbors) {
        const nk = nc + ',' + nr;
        if (visited.has(nk)) continue;
        const nseg = segments.get(nk);
        if (nseg && nseg.utilities.has(connType)) {
          visited.add(nk);
          queue.push(nk);
        }
      }
    }

    // Build tile set from rack footprints for equipment/beamline finding
    const tileSet = new Set();
    for (const { col, row } of cluster) {
      tileSet.add(`${col},${row}`);
      tileSet.add(`${col + 1},${row}`);
      tileSet.add(`${col},${row + 1}`);
      tileSet.add(`${col + 1},${row + 1}`);
    }

    const equipment = this._findAdjacentEquipment(state, tileSet);
    const beamlineNodes = this._findAdjacentBeamline(state, tileSet);

    networks.push({ tiles: cluster, tileSet, equipment, beamlineNodes });
  }

  return networks;
},
```

- [ ] **Step 3: Modify `_findAdjacentEquipment` for vertical overlap**

Instead of checking cardinal adjacency to network tiles, check if equipment tiles overlap with rack footprint tiles (the tileSet already includes all 4 tiles per rack segment):

```js
_findAdjacentEquipment(state, tileSet) {
  const found = [];
  const seen = new Set();
  const placeables = state.placeables || [];

  for (const p of placeables) {
    if (p.category !== 'equipment') continue;
    if (seen.has(p.id)) continue;

    const cells = p.cells || [{ col: p.col, row: p.row }];
    // Check if any equipment tile is under the rack footprint
    const overlaps = cells.some(c => tileSet.has(`${c.col},${c.row}`));
    if (!overlaps) {
      // Also check cardinal adjacency to rack tiles for equipment not directly under
      const adjacent = cells.some(c =>
        tileSet.has(`${c.col - 1},${c.row}`) ||
        tileSet.has(`${c.col + 1},${c.row}`) ||
        tileSet.has(`${c.col},${c.row - 1}`) ||
        tileSet.has(`${c.col},${c.row + 1}`)
      );
      if (!adjacent) continue;
    }

    seen.add(p.id);
    found.push({ id: p.id, type: p.type, col: p.col, row: p.row });
  }

  return found;
},
```

- [ ] **Step 4: Modify `_findAdjacentBeamline` for vertical overlap**

Same approach — check if beamline node tiles are under or adjacent to rack footprint:

```js
_findAdjacentBeamline(state, tileSet) {
  const found = [];
  const beamline = state.beamline || [];

  for (const node of beamline) {
    const tiles = node.tiles || [{ col: node.col, row: node.row }];
    const overlaps = tiles.some(t => tileSet.has(`${t.col},${t.row}`));
    if (!overlaps) {
      const adjacent = tiles.some(t =>
        tileSet.has(`${t.col - 1},${t.row}`) ||
        tileSet.has(`${t.col + 1},${t.row}`) ||
        tileSet.has(`${t.col},${t.row - 1}`) ||
        tileSet.has(`${t.col},${t.row + 1}`)
      );
      if (!adjacent) continue;
    }
    found.push(node);
  }

  return found;
},
```

- [ ] **Step 5: Commit**

```bash
git add src/networks/networks.js
git commit -m "feat: network discovery on rack segment adjacency"
```

---

## Task 4: Rack Structure 3D Builder

**Files:**
- Create: `src/renderer3d/rack-builder.js`

Builds the 3D geometry for carrier rack segments: vertical supports, bottom pipe rail, top cable tray, junction-aware geometry.

- [ ] **Step 1: Create the builder**

```js
// src/renderer3d/rack-builder.js
//
// Builds 3D geometry for carrier rack segments.
// THREE is a CDN global — do NOT import it.

import {
  RACK_HEIGHT, RACK_TRAY_HEIGHT, RACK_RAIL_HEIGHT,
  RACK_SUPPORT_WIDTH, RACK_SIZE,
  rackNeighborAnchors, junctionType, junctionRotation,
} from '../data/carrier-rack.js';

const SEGS = 8;
const TILE_W = 2.0; // world units per tile
const RACK_WORLD_SIZE = RACK_SIZE * TILE_W; // 4.0m per segment

let _supportMat, _railMat, _trayMat;

function ensureMaterials() {
  if (_supportMat) return;
  _supportMat = new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.6, metalness: 0.4 });
  _railMat = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.5, metalness: 0.5 });
  _trayMat = new THREE.MeshStandardMaterial({
    color: 0x888888, roughness: 0.7, metalness: 0.3,
    wireframe: false, side: THREE.DoubleSide,
  });
}

function buildSupport(x, z) {
  const w = RACK_SUPPORT_WIDTH;
  const geo = new THREE.BoxGeometry(w, RACK_HEIGHT, w);
  const mesh = new THREE.Mesh(geo, _supportMat);
  mesh.position.set(x, RACK_HEIGHT / 2, z);
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

function buildBottomRail(length, height) {
  const geo = new THREE.BoxGeometry(length, 0.06, 0.08);
  const mesh = new THREE.Mesh(geo, _railMat);
  mesh.position.set(0, height, 0);
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

function buildTray(length) {
  const group = new THREE.Group();
  const trayW = 1.2;
  const trayH = 0.05;
  const lipH = 0.12;

  // Bottom panel
  const bottom = new THREE.Mesh(
    new THREE.BoxGeometry(length, trayH, trayW),
    _trayMat
  );
  bottom.position.set(0, RACK_TRAY_HEIGHT, 0);
  bottom.matrixAutoUpdate = false;
  bottom.updateMatrix();
  group.add(bottom);

  // Side lips
  for (const side of [-1, 1]) {
    const lip = new THREE.Mesh(
      new THREE.BoxGeometry(length, lipH, trayH),
      _trayMat
    );
    lip.position.set(0, RACK_TRAY_HEIGHT + lipH / 2, side * trayW / 2);
    lip.matrixAutoUpdate = false;
    lip.updateMatrix();
    group.add(lip);
  }

  return group;
}

export class RackBuilder {
  constructor() {
    this._meshes = [];
  }

  build(rackData, parentGroup) {
    this.dispose(parentGroup);
    ensureMaterials();
    if (!rackData || rackData.length === 0) return;

    for (const seg of rackData) {
      const cx = seg.col * TILE_W + RACK_WORLD_SIZE / 2;
      const cz = seg.row * TILE_W + RACK_WORLD_SIZE / 2;

      const wrapper = new THREE.Group();
      wrapper.position.set(cx, 0, cz);

      const rot = junctionRotation(seg.neighbors);
      if (rot !== 0) wrapper.rotation.y = rot;

      // Supports — 2 per lateral side, at ends of segment
      const halfSize = RACK_WORLD_SIZE / 2 - 0.2;
      const sideOff = RACK_WORLD_SIZE / 2 - 0.15;
      wrapper.add(buildSupport(-sideOff, -halfSize));
      wrapper.add(buildSupport(-sideOff,  halfSize));
      wrapper.add(buildSupport( sideOff, -halfSize));
      wrapper.add(buildSupport( sideOff,  halfSize));

      // Bottom rail
      const rail = buildBottomRail(RACK_WORLD_SIZE, RACK_RAIL_HEIGHT);
      wrapper.add(rail);

      // Top cable tray
      const tray = buildTray(RACK_WORLD_SIZE);
      wrapper.add(tray);

      // Extend rails/tray for connected sides
      const { north, south, east, west } = seg.neighbors;
      // Junction extensions are handled by adjacent segments overlapping —
      // each segment draws its own full-length rails/tray, and the overlap
      // at junctions creates a solid visual. No special junction geometry needed
      // for the structural parts.

      wrapper.matrixAutoUpdate = false;
      wrapper.updateMatrix();

      parentGroup.add(wrapper);
      this._meshes.push(wrapper);
    }
  }

  dispose(parentGroup) {
    for (const obj of this._meshes) {
      parentGroup.remove(obj);
      obj.traverse(child => {
        if (child.isMesh && child.geometry) child.geometry.dispose();
      });
    }
    this._meshes = [];
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer3d/rack-builder.js
git commit -m "feat: add carrier rack 3D builder"
```

---

## Task 5: Rewrite Utility Pipe Builder for Rack

**Files:**
- Rewrite: `src/renderer3d/utility-pipe-builder.js`

Replace floor-level pipe rendering with rack-slot pipe rendering and vertical drops.

- [ ] **Step 1: Rewrite the file**

The builder now receives rack-based routing data instead of floor segments. Pipes render at rack height in their fixed slot positions. Vertical drops go from rack height down to component port height.

```js
// src/renderer3d/utility-pipe-builder.js
//
// Renders utility pipes in carrier rack slots and vertical drops to component ports.
// THREE is a CDN global — do NOT import it.

import { UTILITY_PORT_PROFILES } from '../data/utility-ports.js';
import {
  RACK_RAIL_HEIGHT, RACK_TRAY_HEIGHT, RACK_PIPE_CENTER_Y,
  RACK_SIZE, BOTTOM_SLOTS, TOP_SLOTS, ALL_SLOTS,
} from '../data/carrier-rack.js';

const PORT_Y = 0.5;
const STUB_OUT = 0.15;
const SEGS = 8;
const TILE_W = 2.0;
const RACK_WORLD_SIZE = RACK_SIZE * TILE_W;

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

function pipeWidth(connType) {
  const p = UTILITY_PORT_PROFILES[connType];
  if (!p) return 0.04;
  if (p.shape === 'rect') return p.width;
  return p.radius * 2;
}

function createPipeSegment(connType, length) {
  const p = UTILITY_PORT_PROFILES[connType];
  if (p.shape === 'rect') {
    return new THREE.BoxGeometry(length, p.height, p.width);
  }
  return new THREE.CylinderGeometry(p.radius, p.radius, length, SEGS);
}

export class UtilityPipeBuilder {
  constructor() {
    this._meshes = [];
    this._jacketMat = null;
  }

  build(utilityRouting, parentGroup) {
    this.dispose(parentGroup);
    if (!utilityRouting) return;

    const { rackPipes, portRoutes } = utilityRouting;

    if (rackPipes) this._buildRackPipes(rackPipes, parentGroup);
    if (portRoutes) this._buildVerticalDrops(portRoutes, parentGroup);
  }

  _addMesh(mesh, parentGroup) {
    parentGroup.add(mesh);
    this._meshes.push(mesh);
  }

  _buildRackPipes(rackPipes, parentGroup) {
    // rackPipes: array of { col, row, type, neighbors, isBottom }
    // Each entry represents one utility type on one rack segment.

    for (const pipe of rackPipes) {
      const mat = getMat(pipe.type);
      if (!mat) continue;
      const profile = UTILITY_PORT_PROFILES[pipe.type];

      const cx = pipe.col * TILE_W + RACK_WORLD_SIZE / 2;
      const cz = pipe.row * TILE_W + RACK_WORLD_SIZE / 2;

      // Slot X offset from rack center
      const slotX = ALL_SLOTS[pipe.type] ?? 0;

      // Pipe Y: bottom pipes hang below rail, top cables sit in tray
      const pipeY = pipe.isBottom ? RACK_PIPE_CENTER_Y : RACK_TRAY_HEIGHT + 0.03;

      // Draw pipe along the segment's primary axis (Z by default).
      // For each direction with a neighbor, extend to edge of segment.
      const { north, south, east, west } = pipe.neighbors;
      const hasNS = north || south;
      const hasEW = east || west;

      // If no neighbors, short marker
      if (!north && !south && !east && !west) {
        const geo = createPipeSegment(pipe.type, 1.0);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.matrixAutoUpdate = false;
        if (profile.shape === 'rect') {
          mesh.position.set(cx + slotX, pipeY, cz);
        } else {
          mesh.rotation.z = Math.PI / 2;
          mesh.position.set(cx + slotX, pipeY, cz);
        }
        mesh.updateMatrix();
        this._addMesh(mesh, parentGroup);
        this._maybeAddJacket(pipe.type, mesh, 1.0, parentGroup);
        continue;
      }

      // N-S run
      if (hasNS) {
        const half = RACK_WORLD_SIZE / 2;
        const startZ = north ? cz - half : cz;
        const endZ = south ? cz + half : cz;
        const length = endZ - startZ;
        if (length > 0.01) {
          const geo = createPipeSegment(pipe.type, length);
          const mesh = new THREE.Mesh(geo, mat);
          mesh.matrixAutoUpdate = false;
          if (profile.shape === 'rect') {
            mesh.position.set(cx + slotX, pipeY, (startZ + endZ) / 2);
            mesh.rotation.y = Math.PI / 2;
          } else {
            mesh.rotation.x = Math.PI / 2;
            mesh.position.set(cx + slotX, pipeY, (startZ + endZ) / 2);
          }
          mesh.updateMatrix();
          this._addMesh(mesh, parentGroup);
          this._maybeAddJacket(pipe.type, mesh, length, parentGroup);
        }
      }

      // E-W run
      if (hasEW) {
        const half = RACK_WORLD_SIZE / 2;
        const startX = west ? cx - half : cx;
        const endX = east ? cx + half : cx;
        const length = endX - startX;
        if (length > 0.01) {
          const geo = createPipeSegment(pipe.type, length);
          const mesh = new THREE.Mesh(geo, mat);
          mesh.matrixAutoUpdate = false;
          if (profile.shape === 'rect') {
            mesh.position.set((startX + endX) / 2 + slotX, pipeY, cz);
          } else {
            mesh.rotation.z = Math.PI / 2;
            mesh.position.set((startX + endX) / 2, pipeY, cz + slotX);
          }
          mesh.updateMatrix();
          this._addMesh(mesh, parentGroup);
          this._maybeAddJacket(pipe.type, mesh, length, parentGroup);
        }
      }
    }
  }

  _maybeAddJacket(connType, innerMesh, length, parentGroup) {
    if (connType !== 'cryoTransfer') return;
    const r = UTILITY_PORT_PROFILES.cryoTransfer.radius * 1.5;
    const jacketGeo = new THREE.CylinderGeometry(r, r, length, SEGS);
    if (!this._jacketMat) {
      this._jacketMat = new THREE.MeshStandardMaterial({
        color: 0x1a3340, roughness: 0.6, metalness: 0.1, transparent: true, opacity: 0.5,
      });
    }
    const jacket = new THREE.Mesh(jacketGeo, this._jacketMat);
    jacket.matrixAutoUpdate = false;
    jacket.position.copy(innerMesh.position);
    jacket.rotation.copy(innerMesh.rotation);
    jacket.updateMatrix();
    this._addMesh(jacket, parentGroup);
  }

  _buildVerticalDrops(portRoutes, parentGroup) {
    for (const route of portRoutes) {
      if (!route.rackCol && route.rackCol !== 0) continue; // no rack overhead

      const profile = UTILITY_PORT_PROFILES[route.portType];
      if (!profile) continue;
      const mat = getMat(route.portType);

      // Rack slot world position
      const slotX = ALL_SLOTS[route.portType] ?? 0;
      const isBottom = route.portType in BOTTOM_SLOTS;
      const rackY = isBottom ? RACK_PIPE_CENTER_Y : RACK_TRAY_HEIGHT;

      const rackCx = route.rackCol * TILE_W + RACK_WORLD_SIZE / 2;
      const rackCz = route.rackRow * TILE_W + RACK_WORLD_SIZE / 2;

      // Vertical drop from rack slot to component port height
      const dropStartY = rackY;
      const dropEndY = PORT_Y;
      const dropLen = dropStartY - dropEndY;

      // Component port world position
      const compCx = route.col * 2 + 1;
      const compCz = route.row * 2 + 1;

      // Vertical pipe at rack slot X, dropping straight down
      const vertGeo = createPipeSegment(route.portType, dropLen);
      const vertMesh = new THREE.Mesh(vertGeo, mat);
      vertMesh.matrixAutoUpdate = false;
      // Position at rack center + slot offset, vertically between rack and port
      vertMesh.position.set(rackCx + slotX, dropEndY + dropLen / 2, rackCz);
      vertMesh.updateMatrix();
      this._addMesh(vertMesh, parentGroup);

      // Horizontal stub from drop point to component port
      const dx = compCx - (rackCx + slotX);
      const dz = compCz - rackCz;
      const horizLen = Math.sqrt(dx * dx + dz * dz);
      if (horizLen > 0.1) {
        const horizGeo = createPipeSegment(route.portType, horizLen);
        const horizMesh = new THREE.Mesh(horizGeo, mat);
        horizMesh.matrixAutoUpdate = false;
        const angle = Math.atan2(dz, dx);
        if (profile.shape === 'rect') {
          horizMesh.rotation.y = -angle;
        } else {
          horizMesh.rotation.z = Math.PI / 2;
          horizMesh.rotation.y = -angle;
        }
        horizMesh.position.set(
          (rackCx + slotX + compCx) / 2,
          PORT_Y,
          (rackCz + compCz) / 2
        );
        horizMesh.updateMatrix();
        this._addMesh(horizMesh, parentGroup);
      }
    }
  }

  dispose(parentGroup) {
    for (const mesh of this._meshes) {
      parentGroup.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
    }
    this._meshes = [];
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer3d/utility-pipe-builder.js
git commit -m "feat: rewrite utility pipe builder for carrier rack slots"
```

---

## Task 6: World Snapshot — Rack Data

**Files:**
- Modify: `src/renderer3d/world-snapshot.js`

Replace `buildConnections()` + `buildUtilityRouting()` with rack-aware versions.

- [ ] **Step 1: Add import**

Add at the top, after existing imports:

```js
import { rackNeighborAnchors, BOTTOM_SLOTS, TOP_SLOTS, rackTiles } from '../data/carrier-rack.js';
```

- [ ] **Step 2: Add `buildRackSegments()` function**

After the existing `buildConnections()` function, add:

```js
function buildRackSegments(game) {
  const segs = game.state.rackSegments;
  if (!segs || segs.size === 0) return [];

  const result = [];
  for (const [key, seg] of segs) {
    const [col, row] = key.split(',').map(Number);
    const anchors = rackNeighborAnchors(col, row);
    const neighbors = {
      north: segs.has(`${anchors.north.col},${anchors.north.row}`),
      south: segs.has(`${anchors.south.col},${anchors.south.row}`),
      east:  segs.has(`${anchors.east.col},${anchors.east.row}`),
      west:  segs.has(`${anchors.west.col},${anchors.west.row}`),
    };
    result.push({ col, row, utilities: [...seg.utilities], neighbors });
  }
  return result;
}
```

- [ ] **Step 3: Rewrite `buildUtilityRouting()` for rack**

Replace the existing `buildUtilityRouting()` function body. It now reads rack segments instead of floor connection tiles:

```js
function buildUtilityRouting(game) {
  const segs = game.state.rackSegments;
  if (!segs || segs.size === 0) return { rackPipes: [], portRoutes: [] };

  // ── Rack pipes ──
  const rackPipes = [];
  for (const [key, seg] of segs) {
    const [col, row] = key.split(',').map(Number);
    const anchors = rackNeighborAnchors(col, row);

    for (const type of seg.utilities) {
      // Check which neighbors also carry this type
      const neighbors = {
        north: false, south: false, east: false, west: false,
      };
      for (const [dir, a] of Object.entries(anchors)) {
        const nseg = segs.get(`${a.col},${a.row}`);
        if (nseg && nseg.utilities.has(type)) neighbors[dir] = true;
      }

      const isBottom = type in BOTTOM_SLOTS;
      rackPipes.push({ col, row, type, neighbors, isBottom });
    }
  }

  // ── Port routes (vertical drops) ──
  const portRoutes = [];

  // Gather all placed components
  const placeables = [];

  for (const entry of game.registry.getAll()) {
    for (const node of entry.beamline.getAllNodes()) {
      const def = node.compDef || node;
      const compId = def.id || node.type;
      if (!compId) continue;
      placeables.push({
        id: compId,
        col: node.col,
        row: node.row,
        dir: node.dir ?? 0,
        tiles: node.tiles || [{ col: node.col, row: node.row }],
        subW: def.subW || def.gridW || 2,
        subL: def.subL || def.gridH || 2,
      });
    }
  }

  const infraPlaceables = game.state.placeables || [];
  for (const p of infraPlaceables) {
    if (p.category === 'equipment' || p.category === 'infrastructure') {
      const compId = p.type || p.id;
      if (!compId) continue;
      placeables.push({
        id: compId,
        col: p.col,
        row: p.row,
        dir: p.dir ?? 0,
        tiles: p.cells ? p.cells.map(c => ({ col: c.col, row: c.row })) : [{ col: p.col, row: p.row }],
        subW: p.subW || p.gridW || 2,
        subL: p.subL || p.gridH || 2,
      });
    }
  }

  // Pipe attachments
  const pipeAttachments = buildPipeAttachments(game);
  for (const att of pipeAttachments) {
    placeables.push({
      id: att.type,
      col: att.col,
      row: att.row,
      dir: att.direction ?? 0,
      tiles: [{ col: Math.round(att.col), row: Math.round(att.row) }],
      subW: 2,
      subL: 2,
    });
  }

  for (const comp of placeables) {
    const ports = getUtilityPorts(comp.id);
    if (!ports || ports.length === 0) continue;

    // Find rack segment overhead
    let rackSeg = null;
    for (const t of comp.tiles) {
      for (const [key, seg] of segs) {
        const [rc, rr] = key.split(',').map(Number);
        if (t.col >= rc && t.col < rc + 2 && t.row >= rr && t.row < rr + 2) {
          rackSeg = { col: rc, row: rr, seg };
          break;
        }
      }
      if (rackSeg) break;
    }

    for (const port of ports) {
      const connected = rackSeg && rackSeg.seg.utilities.has(port.type);

      portRoutes.push({
        compId: comp.id,
        col: comp.col,
        row: comp.row,
        dir: comp.dir,
        portType: port.type,
        portOffset: port.offset,
        subW: comp.subW,
        subL: comp.subL,
        rackCol: connected ? rackSeg.col : null,
        rackRow: connected ? rackSeg.row : null,
      });
    }
  }

  return { rackPipes, portRoutes };
}
```

- [ ] **Step 4: Add rackSegments to snapshot export**

In `buildWorldSnapshot()`, add:

```js
rackSegments: buildRackSegments(game),
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer3d/world-snapshot.js
git commit -m "feat: world snapshot builds rack segments and rack-based routing"
```

---

## Task 7: Wire Rack Builder into ThreeRenderer

**Files:**
- Modify: `src/renderer3d/ThreeRenderer.js`

Add the rack builder, a new scene group, and refresh it on `connectionsChanged`.

- [ ] **Step 1: Add import**

After existing imports, add:

```js
import { RackBuilder } from './rack-builder.js';
```

- [ ] **Step 2: Add builder and group in constructor**

Near the other builder initializations (~line 110):

```js
this.rackBuilder = new RackBuilder();
```

Near the other group creations (~line 276):

```js
this.rackGroup = new THREE.Group();
this.rackGroup.name = 'carrierRacks';
this.scene.add(this.rackGroup);
```

- [ ] **Step 3: Add `_refreshRack()` method**

Near `_refreshConnections()`:

```js
_refreshRack() {
  const snap = buildWorldSnapshot(this.game);
  this.rackBuilder.build(snap.rackSegments, this.rackGroup);
}
```

- [ ] **Step 4: Call `_refreshRack()` from `_refreshConnections()`**

Update `_refreshConnections()` to also refresh the rack:

```js
_refreshConnections() {
  const snap = buildWorldSnapshot(this.game);
  this.rackBuilder.build(snap.rackSegments, this.rackGroup);
  this.utilityPipeBuilder.build(snap.utilityRouting, this.connectionGroup);
}
```

- [ ] **Step 5: Update initial build**

In `loadAssets()` where `snapshot.utilityRouting` is used, also build the rack:

```js
this.rackBuilder.build(snapshot.rackSegments, this.rackGroup);
```

- [ ] **Step 6: Commit**

```bash
git add src/renderer3d/ThreeRenderer.js
git commit -m "feat: wire RackBuilder into ThreeRenderer"
```

---

## Task 8: Input Handling — Rack Placement and Utility Painting

**Files:**
- Modify: `src/input/InputHandler.js`

Add rack placement mode (click to place 2x2 rack segments) and modify utility painting to target rack segments instead of floor tiles.

- [ ] **Step 1: Read InputHandler.js connection drawing flow**

Understand the existing `selectedConnTool`, `isDrawingConn`, mouse down/move/up handlers at lines 1420-1850. The painting flow needs to change: instead of calling `game.placeConnection(col, row, connType)`, it should call `game.paintRackUtility(col, row, connType)` where (col, row) is the anchor of the rack segment under the cursor.

- [ ] **Step 2: Add rack tool state**

Near the existing connection tool state (~line 81):

```js
this.selectedRackTool = false; // true when placing rack segments
```

- [ ] **Step 3: Modify connection painting to target rack segments**

In the mouse-up handler for connection drawing (~line 1837), replace the per-tile loop:

Old pattern:
```js
game.placeConnection(col, row, connType)
```

New pattern:
```js
// Find rack segment at this tile
const rackSeg = game.getRackSegmentAt(col, row);
if (rackSeg) {
  game.paintRackUtility(rackSeg.col, rackSeg.row, connType);
}
```

And for remove mode:
```js
const rackSeg = game.getRackSegmentAt(col, row);
if (rackSeg) {
  game.removeRackUtility(rackSeg.col, rackSeg.row, connType);
}
```

- [ ] **Step 4: Add rack placement handler**

Add a method for placing rack segments. When `selectedRackTool` is true, clicking places a 2x2 rack segment at the snapped 2x2 grid position:

```js
_handleRackPlace(worldX, worldY) {
  const { col, row } = this._snapToRackGrid(worldX, worldY);
  this.game.placeRackSegment(col, row);
}

_snapToRackGrid(worldX, worldY) {
  const grid = this.isoToGrid(worldX, worldY);
  // Snap to even-aligned 2x2 grid
  const col = Math.floor(grid.col / 2) * 2;
  const row = Math.floor(grid.row / 2) * 2;
  return { col, row };
}
```

Wire this into the mousedown handler: when `selectedRackTool` is true and left-clicking, call `_handleRackPlace()`. Support click-drag for placing multiple segments by tracking the drag path snapped to the 2x2 grid.

- [ ] **Step 5: Add rack tool selection**

Add methods to select/deselect the rack placement tool:

```js
selectRackTool() {
  this.deselectAllTools();
  this.selectedRackTool = true;
}

deselectRackTool() {
  this.selectedRackTool = false;
}
```

Include `this.selectedRackTool = false` in `deselectAllTools()`.

- [ ] **Step 6: Commit**

```bash
git add src/input/InputHandler.js
git commit -m "feat: rack placement and utility painting in input handler"
```

---

## Task 9: UI Integration — Modes and Demolition

**Files:**
- Modify: `src/data/modes.js` — add carrier rack to infra categories
- Modify: `src/input/demolishScopes.js` — add rack demolition

- [ ] **Step 1: Add carrier rack to modes**

In `src/data/modes.js`, within the `infra` mode categories, add a new entry or add the rack to an existing category (e.g. `ops` or a new `distribution` category):

```js
distribution: {
  name: 'Distribution',
  items: ['carrierRack'],
},
```

- [ ] **Step 2: Add rack demolition scope**

In `src/input/demolishScopes.js`, add `'rack'` to the `DEMOLISH_STANDALONE` set or handle it under `demolishUtility`:

The existing `demolishUtility` scope should handle rack segments. In the demolish handler in InputHandler.js, when `demolishUtility` is active and the user clicks, check for a rack segment at the clicked tile and call `game.removeRackSegment(col, row)`.

- [ ] **Step 3: Commit**

```bash
git add src/data/modes.js src/input/demolishScopes.js
git commit -m "feat: add carrier rack to infra modes and demolition"
```

---

## Task 10: Remove Legacy Connection System

**Files:**
- Modify: `src/game/Game.js` — remove `placeConnection`, `removeConnection`, `getConnectionsAt`, `state.connections`
- Modify: `src/renderer3d/world-snapshot.js` — remove `buildConnections()`
- Clean up any remaining references

- [ ] **Step 1: Search for all references to the old connection system**

Search for: `placeConnection`, `removeConnection`, `getConnectionsAt`, `state.connections`, `connectionsChanged` (keep the event name — it's reused by rack methods).

- [ ] **Step 2: Remove old connection methods from Game.js**

Remove `placeConnection()`, `removeConnection()`, `getConnectionsAt()` methods. Keep `hasValidConnection()` but update it to check rack segments instead.

Update `hasValidConnection()` to check if a rack segment overhead carries the matching type:

```js
hasValidConnection(node, connType) {
  const tiles = node.tiles || [{ col: node.col, row: node.row }];
  for (const t of tiles) {
    const rackSeg = this.getRackSegmentAt(t.col, t.row);
    if (rackSeg && rackSeg.utilities && rackSeg.utilities.has(connType)) return true;
  }
  return false;
}
```

- [ ] **Step 3: Remove `state.connections` initialization**

Remove `connections: new Map()` from state init. Remove serialization/deserialization of connections. Remove undo snapshot/restore of connections.

- [ ] **Step 4: Remove `buildConnections()` from world-snapshot.js**

Remove the function and its reference in `buildWorldSnapshot()` return object. The `connections` field is no longer in the snapshot.

- [ ] **Step 5: Verify no remaining references**

Search codebase for `state.connections`, `placeConnection`, `removeConnection`, `buildConnections`. Fix any remaining references.

- [ ] **Step 6: Commit**

```bash
git add src/game/Game.js src/renderer3d/world-snapshot.js
git commit -m "chore: remove legacy floor connection system"
```
