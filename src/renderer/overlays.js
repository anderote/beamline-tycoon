// === OVERLAYS EXTENSION ===
// Adds component popup, tech tree, and goals overlay rendering to Renderer.prototype.
// Note: PIXI is a CDN global — not imported.

import { Renderer, _pxText } from './Renderer.js';
import { COMPONENTS } from '../data/components.js';
import { RESEARCH, RESEARCH_CATEGORIES, RESEARCH_LAB_MAP } from '../data/research.js';
import { OBJECTIVES } from '../data/objectives.js';
import { MACHINES } from '../data/machines.js';
import { MachineWindow } from '../ui/MachineWindow.js';
import { ZONES } from '../data/infrastructure.js';
import { formatEnergy } from '../data/units.js';
import { DIR_NAMES } from '../data/directions.js';
import { PARAM_DEFS, computeStats } from '../beamline/component-physics.js';

// --- Component popup ---

Renderer.prototype.showPopup = function(node, screenX, screenY) {
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
    html += row('Energy Cost', comp.energyCost, 'kW');
    html += row('Length', comp.length, 'm');
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
      this.drawSchematic(popupSchematic, node.type);
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
      this.game.removeComponent(node.id);
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
};

Renderer.prototype._paramLabel = function(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
};

Renderer.prototype._fmtParam = function(val) {
  if (val === undefined || val === null) return '--';
  if (Math.abs(val) >= 100) return val.toFixed(0);
  if (Math.abs(val) >= 1) return val.toFixed(2);
  if (Math.abs(val) >= 0.01) return val.toFixed(3);
  return val.toExponential(2);
};

