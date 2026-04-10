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

  // --- Draw lab background (scrolls with components) ---
  // We need panOffsetPx early for the background, so compute layout first
  const _compWidths = this.draftNodes.map(n => {
    const comp = COMPONENTS[n.type];
    const len = comp ? 1 : 1;
    return Math.max(SCHEM_PW, Math.round(len * SCHEM_PW / 5));
  });
  const _totalPW = _compWidths.reduce((s, w) => s + w, 0);
  const _baseZoom = W / (5 * SCHEM_PW + 40);
  const _effZoom = this.viewZoom * _baseZoom;
  const _panPx = -this.viewX * _effZoom;
  // Compute floorY early for background (must match the main layout)
  const _schH = SCHEM_PH * _effZoom;
  const _railY = H * 0.50 + _schH / 2 + 2;
  const _floorY = _railY + 20 * _effZoom;
  _drawLabBackground(ctx, W, H, _panPx, _floorY);

  if (this.draftNodes.length === 0) {
    ctx.fillStyle = 'rgba(100, 100, 150, 0.5)';
    ctx.font = '14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('No components — add from palette below', W / 2, H / 2);
    ctx.restore();
    return;
  }

  // Calculate per-component pixel widths based on length (edge-to-edge, no gap)
  const compWidths = this.draftNodes.map(n => {
    const comp = COMPONENTS[n.type];
    const len = comp ? 1 : 1;
    return Math.max(SCHEM_PW, Math.round(len * SCHEM_PW / 5));
  });
  const totalPixelWidth = compWidths.reduce((s, w) => s + w, 0);

  // Fixed base zoom at ~5-component density; user controls additional zoom via viewZoom
  const baseZoom = W / (5 * SCHEM_PW + 40);
  const effectiveZoom = this.viewZoom * baseZoom;

  // Calculate pan offset in pixels
  const panOffsetPx = -this.viewX * effectiveZoom;

  // Components sit on the floor — beam line centered, everything scales with zoom
  const beamY = H * 0.50;
  const schematicH = SCHEM_PH * effectiveZoom;

  // Support stands and floor scale with zoom, relative to component bottom
  const railY = beamY + schematicH / 2 + 2;
  const supportH = 20 * effectiveZoom;   // support height scales with zoom
  const floorY = railY + supportH;

  // Draw each component (edge-to-edge, no gaps)
  let xPos = 20 + panOffsetPx;
  this._compRegions = [];
  this._ghostRegions = [];

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

    // Draw component using existing schematic drawer (pass params for polarity-aware rendering)
    const offscreen = this._drawComponentOffscreen(node.type, node.params);
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

    xPos += compW;
  }

  // Store total rendered width for viewport calculations
  this._renderedWidth = xPos - 20 - panOffsetPx;

  // --- Reorder drop indicator ---
  if (this._reorderDropIndex >= 0 && this._compRegions && this._compRegions.length > 0) {
    let dropX;
    if (this._reorderDropIndex < this._compRegions.length) {
      dropX = this._compRegions[this._reorderDropIndex].x;
    } else {
      const last = this._compRegions[this._compRegions.length - 1];
      dropX = last.x + last.w;
    }
    const compTop = beamY - schematicH / 2;
    // Glowing vertical line
    ctx.save();
    ctx.strokeStyle = '#ffaa22';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#ffaa22';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(dropX, compTop - 10);
    ctx.lineTo(dropX, compTop + schematicH + 10);
    ctx.stroke();
    ctx.restore();
    // Arrow triangles pointing inward
    ctx.fillStyle = '#ffaa22';
    const arrowY = beamY;
    // Left-pointing arrow
    ctx.beginPath();
    ctx.moveTo(dropX + 8, arrowY - 5);
    ctx.lineTo(dropX + 8, arrowY + 5);
    ctx.lineTo(dropX + 2, arrowY);
    ctx.closePath();
    ctx.fill();
    // Right-pointing arrow
    ctx.beginPath();
    ctx.moveTo(dropX - 8, arrowY - 5);
    ctx.lineTo(dropX - 8, arrowY + 5);
    ctx.lineTo(dropX - 2, arrowY);
    ctx.closePath();
    ctx.fill();
  }

  // --- Periodic support stands (fixed in beamline world-space) ---
  const beamlineStartX = 20 + panOffsetPx;
  const beamlineEndX = xPos;
  const supportSpacingWorld = 60 * effectiveZoom;  // scale with zoom
  const standW = Math.max(3, 5 * effectiveZoom);
  // Horizontal rail under beamline
  ctx.fillStyle = 'rgba(90, 95, 110, 0.5)';
  ctx.fillRect(beamlineStartX, railY - 2, beamlineEndX - beamlineStartX, 2);
  // Supports at fixed world positions starting from beamline start
  for (let sx = beamlineStartX; sx < beamlineEndX; sx += supportSpacingWorld) {
    if (sx < -standW || sx > W + standW) continue;  // cull offscreen
    // Vertical column
    ctx.fillStyle = 'rgba(70, 75, 90, 0.6)';
    ctx.fillRect(sx - standW / 2, railY, standW, floorY - railY);
    // Top bracket
    ctx.fillStyle = 'rgba(90, 95, 110, 0.5)';
    ctx.fillRect(sx - standW, railY - 1, standW * 2, 3);
    // Base plate
    ctx.fillStyle = 'rgba(80, 85, 100, 0.5)';
    ctx.fillRect(sx - standW - 1, floorY - 2, standW * 2 + 2, 2);
  }

  // --- Ghost quad markers (FODO advisor) ---
  if (this.ghostQuads && this.ghostQuads.length > 0 && this.totalLength > 0) {
    const tileLenSum = this.draftNodes.reduce((s, n) => {
      const c = COMPONENTS[n.type];
      return s + (c ? (c.subL || 4) * 0.5 : 1);
    }, 0) || 1;

    for (const ghost of this.ghostQuads) {
      // Map ghost.s to pixel position (same logic as marker)
      let ghostXPos = 20 + panOffsetPx;
      let cumS = 0;
      for (let i = 0; i < this.draftNodes.length; i++) {
        const comp = COMPONENTS[this.draftNodes[i].type];
        const tileLen = comp ? (comp.subL || 4) * 0.5 : 1;
        const compLen = (tileLen / tileLenSum) * this.totalLength;
        const cW = compWidths[i] * effectiveZoom;

        if (ghost.s <= cumS + compLen) {
          const frac = (ghost.s - cumS) / compLen;
          ghostXPos += frac * cW;
          break;
        }
        cumS += compLen;
        ghostXPos += cW;
      }

      // Draw ghost quad box
      const ghostW = Math.max(SCHEM_PW * 0.6, 30) * effectiveZoom;
      const ghostH = schematicH * 0.8;
      const ghostX = ghostXPos - ghostW / 2;
      const ghostY = beamY - ghostH / 2;

      // Dashed outline
      ctx.strokeStyle = 'rgba(68, 136, 255, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(ghostX, ghostY, ghostW, ghostH);
      ctx.setLineDash([]);

      // Semi-transparent fill
      ctx.fillStyle = 'rgba(68, 136, 255, 0.08)';
      ctx.fillRect(ghostX, ghostY, ghostW, ghostH);

      // Polarity label
      ctx.fillStyle = 'rgba(68, 136, 255, 0.6)';
      ctx.font = `${Math.max(9, 11 * effectiveZoom)}px monospace`;
      ctx.textAlign = 'center';
      const label = ghost.polarity === 1 ? 'F' : 'D';
      ctx.fillText(label, ghostXPos, beamY + 4);

      // "+" icon above
      ctx.fillStyle = 'rgba(68, 136, 255, 0.5)';
      ctx.font = `${Math.max(10, 14 * effectiveZoom)}px monospace`;
      ctx.fillText('+', ghostXPos, ghostY - 4);

      // Store click region for ghost interaction
      this._ghostRegions.push({
        x: ghostX, y: ghostY, w: ghostW, h: ghostH,
        ghost,
      });
    }
  }

  // Draw marker line at markerS position (in physical meters)
  // Use totalLength (from envelope) to derive per-component s-lengths so the
  // schematic marker stays in sync with the plot cursor.
  if (this.markerS >= 0 && this.totalLength > 0) {
    const tileLenSum = this.draftNodes.reduce((s, n) => {
      const c = COMPONENTS[n.type];
      return s + (c ? (c.subL || 4) * 0.5 : 1);
    }, 0) || 1;

    let markerXPos = 20 + panOffsetPx;
    let cumS = 0;
    for (let i = 0; i < this.draftNodes.length; i++) {
      const comp = COMPONENTS[this.draftNodes[i].type];
      const tileLen = comp ? (comp.subL || 4) * 0.5 : 1;
      // Scale so per-component lengths sum to this.totalLength
      const compLen = (tileLen / tileLenSum) * this.totalLength;
      const compW = compWidths[i] * effectiveZoom;

      if (this.markerS <= cumS + compLen) {
        const frac = (this.markerS - cumS) / compLen;
        markerXPos += frac * compW;
        break;
      }
      cumS += compLen;
      markerXPos += compW;
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

// --- Lab background rendering (simple procedural walls + concrete) ---

function _drawLabBackground(ctx, W, H, panOffset, floorY) {
  const pan = panOffset || 0;
  floorY = floorY || H * 0.90;

  // Back wall — dark gradient
  const wallGrad = ctx.createLinearGradient(0, 0, 0, floorY);
  wallGrad.addColorStop(0, '#12141e');
  wallGrad.addColorStop(1, '#191c26');
  ctx.fillStyle = wallGrad;
  ctx.fillRect(0, 0, W, floorY);

  // Concrete floor
  ctx.fillStyle = '#232630';
  ctx.fillRect(0, floorY, W, H - floorY);

  // Floor line
  ctx.strokeStyle = 'rgba(70, 75, 90, 0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, floorY);
  ctx.lineTo(W, floorY);
  ctx.stroke();

  // Floor tile joints — scroll with pan
  ctx.strokeStyle = 'rgba(50, 55, 68, 0.25)';
  ctx.lineWidth = 0.5;
  const tileW = 40;
  const floorOff = ((pan % tileW) + tileW) % tileW;
  for (let x = floorOff - tileW; x < W + tileW; x += tileW) {
    ctx.beginPath();
    ctx.moveTo(x, floorY);
    ctx.lineTo(x, H);
    ctx.stroke();
  }

  // Wall pillars — scroll with pan
  ctx.strokeStyle = 'rgba(40, 44, 58, 0.35)';
  ctx.lineWidth = 2;
  const pillarSpacing = 120;
  const pillarOff = ((pan % pillarSpacing) + pillarSpacing) % pillarSpacing;
  for (let x = pillarOff - pillarSpacing; x < W + pillarSpacing; x += pillarSpacing) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, floorY);
    ctx.stroke();
    // Pillar base
    ctx.fillStyle = 'rgba(45, 50, 62, 0.25)';
    ctx.fillRect(x - 5, floorY - 6, 10, 6);
  }

  // Horizontal cable tray
  ctx.fillStyle = 'rgba(35, 40, 52, 0.3)';
  ctx.fillRect(0, H * 0.18, W, 2);

  // Safety stripe along floor edge — scroll with pan
  ctx.fillStyle = 'rgba(160, 140, 30, 0.1)';
  const stripeW = 16;
  const stripeOff = ((pan % stripeW) + stripeW) % stripeW;
  for (let x = stripeOff - stripeW; x < W + stripeW; x += stripeW) {
    ctx.fillRect(x, floorY, 8, 2);
  }
}

