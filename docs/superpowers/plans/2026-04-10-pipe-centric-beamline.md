# Pipe-Centric Beamline Refactor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify beamline building so pipes are roads drawn between modules, with small components becoming inline attachments on pipes.

**Architecture:** Modules (sources, cavities, dipoles, detectors) are placed freely on the grid and have named ports (entry/exit beam connection points). Pipes are drawn click-and-drag between module ports to connect them. Attachments (quads, BPMs, apertures, bellows) are placed onto existing pipe segments and stored as ordered inline elements. The beam graph is derived from pipe connectivity: BFS from sources through pipes, with attachments injected in order along each pipe edge. The old `Beamline` parent-child graph class is kept alive but becomes legacy — the main map no longer uses it. The **BeamlineDesigner** is adapted to be a *flattened view* of a chosen source→endpoint path through the pipe graph: it walks the graph, produces an ordered list of modules + pipe drift segments + inline attachments, and renders them along the s-axis exactly as it does today. Editing in the designer modifies the underlying placeables and pipe attachments directly. Splitters and multi-path selection are deferred.

**Tech Stack:** Vanilla JS, PixiJS (2D), Three.js (3D), existing placeable system

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/data/components.js` | Modify | Add `placement: 'module'\|'attachment'` and `ports` definitions to each component |
| `src/beamline/Beamline.js` | Keep (legacy) | Preserved so the designer's internal chain representation can coexist; main map no longer uses it |
| `src/beamline/BeamlineRegistry.js` | Keep (legacy) | Same — designer-only |
| `src/beamline/path-flattener.js` | Create | New helper: walks pipe graph from a source and produces an ordered linear draft (modules + pipe drift + inline attachments) |
| `src/game/Game.js` | Modify | Remove old Beamline/Registry usage *from main map*, update `_deriveBeamGraph()` to handle attachments, simplify pipe creation, update `placeSource()` to use placeable system |
| `src/input/InputHandler.js` | Modify | Simplify beam pipe drawing (always port-to-port), add attachment-on-pipe placement |
| `src/ui/BeamlineDesigner.js` | Modify | Edit mode reads from pipe graph via flattener; reconciliation applies param edits + attachment add/remove back to placeables and pipes |
| `src/ui/DesignPlacer.js` | Rewrite | Place a saved design by emitting `placePlaceable` for modules + `createBeamPipe` for links + `addAttachmentToPipe` for inline elements |
| `src/renderer3d/ThreeRenderer.js` | Modify | Render attachments on pipes, update beam pipe preview |
| `src/renderer3d/component-builder.js` | Modify | Build attachment meshes at pipe positions |
| `src/renderer3d/world-snapshot.js` | Modify | Include attachments in snapshot, update beam path building |
| `src/renderer/Renderer.js` | Modify | 2D rendering updates for attachments on pipes |

---

### Task 1: Classify Components as Module vs Attachment

**Files:**
- Modify: `src/data/components.js`

This task adds a `placement` property to every component and `ports` to modules. No behavior changes — purely data annotation.

- [ ] **Step 1: Define the classification rules**

Modules (`placement: 'module'`) — things that occupy grid tiles and have beam ports:
- All sources (`isSource`)
- All RF/accelerating structures (category `rf`)
- Dipoles, SC dipoles, combined function magnets (`isDipole` or has `bendAngle`)
- Splitters
- All endpoints (`isEndpoint`)
- Undulators, wigglers, APPLE-II (large insertion devices)
- Chicane, dogleg (multi-dipole assemblies)
- Solenoid (large floor-mounted magnet)

Attachments (`placement: 'attachment'`) — things that go inline on a pipe:
- Quadrupole, sextupole, octupole, SC quad
- Corrector
- All diagnostics (BPM, screen, ICT, wire scanner, bunch length monitor, energy spectrometer, beam loss monitor, SR light monitor)
- Aperture, collimator, velocity selector, emittance filter
- Bellows
- Gate valve
- Kicker magnet, septum magnet, stripper foil
- Ion pump, NEG pump, turbo pump, cryo pump, NEG coating (vacuum)

- [ ] **Step 2: Add `placement` and `ports` to all components**

Add to each component definition. Modules get `ports` — an object describing beam entry/exit points relative to the component. For linac-phase simplicity, most modules have one `entry` and one `exit` port along the beam axis. Dipoles have `entry` on the incoming axis and `exit` at the bend angle. Splitters have `entry`, `exitStraight`, and `exitBranch`.

```js
// Example: source
source: {
  // ... existing fields ...
  placement: 'module',
  ports: {
    exit: { side: 'front' },  // beam leaves along dir
  },
},

// Example: rfCavity  
rfCavity: {
  // ... existing fields ...
  placement: 'module',
  ports: {
    entry: { side: 'back' },   // beam enters opposite to dir
    exit:  { side: 'front' },  // beam exits along dir
  },
},

// Example: dipole
dipole: {
  // ... existing fields ...
  placement: 'module',
  ports: {
    entry: { side: 'back' },
    exit:  { side: 'front' },  // front is post-bend direction
  },
},

// Example: splitter
splitter: {
  // ... existing fields ...
  placement: 'module',
  ports: {
    entry:        { side: 'back' },
    exitStraight: { side: 'front' },
    exitBranch:   { side: 'left' },
  },
},

// Example: detector (endpoint)
detector: {
  // ... existing fields ...
  placement: 'module',
  ports: {
    entry: { side: 'back' },
  },
},

// Example: quadrupole (attachment)
quadrupole: {
  // ... existing fields ...
  placement: 'attachment',
  // No ports — inline on pipe
},

