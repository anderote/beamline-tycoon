# Surface & Stacking System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow stackable items (oscilloscopes, monitors, etc.) to be placed on surfaces (desks, racks, tables) or stacked on each other, with auto-detection, 4m height cap, and collapse-on-delete.

**Architecture:** Parent-child stacking via `stackParentId`/`stackChildren` fields on placed instances. Floor-level items own `subgridOccupied` cells; stacked items bypass the 2D grid entirely. The renderer lifts meshes by `placeY * SUB_UNIT`. Placement auto-detects surface targets by walking the stack chain at the hovered XZ position.

**Tech Stack:** Vanilla JS, Three.js (CDN global)

---

### Task 1: Tag definitions with `hasSurface` and `stackable`

**Files:**
- Modify: `src/data/facility-lab-furnishings.raw.js` — add `stackable: true` to small items, `hasSurface: false` to irregular items
- Modify: `src/data/facility-room-furnishings.raw.js` — add `stackable: true` to small items
- Modify: `src/data/infrastructure.raw.js` — add `hasSurface: false` to irregular items

The convention: `hasSurface` defaults to `true` (applied in the placeable converters, Task 2), so raw files only need explicit `hasSurface: false` on items without flat tops. `stackable` defaults to `false`, so raw files only add `stackable: true` on small bench items.

- [ ] **Step 1: Add `stackable: true` to lab equipment small items**

In `src/data/facility-lab-furnishings.raw.js`, add `stackable: true` to these entries (append after `baseMaterial` or `faces` on the same line):
- `oscilloscope` (line 34)
- `signalGenerator` (line 35)
- `spectrumAnalyzer` (line 36)
- `networkAnalyzer` (line 37)
- `flowMeter` (line 42)
- `leakDetector` (line 44)
- `beamProfiler` (line 111)
- `mirrorMount` (line 110)
- `scopeStation` (line 113)

- [ ] **Step 2: Add `hasSurface: false` to irregular lab items**

In `src/data/facility-lab-furnishings.raw.js`, add `hasSurface: false` to:
- `coolantPump` (line 38) — cylindrical pump
- `pipeRack` (line 40) — open vertical rack
- `laserAlignment` (line 109) — long rail system
- `assemblyCrane` (line 84) — crane
- `craneHoist` (line 216) — crane

- [ ] **Step 3: Add `stackable: true` to room furnishing small items**

In `src/data/facility-room-furnishings.raw.js`, add `stackable: true` to:
- `coffeeMachine` (line 59)
- `microwave` (line 200)
- `alarmPanel` (line 151)
- `projector` (line 223)
- `phoneUnit` (line 224)

- [ ] **Step 4: Add `hasSurface: false` to irregular infrastructure items**

In `src/data/infrastructure.raw.js`, add `hasSurface: false` to items without flat tops. Scan each entry — most box-shaped racks/cabinets keep the default `true`. Set `false` on:
- `circulator` — waveguide component
- `rfCoupler` — waveguide component
- `cryomoduleHousing` — cylindrical vessel
- `roughingPump`, `turboPump`, `ionPump`, `negPump`, `tiSubPump` — pumps
- `piraniGauge`, `coldCathodeGauge`, `baGauge` — small sensors
- `gateValve` — valve
- `bakeoutSystem` — heating tapes
- `coolingTower` — tall open structure
- `shielding` — concrete blocks
- `beamDump` — shielded target
- `laserSystem` — optical rail

- [ ] **Step 5: Commit**

```
git add src/data/facility-lab-furnishings.raw.js src/data/facility-room-furnishings.raw.js src/data/infrastructure.raw.js
git commit -m "feat(stacking): tag items with stackable and hasSurface flags"
```

---

### Task 2: Wire flags through placeable converters

**Files:**
- Modify: `src/data/placeables/furnishings.js`
- Modify: `src/data/placeables/equipment.js`
- Modify: `src/data/placeables/infrastructure.js`

Each converter's map function needs to pass through `hasSurface` (defaulting `true`) and `stackable` (defaulting `false`).