BeamlineDesigner.prototype._drawComponentOffscreen = function(componentType, params) {
  // Cache offscreen canvases per component type + polarity
  if (!this._schematicCache) this._schematicCache = {};
  const polarity = params?.polarity;
  const cacheKey = polarity != null ? `${componentType}_p${polarity}` : componentType;
  if (this._schematicCache[cacheKey]) return this._schematicCache[cacheKey];

  // Create a tiny canvas and use Renderer's drawSchematic to generate pixel art
  const tiny = document.createElement('canvas');
  tiny.width = SCHEM_PW;
  tiny.height = SCHEM_PH;
  tiny.style.width = SCHEM_PW + 'px';
  tiny.style.height = SCHEM_PH + 'px';
  this.renderer.drawSchematic(tiny, componentType, params);

  this._schematicCache[cacheKey] = tiny;
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
  statsHtml += `<div class="ts-row"><span class="ts-label">Length</span><span class="ts-val">${((comp.subL || 4) * 0.5).toFixed(1)} <span class="ts-unit">m</span></span></div>`;

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

      // Binary params with labels → toggle buttons instead of slider
      if (def.labels && def.min === 0 && def.max === 1 && def.step === 1) {
        html += `<div class="param-toggle-row">`;
        html += `<span class="param-label">${_paramLabel(key)}</span>`;
        html += `<div class="param-toggle-group" data-toggle-param="${key}">`;
        for (const [lv, ll] of Object.entries(def.labels)) {
          const active = Math.round(val) === Number(lv) ? ' active' : '';
          html += `<button class="param-toggle-btn${active}" data-toggle-val="${lv}">${ll}</button>`;
        }
        html += `</div>`;
        html += `</div>`;
        continue;
      }

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
        this._renderSchematic();
        this._renderPlots();
      }, 150);
    });
  });

  // Wire up toggle button events (binary params like polarity)
  container.querySelectorAll('.param-toggle-group[data-toggle-param]').forEach(group => {
    const key = group.dataset.toggleParam;
    group.querySelectorAll('.param-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = Number(btn.dataset.toggleVal);
        node.params[key] = val;
        // Update active state
        group.querySelectorAll('.param-toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // Recompute derived + physics
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
        // Invalidate schematic cache so polarity change is visible
        if (this._schematicCache) {
          for (const k of Object.keys(this._schematicCache)) {
            if (k === node.type || k.startsWith(node.type + '_')) {
              delete this._schematicCache[k];
            }
          }
        }
        this._recalcDraft();
        this._updateDraftBar();
        this._renderSchematic();
        this._renderPlots();
      });
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
  // Compute the x/y ranges based on plot range modes
  const xRange = this._getPlotXRange();
  const yScale = this._getPlotYScale();

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
      ProbePlots.draw(off, plotType, envelope, pins, 0, xRange, yScale);
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

/** Compute the y-axis scale factor from the selected y-range mode.
 *  Returns a number that _range() results get multiplied by:
 *  'full' = null (auto), 'half' = 0.5, '30' / '9' = fixed max in meters. */
BeamlineDesigner.prototype._getPlotYScale = function() {
  const mode = this.plotYRangeMode || 'full';
  if (mode === 'full') return null;
  if (mode === 'half') return 0.5;
  return parseFloat(mode);  // fixed range in meters
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

  // In pipe-graph edit mode, only attachment-type components are insertable.
  // Modules must be placed on the main map, not the designer.
  const attachmentsOnly = !!this.editSourceId;

  const catComps = [];
  for (const [key, comp] of Object.entries(COMPONENTS)) {
    if (comp.category !== category) continue;
    if (!this.game.isComponentUnlocked(comp)) continue;
    if (isFacilityCategory(comp.category)) continue;
    if (attachmentsOnly && comp.placement !== 'attachment') continue;
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
  card.dataset.compType = key;

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
  cost.textContent = `${costs}  ·  ${comp.energyCost}kW  ·  ${((comp.subL || 4) * 0.5).toFixed(1)}m`;
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
      this.designerPaletteIndex = 0;
      this._renderDesignerPalette(key);
      this._applyDesignerPaletteFocus();
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