Renderer.prototype._wirePopupSliders = function(node, paramDefs, body) {
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

Renderer.prototype.showFacilityPopup = function(equip, comp, screenX, screenY) {
  const popup = document.getElementById('component-popup');
  if (!popup) return;

  const title = popup.querySelector('.popup-title');
  if (title) title.textContent = comp.name;

  const body = popup.querySelector('.popup-body');
  if (body) {
    let html = `<div class="popup-stats">`;
    html += `<div>Type: ${comp.name}</div>`;
    html += `<div>Category: ${comp.category}</div>`;
    html += `<div>Energy Cost: ${comp.energyCost} kW</div>`;
    html += `</div>`;
    html += `<div class="popup-actions"><button class="btn-danger" id="popup-remove-facility-btn">Remove (50% refund)</button></div>`;
    body.innerHTML = html;

    document.getElementById('popup-remove-facility-btn')?.addEventListener('click', () => {
      this.game.removeFacilityEquipment(equip.id);
      this.hidePopup();
    });
  }

  popup.style.left = Math.min(screenX + 10, window.innerWidth - 220) + 'px';
  popup.style.top = Math.min(screenY + 10, window.innerHeight - 200) + 'px';
  popup.classList.remove('hidden');

  const closeBtn = popup.querySelector('.popup-close');
  if (closeBtn) closeBtn.onclick = () => this.hidePopup();
};

Renderer.prototype.hidePopup = function() {
  const popup = document.getElementById('component-popup');
  if (popup) popup.classList.add('hidden');
};

// --- Schematic drawing ---

Renderer.prototype.drawSchematic = function(canvas, componentType) {
  // We draw at a tiny resolution (70x30 pixels) then scale up crispy
  const PW = 70, PH = 30;
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
    pipeVacuum:  '#999999',
    pipeCooling: '#4488cc',
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
      cryoTransfer: C.pipeCryo,
      dataFiber:    C.pipeData,
      vacuumPipe:   C.pipeVacuum,
    };
    // Valve-bearing connection types (fluid lines)
    const valveConns = new Set(['coolingWater', 'cryoTransfer', 'vacuumPipe']);
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
    // Cooling distribution/plant: produces cooling water output
    if (comp.category === 'cooling' && comp.subsection !== 'cryogenics' && !uniqueConns.includes('coolingWater')) {
      uniqueConns.push('coolingWater');
    }
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
  if (drawFn) drawFn(p, px, dot, PW, PH, cy, C);

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

Renderer.prototype._schematicDrawers = {
  // === SOURCE (cathode ray / electron gun style) ===
  source(p, px, dot, W, H, cy, C) {
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

    // --- Electron beam envelope ---
    for (const startDy of [-6, -3, 0, 3, 6]) {
      for (let x = cathX + 4; x <= W - 4; x++) {
        let y;
        if (x <= anodeX) {
          const t = (x - cathX - 4) / (anodeX - cathX - 4);
          y = cy + Math.round(startDy * (1 - t * 0.85));
        } else {
          const t2 = (x - anodeX) / (W - 4 - anodeX);
          const residual = Math.round(startDy * 0.15 * (1 - t2 * 0.5));
          y = cy + residual;
        }
        if (y >= 1 && y < H - 1) {
          dot(x, y, startDy === 0 ? C.beam : C.beamDim);
        }
      }
    }

  },

  // === DRIFT TUBE ===
  drift(p, px, dot, W, H, cy, C) {
    const L = 10, R = 60, T = cy - 6, B = cy + 6;
    px(L, T, R - L, 1, C.wall);
    px(L, B, R - L, 1, C.wall);
    px(L, T - 2, 1, B - T + 5, C.wallHi);
    px(L + 1, T - 2, 1, B - T + 5, C.wallDk);
    px(R, T - 2, 1, B - T + 5, C.wallHi);
    px(R - 1, T - 2, 1, B - T + 5, C.wallDk);
    for (const [dx, dy] of [[18, -2], [30, 1], [42, -3], [25, 3], [50, -1], [37, 2]]) {
      dot(L + dx - 8, cy + dy, '#1a1a33');
    }
    dot(L, T - 1, C.metal);
    dot(L, B + 1, C.metal);
    dot(R, T - 1, C.metal);
    dot(R, B + 1, C.metal);

  },

  // === BELLOWS ===
  bellows(p, px, dot, W, H, cy, C) {
    const L = 14, R = 56, T = cy - 7, B = cy + 7;
    px(L, T - 1, 2, B - T + 3, C.wallHi);
    px(R, T - 1, 2, B - T + 3, C.wallHi);
    const folds = 8;
    const step = (R - L - 4) / folds;
    for (let i = 0; i < folds; i++) {
      const x = L + 2 + Math.floor(i * step);
      const bulge = (i % 2 === 0) ? -2 : 0;
      px(x, T + bulge, Math.ceil(step), 1, C.wall);
      px(x, B - bulge, Math.ceil(step), 1, C.wall);
      if (i > 0) {
        const px2 = L + 2 + Math.floor(i * step);
        const prevBulge = ((i - 1) % 2 === 0) ? -2 : 0;
        const curBulge = (i % 2 === 0) ? -2 : 0;
        const yTop = Math.min(T + prevBulge, T + curBulge);
        const yBot = T + Math.max(prevBulge, curBulge);
        px(px2, yTop, 1, yBot - yTop + 1, C.wallDk);
        const yBotA = Math.min(B - prevBulge, B - curBulge);
        const yBotB = B - Math.min(prevBulge, curBulge);
        px(px2, yBotA, 1, yBotB - yBotA + 1, C.wallDk);
      }
    }

  },

  // === DIPOLE ===
  dipole(p, px, dot, W, H, cy, C) {
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
  quadrupole(p, px, dot, W, H, cy, C) {
    const cx = 35;
    px(10, cy - 3, 50, 1, C.wallDk);
    px(10, cy + 3, 50, 1, C.wallDk);
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

    for (let x = 4; x < W - 4; x++) {
      const t = (x - 4) / (W - 8);
      let y;
      if (t < 0.45) {
        y = cy - 5 + Math.round(t / 0.45 * 4);
      } else if (t < 0.55) {
        y = cy - 1;
      } else {
        y = cy - 1 + Math.round((t - 0.55) / 0.45 * 1);
      }
      dot(x, y, C.beamDim);
    }
    for (let x = 4; x < W - 4; x++) {
      dot(x, cy, C.beam);
    }
    for (let x = 4; x < W - 4; x++) {
      const t = (x - 4) / (W - 8);
      let y;
      if (t < 0.45) {
        y = cy + 5 - Math.round(t / 0.45 * 4);
      } else if (t < 0.55) {
        y = cy + 1;
      } else {
        y = cy + 1 - Math.round((t - 0.55) / 0.45 * 1);
      }
      dot(x, y, C.beamDim);
    }

  },

  // === SOLENOID ===
  solenoid(p, px, dot, W, H, cy, C) {
    const L = 12, R = 58;
    px(L, cy - 9, R - L, 1, C.coil);
    px(L, cy + 9, R - L, 1, C.coil);
    for (let x = L + 2; x < R - 1; x += 3) {
      px(x, cy - 9, 1, 19, C.coilDk);
      px(x + 1, cy - 8, 1, 17, '#aa6633');
    }
    px(L - 1, cy - 3, R - L + 2, 1, C.wallDk);
    px(L - 1, cy + 3, R - L + 2, 1, C.wallDk);

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

    for (let x = 4; x < W - 4; x++) {
      const t = (x - 4) / (W - 8);
      let y;
      if (t < 0.42) {
        y = cy - 6 + Math.round(t / 0.42 * 5);
      } else if (t < 0.58) {
        y = cy - 1;
      } else {
        y = cy - 1 + Math.round((t - 0.58) / 0.42 * 1);
      }
      dot(x, y, C.beamDim);
    }
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
    for (let x = 4; x < W - 4; x++) {
      const t = (x - 4) / (W - 8);
      let y;
      if (t < 0.42) {
        y = cy + 6 - Math.round(t / 0.42 * 5);
      } else if (t < 0.58) {
        y = cy + 1;
      } else {
        y = cy + 1 - Math.round((t - 0.58) / 0.42 * 1);
      }
      dot(x, y, C.beamDim);
    }

  },

  // === RF CAVITY ===
  rfCavity(p, px, dot, W, H, cy, C) {
    const L = 10, R = 60;
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
    // Beam pipe
    px(L, cy - 2, R - L, 1, C.wallDk);
    px(L, cy + 2, R - L, 1, C.wallDk);
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

  // === SPLITTER ===
  splitter(p, px, dot, W, H, cy, C) {
    // Incoming beam
    for (let x = 4; x < 30; x++) dot(x, cy, C.beam);
    // Junction point
    dot(30, cy, '#ffffff');
    // Upper branch
    for (let x = 30; x < W - 4; x++) {
      const t = (x - 30) / (W - 34);
      const y = Math.round(cy - t * 8);
      dot(x, y, C.beamDim);
      if (y > 0) { dot(x, y - 1, '#0d0d22'); }
    }
    // Lower branch
    for (let x = 30; x < W - 4; x++) {
      const t = (x - 30) / (W - 34);
      const y = Math.round(cy + t * 8);
      dot(x, y, C.beamDim);
    }
    // Septum magnet at split
    px(29, cy - 2, 2, 5, C.magnetDk);
    dot(30, cy - 1, C.magnetLt);
    dot(30, cy + 1, C.magnetLt);
  },

  // === APERTURE / COLLIMATOR ===
  aperture(p, px, dot, W, H, cy, C) {
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
    // Beam pipe walls
    px(10, cy - 3, cx - 12, 1, C.wallDk);
    px(10, cy + 3, cx - 12, 1, C.wallDk);
    px(cx + 4, cy - 3, 20, 1, C.wallDk);
    px(cx + 4, cy + 3, 20, 1, C.wallDk);
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
    const L = 14, R = 56;
    // E-field plates (top/bottom)
    px(L, cy - 8, R - L, 2, '#cc4444');
    px(L, cy + 7, R - L, 2, '#4444cc');
    // B-field indicators (perpendicular dots)
    for (let x = L + 4; x < R - 2; x += 5) {
      dot(x, cy - 5, C.magnetLt);
      dot(x, cy + 5, C.magnetLt);
    }
    // Beam pipe
    px(L - 2, cy - 3, R - L + 4, 1, C.wallDk);
    px(L - 2, cy + 3, R - L + 4, 1, C.wallDk);
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
    // Beam pipe walls
    px(L - 1, cy - 4, R - L + 2, 1, C.wallDk);
    px(L - 1, cy + 4, R - L + 2, 1, C.wallDk);
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
    const cx = 35;
    // Two jaws
    px(cx - 1, cy - 12, 2, 9, C.metal);
    px(cx - 1, cy + 4, 2, 9, C.metal);
    // Jaw tips
    dot(cx - 1, cy - 3, C.metalDk);
    dot(cx, cy - 3, C.metalDk);
    dot(cx - 1, cy + 3, C.metalDk);
    dot(cx, cy + 3, C.metalDk);
    // Beam pipe
    px(10, cy - 2, 50, 1, C.wallDk);
    px(10, cy + 2, 50, 1, C.wallDk);
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
  },

  // === CRYOMODULE ===
  cryomodule(p, px, dot, W, H, cy, C) {
    const L = 6, R = 64;
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
    // Beam pipe
    px(10, cy - 3, 50, 1, C.wallDk);
    px(10, cy + 3, 50, 1, C.wallDk);
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
    const cx = 35;
    // Small H/V corrector coils
    px(cx - 5, cy - 7, 3, 4, '#cc6644');
    px(cx + 3, cy - 7, 3, 4, '#cc6644');
    px(cx - 5, cy + 4, 3, 4, '#4466cc');
    px(cx + 3, cy + 4, 3, 4, '#4466cc');
    // Beam pipe
    px(10, cy - 3, 50, 1, C.wallDk);
    px(10, cy + 3, 50, 1, C.wallDk);
    // Correction arrows
    dot(cx, cy - 5, '#ffaa44');
    dot(cx, cy - 6, '#ffaa44');
    dot(cx - 1, cy - 5, '#ffaa44');
    dot(cx + 1, cy - 5, '#ffaa44');
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
  },

  // === OCTUPOLE ===
  octupole(p, px, dot, W, H, cy, C) {
    const cx = 35;
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      const pr = 9;
      const tipX = Math.round(cx + Math.cos(angle) * pr);
      const tipY = Math.round(cy + Math.sin(angle) * pr * 0.85);
      const color = i % 2 === 0 ? '#cc4444' : '#4444cc';
      px(tipX - 1, tipY - 1, 2, 2, color);
    }
    px(10, cy - 3, 50, 1, C.wallDk);
    px(10, cy + 3, 50, 1, C.wallDk);
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
  },

  // === SC QUAD ===
  scQuad(p, px, dot, W, H, cy, C) {
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
    px(10, cy - 3, 50, 1, C.wallDk);
    px(10, cy + 3, 50, 1, C.wallDk);
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
  },

  // === SC DIPOLE ===
  scDipole(p, px, dot, W, H, cy, C) {
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
    const cx = 35;
    // Four button pickups around beam pipe
    px(10, cy - 4, 50, 1, C.wallDk);
    px(10, cy + 4, 50, 1, C.wallDk);
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
    // Beam pipe
    px(10, cy - 3, 50, 1, C.wallDk);
    px(10, cy + 3, 50, 1, C.wallDk);
  },

  // === ICT ===
  ict(p, px, dot, W, H, cy, C) {
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
    const cx = 35;
    // Wire crossing beam
    for (let i = -6; i <= 6; i++) {
      dot(cx + Math.round(i * 0.4), cy + i, C.metal);
    }
    // Fork mount
    px(cx - 4, cy - 10, 2, 5, C.metalDk);
    px(cx + 3, cy - 10, 2, 5, C.metalDk);
    px(cx - 4, cy - 11, 10, 1, C.metal);
    // Beam pipe
    px(10, cy - 3, 50, 1, C.wallDk);
    px(10, cy + 3, 50, 1, C.wallDk);
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
  },

  // === BUNCH LENGTH MONITOR ===
  bunchLengthMonitor(p, px, dot, W, H, cy, C) {
    // Beam pipe
    px(10, cy - 3, 50, 1, C.wallDk);
    px(10, cy + 3, 50, 1, C.wallDk);
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
    const cx = 35;
    // Ionization chamber
    px(cx - 4, cy - 8, 8, 16, C.metalDk);
    px(cx - 3, cy - 7, 6, 14, '#1a1a33');
    // Electrodes inside
    px(cx - 2, cy - 6, 1, 12, '#ccaa44');
    px(cx + 2, cy - 6, 1, 12, '#ccaa44');
    // Cable out
    px(cx, cy - 8, 1, -4, C.coil);
    // Beam pipe (beam passes by, not through)
    px(10, cy - 3, 50, 1, C.wallDk);
    px(10, cy + 3, 50, 1, C.wallDk);
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
    // Radiation particles hitting detector
    dot(cx - 1, cy - 4, C.glow);
    dot(cx + 1, cy + 2, C.glow);
  },

  // === SR LIGHT MONITOR ===
  srLightMonitor(p, px, dot, W, H, cy, C) {
    // Beam pipe
    px(10, cy - 3, 50, 1, C.wallDk);
    px(10, cy + 3, 50, 1, C.wallDk);
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
    px(L - 1, cy - 3, R - L + 2, 1, C.wallDk);
    px(L - 1, cy + 3, R - L + 2, 1, C.wallDk);
    // Helical beam
    for (let x = 4; x < W - 4; x++) {
      const phase = (x - L) / (R - L) * nBlocks * Math.PI;
      const dy = Math.round(Math.sin(phase) * 2);
      dot(x, cy + dy, C.beam);
    }
  },

  // === WIGGLER ===
  wiggler(p, px, dot, W, H, cy, C) {
    const L = 10, R = 60;
    const nBlocks = 5;
    const step = (R - L) / nBlocks;
    for (let i = 0; i < nBlocks; i++) {
      const x = L + Math.floor(i * step);
      const w = Math.max(2, Math.floor(step) - 1);
      px(x, cy - 11, w, 5, i % 2 === 0 ? '#cc4444' : '#4444cc');
      px(x, cy + 7, w, 5, i % 2 === 0 ? '#4444cc' : '#cc4444');
    }
    px(L - 1, cy - 4, R - L + 2, 1, C.wallDk);
    px(L - 1, cy + 4, R - L + 2, 1, C.wallDk);
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
    px(L - 1, cy - 4, R - L + 2, 1, C.wallDk);
    px(L - 1, cy + 4, R - L + 2, 1, C.wallDk);
    for (let x = 4; x < W - 4; x++) {
      const phase = (x - L) / (R - L) * nBlocks * Math.PI;
      dot(x, cy + Math.round(Math.sin(phase) * 2), C.beam);
    }
  },

  // === KICKER MAGNET ===
  kickerMagnet(p, px, dot, W, H, cy, C) {
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

  // === SEPTUM MAGNET ===
  septumMagnet(p, px, dot, W, H, cy, C) {
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

  // === STRIPPER FOIL ===
  stripperFoil(p, px, dot, W, H, cy, C) {
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
    // Beam pipe
    px(10, cy - 3, 50, 1, C.wallDk);
    px(10, cy + 3, 50, 1, C.wallDk);
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
    // Beam pipe
    px(10, cy - 3, 50, 1, C.wallDk);
    px(10, cy + 3, 50, 1, C.wallDk);
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
    // Beam pipe
    px(L, cy - 2, R - L, 1, C.wallDk);
    px(L, cy + 2, R - L, 1, C.wallDk);
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
  },

  // === RFQ ===
  rfq(p, px, dot, W, H, cy, C) {
    const L = 10, R = 60;
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

  // === C-BAND CAVITY ===
  cbandCavity(p, px, dot, W, H, cy, C) {
    const L = 12, R = 58;
    px(L, cy - 8, R - L, 1, C.wall);
    px(L, cy + 8, R - L, 1, C.wall);
    px(L, cy - 8, 1, 17, C.wallHi);
    px(R, cy - 8, 1, 17, C.wallHi);
    // Compact cells (C-band = higher frequency, smaller)
    for (let x = L + 2; x < R - 1; x += 4) {
      for (let dx = 0; dx < 3; dx++) {
        const t = dx / 3;
        const h = Math.round(3 * Math.sin(t * Math.PI));
        dot(x + dx, cy - 2 - h, C.hot);
        dot(x + dx, cy + 2 + h, C.hot);
      }
    }
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
  },

  // === X-BAND CAVITY ===
  xbandCavity(p, px, dot, W, H, cy, C) {
    const L = 12, R = 58;
    px(L, cy - 7, R - L, 1, C.wall);
    px(L, cy + 7, R - L, 1, C.wall);
    px(L, cy - 7, 1, 15, C.wallHi);
    px(R, cy - 7, 1, 15, C.wallHi);
    // Very compact cells (X-band = highest frequency)
    for (let x = L + 2; x < R - 1; x += 3) {
      dot(x, cy - 4, C.hot);
      dot(x + 1, cy - 5, C.hot);
      dot(x, cy + 4, C.hot);
      dot(x + 1, cy + 5, C.hot);
    }
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
  },

  // === SRF 650 CAVITY (Tesla 9-cell shares) ===
  srf650Cavity(p, px, dot, W, H, cy, C) {
    const L = 8, R = 62;
    px(L - 2, cy - 12, R - L + 4, 1, C.wallDk);
    px(L - 2, cy + 12, R - L + 4, 1, C.wallDk);
    // Large elliptical cells
    const cells = 3;
    const cellW = (R - L) / cells;
    for (let i = 0; i < cells; i++) {
      const cx2 = L + Math.floor(cellW * (i + 0.5));
      for (let dx = -Math.floor(cellW / 2) + 1; dx < Math.floor(cellW / 2); dx++) {
        const t = Math.abs(dx) / (cellW / 2);
        const h = Math.round(8 * (1 - t * t));
        dot(cx2 + dx, cy - 1 - h, C.scMagnet);
        dot(cx2 + dx, cy + 1 + h, C.scMagnet);
      }
    }
    for (let x = 4; x < W - 4; x++) dot(x, cy, C.beam);
  },

  // === TESLA 9-CELL (uses same as srf650Cavity basically) ===
  tesla9Cell(p, px, dot, W, H, cy, C) {
    const L = 4, R = 66;
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
    // Beam pipe — this IS a beamline component despite being in power category
    px(10, cy - 3, 50, 1, C.wallDk);
    px(10, cy + 3, 50, 1, C.wallDk);
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

  // === SUBSTATION ===
  substation(p, px, dot, W, H, cy, C) {
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
    const cx = 35;
    px(10, cy - 3, 50, 1, C.wallDk);
    px(10, cy + 3, 50, 1, C.wallDk);
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
    const cx = 35;
    // Target block
    px(cx - 3, cy - 8, 6, 17, C.metalDk);
    px(cx - 2, cy - 7, 4, 15, C.metal);
    // Beam in
    for (let x = 4; x < cx - 3; x++) dot(x, cy, C.beam);
    // Impact
    dot(cx - 2, cy, C.glow);
    dot(cx - 1, cy, C.hotBright);
    // Products out
    for (let i = -3; i <= 3; i++) {
      for (let r = 1; r < 8; r++) {
        const px2 = cx + 3 + r;
        const py = cy + Math.round(i * r * 0.3);
        if (px2 < W - 2 && py >= 1 && py < H - 1) dot(px2, py, C.beamDim);
      }
    }
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

Renderer.prototype._buildTreeLayout = function() {
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

Renderer.prototype._renderTechTree = function() {
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
    if (r.unlocks || r.unlocksMachines) {
      typeEl.classList.add('unlock');
      const names = [];
      if (r.unlocks) {
        for (const c of r.unlocks) {
          if (COMPONENTS[c]) names.push(COMPONENTS[c].name);
        }
      }
      if (r.unlocksMachines && typeof MACHINES !== 'undefined') {
        for (const m of r.unlocksMachines) {
          if (MACHINES[m]) names.push(MACHINES[m].name);
        }
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

Renderer.prototype._showResearchPopover = function(id, nodeEl) {
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
  if (r.unlocksMachines && typeof MACHINES !== 'undefined') {
    const names = r.unlocksMachines.map(m => MACHINES[m]?.name).filter(Boolean);
    if (names.length) unlocksText += (unlocksText ? '\n' : '') + 'Unlocks: ' + names.join(', ');
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

Renderer.prototype._scrollToCategory = function(catId) {
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

Renderer.prototype._applyTreeTransform = function() {
  const canvas = document.getElementById('tt-canvas');
  const svg = document.getElementById('tt-connectors');
  if (!canvas || !svg) return;
  const tx = `translate(${this._treePanX}px, ${this._treePanY}px) scale(${this._treeZoom})`;
  canvas.style.transform = tx;
  svg.style.transform = tx;
};

Renderer.prototype._updateTreeProgress = function() {
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

Renderer.prototype._bindTreeEvents = function() {
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

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const overlay = document.getElementById('research-overlay');
      if (overlay && !overlay.classList.contains('hidden')) {
        overlay.classList.add('hidden');
        e.stopPropagation();
      }
    }
  });
};

// --- Goals overlay ---

Renderer.prototype._renderGoalsOverlay = function() {
  const list = document.getElementById('goals-list');
  if (!list) return;
  list.innerHTML = '';

  for (const obj of OBJECTIVES) {
    const item = document.createElement('div');
    item.className = 'objective-item';

    const completed = this.game.state.completedObjectives.includes(obj.id);
    if (completed) item.classList.add('completed');

    const nameEl = document.createElement('div');
    nameEl.className = 'obj-name';
    nameEl.textContent = obj.name + (completed ? ' [DONE]' : '');
    item.appendChild(nameEl);

    const descEl = document.createElement('div');
    descEl.className = 'obj-desc';
    descEl.textContent = obj.desc;
    item.appendChild(descEl);

    const rewardEl = document.createElement('div');
    rewardEl.className = 'obj-reward';
    const rewards = Object.entries(obj.reward).map(([k, v]) => `+${v} ${k}`).join(', ');
    rewardEl.textContent = `Reward: ${rewards}`;
    item.appendChild(rewardEl);

    list.appendChild(item);
  }
};

// --- Machine context windows ---

Renderer.prototype._openMachineWindow = function(machineInstanceId) {
  if (!this._machineWindows) this._machineWindows = {};
  if (this._machineWindows[machineInstanceId]) {
    this._machineWindows[machineInstanceId].ctx.focus();
    return;
  }
  const mw = new MachineWindow(this.game, machineInstanceId);
  this._machineWindows[machineInstanceId] = mw;
  const origClose = mw.ctx.onClose;
  mw.ctx.onClose = () => {
    delete this._machineWindows[machineInstanceId];
    if (origClose) origClose();
  };
};

Renderer.prototype._refreshContextWindows = function() {
  if (this._beamlineWindows) {
    for (const bw of Object.values(this._beamlineWindows)) bw.refresh();
  }
  if (this._machineWindows) {
    for (const mw of Object.values(this._machineWindows)) mw.refresh();
  }
};
