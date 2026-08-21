// src/renderer/designer-renderer.js — Schematic and plot rendering for designer view
// Extends BeamlineDesigner.prototype with canvas rendering methods.

import { BeamlineDesigner } from '../ui/BeamlineDesigner.js';
import { COMPONENTS } from '../data/components.js';
import { PARAM_DEFS, computeStats } from '../beamline/component-physics.js';
import { BeamPhysics } from '../beamline/physics.js';
import { isDesignerAutoManagedParam } from '../beamline/designer-auto-tuning.js';
import { formatEnergy } from '../data/units.js';
import { MODES } from '../data/modes.js';
import { UNITS } from '../data/units.js';
import { isFacilityCategory } from './Renderer.js';
import { beamlineTypeHidesComponent } from '../ui/BeamlineTypePicker.js';
import { getBeamlineType } from '../data/beamline-types.js';
import { ProbePlots } from '../ui/probe-plots.js';
import {
  applyDesignerPlotYRange,
  validateDesignerFixedYRange,
} from '../ui/designer-plot-controls.js';
import { paletteUtilityMetrics } from '../ui/utility-supply.js';
import {
  appendRequiredPortRequirements,
  requiredUtilityPorts,
} from '../ui/required-port-preview.js';

// Schematic pixel dimensions per component (same as overlays.js drawSchematic)
const SCHEM_PW = 70;
const SCHEM_PH = 30;

function _driftPixelWidth(componentType, subL) {
  if (componentType !== 'drift') return SCHEM_PW;
  const s = subL || 4;
  return Math.max(Math.round(SCHEM_PW / 2), Math.round((s / 4) * SCHEM_PW));
}



// ---- Schematic rendering ----

BeamlineDesigner.prototype._renderAll = function() {
  if (!this.isOpen) return;
  this._updateAutoTuneControl();
  this._renderSchematic();
  this._renderTuning();
  this._renderPlots();
};

const _missionFomLabels = {
  beamPowerKw: 'Beam power', beamPowerMw: 'Beam power', fluence: 'Fluence',
  doseAvailability: 'Availability', photonFlux: 'Photon flux',
  felBrilliance: 'FEL brilliance', euvPhotonPowerW: 'EUV photon power',
  integratedLuminosity: 'Luminosity', blackHoleYield: 'Predicted yield',
};

function _inBand(value, band) {
  if (!band || band.length !== 2) return value > 0;
  if (!(value > 0)) return false;
  return (band[0] == null || value >= band[0]) && (band[1] == null || value <= band[1]);
}

function _fmtEnergyValue(gev) {
  const out = formatEnergy(gev || 0);
  return `${out.val} ${out.unit}`;
}

function _fmtBand(band, formatter) {
  if (!band) return 'No target band';
  const [lo, hi] = band;
  if (lo == null) return `≤ ${formatter(hi)}`;
  if (hi == null) return `≥ ${formatter(lo)}`;
  return `${formatter(lo)}–${formatter(hi)}`;
}

function _fmtBeta(value) {
  if (!Number.isFinite(value)) return '--';
  return value < 0.1 ? value.toFixed(3) : value.toFixed(2);
}

function _fmtBetaAcceptance(window) {
  if (!window) return null;
  const design = window.tracksBeam ? 'ramped cells' : `design ${_fmtBeta(window.design)}`;
  return `${_fmtBeta(window.min)}–${_fmtBeta(window.max)} (${design})`;
}

function _missionMetricValue(type, result) {
  if (!result) return 'No beam data';
  const powerKw = (result.beamEnergy || 0) * (result.beamCurrent || 0) * 1000
    * (type.dutyFactor ?? 1);
  if (type.fom === 'beamPowerKw') return `${powerKw.toFixed(powerKw >= 100 ? 0 : 1)} kW`;
  if (type.fom === 'beamPowerMw') return `${(powerKw / 1000).toFixed(2)} MW`;
  if (type.fom === 'doseAvailability') return `${Math.round((result.beamQuality || 0) * 100)}% quality`;
  if (type.fom === 'photonFlux') return Number(result.photonRate || 0).toExponential(2);
  if (type.fom === 'felBrilliance') return result.felSaturated ? 'Saturated' : 'Below saturation';
  if (type.fom === 'euvPhotonPowerW') return `${Number(result.felPower || 0).toPrecision(3)} W`;
  if (type.fom === 'integratedLuminosity') return Number(result.luminosity || 0).toExponential(2);
  if (type.fom === 'blackHoleYield') return Number(result.blackHoleYield || 0).toPrecision(3);
  return `${Math.round((result.beamQuality || 0) * 100)}% quality`;
}