- [ ] **Step 1: Update furnishings.js**

In `src/data/placeables/furnishings.js`, change the map return (line 23) from:

```javascript
  return { ...raw, kind: 'furnishing', subW, subL, subH };
```

to:

```javascript
  return { ...raw, kind: 'furnishing', subW, subL, subH, hasSurface: raw.hasSurface ?? true, stackable: raw.stackable ?? false };
```

- [ ] **Step 2: Update equipment.js**

In `src/data/placeables/equipment.js`, change the map return (line 23) from:

```javascript
  return { ...raw, kind: 'equipment', subW, subL, subH };
```

to:

```javascript
  return { ...raw, kind: 'equipment', subW, subL, subH, hasSurface: raw.hasSurface ?? true, stackable: raw.stackable ?? false };
```

- [ ] **Step 3: Update infrastructure.js**

In `src/data/placeables/infrastructure.js`, change the map return (line 29) from:

```javascript
  return { ...raw, kind: 'infrastructure', subW, subL, subH };
```

to:

```javascript
  return { ...raw, kind: 'infrastructure', subW, subL, subH, hasSurface: raw.hasSurface ?? true, stackable: raw.stackable ?? false };
```

- [ ] **Step 4: Verify the game loads without errors**

Run the dev server and confirm the game starts. Open the browser console and verify no errors from the Placeable constructor or placeable index.

- [ ] **Step 5: Commit**

```
git add src/data/placeables/furnishings.js src/data/placeables/equipment.js src/data/placeables/infrastructure.js
git commit -m "feat(stacking): wire hasSurface/stackable through placeable converters"
```

---

### Task 3: Add stacking fields to placed instances and stack helpers

**Files:**
- Modify: `src/game/Game.js:1525-1537` — add `placeY`, `stackParentId`, `stackChildren` to the entry object in `placePlaceable`
- Create: `src/game/stacking.js` — pure functions for stack resolution, containment checks, collapse logic

- [ ] **Step 1: Create `src/game/stacking.js` with constants and helpers**

