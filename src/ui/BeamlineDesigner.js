// src/ui/BeamlineDesigner.js — Beamline Designer View
// Full-screen 2D view for inspecting and editing a beamline with live physics preview.

import { COMPONENTS } from '../data/components.js';
import { getBeamlineType } from '../data/beamline-types.js';
import { RESEARCH_PHYSICS_EFFECT_KEYS } from '../data/research.js';
import { BeamPhysics } from '../beamline/physics.js';
import { PARAM_DEFS } from '../beamline/component-physics.js';
import { ContextWindow } from './ContextWindow.js';
import { flattenPath } from '../beamline/flattener.js';
import { planDesignerApply } from '../beamline/designer-plan.js';
import { executeDesignerApply } from '../beamline/designer-apply.js';
import { makeDraggable } from './draggable.js';
import { pushEscHandler } from './esc-stack.js';
import { applyPreviewDialog } from './ApplyPreviewDialog.js';
import { DesignNameDialog } from './DesignNameDialog.js';
import {
  computeBeamlinePlacementHints,
  computePlacementHints,
  missionPlotTargets,
  placementHintComponentAvailable,
  recommendedQuadrupoleGradient,
} from '../beamline/designer-placement-hints.js';
import { planDesignerAutoTune } from '../beamline/designer-auto-tuning.js';
import {
  commissioningReport,
  inferInjectorTargetS,
  optimizeInjectorMagnets,
} from '../beamline/injector-commissioning.js';
import { seedComponentParams } from '../beamline/component-params.js';
import { buildDesignerPhysicsElements } from '../beamline/physics-payload.js';
import { summarizeDesignerPlacement } from '../beamline/designer-placement-preview.js';
import { computeBeamlineRevenueBreakdown } from '../game/economy.js';
import {
  addDesignerPlotTag,
  createDesignerPlotYRanges,
  designerPlotPrimaryAxis,
  designerPlotTagCount,
  formatDesignerPlotBound,
  suggestDesignerFixedYRange,
  validateDesignerFixedYRange,
} from './designer-plot-controls.js';

/**
 * Physical length (in sub-units) of one draft node.
 *
 * Drifts are the only variable-length element in the model, and in edit mode
 * `openFromSource` copies each one's REAL length off flattenPath — so falling
 * back to the 2 m `COMPONENTS.drift` template modelled a 51 m unfocused drift
 * as 2 m. The schematic already honoured node.subL, so the window drew a long
 * drift wide while running physics on a short one. Inline attachments are the
 * other deliberate exception: their visual catalogue length remains authored,
 * while the physics draft treats them as zero-length thin elements.
 */
function _nodeSubL(node) {
  const c = node ? COMPONENTS[node.type] : null;
  if (c?.attachmentKind === 'inline') return 0;
  if (node && typeof node.subL === 'number' && node.subL > 0) return node.subL;
  return (c && c.subL) || 4;
}

/**
 * Physics-aware defaults for a component newly placed at the blue marker.
 * Existing components and explicit caller/hint parameters always win.
 */
function _localOpticsDefaults(designer, type) {
  const gradientDef = PARAM_DEFS[type]?.gradient;
  if (!gradientDef || !['quadrupole', 'scQuad'].includes(type)) return {};
  // Physics can still be booting when the player makes the first edit. The
  // minimum is a safe temporary seed; retaining the 20 T/m catalogue default
  // would recreate the original low-energy blow-up precisely on that path.
  if (!designer.draftEnvelope?.length) return { gradient: gradientDef.min };

  let datum = designer.draftEnvelope[0];
  let bestDistance = Infinity;
  for (const candidate of designer.draftEnvelope) {
    const distance = Math.abs((candidate.s || 0) - (designer.markerS || 0));
    if (distance < bestDistance) {
      bestDistance = distance;
      datum = candidate;
    }
  }

  const typeId = designer._designerBeamlineTypeId?.();
  const particle = (typeId && getBeamlineType(typeId)?.particle) || 'e-';
  return {
    gradient: recommendedQuadrupoleGradient({
      kineticEnergyGeV: datum.energy,
      particle,
      lengthM: _nodeSubL({ type }) * 0.5,
      min: gradientDef.min,
      max: gradientDef.max,
      step: gradientDef.step,
    }),
  };
}

function _designerComponentParams(designer, type, initialParams = null) {
  const params = seedComponentParams(type);
  Object.assign(params, _localOpticsDefaults(designer, type));

  // Physics hints may supply a starting point, but only for a declared,
  // non-derived control and only inside its authored range.
  if (initialParams && typeof initialParams === 'object') {
    const defs = PARAM_DEFS[type] || {};
    for (const [key, value] of Object.entries(initialParams)) {
      const def = defs[key];
      if (!def || def.derived || !Number.isFinite(value)) continue;
      const lo = Number.isFinite(def.min) ? def.min : value;
      const hi = Number.isFinite(def.max) ? def.max : value;
      params[key] = Math.max(lo, Math.min(hi, value));
    }
  }
  return params;
}

function _commissioningPercent(value) {
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : '--';
}

function _commissioningDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--';
  if (seconds < 1e-12) return `${(seconds * 1e15).toFixed(0)} fs`;
  if (seconds < 1e-9) return `${(seconds * 1e12).toFixed(0)} ps`;
  return `${(seconds * 1e9).toFixed(1)} ns`;
}

function _commissioningTone(value, good, watch) {
  if (!Number.isFinite(value)) return '';
  if (value >= good) return 'good';
  if (value >= watch) return 'watch';
  return 'bad';
}

export class BeamlineDesigner {
  constructor(game, renderer) {
    this.game = game;
    this.renderer = renderer;
    this.isOpen = false;
    this.beamlineId = null;

    // Pipe-graph edit mode state (set by openFromSource, null otherwise).
    // When editSourceId is non-null, confirm() reconciles to pipe graph
    // instead of the legacy registry.
    this.editSourceId = null;
    this.editEndpointId = null;
    this.availableEndpoints = [];
    this._originalPlacementIds = new Set();
    this._originalModuleIds = new Set();

    // Draft state
    this.draftNodes = [];       // cloned ordered node list
    this.originalNodes = [];    // snapshot for diffing
    this.draftEnvelope = null;  // physics result for draft
    this.draftPhysicsResult = null; // terminal metrics used by the plot mission readout
    // Published alongside the physics result so the renderer only formats a
    // canonical economy projection; it never assembles revenue terms itself.
    this.draftRevenueProjection = null;
    // Physics result for originalNodes — the beamline as actually built, so the
    // plots can show what the draft changes rather than only where it lands.
    // Null in sandbox mode (openDesign), where there is no "current" at all.
    // Computed once per open, never on the edit path: it cannot change while
    // the draft is being edited, so recomputing it per keystroke would double
    // the cost of every slider drag for an identical answer.
    this.baselineEnvelope = null;
    this.baselinePhysicsResult = null;
    this._baselinePending = false;  // baseline deferred until physics is ready
    this.physicsPending = false;
    this._draftPhysicsRevision = 0;
    this._baselinePhysicsRevision = 0;
    // Utility lines a moveJunction op could not re-route, counted per apply.
    this._danglingLineCount = 0;
    // Physics-driven, non-mutating insertion recipes. `ghostQuads` remains a
    // focus-only compatibility view for Stubby and older tests; all designer
    // rendering and one-click insertion use placementHints.
    this.placementHints = [];
    this.ghostQuads = [];
    this._hoverSchematicX = null;
    this.selectedIndex = -1;    // index into draftNodes

    // Mode: 'edit' (from placed beamline) or 'design' (standalone sandbox)
    this.mode = 'edit';
    this.designId = null;       // ID of saved design being edited (design mode only)
    this.designName = '';       // editable name for design mode
    this.draftWorkspaceId = null;       // beamline-owned persistent workspace
    this.activeWorkspaceDraftId = null; // Current or Design N tab
    this._activeDraftOpenSnapshot = null;

    // Viewport (shared between schematic and along-s plots)
    this.viewX = 0;             // horizontal pan offset in beamline-meters
    this.viewZoom = 0.7;          // zoom level (1 = fit-all)
    this.totalLength = 0;       // total beamline length in meters

    // Continuous marker position along s (meters)
    this.markerS = 0;
    this._markerDir = 0;      // -1, 0, or +1 for continuous panning
    this._markerAnimId = null; // requestAnimationFrame id
    this._panDir = 0;         // -1, 0, or +1 for continuous schematic panning
    this._panAnimId = null;   // requestAnimationFrame id

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

    // Plot range modes. Each panel owns its primary Y-axis bounds because the
    // panels may show quantities with unrelated units.
    this.plotRangeMode = 'full';   // x: 'full', '30', '9'
    this.plotYRanges = createDesignerPlotYRanges();
    this._lastAutoPlotYDomains = new Map();
    this.plotSource = 'proposed';  // 'proposed' | 'current' | 'both'
    this.plotYAxisModes = ['linear', 'linear', 'linear'];
    this.plotReference = 'mission'; // 'mission' | 'none'
    this._plotHoverPositions = new Map(); // panel id -> normalized canvas x/y
    this._plotHoverFrame = null;
    this.plotTags = new Map(); // panel id -> up to two persistent solver-sample readouts
    this.tuningPanelExpanded = true;

    // Opt-in automatic matching. It is a session preference rather than a
    // property of the built machine; only the resulting component params are
    // saved/applied. The summary feeds the compact lower-right status readout.
    this.autoTuneEnabled = false;
    this._lastAutoTuneSummary = null;
    this.commissioningBusy = false;
    this._commissioningRun = 0;
    this._commissioningProgress = null;
    this._lastCommissioningResult = null;
    this._commissioningApplying = false;

    // DOM references
    this.overlay = document.getElementById('designer-overlay');
    this.summaryEl = document.getElementById('dsgn-draft-summary');
    this.costEl = document.getElementById('dsgn-draft-cost');

    this._suppressHashUpdate = false;
    this._designNameDialog = new DesignNameDialog();

    this._bindButtons();
    this._bindEvents();
  }

