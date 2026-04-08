# Beamline Controller View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-screen 2D "controller" view for inspecting and editing beamlines with live physics preview, draft mode, and synchronized schematic/plot pan-zoom.

**Architecture:** A DOM overlay (`#controller-overlay`) with three canvas-based zones: schematic strip (reuses `_schematicDrawers`), dynamics plots (reuses `ProbePlots`), and the existing bottom HUD palette. A draft state manager clones the beamline node list and runs physics on edits without committing changes until the player confirms.

**Tech Stack:** Vanilla JS, HTML5 Canvas 2D, existing Pyodide-based BeamPhysics engine, existing ProbePlots renderers, existing _schematicDrawers pixel art.

**Spec:** `docs/superpowers/specs/2026-04-08-beamline-controller-view-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| **Create:** `src/ui/ControllerView.js` | Main controller class — DOM setup, draft state, entry/exit, keyboard/mouse events, cost tracking, confirm/cancel |
| **Create:** `src/renderer/controller-renderer.js` | Schematic canvas rendering, per-component drawing, selection highlight, synchronized viewport, plot panel wiring |
| **Modify:** `src/ui/BeamlineWindow.js` | Add "Controller" button to actions row |
| **Modify:** `src/input/InputHandler.js` | Add `C` key shortcut, suppress normal keys when controller is open |
| **Modify:** `src/main.js` | Wire up ControllerView instance |
| **Modify:** `index.html` | Add `#controller-overlay` DOM skeleton |
| **Modify:** `style.css` | Controller overlay layout CSS |

---

### Task 1: DOM Skeleton & CSS Layout

**Files:**
- Modify: `index.html` (add overlay div before closing `</div>` of `#game`, around line 145)
- Modify: `style.css` (append controller overlay styles)

- [ ] **Step 1: Add controller overlay HTML to index.html**

Add this block after the `#component-popup` div (around line 143) and before `<div id="context-windows-container">`:

```html
<!-- Beamline Controller View (full-screen, hidden by default) -->
<div id="controller-overlay" class="controller-overlay hidden">
  <div class="ctrl-header">
    <span class="ctrl-title">Beamline Controller</span>
    <div class="ctrl-draft-bar">
      <span class="ctrl-draft-summary" id="ctrl-draft-summary"></span>
      <span class="ctrl-draft-cost" id="ctrl-draft-cost"></span>
      <button class="ctrl-btn ctrl-confirm" id="ctrl-confirm">Confirm</button>
      <button class="ctrl-btn ctrl-cancel" id="ctrl-cancel">Cancel</button>
    </div>
    <button class="overlay-close" id="ctrl-close">&times;</button>
  </div>
  <div class="ctrl-body">
    <div class="ctrl-schematic-row">
      <canvas id="ctrl-schematic-canvas"></canvas>
    </div>
    <div class="ctrl-plots-row">
      <div class="ctrl-plot-panel">
        <select class="ctrl-plot-select" data-panel="0">
          <option value="beam-envelope" selected>Beam Envelope</option>
          <option value="current-loss">Current &amp; Loss</option>
          <option value="emittance">Emittance</option>
          <option value="energy-dispersion">Energy &amp; Dispersion</option>
          <option value="peak-current">Peak Current</option>
          <option value="phase-space">Phase Space</option>
          <option value="longitudinal">Longitudinal PS</option>
        </select>
        <canvas class="ctrl-plot-canvas" data-panel="0"></canvas>
      </div>
      <div class="ctrl-plot-panel">
        <select class="ctrl-plot-select" data-panel="1">
          <option value="beam-envelope">Beam Envelope</option>
          <option value="current-loss">Current &amp; Loss</option>
          <option value="emittance" selected>Emittance</option>
          <option value="energy-dispersion">Energy &amp; Dispersion</option>
          <option value="peak-current">Peak Current</option>
          <option value="phase-space">Phase Space</option>
          <option value="longitudinal">Longitudinal PS</option>
        </select>
        <canvas class="ctrl-plot-canvas" data-panel="1"></canvas>
      </div>
      <div class="ctrl-plot-panel">
        <select class="ctrl-plot-select" data-panel="2">
          <option value="beam-envelope">Beam Envelope</option>
          <option value="current-loss">Current &amp; Loss</option>
          <option value="emittance">Emittance</option>
          <option value="energy-dispersion">Energy &amp; Dispersion</option>
          <option value="peak-current">Peak Current</option>
          <option value="phase-space" selected>Phase Space</option>
          <option value="longitudinal">Longitudinal PS</option>
        </select>
        <canvas class="ctrl-plot-canvas" data-panel="2"></canvas>
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add controller CSS to style.css**

Append to the end of `style.css`:

```css
/* === BEAMLINE CONTROLLER OVERLAY === */
.controller-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 250;
  background: rgba(8, 8, 20, 0.98);
  display: flex;
  flex-direction: column;
}
.controller-overlay.hidden {
  display: none;
}

