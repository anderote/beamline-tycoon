# Beamline Designer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename "Beamline Controller" to "Beamline Designer", add a saved designs library, design placement on the map, and replace "New Game" with a Menu dropdown.

**Architecture:** Extend the existing ControllerView with a `mode` property (`'edit'` vs `'design'`). Add a DesignLibrary overlay for browsing saved designs. Add a DesignPlacer class for stamping designs onto the map with transparent preview. Saved designs stored in `game.state.savedDesigns[]` and persisted via localStorage.

**Tech Stack:** Vanilla JS (ES6 modules), PIXI.js for map rendering, HTML/CSS DOM overlays.

---

## File Structure

### New Files
- `src/ui/DesignLibrary.js` — Designs overlay: browse, manage, categorize saved designs
- `src/ui/DesignPlacer.js` — Map placement mode for stamping saved designs onto isometric grid

### Renamed Files
- `src/ui/ControllerView.js` → `src/ui/BeamlineDesigner.js`
- `src/renderer/controller-renderer.js` → `src/renderer/designer-renderer.js`

### Modified Files
- `index.html` — rename overlay IDs/classes, add designs overlay HTML, add menu dropdown, update top bar
- `style.css` — rename `ctrl-*`/`controller-*` classes to `dsgn-*`/`designer-*`, add designs overlay + menu styles
- `src/main.js` — update imports, wire new buttons/classes
- `src/game/Game.js` — add `savedDesigns` to state, save/load designs, auto-foundation helper
- `src/input/InputHandler.js` — update controller references, handle DesignPlacer keys
- `src/ui/BeamlineWindow.js` — rename controller reference to designer
- `src/renderer/Renderer.js` — add design preview layer for placement ghost

---

### Task 1: Rename ControllerView → BeamlineDesigner (file + class rename)

**Files:**
- Rename: `src/ui/ControllerView.js` → `src/ui/BeamlineDesigner.js`
- Rename: `src/renderer/controller-renderer.js` → `src/renderer/designer-renderer.js`
- Modify: `src/main.js`
- Modify: `src/ui/BeamlineWindow.js`
- Modify: `src/input/InputHandler.js`

- [ ] **Step 1: Rename ControllerView.js to BeamlineDesigner.js**

```bash
git mv src/ui/ControllerView.js src/ui/BeamlineDesigner.js
```

- [ ] **Step 2: Rename controller-renderer.js to designer-renderer.js**

```bash
git mv src/renderer/controller-renderer.js src/renderer/designer-renderer.js
```

- [ ] **Step 3: Update class name in BeamlineDesigner.js**

In `src/ui/BeamlineDesigner.js`, change the file header comment:

```javascript
// src/ui/BeamlineDesigner.js — Beamline Designer View
```

Rename the class:

```javascript
export class BeamlineDesigner {
```

- [ ] **Step 4: Update designer-renderer.js imports and prototype references**

In `src/renderer/designer-renderer.js`:

Change the import:
```javascript
import { BeamlineDesigner } from '../ui/BeamlineDesigner.js';
```

Replace all occurrences of `ControllerView.prototype` with `BeamlineDesigner.prototype` (there are 14 occurrences).

Update the comment at line 2:
```javascript
// Extends BeamlineDesigner.prototype with canvas rendering methods.
```

- [ ] **Step 5: Update src/main.js**

Change:
```javascript
import { ControllerView } from './ui/ControllerView.js';
import './renderer/controller-renderer.js';
```
To:
```javascript
import { BeamlineDesigner } from './ui/BeamlineDesigner.js';
import './renderer/designer-renderer.js';
```

Change:
```javascript
const controllerView = new ControllerView(game, renderer);
game._controllerView = controllerView;
```
To:
```javascript
const designer = new BeamlineDesigner(game, renderer);
game._designer = designer;
```

Change:
```javascript
if (controllerView.handlePaletteClick(compType)) return;
```
To:
```javascript
if (designer.handlePaletteClick(compType)) return;
```

- [ ] **Step 6: Update src/ui/BeamlineWindow.js**

Change at line 129:
```javascript
label: 'Designer',
onClick: () => {
  if (this.game._designer) {
    this.game._designer.open(this.beamlineId);
  }
},
```

- [ ] **Step 7: Update src/input/InputHandler.js**

Change at line 91:
```javascript
if (this.game._designer && this.game._designer.isOpen) return;
```

Change at lines 210-214:
```javascript
if (this.game._designer && !this.game._designer.isOpen) {
```
And:
```javascript
this.game._designer.open(blId);
```

- [ ] **Step 8: Verify the app loads**

```bash
cd /Users/andrewcote/Documents/software/beamline-tycoon && npx vite --open 2>&1 | head -5
```