```javascript
// src/game/stacking.js
//
// Pure stacking logic. No game state mutation — callers apply results.

import { PLACEABLES } from '../data/placeables/index.js';

export const MAX_STACK_HEIGHT = 8; // 4m in subtile units

function cellKey(c) {
  return c.col + ',' + c.row + ',' + c.subCol + ',' + c.subRow;
}

/**
 * Given a ground-level placeable instance, walk stackChildren to the topmost item.
 * Returns the topmost instance in the chain.
 */
export function topmostInStack(groundEntry, placeablesById) {
  let current = groundEntry;
  while (current.stackChildren && current.stackChildren.length > 0) {
    const lastChildId = current.stackChildren[current.stackChildren.length - 1];
    const child = placeablesById(lastChildId);
    if (!child) break;
    current = child;
  }
  return current;
}

/**
 * Check whether `stackableDef` (the item being placed) can stack on `targetEntry`
 * (the item it would sit on). Returns { ok, placeY, reason }.
 *
 * @param {object} stackableDef - Placeable definition of the item to place
 * @param {object} targetEntry  - Placed instance to stack on
 * @param {object} targetDef    - Placeable definition of the target
 * @param {number} col, row, subCol, subRow, dir - proposed placement position
 */
export function canStack(stackableDef, targetEntry, targetDef, col, row, subCol, subRow, dir) {
  if (!stackableDef.stackable) {
    return { ok: false, placeY: 0, reason: 'Item is not stackable' };
  }

  if (!targetDef.hasSurface && !targetDef.stackable) {
    return { ok: false, placeY: 0, reason: 'Target has no surface' };
  }

  // Footprint containment: stackable's cells must be a subset of target's cells.
  const targetCells = new Set(
    targetDef.footprintCells(targetEntry.col, targetEntry.row, targetEntry.subCol || 0, targetEntry.subRow || 0, targetEntry.dir || 0)
      .map(cellKey)
  );
  const stackCells = stackableDef.footprintCells(col, row, subCol, subRow, dir);
  for (const c of stackCells) {
    if (!targetCells.has(cellKey(c))) {
      return { ok: false, placeY: 0, reason: 'Does not fit on surface' };
    }
  }

  // Height cap
  const placeY = (targetEntry.placeY || 0) + (targetDef.subH || 1);
  if (placeY + stackableDef.subH > MAX_STACK_HEIGHT) {
    return { ok: false, placeY, reason: 'Exceeds height limit' };
  }

  return { ok: true, placeY, reason: null };
}

/**
 * Compute the collapse plan when deleting `entryId`. Returns null if the
 * deletion would violate constraints, otherwise returns an array of
 * { id, newPlaceY, newStackParentId } updates to apply.
 */
export function collapsePlan(entryId, getEntry, getDef) {
  const entry = getEntry(entryId);
  if (!entry) return null;
  const def = getDef(entry.type);
  if (!def) return null;

  const children = (entry.stackChildren || []).slice();
  if (children.length === 0) return [];

  const parentId = entry.stackParentId || null;
  const deletedHeight = def.subH || 1;
  const updates = [];

  function shiftDown(childId, newParentId, yShift) {
    const child = getEntry(childId);
    if (!child) return true;
    const newY = (child.placeY || 0) - yShift;
    if (newY < 0) return false;
    const childDef = getDef(child.type);
    if (childDef && newY + childDef.subH > MAX_STACK_HEIGHT) return false;
    updates.push({ id: childId, newPlaceY: newY, newStackParentId: newParentId });
    // Recursively shift this child's children too
    for (const grandchildId of (child.stackChildren || [])) {
      if (!shiftDown(grandchildId, childId, yShift)) return false;
    }
    return true;
  }

  for (const childId of children) {
    if (!shiftDown(childId, parentId, deletedHeight)) return null;
  }

  return updates;
}

/**
 * Find the stack target at a given XZ position. Looks up the ground-level
 * occupant, walks to the top of the stack, and checks if we can stack on it.
 * Returns { targetEntry, placeY } or null if no valid stack target.
 */
export function findStackTarget(stackableDef, col, row, subCol, subRow, dir, subgridOccupied, getEntry, getDef) {
  // Check all cells the stackable would occupy — they must all belong to the same ground item
  const cells = stackableDef.footprintCells(col, row, subCol, subRow, dir);
  let groundId = null;
  for (const c of cells) {
    const k = cellKey(c);
    const occ = subgridOccupied[k];
    if (!occ) return null; // at least one cell unoccupied — can't stack
    if (groundId === null) groundId = occ.id;
    else if (occ.id !== groundId) return null; // spans multiple items
  }

  const groundEntry = getEntry(groundId);
  if (!groundEntry) return null;

  // Walk to topmost item
  const topEntry = topmostInStack(groundEntry, getEntry);
  const topDef = getDef(topEntry.type);
  if (!topDef) return null;

  const result = canStack(stackableDef, topEntry, topDef, col, row, subCol, subRow, dir);
  if (!result.ok) return null;

  return { targetEntry: topEntry, placeY: result.placeY };
}
```

- [ ] **Step 2: Add stacking fields to the entry object in `placePlaceable`**

In `src/game/Game.js`, find the entry object creation (around line 1525-1537):

```javascript
    const entry = {
      id,
      type,
      category: kind,
      kind,
      col,
      row,
      subCol: subCol || 0,
      subRow: subRow || 0,
      dir,
      params: null,
      cells,
    };
```

Replace with:

```javascript
    const entry = {
      id,
      type,
      category: kind,
      kind,
      col,
      row,
      subCol: subCol || 0,
      subRow: subRow || 0,
      dir,
      params: null,
      cells,
      placeY: 0,
      stackParentId: null,
      stackChildren: [],
    };
```

- [ ] **Step 3: Commit**

```
git add src/game/stacking.js src/game/Game.js
git commit -m "feat(stacking): add stacking helpers and instance fields"
```

---

### Task 4: Integrate stacking into placement flow

