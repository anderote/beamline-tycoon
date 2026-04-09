# Structure Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the Structure tab with flooring types, zone overlays, hallway connectivity, and zone-gated equipment placement.

**Architecture:** Extend `data.js` with new INFRASTRUCTURE entries, a ZONES constant, and zone tier thresholds. Add zone state tracking and connectivity logic to `game.js`. Add zone overlay rendering to `renderer.js`. Wire the Structure mode palette and zone placement through `renderer.js` and `input.js`.

**Tech Stack:** Vanilla JS, PixiJS (v8), isometric tile engine already in place.

---

### Task 1: Add Data Definitions

**Files:**
- Modify: `data.js:121-125` (MODES.structure)
- Modify: `data.js:1705-1723` (INFRASTRUCTURE)
- Modify: `data.js` (add ZONES, ZONE_TIER_THRESHOLDS after INFRASTRUCTURE)

- [ ] **Step 1: Update MODES.structure**

Replace the disabled structure mode at `data.js:121-125` with:

```js
  structure: {
    name: 'Structure',
    categories: {
      flooring: { name: 'Flooring', color: '#999' },
      zones:    { name: 'Zones',    color: '#6a6' },
      demolish: { name: 'Demolish', color: '#a44' },
    },
  },
```

- [ ] **Step 2: Add new INFRASTRUCTURE entries**

Add these entries to the `INFRASTRUCTURE` object in `data.js` (after the existing `concrete` entry, before the closing `}`):

```js
  labFloor: {
    id: 'labFloor',
    name: 'Lab Flooring',
    desc: 'Clean epoxy floor for laboratory zones. Drag to place.',
    cost: 15,
    color: 0xbbbbbb,
    topColor: 0xdddddd,
    isDragPlacement: true,
  },
  officeFloor: {
    id: 'officeFloor',
    name: 'Office Flooring',
    desc: 'Carpet tile flooring for office and admin zones. Drag to place.',
    cost: 12,
    color: 0xaa9977,
    topColor: 0xccbb99,
    isDragPlacement: true,
  },
  hallway: {
    id: 'hallway',
    name: 'Hallway',
    desc: 'White linoleum hallway connecting zones to the control room. Drag to place.',
    cost: 8,
    color: 0xcccccc,
    topColor: 0xeeeeee,
    isDragPlacement: true,
  },
```

- [ ] **Step 3: Add ZONES constant and ZONE_TIER_THRESHOLDS**

Add after the closing `};` of `INFRASTRUCTURE` (after line 1723):

```js
const ZONES = {
  rfLab:       { id: 'rfLab',       name: 'RF Laboratory',  color: 0xaa8833, requiredFloor: 'labFloor',    gatesCategory: 'rfPower' },
  cryoLab:     { id: 'cryoLab',     name: 'Cryogenic Lab',  color: 0x33aaaa, requiredFloor: 'labFloor',    gatesCategory: 'cryo' },
  vacuumLab:   { id: 'vacuumLab',   name: 'Vacuum Lab',     color: 0x7744aa, requiredFloor: 'labFloor',    gatesCategory: 'vacuum' },
  officeSpace: { id: 'officeSpace', name: 'Office Space',   color: 0x4466aa, requiredFloor: 'officeFloor', gatesCategory: null },
  controlRoom: { id: 'controlRoom', name: 'Control Room',   color: 0x44aa66, requiredFloor: 'officeFloor', gatesCategory: 'dataControls' },
  machineShop: { id: 'machineShop', name: 'Machine Shop',   color: 0x886655, requiredFloor: 'concrete',    gatesCategory: 'beamline' },
  maintenance: { id: 'maintenance', name: 'Maintenance',    color: 0xaa6633, requiredFloor: 'concrete',    gatesCategory: ['cooling', 'safety'] },
};

const ZONE_TIER_THRESHOLDS = [16, 36, 64]; // Tier 1: 16 tiles, Tier 2: 36, Tier 3: 64
```

- [ ] **Step 4: Commit**

```bash
git add data.js
git commit -m "feat: add structure tab data definitions (flooring, zones, tiers)"
```