.ctrl-header {
  display: flex;
  align-items: center;
  padding: 6px 12px;
  border-bottom: 1px solid rgba(80, 80, 120, 0.3);
  gap: 12px;
  flex-shrink: 0;
}
.ctrl-title {
  font-size: 11px;
  color: #aaccff;
  font-family: 'Press Start 2P', monospace;
}
.ctrl-draft-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
  margin-right: 8px;
}
.ctrl-draft-summary {
  font-size: 10px;
  color: #888;
  font-family: monospace;
}
.ctrl-draft-cost {
  font-size: 10px;
  font-family: monospace;
  font-weight: bold;
}
.ctrl-btn {
  font-family: 'Press Start 2P', monospace;
  font-size: 9px;
  padding: 4px 10px;
  border: 1px solid rgba(100, 100, 160, 0.4);
  border-radius: 3px;
  cursor: pointer;
  background: rgba(30, 30, 60, 0.8);
}
.ctrl-confirm {
  color: #88ff88;
  border-color: rgba(80, 180, 80, 0.4);
}
.ctrl-confirm:hover {
  background: rgba(40, 80, 40, 0.6);
}
.ctrl-cancel {
  color: #ff8888;
  border-color: rgba(180, 80, 80, 0.4);
}
.ctrl-cancel:hover {
  background: rgba(80, 40, 40, 0.6);
}

.ctrl-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.ctrl-schematic-row {
  flex: 1;
  position: relative;
  border-bottom: 1px solid rgba(80, 80, 120, 0.2);
  min-height: 0;
}
.ctrl-schematic-row canvas {
  width: 100%;
  height: 100%;
  display: block;
}
.ctrl-plots-row {
  flex: 1;
  display: flex;
  gap: 2px;
  border-bottom: 1px solid rgba(80, 80, 120, 0.2);
  min-height: 0;
}
.ctrl-plot-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  min-width: 0;
}
.ctrl-plot-select {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 10;
  font-family: monospace;
  font-size: 9px;
  background: rgba(20, 20, 40, 0.85);
  color: #aaa;
  border: 1px solid rgba(80, 80, 120, 0.3);
  border-radius: 3px;
  padding: 2px 4px;
}
.ctrl-plot-canvas {
  width: 100%;
  height: 100%;
  display: block;
}
```

- [ ] **Step 3: Verify the overlay appears**

Open the browser dev tools, find `#controller-overlay`, and manually remove the `hidden` class. Confirm the overlay fills the screen with the dark background and has the header, two rows, and three plot panels laid out.

- [ ] **Step 4: Commit**

```bash
git add index.html style.css
git commit -m "feat(controller): add DOM skeleton and CSS layout for controller overlay"
```

---

### Task 2: ControllerView Class — Core Lifecycle

**Files:**
- Create: `src/ui/ControllerView.js`

This task creates the ControllerView class with open/close, draft state cloning, and cost tracking — no rendering yet.

- [ ] **Step 1: Create ControllerView.js**