**Files:**
- Modify: `src/game/Game.js:1461-1575` — update `placePlaceable` to handle stacked placement
- Modify: `src/game/Game.js:1580-1627` — update `removePlaceable` to handle collapse

- [ ] **Step 1: Update `placePlaceable` to support stacking**

At the top of `src/game/Game.js`, add the import (near existing imports):

```javascript
import { findStackTarget, collapsePlan } from './stacking.js';
```

In `placePlaceable` (around line 1461), the method currently receives `opts` and destructures them. Add `placeY` and `stackParentId` to the opts:

Find the line (around 1464-1465):
```javascript
    const placeable = PLACEABLES[type];
    if (!placeable) return false;
```

After the `if (!placeable) return false;` line, add stack target resolution. The key change: when the item is `stackable` and the target cells are occupied, instead of rejecting, try to find a stack target:

```javascript
    // --- Stack target resolution ---
    let stackTarget = null;
    if (placeable.stackable) {
      const getEntry = (id) => {
        const idx = this.state.placeableIndex[id];
        return idx !== undefined ? this.state.placeables[idx] : null;
      };
      const getDef = (t) => PLACEABLES[t] || null;
      stackTarget = findStackTarget(
        placeable, col, row, subCol || 0, subRow || 0, dir,
        this.state.subgridOccupied, getEntry, getDef,
      );
    }
```

Then modify the collision check. Currently (around line 1482-1488) it does:

```javascript
    const cells = placeable.footprintCells(col, row, subCol || 0, subRow || 0, dir);
    for (const c of cells) {
      const k = c.col + ',' + c.row + ',' + c.subCol + ',' + c.subRow;
      if (this.state.subgridOccupied[k]) {
        this.log('Space is occupied!', 'bad');
        return false;
      }
    }
```

Replace with:

```javascript
    const cells = placeable.footprintCells(col, row, subCol || 0, subRow || 0, dir);
    if (stackTarget) {
      // Stacking — cells are occupied by the ground item, which is expected.
      // No subgridOccupied registration for stacked items.
    } else {
      for (const c of cells) {
        const k = c.col + ',' + c.row + ',' + c.subCol + ',' + c.subRow;
        if (this.state.subgridOccupied[k]) {
          this.log('Space is occupied!', 'bad');
          return false;
        }
      }
    }
```

Then in the entry creation, set the stacking fields:

After the entry object is created (the one we modified in Task 3), add:

```javascript
    if (stackTarget) {
      entry.placeY = stackTarget.placeY;
      entry.stackParentId = stackTarget.targetEntry.id;
      entry.cells = []; // stacked items don't occupy subgrid
      // Register as child of target
      stackTarget.targetEntry.stackChildren.push(id);
    }
```

And update the subgridOccupied loop to skip stacked items. Find (around line 1558-1561):

```javascript
    for (const c of cells) {
      const k = c.col + ',' + c.row + ',' + c.subCol + ',' + c.subRow;
      this.state.subgridOccupied[k] = { id, kind };
    }
```

Replace with:

```javascript
    if (!stackTarget) {
      for (const c of cells) {
        const k = c.col + ',' + c.row + ',' + c.subCol + ',' + c.subRow;
        this.state.subgridOccupied[k] = { id, kind };
      }
    }
```

- [ ] **Step 2: Update `removePlaceable` to handle stack collapse**

In `removePlaceable` (around line 1580), after validating the entry exists, add collapse logic.

After `const placeable = PLACEABLES[entry.type];` and its null check, add:

```javascript
    // --- Stack collapse check ---
    const getEntry = (id) => {
      const idx = this.state.placeableIndex[id];
      return idx !== undefined ? this.state.placeables[idx] : null;
    };
    const getDef = (t) => PLACEABLES[t] || null;

    const updates = collapsePlan(placeableId, getEntry, getDef);
    if (updates === null) {
      this.log('Cannot remove — stack would exceed height limit!', 'bad');
      return false;
    }
```

After the existing subgridOccupied cleanup (around line 1602-1605), add the collapse application:

```javascript
    // Apply stack collapse
    if (entry.stackParentId) {
      const parent = getEntry(entry.stackParentId);
      if (parent) {
        parent.stackChildren = parent.stackChildren.filter(cid => cid !== placeableId);
      }
    }
    // Reparent children
    for (const childId of (entry.stackChildren || [])) {
      const child = getEntry(childId);
      if (child) {
        child.stackParentId = entry.stackParentId || null;
        if (entry.stackParentId) {
          const newParent = getEntry(entry.stackParentId);
          if (newParent && !newParent.stackChildren.includes(childId)) {
            newParent.stackChildren.push(childId);
          }
        }
      }
    }
    // Apply Y shifts from collapse plan
    for (const u of updates) {
      const child = getEntry(u.id);
      if (!child) continue;
      child.placeY = u.newPlaceY;
      child.stackParentId = u.newStackParentId;
      // If child collapsed to floor, register its cells in subgridOccupied
      if (u.newStackParentId === null && child.placeY === 0) {
        const childDef = getDef(child.type);
        if (childDef) {
          const childCells = childDef.footprintCells(child.col, child.row, child.subCol || 0, child.subRow || 0, child.dir || 0);
          child.cells = childCells;
          for (const c of childCells) {
            const k = c.col + ',' + c.row + ',' + c.subCol + ',' + c.subRow;
            this.state.subgridOccupied[k] = { id: child.id, kind: child.kind };
          }
        }
      }
    }
```

- [ ] **Step 3: Verify game loads and basic placement still works**

Run the dev server. Place a desk, then place and remove it. Confirm no console errors.

- [ ] **Step 4: Commit**

```
git add src/game/Game.js
git commit -m "feat(stacking): integrate stack placement and collapse into Game"
```

---

### Task 5: Update placement preview for stacking

**Files:**
- Modify: `src/input/InputHandler.js:2567-2597` — update `_updatePlaceablePreview` to compute stack target and pass `placeY` to the ghost
- Modify: `src/renderer3d/ThreeRenderer.js:1396-1483` — update `renderPlaceableGhost` to use `placeY`

- [ ] **Step 1: Update `_updatePlaceablePreview` in InputHandler**

In `src/input/InputHandler.js`, add import at the top (near existing imports from game/):

```javascript
import { findStackTarget } from '../game/stacking.js';
```

Replace `_updatePlaceablePreview` (lines 2567-2597) with:

```javascript
  _updatePlaceablePreview() {
    if (!this.selectedPlaceableId) {
      this.hoverPlaceable = null;
      return;
    }
    if (this.selectedTool && COMPONENTS[this.selectedTool]?.isDrawnConnection) {
      this.hoverPlaceable = null;
      return;
    }
    const placeable = PLACEABLES[this.selectedPlaceableId];
    if (!placeable) return;
    const wx = this.lastMouseWorldX ?? 0;
    const wy = this.lastMouseWorldY ?? 0;
    const snap = snapForPlaceable(wx, wy, placeable, this.placementDir);

    let placeY = 0;
    let stackTargetId = null;
    let ok = false;

    if (placeable.stackable) {
      const getEntry = (id) => {
        const idx = this.game.state.placeableIndex[id];
        return idx !== undefined ? this.game.state.placeables[idx] : null;
      };
      const getDef = (t) => PLACEABLES[t] || null;
      const st = findStackTarget(
        placeable, snap.col, snap.row, snap.subCol, snap.subRow, this.placementDir,
        this.game.state.subgridOccupied, getEntry, getDef,
      );
      if (st) {
        placeY = st.placeY;
        stackTargetId = st.targetEntry.id;
        ok = true;
      } else {
        // Fall back to normal floor placement check
        const result = canPlace(
          this.game, placeable,
          snap.col, snap.row, snap.subCol, snap.subRow,
          this.placementDir,
        );
        ok = result.ok;
      }
    } else {
      const result = canPlace(
        this.game, placeable,
        snap.col, snap.row, snap.subCol, snap.subRow,
        this.placementDir,
      );
      ok = result.ok;
    }

    this.hoverPlaceable = {
      id: this.selectedPlaceableId,
      col: snap.col,
      row: snap.row,
      subCol: snap.subCol,
      subRow: snap.subRow,
      dir: this.placementDir,
      placeY,
      stackTargetId,
    };
    this.renderer.renderPlaceableGhost(this.hoverPlaceable, ok);
  }
```

