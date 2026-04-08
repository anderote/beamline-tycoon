// src/ui/BeamlineDesigner.js — Beamline Designer View
// Full-screen 2D view for inspecting and editing a beamline with live physics preview.

import { COMPONENTS } from '../data/components.js';
import { BeamPhysics } from '../beamline/physics.js';
import { PARAM_DEFS } from '../beamline/component-physics.js';
import { ContextWindow } from './ContextWindow.js';

export class BeamlineDesigner {
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

    // Mode: 'edit' (from placed beamline) or 'design' (standalone sandbox)
    this.mode = 'edit';
    this.designId = null;       // ID of saved design being edited (design mode only)
    this.designName = '';       // editable name for design mode

    // Viewport (shared between schematic and along-s plots)
    this.viewX = 0;             // horizontal pan offset in beamline-meters
    this.viewZoom = 1;          // zoom level (1 = fit-all)
    this.totalLength = 0;       // total beamline length in meters

    // Continuous marker position along s (meters)
    this.markerS = 0;
    this._markerDir = 0;      // -1, 0, or +1 for continuous panning
    this._markerAnimId = null; // requestAnimationFrame id

    // Focus row: 0 = schematic, 1 = plots, 2 = palette
    this.focusRow = 0;

    // Insert mode: null, 'before', or 'after'
    this.insertMode = null;

    // Plot range mode: 'full', '20', '10' (meters)
    this.plotRangeMode = 'full';

    // DOM references
    this.overlay = document.getElementById('designer-overlay');
    this.summaryEl = document.getElementById('dsgn-draft-summary');
    this.costEl = document.getElementById('dsgn-draft-cost');