```js
// src/ui/ControllerView.js — Beamline Controller View
// Full-screen 2D view for inspecting and editing a beamline with live physics preview.

import { COMPONENTS } from '../data/components.js';
import { BeamPhysics } from '../beamline/physics.js';
import { PARAM_DEFS } from '../beamline/component-physics.js';

export class ControllerView {
  constructor(game, renderer) {
    this.game = game;
    this.renderer = renderer;
    this.isOpen = false;
    this.beamlineId = null;

    // Draft state
    this.draftNodes = [];       // cloned ordered node list
    this.originalNodes = [];    // snapshot for diffing
    this.draftEnvelope = null;  // physics result for draft
    this.selectedIndex = -1;    // index into draftNodes

    // Viewport (shared between schematic and along-s plots)
    this.viewX = 0;             // horizontal pan offset in beamline-meters
    this.viewZoom = 1;          // zoom level (1 = fit-all)
    this.totalLength = 0;       // total beamline length in meters

    // Focus row: 0 = schematic, 1 = plots, 2 = palette
    this.focusRow = 0;

    // DOM references
    this.overlay = document.getElementById('controller-overlay');
    this.summaryEl = document.getElementById('ctrl-draft-summary');
    this.costEl = document.getElementById('ctrl-draft-cost');

    this._bindButtons();
  }

  _bindButtons() {
    document.getElementById('ctrl-confirm').addEventListener('click', () => this.confirm());
    document.getElementById('ctrl-cancel').addEventListener('click', () => this.cancel());
    document.getElementById('ctrl-close').addEventListener('click', () => this.close());
  }

  // --- Open / Close ---

  open(beamlineId) {
    const entry = this.game.registry.get(beamlineId);
    if (!entry) return;

    this.beamlineId = beamlineId;
    this.isOpen = true;

    // Clone the ordered node list for draft editing
    const ordered = entry.beamline.getOrderedComponents();
    this.originalNodes = ordered.map(n => this._cloneNode(n));
    this.draftNodes = ordered.map(n => this._cloneNode(n));
    this.selectedIndex = this.draftNodes.length > 0 ? 0 : -1;
    this.focusRow = 0;

    // Compute total length
    this._updateTotalLength();

    // Run initial physics on draft
    this._recalcDraft();

    // Show overlay
    this.overlay.classList.remove('hidden');

    // Update draft bar
    this._updateDraftBar();

    // Trigger initial render
    this._renderAll();
  }

  close() {
    if (!this.isOpen) return;

    // Check for unsaved changes
    if (this._hasDraftChanges() && !confirm('Discard unsaved changes?')) {
      return;
    }

    this._cleanup();
  }

  confirm() {
    if (!this.isOpen) return;
    const entry = this.game.registry.get(this.beamlineId);
    if (!entry) { this._cleanup(); return; }

    // Calculate cost delta and check funding
    const costDelta = this._calcCostDelta();
    if (costDelta > 0 && this.game.state.resources.funding < costDelta) {
      // Not enough funding
      this.game.log('Not enough funding for these changes!', 'bad');
      return;
    }

    // Deduct cost
    if (costDelta !== 0) {
      this.game.state.resources.funding -= costDelta;
    }

    // Apply draft nodes to the real beamline
    this._applyDraftToBeamline(entry);

    // Recalculate real physics
    this.game.recalcBeamline(this.beamlineId);
    this.game.emit('beamlineChanged');

    this._cleanup();
  }

  cancel() {
    if (!this.isOpen) return;

    if (this._hasDraftChanges() && !confirm('Discard unsaved changes?')) {
      return;
    }

    this._cleanup();
  }

  _cleanup() {
    this.isOpen = false;
    this.beamlineId = null;
    this.draftNodes = [];
    this.originalNodes = [];
    this.draftEnvelope = null;
    this.selectedIndex = -1;
    this.overlay.classList.add('hidden');
  }

  // --- Draft operations ---

  replaceComponent(index, newType) {
    if (index < 0 || index >= this.draftNodes.length) return;
    const comp = COMPONENTS[newType];
    if (!comp) return;

    const node = this.draftNodes[index];
    node.type = newType;
    // Reset params for new type
    node.params = {};
    if (PARAM_DEFS[newType]) {
      for (const [k, def] of Object.entries(PARAM_DEFS[newType])) {
        if (!def.derived) node.params[k] = def.default;
      }
    }
    if (comp.params) {
      for (const [k, v] of Object.entries(comp.params)) {
        if (!(k in node.params)) node.params[k] = v;
      }
    }
    node.computedStats = null;

    this._updateTotalLength();
    this._recalcDraft();
    this._updateDraftBar();
    this._renderAll();
  }

  insertComponent(index, type, position) {
    const comp = COMPONENTS[type];
    if (!comp) return;

    const newNode = {
      id: -Date.now(),  // temporary negative ID for draft
      type: type,
      col: 0, row: 0, dir: 0, entryDir: 0,
      parentId: null, bendDir: null, tiles: [],
      params: {},
      computedStats: null,
    };
    if (PARAM_DEFS[type]) {
      for (const [k, def] of Object.entries(PARAM_DEFS[type])) {
        if (!def.derived) newNode.params[k] = def.default;
      }
    }
    if (comp.params) {
      for (const [k, v] of Object.entries(comp.params)) {
        if (!(k in newNode.params)) newNode.params[k] = v;
      }
    }

    const insertIdx = position === 'before' ? index : index + 1;
    this.draftNodes.splice(insertIdx, 0, newNode);
    this.selectedIndex = insertIdx;

    this._updateTotalLength();
    this._recalcDraft();
    this._updateDraftBar();
    this._renderAll();
  }

  removeComponent(index) {
    if (index < 0 || index >= this.draftNodes.length) return;
    this.draftNodes.splice(index, 1);
    if (this.selectedIndex >= this.draftNodes.length) {
      this.selectedIndex = this.draftNodes.length - 1;
    }

    this._updateTotalLength();
    this._recalcDraft();
    this._updateDraftBar();
    this._renderAll();
  }

  // --- Selection / Navigation ---

  selectNext() {
    if (this.draftNodes.length === 0) return;
    this.selectedIndex = Math.min(this.selectedIndex + 1, this.draftNodes.length - 1);
    this._renderAll();
  }

  selectPrev() {
    if (this.draftNodes.length === 0) return;
    this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
    this._renderAll();
  }

  focusRowUp() {
    this.focusRow = Math.max(this.focusRow - 1, 0);
  }

  focusRowDown() {
    this.focusRow = Math.min(this.focusRow + 1, 2);
  }

  // --- Pan / Zoom ---

  panLeft() { this.viewX -= 2 / this.viewZoom; this._renderAll(); }
  panRight() { this.viewX += 2 / this.viewZoom; this._renderAll(); }

  zoomAt(delta, cursorFraction) {
    const oldZoom = this.viewZoom;
    this.viewZoom = Math.max(0.5, Math.min(10, this.viewZoom * (1 - delta * 0.001)));
    // Keep cursor position stable
    const viewWidth = this.totalLength / this.viewZoom;
    this.viewX += (cursorFraction * this.totalLength / oldZoom) - (cursorFraction * viewWidth);
    this._renderAll();
  }

  // --- Internal helpers ---

  _cloneNode(node) {
    return {
      id: node.id,
      type: node.type,
      col: node.col,
      row: node.row,
      dir: node.dir,
      entryDir: node.entryDir,
      parentId: node.parentId,
      bendDir: node.bendDir,
      tiles: node.tiles ? node.tiles.map(t => ({ ...t })) : [],
      params: node.params ? { ...node.params } : {},
      computedStats: node.computedStats ? { ...node.computedStats } : null,
    };
  }

  _updateTotalLength() {
    this.totalLength = 0;
    for (const node of this.draftNodes) {
      const comp = COMPONENTS[node.type];
      if (comp) this.totalLength += comp.length;
    }
    if (this.totalLength === 0) this.totalLength = 1;
  }

  _recalcDraft() {
    if (this.draftNodes.length === 0) {
      this.draftEnvelope = null;
      return;
    }

    // Build physics beamline from draft nodes (same format as Game.recalcBeamline)
    const physicsBeamline = this.draftNodes.map(node => {
      const comp = COMPONENTS[node.type];
      if (!comp) return null;
      const effectiveStats = { ...(comp.stats || {}) };
      if (node.computedStats) {
        Object.assign(effectiveStats, node.computedStats);
      }
      const el = {
        type: node.type,
        length: comp.length,
        stats: effectiveStats,
        params: node.params || {},
      };
      if (comp.extractionEnergy !== undefined) {
        el.extractionEnergy = comp.extractionEnergy;
      }
      return el;
    }).filter(Boolean);

    // Gather research effects
    const researchEffects = {};
    for (const key of ['luminosityMult', 'dataRateMult', 'energyCostMult', 'discoveryChance',
                        'vacuumQuality', 'beamStability', 'photonFluxMult', 'cryoEfficiencyMult',
                        'beamLifetimeMult', 'diagnosticPrecision']) {
      const v = this.game.getEffect(key, key.endsWith('Mult') ? 1 : 0);
      researchEffects[key] = v;
    }
    const entry = this.game.registry.get(this.beamlineId);
    if (entry) researchEffects.machineType = entry.beamState.machineType;

    const result = BeamPhysics.compute(physicsBeamline, researchEffects);
    this.draftEnvelope = result ? result.envelope : null;
  }

  _hasDraftChanges() {
    if (this.draftNodes.length !== this.originalNodes.length) return true;
    for (let i = 0; i < this.draftNodes.length; i++) {
      if (this.draftNodes[i].type !== this.originalNodes[i].type) return true;
      if (this.draftNodes[i].id !== this.originalNodes[i].id) return true;
    }
    return false;
  }

  _calcCostDelta() {
    const costOf = (nodes) => nodes.reduce((sum, n) => {
      const comp = COMPONENTS[n.type];
      return sum + (comp && comp.cost ? (comp.cost.funding || 0) : 0);
    }, 0);

    return costOf(this.draftNodes) - costOf(this.originalNodes);
  }

  _updateDraftBar() {
    // Count changes
    let added = 0, removed = 0, replaced = 0;
    const origIds = new Set(this.originalNodes.map(n => n.id));
    const draftIds = new Set(this.draftNodes.map(n => n.id));

    for (const n of this.draftNodes) {
      if (!origIds.has(n.id)) added++;
      else {
        const orig = this.originalNodes.find(o => o.id === n.id);
        if (orig && orig.type !== n.type) replaced++;
      }
    }
    for (const n of this.originalNodes) {
      if (!draftIds.has(n.id)) removed++;
    }

    const parts = [];
    if (added > 0) parts.push(`+${added} added`);
    if (removed > 0) parts.push(`${removed} removed`);
    if (replaced > 0) parts.push(`${replaced} replaced`);

    this.summaryEl.textContent = parts.length > 0 ? parts.join(', ') : 'No changes';

    const costDelta = this._calcCostDelta();
    if (costDelta > 0) {
      this.costEl.textContent = `+$${costDelta.toLocaleString()}`;
      this.costEl.style.color = '#ff8888';
    } else if (costDelta < 0) {
      this.costEl.textContent = `-$${Math.abs(costDelta).toLocaleString()}`;
      this.costEl.style.color = '#88ff88';
    } else {
      this.costEl.textContent = '$0';
      this.costEl.style.color = '#888';
    }
  }

  _applyDraftToBeamline(entry) {
    // Replace the beamline's node list with the draft.
    // For now, rebuild the node array from draft.
    // This is a simplified approach — it replaces the full node list.
    // Grid tile positions will need to be recalculated by the isometric renderer.
    const bl = entry.beamline;
    
    // Free all existing tiles
    for (const node of bl.nodes) {
      bl._freeTiles(node.tiles);
    }
    
    // Replace nodes with draft (keeping grid positions from originals where possible)
    bl.nodes = this.draftNodes.map(n => this._cloneNode(n));
    
    // Re-occupy tiles for nodes that have valid tile data
    for (const node of bl.nodes) {
      if (node.tiles && node.tiles.length > 0) {
        bl._occupyTiles(node.tiles, node.id);
      }
    }
  }

  // --- Rendering (placeholder — filled in by controller-renderer.js) ---

  _renderAll() {
    // Will be replaced by controller-renderer.js extension
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/ControllerView.js
git commit -m "feat(controller): add ControllerView class with draft state and lifecycle"
```