Open the browser, click on a beamline, click "Designer" — should open the same view as before.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "refactor: rename ControllerView to BeamlineDesigner"
```

---

### Task 2: Rename DOM IDs and CSS classes (ctrl-* → dsgn-*)

**Files:**
- Modify: `index.html`
- Modify: `style.css`
- Modify: `src/ui/BeamlineDesigner.js`
- Modify: `src/renderer/designer-renderer.js`

- [ ] **Step 1: Update index.html overlay HTML**

Replace the controller overlay section (lines 146-212) with:

```html
    <!-- Beamline Designer View (full-screen, hidden by default) -->
    <div id="designer-overlay" class="designer-overlay hidden">
      <div class="dsgn-header">
        <span class="dsgn-title" id="dsgn-title">Beamline Designer</span>
        <div class="dsgn-draft-bar">
          <span class="dsgn-draft-summary" id="dsgn-draft-summary"></span>
          <span class="dsgn-draft-cost" id="dsgn-draft-cost"></span>
          <button class="dsgn-btn dsgn-insert-before" id="dsgn-insert-before" title="Insert Before Selected">+ Before</button>
          <button class="dsgn-btn dsgn-insert-after" id="dsgn-insert-after" title="Insert After Selected">+ After</button>
          <button class="dsgn-btn dsgn-save-design" id="dsgn-save-design" style="display:none">Save Design</button>
          <button class="dsgn-btn dsgn-save-as" id="dsgn-save-as" style="display:none">Save As</button>
          <button class="dsgn-btn dsgn-confirm" id="dsgn-confirm">Confirm</button>
          <button class="dsgn-btn dsgn-cancel" id="dsgn-cancel">Cancel</button>
        </div>
        <button class="overlay-close" id="dsgn-close">&times;</button>
      </div>
      <div class="dsgn-body">
        <div class="dsgn-schematic-row">
          <canvas id="dsgn-schematic-canvas"></canvas>
        </div>
        <div class="dsgn-tuning-row" id="dsgn-tuning-row">
          <div class="dsgn-tuning-info" id="dsgn-tuning-info">
            <div class="dsgn-tuning-name" id="dsgn-tuning-name">No component selected</div>
            <div class="dsgn-tuning-desc" id="dsgn-tuning-desc"></div>
          </div>
          <div class="dsgn-tuning-stats" id="dsgn-tuning-stats"></div>
          <div class="dsgn-tuning-params" id="dsgn-tuning-params">
          </div>
        </div>
        <div class="dsgn-plots-row">
          <div class="dsgn-plot-panel">
            <select class="dsgn-plot-select" data-panel="0">
              <option value="beam-envelope" selected>Beam Envelope</option>
              <option value="current-loss">Current &amp; Loss</option>
              <option value="emittance">Emittance</option>
              <option value="energy-dispersion">Energy &amp; Dispersion</option>
              <option value="peak-current">Peak Current</option>
              <option value="phase-space">Phase Space</option>
              <option value="longitudinal">Longitudinal PS</option>
            </select>
            <canvas class="dsgn-plot-canvas" data-panel="0"></canvas>
          </div>
          <div class="dsgn-plot-panel">
            <select class="dsgn-plot-select" data-panel="1">
              <option value="beam-envelope">Beam Envelope</option>
              <option value="current-loss">Current &amp; Loss</option>
              <option value="emittance" selected>Emittance</option>
              <option value="energy-dispersion">Energy &amp; Dispersion</option>
              <option value="peak-current">Peak Current</option>
              <option value="phase-space">Phase Space</option>
              <option value="longitudinal">Longitudinal PS</option>
            </select>
            <canvas class="dsgn-plot-canvas" data-panel="1"></canvas>
          </div>
          <div class="dsgn-plot-panel">
            <select class="dsgn-plot-select" data-panel="2">
              <option value="beam-envelope">Beam Envelope</option>
              <option value="current-loss">Current &amp; Loss</option>
              <option value="emittance">Emittance</option>
              <option value="energy-dispersion">Energy &amp; Dispersion</option>
              <option value="peak-current">Peak Current</option>
              <option value="phase-space" selected>Phase Space</option>
              <option value="longitudinal">Longitudinal PS</option>
            </select>
            <canvas class="dsgn-plot-canvas" data-panel="2"></canvas>
          </div>
        </div>
      </div>
    </div>
```

- [ ] **Step 2: Update style.css — rename all controller classes**

In `style.css`, perform these replacements throughout:
- `.controller-overlay` → `.designer-overlay`
- `.ctrl-` → `.dsgn-`

This affects lines 1679-1986. Every instance of `ctrl-` in a CSS selector or class name becomes `dsgn-`.

- [ ] **Step 3: Update BeamlineDesigner.js — all DOM ID references**

In `src/ui/BeamlineDesigner.js`, replace all `getElementById` references:

| Old ID | New ID |
|--------|--------|
| `controller-overlay` | `designer-overlay` |
| `ctrl-draft-summary` | `dsgn-draft-summary` |
| `ctrl-draft-cost` | `dsgn-draft-cost` |
| `ctrl-confirm` | `dsgn-confirm` |
| `ctrl-cancel` | `dsgn-cancel` |
| `ctrl-close` | `dsgn-close` |
| `ctrl-insert-before` | `dsgn-insert-before` |
| `ctrl-insert-after` | `dsgn-insert-after` |
| `ctrl-schematic-canvas` | `dsgn-schematic-canvas` |

Also replace the CSS class reference:
- `querySelector('.ctrl-plot-select')` → `querySelector('.dsgn-plot-select')`
- `querySelector('.ctrl-plot-canvas')` → `querySelector('.dsgn-plot-canvas')`

- [ ] **Step 4: Update designer-renderer.js — all DOM ID and class references**

In `src/renderer/designer-renderer.js`, replace all DOM references:

| Old | New |
|-----|-----|
| `ctrl-schematic-canvas` | `dsgn-schematic-canvas` |
| `ctrl-tuning-name` | `dsgn-tuning-name` |
| `ctrl-tuning-desc` | `dsgn-tuning-desc` |
| `ctrl-tuning-stats` | `dsgn-tuning-stats` |
| `ctrl-tuning-params` | `dsgn-tuning-params` |
| `.ctrl-plot-panel` | `.dsgn-plot-panel` |
| `.ctrl-plot-select` | `.dsgn-plot-select` |
| `.ctrl-plot-canvas` | `.dsgn-plot-canvas` |
| `ctrl-palette-card` | `dsgn-palette-card` |
| `ctrl-card-schematic` | `dsgn-card-schematic` |
| `ctrl-card-info` | `dsgn-card-info` |
| `ctrl-card-name` | `dsgn-card-name` |
| `ctrl-card-desc` | `dsgn-card-desc` |
| `ctrl-card-cost` | `dsgn-card-cost` |
| `_renderControllerPalette` | `_renderDesignerPalette` |
| `_createControllerPaletteCard` | `_createDesignerPaletteCard` |
| `_setupControllerTabs` | `_setupDesignerTabs` |

- [ ] **Step 5: Update BeamlineDesigner.js method calls to match renamed methods**

In `src/ui/BeamlineDesigner.js`, rename:
- `this._setupControllerTabs()` → `this._setupDesignerTabs()` (line 227)

- [ ] **Step 6: Verify the app loads and designer still works**

Open browser, test opening designer from a beamline context window.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "refactor: rename ctrl-* DOM IDs and CSS classes to dsgn-*"
```

---

### Task 3: Add design mode to BeamlineDesigner

**Files:**
- Modify: `src/ui/BeamlineDesigner.js`
- Modify: `src/renderer/designer-renderer.js`

- [ ] **Step 1: Add mode and design tracking properties to constructor**

In `src/ui/BeamlineDesigner.js`, add after `this.selectedIndex = -1;` (line 22):

```javascript
    // Mode: 'edit' (from placed beamline) or 'design' (standalone sandbox)
    this.mode = 'edit';
    this.designId = null;       // ID of saved design being edited (design mode only)
    this.designName = '';       // editable name for design mode
```

- [ ] **Step 2: Add openDesignMode method**

After the `open(beamlineId)` method, add:

```javascript
  openDesign(design = null) {
    this.mode = 'design';
    this.beamlineId = null;
    this.isOpen = true;

    if (design) {
      // Load existing design
      this.designId = design.id;
      this.designName = design.name;
      this.draftNodes = design.components.map((c, i) => ({
        id: -(i + 1),
        type: c.type,
        col: 0, row: 0, dir: 0, entryDir: 0,
        parentId: null, bendDir: c.bendDir || null, tiles: [],
        params: c.params ? { ...c.params } : {},
        computedStats: null,
      }));
    } else {
      // New blank design
      this.designId = null;
      this.designName = 'New Design';
      this.draftNodes = [];
    }
    this.originalNodes = this.draftNodes.map(n => this._cloneNode(n));
    this.selectedIndex = this.draftNodes.length > 0 ? 0 : -1;
    this.focusRow = 0;
    this.insertMode = null;
    this.viewX = 0;
    this.viewZoom = 1;
    this._nextTempId = this.draftNodes.length;

    this._updateTotalLength();
    this._recalcDraft();

    // Close all context windows and popups
    ContextWindow.closeAll();
    this.renderer.hidePopup();

    this.overlay.classList.remove('hidden');
    const bottomHud = document.getElementById('bottom-hud');
    if (bottomHud) bottomHud.style.zIndex = '260';

    this._setupDesignerTabs();
    this._updateDesignerHeader();
    this._updateDraftBar();
    this._renderAll();
  }
```

- [ ] **Step 3: Add _updateDesignerHeader method**

```javascript
  _updateDesignerHeader() {
    const titleEl = document.getElementById('dsgn-title');
    const confirmBtn = document.getElementById('dsgn-confirm');
    const cancelBtn = document.getElementById('dsgn-cancel');
    const saveDesignBtn = document.getElementById('dsgn-save-design');
    const saveAsBtn = document.getElementById('dsgn-save-as');
    const costEl = document.getElementById('dsgn-draft-cost');

    if (this.mode === 'design') {
      // Show editable name
      if (titleEl) {
        titleEl.innerHTML = '';
        const input = document.createElement('input');
        input.type = 'text';
        input.value = this.designName;
        input.className = 'dsgn-name-input';
        input.addEventListener('input', () => { this.designName = input.value; });
        titleEl.appendChild(input);
      }
      if (confirmBtn) confirmBtn.style.display = 'none';
      if (cancelBtn) cancelBtn.style.display = 'none';
      if (saveDesignBtn) saveDesignBtn.style.display = '';
      if (saveAsBtn) saveAsBtn.style.display = this.designId ? '' : 'none';
      if (costEl) costEl.style.display = 'none';
    } else {
      if (titleEl) titleEl.textContent = 'Beamline Designer';
      if (confirmBtn) confirmBtn.style.display = '';
      if (cancelBtn) cancelBtn.style.display = '';
      if (saveDesignBtn) {
        saveDesignBtn.style.display = '';
        saveDesignBtn.textContent = 'Save as Design';
      }
      if (saveAsBtn) saveAsBtn.style.display = 'none';
      if (costEl) costEl.style.display = '';
    }
  }
```

- [ ] **Step 4: Update the open() method to set mode='edit'**

At the start of the existing `open(beamlineId)` method, add after `this.isOpen = true;`:

```javascript
    this.mode = 'edit';
    this.designId = null;
    this.designName = '';
```

And add after `this._setupDesignerTabs();`:

```javascript
    this._updateDesignerHeader();
```

- [ ] **Step 5: Wire save buttons in _bindButtons**

Add to `_bindButtons()`:

```javascript
    document.getElementById('dsgn-save-design').addEventListener('click', () => this.saveDesign());
    document.getElementById('dsgn-save-as').addEventListener('click', () => this.saveDesignAs());
```

- [ ] **Step 6: Add saveDesign and saveDesignAs methods**

```javascript
  saveDesign() {
    if (this.draftNodes.length === 0) {
      this.game.log('Cannot save empty design!', 'bad');
      return;
    }

    const components = this.draftNodes.map(n => ({
      type: n.type,
      params: n.params ? { ...n.params } : {},
      bendDir: n.bendDir || null,
    }));

    if (this.mode === 'design' && this.designId) {
      // Overwrite existing design
      this.game.updateDesign(this.designId, {
        name: this.designName,
        components,
      });
      this.originalNodes = this.draftNodes.map(n => this._cloneNode(n));
      this.game.log(`Design "${this.designName}" saved.`, 'good');
    } else {
      // Save as new design (from edit mode or new design)
      const name = this.mode === 'design' ? this.designName : prompt('Design name:', 'My Design');
      if (!name) return;
      const category = this._pickCategory();
      const id = this.game.addDesign({ name, category, components });
      if (this.mode === 'design') {
        this.designId = id;
        this.designName = name;
        this.originalNodes = this.draftNodes.map(n => this._cloneNode(n));
        this._updateDesignerHeader();
      }
      this.game.log(`Design "${name}" saved.`, 'good');
    }
  }

  saveDesignAs() {
    if (this.draftNodes.length === 0) {
      this.game.log('Cannot save empty design!', 'bad');
      return;
    }
    const name = prompt('New design name:', this.designName + ' (copy)');
    if (!name) return;
    const category = this._pickCategory();
    const components = this.draftNodes.map(n => ({
      type: n.type,
      params: n.params ? { ...n.params } : {},
      bendDir: n.bendDir || null,
    }));
    const id = this.game.addDesign({ name, category, components });
    this.designId = id;
    this.designName = name;
    this.originalNodes = this.draftNodes.map(n => this._cloneNode(n));
    this._updateDesignerHeader();
    this.game.log(`Design "${name}" saved as new copy.`, 'good');
  }

  _pickCategory() {
    // Infer category from components
    const types = this.draftNodes.map(n => n.type);
    const hasBend = types.some(t => COMPONENTS[t]?.isDipole);
    const hasUndulator = types.some(t => t === 'undulator' || t === 'wiggler');
    if (hasUndulator) return 'fel';
    if (hasBend) return 'synchrotron';
    return 'linac';
  }
```

- [ ] **Step 7: Update _recalcDraft to handle design mode (no beamlineId)**

In `_recalcDraft()`, the section that reads `this.game.registry.get(this.beamlineId)` needs a guard:

Replace:
```javascript
    const entry = this.game.registry.get(this.beamlineId);
    if (entry) researchEffects.machineType = entry.beamState.machineType;
```
With:
```javascript
    if (this.beamlineId) {
      const entry = this.game.registry.get(this.beamlineId);
      if (entry) researchEffects.machineType = entry.beamState.machineType;
    } else {
      researchEffects.machineType = this._pickCategory();
    }
```

- [ ] **Step 8: Update _updateDraftBar to hide cost in design mode**

At the start of `_updateDraftBar()`, add:

```javascript
    if (this.mode === 'design') {
      this.summaryEl.textContent = `${this.draftNodes.length} components · ${this.totalLength.toFixed(1)}m`;
      return;
    }
```

