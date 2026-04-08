// src/renderer/designer-renderer.js — Schematic and plot rendering for designer view
// Extends BeamlineDesigner.prototype with canvas rendering methods.

import { BeamlineDesigner } from '../ui/BeamlineDesigner.js';
import { COMPONENTS } from '../data/components.js';
import { PARAM_DEFS, computeStats } from '../beamline/component-physics.js';
import { formatEnergy } from '../data/units.js';
import { MODES } from '../data/modes.js';
import { UNITS } from '../data/units.js';
import { Renderer, isFacilityCategory } from './Renderer.js';
import { ProbePlots } from '../ui/probe-plots.js';

// Schematic pixel dimensions per component (same as overlays.js drawSchematic)
const SCHEM_PW = 70;
const SCHEM_PH = 30;

// Gap between components in pixels (at base zoom)
const COMP_GAP = 4;

// ---- Schematic rendering ----

BeamlineDesigner.prototype._renderAll = function() {
  if (!this.isOpen) return;
  this._renderSchematic();
  this._renderTuning();
  this._renderPlots();
};

BeamlineDesigner.prototype._renderSchematic = function() {
  const canvas = document.getElementById('dsgn-schematic-canvas');
  if (!canvas) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const W = rect.width;
  const H = rect.height;

  ctx.save();
  ctx.scale(dpr, dpr);

  // --- Draw lab background ---
  _drawLabBackground(ctx, W, H);

  if (this.draftNodes.length === 0) {
    ctx.fillStyle = 'rgba(100, 100, 150, 0.5)';
    ctx.font = '14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('No components — add from palette below', W / 2, H / 2);
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
  const baseZoom = W / (totalPixelWidth + 40);
  const effectiveZoom = this.viewZoom * baseZoom;

  // Calculate pan offset in pixels
  const panOffsetPx = -this.viewX * effectiveZoom;

  // Components sit on the floor — position beam line at ~60% height
  const beamY = H * 0.55;
  const schematicH = SCHEM_PH * effectiveZoom;

  // --- Beamline rail / beam pipe on the floor ---
  // Support stands
  const railY = beamY + schematicH / 2 + 2;
  const floorY = H * 0.88;

  // Beam pipe background (long horizontal tube)
  ctx.fillStyle = 'rgba(40, 50, 65, 0.6)';
  ctx.fillRect(0, beamY - 2, W, 4);

  // Beam dashes through the pipe
  ctx.strokeStyle = 'rgba(34, 200, 100, 0.25)';
  ctx.lineWidth = 1;
  ctx.setLineDash([8, 5]);
  ctx.beginPath();
  ctx.moveTo(0, beamY);
  ctx.lineTo(W, beamY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw each component
  let xPos = 20 + panOffsetPx;
  this._compRegions = [];

  for (let i = 0; i < this.draftNodes.length; i++) {
    const node = this.draftNodes[i];
    const compW = compWidths[i] * effectiveZoom;
    const compH = schematicH;
    const compTop = beamY - compH / 2;

    // Store region for click detection
    this._compRegions.push({
      x: xPos,
      y: compTop,
      w: compW,
      h: compH,
      index: i,
    });

    // Support stand under each component
    ctx.fillStyle = 'rgba(50, 55, 70, 0.7)';
    const standW = Math.max(4, compW * 0.15);
    const standX = xPos + compW / 2 - standW / 2;
    ctx.fillRect(standX, railY, standW, floorY - railY);
    // Stand base
    ctx.fillStyle = 'rgba(60, 65, 80, 0.6)';
    ctx.fillRect(standX - 2, floorY - 3, standW + 4, 3);

    // Shadow under the component
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.fillRect(xPos + 2, compTop + compH + 1, compW, 3);

    // Draw component using existing schematic drawer
    const offscreen = this._drawComponentOffscreen(node.type);
    if (offscreen) {
      ctx.drawImage(offscreen, xPos, compTop, compW, compH);
    }

    // Selection highlight
    if (i === this.selectedIndex) {
      ctx.strokeStyle = '#4488ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(xPos - 1, compTop - 1, compW + 2, compH + 2);

      // Glow effect
      ctx.shadowColor = '#4488ff';
      ctx.shadowBlur = 8;
      ctx.strokeRect(xPos - 1, compTop - 1, compW + 2, compH + 2);
      ctx.shadowBlur = 0;

      // Component name label
      ctx.fillStyle = '#aaccff';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      const comp = COMPONENTS[node.type];
      ctx.fillText(comp ? comp.name : node.type, xPos + compW / 2, compTop - 8);
    }

    // Index label under component
    ctx.fillStyle = 'rgba(100, 100, 140, 0.6)';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${i + 1}`, xPos + compW / 2, compTop + compH + 14);

    // Beam pipe connector to next component
    if (i < this.draftNodes.length - 1) {
      const gapW = COMP_GAP * effectiveZoom;
      // Pipe segment
      ctx.fillStyle = 'rgba(45, 55, 70, 0.5)';
      ctx.fillRect(xPos + compW, beamY - 2, gapW, 4);
      // Beam dash
      ctx.strokeStyle = 'rgba(34, 200, 100, 0.2)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.moveTo(xPos + compW, beamY);
      ctx.lineTo(xPos + compW + gapW, beamY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    xPos += compW + COMP_GAP * effectiveZoom;
  }

  // Store total rendered width for viewport calculations
  this._renderedWidth = xPos - 20 - panOffsetPx;

  // Draw marker line at markerS position
  if (this.markerS >= 0 && this.totalLength > 0) {
    let markerXPos = 20 + panOffsetPx;
    let cumS = 0;
    for (let i = 0; i < this.draftNodes.length; i++) {
      const comp = COMPONENTS[this.draftNodes[i].type];
      const compLen = comp ? comp.length : 1;
      const compW = compWidths[i] * effectiveZoom;
      const gapW = COMP_GAP * effectiveZoom;

      if (this.markerS <= cumS + compLen) {
        const frac = (this.markerS - cumS) / compLen;
        markerXPos += frac * compW;
        break;
      }
      cumS += compLen;
      markerXPos += compW + gapW;
    }

    // Marker line from top to floor
    ctx.strokeStyle = 'rgba(68, 136, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(markerXPos, 10);
    ctx.lineTo(markerXPos, floorY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Triangle indicator at top
    ctx.fillStyle = '#4488ff';
    ctx.beginPath();
    ctx.moveTo(markerXPos - 5, 4);
    ctx.lineTo(markerXPos + 5, 4);
    ctx.lineTo(markerXPos, 12);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
};

// --- Lab background rendering ---

function _drawLabBackground(ctx, W, H) {
  // Concrete floor
  const floorY = H * 0.88;
  ctx.fillStyle = 'rgba(35, 38, 48, 0.95)';
  ctx.fillRect(0, floorY, W, H - floorY);
  // Floor line
  ctx.strokeStyle = 'rgba(70, 75, 90, 0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, floorY);
  ctx.lineTo(W, floorY);
  ctx.stroke();

  // Floor tiles pattern
  ctx.strokeStyle = 'rgba(50, 55, 68, 0.3)';
  ctx.lineWidth = 0.5;
  const tileW = 40;
  for (let x = 0; x < W; x += tileW) {
    ctx.beginPath();
    ctx.moveTo(x, floorY);
    ctx.lineTo(x, H);
    ctx.stroke();
  }

  // Back wall — subtle gradient
  const wallGrad = ctx.createLinearGradient(0, 0, 0, floorY);
  wallGrad.addColorStop(0, 'rgba(18, 20, 30, 0.95)');
  wallGrad.addColorStop(1, 'rgba(25, 28, 38, 0.95)');
  ctx.fillStyle = wallGrad;
  ctx.fillRect(0, 0, W, floorY);

  // Wall panel lines (vertical girders/pillars)
  ctx.strokeStyle = 'rgba(45, 50, 65, 0.4)';
  ctx.lineWidth = 2;
  const pillarSpacing = 120;
  for (let x = pillarSpacing / 2; x < W; x += pillarSpacing) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, floorY);
    ctx.stroke();
    // Pillar base bracket
    ctx.fillStyle = 'rgba(50, 55, 70, 0.3)';
    ctx.fillRect(x - 6, floorY - 8, 12, 8);
  }

  // Horizontal wall stripe (cable tray / conduit)
  const traysY = [H * 0.12, H * 0.25];
  for (const ty of traysY) {
    ctx.fillStyle = 'rgba(40, 45, 58, 0.35)';
    ctx.fillRect(0, ty, W, 3);
  }

  // Ceiling-mounted cable runs (small dashes across top)
  ctx.strokeStyle = 'rgba(60, 70, 90, 0.2)';
  ctx.lineWidth = 1;
  ctx.setLineDash([12, 8]);
  for (let y = 8; y < H * 0.15; y += 10) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Radiation warning signs on wall (small yellow triangles at intervals)
  const signSpacing = 240;
  for (let x = signSpacing; x < W - 20; x += signSpacing) {
    const sy = H * 0.32;
    ctx.fillStyle = 'rgba(200, 180, 40, 0.25)';
    ctx.beginPath();
    ctx.moveTo(x, sy - 6);
    ctx.lineTo(x + 5, sy + 4);
    ctx.lineTo(x - 5, sy + 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(200, 180, 40, 0.15)';
    ctx.fillRect(x - 1, sy - 2, 2, 3);
  }

  // Safety stripe along floor edge
  ctx.fillStyle = 'rgba(180, 160, 40, 0.12)';
  for (let x = 0; x < W; x += 16) {
    ctx.fillRect(x, floorY, 8, 2);
  }
}

BeamlineDesigner.prototype._drawComponentOffscreen = function(componentType) {
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

BeamlineDesigner.prototype._renderTuning = function() {
  const nameEl = document.getElementById('dsgn-tuning-name');
  const descEl = document.getElementById('dsgn-tuning-desc');
  const statsEl = document.getElementById('dsgn-tuning-stats');
  const paramsEl = document.getElementById('dsgn-tuning-params');
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

  // --- Left column: name + full description ---
  nameEl.textContent = comp.name;
  descEl.textContent = comp.desc || '';

  // --- Middle column: base stats ---
  let statsHtml = '';
  const costStr = comp.cost ? Object.entries(comp.cost).map(([r, a]) =>
    r === 'funding' ? `$${a.toLocaleString()}` : `${a} ${r}`
  ).join(', ') : '--';
  statsHtml += `<div class="ts-row"><span class="ts-label">Cost</span><span class="ts-val">${costStr}</span></div>`;
  statsHtml += `<div class="ts-row"><span class="ts-label">Energy Cost</span><span class="ts-val">${comp.energyCost} <span class="ts-unit">kW</span></span></div>`;
  statsHtml += `<div class="ts-row"><span class="ts-label">Length</span><span class="ts-val">${comp.length} <span class="ts-unit">m</span></span></div>`;

  // Component-specific base stats
  if (comp.stats) {
    for (const [k, v] of Object.entries(comp.stats)) {
      const label = _paramLabel(k);
      if (k === 'energyGain') {
        const e = formatEnergy(v);
        statsHtml += `<div class="ts-row"><span class="ts-label">${label}</span><span class="ts-val">${e.val} <span class="ts-unit">${e.unit}</span></span></div>`;
      } else {
        const unit = typeof UNITS !== 'undefined' && UNITS[k] ? UNITS[k] : '';
        statsHtml += `<div class="ts-row"><span class="ts-label">${label}</span><span class="ts-val">${v}${unit ? ' <span class="ts-unit">' + unit + '</span>' : ''}</span></div>`;
      }
    }
  }

  // Health from game state
  const entry = this.game.registry.get(this.beamlineId);
  if (entry && entry.beamState.componentHealth) {
    const health = entry.beamState.componentHealth[node.id];
    if (health != null) {
      const hColor = health > 60 ? '#4d4' : health > 25 ? '#da4' : '#f44';
      statsHtml += `<div class="ts-row"><span class="ts-label">Health</span><span class="ts-val" style="color:${hColor}">${Math.round(health)}%</span></div>`;
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

BeamlineDesigner.prototype._wireTuningSliders = function(node, paramDefs, container) {
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

// Plot downscale factor — render at 1/PLOT_SCALE of display size for chunky pixel look
const PLOT_SCALE = 1.2;

BeamlineDesigner.prototype._renderPlots = function() {
  // Compute the x-range based on plot range mode
  const xRange = this._getPlotXRange();

  const panels = document.querySelectorAll('.dsgn-plot-panel');
  panels.forEach((panel) => {
    const select = panel.querySelector('.dsgn-plot-select');
    const canvas = panel.querySelector('.dsgn-plot-canvas');
    if (!select || !canvas) return;

    const rect = panel.getBoundingClientRect();
    const plotW = Math.floor(rect.width / PLOT_SCALE);
    const plotH = Math.floor((rect.height - 28) / PLOT_SCALE);
    if (plotW < 10 || plotH < 10) return;

    const plotType = select.value;
    const envelope = this.draftEnvelope;

    // Render to a small offscreen canvas
    const off = document.createElement('canvas');
    off.width = plotW;
    off.height = plotH;

    if (!envelope || envelope.length < 2) {
      const ctx = off.getContext('2d');
      ctx.fillStyle = 'rgba(5, 5, 20, 0.6)';
      ctx.fillRect(0, 0, plotW, plotH);
      ctx.fillStyle = 'rgba(100, 100, 150, 0.5)';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No beam data', plotW / 2, plotH / 2);
    } else {
      // Build a pin at the marker position, passing exact s for alignment
      const markerIdx = this.getMarkerEnvelopeIndex();
      const pins = [];
      if (markerIdx >= 0) {
        pins.push({
          elementIndex: markerIdx,
          s: this.markerS,
          color: '#4488ff',
        });
      }
      ProbePlots.draw(off, plotType, envelope, pins, 0, xRange);
    }

    // Scale up to display canvas with nearest-neighbor (crispy pixels)
    canvas.width = Math.floor(rect.width);
    canvas.height = Math.floor(rect.height - 28);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(off, 0, 0, plotW, plotH, 0, 0, canvas.width, canvas.height);
  });
};

/** Compute the plot x-range based on the selected range mode. */
BeamlineDesigner.prototype._getPlotXRange = function() {
  const mode = this.plotRangeMode || 'full';
  if (mode === 'full') {
    return [0, this.totalLength];
  }
  // Windowed mode: center on marker
  const halfW = parseFloat(mode) / 2;
  let lo = this.markerS - halfW;
  let hi = this.markerS + halfW;
  // Clamp to beamline bounds
  if (lo < 0) { hi -= lo; lo = 0; }
  if (hi > this.totalLength) { lo -= (hi - this.totalLength); hi = this.totalLength; }
  lo = Math.max(0, lo);
  return [lo, hi];
};

// ---- Click detection on schematic ----

BeamlineDesigner.prototype._hitTestSchematic = function(clientX, clientY) {
  const canvas = document.getElementById('dsgn-schematic-canvas');
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

// ---- Controller palette rendering (beamline-only, with preview cards) ----

BeamlineDesigner.prototype._renderDesignerPalette = function(category) {
  const palette = document.getElementById('component-palette');
  if (!palette) return;
  palette.innerHTML = '';

  // Only show beamline components
  const mode = MODES.beamline;
  const catDef = mode?.categories?.[category];
  if (!catDef) return;

  const catComps = [];
  for (const [key, comp] of Object.entries(COMPONENTS)) {
    if (comp.category !== category) continue;
    if (!this.game.isComponentUnlocked(comp)) continue;
    if (isFacilityCategory(comp.category)) continue;
    catComps.push({ key, comp });
  }

  const subsections = catDef.subsections;
  if (subsections && Object.keys(subsections).length > 0) {
    let renderedSections = 0;
    for (const subKey of Object.keys(subsections)) {
      const subDef = subsections[subKey];
      const subComps = catComps.filter(({ comp }) =>
        comp.subsection ? comp.subsection === subKey : false
      );
      if (subComps.length === 0) continue;

      if (renderedSections > 0) {
        const divider = document.createElement('div');
        divider.className = 'palette-subsection-divider';
        palette.appendChild(divider);
      }

      const section = document.createElement('div');
      section.className = 'palette-subsection';

      const label = document.createElement('div');
      label.className = 'palette-subsection-label';
      label.textContent = subDef.name;
      section.appendChild(label);

      const items = document.createElement('div');
      items.className = 'palette-subsection-items';
      for (const { key, comp } of subComps) {
        items.appendChild(this._createDesignerPaletteCard(key, comp));
      }
      section.appendChild(items);
      palette.appendChild(section);
      renderedSections++;
    }
  } else {
    for (const { key, comp } of catComps) {
      palette.appendChild(this._createDesignerPaletteCard(key, comp));
    }
  }
};

BeamlineDesigner.prototype._createDesignerPaletteCard = function(key, comp) {
  const card = document.createElement('div');
  card.className = 'dsgn-palette-card';

  // Schematic canvas
  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'dsgn-card-schematic';
  const canvas = document.createElement('canvas');
  canvas.width = 180;
  canvas.height = 60;
  canvas.style.width = '180px';
  canvas.style.height = '60px';
  this.renderer.drawSchematic(canvas, key);
  canvasWrap.appendChild(canvas);
  card.appendChild(canvasWrap);

  // Info section
  const info = document.createElement('div');
  info.className = 'dsgn-card-info';

  const name = document.createElement('div');
  name.className = 'dsgn-card-name';
  name.textContent = comp.name;
  info.appendChild(name);

  // Short description (first sentence)
  if (comp.desc) {
    const desc = document.createElement('div');
    desc.className = 'dsgn-card-desc';
    desc.textContent = comp.desc;
    info.appendChild(desc);
  }

  const costs = Object.entries(comp.cost).map(([r, a]) =>
    r === 'funding' ? `$${a.toLocaleString()}` : `${a} ${r}`
  ).join(', ');
  const cost = document.createElement('div');
  cost.className = 'dsgn-card-cost';
  cost.textContent = `${costs}  ·  ${comp.energyCost}kW  ·  ${comp.length}m`;
  info.appendChild(cost);

  card.appendChild(info);

  // Affordable check
  if (!this.game.canAfford(comp.cost)) {
    card.classList.add('unaffordable');
  }

  // Click handler
  card.addEventListener('click', () => {
    if (this.renderer._onToolSelect) {
      this.renderer._onToolSelect(key);
    }
  });

  return card;
};

BeamlineDesigner.prototype._setupDesignerTabs = function() {
  const tabsContainer = document.getElementById('category-tabs');
  if (!tabsContainer) return;
  tabsContainer.innerHTML = '';

  const mode = MODES.beamline;
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
      this._renderDesignerPalette(key);
    });
    tabsContainer.appendChild(btn);
  });

  // Hide mode switcher and connection tools
  const modeSwitcher = document.getElementById('mode-switcher');
  if (modeSwitcher) modeSwitcher.style.display = 'none';
  const connTools = document.getElementById('connection-tools');
  if (connTools) connTools.style.display = 'none';

  // Render first category
  if (catKeys.length > 0) {
    this._renderDesignerPalette(catKeys[0]);
  }
};

BeamlineDesigner.prototype._restoreNormalTabs = function() {
  const modeSwitcher = document.getElementById('mode-switcher');
  if (modeSwitcher) modeSwitcher.style.display = '';
  const connTools = document.getElementById('connection-tools');
  if (connTools) connTools.style.display = '';
  // Regenerate normal tabs
  this.renderer._generateCategoryTabs();
};