---

### Task 2: Add Zone State and Connectivity Logic to Game

**Files:**
- Modify: `game.js:7-63` (state initialization)
- Modify: `game.js:167-223` (infrastructure methods — add zone methods after)
- Modify: `game.js:1274-1289` (load — add zone migration)

- [ ] **Step 1: Add zone state to constructor**

In `game.js`, inside `this.state = { ... }` (around line 42, after the `infraOccupied` line), add:

```js
      // Zone overlays
      zones: [],                // [{ type, col, row }]
      zoneOccupied: {},         // "col,row" -> zoneType
      zoneConnectivity: {},     // zoneType -> { active: bool, tileCount: int, tier: int }
```

- [ ] **Step 2: Add zone placement methods**

Add after `placeInfraRect()` (after line 223), before the `// === FACILITY EQUIPMENT ===` comment:

```js
  // === ZONES ===

  placeZoneTile(col, row, zoneType) {
    const zone = ZONES[zoneType];
    if (!zone) return false;
    const key = col + ',' + row;
    // Must have the right flooring underneath
    const floor = this.state.infraOccupied[key];
    if (floor !== zone.requiredFloor) return false;
    // Can't place two zones on same tile
    if (this.state.zoneOccupied[key]) return false;

    this.state.zones.push({ type: zoneType, col, row });
    this.state.zoneOccupied[key] = zoneType;
    this.recomputeZoneConnectivity();
    return true;
  }

  placeZoneRect(startCol, startRow, endCol, endRow, zoneType) {
    const zone = ZONES[zoneType];
    if (!zone) return false;

    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);

    let placed = 0;
    for (let c = minCol; c <= maxCol; c++) {
      for (let r = minRow; r <= maxRow; r++) {
        const key = c + ',' + r;
        const floor = this.state.infraOccupied[key];
        if (floor !== zone.requiredFloor) continue;
        if (this.state.zoneOccupied[key]) continue;

        this.state.zones.push({ type: zoneType, col: c, row: r });
        this.state.zoneOccupied[key] = zoneType;
        placed++;
      }
    }

    if (placed > 0) {
      this.log(`Assigned ${placed} ${zone.name} tiles`, 'good');
      this.recomputeZoneConnectivity();
      this.emit('zonesChanged');
    }
    return placed > 0;
  }

  removeZoneTile(col, row) {
    const key = col + ',' + row;
    if (!this.state.zoneOccupied[key]) return false;
    const idx = this.state.zones.findIndex(z => z.col === col && z.row === row);
    if (idx !== -1) {
      this.state.zones.splice(idx, 1);
      delete this.state.zoneOccupied[key];
      this.recomputeZoneConnectivity();
      this.emit('zonesChanged');
      return true;
    }
    return false;
  }

  // Flood-fill from Control Room through hallways to determine zone connectivity
  recomputeZoneConnectivity() {
    const connectivity = {};
    for (const zoneType of Object.keys(ZONES)) {
      connectivity[zoneType] = { active: false, tileCount: 0, tier: 0 };
    }

    // Count tiles per zone type
    for (const z of this.state.zones) {
      if (connectivity[z.type]) {
        connectivity[z.type].tileCount++;
      }
    }

    // Compute tier from tile count
    for (const info of Object.values(connectivity)) {
      if (info.tileCount >= ZONE_TIER_THRESHOLDS[2]) info.tier = 3;
      else if (info.tileCount >= ZONE_TIER_THRESHOLDS[1]) info.tier = 2;
      else if (info.tileCount >= ZONE_TIER_THRESHOLDS[0]) info.tier = 1;
      else info.tier = 0;
    }

    // Find all Control Room tiles
    const controlRoomTiles = this.state.zones
      .filter(z => z.type === 'controlRoom')
      .map(z => z.col + ',' + z.row);

    if (controlRoomTiles.length === 0) {
      this.state.zoneConnectivity = connectivity;
      return;
    }

    // Control Room is always active if it exists
    connectivity.controlRoom.active = true;

    // Find all hallway tiles adjacent to Control Room — seed the flood fill
    const hallwaySet = new Set();
    for (const tile of this.state.infrastructure) {
      if (tile.type === 'hallway') hallwaySet.add(tile.col + ',' + tile.row);
    }

    const visited = new Set();
    const queue = [];

    // Seed: hallway tiles adjacent to any Control Room tile
    for (const crKey of controlRoomTiles) {
      const [cc, cr] = crKey.split(',').map(Number);
      for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nk = (cc + dc) + ',' + (cr + dr);
        if (hallwaySet.has(nk) && !visited.has(nk)) {
          visited.add(nk);
          queue.push(nk);
        }
      }
    }

    // BFS through hallway tiles
    while (queue.length > 0) {
      const cur = queue.shift();
      const [cc, cr] = cur.split(',').map(Number);
      for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nk = (cc + dc) + ',' + (cr + dr);
        if (hallwaySet.has(nk) && !visited.has(nk)) {
          visited.add(nk);
          queue.push(nk);
        }
      }
    }

    // Check each zone: if any tile is adjacent to a reachable hallway tile, it's active
    const zonesByType = {};
    for (const z of this.state.zones) {
      if (!zonesByType[z.type]) zonesByType[z.type] = [];
      zonesByType[z.type].push(z);
    }

    for (const [zoneType, tiles] of Object.entries(zonesByType)) {
      if (zoneType === 'controlRoom') continue; // already active
      for (const tile of tiles) {
        for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nk = (tile.col + dc) + ',' + (tile.row + dr);
          if (visited.has(nk)) {
            connectivity[zoneType].active = true;
            break;
          }
        }
        if (connectivity[zoneType].active) break;
      }
    }

    this.state.zoneConnectivity = connectivity;
  }

  // Get the achieved tier for a gated category (0 = no zone, 1-3 = tier)
  getZoneTierForCategory(category) {
    for (const zone of Object.values(ZONES)) {
      const gates = Array.isArray(zone.gatesCategory) ? zone.gatesCategory : [zone.gatesCategory];
      if (gates.includes(category)) {
        const conn = this.state.zoneConnectivity?.[zone.id];
        if (!conn || !conn.active) return 0;
        return conn.tier;
      }
    }
    // Special case: 'beamline' category is gated by machineShop
    // (handled above via gatesCategory: 'beamline')
    return 99; // ungated category
  }
```