---

### Task 3: Controller Renderer — Schematic Canvas

**Files:**
- Create: `src/renderer/controller-renderer.js`

This task implements the schematic strip rendering — drawing each component left-to-right using the existing `_schematicDrawers`, with selection highlight and beam dashes connecting them.

- [ ] **Step 1: Create controller-renderer.js**

```js
// src/renderer/controller-renderer.js — Schematic and plot rendering for controller view
// Extends ControllerView.prototype with canvas rendering methods.

import { ControllerView } from '../ui/ControllerView.js';
import { COMPONENTS } from '../data/components.js';
import { Renderer } from './Renderer.js';
import { ProbePlots } from '../ui/probe-plots.js';

// Schematic pixel dimensions per component (same as overlays.js drawSchematic)
const SCHEM_PW = 70;
const SCHEM_PH = 30;

// Gap between components in pixels (at base zoom)
const COMP_GAP = 4;

// ---- Schematic rendering ----

ControllerView.prototype._renderAll = function() {
  if (!this.isOpen) return;
  this._renderSchematic();
  this._renderPlots();
};

ControllerView.prototype._renderSchematic = function() {
  const canvas = document.getElementById('ctrl-schematic-canvas');
  if (!canvas) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (this.draftNodes.length === 0) {
    ctx.fillStyle = 'rgba(100, 100, 150, 0.5)';
    ctx.font = '14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('No components — add from palette below', canvas.width / 2, canvas.height / 2);
    return;
  }

  // Calculate per-component pixel widths based on length, scaled by zoom
  const compWidths = this.draftNodes.map(n => {
    const comp = COMPONENTS[n.type];
    const len = comp ? comp.length : 1;
    return Math.max(SCHEM_PW, Math.round(len * SCHEM_PW / 5));
  });
  const totalPixelWidth = compWidths.reduce((s, w) => s + w + COMP_GAP, -COMP_GAP);

  // Auto-fit zoom if viewZoom is 1 (initial)
  const viewWidthPx = canvas.width / dpr;
  const baseZoom = viewWidthPx / (totalPixelWidth + 40);
  const effectiveZoom = this.viewZoom * baseZoom;

  // Calculate pan offset in pixels
  const panOffsetPx = -this.viewX * effectiveZoom;

  // Vertical center
  const centerY = (canvas.height / dpr) / 2;
  const schematicH = SCHEM_PH * effectiveZoom;

  ctx.save();
  ctx.scale(dpr, dpr);

  // Draw beam dashes across full width (background)
  const beamY = centerY;
  ctx.strokeStyle = 'rgba(34, 136, 85, 0.3)';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(0, beamY);
  ctx.lineTo(viewWidthPx, beamY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw each component
  let xPos = 20 + panOffsetPx;  // start with left margin
  // Store component regions for click detection
  this._compRegions = [];

  for (let i = 0; i < this.draftNodes.length; i++) {
    const node = this.draftNodes[i];
    const compW = compWidths[i] * effectiveZoom;
    const compH = schematicH;

    // Store region for click detection
    this._compRegions.push({
      x: xPos,
      y: centerY - compH / 2,
      w: compW,
      h: compH,
      index: i,
    });

    // Draw component using existing schematic drawer
    const offscreen = this._drawComponentOffscreen(node.type);
    if (offscreen) {
      ctx.drawImage(offscreen, xPos, centerY - compH / 2, compW, compH);
    }

    // Selection highlight
    if (i === this.selectedIndex) {
      ctx.strokeStyle = '#4488ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(xPos - 1, centerY - compH / 2 - 1, compW + 2, compH + 2);

      // Component name label
      ctx.fillStyle = '#aaccff';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      const comp = COMPONENTS[node.type];
      ctx.fillText(comp ? comp.name : node.type, xPos + compW / 2, centerY - compH / 2 - 6);
    }

    // Beam dash connector to next component
    if (i < this.draftNodes.length - 1) {
      ctx.strokeStyle = '#228855';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.moveTo(xPos + compW, beamY);
      ctx.lineTo(xPos + compW + COMP_GAP * effectiveZoom, beamY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    xPos += compW + COMP_GAP * effectiveZoom;
  }

  // Store total rendered width for viewport calculations
  this._renderedWidth = xPos - 20 - panOffsetPx;

  ctx.restore();
};

ControllerView.prototype._drawComponentOffscreen = function(componentType) {
  // Cache offscreen canvases per component type
  if (!this._schematicCache) this._schematicCache = {};
  if (this._schematicCache[componentType]) return this._schematicCache[componentType];

  // Use the Renderer's drawSchematic to generate the pixel art
  const off = document.createElement('canvas');
  off.width = SCHEM_PW;
  off.height = SCHEM_PH;
  this.renderer.drawSchematic(off, componentType);

  // drawSchematic scales up — we want the raw pixels, so draw at native resolution
  const raw = document.createElement('canvas');
  raw.width = SCHEM_PW;
  raw.height = SCHEM_PH;
  const rctx = raw.getContext('2d');
  rctx.imageSmoothingEnabled = false;

  // drawSchematic draws at the canvas's displayed size, so we create a tiny canvas
  const tiny = document.createElement('canvas');
  tiny.width = SCHEM_PW;
  tiny.height = SCHEM_PH;
  // Set clientWidth/clientHeight via style so drawSchematic scales to our size
  tiny.style.width = SCHEM_PW + 'px';
  tiny.style.height = SCHEM_PH + 'px';
  this.renderer.drawSchematic(tiny, componentType);

  this._schematicCache[componentType] = tiny;
  return tiny;
};

// ---- Plot rendering ----

ControllerView.prototype._renderPlots = function() {
  const panels = document.querySelectorAll('.ctrl-plot-panel');
  panels.forEach((panel) => {
    const select = panel.querySelector('.ctrl-plot-select');
    const canvas = panel.querySelector('.ctrl-plot-canvas');
    if (!select || !canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = panel.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = (rect.height - 28) * dpr;  // account for select dropdown height

    const plotType = select.value;
    const envelope = this.draftEnvelope;

    if (!envelope || envelope.length < 2) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(5, 5, 20, 0.6)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(100, 100, 150, 0.5)';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No beam data', canvas.width / 2, canvas.height / 2);
      return;
    }

    // Build a mock pin for "at-a-point" plots at the selected component
    const pins = [];
    if (this.selectedIndex >= 0 && this.selectedIndex < envelope.length) {
      pins.push({
        elementIndex: this.selectedIndex,
        color: '#4488ff',
      });
    }

    ProbePlots.draw(canvas, plotType, envelope, pins, 0);
  });
};

// ---- Click detection on schematic ----

ControllerView.prototype._hitTestSchematic = function(clientX, clientY) {
  const canvas = document.getElementById('ctrl-schematic-canvas');
  if (!canvas || !this._compRegions) return -1;

  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;

  for (const region of this._compRegions) {
    if (x >= region.x && x <= region.x + region.w &&
        y >= region.y && y <= region.y + region.h) {
      return region.index;
    }
  }
  return -1;
};
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/controller-renderer.js
git commit -m "feat(controller): add schematic and plot canvas rendering"
```

