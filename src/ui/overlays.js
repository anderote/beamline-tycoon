// === OVERLAYS EXTENSION ===
// Adds component popup, tech tree, and goals overlay rendering to UIHost.prototype.

import { _pxText } from '../renderer/Renderer.js';
import { UIHost } from './UIHost.js';
import { COMPONENTS } from '../data/components.js';
import { RESEARCH, RESEARCH_CATEGORIES, RESEARCH_LAB_MAP } from '../data/research.js';
import { OBJECTIVES } from '../data/objectives.js';
import { TUTORIAL_STEPS, TUTORIAL_GROUPS } from '../data/tutorial.js';
import { BeamlineWindow } from './BeamlineWindow.js';
import { EquipmentWindow } from './EquipmentWindow.js';
import { pushEscHandler } from './esc-stack.js';
import { ZONES } from '../data/facility.js';
import { formatEnergy } from '../data/units.js';
import { DIR_NAMES } from '../data/directions.js';
import { PARAM_DEFS, computeStats } from '../beamline/component-physics.js';
import { tileCenterIso } from '../renderer/grid.js';
import { makeDraggable } from './draggable.js';
import { utilityStatRows } from './utility-supply.js';

// --- Component popup ---

UIHost.prototype.showPopup = function(node, screenX, screenY) {
  const popup = document.getElementById('component-popup');
  if (!popup) return;

  const comp = COMPONENTS[node.type];
  if (!comp) return;

  const title = popup.querySelector('.popup-title');
  if (title) title.textContent = comp.name;

  const body = popup.querySelector('.popup-body');
  if (body) {
    const health = this.game.getComponentHealth(node.id);
    const healthColor = health > 60 ? '#44dd66' : health > 25 ? '#ddaa22' : '#ff4444';
    const healthClass = health < 40 ? ' low' : '';

    const row = (label, val, unit) =>
      `<div class="stat-row"><span class="stat-label">${label}</span><span class="stat-value">${val}</span>${unit ? `<span class="stat-unit">${unit}</span>` : ''}</div>`;

    let html = '';

    // Description
    if (comp.desc) {
      html += `<div class="popup-desc">${comp.desc}</div>`;
    }

    // Schematic cross-section
    if (this._schematicDrawers[node.type]) {
      html += `<canvas class="schematic-canvas" id="popup-schematic" width="280" height="100"></canvas>`;
    }

    // Fixed stats
    html += '<div class="popup-stats">';
    html += '<div class="popup-section-label">Info</div>';
    html += row('Direction', DIR_NAMES[node.dir] || '--', '');
    for (const r of utilityStatRows(comp)) html += row(r.label, r.value, '');
    html += row('Length', ((comp.subL || 4) * 0.5).toFixed(1), 'm');
    html += '</div>';

    // Parameter dropdowns (if component has paramOptions)
    if (comp.paramOptions) {
      if (!node.params) node.params = {};
      html += '<div class="popup-sliders">';
      html += '<div class="popup-section-label">Configuration</div>';
      for (const [key, options] of Object.entries(comp.paramOptions)) {
        const current = node.params[key] ?? comp.params?.[key] ?? options[0];
        html += `<div class="param-slider-row">`;
        html += `<span class="param-label">${this._paramLabel(key)}</span>`;
        html += `<select data-param-option="${key}" class="param-select">`;
        for (const opt of options) {
          const sel = opt === current ? ' selected' : '';
          html += `<option value="${opt}"${sel}>${opt.charAt(0).toUpperCase() + opt.slice(1)}</option>`;
        }
        html += `</select>`;
        html += `</div>`;
      }
      html += '</div>';
    }

    // Parameter sliders (if this component type has paramDefs)
    const paramDefs = typeof PARAM_DEFS !== 'undefined' ? PARAM_DEFS[node.type] : null;
    if (paramDefs) {
      // Initialize node.params if missing (backwards compat with old saves)
      if (!node.params) {
        node.params = {};
        for (const [k, def] of Object.entries(paramDefs)) {
          if (!def.derived) node.params[k] = def.default;
        }
      }

      html += '<div class="popup-sliders">';
      html += '<div class="popup-section-label">Parameters</div>';

      // Adjustable sliders
      for (const [key, def] of Object.entries(paramDefs)) {
        if (def.derived) continue;
        const val = node.params[key] ?? def.default;
        html += `<div class="param-slider-row">`;
        html += `<span class="param-label">${this._paramLabel(key)}</span>`;
        html += `<input type="range" min="${def.min}" max="${def.max}" step="${def.step}" value="${val}" data-param="${key}">`;
        if (def.labels) {
          html += `<span class="param-value" data-param-display="${key}">${def.labels[Math.round(val)] || val}</span>`;
        } else {
          html += `<span class="param-value" data-param-display="${key}">${this._fmtParam(val)}</span>`;
        }
        html += `<span class="param-unit">${def.unit}</span>`;
        html += `</div>`;
      }

      // Derived readouts
      const derivedKeys = Object.entries(paramDefs).filter(([_, def]) => def.derived);
      if (derivedKeys.length > 0) {
        html += '<div class="popup-section-label" style="margin-top:6px">Output</div>';
        const computed = typeof computeStats !== 'undefined' ? computeStats(node.type, node.params) : null;
        for (const [key, def] of derivedKeys) {
          const val = computed ? computed[key] : (node.params[key] ?? def.default);
          const isEnergy = def.unit === 'GeV' || def.unit === 'GeV/c';
          const suffix = def.unit === 'GeV/c' ? '/c' : '';
          const dispVal = isEnergy ? formatEnergy(val, suffix).val : this._fmtParam(val);
          const dispUnit = isEnergy ? formatEnergy(val, suffix).unit : def.unit;
          html += `<div class="param-derived-row">`;
          html += `<span class="param-label">${this._paramLabel(key)}</span>`;
          html += `<span class="param-value" data-derived-display="${key}">${dispVal}</span>`;
          html += `<span class="param-unit" data-derived-unit="${key}">${dispUnit}</span>`;
          html += `</div>`;
        }
      }

      html += '</div>';
    }

    // Health with bar
    html += `<div class="stat-row health-row${healthClass}"><span class="stat-label">Health</span><span class="stat-value">${Math.round(health)}%</span></div>`;
    html += `<div class="popup-health-bar"><div class="popup-health-fill" style="width:${health}%;background:${healthColor}"></div></div>`;

    // Actions
    const refund = Object.entries(comp.cost).map(([r, a]) => `${Math.floor(a * 0.5)} ${r}`).join(', ');
    html += '<div class="popup-actions">';
    html += `<button class="btn-danger" id="popup-remove-btn">Recycle (${refund})</button>`;
    html += '<button class="popup-probe-btn" id="popup-probe-btn">Probe</button>';
    html += '</div>';

    body.innerHTML = html;

    // Draw schematic if present
    const popupSchematic = document.getElementById('popup-schematic');
    if (popupSchematic) {
      this.drawSchematic(popupSchematic, node.type, node.params);
    }

    // Wire up slider events
    if (paramDefs) {
      this._wirePopupSliders(node, paramDefs, body);
    }

    // Wire up dropdown events
    body.querySelectorAll('select[data-param-option]').forEach(sel => {
      sel.addEventListener('change', () => {
        const key = sel.dataset.paramOption;
        if (!node.params) node.params = {};
        node.params[key] = sel.value;
        this.game.recalcBeamline();
      });
    });

    document.getElementById('popup-remove-btn')?.addEventListener('click', () => {
      this.game.demolishTarget({ kind: 'beamline', node });
      this.hidePopup();
    });

    document.getElementById('popup-probe-btn')?.addEventListener('click', () => {
      this.hidePopup();
      if (this.onProbeClick) this.onProbeClick(node);
    });
  }

  // Position near click, clamped to viewport
  popup.style.left = Math.min(screenX + 14, window.innerWidth - 340) + 'px';
  popup.style.top = Math.min(screenY + 14, window.innerHeight - 400) + 'px';
  popup.classList.remove('hidden');

  const closeBtn = popup.querySelector('.popup-close');
  if (closeBtn) {
    closeBtn.onclick = () => this.hidePopup();
  }

  // Make popup draggable by header
  if (!popup._dragInit) {
    popup._dragInit = true;
    const header = popup.querySelector('.popup-header');
    if (header) {
      header.style.cursor = 'grab';
      makeDraggable(popup, header, { exclude: '.popup-close', grabCursor: true });
    }
  }
};

UIHost.prototype._paramLabel = function(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
};

UIHost.prototype._fmtParam = function(val) {
  if (val === undefined || val === null) return '--';
  if (Math.abs(val) >= 100) return val.toFixed(0);
  if (Math.abs(val) >= 1) return val.toFixed(2);
  if (Math.abs(val) >= 0.01) return val.toFixed(3);
  return val.toExponential(2);
};

UIHost.prototype._wirePopupSliders = function(node, paramDefs, body) {
  let debounceTimer = null;

  const sliders = body.querySelectorAll('input[type="range"][data-param]');
  sliders.forEach(slider => {
    slider.addEventListener('input', () => {
      const key = slider.dataset.param;
      const def = paramDefs[key];
      const val = parseFloat(slider.value);
      node.params[key] = val;

      // Update displayed value
      const display = body.querySelector(`[data-param-display="${key}"]`);
      if (display) {
        if (def.labels) {
          display.textContent = def.labels[Math.round(val)] || val;
        } else {
          display.textContent = this._fmtParam(val);
        }
      }

      // Debounced recalc
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        // Recompute derived values
        if (typeof computeStats !== 'undefined') {
          const computed = computeStats(node.type, node.params);
          if (computed) {
            for (const [dKey, dDef] of Object.entries(paramDefs)) {
              if (!dDef.derived) continue;
              const dDisplay = body.querySelector(`[data-derived-display="${dKey}"]`);
              if (dDisplay && computed[dKey] !== undefined) {
                const isEnergy = dDef.unit === 'GeV' || dDef.unit === 'GeV/c';
                const suffix = dDef.unit === 'GeV/c' ? '/c' : '';
                dDisplay.textContent = isEnergy ? formatEnergy(computed[dKey], suffix).val : this._fmtParam(computed[dKey]);
                const dUnit = body.querySelector(`[data-derived-unit="${dKey}"]`);
                if (dUnit && isEnergy) dUnit.textContent = formatEnergy(computed[dKey], suffix).unit;
                // Flash animation
                const row = dDisplay.closest('.param-derived-row');
                if (row) {
                  row.classList.add('flash');
                  setTimeout(() => row.classList.remove('flash'), 300);
                }
              }
            }

            // Update node's computed stats for game engine
            if (!node.computedStats) node.computedStats = {};
            for (const [sk, sv] of Object.entries(computed)) {
              node.computedStats[sk] = sv;
            }
          }
        }

        // Trigger full beamline recalc
        this.game.recalcBeamline();
        this.game.emit('beamlineChanged');
      }, 50);
    });
  });
};

UIHost.prototype.showFacilityPopup = function(equip, comp, screenX, screenY) {
  const popup = document.getElementById('component-popup');
  if (!popup) return;

  const title = popup.querySelector('.popup-title');
  if (title) title.textContent = comp.name;

  const body = popup.querySelector('.popup-body');
  if (body) {
    let html = `<div class="popup-stats">`;
    html += `<div>Type: ${comp.name}</div>`;
    html += `<div>Category: ${comp.category}</div>`;
    for (const r of utilityStatRows(comp)) html += `<div>${r.label}: ${r.value}</div>`;
    html += `</div>`;
    html += `<div class="popup-actions"><button class="btn-danger" id="popup-remove-facility-btn">Remove (50% refund)</button></div>`;
    body.innerHTML = html;

    document.getElementById('popup-remove-facility-btn')?.addEventListener('click', () => {
      this.game.demolishTarget({ kind: 'equipment', id: equip.id });
      this.hidePopup();
    });
  }

  popup.style.left = Math.min(screenX + 10, window.innerWidth - 220) + 'px';
  popup.style.top = Math.min(screenY + 10, window.innerHeight - 200) + 'px';
  popup.classList.remove('hidden');

  const closeBtn2 = popup.querySelector('.popup-close');
  if (closeBtn2) closeBtn2.onclick = () => this.hidePopup();
  if (!popup._dragInit) {
    popup._dragInit = true;
    const hdr = popup.querySelector('.popup-header');
    if (hdr) {
      hdr.style.cursor = 'grab';
      makeDraggable(popup, hdr, { exclude: '.popup-close', grabCursor: true });
    }
  }
};

UIHost.prototype.hidePopup = function() {
  const popup = document.getElementById('component-popup');
  if (popup) popup.classList.add('hidden');
};

// --- Schematic drawing ---

UIHost.prototype.drawSchematic = function(canvas, componentType, params, options) {
  // We draw at a tiny resolution (70x30 pixels) then scale up crispy
  const PW = (options && options.pixelWidth) || 70, PH = 30;
  const off = document.createElement('canvas');
  off.width = PW; off.height = PH;
  const p = off.getContext('2d');
  p.imageSmoothingEnabled = false;

  // Helper: draw a filled pixel rectangle
  const px = (x, y, w, h, color) => { p.fillStyle = color; p.fillRect(x, y, w, h); };
  // Helper: draw a single pixel
  const dot = (x, y, color) => px(x, y, 1, 1, color);

  // Palette
  const C = {
    bg:       '#0a0a1a',
    wall:     '#667799',
    wallHi:   '#8899bb',
    wallDk:   '#445566',
    beam:     '#44ee88',
    beamDim:  '#228855',
    hot:      '#ee8844',
    hotBright:'#ffaa44',
    glow:     '#ff6622',
    metal:    '#99aabb',
    metalDk:  '#556677',
    magnet:   '#4488cc',
    magnetDk: '#2266aa',
    magnetLt: '#66aaee',
    coil:     '#cc7744',
    coilDk:   '#995522',
    scMagnet: '#44ccee',
    scMagDk:  '#2299bb',
    label:    '#556688',
    aperture: '#334455',
    // Utility pipe colors
    pipeRF:      '#cc4444',
    pipeCryo:    '#44aacc',
    pipeVacuum:  '#555555',
    pipeCooling: '#4488cc',
    pipePlantWater: '#277a9c',
    pipePower:   '#44cc44',
    pipeData:    '#eeeeee',
  };
  const cy = Math.floor(PH / 2);

  // Clear
  px(0, 0, PW, PH, C.bg);

  // Determine if this is a facility (non-beamline) component
  const comp = COMPONENTS[componentType];
  const facilityCategories = ['rfPower', 'cooling', 'vacuum', 'dataControls', 'ops', 'power'];
  const isFacility = comp && facilityCategories.includes(comp.category);

  if (isFacility) {
    // Draw utility pipe background instead of beam
    // Determine pipe color based on category
    const pipeColorMap = {
      rfPower: C.pipeRF,
      cooling: C.pipeCooling,
      vacuum: C.pipeVacuum,
      dataControls: C.pipeData,
      ops: C.wall,
      power: C.pipePower,
    };
    // Draw connection stubs based on requiredConnections
    const conns = comp.requiredConnections || [];
    // Deduplicate and map to colors
    const connColorMap = {
      powerCable:   C.pipePower,
      rfWaveguide:  C.pipeRF,
      coolingWater: C.pipeCooling,
      plantWater: C.pipePlantWater,
      cryoTransfer: C.pipeCryo,
      dataFiber:    C.pipeData,
      vacuumPipe:   C.pipeVacuum,
    };
    // Valve-bearing connection types (fluid lines)
    const valveConns = new Set(['coolingWater', 'plantWater', 'cryoTransfer', 'vacuumPipe']);
    // Collect unique connection types
    const uniqueConns = [...new Set(conns)].filter(c => connColorMap[c]);
    // Add output connections for facility categories that provide services
    // RF Power: produces RF waveguide output
    if (comp.category === 'rfPower' && !uniqueConns.includes('rfWaveguide')) {
      uniqueConns.push('rfWaveguide');
    }
    // Cooling/cryo subsection: produces cryo transfer output
    if (comp.category === 'cooling' && comp.subsection === 'cryogenics' && !uniqueConns.includes('cryoTransfer')) {
      uniqueConns.push('cryoTransfer');
    }
    // Cooling diagrams describe their actual service: process-water plant
    // supplies LCW, while tanks and rejectors sit on the plant-water loop.
    if (comp.category === 'cooling' && ['integratedCooling', 'processCooling'].includes(comp.subsection) && !uniqueConns.includes('coolingWater')) uniqueConns.push('coolingWater');
    if (comp.category === 'cooling' && ['waterSupply', 'heatRejection'].includes(comp.subsection) && !uniqueConns.includes('plantWater')) uniqueConns.push('plantWater');
    // Data/Controls: produces data fiber output
    if (comp.category === 'dataControls' && !uniqueConns.includes('dataFiber')) {
      uniqueConns.push('dataFiber');
    }
    // Vacuum: provides vacuum pipe service
    if (comp.category === 'vacuum' && !uniqueConns.includes('vacuumPipe')) {
      uniqueConns.push('vacuumPipe');
    }
    // Power: provides power cable service
    if (comp.category === 'power' && !uniqueConns.includes('powerCable')) {
      uniqueConns.push('powerCable');
    }

    if (uniqueConns.length > 0) {
      const baseY = cy + 5;
      const yStep = 4; // vertical offset between successive connection lines

      for (let i = 0; i < uniqueConns.length; i++) {
        const connType = uniqueConns[i];
        const color = connColorMap[connType];
        const lineY = baseY + i * yStep;
        const stubX = 35; // all drop from center
        const hasValve = valveConns.has(connType);

        // Vertical dashed stub down from equipment
        for (let y = cy + 2; y <= lineY; y += 2) {
          dot(stubX - i * 3, y, color);
        }
        // Elbow
        dot(stubX - i * 3, lineY, color);
        // Horizontal dashed line going right
        const hStart = stubX - i * 3 + 1;
        const hEnd = PW - 4;
        for (let x = hStart; x < hEnd; x += 3) {
          dot(x, lineY, color);
          if (x + 1 < hEnd) dot(x + 1, lineY, color);
        }
        // Arrow at end
        dot(hEnd, lineY, color);
        dot(hEnd - 1, lineY - 1, color);
        dot(hEnd - 1, lineY + 1, color);

        // Valve symbol for fluid lines only
        if (hasValve) {
          const vx = stubX - i * 3 + 3, vy = lineY;
          dot(vx, vy - 2, color);
          dot(vx, vy - 1, color);
          dot(vx, vy, color);
          dot(vx, vy + 1, color);
          dot(vx, vy + 2, color);
          dot(vx + 1, vy - 1, color);
          dot(vx + 1, vy + 1, color);
          dot(vx + 2, vy, color);
          dot(vx + 4, vy - 2, color);
          dot(vx + 4, vy - 1, color);
          dot(vx + 4, vy, color);
          dot(vx + 4, vy + 1, color);
          dot(vx + 4, vy + 2, color);
          dot(vx + 3, vy - 1, color);
          dot(vx + 3, vy + 1, color);
        }
      }
    }
  } else {
    // Beam dashes (background, across whole width)
    for (let x = 2; x < PW - 2; x += 3) {
      dot(x, cy, C.beamDim);
      if (x + 1 < PW - 2) dot(x + 1, cy, C.beamDim);
    }
    // Beam arrow at right
    dot(PW - 4, cy, C.beam);
    dot(PW - 5, cy - 1, C.beamDim);
    dot(PW - 5, cy + 1, C.beamDim);
  }

  // Dispatch to specific component drawer
  const drawFn = this._schematicDrawers[componentType];
  if (drawFn) drawFn(p, px, dot, PW, PH, cy, C, params);

  // Scale up to display canvas
  const dpr = window.devicePixelRatio || 1;
  const dw = canvas.clientWidth || 280;
  const dh = canvas.clientHeight || 100;
  canvas.width = dw * dpr;
  canvas.height = dh * dpr;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, dw * dpr, dh * dpr);
  ctx.drawImage(off, 0, 0, PW, PH, 0, 0, dw * dpr, dh * dpr);
};

// Standard beam pipe dimensions for consistent schematic rendering
const PIPE_HALF = 3;    // pipe walls at cy ± 3
const FLANGE_HALF = 5;  // flange extends to cy ± 5
const FLANGE_W = 2;     // flange width in pixels

// Draw standard beam pipe walls and flanges for consistent component-to-component alignment.
// Options: leftFlange/rightFlange (bool), skipFrom/skipTo (x range to omit walls for cavities)
function _drawBeamPipe(px, dot, W, cy, C, opts = {}) {
  const { leftFlange = true, rightFlange = true, skipFrom, skipTo } = opts;

  // Pipe walls (1px lines at cy ± PIPE_HALF, full width or with cavity gap)
  if (skipFrom != null && skipTo != null) {
    if (skipFrom > 0) {
      px(0, cy - PIPE_HALF, skipFrom, 1, C.wallDk);
      px(0, cy + PIPE_HALF, skipFrom, 1, C.wallDk);
    }
    if (skipTo < W) {
      px(skipTo, cy - PIPE_HALF, W - skipTo, 1, C.wallDk);
      px(skipTo, cy + PIPE_HALF, W - skipTo, 1, C.wallDk);
    }
  } else {
    px(0, cy - PIPE_HALF, W, 1, C.wallDk);
    px(0, cy + PIPE_HALF, W, 1, C.wallDk);
  }

  // Left flange
  if (leftFlange) {
    px(0, cy - FLANGE_HALF, FLANGE_W, FLANGE_HALF * 2 + 1, C.metal);
    px(FLANGE_W, cy - FLANGE_HALF + 1, 1, FLANGE_HALF * 2 - 1, C.wallDk);
  }

  // Right flange
  if (rightFlange) {
    px(W - FLANGE_W, cy - FLANGE_HALF, FLANGE_W, FLANGE_HALF * 2 + 1, C.metal);
    px(W - FLANGE_W - 1, cy - FLANGE_HALF + 1, 1, FLANGE_HALF * 2 - 1, C.wallDk);
  }
}

// Hatched shielding block. Bulk shielding is the one thing in these schematics
// that has no interesting internal structure — it is just a lot of dense
// material — so it gets the conventional drawing-office answer: a flat fill
// with a diagonal hatch over it, which reads as "solid" without competing for
// attention with the hardware it surrounds.
function _drawHatchBlock(px, dot, x, y, w, h, base, hatch) {
  px(x, y, w, h, base);
  for (let iy = 0; iy < h; iy++) {
    for (let ix = 0; ix < w; ix++) {
      if ((x + ix + y + iy) % 4 === 0) dot(x + ix, y + iy, hatch);
    }
  }
}

// Shared body for the SRF cryomodule family: vacuum vessel, 80 K thermal
// shield and a run of elliptical cells. Cell count and bulge are what separate
// the rungs of the ladder at 70x30, so both are the caller's choice.
// Options: cells, bulge, cellColor, shield (bool), vesselHalf.
function _drawCryoShell(px, dot, cy, C, L, R, opts) {
  const { cells, bulge, cellColor, shield = true, vesselHalf = 12 } = opts;
  // Outer vacuum vessel
  px(L, cy - vesselHalf, R - L, 1, C.wall);
  px(L, cy + vesselHalf, R - L, 1, C.wall);
  px(L, cy - vesselHalf, 1, vesselHalf * 2 + 1, C.wallHi);
  px(R, cy - vesselHalf, 1, vesselHalf * 2 + 1, C.wallHi);
  if (shield) {
    px(L + 2, cy - vesselHalf + 2, R - L - 4, 1, '#886633');
    px(L + 2, cy + vesselHalf - 2, R - L - 4, 1, '#886633');
  }
  // Elliptical cell string
  const cellW = (R - L - 8) / cells, hw = Math.max(2, Math.floor(cellW / 2));
  for (let i = 0; i < cells; i++) {
    const cx2 = L + 4 + Math.round(cellW * (i + 0.5));
    for (let dx = -hw; dx <= hw; dx++) {
      const t = Math.abs(dx) / hw;
      const h = Math.round(bulge * (1 - t * t));
      dot(cx2 + dx, cy - 1 - h, cellColor);
      dot(cx2 + dx, cy + 1 + h, cellColor);
    }
  }
}

