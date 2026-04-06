# Category Reorganization & Facility Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the game's single-category placement UI into three modes (Beamline, Facility, Structure) with new category tabs, facility equipment grid placement, and a utility connection drawing system.

**Architecture:** Replace the flat `CATEGORIES` dict with a `MODES` structure grouping categories by mode. Re-categorize all ~80 components. Add a mode switcher UI above category tabs. Add connection types as a new data structure, with drag-to-draw placement and auto-shape rendering on the isometric grid. Facility equipment is placed on the grid (not beamline track) and connections are validated at endpoints.

**Tech Stack:** Vanilla JS, PixiJS 8, HTML/CSS

---

### Task 1: Replace CATEGORIES with MODES in data.js

**Files:**
- Modify: `data.js:20-28`

- [ ] **Step 1: Replace CATEGORIES with MODES and add CONNECTION_TYPES**

Replace the `CATEGORIES` block at lines 20-28 with:

```js
// Placement modes — each mode has its own set of category tabs
const MODES = {
  beamline: {
    name: 'Beamline',
    categories: {
      source:     { name: 'Sources',     color: '#4a9' },
      focusing:   { name: 'Focusing',    color: '#c44' },
      rf:         { name: 'RF / Accel',  color: '#c90' },
      diagnostic: { name: 'Diagnostics', color: '#44c' },
      beamOptics: { name: 'Beam Optics', color: '#a4a' },
    },
  },
  facility: {
    name: 'Facility',
    categories: {
      vacuum:       { name: 'Vacuum',          color: '#669' },
      cryo:         { name: 'Cryo',            color: '#4aa' },
      rfPower:      { name: 'RF Power',        color: '#aa4' },
      cooling:      { name: 'Cooling',         color: '#a66' },
      dataControls: { name: 'Data & Controls', color: '#6a6' },
      power:        { name: 'Power',           color: '#a84' },
      safety:       { name: 'Safety',          color: '#888' },
    },
  },
  structure: {
    name: 'Structure',
    categories: {},
    disabled: true,
  },
};

// Flat lookup for backwards compat — used by palette rendering, etc.
const CATEGORIES = {};
for (const mode of Object.values(MODES)) {
  Object.assign(CATEGORIES, mode.categories);
}

// Utility connection types drawn as thin lines between facility equipment and beamline
const CONNECTION_TYPES = {
  vacuumPipe:   { name: 'Vacuum Pipe',   color: 0x888888, validTargets: 'any' },
  cryoTransfer: { name: 'Cryo Transfer', color: 0x44aacc, validTargets: { categoryMatch: ['rf'], idMatch: ['cryomodule', 'scQuad', 'scDipole'] } },
  rfWaveguide:  { name: 'RF Waveguide',  color: 0xccaa44, validTargets: { categoryMatch: ['rf'] } },
  coolingWater: { name: 'Cooling Water',  color: 0x4488cc, validTargets: { categoryMatch: ['rf', 'focusing'], idMatch: ['target'] } },
  powerCable:   { name: 'Power Cable',   color: 0xcc4444, validTargets: 'any' },
  dataFiber:    { name: 'Data/Fiber',    color: 0x44cc44, validTargets: { categoryMatch: ['diagnostic'] } },
};
```

- [ ] **Step 2: Verify the game loads without errors**

Run: Open `index.html` in browser, check the console for errors.
Expected: No errors referencing `CATEGORIES` — the flat lookup is still populated.

- [ ] **Step 3: Commit**

```bash
git add data.js
git commit -m "Replace CATEGORIES with MODES structure and add CONNECTION_TYPES"
```

---

### Task 2: Re-categorize all components in data.js

**Files:**
- Modify: `data.js` (component entries throughout)

This task changes the `category` field on components and removes the `isInfrastructure` flag. Here is the complete mapping of every component that needs to change:

**`category: 'magnet'` → `category: 'focusing'`** (all magnets):
- `dipole` (line 66), `quadrupole` (line 81), `solenoid` (line 356), `corrector` (line 370), `octupole` (line 384), `scQuad` (line 399), `scDipole` (line 414), `combinedFunctionMagnet` (line 430), `protonQuad` (line 1486)

**`category: 'dipole'` → `category: 'focusing'`:**
- `protonDipole` (line 1500)

**`category: 'special'` → `category: 'beamOptics'`** (beam manipulation components):
- `splitter` (line 123), `undulator` (line 138), `collimator` (line 152), `sextupole` (line 195), `helicalUndulator` (line 558), `wiggler` (line 573), `apple2Undulator` (line 588), `kickerMagnet` (line 605), `septumMagnet` (line 620), `chicane` (line 635), `dogleg` (line 650), `stripperFoil` (line 665), `laserHeater` (line 1393)

**`category: 'special'` → `category: 'vacuum'`** (vacuum components):
- `roughingPump` (line 1042), `turboPump` (line 1056), `ionPump` (line 1070), `negPump` (line 1085), `tiSubPump` (line 1100), `gateValve` (line 1158), `bakeoutSystem` (line 1172)

**`category: 'special'` → `category: 'safety'`:**
- `shielding` (line 1319)

**`category: 'rf'` → `category: 'rfPower'`** (RF infrastructure):
- `solidStateAmp` (line 751), `pulsedKlystron` (line 765), `cwKlystron` (line 780), `modulator` (line 796), `iot` (line 810), `circulator` (line 826), `waveguide` (line 840), `rfCoupler` (line 854), `llrfController` (line 868), `multibeamKlystron` (line 884), `highPowerSSA` (line 900)