- [ ] **Step 9: Update confirm() to be no-op in design mode**

At the start of `confirm()`, add:

```javascript
    if (this.mode === 'design') return; // use Save in design mode
```

- [ ] **Step 10: Add CSS for the name input**

In `style.css`, after the `.dsgn-title` rule, add:

```css
.dsgn-name-input {
  font-size: 11px;
  color: #aaccff;
  font-family: 'Press Start 2P', monospace;
  background: rgba(20, 20, 50, 0.8);
  border: 1px solid rgba(80, 80, 120, 0.4);
  border-radius: 3px;
  padding: 2px 8px;
  outline: none;
  width: 200px;
}
.dsgn-name-input:focus {
  border-color: #4488ff;
}
.dsgn-save-design {
  color: #88ccff;
  border-color: rgba(80, 120, 180, 0.4);
}
.dsgn-save-design:hover {
  background: rgba(40, 60, 80, 0.6);
}
```

- [ ] **Step 11: Commit**

```bash
git add -A && git commit -m "feat: add design mode to BeamlineDesigner with save/save-as"
```

---

### Task 4: Add saved designs to Game state with persistence

**Files:**
- Modify: `src/game/Game.js`

- [ ] **Step 1: Add savedDesigns to initial state**

In the `Game` constructor, after `networkData: null,` (line 68), add:

```javascript
      // Saved beamline designs
      savedDesigns: [],
      savedDesignNextId: 1,
```

- [ ] **Step 2: Add design CRUD methods**

After the `removeDecoration` method (or at the end of the class before `save()`), add:

```javascript
  // === SAVED DESIGNS ===

  addDesign({ name, category, components }) {
    const id = this.state.savedDesignNextId++;
    const now = Date.now();
    this.state.savedDesigns.push({
      id,
      name,
      category: category || 'other',
      components,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  updateDesign(id, updates) {
    const design = this.state.savedDesigns.find(d => d.id === id);
    if (!design) return false;
    if (updates.name !== undefined) design.name = updates.name;
    if (updates.category !== undefined) design.category = updates.category;
    if (updates.components !== undefined) design.components = updates.components;
    design.updatedAt = Date.now();
    return true;
  }

  deleteDesign(id) {
    const idx = this.state.savedDesigns.findIndex(d => d.id === id);
    if (idx < 0) return false;
    this.state.savedDesigns.splice(idx, 1);
    return true;
  }

  getDesign(id) {
    return this.state.savedDesigns.find(d => d.id === id) || null;
  }

  getDesignsByCategory(category) {
    if (!category || category === 'all') return this.state.savedDesigns;
    return this.state.savedDesigns.filter(d => d.category === category);
  }
```

- [ ] **Step 3: Ensure savedDesigns survives save/load**

In the `load()` method, after the `this.state.networkData` migration line (~line 1942), add:

```javascript
      // Ensure saved designs exist
      if (!this.state.savedDesigns) this.state.savedDesigns = [];
      if (!this.state.savedDesignNextId) this.state.savedDesignNextId = 1;
```

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add saved designs CRUD to Game state with persistence"
```

---

### Task 5: Update top bar — add Beamline Designer, Designs, Menu buttons

**Files:**
- Modify: `index.html`
- Modify: `style.css`
- Modify: `src/main.js`

- [ ] **Step 1: Update index.html top bar**

Replace the `<div id="top-buttons">` section (lines 33-38) with:

```html
      <div id="top-buttons">
        <span id="beam-summary" class="beam-summary"></span>
        <button id="btn-designer" class="hud-btn">Beamline Designer</button>
        <button id="btn-designs" class="hud-btn">Designs</button>
        <button id="btn-research" class="hud-btn">Research</button>
        <button id="btn-goals" class="hud-btn">Goals</button>
        <div id="menu-wrapper">
          <button id="btn-menu" class="hud-btn">Menu</button>
          <div id="menu-dropdown" class="menu-dropdown hidden">
            <button class="menu-item" data-action="new-game">New Game</button>
            <button class="menu-item" data-action="save-game">Save Game</button>
            <button class="menu-item" data-action="load-game">Load Game</button>
            <div class="menu-divider"></div>
            <button class="menu-item" data-action="scenarios">Scenarios</button>
            <button class="menu-item" data-action="options">Options</button>
            <button class="menu-item" data-action="guide">Guide</button>
          </div>
        </div>
      </div>
```

- [ ] **Step 2: Add menu dropdown CSS**

In `style.css`, add after the existing `#top-buttons` styles:

```css
#menu-wrapper {
  position: relative;
  display: inline-block;
}
.menu-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  background: rgba(15, 15, 35, 0.97);
  border: 1px solid rgba(80, 80, 120, 0.4);
  border-radius: 4px;
  min-width: 150px;
  z-index: 300;
  padding: 4px 0;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
}
.menu-dropdown.hidden {
  display: none;
}
.menu-item {
  display: block;
  width: 100%;
  padding: 6px 14px;
  text-align: left;
  font-family: monospace;
  font-size: 11px;
  color: #bbb;
  background: none;
  border: none;
  cursor: pointer;
}
.menu-item:hover {
  background: rgba(68, 136, 255, 0.15);
  color: #ddd;
}
.menu-divider {
  height: 1px;
  background: rgba(80, 80, 120, 0.3);
  margin: 4px 0;
}
```

- [ ] **Step 3: Wire up buttons in src/main.js**

Replace the `btn-new-game` event listener (lines 111-116) with:

```javascript
  // Beamline Designer button — opens blank designer
  document.getElementById('btn-designer').addEventListener('click', () => {
    designer.openDesign(null);
  });

  // Menu dropdown toggle
  const menuBtn = document.getElementById('btn-menu');
  const menuDropdown = document.getElementById('menu-dropdown');
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    menuDropdown.classList.toggle('hidden');
  });
  document.addEventListener('click', () => menuDropdown.classList.add('hidden'));
  menuDropdown.addEventListener('click', (e) => {
    const action = e.target.dataset?.action;
    if (!action) return;
    menuDropdown.classList.add('hidden');
    switch (action) {
      case 'new-game':
        if (confirm('Start a new game? All progress will be lost.')) {
          localStorage.removeItem('beamlineTycoon');
          location.reload();
        }
        break;
      case 'save-game':
        game.save();
        game.log('Game saved.', 'good');
        break;
      case 'load-game':
        game.log('Load game — coming soon.', 'info');
        break;
      case 'scenarios':
        game.log('Scenarios — coming soon.', 'info');
        break;
      case 'options':
        game.log('Options — coming soon.', 'info');
        break;
      case 'guide':
        game.log('Guide — coming soon.', 'info');
        break;
    }
  });
```

