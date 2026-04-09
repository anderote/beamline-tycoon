# Wall System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add edge-based wall placement to the game — walls sit on tile edges, placed via click-and-drag, rendered as vertical parallelograms in isometric view.

**Architecture:** Walls are stored as `{type, col, row, edge}` entries where `edge` is `'e'` (SE) or `'s'` (SW). A new `WALL_TYPES` export in `infrastructure.js` defines wall properties. The InputHandler detects the nearest tile edge using fractional grid coordinates and supports drag-to-place along connected edges. The infrastructure renderer draws walls as colored polygons with height varying by type.

**Tech Stack:** Vanilla JS, PixiJS v8 (CDN global), existing isometric grid system (64x32 tiles)

---

### Task 1: Update wall definitions in infrastructure.js

Replace the 6 existing full-tile wall items in `INFRASTRUCTURE` with a new `WALL_TYPES` export. Walls are no longer infrastructure items — they have their own data structure.

**Files:**
- Modify: `src/data/infrastructure.js`

- [ ] **Step 1: Replace wall items with WALL_TYPES export**

Remove all 6 wall entries (`concreteWall`, `brickWall`, `metalPanel`, `glassWall`, `drywall`, `labPartition`) from the `INFRASTRUCTURE` object. Add a new `WALL_TYPES` export after `INFRASTRUCTURE`:

```js
// Wall types — placed on tile edges, not full tiles
export const WALL_TYPES = {
  officeWall: {
    id: 'officeWall',
    name: 'Office Wall',
    desc: 'Standard drywall partition for dividing office and admin spaces.',
    cost: 15,
    color: 0xccccbb,
    topColor: 0xddddcc,
    wallHeight: 14,
    subsection: 'interior',
    isWall: true,
  },
  cubicleWall: {
    id: 'cubicleWall',
    name: 'Cubicle Wall',
    desc: 'Low cubicle divider for open-plan office layouts.',
    cost: 8,
    color: 0x99aabb,
    topColor: 0xaabbcc,
    wallHeight: 8,
    subsection: 'interior',
    isWall: true,
  },
  exteriorWall: {
    id: 'exteriorWall',
    name: 'Exterior Wall',
    desc: 'Reinforced concrete building wall for enclosing structures.',
    cost: 25,
    color: 0x888888,
    topColor: 0xaaaaaa,
    wallHeight: 24,
    subsection: 'exterior',
    isWall: true,
  },
  chainLinkFence: {
    id: 'chainLinkFence',
    name: 'Chain Link Fence',
    desc: 'Standard chain link perimeter fencing.',
    cost: 10,
    color: 0x889999,
    topColor: 0xaabbbb,
    wallHeight: 14,
    subsection: 'exterior',
    isWall: true,
  },
  barbedWireFence: {
    id: 'barbedWireFence',
    name: 'Barbed Wire Fence',
    desc: 'Chain link fence with barbed wire top for secure perimeters.',
    cost: 18,
    color: 0x778888,
    topColor: 0x99aaaa,
    wallHeight: 18,
    subsection: 'exterior',
    isWall: true,
  },
  woodFence: {
    id: 'woodFence',
    name: 'Wood Fence',
    desc: 'Wooden slat fence for boundaries and decorative enclosures.',
    cost: 12,
    color: 0x997755,
    topColor: 0xbb9966,
    wallHeight: 14,
    subsection: 'exterior',
    isWall: true,
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/data/infrastructure.js
git commit -m "refactor: replace full-tile wall items with WALL_TYPES edge-based definitions"
```

---

### Task 2: Add isoToGridFloat to grid.js

The edge detection system needs fractional grid coordinates (without `Math.floor`).

**Files:**
- Modify: `src/renderer/grid.js`

- [ ] **Step 1: Add isoToGridFloat function**

Add this after the existing `isoToGrid` function at line 24:

```js
/**
 * Convert isometric screen position to fractional grid coordinates (no rounding).
 * Used for edge detection — determines which edge of a tile the cursor is nearest to.
 */
export function isoToGridFloat(screenX, screenY) {
  return {
    col: (screenX / (TILE_W / 2) + screenY / (TILE_H / 2)) / 2,
    row: (screenY / (TILE_H / 2) - screenX / (TILE_W / 2)) / 2,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/grid.js
git commit -m "feat: add isoToGridFloat for fractional grid coordinate conversion"
```