**`category: 'rf'` → `category: 'cryo'`** (cryogenic infrastructure):
- `heCompressor` (line 918), `coldBox4K` (line 933), `coldBox2K` (line 949), `cryomoduleHousing` (line 965), `transferLine` (line 980), `ln2Precooler` (line 995), `heRecovery` (line 1010), `cryocooler` (line 1025)

**`category: 'rf'` → `category: 'cooling'`** (cooling infrastructure):
- `lcwSkid` (line 1189), `chiller` (line 1203), `coolingTower` (line 1217), `heatExchanger` (line 1231), `waterLoad` (line 1245), `deionizer` (line 1259), `emergencyCooling` (line 1274)

**`category: 'rf'` → `category: 'power'`** (power infrastructure):
- `substation` (line 1410), `powerPanel` (line 1425)

**`category: 'diagnostic'` → `category: 'vacuum'`** (vacuum gauges):
- `piraniGauge` (line 1115), `coldCathodeGauge` (line 1129), `baGauge` (line 1143)

**`category: 'diagnostic'` → `category: 'dataControls'`** (controls/monitoring):
- `rackIoc` (line 1291), `ppsInterlock` (line 1305), `mps` (line 1333), `areaMonitor` (line 1348), `timingSystem` (line 1362)

**`category: 'source'` → `category: 'power'`** (laser systems):
- `laserSystem` (line 1377)

- [ ] **Step 1: Change category on focusing components (magnet → focusing)**

In `data.js`, use find-and-replace on these specific component entries. Change `category: 'magnet'` to `category: 'focusing'` on: dipole, quadrupole, solenoid, corrector, octupole, scQuad, scDipole, combinedFunctionMagnet, protonQuad. Also change `protonDipole` from `category: 'dipole'` to `category: 'focusing'`.

- [ ] **Step 2: Change category on beam optics components (special → beamOptics)**

Change `category: 'special'` to `category: 'beamOptics'` on: splitter, undulator, collimator, sextupole, helicalUndulator, wiggler, apple2Undulator, kickerMagnet, septumMagnet, chicane, dogleg, stripperFoil, laserHeater.

- [ ] **Step 3: Change category on vacuum components**

Change `category: 'special'` to `category: 'vacuum'` on: roughingPump, turboPump, ionPump, negPump, tiSubPump, gateValve, bakeoutSystem.
Change `category: 'diagnostic'` to `category: 'vacuum'` on: piraniGauge, coldCathodeGauge, baGauge.

- [ ] **Step 4: Change category on RF power infrastructure**

Change `category: 'rf'` to `category: 'rfPower'` on: solidStateAmp, pulsedKlystron, cwKlystron, modulator, iot, circulator, waveguide, rfCoupler, llrfController, multibeamKlystron, highPowerSSA.

- [ ] **Step 5: Change category on cryo infrastructure**

Change `category: 'rf'` to `category: 'cryo'` on: heCompressor, coldBox4K, coldBox2K, cryomoduleHousing, transferLine, ln2Precooler, heRecovery, cryocooler.

- [ ] **Step 6: Change category on cooling, power, data/controls, and safety**

Change `category: 'rf'` to `category: 'cooling'` on: lcwSkid, chiller, coolingTower, heatExchanger, waterLoad, deionizer, emergencyCooling.
Change `category: 'rf'` to `category: 'power'` on: substation, powerPanel.
Change `category: 'source'` to `category: 'power'` on: laserSystem.
Change `category: 'diagnostic'` to `category: 'dataControls'` on: rackIoc, ppsInterlock, mps, areaMonitor, timingSystem.
Change `category: 'special'` to `category: 'safety'` on: shielding.

- [ ] **Step 7: Remove isInfrastructure flag from all components**

Search for all occurrences of `isInfrastructure: true,` in data.js and remove those lines. The facility vs beamline distinction is now determined by category membership — categories in `MODES.facility.categories` are facility equipment.

- [ ] **Step 8: Add bellows to beamOptics category**

Change bellows (line 264) from `category: 'source'` to `category: 'beamOptics'`.

- [ ] **Step 9: Verify no orphaned categories remain**

Search data.js for any `category: 'special'`, `category: 'magnet'`, or `category: 'dipole'` — there should be zero matches (excluding MACHINES entries which use different category values like 'stall' and 'ring').

- [ ] **Step 10: Commit**

```bash
git add data.js
git commit -m "Re-categorize all components into new mode-based categories"
```

---

### Task 3: Add mode switcher UI to HTML and CSS

**Files:**
- Modify: `index.html:47-54`
- Modify: `style.css`

- [ ] **Step 1: Replace static category tabs with mode switcher and dynamic tabs in index.html**

Replace the `#hud-controls` div (lines 47-59 of index.html) with:

```html
<div id="hud-controls">
  <div id="mode-switcher">
    <button class="mode-btn active" data-mode="beamline">Beamline</button>
    <button class="mode-btn" data-mode="facility">Facility</button>
    <button class="mode-btn disabled" data-mode="structure">Structure</button>
  </div>
  <div id="category-tabs">
    <!-- dynamically generated based on active mode -->
  </div>
  <div id="connection-tools" class="hidden">
    <!-- shown only in facility mode, populated dynamically -->
  </div>
  <div id="hud-buttons">
    <button id="btn-research" class="hud-btn">Research</button>
    <button id="btn-goals" class="hud-btn">Goals</button>
    <button id="btn-toggle-beam" class="hud-btn btn-beam">Start Beam</button>
  </div>
</div>
```

- [ ] **Step 2: Add mode switcher and connection tools CSS to style.css**

Append these styles to `style.css`:

```css
/* === MODE SWITCHER === */
#mode-switcher {
  display: flex;
  gap: 3px;
  margin-right: 8px;
}

.mode-btn {
  font-family: 'Press Start 2P', monospace;
  font-size: 9px;
  padding: 6px 10px;
  background: rgba(30, 30, 50, 0.8);
  color: #6666aa;
  border: 1px solid rgba(60, 60, 100, 0.4);
  border-radius: 3px;
  cursor: pointer;
  white-space: nowrap;
}

.mode-btn:hover {
  background: rgba(50, 50, 80, 0.8);
  color: #8888cc;
}

.mode-btn.active {
  background: rgba(50, 60, 100, 0.8);
  color: #aaccff;
  border-color: rgba(80, 120, 200, 0.6);
}

.mode-btn.disabled {
  opacity: 0.3;
  cursor: not-allowed;
  pointer-events: none;
}

/* === CONNECTION TOOLS === */
#connection-tools {
  display: flex;
  gap: 3px;
  margin-left: 8px;
}

.conn-btn {
  font-family: 'Press Start 2P', monospace;
  font-size: 7px;
  padding: 4px 8px;
  background: rgba(30, 30, 50, 0.8);
  border: 1px solid rgba(60, 60, 100, 0.4);
  border-radius: 3px;
  cursor: pointer;
  white-space: nowrap;
}

.conn-btn:hover {
  background: rgba(50, 50, 80, 0.8);
}

.conn-btn.active {
  border-width: 2px;
}
```

- [ ] **Step 3: Verify the page renders correctly**

Open `index.html` in browser. The mode switcher buttons should appear. Structure should be greyed out. Category tabs area should be empty (will be populated dynamically in next task).

- [ ] **Step 4: Commit**

```bash
git add index.html style.css
git commit -m "Add mode switcher and connection tools UI"
```

---

### Task 4: Wire up mode switching in renderer.js

**Files:**
- Modify: `renderer.js:1-11` (CATEGORY_MAP)
- Modify: `renderer.js` (_bindHUDEvents, _renderPalette, init)

- [ ] **Step 1: Remove CATEGORY_MAP and add mode-aware tab generation**

Replace the `CATEGORY_MAP` block at lines 1-11 of renderer.js with:

```js
// === BEAMLINE TYCOON: PIXI.JS RENDERER ===

// Determine which mode a category belongs to
function getModeForCategory(catKey) {
  for (const [modeKey, mode] of Object.entries(MODES)) {
    if (mode.categories[catKey]) return modeKey;
  }
  return null;
}

// Check if a category is a facility category (equipment placed on grid, not beamline)
function isFacilityCategory(catKey) {
  return getModeForCategory(catKey) === 'facility';
}
```

- [ ] **Step 2: Add activeMode state and tab generation to the Renderer class**

Add these properties to the constructor (after `this._onInfraSelect = null;`):

```js
this.activeMode = 'beamline';
this._onConnSelect = null;  // callback for connection tool selection
```

Add a new method `_generateCategoryTabs()`:

```js
_generateCategoryTabs() {
  const tabsContainer = document.getElementById('category-tabs');
  if (!tabsContainer) return;
  tabsContainer.innerHTML = '';

  const mode = MODES[this.activeMode];
  if (!mode || mode.disabled) return;

  const catKeys = Object.keys(mode.categories);
  catKeys.forEach((key, idx) => {
    const cat = mode.categories[key];
    const btn = document.createElement('button');
    btn.className = 'cat-tab' + (idx === 0 ? ' active' : '');
    btn.dataset.category = key;
    btn.textContent = cat.name;
    btn.addEventListener('click', () => {
      tabsContainer.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      this._renderPalette(key);
    });
    tabsContainer.appendChild(btn);
  });

  // Generate connection tool buttons for facility mode
  const connContainer = document.getElementById('connection-tools');
  if (connContainer) {
    connContainer.innerHTML = '';
    if (this.activeMode === 'facility') {
      connContainer.classList.remove('hidden');
      for (const [key, conn] of Object.entries(CONNECTION_TYPES)) {
        const btn = document.createElement('button');
        btn.className = 'conn-btn';
        btn.dataset.connType = key;
        btn.textContent = conn.name;
        // Set border color to connection color
        const hex = '#' + conn.color.toString(16).padStart(6, '0');
        btn.style.color = hex;
        btn.style.borderColor = hex;
        btn.addEventListener('click', () => {
          connContainer.querySelectorAll('.conn-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          if (this._onConnSelect) this._onConnSelect(key);
        });
        connContainer.appendChild(btn);
      }
    } else {
      connContainer.classList.add('hidden');
    }
  }

  // Render palette for first category in mode
  if (catKeys.length > 0) {
    this._renderPalette(catKeys[0]);
  }
}
```

- [ ] **Step 3: Add mode switching logic to _bindHUDEvents**

Find the `_bindHUDEvents()` method in renderer.js. Add mode switcher click handling at the beginning of the method:

```js
// Mode switcher
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    if (MODES[mode]?.disabled) return;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    this.activeMode = mode;
    this._generateCategoryTabs();
  });
});
```

- [ ] **Step 4: Update _renderPalette to handle facility categories**

In `_renderPalette(tabCategory)`, replace the infrastructure check block (the `if (compCategory === 'infrastructure')` block) with a facility category check:

Replace:
```js
// Map tab category name to component category field
const compCategory = CATEGORY_MAP[tabCategory] || tabCategory;

// Infrastructure tab uses INFRASTRUCTURE items instead of COMPONENTS
if (compCategory === 'infrastructure') {
```