---

### Task 4: Wire Up Events — Keyboard, Mouse, Plot Selectors

**Files:**
- Modify: `src/ui/ControllerView.js` (add event binding methods)

This task adds all interactive behavior: keyboard navigation (arrow keys for selection, WASD for pan, Delete for remove), mouse click on schematic, mousewheel zoom, plot selector dropdowns, and palette click handling in draft mode.

- [ ] **Step 1: Add event binding to ControllerView constructor**

In `src/ui/ControllerView.js`, add to the end of the constructor (after `this._bindButtons();`):

```js
    this._bindEvents();
```

- [ ] **Step 2: Add _bindEvents method to ControllerView**

Add this method to the ControllerView class, after the `_bindButtons()` method:

```js
  _bindEvents() {
    // Keyboard handler (only active when controller is open)
    this._onKeyDown = (e) => {
      if (!this.isOpen) return;
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          e.stopPropagation();
          this.selectPrev();
          break;
        case 'ArrowRight':
          e.preventDefault();
          e.stopPropagation();
          this.selectNext();
          break;
        case 'ArrowUp':
          e.preventDefault();
          e.stopPropagation();
          this.focusRowUp();
          break;
        case 'ArrowDown':
          e.preventDefault();
          e.stopPropagation();
          this.focusRowDown();
          break;
        case 'a': case 'A':
          e.preventDefault();
          e.stopPropagation();
          this.panLeft();
          break;
        case 'd': case 'D':
          e.preventDefault();
          e.stopPropagation();
          this.panRight();
          break;
        case 'Delete': case 'Backspace':
          e.preventDefault();
          e.stopPropagation();
          this.removeComponent(this.selectedIndex);
          break;
        case 'Escape':
          e.preventDefault();
          e.stopPropagation();
          this.close();
          break;
        case 'c': case 'C':
          e.preventDefault();
          e.stopPropagation();
          this.close();
          break;
      }
    };
    // Use capture phase so we intercept before InputHandler
    window.addEventListener('keydown', this._onKeyDown, true);

    // Schematic click
    const schematicCanvas = document.getElementById('ctrl-schematic-canvas');
    if (schematicCanvas) {
      schematicCanvas.addEventListener('click', (e) => {
        if (!this.isOpen) return;
        const idx = this._hitTestSchematic(e.clientX, e.clientY);
        if (idx >= 0) {
          this.selectedIndex = idx;
          this._renderAll();
        }
      });

      // Mouse drag panning on schematic
      let dragging = false;
      let dragStartX = 0;
      let dragStartViewX = 0;
      schematicCanvas.addEventListener('mousedown', (e) => {
        if (!this.isOpen) return;
        dragging = true;
        dragStartX = e.clientX;
        dragStartViewX = this.viewX;
      });
      window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - dragStartX;
        this.viewX = dragStartViewX - dx / (this.viewZoom * 2);
        this._renderAll();
      });
      window.addEventListener('mouseup', () => { dragging = false; });

      // Mousewheel zoom
      schematicCanvas.addEventListener('wheel', (e) => {
        if (!this.isOpen) return;
        e.preventDefault();
        const rect = schematicCanvas.getBoundingClientRect();
        const fraction = (e.clientX - rect.left) / rect.width;
        this.zoomAt(e.deltaY, fraction);
      }, { passive: false });
    }

    // Plot selector dropdowns — re-render on change
    document.querySelectorAll('.ctrl-plot-select').forEach(select => {
      select.addEventListener('change', () => {
        if (this.isOpen) this._renderPlots();
      });
    });

    // Mousewheel on plot canvases (sync zoom with schematic)
    document.querySelectorAll('.ctrl-plot-canvas').forEach(canvas => {
      canvas.addEventListener('wheel', (e) => {
        if (!this.isOpen) return;
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const fraction = (e.clientX - rect.left) / rect.width;
        this.zoomAt(e.deltaY, fraction);
      }, { passive: false });
    });

    // Stop propagation on overlay to prevent game input underneath
    this.overlay.addEventListener('mousedown', (e) => e.stopPropagation());
    this.overlay.addEventListener('wheel', (e) => e.stopPropagation(), { passive: false });
  }
```

