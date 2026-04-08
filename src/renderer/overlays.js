// === OVERLAYS EXTENSION ===
// Adds component popup, tech tree, and goals overlay rendering to Renderer.prototype.
// Note: PIXI is a CDN global — not imported.

import { Renderer, _pxText } from './Renderer.js';
import { COMPONENTS } from '../data/components.js';
import { RESEARCH, RESEARCH_CATEGORIES, RESEARCH_LAB_MAP } from '../data/research.js';
import { OBJECTIVES } from '../data/objectives.js';
import { MACHINES } from '../data/machines.js';
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
  };
  const cy = Math.floor(PH / 2);

  // Clear
  px(0, 0, PW, PH, C.bg);

  // Beam dashes (background, across whole width)
  for (let x = 2; x < PW - 2; x += 3) {
    dot(x, cy, C.beamDim);
    if (x + 1 < PW - 2) dot(x + 1, cy, C.beamDim);
  }
  // Beam arrow at right
  dot(PW - 4, cy, C.beam);
  dot(PW - 5, cy - 1, C.beamDim);
  dot(PW - 5, cy + 1, C.beamDim);

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
