// src/ui/BeamlineDesigner.js — Beamline Designer View
// Full-screen 2D view for inspecting and editing a beamline with live physics preview.

import { COMPONENTS } from '../data/components.js';
import { BeamPhysics } from '../beamline/physics.js';
import { PARAM_DEFS } from '../beamline/component-physics.js';
import { ContextWindow } from './ContextWindow.js';

// Must match beam_physics/gameplay.py LENGTH_SCALE
// 1 tile = 2 m
const LENGTH_SCALE = 2.0;

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
    this.ghostQuads = [];      // suggested quad positions [{s, nodeIndex, polarity}]
    this.selectedIndex = -1;    // index into draftNodes

    // Mode: 'edit' (from placed beamline) or 'design' (standalone sandbox)
    this.mode = 'edit';
    this.designId = null;       // ID of saved design being edited (design mode only)
    this.designName = '';       // editable name for design mode

    // Viewport (shared between schematic and along-s plots)
    this.viewX = 0;             // horizontal pan offset in beamline-meters
    this.viewZoom = 0.7;          // zoom level (1 = fit-all)
    this.totalLength = 0;       // total beamline length in meters

    // Continuous marker position along s (meters)
    this.markerS = 0;
    this._markerDir = 0;      // -1, 0, or +1 for continuous panning
    this._markerAnimId = null; // requestAnimationFrame id

    // Focus row: 0 = beamline stackup, 1 = component palette
    this.focusRow = 0;

    // Palette keyboard index when focusRow=1
    this.designerPaletteIndex = -1;

    // Insert mode: null (replace), 'nearest', 'before', or 'after'
    this.insertMode = 'nearest';

    // Drag-reorder drop target index (-1 = inactive)
    this._reorderDropIndex = -1;

    // Undo stack (max 3 snapshots)
    this._undoStack = [];
    this._UNDO_MAX = 3;

    // Plot range modes
    this.plotRangeMode = 'full';   // x: 'full', '30', '9'
    this.plotYRangeMode = 'full';  // y: 'full', 'half', '30', '9'

    // DOM references
    this.overlay = document.getElementById('designer-overlay');
    this.summaryEl = document.getElementById('dsgn-draft-summary');
    this.costEl = document.getElementById('dsgn-draft-cost');

    this._suppressHashUpdate = false;

    this._bindButtons();
    this._bindEvents();
  }

  _bindButtons() {
    document.getElementById('dsgn-confirm').addEventListener('click', () => this.confirm());
    document.getElementById('dsgn-cancel').addEventListener('click', () => this.cancel());
    document.getElementById('dsgn-close').addEventListener('click', () => this.close());
    document.getElementById('dsgn-action-replace').addEventListener('click', () => {
      this.insertMode = null;
      this._updateInsertButtons();
    });
    document.getElementById('dsgn-action-insert').addEventListener('click', () => {
      this.insertMode = 'nearest';
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

      // Ctrl+Z → undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        e.stopPropagation();
        this.undo();
        return;
      }

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          e.stopPropagation();
          if (this.focusRow === 0) {
            this._startMarkerMove(-1);
          } else if (this.focusRow === 1) {
            this._navigateDesignerTab(-1);
          } else if (this.focusRow === 2) {
            this._navigateDesignerPalette(-1);
          }
          break;
        case 'ArrowRight':
          e.preventDefault();
          e.stopPropagation();
          if (this.focusRow === 0) {
            this._startMarkerMove(1);
          } else if (this.focusRow === 1) {
            this._navigateDesignerTab(1);
          } else if (this.focusRow === 2) {
            this._navigateDesignerPalette(1);
          }
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
        case 'Tab':
          e.preventDefault();
          e.stopPropagation();
          // Cycle between replace and insert mode
          this.insertMode = this.insertMode ? null : 'nearest';
          this._updateInsertButtons();
          break;
        case 'Enter': case ' ':
          if (this.focusRow === 1) {
            e.preventDefault();
            e.stopPropagation();
            // Select tab and move down to palette
            this._activateCurrentTab();
            this.focusRow = 2;
            this.designerPaletteIndex = 0;
            this._updateFocusRowVisuals();
          } else if (this.focusRow === 2) {
            e.preventDefault();
            e.stopPropagation();
            this._confirmPaletteSelection();
          }
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
          if (this.focusRow > 0) {
            this.focusRow--;
            if (this.focusRow < 2) this.designerPaletteIndex = -1;
            this._updateFocusRowVisuals();
          } else {
            this.close();
          }
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
        if (this.focusRow === 0) this._stopMarkerMove();
      }
    };
    // Use capture phase so we intercept before InputHandler
    window.addEventListener('keydown', this._onKeyDown, true);
    window.addEventListener('keyup', this._onKeyUp, true);

    // Schematic click + drag panning / component reorder
    const schematicCanvas = document.getElementById('dsgn-schematic-canvas');
    if (schematicCanvas) {
      let dragging = false;
      let reorderDragging = false;   // true when dragging a selected component
      let reorderSourceIndex = -1;
      let dragStartX = 0;
      let dragStartViewX = 0;
      let dragDistance = 0;

      schematicCanvas.addEventListener('mousedown', (e) => {
        if (!this.isOpen) return;
        dragStartX = e.clientX;
        dragDistance = 0;

        // Check if mousedown is on the currently selected component
        const rect = schematicCanvas.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;
        let hitSelected = false;
        if (this.selectedIndex >= 0 && this._compRegions) {
          const r = this._compRegions[this.selectedIndex];
          if (r && clickX >= r.x && clickX <= r.x + r.w &&
              clickY >= r.y && clickY <= r.y + r.h) {
            hitSelected = true;
          }
        }

        if (hitSelected) {
          reorderDragging = true;
          reorderSourceIndex = this.selectedIndex;
          this._reorderDropIndex = -1;
          dragging = false;
        } else {
          dragging = true;
          reorderDragging = false;
          dragStartViewX = this.viewX;
        }
      });
      window.addEventListener('mousemove', (e) => {
        if (reorderDragging) {
          const dx = e.clientX - dragStartX;
          dragDistance = Math.abs(dx);
          if (dragDistance <= 5) return;  // not dragging yet
          // Find drop position from mouse X
          const rect = schematicCanvas.getBoundingClientRect();
          const mouseX = e.clientX - rect.left;
          let dropIdx = this.draftNodes.length;  // default: after last
          if (this._compRegions) {
            for (const r of this._compRegions) {
              const cx = r.x + r.w / 2;
              if (mouseX < cx) {
                dropIdx = r.index;
                break;
              }
            }
          }
          // Don't show indicator at current position or adjacent (no-op)
          if (dropIdx === reorderSourceIndex || dropIdx === reorderSourceIndex + 1) {
            dropIdx = -1;
          }
          if (this._reorderDropIndex !== dropIdx) {
            this._reorderDropIndex = dropIdx;
            this._renderAll();
          }
          return;
        }
        if (!dragging) return;
        const dx = e.clientX - dragStartX;
        dragDistance = Math.abs(dx);
        this.viewX = dragStartViewX - dx / (this.viewZoom * 2);
        this._clampViewX();
        this._renderAll();
      });
      window.addEventListener('mouseup', () => {
        if (reorderDragging && dragDistance > 5 && this._reorderDropIndex >= 0) {
          this._reorderComponent(reorderSourceIndex, this._reorderDropIndex);
        }
        this._reorderDropIndex = -1;
        dragging = false;
        reorderDragging = false;
        reorderSourceIndex = -1;
        this._renderAll();
      });

      schematicCanvas.addEventListener('click', (e) => {
        if (!this.isOpen) return;
        if (dragDistance > 5) return;  // was a drag, not a click
        const rect = schematicCanvas.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;

        // Check ghost quad click first
        if (this._ghostRegions) {
          const dpr = window.devicePixelRatio || 1;
          for (const gr of this._ghostRegions) {
            if (clickX >= gr.x / dpr && clickX <= (gr.x + gr.w) / dpr &&
                clickY >= gr.y / dpr && clickY <= (gr.y + gr.h) / dpr) {
              this._insertGhostQuad(gr.ghost);
              return;
            }
          }
        }

        this._placeMarkerAtClickX(clickX);
        this._renderAll();
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

    // Plot x-range buttons
    document.querySelectorAll('.dsgn-xrange-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!this.isOpen) return;
        this.plotRangeMode = btn.dataset.range;
        document.querySelectorAll('.dsgn-xrange-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._renderPlots();
      });
    });

    // Plot y-range buttons
    document.querySelectorAll('.dsgn-yrange-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!this.isOpen) return;
        this.plotYRangeMode = btn.dataset.yrange;
        document.querySelectorAll('.dsgn-yrange-btn').forEach(b => b.classList.remove('active'));
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

    // Check for saved draft state for this beamline
    const savedDraft = this.game.state.designerState;
    const hasSavedDraft = savedDraft && savedDraft.mode === 'edit' && savedDraft.beamlineId === beamlineId;

    // Clone the ordered node list as the original (pre-edit) snapshot
    const ordered = entry.beamline.getOrderedComponents();
    this.originalNodes = ordered.map(n => this._cloneNode(n));

    if (hasSavedDraft && savedDraft.draftNodes.length > 0) {
      // Restore saved draft
      this.draftNodes = savedDraft.draftNodes.map(n => ({
        id: n.id,
        type: n.type,
        col: 0, row: 0, dir: 0, entryDir: 0,
        parentId: null, bendDir: n.bendDir || null, tiles: [],
        params: n.params ? { ...n.params } : {},
        computedStats: null,
      }));
      this.selectedIndex = savedDraft.selectedIndex ?? 0;
      this.viewX = savedDraft.viewX ?? 0;
      this.viewZoom = savedDraft.viewZoom ?? 0.7;
    } else {
      this.draftNodes = ordered.map(n => this._cloneNode(n));
      this.selectedIndex = this.draftNodes.length > 0 ? 0 : -1;
      this.viewX = 0;
      this.viewZoom = 0.7;
    }
    this.markerS = 0;
    this.focusRow = 0;
    this.designerPaletteIndex = -1;
    this.insertMode = 'nearest';
    this.plotRangeMode = 'full';
    this.plotYRangeMode = 'full';
    // Reset range button UI
    document.querySelectorAll('.dsgn-xrange-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.range === 'full');
    });
    document.querySelectorAll('.dsgn-yrange-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.yrange === 'full');
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
    const paletteActions = document.getElementById('dsgn-palette-actions');
    if (paletteActions) paletteActions.classList.remove('hidden');

    // Set up beamline-only palette with preview cards
    this._setupDesignerTabs();
    this._updateDesignerHeader();

    // Update draft bar
    this._updateDraftBar();

    // Trigger initial render
    this._renderAll();
    window.location.hash = `designer?edit=${beamlineId}`;
  }

  openDesign(design = null) {
    this.mode = 'design';
    this.beamlineId = null;
    this.isOpen = true;

    // Check for saved draft state for this design
    const savedDraft = this.game.state.designerState;
    const hasSavedDraft = savedDraft && savedDraft.mode === 'design'
      && ((design && savedDraft.designId === design.id) || (!design && !savedDraft.designId));

    if (hasSavedDraft && savedDraft.draftNodes.length > 0) {
      // Restore saved draft
      this.designId = savedDraft.designId;
      this.designName = savedDraft.designName;
      this.draftNodes = savedDraft.draftNodes.map(n => ({
        id: n.id,
        type: n.type,
        col: 0, row: 0, dir: 0, entryDir: 0,
        parentId: null, bendDir: n.bendDir || null, tiles: [],
        params: n.params ? { ...n.params } : {},
        computedStats: null,
      }));
      this.selectedIndex = savedDraft.selectedIndex ?? 0;
      this.viewX = savedDraft.viewX ?? 0;
      this.viewZoom = savedDraft.viewZoom ?? 0.7;
    } else if (design) {
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
      this.selectedIndex = this.draftNodes.length > 0 ? 0 : -1;
      this.viewX = 0;
      this.viewZoom = 0.7;
    } else {
      this.designId = null;
      this.designName = 'New Design';
      this.draftNodes = [];
      this.selectedIndex = -1;
      this.viewX = 0;
      this.viewZoom = 0.7;
    }
    this.originalNodes = this.draftNodes.map(n => this._cloneNode(n));
    this.markerS = 0;
    this.focusRow = 0;
    this.designerPaletteIndex = -1;
    this.insertMode = 'nearest';
    this.plotRangeMode = 'full';
    this._nextTempId = this.draftNodes.length;

    this._updateTotalLength();
    this._recalcDraft();

    ContextWindow.closeAll();
    this.renderer.hidePopup();

    this.overlay.classList.remove('hidden');
    const bottomHud = document.getElementById('bottom-hud');
    if (bottomHud) bottomHud.style.zIndex = '260';
    const paletteActions = document.getElementById('dsgn-palette-actions');
    if (paletteActions) paletteActions.classList.remove('hidden');

    this._setupDesignerTabs();
    this._updateDesignerHeader();
    this._updateDraftBar();
    this._renderAll();
    window.location.hash = design ? `designer?design=${design.id}` : 'designer';
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

    // Auto-save draft state so user can resume later
    this._saveDraftState();
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

    // Changes applied — clear draft state
    this._clearDraftState();
    this._cleanup();
  }

  cancel() {
    if (!this.isOpen) return;

    // Cancel discards the draft and reverts
    if (this._hasDraftChanges() && !confirm('Discard draft changes?')) {
      return;
    }
    this._clearDraftState();
    this._cleanup();
  }

  _saveDraftState() {
    // Persist draft to game state so it survives close/reload
    this.game.state.designerState = this.serializeState();
  }

  _clearDraftState() {
    // Clear saved draft (e.g., after confirm applies changes)
    this.game.state.designerState = null;
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
    const paletteActions = document.getElementById('dsgn-palette-actions');
    if (paletteActions) paletteActions.classList.add('hidden');
    if (!this._suppressHashUpdate && window.location.hash.startsWith('#designer')) {
      window.location.hash = 'game';
    }
    this._suppressHashUpdate = false;
    // Restore normal palette tabs
    this._restoreNormalTabs();
  }

  // --- Undo ---

  _pushUndo() {
    this._undoStack.push({
      draftNodes: this.draftNodes.map(n => this._cloneNode(n)),
      selectedIndex: this.selectedIndex,
      markerS: this.markerS,
    });
    if (this._undoStack.length > this._UNDO_MAX) {
      this._undoStack.shift();
    }
  }

  undo() {
    if (this._undoStack.length === 0) {
      this.game.log('Nothing to undo', 'info');
      return;
    }
    const snap = this._undoStack.pop();
    this.draftNodes = snap.draftNodes;
    this.selectedIndex = snap.selectedIndex;
    this.markerS = snap.markerS;
    this._lastTuningKey = null; // force tuning panel rebuild
    this._updateTotalLength();
    this._recalcDraft();
    this._updateDraftBar();
    this._renderAll();
  }

  // --- Draft operations ---

  replaceComponent(index, newType) {
    if (index < 0 || index >= this.draftNodes.length) return;
    const comp = COMPONENTS[newType];
    if (!comp) return;
    this._pushUndo();

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
    this._pushUndo();

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
    this._pushUndo();
    this.draftNodes.splice(index, 1);
    if (this.selectedIndex >= this.draftNodes.length) {
      this.selectedIndex = this.draftNodes.length - 1;
    }

    this._updateTotalLength();
    this._recalcDraft();
    this._updateDraftBar();
    this._renderAll();
  }

  /** Move a component from one index to a new position via drag reorder. */
  _reorderComponent(fromIndex, toIndex) {
    if (fromIndex < 0 || fromIndex >= this.draftNodes.length) return;
    if (toIndex < 0 || toIndex > this.draftNodes.length) return;
    this._pushUndo();
    const [node] = this.draftNodes.splice(fromIndex, 1);
    // After removing, adjust toIndex if it was after the removed element
    const insertAt = toIndex > fromIndex ? toIndex - 1 : toIndex;
    this.draftNodes.splice(insertAt, 0, node);
    this.selectedIndex = insertAt;
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
      // Find closest edge using marker position
      const { index, position } = this._findClosestEdge();
      this.insertComponent(index, componentType, position);
      // Advance marker past the inserted component so the next click places after it
      const lengths = this._compPhysLengths();
      let s = 0;
      for (let i = 0; i <= this.selectedIndex && i < lengths.length; i++) s += lengths[i];
      this.markerS = s;
      return true;
    }

    if (this.selectedIndex >= 0) {
      this.replaceComponent(this.selectedIndex, componentType);
      return true;
    }

    return false;
  }

  /** Find the closest component boundary to the current marker position.
   *  Returns { index, position } for use with insertComponent. */
  _findClosestEdge() {
    if (this.draftNodes.length === 0) {
      return { index: 0, position: 'before' };
    }
    const lengths = this._compPhysLengths();
    let cumS = 0;
    let bestDist = Infinity;
    let bestIdx = 0;
    let bestPos = 'before';

    // Check left edge of first component
    const d0 = Math.abs(this.markerS);
    if (d0 < bestDist) { bestDist = d0; bestIdx = 0; bestPos = 'before'; }

    for (let i = 0; i < this.draftNodes.length; i++) {
      cumS += lengths[i];
      // Right edge of component i = left edge of i+1
      const dist = Math.abs(this.markerS - cumS);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
        bestPos = 'after';
      }
    }
    return { index: bestIdx, position: bestPos };
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
    // Build visual-to-physical mapping for constant visual speed
    const compMap = this._buildCompVisualMap();
    // Traverse full visual length in ~3 seconds
    const totalVisual = compMap.totalVisual || 1;
    const VISUAL_SPEED = totalVisual / 3;

    // Convert current markerS to visual position
    let visualPos = this._sToVisual(compMap);

    const step = (now) => {
      const dt = Math.min((now - this._lastMarkerTime) / 1000, 0.05);
      this._lastMarkerTime = now;

      if (this._markerDir === 0) {
        this._markerAnimId = null;
        return;
      }

      // Advance in visual units at constant speed
      visualPos = Math.max(0, Math.min(totalVisual,
        visualPos + this._markerDir * VISUAL_SPEED * dt));

      // Convert visual position back to physical s
      this.markerS = this._visualToS(compMap, visualPos);

      this._updateSelectionFromMarker();
      this._renderSchematic();
      this._renderPlots();
      this._markerAnimId = requestAnimationFrame(step);
    };
    this._markerAnimId = requestAnimationFrame(step);
  }

  /** Build array mapping each component's visual width and physical length.
   *  Physical lengths are derived from this.totalLength proportionally so they
   *  stay in sync with the envelope s-values used by the plots. */
  _buildCompVisualMap() {
    const SCHEM_PW = 70;
    const tileLenSum = this.draftNodes.reduce((s, n) => {
      const c = COMPONENTS[n.type];
      return s + (c ? c.length : 1);
    }, 0) || 1;

    const entries = [];
    let totalVisual = 0;
    for (const node of this.draftNodes) {
      const comp = COMPONENTS[node.type];
      const len = comp ? (comp.subL || 4) * 0.5 : 1;
      const visualW = Math.max(SCHEM_PW, Math.round(len * SCHEM_PW / 5));
      const physLen = (len / tileLenSum) * this.totalLength;
      entries.push({ visualW, physLen });
      totalVisual += visualW;
    }
    return { entries, totalVisual, totalPhysical: this.totalLength };
  }

  /** Convert current markerS (physical) to visual position. */
  _sToVisual(compMap) {
    let cumS = 0;
    let cumV = 0;
    for (const e of compMap.entries) {
      if (this.markerS <= cumS + e.physLen) {
        const frac = e.physLen > 0 ? (this.markerS - cumS) / e.physLen : 0;
        return cumV + frac * e.visualW;
      }
      cumS += e.physLen;
      cumV += e.visualW;
    }
    return compMap.totalVisual;
  }

  /** Convert visual position to physical s. */
  _visualToS(compMap, visualPos) {
    let cumV = 0;
    let cumS = 0;
    for (const e of compMap.entries) {
      if (visualPos <= cumV + e.visualW) {
        const frac = e.visualW > 0 ? (visualPos - cumV) / e.visualW : 0;
        return cumS + frac * e.physLen;
      }
      cumV += e.visualW;
      cumS += e.physLen;
    }
    return compMap.totalPhysical;
  }

  /** Compute per-component physical lengths that sum to this.totalLength. */
  _compPhysLengths() {
    const tileLenSum = this.draftNodes.reduce((s, n) => {
      const c = COMPONENTS[n.type];
      return s + (c ? c.length : 1);
    }, 0) || 1;
    return this.draftNodes.map(n => {
      const c = COMPONENTS[n.type];
      return ((c ? c.length : 1) / tileLenSum) * this.totalLength;
    });
  }

  /** Set markerS to the center of the currently selected component (instant, for clicks). */
  _updateMarkerToComponentCenter() {
    if (this.selectedIndex < 0 || this.draftNodes.length === 0) return;
    const lengths = this._compPhysLengths();
    let s = 0;
    for (let i = 0; i < this.selectedIndex; i++) s += lengths[i];
    s += lengths[this.selectedIndex] / 2;
    this.markerS = s;
  }

  /** Place marker at exact click X pixel position in the schematic canvas.
   *  Uses _compRegions from the renderer to map pixel → fractional position → physical s. */
  _placeMarkerAtClickX(clickX) {
    if (!this._compRegions || this._compRegions.length === 0 || this.draftNodes.length === 0) return;
    const lengths = this._compPhysLengths();

    // Find which region the click falls in and compute fractional position
    for (const region of this._compRegions) {
      if (clickX >= region.x && clickX <= region.x + region.w) {
        const frac = region.w > 0 ? (clickX - region.x) / region.w : 0.5;
        let s = 0;
        for (let i = 0; i < region.index; i++) s += lengths[i];
        s += frac * lengths[region.index];
        this.markerS = Math.max(0, Math.min(this.totalLength, s));
        this._updateSelectionFromMarker();
        return;
      }
    }

    // Click outside any component — snap to nearest edge
    const first = this._compRegions[0];
    const last = this._compRegions[this._compRegions.length - 1];
    if (clickX < first.x) {
      this.markerS = 0;
    } else {
      this.markerS = this.totalLength;
    }
    this._updateSelectionFromMarker();
  }

  /** Update selectedIndex based on current markerS position. */
  _updateSelectionFromMarker() {
    if (this.draftNodes.length === 0) { this.selectedIndex = -1; return; }
    const lengths = this._compPhysLengths();
    let cumS = 0;
    for (let i = 0; i < this.draftNodes.length; i++) {
      if (this.markerS < cumS + lengths[i]) {
        if (this.selectedIndex !== i) {
          this.selectedIndex = i;
          this._renderTuning();
        }
        return;
      }
      cumS += lengths[i];
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
    if (this.focusRow > 0) {
      this.focusRow--;
      this._stopMarkerMove();
      this._updateFocusRowVisuals();
    }
  }

  focusRowDown() {
    if (this.focusRow < 2) {
      this.focusRow++;
      // Initialize palette index if entering palette row
      if (this.focusRow === 2 && this.designerPaletteIndex < 0) this.designerPaletteIndex = 0;
      this._updateFocusRowVisuals();
    }
  }

  _updateFocusRowVisuals() {
    // Highlight focused row: 0=schematic, 1=tabs, 2=palette
    const schematic = document.getElementById('dsgn-schematic-canvas');
    const tabsContainer = document.getElementById('category-tabs');
    const palette = document.getElementById('component-palette');
    if (schematic) {
      schematic.parentElement.classList.toggle('dsgn-focus-active', this.focusRow === 0);
    }
    if (tabsContainer) {
      tabsContainer.classList.toggle('dsgn-focus-active', this.focusRow === 1);
      tabsContainer.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('kb-focus'));
      if (this.focusRow === 1) {
        const activeTab = tabsContainer.querySelector('.cat-tab.active');
        if (activeTab) activeTab.classList.add('kb-focus');
      }
    }
    if (palette) {
      palette.classList.toggle('dsgn-focus-active', this.focusRow === 2);
    }
    // Update palette kb-focus
    this._applyDesignerPaletteFocus();
  }

  _navigateDesignerTab(dir) {
    const tabsContainer = document.getElementById('category-tabs');
    if (!tabsContainer) return;
    const tabs = Array.from(tabsContainer.querySelectorAll('.cat-tab'));
    if (tabs.length === 0) return;
    const activeIdx = tabs.findIndex(t => t.classList.contains('active'));
    const newIdx = Math.max(0, Math.min(tabs.length - 1, activeIdx + dir));
    if (newIdx !== activeIdx) {
      tabs[newIdx].click();
      tabs.forEach(t => t.classList.remove('kb-focus'));
      tabs[newIdx].classList.add('kb-focus');
    }
  }

  _activateCurrentTab() {
    // Tab is already active from navigation; no-op
  }

  _navigateDesignerPalette(dir) {
    const cards = document.querySelectorAll('#component-palette .dsgn-palette-card');
    if (cards.length === 0) return;
    if (this.designerPaletteIndex < 0) this.designerPaletteIndex = 0;
    const newIdx = this.designerPaletteIndex + dir;
    // Wrap to next/prev tab when going past edges
    if (newIdx < 0) {
      this._navigateDesignerTab(-1);
      const newCards = document.querySelectorAll('#component-palette .dsgn-palette-card');
      this.designerPaletteIndex = Math.max(0, newCards.length - 1);
      this._applyDesignerPaletteFocus();
      return;
    }
    if (newIdx >= cards.length) {
      this._navigateDesignerTab(1);
      this.designerPaletteIndex = 0;
      this._applyDesignerPaletteFocus();
      return;
    }
    this.designerPaletteIndex = newIdx;
    this._applyDesignerPaletteFocus();
  }

  _applyDesignerPaletteFocus() {
    const cards = document.querySelectorAll('#component-palette .dsgn-palette-card');
    cards.forEach(c => c.classList.remove('kb-focus'));
    if (this.focusRow === 2 && this.designerPaletteIndex >= 0 && this.designerPaletteIndex < cards.length) {
      const focused = cards[this.designerPaletteIndex];
      focused.classList.add('kb-focus');
      focused.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }
  }

  _getDesignerPaletteKeys() {
    const cards = document.querySelectorAll('#component-palette .dsgn-palette-card');
    const keys = [];
    cards.forEach(card => {
      // Cards fire renderer._onToolSelect(key) on click, key stored in closure
      // We need to extract the component type — stored as data attribute
      if (card.dataset.compType) keys.push(card.dataset.compType);
    });
    return keys;
  }

  _confirmPaletteSelection() {
    // Default action: replace if component selected, insert after if at end
    if (this.insertMode) {
      this._paletteInsert();
    } else {
      this._paletteReplace();
    }
  }

  _paletteReplace() {
    const cards = document.querySelectorAll('#component-palette .dsgn-palette-card');
    if (this.designerPaletteIndex < 0 || this.designerPaletteIndex >= cards.length) return;
    // Simulate click to trigger replace
    cards[this.designerPaletteIndex].click();
  }

  _paletteInsert() {
    const cards = document.querySelectorAll('#component-palette .dsgn-palette-card');
    if (this.designerPaletteIndex < 0 || this.designerPaletteIndex >= cards.length) return;
    // Set insert mode to nearest edge and click
    this.insertMode = 'nearest';
    this._updateInsertButtons();
    cards[this.designerPaletteIndex].click();
  }

  // --- Pan / Zoom ---

  panLeft() {
    const speed = Math.max(8, this.draftNodes.length * 3) / this.viewZoom;
    this.viewX -= speed; this._clampViewX(); this._renderAll();
  }
  panRight() {
    const speed = Math.max(8, this.draftNodes.length * 3) / this.viewZoom;
    this.viewX += speed; this._clampViewX(); this._renderAll();
  }

  zoomAt(delta, cursorFraction) {
    const oldZoom = this.viewZoom;
    this.viewZoom = Math.max(0.5, Math.min(10, this.viewZoom * (1 - delta * 0.001)));
    const viewWidth = this.totalLength / this.viewZoom;
    this.viewX += (cursorFraction * this.totalLength / oldZoom) - (cursorFraction * viewWidth);
    this._clampViewX();
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
      if (comp) this.totalLength += (comp.subL || 4) * 0.5;
    }
    if (this.totalLength === 0) this.totalLength = 1;
  }

  /** Clamp viewX so scrolling can't go past the start or end of the beamline. */
  _clampViewX() {
    if (this.draftNodes.length === 0) { this.viewX = 0; return; }
    const canvas = document.getElementById('dsgn-schematic-canvas');
    if (!canvas) return;
    const W = canvas.parentElement.getBoundingClientRect().width;
    const SCHEM_PW = 70;
    const compWidths = this.draftNodes.map(n => {
      const comp = COMPONENTS[n.type];
      const len = comp ? (comp.subL || 4) * 0.5 : 1;
      return Math.max(SCHEM_PW, Math.round(len * SCHEM_PW / 5));
    });
    const totalPW = compWidths.reduce((s, w) => s + w, 0);
    const baseZoom = W / (5 * SCHEM_PW + 40);
    const effZoom = this.viewZoom * baseZoom;
    // viewX is in "beamline-meters" scaled by effectiveZoom to get panOffsetPx
    // panOffsetPx = -viewX * effZoom; xPos starts at 20 + panOffsetPx
    // Left edge: first component at x=20+panOffsetPx >= -margin
    // Right edge: last component ends at 20+panOffsetPx+totalPW*effZoom <= W+margin
    const margin = W * 0.15;
    const totalRenderedW = totalPW * effZoom;
    const minPanPx = -(totalRenderedW - W + 20 + margin);
    const maxPanPx = 20 + margin;
    // panOffsetPx = -viewX * effZoom
    const maxViewX = -minPanPx / effZoom;
    const minViewX = -maxPanPx / effZoom;
    this.viewX = Math.max(minViewX, Math.min(maxViewX, this.viewX));
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
        subL: comp.subL || 4,
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

    // Update totalLength from envelope to stay in sync with physics s-values
    if (this.draftEnvelope && this.draftEnvelope.length > 0) {
      const maxS = this.draftEnvelope[this.draftEnvelope.length - 1].s;
      if (maxS > 0) this.totalLength = maxS;
    }

    // Compute ghost quad suggestions from focus urgency
    this._computeGhostQuads();
  }

  /**
   * Compute suggested quad positions from focus urgency data.
   * Returns array of { s, nodeIndex, polarity } objects.
   */
  _computeGhostQuads() {
    this.ghostQuads = [];
    const env = this.draftEnvelope;
    if (!env || env.length < 2) return;

    const URGENCY_THRESHOLD = 0.7;

    // Find s-positions of existing quads
    const quadTypes = new Set([
      'quadrupole', 'scQuad', 'protonQuad', 'combinedFunctionMagnet',
    ]);
    const existingQuadS = [];
    let lastQuadPolarity = 1; // default: first ghost is Focus X
    let cumS = 0;
    for (const node of this.draftNodes) {
      const comp = COMPONENTS[node.type];
      const compLen = (comp ? comp.subL || 4 : 4) * 0.5;
      if (quadTypes.has(node.type)) {
        existingQuadS.push(cumS + compLen / 2);
        // Track last quad polarity for alternation
        const p = node.params?.polarity;
        lastQuadPolarity = (p === 1) ? -1 : 1; // next should be opposite
      }
      cumS += compLen;
    }

    // Estimate one cell length for "nearby" check
    // Use ref_focal from the beam energy at midpoint
    const midEnv = env[Math.floor(env.length / 2)];
    const pGev = midEnv ? midEnv.energy : 0.01;
    const refFocal = pGev / (0.2998 * 20.0 * 2.0);
    const cellLength = Math.max(refFocal * 2, 3.0);

    let inUrgentRegion = false;
    for (let i = 0; i < env.length; i++) {
      const d = env[i];
      const urgency = d.focus_urgency || 0;

      if (urgency >= URGENCY_THRESHOLD && !inUrgentRegion) {
        inUrgentRegion = true;
        const ghostS = d.s || 0;

        // Check if an existing quad is nearby (within one cell length ahead)
        const hasNearbyQuad = existingQuadS.some(qs =>
          qs >= ghostS && qs <= ghostS + cellLength
        );
        if (hasNearbyQuad) continue;

        // Map s-position to node index
        let nodeIdx = 0;
        let accS = 0;
        for (let j = 0; j < this.draftNodes.length; j++) {
          const comp = COMPONENTS[this.draftNodes[j].type];
          accS += (comp ? comp.subL || 4 : 4) * 0.5;
          if (accS >= ghostS) { nodeIdx = j; break; }
        }

        // Alternate polarity from last real or ghost quad
        const polarity = lastQuadPolarity;
        lastQuadPolarity = polarity === 1 ? -1 : 1;

        this.ghostQuads.push({ s: ghostS, nodeIndex: nodeIdx, polarity });
      } else if (urgency < URGENCY_THRESHOLD * 0.8) {
        inUrgentRegion = false;
      }
    }
  }

  /**
   * Insert a quad at a ghost marker position.
   * Activates insert mode at the ghost's node index with focusing category selected.
   */
  _insertGhostQuad(ghost) {
    // Move marker to ghost position
    this.markerS = ghost.s;

    // Select the node at the ghost position
    this.selectedIndex = Math.min(ghost.nodeIndex, this.draftNodes.length - 1);

    // Activate insert mode
    this.insertMode = 'nearest';
    this._updateInsertButtons();

    // Set focus row to palette
    this.focusRow = 1;
    this._updateFocusRowVisuals();

    this._renderAll();
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
    const replaceBtn = document.getElementById('dsgn-action-replace');
    const insertBtn = document.getElementById('dsgn-action-insert');
    if (replaceBtn) replaceBtn.classList.toggle('active', !this.insertMode);
    if (insertBtn) insertBtn.classList.toggle('active', !!this.insertMode);
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

  serializeState() {
    if (!this.isOpen) return null;
    return {
      isOpen: true,
      mode: this.mode,
      beamlineId: this.beamlineId,
      designId: this.designId,
      designName: this.designName,
      draftNodes: this.draftNodes.map(n => ({
        id: n.id,
        type: n.type,
        params: n.params ? { ...n.params } : {},
        bendDir: n.bendDir || null,
      })),
      selectedIndex: this.selectedIndex,
      viewX: this.viewX,
      viewZoom: this.viewZoom,
    };
  }

  restoreState(state) {
    if (!state || !state.isOpen) return;

    if (state.mode === 'edit' && state.beamlineId) {
      const entry = this.game.registry.get(state.beamlineId);
      if (entry) {
        this.open(state.beamlineId);
        // Restore draft nodes from saved state
        this.draftNodes = state.draftNodes.map(n => ({
          id: n.id,
          type: n.type,
          col: 0, row: 0, dir: 0, entryDir: 0,
          parentId: null, bendDir: n.bendDir || null, tiles: [],
          params: n.params ? { ...n.params } : {},
          computedStats: null,
        }));
        this.selectedIndex = state.selectedIndex;
        this.viewX = state.viewX;
        this.viewZoom = state.viewZoom;
        this._updateTotalLength();
        this._recalcDraft();
        this._updateDraftBar();
        this._renderAll();
      }
    } else if (state.mode === 'design') {
      const design = state.designId ? this.game.getDesign(state.designId) : null;
      this.openDesign(design);
      // Override draft with saved state
      this.draftNodes = state.draftNodes.map(n => ({
        id: n.id,
        type: n.type,
        col: 0, row: 0, dir: 0, entryDir: 0,
        parentId: null, bendDir: n.bendDir || null, tiles: [],
        params: n.params ? { ...n.params } : {},
        computedStats: null,
      }));
      this.designName = state.designName;
      this.selectedIndex = state.selectedIndex;
      this.viewX = state.viewX;
      this.viewZoom = state.viewZoom;
      this._nextTempId = this.draftNodes.length;
      this._updateTotalLength();
      this._recalcDraft();
      this._updateDesignerHeader();
      this._updateDraftBar();
      this._renderAll();
    }
  }

  // --- Rendering (placeholders — filled in by designer-renderer.js) ---

  _renderAll() {}
  _renderSchematic() {}
  _renderTuning() {}
  _renderPlots() {}
}
