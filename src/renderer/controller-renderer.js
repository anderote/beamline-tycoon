// src/renderer/controller-renderer.js — Schematic and plot rendering for controller view
// Extends ControllerView.prototype with canvas rendering methods.

import { ControllerView } from '../ui/ControllerView.js';
import { COMPONENTS } from '../data/components.js';
import { PARAM_DEFS, computeStats } from '../beamline/component-physics.js';
import { formatEnergy } from '../data/units.js';
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
  this._renderTuning();
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
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = 'rgba(100, 100, 150, 0.5)';
    ctx.font = '14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('No components — add from palette below', rect.width / 2, rect.height / 2);
    ctx.restore();
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

    // Index label under each component
    ctx.fillStyle = 'rgba(100, 100, 140, 0.6)';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${i + 1}`, xPos + compW / 2, centerY + compH / 2 + 10);

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

  // Create a tiny canvas and use Renderer's drawSchematic to generate pixel art
  const tiny = document.createElement('canvas');
  tiny.width = SCHEM_PW;
  tiny.height = SCHEM_PH;
  tiny.style.width = SCHEM_PW + 'px';
  tiny.style.height = SCHEM_PH + 'px';
  this.renderer.drawSchematic(tiny, componentType);

  this._schematicCache[componentType] = tiny;
  return tiny;
};

// ---- Tuning row rendering ----

ControllerView.prototype._renderTuning = function() {
  const nameEl = document.getElementById('ctrl-tuning-name');
  const descEl = document.getElementById('ctrl-tuning-desc');
  const statsEl = document.getElementById('ctrl-tuning-stats');
  const paramsEl = document.getElementById('ctrl-tuning-params');
  if (!nameEl || !paramsEl) return;

  if (this.selectedIndex < 0 || this.selectedIndex >= this.draftNodes.length) {
    nameEl.textContent = 'No component selected';
    descEl.textContent = '';
    statsEl.innerHTML = '';
    paramsEl.innerHTML = '';
    return;
  }

  const node = this.draftNodes[this.selectedIndex];
  const comp = COMPONENTS[node.type];
  if (!comp) {
    nameEl.textContent = node.type;
    descEl.textContent = '';
    statsEl.innerHTML = '';
    paramsEl.innerHTML = '';
    return;
  }

  // --- Left side: name, description, stats ---
  nameEl.textContent = comp.name;
  descEl.textContent = comp.desc || '';

  let statsHtml = '';
  const costStr = comp.cost ? Object.entries(comp.cost).map(([r, a]) =>
    r === 'funding' ? `$${a.toLocaleString()}` : `${a} ${r}`
  ).join(', ') : '--';
  statsHtml += `<span class="ts-row"><span class="ts-label">Cost:</span><span class="ts-val">${costStr}</span></span>`;
  statsHtml += `<span class="ts-row"><span class="ts-label">Energy:</span><span class="ts-val">${comp.energyCost}</span><span class="ts-unit">kW</span></span>`;
  statsHtml += `<span class="ts-row"><span class="ts-label">Length:</span><span class="ts-val">${comp.length}</span><span class="ts-unit">m</span></span>`;

  // Health from game state
  const entry = this.game.registry.get(this.beamlineId);
  if (entry && entry.beamState.componentHealth) {
    const health = entry.beamState.componentHealth[node.id];
    if (health != null) {
      const hColor = health > 60 ? '#4d4' : health > 25 ? '#da4' : '#f44';
      statsHtml += `<span class="ts-row"><span class="ts-label">Health:</span><span class="ts-val" style="color:${hColor}">${Math.round(health)}%</span></span>`;
    }
  }
  statsEl.innerHTML = statsHtml;

  // --- Right side: tuning parameters ---
  // Only rebuild if selected component changed (avoid losing slider state)
  const tuningKey = `${this.selectedIndex}:${node.type}`;
  if (this._lastTuningKey === tuningKey) return;
  this._lastTuningKey = tuningKey;

  let html = '';

  // Param option dropdowns (e.g., particleType: electron/proton)
  if (comp.paramOptions) {
    if (!node.params) node.params = {};
    for (const [key, options] of Object.entries(comp.paramOptions)) {
      const current = node.params[key] ?? comp.params?.[key] ?? options[0];
      html += `<div class="param-slider-row">`;
      html += `<span class="param-label">${_paramLabel(key)}</span>`;
      html += `<select data-param-option="${key}" class="param-select">`;
      for (const opt of options) {
        const sel = opt === current ? ' selected' : '';
        html += `<option value="${opt}"${sel}>${opt.charAt(0).toUpperCase() + opt.slice(1)}</option>`;
      }
      html += `</select>`;
      html += `</div>`;
    }
  }

  // Parameter sliders
  const paramDefs = PARAM_DEFS[node.type];
  if (paramDefs) {
    if (!node.params) {
      node.params = {};
      for (const [k, def] of Object.entries(paramDefs)) {
        if (!def.derived) node.params[k] = def.default;
      }
    }

    html += '<div class="popup-section-label">Parameters</div>';
    for (const [key, def] of Object.entries(paramDefs)) {
      if (def.derived) continue;
      const val = node.params[key] ?? def.default;
      html += `<div class="param-slider-row">`;
      html += `<span class="param-label">${_paramLabel(key)}</span>`;
      html += `<input type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${val}" data-param="${key}">`;
      if (def.labels) {
        html += `<span class="param-value" data-param-display="${key}">${def.labels[Math.round(val)] || val}</span>`;
      } else {
        html += `<span class="param-value" data-param-display="${key}">${_fmtParam(val)}</span>`;
      }
      html += `<span class="param-unit">${def.unit}</span>`;
      html += `</div>`;
    }

    // Derived readouts
    const derivedKeys = Object.entries(paramDefs).filter(([_, def]) => def.derived);
    if (derivedKeys.length > 0) {
      html += '<div class="popup-section-label">Output</div>';
      const computed = computeStats(node.type, node.params);
      for (const [key, def] of derivedKeys) {
        const val = computed ? computed[key] : (node.params[key] ?? def.default);
        const isEnergy = def.unit === 'GeV' || def.unit === 'GeV/c';
        const suffix = def.unit === 'GeV/c' ? '/c' : '';
        const dispVal = isEnergy ? formatEnergy(val, suffix).val : _fmtParam(val);
        const dispUnit = isEnergy ? formatEnergy(val, suffix).unit : def.unit;
        html += `<div class="param-derived-row">`;
        html += `<span class="param-label">${_paramLabel(key)}</span>`;
        html += `<span class="param-value" data-derived-display="${key}">${dispVal}</span>`;
        html += `<span class="param-unit" data-derived-unit="${key}">${dispUnit}</span>`;
        html += `</div>`;
      }
    }
  }

  if (!html) {
    html = '<span style="color:#556;font-size:10px">No tunable parameters</span>';
  }

  paramsEl.innerHTML = html;

  // Wire up slider events
  this._wireTuningSliders(node, paramDefs, paramsEl);

  // Wire up dropdown events
  paramsEl.querySelectorAll('select[data-param-option]').forEach(sel => {
    sel.addEventListener('change', () => {
      const key = sel.dataset.paramOption;
      if (!node.params) node.params = {};
      node.params[key] = sel.value;
      this._recalcDraft();
      this._renderPlots();
    });
  });
};