    this._bindButtons();
    this._bindEvents();
  }

  _bindButtons() {
    document.getElementById('dsgn-confirm').addEventListener('click', () => this.confirm());
    document.getElementById('dsgn-cancel').addEventListener('click', () => this.cancel());
    document.getElementById('dsgn-close').addEventListener('click', () => this.close());
    document.getElementById('dsgn-insert-before').addEventListener('click', () => {
      this.insertMode = this.insertMode === 'before' ? null : 'before';
      this._updateInsertButtons();
    });
    document.getElementById('dsgn-insert-after').addEventListener('click', () => {
      this.insertMode = this.insertMode === 'after' ? null : 'after';
      this._updateInsertButtons();
    });
    document.getElementById('dsgn-save-design').addEventListener('click', () => this.saveDesign());
    document.getElementById('dsgn-save-as').addEventListener('click', () => this.saveDesignAs());
  }

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
          this._startMarkerMove(-1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          e.stopPropagation();
          this._startMarkerMove(1);
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
    this._onKeyUp = (e) => {
      if (!this.isOpen) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        this._stopMarkerMove();
      }
    };
    // Use capture phase so we intercept before InputHandler
    window.addEventListener('keydown', this._onKeyDown, true);
    window.addEventListener('keyup', this._onKeyUp, true);

    // Schematic click + drag panning
    const schematicCanvas = document.getElementById('dsgn-schematic-canvas');
    if (schematicCanvas) {
      let dragging = false;
      let dragStartX = 0;
      let dragStartViewX = 0;
      let dragDistance = 0;

      schematicCanvas.addEventListener('mousedown', (e) => {
        if (!this.isOpen) return;
        dragging = true;
        dragStartX = e.clientX;
        dragStartViewX = this.viewX;
        dragDistance = 0;
      });
      window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - dragStartX;
        dragDistance = Math.abs(dx);
        this.viewX = dragStartViewX - dx / (this.viewZoom * 2);
        this._renderAll();
      });
      window.addEventListener('mouseup', () => { dragging = false; });

      schematicCanvas.addEventListener('click', (e) => {
        if (!this.isOpen) return;
        if (dragDistance > 5) return;  // was a drag, not a click
        const idx = this._hitTestSchematic(e.clientX, e.clientY);
        if (idx >= 0) {
          this.selectedIndex = idx;
          this._updateMarkerToComponentCenter();
          this._renderAll();
        }
      });

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
    document.querySelectorAll('.dsgn-plot-select').forEach(select => {
      select.addEventListener('change', () => {
        if (this.isOpen) this._renderPlots();
      });
    });

    // Plot range buttons
    document.querySelectorAll('.dsgn-range-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!this.isOpen) return;
        this.plotRangeMode = btn.dataset.range;
        document.querySelectorAll('.dsgn-range-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._renderPlots();
      });
    });

    // Mousewheel on plot canvases (sync zoom with schematic)
    document.querySelectorAll('.dsgn-plot-canvas').forEach(canvas => {
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

    // Re-render on resize
    this._resizeObserver = new ResizeObserver(() => {
      if (this.isOpen) this._renderAll();
    });
    this._resizeObserver.observe(this.overlay);
  }

  // --- Open / Close ---

  open(beamlineId) {
    const entry = this.game.registry.get(beamlineId);
    if (!entry) return;

    this.beamlineId = beamlineId;
    this.isOpen = true;
    this.mode = 'edit';
    this.designId = null;
    this.designName = '';

    // Clone the ordered node list for draft editing
    const ordered = entry.beamline.getOrderedComponents();
    this.originalNodes = ordered.map(n => this._cloneNode(n));
    this.draftNodes = ordered.map(n => this._cloneNode(n));
    this.selectedIndex = this.draftNodes.length > 0 ? 0 : -1;
    this.markerS = 0;
    this.focusRow = 0;
    this.insertMode = null;
    this.plotRangeMode = 'full';
    this.viewX = 0;
    this.viewZoom = 1;
    // Reset range button UI
    document.querySelectorAll('.dsgn-range-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.range === 'full');
    });

    // Compute total length
    this._updateTotalLength();

    // Run initial physics on draft
    this._recalcDraft();

    // Close all context windows and popups before showing controller
    ContextWindow.closeAll();
    this.renderer.hidePopup();

    // Show overlay, ensure bottom HUD stays visible above controller
    this.overlay.classList.remove('hidden');
    const bottomHud = document.getElementById('bottom-hud');
    if (bottomHud) bottomHud.style.zIndex = '260';

    // Set up beamline-only palette with preview cards
    this._setupDesignerTabs();
    this._updateDesignerHeader();

    // Update draft bar
    this._updateDraftBar();

    // Trigger initial render
    this._renderAll();
  }

  openDesign(design = null) {
    this.mode = 'design';
    this.beamlineId = null;
    this.isOpen = true;

    if (design) {
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
      this.designId = null;
      this.designName = 'New Design';
      this.draftNodes = [];
    }
    this.originalNodes = this.draftNodes.map(n => this._cloneNode(n));
    this.selectedIndex = this.draftNodes.length > 0 ? 0 : -1;
    this.markerS = 0;
    this.focusRow = 0;
    this.insertMode = null;
    this.plotRangeMode = 'full';
    this.viewX = 0;
    this.viewZoom = 1;
    this._nextTempId = this.draftNodes.length;

    this._updateTotalLength();
    this._recalcDraft();

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

  _updateDesignerHeader() {
    const titleEl = document.getElementById('dsgn-title');
    const confirmBtn = document.getElementById('dsgn-confirm');
    const cancelBtn = document.getElementById('dsgn-cancel');
    const saveDesignBtn = document.getElementById('dsgn-save-design');
    const saveAsBtn = document.getElementById('dsgn-save-as');
    const costEl = document.getElementById('dsgn-draft-cost');

    if (this.mode === 'design') {
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
      this.game.updateDesign(this.designId, {
        name: this.designName,
        components,
      });
      this.originalNodes = this.draftNodes.map(n => this._cloneNode(n));
      this.game.log(`Design "${this.designName}" saved.`, 'good');
    } else {
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
    const types = this.draftNodes.map(n => n.type);
    const hasBend = types.some(t => COMPONENTS[t]?.isDipole);
    const hasUndulator = types.some(t => t === 'undulator' || t === 'wiggler');
    if (hasUndulator) return 'fel';
    if (hasBend) return 'synchrotron';
    return 'linac';
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
    if (this.mode === 'design') return;
    const entry = this.game.registry.get(this.beamlineId);
    if (!entry) { this._cleanup(); return; }

    // Calculate cost delta and check funding
    const costDelta = this._calcCostDelta();
    if (costDelta > 0 && this.game.state.resources.funding < costDelta) {
      this.game.log('Not enough funding for these changes!', 'bad');
      return;
    }

    // Deduct cost
    if (costDelta !== 0) {
      this.game.state.resources.funding -= costDelta;
    }

    // Apply draft nodes to the real beamline
    this._applyDraftToBeamline(entry);

    // Auto-place foundation under any beamline tiles that lack it
    for (const node of entry.beamline.nodes) {
      if (!node.tiles) continue;
      for (const tile of node.tiles) {
        const key = tile.col + ',' + tile.row;
        if (!this.game.state.infraOccupied[key]) {
          if (this.game.state.decorationOccupied[key]) {
            this.game.removeDecoration(tile.col, tile.row);
          }
          this.game.state.infrastructure.push({ type: 'concrete', col: tile.col, row: tile.row, variant: 0 });
          this.game.state.infraOccupied[key] = 'concrete';
          this.game.state.resources.funding -= 10;
        }
      }
    }

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
    this._lastTuningKey = null;
    this._markerDir = 0;
    if (this._markerAnimId) {
      cancelAnimationFrame(this._markerAnimId);
      this._markerAnimId = null;
    }
    this.overlay.classList.add('hidden');
    const bottomHud = document.getElementById('bottom-hud');
    if (bottomHud) bottomHud.style.zIndex = '';
    // Restore normal palette tabs
    this._restoreNormalTabs();
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
      id: -(this._nextTempId = (this._nextTempId || 0) + 1),  // unique negative ID for draft
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

  // --- Palette integration ---

  handlePaletteClick(componentType) {
    if (!this.isOpen) return false;
    const comp = COMPONENTS[componentType];
    if (!comp) return false;

    if (this.insertMode) {
      const idx = this.selectedIndex >= 0 ? this.selectedIndex : this.draftNodes.length - 1;
      this.insertComponent(idx, componentType, this.insertMode);
      this.insertMode = null;
      return true;
    }

    if (this.selectedIndex >= 0) {
      this.replaceComponent(this.selectedIndex, componentType);
      return true;
    }

    return false;
  }

  // --- Selection / Navigation ---

  /** Start continuous marker movement in a direction (-1 or +1). */
  _startMarkerMove(dir) {
    this._markerDir = dir;
    if (this._markerAnimId) return; // animation already running
    this._lastMarkerTime = performance.now();
    this._runMarkerAnimation();
  }

  /** Stop continuous marker movement. */
  _stopMarkerMove() {
    this._markerDir = 0;
    // Animation will stop on next frame when dir is 0
  }

  _runMarkerAnimation() {
    // Speed: traverse full beamline in ~3 seconds
    const SPEED_FACTOR = Math.max(this.totalLength / 3, 0.5);

    const step = (now) => {
      const dt = Math.min((now - this._lastMarkerTime) / 1000, 0.05); // cap at 50ms
      this._lastMarkerTime = now;

      if (this._markerDir === 0) {
        this._markerAnimId = null;
        return;
      }

      this.markerS = Math.max(0, Math.min(this.totalLength,
        this.markerS + this._markerDir * SPEED_FACTOR * dt));

      // Update selected component based on marker position
      this._updateSelectionFromMarker();

      this._renderSchematic();
      this._renderPlots();
      this._markerAnimId = requestAnimationFrame(step);
    };
    this._markerAnimId = requestAnimationFrame(step);
  }

  /** Set markerS to the center of the currently selected component (instant, for clicks). */
  _updateMarkerToComponentCenter() {
    if (this.selectedIndex < 0 || this.draftNodes.length === 0) return;
    let s = 0;
    for (let i = 0; i < this.selectedIndex; i++) {
      const comp = COMPONENTS[this.draftNodes[i].type];
      if (comp) s += comp.length;
    }
    const comp = COMPONENTS[this.draftNodes[this.selectedIndex].type];
    if (comp) s += comp.length / 2;
    this.markerS = s;
  }

  /** Update selectedIndex based on current markerS position. */
  _updateSelectionFromMarker() {
    if (this.draftNodes.length === 0) { this.selectedIndex = -1; return; }
    let cumS = 0;
    for (let i = 0; i < this.draftNodes.length; i++) {
      const comp = COMPONENTS[this.draftNodes[i].type];
      const len = comp ? comp.length : 1;
      if (this.markerS < cumS + len) {
        if (this.selectedIndex !== i) {
          this.selectedIndex = i;
          this._renderTuning();
        }
        return;
      }
      cumS += len;
    }
    // Past the end — select last component
    const last = this.draftNodes.length - 1;
    if (this.selectedIndex !== last) {
      this.selectedIndex = last;
      this._renderTuning();
    }
  }

  /** Find the envelope index closest to the current markerS. */
  getMarkerEnvelopeIndex() {
    if (!this.draftEnvelope || this.draftEnvelope.length === 0) return -1;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < this.draftEnvelope.length; i++) {
      const dist = Math.abs((this.draftEnvelope[i].s || 0) - this.markerS);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
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
    if (this.beamlineId) {
      const entry = this.game.registry.get(this.beamlineId);
      if (entry) researchEffects.machineType = entry.beamState.machineType;
    } else {
      researchEffects.machineType = this._pickCategory();
    }

    const result = BeamPhysics.compute(physicsBeamline, researchEffects);
    this.draftEnvelope = result ? result.envelope : null;
  }

  _hasDraftChanges() {
    if (this.draftNodes.length !== this.originalNodes.length) return true;
    for (let i = 0; i < this.draftNodes.length; i++) {
      if (this.draftNodes[i].type !== this.originalNodes[i].type) return true;
      if (this.draftNodes[i].id !== this.originalNodes[i].id) return true;
      if (JSON.stringify(this.draftNodes[i].params) !== JSON.stringify(this.originalNodes[i].params)) return true;
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
    if (this.mode === 'design') {
      this.summaryEl.textContent = `${this.draftNodes.length} components · ${this.totalLength.toFixed(1)}m`;
      return;
    }
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

  _updateInsertButtons() {
    const beforeBtn = document.getElementById('dsgn-insert-before');
    const afterBtn = document.getElementById('dsgn-insert-after');
    if (beforeBtn) beforeBtn.classList.toggle('active', this.insertMode === 'before');
    if (afterBtn) afterBtn.classList.toggle('active', this.insertMode === 'after');
  }

  _applyDraftToBeamline(entry) {
    const bl = entry.beamline;

    // Free all existing tiles
    for (const node of bl.nodes) {
      bl._freeTiles(node.tiles);
    }

    // Replace nodes with draft
    bl.nodes = this.draftNodes.map(n => this._cloneNode(n));

    // Re-occupy tiles for nodes that have valid tile data
    for (const node of bl.nodes) {
      if (node.tiles && node.tiles.length > 0) {
        bl._occupyTiles(node.tiles, node.id);
      }
    }
  }

  // --- Rendering (placeholders — filled in by designer-renderer.js) ---

  _renderAll() {}
  _renderSchematic() {}
  _renderTuning() {}
  _renderPlots() {}
}