With:
```js
const compCategory = tabCategory;

// Infrastructure tab (Structure mode) uses INFRASTRUCTURE items
if (compCategory === 'infrastructure') {
```

Also update the main component loop to use `compCategory` directly (remove the `CATEGORY_MAP` reference):

The loop at `for (const [key, comp] of Object.entries(COMPONENTS))` already uses `comp.category !== compCategory` — this works since categories now match directly.

For facility categories, use the same component rendering as beamline but call `_onFacilitySelect` instead of `_onToolSelect`:

After the infrastructure block's `return;` and before the component loop, add:

```js
// Facility mode — show components from facility categories
if (isFacilityCategory(compCategory)) {
  for (const [key, comp] of Object.entries(COMPONENTS)) {
    if (comp.category !== compCategory) continue;

    const item = document.createElement('div');
    item.className = 'palette-item';

    const unlocked = this.game.isComponentUnlocked(comp);
    const affordable = this.game.canAfford(comp.cost);

    if (!unlocked) item.classList.add('locked');
    if (!affordable) item.classList.add('unaffordable');

    const nameEl = document.createElement('div');
    nameEl.className = 'palette-name';
    nameEl.textContent = comp.name;
    item.appendChild(nameEl);

    const costEl = document.createElement('div');
    costEl.className = 'palette-cost';
    const costs = Object.entries(comp.cost).map(([r, a]) => `${this._fmt(a)} ${r}`).join(', ');
    costEl.textContent = unlocked ? costs : 'Locked';
    item.appendChild(costEl);

    if (unlocked) {
      item.addEventListener('click', () => {
        if (this._onFacilitySelect) this._onFacilitySelect(key);
      });
    }

    palette.appendChild(item);
  }
  return;
}
```

Add `this._onFacilitySelect = null;` to the constructor alongside the other callbacks.

- [ ] **Step 5: Update init() to generate tabs dynamically**

In the `init()` method, replace the line:
```js
this._renderPalette('sources');
```
with:
```js
this._generateCategoryTabs();
```

- [ ] **Step 6: Verify mode switching works**

Open in browser. Click Beamline → see Sources/Focusing/RF tabs. Click Facility → see Vacuum/Cryo/RF Power tabs with connection tool buttons. Click Structure → nothing (disabled). Components should appear in correct tabs.

- [ ] **Step 7: Commit**

```bash
git add renderer.js
git commit -m "Wire up mode switching with dynamic category tabs"
```

---

### Task 5: Update InputHandler for mode switching and Tab cycling

**Files:**
- Modify: `input.js`

- [ ] **Step 1: Add mode awareness and facility placement state to InputHandler**

Add these properties to the InputHandler constructor:

```js
this.activeMode = 'beamline';       // synced with renderer
this.selectedFacilityTool = null;   // facility component type or null
this.selectedConnTool = null;       // connection type key or null
this.isDrawingConn = false;         // true while dragging to draw connections
this.connPath = [];                 // array of {col, row} tiles drawn
```

- [ ] **Step 2: Update Tab key handler to use MODES**

Replace the Tab key handler (lines 65-77) with:

```js
case 'Tab': {
  e.preventDefault();
  const mode = MODES[this.activeMode];
  if (!mode || mode.disabled) break;
  const catKeys = Object.keys(mode.categories);
  const tabs = document.querySelectorAll('.cat-tab');
  const tabCats = Array.from(tabs).map(t => t.dataset.category);
  const curIdx = tabCats.indexOf(this.selectedCategory);
  const nextIdx = (curIdx + 1) % tabCats.length;
  this.selectedCategory = tabCats[nextIdx];
  tabs.forEach(t => t.classList.remove('active'));
  tabs[nextIdx].classList.add('active');
  this.renderer.updatePalette(this.selectedCategory);
  break;
}
```

- [ ] **Step 3: Add facility tool selection methods**

Add these methods to InputHandler:

```js
selectFacilityTool(compType) {
  this.deselectTool();
  this.deselectInfraTool();
  this.deselectConnTool();
  this.selectedFacilityTool = compType;
  this.selectedNodeId = null;
  this.renderer.hidePopup();
}

deselectFacilityTool() {
  this.selectedFacilityTool = null;
}

selectConnTool(connType) {
  this.deselectTool();
  this.deselectInfraTool();
  this.deselectFacilityTool();
  this.selectedConnTool = connType;
  this.selectedNodeId = null;
  this.renderer.hidePopup();
}

deselectConnTool() {
  this.selectedConnTool = null;
  this.isDrawingConn = false;
  this.connPath = [];
}

setActiveMode(mode) {
  this.activeMode = mode;
  this.deselectTool();
  this.deselectInfraTool();
  this.deselectFacilityTool();
  this.deselectConnTool();
  this.renderer.activeMode = mode;
}
```

- [ ] **Step 4: Update Escape key handler to clear facility/connection state**

In the Escape handler, add after `this.deselectInfraTool();`:

```js
this.deselectFacilityTool();
this.deselectConnTool();
```

- [ ] **Step 5: Commit**

```bash
git add input.js
git commit -m "Add facility and connection tool selection to InputHandler"
```

---

### Task 6: Wire facility and connection callbacks in main.js

**Files:**
- Modify: `main.js`

- [ ] **Step 1: Add facility and connection selection callbacks**

After the existing callback wiring (lines 19-20), add:

```js
renderer._onFacilitySelect = (compType) => input.selectFacilityTool(compType);
renderer._onConnSelect = (connType) => input.selectConnTool(connType);
```

Also wire mode switching from the renderer back to input. Add after the callback lines:

```js
// Sync mode changes from renderer to input
const origGenTabs = renderer._generateCategoryTabs.bind(renderer);
const origMethod = renderer._generateCategoryTabs;
// Override mode button clicks to sync input handler
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    if (MODES[mode]?.disabled) return;
    input.setActiveMode(mode);
  });
});
```

- [ ] **Step 2: Verify mode switching syncs between renderer and input**

Open in browser. Switch modes. Verify no console errors. Select a facility component — should not try to place on beamline.

- [ ] **Step 3: Commit**

```bash
git add main.js
git commit -m "Wire facility and connection callbacks in main.js"
```

---

### Task 7: Add facility equipment grid placement to game.js

**Files:**
- Modify: `game.js`

- [ ] **Step 1: Add facility state to game state**

In the Game constructor's `this.state` object, add after the `infraOccupied` line:

```js
// Facility equipment (off-beamline support systems)
facilityEquipment: [],      // [{ id, type, col, row }]
facilityGrid: {},           // "col,row" -> equipment id
facilityNextId: 1,
// Utility connections
connections: new Map(),     // "col,row" -> Set of connection type keys
```

- [ ] **Step 2: Add facility placement methods**

Add these methods to the Game class:

```js
// === FACILITY EQUIPMENT ===

placeFacilityEquipment(col, row, compType) {
  const comp = COMPONENTS[compType];
  if (!comp) return false;
  if (!this.isComponentUnlocked(comp)) return false;
  if (!this.canAfford(comp.cost)) {
    this.log(`Can't afford ${comp.name}!`, 'bad');
    return false;
  }

  const key = col + ',' + row;
  if (this.state.facilityGrid[key]) {
    this.log('Tile occupied!', 'bad');
    return false;
  }
  if (this.state.infraOccupied[key]) {
    this.log('Tile occupied!', 'bad');
    return false;
  }

  const id = 'fac_' + this.state.facilityNextId++;
  this.spend(comp.cost);
  const entry = { id, type: compType, col, row };
  this.state.facilityEquipment.push(entry);
  this.state.facilityGrid[key] = id;
  this.log(`Built ${comp.name}`, 'good');
  this.emit('facilityChanged');
  return true;
}

removeFacilityEquipment(equipId) {
  const idx = this.state.facilityEquipment.findIndex(e => e.id === equipId);
  if (idx === -1) return false;

  const entry = this.state.facilityEquipment[idx];
  const comp = COMPONENTS[entry.type];

  // 50% refund
  if (comp) {
    for (const [r, a] of Object.entries(comp.cost))
      this.state.resources[r] += Math.floor(a * 0.5);
  }

  const key = entry.col + ',' + entry.row;
  delete this.state.facilityGrid[key];
  this.state.facilityEquipment.splice(idx, 1);
  this.log(`Removed ${comp ? comp.name : 'equipment'} (50% refund)`, 'info');
  this.emit('facilityChanged');
  return true;
}

// === CONNECTIONS ===

placeConnection(col, row, connType) {
  const key = col + ',' + row;
  if (!this.state.connections.has(key)) {
    this.state.connections.set(key, new Set());
  }
  const set = this.state.connections.get(key);
  if (set.has(connType)) {
    // Toggle off — remove this connection type from the tile
    set.delete(connType);
    if (set.size === 0) this.state.connections.delete(key);
    this.emit('connectionsChanged');
    return false; // removed
  }
  set.add(connType);
  this.emit('connectionsChanged');
  return true; // added
}