---

### Task 3: Add wall state and methods to Game.js

Add wall storage to game state, placement/removal methods, and save/load support.

**Files:**
- Modify: `src/game/Game.js`

- [ ] **Step 1: Add wall state to initial state object**

In the constructor's `this.state = { ... }` block, after the `decorationNextId` line (around line 57), add:

```js
      // Walls (edge-based)
      walls: [],              // [{ type, col, row, edge }]  edge = 'e' | 's'
      wallOccupied: {},       // "col,row,edge" -> wallType
```

- [ ] **Step 2: Add WALL_TYPES import**

Update the infrastructure import at the top of Game.js. Find the line:

```js
import { INFRASTRUCTURE, ZONES, ZONE_FURNISHINGS, ... } from '../data/infrastructure.js';
```

Add `WALL_TYPES` to it:

```js
import { INFRASTRUCTURE, ZONES, ZONE_FURNISHINGS, WALL_TYPES, ... } from '../data/infrastructure.js';
```

- [ ] **Step 3: Add placeWall method**

Add after the `removeInfraTile` method (around line 506):

```js
  // === WALLS (EDGE-BASED) ===

  placeWall(col, row, edge, wallType) {
    const wt = WALL_TYPES[wallType];
    if (!wt) return false;
    const key = `${col},${row},${edge}`;
    if (this.state.wallOccupied[key] === wallType) return true; // already same type
    if (this.state.wallOccupied[key]) {
      // Replace existing wall
      this.state.walls = this.state.walls.filter(
        w => !(w.col === col && w.row === row && w.edge === edge)
      );
    }
    if (this.state.resources.funding < wt.cost) return false;
    this.state.resources.funding -= wt.cost;
    this.state.walls.push({ type: wallType, col, row, edge });
    this.state.wallOccupied[key] = wallType;
    return true;
  }

  placeWallPath(path, wallType) {
    const wt = WALL_TYPES[wallType];
    if (!wt) return false;
    let placed = 0;
    for (const pt of path) {
      const key = `${pt.col},${pt.row},${pt.edge}`;
      if (this.state.wallOccupied[key] === wallType) continue;
      if (this.state.resources.funding < wt.cost) break;
      if (this.state.wallOccupied[key]) {
        this.state.walls = this.state.walls.filter(
          w => !(w.col === pt.col && w.row === pt.row && w.edge === pt.edge)
        );
      }
      this.state.resources.funding -= wt.cost;
      this.state.walls.push({ type: wallType, col: pt.col, row: pt.row, edge: pt.edge });
      this.state.wallOccupied[key] = wallType;
      placed++;
    }
    if (placed > 0) {
      this.log(`Placed ${placed} ${wt.name} segments ($${placed * wt.cost})`, 'good');
      this.emit('wallsChanged');
    }
    return placed > 0;
  }

  removeWall(col, row, edge) {
    const key = `${col},${row},${edge}`;
    const wallType = this.state.wallOccupied[key];
    if (!wallType) return false;
    const wt = WALL_TYPES[wallType];
    // 50% refund
    if (wt) this.state.resources.funding += Math.floor(wt.cost * 0.5);
    this.state.walls = this.state.walls.filter(
      w => !(w.col === col && w.row === row && w.edge === edge)
    );
    delete this.state.wallOccupied[key];
    this.emit('wallsChanged');
    return true;
  }
```

- [ ] **Step 4: Add wall rebuild in load path**

In the `load()` method, after the decoration rebuild block (around line 1997), add:

```js
      // Rebuild wall state
      this.state.walls = this.state.walls || [];
      this.state.wallOccupied = {};
      for (const w of this.state.walls) {
        this.state.wallOccupied[`${w.col},${w.row},${w.edge}`] = w.type;
      }
```

Also add the same block in `_migrateV5()` after the connections restore (around line 2119).

- [ ] **Step 5: Commit**

```bash
git add src/game/Game.js
git commit -m "feat: add wall state, placeWall/removeWall methods, save/load support"
```