- [ ] **Step 4: Verify top bar renders correctly**

Open the browser. Confirm the new button order appears: Beamline Designer, Designs, Research, Goals, Menu. Click Menu to see the dropdown. Click "Beamline Designer" to open the empty designer.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add Beamline Designer, Designs, Menu buttons to top bar"
```

---

### Task 6: Create the Designs Library overlay

**Files:**
- Create: `src/ui/DesignLibrary.js`
- Modify: `index.html`
- Modify: `style.css`
- Modify: `src/main.js`

- [ ] **Step 1: Add Designs overlay HTML to index.html**

After the goals overlay closing `</div>` (line 134), add:

```html
    <!-- Designs Library overlay (hidden by default) -->
    <div id="designs-overlay" class="overlay hidden">
      <div class="overlay-header">
        <span class="overlay-title">Designs</span>
        <button class="overlay-close" data-close="designs-overlay">&times;</button>
      </div>
      <div class="designs-category-tabs" id="designs-category-tabs"></div>
      <div class="overlay-body">
        <div id="designs-grid" class="designs-grid"></div>
      </div>
    </div>
```

- [ ] **Step 2: Add designs overlay CSS**

In `style.css`, add:

```css
/* Designs Library */
.designs-category-tabs {
  display: flex;
  gap: 2px;
  padding: 4px 12px;
  border-bottom: 1px solid rgba(80, 80, 120, 0.2);
  flex-shrink: 0;
}
.designs-cat-tab {
  font-family: monospace;
  font-size: 10px;
  padding: 4px 10px;
  border: 1px solid rgba(80, 80, 120, 0.3);
  border-radius: 3px;
  background: rgba(20, 20, 40, 0.6);
  color: #888;
  cursor: pointer;
}
.designs-cat-tab.active {
  background: rgba(68, 136, 255, 0.2);
  border-color: #4488ff;
  color: #aaccff;
}
.designs-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 12px;
}
.design-card {
  width: 220px;
  background: rgba(20, 20, 45, 0.9);
  border: 1px solid rgba(80, 80, 120, 0.3);
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.15s;
}
.design-card:hover {
  border-color: rgba(100, 150, 255, 0.6);
}
.design-card-new {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 140px;
  color: #668;
  font-size: 13px;
  font-family: monospace;
}
.design-card-new:hover {
  color: #aaccff;
}
.design-card-preview {
  height: 60px;
  background: #0a0a1a;
  border-bottom: 1px solid rgba(60, 60, 100, 0.2);
}
.design-card-preview canvas {
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
}
.design-card-body {
  padding: 8px 10px;
}
.design-card-name {
  font-size: 12px;
  color: #ccc;
  font-weight: bold;
  margin-bottom: 4px;
}
.design-card-meta {
  font-size: 10px;
  color: #667;
  margin-bottom: 6px;
}
.design-card-actions {
  display: flex;
  gap: 6px;
}
.design-card-actions button {
  font-family: monospace;
  font-size: 9px;
  padding: 3px 8px;
  border: 1px solid rgba(80, 80, 120, 0.3);
  border-radius: 3px;
  background: rgba(30, 30, 60, 0.8);
  color: #aaa;
  cursor: pointer;
}
.design-card-actions button:hover {
  background: rgba(50, 50, 80, 0.9);
  color: #ddd;
}
.design-card-actions .btn-delete {
  color: #f88;
  border-color: rgba(180, 80, 80, 0.3);
}
```

- [ ] **Step 3: Create src/ui/DesignLibrary.js**

```javascript
// src/ui/DesignLibrary.js — Designs library overlay for browsing and managing saved designs.

import { COMPONENTS } from '../data/components.js';

const CATEGORIES = [
  { key: 'all', name: 'All' },
  { key: 'linac', name: 'Linacs' },
  { key: 'storageRing', name: 'Storage Rings' },
  { key: 'fel', name: 'FEL' },
  { key: 'synchrotron', name: 'Synchrotrons' },
  { key: 'collider', name: 'Colliders' },
  { key: 'other', name: 'Other' },
];

export class DesignLibrary {
  constructor(game, designer, renderer) {
    this.game = game;
    this.designer = designer;
    this.renderer = renderer;
    this.overlay = document.getElementById('designs-overlay');
    this.activeCategory = 'all';

    this._bindClose();
  }