- [ ] **Step 2: Update `renderPlaceableGhost` in ThreeRenderer**

In `src/renderer3d/ThreeRenderer.js`, find `renderPlaceableGhost` (line 1396). The position calculation is around line 1455-1459:

```javascript
    const px = col * 2 + sc * SUB_UNIT + footW / 2;
    const pz = row * 2 + sr * SUB_UNIT + footH / 2;
    const vSubH = placeable.visualSubH ?? placeable.subH ?? 2;
    const y = isDetailed ? 0 : (vSubH * SUB_UNIT) / 2;
    obj.position.set(px, y, pz);
```

Replace with:

```javascript
    const px = col * 2 + sc * SUB_UNIT + footW / 2;
    const pz = row * 2 + sr * SUB_UNIT + footH / 2;
    const placeYOffset = (hover.placeY || 0) * SUB_UNIT;
    const vSubH = placeable.visualSubH ?? placeable.subH ?? 2;
    const y = isDetailed ? placeYOffset : placeYOffset + (vSubH * SUB_UNIT) / 2;
    obj.position.set(px, y, pz);
```

Also update the floor outline to render at the stacking height. Find the `pts` array (around line 1472-1476):

```javascript
    const pts = [
      new THREE.Vector3(x0, 0.12, z0), new THREE.Vector3(x1, 0.12, z0),
      new THREE.Vector3(x1, 0.12, z1), new THREE.Vector3(x0, 0.12, z1),
      new THREE.Vector3(x0, 0.12, z0),
    ];
```

Replace with:

```javascript
    const outlineY = placeYOffset + 0.12;
    const pts = [
      new THREE.Vector3(x0, outlineY, z0), new THREE.Vector3(x1, outlineY, z0),
      new THREE.Vector3(x1, outlineY, z1), new THREE.Vector3(x0, outlineY, z1),
      new THREE.Vector3(x0, outlineY, z0),
    ];
```

And update the fill plane (around line 1480-1481):

```javascript
    fill.position.set(px, 0.1, pz);
```

Replace with:

```javascript
    fill.position.set(px, placeYOffset + 0.1, pz);
```

- [ ] **Step 3: Commit**

```
git add src/input/InputHandler.js src/renderer3d/ThreeRenderer.js
git commit -m "feat(stacking): placement preview shows ghost at correct stack height"
```

---

### Task 6: Update equipment builder to render at `placeY`

**Files:**
- Modify: `src/renderer3d/world-snapshot.js:164-177,446-455` — pass through `placeY` field
- Modify: `src/renderer3d/equipment-builder.js:110-231` — use `placeY` for Y positioning

- [ ] **Step 1: Pass `placeY` through world snapshot**

In `src/renderer3d/world-snapshot.js`, update `buildEquipment` (line 167-176) to include `placeY`:

Find:
```javascript
  return equip.map(eq => ({
    key: eq.col + ',' + eq.row,
    id: eq.id,
    type: eq.type ?? null,
    col: eq.col ?? null,
    row: eq.row ?? null,
    subCol: eq.subCol ?? null,
    subRow: eq.subRow ?? null,
    dir: eq.dir ?? 0,
  }));
```

Replace with:
```javascript
  return equip.map(eq => ({
    key: eq.col + ',' + eq.row,
    id: eq.id,
    type: eq.type ?? null,
    col: eq.col ?? null,
    row: eq.row ?? null,
    subCol: eq.subCol ?? null,
    subRow: eq.subRow ?? null,
    dir: eq.dir ?? 0,
    placeY: eq.placeY || 0,
  }));
```

Update `buildFurnishings` (line 447-454) similarly:

Find:
```javascript
  return (game.state.zoneFurnishings || []).map(f => ({
    col: f.col,
    row: f.row,
    subCol: f.subCol ?? null,
    subRow: f.subRow ?? null,
    type: f.type,
    dir: f.dir ?? 0,
  }));
```

Replace with:
```javascript
  return (game.state.zoneFurnishings || []).map(f => ({
    col: f.col,
    row: f.row,
    subCol: f.subCol ?? null,
    subRow: f.subRow ?? null,
    type: f.type,
    dir: f.dir ?? 0,
    placeY: f.placeY || 0,
  }));
```

- [ ] **Step 2: Use `placeY` in equipment-builder positioning**

In `src/renderer3d/equipment-builder.js`, in the `placeOne` function:

Add after `const centerZ = ...;` (line 129):

```javascript
      const baseY = (item.placeY || 0) * SUB_UNIT;
```

For the **parts path** (around line 165), change:

```javascript
        group.position.set(centerX, 0, centerZ);
```

to:

```javascript
        group.position.set(centerX, baseY, centerZ);
```

For the **single-box path** (around line 211), change:

```javascript
      mesh.position.set(0, h / 2, 0);
```

to:

```javascript
      mesh.position.set(0, h / 2, 0);
```

This stays the same because the mesh is relative to the wrapper. Update the **wrapper** (around line 215):

```javascript
      wrapper.position.set(centerX, 0, centerZ);
```

to:

```javascript
      wrapper.position.set(centerX, baseY, centerZ);
```

- [ ] **Step 3: Test visually**

Run the dev server. Place a desk, then place an oscilloscope on it. The oscilloscope should render sitting on top of the desk surface. Place a second oscilloscope — it should stack on top of the first. Delete the bottom oscilloscope — the top one should drop to the desk surface.

- [ ] **Step 4: Commit**

```
git add src/renderer3d/world-snapshot.js src/renderer3d/equipment-builder.js
git commit -m "feat(stacking): render equipment at placeY height"
```

---

### Task 7: Handle save/load backward compatibility

**Files:**
- Modify: `src/game/Game.js` — ensure loaded saves without stacking fields get defaults

- [ ] **Step 1: Add migration in the save-load hydration path**

Find the save hydration section in Game.js. Search for where `subgridOccupied` is rebuilt on load (around line 3546 or 3767). In that section, after existing placeables are iterated, add field defaults:

Find the loop that iterates placeables during load and add after each entry is processed:

```javascript
        if (entry.placeY == null) entry.placeY = 0;
        if (!entry.stackParentId) entry.stackParentId = null;
        if (!entry.stackChildren) entry.stackChildren = [];
```

This ensures old saves gain the new fields with safe defaults. All existing items are floor-level with no stacking, which is correct.

- [ ] **Step 2: Commit**

```
git add src/game/Game.js
git commit -m "feat(stacking): backward-compatible save/load migration"
```

---

### Task 8: End-to-end manual test

- [ ] **Step 1: Test surface placement**

1. Start the game, build an office zone, place a desk
2. Select an oscilloscope (or coffee machine if in office) — move cursor over the desk
3. Verify: ghost appears elevated on the desk surface, green tint
4. Click to place — item renders on the desk
5. Place a second stackable item on top — should stack

- [ ] **Step 2: Test floor stacking**

1. Place an oscilloscope on the floor
2. Place another oscilloscope on top of it
3. Stack up to 4m total height (8 subtiles)
4. Try to exceed — placement should be rejected (red ghost or no placement)

- [ ] **Step 3: Test deletion and collapse**

1. Build a desk with 2 oscilloscopes stacked on it
2. Delete the bottom oscilloscope — top one should drop to the desk surface
3. Delete the desk — oscilloscopes should drop to the floor
4. Build a desk, stack items to near the height limit, try deleting the desk — should be blocked if collapse would exceed limit

- [ ] **Step 4: Test save/load roundtrip**

1. Build a stack of items, save the game
2. Reload — stacked items should appear at correct heights
3. Verify stack relationships survive (can delete and collapse works)