// Example: bpm (attachment)
bpm: {
  // ... existing fields ...
  placement: 'attachment',
},
```

Go through every component in `components.js` and add the appropriate `placement` field. Sources only have `exit` port. Endpoints only have `entry` port. Everything else has both `entry` and `exit`. Attachments get no `ports`.

- [ ] **Step 3: Verify no component is missing classification**

Add a self-check at the bottom of `components.js`:

```js
// Validate: every component must have a placement type
for (const [key, comp] of Object.entries(COMPONENTS)) {
  if (!comp.placement) {
    console.warn(`Component '${key}' missing placement type`);
  }
  if (comp.placement === 'module' && !comp.ports) {
    console.warn(`Module '${key}' missing ports definition`);
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/data/components.js
git commit -m "data: classify components as module vs attachment, add port definitions"
```

---

### Task 2: Rework Beam Pipe Data Model

**Files:**
- Modify: `src/game/Game.js` (state shape, `createBeamPipe`, `removeBeamPipe`, `_deriveBeamGraph`)

Currently beam pipes store `fromId`/`toId` as placeable IDs with a tile `path`. We need to also track:
- Which ports are connected (`fromPort`, `toPort`)
- Inline attachments on this pipe segment (`attachments: []`)

- [ ] **Step 1: Update state shape for beam pipes**

In the `Game` constructor, the existing `beamPipes` array already has the right location. Update the comment to reflect the new shape:

```js
// Beam pipe connections (drawn between module ports)
beamPipes: [],  // [{ id, fromId, fromPort, toId, toPort, path: [{col,row}], subL, attachments: [{id, type, position, params}] }]
beamPipeNextId: 1,
```

- [ ] **Step 2: Update `createBeamPipe` to accept port names**

```js
createBeamPipe(fromId, fromPort, toId, toPort, path) {
  const from = this.getPlaceable(fromId);
  const to = this.getPlaceable(toId);
  if (!from || !to) return false;
  if (from.category !== 'beamline' || to.category !== 'beamline') return false;

  const fromDef = COMPONENTS[from.type];
  const toDef = COMPONENTS[to.type];

  // Validate ports exist
  if (!fromDef.ports || !fromDef.ports[fromPort]) {
    this.log('Invalid source port!', 'bad');
    return false;
  }
  if (!toDef.ports || !toDef.ports[toPort]) {
    this.log('Invalid destination port!', 'bad');
    return false;
  }

  // Check no duplicate connection on same ports
  const existing = this.state.beamPipes.find(
    p => (p.fromId === fromId && p.fromPort === fromPort) ||
         (p.toId === fromId && p.toPort === fromPort) ||
         (p.fromId === toId && p.fromPort === toPort) ||
         (p.toId === toId && p.toPort === toPort)
  );
  if (existing) {
    this.log('Port already connected!', 'bad');
    return false;
  }

  // Compute length from path
  const subL = Math.max(1, (path.length - 1) * 4);

  // Cost scales with length
  const driftDef = COMPONENTS.drift;
  const costPerTile = driftDef ? driftDef.cost.funding : 10000;
  const totalCost = { funding: Math.max(costPerTile, Math.floor(costPerTile * (path.length - 1))) };

  if (!this.canAfford(totalCost)) {
    this.log("Can't afford beam pipe!", 'bad');
    return false;
  }

  this.spend(totalCost);

  const id = 'bp_' + this.state.beamPipeNextId++;
  const pipe = {
    id,
    fromId,
    fromPort,
    toId,
    toPort,
    path: path.map(p => ({ col: p.col, row: p.row })),
    subL,
    attachments: [],
  };

  this.state.beamPipes.push(pipe);
  this.log(`Connected beam pipe (${(subL * 0.5).toFixed(1)}m)`, 'good');
  this._deriveBeamGraph();
  this.emit('beamlineChanged');
  return true;
}
```

- [ ] **Step 3: Add `addAttachmentToPipe` method**

```js
/**
 * Add an attachment (inline component) to an existing beam pipe.
 * @param {string} pipeId - beam pipe ID
 * @param {string} type - component type (must be placement: 'attachment')
 * @param {number} position - 0..1 normalized position along pipe
 * @param {Object} params - optional parameter overrides
 */
addAttachmentToPipe(pipeId, type, position, params) {
  const pipe = this.state.beamPipes.find(p => p.id === pipeId);
  if (!pipe) return false;

  const def = COMPONENTS[type];
  if (!def || def.placement !== 'attachment') {
    this.log('Not an attachment component!', 'bad');
    return false;
  }

  if (!this.isComponentUnlocked(def)) {
    this.log(`${def.name} not unlocked!`, 'bad');
    return false;
  }

  if (!this.canAfford(def.cost)) {
    this.log(`Can't afford ${def.name}!`, 'bad');
    return false;
  }

  this.spend(def.cost);

  const attId = 'att_' + this.state.placeableNextId++;
  const attachment = {
    id: attId,
    type,
    position: Math.max(0, Math.min(1, position)),
    params: {},
  };

  // Initialize params
  if (PARAM_DEFS[type]) {
    for (const [k, pdef] of Object.entries(PARAM_DEFS[type])) {
      if (!pdef.derived) attachment.params[k] = pdef.default;
    }
  }
  if (def.params) {
    for (const [k, v] of Object.entries(def.params)) {
      if (!(k in attachment.params)) attachment.params[k] = v;
    }
  }
  if (params) Object.assign(attachment.params, params);

  // Insert sorted by position
  const insertIdx = pipe.attachments.findIndex(a => a.position > position);
  if (insertIdx === -1) {
    pipe.attachments.push(attachment);
  } else {
    pipe.attachments.splice(insertIdx, 0, attachment);
  }

  this.log(`Attached ${def.name}`, 'good');
  this._deriveBeamGraph();
  this.emit('beamlineChanged');
  return attId;
}

/**
 * Remove an attachment from a pipe.
 */
removeAttachment(pipeId, attachmentId) {
  const pipe = this.state.beamPipes.find(p => p.id === pipeId);
  if (!pipe) return false;

  const idx = pipe.attachments.findIndex(a => a.id === attachmentId);
  if (idx === -1) return false;

  const att = pipe.attachments[idx];
  const def = COMPONENTS[att.type];

  // 50% refund
  if (def && def.cost) {
    for (const [r, a] of Object.entries(def.cost)) {
      this.state.resources[r] += Math.floor(a * 0.5);
    }
  }

  pipe.attachments.splice(idx, 1);
  this.log(`Removed ${def ? def.name : 'attachment'} (50% refund)`, 'info');
  this._deriveBeamGraph();
  this.emit('beamlineChanged');
  return true;
}
```

- [ ] **Step 4: Update `_deriveBeamGraph` to include attachments**

Replace the existing `_deriveBeamGraph` method. The key change: when traversing a pipe edge, inject the pipe's attachments (sorted by position) as intermediate beam nodes between the two connected modules.

```js
_deriveBeamGraph() {
  const beamItems = this.state.placeables.filter(p => p.category === 'beamline');

  // Build adjacency from beam pipes (directed: fromPort is output, toPort is input)
  // adj maps placeableId -> [{ neighborId, pipeId, subL, fromSide, attachments }]
  const adj = {};
  for (const pipe of this.state.beamPipes) {
    if (!adj[pipe.fromId]) adj[pipe.fromId] = [];
    adj[pipe.fromId].push({
      neighborId: pipe.toId,
      pipeId: pipe.id,
      subL: pipe.subL,
      attachments: pipe.attachments || [],
    });
    // For undirected traversal (non-source paths), also add reverse
    if (!adj[pipe.toId]) adj[pipe.toId] = [];
    adj[pipe.toId].push({
      neighborId: pipe.fromId,
      pipeId: pipe.id,
      subL: pipe.subL,
      attachments: [...(pipe.attachments || [])].reverse(),
      reversed: true,
    });
  }

  // Find sources
  const placeableSources = beamItems.filter(p => {
    const def = COMPONENTS[p.type];
    return def && def.isSource;
  });

  // BFS from each source
  const allOrdered = [];
  const visited = new Set();

  for (const source of placeableSources) {
    if (visited.has(source.id)) continue;
    visited.add(source.id);

    const queue = [{ item: source, beamStart: 0 }];

    while (queue.length > 0) {
      const { item, beamStart } = queue.shift();
      const def = COMPONENTS[item.type];
      const itemSubL = def ? (def.subL || 4) : 4;

      // Add the module node
      allOrdered.push({
        id: item.id,
        type: item.type,
        col: item.col,
        row: item.row,
        dir: item.dir,
        params: item.params,
        tiles: (item.cells || []).map(c => ({ col: c.col, row: c.row })),
        beamStart,
        subL: itemSubL,
      });

      const nextBeamStart = beamStart + itemSubL * 0.5;

      // Follow pipes to neighbors
      const neighbors = adj[item.id] || [];
      for (const edge of neighbors) {
        if (visited.has(edge.neighborId)) continue;
        visited.add(edge.neighborId);

        let currentBeamPos = nextBeamStart;

        // Insert attachments along the pipe
        for (const att of edge.attachments) {
          const attDef = COMPONENTS[att.type];
          const attSubL = attDef ? (attDef.subL || 1) : 1;
          const attBeamStart = currentBeamPos + (att.position * edge.subL * 0.5);

          allOrdered.push({
            id: att.id,
            type: att.type,
            col: item.col, // approximate position
            row: item.row,
            dir: item.dir,
            params: att.params,
            tiles: [],
            beamStart: attBeamStart,
            subL: attSubL,
            isAttachment: true,
            pipeId: edge.pipeId,
          });
        }

        // Add drift for the pipe itself (total length minus attachment lengths)
        const totalAttSubL = edge.attachments.reduce((sum, a) => {
          const d = COMPONENTS[a.type];
          return sum + (d ? (d.subL || 1) : 1);
        }, 0);
        const driftSubL = Math.max(1, edge.subL - totalAttSubL);

        allOrdered.push({
          id: edge.pipeId,
          type: 'drift',
          col: item.col,
          row: item.row,
          dir: item.dir,
          params: {},
          tiles: [],
          beamStart: currentBeamPos,
          subL: driftSubL,
        });

        const afterPipe = currentBeamPos + edge.subL * 0.5;

        // Queue the neighbor module
        const neighbor = this.getPlaceable(edge.neighborId);
        if (neighbor) {
          queue.push({ item: neighbor, beamStart: afterPipe });
        }
      }
    }
  }

  this.state.beamline = allOrdered;
}
```

- [ ] **Step 5: Update `removeBeamPipe` to refund attachments**

```js
removeBeamPipe(pipeId) {
  const idx = this.state.beamPipes.findIndex(p => p.id === pipeId);
  if (idx === -1) return false;

  const pipe = this.state.beamPipes[idx];

  // Refund pipe cost (50%)
  const driftDef = COMPONENTS.drift;
  const costPerTile = driftDef ? driftDef.cost.funding : 10000;
  const tileCost = Math.max(costPerTile, Math.floor(costPerTile * ((pipe.path.length - 1) || 1)));
  this.state.resources.funding += Math.floor(tileCost * 0.5);

  // Refund all attachments on this pipe (50%)
  for (const att of pipe.attachments) {
    const attDef = COMPONENTS[att.type];
    if (attDef && attDef.cost) {
      for (const [r, a] of Object.entries(attDef.cost)) {
        this.state.resources[r] += Math.floor(a * 0.5);
      }
    }
  }

  this.state.beamPipes.splice(idx, 1);
  this.log('Removed beam pipe (50% refund)', 'info');
  this._deriveBeamGraph();
  this.emit('beamlineChanged');
  return true;
}
```

- [ ] **Step 6: Commit**

```bash
git add src/game/Game.js
git commit -m "feat: rework beam pipe data model with ports and inline attachments"
```

---

### Task 3: Remove Old Beamline Class Dependencies

**Files:**
- Modify: `src/game/Game.js` (remove Beamline/BeamlineRegistry imports and usage)
- Modify: `src/renderer3d/world-snapshot.js` (remove old beamline traversal)
- Modify: `src/renderer/Renderer.js` (remove old beamline rendering calls)

The old `Beamline` and `BeamlineRegistry` classes are no longer the source of truth. The pipe-based graph in `Game.state.beamPipes` + `_deriveBeamGraph()` replaces them entirely. This task removes all references so nothing breaks when we delete the files.

- [ ] **Step 1: Remove Beamline/Registry imports from Game.js**

Remove these imports from the top of `Game.js`:

```js
// DELETE these lines:
import { makeDefaultBeamState } from '../beamline/BeamlineRegistry.js';
import { Beamline } from '../beamline/Beamline.js';
```

Remove the constructor line:
```js
// DELETE:
this.beamline = null;
```

- [ ] **Step 2: Remove `placeSource()` — use `placePlaceable` instead**

Currently `placeSource()` creates a beamline entry in the old registry. Replace it: sources should just use `placePlaceable` with `category: 'beamline'`. Find `placeSource` in `Game.js` and remove it. Update any callers (InputHandler.js) to use `placePlaceable` instead.

In `InputHandler.js`, find the source placement code and change:

```js
// OLD:
const entryId = this.game.placeSource(this.renderer.hoverCol, this.renderer.hoverRow, this.placementDir, this.selectedTool, this.selectedParamOverrides);

// NEW:
const entryId = this.game.placePlaceable({
  type: this.selectedTool,
  category: 'beamline',
  col: this.renderer.hoverCol,
  row: this.renderer.hoverRow,
  subCol: 0,
  subRow: 0,
  rotated: false,
  dir: this.placementDir,
  params: this.selectedParamOverrides,
});
```

- [ ] **Step 3: Remove all `this.registry` usage from Game.js**

Search for `this.registry` in Game.js. Remove:
- `this.registry = registry` in constructor
- Any calls to `registry.getAll()`, `registry.create()`, etc.
- The legacy compatibility loop in `_deriveBeamGraph` that calls `entry.beamline.getOrderedComponents()`
- `_updateAggregateBeamline()` if it exists — `_deriveBeamGraph` replaces it
- The `recalcBeamline` / `_recalcSingleBeamline` methods that iterate over registry entries — physics should now use `this.state.beamline` directly

- [ ] **Step 4: Update world-snapshot.js**

In `world-snapshot.js`, the snapshot builder reads components from the game state. Update it to include attachment positions along pipes for 3D rendering. Find where it builds `components[]` and `beamPaths[]` and update:

```js
// Add attachments to the snapshot
snapshot.attachments = [];
for (const pipe of game.state.beamPipes) {
  for (const att of pipe.attachments) {
    const def = COMPONENTS[att.type];
    // Interpolate world position along pipe path
    const pathIdx = Math.floor(att.position * (pipe.path.length - 1));
    const tile = pipe.path[Math.min(pathIdx, pipe.path.length - 1)];
    snapshot.attachments.push({
      id: att.id,
      type: att.type,
      col: tile.col,
      row: tile.row,
      pipeId: pipe.id,
      position: att.position,
      params: att.params,
    });
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add src/game/Game.js src/input/InputHandler.js src/renderer3d/world-snapshot.js
git commit -m "refactor: remove old Beamline/BeamlineRegistry dependencies, sources use placePlaceable"
```

---

### Task 4: Simplify Pipe Drawing Input

**Files:**
- Modify: `src/input/InputHandler.js`

The current pipe drawing code does too much — it sometimes creates pipe records, sometimes places individual drift placeables tile by tile. Simplify: pipe drawing always connects two modules via their ports. Click on a module to start, drag to another module to finish.

- [ ] **Step 1: Simplify mousedown for beam pipe**

Replace the beam pipe drawing start block (around line 967-982):

```js
// Beam pipe drawing start
if ((e.button === 0 || e.button === 2) && this.selectedTool && COMPONENTS[this.selectedTool]?.isDrawnConnection) {
  const world = this.renderer.screenToWorld(e.clientX, e.clientY);
  const grid = isoToGrid(world.x, world.y);

  if (e.button === 2) {
    // Right-click on pipe to remove
    this.drawingBeamPipe = true;
    this.beamPipeDrawMode = 'remove';
    this.beamPipeStartId = null;
    this.beamPipePath = [{ col: grid.col, row: grid.row }];
    this.renderer.renderBeamPipePreview(this.beamPipePath, 'remove');
    return;
  }

  // Left-click: must start on a module
  const startComp = this._findBeamlineComponentAt(grid.col, grid.row);
  if (!startComp) return; // can't start pipe in empty space

  const startDef = COMPONENTS[startComp.type];
  if (!startDef || startDef.placement !== 'module') return; // must be a module

  this.drawingBeamPipe = true;
  this.beamPipeDrawMode = 'add';
  this.beamPipeStartId = startComp.id;
  this.beamPipePath = [{ col: grid.col, row: grid.row }];
  this.renderer.renderBeamPipePreview(this.beamPipePath, 'add');
  return;
}
```

- [ ] **Step 2: Simplify mouseup for beam pipe**

Replace the beam pipe end block (around line 1299-1378). The key change: no more tile-by-tile drift placement. We only create a pipe record connecting two modules.

```js
// Beam pipe drawing end
if (this.drawingBeamPipe) {
  const world = this.renderer.screenToWorld(e.clientX, e.clientY);
  const grid = isoToGrid(world.x, world.y);
  this.beamPipePath = this._buildStraightPath(this.beamPipePath[0], { col: grid.col, row: grid.row });

  if (this.beamPipeDrawMode === 'remove') {
    // Right-click drag: find and remove pipes along path
    const pipesToRemove = new Set();
    for (const pipe of this.game.state.beamPipes) {
      for (const pt of this.beamPipePath) {
        if (pipe.path.some(pp => pp.col === pt.col && pp.row === pt.row)) {
          pipesToRemove.add(pipe.id);
          break;
        }
      }
    }
    if (pipesToRemove.size > 0) {
      this.game._pushUndo();
      for (const id of pipesToRemove) {
        this.game.removeBeamPipe(id);
      }
    }
  } else {
    // Left-click: connect two modules
    const endComp = this._findBeamlineComponentAt(grid.col, grid.row);

    if (this.beamPipeStartId && endComp && endComp.id !== this.beamPipeStartId) {
      const startComp = this.game.getPlaceable(this.beamPipeStartId);
      const startDef = COMPONENTS[startComp.type];
      const endDef = COMPONENTS[endComp.type];

      // Auto-select ports: pick first available exit port on start, first available entry port on end
      const fromPort = this._findAvailablePort(this.beamPipeStartId, 'exit');
      const toPort = this._findAvailablePort(endComp.id, 'entry');

      if (fromPort && toPort) {
        this.game._pushUndo();
        this.game.createBeamPipe(this.beamPipeStartId, fromPort, endComp.id, toPort, this.beamPipePath);
      } else {
        this.game.log('No available ports!', 'bad');
      }
    }
  }

  this.drawingBeamPipe = false;
  this.beamPipeStartId = null;
  this.beamPipePath = [];
  this.beamPipeDrawMode = 'add';
  this.renderer.clearDragPreview();
  return;
}
```

- [ ] **Step 3: Add `_findAvailablePort` helper**

```js
/**
 * Find an available (unconnected) port on a module.
 * @param {string} placeableId
 * @param {'entry'|'exit'} direction - 'exit' for source-side ports, 'entry' for dest-side ports
 * @returns {string|null} port name or null if all ports are occupied
 */
_findAvailablePort(placeableId, direction) {
  const placeable = this.game.getPlaceable(placeableId);
  if (!placeable) return null;
  const def = COMPONENTS[placeable.type];
  if (!def || !def.ports) return null;

  const connectedPorts = new Set();
  for (const pipe of this.game.state.beamPipes) {
    if (pipe.fromId === placeableId) connectedPorts.add(pipe.fromPort);
    if (pipe.toId === placeableId) connectedPorts.add(pipe.toPort);
  }

  // Find first port matching direction that isn't connected
  for (const [portName, portDef] of Object.entries(def.ports)) {
    if (connectedPorts.has(portName)) continue;

    if (direction === 'exit') {
      // Exit ports: 'exit', 'exitStraight', 'exitBranch', or any port on 'front'/'left'/'right'
      if (portName.startsWith('exit') || portDef.side === 'front') return portName;
    } else {
      // Entry ports: 'entry', or any port on 'back'
      if (portName === 'entry' || portDef.side === 'back') return portName;
    }
  }
  return null;
}
```

- [ ] **Step 4: Update attachment placement — click pipe with attachment tool selected**

Add handling for when the selected tool is an attachment-type component. In the spacebar/click placement handler, detect attachment tools:

```js
// In the spacebar handler (around the component placement section):
if (this.selectedTool) {
  const comp = COMPONENTS[this.selectedTool];
  if (comp && comp.placement === 'attachment') {
    // Find the nearest pipe to the cursor
    const pipe = this._findNearestPipe(this.renderer.hoverCol, this.renderer.hoverRow);
    if (pipe) {
      const position = this._getPipePosition(pipe, this.renderer.hoverCol, this.renderer.hoverRow);
      this.game._pushUndo();
      this.game.addAttachmentToPipe(pipe.id, this.selectedTool, position, this.selectedParamOverrides);
    } else {
      this.game.log('Must place on a beam pipe!', 'bad');
    }
  } else if (comp && comp.placement === 'module') {
    // Existing module placement logic...
  }
}
```

- [ ] **Step 5: Add `_findNearestPipe` and `_getPipePosition` helpers**

```js
/**
 * Find the beam pipe closest to the given grid position.
 */
_findNearestPipe(col, row) {
  let bestPipe = null;
  let bestDist = Infinity;

  for (const pipe of this.game.state.beamPipes) {
    for (const pt of pipe.path) {
      const dist = Math.abs(pt.col - col) + Math.abs(pt.row - row);
      if (dist < bestDist) {
        bestDist = dist;
        bestPipe = pipe;
      }
    }
  }

  return bestDist <= 1 ? bestPipe : null; // must be on or adjacent to pipe
}

/**
 * Get the normalized 0..1 position along a pipe for a given grid coordinate.
 */
_getPipePosition(pipe, col, row) {
  if (pipe.path.length <= 1) return 0.5;

  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < pipe.path.length; i++) {
    const dist = Math.abs(pipe.path[i].col - col) + Math.abs(pipe.path[i].row - row);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }

  return bestIdx / (pipe.path.length - 1);
}
```

- [ ] **Step 6: Commit**

```bash
git add src/input/InputHandler.js
git commit -m "feat: simplify pipe drawing to port-to-port, add attachment placement on pipes"
```

---

### Task 5: Update Build Menu to Distinguish Modules and Attachments

**Files:**
- Modify: `src/renderer/hud.js` (the build palette/menu)

The build menu currently shows all beamline components in one flat list. Update it so that:
- Module-type components show normally (placed on grid)
- Attachment-type components show with a visual indicator (e.g., a small pipe icon or "INLINE" tag)
- When an attachment is selected and the player hovers over a pipe, highlight the pipe

- [ ] **Step 1: Read the current HUD build menu code**

Read `src/renderer/hud.js` to find where beamline components are listed in the build palette. Understand the current rendering of tool buttons.

- [ ] **Step 2: Add visual distinction for attachments**

When building the palette buttons, check `comp.placement`:

```js
// When rendering a beamline tool button:
const comp = COMPONENTS[toolId];
if (comp.placement === 'attachment') {
  // Add a small indicator — e.g., a subtitle or border style
  button.classList.add('attachment-tool');
  // Add tooltip hint
  button.title += ' (attaches to beam pipe)';
}
```

- [ ] **Step 3: Add CSS for attachment indicators**

In `style.css`, add:

```css
.attachment-tool {
  border-left: 3px solid #44cc44;
}
.attachment-tool::after {
  content: 'INLINE';
  font-size: 8px;
  color: #44cc44;
  position: absolute;
  bottom: 2px;
  right: 2px;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/hud.js style.css
git commit -m "feat: visually distinguish attachment vs module tools in build menu"
```

---

### Task 6: Update 3D Renderer for Attachments on Pipes

**Files:**
- Modify: `src/renderer3d/ThreeRenderer.js`
- Modify: `src/renderer3d/component-builder.js`
- Modify: `src/renderer3d/world-snapshot.js`

Attachments need to render at their interpolated position along the pipe path in 3D.

- [ ] **Step 1: Update world snapshot to include pipe attachments**

In `world-snapshot.js`, when building the snapshot, add attachment data:

```js
// In the snapshot builder, after building beamPaths:
snapshot.pipeAttachments = [];
for (const pipe of game.state.beamPipes) {
  for (const att of (pipe.attachments || [])) {
    // Interpolate position along pipe path
    const t = att.position;
    const pathLen = pipe.path.length;
    const exactIdx = t * (pathLen - 1);
    const idx0 = Math.floor(exactIdx);
    const idx1 = Math.min(idx0 + 1, pathLen - 1);
    const frac = exactIdx - idx0;

    const p0 = pipe.path[idx0];
    const p1 = pipe.path[idx1];
    const col = p0.col + (p1.col - p0.col) * frac;
    const row = p0.row + (p1.row - p0.row) * frac;

    // Determine direction from pipe path segment
    let dir = 0;
    if (idx1 > idx0) {
      const dc = p1.col - p0.col;
      const dr = p1.row - p0.row;
      if (dc > 0) dir = 1;      // SE
      else if (dc < 0) dir = 3; // NW
      else if (dr > 0) dir = 2; // SW
      else if (dr < 0) dir = 0; // NE
    }

    snapshot.pipeAttachments.push({
      id: att.id,
      type: att.type,
      col,
      row,
      dir,
      pipeId: pipe.id,
      params: att.params,
    });
  }
}
```

- [ ] **Step 2: Render attachments in ThreeRenderer**

In the component rendering section of `ThreeRenderer.js`, after rendering modules, also render attachments:

```js
// After rendering normal components, render pipe attachments
if (snapshot.pipeAttachments) {
  for (const att of snapshot.pipeAttachments) {
    const mesh = this.componentBuilder.build(att);
    if (mesh) {
      // Position at interpolated pipe location
      const isoPos = gridToIso(att.col, att.row);
      mesh.position.set(isoPos.x * SCALE, BEAM_HEIGHT, isoPos.y * SCALE);
      mesh.rotation.y = att.dir * Math.PI / 2;
      mesh.userData = { type: 'attachment', attachmentId: att.id, pipeId: att.pipeId };
      this.componentGroup.add(mesh);
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer3d/ThreeRenderer.js src/renderer3d/component-builder.js src/renderer3d/world-snapshot.js
git commit -m "feat: render attachments at interpolated positions along 3D beam pipes"
```

---

### Task 7: Mark Old Beamline Classes as Legacy (Do Not Delete)

**Files:**
- Modify: `src/beamline/Beamline.js` (add legacy header comment)
- Modify: `src/beamline/BeamlineRegistry.js` (add legacy header comment)
- Modify: `src/game/Game.js` (final cleanup of stale references)

The old `Beamline` / `BeamlineRegistry` classes are **not deleted** — they survive as the designer's internal draft representation until the designer is fully pipe-native (future work). Main map code must no longer use them.

- [ ] **Step 1: Add legacy header to Beamline.js**

Prepend to the top of `src/beamline/Beamline.js`:

```js
// === LEGACY: designer-internal use only ===
// This class is no longer used by the main map. The pipe-centric beam graph
// in Game.state.beamPipes + state.placeables is the source of truth for the
// placed world. This class survives because BeamlineDesigner still uses a
// linear parent-child draft for its schematic editor. See path-flattener.js
// for the bridge between the pipe graph and the designer's flat draft format.
```

Add the same note to `BeamlineRegistry.js`.

- [ ] **Step 2: Verify no main-map code imports these files**

```bash
grep -rn "from.*Beamline\.js\|from.*BeamlineRegistry\.js" src/ --include="*.js"
```

Expected: only `src/ui/BeamlineDesigner.js`, `src/ui/DesignPlacer.js`, and `src/beamline/*.js` itself should appear. If `Game.js`, `InputHandler.js`, or renderer files appear, remove those imports.

- [ ] **Step 3: Confirm `Game` constructor no longer needs registry for main map**

The constructor may still accept a `registry` param for the designer's use — that's fine. Just confirm that `this.state.beamPipes` / `this.state.placeables` is the only thing `_deriveBeamGraph()` reads from.

- [ ] **Step 4: Commit**

```bash
git add src/beamline/Beamline.js src/beamline/BeamlineRegistry.js src/game/Game.js
git commit -m "refactor: mark old Beamline classes as designer-only legacy"
```

---

### Task 8: Update Physics Integration

**Files:**
- Modify: `src/game/Game.js` (physics recalculation)
- Modify: `src/beamline/physics.js` (if needed)

The physics system needs to consume the new beam graph format. Currently `_recalcSingleBeamline` iterates registry entries. Replace with a single pass over `state.beamline` which now includes both modules and inline attachments.

- [ ] **Step 1: Replace physics recalc to use state.beamline directly**

Find `_recalcSingleBeamline` and `recalcBeamline` in Game.js. Replace with:

```js
recalcBeamline() {
  this._deriveBeamGraph();

  const ordered = this.state.beamline;
  if (ordered.length === 0) return;

  // Build physics beamline array
  const physicsBeamline = ordered.map(node => {
    const def = COMPONENTS[node.type];
    return {
      type: node.type,
      subL: node.subL || (def ? def.subL : 4),
      stats: def ? { ...def.stats } : {},
      params: node.params || {},
      isAttachment: node.isAttachment || false,
    };
  });

  // Collect research effects
  const researchEffects = {};
  for (const rId of this.state.completedResearch) {
    const r = RESEARCH[rId];
    if (r && r.effects) Object.assign(researchEffects, r.effects);
  }

  // Run physics
  const result = BeamPhysics.compute(physicsBeamline, researchEffects);

  // Store results
  this.state.beamState = result;
  this.emit('physicsUpdated');
}
```

- [ ] **Step 2: Commit**

```bash
git add src/game/Game.js
git commit -m "feat: physics recalc uses unified pipe-based beam graph"
```

---

### Task 9: Save/Load Compatibility

**Files:**
- Modify: `src/game/Game.js` (serialization)

Ensure the new beam pipe format (with `fromPort`, `toPort`, `attachments`) is saved and loaded correctly. Add migration for old save files that have the old format.

- [ ] **Step 1: Add migration in the load/fromJSON path**

Find where save data is loaded (likely a `fromJSON` or `loadState` method). Add migration:

```js
// Migrate old beam pipes that lack port fields
if (state.beamPipes) {
  for (const pipe of state.beamPipes) {
    if (!pipe.fromPort) pipe.fromPort = 'exit';
    if (!pipe.toPort) pipe.toPort = 'entry';
    if (!pipe.attachments) pipe.attachments = [];
  }
}

// Migrate old beamline nodes from registry format to placeables
// (if state has old registry data, convert to placeables)
if (state.beamlineEntries && !state.beamPipes.length) {
  // Convert old parent-child nodes to placeables
  // This is best-effort — old saves may need manual reconnection
  for (const entry of state.beamlineEntries) {
    for (const node of entry.nodes) {
      const existing = state.placeables.find(p => p.id === node.id);
      if (!existing) {
        state.placeables.push({
          id: 'bl_' + (state.placeableNextId++),
          type: node.type,
          category: 'beamline',
          col: node.col,
          row: node.row,
          subCol: 0, subRow: 0,
          rotated: false,
          dir: node.dir,
          params: node.params,
          cells: node.tiles.map(t => ({ col: t.col, row: t.row, subCol: 0, subRow: 0 })),
        });
      }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/game/Game.js
git commit -m "feat: save/load migration for pipe-centric beam model"
```

---

### Task 10: Pipe Graph → Flat Path Flattener

**Files:**
- Create: `src/beamline/path-flattener.js`

The designer needs a way to walk the pipe graph from a chosen source along a chosen path and produce a flat ordered list of entries (modules + pipe drift segments + inline attachments at their positions). This is the bridge between the pipe graph (source of truth) and the designer's linear schematic UI.

- [ ] **Step 1: Create the flattener module**

```js
// src/beamline/path-flattener.js
// Walks a pipe graph from a chosen source and produces an ordered flat list
// (modules + pipe drift segments + inline attachments) for the designer's
// linear schematic view and the physics pipeline.

import { COMPONENTS } from '../data/components.js';

/**
 * Flatten a source→endpoint path through the pipe graph.
 *
 * @param {Object} gameState - game.state (reads placeables + beamPipes)
 * @param {string} sourceId - placeable id of the source module to start from
 * @param {string} [endpointId] - optional endpoint id; if omitted, picks the
 *   first reachable endpoint via BFS (works for single-path linacs)
 * @returns {Array} ordered entries:
 *   { kind: 'module', id, type, params, beamStart, subL, placeable }
 *   { kind: 'attachment', id, type, params, beamStart, subL, pipeId, position }
 *   { kind: 'drift', id: pipeId, beamStart, subL, pipeId }
 */
export function flattenPath(gameState, sourceId, endpointId = null) {
  const placeableById = {};
  for (const p of gameState.placeables) placeableById[p.id] = p;

  // Build directed adjacency: only follow pipes in the direction of beam flow
  // (fromId → toId). For linacs this is unambiguous. When splitters arrive,
  // this function will need a pathHint argument to pick branches.
  const outEdges = {};
  for (const pipe of gameState.beamPipes) {
    if (!outEdges[pipe.fromId]) outEdges[pipe.fromId] = [];
    outEdges[pipe.fromId].push(pipe);
    // Also allow reverse traversal if the neighbor pipe was drawn toward source
    if (!outEdges[pipe.toId]) outEdges[pipe.toId] = [];
    outEdges[pipe.toId].push({ ...pipe, _reversed: true });
  }

  const result = [];
  const visited = new Set();
  let beamStart = 0;

  let currentId = sourceId;
  while (currentId) {
    if (visited.has(currentId)) break; // cycle — bail (rings come later)
    visited.add(currentId);

    const placeable = placeableById[currentId];
    if (!placeable) break;
    const def = COMPONENTS[placeable.type];
    const subL = def ? (def.subL || 4) : 4;

    result.push({
      kind: 'module',
      id: placeable.id,
      type: placeable.type,
      params: placeable.params || {},
      beamStart,
      subL,
      placeable,
    });
    beamStart += subL * 0.5;

    // If we've reached the requested endpoint, stop
    if (endpointId && placeable.id === endpointId) break;

    // If this is an endpoint component and no target specified, stop
    if (!endpointId && def && def.isEndpoint) break;

    // Pick next pipe (linac: exactly one outgoing, ignore reversed edges)
    const edges = (outEdges[currentId] || []).filter(e => !e._reversed && !visited.has(e.toId));
    if (edges.length === 0) break;

    // For linacs pick the first. TODO(splitter): use pathHint to choose.
    const pipe = edges[0];

    // Emit attachments + drift interleaved. Attachments are sorted by position.
    const atts = [...(pipe.attachments || [])].sort((a, b) => a.position - b.position);
    const pipeBeamLen = pipe.subL * 0.5;

    let pipeCursor = beamStart;
    let attCursor = 0; // how much pipe length is consumed by attachments

    for (const att of atts) {
      const attDef = COMPONENTS[att.type];
      const attSubL = attDef ? (attDef.subL || 1) : 1;
      const attBeamLen = attSubL * 0.5;

      // Drift segment leading up to this attachment
      const driftBeamLen = att.position * pipeBeamLen - attCursor;
      if (driftBeamLen > 0) {
        result.push({
          kind: 'drift',
          id: pipe.id + '_drift_' + attCursor.toFixed(2),
          beamStart: pipeCursor,
          subL: driftBeamLen * 2,
          pipeId: pipe.id,
        });
        pipeCursor += driftBeamLen;
        attCursor += driftBeamLen;
      }

      // The attachment itself
      result.push({
        kind: 'attachment',
        id: att.id,
        type: att.type,
        params: att.params || {},
        beamStart: pipeCursor,
        subL: attSubL,
        pipeId: pipe.id,
        position: att.position,
      });
      pipeCursor += attBeamLen;
      attCursor += attBeamLen;
    }

    // Remaining drift to end of pipe
    const tailBeamLen = pipeBeamLen - attCursor;
    if (tailBeamLen > 0) {
      result.push({
        kind: 'drift',
        id: pipe.id + '_drift_tail',
        beamStart: pipeCursor,
        subL: tailBeamLen * 2,
        pipeId: pipe.id,
      });
      pipeCursor += tailBeamLen;
    }

    beamStart = pipeCursor;
    currentId = pipe.toId;
  }

  return result;
}

/**
 * Find all reachable endpoints from a source in the pipe graph.
 * Used by the designer to populate an endpoint selector for the future
 * splitter support, and to validate source selection.
 */
export function findReachableEndpoints(gameState, sourceId) {
  const placeableById = {};
  for (const p of gameState.placeables) placeableById[p.id] = p;

  const adj = {};
  for (const pipe of gameState.beamPipes) {
    if (!adj[pipe.fromId]) adj[pipe.fromId] = [];
    adj[pipe.fromId].push(pipe.toId);
  }

  const endpoints = [];
  const visited = new Set();
  const queue = [sourceId];
  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    const p = placeableById[id];
    if (!p) continue;
    const def = COMPONENTS[p.type];
    if (def && def.isEndpoint) endpoints.push(p);
    for (const nxt of (adj[id] || [])) queue.push(nxt);
  }
  return endpoints;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/beamline/path-flattener.js
git commit -m "feat: add path flattener to convert pipe graph to linear designer draft"
```

---

### Task 11: Designer Edit Mode Reads From Pipe Graph

**Files:**
- Modify: `src/ui/BeamlineDesigner.js`

When the player opens an existing placed beamline in the designer (edit mode), the designer should populate its `draftNodes[]` from the flattened pipe-graph path instead of from the old `Beamline.nodes` parent-child list.

- [ ] **Step 1: Read the current edit-mode open logic**

Open `src/ui/BeamlineDesigner.js` and find the method that currently opens an existing beamline (likely `open(beamlineId)` or similar). Understand how it builds `draftNodes` today from the old `Beamline` object.

- [ ] **Step 2: Add a new open path that uses the flattener**

Import the flattener at the top of `BeamlineDesigner.js`:

```js
import { flattenPath, findReachableEndpoints } from '../beamline/path-flattener.js';
```

Add a new method that opens edit mode from a source placeable id:

```js
/**
 * Open edit mode for a beamline rooted at the given source placeable.
 * Walks the pipe graph and builds the draft from the flattened path.
 */
openFromSource(sourceId, endpointId = null) {
  this.mode = 'edit';
  this.editSourceId = sourceId;

  // Find reachable endpoints so the user can pick a path if there are many
  const endpoints = findReachableEndpoints(this.game.state, sourceId);
  this.availableEndpoints = endpoints;

  // Default endpoint: first one, or provided
  if (!endpointId && endpoints.length > 0) {
    endpointId = endpoints[0].id;
  }
  this.editEndpointId = endpointId;

  // Flatten
  const flat = flattenPath(this.game.state, sourceId, endpointId);

  // Convert to draftNodes (the designer's existing format)
  this.draftNodes = flat.map(entry => ({
    kind: entry.kind,        // 'module' | 'drift' | 'attachment'
    type: entry.kind === 'drift' ? 'drift' : entry.type,
    params: { ...entry.params },
    beamStart: entry.beamStart,
    subL: entry.subL,
    // Back-reference so reconciliation can find the underlying object
    _sourceRef: entry.kind === 'module' ? { placeableId: entry.id }
              : entry.kind === 'attachment' ? { pipeId: entry.pipeId, attachmentId: entry.id }
              : { pipeId: entry.pipeId },
    bendDir: null,
  }));

  this.isOpen = true;
  this._render();
}
```

- [ ] **Step 3: Update the existing `open()` entrypoint to route to `openFromSource`**

Find any place that currently calls the old `open(beamlineId)` method. Replace it with logic that:

1. Determines the source placeable from the click target on the map
2. Calls `openFromSource(sourceId)`

For callers that still pass a `beamlineId` from the legacy registry (if any), add a shim that finds a source placeable to use instead. Since the main map no longer uses the registry, any remaining legacy callers can be updated or removed.

- [ ] **Step 4: Update the confirm/reconcile logic**

Find the `confirm()` (or equivalent) method that writes draft changes back. Replace its body with pipe-graph reconciliation:

```js
confirm() {
  // Walk draftNodes; for each node, apply changes back to the underlying
  // placeable or pipe attachment. This MVP only supports:
  //   - param edits on existing modules
  //   - param edits on existing attachments
  //   - add new attachment (inserted into draft during editing)
  //   - remove existing attachment
  // Adding/removing modules from the designer is disabled for now —
  // those operations happen on the main map.

  const existingAttachmentIds = new Set();

  for (const node of this.draftNodes) {
    if (node.kind === 'module' && node._sourceRef?.placeableId) {
      // Apply param edits to the placeable
      const p = this.game.getPlaceable(node._sourceRef.placeableId);
      if (p) Object.assign(p.params, node.params);
    } else if (node.kind === 'attachment' && node._sourceRef?.attachmentId) {
      // Apply param edits to the existing attachment
      const pipe = this.game.state.beamPipes.find(p => p.id === node._sourceRef.pipeId);
      if (pipe) {
        const att = pipe.attachments.find(a => a.id === node._sourceRef.attachmentId);
        if (att) Object.assign(att.params, node.params);
        existingAttachmentIds.add(node._sourceRef.attachmentId);
      }
    } else if (node.kind === 'attachment' && !node._sourceRef?.attachmentId) {
      // Newly added attachment in the draft — add to the nearest pipe
      // The draft editor stores a target pipeId in node._targetPipeId when
      // inserting (see the insertion UI in Step 5)
      if (node._targetPipeId) {
        this.game.addAttachmentToPipe(
          node._targetPipeId,
          node.type,
          node._targetPosition || 0.5,
          node.params,
        );
      }
    }
  }

  // Remove attachments that were in the original draft but got deleted
  for (const pipe of this.game.state.beamPipes) {
    for (const att of [...pipe.attachments]) {
      if (!existingAttachmentIds.has(att.id)) {
        // This attachment was on this pipe when we opened, and is no longer
        // in the draft → it was deleted by the user
        const wasInOriginal = this._originalAttachmentIds?.has(att.id);
        if (wasInOriginal) {
          this.game.removeAttachment(pipe.id, att.id);
        }
      }
    }
  }

  this.game.recalcBeamline();
  this.close();
}
```

- [ ] **Step 5: Snapshot original attachment ids on open**

In `openFromSource`, record which attachments were present when we opened, so the confirm step can detect deletions:

```js
// At the end of openFromSource, before this._render():
this._originalAttachmentIds = new Set();
for (const entry of flat) {
  if (entry.kind === 'attachment') {
    this._originalAttachmentIds.add(entry.id);
  }
}
```

- [ ] **Step 6: Restrict draft insert UI to attachments in edit mode**

In the component palette, when `this.mode === 'edit'`, hide or disable any component with `placement === 'module'`. Only attachment-type components can be inserted into the draft in edit mode. Show a tooltip "Modules must be placed on the map" when hovering a disabled module tile.

- [ ] **Step 7: Commit**

```bash
git add src/ui/BeamlineDesigner.js
git commit -m "feat: designer edit mode reads flattened pipe path, writes back param + attachment changes"
```

---

### Task 12: Rewrite DesignPlacer to Emit Pipes + Modules + Attachments

**Files:**
- Modify: `src/ui/DesignPlacer.js`

When the player places a saved design from the library onto the main map, `DesignPlacer.confirm()` currently builds a parent-child `Beamline` chain. Rewrite it to place modules as placeables and connect them with pipes, folding attachments into pipes.

- [ ] **Step 1: Read the current DesignPlacer.confirm() code**

Open `src/ui/DesignPlacer.js` and understand the current chain-building logic:
- How does it advance the cursor between components?
- How does it handle dipole bends?
- Where is the cost computation?

- [ ] **Step 2: Rewrite confirm() to use the new model**

Replace the component placement loop with one that:

1. Walks the design's component list in order
2. For each module-type component, calls `game.placePlaceable({...})` at the current cursor
3. For each attachment-type component, holds it in a "pending attachments" queue until the next pipe is created
4. Between modules, creates a pipe connecting the previous module's exit to this module's entry, generating a path between them
5. After creating a pipe, drains pending attachments onto it at evenly-spaced positions

```js
confirm() {
  if (!this.active || !this.design) return false;
  if (!this._validatePlacement()) return false;

  // Total cost check
  if (!this.game.canAfford(this._totalCost)) {
    this.game.log("Can't afford design!", 'bad');
    return false;
  }

  const components = this.design.components;
  let cursor = { col: this.col, row: this.row };
  let dir = this.dir;
  let prevModuleId = null;
  let prevModuleExitPort = null;
  let pendingAttachments = [];

  for (const compEntry of components) {
    const def = COMPONENTS[compEntry.type];
    if (!def) continue;

    if (def.placement === 'attachment') {
      // Queue for the next pipe we create
      pendingAttachments.push(compEntry);
      continue;
    }

    // It's a module — place it
    const effectiveDir = dir;
    const placeableId = this.game.placePlaceable({
      type: compEntry.type,
      category: 'beamline',
      col: cursor.col,
      row: cursor.row,
      subCol: 0, subRow: 0,
      rotated: false,
      dir: effectiveDir,
      params: compEntry.params,
    });

    if (!placeableId) {
      this.game.log('Design placement failed — collision or out of bounds', 'bad');
      return false;
    }

    // Connect to previous module via a pipe, if there is one
    if (prevModuleId && def.ports?.entry) {
      const pipePath = this._buildPipePath(prevModuleId, placeableId);
      const pipeId = this.game.createBeamPipe(
        prevModuleId, prevModuleExitPort || 'exit',
        placeableId, 'entry',
        pipePath,
      );

      // Drain pending attachments onto this pipe at evenly spaced positions
      if (pipeId && pendingAttachments.length > 0) {
        const n = pendingAttachments.length;
        pendingAttachments.forEach((att, i) => {
          const pos = (i + 1) / (n + 1); // evenly spaced in (0,1)
          this.game.addAttachmentToPipe(pipeId, att.type, pos, att.params);
        });
        pendingAttachments = [];
      }
    }

    prevModuleId = placeableId;
    // Pick the outgoing port — for dipoles with bendDir, use 'exit' and adjust dir
    prevModuleExitPort = 'exit';

    // Advance cursor
    const moduleLength = def.subL || 4;
    const tilesAlong = Math.ceil(moduleLength / 4);
    cursor = this._advance(cursor, dir, tilesAlong + 1); // +1 for gap

    // Handle dipole bends
    if (def.isDipole && compEntry.bendDir) {
      dir = compEntry.bendDir === 'left' ? this._turnLeft(dir) : this._turnRight(dir);
    }
  }

  // Deduct cost, log
  this.game.spend(this._totalCost);
  this.game.log(`Placed design: ${this.design.name}`, 'good');

  // Exit placement mode
  this.active = false;
  this.design = null;
  return true;
}

/**
 * Build a path of tiles between two modules for a pipe.
 * Simple L-shaped routing from exit-edge of `from` to entry-edge of `to`.
 */
_buildPipePath(fromId, toId) {
  const from = this.game.getPlaceable(fromId);
  const to = this.game.getPlaceable(toId);
  if (!from || !to) return [];

  const path = [];
  const startCol = from.col + (from.cells?.length ? 1 : 0);
  const startRow = from.row;
  const endCol = to.col;
  const endRow = to.row;

  let c = startCol, r = startRow;
  path.push({ col: c, row: r });
  while (c !== endCol) {
    c += Math.sign(endCol - c);
    path.push({ col: c, row: r });
  }
  while (r !== endRow) {
    r += Math.sign(endRow - r);
    path.push({ col: c, row: r });
  }
  return path;
}

/**
 * Advance a cursor by N tiles in the given isometric direction.
 */
_advance(cursor, dir, n) {
  const DIR_DELTA = { 0: {dc: 0, dr: -1}, 1: {dc: 1, dr: 0}, 2: {dc: 0, dr: 1}, 3: {dc: -1, dr: 0} };
  const d = DIR_DELTA[dir];
  return { col: cursor.col + d.dc * n, row: cursor.row + d.dr * n };
}

_turnLeft(dir) { return (dir + 3) % 4; }
_turnRight(dir) { return (dir + 1) % 4; }
```

- [ ] **Step 3: Handle saved design format migration**

Designs saved before this refactor only contain `[{ type, bendDir, params }, ...]`. Attachments will be intermingled with modules in the list. The new `confirm()` already handles this — it detects `def.placement === 'attachment'` and queues them for the next pipe. No migration needed for the data, just verify with a saved design.

- [ ] **Step 4: Commit**

```bash
git add src/ui/DesignPlacer.js
git commit -m "feat: DesignPlacer emits modules+pipes+attachments on the new model"
```

---

### Task 13: Endpoint Selector Stub in Designer Header

**Files:**
- Modify: `src/ui/BeamlineDesigner.js`

Lay the groundwork for splitter support: when the player opens a beamline with multiple reachable endpoints, they pick which one to view. For linacs with one endpoint, the UI auto-picks and hides the selector.

- [ ] **Step 1: Add endpoint selector to designer header**

In `BeamlineDesigner.js`, find where the header/toolbar is rendered. Add:

```js
_renderEndpointSelector() {
  if (!this.availableEndpoints || this.availableEndpoints.length <= 1) {
    // Hide selector when there's only one path
    return '';
  }
  const options = this.availableEndpoints.map(ep => {
    const def = COMPONENTS[ep.type];
    const label = def ? def.name : ep.type;
    const selected = ep.id === this.editEndpointId ? 'selected' : '';
    return `<option value="${ep.id}" ${selected}>${label}</option>`;
  }).join('');
  return `
    <div class="endpoint-selector">
      <label>Path to:</label>
      <select id="designer-endpoint-select">${options}</select>
    </div>
  `;
}
```

Wire up the change handler:

```js
// After rendering the header:
const sel = document.getElementById('designer-endpoint-select');
if (sel) {
  sel.addEventListener('change', (e) => {
    this.openFromSource(this.editSourceId, e.target.value);
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/BeamlineDesigner.js
git commit -m "feat: endpoint selector in designer for future multi-path support"
```

---

### Task 14: Unify Physics Input via the Flattener

**Files:**
- Modify: `src/game/Game.js` (`_deriveBeamGraph` delegates to flattener)
- Modify: `src/ui/BeamlineDesigner.js` (physics recalc uses same ordered list the schematic renders)

This task ensures the flattener is the **single source of truth** for beam ordering. Both the main map's physics recalc and the designer's preview physics must see the same ordered list with the same indices, so the designer's schematic x-axis and plot s-axis stay perfectly aligned.

**Physics pipeline contract** (read first, don't break):

- Input is an array `[{type, subL, stats, params}, ...]` in beam order.
- `subL` is in **sub-units** (1 sub-unit = 0.5 m). `gameplay.py` multiplies by 0.5 to get metres.
- The returned `envelope` has one entry per input element, at the same index. `envelope[i].s` is the cumulative beam length in metres at element `i`.
- The designer plots by iterating `envelope[i]` and rendering at x = `envelope[i].s` on the s-axis. Any divergence between the ordering passed to physics and the ordering rendered in the schematic will desync the plots.

- [ ] **Step 1: Replace `_deriveBeamGraph` body with a flattener call**

In `Game.js`, replace the method body added in Task 2 Step 4 with a loop that calls `flattenPath()` for each source and concatenates:

```js
import { flattenPath } from '../beamline/path-flattener.js';

// ...

_deriveBeamGraph() {
  const beamItems = this.state.placeables.filter(p => p.category === 'beamline');
  const sources = beamItems.filter(p => {
    const def = COMPONENTS[p.type];
    return def && def.isSource;
  });

  const allOrdered = [];
  for (const source of sources) {
    const flat = flattenPath(this.state, source.id);
    // Convert flattener entries to the shape physics expects.
    // Every entry needs: type, subL (sub-units), stats, params.
    for (const entry of flat) {
      const def = COMPONENTS[entry.type] || COMPONENTS.drift;
      allOrdered.push({
        id: entry.id,
        type: entry.kind === 'drift' ? 'drift' : entry.type,
        col: entry.placeable?.col ?? 0,
        row: entry.placeable?.row ?? 0,
        dir: entry.placeable?.dir ?? 0,
        params: entry.params || {},
        tiles: entry.placeable?.cells?.map(c => ({ col: c.col, row: c.row })) || [],
        beamStart: entry.beamStart,
        subL: entry.subL,
        // Pass through stats from the component template so physics can read them
        stats: def ? { ...def.stats } : {},
        // Mark attachments for any downstream logic that cares
        isAttachment: entry.kind === 'attachment',
        pipeId: entry.pipeId || null,
      });
    }
  }

  this.state.beamline = allOrdered;
}
```

- [ ] **Step 2: Verify subL values survive the round-trip**

Add a debug assertion in `recalcBeamline()` (non-fatal):

```js
recalcBeamline() {
  this._deriveBeamGraph();
  const ordered = this.state.beamline;
  if (ordered.length === 0) return;

  // Contract check: every entry must have a positive subL so physics can
  // compute cumulative s correctly. A zero or missing subL would desync the
  // designer plot axis from the physics envelope.
  for (const node of ordered) {
    if (!node.subL || node.subL <= 0) {
      console.warn('[physics] element with bad subL', node);
    }
  }

  // ... rest of recalcBeamline from Task 8 ...
}
```

- [ ] **Step 3: Make the designer physics preview use the same list**

In `BeamlineDesigner.js`, the edit-mode preview currently builds its own physics input from `draftNodes`. Change it to use the exact same shape the flattener produces, so the envelope indices line up with the draft node indices one-for-one.

Find the designer's `_recomputePhysics()` (or equivalently-named method) and replace its beamline-building code with:

```js
_recomputePhysics() {
  // The draftNodes were built from flattenPath() in openFromSource(),
  // so they're already in the right order with correct subL values.
  // Build physics input directly from draftNodes — one input element per
  // draft node — so envelope[i] lines up with draftNodes[i] for plotting.
  const physicsInput = this.draftNodes.map(node => {
    const def = COMPONENTS[node.type] || COMPONENTS.drift;
    return {
      type: node.kind === 'drift' ? 'drift' : node.type,
      subL: node.subL,
      stats: def ? { ...def.stats } : {},
      params: node.params || {},
    };
  });

  // Collect research effects (same as Game.recalcBeamline)
  const researchEffects = {};
  for (const rId of this.game.state.completedResearch) {
    const r = RESEARCH[rId];
    if (r && r.effects) Object.assign(researchEffects, r.effects);
  }

  const result = BeamPhysics.compute(physicsInput, researchEffects);
  this.previewResult = result;
  this._render();
}
```

- [ ] **Step 4: Verify schematic x-axis matches envelope s-axis**

Find the designer's schematic layout code (where each draft node is placed on the schematic canvas). Confirm the x-coordinate is derived from `node.beamStart` accumulated in sub-units and converted to display units the same way the plots convert `envelope[i].s` (metres) to display units.

The conversion is:

- `node.beamStart` is in **metres** (cumulative from source, set by the flattener)
- `node.subL` is in **sub-units** (1 sub-unit = 0.5 m) — passed unchanged to physics
- `envelope[i].s` is in **metres** (set by `lattice.propagate()` using `length = subL * 0.5`)
- So `envelope[i].s ≈ draftNodes[i].beamStart` for every `i` (both metres)

Add a dev-mode assertion:

```js
// After running physics in _recomputePhysics:
if (this.previewResult && this.previewResult.envelope) {
  const env = this.previewResult.envelope;
  for (let i = 0; i < Math.min(env.length, this.draftNodes.length); i++) {
    const expectedS = this.draftNodes[i].beamStart;
    const actualS = env[i].s;
    if (Math.abs(expectedS - actualS) > 0.01) {
      console.warn(
        `[designer] s-axis misalignment at element ${i}: ` +
        `schematic=${expectedS.toFixed(3)}m envelope=${actualS.toFixed(3)}m`
      );
    }
  }
}
```

If this fires, the ordering or subL values have diverged somewhere — investigate before shipping.

- [ ] **Step 5: Document the contract in path-flattener.js**

Add to the top of `src/beamline/path-flattener.js`:

```js
// ---------------------------------------------------------------------------
// PHYSICS CONTRACT — read before modifying
//
// The flattener is the single source of truth for beam element ordering.
// Both the main map's Game._deriveBeamGraph() and BeamlineDesigner's edit
// mode call flattenPath() and consume its output directly. Any consumer
// that builds its own ordered list will desync from the physics envelope.
//
// Every entry has:
//   - beamStart: cumulative METRE position of the element's START from the source
//   - subL:      element length in sub-units (1 sub-unit = 0.5 m)
//
// Invariant: envelope[i].s (metres) === entries[i].beamStart (metres)
//            for every physics-generated envelope snapshot.
//
// When adding new entry kinds (e.g. splitter branches later), preserve
// the index-per-entry mapping so the designer plots stay aligned.
// ---------------------------------------------------------------------------
```

- [ ] **Step 6: Commit**

```bash
git add src/game/Game.js src/ui/BeamlineDesigner.js src/beamline/path-flattener.js
git commit -m "feat: unify physics input via flattener, enforce s-axis alignment contract"
```