getConnectionsAt(col, row) {
  const key = col + ',' + row;
  return this.state.connections.get(key) || new Set();
}
```

- [ ] **Step 3: Commit**

```bash
git add game.js
git commit -m "Add facility equipment and connection placement to game engine"
```

---

### Task 8: Handle facility clicks and connection drawing in InputHandler

**Files:**
- Modify: `input.js`

- [ ] **Step 1: Add facility click handling to _handleClick**

In `_handleClick`, add a block before the `if (this.selectedTool)` check:

```js
// Facility equipment placement
if (this.selectedFacilityTool) {
  this.game.placeFacilityEquipment(col, row, this.selectedFacilityTool);
  return;
}
```

- [ ] **Step 2: Add connection drawing to mousedown**

In the `mousedown` handler, add before the existing infrastructure drag block:

```js
// Connection drawing start
if (e.button === 0 && this.selectedConnTool) {
  const world = this.renderer.screenToWorld(e.clientX, e.clientY);
  const grid = isoToGrid(world.x, world.y);
  this.isDrawingConn = true;
  this.connPath = [{ col: grid.col, row: grid.row }];
  this.game.placeConnection(grid.col, grid.row, this.selectedConnTool);
  return;
}
```

- [ ] **Step 3: Add connection drawing to mousemove**

In the `mousemove` handler, add a block after the `isDragging` check and before the `else`:

```js
else if (this.isDrawingConn && this.selectedConnTool) {
  const world = this.renderer.screenToWorld(e.clientX, e.clientY);
  const grid = isoToGrid(world.x, world.y);
  const last = this.connPath[this.connPath.length - 1];
  if (grid.col !== last.col || grid.row !== last.row) {
    this.connPath.push({ col: grid.col, row: grid.row });
    this.game.placeConnection(grid.col, grid.row, this.selectedConnTool);
  }
}
```

- [ ] **Step 4: Add connection drawing end to mouseup**

In the `mouseup` handler, add before the infrastructure drag end block:

```js
// Connection drawing end
if (this.isDrawingConn) {
  this.isDrawingConn = false;
  this.connPath = [];
  return;
}
```

- [ ] **Step 5: Verify facility placement and connection drawing**

Open in browser. Switch to Facility mode. Select a vacuum pump. Click on grid — should place. Select a connection tool. Click and drag across tiles — connections should be placed. Check console for errors.

- [ ] **Step 6: Commit**

```bash
git add input.js
git commit -m "Handle facility clicks and connection drag-drawing"
```

---

### Task 9: Render facility equipment on the isometric grid

**Files:**
- Modify: `renderer.js`
- Modify: `sprites.js`

- [ ] **Step 1: Generate textures for facility components in SpriteManager**

In `sprites.js`, update `generatePlaceholders()` to also generate textures for facility-category components. The current code only iterates `COMPONENTS` — it already covers all entries, so facility components will get textures automatically since they're in `COMPONENTS`. No code change needed here — just verify.

- [ ] **Step 2: Add facility rendering layer to Renderer**

In the Renderer constructor, add:

```js
this.facilityLayer = null;
```

In `init()`, add after the `infraLayer` creation:

```js
this.facilityLayer = new PIXI.Container();
this.facilityLayer.zIndex = 1.5;
this.facilityLayer.sortableChildren = true;
this.world.addChild(this.facilityLayer);
```

- [ ] **Step 3: Add _renderFacilityEquipment method**

Add to the Renderer class:

```js
_renderFacilityEquipment() {
  this.facilityLayer.removeChildren();
  const equipment = this.game.state.facilityEquipment || [];
  for (const equip of equipment) {
    const comp = COMPONENTS[equip.type];
    if (!comp) continue;
    const spriteKey = comp.spriteKey || equip.type;
    const texture = this.sprites.getTexture(spriteKey);
    if (!texture) continue;

    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5, 0.7);
    const pos = tileCenterIso(equip.col, equip.row);
    sprite.x = pos.x;
    sprite.y = pos.y;
    sprite.zIndex = equip.col + equip.row;
    this.facilityLayer.addChild(sprite);

    // Label
    const label = new PIXI.Text({
      text: comp.name,
      style: { fontFamily: 'monospace', fontSize: 9, fill: 0xcccccc },
    });
    label.anchor.set(0.5, 0);
    label.x = pos.x;
    label.y = pos.y + 8;
    label.zIndex = equip.col + equip.row + 0.1;
    this.facilityLayer.addChild(label);
  }
}
```

- [ ] **Step 4: Wire facilityChanged event**

In the `init()` event listener block, add a case:

```js
case 'facilityChanged':
  this._renderFacilityEquipment();
  break;
```

Also add `this._renderFacilityEquipment();` to the initial renders block and to the `'loaded'` case.

- [ ] **Step 5: Verify facility equipment renders**

Open in browser. Switch to Facility mode. Place a pump. It should render as an isometric box on the grid.

- [ ] **Step 6: Commit**

```bash
git add renderer.js sprites.js
git commit -m "Render facility equipment as isometric sprites on grid"
```

---

### Task 10: Render utility connections with auto-shaping

**Files:**
- Modify: `renderer.js`

- [ ] **Step 1: Add connection rendering layer**

In the Renderer constructor, add:

```js
this.connectionLayer = null;
```

In `init()`, add after the `facilityLayer` creation:

```js
this.connectionLayer = new PIXI.Container();
this.connectionLayer.zIndex = 0.7;
this.world.addChild(this.connectionLayer);
```

- [ ] **Step 2: Add _renderConnections method with auto-shaping**

Add to the Renderer class:

```js
_renderConnections() {
  this.connectionLayer.removeChildren();
  const connections = this.game.state.connections;
  if (!connections || connections.size === 0) return;

  // Fixed draw order for consistent parallel offset
  const CONN_ORDER = ['vacuumPipe', 'cryoTransfer', 'rfWaveguide', 'coolingWater', 'powerCable', 'dataFiber'];
  const LINE_WIDTH = 2;
  const LINE_GAP = 3; // pixels between parallel lines

  for (const [key, typeSet] of connections) {
    const [colStr, rowStr] = key.split(',');
    const col = parseInt(colStr);
    const row = parseInt(rowStr);

    // For each connection type on this tile, determine shape and draw
    const types = CONN_ORDER.filter(t => typeSet.has(t));
    const totalWidth = types.length * LINE_GAP;
    const startOffset = -totalWidth / 2 + LINE_GAP / 2;

    types.forEach((connType, idx) => {
      const conn = CONNECTION_TYPES[connType];
      if (!conn) return;

      const offset = startOffset + idx * LINE_GAP;

      // Check 4 neighbors for same connection type
      const hasN = this._hasConnection(col, row - 1, connType); // NE direction (row-1)
      const hasS = this._hasConnection(col, row + 1, connType); // SW direction (row+1)
      const hasE = this._hasConnection(col + 1, row, connType); // SE direction (col+1)
      const hasW = this._hasConnection(col - 1, row, connType); // NW direction (col-1)

      const neighbors = [hasN, hasE, hasS, hasW];
      const count = neighbors.filter(Boolean).length;

      const g = new PIXI.Graphics();
      const center = tileCenterIso(col, row);

      // Calculate edge midpoints in isometric space
      const midN = tileCenterIso(col, row - 0.5); // top-right edge
      const midS = tileCenterIso(col, row + 0.5); // bottom-left edge
      const midE = tileCenterIso(col + 0.5, row); // bottom-right edge
      const midW = tileCenterIso(col - 0.5, row); // top-left edge

      const edgeMids = [midN, midE, midS, midW]; // N, E, S, W

      // Apply perpendicular offset for parallel lines
      const applyOffset = (point, dirIdx) => {
        // Offset perpendicular to the edge direction
        // For N-S edges, offset in E-W iso direction and vice versa
        if (dirIdx === 0 || dirIdx === 2) {
          // N or S neighbor — offset along iso X
          return { x: point.x + offset, y: point.y };
        } else {
          // E or W neighbor — offset along iso Y
          return { x: point.x, y: point.y + offset * 0.5 };
        }
      };

      const centerOff = { x: center.x + offset * 0.5, y: center.y + offset * 0.25 };

      if (count === 0) {
        // Isolated dot
        g.circle(center.x, center.y, LINE_WIDTH);
        g.fill({ color: conn.color, alpha: 0.8 });
      } else {
        // Draw line from center to each connected edge
        for (let i = 0; i < 4; i++) {
          if (!neighbors[i]) continue;
          const edgePt = applyOffset(edgeMids[i], i);
          g.moveTo(centerOff.x, centerOff.y);
          g.lineTo(edgePt.x, edgePt.y);
          g.stroke({ color: conn.color, width: LINE_WIDTH, alpha: 0.9 });
        }
      }

      this.connectionLayer.addChild(g);
    });
  }
}