UIHost.prototype._schematicDrawers = {
  // === SOURCE (cathode ray / electron gun style) ===
  source(p, px, dot, W, H, cy, C) {
    // Clear pre-drawn beam dashes on the left side (source generates its own beam)
    px(0, cy - 1, 45, 3, C.bg);
    // Beam pipe only on the right (from anode onwards)
    const pipeStart = 43;
    px(pipeStart, cy - PIPE_HALF, W - pipeStart, 1, C.wallDk);
    px(pipeStart, cy + PIPE_HALF, W - pipeStart, 1, C.wallDk);
    // Right flange only
    px(W - FLANGE_W, cy - FLANGE_HALF, FLANGE_W, FLANGE_HALF * 2 + 1, C.metal);
    px(W - FLANGE_W - 1, cy - FLANGE_HALF + 1, 1, FLANGE_HALF * 2 - 1, C.wallDk);
    const cathX = 12;  // cathode plate x position
    const anodeX = 42; // anode plate x position
    const focusX = 20; // focus electrode x position

    // --- Cathode (curved plate on left) ---
    for (let dy = -8; dy <= 8; dy++) {
      const curve = Math.round(Math.abs(dy) * Math.abs(dy) / 18);
      const cx = cathX + 2 - curve;
      dot(cx, cy + dy, C.hot);
      dot(cx - 1, cy + dy, '#cc6633');
    }
    // Cathode glow (thermionic emission)
    for (let dy = -5; dy <= 5; dy++) {
      const curve = Math.round(dy * dy / 18);
      dot(cathX + 3 - curve, cy + dy, C.hotBright);
    }
    dot(cathX + 4, cy, '#ffcc66');
    dot(cathX + 3, cy - 1, '#ffaa44');
    dot(cathX + 3, cy + 1, '#ffaa44');

    // --- Focus electrode (Wehnelt cylinder) ---
    for (let x = cathX - 3; x <= focusX; x++) {
      dot(x, cy - 10, C.wall);
      dot(x, cy - 11, C.wallDk);
    }
    for (let x = cathX - 3; x <= focusX; x++) {
      dot(x, cy + 10, C.wall);
      dot(x, cy + 11, C.wallDk);
    }
    dot(focusX + 1, cy - 9, C.wall);
    dot(focusX + 2, cy - 8, C.wall);
    dot(focusX + 1, cy + 9, C.wall);
    dot(focusX + 2, cy + 8, C.wall);
    for (let dy = -11; dy <= 11; dy++) {
      dot(cathX - 3, cy + dy, C.wallDk);
    }

    // --- Anode plate (with aperture hole) ---
    for (let dy = -10; dy <= 10; dy++) {
      if (Math.abs(dy) <= 2) continue;
      dot(anodeX, cy + dy, C.metal);
      dot(anodeX + 1, cy + dy, C.metalDk);
    }

    // --- Equipotential field lines ---
    const fieldColor = '#334466';
    const fieldBright = '#445588';
    for (const frac of [0.2, 0.4, 0.6, 0.8]) {
      const fx = Math.round(cathX + 4 + frac * (anodeX - cathX - 4));
      const spread = Math.round(9 * (1 - frac * 0.6));
      for (let dy = -spread; dy <= spread; dy++) {
        const bow = Math.round((1 - frac) * dy * dy / 25);
        const lx = fx - bow;
        if (lx > cathX + 4 && lx < anodeX) {
          dot(lx, cy + dy, (Math.abs(dy) % 2 === 0) ? fieldBright : fieldColor);
        }
      }
    }

    // --- Electron beam envelope (left of anode: dim traces converging) ---
    for (const startDy of [-6, -3, 3, 6]) {
      for (let x = cathX + 4; x <= anodeX; x++) {
        const t = (x - cathX - 4) / (anodeX - cathX - 4);
        const y = cy + Math.round(startDy * (1 - t * 0.85));
        if (y >= 1 && y < H - 1) {
          dot(x, y, C.beamDim);
        }
      }
    }
    // --- Solid beam line (right of anode: focused beam in pipe) ---
    px(anodeX + 2, cy, W - FLANGE_W - 2 - (anodeX + 2), 1, C.beam);

  },

  // === BEAM PIPE ===
  drift(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    // Vacuum interior between pipe walls
    px(FLANGE_W + 1, cy - PIPE_HALF + 1, W - 2 * FLANGE_W - 2, PIPE_HALF * 2 - 1, '#0d0d22');
    // Vacuum specks — distribute proportionally, skip any outside bounds
    const innerL = FLANGE_W + 2, innerR = W - FLANGE_W - 2;
    for (const [frac, dy] of [[0.26, -1], [0.43, 0], [0.60, -2], [0.36, 1], [0.71, -1], [0.53, 1]]) {
      const dx = Math.round(frac * W);
      if (dx >= innerL && dx < innerR && Math.abs(dy) < PIPE_HALF) dot(dx, cy + dy, '#1a1a33');
    }
    // Solid beam line (vacuum fill covers pre-drawn dashes)
    px(FLANGE_W + 2, cy, W - 2 * FLANGE_W - 4, 1, C.beam);
  },

  // === BELLOWS ===
  bellows(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    // Corrugated bellows folds on the pipe surface
    const L = FLANGE_W + 2, R = W - FLANGE_W - 2;
    const folds = 10;
    const step = (R - L) / folds;
    for (let i = 0; i <= folds; i++) {
      const x = L + Math.floor(i * step);
      const bulge = (i % 2 === 0) ? 1 : 0;
      dot(x, cy - PIPE_HALF - bulge, C.wall);
      dot(x, cy + PIPE_HALF + bulge, C.wall);
      if (i > 0 && i % 2 === 0) {
        // Vertical fold lines connecting corrugations
        dot(x, cy - PIPE_HALF - 1, C.wallDk);
        dot(x, cy + PIPE_HALF + 1, C.wallDk);
      }
    }
    // Solid beam line
    px(FLANGE_W + 2, cy, W - 2 * FLANGE_W - 4, 1, C.beam);
  },

  // === DIPOLE ===
  dipole(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    const L = 16, R = 54, T = cy - 12, B = cy + 12;
    px(L, T, R - L, 2, C.wallHi);
    px(L, B - 1, R - L, 2, C.wallHi);
    px(L, T, 2, B - T + 1, C.wall);
    px(L + 2, T + 2, R - L - 2, 2, C.magnetDk);
    px(L + 2, B - 3, R - L - 2, 2, C.magnetDk);
    px(L + 2, T + 4, 4, cy - T - 5, C.coil);
    px(L + 2, cy + 2, 4, B - cy - 5, C.coil);
    px(L + 3, T + 5, 2, cy - T - 7, C.coilDk);
    px(L + 3, cy + 3, 2, B - cy - 7, C.coilDk);
    px(L + 6, cy - 3, R - L - 6, 7, '#0d0d22');

    const fieldColor = '#3366bb';
    const fieldDim = '#223366';
    for (const fx of [24, 30, 36, 42, 48]) {
      for (let y = T + 4; y < B - 3; y++) {
        if (y >= cy - 3 && y <= cy + 3) continue;
        dot(fx, y, (y % 2 === 0) ? fieldColor : fieldDim);
      }
      dot(fx, cy - 3, fieldColor);
      dot(fx - 1, cy - 4, fieldDim);
      dot(fx + 1, cy - 4, fieldDim);
    }

    for (const yOff of [-2, 0, 2]) {
      const rayColor = yOff === 0 ? C.beam : C.beamDim;
      for (let x = 4; x < L + 8; x++) dot(x, cy + yOff, rayColor);
      for (let x = L + 8; x < R - 2; x++) {
        const t = (x - L - 8) / (R - L - 10);
        const bend = Math.round(t * t * 4);
        dot(x, cy + yOff - bend, rayColor);
      }
      for (let i = 0; i < 8; i++) {
        const ex = R - 2 + i;
        const ey = cy + yOff - 4 - Math.round(i * 0.6);
        if (ey >= 0 && ey < H && ex < W) dot(ex, ey, rayColor);
      }
    }

  },

  // === QUADRUPOLE ===
  quadrupole(p, px, dot, W, H, cy, C, params) {
    _drawBeamPipe(px, dot, W, cy, C);
    const cx = 35;
    px(cx - 8, cy - 11, 16, 5, C.magnet);
    px(cx - 5, cy - 7, 10, 3, C.magnetDk);
    px(cx - 8, cy + 7, 16, 5, C.magnet);
    px(cx - 5, cy + 5, 10, 3, C.magnetDk);
    px(cx - 10, cy - 10, 2, 4, C.coil);
    px(cx + 8, cy - 10, 2, 4, C.coil);
    px(cx - 10, cy + 7, 2, 4, C.coil);
    px(cx + 8, cy + 7, 2, 4, C.coil);
    dot(cx, cy - 9, '#ff4444');
    dot(cx, cy + 9, '#4444ff');

    const fieldColor = '#3366bb';
    const fieldDim = '#223366';
    for (const fx of [cx - 3, cx, cx + 3]) {
      for (let y = cy - 7; y <= cy - 4; y++) {
        dot(fx, y, (y % 2 === 0) ? fieldColor : fieldDim);
      }
    }
    for (const fx of [cx - 3, cx, cx + 3]) {
      for (let y = cy + 4; y <= cy + 6; y++) {
        dot(fx, y, (y % 2 === 0) ? fieldColor : fieldDim);
      }
    }

    // Solid beam line
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);

    // Polarity arrows at cx+12: Focus X (polarity 0) = vertical, Focus Y (polarity 1) = horizontal
    const polarity = params?.polarity;
    const ax = cx + 12;
    if (polarity === 0 || polarity == null) {
      // Focus X: red inward vertical arrows
      const col = '#ff4466';
      // Top arrow pointing down
      dot(ax, cy - 8, col);
      dot(ax, cy - 9, col);
      dot(ax, cy - 10, col);
      dot(ax - 1, cy - 8, col);
      dot(ax + 1, cy - 8, col);
      // Bottom arrow pointing up
      dot(ax, cy + 8, col);
      dot(ax, cy + 9, col);
      dot(ax, cy + 10, col);
      dot(ax - 1, cy + 8, col);
      dot(ax + 1, cy + 8, col);
    }
    if (polarity === 1 || polarity == null) {
      // Focus Y: blue inward horizontal arrows (same x region)
      const col = '#4488ff';
      const yOff = polarity == null ? 6 : 0;
      // Left arrow pointing right (above or at beam)
      dot(ax - 3, cy - yOff, col);
      dot(ax - 2, cy - yOff, col);
      dot(ax - 1, cy - yOff, col);
      dot(ax - 1, cy - yOff - 1, col);
      dot(ax - 1, cy - yOff + 1, col);
      // Right arrow pointing left (below or at beam)
      dot(ax + 3, cy + yOff, col);
      dot(ax + 2, cy + yOff, col);
      dot(ax + 1, cy + yOff, col);
      dot(ax + 1, cy + yOff - 1, col);
      dot(ax + 1, cy + yOff + 1, col);
    }
  },

  // === SOLENOID ===
  solenoid(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    const L = 12, R = 58;
    px(L, cy - 9, R - L, 1, C.coil);
    px(L, cy + 9, R - L, 1, C.coil);
    for (let x = L + 2; x < R - 1; x += 3) {
      px(x, cy - 9, 1, 19, C.coilDk);
      px(x + 1, cy - 8, 1, 17, '#aa6633');
    }

    const fieldColor = '#3366bb';
    const fieldDim = '#223366';
    for (const fy of [cy - 2, cy, cy + 2]) {
      for (let x = L + 2; x < R - 1; x++) {
        dot(x, fy, (x % 2 === 0) ? fieldColor : fieldDim);
      }
      dot(R - 2, fy, fieldColor);
      dot(R - 3, fy - 1, fieldDim);
      dot(R - 3, fy + 1, fieldDim);
    }

    // Solid beam line
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);

    // Symmetric focusing arrows (solenoid focuses both planes)
    const ax = 35 + 12;
    const arrowRed = '#ff4466';
    const arrowBlue = '#4488ff';
    // Vertical red arrows (inward)
    dot(ax, cy - 10, arrowRed);
    dot(ax, cy - 9, arrowRed);
    dot(ax, cy - 8, arrowRed);
    dot(ax - 1, cy - 10, arrowRed);
    dot(ax + 1, cy - 10, arrowRed);
    dot(ax, cy + 10, arrowRed);
    dot(ax, cy + 9, arrowRed);
    dot(ax, cy + 8, arrowRed);
    dot(ax - 1, cy + 10, arrowRed);
    dot(ax + 1, cy + 10, arrowRed);
    // Horizontal blue arrows (inward)
    const cx = 35;
    dot(cx - 18, cy, arrowBlue);
    dot(cx - 17, cy, arrowBlue);
    dot(cx - 16, cy, arrowBlue);
    dot(cx - 18, cy - 1, arrowBlue);
    dot(cx - 18, cy + 1, arrowBlue);
    dot(cx + 18, cy, arrowBlue);
    dot(cx + 17, cy, arrowBlue);
    dot(cx + 16, cy, arrowBlue);
    dot(cx + 18, cy - 1, arrowBlue);
    dot(cx + 18, cy + 1, arrowBlue);
  },

  // === RF CAVITY ===
  rfCavity(p, px, dot, W, H, cy, C) {
    const L = 10, R = 60;
    _drawBeamPipe(px, dot, W, cy, C, { skipFrom: L, skipTo: R });
    // Outer vessel walls
    px(L, cy - 10, R - L, 1, C.wall);
    px(L, cy + 10, R - L, 1, C.wall);
    px(L, cy - 10, 1, 21, C.wallHi);
    px(R, cy - 10, 1, 21, C.wallHi);
    // Cavity cells — bulging profile
    const cells = 3;
    const cellW = (R - L - 2) / cells;
    for (let i = 0; i < cells; i++) {
      const cx2 = L + 1 + Math.floor(cellW * (i + 0.5));
      const bulge = 7;
      // Top bulge
      for (let dx = -Math.floor(cellW / 2) + 1; dx < Math.floor(cellW / 2); dx++) {
        const t = Math.abs(dx) / (cellW / 2);
        const h = Math.round(bulge * (1 - t * t));
        dot(cx2 + dx, cy - 3 - h, C.hot);
        dot(cx2 + dx, cy + 3 + h, C.hot);
      }
      // Iris walls between cells
      if (i > 0) {
        const ix = L + 1 + Math.floor(cellW * i);
        for (let dy = -3; dy <= 3; dy++) {
          if (Math.abs(dy) <= 1) continue;
          dot(ix, cy + dy, C.metal);
        }
      }
    }
    // RF field lines
    for (let i = 0; i < cells; i++) {
      const cx2 = L + 1 + Math.floor(cellW * (i + 0.5));
      for (let dy = -1; dy <= 1; dy++) {
        dot(cx2, cy + dy, C.hotBright);
        dot(cx2 - 1, cy + dy, '#cc6633');
        dot(cx2 + 1, cy + dy, '#cc6633');
      }
    }
  },

  // === FARADAY CUP ===
  faradayCup(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C, { rightFlange: false });
    const L = 20, R = 50;
    // Cup shape — open on left
    px(R - 2, cy - 8, 2, 17, C.metal);
    px(L, cy - 8, R - L, 2, C.metal);
    px(L, cy + 7, R - L, 2, C.metal);
    // Interior dark
    px(L + 2, cy - 6, R - L - 4, 13, '#0d0d22');
    // Wire lead out
    px(R, cy, 8, 1, C.coil);
    dot(R + 8, cy, C.coilDk);
    // Beam hitting back wall
    for (let x = 4; x < L + 2; x++) dot(x, cy, C.beam);
    for (let x = L + 2; x < R - 2; x++) {
      dot(x, cy, C.beamDim);
    }
    // Charge collection sparks
    dot(R - 4, cy - 2, C.hotBright);
    dot(R - 3, cy + 1, C.hot);
    dot(R - 5, cy + 2, C.hotBright);
  },

  // === BEAM STOP ===
  beamStop(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C, { rightFlange: false });
    const L = 24, R = 50;
    // Thick absorber block
    px(L, cy - 10, R - L, 21, C.metalDk);
    px(L + 1, cy - 9, R - L - 2, 19, C.metal);
    // Cooling channels
    for (let y = cy - 7; y <= cy + 7; y += 3) {
      px(L + 3, y, R - L - 6, 1, '#2255aa');
    }
    // Beam entering
    for (let x = 4; x < L; x++) dot(x, cy, C.beam);
    // Heat glow at impact
    dot(L + 1, cy, C.glow);
    dot(L + 2, cy, C.hot);
    dot(L + 1, cy - 1, C.hot);
    dot(L + 1, cy + 1, C.hot);
  },

  // === DETECTOR ===
  detector(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C, { rightFlange: false });
    const cx = 35;
    // Concentric detector layers
    for (const r of [12, 9, 6, 3]) {
      const color = r > 9 ? C.metalDk : r > 6 ? C.magnet : r > 3 ? C.coil : C.hot;
      for (let a = 0; a < Math.PI * 2; a += 0.15) {
        const dx = Math.round(Math.cos(a) * r);
        const dy = Math.round(Math.sin(a) * r * 0.85);
        if (cx + dx >= 2 && cx + dx < W - 2) dot(cx + dx, cy + dy, color);
      }
    }
    // Beam pipe through center
    px(4, cy - 1, cx - 6, 3, '#0d0d22');
    for (let x = 4; x < cx - 2; x++) dot(x, cy, C.beam);
    // Interaction vertex
    dot(cx, cy, '#ffffff');
    dot(cx - 1, cy, C.hotBright);
    dot(cx + 1, cy, C.hotBright);
  },

  // === BLACK HOLE CHAMBER ===
  // The only endpoint with a beam arriving on both faces, so it is drawn as an
  // interaction region rather than a terminus: a spherical containment vessel
  // in a shielded pit, two beams converging on it, final-focus doublets just
  // outside the shield. Closer to a reactor vessel than to `detector` — the
  // hardware is there to hold something in, not to look at it.
  blackHoleChamber(p, px, dot, W, H, cy, C) {
    const cx = 35, R = 10;
    const shell = '#4d5a6b', core = '#0f131b', strap = '#c86a20', strapHi = '#ff7a18';
    _drawBeamPipe(px, dot, W, cy, C, { skipFrom: cx - R, skipTo: cx + R + 1 });

    // --- Shielded pit: walls the beams penetrate, roof partly lifted ---
    for (const [wx, gapY] of [[2, cy], [61, cy]]) {
      _drawHatchBlock(px, dot, wx, 2, 7, 26, '#3a3a44', '#565663');
      px(wx, gapY - 4, 7, 9, C.bg);            // beam penetration
      px(wx, gapY - 4, 7, 1, '#565663');
      px(wx, gapY + 4, 7, 1, '#565663');
    }
    for (const rx of [10, 42]) _drawHatchBlock(px, dot, rx, 1, 18, 3, '#3a3a44', '#565663');
    _drawHatchBlock(px, dot, 10, 27, 50, 2, '#3a3a44', '#565663');

    // --- Containment vessel ---
    for (let dy = -R; dy <= R; dy++) {
      const hw = Math.round(Math.sqrt(R * R - dy * dy));
      px(cx - hw, cy + dy, hw * 2 + 1, 1, shell);
      const ir = 8;
      if (Math.abs(dy) < ir) {
        const iw = Math.round(Math.sqrt(ir * ir - dy * dy));
        px(cx - iw, cy + dy, iw * 2 + 1, 1, core);
      }
    }
    // Girth straps: an equatorial belt and two meridians, drawn as the
    // ellipses they project to, which is what makes the shell read as a sphere.
    for (let a = 0; a < Math.PI * 2; a += 0.08) {
      dot(cx + Math.round(Math.cos(a) * R), cy + Math.round(Math.sin(a) * 2.6), strapHi);
      dot(cx + Math.round(Math.cos(a) * 6.2), cy + Math.round(Math.sin(a) * R), strap);
      dot(cx + Math.round(Math.cos(a) * 2.6), cy + Math.round(Math.sin(a) * R), strap);
    }

    // --- Instrumentation penetrations, all on the upper hemisphere ---
    for (const a of [-2.3, -1.9, -1.25, -0.85]) {
      const nx = Math.round(cx + Math.cos(a) * R), ny = Math.round(cy + Math.sin(a) * R);
      const ex = Math.round(cx + Math.cos(a) * (R + 3)), ey = Math.round(cy + Math.sin(a) * (R + 3));
      dot(nx, ny, C.metal); dot(ex, ey, C.metal);
      dot(Math.round((nx + ex) / 2), Math.round((ny + ey) / 2), C.metalDk);
      px(ex - 1, ey - 1, 3, 2, C.metalDk);
    }
    // Top access hatch, in the gap the roof blocks leave open
    px(cx - 2, cy - R - 3, 5, 3, C.metal);
    px(cx - 3, cy - R - 4, 7, 1, strapHi);

    // --- Final-focus doublets, one per arm ---
    for (const [qx, sgn] of [[13, -1], [52, 1]]) {
      px(qx, cy - 5, 5, 11, C.magnetDk);
      px(qx, cy - 5, 5, 1, C.magnet);
      px(qx, cy + 5, 5, 1, C.magnet);
      px(qx + 1, cy - 3, 3, 2, C.coil);
      px(qx + 1, cy + 2, 3, 2, C.coil);
      dot(qx + (sgn > 0 ? 5 : -1), cy, C.beam);
    }

    // --- Two beams converging, and what happens where they meet ---
    for (let x = 3; x < cx - R; x++) dot(x, cy, x > cx - R - 8 ? '#ccffdd' : C.beam);
    for (let x = cx + R + 1; x < W - 3; x++) dot(x, cy, x < cx + R + 9 ? '#ccffdd' : C.beam);
    dot(cx - R - 2, cy - 1, C.beam); dot(cx - R - 2, cy + 1, C.beam);
    dot(cx + R + 2, cy - 1, C.beam); dot(cx + R + 2, cy + 1, C.beam);
    // The event: a white core and debris spraying out through the vessel
    for (const [dx, dy] of [[3, -2], [3, 2], [-3, -2], [-3, 2], [2, -4], [-2, 4], [4, 1], [-4, -1]]) {
      dot(cx + dx, cy + dy, C.hot);
      dot(cx + dx * 2, cy + dy * 2, C.glow);
    }
    px(cx - 1, cy - 1, 3, 3, C.hotBright);
    dot(cx, cy, '#ffffff');
  },

  // === HAWKING RADIATION DETECTOR ===
  // A calorimeter, not a barrel: no yoke, no coil, no tracker, nothing here
  // bends a particle. What it has instead is instrumentation density — a fine
  // sampling stack graded from EM pitch to hadronic pitch, every layer piped
  // out through fibre to readout racks. The fan-out is the identity.
  hawkingDetector(p, px, dot, W, H, cy, C) {
    const top = cy - 11, bot = cy + 11, sci = '#ff9c3c', fib = '#d9a05a';
    _drawBeamPipe(px, dot, W, cy, C, { rightFlange: false });
    px(47, 0, W - 47, H, C.bg);      // nothing downstream — the beam stops in here

    // --- Hermetic frame. Anything that escapes through a crack is signal lost ---
    px(17, top, 30, 1, C.metal);
    px(17, bot, 30, 1, C.metal);
    px(17, top, 1, bot - top + 1, C.metalDk);
    px(46, top, 1, bot - top + 1, C.metalDk);

    // --- Sampling stack: fine EM pitch first, then coarse hadronic pitch ---
    const layerH = bot - top - 1;
    for (let x = 18; x < 30; x += 3) {
      px(x, top + 1, 2, layerH, C.metalDk);
      px(x + 2, top + 1, 1, layerH, sci);
    }
    for (let x = 30; x < 46; x += 4) {
      px(x, top + 1, 3, layerH, '#3d4450');
      px(x + 3, top + 1, 1, layerH, sci);
    }

    // --- Entrance snout, and the shower dying inside the stack ---
    px(14, cy - 3, 3, 7, C.metal);
    for (let x = 19; x < 44; x++) {
      const t = (x - 19) / 24;
      const amp = Math.round(9 * Math.sin(Math.PI * Math.min(1, t * 1.3)) * (1 - t * 0.5));
      for (let dy = -amp; dy <= amp; dy++) {
        if ((x + dy) % 3) continue;
        dot(x, cy + dy, Math.abs(dy) < 2 ? C.hotBright : C.hot);
      }
    }
    for (let x = 2; x < 14; x++) dot(x, cy, C.beam);

    // --- Fibre readout: a riser off every layer into the manifolds, then the
    // fan-out that is this endpoint's whole identity ---
    px(17, 1, 30, 2, C.metalDk);
    px(17, bot + 1, 30, 2, C.metalDk);
    for (let x = 18; x < 46; x += 2) { dot(x, 3, fib); dot(x, bot + 1, fib); }
    for (let i = 0; i < 6; i++) {
      const x1 = 51 + i * 3;
      for (let x = 47; x <= x1; x++) {
        dot(x, Math.round(2 + 5 * ((x - 47) / (x1 - 47))), fib);
      }
    }
    for (let x = 47; x < 50; x++) dot(x, 28 - (x - 47), fib);

    // --- Readout racks. What this endpoint produces is data, not events ---
    for (const rx of [50, 59]) {
      px(rx, 7, 8, 11, C.metalDk);
      px(rx + 1, 8, 6, 9, '#101420');
      for (let k = 0; k < 4; k++) px(rx + 2, 9 + k * 2, 4, 1, C.wallDk);
      dot(rx + 6, 9, C.beam);
      dot(rx + 6, 13, sci);
      px(rx + 3, 18, 2, 1, fib);
    }
    px(50, 19, 17, 8, C.metalDk);
    px(51, 20, 15, 6, '#101420');
    for (let k = 0; k < 3; k++) px(52, 21 + k * 2, 13, 1, C.wallDk);
    for (const lx of [63, 65]) dot(lx, 25, C.beam);
  },

  // === APERTURE / COLLIMATOR ===
  aperture(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    const cx = 35;
    // Upper jaw
    px(cx - 2, cy - 12, 4, 8, C.metal);
    px(cx - 1, cy - 12, 2, 8, C.metalDk);
    // Lower jaw
    px(cx - 2, cy + 5, 4, 8, C.metal);
    px(cx - 1, cy + 5, 2, 8, C.metalDk);
    // Jaw tips (tapered)
    dot(cx - 1, cy - 4, C.metal);
    dot(cx, cy - 4, C.metal);
    dot(cx - 1, cy + 4, C.metal);
    dot(cx, cy + 4, C.metal);
    // Beam narrowing through gap
    for (let x = 4; x < cx - 2; x++) {
      const t = (x - 4) / (cx - 6);
      const spread = Math.round(2 * (1 - t));
      dot(x, cy + spread, C.beamDim);
      dot(x, cy - spread, C.beamDim);
      dot(x, cy, C.beam);
    }
    for (let x = cx + 2; x < W - 4; x++) dot(x, cy, C.beam);
  },

  // === VELOCITY SELECTOR ===
  velocitySelector(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    const L = 14, R = 56;
    // E-field plates (top/bottom)
    px(L, cy - 8, R - L, 2, '#cc4444');
    px(L, cy + 7, R - L, 2, '#4444cc');
    // B-field indicators (perpendicular dots)
    for (let x = L + 4; x < R - 2; x += 5) {
      dot(x, cy - 5, C.magnetLt);
      dot(x, cy + 5, C.magnetLt);
    }
    // Beam — selected velocities pass through
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
    // Rejected particles deflected
    for (let i = 0; i < 4; i++) {
      const sx = L + 8 + i * 8;
      dot(sx, cy - 2, C.beamDim);
      dot(sx + 1, cy - 4, '#553322');
    }
  },

  // === EMITTANCE FILTER ===
  emittanceFilter(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    const cx = 35;
    // Slit pair
    px(cx - 6, cy - 10, 2, 7, C.metal);
    px(cx - 6, cy + 4, 2, 7, C.metal);
    px(cx + 4, cy - 10, 2, 7, C.metal);
    px(cx + 4, cy + 4, 2, 7, C.metal);
    // Beam envelope narrowing
    for (let x = 4; x < cx - 6; x++) {
      const spread = Math.round(3 * (1 - (x - 4) / (cx - 10)));
      dot(x, cy + spread, C.beamDim);
      dot(x, cy - spread, C.beamDim);
      dot(x, cy, C.beam);
    }
    for (let x = cx + 6; x < W - 4; x++) dot(x, cy, C.beam);
    // Phase space label
    dot(cx - 2, cy - 5, C.label);
    dot(cx, cy - 5, C.label);
    dot(cx + 2, cy - 5, C.label);
  },

  // === UNDULATOR ===
  undulator(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    const L = 8, R = 62;
    // Alternating N/S magnet blocks
    const nBlocks = 8;
    const step = (R - L) / nBlocks;
    for (let i = 0; i < nBlocks; i++) {
      const x = L + Math.floor(i * step);
      const w = Math.max(1, Math.floor(step) - 1);
      const isN = i % 2 === 0;
      px(x, cy - 10, w, 4, isN ? '#cc4444' : '#4444cc');
      px(x, cy + 7, w, 4, isN ? '#4444cc' : '#cc4444');
    }
    // Sinusoidal beam path
    for (let x = 4; x < W - 4; x++) {
      const phase = (x - L) / (R - L) * nBlocks * Math.PI;
      const y = Math.round(cy + Math.sin(phase) * 2);
      dot(x, y, C.beam);
    }
    // Radiation cone at exit
    for (let i = 0; i < 3; i++) {
      dot(R + 2 + i, cy - i, '#ffdd44');
      dot(R + 2 + i, cy, '#ffdd44');
      dot(R + 2 + i, cy + i, '#ffdd44');
    }
  },

  // === COLLIMATOR ===
  collimator(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    const cx = 35;
    // Two jaws
    px(cx - 1, cy - 12, 2, 9, C.metal);
    px(cx - 1, cy + 4, 2, 9, C.metal);
    // Jaw tips
    dot(cx - 1, cy - 3, C.metalDk);
    dot(cx, cy - 3, C.metalDk);
    dot(cx - 1, cy + 3, C.metalDk);
    dot(cx, cy + 3, C.metalDk);
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
  },

  // === CRYOMODULE ===
  cryomodule(p, px, dot, W, H, cy, C) {
    const L = 6, R = 64;
    _drawBeamPipe(px, dot, W, cy, C, { skipFrom: L, skipTo: R });
    // Outer vacuum vessel
    px(L, cy - 12, R - L, 1, C.wall);
    px(L, cy + 12, R - L, 1, C.wall);
    px(L, cy - 12, 1, 25, C.wallHi);
    px(R, cy - 12, 1, 25, C.wallHi);
    // Thermal shield (80K)
    px(L + 2, cy - 10, R - L - 4, 1, '#886633');
    px(L + 2, cy + 10, R - L - 4, 1, '#886633');
    // Inner vessel (4K/2K)
    px(L + 4, cy - 8, R - L - 8, 1, C.scMagnet);
    px(L + 4, cy + 8, R - L - 8, 1, C.scMagnet);
    // SRF cavity cells inside
    const cells = 4;
    const cellW = (R - L - 10) / cells;
    for (let i = 0; i < cells; i++) {
      const cx2 = L + 5 + Math.floor(cellW * (i + 0.5));
      for (let dx = -Math.floor(cellW / 3); dx <= Math.floor(cellW / 3); dx++) {
        const t = Math.abs(dx) / (cellW / 3);
        const h = Math.round(5 * (1 - t * t));
        dot(cx2 + dx, cy - 2 - h, C.scMagDk);
        dot(cx2 + dx, cy + 2 + h, C.scMagDk);
      }
    }
    // Beam axis
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
  },

  // === SEXTUPOLE ===
  sextupole(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    const cx = 35;
    // Six pole tips at 60-degree intervals
    for (let i = 0; i < 6; i++) {
      const angle = i * Math.PI / 3 - Math.PI / 6;
      const pr = 9;
      const tipX = Math.round(cx + Math.cos(angle) * pr);
      const tipY = Math.round(cy + Math.sin(angle) * pr * 0.85);
      const color = i % 2 === 0 ? '#cc4444' : '#4444cc';
      px(tipX - 1, tipY - 1, 3, 3, color);
    }
    // Yoke ring
    for (let a = 0; a < Math.PI * 2; a += 0.2) {
      const rx = Math.round(cx + Math.cos(a) * 11);
      const ry = Math.round(cy + Math.sin(a) * 11 * 0.85);
      if (rx >= 2 && rx < W - 2 && ry >= 1 && ry < H - 1) dot(rx, ry, C.wallDk);
    }
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
  },

  // === DC PHOTO GUN ===
  dcPhotoGun(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C, { leftFlange: false });
    const cathX = 14, anodeX = 40;
    // Cathode plate
    for (let dy = -7; dy <= 7; dy++) {
      dot(cathX, cy + dy, C.metal);
      dot(cathX + 1, cy + dy, C.metalDk);
    }
    // Laser beam hitting cathode (from above-left)
    for (let i = 0; i < 10; i++) {
      dot(cathX - 8 + i, cy - 10 + i, '#44cc44');
    }
    dot(cathX, cy - 1, '#88ff88');
    dot(cathX, cy, '#88ff88');
    dot(cathX, cy + 1, '#88ff88');
    // Anode
    for (let dy = -9; dy <= 9; dy++) {
      if (Math.abs(dy) <= 2) continue;
      dot(anodeX, cy + dy, C.metal);
    }
    // HV insulator
    px(cathX - 4, cy - 9, 3, 19, '#443366');
    // Electron beam
    for (let x = cathX + 2; x < W - 4; x++) dot(x, cy, x < anodeX ? C.beamDim : C.beam);
  },

  // === NC RF GUN ===
  ncRfGun(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C, { leftFlange: false });
    const L = 12, R = 50;
    // Half-cell + full cell cavity
    px(L, cy - 9, 1, 19, C.wallHi);
    px(L, cy - 9, R - L, 1, C.wall);
    px(L, cy + 9, R - L, 1, C.wall);
    // Half cell
    for (let dx = 0; dx < 12; dx++) {
      const t = dx / 12;
      const h = Math.round(6 * Math.sin(t * Math.PI));
      dot(L + 1 + dx, cy - 3 - h, C.hot);
      dot(L + 1 + dx, cy + 3 + h, C.hot);
    }
    // Full cell
    for (let dx = 0; dx < 18; dx++) {
      const t = dx / 18;
      const h = Math.round(6 * Math.sin(t * Math.PI));
      dot(L + 14 + dx, cy - 3 - h, C.hot);
      dot(L + 14 + dx, cy + 3 + h, C.hot);
    }
    // Cathode plate
    for (let dy = -3; dy <= 3; dy++) dot(L + 1, cy + dy, C.hotBright);
    // Beam
    for (let x = L + 3; x < W - 4; x++) dot(x, cy, C.beam);
    // RF feed
    px(L + 20, cy - 9, 2, 4, C.coil);
  },

  // === SRF GUN ===
  srfGun(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C, { leftFlange: false });
    const L = 12, R = 52;
    // SRF cavity shape (rounder)
    for (let dx = 0; dx < R - L; dx++) {
      const t = dx / (R - L);
      const h = Math.round(8 * Math.sin(t * Math.PI));
      dot(L + dx, cy - 2 - h, C.scMagnet);
      dot(L + dx, cy + 2 + h, C.scMagnet);
    }
    // Outer cryostat
    px(L - 2, cy - 12, R - L + 4, 1, C.wallDk);
    px(L - 2, cy + 12, R - L + 4, 1, C.wallDk);
    // Cathode
    for (let dy = -2; dy <= 2; dy++) dot(L + 1, cy + dy, C.hotBright);
    // Beam
    for (let x = L + 3; x < W - 4; x++) dot(x, cy, C.beam);
    // Cryo indicator
    dot(R - 4, cy - 10, C.scMagnet);
    dot(R - 3, cy - 10, C.scMagDk);
  },

  // === CORRECTOR ===
  corrector(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    const cx = 35;
    // Small H/V corrector coils
    px(cx - 5, cy - 7, 3, 4, '#cc6644');
    px(cx + 3, cy - 7, 3, 4, '#cc6644');
    px(cx - 5, cy + 4, 3, 4, '#4466cc');
    px(cx + 3, cy + 4, 3, 4, '#4466cc');
    // Correction arrows
    dot(cx, cy - 5, '#ffaa44');
    dot(cx, cy - 6, '#ffaa44');
    dot(cx - 1, cy - 5, '#ffaa44');
    dot(cx + 1, cy - 5, '#ffaa44');
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
  },

  // === OCTUPOLE ===
  octupole(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    const cx = 35;
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      const pr = 9;
      const tipX = Math.round(cx + Math.cos(angle) * pr);
      const tipY = Math.round(cy + Math.sin(angle) * pr * 0.85);
      const color = i % 2 === 0 ? '#cc4444' : '#4444cc';
      px(tipX - 1, tipY - 1, 2, 2, color);
    }
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
  },

  // === SC QUAD ===
  scQuad(p, px, dot, W, H, cy, C, params) {
    _drawBeamPipe(px, dot, W, cy, C);
    const cx = 35;
    // Superconducting quad — like quad but with cryo layer
    for (let a = 0; a < Math.PI * 2; a += 0.2) {
      const rx = Math.round(cx + Math.cos(a) * 12);
      const ry = Math.round(cy + Math.sin(a) * 12 * 0.85);
      if (rx >= 2 && rx < W - 2 && ry >= 1 && ry < H - 1) dot(rx, ry, C.scMagDk);
    }
    px(cx - 8, cy - 11, 16, 4, C.scMagnet);
    px(cx - 5, cy - 7, 10, 3, C.scMagDk);
    px(cx - 8, cy + 7, 16, 4, C.scMagnet);
    px(cx - 5, cy + 5, 10, 3, C.scMagDk);
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);

    // Polarity arrows (same layout as normal quad)
    const polarity = params?.polarity;
    const ax = cx + 12;
    if (polarity === 0 || polarity == null) {
      const col = '#ff4466';
      dot(ax, cy - 8, col);
      dot(ax, cy - 9, col);
      dot(ax, cy - 10, col);
      dot(ax - 1, cy - 8, col);
      dot(ax + 1, cy - 8, col);
      dot(ax, cy + 8, col);
      dot(ax, cy + 9, col);
      dot(ax, cy + 10, col);
      dot(ax - 1, cy + 8, col);
      dot(ax + 1, cy + 8, col);
    }
    if (polarity === 1 || polarity == null) {
      const col = '#4488ff';
      const yOff = polarity == null ? 6 : 0;
      dot(ax - 3, cy - yOff, col);
      dot(ax - 2, cy - yOff, col);
      dot(ax - 1, cy - yOff, col);
      dot(ax - 1, cy - yOff - 1, col);
      dot(ax - 1, cy - yOff + 1, col);
      dot(ax + 3, cy + yOff, col);
      dot(ax + 2, cy + yOff, col);
      dot(ax + 1, cy + yOff, col);
      dot(ax + 1, cy + yOff - 1, col);
      dot(ax + 1, cy + yOff + 1, col);
    }
  },

  // === SC DIPOLE ===
  scDipole(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    const L = 16, R = 54, T = cy - 12, B = cy + 12;
    px(L, T, R - L, 2, C.scMagnet);
    px(L, B - 1, R - L, 2, C.scMagnet);
    px(L, T, 2, B - T + 1, C.scMagDk);
    px(L + 2, T + 2, R - L - 2, 2, C.scMagDk);
    px(L + 2, B - 3, R - L - 2, 2, C.scMagDk);
    px(L + 6, cy - 3, R - L - 6, 7, '#0d0d22');
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
  },

  // === COMBINED FUNCTION MAGNET ===
  combinedFunctionMagnet(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    const L = 14, R = 56, T = cy - 11, B = cy + 11;
    px(L, T, R - L, 2, C.magnet);
    px(L, B - 1, R - L, 2, C.magnet);
    px(L, T, 2, B - T + 1, C.wallHi);
    // Gradient shading (combined function = dipole + quad)
    for (let x = L + 3; x < R - 1; x++) {
      const t = (x - L) / (R - L);
      const shade = Math.round(t * 3);
      dot(x, T + 3, shade > 1 ? C.magnetLt : C.magnetDk);
      dot(x, B - 3, shade > 1 ? C.magnetDk : C.magnetLt);
    }
    px(L + 3, cy - 3, R - L - 4, 7, '#0d0d22');
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
  },

  // === BPM ===
  bpm(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    const cx = 35;
    // Buttons
    px(cx - 1, cy - 6, 3, 2, '#ccaa44');
    px(cx - 1, cy + 5, 3, 2, '#ccaa44');
    px(cx - 7, cy - 1, 2, 3, '#ccaa44');
    px(cx + 6, cy - 1, 2, 3, '#ccaa44');
    // Signal wires
    dot(cx, cy - 8, C.coil);
    dot(cx, cy + 7, C.coil);
    dot(cx - 9, cy, C.coil);
    dot(cx + 8, cy, C.coil);
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
  },

  // === SCREEN ===
  screen(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    // Solid beam line
    px(FLANGE_W + 2, cy, W - 2 * FLANGE_W - 4, 1, C.beam);
    const cx = 35;
    // Insertable phosphor screen (angled)
    for (let i = -8; i <= 8; i++) {
      const sx = cx + Math.round(i * 0.3);
      dot(sx, cy + i, '#44cc88');
      dot(sx + 1, cy + i, '#338866');
    }
    // Actuator rod going up
    px(cx - 1, cy - 12, 2, 4, C.metal);
    // Glow when beam hits screen
    dot(cx, cy, '#88ffaa');
    dot(cx + 1, cy, '#88ffaa');
    dot(cx - 1, cy - 1, '#66cc88');
    dot(cx + 1, cy + 1, '#66cc88');
  },

  // === ICT ===
  ict(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    const cx = 35;
    // Toroidal transformer ring
    for (let a = 0; a < Math.PI * 2; a += 0.15) {
      const rx = Math.round(cx + Math.cos(a) * 8);
      const ry = Math.round(cy + Math.sin(a) * 8 * 0.7);
      dot(rx, ry, C.coil);
    }
    for (let a = 0; a < Math.PI * 2; a += 0.2) {
      const rx = Math.round(cx + Math.cos(a) * 6);
      const ry = Math.round(cy + Math.sin(a) * 6 * 0.7);
      dot(rx, ry, C.coilDk);
    }
    // Beam through center
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
    // Signal cable
    px(cx + 8, cy - 8, 1, 4, C.coil);
  },

  // === WIRE SCANNER ===
  wireScanner(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    const cx = 35;
    // Wire crossing beam
    for (let i = -6; i <= 6; i++) {
      dot(cx + Math.round(i * 0.4), cy + i, C.metal);
    }
    // Fork mount
    px(cx - 4, cy - 10, 2, 5, C.metalDk);
    px(cx + 3, cy - 10, 2, 5, C.metalDk);
    px(cx - 4, cy - 11, 10, 1, C.metal);
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
  },

  // === BUNCH LENGTH MONITOR ===
  bunchLengthMonitor(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
    // Streak display — pulse shape above
    const baseY = cy - 8;
    for (let x = 20; x < 50; x++) {
      const t = (x - 20) / 30;
      const h = Math.round(5 * Math.exp(-((t - 0.5) * (t - 0.5)) / 0.02));
      for (let dy = 0; dy < h; dy++) {
        dot(x, baseY - dy, '#44ccaa');
      }
    }
  },

  // === ENERGY SPECTROMETER ===
  energySpectrometer(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    // Bending magnet section
    px(20, cy - 10, 20, 3, C.magnetDk);
    px(20, cy + 8, 20, 3, C.magnetDk);
    // Beam bends through dipole
    for (let x = 4; x < 20; x++) dot(x, cy, C.beam);
    for (let x = 20; x < 40; x++) {
      const t = (x - 20) / 20;
      const bend = Math.round(t * t * 5);
      dot(x, cy - bend, C.beam);
      dot(x, cy - bend + 1, C.beamDim);
      dot(x, cy - bend - 1, C.beamDim);
    }
    // Detector screen
    px(45, cy - 12, 2, 20, '#44cc88');
    // Energy spread marks
    dot(46, cy - 8, '#ff4444');
    dot(46, cy - 5, '#44ff44');
    dot(46, cy - 2, '#4444ff');
  },

  // === BEAM LOSS MONITOR ===
  beamLossMonitor(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    const cx = 35;
    // Ionization chamber
    px(cx - 4, cy - 8, 8, 16, C.metalDk);
    px(cx - 3, cy - 7, 6, 14, '#1a1a33');
    // Electrodes inside
    px(cx - 2, cy - 6, 1, 12, '#ccaa44');
    px(cx + 2, cy - 6, 1, 12, '#ccaa44');
    // Cable out
    px(cx, cy - 8, 1, -4, C.coil);
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
    // Radiation particles hitting detector
    dot(cx - 1, cy - 4, C.glow);
    dot(cx + 1, cy + 2, C.glow);
  },

  // === SR LIGHT MONITOR ===
  srLightMonitor(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
    // Viewport window
    px(34, cy - 3, 3, 1, '#446688');
    // Light cone going up to detector
    for (let i = 1; i <= 8; i++) {
      const spread = Math.round(i * 0.5);
      for (let dx = -spread; dx <= spread; dx++) {
        dot(35 + dx, cy - 3 - i, '#ffdd44');
      }
    }
    // Detector/camera
    px(32, cy - 13, 7, 2, C.metal);
  },

  // === HELICAL UNDULATOR ===
  helicalUndulator(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    const L = 8, R = 62;
    const nBlocks = 8;
    const step = (R - L) / nBlocks;
    for (let i = 0; i < nBlocks; i++) {
      const x = L + Math.floor(i * step);
      const w = Math.max(1, Math.floor(step) - 1);
      // Rotated poles for helical field
      px(x, cy - 10, w, 3, i % 2 === 0 ? '#cc4444' : '#4444cc');
      px(x, cy + 8, w, 3, i % 2 === 0 ? '#4444cc' : '#cc4444');
      // Side poles (rotated 90 deg)
      if (i % 2 === 0) {
        dot(x, cy - 5, '#cc44cc');
        dot(x, cy + 5, '#44cccc');
      }
    }
    // Helical beam
    for (let x = 4; x < W - 4; x++) {
      const phase = (x - L) / (R - L) * nBlocks * Math.PI;
      const dy = Math.round(Math.sin(phase) * 2);
      dot(x, cy + dy, C.beam);
    }
  },

  // === WIGGLER ===
  wiggler(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    const L = 10, R = 60;
    const nBlocks = 5;
    const step = (R - L) / nBlocks;
    for (let i = 0; i < nBlocks; i++) {
      const x = L + Math.floor(i * step);
      const w = Math.max(2, Math.floor(step) - 1);
      px(x, cy - 11, w, 5, i % 2 === 0 ? '#cc4444' : '#4444cc');
      px(x, cy + 7, w, 5, i % 2 === 0 ? '#4444cc' : '#cc4444');
    }
    // Larger amplitude oscillation
    for (let x = 4; x < W - 4; x++) {
      const phase = (x - L) / (R - L) * nBlocks * Math.PI;
      const dy = Math.round(Math.sin(phase) * 3);
      dot(x, cy + dy, C.beam);
    }
    // Broad radiation fan
    for (let dy = -4; dy <= 4; dy++) {
      dot(R + 2, cy + dy, '#ffdd44');
      if (Math.abs(dy) < 3) dot(R + 3, cy + dy, '#ffdd44');
    }
  },

  // === APPLE-2 UNDULATOR ===
  apple2Undulator(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    const L = 8, R = 62;
    const nBlocks = 6;
    const step = (R - L) / nBlocks;
    for (let i = 0; i < nBlocks; i++) {
      const x = L + Math.floor(i * step);
      const w = Math.max(1, Math.floor(step) - 2);
      // Four magnet arrays (APPLE-II has 4 movable rows)
      px(x, cy - 10, w, 2, '#cc4444');
      px(x + 1, cy - 8, w, 2, '#cc44cc');
      px(x, cy + 7, w, 2, '#4444cc');
      px(x + 1, cy + 9, w, 2, '#44cccc');
    }
    for (let x = 4; x < W - 4; x++) {
      const phase = (x - L) / (R - L) * nBlocks * Math.PI;
      dot(x, cy + Math.round(Math.sin(phase) * 2), C.beam);
    }
  },

  // === KICKER MAGNET ===
  kickerMagnet(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    const L = 18, R = 52;
    px(L, cy - 8, R - L, 2, C.magnet);
    px(L, cy + 7, R - L, 2, C.magnet);
    // Fast pulsed coils
    px(L + 2, cy - 6, 3, 3, C.coil);
    px(R - 5, cy - 6, 3, 3, C.coil);
    px(L + 2, cy + 4, 3, 3, C.coil);
    px(R - 5, cy + 4, 3, 3, C.coil);
    // HV pulser symbol (lightning)
    dot(L + 10, cy - 7, C.hotBright);
    dot(L + 11, cy - 6, C.hot);
    dot(L + 10, cy - 5, C.hotBright);
    dot(L + 11, cy - 4, C.hot);
    // Beam kicked
    for (let x = 4; x < 30; x++) dot(x, cy, C.beam);
    for (let x = 30; x < W - 4; x++) {
      const t = (x - 30) / (W - 34);
      dot(x, cy - Math.round(t * 4), C.beam);
    }
  },

  // === FAST KICKER ===
  // Identity is the pulse-forming network, not the magnet: a tiny ferrite
  // window-frame aperture fed by fat coaxial pulse cables from a big rack.
  fastKicker(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    const ferrite = '#6a5a7a', ferriteDk = '#443355';
    const cabL = 2, cabR = 32;
    // Pulse-forming-network racks — stacked above and below the line so the
    // beam pipe stays clear while the cabinet still dwarfs the magnet
    for (const sgn of [-1, 1]) {
      const top = sgn < 0 ? cy - 14 : cy + 6;
      px(cabL, top, cabR - cabL, 9, C.metalDk);
      px(cabL + 1, top + 1, cabR - cabL - 2, 7, '#1a1f2a');
      // PFN capacitor stack
      for (let i = 0; i < 5; i++) {
        const rx = cabL + 3 + i * 5;
        px(rx, top + 2, 3, 5, C.wallDk);
        px(rx, top + 3, 3, 1, C.wall);
      }
      // Inductor bus tying the stack together
      for (let x = cabL + 3; x < cabR - 3; x += 2) dot(x, top + 7, C.coilDk);
      // Thyratron switch — the hot element of the rack
      px(cabR - 4, top + 2, 2, 5, C.hot);
      dot(cabR - 4, top + 4, C.hotBright);
    }

    const magL = 46, magR = 60;
    // Thick coaxial pulse cables: braid sheath with a bright inner conductor
    for (const sgn of [-1, 1]) {
      for (let x = cabR; x <= magL + 1; x++) {
        const t = (x - cabR) / (magL + 1 - cabR);
        const y = cy + sgn * Math.round(9 - 4 * t * t);
        px(x, y - 1, 1, 3, '#33404f');
        dot(x, y, '#e8b45a');
      }
    }
    // Ferrite window-frame magnet (small)
    px(magL, cy - 7, magR - magL, 15, ferriteDk);
    px(magL, cy - 7, magR - magL, 1, ferrite);
    px(magL, cy + 7, magR - magL, 1, ferrite);
    px(magL + 2, cy - 4, magR - magL - 4, 9, C.bg);
    // Deflecting plates inside the window
    px(magL + 2, cy - 5, magR - magL - 4, 1, C.metal);
    px(magL + 2, cy + 5, magR - magL - 4, 1, C.metal);
    // Beam kicked out on the downstream side
    for (let x = 2; x < magR; x++) dot(x, cy, C.beam);
    for (let x = magR; x < W - 2; x++) {
      dot(x, cy - Math.round((x - magR) / (W - 2 - magR) * 4), C.beam);
    }
  },

  // === SEPTUM MAGNET ===
  septumMagnet(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    const cx = 35;
    // Thin septum wall
    px(cx, cy - 10, 1, 21, C.metal);
    px(cx + 1, cy - 10, 1, 21, C.metalDk);
    // Magnet yoke on one side
    px(cx + 2, cy - 8, 10, 2, C.magnet);
    px(cx + 2, cy + 7, 10, 2, C.magnet);
    px(cx + 2, cy - 8, 2, 17, C.magnetDk);
    // Two beam paths on either side
    for (let x = 4; x < cx; x++) dot(x, cy - 4, C.beam);
    for (let x = 4; x < cx; x++) dot(x, cy + 4, C.beamDim);
    for (let x = cx + 2; x < W - 4; x++) dot(x, cy - 4, C.beam);
    for (let x = cx + 2; x < W - 4; x++) dot(x, cy + 4, C.beamDim);
  },

  // === CHICANE ===
  chicane(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    // Four-dipole chicane for bunch compression
    const dipoles = [14, 26, 38, 50];
    for (const dx of dipoles) {
      px(dx, cy - 6, 4, 3, C.magnet);
      px(dx, cy + 4, 4, 3, C.magnet);
    }
    // Beam path through chicane
    for (let x = 4; x < 14; x++) dot(x, cy, C.beam);
    for (let x = 14; x < 26; x++) {
      const t = (x - 14) / 12;
      dot(x, cy - Math.round(t * 5), C.beam);
    }
    for (let x = 26; x < 38; x++) dot(x, cy - 5, C.beam);
    for (let x = 38; x < 50; x++) {
      const t = (x - 38) / 12;
      dot(x, cy - 5 + Math.round(t * 5), C.beam);
    }
    for (let x = 50; x < W - 4; x++) dot(x, cy, C.beam);
  },

  // === DOGLEG ===
  dogleg(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    const d1 = 20, d2 = 44;
    px(d1, cy - 6, 4, 3, C.magnet);
    px(d1, cy + 4, 4, 3, C.magnet);
    px(d2, cy - 11, 4, 3, C.magnet);
    px(d2, cy - 1, 4, 3, C.magnet);
    for (let x = 4; x < d1; x++) dot(x, cy, C.beam);
    for (let x = d1; x < d2; x++) {
      const t = (x - d1) / (d2 - d1);
      dot(x, cy - Math.round(t * 6), C.beam);
    }
    for (let x = d2; x < W - 4; x++) dot(x, cy - 6, C.beam);
  },

  // === RECIRCULATION ARC ===
  // The pipe splits, arcs laterally away from the straight-through leg and
  // rejoins it; small dipoles bend the recirculated beam around.
  recirculationArc(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    // Shallow enough that the channel never breaks into a staircase
    const sx = 8, ex = 62;
    const arcY = (x) => cy - Math.round(9 * Math.sin(Math.PI * (x - sx) / (ex - sx)));
    // Straight-through leg
    for (let x = 2; x < W - 2; x++) dot(x, cy, C.beamDim);
    // Arc channel walls plus the recirculated beam
    for (let x = sx; x <= ex; x++) {
      const y = arcY(x);
      if (y < cy - 1) {
        dot(x, y - 2, C.wallDk);
        dot(x, y + 2, C.wallDk);
      }
      dot(x, y, C.beam);
    }
    // Splitter and recombiner septa
    for (let dy = -2; dy <= 2; dy++) {
      dot(sx, cy + dy, C.metal);
      dot(ex, cy + dy, C.metal);
    }
    // Small dipoles along the arc, kept clear of the straight-through leg
    for (const t of [0.28, 0.39, 0.5, 0.61, 0.72]) {
      const x = Math.round(sx + t * (ex - sx));
      const y = arcY(x);
      px(x - 1, y - 5, 3, 2, C.magnet);
      px(x - 1, y + 4, 3, 2, C.magnet);
    }
  },

  // === FINAL FOCUS DOUBLET ===
  // Two SC quads back-to-back at different apertures in one cryostat, with a
  // conical taper running down to the interaction point at the right edge.
  finalFocusDoublet(p, px, dot, W, H, cy, C) {
    const L = 3, R = 56;
    _drawBeamPipe(px, dot, W, cy, C, { skipFrom: L, skipTo: W, rightFlange: false });
    // Shared cryostat
    px(L, cy - 13, R - L, 1, C.wall);
    px(L, cy + 13, R - L, 1, C.wall);
    px(L, cy - 13, 1, 27, C.wallHi);
    px(L + 2, cy - 11, R - L - 4, 1, C.scMagDk);
    px(L + 2, cy + 11, R - L - 4, 1, C.scMagDk);
    // Q1 — the large-aperture quad
    const q1 = 18;
    px(q1 - 10, cy - 10, 20, 5, C.scMagnet);
    px(q1 - 7, cy - 6, 14, 2, C.scMagDk);
    px(q1 - 10, cy + 6, 20, 5, C.scMagnet);
    px(q1 - 7, cy + 5, 14, 2, C.scMagDk);
    // Q2 — poles reach further in, so a visibly tighter aperture
    const q2 = 42;
    px(q2 - 9, cy - 10, 18, 6, C.scMagnet);
    px(q2 - 6, cy - 4, 12, 2, C.scMagDk);
    px(q2 - 9, cy + 5, 18, 6, C.scMagnet);
    px(q2 - 6, cy + 3, 12, 2, C.scMagDk);
    // Conical taper toward the IP
    for (let x = R; x < W - 1; x++) {
      const h = Math.round(9 - 7 * (x - R) / (W - 1 - R));
      dot(x, cy - h, C.metal);
      dot(x, cy + h, C.metal);
    }
    // Beam envelope converging onto the IP
    for (let x = 2; x < W - 1; x++) {
      const hw = Math.round(4 * (1 - Math.max(0, (x - 6) / (W - 8))));
      if (hw > 0) {
        dot(x, cy - hw, C.beamDim);
        dot(x, cy + hw, C.beamDim);
      }
      dot(x, cy, C.beam);
    }
    dot(W - 2, cy, '#ffffff');
  },

  // === STRIPPER FOIL ===
  stripperFoil(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    const cx = 35;
    // Thin foil
    px(cx, cy - 8, 1, 17, '#ccaa44');
    px(cx + 1, cy - 8, 1, 17, '#aa8833');
    // Beam in
    for (let x = 4; x < cx; x++) dot(x, cy, C.beam);
    // Multiple charge states out
    for (let x = cx + 2; x < W - 4; x++) {
      dot(x, cy, C.beam);
      dot(x, cy - 2, C.beamDim);
      dot(x, cy + 2, C.beamDim);
    }
    // Scattered electrons
    dot(cx + 4, cy - 5, '#ff6644');
    dot(cx + 6, cy - 7, '#ff6644');
    dot(cx + 3, cy + 4, '#ff6644');
  },

  // === FIXED TARGET (Advanced) ===
  fixedTargetAdv(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C, { rightFlange: false });
    const cx = 30;
    // Target block
    px(cx, cy - 6, 4, 13, C.metalDk);
    px(cx + 1, cy - 5, 2, 11, C.metal);
    // Beam in
    for (let x = 4; x < cx; x++) dot(x, cy, C.beam);
    // Collision products spraying out
    for (let i = 0; i < 8; i++) {
      const angle = (i - 4) * 0.4;
      for (let r = 1; r < 12; r++) {
        const px2 = cx + 4 + Math.round(Math.cos(angle) * r);
        const py = cy + Math.round(Math.sin(angle) * r);
        if (px2 < W - 2 && py >= 1 && py < H - 1) {
          dot(px2, py, r < 4 ? C.hotBright : C.beamDim);
        }
      }
    }
  },

  // === PHOTON PORT ===
  photonPort(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
    // Viewport/window
    px(33, cy - 3, 4, 1, '#446688');
    // Photon beam going up
    for (let i = 1; i <= 10; i++) {
      const spread = Math.round(i * 0.3);
      for (let dx = -spread; dx <= spread; dx++) {
        const c = Math.abs(dx) < spread ? '#ffee44' : '#ccaa22';
        dot(35 + dx, cy - 3 - i, c);
      }
    }
  },

  // === POSITRON TARGET ===
  positronTarget(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C, { rightFlange: false });
    const cx = 30;
    // Converter target
    px(cx, cy - 5, 3, 11, C.metalDk);
    // Beam in
    for (let x = 4; x < cx; x++) dot(x, cy, C.beam);
    // e+ going up, e- going down
    for (let x = cx + 3; x < W - 4; x++) {
      const t = (x - cx - 3) / (W - cx - 7);
      dot(x, cy - Math.round(t * 6), '#ff4444'); // e+
      dot(x, cy + Math.round(t * 6), '#4444ff'); // e-
    }
    // Photon flash at target
    dot(cx + 1, cy, C.hotBright);
    dot(cx + 1, cy - 1, C.hot);
    dot(cx + 1, cy + 1, C.hot);
  },

  // === COMPTON IP ===
  comptonIP(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
    // Laser beam crossing vertically
    for (let y = 2; y < H - 2; y++) {
      dot(35, y, '#ff4444');
      if (y === cy) dot(35, y, '#ffffff'); // interaction point
    }
    // Scattered photons
    dot(38, cy - 4, '#ffdd44');
    dot(40, cy - 6, '#ffdd44');
    dot(37, cy - 3, '#ffdd44');
  },

  // === PILLBOX CAVITY ===
  pillboxCavity(p, px, dot, W, H, cy, C) {
    const L = 18, R = 52;
    _drawBeamPipe(px, dot, W, cy, C, { skipFrom: L, skipTo: R });
    px(L, cy - 8, R - L, 1, C.wall);
    px(L, cy + 8, R - L, 1, C.wall);
    px(L, cy - 8, 1, 17, C.wallHi);
    px(R, cy - 8, 1, 17, C.wallHi);
    // Simple cylindrical shape
    px(L + 1, cy - 7, R - L - 2, 15, '#1a0d0d');
    // RF field
    for (let dy = -5; dy <= 5; dy++) {
      dot(35, cy + dy, C.hot);
    }
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
  },

  // === RFQ ===
  rfq(p, px, dot, W, H, cy, C) {
    const L = 10, R = 60;
    _drawBeamPipe(px, dot, W, cy, C, { skipFrom: L, skipTo: R });
    px(L, cy - 10, R - L, 1, C.wall);
    px(L, cy + 10, R - L, 1, C.wall);
    px(L, cy - 10, 1, 21, C.wallHi);
    px(R, cy - 10, 1, 21, C.wallHi);
    // Four vanes converging
    for (let x = L + 2; x < R - 1; x += 2) {
      const mod = Math.sin((x - L) * 0.4) * 2;
      dot(x, cy - 4 + Math.round(mod), C.hot);
      dot(x, cy + 4 - Math.round(mod), C.hot);
      dot(x, cy - 7, C.metal);
      dot(x, cy + 7, C.metal);
    }
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
  },

  // === DTL ===
  dtl(p, px, dot, W, H, cy, C) {
    const L = 8, R = 62;
    _drawBeamPipe(px, dot, W, cy, C, { skipFrom: L, skipTo: R });
    px(L, cy - 10, R - L, 1, C.wall);
    px(L, cy + 10, R - L, 1, C.wall);
    px(L, cy - 10, 1, 21, C.wallHi);
    px(R, cy - 10, 1, 21, C.wallHi);
    // Drift tubes inside tank
    const nTubes = 5;
    const step = (R - L - 4) / nTubes;
    for (let i = 0; i < nTubes; i++) {
      const tx = L + 2 + Math.floor(i * step);
      const tw = Math.floor(step * 0.6);
      px(tx, cy - 4, tw, 9, C.metal);
      px(tx + 1, cy - 3, tw - 2, 7, C.metalDk);
      // Stem
      px(tx + Math.floor(tw / 2), cy - 9, 1, 5, C.metal);
    }
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
  },

  // === DTL CAVITY ===
  dtlCavity(p, px, dot, W, H, cy, C) {
    const L = 10, R = 60;
    _drawBeamPipe(px, dot, W, cy, C, { skipFrom: L, skipTo: R });
    px(L, cy - 9, R - L, 1, C.wall);
    px(L, cy + 9, R - L, 1, C.wall);
    px(L, cy - 9, 1, 19, C.wallHi);
    px(R, cy - 9, 1, 19, C.wallHi);
    const nTubes = 4;
    const step = (R - L - 4) / nTubes;
    for (let i = 0; i < nTubes; i++) {
      const tx = L + 2 + Math.floor(i * step);
      const tw = Math.floor(step * 0.5);
      px(tx, cy - 3, tw, 7, C.metal);
      px(tx + Math.floor(tw / 2), cy - 8, 1, 5, C.metal);
    }
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
  },

  // === BUNCHER ===
  buncher(p, px, dot, W, H, cy, C) {
    const L = 18, R = 52;
    _drawBeamPipe(px, dot, W, cy, C, { skipFrom: L, skipTo: R });
    px(L, cy - 7, R - L, 1, C.wall);
    px(L, cy + 7, R - L, 1, C.wall);
    px(L, cy - 7, 1, 15, C.wallHi);
    px(R, cy - 7, 1, 15, C.wallHi);
    // Single cell cavity
    for (let dx = 2; dx < R - L - 2; dx++) {
      const t = dx / (R - L - 4);
      const h = Math.round(4 * Math.sin(t * Math.PI));
      dot(L + dx, cy - 2 - h, C.hot);
      dot(L + dx, cy + 2 + h, C.hot);
    }
    // Beam: spread dots becoming bunched
    for (let x = 4; x < L; x += 2) dot(x, cy, C.beamDim);
    for (let x = R; x < W - 4; x++) {
      if (x % 4 < 2) dot(x, cy, C.beam);
    }
    for (let x = L; x < R; x++) dot(x, cy, C.beamDim);
  },

  // === HARMONIC LINEARIZER ===
  harmonicLinearizer(p, px, dot, W, H, cy, C) {
    const L = 14, R = 56;
    _drawBeamPipe(px, dot, W, cy, C, { skipFrom: L, skipTo: R });
    px(L, cy - 8, R - L, 1, C.wall);
    px(L, cy + 8, R - L, 1, C.wall);
    px(L, cy - 8, 1, 17, C.wallHi);
    px(R, cy - 8, 1, 17, C.wallHi);
    // Higher harmonic cavity cells (smaller, more frequent)
    const cells = 5;
    const cellW = (R - L - 2) / cells;
    for (let i = 0; i < cells; i++) {
      const cx2 = L + 1 + Math.floor(cellW * (i + 0.5));
      for (let dx = -2; dx <= 2; dx++) {
        const t = Math.abs(dx) / 3;
        const h = Math.round(4 * (1 - t * t));
        dot(cx2 + dx, cy - 2 - h, C.hot);
        dot(cx2 + dx, cy + 2 + h, C.hot);
      }
    }
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
  },

  // === S-BAND STRUCTURE ===
  sbandStructure(p, px, dot, W, H, cy, C) {
    const L = 8, R = 62;
    _drawBeamPipe(px, dot, W, cy, C, { skipFrom: L, skipTo: R });
    px(L, cy - 9, R - L, 1, C.wall);
    px(L, cy + 9, R - L, 1, C.wall);
    px(L, cy - 9, 1, 19, C.wallHi);
    px(R, cy - 9, 1, 19, C.wallHi);
    // Traveling wave structure — many small cells
    for (let x = L + 2; x < R - 1; x += 3) {
      dot(x, cy - 6, C.hot);
      dot(x, cy + 6, C.hot);
      dot(x, cy - 3, C.wallDk);
      dot(x, cy + 3, C.wallDk);
    }
    // RF coupler ports
    px(L + 4, cy - 9, 2, 3, C.coil);
    px(R - 6, cy - 9, 2, 3, C.coil);
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
  },

  // === C-BAND STRUCTURE ===
  // Copper disc-loaded waveguide, cell pitch a step finer than S-band, one
  // waveguide feed and a water manifold along the top.
  cbandStructure(p, px, dot, W, H, cy, C) {
    const L = 6, R = 64;
    _drawBeamPipe(px, dot, W, cy, C, { skipFrom: L, skipTo: R });
    // Copper body
    px(L, cy - 8, R - L, 17, '#4a2a1a');
    px(L, cy - 8, R - L, 1, C.coil);
    px(L, cy + 8, R - L, 1, C.coil);
    px(L, cy - 8, 1, 17, C.coilDk);
    px(R - 1, cy - 8, 1, 17, C.coilDk);
    // Loading discs on a 3px pitch — denser than S-band's, coarser than X-band's
    for (let x = L + 2; x < R - 1; x += 3) {
      px(x, cy - 7, 1, 4, C.coil);
      px(x, cy + 4, 1, 4, C.coil);
      dot(x, cy - 3, C.coilDk);
      dot(x, cy + 3, C.coilDk);
    }
    // Water manifold along the top, with drops into the body
    px(L, cy - 14, R - L, 2, C.pipeCooling);
    for (let x = L + 8; x < R - 4; x += 12) px(x, cy - 12, 1, 4, C.pipeCooling);
    // Single waveguide feed
    px(24, cy - 12, 8, 4, C.metalDk);
    px(25, cy - 11, 6, 2, C.hot);
    px(27, cy - 9, 2, 2, C.metal);
    for (let x = 2; x < W - 2; x++) dot(x, cy, C.beam);
  },

  // === X-BAND STRUCTURE ===
  // Finest cell pitch on the ladder and the smallest bore, with waveguide
  // manifolds above and below — reads as a dense copper comb.
  xbandStructure(p, px, dot, W, H, cy, C) {
    const L = 6, R = 64;
    _drawBeamPipe(px, dot, W, cy, C, { skipFrom: L, skipTo: R });
    // Copper body — shallower than C-band
    px(L, cy - 7, R - L, 15, '#4a2a1a');
    px(L, cy - 7, R - L, 1, C.coil);
    px(L, cy + 7, R - L, 1, C.coil);
    // Comb of loading discs every other column, leaving a ±2 bore
    for (let x = L + 1; x < R - 1; x += 2) {
      px(x, cy - 6, 1, 4, C.coil);
      px(x, cy + 3, 1, 4, C.coil);
    }
    for (let x = L + 2; x < R - 1; x += 2) {
      dot(x, cy - 6, C.coilDk);
      dot(x, cy + 6, C.coilDk);
    }
    // Waveguide manifolds above and below, each feeding the body
    for (const sgn of [-1, 1]) {
      const my = cy + sgn * 11;
      px(L + 2, my - 1, R - L - 4, 3, C.metalDk);
      for (let x = L + 4; x < R - 4; x += 4) dot(x, my, C.hot);
      for (const fx of [18, 34, 50]) px(fx, cy + sgn * 8, 2, 2, C.metal);
    }
    // Water headers on both sides
    px(L, cy - 14, R - L, 1, C.pipeCooling);
    px(L, cy + 14, R - L, 1, C.pipeCooling);
    for (let x = 2; x < W - 2; x++) dot(x, cy, C.beam);
  },

  // === TWO-BEAM MODULE ===
  // The doubled axis is the identity: a drive line above feeding PETS
  // decelerators, which power the main accelerating structures below.
  twoBeamModule(p, px, dot, W, H, cy, C) {
    // The shared background beam dash sits on neither axis here
    px(0, cy - 1, W, 3, C.bg);
    const dy = cy - 8, my = cy + 7;
    for (const [ay, wallC] of [[dy, C.wallDk], [my, C.wallDk]]) {
      px(0, ay - 3, W, 1, wallC);
      px(0, ay + 3, W, 1, wallC);
      px(0, ay - 5, FLANGE_W, 11, C.metal);
      px(W - FLANGE_W, ay - 5, FLANGE_W, 11, C.metal);
    }
    const stations = [10, 30, 50];
    for (const sx of stations) {
      // PETS decelerator on the drive line
      px(sx, dy - 4, 14, 9, C.coilDk);
      px(sx + 1, dy - 3, 12, 7, '#4a2a1a');
      for (let x = sx + 2; x < sx + 13; x += 2) {
        dot(x, dy - 2, C.coil);
        dot(x, dy + 2, C.coil);
      }
      // Accelerating structure on the main line
      px(sx, my - 4, 14, 9, C.metalDk);
      px(sx + 1, my - 3, 12, 7, '#3a2418');
      for (let x = sx + 2; x < sx + 13; x += 2) {
        dot(x, my - 2, C.hot);
        dot(x, my + 2, C.hot);
      }
      // RF power transfer waveguide between the two lines
      px(sx + 6, dy + 5, 3, my - dy - 9, C.metal);
      dot(sx + 7, my - 5, C.hotBright);
    }
    // Drive beam above (dim, being decelerated), main beam below
    for (let x = 2; x < W - 2; x++) {
      dot(x, dy, C.beamDim);
      dot(x, my, C.beam);
    }
  },

  // === PLASMA AFTERBURNER ===
  // A short capillary cell overshadowed by its laser hall: enclosure, turning
  // mirror, drive beam down the axis. Deliberately no RF hardware anywhere.
  plasmaAfterburner(p, px, dot, W, H, cy, C) {
    const capL = 38, capR = 53;
    _drawBeamPipe(px, dot, W, cy, C, { skipFrom: capL, skipTo: capR + 1 });
    // Laser enclosure — the dominant structure
    px(2, cy - 14, 24, 10, C.metalDk);
    px(3, cy - 13, 22, 8, '#1a0d0d');
    px(7, cy - 10, 14, 3, '#882244');
    px(5, cy - 11, 1, 5, '#ccaa44');
    px(23, cy - 11, 1, 5, C.metal);
    px(10, cy - 14, 8, 1, '#44ff44');
    // Drive laser out to the turning mirror
    for (let x = 26; x < 45; x++) {
      dot(x, cy - 9, '#ff2222');
      dot(x, cy - 10, '#cc1111');
      dot(x, cy - 8, '#cc1111');
    }
    // Turning-mirror housing, folding the laser down onto the axis
    px(42, cy - 12, 7, 8, C.metalDk);
    for (let k = 0; k < 4; k++) dot(44 + k, cy - 11 + k, '#ccaa44');
    for (let y = cy - 8; y < cy - 4; y++) dot(45, y, '#ff2222');
    // Sapphire capillary cell with its plasma channel
    px(capL, cy - 4, capR - capL, 9, '#334466');
    px(capL, cy - 4, capR - capL, 1, C.metal);
    px(capL, cy + 4, capR - capL, 1, C.metal);
    px(capL + 1, cy - 1, capR - capL - 2, 3, '#8866ff');
    // Discharge electrodes and gas feed
    px(capL, cy - 7, 2, 3, C.metal);
    px(capR - 2, cy - 7, 2, 3, C.metal);
    px(capL + 6, cy + 5, 2, 4, C.metalDk);
    // Beam in, and out with the energy gain
    for (let x = 2; x < capL; x++) dot(x, cy, C.beam);
    for (let x = capL; x < W - 2; x++) dot(x, cy, '#ccffdd');
  },

  // === CRYSTAL CHANNELING STAGE ===
  // The accelerating medium is the three white pixels at the centre. Everything
  // else on this card is the mount: a granite bench on air legs, a pitch cradle
  // curved about the crystal, a yaw stage, micrometers, and a laser
  // interferometer watching the whole stack. That 100:1 ratio is the read — so
  // no cells, no bulges, no coupler boxes, nothing that says "cavity".
  crystalChannelStage(p, px, dot, W, H, cy, C) {
    const cx = 35, chL = 31, chR = 39;
    const crystal = '#cdf4ff', laser = '#7fd4e8', laserDk = '#3d8ba6';
    _drawBeamPipe(px, dot, W, cy, C, { skipFrom: chL, skipTo: chR + 1 });

    // --- Granite bench on pneumatic isolators ---
    px(4, cy + 11, 58, 3, '#6b6b74');
    px(4, cy + 11, 58, 1, '#8d8d97');
    for (let x = 7; x < 60; x += 5) dot(x + (x % 3), cy + 12, '#53535c');
    for (const fx of [8, 33, 54]) px(fx, cy + 14, 6, 1, C.metalDk);

    // --- Pitch cradle: an arc whose centre of curvature IS the crystal, so
    // tilting the stage rotates the wafer without translating it off the beam ---
    for (let a = -1.08; a <= 1.08; a += 0.04) {
      const ax = Math.round(cx + Math.sin(a) * 11);
      const ay = Math.round(cy + Math.cos(a) * 11);
      dot(ax, ay, C.metal);
      dot(ax, ay + 1, C.metalDk);
    }

    // --- Stage stack: carriage on the cradle, yaw table, graduated readout ---
    px(26, cy + 9, 19, 2, C.metalDk);
    px(26, cy + 9, 19, 1, C.metal);
    px(29, cy + 6, 12, 3, C.metalDk);
    px(29, cy + 6, 12, 1, laser);
    px(cx - 1, cy + 5, 2, 1, C.metal);       // rotary vacuum feedthrough

    // --- Micrometers: on the yaw table, and walking the carriage along the arc ---
    px(26, cy + 7, 3, 1, C.metal); dot(25, cy + 7, C.metalDk);
    px(41, cy + 7, 3, 1, C.metal); dot(44, cy + 7, C.metalDk);
    px(22, cy + 9, 4, 1, C.metal); dot(21, cy + 9, C.metalDk);
    px(45, cy + 9, 4, 1, C.metal); dot(49, cy + 9, C.metalDk);

    // --- The crystal chamber: the smallest vessel on any beamline here ---
    px(chL, cy - 4, 9, 9, '#182231');
    px(chL, cy - 4, 9, 1, C.metal);
    px(chL, cy + 4, 9, 1, C.metal);
    px(chL, cy - 4, 1, 9, C.metalDk);
    px(chR, cy - 4, 1, 9, C.metalDk);
    px(cx - 1, cy - 6, 2, 2, C.metal);
    px(cx - 2, cy - 7, 4, 1, C.metalDk);
    // Alignment viewports either side — the stage is set optically before beam
    px(chL - 2, cy - 2, 2, 3, C.metal); dot(chL - 2, cy - 1, laser);
    px(chR + 1, cy - 2, 2, 3, C.metal); dot(chR + 2, cy - 1, laser);

    // --- Laser interferometer arm: the readout that makes this an instrument ---
    px(6, cy - 11, 42, 2, C.metalDk);
    px(4, cy - 14, 9, 5, C.metal);
    px(5, cy - 13, 7, 3, '#12202a');
    dot(11, cy - 12, laser);
    for (let x = 13; x < 44; x++) dot(x, cy - 9, x % 2 ? laser : laserDk);
    px(23, cy - 10, 3, 3, C.metal);          // beam splitter
    px(44, cy - 10, 3, 3, C.metalDk);        // reference retroreflector
    for (let y = cy - 8; y < cy + 2; y++) dot(24, y, y % 2 ? laser : laserDk);
    px(22, cy + 2, 5, 2, C.metal);           // measurement retro
    px(23, cy + 4, 2, 6, C.metalDk);         // …posted off the carriage itself

    // --- Stage controller rack, bolted to the bench ---
    px(50, cy + 4, 10, 7, C.metalDk);
    px(51, cy + 5, 8, 5, '#12141c');
    px(52, cy + 6, 6, 1, laser);
    for (const lx of [52, 54, 56]) dot(lx, cy + 8, C.beam);

    // Beam in, channeled between lattice planes, out 12 TeV richer
    for (let x = 2; x < chL; x++) dot(x, cy, C.beam);
    for (let x = chL; x <= chR; x++) dot(x, cy, laser);
    for (let x = chR + 1; x < W - 2; x++) dot(x, cy, '#ccffdd');

    // --- The silicon. Three pixels, on a holder, in the middle of all that. ---
    px(cx, cy + 2, 1, 3, C.metalDk);
    dot(cx, cy - 1, crystal);
    dot(cx, cy, '#ffffff');
    dot(cx, cy + 1, crystal);
  },

  // === SRF 650 MHz CRYOMODULE ===
  // Five big cells (650 MHz is physically large) under a single cryo port.
  srf650Cryomodule(p, px, dot, W, H, cy, C) {
    const L = 4, R = 66;
    _drawBeamPipe(px, dot, W, cy, C, { skipFrom: L, skipTo: R });
    _drawCryoShell(px, dot, cy, C, L, R, { cells: 5, bulge: 8, cellColor: C.scMagnet });
    // Single cryogenic port on top
    px(34, cy - 15, 3, 4, C.metal);
    px(32, cy - 15, 7, 1, C.pipeCryo);
    // Warm-to-cold transitions at both ends
    for (const [ex, dir] of [[L + 1, 1], [R - 3, -1]]) {
      for (let k = 0; k < 3; k++) {
        dot(ex + dir * k, cy - 5 + k, C.metalDk);
        dot(ex + dir * k, cy + 5 - k, C.metalDk);
      }
    }
    for (let x = 2; x < W - 2; x++) dot(x, cy, C.beam);
  },

  // === SRF 805 MHz CRYOMODULE ===
  // One rung up from the 650: six visibly smaller cells and twin cryo ports.
  srf805Cryomodule(p, px, dot, W, H, cy, C) {
    const L = 4, R = 66;
    _drawBeamPipe(px, dot, W, cy, C, { skipFrom: L, skipTo: R });
    _drawCryoShell(px, dot, cy, C, L, R, { cells: 6, bulge: 6, cellColor: C.scMagnet });
    // 2 K cold mass boundary, tighter than the 650's
    px(L + 4, cy - 8, R - L - 8, 1, C.scMagDk);
    px(L + 4, cy + 8, R - L - 8, 1, C.scMagDk);
    // Twin cryogenic ports
    for (const sx of [20, 46]) {
      px(sx, cy - 15, 3, 4, C.metal);
      px(sx - 2, cy - 15, 7, 1, C.pipeCryo);
    }
    for (let x = 2; x < W - 2; x++) dot(x, cy, C.beam);
  },

  // === CW CRYOMODULE ===
  // Same cell count as the pulsed cryomodule, but sized for a continuous heat
  // load: a heavy cryogenic header overhead and doubled coupler boxes.
  cwCryomodule(p, px, dot, W, H, cy, C) {
    const L = 4, R = 66;
    _drawBeamPipe(px, dot, W, cy, C, { skipFrom: L, skipTo: R });
    // Heavy cryogenic header along the whole top edge, with drop legs
    px(0, cy - 15, W, 3, C.pipeCryo);
    px(0, cy - 12, W, 1, '#2a7799');
    for (const x of [12, 26, 40, 54]) px(x, cy - 12, 2, 3, C.metalDk);
    _drawCryoShell(px, dot, cy, C, L, R, {
      cells: 4, bulge: 6, cellColor: C.scMagnet, vesselHalf: 10,
    });
    // Doubled coupler boxes — two per feed point
    for (const x of [14, 20, 44, 50]) {
      px(x, cy + 10, 5, 4, C.coil);
      px(x + 1, cy + 14, 3, 1, C.coilDk);
    }
    for (let x = 2; x < W - 2; x++) dot(x, cy, C.beam);
  },

  // === Nb3Sn CRYOMODULE ===
  // The 650's silhouette in a warmer palette: bronze Nb3Sn cells running at
  // 4.5 K, so the cryogenic connection is a fraction of the size.
  nbSnCryomodule(p, px, dot, W, H, cy, C) {
    const L = 4, R = 66;
    const nbSn = '#ddaa66', nbSnDk = '#aa7733';
    _drawBeamPipe(px, dot, W, cy, C, { skipFrom: L, skipTo: R });
    _drawCryoShell(px, dot, cy, C, L, R, { cells: 5, bulge: 7, cellColor: nbSn });
    // 4.5 K cold mass in the same warm accent
    px(L + 4, cy - 8, R - L - 8, 1, nbSnDk);
    px(L + 4, cy + 8, R - L - 8, 1, nbSnDk);
    // Small cryocooler connection instead of a 2 K plant header
    px(35, cy - 15, 1, 3, C.metalDk);
    px(34, cy - 15, 3, 1, nbSn);
    for (let x = 2; x < W - 2; x++) dot(x, cy, C.beam);
  },

  // === SRF LINAC SECTOR ===
  // Several cryomodules on one distribution line: cell groups split by
  // interconnect bellows, cryo header end to end, a whole row of couplers.
  srfLinacSector(p, px, dot, W, H, cy, C) {
    const L = 2, R = 68;
    _drawBeamPipe(px, dot, W, cy, C, { skipFrom: L, skipTo: R });
    // Cryogenic distribution line spanning the full width
    px(0, cy - 15, W, 2, C.pipeCryo);
    for (let x = 6; x < W - 4; x += 12) px(x, cy - 13, 1, 2, C.pipeCryo);
    // Vacuum jacket
    px(L, cy - 11, R - L, 1, C.wall);
    px(L, cy + 11, R - L, 1, C.wall);
    px(L, cy - 11, 1, 23, C.wallHi);
    px(R, cy - 11, 1, 23, C.wallHi);
    // Three cell groups
    for (const [gl, gr] of [[5, 21], [27, 43], [49, 65]]) {
      px(gl, cy - 9, gr - gl, 1, C.scMagDk);
      px(gl, cy + 9, gr - gl, 1, C.scMagDk);
      const n = 3, cw = (gr - gl) / n;
      for (let i = 0; i < n; i++) {
        const cx2 = gl + Math.round(cw * (i + 0.5));
        for (let dx = -2; dx <= 2; dx++) {
          const h = Math.round(6 * (1 - (dx * dx) / 6));
          dot(cx2 + dx, cy - 1 - h, C.scMagnet);
          dot(cx2 + dx, cy + 1 + h, C.scMagnet);
        }
      }
    }
    // Interconnect bellows between groups
    for (const bx of [23, 45]) {
      for (let dy = -7; dy <= 7; dy += 2) {
        dot(bx, cy + dy, C.metal);
        dot(bx + 1, cy + dy, C.metalDk);
      }
    }
    // Row of coupler boxes along the bottom
    for (let x = 6; x < R - 6; x += 8) px(x, cy + 11, 4, 3, C.coil);
    for (let x = 2; x < W - 2; x++) dot(x, cy, C.beam);
  },

  // === TESLA 9-CELL ===
  tesla9Cell(p, px, dot, W, H, cy, C) {
    const L = 4, R = 66;
    _drawBeamPipe(px, dot, W, cy, C, { skipFrom: L, skipTo: R });
    px(L - 2, cy - 12, R - L + 4, 1, C.wallDk);
    px(L - 2, cy + 12, R - L + 4, 1, C.wallDk);
    const cells = 9;
    const cellW = (R - L) / cells;
    for (let i = 0; i < cells; i++) {
      const cx2 = L + Math.floor(cellW * (i + 0.5));
      for (let dx = -2; dx <= 2; dx++) {
        const t = Math.abs(dx) / 3;
        const h = Math.round(7 * (1 - t * t));
        dot(cx2 + dx, cy - 1 - h, C.scMagnet);
        dot(cx2 + dx, cy + 1 + h, C.scMagnet);
      }
    }
    for (let x = 2; x < W - 2; x++) dot(x, cy, C.beam);
  },

  // === SOLID STATE AMP ===
  solidStateAmp(p, px, dot, W, H, cy, C) {
    // Amplifier triangle
    const L = 18, R = 52, my = cy - 2;
    for (let x = L; x <= R; x++) {
      const t = (x - L) / (R - L);
      const h = Math.round(t * 10);
      dot(x, my - h, C.hot);
      dot(x, my + h, C.hot);
    }
    px(L, my - 1, 1, 3, C.hot);
    // Input signal (small)
    for (let x = 6; x < L; x += 2) dot(x, my, C.pipeRF);
    // Output signal (large)
    for (let x = R + 2; x < W - 2; x += 2) {
      dot(x, my, C.hotBright);
      dot(x, my - 1, C.hot);
      dot(x, my + 1, C.hot);
    }
  },

  // === PULSED KLYSTRON ===
  pulsedKlystron(p, px, dot, W, H, cy, C) {
    const L = 10, R = 58, my = cy - 3;
    px(L, my - 8, R - L, 1, C.wall);
    px(L, my + 8, R - L, 1, C.wall);
    px(L, my - 8, 2, 17, C.wallHi);
    px(R, my - 8, 2, 17, C.wallHi);
    // Cavities inside klystron tube
    for (const cx2 of [20, 32, 44]) {
      px(cx2 - 1, my - 6, 3, 13, C.metalDk);
      px(cx2, my - 5, 1, 11, C.hot);
    }
    // Internal electron beam
    px(L + 3, my - 1, R - L - 5, 3, '#1a0d22');
    for (let x = L + 3; x < R - 2; x++) dot(x, my, C.pipeRF);
    // Collector
    px(R - 4, my - 6, 3, 13, C.metal);
    // HV pulse indicator
    for (let x = 4; x < L; x += 2) dot(x, my - 6, C.hotBright);
  },

  // === CW KLYSTRON ===
  cwKlystron(p, px, dot, W, H, cy, C) {
    const L = 10, R = 58, my = cy - 3;
    px(L, my - 8, R - L, 1, C.wall);
    px(L, my + 8, R - L, 1, C.wall);
    px(L, my - 8, 2, 17, C.wallHi);
    px(R, my - 8, 2, 17, C.wallHi);
    for (const cx2 of [20, 32, 44]) {
      px(cx2 - 1, my - 6, 3, 13, C.metalDk);
      px(cx2, my - 5, 1, 11, C.hot);
    }
    px(L + 3, my - 1, R - L - 5, 3, '#1a0d22');
    for (let x = L + 3; x < R - 2; x++) dot(x, my, C.pipeRF);
    px(R - 4, my - 6, 3, 13, C.metal);
    // CW sine wave indicator
    for (let x = 4; x < L; x++) {
      dot(x, my - 6 + Math.round(Math.sin(x * 1.5) * 2), '#44cc44');
    }
  },

  // === SLAC 5045 KLYSTRON ===
  // Drawn upright. The 5045 stands on end in its oil tank, and the vertical
  // silhouette — banded solenoid, collector on top, waveguide off the neck —
  // is what separates it at a glance from the two horizontal klystrons above.
  slac5045Klystron(p, px, dot, W, H, cy, C) {
    const ax = 35;           // tube axis
    const tankTop = H - 8;   // y of the oil-tank lid
    const bodyTop = 8;

    // Oil tank and its lid
    px(ax - 15, tankTop + 2, 30, 5, C.metalDk);
    px(ax - 14, tankTop + 3, 28, 3, '#1a1a2a');
    px(ax - 17, tankTop, 34, 2, C.metal);
    // HV feed running into the tank
    for (let x = 4; x < ax - 17; x += 2) dot(x, tankTop + 4, C.hotBright);

    // Solenoid body
    px(ax - 8, bodyTop, 16, tankTop - bodyTop, C.wallDk);
    px(ax - 8, bodyTop, 1, tankTop - bodyTop, C.wallHi);
    px(ax + 7, bodyTop, 1, tankTop - bodyTop, C.wallHi);
    // End plates
    px(ax - 10, bodyTop - 1, 20, 1, C.wall);
    px(ax - 10, tankTop - 1, 20, 1, C.wall);
    // Focusing coil bands
    for (let i = 0; i < 4; i++) {
      const y = bodyTop + 2 + i * 3;
      px(ax - 9, y, 18, 2, C.coil);
      px(ax - 9, y + 2, 18, 1, C.coilDk);
    }
    // Electron beam down the axis
    for (let y = bodyTop; y < tankTop; y++) dot(ax, y, C.pipeRF);

    // Drift-tube neck and collector
    px(ax - 2, bodyTop - 4, 5, 3, C.metal);
    px(ax - 4, bodyTop - 8, 9, 4, C.hot);
    px(ax - 4, bodyTop - 8, 9, 1, C.hotBright);

    // Output waveguide off the neck, flange, then RF out to the right edge
    px(ax + 3, bodyTop - 4, 12, 3, C.hotBright);
    px(ax + 15, bodyTop - 5, 2, 5, C.metal);
    for (let x = ax + 18; x < W - 2; x += 2) dot(x, bodyTop - 3, C.pipeRF);
  },

  // === MODULATOR ===
  modulator(p, px, dot, W, H, cy, C) {
    const my = cy - 3;
    px(14, my - 6, 30, 15, C.metalDk);
    px(15, my - 5, 28, 13, '#1a1a2a');
    // Transformer core
    px(22, my - 3, 4, 9, C.metal);
    px(32, my - 3, 4, 9, C.metal);
    // Coils
    px(18, my - 2, 4, 3, C.coil);
    px(18, my + 2, 4, 3, C.coil);
    px(36, my - 2, 4, 3, C.coil);
    px(36, my + 2, 4, 3, C.coil);
    // HV lightning symbol
    dot(29, my - 2, C.hotBright);
    dot(28, my, C.hot);
    dot(29, my + 2, C.hotBright);
    dot(28, my + 4, C.hot);
  },

  // === IOT ===
  iot(p, px, dot, W, H, cy, C) {
    const L = 14, R = 52, my = cy - 3;
    // Tube envelope
    for (let a = 0; a < Math.PI * 2; a += 0.15) {
      const rx = Math.round(33 + Math.cos(a) * 18);
      const ry = Math.round(my + Math.sin(a) * 9);
      if (rx >= L && rx <= R) dot(rx, ry, C.wall);
    }
    // Grid
    for (let dy = -5; dy <= 5; dy += 2) dot(28, my + dy, C.metal);
    // Internal electron beam
    for (let x = L + 4; x < R - 4; x++) dot(x, my, C.pipeRF);
    // Output gap
    px(38, my - 4, 2, 9, C.hot);
  },

  // === CIRCULATOR ===
  circulator(p, px, dot, W, H, cy, C) {
    const cx = 35, my = cy - 3;
    // Circular body
    for (let a = 0; a < Math.PI * 2; a += 0.12) {
      dot(Math.round(cx + Math.cos(a) * 10), Math.round(my + Math.sin(a) * 10 * 0.7), C.wall);
    }
    // Arrow showing circulation direction
    dot(cx + 4, my - 4, C.hotBright);
    dot(cx + 5, my - 2, C.hot);
    dot(cx + 4, my, C.hot);
    dot(cx + 2, my + 2, C.hot);
    dot(cx, my + 3, C.hot);
    dot(cx - 3, my + 2, C.hotBright);
  },

  // === RF COUPLER ===
  rfCoupler(p, px, dot, W, H, cy, C) {
    const my = cy - 3;
    // RF waveguide (horizontal)
    px(10, my - 2, 50, 5, C.wallDk);
    px(11, my - 1, 48, 3, '#1a0d0d');
    // Coupler port (T-junction going down to pipe)
    px(33, my + 3, 4, 8, C.wall);
    px(34, my + 3, 2, 8, C.wallDk);
    // RF power arrow
    dot(35, my + 6, C.hotBright);
    dot(35, my + 8, C.hot);
    dot(34, my + 7, C.hot);
    dot(36, my + 7, C.hot);
    // RF signal in waveguide
    for (let x = 12; x < 58; x += 3) dot(x, my, C.pipeRF);
  },

  // === WAVEGUIDE MANIFOLD ===
  // A plan-ish elevation of the real thing: one trunk in from the left,
  // bolted flanges along it, three tees dropping to cavity feeds. The point
  // the picture has to make is that the RF arriving on the left is the same
  // RF leaving through all three legs — it is divided, never multiplied —
  // so the input dashes are dense and each output run is sparser.
  waveguideManifold(p, px, dot, W, H, cy, C) {
    // Trunk rides high in the 70x30 buffer: everything interesting hangs
    // below it, and the blanked stub needs the two rows above.
    const my = cy - 5;          // trunk centreline
    const taps = [22, 36, 50];  // tee positions along the trunk

    // Input run to the first flange
    px(2, my - 3, 8, 7, C.metalDk);
    px(2, my - 2, 8, 5, C.metal);
    for (let x = 3; x < 10; x++) dot(x, my, C.pipeRF);

    // Trunk
    px(10, my - 3, 52, 7, C.metalDk);
    px(10, my - 2, 52, 5, C.metal);
    px(11, my - 1, 50, 1, C.wallHi);

    // Bolted flanges: a taller plate with two bolt heads
    for (const fx of [10, 61]) {
      px(fx - 1, my - 5, 3, 11, C.wall);
      dot(fx, my - 4, C.metalDk);
      dot(fx, my + 4, C.metalDk);
    }
    // Blanked H-arm stub on top — the magic tee's fourth port. Kept well
    // clear of the taps so it does not read as a fourth output.
    px(14, my - 8, 5, 3, C.metal);
    px(13, my - 10, 7, 2, C.wall);

    // Three E-plane tees dropping to mitred bends
    for (const tx of [...taps]) {
      // Tee body straddling the trunk
      px(tx - 4, my - 5, 9, 11, C.metalDk);
      px(tx - 3, my - 4, 7, 9, C.metal);
      // Down leg
      px(tx - 2, my + 4, 5, 9, C.metalDk);
      px(tx - 1, my + 5, 3, 8, C.metal);
      // Mitred corner and the run out to the cavity flange
      px(tx - 2, my + 12, 8, 4, C.metalDk);
      px(tx + 4, my + 13, 6, 3, C.metal);
      px(tx + 9, my + 11, 2, 7, C.wall);
      // Divided RF continuing down each leg
      dot(tx, my + 6, C.pipeRF);
      dot(tx, my + 9, C.pipeRF);
      dot(tx + 4, my + 14, C.pipeRF);
      dot(tx + 7, my + 14, C.pipeRF);
    }

    // Full-power RF along the trunk, thinning after each tap
    for (let x = 12; x < 60; x += 2) {
      const left = taps.filter(t => t > x).length;
      dot(x, my, left >= 3 ? C.hotBright : left === 2 ? C.hot : left === 1 ? C.pipeRF : C.wallDk);
    }
  },

  // === GYROTRON ===
  // Drawn upright, because a gyrotron is a tube standing inside the bore of
  // a superconducting magnet and the magnet is most of what you see. The
  // read is: gun at the bottom, beam spiralling up the bore, collector and
  // then the mm-wave beam leaving sideways through the window — not out the
  // end like every other tube in the list.
  gyrotron(p, px, dot, W, H, cy, C) {
    const ax = 28;              // tube axis
    // The magnet is squeezed to 12 rows so the collector and its cooling
    // fins clear the top of the buffer and the gun still lands on the base.
    const magTop = 9, magBot = 21;

    // Base frame
    px(14, 27, 30, 3, C.wallDk);

    // Superconducting magnet cryostat around the bore
    px(ax - 13, magTop, 26, magBot - magTop, C.metalDk);
    px(ax - 12, magTop + 1, 24, magBot - magTop - 2, C.wall);
    // Cold bore — the dark channel the tube sits in
    px(ax - 4, magTop, 9, magBot - magTop, '#0d1420');
    // SC coil pack either side of the bore
    for (const sx of [-1, 1]) {
      const x0 = ax + (sx < 0 ? -11 : 5);
      px(x0, magTop + 3, 6, magBot - magTop - 6, C.scMagDk);
      for (let y = magTop + 4; y < magBot - 3; y += 3) px(x0, y, 6, 1, C.scMagnet);
    }
    // Cryostat end plates and a helium fill neck
    px(ax - 15, magTop - 2, 30, 2, C.metal);
    px(ax - 15, magBot, 30, 2, C.metal);
    px(ax - 15, magTop - 6, 3, 4, C.pipeCryo);

    // Electron gun below the magnet — a magnetron injection gun, so it is
    // an annular emitter, drawn as two flares rather than one cathode.
    px(ax - 6, magBot + 2, 13, 4, C.metalDk);
    px(ax - 5, magBot + 3, 3, 2, C.hot);
    px(ax + 3, magBot + 3, 3, 2, C.hot);
    for (let x = 4; x < ax - 6; x += 2) dot(x, magBot + 4, C.hotBright);

    // Helical beam up the bore — cyclotron motion is the whole mechanism
    for (let y = magBot; y > magTop; y--) {
      dot(ax + Math.round(Math.sin(y * 0.7) * 3), y, C.pipeRF);
    }

    // Collector above the magnet, then the output window off the side
    px(ax - 7, magTop - 8, 15, 6, C.metalDk);
    px(ax - 6, magTop - 7, 13, 4, C.metal);
    for (let x = ax - 6; x < ax + 7; x += 3) px(x, magTop - 9, 2, 1, C.metalDk);

    // Diamond output window and the mm-wave beam leaving sideways
    px(ax + 9, magTop - 7, 3, 5, C.scMagnet);
    px(ax + 12, magTop - 8, 2, 7, C.wall);
    for (let x = ax + 15; x < W - 2; x += 2) {
      dot(x, magTop - 5, C.hotBright);
      dot(x, magTop - 7, C.hot);
      dot(x, magTop - 3, C.hot);
    }
    // 1 MW is a lot of water
    px(ax + 9, magBot - 6, 8, 1, C.pipeCooling);
    px(ax + 9, magBot - 3, 8, 1, C.pipeCooling);
  },

  // === LLRF CONTROLLER ===
  llrfController(p, px, dot, W, H, cy, C) {
    const my = cy - 4;
    // Electronics box
    px(14, my - 4, 32, 15, C.metalDk);
    px(15, my - 3, 30, 13, '#0d0d1a');
    // Display showing sine wave
    px(18, my - 1, 20, 8, '#0a1a0a');
    for (let x = 0; x < 18; x++) {
      const y = Math.round(Math.sin(x * 0.8) * 2);
      dot(19 + x, my + 3 + y, '#44cc44');
    }
    // Status LEDs
    dot(40, my - 1, '#44ff44');
    dot(40, my + 1, '#44ff44');
    dot(40, my + 3, '#ffaa44');
  },

  // === MULTIBEAM KLYSTRON ===
  multibeamKlystron(p, px, dot, W, H, cy, C) {
    const L = 8, R = 58, my = cy - 3;
    px(L, my - 8, R - L, 1, C.wall);
    px(L, my + 8, R - L, 1, C.wall);
    px(L, my - 8, 2, 17, C.wallHi);
    px(R, my - 8, 2, 17, C.wallHi);
    // Multiple beam tunnels
    for (const by of [my - 5, my - 1, my + 3]) {
      for (let x = L + 3; x < R - 2; x++) dot(x, by, C.pipeRF);
    }
    // Cavities
    for (const cx2 of [22, 35, 48]) {
      px(cx2, my - 7, 2, 15, C.metalDk);
      dot(cx2, my - 5, C.hot);
      dot(cx2, my - 1, C.hot);
      dot(cx2, my + 3, C.hot);
    }
  },

  // === HIGH POWER SSA ===
  highPowerSSA(p, px, dot, W, H, cy, C) {
    const L = 14, R = 52, my = cy - 2;
    for (let x = L; x <= R; x++) {
      const t = (x - L) / (R - L);
      const h = Math.round(t * 9);
      dot(x, my - h, C.hot);
      dot(x, my + h, C.hot);
    }
    px(L, my - 1, 1, 3, C.hot);
    // Heat sink fins on back
    for (let y = my - 7; y <= my + 7; y += 2) {
      px(R + 2, y, 4, 1, C.metalDk);
    }
    // RF input
    for (let x = 6; x < L; x += 2) dot(x, my, C.pipeRF);
    // RF output (amplified)
    for (let x = R + 1; x < W - 2; x++) dot(x, my, C.hotBright);
  },

  // === LN2 DEWAR ===
  ln2Dewar(p, px, dot, W, H, cy, C) {
    const my = cy - 4;
    // Outer vessel (double-walled dewar)
    px(20, my - 8, 20, 1, C.wall);
    px(20, my + 10, 20, 1, C.wall);
    px(20, my - 8, 1, 19, C.wallHi);
    px(39, my - 8, 1, 19, C.wallHi);
    // Inner vessel
    px(22, my - 6, 16, 1, C.wallDk);
    px(22, my + 8, 16, 1, C.wallDk);
    px(22, my - 6, 1, 15, C.wallDk);
    px(37, my - 6, 1, 15, C.wallDk);
    // Vacuum gap (dark between walls)
    px(21, my - 7, 1, 16, '#0a0a1a');
    px(38, my - 7, 1, 16, '#0a0a1a');
    // LN2 liquid fill
    px(23, my + 1, 14, 7, '#2255aa');
    px(23, my, 14, 1, '#3377cc');
    // Bubbles
    dot(27, my + 3, '#4499dd');
    dot(32, my + 5, '#4499dd');
    dot(29, my + 2, '#4499dd');
    // Lid / top flange
    px(20, my - 8, 20, 2, C.metal);
    // Vent / pressure relief
    px(28, my - 10, 4, 2, C.wallDk);
    dot(29, my - 11, '#cccccc');
    dot(30, my - 12, '#aaaaaa');
    // Fill port
    px(34, my - 10, 3, 2, C.metalDk);
  },

  // === CRYOCOOLER ===
  cryocooler(p, px, dot, W, H, cy, C) {
    const my = cy - 3;
    // Compressor head
    px(20, my - 6, 16, 8, C.metalDk);
    px(21, my - 5, 14, 6, C.metal);
    // Cold finger going down
    px(27, my + 2, 2, 8, C.scMagnet);
    // Cold tip
    px(25, my + 10, 6, 3, C.scMagDk);
    dot(28, my + 11, '#88ddff');
  },

  // === LN2 PRECOOLER ===
  ln2Precooler(p, px, dot, W, H, cy, C) {
    const my = cy - 4;
    // Dewar vessel
    px(16, my - 6, 28, 1, C.wall);
    px(16, my + 10, 28, 1, C.wall);
    px(16, my - 6, 1, 17, C.wallHi);
    px(43, my - 6, 1, 17, C.wallHi);
    // LN2 liquid level
    px(17, my + 2, 26, 8, '#2255aa');
    px(17, my + 1, 26, 1, '#3377cc');
    // Bubbles
    dot(25, my + 4, '#4499dd');
    dot(30, my + 6, '#4499dd');
    dot(35, my + 3, '#4499dd');
    // Vent
    px(28, my - 6, 4, 3, C.wallDk);
    dot(29, my - 8, '#cccccc');
  },

  // === HE COMPRESSOR ===
  heCompressor(p, px, dot, W, H, cy, C) {
    const my = cy - 3;
    px(14, my - 7, 32, 17, C.metalDk);
    px(15, my - 6, 30, 15, C.metal);
    // Motor
    for (let a = 0; a < Math.PI * 2; a += 0.2) {
      dot(Math.round(24 + Math.cos(a) * 5), Math.round(my + Math.sin(a) * 5), C.coil);
    }
    // Piston
    px(34, my - 4, 8, 9, C.metalDk);
    px(35, my - 3, 6, 7, '#1a1a2a');
    px(37, my - 2, 2, 5, C.metal);
  },

  // === COLD BOX 4K ===
  coldBox4K(p, px, dot, W, H, cy, C) {
    const my = cy - 3;
    px(14, my - 7, 32, 17, C.wallDk);
    px(15, my - 6, 30, 15, '#0d1a2a');
    // Heat exchangers inside
    for (let x = 18; x < 42; x += 4) {
      px(x, my - 5, 1, 13, '#224466');
    }
    // "4K" cold region
    px(22, my - 2, 16, 7, '#112244');
    dot(28, my, C.scMagnet);
    dot(30, my + 1, C.scMagDk);
    dot(32, my - 1, C.scMagnet);
  },

  // === COLD BOX 2K ===
  coldBox2K(p, px, dot, W, H, cy, C) {
    const my = cy - 3;
    px(14, my - 7, 32, 17, C.wallDk);
    px(15, my - 6, 30, 15, '#0a0a22');
    for (let x = 18; x < 42; x += 4) {
      px(x, my - 5, 1, 13, '#1a2244');
    }
    // "2K" even colder
    px(22, my - 2, 16, 7, '#0a1133');
    // JT valve
    dot(28, my, C.scMagnet);
    dot(29, my + 1, '#ffffff');
    dot(30, my + 2, C.scMagDk);
  },

  // === CRYOMODULE HOUSING ===
  cryomoduleHousing(p, px, dot, W, H, cy, C) {
    const L = 6, R = 64, my = cy - 3;
    // Outer vessel
    px(L, my - 10, R - L, 1, C.wall);
    px(L, my + 10, R - L, 1, C.wall);
    px(L, my - 10, 1, 21, C.wallHi);
    px(R, my - 10, 1, 21, C.wallHi);
    // Thermal shields
    px(L + 2, my - 8, R - L - 4, 1, '#886633');
    px(L + 2, my + 8, R - L - 4, 1, '#886633');
    px(L + 4, my - 6, R - L - 8, 1, C.scMagDk);
    px(L + 4, my + 6, R - L - 8, 1, C.scMagDk);
    // MLI insulation dots
    for (let x = L + 6; x < R - 4; x += 4) {
      dot(x, my - 7, '#554422');
      dot(x + 2, my + 7, '#554422');
    }
  },

  // === HE RECOVERY ===
  heRecovery(p, px, dot, W, H, cy, C) {
    const my = cy - 3;
    // Gas bag
    for (let a = 0; a < Math.PI * 2; a += 0.12) {
      const rx = Math.round(35 + Math.cos(a) * 16);
      const ry = Math.round(my + Math.sin(a) * 8);
      if (rx >= 6 && rx < 64) dot(rx, ry, C.wall);
    }
    // Fill
    px(22, my - 4, 26, 9, '#0d2233');
    // He label
    dot(32, my - 1, C.scMagnet);
    dot(33, my - 1, C.scMagnet);
    dot(34, my - 1, C.scMagDk);
    dot(35, my - 1, C.scMagDk);
  },

  // === HE RECOVERY HEADER ===
  // A run of vacuum-jacketed line on stands with relief branches teeing off
  // it. Deliberately plain — it is the plumbing the rest of the chain hangs
  // off, and it does nothing on its own.
  heRecoveryHeader(p, px, dot, W, H, cy, C) {
    const my = cy - 2;
    // Stands
    for (const x of [14, 34, 54]) {
      px(x, my + 4, 3, 8, C.wallDk);
      px(x - 1, my + 11, 5, 1, C.metalDk);
    }
    // Outer jacket
    px(8, my - 3, 54, 7, C.metalDk);
    px(8, my - 2, 54, 5, C.metal);
    // Inner cold line visible through the cutaway
    px(20, my - 1, 30, 3, C.pipeCryo);
    px(20, my, 30, 1, '#66ccee');
    // Jacket weld bands
    for (const x of [16, 30, 44, 58]) px(x, my - 4, 1, 9, C.wallDk);
    // Branch stubs alternating up and down, each with a blank flange
    for (const [x, up] of [[22, 1], [33, 0], [44, 1], [55, 0]]) {
      if (up) { px(x, my - 7, 2, 4, C.metal); px(x - 1, my - 8, 4, 1, C.wall); }
      else { px(x, my + 4, 2, 4, C.metal); px(x - 1, my + 8, 4, 1, C.wall); }
    }
    // Relief stack — the header can still blow
    px(12, my - 9, 2, 6, C.wallDk);
    dot(12, my - 10, '#cccccc');
    dot(13, my - 11, '#aaaaaa');
  },

  // === HE GAS BAG ===
  // A slack balloon in a steel cage. The bag reads soft and the cage reads
  // rigid — the contrast is the whole point of the picture.
  heGasBag(p, px, dot, W, H, cy, C) {
    const my = cy - 2;
    // Cage: base, two posts, top rail
    px(14, my + 11, 42, 2, C.wallDk);
    px(14, my - 11, 42, 1, C.metalDk);
    px(14, my - 11, 2, 22, C.metalDk);
    px(54, my - 11, 2, 22, C.metalDk);
    px(14, my, 2, 1, C.wallDk);
    px(54, my, 2, 1, C.wallDk);
    // Bag body — a fat teardrop, wider low than high
    for (let y = -9; y <= 10; y++) {
      const t = (y + 9) / 19;
      const r = Math.round(17 * Math.sin(Math.PI * Math.pow(t, 0.78)) * 0.98 + 2);
      if (r <= 1) continue;
      px(35 - r, my + y, r * 2, 1, y < 0 ? '#556b8a' : '#44586f');
    }
    // Highlight down the left shoulder, so the surface reads as fabric
    for (let y = -6; y <= 4; y++) dot(35 - 12 + Math.round(Math.abs(y) * 0.4), my + y, C.wall);
    // Seam stitching around the belly
    for (let x = 22; x <= 48; x += 3) dot(x, my + 6, C.wallDk);
    // Lashing ring and inlet spool at the base
    px(30, my + 9, 10, 2, C.metalDk);
    px(33, my + 11, 4, 2, C.metal);
    px(4, my + 11, 30, 1, C.pipeCryo);
    // Tell-tale weight over the rail — bag height IS the inventory gauge
    px(58, my - 11, 1, 9, C.metalDk);
    px(57, my - 2, 3, 2, '#cc8844');
  },

  // === HE PURIFIER ===
  // Twin adsorber beds with a switching manifold across the top: one bed on
  // line, one regenerating, and a vent stack where the contaminant leaves.
  hePurifier(p, px, dot, W, H, cy, C) {
    // Tall subject in a 30 px buffer: the baseline sits low so the vent stack
    // and the switching manifold above the beds still fit.
    const my = cy + 2;
    // Skid
    px(12, my + 11, 54, 2, C.wallDk);
    // Two beds
    for (const x0 of [18, 38]) {
      px(x0, my - 8, 14, 19, C.metalDk);
      px(x0 + 1, my - 7, 12, 17, C.metal);
      // Charcoal fill
      px(x0 + 2, my - 3, 10, 12, '#2a2a30');
      for (let y = my - 2; y < my + 9; y += 2) {
        for (let x = x0 + 3; x < x0 + 11; x += 3) dot(x + (y % 4 ? 1 : 0), y, '#4a4a52');
      }
      // Cold collar — the beds sit at 80 K
      px(x0, my + 1, 14, 1, C.scMagDk);
      px(x0, my + 2, 14, 1, C.scMagnet);
      // Dished head and inlet elbow
      px(x0 + 2, my - 10, 10, 2, C.wall);
      px(x0 + 6, my - 12, 2, 2, C.metal);
    }
    // Switching valve manifold tying the two heads together
    px(24, my - 13, 22, 1, '#886644');
    for (const x of [24, 45]) px(x, my - 14, 2, 2, '#cc8844');
    // Regeneration vent stack
    px(12, my - 12, 2, 23, C.wallDk);
    px(11, my - 14, 4, 2, C.metalDk);
    dot(12, my - 15, '#998877');
    dot(13, my - 16, '#776655');
    // Purity readout on its own stand — the number this box exists to hold up
    px(62, my + 2, 2, 9, C.wallDk);
    px(59, my - 4, 8, 7, C.metalDk);
    px(60, my - 3, 6, 5, '#12202a');
    dot(61, my - 1, '#44ff44');
    dot(62, my - 1, '#44ff44');
    dot(63, my - 1, '#44ff44');
    dot(64, my - 1, '#44ff44');
    // Sample line back to the bed outlet
    px(52, my, 7, 1, '#886644');
  },

  // === HE LIQUEFIER ===
  // Insulated cold box with two turbine expanders on the roof, feeding a
  // horizontal dewar. The liquid level in the dewar is the payoff.
  heLiquefier(p, px, dot, W, H, cy, C) {
    // The tallest thing in the chain, drawn against the top of the 30 px
    // buffer: turbines at y = 1, skid at y = 25.
    // Skid
    px(4, 25, 62, 2, C.wallDk);
    // Cold box
    px(6, 9, 34, 16, C.metalDk);
    px(7, 10, 32, 14, C.metal);
    // Cold-end frost on the lower half
    px(7, 18, 32, 6, '#7f96a8');
    for (let x = 9; x < 38; x += 4) dot(x, 20, '#c8dce8');
    // Roof plate
    px(5, 7, 36, 2, C.wallDk);
    // Two turbine expanders
    for (const x0 of [12, 28]) {
      px(x0, 3, 8, 4, C.metalDk);
      px(x0 + 1, 4, 6, 2, C.metal);
      px(x0 + 2, 1, 4, 2, C.wallDk);
      dot(x0 + 3, 0, '#cccccc');
      // Cold return leg down the cold box face
      px(x0 + 3, 10, 1, 12, C.pipeCryo);
    }
    // JT valve station between them
    px(23, 4, 2, 3, '#cc8844');
    // Warm-end transfer lines across to the dewar
    px(40, 13, 6, 1, C.pipeCryo);
    px(40, 21, 6, 1, C.pipeCryo);
    // Storage dewar
    px(46, 11, 20, 14, C.metalDk);
    px(47, 12, 18, 12, C.wallDk);
    // Liquid helium level — the whole reason the box is here
    px(48, 16, 16, 7, '#2255aa');
    px(48, 15, 16, 1, '#66ccee');
    dot(52, 18, '#4499dd');
    dot(58, 20, '#4499dd');
    // Relief and level gauge on top
    px(50, 9, 2, 2, C.wallDk);
    px(60, 9, 2, 2, '#cc8844');
  },

  // === CRYO VALVE BOX ===
  // The small one, and the one that has to work hardest to say "cryo". Three
  // cues do it: bayonet connectors running out both sides (nested cones, never
  // a plain flange), a frost band across the bottom of the can, and valve
  // stems standing well proud of the lid with handwheels on top.
  cryoValveBox(p, px, dot, W, H, cy, C) {
    const bx = 20, bw = 30, by = 9, bh = 14;

    // Bayonet connections, left and right, drawn before the can so the can's
    // wall overlaps their inboard ends.
    for (const s of [-1, 1]) {
      const x0 = s < 0 ? 6 : 50;
      // Outer vacuum jacket
      px(x0, cy - 3, 14, 6, C.metalDk);
      px(x0, cy - 2, 14, 4, C.metal);
      // Jacket weld ring
      px(x0 + (s < 0 ? 5 : 8), cy - 4, 1, 8, C.wallDk);
      // Inner cold line, and the nose flange at the free end
      px(x0 + 2, cy - 1, 10, 2, C.pipeCryo);
      px(s < 0 ? 4 : 64, cy - 4, 2, 8, C.wallDk);
    }

    // Vacuum-jacketed can
    px(bx, by, bw, bh, C.metalDk);
    px(bx + 1, by + 1, bw - 2, bh - 2, C.metal);
    // Cold interior
    px(bx + 3, by + 3, bw - 6, bh - 6, '#0d1a2a');
    // Supply and return headers inside
    px(bx + 4, by + 4, bw - 8, 1, C.pipeCryo);
    px(bx + 4, by + 6, bw - 8, 1, C.scMagDk);
    // Frost sitting in the bottom of the can
    px(bx + 3, by + 8, bw - 6, 3, '#7f96a8');
    for (let x = bx + 4; x < bx + bw - 4; x += 3) dot(x, by + 9, '#c8dce8');
    // Nameplate
    px(bx + 2, by + bh - 3, 5, 2, C.label);

    // Valve stems on the lid — the middle one is the control valve and stands
    // taller than the two isolation valves either side of it.
    for (const [sx, top] of [[25, 3], [33, 2], [41, 3]]) {
      px(sx - 2, by - 3, 5, 3, C.metalDk);        // bonnet
      px(sx - 1, by - 2, 3, 1, C.metal);
      px(sx, top, 1, by - 3 - top, C.metal);      // stem
      px(sx - 3, top - 1, 7, 1, '#cc8844');       // handwheel
      dot(sx, top - 2, C.wallHi);
    }

    // Relief stack with its burst disc
    px(46, by - 4, 3, 4, C.wallDk);
    px(47, by - 7, 1, 3, '#cc8844');
    dot(47, by - 8, '#ffaa44');
    // Vacuum pump-out port, blanked off
    px(21, by - 2, 2, 2, C.wallDk);
  },

  // === ROUGHING PUMP ===
  roughingPump(p, px, dot, W, H, cy, C) {
    const my = cy - 3;
    // Scroll pump body
    for (let a = 0; a < Math.PI * 2; a += 0.15) {
      dot(Math.round(30 + Math.cos(a) * 10), Math.round(my + Math.sin(a) * 8), C.wall);
    }
    px(22, my - 6, 16, 13, C.metalDk);
    // Scroll spiral
    for (let a = 0; a < 6; a += 0.2) {
      const r = 6 - a * 0.8;
      if (r < 1) break;
      dot(Math.round(30 + Math.cos(a) * r), Math.round(my + Math.sin(a) * r * 0.6), C.metal);
    }
    // Motor
    px(40, my - 4, 10, 9, C.metalDk);
    px(41, my - 3, 8, 7, C.coil);
  },

  // === TURBO PUMP ===
  turboPump(p, px, dot, W, H, cy, C) {
    const cx2 = 32, my = cy - 3;
    // Cylindrical body
    px(cx2 - 8, my - 8, 16, 18, C.metalDk);
    px(cx2 - 7, my - 7, 14, 16, '#1a1a2a');
    // Blade stages
    for (let y = my - 6; y <= my + 6; y += 3) {
      for (let dx = -5; dx <= 5; dx++) {
        const angle = dx * 0.3 + y * 0.2;
        dot(cx2 + dx, y, angle > 0 ? C.metal : C.metalDk);
      }
    }
  },

  // === ION PUMP ===
  ionPump(p, px, dot, W, H, cy, C) {
    const my = cy - 3;
    px(16, my - 7, 28, 15, C.metalDk);
    px(17, my - 6, 26, 13, '#0d0d22');
    // Anode cells
    for (let x = 20; x < 40; x += 5) {
      px(x, my - 4, 3, 9, C.metal);
      px(x + 1, my - 3, 1, 7, '#ccaa44');
    }
    // Cathode plates
    px(18, my - 5, 24, 1, '#4444cc');
    px(18, my + 5, 24, 1, '#4444cc');
    // Magnetic field
    dot(16, my - 8, C.magnetLt);
    dot(43, my - 8, C.magnetLt);
    // HV connection
    px(28, my - 7, 4, 2, '#cc4444');
  },

  // === NEG PUMP ===
  negPump(p, px, dot, W, H, cy, C) {
    const L = 16, R = 54, my = cy - 3;
    px(L, my - 6, R - L, 13, C.metalDk);
    px(L + 1, my - 5, R - L - 2, 11, '#0d0d22');
    // NEG strips (getter material)
    for (let x = L + 3; x < R - 2; x += 3) {
      px(x, my - 3, 1, 7, '#aa8844');
    }
    // Heating current indicators
    dot(L + 4, my - 4, C.hot);
    dot(L + 10, my - 4, C.hot);
  },

  // === TI SUBLIMATION PUMP ===
  tiSubPump(p, px, dot, W, H, cy, C) {
    const my = cy - 3;
    px(18, my - 7, 24, 15, C.metalDk);
    px(19, my - 6, 22, 13, '#0d0d22');
    // Ti filaments
    for (const fx of [25, 30, 35]) {
      px(fx, my - 5, 1, 11, C.metal);
      dot(fx, my - 3, C.hot);
      dot(fx, my, C.hotBright);
      dot(fx, my + 3, C.hot);
    }
    // Ti film deposits
    for (let x = 20; x < 40; x += 2) {
      dot(x, my - 5, '#888899');
      dot(x, my + 5, '#888899');
    }
  },

  // === PIRANI GAUGE ===
  piraniGauge(p, px, dot, W, H, cy, C) {
    const my = cy - 3;
    for (let a = 0; a < Math.PI * 2; a += 0.15) {
      dot(Math.round(35 + Math.cos(a) * 8), Math.round(my + Math.sin(a) * 7), C.wall);
    }
    px(28, my - 5, 14, 11, '#0d0d22');
    // Heated wire
    px(32, my - 2, 6, 1, C.hot);
    dot(35, my - 2, C.hotBright);
    // Dial needle
    dot(35, my + 2, C.metal);
    dot(36, my + 1, '#ff4444');
    dot(37, my, '#ff4444');
  },

  // === COLD CATHODE GAUGE ===
  coldCathodeGauge(p, px, dot, W, H, cy, C) {
    const my = cy - 3;
    for (let a = 0; a < Math.PI * 2; a += 0.15) {
      dot(Math.round(35 + Math.cos(a) * 8), Math.round(my + Math.sin(a) * 7), C.wall);
    }
    px(28, my - 5, 14, 11, '#0d0d22');
    // Glow discharge
    dot(35, my, '#aa44ff');
    dot(34, my - 1, '#8833cc');
    dot(36, my + 1, '#8833cc');
    dot(35, my - 2, '#6622aa');
    dot(35, my + 2, '#6622aa');
    // Cathode plates
    px(30, my - 3, 1, 7, C.metal);
    px(39, my - 3, 1, 7, C.metal);
  },

  // === BA GAUGE ===
  baGauge(p, px, dot, W, H, cy, C) {
    const my = cy - 3;
    for (let a = 0; a < Math.PI * 2; a += 0.15) {
      dot(Math.round(35 + Math.cos(a) * 8), Math.round(my + Math.sin(a) * 7), C.wall);
    }
    px(28, my - 5, 14, 11, '#0d0d22');
    // Filament
    dot(31, my - 2, C.hot);
    dot(31, my, C.hotBright);
    dot(31, my + 2, C.hot);
    // Grid
    for (let dy = -3; dy <= 3; dy += 2) dot(35, my + dy, '#ccaa44');
    // Collector
    dot(39, my, C.metal);
  },

  // === GATE VALVE ===
  gateValve(p, px, dot, W, H, cy, C) {
    const my = cy - 3;
    // Valve body
    px(30, my - 8, 10, 17, C.metal);
    px(31, my - 7, 8, 15, C.metalDk);
    // Gate disc (closed position)
    px(34, my - 6, 2, 13, C.wallHi);
    // Actuator on top
    px(33, my - 10, 4, 2, C.wall);
    dot(35, my - 11, '#44cc44'); // Open indicator
  },

  // === BAKEOUT SYSTEM ===
  bakeoutSystem(p, px, dot, W, H, cy, C) {
    const my = cy - 3;
    px(11, my - 1, 48, 3, '#1a1a2a');
    // Heating tape wrapped around
    for (let x = 12; x < 58; x += 4) {
      dot(x, my - 2, C.hot);
      dot(x + 1, my + 2, C.hot);
      dot(x + 2, my - 2, C.hotBright);
    }
    // Heat waves rising
    for (let x = 16; x < 54; x += 8) {
      dot(x, my - 4, '#ff6622');
      dot(x + 1, my - 6, '#cc4411');
      dot(x, my - 8, '#993311');
    }
    // Thermocouple
    dot(35, my + 3, '#ccaa44');
    dot(35, my + 4, C.coil);
  },

  // === HEAT EXCHANGER ===
  heatExchanger(p, px, dot, W, H, cy, C) {
    const my = cy - 3;
    px(16, my - 7, 28, 15, C.metalDk);
    px(17, my - 6, 26, 13, '#0d0d22');
    // Hot side channels
    for (let x = 20; x < 40; x += 4) {
      px(x, my - 5, 1, 11, '#cc4444');
    }
    // Cold side channels
    for (let x = 22; x < 40; x += 4) {
      px(x, my - 5, 1, 11, '#4444cc');
    }
  },

  // === WATER LOAD ===
  waterLoad(p, px, dot, W, H, cy, C) {
    const my = cy - 3;
    px(18, my - 6, 24, 13, C.metalDk);
    px(19, my - 5, 22, 11, '#0d0d22');
    // Absorbing material
    px(22, my - 3, 16, 7, '#443322');
    // Water channels
    for (let y = my - 2; y <= my + 2; y += 2) {
      px(23, y, 14, 1, '#2255aa');
    }
  },

  // === LCW MANIFOLD ===
  // A header, not a box. Two parallel runs on thin stands, handwheels where
  // branches leave and blanked caps where they have not been run yet — the
  // open space under and between the runs is the read.
  coolingManifold(p, px, dot, W, H, cy, C) {
    const my = cy - 1;
    // Three short stands: column, foot plate, cross arm carrying both runs.
    for (const x of [15, 34, 53]) {
      px(x, my + 5, 3, 8, C.wallDk);
      px(x - 3, my + 13, 9, 2, C.wallDk);
      px(x - 4, my + 3, 11, 2, C.metalDk);
    }
    // Supply run (upper) and return run (lower)
    px(8, my - 3, 54, 3, C.pipeCooling);
    px(8, my + 1, 54, 3, C.coil);
    // Blank end flanges on both runs
    for (const x of [6, 62]) px(x, my - 4, 2, 9, C.metalDk);
    // Isolation valves — body, rising stem, handwheel
    for (const x of [18, 35, 52]) {
      px(x - 3, my - 5, 7, 5, C.metalDk);
      px(x, my - 8, 1, 3, C.metal);
      px(x - 4, my - 10, 9, 2, C.metal);
      dot(x, my - 9, C.wall);
    }
    // Capped branch tees between the valves
    for (const x of [26, 44]) {
      px(x - 1, my - 6, 2, 3, C.pipeCooling);
      px(x - 3, my - 8, 6, 2, C.metalDk);
    }
    // Pressure gauge tapped off the supply run
    px(11, my - 6, 1, 3, C.metal);
    px(9, my - 9, 5, 3, C.metalDk);
    dot(11, my - 8, '#44ff44');
  },

  // === FAN-COIL COOLER ===
  // A finned coil behind a blower: fin stack on the left, fan wheel on the
  // right. No compressor anywhere — that is the whole point of the unit.
  fanCoilCooler(p, px, dot, W, H, cy, C) {
    const my = cy - 3;
    // Cabinet
    px(20, my - 7, 30, 15, C.metalDk);
    px(21, my - 6, 28, 13, '#0d0d22');
    // Finned coil block
    for (let x = 23; x <= 33; x += 2) {
      px(x, my - 4, 1, 9, '#886644');
    }
    // Coil headers top and bottom
    px(23, my - 5, 11, 1, C.pipeCooling);
    px(23, my + 5, 11, 1, C.pipeCooling);
    // Blower wheel
    for (let a = 0; a < Math.PI * 2; a += 0.25) {
      dot(Math.round(42 + Math.cos(a) * 4), Math.round(my + Math.sin(a) * 4), C.metal);
    }
    dot(42, my, C.metalDk);
    // Discharge grille
    for (let y = my - 4; y <= my + 4; y += 2) px(47, y, 2, 1, C.wall);
  },

  // === PACKAGE CHILLER ===
  // Skid frame, scroll compressor, and one condenser fan on top.
  packageChiller(p, px, dot, W, H, cy, C) {
    const my = cy - 3;
    // Skid frame
    px(17, my + 6, 30, 2, C.wallDk);
    // Cabinet
    px(18, my - 6, 28, 12, C.metalDk);
    px(19, my - 5, 26, 10, C.metal);
    // Scroll compressor — squat cylinder
    px(22, my - 2, 7, 7, C.metalDk);
    px(23, my - 3, 5, 1, C.wall);
    // Brazed-plate evaporator stack
    for (let x = 32; x <= 40; x += 2) px(x, my - 3, 1, 8, '#556677');
    // Condenser fan on the roof
    px(28, my - 8, 10, 2, C.wallDk);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + 0.4;
      dot(Math.round(33 + Math.cos(a) * 3), Math.round(my - 7 + Math.sin(a) * 1), C.metal);
    }
    // Supply/return stubs
    px(46, my - 3, 3, 1, C.pipeCooling);
    px(46, my + 1, 3, 1, C.pipeCooling);
  },

  // === LCW SKID ===
  lcwSkid(p, px, dot, W, H, cy, C) {
    const my = cy - 3;
    // Pump
    for (let a = 0; a < Math.PI * 2; a += 0.15) {
      dot(Math.round(24 + Math.cos(a) * 6), Math.round(my + Math.sin(a) * 6), C.wall);
    }
    px(19, my - 4, 10, 9, C.metalDk);
    // Impeller
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      dot(Math.round(24 + Math.cos(a) * 3), Math.round(my + Math.sin(a) * 3), C.metal);
    }
    // Control panel
    px(48, my - 4, 8, 10, C.metalDk);
    dot(50, my - 2, '#44ff44');
    dot(50, my, '#44ff44');
  },

  // === DUAL-CIRCUIT CHILLER ===
  // Two mirrored halves split by a seam: each has its own compressor, its own
  // condenser coil, its own roof fan and its own setpoint light. Losing one
  // half is what this unit sells.
  dualCircuitChiller(p, px, dot, W, H, cy, C) {
    const my = cy - 3;
    // Common skid under both circuits
    px(10, my + 8, 44, 2, C.wallDk);
    for (const x0 of [11, 33]) {
      // Cabinet
      px(x0, my - 4, 20, 12, C.metalDk);
      px(x0 + 1, my - 3, 18, 10, C.metal);
      // Scroll compressor
      px(x0 + 3, my + 1, 6, 6, C.metalDk);
      px(x0 + 4, my, 4, 1, C.wall);
      // Condenser coil block
      for (let x = x0 + 12; x <= x0 + 18; x += 2) px(x, my - 2, 1, 8, '#886644');
      // Roof fan
      px(x0 + 4, my - 7, 12, 3, C.wallDk);
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + 0.4;
        dot(Math.round(x0 + 10 + Math.cos(a) * 4), Math.round(my - 6 + Math.sin(a) * 1), C.metal);
      }
      // This circuit's own supply/return pair and setpoint light
      px(x0 + 5, my + 10, 10, 1, C.pipeCooling);
      dot(x0 + 3, my - 1, '#44ff44');
    }
    // The seam — two circuits, not one big box
    px(31, my - 5, 2, 14, C.wallDk);
  },

  // === CHILLER ===
  chiller(p, px, dot, W, H, cy, C) {
    const my = cy - 3;
    px(12, my - 7, 36, 15, C.metalDk);
    px(13, my - 6, 34, 13, C.metal);
    // Compressor
    for (let a = 0; a < Math.PI * 2; a += 0.2) {
      dot(Math.round(24 + Math.cos(a) * 4), Math.round(my + Math.sin(a) * 4), C.coil);
    }
    // Condenser coils
    for (let y = my - 4; y <= my + 4; y += 2) {
      px(34, y, 10, 1, '#886644');
    }
    // Fan
    dot(42, my, C.metal);
    dot(41, my - 2, C.metalDk);
    dot(43, my - 2, C.metalDk);
    dot(41, my + 2, C.metalDk);
    dot(43, my + 2, C.metalDk);
  },

  // === DRY COOLER BANK ===
  // Long, raised and open underneath: coils and fans, no basin and no plume.
  // The empty space under the frame is the read — nothing is evaporating here.
  dryCoolerBank(p, px, dot, W, H, cy, C) {
    const my = cy - 2;
    // Legs and ground tie — the bank stands clear of the ground for airflow
    for (const x of [13, 31, 49]) px(x, my + 6, 3, 7, C.wallDk);
    px(12, my + 12, 41, 1, C.wallDk);
    // Deck
    px(11, my + 4, 42, 2, C.metalDk);
    // Finned coil bank
    px(11, my - 1, 42, 5, C.metalDk);
    for (let x = 12; x <= 51; x += 2) px(x, my - 1, 1, 5, '#886644');
    // Plenum closing the top of the V
    px(11, my - 3, 42, 2, C.metal);
    // Three axial fans pulling air up through the coils
    for (const fx of [19, 32, 45]) {
      px(fx - 6, my - 5, 12, 2, C.wallDk);
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + 0.4;
        dot(Math.round(fx + Math.cos(a) * 4), Math.round(my - 4 + Math.sin(a) * 1), C.metal);
      }
      dot(fx, my - 4, C.metalDk);
    }
    // Adiabatic spray header and nozzles under the coil face
    px(11, my + 3, 42, 1, C.pipeCooling);
    for (let x = 15; x <= 49; x += 6) dot(x, my + 2, C.pipeCooling);
    // Water supply/return at the near end
    px(5, my + 1, 6, 1, C.pipeCooling);
    px(5, my + 5, 6, 1, C.pipeCooling);
  },

  // === COOLING TOWER ===
  coolingTower(p, px, dot, W, H, cy, C) {
    const my = cy - 4;
    // Hyperbolic tower shape
    for (let y = my - 8; y <= my + 10; y++) {
      const t = (y - my + 8) / 18;
      const w = Math.round(5 + Math.abs(t - 0.4) * 12);
      px(35 - w, y, w * 2, 1, C.wall);
    }
    // Fill material inside
    px(30, my + 2, 10, 6, C.metalDk);
    // Water falling
    for (let y = my + 3; y <= my + 7; y += 2) {
      dot(31 + (y % 3), y, C.pipeCooling);
      dot(37 + (y % 2), y, C.pipeCooling);
    }
    // Steam plume
    for (let i = 0; i < 4; i++) {
      dot(34 + (i % 3), my - 9 - i, '#aaaaaa');
      dot(36 + (i % 2), my - 10 - i, '#888888');
    }
  },

  // === DEIONIZER ===
  deionizer(p, px, dot, W, H, cy, C) {
    const my = cy - 3;
    // DI column
    px(27, my - 8, 10, 19, C.wallDk);
    px(28, my - 7, 8, 17, '#0d0d22');
    // Resin bed
    px(29, my - 2, 6, 10, '#aa8844');
    // Beads
    for (let y = my; y <= my + 6; y += 2) {
      for (let x = 30; x <= 33; x += 2) dot(x, y, '#ccaa44');
    }
  },

  // === EMERGENCY COOLING ===
  emergencyCooling(p, px, dot, W, H, cy, C) {
    const my = cy - 4;
    // Red cross
    px(31, my - 6, 8, 14, '#cc2222');
    px(26, my - 1, 18, 4, '#cc2222');
    px(32, my - 5, 6, 12, '#ff4444');
    px(27, my, 16, 2, '#ff4444');
    // Water drop symbol in center
    dot(35, my - 2, C.pipeCooling);
    dot(34, my - 1, C.pipeCooling);
    dot(36, my - 1, C.pipeCooling);
    dot(35, my, '#2266aa');
  },

  // === RACK IOC ===
  rackIoc(p, px, dot, W, H, cy, C) {
    const my = cy - 4;
    px(20, my - 6, 20, 19, C.metalDk);
    px(21, my - 5, 18, 17, '#0d0d1a');
    // Rack units
    for (let y = my - 3; y <= my + 9; y += 3) {
      px(22, y, 16, 2, C.metalDk);
      dot(36, y, '#44ff44');
      dot(36, y + 1, '#226622');
    }
    // Activity lights
    dot(34, my - 2, '#ffaa44');
    dot(34, my + 4, '#44ff44');
  },

  // === PPS INTERLOCK ===
  ppsInterlock(p, px, dot, W, H, cy, C) {
    const cx2 = 35, my = cy - 4;
    // Shield shape
    for (let y = my - 6; y <= my + 6; y++) {
      const t = Math.max(0, (y - my) / 6);
      const w = Math.round(10 * (1 - t * t));
      if (w > 0) px(cx2 - w, y, w * 2, 1, '#cc2222');
    }
    for (let y = my - 6; y <= my; y++) {
      px(cx2 - 10, y, 20, 1, '#cc2222');
    }
    // Lock symbol
    px(cx2 - 2, my - 2, 4, 5, '#ffcc44');
    for (let a = 0; a < Math.PI; a += 0.3) {
      dot(Math.round(cx2 + Math.cos(a) * 3), my - 3 - Math.round(Math.sin(a) * 3), '#ffcc44');
    }
  },

  // === SHIELDING ===
  shielding(p, px, dot, W, H, cy, C) {
    const my = cy - 2;
    // Concrete block wall
    px(10, my - 10, 50, 20, '#666677');
    // Brick/block pattern
    for (let y = my - 10; y < my + 10; y += 4) {
      px(10, y, 50, 1, '#555566');
      const offset = ((y - my + 10) / 4) % 2 === 0 ? 0 : 8;
      for (let x = 10 + offset; x < 60; x += 16) {
        px(x, y, 1, 4, '#555566');
      }
    }
    // Rebar dots
    dot(22, my - 4, C.metalDk);
    dot(35, my + 2, C.metalDk);
    dot(48, my + 6, C.metalDk);
  },

  // === MPS ===
  mps(p, px, dot, W, H, cy, C) {
    const cx2 = 35, my = cy - 4;
    // Warning triangle
    for (let y = my - 6; y <= my + 6; y++) {
      const t = (y - my + 6) / 12;
      const w = Math.round(t * 12);
      px(cx2 - w, y, w * 2, 1, '#ccaa22');
    }
    // Exclamation mark
    px(cx2 - 1, my - 3, 2, 6, '#1a1a0a');
    px(cx2 - 1, my + 4, 2, 2, '#1a1a0a');
  },

  // === AREA MONITOR ===
  areaMonitor(p, px, dot, W, H, cy, C) {
    const my = cy - 4;
    // Detector body
    px(24, my - 2, 16, 10, C.metalDk);
    px(25, my - 1, 14, 8, '#1a1a2a');
    // GM tube inside
    px(28, my + 1, 8, 4, C.metal);
    dot(32, my + 2, C.hot);
    // Antenna
    px(31, my - 2, 2, 1, C.metal);
    px(32, my - 8, 1, 6, C.metal);
    // Signal arcs
    dot(34, my - 7, C.hotBright);
    dot(35, my - 6, C.hot);
    dot(36, my - 8, C.hot);
    // Display
    px(26, my + 5, 10, 3, '#0a1a0a');
    dot(28, my + 6, '#44ff44');
    dot(30, my + 6, '#44ff44');
    dot(32, my + 6, '#ff4444');
  },

  // === TIMING SYSTEM ===
  timingSystem(p, px, dot, W, H, cy, C) {
    const my = cy - 4;
    // Clock face
    for (let a = 0; a < Math.PI * 2; a += 0.12) {
      dot(Math.round(35 + Math.cos(a) * 9), Math.round(my + Math.sin(a) * 9), C.wall);
    }
    px(27, my - 7, 16, 15, '#0d0d1a');
    // Clock hands
    dot(35, my, '#ffffff');
    for (let i = 1; i <= 4; i++) dot(35, my - i, C.metal);
    for (let i = 1; i <= 5; i++) dot(35 + i, my - Math.round(i * 0.3), C.metalDk);
    // Tick marks
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      dot(Math.round(35 + Math.cos(a) * 7), Math.round(my + Math.sin(a) * 7), C.wallHi);
    }
  },

  // === LASER SYSTEM ===
  laserSystem(p, px, dot, W, H, cy, C) {
    const my = cy - 3;
    // Laser cavity
    px(12, my - 4, 28, 9, C.metalDk);
    px(13, my - 3, 26, 7, '#1a0d0d');
    // Gain medium
    px(16, my - 1, 20, 3, '#882244');
    // Mirrors
    px(14, my - 2, 1, 5, '#ccaa44');
    px(37, my - 2, 1, 5, C.metal);
    // Laser beam output
    for (let x = 38; x < W - 4; x++) {
      dot(x, my, '#ff2222');
      dot(x, my - 1, '#cc1111');
      dot(x, my + 1, '#cc1111');
    }
    // Pump source
    px(22, my - 4, 8, 1, '#44ff44');
  },

  // === LASER HEATER ===
  laserHeater(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
    // Laser beam crossing
    for (let y = 2; y < H - 2; y++) {
      const c = y === cy ? '#ffcc44' : '#ff4444';
      dot(35, y, c);
    }
    // Undulator section
    px(28, cy - 6, 3, 2, '#cc4444');
    px(28, cy + 5, 3, 2, '#4444cc');
    px(38, cy - 6, 3, 2, '#4444cc');
    px(38, cy + 5, 3, 2, '#cc4444');
    dot(35, cy, '#ffffff');
  },

  // === POWER PANEL ===
  powerPanel(p, px, dot, W, H, cy, C) {
    const my = cy - 3;
    px(18, my - 7, 24, 16, C.metalDk);
    px(19, my - 6, 22, 14, '#1a1a2a');
    // Breaker rows
    for (let y = my - 4; y <= my + 5; y += 3) {
      for (let x = 22; x <= 36; x += 4) {
        px(x, y, 2, 2, C.metal);
        dot(x + 1, y, (x + y) % 6 < 3 ? '#44ff44' : '#ff4444');
      }
    }
    // Bus bars
    px(21, my - 5, 1, 13, '#ccaa44');
    px(39, my - 5, 1, 13, '#ccaa44');
  },

  // === HV TRANSFORMER ===
  hvTransformer(p, px, dot, W, H, cy, C) {
    const my = cy - 3;
    // Transformer
    px(16, my - 7, 14, 15, C.metalDk);
    px(17, my - 6, 12, 13, '#1a1a2a');
    // Primary coil
    for (let y = my - 4; y <= my + 4; y += 2) dot(20, y, C.coil);
    // Core
    px(23, my - 5, 3, 11, C.metal);
    // Secondary coil
    for (let y = my - 4; y <= my + 4; y += 2) dot(27, y, C.coilDk);
    // HV bushings
    px(18, my - 9, 3, 2, '#cc4444');
    px(26, my - 9, 3, 2, '#cc4444');
    // Cooling fins
    for (let y = my - 4; y <= my + 4; y += 3) {
      px(36, y, 6, 1, C.metalDk);
    }
  },

  // === ION SOURCE ===
  ionSource(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C, { leftFlange: false });
    const L = 10, R = 46;
    // Plasma chamber
    px(L, cy - 9, R - L, 19, C.metalDk);
    px(L + 1, cy - 8, R - L - 2, 17, '#220d22');
    // Plasma glow
    px(L + 4, cy - 4, R - L - 8, 9, '#663388');
    dot(25, cy, '#aa66cc');
    dot(28, cy - 2, '#9955bb');
    dot(22, cy + 2, '#aa66cc');
    // Extraction electrode
    for (let dy = -6; dy <= 6; dy++) {
      if (Math.abs(dy) <= 2) continue;
      dot(R, cy + dy, C.metal);
    }
    // Ion beam out
    for (let x = R + 2; x < W - 4; x++) dot(x, cy, C.beam);
  },

  // === PROTON DIPOLE ===
  protonDipole(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    const L = 14, R = 56, T = cy - 12, B = cy + 12;
    px(L, T, R - L, 2, C.magnet);
    px(L, B - 1, R - L, 2, C.magnet);
    px(L, T, 2, B - T + 1, C.wallHi);
    px(L + 2, T + 2, R - L - 2, 2, C.magnetDk);
    px(L + 2, B - 3, R - L - 2, 2, C.magnetDk);
    px(L + 2, T + 4, 4, cy - T - 5, C.coil);
    px(L + 2, cy + 2, 4, B - cy - 5, C.coil);
    px(L + 6, cy - 4, R - L - 6, 9, '#0d0d22');
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
    // "p" marker
    dot(R - 6, T + 3, '#ffaa44');
  },

  // === PROTON QUAD ===
  protonQuad(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C);
    const cx = 35;
    px(cx - 8, cy - 11, 16, 5, C.magnet);
    px(cx - 5, cy - 7, 10, 3, C.magnetDk);
    px(cx - 8, cy + 7, 16, 5, C.magnet);
    px(cx - 5, cy + 5, 10, 3, C.magnetDk);
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
    dot(cx + 6, cy - 9, '#ffaa44');
  },

  // === SPOKE CAVITY ===
  spokeCavity(p, px, dot, W, H, cy, C) {
    const L = 14, R = 56;
    _drawBeamPipe(px, dot, W, cy, C, { skipFrom: L, skipTo: R });
    px(L, cy - 10, R - L, 1, C.scMagnet);
    px(L, cy + 10, R - L, 1, C.scMagnet);
    px(L, cy - 10, 1, 21, C.scMagDk);
    px(R, cy - 10, 1, 21, C.scMagDk);
    // Spoke bars
    for (const sx of [24, 35, 46]) {
      px(sx, cy - 8, 2, 17, C.scMagnet);
    }
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
  },

  // === HALF WAVE RESONATOR ===
  halfWaveResonator(p, px, dot, W, H, cy, C) {
    const L = 14, R = 56;
    _drawBeamPipe(px, dot, W, cy, C, { skipFrom: L, skipTo: R });
    px(L, cy - 10, R - L, 21, '#0d1a2a');
    px(L, cy - 10, R - L, 1, C.scMagnet);
    px(L, cy + 10, R - L, 1, C.scMagnet);
    // Half-wave shape
    for (let dx = 0; dx < R - L; dx++) {
      const t = dx / (R - L);
      const h = Math.round(7 * Math.sin(t * Math.PI));
      dot(L + dx, cy - h, C.scMagDk);
      dot(L + dx, cy + h, C.scMagDk);
    }
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
  },

  // === MAGNETRON ===
  magnetron(p, px, dot, W, H, cy, C) {
    const cx2 = 35, my = cy - 3;
    for (let a = 0; a < Math.PI * 2; a += 0.15) {
      dot(Math.round(cx2 + Math.cos(a) * 8), Math.round(my + Math.sin(a) * 8), C.wall);
    }
    px(28, my - 6, 14, 13, C.metalDk);
    // Cavities around circumference
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      dot(Math.round(cx2 + Math.cos(a) * 6), Math.round(my + Math.sin(a) * 6), C.hot);
    }
    // Central cathode
    dot(cx2, my, C.hotBright);
  },

  // === TWT ===
  twt(p, px, dot, W, H, cy, C) {
    const L = 10, R = 56, my = cy - 3;
    px(L, my - 4, R - L, 9, C.metalDk);
    px(L + 1, my - 3, R - L - 2, 7, '#1a1a2a');
    // Helix slow-wave structure
    for (let x = L + 3; x < R - 2; x += 2) {
      dot(x, my - 2, C.coil);
      dot(x + 1, my + 2, C.coil);
    }
    // Internal electron beam
    for (let x = L + 2; x < R - 1; x++) dot(x, my, C.pipeRF);
    // Gun
    px(L, my - 1, 3, 3, C.metal);
    // Collector
    px(R - 3, my - 2, 3, 5, C.metal);
  },

  // === BEAM DUMP ===
  beamDump(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C, { rightFlange: false });
    const L = 22, R = 54, my = cy - 3;
    // Large water-cooled absorber
    px(L, my - 8, R - L, 18, C.metalDk);
    px(L + 1, my - 7, R - L - 2, 16, C.metal);
    // Cooling channels
    for (let y = my - 6; y <= my + 6; y += 2) {
      px(L + 3, y, R - L - 6, 1, '#2255aa');
    }
    // Impact glow
    dot(L + 1, my, C.glow);
    dot(L + 2, my - 1, C.hot);
    dot(L + 2, my + 1, C.hot);
  },

  // === TARGET (shared sprite) ===
  target(p, px, dot, W, H, cy, C) {
    _drawBeamPipe(px, dot, W, cy, C, { rightFlange: false });
    const cx = 35;
    // Clear right side (no pipe or beam past target)
    px(cx + 4, 0, W - cx - 4, H, C.bg);
    // Target block
    px(cx - 3, cy - 8, 6, 17, C.metalDk);
    px(cx - 2, cy - 7, 4, 15, C.metal);
    // Solid beam in
    px(FLANGE_W + 2, cy, cx - 3 - FLANGE_W - 2, 1, C.beam);
    // Impact glow
    dot(cx - 2, cy, C.glow);
    dot(cx - 1, cy, C.hotBright);
  },

  // === TARGET HANDLING ===
  targetHandling(p, px, dot, W, H, cy, C) {
    const my = cy - 3;
    // Hot cell / shielded enclosure
    px(14, my - 7, 32, 17, '#666677');
    px(16, my - 5, 28, 13, '#0d0d22');
    // Manipulator arm
    px(22, my - 1, 14, 2, C.metal);
    px(35, my - 3, 2, 5, C.metalDk);
    // Gripper
    dot(36, my - 3, C.metal);
    dot(37, my - 4, C.metalDk);
    dot(37, my - 2, C.metalDk);
    // Target object
    px(26, my + 3, 4, 3, C.hot);
    // Shielded window
    px(18, my - 7, 6, 2, '#446688');
  },

  // === RAD WASTE STORAGE ===
  radWasteStorage(p, px, dot, W, H, cy, C) {
    const my = cy - 2;
    // Barrel/drum
    px(24, my - 7, 12, 16, '#ccaa22');
    px(25, my - 6, 10, 14, '#aa8811');
    // Radiation trefoil
    dot(30, my - 1, '#1a1a0a');
    dot(29, my + 1, '#1a1a0a');
    dot(31, my + 1, '#1a1a0a');
    dot(30, my + 3, '#1a1a0a');
    // Lid
    px(24, my - 7, 12, 2, C.metalDk);
    // Floor/pad
    px(20, my + 9, 20, 2, '#555566');
  },

};