  _bindClose() {
    const closeBtn = this.overlay.querySelector('[data-close="designs-overlay"]');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.close());
    }
  }

  open() {
    this.overlay.classList.remove('hidden');
    this._renderTabs();
    this._renderGrid();
  }

  close() {
    this.overlay.classList.add('hidden');
  }

  get isOpen() {
    return !this.overlay.classList.contains('hidden');
  }

  _renderTabs() {
    const container = document.getElementById('designs-category-tabs');
    if (!container) return;
    container.innerHTML = '';

    for (const cat of CATEGORIES) {
      const btn = document.createElement('button');
      btn.className = 'designs-cat-tab' + (cat.key === this.activeCategory ? ' active' : '');
      btn.textContent = cat.name;
      btn.addEventListener('click', () => {
        this.activeCategory = cat.key;
        this._renderTabs();
        this._renderGrid();
      });
      container.appendChild(btn);
    }
  }

  _renderGrid() {
    const grid = document.getElementById('designs-grid');
    if (!grid) return;
    grid.innerHTML = '';

    // "New Design" card
    const newCard = document.createElement('div');
    newCard.className = 'design-card design-card-new';
    newCard.textContent = '+ New Design';
    newCard.addEventListener('click', () => {
      this.close();
      this.designer.openDesign(null);
    });
    grid.appendChild(newCard);

    // Saved design cards
    const designs = this.game.getDesignsByCategory(this.activeCategory);
    for (const design of designs) {
      grid.appendChild(this._createCard(design));
    }
  }

  _createCard(design) {
    const card = document.createElement('div');
    card.className = 'design-card';

    // Mini schematic preview
    const preview = document.createElement('div');
    preview.className = 'design-card-preview';
    const canvas = document.createElement('canvas');
    canvas.width = 220;
    canvas.height = 60;
    this._drawMiniSchematic(canvas, design);
    preview.appendChild(canvas);
    card.appendChild(preview);

    // Body
    const body = document.createElement('div');
    body.className = 'design-card-body';

    const name = document.createElement('div');
    name.className = 'design-card-name';
    name.textContent = design.name;
    body.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'design-card-meta';
    const compCount = design.components.length;
    const totalLength = design.components.reduce((sum, c) => {
      const comp = COMPONENTS[c.type];
      return sum + (comp ? comp.length : 0);
    }, 0);
    const totalCost = design.components.reduce((sum, c) => {
      const comp = COMPONENTS[c.type];
      return sum + (comp?.cost?.funding || 0);
    }, 0);
    meta.textContent = `${compCount} parts · ${totalLength.toFixed(1)}m · $${totalCost.toLocaleString()}`;
    body.appendChild(meta);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'design-card-actions';

    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
      this.designer.openDesign(design);
    });
    actions.appendChild(editBtn);

    const placeBtn = document.createElement('button');
    placeBtn.textContent = 'Place';
    placeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
      if (this.onPlace) this.onPlace(design);
    });
    actions.appendChild(placeBtn);

    const dupeBtn = document.createElement('button');
    dupeBtn.textContent = 'Duplicate';
    dupeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.game.addDesign({
        name: design.name + ' (copy)',
        category: design.category,
        components: design.components.map(c => ({ ...c, params: { ...c.params } })),
      });
      this._renderGrid();
    });
    actions.appendChild(dupeBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-delete';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Delete "${design.name}"?`)) {
        this.game.deleteDesign(design.id);
        this._renderGrid();
      }
    });
    actions.appendChild(deleteBtn);

    body.appendChild(actions);
    card.appendChild(body);

    // Click card to edit
    card.addEventListener('click', () => {
      this.close();
      this.designer.openDesign(design);
    });

    return card;
  }

  _drawMiniSchematic(canvas, design) {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (design.components.length === 0) return;

    const compW = Math.min(40, (canvas.width - 20) / design.components.length);
    const compH = 20;
    const y = (canvas.height - compH) / 2;
    let x = 10;

    for (const c of design.components) {
      const comp = COMPONENTS[c.type];
      if (!comp) continue;

      // Draw component box with category color
      const color = this._getCategoryColor(comp.category);
      ctx.fillStyle = color;
      ctx.fillRect(x, y, compW - 2, compH);

      // Border
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, compW - 2, compH);

      x += compW;
    }
  }

  _getCategoryColor(category) {
    const map = {
      source: 'rgba(68, 204, 68, 0.6)',
      focusing: 'rgba(68, 136, 204, 0.6)',
      rf: 'rgba(204, 68, 68, 0.6)',
      diagnostic: 'rgba(200, 200, 200, 0.4)',
      beamOptics: 'rgba(68, 170, 204, 0.6)',
      endpoint: 'rgba(150, 150, 150, 0.5)',
    };
    return map[category] || 'rgba(100, 100, 140, 0.4)';
  }
}
```

- [ ] **Step 4: Wire DesignLibrary in src/main.js**

Add import:
```javascript
import { DesignLibrary } from './ui/DesignLibrary.js';
```

After the designer is created, add:
```javascript
  const designLibrary = new DesignLibrary(game, designer, renderer);
```

Wire the Designs button (after the btn-designer listener):
```javascript
  // Designs button — opens library
  document.getElementById('btn-designs').addEventListener('click', () => {
    designLibrary.open();
  });
```

- [ ] **Step 5: Verify the Designs overlay**

Open the browser. Click "Designs" — should see the overlay with category tabs and a "+ New Design" card. Click "+ New Design" — should open the designer in design mode. Save a design, close, reopen Designs — should see the card.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add Designs library overlay with browse, edit, duplicate, delete"
```

---

### Task 7: Create DesignPlacer for map stamping

**Files:**
- Create: `src/ui/DesignPlacer.js`
- Modify: `src/main.js`
- Modify: `src/input/InputHandler.js`
- Modify: `src/renderer/beamline-renderer.js`

- [ ] **Step 1: Create src/ui/DesignPlacer.js**