_hasConnection(col, row, connType) {
  const key = col + ',' + row;
  const set = this.game.state.connections.get(key);
  return set ? set.has(connType) : false;
}
```

- [ ] **Step 3: Wire connectionsChanged event**

In the event listener block, add:

```js
case 'connectionsChanged':
  this._renderConnections();
  break;
```

Also add `this._renderConnections();` to the initial renders block and the `'loaded'` case.

- [ ] **Step 4: Verify connection rendering**

Open in browser. Switch to Facility mode. Select a connection tool. Draw some lines. They should appear as thin colored lines with auto-shaping based on neighbors. Draw two different connection types on overlapping tiles — they should appear as parallel lines.

- [ ] **Step 5: Commit**

```bash
git add renderer.js
git commit -m "Render utility connections with auto-shaping and parallel stacking"
```

---

### Task 11: Add connection validation and hard-requirement gameplay

**Files:**
- Modify: `game.js`

- [ ] **Step 1: Add connection validation method**

Add to the Game class:

```js
// Check if a beamline component has a valid connection of the given type
hasValidConnection(node, connType) {
  const conn = CONNECTION_TYPES[connType];
  if (!conn) return false;

  // Check all 4 adjacent tiles for the connection type
  const adjacentTiles = [
    { col: node.col, row: node.row - 1 },
    { col: node.col, row: node.row + 1 },
    { col: node.col + 1, row: node.row },
    { col: node.col - 1, row: node.row },
  ];

  for (const adj of adjacentTiles) {
    const connSet = this.getConnectionsAt(adj.col, adj.row);
    if (!connSet.has(connType)) continue;

    // Trace the connection path to see if it reaches a valid facility source
    if (this._traceConnectionToSource(adj.col, adj.row, connType)) {
      return true;
    }
  }
  return false;
}

_traceConnectionToSource(startCol, startRow, connType) {
  // BFS from the tile adjacent to the beamline component, following
  // connected tiles of the same type, looking for facility equipment
  const visited = new Set();
  const queue = [{ col: startCol, row: startRow }];

  while (queue.length > 0) {
    const { col, row } = queue.shift();
    const key = col + ',' + row;
    if (visited.has(key)) continue;
    visited.add(key);

    // Check if there's facility equipment here
    const equipId = this.state.facilityGrid[key];
    if (equipId) {
      // Found facility equipment — check if it's the right type for this connection
      const equip = this.state.facilityEquipment.find(e => e.id === equipId);
      if (equip) {
        const equipConn = this._getEquipmentConnectionType(equip.type);
        if (equipConn === connType) return true;
      }
    }

    // Expand to neighbors that have this connection type
    const neighbors = [
      { col: col, row: row - 1 },
      { col: col, row: row + 1 },
      { col: col + 1, row: row },
      { col: col - 1, row: row },
    ];
    for (const n of neighbors) {
      const nKey = n.col + ',' + n.row;
      if (!visited.has(nKey) && this.getConnectionsAt(n.col, n.row).has(connType)) {
        queue.push(n);
      }
    }
  }
  return false;
}