  _bindButtons() {
    document.getElementById('dsgn-confirm').addEventListener('click', () => {
      // confirm() is async (it awaits the apply preview). Swallow the promise
      // here so a thrown apply surfaces as a log line rather than an unhandled
      // rejection nobody sees.
      Promise.resolve(this.confirm()).catch((err) => {
        console.error('[designer] apply crashed', err);
        this.game.log('Apply failed unexpectedly — nothing was changed', 'bad');
      });
    });
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
    document.getElementById('dsgn-save-design').addEventListener('click', () => {
      Promise.resolve(this.saveDesign()).catch(err => console.error('[designer] save failed', err));
    });
    document.getElementById('dsgn-save-as').addEventListener('click', () => {
      Promise.resolve(this.saveDesignAs()).catch(err => console.error('[designer] save-as failed', err));
    });
    const workspaceTabs = document.getElementById('dsgn-workspace-tabs');
    workspaceTabs?.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.dataset.action === 'new-draft') {
        this._createWorkspaceAlternative();
      } else if (button.dataset.draftId) {
        this._switchWorkspaceDraft(button.dataset.draftId);
      }
    });
    const autoTune = document.getElementById('dsgn-auto-tune');
    if (autoTune) {
      autoTune.addEventListener('change', () => {
        this._setAutoTuneEnabled(autoTune.checked);
      });
    }
    const commission = document.getElementById('dsgn-commissioning-optimize');
    commission?.addEventListener('click', () => {
      Promise.resolve(this._optimizeInjectorSection()).catch(err => {
        console.error('[designer] injector commissioning failed', err);
      });
    });
    const tuningToggle = document.getElementById('dsgn-tuning-toggle');
    if (tuningToggle) {
      tuningToggle.addEventListener('click', () => {
        this._setTuningPanelExpanded(!this.tuningPanelExpanded);
      });
    }
  }

  _setTuningPanelExpanded(expanded) {
    this.tuningPanelExpanded = expanded !== false;
    const toggle = document.getElementById('dsgn-tuning-toggle');
    const row = document.getElementById('dsgn-tuning-row');
    const label = document.getElementById('dsgn-tuning-toggle-label');
    row?.classList.toggle('is-collapsed', !this.tuningPanelExpanded);
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(this.tuningPanelExpanded));
      toggle.setAttribute('aria-label', this.tuningPanelExpanded
        ? 'Collapse component details'
        : 'Expand component details');
    }
    if (label) label.textContent = this.tuningPanelExpanded ? 'Hide' : 'Show';

    // Canvas backing sizes are derived from their laid-out CSS rectangles.
    // Redraw one frame after the panel changes so the plots claim the height
    // released by a collapsed details strip (and shrink cleanly when reopened).
    if (this.isOpen) {
      requestAnimationFrame(() => {
        if (this.isOpen) this._renderAll();
      });
    }
  }

  _bindEvents() {
    // Keyboard handler (only active when controller is open)
    this._onKeyDown = (e) => {
      if (!this.isOpen) return;
      // Escape belongs to the global esc-stack (we push a handler while
      // open — see openFromSource/openDesign); every other key is swallowed
      // at capture phase so game hotkeys (pause, mode buttons, palette,
      // Space-place) never fire underneath the full-screen designer. This
      // replaces the old InputHandler `_designer.isOpen` guard, so it must
      // swallow even with focus in a designer input/select.
      if (e.key === 'Escape') return;
      e.stopPropagation();
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
            this._startPan(-1);
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
            this._startPan(1);
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
          this._startPan(-1);
          break;
        case 'd': case 'D':
          e.preventDefault();
          e.stopPropagation();
          this._startPan(1);
          break;
        case 'w': case 'W':
          e.preventDefault();
          e.stopPropagation();
          this.panToStart();
          break;
        case 's': case 'S':
          e.preventDefault();
          e.stopPropagation();
          this.panToEnd();
          break;
        case 'Delete': case 'Backspace':
          e.preventDefault();
          e.stopPropagation();
          this.removeComponent(this.selectedIndex);
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
        if (this.focusRow === 0) this._stopPan();
      }
      if (e.key === 'a' || e.key === 'A' || e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        e.stopPropagation();
        this._stopPan();
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

      makeDraggable(schematicCanvas, schematicCanvas, {
        preventDefault: false,
        onStart: (e) => {
          if (!this.isOpen) return false;
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
        },
        onMove: (e) => {
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
        },
        onEnd: () => {
          if (reorderDragging && dragDistance > 5 && this._reorderDropIndex >= 0) {
            this._reorderComponent(reorderSourceIndex, this._reorderDropIndex);
          }
          this._reorderDropIndex = -1;
          dragging = false;
          reorderDragging = false;
          reorderSourceIndex = -1;
          this._renderAll();
        },
      });

      schematicCanvas.addEventListener('click', (e) => {
        if (!this.isOpen) return;
        if (dragDistance > 5) return;  // was a drag, not a click
        const rect = schematicCanvas.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;

        // Check ghost quad click first. Ghost regions are recorded in the same
        // CSS-pixel space as _compRegions — the renderer applies its own
        // ctx.scale(dpr, dpr) — so they compare against clickX directly.
        if (this._ghostRegions) {
          for (const gr of this._ghostRegions) {
            if (clickX >= gr.x && clickX <= gr.x + gr.w &&
                clickY >= gr.y && clickY <= gr.y + gr.h) {
              this._acceptPlacementHint(gr.hint || gr.ghost);
              return;
            }
          }
        }

        this._placeMarkerAtClickX(clickX);
        this.focusRow = 0;
        this._updateFocusRowVisuals();
        this._renderAll();
      });

      // Pointer-local advice. This does not move the blue inspection marker or
      // re-run physics: it only asks the schematic to reveal the closest
      // already-computed build hint. A single rAF coalesces dense mousemove
      // events so the canvas stays responsive on long lattices.
      schematicCanvas.addEventListener('mousemove', (e) => {
        if (!this.isOpen || dragging || reorderDragging) return;
        const rect = schematicCanvas.getBoundingClientRect();
        this._hoverSchematicX = e.clientX - rect.left;
        if (this._hoverHintFrame) return;
        this._hoverHintFrame = requestAnimationFrame(() => {
          this._hoverHintFrame = null;
          if (this.isOpen) this._renderSchematic();
        });
      });
      schematicCanvas.addEventListener('mouseleave', () => {
        this._hoverSchematicX = null;
        if (this.isOpen) this._renderSchematic();
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

    // Focus advisor readout — step the marker through the suggestions
    const advisorReadout = document.getElementById('dsgn-advisor-readout');
    if (advisorReadout) {
      advisorReadout.addEventListener('click', () => {
        if (!this.isOpen) return;
        this._jumpToNextPlacementHint();
      });
    }

    // Primary and optional overlay plot selectors — the renderer validates
    // whether all three channels can share a distance axis.
    document.querySelectorAll(
      '.dsgn-plot-select, .dsgn-plot-secondary-select, .dsgn-plot-tertiary-select'
    ).forEach(select => {
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

    // Each panel toggles independently between its current solver autoscale and
    // explicit primary-axis bounds. Fixed mode is seeded from the last drawn
    // auto domain so the toggle itself does not move the trace.
    document.querySelectorAll('.dsgn-plot-y-mode').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!this.isOpen) return;
        const panel = Number(btn.dataset.panel);
        const current = this.plotYRanges[panel] || { mode: 'auto', min: null, max: null };
        if (current.mode === 'fixed') {
          this.plotYRanges[panel] = { ...current, mode: 'auto' };
        } else {
          this.plotYRanges[panel] = suggestDesignerFixedYRange(
            this._lastAutoPlotYDomains.get(String(panel))?.[0],
            this.plotYAxisModes?.[panel] === 'log' ? 'log' : 'linear',
          );
        }
        this._renderPlots();
      });
    });

    document.querySelectorAll('.dsgn-plot-y-bound').forEach(input => {
      const applyBound = () => {
        if (!this.isOpen) return;
        const controls = input.closest('.dsgn-plot-y-controls');
        const panel = Number(controls?.dataset.panel);
        const minInput = controls?.querySelector('[data-bound="min"]');
        const maxInput = controls?.querySelector('[data-bound="max"]');
        const scale = Number(controls?.dataset.axisScale) || 1;
        const minText = minInput?.value.trim() || '';
        const maxText = maxInput?.value.trim() || '';
        const candidate = {
          mode: 'fixed',
          min: minText === '' ? NaN : Number(minText) / scale,
          max: maxText === '' ? NaN : Number(maxText) / scale,
        };
        const panelAxisMode = this.plotYAxisModes?.[panel] === 'log' ? 'log' : 'linear';
        const validation = validateDesignerFixedYRange(candidate, panelAxisMode);
        for (const boundInput of [minInput, maxInput]) {
          if (!boundInput) continue;
          boundInput.setCustomValidity(validation.error);
          boundInput.setAttribute('aria-invalid', validation.valid ? 'false' : 'true');
        }
        if (!validation.valid) return;
        this.plotYRanges[panel] = candidate;
        this._renderPlots();
      };
      input.addEventListener('input', applyBound);
      input.addEventListener('blur', () => {
        const controls = input.closest('.dsgn-plot-y-controls');
        const panel = Number(controls?.dataset.panel);
        const plotType = controls?.closest('.dsgn-plot-options')
          ?.querySelector('.dsgn-plot-select')?.value;
        this.syncPlotYRangeControl(
          String(panel),
          plotType,
          this._lastAutoPlotYDomains.get(String(panel)),
          true,
        );
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
      });
    });

    // Plot source buttons (Proposed / Current / Both)
    document.querySelectorAll('.dsgn-source-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!this.isOpen) return;
        this.plotSource = btn.dataset.source;
        document.querySelectorAll('.dsgn-source-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._renderPlots();
      });
    });

    document.querySelectorAll('.dsgn-plot-scale-select').forEach(select => {
      select.addEventListener('change', () => {
        if (!this.isOpen) return;
        const panelIndex = Number.parseInt(select.dataset.panel, 10);
        if (!Number.isInteger(panelIndex) || panelIndex < 0) return;
        const nextMode = select.value === 'log' ? 'log' : 'linear';
        this.plotYAxisModes[panelIndex] = nextMode;
        const range = this.plotYRanges[panelIndex];
        if (nextMode === 'log' && range?.mode === 'fixed'
          && !validateDesignerFixedYRange(range, 'log').valid) {
          this.plotYRanges[panelIndex] = suggestDesignerFixedYRange(
            this._lastAutoPlotYDomains.get(String(panelIndex))?.[0],
            'log',
          );
        }
        this._renderPlots();
      });
    });

    const referenceSelect = document.getElementById('dsgn-plot-reference-select');
    if (referenceSelect) {
      referenceSelect.addEventListener('change', () => {
        if (!this.isOpen) return;
        this.plotReference = referenceSelect.value === 'none' ? 'none' : 'mission';
        this._renderPlots();
      });
    }

    // Plot hover readouts and mousewheel zoom. Pointer movement only redraws
    // the already-computed envelopes; a shared rAF prevents dense move events
    // from rebuilding all three plot canvases more than once per frame.
    document.querySelectorAll('.dsgn-plot-canvas').forEach(canvas => {
      canvas.addEventListener('mousemove', (e) => {
        if (!this.isOpen) return;
        const rect = canvas.getBoundingClientRect();
        const panel = canvas.dataset.panel || '0';
        this._plotHoverPositions.set(panel, {
          x: Math.max(0, Math.min(1, (e.clientX - rect.left) / (rect.width || 1))),
          y: Math.max(0, Math.min(1, (e.clientY - rect.top) / (rect.height || 1))),
        });
        if (this._plotHoverFrame) return;
        this._plotHoverFrame = requestAnimationFrame(() => {
          this._plotHoverFrame = null;
          if (this.isOpen) this._renderPlots();
        });
      });
      canvas.addEventListener('mouseleave', () => {
        this._plotHoverPositions.delete(canvas.dataset.panel || '0');
        if (this.isOpen) this._renderPlots();
      });
      canvas.addEventListener('click', (e) => {
        if (!this.isOpen) return;
        // At-a-point plots have no distance cursor to attach a tag to.
        if (canvas.closest('.dsgn-plot-panel')?.classList.contains('dsgn-plot-panel--geometric')) {
          return;
        }
        const rect = canvas.getBoundingClientRect();
        const panel = canvas.dataset.panel || '0';
        addDesignerPlotTag(this.plotTags, panel, {
          s: null,
          x: Math.max(0, Math.min(1, (e.clientX - rect.left) / (rect.width || 1))),
          y: Math.max(0, Math.min(1, (e.clientY - rect.top) / (rect.height || 1))),
        });
        // Avoid drawing the same sample twice on the click frame. The next
        // pointer movement adds a separate live preview without hiding tags.
        this._plotHoverPositions.delete(panel);
        this._renderPlots();
      });
      canvas.addEventListener('wheel', (e) => {
        if (!this.isOpen) return;
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const fraction = (e.clientX - rect.left) / rect.width;
        this.zoomAt(e.deltaY, fraction);
      }, { passive: false });
    });

    const clearPlotMarker = document.getElementById('dsgn-clear-plot-marker');
    if (clearPlotMarker) {
      clearPlotMarker.addEventListener('click', () => {
        if (!this.isOpen || designerPlotTagCount(this.plotTags) === 0) return;
        this.plotTags.clear();
        this._renderPlots();
      });
    }

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

  /**
   * Claim an esc-stack slot for the lifetime of the open designer. Esc
   * steps the keyboard focus row back toward the schematic, then closes.
   * (A modal DesignLibrary opened on top pushes later, so it wins Esc
   * first — the old capture-phase race is gone.)
   */
  _pushEsc() {
    if (this._escUnsub) return;
    this._escUnsub = pushEscHandler((e) => {
      // Inert while typing in a designer field (legacy behavior: Esc did
      // nothing there). Consume so the game's fallback sweep doesn't run
      // underneath the open designer.
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (this.focusRow > 0) {
        this.focusRow--;
        if (this.focusRow < 2) this.designerPaletteIndex = -1;
        this._updateFocusRowVisuals();
      } else {
        this.close();
      }
      return true;
    });
  }

  /**
   * Open edit mode for a beamline rooted at the given source placeable.
   * Walks the pipe graph via flattenPath and populates draftNodes.
   *
   * @param {string} sourceId - placeable id of the source module
   * @param {string} [endpointId] - optional endpoint id (currently unused,
   *   retained for future multi-endpoint support).
   */
  openFromSource(sourceId, endpointId = null) {
    if (!sourceId) return;
    // Router-driven switches can replace one open Designer session without
    // calling close(). Checkpoint the outgoing beamline before any of its
    // fields are overwritten by the new source.
    if (this.isOpen) this._saveActiveWorkspaceDraft();

    this.isOpen = true;
    this._pushEsc();
    this.mode = 'edit';
    this.beamlineId = null;  // not a registry-backed beamline
    this.designId = null;
    this.designName = '';
    this.editSourceId = sourceId;

    this.availableEndpoints = [];
    this.editEndpointId = endpointId;

    this._syncDraftFromMap();
    this._openBeamlineDraftWorkspace();

    this.markerS = 0;
    this.focusRow = 0;
    this.designerPaletteIndex = -1;
    this.insertMode = 'nearest';
    this.plotRangeMode = 'full';
    this.plotYRanges = createDesignerPlotYRanges();
    this._lastAutoPlotYDomains.clear();
    this.plotSource = 'proposed';
    this.plotYAxisModes = ['linear', 'linear', 'linear'];
    this.plotReference = 'mission';
    this._plotHoverPositions.clear();
    this.plotTags.clear();

    this._updateTotalLength();
    this._recalcDraft();
    // Baseline last: originalNodes is the snapshot taken above, and _recalcDraft
    // is what pins totalLength, so the two envelopes share an s-axis.
    this._recalcBaseline();

    // Close any popups
    ContextWindow.closeAll();
    this.renderer.hidePopup();

    // Show overlay
    this.overlay.classList.remove('hidden');
    const bottomHud = document.getElementById('bottom-hud');
    if (bottomHud) {
      bottomHud.style.zIndex = '260';
      bottomHud.classList.add('designer-active');
    }
    const paletteActions = document.getElementById('dsgn-palette-actions');
    if (paletteActions) paletteActions.classList.remove('hidden');

    this._setupDesignerTabs();
    this._updateDesignerHeader();
    this._updateDraftBar();
    this._renderAll();

    window.location.hash = `designer?src=${sourceId}`;
  }

  /** Plain save-safe shape shared by closed workspaces and open-session aux. */
  _draftPayload(nodes = this.draftNodes) {
    return {
      draftNodes: (nodes || []).map(n => ({
        id: n.id,
        type: n.type,
        params: n.params ? { ...n.params } : {},
        bendDir: n.bendDir || null,
        subL: n.subL,
        _pipeKind: n._pipeKind,
        _sourceRef: n._sourceRef ? { ...n._sourceRef } : undefined,
        _targetPipeId: n._targetPipeId,
        _targetPosition: n._targetPosition,
        _insertMode: n._insertMode,
      })),
      selectedIndex: this.selectedIndex,
      viewX: this.viewX,
      viewZoom: this.viewZoom,
      autoTuneEnabled: this.autoTuneEnabled === true,
      hasChanges: this.mode === 'edit' && this._nodesDiffer(nodes, this.originalNodes),
    };
  }

  _inflateDraftNodes(nodes) {
    return (nodes || []).map(n => ({
      id: n.id,
      type: n.type,
      col: 0, row: 0, dir: 0, entryDir: 0,
      parentId: null, bendDir: n.bendDir || null, tiles: [],
      params: n.params ? { ...n.params } : {},
      computedStats: null,
      subL: n.subL,
      _pipeKind: n._pipeKind,
      _sourceRef: n._sourceRef ? { ...n._sourceRef } : (n._pipeKind ? {} : undefined),
      _targetPipeId: n._targetPipeId,
      _targetPosition: n._targetPosition,
      _insertMode: n._insertMode,
    }));
  }

  _loadWorkspaceDraft(draft) {
    if (!draft) return;
    this.draftNodes = this._inflateDraftNodes(draft.draftNodes);
    this.selectedIndex = Number.isInteger(draft.selectedIndex)
      ? Math.max(-1, Math.min(draft.selectedIndex, this.draftNodes.length - 1))
      : (this.draftNodes.length ? 0 : -1);
    this.viewX = Number.isFinite(draft.viewX) ? draft.viewX : 0;
    this.viewZoom = Number.isFinite(draft.viewZoom) ? draft.viewZoom : 0.7;
    this.autoTuneEnabled = draft.autoTuneEnabled === true;
    this._nextTempId = this.draftNodes.length;
    this._undoStack = [];
    this._activeDraftOpenSnapshot = this._draftPayload();
  }

  /** Attach edit mode to this beamline's saved Current/Design N workspace. */
  _openBeamlineDraftWorkspace() {
    const entry = this.game.registry?.getBySourceId?.(this.editSourceId) || null;
    this.draftWorkspaceId = entry?.id || `source:${this.editSourceId}`;

    const existing = this.game.getBeamlineDesignerWorkspace?.(this.draftWorkspaceId);
    const currentPayload = {
      ...this._draftPayload(this.originalNodes),
      selectedIndex: this.originalNodes.length ? 0 : -1,
      viewX: 0,
      viewZoom: 0.7,
      autoTuneEnabled: false,
    };
    const workspace = this.game.ensureBeamlineDesignerWorkspace?.({
      workspaceId: this.draftWorkspaceId,
      beamlineId: entry?.id || null,
      sourceId: this.editSourceId,
      currentDraft: currentPayload,
    });
    if (!workspace) {
      this.activeWorkspaceDraftId = null;
      this.selectedIndex = this.draftNodes.length ? 0 : -1;
      this.viewX = 0;
      this.viewZoom = 0.7;
      return;
    }

    // Import the old global single-draft slot once, so upgrading does not
    // discard precisely the unplaceable draft this feature is meant to keep.
    const legacy = this.game.state.designerState;
    if (!existing && legacy?.mode === 'edit'
        && legacy.editSourceId === this.editSourceId && legacy.draftNodes?.length) {
      this.game.saveBeamlineDesignerDraft?.(
        this.draftWorkspaceId,
        'current',
        { ...legacy, hasChanges: true },
      );
    } else if (existing) {
      // Current follows the map whenever it had no pending edits. Without
      // this refresh, an ordinary map-side beamline change made while the
      // Designer was closed would turn a formerly clean tab into an
      // accidental proposal to revert the change.
      const current = workspace.drafts.find(draft => draft.id === 'current');
      if (current && current.hasChanges !== true) {
        this.game.saveBeamlineDesignerDraft?.(
          this.draftWorkspaceId,
          'current',
          { ...currentPayload, hasChanges: false },
        );
      }
    }

    this.activeWorkspaceDraftId = workspace.activeDraftId || 'current';
    const active = workspace.drafts.find(draft => draft.id === this.activeWorkspaceDraftId)
      || workspace.drafts[0];
    this.activeWorkspaceDraftId = active?.id || 'current';
    this._loadWorkspaceDraft(active);
  }

  _saveActiveWorkspaceDraft() {
    if (this.mode !== 'edit' || !this.draftWorkspaceId || !this.activeWorkspaceDraftId) {
      return null;
    }
    return this.game.saveBeamlineDesignerDraft?.(
      this.draftWorkspaceId,
      this.activeWorkspaceDraftId,
      this._draftPayload(),
    ) || null;
  }

  _switchWorkspaceDraft(draftId) {
    if (this.mode !== 'edit' || !this.draftWorkspaceId
        || draftId === this.activeWorkspaceDraftId) return;
    this._saveActiveWorkspaceDraft();
    if (!this.game.selectBeamlineDesignerDraft?.(this.draftWorkspaceId, draftId)) return;
    const workspace = this.game.getBeamlineDesignerWorkspace?.(this.draftWorkspaceId);
    const draft = workspace?.drafts?.find(candidate => candidate.id === draftId);
    if (!draft) return;
    this.activeWorkspaceDraftId = draft.id;
    this._loadWorkspaceDraft(draft);
    this.markerS = 0;
    this._lastTuningKey = null;
    this._updateTotalLength();
    this._recalcDraft();
    this._updateDraftBar();
    this._renderAll();
  }

  _createWorkspaceAlternative() {
    if (this.mode !== 'edit' || !this.draftWorkspaceId) return;
    this._saveActiveWorkspaceDraft();
    // Alternatives branch from the installed machine, not from another
    // speculative tab. That keeps each option independently comparable to
    // Current and avoids accidentally nesting one proposal inside another.
    const baseline = {
      ...this._draftPayload(this.originalNodes),
      selectedIndex: this.originalNodes.length ? 0 : -1,
      viewX: 0,
      viewZoom: 0.7,
      autoTuneEnabled: false,
      hasChanges: false,
    };
    const draft = this.game.createBeamlineDesignerAlternative?.(
      this.draftWorkspaceId,
      baseline,
    );
    if (!draft) return;
    this.activeWorkspaceDraftId = draft.id;
    this._loadWorkspaceDraft(draft);
    this.markerS = 0;
    this._lastTuningKey = null;
    this._updateTotalLength();
    this._recalcDraft();
    this._updateDraftBar();
    this._renderAll();
  }

  _renderWorkspaceTabs() {
    const root = document.getElementById('dsgn-workspace-tabs');
    if (!root) return;
    root.innerHTML = '';
    root.classList.toggle('hidden', this.mode !== 'edit' || !this.draftWorkspaceId);
    if (this.mode !== 'edit' || !this.draftWorkspaceId) return;
    const workspace = this.game.getBeamlineDesignerWorkspace?.(this.draftWorkspaceId);
    for (const draft of (workspace?.drafts || [])) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'dsgn-workspace-tab';
      button.dataset.draftId = draft.id;
      button.textContent = draft.name;
      button.classList.toggle('active', draft.id === this.activeWorkspaceDraftId);
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(draft.id === this.activeWorkspaceDraftId));
      if (draft.id === this.activeWorkspaceDraftId && this._hasDraftChanges()) {
        button.classList.add('has-changes');
      }
      button.title = draft.id === 'current'
        ? 'Working draft for the installed beamline — auto-saved on exit'
        : `${draft.name} — auto-saved alternative`;
      root.appendChild(button);
    }
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'dsgn-workspace-tab dsgn-workspace-add';
    add.dataset.action = 'new-draft';
    add.textContent = '+';
    add.title = 'New alternative from the installed beamline';
    add.setAttribute('aria-label', 'New beamline design alternative');
    root.appendChild(add);
  }

  /**
   * (Re)build draftNodes and the original-state bookkeeping by walking the map
   * from `editSourceId`. Called when the designer opens, and again after a
   * successful Apply — at that moment every node the player added is on the
   * map but still carries an EMPTY `_sourceRef`, which is exactly how the
   * planner recognises an addition. Leaving them that way would make a second
   * Apply plan the same additions all over again and build them twice.
   */
  _syncDraftFromMap() {
    // Walk the pipe graph (flattener ignores endpointId today but reserved
    // for future multi-path support).
    const flat = flattenPath(this.game.state, this.editSourceId, {
      endpointId: this.editEndpointId,
    });

    // Convert flattener entries to draftNodes format.
    // (Flattener emits kind: 'module' | 'placement' | 'drift'.)
    this.draftNodes = flat.map((entry, idx) => ({
      // Use a negative id for drift nodes (they don't have stable identity)
      id: entry.kind === 'module' ? entry.id
          : entry.kind === 'placement' ? entry.id
          : -1000 - idx,  // synthetic drift id
      type: entry.kind === 'drift' ? 'drift' : entry.type,
      col: 0, row: 0, dir: 0, entryDir: 0,
      parentId: null,
      bendDir: null,
      tiles: [],
      params: { ...(entry.params || {}) },
      computedStats: null,
      beamStart: entry.beamStart,
      subL: entry.subL,
      // Back-reference so the planner can align this node against the map
      _pipeKind: entry.kind,
      _sourceRef: entry.kind === 'module'
                  ? { placeableId: entry.id }
                  : entry.kind === 'placement'
                    ? { pipeId: entry.pipeId, placementId: entry.id, position: entry.position }
                    : { pipeId: entry.pipeId },
    }));

    // Snapshot original placement and module IDs so the draft bar can detect
    // deletions: an id here that no draft node still references was deleted.
    this._originalPlacementIds = new Set();
    this._originalModuleIds = new Set();
    for (const entry of flat) {
      if (entry.kind === 'placement') {
        this._originalPlacementIds.add(entry.id);
      } else if (entry.kind === 'module') {
        this._originalModuleIds.add(entry.id);
      }
    }

    // Snapshot originalNodes for diff (cost delta etc.)
    this.originalNodes = this.draftNodes.map(n => this._cloneNode(n));
  }

  openDesign(design = null) {
    // Same route-switch seam as openFromSource: leaving an edit workspace for
    // the standalone library must retain the beamline draft first.
    if (this.isOpen) this._saveActiveWorkspaceDraft();
    this.mode = 'design';
    this.beamlineId = null;
    this.isOpen = true;
    this._pushEsc();
    this.draftWorkspaceId = null;
    this.activeWorkspaceDraftId = null;
    this._activeDraftOpenSnapshot = null;

    // Check for saved draft state for this design
    const savedDraft = this.game.state.designerState;
    const hasSavedDraft = savedDraft && savedDraft.mode === 'design'
      && ((design && savedDraft.designId === design.id) || (!design && !savedDraft.designId));

    if (hasSavedDraft && savedDraft.draftNodes.length > 0) {
      // Restore saved draft
      this.autoTuneEnabled = savedDraft.autoTuneEnabled === true;
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
    this.plotYRanges = createDesignerPlotYRanges();
    this._lastAutoPlotYDomains.clear();
    this.plotSource = 'proposed';
    this.plotYAxisModes = ['linear', 'linear', 'linear'];
    this.plotReference = 'mission';
    this._plotHoverPositions.clear();
    this.plotTags.clear();
    this._nextTempId = this.draftNodes.length;

    this._updateTotalLength();
    this._recalcDraft();
    // Sandbox: a design library entry is not a built beamline, so there is no
    // "current" to compare against and the source toggle stays hidden. Clearing
    // the pending flag too, or a designer that opened mid-boot in edit mode
    // would have its retry fire here and grow a baseline sandbox has no use for.
    this.baselineEnvelope = null;
    this.baselinePhysicsResult = null;
    this._baselinePending = false;
    this.physicsPending = false;
    this._draftPhysicsRevision++;
    this._baselinePhysicsRevision++;
    this._updatePlotSourceBar();

    ContextWindow.closeAll();
    this.renderer.hidePopup();

    this.overlay.classList.remove('hidden');
    const bottomHud = document.getElementById('bottom-hud');
    if (bottomHud) {
      bottomHud.style.zIndex = '260';
      bottomHud.classList.add('designer-active');
    }
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

    // Endpoint selector — only shown when multiple reachable endpoints exist
    const headerEl = this.overlay?.querySelector('.dsgn-header-right') || this.overlay?.querySelector('.dsgn-header') || this.overlay;
    if (headerEl) {
      let sel = document.getElementById('designer-endpoint-selector');
      const hasMulti = Array.isArray(this.availableEndpoints) && this.availableEndpoints.length > 1;

      if (hasMulti) {
        if (!sel) {
          sel = document.createElement('div');
          sel.id = 'designer-endpoint-selector';
          sel.className = 'dsgn-endpoint-selector';
          sel.innerHTML = '<label>Path to:</label><select></select>';
          headerEl.appendChild(sel);
          const select = sel.querySelector('select');
          select.addEventListener('change', (e) => {
            const newId = e.target.value;
            if (this.editSourceId) {
              this.openFromSource(this.editSourceId, newId);
            }
          });
        }
        const select = sel.querySelector('select');
        if (select) {
          select.innerHTML = this.availableEndpoints.map(ep => {
            const def = COMPONENTS[ep.type];
            const label = def ? def.name : ep.type;
            const selected = ep.id === this.editEndpointId ? 'selected' : '';
            return `<option value="${ep.id}" ${selected}>${label}</option>`;
          }).join('');
        }
        sel.style.display = '';
      } else if (sel) {
        sel.style.display = 'none';
      }
    }
  }

  async saveDesign() {
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
      const name = this.mode === 'design'
        ? this.designName.trim()
        : await this._requestDesignName('My Design', 'Save Beamline Design');
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

  async saveDesignAs() {
    if (this.draftNodes.length === 0) {
      this.game.log('Cannot save empty design!', 'bad');
      return;
    }
    const name = await this._requestDesignName(
      `${this.designName} (copy)`,
      'Save a Copy'
    );
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

  _requestDesignName(defaultName, title) {
    return this._designNameDialog.open({
      title,
      defaultName,
      componentCount: this.draftNodes.length,
      lengthM: this.totalLength,
      category: this._pickCategory(),
    });
  }

  /**
   * Design-library label. Free-form: it only groups saved designs in the UI.
   * NOT a physics machine type — see _pickMachineType.
   */
  _pickCategory() {
    const types = this.draftNodes.map(n => n.type);
    const hasBend = types.some(t => COMPONENTS[t]?.isDipole);
    const hasUndulator = types.some(t => t === 'undulator' || t === 'wiggler');
    if (hasUndulator) return 'fel';
    if (hasBend) return 'synchrotron';
    return 'linac';
  }

  /**
   * Machine type for the physics backend. MUST be one of MACHINE_TYPES in
   * beam_physics/machines.py — get_machine_config() falls back to 'linac' on
   * anything else, which is recoverable but silently drops the specialised
   * modules, so guessing here is worse than useless.
   *
   * THERE IS EXACTLY ONE SOURCE OF TRUTH: the beamline's TYPE, chosen once in
   * the New Beamline picker and stored as `entry.typeId`. This method used to
   * be `_pickMachineType()`, a heuristic returning 'fel' whenever the draft
   * contained an undulator or wiggler and 'linac' otherwise, and it ran
   * whenever `this.beamlineId` was unset — which `openFromSource` always
   * leaves unset. So editing a `lightSource` with an insertion device in it
   * handed physics 'fel', and FELGainModule reported saturation a storage ring
   * cannot physically reach: precisely the bug the capability sets in
   * machines.py were introduced to prevent, reintroduced one layer up. The
   * heuristic is gone rather than demoted, because a fallback that can
   * contradict the type is a fallback that will.
   *
   * The remaining fallback is 'linac' — a plain transport stack that claims no
   * specialised product — for the two genuinely typeless cases: an untyped
   * registry entry (pre-picker saves, scenario-authored beamlines) keeps
   * whatever machineType its beamState carries, and a design-library draft,
   * which is not a beamline at all and has no registry entry to ask.
   */
  _machineTypeForDraft() {
    // openFromSource deliberately leaves this.beamlineId null (the draft is
    // pipe-graph-backed, not registry-backed), so resolve through the source
    // placeable as well before giving up.
    const entry = (this.beamlineId && this.game.registry.get(this.beamlineId))
      || (this.editSourceId && this.game.registry.getBySourceId(this.editSourceId))
      || null;
    if (!entry) return 'linac';

    const type = entry.typeId ? getBeamlineType(entry.typeId) : null;
    if (type) return type.machineType;
    return entry.beamState?.machineType || 'linac';
  }

  close() {
    if (!this.isOpen) return;

    // Auto-save draft state so user can resume later
    this._saveDraftState();
    this._cleanup();
  }

  confirm() {
    if (!this.isOpen) return;
    if (this.mode === 'design') return; // designs are saved, not confirmed
    if (!this.editSourceId) return;
    // Returns a promise so tests (and any future caller) can await the
    // preview; the button handler fires and forgets.
    return this._planAndApply();
  }

  cancel() {
    if (!this.isOpen) return;

    // Cancel discards only edits made since this tab was opened/selected. Its
    // last auto-saved version remains in the beamline workspace.
    const openedNodes = this._activeDraftOpenSnapshot?.draftNodes || this.originalNodes;
    const changedSinceOpen = this._nodesDiffer(this.draftNodes, openedNodes);
    if (changedSinceOpen && !confirm('Discard changes made since this draft was opened?')) {
      return;
    }
    this._clearDraftState();
    this._cleanup();
  }

  _saveDraftState() {
    // Beamline drafts live in the per-beamline workspace; designerState only
    // remembers the last transient session for runtime routing/reload.
    this._saveActiveWorkspaceDraft();
    this.game.state.designerState = this.serializeState();
  }

  _clearDraftState() {
    // Clear saved draft (e.g., after confirm applies changes)
    this.game.state.designerState = null;
  }

  // ---------------------------------------------------------------------
  // Apply: plan → preview → transaction
  //
  // The draft is a statement of the desired end state; designer-plan.js
  // diffs it against the map and hands back an ORDERED op list plus a
  // player-facing summary. Everything below is the executor for that list —
  // the op contract, including the symbol table, is documented in the header
  // of src/beamline/designer-plan.js.
  // ---------------------------------------------------------------------

  /**
   * Plan the draft, show the preview, and — if the player says yes — execute
   * the plan as one all-or-nothing transaction. Returns true when the map
   * changed. Async only because the preview is a promise; nothing is planned
   * or executed off the main task.
   */
  async _planAndApply() {
    // A blocked or rejected Apply is still valuable design work. Persist it
    // before planning so any later exit always has an exact recovery point.
    this._saveActiveWorkspaceDraft();
    const plan = planDesignerApply(this.game.state, {
      sourceId: this.editSourceId,
      draftNodes: this.draftNodes,
      originalNodes: this.originalNodes,
      prepareSite: true,
    });
    if (!plan.ok) {
      this._reportBlockers(plan.blockers);
      return false;
    }

    const choice = await applyPreviewDialog.open(plan.summary, {
      name: this._editedBeamlineName(),
      applyLabel: 'Confirm changes',
    });
    if (choice !== 'apply') return false;
    // The designer can be torn down while the preview is up (a load, a
    // reload, the Esc ladder); applying then would write a plan built against
    // a session that no longer exists.
    if (!this.isOpen || !this.editSourceId) return false;

    const failure = this._executePlan(plan.ops);
    if (failure) {
      // All-or-nothing. A half-applied beamline — a pipe cut in two with no
      // module in the gap, a junction placed with nothing feeding it — is
      // worse than no change at all, and the player has no way to see it
      // happened, let alone undo it.
      this.game.log(
        `Apply failed at step ${failure.index + 1} (${failure.kind}: ${failure.reason}) — `
        + 'nothing was changed',
        'bad',
      );
      return false;
    }

    // Displacement can strand utility feeds that had no legal route to the
    // module's new position. They are still on the map as loose ends, so say
    // so — silently unwired hardware reads as a physics bug, not an edit the
    // player asked for.
    if (this._danglingLineCount > 0) {
      const n = this._danglingLineCount;
      this.game.log(
        `${n} utility line${n === 1 ? '' : 's'} came loose and need${n === 1 ? 's' : ''} rewiring`,
        'bad',
      );
    }

    this.game.recalcBeamline();
    this.game.emit('beamlineChanged');

    // Re-walk the map: every node the player added now exists on it, and the
    // draft has to learn their real ids or a second Apply would build them
    // again. _recalcBaseline then re-measures "current" against the line as
    // actually built, since the old baseline describes a beamline that no
    // longer exists.
    this._syncDraftFromMap();
    this._updateTotalLength();
    this._recalcBaseline();

    if (this.draftWorkspaceId) {
      this.game.replaceCurrentBeamlineDesignerDraft?.(
        this.draftWorkspaceId,
        {
          ...this._draftPayload(this.draftNodes),
          selectedIndex: this.draftNodes.length ? 0 : -1,
          viewX: 0,
          viewZoom: 0.7,
        },
      );
      this.activeWorkspaceDraftId = 'current';
    }

    this._clearDraftState();
    this._cleanup();
    return true;
  }

  /** Registry name of the beamline under edit, for the preview header. */
  _editedBeamlineName() {
    const entry = this.editSourceId
      ? this.game.registry?.getBySourceId(this.editSourceId)
      : null;
    return (entry && entry.name) || null;
  }

  /**
   * Run the plan's ops in the ORDER GIVEN. Returns null on success, or
   * `{index, kind, reason}` naming the op that refused.
   *
   * The order is load-bearing and must not be rearranged: mergePipes is
   * deliberately emitted before removeJunction, because validateMergePipes
   * proves two pipes are adjacent through the junction reference they share —
   * the very reference removeJunction nulls.
   */
  _executePlan(ops) {
    const result = executeDesignerApply(this.game, ops);
    this._danglingLineCount = result.danglingLineCount;
    return result.failure;
  }

  /**
   * Refuse the apply and say why. Blockers are the planner's whole failure
   * channel, so every one of them is surfaced — and the first that names a
   * draft node selects it, which is what puts the highlight on the offending
   * element in the schematic instead of leaving the player to guess.
   */
  _reportBlockers(blockers) {
    const list = (blockers && blockers.length)
      ? blockers
      : [{ message: 'These changes cannot be applied.', nodeIndex: -1 }];
    for (const b of list) this.game.log(`Can't apply: ${b.message}`, 'bad');

    const pointed = list.find(b => b.nodeIndex >= 0 && b.nodeIndex < this.draftNodes.length);
    if (pointed) {
      this.selectedIndex = pointed.nodeIndex;
      this._updateMarkerToComponentCenter();
    }
    this._renderAll();
  }

  _cleanup() {
    this._hideDesignerPaletteHover?.();
    this.isOpen = false;
    this._escUnsub?.();
    this._escUnsub = null;
    this.beamlineId = null;
    this.draftWorkspaceId = null;
    this.activeWorkspaceDraftId = null;
    this._activeDraftOpenSnapshot = null;
    this.editSourceId = null;
    this.editEndpointId = null;
    this.availableEndpoints = [];
    this._originalPlacementIds = new Set();
    this._originalModuleIds = new Set();
    this.draftNodes = [];
    this.originalNodes = [];
    this.draftEnvelope = null;
    this.draftPhysicsResult = null;
    this.draftRevenueProjection = null;
    this.baselineEnvelope = null;
    this.baselinePhysicsResult = null;
    this._baselinePending = false;
    this.selectedIndex = -1;
    this._lastTuningKey = null;
    this._plotHoverPositions.clear();
    this._lastAutoPlotYDomains.clear();
    this.plotTags.clear();
    if (this._plotHoverFrame) {
      cancelAnimationFrame(this._plotHoverFrame);
      this._plotHoverFrame = null;
    }
    this._markerDir = 0;
    if (this._markerAnimId) {
      cancelAnimationFrame(this._markerAnimId);
      this._markerAnimId = null;
    }
    // Same teardown for the schematic pan loop. _onKeyUp early-returns on
    // `!this.isOpen`, so _stopPan() — the only writer of _panDir = 0 — is
    // unreachable once the designer closes: closing while a/d was still held
    // pinned a 60 Hz rAF no-op for the rest of the session.
    this._panDir = 0;
    if (this._panAnimId) {
      cancelAnimationFrame(this._panAnimId);
      this._panAnimId = null;
    }
    this.overlay.classList.add('hidden');
    const bottomHud = document.getElementById('bottom-hud');
    if (bottomHud) {
      bottomHud.style.zIndex = '';
      bottomHud.classList.remove('designer-active');
    }
    const paletteActions = document.getElementById('dsgn-palette-actions');
    if (paletteActions) paletteActions.classList.add('hidden');
    if (!this._suppressHashUpdate && window.location.hash.startsWith('#designer')) {
      window.location.hash = 'game';
    }
    this._suppressHashUpdate = false;
    // Restore normal palette tabs
    this._restoreNormalTabs();
    this._renderWorkspaceTabs();
  }

  // --- Undo ---

  _pushUndo() {
    this._undoStack.push({
      draftNodes: this.draftNodes.map(n => this._cloneNode(n)),
      selectedIndex: this.selectedIndex,
      markerS: this.markerS,
      autoTuneEnabled: this.autoTuneEnabled,
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
    this.autoTuneEnabled = snap.autoTuneEnabled === true;
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
    // Reset through the same canonical seeder used by both map placement
    // paths. The hover preview calls this helper too, so preview and click
    // cannot start the component with different controls.
    node.params = _designerComponentParams(this, newType);
    node.computedStats = null;

    this._updateTotalLength();
    this._recalcDraft();
    this._updateDraftBar();
    this._renderAll();
  }

  insertComponent(index, type, position, initialParams = null) {
    const comp = COMPONENTS[type];
    if (!comp) return;
    this._pushUndo();

    // Pick the target pipe and the fractional-s position on it, using the
    // neighbouring draft node (which was derived from the flattener and so
    // carries a pipeId).
    const pipeCtx = this.editSourceId
      ? this._resolvePipeContextForInsert(index, position)
      : null;

    const newNode = {
      id: -(this._nextTempId = (this._nextTempId || 0) + 1),  // unique negative ID for draft
      type: type,
      col: 0, row: 0, dir: 0, entryDir: 0,
      parentId: null, bendDir: null, tiles: [],
      params: _designerComponentParams(this, type, initialParams),
      computedStats: null,
    };

    if (this.editSourceId && comp.placement === 'attachment') {
      newNode._pipeKind = 'placement';
      newNode._sourceRef = {};          // empty → reconciler treats as "new"
      newNode._targetPipeId = pipeCtx ? pipeCtx.pipeId : null;
      newNode._targetPosition = pipeCtx ? pipeCtx.position : 0.5;
      newNode._insertMode = this.insertMode ? 'insert' : 'replace';
    } else if (this.editSourceId) {
      // A module added to the draft. It carries no map bookkeeping — the draft
      // states the desired stack and the planner resolves where it lands on the
      // sub-grid. An empty _sourceRef is what marks it as not-yet-on-the-map.
      newNode._pipeKind = 'module';
      newNode._sourceRef = {};
    }

    const insertIdx = position === 'before' ? index : index + 1;
    this.draftNodes.splice(insertIdx, 0, newNode);
    this.selectedIndex = insertIdx;

    this._updateTotalLength();
    this._recalcDraft();
    this._updateDraftBar();
    this._renderAll();
  }

  /**
   * For a newly inserted draft node, resolve which pipe it targets and what
   * fractional position on that pipe it corresponds to. Uses the adjacent
   * draft node (which came from the flattener) as an anchor.
   */
  _resolvePipeContextForInsert(index, position) {
    const anchor = this.draftNodes[index];
    if (!anchor) return null;
    // If the anchor is a placement or drift, it has a pipeId in _sourceRef.
    const pipeId = anchor._sourceRef?.pipeId || null;
    if (!pipeId) return null;
    // Prefer the anchor's own fractional position if it's a placement; else
    // default to the midpoint. findSlot() will snap-or-insert from there
    // depending on mode.
    const pos = (typeof anchor._sourceRef?.position === 'number')
      ? anchor._sourceRef.position
      : 0.5;
    return { pipeId, position: pos };
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

  /**
   * Run a non-mutating solver preview for the palette component at the exact
   * insert/replace location a click would use. This is the public read seam for
   * designer-renderer.js; it never writes draft state or pushes undo.
   */
  async previewComponentPlacement(componentType) {
    if (!this.isOpen) return null;
    const component = COMPONENTS[componentType];
    if (!component) return null;

    const revision = this._draftPhysicsRevision;
    const nodes = this.draftNodes.map(node => this._cloneNode(node));
    const lengths = this._compPhysLengths();
    let componentIndex;
    let positionS = 0;
    let action;

    if (this.insertMode) {
      const target = this._findClosestEdge();
      componentIndex = target.position === 'before' ? target.index : target.index + 1;
      componentIndex = Math.max(0, Math.min(nodes.length, componentIndex));
      positionS = lengths.slice(0, componentIndex).reduce((sum, length) => sum + length, 0);
      nodes.splice(componentIndex, 0, {
        id: '__designer_hover_preview__',
        type: componentType,
        params: _designerComponentParams(this, componentType),
        computedStats: null,
      });
      action = 'insert';
    } else {
      if (this.selectedIndex < 0 || this.selectedIndex >= nodes.length) return null;
      componentIndex = this.selectedIndex;
      positionS = lengths.slice(0, componentIndex).reduce((sum, length) => sum + length, 0);
      nodes[componentIndex].type = componentType;
      nodes[componentIndex].params = _designerComponentParams(this, componentType);
      nodes[componentIndex].computedStats = null;
      action = 'replace';
    }

    const previewResult = await this._computePhysics(nodes, 'designer:placement-preview');
    if (!this.isOpen || revision !== this._draftPhysicsRevision) return null;
    return summarizeDesignerPlacement({
      component,
      componentIndex,
      beforeResult: this.draftPhysicsResult,
      previewResult,
      action,
      positionS,
    });
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
    const compMap = this._buildCompVisualMap();
    const totalVisual = compMap.totalVisual || 1;
    const BASE_SPEED = totalVisual / 3;

    let visualPos = this._sToVisual(compMap);

    const step = (now) => {
      const dt = Math.min((now - this._lastMarkerTime) / 1000, 0.05);
      this._lastMarkerTime = now;

      if (this._markerDir === 0) {
        this._markerAnimId = null;
        return;
      }

      const speed = BASE_SPEED / this.viewZoom;
      visualPos = Math.max(0, Math.min(totalVisual,
        visualPos + this._markerDir * speed * dt));

      this.markerS = this._visualToS(compMap, visualPos);
      this._updateSelectionFromMarker();
      this._panToFollowMarker();
      this._renderSchematic();
      this._renderPlots();
      this._markerAnimId = requestAnimationFrame(step);
    };
    this._markerAnimId = requestAnimationFrame(step);
  }

  _panToFollowMarker() {
    const canvas = document.getElementById('dsgn-schematic-canvas');
    if (!canvas || this.draftNodes.length === 0) return;
    const W = canvas.parentElement.getBoundingClientRect().width;
    const SCHEM_PW = 70;
    const baseZoom = W / (5 * SCHEM_PW + 40);
    const effZoom = this.viewZoom * baseZoom;
    const panPx = -this.viewX * effZoom;

    const markerPx = 20 + panPx + this._sToPixelOffset(this.markerS, effZoom);

    const centerX = W / 2;
    const deadZone = W * 0.4;
    const offset = markerPx - centerX;
    if (Math.abs(offset) > deadZone) {
      const overshoot = offset > 0 ? offset - deadZone : offset + deadZone;
      this.viewX += overshoot / effZoom;
      this._clampViewX();
    }
  }

  /** Build array mapping each component's visual width and physical length.
   *  Physical lengths are derived from this.totalLength proportionally so they
   *  stay in sync with the envelope s-values used by the plots. */
  _buildCompVisualMap() {
    const SCHEM_PW = 70;
    const tileLenSum = this.draftNodes.reduce((s, n) => s + _nodeSubL(n) * 0.5, 0) || 1;

    const entries = [];
    let totalVisual = 0;
    for (const node of this.draftNodes) {
      const len = _nodeSubL(node) * 0.5;
      const visualW = this._compPixelWidth(node.type, _nodeSubL(node));
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

  _compPixelWidth(componentType, subL) {
    const SCHEM_PW = 70;
    if (componentType !== 'drift') return SCHEM_PW;
    const s = subL || 4;
    return Math.max(Math.round(SCHEM_PW / 2), Math.round((s / 4) * SCHEM_PW));
  }

  /** Compute per-component physical lengths that sum to this.totalLength. */
  _compPhysLengths() {
    const tileLenSum = this.draftNodes.reduce((s, n) => s + _nodeSubL(n) * 0.5, 0) || 1;
    return this.draftNodes.map(n => (_nodeSubL(n) * 0.5 / tileLenSum) * this.totalLength);
  }

  /** Pixel offset from the left edge of the beamline (x = 20 + panPx) to
   *  physical position s. Inverse of the click mapping in
   *  _placeMarkerAtClickX, so the marker draws under the cursor that set it. */
  _sToPixelOffset(s, effectiveZoom) {
    // _compPhysLengths is the one length model in this file — it reads a
    // trimmed drift's real length off the node, the same way the click
    // mapping and totalLength do. Recomputing it from COMPONENTS[type].subL
    // here would put the marker somewhere other than where it was clicked.
    const lengths = this._compPhysLengths();
    let px = 0;
    let cumS = 0;
    for (let i = 0; i < this.draftNodes.length; i++) {
      const compW = this._compPixelWidth(this.draftNodes[i].type,
        _nodeSubL(this.draftNodes[i])) * effectiveZoom;
      if (s <= cumS + lengths[i]) {
        const frac = lengths[i] > 0 ? (s - cumS) / lengths[i] : 0;
        return px + frac * compW;
      }
      cumS += lengths[i];
      px += compW;
    }
    return px;
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
      // Cards route clicks through InputHandler.selectPaletteTool('component', key)
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

  _startPan(dir) {
    this._panDir = dir;
    if (this._panAnimId) return;
    this._lastPanTime = performance.now();
    this._runPanAnimation();
  }

  _stopPan() {
    this._panDir = 0;
  }

  _runPanAnimation() {
    if (!this._panDir) { this._panAnimId = null; return; }
    const now = performance.now();
    const dt = (now - this._lastPanTime) / 1000;
    this._lastPanTime = now;
    const speed = (this.totalLength || 100) * 2.0;
    this.viewX += this._panDir * speed * dt;
    this._clampViewX();
    this._renderAll();
    this._panAnimId = requestAnimationFrame(() => this._runPanAnimation());
  }

  panToStart() {
    this.viewX = 0;
    this._clampViewX();
    this._renderAll();
  }

  panToEnd() {
    this.viewX = this.totalLength;
    this._clampViewX();
    this._renderAll();
  }

  zoomAt(delta, cursorFraction) {
    const oldZoom = this.viewZoom;
    this.viewZoom = Math.max(0.5, Math.min(10, this.viewZoom * (1 - delta * 0.001)));
    const viewWidth = this.totalLength / this.viewZoom;
    this.viewX += (cursorFraction * this.totalLength / oldZoom) - (cursorFraction * viewWidth);
    this._clampViewX();
    this._renderAll();
  }

  // --- Focus advisor surfacing ---

  /** Effective pixels-per-unit-width for the schematic at the current zoom,
   *  or null when the canvas is not laid out yet. */
  _schematicZoom() {
    const canvas = document.getElementById('dsgn-schematic-canvas');
    if (!canvas || !canvas.parentElement) return null;
    const W = canvas.parentElement.getBoundingClientRect().width;
    if (!W) return null;
    const SCHEM_PW = 70;
    return { W, effZoom: this.viewZoom * (W / (5 * SCHEM_PW + 40)) };
  }

  /** Show how many physics-backed build insertions are currently actionable. */
  _updateAdvisorReadout() {
    const el = document.getElementById('dsgn-advisor-readout');
    if (!el) return;
    const n = this.placementHints ? this.placementHints.length : 0;
    if (n === 0) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    el.textContent = `▲ physics advisor: ${n} build hint${n === 1 ? '' : 's'}`;
  }

  /** Walk through every typed placement hint from source to endpoint. */
  _jumpToNextPlacementHint() {
    if (!this.placementHints || this.placementHints.length === 0) return;
    const i = (this._placementHintCursor ?? -1) + 1;
    this._placementHintCursor = i >= this.placementHints.length ? 0 : i;
    this.markerS = this.placementHints[this._placementHintCursor].s;
    this._hoverSchematicX = null;
    this._updateSelectionFromMarker();
    this._centerViewOnMarker();
    this._renderAll();
  }

  /** Walk the marker through the advisor's suggestions, one per click, and
   *  centre the view on each so the arrow is actually on screen when you
   *  arrive. Wraps around at the end. */
  _jumpToNextGhost() {
    if (!this.ghostQuads || this.ghostQuads.length === 0) return;
    const i = (this._advisorCursor ?? -1) + 1;
    this._advisorCursor = i >= this.ghostQuads.length ? 0 : i;
    this.markerS = this.ghostQuads[this._advisorCursor].s;
    this._updateSelectionFromMarker();
    this._centerViewOnMarker();
    this._renderAll();
  }

  /** Goal bands consumed by ProbePlots. Kept on the designer so a saved,
   *  typeless design simply returns quiet plots rather than inventing goals. */
  _missionPlotTargets() {
    const typeId = this._designerBeamlineTypeId?.();
    return missionPlotTargets(typeId ? getBeamlineType(typeId) : null);
  }

  /** Centre the schematic viewport on the marker (unlike _panToFollowMarker,
   *  which only nudges once the marker leaves a dead zone). */
  _centerViewOnMarker() {
    const z = this._schematicZoom();
    if (!z || this.draftNodes.length === 0) return;
    const offset = this._sToPixelOffset(this.markerS, z.effZoom);
    // markerPx = 20 + panPx + offset, panPx = -viewX * effZoom; solve for the
    // viewX that puts markerPx at the canvas centre.
    this.viewX = -(z.W / 2 - 20 - offset) / z.effZoom;
    this._clampViewX();
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
      subL: node.subL,
      beamStart: node.beamStart,
      _pipeKind: node._pipeKind,
      _sourceRef: node._sourceRef,
      _targetPipeId: node._targetPipeId,
      _targetPosition: node._targetPosition,
      _insertMode: node._insertMode,
    };
  }

  _updateTotalLength() {
    this.totalLength = 0;
    for (const node of this.draftNodes) {
      this.totalLength += _nodeSubL(node) * 0.5;
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
    const compWidths = this.draftNodes.map(n => this._compPixelWidth(n.type, _nodeSubL(n)));
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

  /**
   * Run the physics engine over an ordered node list and return its envelope.
   *
   * Shared by the draft and the baseline so the two curves in a Proposed/Current
   * comparison come out of the same code path — a baseline built by a parallel
   * copy of this would drift from the draft on the next physics change and the
   * comparison would quietly start reading differences that are not there.
   *
   * Callers wanting more than the envelope (dispersion warnings, summary stats)
   * call _computePhysics and read the field they need. Returning only the
   * envelope here keeps every existing caller honest about what it uses.
   */
  async _computeEnvelope(nodes) {
    const result = await this._computePhysics(nodes);
    return result ? result.envelope : null;
  }

  /** The full physics result for a node list, or null when the engine
   *  declined (empty draft, or Pyodide still booting). */
  async _computePhysics(nodes, lane = 'designer:draft') {
    if (!nodes || nodes.length === 0) return null;

    // Drafts assume ideal services because their components do not have map
    // endpoints yet. Catalogue physics fields still share the production
    // payload builder so beta acceptance and physical aperture cannot drift.
    const physicsBeamline = buildDesignerPhysicsElements(nodes.map(node => ({
      ...node,
      subL: _nodeSubL(node),
    })));

    // Gather research effects
    const researchEffects = {};
    for (const key of RESEARCH_PHYSICS_EFFECT_KEYS) {
      const v = this.game.getEffect(key, key.endsWith('Mult') ? 1 : 0);
      researchEffects[key] = v;
    }
    researchEffects.machineType = this._machineTypeForDraft();

    const result = await BeamPhysics.computeAsync(physicsBeamline, researchEffects, { lane });

    // TEMPORARY (debugging "No beam data"): report every unplottable outcome to
    // the dev sink in vite.config.js, including the branches BeamPhysics itself
    // never sees — a payload that emptied out, or a result whose envelope came
    // back too short to draw. Remove with the sink.
    if (import.meta.env.DEV && (!result || !result.envelope || result.envelope.length < 2)) {
      try {
        fetch('/__diag', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 'designer-envelope-null',
            ready: BeamPhysics.isReady(),
            lastError: BeamPhysics.getLastError ? BeamPhysics.getLastError() : null,
            nodeCount: nodes.length,
            nodeTypes: nodes.map(n => n.type),
            payloadCount: physicsBeamline.length,
            envelopeLength: result && result.envelope ? result.envelope.length : null,
            beamline: physicsBeamline,
            effects: researchEffects,
          }),
        }).catch(() => {});
      } catch (_) { /* never let diagnostics break the designer */ }
    }

    return result || null;
  }

  /**
   * Recompute the as-built envelope from originalNodes. Call after anything
   * that changes what "current" means — opening the designer, or applying a
   * draft to the map, after which the old baseline describes a beamline that no
   * longer exists and would show the player a difference they just eliminated.
   */
  async _recalcBaseline() {
    const revision = ++this._baselinePhysicsRevision;
    // Pyodide boots asynchronously, so a designer opened during the first
    // seconds of a session asks a physics engine that answers null to
    // everything. The draft recovers on the next edit; the baseline is computed
    // exactly once, so without this flag it would stay null for the rest of the
    // session and the comparison would silently never appear.
    this._baselinePending = true;
    const result = await this._computePhysics(this.originalNodes, 'designer:baseline');
    if (revision !== this._baselinePhysicsRevision || !this.isOpen) return;
    this._baselinePending = false;
    this.baselinePhysicsResult = result;
    this.baselineEnvelope = this.baselinePhysicsResult?.envelope || null;
    this._updatePlotSourceBar();
    this._renderAll?.();
  }

  async _recalcDraft() {
    const revision = ++this._draftPhysicsRevision;
    if (!this._commissioningApplying) this._lastCommissioningResult = null;
    this.physicsPending = this.draftNodes.length > 0;
    this.draftRevenueProjection = null;
    // The full result, not just the envelope: the advisor reads
    // dispersionWarnings off it, and re-running physics to fetch them would
    // double the cost of every keystroke in a slider drag.
    let draftResult = await this._computePhysics(this.draftNodes);
    if (revision !== this._draftPhysicsRevision || !this.isOpen) return;

    // Auto matching is iterative because an RF phase repair changes downstream
    // energy, and therefore the gradients the downstream magnets need. Each
    // pass plans from the current published envelope, applies only changed
    // params, then recomputes. In practice this settles in two passes; the cap
    // makes a future rounded-control edge case harmless.
    if (this.autoTuneEnabled) {
      const typeId = this._designerBeamlineTypeId?.();
      const particle = (typeId && getBeamlineType(typeId)?.particle) || 'e-';
      for (let pass = 0; pass < 3; pass++) {
        const plan = planDesignerAutoTune({
          nodes: this.draftNodes,
          envelope: draftResult?.envelope || [],
          particle,
        });
        this._lastAutoTuneSummary = plan;
        if (plan.updates.length === 0) break;
        for (const update of plan.updates) {
          const node = this.draftNodes[update.index];
          if (!node) continue;
          node.params = { ...(node.params || {}), ...update.params };
          node.computedStats = null;
        }
        this._lastTuningKey = null;
        draftResult = await this._computePhysics(this.draftNodes);
        if (revision !== this._draftPhysicsRevision || !this.isOpen) return;
      }
    } else {
      this._lastAutoTuneSummary = null;
    }

    this.draftPhysicsResult = draftResult;
    this.draftRevenueProjection = draftResult
      ? computeBeamlineRevenueBreakdown(
        this._designerBeamlineTypeId?.(),
        draftResult,
        this.draftNodes,
        {
          // The Designer models the machine rather than its external utility
          // wiring, so quote fully connected gross earning potential.
          dataConnectivity: 1,
          nodeCount: this.draftNodes.filter(node => node.type !== 'drift').length,
        },
      )
      : null;
    this.physicsPending = false;
    this.draftEnvelope = draftResult ? draftResult.envelope : null;
    this.draftDispersionWarnings = draftResult?.dispersionWarnings || [];
    if (!this.draftEnvelope) {
      this.placementHints = [];
      this.ghostQuads = [];
      this._advisorCursor = -1;
      this._placementHintCursor = -1;
      this._updateAdvisorReadout();
      this._renderAll?.();
      return;
    }

    // NOTE: this used to hold a "s-axis alignment" dev check comparing
    // draftEnvelope[i].s against draftNodes[i].beamStart. Those are different
    // index spaces — the envelope is the physics engine's fixed-size resample
    // indexed by sample position, the draft nodes are one entry per element —
    // so the check warned on nearly every element of every recompute (and a
    // slider drag recomputes continuously). A 100%-false-positive check makes
    // genuine drift unobservable, so it is gone; see the flattener header for
    // the real relationship between the two arrays.

    // Update totalLength from envelope to stay in sync with physics s-values
    if (this.draftEnvelope && this.draftEnvelope.length > 0) {
      const maxS = this.draftEnvelope[this.draftEnvelope.length - 1].s;
      if (maxS > 0) this.totalLength = maxS;
    }

    // Compute typed build suggestions from the same propagated beam state the
    // plots display. No extra physics pass and no UI heuristic copy.
    this._computePlacementHints();
    // The suggestion list just changed, so a cursor into the old list points at
    // an unrelated position. Start the walk over.
    this._advisorCursor = -1;
    this._placementHintCursor = -1;
    this._updateAdvisorReadout();
    this._renderAll?.();
    // Optics advice is only meaningful against the current draft, and the
    // draft changes far faster than the tick Stubby normally runs on.
    this.game?._runAdvisor?.();
  }

  /** Whether the player can actually insert a component into this machine. */
  _componentAvailableForHint(type) {
    const typeId = this._designerBeamlineTypeId?.();
    return placementHintComponentAvailable({
      typeId,
      componentType: type,
      isUnlocked: comp => this.game?.isComponentUnlocked?.(comp) !== false,
    });
  }

  /** Compute all designer-local insertion recipes. */
  _computePlacementHints() {
    const typeId = this._designerBeamlineTypeId?.();
    this.placementHints = computeBeamlinePlacementHints({
      nodes: this.draftNodes,
      envelope: this.draftEnvelope,
      typeId,
      isUnlocked: comp => this.game?.isComponentUnlocked?.(comp) !== false,
    });
    // Stubby's existing focus rules and the regression suite consume this
    // narrow view. Keep it derived so it cannot disagree with the canvas.
    this.ghostQuads = this.placementHints
      .filter(hint => hint.kind === 'focus' && hint.componentType === 'quadrupole')
      .map(hint => ({
        s: hint.s,
        nodeIndex: hint.nodeIndex,
        polarity: hint.params?.polarity,
      }));
  }

  /** Compatibility entry point used by focused unit tests. */
  _computeGhostQuads() {
    // Prototype-only tests intentionally construct a designer without a game;
    // in that case every catalogue component is available and the untyped line
    // defaults to the established quadrupole behavior.
    if (!this.game) {
      this.placementHints = computePlacementHints({
        nodes: this.draftNodes,
        envelope: this.draftEnvelope,
        isAvailable: type => type === 'quadrupole',
      });
      this.ghostQuads = this.placementHints
        .filter(hint => hint.kind === 'focus')
        .map(hint => ({ s: hint.s, nodeIndex: hint.nodeIndex, polarity: hint.params.polarity }));
      return;
    }
    this._computePlacementHints();
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

  /** Commit a rendered recipe as one ordinary, undoable draft insertion. */
  _acceptPlacementHint(hint) {
    if (!hint || !hint.componentType) return;
    if (!this._componentAvailableForHint(hint.componentType)) return;
    this.markerS = Math.max(0, Math.min(this.totalLength, hint.s || 0));
    this.insertMode = 'nearest';
    this._updateInsertButtons();
    this.insertComponent(
      Math.max(0, Math.min(this.draftNodes.length - 1, hint.nodeIndex || 0)),
      hint.componentType,
      hint.position || 'after',
      hint.params || null,
    );
    const name = COMPONENTS[hint.componentType]?.name || hint.componentType;
    this.game?.log?.(`${name} inserted from physics hint`, 'good');
  }

  _nodesDiffer(draftNodes, originalNodes) {
    if ((draftNodes || []).length !== (originalNodes || []).length) return true;
    for (let i = 0; i < draftNodes.length; i++) {
      if (draftNodes[i].type !== originalNodes[i].type) return true;
      if (draftNodes[i].id !== originalNodes[i].id) return true;
      if (JSON.stringify(draftNodes[i].params) !== JSON.stringify(originalNodes[i].params)) return true;
    }
    return false;
  }

  _hasDraftChanges() {
    return this._nodesDiffer(this.draftNodes, this.originalNodes);
  }

  _calcCostDelta() {
    const costOf = (nodes) => nodes.reduce((sum, n) => {
      const comp = COMPONENTS[n.type];
      return sum + (comp && comp.cost ? (comp.cost.funding || 0) : 0);
    }, 0);
    return costOf(this.draftNodes) - costOf(this.originalNodes);
  }

  _updateDraftBar() {
    this._renderWorkspaceTabs();
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

  /**
   * Show the Proposed/Current/Both toggle only when there is a baseline to
   * compare against, and keep the active button in sync with plotSource.
   * Without the visibility rule, sandbox mode would offer a "Current" that can
   * only ever render "No beam data".
   */
  _updatePlotSourceBar() {
    const group = document.getElementById('dsgn-plot-source');
    if (!group) return;
    const enabled = !!(this.baselineEnvelope && this.baselineEnvelope.length >= 2);
    group.classList.toggle('hidden', !enabled);
    if (!enabled) this.plotSource = 'proposed';
    document.querySelectorAll('.dsgn-source-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.source === this.plotSource);
    });
  }

  /** Keep one panel's Auto/Fixed controls aligned with its published plot domain. */
  syncPlotYRangeControl(panelId, plotType, autoDomain, enabled = true) {
    const controls = document.querySelector(`.dsgn-plot-y-controls[data-panel="${panelId}"]`);
    if (!controls) return;
    controls.hidden = !enabled;
    if (!enabled) return;

    const panel = Number(panelId);
    const range = this.plotYRanges[panel] || { mode: 'auto', min: null, max: null };
    const fixed = range.mode === 'fixed';
    const modeButton = controls.querySelector('.dsgn-plot-y-mode');
    const bounds = controls.querySelector('.dsgn-plot-y-bounds');
    if (modeButton) {
      modeButton.textContent = fixed ? 'Fixed Y' : 'Auto Scale';
      modeButton.classList.toggle('active', fixed);
      modeButton.setAttribute('aria-pressed', fixed ? 'true' : 'false');
      modeButton.title = fixed
        ? 'Use solver autoscale for this plot'
        : 'Set explicit minimum and maximum for this plot';
    }
    if (bounds) bounds.hidden = !fixed;

    const primaryDomain = fixed ? [range.min, range.max] : autoDomain?.[0];
    const unit = controls.querySelector('.dsgn-plot-y-unit');
    const focusedBound = document.activeElement?.classList?.contains('dsgn-plot-y-bound')
      && controls.contains(document.activeElement);
    // Keep the editing unit stable until blur. Otherwise crossing, for example,
    // MeV -> GeV mid-keystroke would reinterpret the rest of the typed number.
    const axis = focusedBound
      ? {
        scale: Number(controls.dataset.axisScale) || 1,
        unit: unit?.textContent || '',
      }
      : designerPlotPrimaryAxis(plotType, primaryDomain);
    if (!focusedBound) {
      controls.dataset.axisScale = String(axis.scale);
      if (unit) unit.textContent = axis.unit;
    }

    if (!fixed) return;
    for (const bound of ['min', 'max']) {
      const input = controls.querySelector(`[data-bound="${bound}"]`);
      if (!input) continue;
      input.setCustomValidity('');
      input.setAttribute('aria-invalid', 'false');
      if (document.activeElement !== input) {
        input.value = formatDesignerPlotBound(range[bound], axis.scale);
      }
    }
  }

  /** Enable the global clear action only while a persistent plot tag exists. */
  syncPlotPinControl() {
    const button = document.getElementById('dsgn-clear-plot-marker');
    if (button) button.disabled = designerPlotTagCount(this.plotTags) === 0;
  }

  _updateInsertButtons() {
    const replaceBtn = document.getElementById('dsgn-action-replace');
    const insertBtn = document.getElementById('dsgn-action-insert');
    if (replaceBtn) replaceBtn.classList.toggle('active', !this.insertMode);
    if (insertBtn) insertBtn.classList.toggle('active', !!this.insertMode);
  }

  /** Toggle the opt-in matcher. Enabling is one undoable draft action; later
   * structural edits retain the mode in their own snapshots. */
  _setAutoTuneEnabled(enabled) {
    const next = enabled === true;
    if (next === this.autoTuneEnabled) {
      this._updateAutoTuneControl();
      return;
    }
    if (next && this.isOpen && this.draftNodes.length > 0) this._pushUndo();
    this.autoTuneEnabled = next;
    this._lastAutoTuneSummary = null;
    this._lastTuningKey = null;
    if (this.isOpen) {
      this._recalcDraft();
      this._updateDraftBar();
      this._renderAll();
    } else {
      this._updateAutoTuneControl();
    }
  }

  /** Keep the lower-right checkbox and managed-element count in sync. */
  _updateAutoTuneControl() {
    const input = document.getElementById('dsgn-auto-tune');
    const root = document.getElementById('dsgn-auto-tune-control');
    const status = document.getElementById('dsgn-auto-tune-status');
    if (input) input.checked = this.autoTuneEnabled === true;
    if (root) root.classList.toggle('active', this.autoTuneEnabled === true);
    if (!status) return;
    if (!this.autoTuneEnabled) {
      status.textContent = 'MANUAL';
      return;
    }
    const magnets = this._lastAutoTuneSummary?.managedMagnets || 0;
    const rf = this._lastAutoTuneSummary?.managedRf || 0;
    status.textContent = `${magnets} MAG · ${rf} RF`;
  }

  _commissioningTargetS() {
    return inferInjectorTargetS(this.draftEnvelope || []);
  }

  _updateCommissioningPanel() {
    const root = document.getElementById('dsgn-commissioning-control');
    const status = document.getElementById('dsgn-commissioning-status');
    const metrics = document.getElementById('dsgn-commissioning-metrics');
    const button = document.getElementById('dsgn-commissioning-optimize');
    if (!root || !status || !metrics || !button) return;

    const report = commissioningReport(this.draftEnvelope || [], {
      targetS: this._commissioningTargetS(),
    });
    const hasMagnets = this.draftNodes.some(node =>
      ['solenoid', 'quadrupole', 'scQuad'].includes(node?.type));
    button.disabled = this.commissioningBusy || this.physicsPending || !report || !hasMagnets;
    button.textContent = this.commissioningBusy ? 'Scanning…' : 'Match section';

    if (!report) {
      status.textContent = this.physicsPending ? 'SOLVING BEAM…' : 'WAITING FOR BEAM';
      metrics.innerHTML = '<span class="dsgn-commissioning-metric"><span>Add a source and beamline to begin</span></span>';
      return;
    }

    if (this.commissioningBusy && this._commissioningProgress) {
      const { evaluations, total } = this._commissioningProgress;
      status.textContent = `SOLVING ${Math.min(evaluations, total)} / ${total}`;
    } else {
      const score = Math.round(report.score * 100);
      const previous = this._lastCommissioningResult?.before?.score;
      const gain = Number.isFinite(previous)
        ? Math.max(0, Math.round((report.score - previous) * 100))
        : 0;
      status.textContent = `0–${report.targetS.toFixed(1)} M · ${score}/100${gain ? ` · +${gain}` : ''}`;
    }

    const capture = report.captureEfficiency;
    const margin = report.minFocusMargin;
    const rows = [
      ['Capture', _commissioningPercent(capture), _commissioningTone(capture, 0.6, 0.4)],
      ['Transmit', _commissioningPercent(report.transmission), _commissioningTone(report.transmission, 0.8, 0.55)],
      ['ε keep', _commissioningPercent(report.emittancePreservation), _commissioningTone(report.emittancePreservation, 0.95, 0.8)],
      ['Aperture', _commissioningPercent(margin), _commissioningTone(margin, 0.5, 0.2)],
      ['Bunch', _commissioningDuration(report.bunchLength), report.bunchFrequency > 0 ? 'good' : 'watch'],
      ['I peak', Number.isFinite(report.peakCurrent) ? `${report.peakCurrent.toFixed(2)} A` : '--', ''],
    ];
    metrics.innerHTML = rows.map(([label, value, tone]) =>
      `<span class="dsgn-commissioning-metric ${tone}"><span>${label}</span><strong>${value}</strong></span>`
    ).join('');
  }

  /** Scan the current source-to-5 MeV section through the authoritative worker
   * solver. This is deliberately an explicit action rather than continuous:
   * one run can evaluate dozens of candidates, while the lightweight Auto mode
   * remains suitable for every slider drag and structural edit. */
  async _optimizeInjectorSection() {
    if (this.commissioningBusy || this.physicsPending || !this.draftEnvelope?.length) return;
    const run = ++this._commissioningRun;
    const startingRevision = this._draftPhysicsRevision;
    const targetS = this._commissioningTargetS();
    this.commissioningBusy = true;
    this._commissioningProgress = { evaluations: 0, total: 1 };
    this._updateCommissioningPanel();

    try {
      const result = await optimizeInjectorMagnets({
        nodes: this.draftNodes,
        initialEnvelope: this.draftEnvelope,
        targetS,
        evaluate: nodes => this._computePhysics(nodes, 'designer:commissioning'),
        onProgress: progress => {
          if (run !== this._commissioningRun) return;
          this._commissioningProgress = progress;
          this._updateCommissioningPanel();
        },
      });
      // A structural edit or another run supersedes this scan. Candidate
      // solves are read-only, so abandoning their answer needs no rollback.
      if (!this.isOpen || run !== this._commissioningRun
          || startingRevision !== this._draftPhysicsRevision) return;

      if (result.updates.length) {
        this._pushUndo();
        for (const update of result.updates) {
          const node = this.draftNodes[update.index];
          if (!node) continue;
          node.params = { ...(node.params || {}), ...update.params };
          node.computedStats = null;
        }
        // The continuous rigidity heuristic owns the same controls and would
        // immediately overwrite a solved section match. Leave the optimized
        // setpoints in manual mode so they remain the values the scan proved.
        this.autoTuneEnabled = false;
        this._lastAutoTuneSummary = null;
        this._lastTuningKey = null;
        this._commissioningApplying = true;
        await this._recalcDraft();
        this._commissioningApplying = false;
        this._lastCommissioningResult = {
          ...result,
          after: commissioningReport(this.draftEnvelope || [], { targetS }),
        };
        this._updateDraftBar();
      } else {
        this._lastCommissioningResult = result;
      }
    } finally {
      if (run === this._commissioningRun) {
        this.commissioningBusy = false;
        this._commissioningApplying = false;
        this._commissioningProgress = null;
        this._renderAll();
      }
    }
  }

  serializeState() {
    if (!this.isOpen) return null;
    // Envelopes are deliberately absent: draftEnvelope and baselineEnvelope are
    // both physics output, rebuilt by restoreState's _recalcDraft / by
    // openFromSource. Persisting them would freeze a physics answer into the
    // save file and show a stale curve after any balance change.
    return {
      isOpen: true,
      mode: this.mode,
      beamlineId: this.beamlineId,
      editSourceId: this.editSourceId || null,
      editEndpointId: this.editEndpointId || null,
      designId: this.designId,
      designName: this.designName,
      draftWorkspaceId: this.draftWorkspaceId,
      activeWorkspaceDraftId: this.activeWorkspaceDraftId,
      // The map back-references ride along in edit mode. They are what the
      // planner aligns the draft against, so a draft restored without them
      // reads as "every module is new, including the source" and Apply refuses
      // the whole thing as source_immovable. subL travels for the same reason
      // _nodeSubL exists: a drift's real length is on the node, not the
      // component template.
      draftNodes: this._draftPayload().draftNodes,
      selectedIndex: this.selectedIndex,
      viewX: this.viewX,
      viewZoom: this.viewZoom,
      autoTuneEnabled: this.autoTuneEnabled,
    };
  }

  restoreState(state) {
    if (!state || !state.isOpen) return;

    if (state.mode === 'edit' && state.editSourceId) {
      this.autoTuneEnabled = state.autoTuneEnabled === true;
      this.openFromSource(state.editSourceId, state.editEndpointId);
      if (state.activeWorkspaceDraftId && this.draftWorkspaceId) {
        this.game.selectBeamlineDesignerDraft?.(
          this.draftWorkspaceId,
          state.activeWorkspaceDraftId,
        );
        this.activeWorkspaceDraftId = state.activeWorkspaceDraftId;
      }
      if (state.draftNodes?.length) {
        this.draftNodes = this._inflateDraftNodes(state.draftNodes);
        this.selectedIndex = state.selectedIndex;
        this.viewX = state.viewX;
        this.viewZoom = state.viewZoom;
        this._updateTotalLength();
        this._recalcDraft();
        this._updateDraftBar();
        this._renderAll();
        this._activeDraftOpenSnapshot = this._draftPayload();
      }
    } else if (state.mode === 'design') {
      this.autoTuneEnabled = state.autoTuneEnabled === true;
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