- [ ] **Step 3: Add zone migration to load()**

In `game.js`, after the infraOccupied rebuild block (around line 1289), add:

```js
      // Rebuild zoneOccupied
      this.state.zones = this.state.zones || [];
      this.state.zoneOccupied = {};
      for (const z of this.state.zones) {
        this.state.zoneOccupied[z.col + ',' + z.row] = z.type;
      }
      this.state.zoneConnectivity = {};
      this.recomputeZoneConnectivity();
```

- [ ] **Step 4: Commit**

```bash
git add game.js
git commit -m "feat: add zone state, placement, and connectivity logic"
```

---

### Task 3: Add Zone Rendering to Renderer

**Files:**
- Modify: `renderer.js:60-101` (layer creation — add zoneLayer)
- Modify: `renderer.js:114-135` (event listeners — add zonesChanged)
- Modify: `renderer.js:816-848` (infrastructure rendering — add zone rendering after)

- [ ] **Step 1: Add zoneLayer**

In `renderer.js`, after the `infraLayer` setup (after line 73, before `dragPreviewLayer`), add:

```js
    this.zoneLayer = new PIXI.Container();
    this.zoneLayer.zIndex = 0.55;
    this.world.addChild(this.zoneLayer);
```

- [ ] **Step 2: Listen for zonesChanged event**

In the event listener switch in `renderer.js` (around line 127), add a new case after `infrastructureChanged`:

```js
        case 'zonesChanged':
          this._renderZones();
          break;
```

Also add `this._renderZones();` to the `beamlineChanged`/`loaded` case block (after `this._renderInfrastructure();` on line 122).

- [ ] **Step 3: Add _renderZones method**

After `_drawInfraTile()` (after line 848), add:

```js
  // --- Zone rendering ---

  _renderZones() {
    this.zoneLayer.removeChildren();
    const zones = this.game.state.zones || [];
    const connectivity = this.game.state.zoneConnectivity || {};

    for (const tile of zones) {
      const zone = ZONES[tile.type];
      if (!zone) continue;
      const conn = connectivity[tile.type];
      const active = conn ? conn.active : false;
      this._drawZoneTile(tile.col, tile.row, zone, active);
    }

    // Draw zone labels for each zone type
    this._drawZoneLabels(zones, connectivity);
  }

  _drawZoneTile(col, row, zone, active) {
    const g = new PIXI.Graphics();
    const pos = tileCenterIso(col, row);
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;

    const alpha = active ? 0.4 : 0.15;

    // Top face overlay
    g.poly([pos.x, pos.y - hh, pos.x + hw, pos.y, pos.x, pos.y + hh, pos.x - hw, pos.y]);
    g.fill({ color: zone.color, alpha });

    this.zoneLayer.addChild(g);
  }

  _drawZoneLabels(zones, connectivity) {
    // Group zone tiles by type and find center of each group
    const groups = {};
    for (const z of zones) {
      if (!groups[z.type]) groups[z.type] = [];
      groups[z.type].push(z);
    }

    for (const [type, tiles] of Object.entries(groups)) {
      const zone = ZONES[type];
      if (!zone) continue;
      const conn = connectivity[type];
      const count = conn ? conn.tileCount : tiles.length;

      // Find average position
      let avgCol = 0, avgRow = 0;
      for (const t of tiles) { avgCol += t.col; avgRow += t.row; }
      avgCol /= tiles.length;
      avgRow /= tiles.length;

      const pos = tileCenterIso(avgCol, avgRow);
      const label = new PIXI.Text({
        text: `${zone.name} (${count})`,
        style: { fontFamily: 'monospace', fontSize: 10, fill: 0xffffff, align: 'center' },
      });
      label.anchor.set(0.5, 0.5);
      label.x = pos.x;
      label.y = pos.y;
      label.alpha = conn?.active ? 0.9 : 0.4;
      this.zoneLayer.addChild(label);
    }
  }
```

- [ ] **Step 4: Commit**

```bash
git add renderer.js
git commit -m "feat: add zone overlay and label rendering"
```

---

### Task 4: Wire Structure Tab Palette and Zone Placement

**Files:**
- Modify: `renderer.js:1096-1146` (_generateCategoryTabs — handle structure mode)
- Modify: `renderer.js:1148-1190` (_renderPalette — add flooring/zone/demolish rendering)
- Modify: `input.js:1-30` (add zone tool state)
- Modify: `input.js:220-232` (drag start — handle zone drag)
- Modify: `input.js:282-294` (drag end — handle zone placement)
- Modify: `input.js:345-371` (bulldozer — remove zones too)
- Modify: `main.js:19-24` (wire zone selection callback)

- [ ] **Step 1: Add structure palette rendering**

In `renderer.js`, in `_renderPalette()`, add a handler for the structure mode categories. After the `if (compCategory === 'infrastructure')` block closing brace (line 1190), add:

```js
    // Structure mode — Flooring tab: show flooring INFRASTRUCTURE items
    if (compCategory === 'flooring') {
      const flooringKeys = ['labFloor', 'officeFloor', 'concrete', 'hallway'];
      for (const key of flooringKeys) {
        const infra = INFRASTRUCTURE[key];
        if (!infra) continue;
        const item = document.createElement('div');
        item.className = 'palette-item';
        item.dataset.paletteIndex = paletteIdx;
        const idx = paletteIdx++;

        const affordable = this.game.state.resources.funding >= infra.cost;
        if (!affordable) item.classList.add('unaffordable');

        const nameEl = document.createElement('div');
        nameEl.className = 'palette-name';
        nameEl.textContent = infra.name;
        item.appendChild(nameEl);

        const costEl = document.createElement('div');
        costEl.className = 'palette-cost';
        costEl.textContent = `$${infra.cost}/tile`;
        item.appendChild(costEl);

        item.addEventListener('click', () => {
          if (this._onPaletteClick) this._onPaletteClick(idx);
          if (this._onInfraSelect) this._onInfraSelect(key);
        });

        palette.appendChild(item);
      }
      return;
    }

    // Structure mode — Zones tab: show zone types
    if (compCategory === 'zones') {
      for (const [key, zone] of Object.entries(ZONES)) {
        const item = document.createElement('div');
        item.className = 'palette-item';
        item.dataset.paletteIndex = paletteIdx;
        const idx = paletteIdx++;

        const hex = '#' + zone.color.toString(16).padStart(6, '0');
        item.style.borderLeft = `4px solid ${hex}`;

        const nameEl = document.createElement('div');
        nameEl.className = 'palette-name';
        nameEl.textContent = zone.name;
        item.appendChild(nameEl);

        const descEl = document.createElement('div');
        descEl.className = 'palette-cost';
        descEl.textContent = `Requires: ${INFRASTRUCTURE[zone.requiredFloor]?.name || zone.requiredFloor}`;
        item.appendChild(descEl);

        item.addEventListener('click', () => {
          if (this._onPaletteClick) this._onPaletteClick(idx);
          if (this._onZoneSelect) this._onZoneSelect(key);
        });

        palette.appendChild(item);
      }
      return;
    }

    // Structure mode — Demolish tab: show demolish tool
    if (compCategory === 'demolish') {
      const item = document.createElement('div');
      item.className = 'palette-item';
      item.dataset.paletteIndex = 0;
      paletteIdx++;

      const nameEl = document.createElement('div');
      nameEl.className = 'palette-name';
      nameEl.textContent = 'Demolish Tool';
      item.appendChild(nameEl);

      const descEl = document.createElement('div');
      descEl.className = 'palette-cost';
      descEl.textContent = 'Click/drag to remove flooring & zones';
      item.appendChild(descEl);

      item.addEventListener('click', () => {
        if (this._onPaletteClick) this._onPaletteClick(0);
        if (this._onDemolishSelect) this._onDemolishSelect();
      });

      palette.appendChild(item);
      return;
    }
```

- [ ] **Step 2: Add zone tool state to InputHandler**

In `input.js`, add after `this.selectedInfraTool = null;` (line 15):

```js
    this.selectedZoneTool = null;    // zone type or null
    this.demolishMode = false;       // structure demolish tool
```

- [ ] **Step 3: Add zone drag handling to mousedown**

In `input.js`, after the infrastructure drag start block (line 220-231), add:

```js
      // Zone drag start
      if (e.button === 0 && this.selectedZoneTool) {
        this.isDragging = true;
        const world = this.renderer.screenToWorld(e.clientX, e.clientY);
        const grid = isoToGrid(world.x, world.y);
        this.dragStart = { col: grid.col, row: grid.row };
        this.dragEnd = { col: grid.col, row: grid.row };
      }
```

- [ ] **Step 4: Add zone drag end handling to mouseup**

In `input.js`, in the mouseup handler, the existing infra drag end block (line 282-294) handles `this.isDragging`. We need to add zone handling. Replace the infrastructure drag end block with:

```js
      // Infrastructure or zone drag end
      if (this.isDragging && this.dragStart && this.dragEnd) {
        if (this.selectedZoneTool) {
          this.game.placeZoneRect(
            this.dragStart.col, this.dragStart.row,
            this.dragEnd.col, this.dragEnd.row,
            this.selectedZoneTool
          );
        } else if (this.selectedInfraTool) {
          this.game.placeInfraRect(
            this.dragStart.col, this.dragStart.row,
            this.dragEnd.col, this.dragEnd.row,
            this.selectedInfraTool
          );
        }
        this.isDragging = false;
        this.dragStart = null;
        this.dragEnd = null;
        this.renderer.clearDragPreview();
        return;
      }
```

- [ ] **Step 5: Add zone click handling (single-tile and demolish)**

In `input.js`, in `_handleClick()`, after the `if (this.selectedInfraTool)` block (line 374-383), add:

```js
    // Zone placement (single tile click — zones are always drag but allow single click too)
    if (this.selectedZoneTool) {
      if (this.game.placeZoneTile(col, row, this.selectedZoneTool)) {
        this.game.emit('zonesChanged');
      }
      return;
    }

    // Structure demolish mode
    if (this.demolishMode) {
      const key = col + ',' + row;
      // Remove zone first
      if (this.game.state.zoneOccupied[key]) {
        this.game.removeZoneTile(col, row);
      }
      // Remove infrastructure
      if (this.game.state.infraOccupied[key]) {
        const idx = this.game.state.infrastructure.findIndex(t => t.col === col && t.row === row);
        if (idx !== -1) {
          this.game.state.infrastructure.splice(idx, 1);
          delete this.game.state.infraOccupied[key];
          this.game.emit('infrastructureChanged');
        }
      }
      return;
    }
```

- [ ] **Step 6: Add zone removal to bulldozer mode**

In `input.js`, in the bulldozer block (around line 345-371), after the infrastructure removal block, add:

```js
      // Remove zones
      if (this.game.state.zoneOccupied[key]) {
        this.game.removeZoneTile(col, row);
      }
```

- [ ] **Step 7: Add selection/deselection methods for zones and demolish**

In `input.js`, after `deselectConnTool()` (line 519), add:

```js
  selectZoneTool(zoneType) {
    this.deselectTool();
    this.deselectInfraTool();
    this.deselectFacilityTool();
    this.deselectConnTool();
    this.demolishMode = false;
    this.selectedZoneTool = zoneType;
  }

  deselectZoneTool() {
    this.selectedZoneTool = null;
  }

  selectDemolishTool() {
    this.deselectTool();
    this.deselectInfraTool();
    this.deselectFacilityTool();
    this.deselectConnTool();
    this.deselectZoneTool();
    this.demolishMode = true;
  }

  deselectDemolishTool() {
    this.demolishMode = false;
  }
```

- [ ] **Step 8: Update setActiveMode to clear zone/demolish state**

In `input.js`, in `setActiveMode()` (line 522-537), add after `this.deselectConnTool();`:

```js
    this.deselectZoneTool();
    this.deselectDemolishTool();
```

- [ ] **Step 9: Wire zone and demolish callbacks in main.js**

In `main.js`, after the existing callback wiring (line 22), add:

```js
  renderer._onZoneSelect = (zoneType) => input.selectZoneTool(zoneType);
  renderer._onDemolishSelect = () => input.selectDemolishTool();
```

- [ ] **Step 10: Add right-click deselect for zone/demolish tools**

In `input.js`, in the right-click handling (mouseup, around line 300-310), the chain of deselect checks needs zone and demolish. After the `selectedConnTool` check, add:

```js
        } else if (this.selectedZoneTool) {
          this.deselectZoneTool();
        } else if (this.demolishMode) {
          this.deselectDemolishTool();
```

- [ ] **Step 11: Update _getPaletteCompKeys for structure mode categories**

In `input.js`, in `_getPaletteCompKeys()` (line 721-731), add at the top of the function:

```js
    if (category === 'flooring') {
      return ['labFloor', 'officeFloor', 'concrete', 'hallway'];
    }
    if (category === 'zones') {
      return Object.keys(ZONES);
    }
    if (category === 'demolish') {
      return ['demolish'];
    }
```

- [ ] **Step 12: Commit**

```bash
git add renderer.js input.js main.js
git commit -m "feat: wire structure tab palette, zone placement, and demolish tool"
```

---

### Task 5: Add Equipment Gating by Zone Tier

**Files:**
- Modify: `renderer.js:1194-1229` (facility palette rendering — add zone gating)
- Modify: `game.js:225-238` (placeFacilityEquipment — add zone check)

- [ ] **Step 1: Add zone tier check to facility palette rendering**

In `renderer.js`, in the facility palette rendering block (`_renderPalette`, around line 1194), after the `unlocked` and `affordable` checks, add zone gating:

```js
        const zoneTier = this.game.getZoneTierForCategory(compCategory);
        const compTier = comp.zoneTier || 1;
        const zoneBlocked = zoneTier < compTier;

        if (zoneBlocked) item.classList.add('locked');
```