_getEquipmentConnectionType(compType) {
  const comp = COMPONENTS[compType];
  if (!comp) return null;
  switch (comp.category) {
    case 'vacuum': return 'vacuumPipe';
    case 'cryo': return 'cryoTransfer';
    case 'rfPower': return 'rfWaveguide';
    case 'cooling': return 'coolingWater';
    case 'power': return 'powerCable';
    case 'dataControls': return 'dataFiber';
    default: return null;
  }
}
```

- [ ] **Step 2: Add requirement checking to recalcBeamline**

In `recalcBeamline()`, after the existing stat calculation loop, add connection requirement checks. Add after the `tCost += t.energyCost * ecm;` line inside the loop:

```js
// Check connection requirements for this component
if (!t.unlocked || t.requires) {
  // RF components need RF waveguide connection
  if (t.category === 'rf' && !this.hasValidConnection(node, 'rfWaveguide')) {
    node._missingConn = 'rfWaveguide';
  }
}
```

For now, track missing connections on nodes but don't block beam operation — the full hard-requirement system (beam won't work without connections) will be tied into the physics engine. The visual indicator (Task 12) will show players what's missing.

- [ ] **Step 3: Commit**

```bash
git add game.js
git commit -m "Add connection validation with BFS path tracing"
```

---

### Task 12: Add visual indicators for missing connections

**Files:**
- Modify: `renderer.js`

- [ ] **Step 1: Add warning indicators on components missing connections**

In `_renderComponents()`, after placing each component sprite, add a warning indicator if the node has a missing connection. Add after `this.nodeSprites[node.id] = sprite;`:

```js
// Warning indicator for missing connections
if (node._missingConn) {
  const warn = new PIXI.Text({
    text: '!',
    style: { fontFamily: 'monospace', fontSize: 14, fill: 0xff4444, fontWeight: 'bold' },
  });
  warn.anchor.set(0.5, 1);
  warn.x = center.x + 10;
  warn.y = center.y - 10;
  warn.zIndex = node.col + node.row + 0.2;
  this.componentLayer.addChild(warn);
}
```

- [ ] **Step 2: Verify warning indicators appear**

Open in browser. Place an RF cavity on the beamline. Without any RF power source connected via waveguide, a red "!" should appear on the component.

- [ ] **Step 3: Commit**

```bash
git add renderer.js
git commit -m "Show warning indicators on components missing utility connections"
```

---

### Task 13: Update save/load for new state fields

**Files:**
- Modify: `game.js`

- [ ] **Step 1: Update save method**

Find the `save()` method in game.js. The connections Map needs to be serialized since `JSON.stringify` doesn't handle Maps. Add conversion logic:

In the save method, before `localStorage.setItem`, add conversion of the connections Map:

```js
// Convert connections Map to serializable format
const connObj = {};
for (const [key, set] of this.state.connections) {
  connObj[key] = Array.from(set);
}
const saveState = { ...this.state, connections: connObj };
```

Use `saveState` instead of `this.state` in the `JSON.stringify` call.

- [ ] **Step 2: Update load method**

In the `load()` method, after restoring state, convert the connections back to a Map:

```js
// Restore connections Map from serialized format
if (this.state.connections && !(this.state.connections instanceof Map)) {
  const map = new Map();
  for (const [key, arr] of Object.entries(this.state.connections)) {
    map.set(key, new Set(arr));
  }
  this.state.connections = map;
} else if (!this.state.connections) {
  this.state.connections = new Map();
}

// Ensure facility arrays exist for old saves
if (!this.state.facilityEquipment) this.state.facilityEquipment = [];
if (!this.state.facilityGrid) this.state.facilityGrid = {};
if (!this.state.facilityNextId) this.state.facilityNextId = 1;
```

- [ ] **Step 3: Verify save/load round-trips**

Open in browser. Place facility equipment and draw connections. Refresh page. Equipment and connections should persist.

- [ ] **Step 4: Commit**

```bash
git add game.js
git commit -m "Serialize facility equipment and connections for save/load"
```

---

### Task 14: Final integration and cleanup

**Files:**
- Modify: `renderer.js`
- Modify: `input.js`

- [ ] **Step 1: Add facility equipment click-to-inspect**

In InputHandler's `_handleClick`, add facility equipment inspection when no tool is selected. After the existing beamline node selection block:

```js
// Check for facility equipment click
const facKey = col + ',' + row;
const facId = this.game.state.facilityGrid[facKey];
if (facId) {
  const equip = this.game.state.facilityEquipment.find(e => e.id === facId);
  if (equip) {
    const comp = COMPONENTS[equip.type];
    if (comp) {
      this.renderer.showFacilityPopup(equip, comp, screenX, screenY);
      return;
    }
  }
}
```

- [ ] **Step 2: Add showFacilityPopup to Renderer**

Add a method to show a popup for facility equipment, reusing the existing popup DOM:

```js
showFacilityPopup(equip, comp, screenX, screenY) {
  const popup = document.getElementById('component-popup');
  if (!popup) return;

  const title = popup.querySelector('.popup-title');
  if (title) title.textContent = comp.name;

  const stats = popup.querySelector('.popup-stats');
  if (stats) {
    let html = `<div>Type: ${comp.name}</div>`;
    html += `<div>Category: ${comp.category}</div>`;
    html += `<div>Energy Cost: ${comp.energyCost} E/s</div>`;
    stats.innerHTML = html;
  }

  const actions = popup.querySelector('.popup-actions');
  if (actions) {
    actions.innerHTML = '';
    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove (50% refund)';
    removeBtn.className = 'popup-remove-btn btn-danger';
    removeBtn.addEventListener('click', () => {
      this.game.removeFacilityEquipment(equip.id);
      this.hidePopup();
    });
    actions.appendChild(removeBtn);
  }

  popup.style.left = Math.min(screenX + 10, window.innerWidth - 220) + 'px';
  popup.style.top = Math.min(screenY + 10, window.innerHeight - 200) + 'px';
  popup.classList.remove('hidden');

  const closeBtn = popup.querySelector('.popup-close');
  if (closeBtn) closeBtn.onclick = () => this.hidePopup();
}
```

- [ ] **Step 3: Add right-click to deselect facility/connection tools**

In the mouseup handler's right-click block, add after `this.deselectInfraTool()`:

```js
} else if (this.selectedFacilityTool) {
  this.deselectFacilityTool();
} else if (this.selectedConnTool) {
  this.deselectConnTool();
```

- [ ] **Step 4: Final verification**

Open in browser. Full test:
1. Beamline mode: place source, quad, RF cavity — works as before
2. Switch to Facility mode: see new tabs (Vacuum, Cryo, RF Power, etc.)
3. Place a klystron from RF Power tab
4. Select RF Waveguide connection tool, drag from klystron toward beamline
5. RF cavity warning "!" should disappear if waveguide reaches it
6. Switch back to Beamline mode — all items still visible
7. Tab key cycles categories within current mode only
8. Save, reload — everything persists

- [ ] **Step 5: Commit**

```bash
git add renderer.js input.js
git commit -m "Add facility equipment inspection and final integration"
```