BeamlineDesigner.prototype._renderPlotMissionSummary = function() {
  const summary = document.getElementById('dsgn-plot-mission-summary');
  if (!summary) return;

  const type = getBeamlineType(this._designerBeamlineTypeId?.());
  const referenceSelect = document.getElementById('dsgn-plot-reference-select');
  if (referenceSelect) {
    referenceSelect.disabled = !type;
    referenceSelect.value = type && this.plotReference !== 'none' ? 'mission' : 'none';
    referenceSelect.title = type
      ? 'Show or hide mission target lines on compatible plots'
      : 'Free Build has no mission targets';
  }
  if (!type) {
    summary.innerHTML = '<span class="dsgn-plot-mission-empty">Free Build · no mission targets</span>';
    summary.setAttribute('aria-label', 'Free Build; no mission targets');
    return;
  }

  const draft = this.draftPhysicsResult;
  const energy = Number(draft?.beamEnergy || 0);
  const current = Number(draft?.beamCurrent || 0);
  const quality = Math.round((draft?.beamQuality || 0) * 100);
  const energyTarget = _fmtBand(type.spec?.energyGeV, _fmtEnergyValue);
  const currentTarget = _fmtBand(type.spec?.currentMA, value => `${value} mA`);
  const fomLabel = _missionFomLabels[type.fom] || 'Mission metric';
  const fomValue = _missionMetricValue(type, draft);
  const currentValue = `${current < 0.01 ? current.toPrecision(2) : current.toFixed(current < 10 ? 2 : 1)} mA`;
  const metric = (label, value, target, state = '') =>
    `<span class="dsgn-plot-mission-metric ${state}" title="${label} target: ${target}">`
      + `<span>${label}</span><strong>${value}</strong></span>`;

  summary.innerHTML = `<span class="dsgn-plot-mission-name" title="T${type.tier} · ${type.name}">`
    + `T${type.tier} · ${type.name}</span>`
    + metric('Energy', _fmtEnergyValue(energy), energyTarget,
      _inBand(energy, type.spec?.energyGeV) ? 'in' : 'out')
    + metric('Current', currentValue, currentTarget,
      _inBand(current, type.spec?.currentMA) ? 'in' : 'out')
    + metric(fomLabel, fomValue,
      type.fomRef != null ? `reference ${type.fomRef}` : 'type objective')
    + metric('Quality', `${quality}%`, 'higher is better', quality >= 70 ? 'in' : 'out');
  summary.setAttribute('aria-label', `T${type.tier} ${type.name}; Energy ${_fmtEnergyValue(energy)}, target ${energyTarget}; `
    + `Current ${currentValue}, target ${currentTarget}; ${fomLabel} ${fomValue}; Beam quality ${quality}%`);
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
    return _driftPixelWidth(n.type, n.subL || (COMPONENTS[n.type] || {}).subL);
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
    return _driftPixelWidth(n.type, n.subL || (COMPONENTS[n.type] || {}).subL);
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
    const offscreen = this._drawComponentOffscreen(node.type, node.params, node.subL);
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

  // --- Physics-aware insertion hints ---
  // Bare terminal text is intentionally drawn into the schematic rather than
  // placed in a panel: the proposal belongs to one physical s-position. Small
  // glyphs remain visible along the line; the closest one to the pointer (or
  // blue marker when there is no pointer) expands into the one-click recipe.
  if (this.placementHints && this.placementHints.length > 0 && this.totalLength > 0) {
    const compTop = beamY - schematicH / 2;
    const compBot = beamY + schematicH / 2;
    let offLeft = 0;
    let offRight = 0;
    const pointerX = Number.isFinite(this._hoverSchematicX)
      ? this._hoverSchematicX
      : 20 + panOffsetPx + this._sToPixelOffset(this.markerS, effectiveZoom);
    const visible = [];

    for (const hint of this.placementHints) {
      const hintX = 20 + panOffsetPx + this._sToPixelOffset(hint.s, effectiveZoom);
      if (hintX < 0) { offLeft++; continue; }
      if (hintX > W) { offRight++; continue; }
      visible.push({ hint, x: hintX, color: _placementHintColor(hint) });
    }

    let active = null;
    for (const item of visible) {
      const distance = Math.abs(item.x - pointerX);
      if (!active || distance < active.distance ||
          (distance === active.distance && item.hint.priority > active.hint.priority)) {
        active = { ...item, distance };
      }
    }
    // Hints stay quiet until the cursor/marker comes into their neighbourhood.
    if (active && active.distance > Math.max(110, W * 0.18)) active = null;

    for (const item of visible) {
      const { hint, x: hintX, color } = item;
      const isActive = active?.hint.id === hint.id;

      ctx.strokeStyle = _withAlpha(color, isActive ? 0.55 : 0.2);
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hintX, compTop - 2);
      ctx.lineTo(hintX, compBot + 2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = _withAlpha(color, isActive ? 1 : 0.72);
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('✦', hintX, compTop - 5);

      this._ghostRegions.push({
        x: hintX - 9, y: compTop - 18, w: 18, h: compBot - compTop + 27,
        hint,
      });
    }

    if (active) {
      const { hint, x: hintX, color } = active;
      const line1 = `✦ ${hint.label}  [+ INSERT]`;
      const line2 = hint.reason || '';
      const line3 = `${hint.state || ''}${hint.state && hint.target ? '  →  ' : ''}${hint.target || ''}`;
      ctx.save();
      ctx.font = 'bold 9px monospace';
      const textW = Math.max(
        ctx.measureText(line1).width,
        ctx.measureText(line2).width,
        ctx.measureText(line3).width,
      );
      const textX = Math.max(8, Math.min(W - textW - 8, hintX + 9));
      const textY = Math.max(10, compTop - 35);

      ctx.strokeStyle = _withAlpha(color, 0.5);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hintX, compTop - 4);
      ctx.lineTo(hintX, textY + 2);
      ctx.lineTo(textX - 3, textY + 2);
      ctx.stroke();

      // No box: a tiny shadow is enough to hold terminal text over the lab.
      ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
      ctx.shadowBlur = 2;
      ctx.textAlign = 'left';
      ctx.fillStyle = _withAlpha(color, 1);
      ctx.fillText(line1, textX, textY);
      ctx.font = '8px monospace';
      ctx.fillStyle = 'rgba(225, 232, 238, 0.9)';
      ctx.fillText(line2, textX, textY + 11);
      ctx.fillStyle = 'rgba(160, 190, 205, 0.85)';
      ctx.fillText(line3, textX, textY + 21);
      ctx.restore();

      this._ghostRegions.push({
        x: textX - 4, y: textY - 10, w: textW + 8, h: 35,
        hint,
      });
    }

    if (offLeft > 0) _drawOffscreenGhostChevron(ctx, 10, beamY, -1, offLeft);
    if (offRight > 0) _drawOffscreenGhostChevron(ctx, W - 10, beamY, 1, offRight);
  }

  // Draw marker line at markerS position (in physical meters).
  // _sToPixelOffset is the exact inverse of the click mapping in
  // _placeMarkerAtClickX, so the marker lands under the cursor that set it.
  if (this.markerS >= 0 && this.totalLength > 0) {
    const markerXPos = 20 + panOffsetPx + this._sToPixelOffset(this.markerS, effectiveZoom);

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

    // Distance-from-source label next to marker
    const distLabel = this.markerS < 1000
      ? `${this.markerS.toFixed(1)} m`
      : `${(this.markerS / 1000).toFixed(2)} km`;
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    // Background pill for readability
    const labelW = ctx.measureText(distLabel).width + 6;
    const labelX = markerXPos + 6;
    const labelY = 3;
    ctx.fillStyle = 'rgba(10, 12, 20, 0.7)';
    ctx.fillRect(labelX, labelY, labelW, 14);
    ctx.fillStyle = 'rgba(68, 136, 255, 0.85)';
    ctx.fillText(distLabel, labelX + 3, labelY + 11);
  }

  ctx.restore();
};