Also update the cost text to show zone requirement when blocked. After the `costEl.textContent` line, add:

```js
        if (zoneBlocked) {
          const neededTiles = ZONE_TIER_THRESHOLDS[compTier - 1];
          // Find which zone gates this category
          let zoneName = '';
          for (const z of Object.values(ZONES)) {
            const gates = Array.isArray(z.gatesCategory) ? z.gatesCategory : [z.gatesCategory];
            if (gates.includes(compCategory)) { zoneName = z.name; break; }
          }
          costEl.textContent = `Needs ${neededTiles} ${zoneName} tiles`;
        }
```

- [ ] **Step 2: Add zone check to placeFacilityEquipment**

In `game.js`, in `placeFacilityEquipment()` (around line 227), after the `isComponentUnlocked` check, add:

```js
    // Zone gating
    const zoneTier = this.getZoneTierForCategory(comp.category);
    const compTier = comp.zoneTier || 1;
    if (zoneTier < compTier) {
      this.log(`Need more zone area for ${comp.name}!`, 'bad');
      return false;
    }
```

- [ ] **Step 3: Commit**

```bash
git add renderer.js game.js
git commit -m "feat: gate facility equipment by zone tier and connectivity"
```

---

### Task 6: Recompute Connectivity on Infrastructure Changes and Handle Drag Preview for Zones

**Files:**
- Modify: `game.js:218-222` (placeInfraRect — trigger zone recompute when hallways change)
- Modify: `renderer.js` (renderDragPreview — support zone color preview)
- Modify: `input.js:240-246` (mousemove — show drag preview for zones)

- [ ] **Step 1: Recompute zone connectivity when hallways change**

In `game.js`, in `placeInfraRect()`, after the `this.emit('infrastructureChanged');` line (line 220), add:

```js
      // Hallway changes affect zone connectivity
      if (infraType === 'hallway') {
        this.recomputeZoneConnectivity();
        this.emit('zonesChanged');
      }
```

Also in `placeInfraTile()`, after `this.state.infraOccupied[key] = infraType;` (line 178), add the same check:

```js
    if (infraType === 'hallway') {
      this.recomputeZoneConnectivity();
    }
```

- [ ] **Step 2: Add zone drag preview in mousemove**

In `input.js`, in the mousemove handler (around line 240-246), the existing `isDragging` block updates the drag preview. Update it to also handle zones:

```js
      } else if (this.isDragging && this.dragStart) {
        const world = this.renderer.screenToWorld(e.clientX, e.clientY);
        const grid = isoToGrid(world.x, world.y);
        this.dragEnd = { col: grid.col, row: grid.row };
        if (this.selectedZoneTool) {
          this.renderer.renderDragPreview(
            this.dragStart.col, this.dragStart.row,
            grid.col, grid.row, this.selectedZoneTool, true
          );
        } else {
          this.renderer.renderDragPreview(
            this.dragStart.col, this.dragStart.row,
            grid.col, grid.row, this.selectedInfraTool
          );
        }
```

- [ ] **Step 3: Update renderDragPreview to support zone preview**

In `renderer.js:997`, update the method signature and body to handle zones:

```js
  renderDragPreview(startCol, startRow, endCol, endRow, type, isZone = false) {
    this.dragPreviewLayer.removeChildren();
    if (startCol == null || endCol == null) return;

    let previewColor, cost;
    if (isZone) {
      const zone = ZONES[type];
      if (!zone) return;
      previewColor = zone.color;
      cost = 0; // zones are free to assign
    } else {
      const infra = INFRASTRUCTURE[type];
      if (!infra) return;
      previewColor = infra.topColor;
      cost = infra.cost;
    }

    const minCol = Math.min(startCol, endCol);
    const maxCol = Math.max(startCol, endCol);
    const minRow = Math.min(startRow, endRow);
    const maxRow = Math.max(startRow, endRow);

    const tileCount = (maxCol - minCol + 1) * (maxRow - minRow + 1);
    const totalCost = tileCount * cost;
    const canAfford = cost === 0 || this.game.state.resources.funding >= totalCost;

    for (let c = minCol; c <= maxCol; c++) {
      for (let r = minRow; r <= maxRow; r++) {
        const g = new PIXI.Graphics();
        const pos = tileCenterIso(c, r);
        const hw = TILE_W / 2;
        const hh = TILE_H / 2;

        g.poly([pos.x, pos.y - hh, pos.x + hw, pos.y, pos.x, pos.y + hh, pos.x - hw, pos.y]);
        g.fill({ color: canAfford ? previewColor : 0xcc3333, alpha: isZone ? 0.4 : 0.5 });
        g.stroke({ color: canAfford ? 0xffffff : 0xff4444, width: 1, alpha: 0.4 });

        this.dragPreviewLayer.addChild(g);
      }
    }

    // Cost label at center of preview
    const centerCol = (minCol + maxCol) / 2;
    const centerRow = (minRow + maxRow) / 2;
    const centerPos = tileCenterIso(centerCol, centerRow);
    const labelText = cost > 0 ? `$${totalCost} (${tileCount} tiles)` : `${tileCount} tiles`;
    const label = new PIXI.Text({
      text: labelText,
      style: { fontFamily: 'monospace', fontSize: 10, fill: canAfford ? 0xffffff : 0xff4444 },
    });
    label.anchor.set(0.5, 0.5);
    label.x = centerPos.x;
    label.y = centerPos.y - 12;
    this.dragPreviewLayer.addChild(label);
  }
```

- [ ] **Step 4: Commit**

```bash
git add game.js renderer.js input.js
git commit -m "feat: recompute connectivity on hallway changes, add zone drag preview"
```

---

### Task 7: Handle Infrastructure Removal and Zone Cascade

**Files:**
- Modify: `game.js:167-180` (add removeInfraTile method)
- Modify: `input.js:345-371` (bulldozer — cascade zone removal when flooring removed)

- [ ] **Step 1: Add removeInfraTile method to Game**

In `game.js`, after `placeInfraRect()`, add:

```js
  removeInfraTile(col, row) {
    const key = col + ',' + row;
    if (!this.state.infraOccupied[key]) return false;
    const idx = this.state.infrastructure.findIndex(t => t.col === col && t.row === row);
    if (idx === -1) return false;

    // Removing flooring also removes any zone on that tile
    if (this.state.zoneOccupied[key]) {
      this.removeZoneTile(col, row);
    }

    this.state.infrastructure.splice(idx, 1);
    const wasHallway = this.state.infraOccupied[key] === 'hallway';
    delete this.state.infraOccupied[key];

    if (wasHallway) {
      this.recomputeZoneConnectivity();
      this.emit('zonesChanged');
    }

    this.emit('infrastructureChanged');
    return true;
  }
```

- [ ] **Step 2: Update bulldozer to use removeInfraTile**

In `input.js`, in the bulldozer block, replace the manual infrastructure removal (lines 352-359):

```js
      // Remove infrastructure (cascades to zones)
      if (this.game.state.infraOccupied[key]) {
        this.game.removeInfraTile(col, row);
      }
```

And remove the separate zone removal line added in Task 4 Step 6 since `removeInfraTile` handles it. But keep a standalone zone removal for cases where only the zone (not the floor) should be removed:

```js
      // Remove standalone zones (if floor wasn't removed)
      if (this.game.state.zoneOccupied[key]) {
        this.game.removeZoneTile(col, row);
      }
```

- [ ] **Step 3: Update demolish tool to use removeInfraTile**

In `input.js`, in the demolish mode handler (added in Task 4 Step 5), replace the manual removal with:

```js
    if (this.demolishMode) {
      const key = col + ',' + row;
      if (this.game.state.zoneOccupied[key]) {
        this.game.removeZoneTile(col, row);
      }
      if (this.game.state.infraOccupied[key]) {
        this.game.removeInfraTile(col, row);
      }
      return;
    }
```

- [ ] **Step 4: Commit**

```bash
git add game.js input.js
git commit -m "feat: add removeInfraTile with zone cascade on flooring removal"
```