// --- Tech Tree ---

UIHost.prototype._buildTreeLayout = function() {
  const NODE_W = 260;
  const NODE_H = 85;
  const H_GAP = 50;
  const V_GAP = 50;
  const COL_GAP = 70;
  const HEADER_H = 35;

  const categories = Object.keys(RESEARCH_CATEGORIES);
  const layout = {};
  let colX = 40;

  for (const cat of categories) {
    const items = Object.entries(RESEARCH).filter(
      ([, r]) => r.category === cat && !r.hidden
    );
    if (items.length === 0) continue;

    // Build adjacency: parent -> children
    const children = {};
    const roots = [];
    for (const [id] of items) {
      children[id] = [];
    }
    for (const [id, r] of items) {
      const reqs = r.requires
        ? (Array.isArray(r.requires) ? r.requires : [r.requires])
        : [];
      const inCatReqs = reqs.filter(req => RESEARCH[req]?.category === cat);
      if (inCatReqs.length === 0) {
        roots.push(id);
      }
      for (const req of inCatReqs) {
        if (children[req]) children[req].push(id);
      }
    }

    // BFS to assign depth
    const depth = {};
    const queue = [...roots];
    for (const r of roots) depth[r] = 0;
    while (queue.length > 0) {
      const id = queue.shift();
      for (const child of (children[id] || [])) {
        const d = depth[id] + 1;
        if (depth[child] === undefined || d > depth[child]) {
          depth[child] = d;
          queue.push(child);
        }
      }
    }

    // Group by depth
    const byDepth = {};
    let maxDepth = 0;
    for (const [id] of items) {
      const d = depth[id] ?? 0;
      if (!byDepth[d]) byDepth[d] = [];
      byDepth[d].push(id);
      if (d > maxDepth) maxDepth = d;
    }

    // Determine column width based on max items at any depth
    let maxBreadth = 1;
    for (const ids of Object.values(byDepth)) {
      if (ids.length > maxBreadth) maxBreadth = ids.length;
    }
    const colWidth = maxBreadth * (NODE_W + H_GAP) - H_GAP;

    // Assign positions
    for (let d = 0; d <= maxDepth; d++) {
      const ids = byDepth[d] || [];
      const totalW = ids.length * NODE_W + (ids.length - 1) * H_GAP;
      const startX = colX + (colWidth - totalW) / 2;
      for (let i = 0; i < ids.length; i++) {
        layout[ids[i]] = {
          x: startX + i * (NODE_W + H_GAP),
          y: HEADER_H + d * (NODE_H + V_GAP),
          col: cat,
        };
      }
    }

    layout['__header_' + cat] = {
      x: colX + colWidth / 2 - NODE_W / 2,
      y: 0,
      col: cat,
      isHeader: true,
      colWidth,
    };

    colX += colWidth + COL_GAP;
  }

  this._treeLayout = layout;
  this._treeCanvasWidth = colX;
  const maxY = Math.max(...Object.values(layout).filter(l => !l.isHeader).map(l => l.y));
  this._treeCanvasHeight = Math.max(maxY + NODE_H + 80, 400);
};