```javascript
// src/ui/DesignPlacer.js — Handles placing a saved design onto the isometric map.

import { COMPONENTS } from '../data/components.js';
import { INFRASTRUCTURE } from '../data/infrastructure.js';
import { DIR, DIR_DELTA, turnLeft, turnRight } from '../data/directions.js';

export class DesignPlacer {
  constructor(game, renderer) {
    this.game = game;
    this.renderer = renderer;
    this.active = false;
    this.design = null;
    this.startCol = 0;
    this.startRow = 0;
    this.direction = DIR.SE;  // initial placement direction
    this.reflected = false;

    // Computed placement preview
    this.previewTiles = [];   // [{ col, row, type }] — component tiles
    this.foundationTiles = []; // [{ col, row }] — auto-foundation tiles needed
    this.totalCost = 0;
    this.valid = true;
  }

  start(design) {
    this.design = design;
    this.active = true;
    this.direction = DIR.SE;
    this.reflected = false;
    this._recompute();
  }

  cancel() {
    this.active = false;
    this.design = null;
    this.previewTiles = [];
    this.foundationTiles = [];
  }

  setPosition(col, row) {
    this.startCol = col;
    this.startRow = row;
    this._recompute();
  }

  rotate() {
    this.direction = (this.direction + 1) % 4;
    this._recompute();
  }

  reflect() {
    this.reflected = !this.reflected;
    this._recompute();
  }

  _recompute() {
    if (!this.design || !this.active) return;

    this.previewTiles = [];
    this.foundationTiles = [];
    this.totalCost = 0;
    this.valid = true;

    let col = this.startCol;
    let row = this.startRow;
    let dir = this.direction;

    const concreteCost = INFRASTRUCTURE.concrete?.cost || 10;
    let componentCost = 0;
    let foundationCost = 0;

    for (const c of this.design.components) {
      const comp = COMPONENTS[c.type];
      if (!comp) continue;

      // Calculate exit direction for dipoles
      let exitDir = dir;
      let bendDir = c.bendDir;
      if (this.reflected && bendDir) {
        bendDir = bendDir === 'left' ? 'right' : 'left';
      }
      if (comp.isDipole && bendDir) {
        exitDir = bendDir === 'left' ? turnLeft(dir) : turnRight(dir);
      }

      const delta = DIR_DELTA[exitDir];
      const trackLen = comp.trackLength || 1;
      const trackW = comp.trackWidth || 1;
      const perpDir = turnLeft(exitDir);
      const perpDelta = DIR_DELTA[perpDir];

      const widthOffsets = [];
      for (let j = 0; j < trackW; j++) {
        widthOffsets.push(j - (trackW - 1) / 2);
      }

      for (let i = 0; i < trackLen; i++) {
        for (const wOff of widthOffsets) {
          const tc = col + delta.dc * i + perpDelta.dc * wOff;
          const tr = row + delta.dr * i + perpDelta.dr * wOff;
          this.previewTiles.push({ col: tc, row: tr, type: c.type });

          // Check collision
          const key = tc + ',' + tr;
          if (this.game.registry.isTileOccupied(tc, tr)) {
            this.valid = false;
          }

          // Check foundation
          const hasFoundation = this.game.state.infraOccupied[key];
          if (!hasFoundation) {
            // Check if we already plan to place foundation here
            const alreadyPlanned = this.foundationTiles.some(f => f.col === tc && f.row === tr);
            if (!alreadyPlanned) {
              this.foundationTiles.push({ col: tc, row: tr });
              foundationCost += concreteCost;
            }
          }
        }
      }

      componentCost += comp.cost?.funding || 0;

      // Advance cursor to end of this component
      col += delta.dc * trackLen;
      row += delta.dr * trackLen;
      dir = exitDir;
    }

    this.totalCost = componentCost + foundationCost;

    // Check funding
    if (this.totalCost > this.game.state.resources.funding) {
      this.valid = false;
    }
  }

  confirm() {
    if (!this.active || !this.design || !this.valid) return false;

    // Place foundation tiles
    for (const ft of this.foundationTiles) {
      const key = ft.col + ',' + ft.row;
      // Remove any decoration
      if (this.game.state.decorationOccupied[key]) {
        this.game.removeDecoration(ft.col, ft.row);
      }
      this.game.state.infrastructure.push({ type: 'concrete', col: ft.col, row: ft.row, variant: 0 });
      this.game.state.infraOccupied[key] = 'concrete';
    }

    // Determine machine type from design category
    const machineType = this.design.category || 'linac';

    // Create new beamline from design
    const entry = this.game.registry.createBeamline(machineType);

    let col = this.startCol;
    let row = this.startRow;
    let dir = this.direction;
    let firstNodeId = null;

    for (let idx = 0; idx < this.design.components.length; idx++) {
      const c = this.design.components[idx];
      const comp = COMPONENTS[c.type];
      if (!comp) continue;

      let bendDir = c.bendDir;
      if (this.reflected && bendDir) {
        bendDir = bendDir === 'left' ? 'right' : 'left';
      }

      let exitDir = dir;
      if (comp.isDipole && bendDir) {
        exitDir = bendDir === 'left' ? turnLeft(dir) : turnRight(dir);
      }

      let nodeId;
      if (idx === 0 && comp.isSource) {
        // Place as source
        nodeId = entry.beamline.placeSource(col, row, exitDir);
        // Override the source type if it's not the default
        if (nodeId != null && c.type !== 'source') {
          const node = entry.beamline.nodes.find(n => n.id === nodeId);
          if (node) node.type = c.type;
        }
      } else if (idx === 0) {
        // First component but not a source — place a default source first, then this
        const srcId = entry.beamline.placeSource(col, row, dir);
        if (srcId != null) {
          const srcNode = entry.beamline.nodes.find(n => n.id === srcId);
          if (srcNode) this.game.registry.occupyTiles(entry.id, srcNode);
          firstNodeId = srcId;
        }
        // Get cursor for next placement
        const cursors = entry.beamline.getBuildCursors();
        if (cursors.length > 0) {
          nodeId = entry.beamline.placeAt(cursors[0], c.type, bendDir);
          col = cursors[0].col;
          row = cursors[0].row;
        }
      } else {
        const cursors = entry.beamline.getBuildCursors();
        const cursor = cursors.find(cur => cur.col === col && cur.row === row) || cursors[0];
        if (cursor) {
          nodeId = entry.beamline.placeAt(cursor, c.type, bendDir);
        }
      }

      if (nodeId != null) {
        const node = entry.beamline.nodes.find(n => n.id === nodeId);
        if (node) {
          // Apply saved params
          if (c.params) node.params = { ...c.params };
          this.game.registry.occupyTiles(entry.id, node);
          if (!firstNodeId) firstNodeId = nodeId;

          // Advance cursor
          const delta = DIR_DELTA[exitDir];
          const trackLen = comp.trackLength || 1;
          col += delta.dc * trackLen;
          row += delta.dr * trackLen;
          dir = exitDir;
        }
      }
    }

    // Deduct cost
    this.game.state.resources.funding -= this.totalCost;

    // Set as active beamline
    this.game.editingBeamlineId = entry.id;
    this.game.selectedBeamlineId = entry.id;

    this.game.recalcBeamline(entry.id);
    this.game.emit('beamlineChanged');
    this.game.log(`Placed design "${this.design.name}" ($${this.totalCost.toLocaleString()})`, 'good');

    this.cancel();
    return true;
  }
}
```

- [ ] **Step 2: Wire DesignPlacer in src/main.js**

Add import:
```javascript
import { DesignPlacer } from './ui/DesignPlacer.js';
```

After the designLibrary is created, add:
```javascript
  const designPlacer = new DesignPlacer(game, renderer);
  game._designPlacer = designPlacer;

  // Wire "Place" from design library
  designLibrary.onPlace = (design) => {
    designPlacer.start(design);
    game.log('Click to place design. F=rotate, R=reflect, Esc=cancel', 'info');
  };
```

- [ ] **Step 3: Add DesignPlacer input handling to InputHandler**

In `src/input/InputHandler.js`, at the top of the keyboard handler (after the `_designer.isOpen` check at line 91), add:

```javascript
      // Handle DesignPlacer keys
      if (this.game._designPlacer && this.game._designPlacer.active) {
        if (e.key === 'f' || e.key === 'F') {
          this.game._designPlacer.rotate();
          this.renderer.requestRender();
          return;
        }
        if (e.key === 'r' || e.key === 'R') {
          this.game._designPlacer.reflect();
          this.renderer.requestRender();
          return;
        }
        if (e.key === 'Escape') {
          this.game._designPlacer.cancel();
          this.renderer.requestRender();
          return;
        }
      }
```

In the mouse move handler, add position tracking for the placer. Find where mouse position is converted to grid coords (the `_onPointerMove` or equivalent handler) and add:

```javascript
      if (this.game._designPlacer && this.game._designPlacer.active) {
        this.game._designPlacer.setPosition(col, row);
        this.renderer.requestRender();
      }
```

In the click/pointer-up handler, add placement confirmation:

```javascript
      if (this.game._designPlacer && this.game._designPlacer.active) {
        if (this.game._designPlacer.valid) {
          this.game._designPlacer.confirm();
        } else {
          this.game.log('Invalid placement!', 'bad');
        }
        this.renderer.requestRender();
        return;
      }
```

- [ ] **Step 4: Add ghost preview rendering**