---

### Task 4: Add wall layer to Renderer.js

Add a dedicated rendering layer for walls between zones and the drag preview.

**Files:**
- Modify: `src/renderer/Renderer.js`

- [ ] **Step 1: Add wallLayer property**

In the constructor, after `this.infraLayer = null;` (line 82), add:

```js
    this.wallLayer = null;
```

- [ ] **Step 2: Create wallLayer container**

After the `zoneLayer` setup (line 148), add:

```js
    this.wallLayer = new PIXI.Container();
    this.wallLayer.zIndex = 0.57;
    this.wallLayer.sortableChildren = true;
    this.world.addChild(this.wallLayer);
```

- [ ] **Step 3: Add wallsChanged event handler**

In the event handler switch (around line 220), add a new case:

```js
        case 'wallsChanged':
          this._renderWalls();
          break;
```

- [ ] **Step 4: Add _renderWalls call to full render**

In the full render path (around line 268, after `_renderInfrastructure()`), add:

```js
    this._renderWalls();
```

Also add it after `_renderZones()` in the `'loaded'` event case (around line 216):

```js
          this._renderWalls();
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/Renderer.js
git commit -m "feat: add wallLayer to renderer with wallsChanged event handling"
```

---

### Task 5: Wall rendering in infrastructure-renderer.js

Add the `_renderWalls` method and wall edge preview. Also clean up the full-tile wall rendering code added earlier.

**Files:**
- Modify: `src/renderer/infrastructure-renderer.js`

- [ ] **Step 1: Add WALL_TYPES import**

Update the import at the top of the file. Change:

```js
import { INFRASTRUCTURE, ZONES, ZONE_FURNISHINGS } from '../data/infrastructure.js';
```

To:

```js
import { INFRASTRUCTURE, ZONES, ZONE_FURNISHINGS, WALL_TYPES } from '../data/infrastructure.js';
```

- [ ] **Step 2: Remove the full-tile wall rendering from _drawInfraTile**

Revert the `_drawInfraTile` method to remove the `isWall` branch. The method should no longer check for `infra.isWall`. Restore the original `const depth = 6;` line (remove the ternary). Remove the entire `if (infra.isWall) { ... return; }` block that draws tall iso blocks.

The `_drawInfraTile` method should start:

```js
Renderer.prototype._drawInfraTile = function(col, row, infra, hasRight, hasBelow, variant, sideColor) {
  const pos = tileCenterIso(col, row);
  const hw = TILE_W / 2;
  const hh = TILE_H / 2;
  const depth = 6;
  const sColor = sideColor || infra.color;
  const isoDepth = col + row;

  // Side faces — drawn below the grid layer so grid lines appear on top
  if (!hasRight || !hasBelow) {
```

Also remove the `_darkenColor` method added previously (it will be re-added below with the wall renderer).

- [ ] **Step 3: Add _renderWalls method**

Add after the `_darkenColor` removal point (after `_drawInfraTile` closing `};`):