- [ ] **Step 3: Commit**

```bash
git add src/ui/ControllerView.js
git commit -m "feat(controller): add keyboard, mouse, and zoom event handling"
```

---

### Task 5: Entry Points — BeamlineWindow Button & C Key Shortcut

**Files:**
- Modify: `src/ui/BeamlineWindow.js:117-149` (add Controller button to actions)
- Modify: `src/input/InputHandler.js:82-239` (add C key handling, skip when controller open)
- Modify: `src/main.js` (instantiate ControllerView, import controller-renderer)

- [ ] **Step 1: Add Controller button to BeamlineWindow**

In `src/ui/BeamlineWindow.js`, in the `_updateActions()` method, add a new action object to the array passed to `this.ctx.setActions()`. The existing array starts at line 117. Add this after the existing `Edit` action (around line 138):

```js
      {
        label: 'Controller',
        onClick: () => {
          if (this.game._controllerView) {
            this.game._controllerView.open(this.beamlineId);
          }
        },
      },
```

So the full `setActions` call becomes (showing the new entry among existing ones):

```js
    this.ctx.setActions([
      {
        label: isRunning ? 'Stop Beam' : 'Start Beam',
        style: isRunning ? 'color:#f88' : 'color:#8f8',
        onClick: () => {
          this.game.toggleBeam(this.beamlineId);
          this._updateStatus();
          this._updateActions();
          this.ctx.update();
        },
      },
      {
        label: 'Controller',
        onClick: () => {
          if (this.game._controllerView) {
            this.game._controllerView.open(this.beamlineId);
          }
        },
      },
      {
        label: 'Edit',
        onClick: () => {
          if (this.game.editingBeamlineId === this.beamlineId) {
            this.game.editingBeamlineId = null;
          } else {
            this.game.editingBeamlineId = this.beamlineId;
            this.game.selectedBeamlineId = this.beamlineId;
          }
        },
      },
      {
        label: 'Rename',
        onClick: () => {
          const newName = prompt('Enter new name:', entry.name);
          if (newName && newName.trim()) {
            entry.name = newName.trim();
            this.ctx.setTitle(entry.name);
          }
        },
      },
    ]);
```