function _placementHintColor(hint) {
  if (hint.kind === 'longitudinal') return '#cc88ff';
  if (hint.kind === 'energy') return '#55dd99';
  if (hint.componentType === 'solenoid') return '#55ccee';
  if (hint.params?.polarity === 1) return '#e65050';
  if (hint.params?.polarity === 0) return '#508ce6';
  return '#ffaa22';
}

function _withAlpha(hex, alpha) {
  const value = hex.startsWith('#') ? hex.slice(1) : hex;
  const n = parseInt(value, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Edge marker for advisor suggestions that lie outside the visible span:
 *  a chevron pointing the way to scroll, with how many are that way. */
function _drawOffscreenGhostChevron(ctx, x, y, dir, count) {
  const h = 7;
  const w = 6;
  ctx.save();
  ctx.fillStyle = 'rgba(255, 170, 34, 0.85)';
  ctx.beginPath();
  ctx.moveTo(x + dir * w, y - h);
  ctx.lineTo(x + dir * w, y + h);
  ctx.lineTo(x - dir * w, y);
  ctx.closePath();
  ctx.fill();
  ctx.font = 'bold 9px monospace';
  ctx.textAlign = dir < 0 ? 'left' : 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(count), x + dir * (w + 4), y);
  ctx.restore();
}

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

BeamlineDesigner.prototype._drawComponentOffscreen = function(componentType, params, subL) {
  if (!this._schematicCache) this._schematicCache = {};
  const polarity = params?.polarity;
  const pw = _driftPixelWidth(componentType, subL);
  const cacheKey = polarity != null ? `${componentType}_p${polarity}_${pw}` : `${componentType}_${pw}`;
  if (this._schematicCache[cacheKey]) return this._schematicCache[cacheKey];

  const tiny = document.createElement('canvas');
  tiny.width = pw;
  tiny.height = SCHEM_PH;
  tiny.style.width = pw + 'px';
  tiny.style.height = SCHEM_PH + 'px';
  this.renderer.drawSchematic(tiny, componentType, params, { pixelWidth: pw });

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

  // RF-specific component properties
  // Only a sink is cut for a frequency. Wideband sources carry the legacy
  // string 'broadband' here, which would render as "broadband MHz" — their
  // coverage is the band row below.
  if (typeof comp.rfFrequency === 'number') {
    statsHtml += `<div class="ts-row"><span class="ts-label">RF Frequency</span><span class="ts-val">${comp.rfFrequency} <span class="ts-unit">MHz</span></span></div>`;
  }
  // A source covers several bands; a cavity sits in exactly one. Prefer the
  // array so a klystron does not advertise half its reach.
  const rfBands = comp.rfBands || (comp.rfBand ? [comp.rfBand] : null);
  if (rfBands) {
    const label = rfBands.map(b => b.toUpperCase()).join(', ');
    statsHtml += `<div class="ts-row"><span class="ts-label">RF Band</span><span class="ts-val">${label}</span></div>`;
  }
  if (comp.betaAcceptance) {
    statsHtml += `<div class="ts-row"><span class="ts-label">β Acceptance</span><span class="ts-val">${_fmtBetaAcceptance(comp.betaAcceptance)}</span></div>`;
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

  // --- Live beam state at this component from envelope ---
  const envSnap = this._getEnvelopeAtSelected();
  if (envSnap) {
    statsHtml += `<div class="ts-section-label">Beam at this point</div>`;
    const eAt = formatEnergy(envSnap.energy);
    statsHtml += `<div class="ts-row"><span class="ts-label">Energy</span><span class="ts-val">${eAt.val} <span class="ts-unit">${eAt.unit}</span></span></div>`;
    statsHtml += `<div class="ts-row"><span class="ts-label">Current</span><span class="ts-val">${envSnap.current.toFixed(3)} <span class="ts-unit">mA</span></span></div>`;
    if (Number.isFinite(envSnap.rel_beta)) {
      statsHtml += `<div class="ts-row"><span class="ts-label">Beam β</span><span class="ts-val">${envSnap.rel_beta.toFixed(4)}</span></div>`;
    }
    if (envSnap.beta_accepted != null) {
      const matchColor = envSnap.beta_accepted ? '#4d4' : '#f55';
      const matchText = envSnap.beta_accepted ? 'MATCHED' : 'OUTSIDE WINDOW';
      const ttf = Number.isFinite(envSnap.beta_ttf)
        ? ` · TTF ${envSnap.beta_ttf.toFixed(3)}` : '';
      statsHtml += `<div class="ts-row"><span class="ts-label">Velocity match</span><span class="ts-val" style="color:${matchColor}">${matchText}${ttf}</span></div>`;
    }

    const sx = envSnap.sigma_x * 1e3;
    const sy = envSnap.sigma_y * 1e3;
    statsHtml += `<div class="ts-row"><span class="ts-label">Beam size X</span><span class="ts-val">${sx.toFixed(2)} <span class="ts-unit">mm</span></span></div>`;
    statsHtml += `<div class="ts-row"><span class="ts-label">Beam size Y</span><span class="ts-val">${sy.toFixed(2)} <span class="ts-unit">mm</span></span></div>`;

    if (envSnap.energy_spread > 0) {
      const espPct = (envSnap.energy_spread * 100).toFixed(3);
      statsHtml += `<div class="ts-row"><span class="ts-label">Energy spread</span><span class="ts-val">${espPct} <span class="ts-unit">%</span></span></div>`;
    }

    if (envSnap.emit_nx > 0) {
      const enx = (envSnap.emit_nx * 1e6).toFixed(3);
      statsHtml += `<div class="ts-row"><span class="ts-label">Norm emit X</span><span class="ts-val">${enx} <span class="ts-unit">mm·mrad</span></span></div>`;
    }

    if (envSnap.eta_x != null && Math.abs(envSnap.eta_x) > 0.001) {
      const etaColor = Math.abs(envSnap.eta_x) > 0.1 ? '#da4' : '#8a8';
      statsHtml += `<div class="ts-row"><span class="ts-label">Dispersion X</span><span class="ts-val" style="color:${etaColor}">${envSnap.eta_x.toFixed(3)} <span class="ts-unit">m</span></span></div>`;
    }

    if (envSnap.peak_current > 0) {
      const pkA = envSnap.peak_current;
      const pkStr = pkA >= 1 ? pkA.toFixed(1) + ' A' : (pkA * 1e3).toFixed(1) + ' mA';
      statsHtml += `<div class="ts-row"><span class="ts-label">Peak current</span><span class="ts-val">${pkStr}</span></div>`;
    }

    if (!envSnap.alive) {
      statsHtml += `<div class="ts-row"><span class="ts-label">Status</span><span class="ts-val" style="color:#f44">BEAM LOST</span></div>`;
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
      const autoManaged = this.autoTuneEnabled && isDesignerAutoManagedParam(node.type, key);
      const disabled = autoManaged ? ' disabled' : '';
      const managedTitle = autoManaged ? ' title="Managed by automatic matching"' : '';

      // Binary params with labels → toggle buttons instead of slider
      if (def.labels && def.min === 0 && def.max === 1 && def.step === 1) {
        html += `<div class="param-toggle-row">`;
        html += `<span class="param-label">${_paramLabel(key)}</span>`;
        html += `<div class="param-toggle-group" data-toggle-param="${key}">`;
        for (const [lv, ll] of Object.entries(def.labels)) {
          const active = Math.round(val) === Number(lv) ? ' active' : '';
          html += `<button class="param-toggle-btn${active}" data-toggle-val="${lv}"${disabled}${managedTitle}>${ll}</button>`;
        }
        html += `</div>`;
        html += `</div>`;
        continue;
      }

      html += `<div class="param-slider-row">`;
      html += `<span class="param-label">${_paramLabel(key)}</span>`;
      html += `<input type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${val}" data-param="${key}"${disabled}${managedTitle}>`;
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

/** Get the envelope snapshot closest to the currently selected component. */
BeamlineDesigner.prototype._getEnvelopeAtSelected = function() {
  if (!this.draftEnvelope || this.draftEnvelope.length === 0) return null;
  if (this.selectedIndex < 0) return null;

  const node = this.draftNodes[this.selectedIndex];
  if (!node) return null;

  // Use the marker position if it falls within this component's span
  const markerIdx = this.getMarkerEnvelopeIndex();
  if (markerIdx >= 0) return this.draftEnvelope[markerIdx];

  // Fall back: find envelope point matching this component's element index
  const target = this.selectedIndex;
  for (let i = this.draftEnvelope.length - 1; i >= 0; i--) {
    if (this.draftEnvelope[i].index === target) return this.draftEnvelope[i];
  }
  return null;
};

// ---- Plot rendering ----

// Plot downscale factor — render at 1/PLOT_SCALE of display size for chunky pixel look
const PLOT_SCALE = 1.2;
const PRIMARY_RIGHT_AXIS_INSET = 30;
const SECONDARY_RIGHT_AXIS_INSET = 36;

// An envelope the plot renderers can actually draw (they need two samples to
// have a curve at all).
function _plottable(env) {
  return env && env.length >= 2 ? env : null;
}

/**
 * The empty-panel state, which used to be a flat "No beam data" for three very
 * different situations: a draft with nothing in it, a physics engine that
 * raised, and a beamline the engine genuinely found no beam on. The first two
 * are faults and the third is a result, and reading them as one another sent a
 * real debugging session chasing the beamline instead of the exception.
 */
function _drawNoDataPlaceholder(ctx, w, h, designer) {
  ctx.fillStyle = 'rgba(5, 5, 20, 0.6)';
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';

  const err = BeamPhysics.getLastError ? BeamPhysics.getLastError() : null;
  const empty = !designer.draftNodes || designer.draftNodes.length === 0;
  const pending = designer.physicsPending === true;

  let head = 'No beam data';
  let detail = null;
  if (empty) {
    head = 'No components yet';
  } else if (pending) {
    head = 'Calculating beam…';
  } else if (err) {
    head = 'Physics engine error';
    detail = err;
  }

  ctx.fillStyle = err ? 'rgba(220, 110, 110, 0.85)' : 'rgba(100, 100, 150, 0.5)';
  ctx.font = '10px monospace';
  ctx.fillText(head, w / 2, detail ? h / 2 - 16 : h / 2);

  if (!detail) return;
  // Wrap the exception text at whatever the panel can hold; the tail of a
  // traceback is the useful part, so keep the last lines if it overflows.
  ctx.font = '8px monospace';
  ctx.fillStyle = 'rgba(190, 160, 160, 0.8)';
  const perLine = Math.max(8, Math.floor(w / 5) - 2);
  const lines = [];
  for (let i = 0; i < detail.length && lines.length < 8; i += perLine) {
    lines.push(detail.slice(i, i + perLine));
  }
  lines.forEach((ln, i) => ctx.fillText(ln, w / 2, h / 2 - 2 + i * 10));
}

BeamlineDesigner.prototype._renderPlots = function() {
  this._renderPlotMissionSummary();
  this.syncPlotPinControl();
  // The shared X window still follows the range bar. Primary Y domains are
  // resolved independently per panel below; overlay channels remain automatic.
  const xRange = this._getPlotXRange();
  const yScale = null;
  const targets = this.plotReference === 'none'
    ? null
    : (this._missionPlotTargets?.() || null);

  // Which beamline(s) the panels show. `solid` is drawn in full colour with all
  // the chrome; `ghost` is the dimmed comparison drawn underneath it.
  const draft = _plottable(this.draftEnvelope);
  const base = _plottable(this.baselineEnvelope);
  const source = base ? (this.plotSource || 'proposed') : 'proposed';
  let solid = draft;
  let ghost = null;
  if (source === 'current') {
    solid = base;
  } else if (source === 'both') {
    solid = draft;
    ghost = base;
  }
  // A Both/Proposed view of an emptied draft still has something worth showing:
  // fall back to the as-built line rather than blanking the panel out from under
  // the player the moment they delete the last component.
  if (!solid && ghost) { solid = ghost; ghost = null; }

  // One pin at the marker, shared by both passes so the at-a-point plots (phase
  // space, longitudinal, E/I/eps) compare the same location on both beamlines.
  // The marker indexes the draft; a baseline shorter than that simply has no
  // datum there and its ghost pass draws nothing.
  const markerIdx = this.getMarkerEnvelopeIndex();
  const pins = markerIdx >= 0
    ? [{ elementIndex: markerIdx, s: this.markerS, color: '#4488ff' }]
    : [];

  const panels = document.querySelectorAll('.dsgn-plot-panel');
  panels.forEach((panel) => {
    const select = panel.querySelector('.dsgn-plot-select');
    const scaleSelect = panel.querySelector('.dsgn-plot-scale-select');
    const overlaySelects = [...panel.querySelectorAll(
      '.dsgn-plot-secondary-select, .dsgn-plot-tertiary-select'
    )];
    const canvas = panel.querySelector('.dsgn-plot-canvas');
    if (!select || !canvas) return;
    const panelIndex = Number.parseInt(canvas.dataset.panel, 10);
    const yAxisMode = this.plotYAxisModes?.[panelIndex] === 'log' ? 'log' : 'linear';
    if (scaleSelect) scaleSelect.value = yAxisMode;

    // The selectors live in a dedicated panel header. Size from the canvas
    // itself so the renderer never relies on a guessed control-row height or
    // paints underneath the controls.
    const rect = canvas.getBoundingClientRect();
    const plotW = Math.floor(rect.width / PLOT_SCALE);
    const plotH = Math.floor(rect.height / PLOT_SCALE);
    if (plotW < 10 || plotH < 10) return;

    const plotType = select.value;
    const panelId = canvas.dataset.panel || '0';
    const distancePlot = ProbePlots.isDistancePlot(plotType);
    panel.classList.toggle('dsgn-plot-panel--geometric', !distancePlot);
    panel.classList.toggle('dsgn-plot-panel--radar', plotType === 'eic-triangle');

    // Sanitize the two optional channels in order, then disable duplicates in
    // each selector. Every active channel gets its own scale but shares the
    // primary plot's physical distance pixels.
    const usedTypes = new Set([plotType]);
    for (const overlaySelect of overlaySelects) {
      overlaySelect.disabled = !distancePlot;
      overlaySelect.title = distancePlot
        ? 'Overlay another quantity with an independent right-side y-axis'
        : 'Geometric plots are single-vector displays';
      if (!distancePlot || (overlaySelect.value !== 'none' && usedTypes.has(overlaySelect.value))) {
        overlaySelect.value = 'none';
      }
      if (overlaySelect.value !== 'none') usedTypes.add(overlaySelect.value);
    }
    for (const overlaySelect of overlaySelects) {
      const otherTypes = new Set([plotType]);
      for (const other of overlaySelects) {
        if (other !== overlaySelect && other.value !== 'none') otherTypes.add(other.value);
      }
      for (const option of overlaySelect.options) {
        option.disabled = option.value !== 'none' && otherTypes.has(option.value);
      }
    }
    const overlays = distancePlot
      ? overlaySelects
        .map((overlaySelect, index) => ({
          type: overlaySelect.value,
          seriesIndex: overlaySelect.classList.contains('dsgn-plot-tertiary-select') ? 3 : 2,
          axisSlot: index,
        }))
        .filter(overlay => overlay.type !== overlaySelects[0]?.options[0]?.value)
        .map((overlay, axisSlot) => ({ ...overlay, axisSlot }))
      : [];
    const hover = this._plotHoverPositions?.get(panelId) || null;
    const pin = this.plotPin?.panel === panelId ? this.plotPin : null;
    const cursor = hover || pin;
    const primaryRightInset = ['energy-dispersion', 'bunch-evolution'].includes(plotType)
      ? PRIMARY_RIGHT_AXIS_INSET
      : 0;
    const rightInset = primaryRightInset
      + overlays.length * SECONDARY_RIGHT_AXIS_INSET;

    // Render to a small offscreen canvas
    const off = document.createElement('canvas');
    off.width = plotW;
    off.height = plotH;

    let autoYDomain = null;
    if (!solid) {
      _drawNoDataPlaceholder(off.getContext('2d'), plotW, plotH, this);
    } else {
      // Both passes get the union of the two autoscales. Without it each pass
      // would autoscale to its own envelope and the two curves would be drawn
      // to different y-axes on the same pixels — a comparison that reads as a
      // difference in beam size when it is only a difference in scale.
      autoYDomain = ProbePlots.unionYDomain(
        ProbePlots.yDomainFor(plotType, solid, yScale, pins, 0),
        ghost ? ProbePlots.yDomainFor(plotType, ghost, yScale, pins, 0) : null,
      );
      const panelYRange = this.plotYRanges?.[Number(panelId)];
      const fixedYDomain = distancePlot
        && panelYRange?.mode === 'fixed'
        && validateDesignerFixedYRange(panelYRange, yAxisMode).valid;
      const yDomain = distancePlot
        ? applyDesignerPlotYRange(
          autoYDomain,
          panelYRange,
          yAxisMode,
        )
        : autoYDomain;
      const targetDomain = ProbePlots.targetYDomain(plotType, targets);
      const targetBand = targetDomain?.[0] || null;
      for (const overlay of overlays) {
        const domainChannels = ProbePlots.unionYDomain(
          ProbePlots.secondaryYDomain(overlay.type, solid, yScale),
          ghost ? ProbePlots.secondaryYDomain(overlay.type, ghost, yScale) : null,
        );
        overlay.domain = domainChannels?.[0] || null;
      }
      // Ghost first: it draws marks only, so the solid pass on top supplies the
      // axes, bands, pin lines and legend. Reversed, the chrome would paint over
      // the proposal and the as-built line would read as the real one.
      if (ghost) {
        ProbePlots.draw(off, plotType, ghost, pins, 0, xRange, yScale,
          { yDomain, targetBand, ghost: true, targets, yAxisMode, fixedYDomain, rightInset });
        for (const overlay of overlays) {
          if (!overlay.domain) continue;
          ProbePlots.drawSecondary(off, overlay.type, ghost, xRange, yScale, {
            yDomain: overlay.domain,
            ghost: true,
            yAxisMode,
            rightInset,
            axisOffset: primaryRightInset + overlay.axisSlot * SECONDARY_RIGHT_AXIS_INSET,
            seriesIndex: overlay.seriesIndex,
          });
        }
      }
      ProbePlots.draw(off, plotType, solid, pins, 0, xRange, yScale,
        { yDomain, targetBand, noClear: !!ghost, targets, yAxisMode, fixedYDomain, rightInset });
      for (const overlay of overlays) {
        if (!overlay.domain) continue;
        ProbePlots.drawSecondary(off, overlay.type, solid, xRange, yScale, {
          yDomain: overlay.domain,
          yAxisMode,
          rightInset,
          axisOffset: primaryRightInset + overlay.axisSlot * SECONDARY_RIGHT_AXIS_INSET,
          seriesIndex: overlay.seriesIndex,
        });
      }
      if (cursor && distancePlot) {
        const readout = ProbePlots.drawCursor(off, plotType, solid, xRange, {
          cursorX: cursor.x * plotW,
          cursorY: cursor.y * plotH,
          cursorS: !hover && Number.isFinite(pin?.s) ? pin.s : undefined,
          pinned: !hover && !!pin,
          yDomain,
          overlays: overlays.map(overlay => ({
            type: overlay.type,
            domain: overlay.domain,
            seriesIndex: overlay.seriesIndex,
          })),
          ghostEnvelope: ghost,
          solidLabel: source === 'current' ? 'C' : 'P',
          ghostLabel: 'C',
          yAxisMode,
          fixedYDomain,
          rightInset,
        });
        if (!hover && pin && readout) pin.s = readout.s;
        if (!hover && pin && !readout && !Number.isFinite(pin.s)) this.plotPin = null;
      }
    }

    this._lastAutoPlotYDomains.set(panelId, autoYDomain);
    this.syncPlotYRangeControl(panelId, plotType, autoYDomain, distancePlot);

    // Scale up to display canvas with nearest-neighbor (crispy pixels)
    canvas.width = Math.floor(rect.width);
    canvas.height = Math.floor(rect.height);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(off, 0, 0, plotW, plotH, 0, 0, canvas.width, canvas.height);
  });
  this.syncPlotPinControl();
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

/**
 * The type whose palette this designer session is building against.
 *
 * openFromSource leaves this.beamlineId null (the draft is pipe-graph-backed),
 * so an edit session has to resolve through the source placeable — asking
 * getActiveBeamlineTypeId alone would report whatever beamline happened to be
 * selected instead. Null means no type, and nothing is filtered.
 */
BeamlineDesigner.prototype._designerBeamlineTypeId = function() {
  if (this.editSourceId) {
    return this.game.registry?.getBySourceId(this.editSourceId)?.typeId || null;
  }
  return this.game.getActiveBeamlineTypeId?.() || null;
};

/**
 * The components a category's palette would actually show. Both the tab strip
 * and the palette body go through here: if they each ran their own copy of the
 * filter set, a tab could survive while its palette came up empty — the dead
 * click this is here to prevent.
 */
BeamlineDesigner.prototype._visibleDesignerComps = function(category) {
  // Same beamline-type filter the main HUD palette applies, so the designer
  // can't offer a component the line's type excludes — placing one from here
  // used to sneak past the gate the New Beamline picker set up.
  const typeId = this._designerBeamlineTypeId();

  const out = [];
  for (const [key, comp] of Object.entries(COMPONENTS)) {
    if (comp.category !== category) continue;
    if (!this.game.isComponentUnlocked(comp)) continue;
    if (isFacilityCategory(comp.category)) continue;
    if (beamlineTypeHidesComponent(typeId, key, comp)) continue;
    out.push({ key, comp });
  }
  return out;
};

BeamlineDesigner.prototype._renderDesignerPalette = function(category) {
  const palette = document.getElementById('component-palette');
  if (!palette) return;
  this._hideDesignerPaletteHover();
  palette.innerHTML = '';

  // Only show beamline components
  const mode = MODES.beamline;
  const catDef = mode?.categories?.[category];
  if (!catDef) return;

  const catComps = this._visibleDesignerComps(category);

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

/**
 * Return the complete static catalogue facts used by the designer palette's
 * floating hover inspector. Keeping this separate from DOM construction makes
 * it difficult for the compact card and the detailed panel to drift apart.
 */
export function designerPaletteDetails(key, comp) {
  const rows = [];
  const costs = Object.entries(comp.cost || {}).map(([resource, amount]) =>
    resource === 'funding' ? `$${amount.toLocaleString()}` : `${amount} ${resource}`
  ).join(', ') || '--';
  rows.push({ label: 'Cost', value: costs });
  rows.push({ label: 'Power', value: `${comp.energyCost || 0} kW` });
  rows.push({ label: 'Length', value: `${((comp.subL || 4) * 0.5).toFixed(1)} m` });

  if (Number.isFinite(comp.apertureRadius)) {
    rows.push({ label: 'Aperture radius', value: `${comp.apertureRadius} mm` });
  }

  for (const [statKey, value] of Object.entries(comp.stats || {})) {
    if (statKey === 'energyGain') {
      const energy = formatEnergy(value);
      rows.push({ label: _paramLabel(statKey), value: `${energy.val} ${energy.unit}` });
    } else {
      const unit = UNITS?.[statKey] || '';
      rows.push({ label: _paramLabel(statKey), value: `${value}${unit ? ` ${unit}` : ''}` });
    }
  }

  if (typeof comp.rfFrequency === 'number') {
    rows.push({ label: 'RF frequency', value: `${comp.rfFrequency} MHz` });
  }
  const rfBands = comp.rfBands || (comp.rfBand ? [comp.rfBand] : null);
  if (rfBands) rows.push({ label: 'RF band', value: rfBands.map(b => b.toUpperCase()).join(', ') });
  if (comp.betaAcceptance) {
    rows.push({ label: 'β acceptance', value: _fmtBetaAcceptance(comp.betaAcceptance) });
  }

  const utilityRows = paletteUtilityMetrics(comp);
  const requiredPorts = requiredUtilityPorts(comp);
  const connections = requiredPorts
    .map(port => `${port.label}${port.count > 1 ? ` ×${port.count}` : ''}`);

  const params = [];
  const defs = PARAM_DEFS[key] || {};
  for (const [paramKey, value] of Object.entries(comp.params || {})) {
    const unit = defs[paramKey]?.unit || '';
    params.push({
      label: _paramLabel(paramKey),
      value: `${value}${unit ? ` ${unit}` : ''}`,
    });
  }

  return {
    name: comp.name || key,
    description: comp.desc || '',
    rows,
    utilityRows,
    connections,
    requiredPorts,
    params,
  };
}

BeamlineDesigner.prototype._hideDesignerPaletteHover = function() {
  this._designerPaletteHoverRevision = (this._designerPaletteHoverRevision || 0) + 1;
  if (this._designerPaletteHover?.isConnected) this._designerPaletteHover.remove();
  this._designerPaletteHover = null;
};

BeamlineDesigner.prototype._showDesignerPaletteHover = function(card, key, comp) {
  this._hideDesignerPaletteHover();
  const details = designerPaletteDetails(key, comp);
  const popup = document.createElement('div');
  popup.className = 'dsgn-palette-hover';
  popup.setAttribute('role', 'tooltip');

  const title = document.createElement('div');
  title.className = 'dsgn-palette-hover-title';
  title.textContent = details.name;
  popup.appendChild(title);

  if (details.description) {
    const description = document.createElement('div');
    description.className = 'dsgn-palette-hover-desc';
    description.textContent = details.description;
    popup.appendChild(description);
  }

  // Placement-specific physics goes first: catalogue facts answer what the
  // hardware is, while this section answers whether it belongs at the current
  // blue marker. It is filled asynchronously from the same worker result the
  // Designer plots consume.
  const placementSection = document.createElement('div');
  placementSection.className = 'dsgn-palette-hover-section dsgn-palette-hover-placement';
  const placementHeading = document.createElement('div');
  placementHeading.className = 'dsgn-palette-hover-heading';
  placementHeading.textContent = 'Placement impact';
  const placementStatus = document.createElement('div');
  placementStatus.className = 'dsgn-palette-hover-placement-status';
  placementStatus.textContent = 'Calculating with the beam solver\u2026';
  placementSection.append(placementHeading, placementStatus);
  popup.appendChild(placementSection);

  const addRows = (label, rows) => {
    if (!rows.length) return;
    const section = document.createElement('div');
    section.className = 'dsgn-palette-hover-section';
    if (label) {
      const heading = document.createElement('div');
      heading.className = 'dsgn-palette-hover-heading';
      heading.textContent = label;
      section.appendChild(heading);
    }
    for (const row of rows) {
      const line = document.createElement('div');
      line.className = 'dsgn-palette-hover-row';
      if (row.tone && row.tone !== 'neutral') line.classList.add(`is-${row.tone}`);
      const rowLabel = document.createElement('span');
      rowLabel.textContent = row.label;
      const rowValue = document.createElement('strong');
      rowValue.textContent = row.value;
      line.append(rowLabel, rowValue);
      section.appendChild(line);
    }
    popup.appendChild(section);
  };

  addRows('', details.rows);
  addRows('Utilities', details.utilityRows);
  addRows('Default parameters', details.params);

  appendRequiredPortRequirements(popup, details.requiredPorts);

  document.body.appendChild(popup);
  const positionPopup = () => {
    if (!popup.isConnected || !card.isConnected) return;
    const cardRect = card.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const margin = 10;
    const left = Math.max(margin, Math.min(
      cardRect.left + cardRect.width / 2 - popupRect.width / 2,
      window.innerWidth - popupRect.width - margin,
    ));
    let top = cardRect.top - popupRect.height - margin;
    if (top < margin) top = Math.min(window.innerHeight - popupRect.height - margin, cardRect.bottom + margin);
    popup.style.left = `${left}px`;
    popup.style.top = `${Math.max(margin, top)}px`;
  };
  positionPopup();
  this._designerPaletteHover = popup;
  const previewRevision = this._designerPaletteHoverRevision;
  Promise.resolve(this.previewComponentPlacement(key)).then(preview => {
    if (!popup.isConnected || this._designerPaletteHover !== popup
        || this._designerPaletteHoverRevision !== previewRevision) return;
    placementStatus.remove();
    if (!preview) {
      const unavailable = document.createElement('div');
      unavailable.className = 'dsgn-palette-hover-placement-status';
      unavailable.textContent = 'Placement preview unavailable';
      placementSection.appendChild(unavailable);
      positionPopup();
      return;
    }
    placementHeading.textContent = `Placement impact \u00b7 ${preview.heading}`;
    for (const row of preview.rows || []) {
      const line = document.createElement('div');
      line.className = 'dsgn-palette-hover-row';
      if (row.tone && row.tone !== 'neutral') line.classList.add(`is-${row.tone}`);
      const rowLabel = document.createElement('span');
      rowLabel.textContent = row.label;
      const rowValue = document.createElement('strong');
      rowValue.textContent = row.value;
      line.append(rowLabel, rowValue);
      placementSection.appendChild(line);
    }
    positionPopup();
  }).catch(() => {
    if (!popup.isConnected || this._designerPaletteHover !== popup) return;
    placementStatus.textContent = 'Placement preview unavailable';
  });
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
  canvas.height = 40;
  canvas.style.width = '180px';
  canvas.style.height = '40px';
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

  // Click handler — same single palette path as the main HUD; with the
  // designer open, selectComponentTool routes into handlePaletteClick.
  card.addEventListener('click', () => {
    this._hideDesignerPaletteHover();
    this.renderer._inputHandler?.selectPaletteTool('component', key);
  });
  card.addEventListener('mouseenter', () => this._showDesignerPaletteHover(card, key, comp));
  card.addEventListener('mouseleave', () => this._hideDesignerPaletteHover());
  card.addEventListener('focusin', () => this._showDesignerPaletteHover(card, key, comp));
  card.addEventListener('focusout', () => this._hideDesignerPaletteHover());

  return card;
};

BeamlineDesigner.prototype._setupDesignerTabs = function() {
  const tabsContainer = document.getElementById('category-tabs');
  if (!tabsContainer) return;
  tabsContainer.innerHTML = '';

  const mode = MODES.beamline;
  // A tab whose every component is filtered out — by research or by the
  // beamline type — would open onto an empty palette, which reads as a dead
  // click. Drop the tab instead of shipping the dead end.
  const catKeys = Object.keys(mode.categories)
    .filter(key => this._visibleDesignerComps(key).length > 0);

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