```js
// --- Wall rendering (edge-based) ---

Renderer.prototype._renderWalls = function() {
  this.wallLayer.removeChildren();
  const walls = this.game.state.walls || [];
  // Sort by isometric depth so front walls overlap back walls
  const sorted = [...walls].sort((a, b) => (a.col + a.row) - (b.col + b.row));
  for (const wall of sorted) {
    const wt = WALL_TYPES[wall.type];
    if (!wt) continue;
    this._drawWallEdge(wall.col, wall.row, wall.edge, wt);
  }
};

Renderer.prototype._drawWallEdge = function(col, row, edge, wt) {
  const pos = tileCenterIso(col, row);
  const hw = TILE_W / 2;
  const hh = TILE_H / 2;
  const h = wt.wallHeight;
  const isoDepth = (col + row) * 10 + 5;
  const g = new PIXI.Graphics();

  if (edge === 'e') {
    // SE edge: from right vertex (cx+hw, cy) to bottom vertex (cx, cy+hh)
    // Wall face is a vertical parallelogram
    g.poly([
      pos.x + hw, pos.y,           // bottom-right of wall base
      pos.x, pos.y + hh,           // bottom-left of wall base
      pos.x, pos.y + hh - h,       // top-left of wall
      pos.x + hw, pos.y - h,       // top-right of wall
    ]);
    g.fill({ color: this._darkenWallColor(wt.color, 0.85) });
    // Top edge highlight
    g.moveTo(pos.x + hw, pos.y - h);
    g.lineTo(pos.x, pos.y + hh - h);
    g.stroke({ color: wt.topColor, width: 1, alpha: 0.6 });
  } else {
    // SW edge: from bottom vertex (cx, cy+hh) to left vertex (cx-hw, cy)
    g.poly([
      pos.x, pos.y + hh,           // bottom-right of wall base
      pos.x - hw, pos.y,           // bottom-left of wall base
      pos.x - hw, pos.y - h,       // top-left of wall
      pos.x, pos.y + hh - h,       // top-right of wall
    ]);
    g.fill({ color: this._darkenWallColor(wt.color, 0.7) });
    // Top edge highlight
    g.moveTo(pos.x, pos.y + hh - h);
    g.lineTo(pos.x - hw, pos.y - h);
    g.stroke({ color: wt.topColor, width: 1, alpha: 0.6 });
  }

  g.zIndex = isoDepth;
  this.wallLayer.addChild(g);
};

Renderer.prototype._darkenWallColor = function(color, factor) {
  const r = Math.floor(((color >> 16) & 0xff) * factor);
  const g = Math.floor(((color >> 8) & 0xff) * factor);
  const b = Math.floor((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
};
```

- [ ] **Step 4: Add wall edge preview for placement**

Add after `_drawWallEdge`:

```js
Renderer.prototype.renderWallPreview = function(path, wallType) {
  this.dragPreviewLayer.removeChildren();
  if (!path || path.length === 0) return;

  const wt = WALL_TYPES[wallType];
  if (!wt) return;
  const totalCost = path.length * wt.cost;
  const canAfford = this.game.state.resources.funding >= totalCost;

  for (const pt of path) {
    const pos = tileCenterIso(pt.col, pt.row);
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;
    const h = wt.wallHeight;
    const occupied = this.game.state.wallOccupied[`${pt.col},${pt.row},${pt.edge}`];
    const ok = canAfford && !occupied;
    const g = new PIXI.Graphics();

    if (pt.edge === 'e') {
      g.poly([
        pos.x + hw, pos.y,
        pos.x, pos.y + hh,
        pos.x, pos.y + hh - h,
        pos.x + hw, pos.y - h,
      ]);
    } else {
      g.poly([
        pos.x, pos.y + hh,
        pos.x - hw, pos.y,
        pos.x - hw, pos.y - h,
        pos.x, pos.y + hh - h,
      ]);
    }
    g.fill({ color: ok ? wt.color : 0xcc3333, alpha: 0.5 });
    g.stroke({ color: ok ? 0xffffff : 0xff4444, width: 1, alpha: 0.5 });
    this.dragPreviewLayer.addChild(g);
  }

  // Cost label at last edge
  const last = path[path.length - 1];
  const labelPos = tileCenterIso(last.col, last.row);
  const label = new PIXI.Text({
    text: `$${totalCost} (${path.length} segments)`,
    style: { fontFamily: 'monospace', fontSize: 10, fill: canAfford ? 0xffffff : 0xff4444 },
  });
  label.anchor.set(0.5, 0.5);
  label.x = labelPos.x;
  label.y = labelPos.y - 16;
  this.dragPreviewLayer.addChild(label);
};

Renderer.prototype.renderWallEdgeHighlight = function(col, row, edge) {
  this.dragPreviewLayer.removeChildren();
  if (col == null || edge == null) return;

  const pos = tileCenterIso(col, row);
  const hw = TILE_W / 2;
  const hh = TILE_H / 2;
  const g = new PIXI.Graphics();

  if (edge === 'e') {
    g.moveTo(pos.x + hw, pos.y);
    g.lineTo(pos.x, pos.y + hh);
  } else {
    g.moveTo(pos.x, pos.y + hh);
    g.lineTo(pos.x - hw, pos.y);
  }
  g.stroke({ color: 0xffffff, width: 2, alpha: 0.7 });
  this.dragPreviewLayer.addChild(g);
};
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/infrastructure-renderer.js
git commit -m "feat: add edge-based wall rendering and placement preview"
```