ControllerView.prototype._wireTuningSliders = function(node, paramDefs, container) {
  if (!paramDefs) return;
  let debounceTimer = null;

  const sliders = container.querySelectorAll('input[type="range"][data-param]');
  sliders.forEach(slider => {
    slider.addEventListener('input', () => {
      const key = slider.dataset.param;
      const def = paramDefs[key];
      const val = parseFloat(slider.value);
      node.params[key] = val;

      // Update displayed value
      const display = container.querySelector(`[data-param-display="${key}"]`);
      if (display) {
        if (def.labels) {
          display.textContent = def.labels[Math.round(val)] || val;
        } else {
          display.textContent = _fmtParam(val);
        }
      }

      // Debounced recalc
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        // Recompute derived values
        const computed = computeStats(node.type, node.params);
        if (computed) {
          node.computedStats = computed;
          for (const [dKey, dDef] of Object.entries(paramDefs)) {
            if (!dDef.derived) continue;
            const dDisplay = container.querySelector(`[data-derived-display="${dKey}"]`);
            const dUnit = container.querySelector(`[data-derived-unit="${dKey}"]`);
            if (dDisplay && computed[dKey] != null) {
              const isEnergy = dDef.unit === 'GeV' || dDef.unit === 'GeV/c';
              const suffix = dDef.unit === 'GeV/c' ? '/c' : '';
              dDisplay.textContent = isEnergy ? formatEnergy(computed[dKey], suffix).val : _fmtParam(computed[dKey]);
              if (dUnit) dUnit.textContent = isEnergy ? formatEnergy(computed[dKey], suffix).unit : dDef.unit;
            }
          }
        }
        // Recalc physics and update plots
        this._recalcDraft();
        this._updateDraftBar();
        this._renderPlots();
      }, 150);
    });
  });
};

// Helper functions (copied from Renderer to avoid coupling)
function _paramLabel(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
}

function _fmtParam(val) {
  if (val === undefined || val === null) return '--';
  if (Math.abs(val) >= 100) return val.toFixed(0);
  if (Math.abs(val) >= 1) return val.toFixed(2);
  if (Math.abs(val) >= 0.01) return val.toFixed(3);
  return val.toExponential(2);
}

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