- [ ] **Step 2: Add C key shortcut to InputHandler**

In `src/input/InputHandler.js`, inside the `_bindKeyboard()` method's `keydown` handler, add a case for `c`/`C` in the switch statement (after the `'p': case 'P':` block, around line 216):

```js
        case 'c': case 'C':
          if (this.game._controllerView && !this.game._controllerView.isOpen) {
            const blId = this.game.selectedBeamlineId || this.game.editingBeamlineId;
            if (blId) {
              e.preventDefault();
              this.game._controllerView.open(blId);
            }
          }
          break;
```

Also, at the very top of the `keydown` handler (after the `if (tag === 'INPUT' || tag === 'TEXTAREA') return;` check on line 86), add an early return when the controller is open:

```js
      // Skip normal input handling when controller overlay is open
      if (this.game._controllerView && this.game._controllerView.isOpen) return;
```

- [ ] **Step 3: Wire up ControllerView in main.js**

In `src/main.js`, add the import near the top (after the existing imports around line 17):

```js
import { ControllerView } from './ui/ControllerView.js';
import './renderer/controller-renderer.js';
```

Then after the `const input = new InputHandler(renderer, game);` line (line 47), add:

```js
  const controllerView = new ControllerView(game, renderer);
  game._controllerView = controllerView;
```

- [ ] **Step 4: Verify the full flow**

1. Open the game in the browser
2. Place a source and a few components on a beamline
3. Click the beamline to select it
4. Press `C` — the controller overlay should open showing the schematic strip
5. Use Left/Right arrows to select components
6. Use A/D to pan, mousewheel to zoom
7. Press `Esc` to close
8. Also verify the "Controller" button appears in the BeamlineWindow

- [ ] **Step 5: Commit**

```bash
git add src/ui/BeamlineWindow.js src/input/InputHandler.js src/main.js
git commit -m "feat(controller): wire up entry points — C key shortcut and BeamlineWindow button"
```

---

### Task 6: Palette Integration — Replace & Insert from Bottom HUD

**Files:**
- Modify: `src/ui/ControllerView.js` (add palette click interception)

When the controller is open and a component is selected in the schematic, clicking a palette item should replace that component in the draft (default action). We also need Insert Before/After buttons in the header when a component is selected.

- [ ] **Step 1: Add insert buttons to the controller header in index.html**

In `index.html`, inside the `.ctrl-draft-bar` div, add insert action buttons before the Confirm/Cancel buttons:

```html
      <button class="ctrl-btn ctrl-insert-before" id="ctrl-insert-before" title="Insert Before Selected">+ Before</button>
      <button class="ctrl-btn ctrl-insert-after" id="ctrl-insert-after" title="Insert After Selected">+ After</button>
```

- [ ] **Step 2: Add palette interception to ControllerView**

In `src/ui/ControllerView.js`, add these properties to the constructor (after `this.focusRow = 0;`):

```js
    // Insert mode: null, 'before', or 'after'
    this.insertMode = null;
```

Add this method to the class:

```js
  handlePaletteClick(componentType) {
    if (!this.isOpen) return false;  // not handled
    const comp = COMPONENTS[componentType];
    if (!comp) return false;

    if (this.insertMode) {
      // Insert mode — add new component
      const idx = this.selectedIndex >= 0 ? this.selectedIndex : this.draftNodes.length - 1;
      this.insertComponent(idx, componentType, this.insertMode);
      this.insertMode = null;
      return true;
    }

    if (this.selectedIndex >= 0) {
      // Default: replace selected component
      this.replaceComponent(this.selectedIndex, componentType);
      return true;
    }

    return false;
  }
```

Extend `_bindButtons()` to include the insert buttons:

```js
  _bindButtons() {
    document.getElementById('ctrl-confirm').addEventListener('click', () => this.confirm());
    document.getElementById('ctrl-cancel').addEventListener('click', () => this.cancel());
    document.getElementById('ctrl-close').addEventListener('click', () => this.close());
    document.getElementById('ctrl-insert-before').addEventListener('click', () => {
      this.insertMode = this.insertMode === 'before' ? null : 'before';
    });
    document.getElementById('ctrl-insert-after').addEventListener('click', () => {
      this.insertMode = this.insertMode === 'after' ? null : 'after';
    });
  }
```

- [ ] **Step 3: Hook palette clicks through to ControllerView**

In `src/main.js`, modify the `_onToolSelect` callback (around line 48) to check the controller first:

Replace:
```js
  renderer._onToolSelect = (compType) => input.selectTool(compType);
```

With:
```js
  renderer._onToolSelect = (compType) => {
    if (controllerView.handlePaletteClick(compType)) return;
    input.selectTool(compType);
  };
```