---

### Task 6: Wall placement in InputHandler.js

Add edge detection, wall tool selection, and drag-to-place for walls.

**Files:**
- Modify: `src/input/InputHandler.js`

- [ ] **Step 1: Add imports**

Add `WALL_TYPES` to the infrastructure import:

```js
import { INFRASTRUCTURE, ZONES, ZONE_FURNISHINGS, WALL_TYPES } from '../data/infrastructure.js';
```

Add `isoToGridFloat` to the grid import:

```js
import { isoToGrid, isoToGridFloat, tileCenterIso } from '../renderer/grid.js';
```

- [ ] **Step 2: Add wall state properties**

In the constructor, after `this.isDrawingLine = false;` / `this.linePath = [];` (around line 42), add:

```js
    // Wall placement (edge-based)
    this.selectedWallTool = null;  // wall type key or null
    this.isDrawingWall = false;
    this.wallPath = [];            // [{ col, row, edge }]
```

- [ ] **Step 3: Add edge detection helper**

Add a new method to InputHandler:

```js
  /**
   * Given screen coordinates, return the nearest tile edge as { col, row, edge }.
   * edge is 'e' (SE) or 's' (SW), canonicalized so each edge has one unique key.
   */
  _getNearestEdge(screenX, screenY) {
    const world = this.renderer.screenToWorld(screenX, screenY);
    const gf = isoToGridFloat(world.x, world.y);
    const col = Math.floor(gf.col);
    const row = Math.floor(gf.row);
    const fx = gf.col - col; // fractional x within tile [0,1)
    const fy = gf.row - row; // fractional y within tile [0,1)

    // Distance to each edge
    const dN = fy;          // north edge
    const dS = 1 - fy;      // south edge
    const dE = 1 - fx;      // east edge
    const dW = fx;           // west edge

    const min = Math.min(dN, dS, dE, dW);

    // Canonicalize: north → (col, row-1, 's'), west → (col-1, row, 'e')
    if (min === dN) return { col, row: row - 1, edge: 's' };
    if (min === dS) return { col, row, edge: 's' };
    if (min === dE) return { col, row, edge: 'e' };
    /* dW */      return { col: col - 1, row, edge: 'e' };
  }
```

- [ ] **Step 4: Add wall tool selection method**

```js
  selectWallTool(wallType) {
    this.deselectAllTools();
    this.selectedWallTool = wallType;
  }

  deselectWallTool() {
    this.selectedWallTool = null;
    this.isDrawingWall = false;
    this.wallPath = [];
    this.renderer.clearDragPreview();
  }
```

- [ ] **Step 5: Update deselectAllTools**

Find the existing `deselectInfraTool` method. There may also be a general deselect path. In whichever deselect method is called when switching tools, add:

```js
    this.selectedWallTool = null;
    this.isDrawingWall = false;
    this.wallPath = [];
```

Check if `deselectInfraTool` is the main deselect. If so, add the wall cleanup there. If there's a separate `deselectAllTools`, add it there instead.

- [ ] **Step 6: Add wall mousedown handler**

In the `pointerdown` handler, after the infrastructure line placement start block (around line 374), add:

```js
      // Wall edge placement start
      if (e.button === 0 && this.selectedWallTool) {
        const edge = this._getNearestEdge(e.clientX, e.clientY);
        this.isDrawingWall = true;
        this.wallPath = [edge];
        this.renderer.renderWallPreview(this.wallPath, this.selectedWallTool);
        return;
      }
```

- [ ] **Step 7: Add wall mousemove handler**

In the `pointermove` handler, after the `isDrawingLine` block (around line 440), add:

```js
      } else if (this.isDrawingWall && this.selectedWallTool) {
        const edge = this._getNearestEdge(e.clientX, e.clientY);
        const last = this.wallPath[this.wallPath.length - 1];
        if (edge.col !== last.col || edge.row !== last.row || edge.edge !== last.edge) {
          // Check not already in path
          const key = `${edge.col},${edge.row},${edge.edge}`;
          const inPath = this.wallPath.some(p => `${p.col},${p.row},${p.edge}` === key);
          if (!inPath) {
            this.wallPath.push(edge);
          }
          this.renderer.renderWallPreview(this.wallPath, this.selectedWallTool);
        }
```

Also add wall hover highlight when not dragging. In the general hover section (when the wall tool is selected but not drawing), after the existing infra hover code, add edge highlighting:

```js
      } else if (this.selectedWallTool && !this.isDrawingWall) {
        const edge = this._getNearestEdge(e.clientX, e.clientY);
        this.renderer.renderWallEdgeHighlight(edge.col, edge.row, edge.edge);
```

- [ ] **Step 8: Add wall mouseup handler**

In the `pointerup` handler, after the line placement end block (around line 506), add:

```js
      // Wall placement end
      if (this.isDrawingWall && this.wallPath.length > 0) {
        this.game.placeWallPath(this.wallPath, this.selectedWallTool);
        this.isDrawingWall = false;
        this.wallPath = [];
        this.renderer.clearDragPreview();
        return;
      }
```

- [ ] **Step 9: Update _getPaletteCompKeys for walls category**

The existing code (added in a prior session) returns wall keys filtered by `isWall`. Update it to use `WALL_TYPES`:

```js
    if (category === 'walls') {
      return Object.keys(WALL_TYPES);
    }
```

- [ ] **Step 10: Update tool selection for walls category**

In `_onPaletteSelect` (around line 1170), update the walls handling. Find the line:

```js
      } else if (this.selectedCategory === 'flooring' || this.selectedCategory === 'walls' || this.selectedCategory === 'infrastructure') {
```

Change it to handle walls separately:

```js
      } else if (this.selectedCategory === 'walls') {
        this.selectWallTool(compKey);
      } else if (this.selectedCategory === 'flooring' || this.selectedCategory === 'infrastructure') {
```

- [ ] **Step 11: Update _showPreviewForIndex for walls**

In `_showPreviewForIndex`, after the flooring/infrastructure check, add:

```js
    if (this.selectedCategory === 'walls') {
      const wt = WALL_TYPES[key];
      if (!wt) { this._hidePreview(); return; }
      this._renderPreview(wt.name, wt.desc || '', [
        ['Cost', `$${wt.cost}/segment`],
        ['Height', `${wt.wallHeight}px`],
        ['Placement', 'Drag along edges'],
      ]);
      return;
    }
```

- [ ] **Step 12: Commit**

```bash
git add src/input/InputHandler.js
git commit -m "feat: add wall edge detection, drag-to-place, and tool selection"
```

---

### Task 7: Update HUD walls palette to use WALL_TYPES

The HUD walls tab currently filters `INFRASTRUCTURE` by `isWall`. Update to use `WALL_TYPES` instead.

**Files:**
- Modify: `src/renderer/hud.js`

- [ ] **Step 1: Add WALL_TYPES import**

Update the infrastructure import:

```js
import { INFRASTRUCTURE, ZONES, ZONE_FURNISHINGS, ZONE_TIER_THRESHOLDS, WALL_TYPES } from '../data/infrastructure.js';
```

- [ ] **Step 2: Update walls palette rendering**

Find the `if (compCategory === 'walls')` block. Replace the line:

```js
    const wallKeys = Object.keys(INFRASTRUCTURE).filter(k => INFRASTRUCTURE[k].isWall);
```

With:

```js
    const wallKeys = Object.keys(WALL_TYPES);
```

Also update the inner loop to use `WALL_TYPES` instead of `INFRASTRUCTURE`:

Replace:

```js
      const subItems = wallKeys.filter(k => INFRASTRUCTURE[k]?.subsection === subKey);
```

With:

```js
      const subItems = wallKeys.filter(k => WALL_TYPES[k]?.subsection === subKey);
```

And replace each `INFRASTRUCTURE[key]` reference inside the walls block with `WALL_TYPES[key]`:

```js
        const infra = WALL_TYPES[key];
```

Change the cost display from `$${infra.cost}/tile` to `$${infra.cost}/seg`.