In `src/renderer/beamline-renderer.js`, in the `_renderCursor` method (or add a new `_renderDesignPreview` method called from the main render loop), add:

```javascript
Renderer.prototype._renderDesignPreview = function() {
  const placer = this.game._designPlacer;
  if (!placer || !placer.active) return;

  // Clear any previous preview sprites from cursorLayer
  // (or use a dedicated preview container)

  const alpha = placer.valid ? 0.4 : 0.25;
  const tint = placer.valid ? 0x44ff44 : 0xff4444;

  // Draw foundation preview tiles
  for (const ft of placer.foundationTiles) {
    const pos = this.gridToIso(ft.col, ft.row);
    const g = new PIXI.Graphics();
    g.fill({ color: 0x999999, alpha: 0.3 });
    g.moveTo(0, 0);
    g.lineTo(32, 16);
    g.lineTo(0, 32);
    g.lineTo(-32, 16);
    g.closePath();
    g.fill();
    g.x = pos.x;
    g.y = pos.y;
    this.cursorLayer.addChild(g);
  }

  // Draw component preview tiles
  for (const pt of placer.previewTiles) {
    const pos = this.gridToIso(pt.col, pt.row);
    const g = new PIXI.Graphics();
    g.fill({ color: tint, alpha });
    g.moveTo(0, 0);
    g.lineTo(32, 16);
    g.lineTo(0, 32);
    g.lineTo(-32, 16);
    g.closePath();
    g.fill();
    g.x = pos.x;
    g.y = pos.y;
    this.cursorLayer.addChild(g);
  }

  // Cost label near cursor
  if (placer.previewTiles.length > 0) {
    const first = placer.previewTiles[0];
    const pos = this.gridToIso(first.col, first.row);
    const text = new PIXI.Text({
      text: `$${placer.totalCost.toLocaleString()}`,
      style: {
        fontFamily: 'monospace',
        fontSize: 10,
        fill: placer.valid ? '#88ff88' : '#ff8888',
      },
    });
    text.x = pos.x - 20;
    text.y = pos.y - 20;
    this.cursorLayer.addChild(text);
  }
};
```

Then ensure `_renderDesignPreview` is called during the render loop. In the main render method, after `_renderCursor()`, add a call to `this._renderDesignPreview();`.

- [ ] **Step 5: Verify placement works**

Open browser. Save a design. Open Designs, click "Place" on a card. Move mouse over the map — should see green ghost tiles. Press F to rotate, R to reflect. Click to place. Verify beamline appears on map with foundation concrete underneath.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add DesignPlacer with ghost preview, rotate, reflect, auto-foundation"
```

---

### Task 8: Auto-foundation for edit mode beamline growth

**Files:**
- Modify: `src/ui/BeamlineDesigner.js`
- Modify: `src/game/Game.js`

- [ ] **Step 1: Add auto-foundation logic to BeamlineDesigner.confirm()**

In `src/ui/BeamlineDesigner.js`, update the `confirm()` method. After `this._applyDraftToBeamline(entry);` and before `this.game.recalcBeamline(this.beamlineId);`, add:

```javascript
    // Auto-place foundation under any beamline tiles that lack it
    for (const node of entry.beamline.nodes) {
      if (!node.tiles) continue;
      for (const tile of node.tiles) {
        const key = tile.col + ',' + tile.row;
        if (!this.game.state.infraOccupied[key]) {
          // Remove decoration if present
          if (this.game.state.decorationOccupied[key]) {
            this.game.removeDecoration(tile.col, tile.row);
          }
          this.game.state.infrastructure.push({ type: 'concrete', col: tile.col, row: tile.row, variant: 0 });
          this.game.state.infraOccupied[key] = 'concrete';
          // Deduct foundation cost
          const concreteCost = 10; // INFRASTRUCTURE.concrete.cost
          this.game.state.resources.funding -= concreteCost;
        }
      }
    }
```

- [ ] **Step 2: Update _calcCostDelta to include foundation costs**

In `_calcCostDelta()`, after computing the component cost delta, also compute foundation cost for new tiles. Replace the method:

```javascript
  _calcCostDelta() {
    const costOf = (nodes) => nodes.reduce((sum, n) => {
      const comp = COMPONENTS[n.type];
      return sum + (comp && comp.cost ? (comp.cost.funding || 0) : 0);
    }, 0);
    let delta = costOf(this.draftNodes) - costOf(this.originalNodes);

    // In edit mode, include auto-foundation costs for new tiles
    if (this.mode === 'edit' && this.beamlineId) {
      const entry = this.game.registry.get(this.beamlineId);
      if (entry) {
        // Estimate foundation tiles needed for draft nodes
        // This is an approximation — actual tiles depend on placement
        // For now, just return component cost delta
      }
    }
    return delta;
  }
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: auto-place foundation concrete when confirming beamline edits"
```

---

### Task 9: Final integration and polish

**Files:**
- Modify: `src/main.js`
- Modify: `src/renderer/Renderer.js`

- [ ] **Step 1: Ensure design preview renders in render loop**

In `src/renderer/Renderer.js`, find the main render method and add after cursor rendering:

```javascript
    this._renderDesignPreview();
```

If `_renderDesignPreview` is defined in `beamline-renderer.js` as a prototype extension, ensure it's available by the time the render loop runs. Since `beamline-renderer.js` is imported after `Renderer.js` in `main.js`, this will work.

- [ ] **Step 2: Add the `requestRender` method if it doesn't exist**

Check if `Renderer` has a `requestRender` method. If not, add to `src/renderer/Renderer.js`:

```javascript
  requestRender() {
    // Force a re-render on next frame
    this.render();
  }
```

Or if the renderer uses an animation loop that already re-renders every frame, the InputHandler just needs to mark the state dirty and the existing loop handles it. In that case, `requestRender` is a no-op or just sets a dirty flag.

- [ ] **Step 3: Test full workflow**

1. Click "Beamline Designer" — blank designer opens in design mode
2. Add components from the palette, tune parameters, see plots update
3. Click "Save Design" — prompted for name, saves to library
4. Close designer, click "Designs" — card appears with mini schematic
5. Click "Edit" on card — designer opens with that design loaded
6. Modify, click "Save" — overwrites existing design
7. Click "Save As" — creates new copy
8. Click "Place" on a card — ghost preview on map, F to rotate, R to reflect
9. Click to place — beamline created with auto-foundation
10. Click on placed beamline, click "Designer" — opens in edit mode with Confirm/Cancel
11. Add components that extend beyond concrete pad — confirm, foundation auto-placed
12. Click "Save as Design" from edit mode — design saved to library

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: integrate DesignPlacer rendering and final polish"
```