UIHost.prototype._renderTechTree = function() {
  const canvas = document.getElementById('tt-canvas');
  const svg = document.getElementById('tt-connectors');
  const tabsEl = document.getElementById('tt-category-tabs');
  const activeEl = document.getElementById('tt-active-research');
  if (!canvas || !svg || !tabsEl) return;

  if (!this._treeLayout) this._buildTreeLayout();
  const layout = this._treeLayout;

  const NODE_W = 260;
  const NODE_H = 85;

  canvas.style.width = this._treeCanvasWidth + 'px';
  canvas.style.height = this._treeCanvasHeight + 'px';
  svg.setAttribute('width', this._treeCanvasWidth);
  svg.setAttribute('height', this._treeCanvasHeight);
  svg.innerHTML = '';
  canvas.innerHTML = '';

  // Category tabs
  tabsEl.innerHTML = '';
  for (const [catId, cat] of Object.entries(RESEARCH_CATEGORIES)) {
    const tab = document.createElement('div');
    tab.className = 'tt-cat-tab';
    tab.textContent = cat.name;
    tab.style.setProperty('--cat-color', cat.color);
    tab.dataset.category = catId;
    tab.addEventListener('click', () => {
      this._scrollToCategory(catId);
      tabsEl.querySelectorAll('.tt-cat-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
    });
    tabsEl.appendChild(tab);
  }

  // Active research indicator
  if (this.game.state.activeResearch) {
    const r = RESEARCH[this.game.state.activeResearch];
    const pct = Math.min(100, Math.round((this.game.state.researchProgress / r.duration) * 100));
    activeEl.textContent = `Researching: ${r.name} (${pct}%)`;
  } else {
    activeEl.textContent = '';
  }

  // Draw connector lines (SVG)
  for (const [id, r] of Object.entries(RESEARCH)) {
    if (r.hidden || !r.category || !layout[id]) continue;
    const reqs = r.requires ? (Array.isArray(r.requires) ? r.requires : [r.requires]) : [];
    for (const reqId of reqs) {
      const parentPos = layout[reqId];
      const childPos = layout[id];
      if (!parentPos || !childPos) continue;

      const x1 = parentPos.x + NODE_W / 2;
      const y1 = parentPos.y + NODE_H;
      const x2 = childPos.x + NODE_W / 2;
      const y2 = childPos.y;
      const midY = (y1 + y2) / 2;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`);

      const completed = this.game.state.completedResearch.includes(id);
      const parentDone = this.game.state.completedResearch.includes(reqId);
      const available = this.game.isResearchAvailable(id);

      let cls = 'tt-connector ';
      if (completed) cls += 'completed';
      else if (available || parentDone) cls += 'available';
      else cls += 'locked';
      path.setAttribute('class', cls);

      svg.appendChild(path);
    }
  }

  // Draw column headers
  for (const [catId, cat] of Object.entries(RESEARCH_CATEGORIES)) {
    const hKey = '__header_' + catId;
    if (!layout[hKey]) continue;
    const h = document.createElement('div');
    h.className = 'tt-column-header';
    h.style.left = layout[hKey].x + 'px';
    h.style.top = '0px';
    h.style.color = cat.color;
    h.textContent = cat.name;
    h.dataset.category = catId;
    canvas.appendChild(h);
  }

  // Draw nodes
  for (const [id, r] of Object.entries(RESEARCH)) {
    if (r.hidden || !r.category || !layout[id]) continue;

    const pos = layout[id];
    const completed = this.game.state.completedResearch.includes(id);
    const isActive = this.game.state.activeResearch === id;
    const available = this.game.isResearchAvailable(id);

    const node = document.createElement('div');
    node.className = 'tt-node';
    node.style.left = pos.x + 'px';
    node.style.top = pos.y + 'px';
    node.dataset.researchId = id;

    if (completed) node.classList.add('completed');
    else if (isActive) node.classList.add('researching');
    else if (available) node.classList.add('available');
    else node.classList.add('locked');

    // Name
    const name = document.createElement('div');
    name.className = 'tt-node-name';
    name.textContent = r.name;
    if (completed) {
      const check = document.createElement('span');
      check.className = 'tt-check';
      check.textContent = '\u2713';
      name.appendChild(check);
    }
    node.appendChild(name);

    // Type indicator (unlock vs boost)
    const typeEl = document.createElement('div');
    typeEl.className = 'tt-node-type';
    if (r.unlocks) {
      typeEl.classList.add('unlock');
      const names = [];
      for (const c of r.unlocks) {
        if (COMPONENTS[c]) names.push(COMPONENTS[c].name);
      }
      if (names.length > 0) {
        typeEl.textContent = '\u25B8 ' + names.slice(0, 3).join(', ') + (names.length > 3 ? '...' : '');
      }
    } else if (r.effect) {
      typeEl.classList.add('boost');
      const effects = Object.entries(r.effect).map(([k, v]) => {
        if (k.endsWith('Mult')) return `${Math.round((1 - v) * 100)}% ${k.replace('Mult', '')} saving`;
        return `+${v} ${k}`;
      });
      typeEl.textContent = '\u2191 ' + effects.join(', ');
    }
    node.appendChild(typeEl);

    // Progress bar for active research
    if (isActive) {
      const prog = document.createElement('div');
      prog.className = 'tt-node-progress';
      const bar = document.createElement('div');
      bar.className = 'bar';
      const pct = Math.min(100, (this.game.state.researchProgress / r.duration) * 100);
      bar.style.width = pct + '%';
      prog.appendChild(bar);
      node.appendChild(prog);
    }

    // Click handler — all non-completed nodes (locked ones show info only)
    if (!completed) {
      node.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showResearchPopover(id, node);
      });
      node.style.cursor = 'pointer';
    }

    canvas.appendChild(node);
  }
};

UIHost.prototype._showResearchPopover = function(id, nodeEl) {
  const r = RESEARCH[id];
  const popover = document.getElementById('tt-popover');
  if (!popover) return;

  const available = this.game.isResearchAvailable(id);
  const isActive = this.game.state.activeResearch === id;

  const costs = Object.entries(r.cost).map(([k, v]) => {
    if (k === 'funding') return `$${v}`;
    if (k === 'reputation') return `${v} rep (threshold)`;
    return `${v} ${k}`;
  }).join(', ');

  let unlocksText = '';
  if (r.unlocks) {
    const names = r.unlocks.map(c => COMPONENTS[c]?.name).filter(Boolean);
    if (names.length) unlocksText = 'Unlocks: ' + names.join(', ');
  }
  if (r.effect) {
    const effects = Object.entries(r.effect).map(([k, v]) => {
      if (k.endsWith('Mult')) return `${Math.round((1 - v) * 100)}% ${k.replace('Mult', '')} saving`;
      return `+${v} ${k}`;
    });
    unlocksText += (unlocksText ? '\n' : '') + 'Effect: ' + effects.join(', ');
  }

  // Show prerequisite info for locked items
  let requiresText = '';
  if (!available && !isActive) {
    const reqs = r.requires ? (Array.isArray(r.requires) ? r.requires : [r.requires]) : [];
    const missing = reqs.filter(req => !this.game.state.completedResearch.includes(req));
    if (missing.length > 0) {
      const names = missing.map(req => RESEARCH[req]?.name || req);
      requiresText = 'Requires: ' + names.join(', ');
    }
  }

  // Lab speed info
  let labText = '';
  const speedMult = this.game.getResearchSpeedMultiplier(id);
  const labType = RESEARCH_LAB_MAP[r.category];
  if (labType) {
    const labName = ZONES[labType]?.name || labType;
    const labTier = this.game.getLabResearchTier(labType);
    if (speedMult === null) {
      const isFinal = this.game._computeFinalNodes().has(id);
      const minTier = isFinal ? 2 : 1;
      labText = `\u26D4 Requires ${labName} (Tier ${minTier}+)`;
    } else if (speedMult > 1) {
      labText = `\u26A0 ${speedMult}x slower \u2014 ${labName} Tier ${labTier} (upgrade for faster research)`;
    } else {
      labText = `${labName} Tier ${labTier}`;
    }
  }

  // Buttons: Research if available and not blocked, just Close otherwise
  const isBlocked = speedMult === null;
  let buttonsHtml;
  if (available && !isActive && !isBlocked) {
    buttonsHtml = `
      <button class="tt-btn-research" id="tt-btn-start">Research</button>
      <button class="tt-btn-cancel" id="tt-btn-close">Close</button>
    `;
  } else {
    buttonsHtml = `<button class="tt-btn-cancel" id="tt-btn-close">Close</button>`;
  }

  popover.innerHTML = `
    <div class="tt-popover-name">${r.name}</div>
    <div class="tt-popover-desc">${r.desc}</div>
    ${unlocksText ? `<div class="tt-popover-unlocks">${unlocksText}</div>` : ''}
    ${requiresText ? `<div class="tt-popover-requires">${requiresText}</div>` : ''}
    ${labText ? `<div class="tt-popover-lab" style="color:${speedMult === null ? '#c44' : speedMult > 1 ? '#ca4' : '#8c8'};font-size:11px;margin:4px 0">${labText}</div>` : ''}
    <div class="tt-popover-cost">Cost: ${costs} | ${r.duration}s${speedMult && speedMult > 1 ? ` (effective: ${Math.round(r.duration * speedMult)}s)` : ''}</div>
    <div class="tt-popover-buttons">
      ${buttonsHtml}
    </div>
  `;

  // Position popover near the node
  const rect = nodeEl.getBoundingClientRect();
  popover.style.left = (rect.right + 8) + 'px';
  popover.style.top = rect.top + 'px';

  popover.classList.remove('hidden');
  const popRect = popover.getBoundingClientRect();
  if (popRect.right > window.innerWidth) {
    popover.style.left = (rect.left - popRect.width - 8) + 'px';
  }
  if (popRect.bottom > window.innerHeight) {
    popover.style.top = (window.innerHeight - popRect.height - 8) + 'px';
  }

  const startBtn = document.getElementById('tt-btn-start');
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      this.game.startResearch(id);
      popover.classList.add('hidden');
    });
  }
  document.getElementById('tt-btn-close').addEventListener('click', () => {
    popover.classList.add('hidden');
  });
};

UIHost.prototype._scrollToCategory = function(catId) {
  const hKey = '__header_' + catId;
  const pos = this._treeLayout?.[hKey];
  if (!pos) return;

  const wrapper = document.getElementById('tt-canvas-wrapper');
  if (!wrapper) return;

  const wrapperW = wrapper.clientWidth;
  const targetX = pos.x + 130 - wrapperW / 2;

  this._treePanX = -targetX * this._treeZoom;
  this._treePanY = 0;
  this._applyTreeTransform();
};

UIHost.prototype._applyTreeTransform = function() {
  const canvas = document.getElementById('tt-canvas');
  const svg = document.getElementById('tt-connectors');
  if (!canvas || !svg) return;
  const tx = `translate(${this._treePanX}px, ${this._treePanY}px) scale(${this._treeZoom})`;
  canvas.style.transform = tx;
  svg.style.transform = tx;
};

UIHost.prototype._updateTreeProgress = function() {
  const overlay = document.getElementById('research-overlay');
  if (!overlay || overlay.classList.contains('hidden')) return;
  if (!this.game.state.activeResearch) return;

  const r = RESEARCH[this.game.state.activeResearch];
  if (!r) return;
  const pct = Math.min(100, (this.game.state.researchProgress / r.duration) * 100);

  const node = document.querySelector(`.tt-node[data-research-id="${this.game.state.activeResearch}"]`);
  if (node) {
    const bar = node.querySelector('.tt-node-progress .bar');
    if (bar) bar.style.width = pct + '%';
  }

  const activeEl = document.getElementById('tt-active-research');
  if (activeEl) {
    const speedMult = this.game.getResearchSpeedMultiplier(this.game.state.activeResearch) || 1;
    const speedLabel = speedMult > 1 ? ` [${speedMult}x slower]` : '';
    activeEl.textContent = `Researching: ${r.name} (${Math.round(pct)}%)${speedLabel}`;
  }
};

UIHost.prototype._bindTreeEvents = function() {
  const wrapper = document.getElementById('tt-canvas-wrapper');
  if (!wrapper) return;

  wrapper.addEventListener('mousedown', (e) => {
    if (e.target.closest('.tt-node') || e.target.closest('.tt-popover')) return;
    this._treeDragging = true;
    this._treeDragStartX = e.clientX - this._treePanX;
    this._treeDragStartY = e.clientY - this._treePanY;
    const popover = document.getElementById('tt-popover');
    if (popover) popover.classList.add('hidden');
  });

  window.addEventListener('mousemove', (e) => {
    if (!this._treeDragging) return;
    this._treePanX = e.clientX - this._treeDragStartX;
    this._treePanY = e.clientY - this._treeDragStartY;
    this._applyTreeTransform();
  });

  window.addEventListener('mouseup', () => {
    this._treeDragging = false;
  });

  wrapper.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomSpeed = 0.001;
    const oldZoom = this._treeZoom;
    this._treeZoom = Math.max(0.4, Math.min(1.8, this._treeZoom - e.deltaY * zoomSpeed));

    const rect = wrapper.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const scale = this._treeZoom / oldZoom;
    this._treePanX = cx - scale * (cx - this._treePanX);
    this._treePanY = cy - scale * (cy - this._treePanY);

    this._applyTreeTransform();
  }, { passive: false });

  // Esc closes the research overlay via the global esc-stack. Registered
  // once as a permanent *conditional* handler (the overlay is toggled by
  // classList from several sites, so per-open push/unsub has no single
  // choke point): returning false while hidden passes Esc down the stack.
  // Sits above the game input layer's fallback ladder regardless of
  // construction order, so an open tech tree beats tool disarm.
  if (!this._researchEscUnsub) {
    this._researchEscUnsub = pushEscHandler(() => {
      const overlay = document.getElementById('research-overlay');
      if (overlay && !overlay.classList.contains('hidden')) {
        overlay.classList.add('hidden');
        return true;
      }
      return false;
    });
  }
};

// --- Goals overlay ---

UIHost.prototype._renderGoalsOverlay = function() {
  const list = document.getElementById('goals-list');
  if (!list) return;
  list.innerHTML = '';

  const state = this.game.state;

  let completedCount = 0;
  let firstIncomplete = null;
  const completedSet = new Set();
  for (const step of TUTORIAL_STEPS) {
    let done = false;
    try { done = step.condition(state); } catch (_) {}
    if (done) {
      completedCount++;
      completedSet.add(step.id);
    } else if (!firstIncomplete) {
      firstIncomplete = step.id;
    }
  }

  // Summary / progress header
  const summary = document.createElement('div');
  summary.className = 'goals-progress';
  const total = TUTORIAL_STEPS.length;
  const pct = total > 0 ? Math.round((completedCount / total) * 100) : 0;
  summary.innerHTML =
    `<div class="goals-progress-label">` +
    `<span>${completedCount === total ? 'All Done!' : 'Getting Started'}</span>` +
    `<span class="goals-progress-count">${completedCount}/${total}</span>` +
    `</div>` +
    `<div class="goals-progress-bar"><div class="goals-progress-fill" style="width:${pct}%"></div></div>`;
  list.appendChild(summary);

  // Grouped checklist
  for (const group of TUTORIAL_GROUPS) {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'tut-group';
    const title = document.createElement('div');
    title.className = 'tut-group-name';
    title.textContent = group.name;
    groupDiv.appendChild(title);

    for (const step of TUTORIAL_STEPS.filter(s => s.group === group.id)) {
      const stepDiv = document.createElement('div');
      stepDiv.className = 'tut-step';
      if (completedSet.has(step.id)) stepDiv.classList.add('completed');
      if (step.id === firstIncomplete) stepDiv.classList.add('next');

      const check = document.createElement('span');
      check.className = 'tut-check';
      check.textContent = completedSet.has(step.id) ? '\u2713' : '\u25cb';
      stepDiv.appendChild(check);

      const nameWrap = document.createElement('span');
      nameWrap.className = 'tut-name';
      nameWrap.textContent = step.name;
      const hint = document.createElement('span');
      hint.className = 'tut-hint';
      hint.textContent = step.hint;
      nameWrap.appendChild(hint);
      stepDiv.appendChild(nameWrap);

      groupDiv.appendChild(stepDiv);
    }

    list.appendChild(groupDiv);
  }

  // Objectives. The tutorial checklist is guidance, not the reward layer —
  // OBJECTIVES carries the actual funding/reputation milestones, and until
  // now it had no UI at all (the only signal was a log line nothing renders).
  const completedObjectives = new Set(state.completedObjectives || []);
  const objHeader = document.createElement('div');
  objHeader.className = 'goals-progress';
  objHeader.innerHTML =
    `<div class="goals-progress-label">` +
    `<span>Objectives</span>` +
    `<span class="goals-progress-count">${completedObjectives.size}/${OBJECTIVES.length}</span>` +
    `</div>` +
    `<div class="goals-progress-bar"><div class="goals-progress-fill" ` +
    `style="width:${Math.round((completedObjectives.size / OBJECTIVES.length) * 100)}%"></div></div>`;
  list.appendChild(objHeader);

  for (const [tier, tierName] of OBJECTIVE_TIER_NAMES) {
    const objs = OBJECTIVES.filter(o => (o.tier || 0) === tier);
    if (objs.length === 0) continue;
    const groupDiv = document.createElement('div');
    groupDiv.className = 'tut-group';
    const title = document.createElement('div');
    title.className = 'tut-group-name';
    title.textContent = `Tier ${tier} — ${tierName}`;
    groupDiv.appendChild(title);

    for (const obj of objs) {
      const done = completedObjectives.has(obj.id);
      const item = document.createElement('div');
      item.className = 'objective-item' + (done ? ' completed' : '');
      const name = document.createElement('div');
      name.className = 'obj-name';
      name.textContent = (done ? '✓ ' : '○ ') + obj.name;
      const desc = document.createElement('div');
      desc.className = 'obj-desc';
      desc.textContent = obj.desc;
      const reward = document.createElement('div');
      reward.className = 'obj-reward';
      reward.textContent = objectiveRewardText(obj.reward);
      item.appendChild(name);
      item.appendChild(desc);
      item.appendChild(reward);
      groupDiv.appendChild(item);
    }
    list.appendChild(groupDiv);
  }
};

// Tier labels mirror the section comments in src/data/objectives.js.
const OBJECTIVE_TIER_NAMES = [
  [0, 'Getting Started'],
  [1, 'Basic Competence'],
  [2, 'Real Facility'],
  [3, 'World Class'],
  [4, 'Frontier'],
  [5, 'Legacy'],
];

function objectiveRewardText(reward) {
  const parts = [];
  if (reward?.funding) parts.push('$' + reward.funding.toLocaleString());
  if (reward?.reputation) parts.push(`+${reward.reputation} rep`);
  if (reward?.data) parts.push(`+${reward.data} data`);
  return parts.length ? 'Reward: ' + parts.join(' · ') : '';
}

// ---------------------------------------------------------------------------
// Beamline context windows
// ---------------------------------------------------------------------------

UIHost.prototype._openBeamlineWindow = function(beamlineId, anchorNode) {
  if (!this._beamlineWindows) this._beamlineWindows = {};
  if (this._beamlineWindows[beamlineId]) {
    this._beamlineWindows[beamlineId].ctx.focus();
    return;
  }
  const bw = new BeamlineWindow(this.game, beamlineId);
  this._beamlineWindows[beamlineId] = bw;

  // Anchor the window: to the clicked node if provided, else the beamline's
  // centroid (fallback for programmatic opens that don't know a click origin).
  const entry = this.game.registry.get(beamlineId);
  if (entry && bw.ctx) {
    const tiles = anchorNode
      ? (anchorNode.cells || [{ col: anchorNode.col, row: anchorNode.row }])
      : this.game.state.placeables
          .filter(p => p.beamlineId === beamlineId)
          .flatMap(p => p.cells || [{ col: p.col, row: p.row }]);
    if (tiles.length > 0) {
      let sumX = 0, sumY = 0, sumCol = 0, sumRow = 0;
      for (const t of tiles) {
        const iso = tileCenterIso(t.col, t.row);
        sumX += iso.x;
        sumY += iso.y;
        sumCol += t.col + 0.5;
        sumRow += t.row + 0.5;
      }
      const n = tiles.length;
      // Anchor slightly above and to the right of the target tile(s)
      bw.ctx.setWorldAnchor(sumX / n + 60, sumY / n - 80);
      bw.ctx.setTileAnchor(sumCol / n, sumRow / n, 60, -80);
      bw.ctx.updateScreenPosition(this.world.x, this.world.y, this.zoom);
    }
  }

  const origClose = bw.ctx._onClose;
  bw.ctx._onClose = () => {
    delete this._beamlineWindows[beamlineId];
    if (origClose) origClose();
  };
};

// --- Equipment context windows ---

UIHost.prototype._openEquipmentWindow = function(equip) {
  if (!this._equipmentWindows) this._equipmentWindows = {};
  if (this._equipmentWindows[equip.id]) {
    this._equipmentWindows[equip.id].ctx.focus();
    return;
  }
  const input = this.renderer?._inputHandler;
  const ew = new EquipmentWindow(this.game, equip, {
    onPlace: id => input?._beginSelectionPlacement('move', id),
    onCopy: id => input?._beginSelectedCopy(id),
    onDemolish: id => input?._demolishSelected(id),
    getSelectionCount: id => input?._selectionIdsForAnchor(id).length || 1,
  });
  if (!ew.ctx) return;
  this._equipmentWindows[equip.id] = ew;

  // Anchor to equipment tile
  const iso = tileCenterIso(equip.col, equip.row);
  ew.ctx.setWorldAnchor(iso.x + 40, iso.y - 60);
  ew.ctx.setTileAnchor(equip.col + 0.5, equip.row + 0.5, 40, -60);
  ew.ctx.updateScreenPosition(this.world.x, this.world.y, this.zoom);

  const origClose = ew.ctx._onClose;
  ew.ctx._onClose = () => {
    delete this._equipmentWindows[equip.id];
    if (origClose) origClose();
  };
};

/** Close only the anchored info window belonging to a placeable being moved. */
UIHost.prototype._closePlaceableInfoWindow = function(entry) {
  if (!entry) return;
  if (entry.category === 'beamline') {
    this._beamlineWindows?.[entry.beamlineId]?.ctx?.close();
    return;
  }
  this._equipmentWindows?.[entry.id]?.ctx?.close();
};

UIHost.prototype._refreshContextWindows = function() {
  // Only refresh content here — position tracking is owned by the
  // renderer's per-frame ThreeRenderer._updateAnchoredWindows. Calling
  // updateScreenPosition here would use the 2D PIXI projection, which is
  // wrong under 3D rotation/pitch and fights the per-frame 3D projection,
  // causing flicker while panning and stutter while dragging.
  if (this._beamlineWindows) {
    for (const bw of Object.values(this._beamlineWindows)) bw.refresh();
  }
  if (this._equipmentWindows) {
    for (const ew of Object.values(this._equipmentWindows)) ew.refresh();
  }
};

// (Position tracking for anchored windows is owned by the renderer's
// per-frame ThreeRenderer._updateAnchoredWindows, which projects each
// window's tile anchor through the 3D camera. The old 2D pan/zoom variant
// that lived here was dead code — nothing called it with a UIHost
// receiver — and used the wrong (PIXI) projection under 3D rotation.)