Update the swatch to use a tall hex shape (already done) but reference `WALL_TYPES[key]` for colors.

Update the click handler: change `this._onInfraSelect` to `this._onWallSelect`:

```js
        item.addEventListener('click', () => {
          if (this._onPaletteClick) this._onPaletteClick(idx);
          if (this._onWallSelect) this._onWallSelect(key);
        });
```

- [ ] **Step 3: Wire _onWallSelect callback**

In `src/main.js`, find where `_onInfraSelect`, `_onZoneSelect` etc. are wired up. Add:

```js
  renderer._onWallSelect = (wallType) => input.selectWallTool(wallType);
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/hud.js src/main.js
git commit -m "feat: update walls palette to use WALL_TYPES and wire wall selection"
```

---

### Task 8: Add wall demolish tool

Add "Remove Walls" to the demolish tools, with edge-based demolition.

**Files:**
- Modify: `src/renderer/hud.js`
- Modify: `src/input/InputHandler.js`

- [ ] **Step 1: Add demolishWall to demolish tools list in hud.js**

Find the `demolishTools` array in the demolish rendering section. Add after `demolishFloor`:

```js
      { key: 'demolishWall', name: 'Remove Walls', desc: 'Click or drag to remove wall segments', color: '#a86' },
```

- [ ] **Step 2: Add wall demolish handling in InputHandler.js**

In the demolish tool handling, find where `demolishFloor` is handled. Add wall demolish support. When `this.demolishType === 'demolishWall'`:

For single click (in the click handler section):

```js
      if (this.demolishType === 'demolishWall') {
        const edge = this._getNearestEdge(e.clientX, e.clientY);
        this.game.removeWall(edge.col, edge.row, edge.edge);
        return;
      }
```

For drag, in the mousedown:

```js
      if (this.demolishType === 'demolishWall' && e.button === 0) {
        const edge = this._getNearestEdge(e.clientX, e.clientY);
        this.isDrawingWall = true;
        this.wallPath = [edge];
        return;
      }
```

In mousemove, add wall demolish path tracking (similar to wall placement drag).

In mouseup:

```js
      if (this.demolishType === 'demolishWall' && this.isDrawingWall) {
        for (const pt of this.wallPath) {
          this.game.removeWall(pt.col, pt.row, pt.edge);
        }
        this.isDrawingWall = false;
        this.wallPath = [];
        this.renderer.clearDragPreview();
        return;
      }
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/hud.js src/input/InputHandler.js
git commit -m "feat: add wall demolish tool with edge-based removal"
```

---

### Task 9: Integration testing and polish

Verify all pieces work together — placement, rendering, save/load, demolish.

**Files:**
- All modified files

- [ ] **Step 1: Verify the game loads without errors**

Open the game in a browser, check the console for any import errors or missing references. The Structure tab should show: Flooring, Walls, Office, Cafeteria, Meeting, RF Lab, Cooling Lab, Vacuum Lab, Optics Lab, Diagnostics Lab, Control Room, Machine Shop, Maintenance.

- [ ] **Step 2: Test wall placement**

1. Click "Walls" tab in Structure mode
2. Select "Office Wall" from the palette
3. Hover over the map — a white edge highlight should follow the nearest tile edge
4. Click and drag — wall preview should appear along dragged edges
5. Release — walls should be placed and rendered as colored parallelograms

- [ ] **Step 3: Test all 6 wall types render at correct heights**

Place one of each: cubicle (short), office wall (medium), exterior wall (tall), chain link, barbed wire, wood fence. Verify heights differ visually.

- [ ] **Step 4: Test save/load preserves walls**

Place some walls, save (game auto-saves), reload the page. Walls should reappear.

- [ ] **Step 5: Test wall demolish**

Select Demolish mode, click "Remove Walls", click on placed walls. They should be removed with a funding refund.

- [ ] **Step 6: Test new zones (Cafeteria, Meeting Room)**

Place office flooring, paint Cafeteria or Meeting zone, place furnishings. Verify they work like existing zones.

- [ ] **Step 7: Commit any fixes**

```bash
git add -A
git commit -m "fix: wall system integration fixes"
```