- [ ] **Step 4: Commit**

```bash
git add index.html src/ui/ControllerView.js src/main.js
git commit -m "feat(controller): integrate palette for replace and insert actions in draft mode"
```

---

### Task 7: Polish — Resize Handling, Schematic Cache Invalidation, Visual Refinements

**Files:**
- Modify: `src/renderer/controller-renderer.js` (add resize observer, improve visuals)
- Modify: `src/ui/ControllerView.js` (invalidate cache on type change)

- [ ] **Step 1: Add resize observer to re-render on window resize**

In `src/ui/ControllerView.js`, add to the `_bindEvents()` method:

```js
    // Re-render on resize
    this._resizeObserver = new ResizeObserver(() => {
      if (this.isOpen) this._renderAll();
    });
    this._resizeObserver.observe(this.overlay);
```

- [ ] **Step 2: Invalidate schematic cache when components change**

In `src/ui/ControllerView.js`, at the start of both `replaceComponent()` and `insertComponent()`, add:

```js
    // Invalidate schematic cache for the changed type
    if (this._schematicCache) delete this._schematicCache[newType || type];
```

Actually, the cache is keyed by component type and the drawers are stateless, so the cache doesn't need invalidation on edits — only if the drawer code itself changed, which doesn't happen at runtime. Remove this step.

- [ ] **Step 2 (revised): Add component index labels to schematic**

In `src/renderer/controller-renderer.js`, in `_renderSchematic()`, after drawing the selection highlight, add index labels for all components. After the `// Component name label` block for the selected component, add for all components:

```js
    // Index label under each component
    ctx.fillStyle = 'rgba(100, 100, 140, 0.6)';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${i + 1}`, xPos + compW / 2, centerY + compH / 2 + 10);
```

- [ ] **Step 3: Show the bottom HUD when controller is open**

The existing `#bottom-hud` should remain visible when the controller is open (it's already at `z-index: 100`, and the controller overlay is `z-index: 250`). We need to ensure the controller's body doesn't overlap it. 

In `style.css`, update `.ctrl-body` to leave room for the bottom HUD:

```css
.ctrl-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding-bottom: 120px; /* space for bottom HUD */
}
```

And ensure the bottom HUD is above the controller overlay when it's open:

```css
.controller-overlay ~ #bottom-hud {
  z-index: 260;
}
```

Wait — the bottom HUD is not a sibling of the controller overlay in DOM order. Both are inside `#game`. Let's use a simpler approach: when the controller opens, bump the bottom HUD z-index.

In `src/ui/ControllerView.js`, in the `open()` method, after showing the overlay:

```js
    // Ensure bottom HUD stays visible above controller
    const bottomHud = document.getElementById('bottom-hud');
    if (bottomHud) bottomHud.style.zIndex = '260';
```

And in `_cleanup()`, reset it:

```js
    const bottomHud = document.getElementById('bottom-hud');
    if (bottomHud) bottomHud.style.zIndex = '';
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/controller-renderer.js src/ui/ControllerView.js style.css
git commit -m "feat(controller): add resize handling, visual polish, and bottom HUD layering"
```

---

### Task 8: End-to-End Testing & Bug Fixes

**Files:**
- All controller files (fix any issues found during testing)

This task is a manual testing pass to verify the full flow works correctly.

- [ ] **Step 1: Test basic open/close flow**

1. Start the game, place a source + quad + cavity on a beamline
2. Select the beamline by clicking it
3. Press `C` — controller should open
4. Verify: schematic shows 3 components left-to-right with pixel art
5. Verify: plots show beam data (if physics engine loaded)
6. Press `Esc` — controller should close with no changes

- [ ] **Step 2: Test draft editing**

1. Open controller
2. Select the quad (arrow key or click)
3. Click a different component type in the palette (e.g., sextupole)
4. Verify: the quad is replaced in the schematic, plots update, draft bar shows "1 replaced" and cost delta
5. Click "+ After" then click drift tube in palette
6. Verify: a drift is inserted after the sextupole, draft bar updates
7. Select the drift, press Delete
8. Verify: drift is removed

- [ ] **Step 3: Test confirm/cancel**

1. Make some changes in the controller
2. Click Cancel — confirm prompt appears, click OK
3. Verify: beamline in isometric view is unchanged
4. Re-open controller, make changes, click Confirm
5. Verify: changes are applied to the isometric beamline, funding deducted

- [ ] **Step 4: Test pan/zoom**

1. Open controller with a long beamline (10+ components)
2. Use A/D to pan left/right
3. Use mousewheel to zoom in/out
4. Verify: schematic and along-s plots scroll in sync

- [ ] **Step 5: Fix any issues found and commit**

```bash
git add -u
git commit -m "fix(controller): address issues found during end-to-end testing"
```

---

## Summary

| Task | Description | Key Files |
|------|------------|-----------|
| 1 | DOM skeleton & CSS | index.html, style.css |
| 2 | ControllerView class — lifecycle & draft state | src/ui/ControllerView.js |
| 3 | Schematic & plot canvas rendering | src/renderer/controller-renderer.js |
| 4 | Keyboard, mouse & zoom events | src/ui/ControllerView.js |
| 5 | Entry points — C key & BeamlineWindow button | BeamlineWindow.js, InputHandler.js, main.js |
| 6 | Palette integration — replace & insert | ControllerView.js, main.js, index.html |
| 7 | Polish — resize, visuals, HUD layering | controller-renderer.js, ControllerView.js, style.css |
| 8 | End-to-end testing & bug fixes | All files |
