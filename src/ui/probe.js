// === PROBE DIAGNOSTICS WINDOW ===

import { COMPONENTS } from '../data/components.js';
import { ProbePlots } from './probe-plots.js';

const PROBE_COLORS = ['#ff5555', '#55bbff', '#55bb55', '#ffaa55', '#bb55ff', '#55ffff'];
const PROBE_GRID_LAYOUTS = [[1,1],[2,1],[1,2],[2,2],[3,2]];
const PROBE_PLOT_TYPES = [
  { id: 'phase-space', name: 'Phase Space' },
  { id: 'beam-envelope', name: 'Beam Envelope' },
  { id: 'current-loss', name: 'Current & Loss' },
  { id: 'emittance', name: 'Emittance' },
  { id: 'energy-dispersion', name: 'Energy & Dispersion' },
  { id: 'peak-current', name: 'Peak Current' },
  { id: 'longitudinal', name: 'Longitudinal PS' },
  { id: 'summary', name: 'Summary Stats' },
];

export class ProbeWindow {
  constructor(game) {
    this.game = game;
    this.pins = [];
    this.activePin = 0;
    this.gridLayout = [2, 2];
    this.cells = [
      { type: 'beam-envelope' },
      { type: 'emittance' },
      { type: 'current-loss' },
      { type: 'summary' },
    ];
    this.open = false;
    this.el = null;
    this._dragging = false;
    this._resizing = false;
    this._buildDOM();
    this._bindEvents();
  }

  _buildDOM() {
    const win = document.createElement('div');
    win.id = 'probe-window';
    win.className = 'hidden';

    win.innerHTML = `
      <div class="probe-titlebar">
        <span class="probe-title">Probe</span>
        <span class="probe-pins"></span>
        <span class="probe-controls">
          <select class="probe-layout-select">
            ${PROBE_GRID_LAYOUTS.map(([c,r], i) =>
              `<option value="${i}"${i === 3 ? ' selected' : ''}>${c}\u00d7${r}</option>`
            ).join('')}
          </select>
          <button class="probe-minimize" title="Minimize">\u2212</button>
          <button class="probe-close" title="Close">\u00d7</button>
        </span>
      </div>
      <div class="probe-grid"></div>
    `;

    document.getElementById('game').appendChild(win);
    this.el = win;

    win.style.left = '60px';
    win.style.top = '80px';
    win.style.width = '560px';
    win.style.height = '420px';

    const handle = document.createElement('div');
    handle.className = 'probe-resize-handle';
    win.appendChild(handle);

    // Prevent game input when interacting with probe window
    win.addEventListener('mousedown', (e) => e.stopPropagation());
    win.addEventListener('wheel', (e) => e.stopPropagation());
  }

  _bindEvents() {
    const titlebar = this.el.querySelector('.probe-titlebar');
    titlebar.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT') return;
      this._dragging = true;
      this._dragOff = {
        x: e.clientX - this.el.offsetLeft,
        y: e.clientY - this.el.offsetTop,
      };
      e.preventDefault();
    });

    const handle = this.el.querySelector('.probe-resize-handle');
    handle.addEventListener('mousedown', (e) => {
      this._resizing = true;
      this._resizeStart = {
        x: e.clientX, y: e.clientY,
        w: this.el.offsetWidth, h: this.el.offsetHeight,
      };
      e.preventDefault();
      e.stopPropagation();
    });

    document.addEventListener('mousemove', (e) => {
      if (this._dragging) {
        this.el.style.left = (e.clientX - this._dragOff.x) + 'px';
        this.el.style.top = (e.clientY - this._dragOff.y) + 'px';
      }
      if (this._resizing) {
        const dx = e.clientX - this._resizeStart.x;
        const dy = e.clientY - this._resizeStart.y;
        this.el.style.width = Math.max(300, this._resizeStart.w + dx) + 'px';
        this.el.style.height = Math.max(200, this._resizeStart.h + dy) + 'px';
        this._sizeCanvases();
      }
    });

    document.addEventListener('mouseup', () => {
      this._dragging = false;
      this._resizing = false;
    });

    this.el.querySelector('.probe-close').addEventListener('click', () => this.close());
    this.el.querySelector('.probe-minimize').addEventListener('click', () => this.toggleMinimize());

    this.el.querySelector('.probe-layout-select').addEventListener('change', (e) => {
      const [cols, rows] = PROBE_GRID_LAYOUTS[e.target.value];
      this.gridLayout = [cols, rows];
      const total = cols * rows;
      while (this.cells.length < total) this.cells.push({ type: null });
      this.cells.length = total;
      this._renderGrid();
    });

    // Listen for beamline changes — re-resolve pin indices and update plots
    this.game.on((event) => {
      if (event !== 'beamlineChanged') return;
      if (!this.open) return;
      const ordered = this.game.state.beamline;
      this.pins = this.pins.filter(pin => {
        const idx = ordered.findIndex(n => n.id === pin.nodeId);
        if (idx < 0) return false;
        pin.elementIndex = idx;
        return true;
      });
      if (this.pins.length === 0 && this.open) {
        this.close();
        return;
      }
      if (this.activePin >= this.pins.length) {
        this.activePin = Math.max(0, this.pins.length - 1);
      }
      this._renderPinLegend();
      this.updatePlots();
    });

    // Re-size canvases when window resizes
    new ResizeObserver(() => {
      if (this.open) this._sizeCanvases();
    }).observe(this.el);
  }

  // --- Pin management ---

  addPin(node) {
    const existing = this.pins.findIndex(p => p.nodeId === node.id);
    if (existing >= 0) {
      this.activePin = existing;
      this._renderPinLegend();
      this.updatePlots();
      return;
    }
    if (this.pins.length >= 6) return;

    const ordered = this.game.state.beamline;
    const elemIdx = ordered.findIndex(n => n.id === node.id);

    this.pins.push({
      nodeId: node.id,
      elementIndex: elemIdx,
      color: PROBE_COLORS[this.pins.length],
      label: COMPONENTS[node.type]?.name || node.type,
    });
    this.activePin = this.pins.length - 1;

    if (!this.open) this.show();
    this._renderPinLegend();
    this.updatePlots();
  }

  removePin(index) {
    this.pins.splice(index, 1);
    if (this.activePin >= this.pins.length) this.activePin = Math.max(0, this.pins.length - 1);
    if (this.pins.length === 0) {
      this.close();
      return;
    }
    this._renderPinLegend();
    this.updatePlots();
  }

  _renderPinLegend() {
    const container = this.el.querySelector('.probe-pins');
    container.innerHTML = '';
    this.pins.forEach((pin, i) => {
      const chip = document.createElement('span');
      chip.className = 'probe-pin-chip' + (i === this.activePin ? ' active' : '');
      chip.style.borderColor = pin.color;
      chip.innerHTML = `<span class="pin-color" style="background:${pin.color}"></span>${pin.label}<button class="pin-remove" data-idx="${i}">\u00d7</button>`;
      chip.addEventListener('click', (e) => {
        if (e.target.classList.contains('pin-remove')) {
          this.removePin(parseInt(e.target.dataset.idx));
          return;
        }
        this.activePin = i;
        this._renderPinLegend();
        this.updatePlots();
      });
      container.appendChild(chip);
    });
  }

  // --- Window management ---

  show() {
    this.open = true;
    this.el.classList.remove('hidden');
    this.el.classList.remove('minimized');
    this._renderGrid();
  }

  close() {
    this.open = false;
    this.pins = [];
    this.activePin = 0;
    this.el.classList.add('hidden');
  }

  toggleMinimize() {
    this.el.classList.toggle('minimized');
  }

  // --- Grid rendering ---

  _renderGrid() {
    const grid = this.el.querySelector('.probe-grid');
    const [cols, rows] = this.gridLayout;
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    grid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    grid.innerHTML = '';

    for (let i = 0; i < cols * rows; i++) {
      const cell = document.createElement('div');
      cell.className = 'probe-cell';
      const cellData = this.cells[i] || { type: null };

      if (cellData.type) {
        cell.innerHTML = `
          <div class="probe-cell-header">
            <select class="probe-cell-select" data-cell="${i}">
              <option value="">-- Select --</option>
              ${PROBE_PLOT_TYPES.map(p =>
                `<option value="${p.id}"${p.id === cellData.type ? ' selected' : ''}>${p.name}</option>`
              ).join('')}
            </select>
            <button class="probe-cell-clear" data-cell="${i}">\u00d7</button>
          </div>
          ${cellData.type === 'summary'
            ? '<div class="probe-summary-card"></div>'
            : `<canvas class="probe-canvas" data-cell="${i}" data-type="${cellData.type}"></canvas>`
          }
        `;
      } else {
        cell.classList.add('empty');
        cell.innerHTML = `
          <select class="probe-cell-select add-plot" data-cell="${i}">
            <option value="">+ Add Plot</option>
            ${PROBE_PLOT_TYPES.map(p =>
              `<option value="${p.id}">${p.name}</option>`
            ).join('')}
          </select>
        `;
      }
      grid.appendChild(cell);
    }

    grid.querySelectorAll('.probe-cell-select').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.cell);
        this.cells[idx] = { type: e.target.value || null };
        this._renderGrid();
        this.updatePlots();
      });
    });
    grid.querySelectorAll('.probe-cell-clear').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.cell);
        this.cells[idx] = { type: null };
        this._renderGrid();
      });
    });

    requestAnimationFrame(() => this._sizeCanvases());
  }

  _sizeCanvases() {
    this.el.querySelectorAll('.probe-canvas').forEach(canvas => {
      const parent = canvas.parentElement;
      const headerH = parent.querySelector('.probe-cell-header')?.offsetHeight || 0;
      const rect = parent.getBoundingClientRect();
      canvas.width = Math.floor(rect.width - 4);
      canvas.height = Math.floor(rect.height - headerH - 6);
    });
    this.updatePlots();
  }

  // --- Plot updates ---

  updatePlots() {
    if (!this.open || this.pins.length === 0) return;
    const envelope = this.game.state.physicsEnvelope;
    if (!envelope || envelope.length === 0) return;

    this.el.querySelectorAll('.probe-canvas').forEach(canvas => {
      const type = canvas.dataset.type;
      if (!type || typeof ProbePlots === 'undefined') return;
      ProbePlots.draw(canvas, type, envelope, this.pins, this.activePin);
    });

    // Update summary cards
    this.el.querySelectorAll('.probe-summary-card').forEach(card => {
      this._renderSummaryCard(card, envelope);
    });
  }

  _renderSummaryCard(card, envelope) {
    const pin = this.pins[this.activePin];
    if (!pin) return;
    const data = envelope[pin.elementIndex];
    if (!data) return;

    card.style.borderTopColor = pin.color;
    const r = (label, val, unit) =>
      `<div class="ps-row"><span>${label}</span><span>${val} ${unit || ''}</span></div>`;
    const fmtSci = (v) => v != null && isFinite(v) ? v.toExponential(2) : '--';
    const fmtFix = (v, d) => v != null && isFinite(v) ? v.toFixed(d) : '--';
    card.innerHTML =
      r('Energy', formatEnergy(data.energy).val, formatEnergy(data.energy).unit) +
      r('Current', fmtFix(data.current, 2), 'mA') +
      r('I_peak', fmtFix(data.peak_current, 1), 'A') +
      r('\u03c3_x', fmtFix((data.sigma_x || 0) * 1000, 3), 'mm') +
      r('\u03c3_y', fmtFix((data.sigma_y || 0) * 1000, 3), 'mm') +
      r('\u03b5_nx', fmtSci(data.emit_nx), 'm\u00b7rad') +
      r('\u03b5_ny', fmtSci(data.emit_ny), 'm\u00b7rad') +
      r('\u03b7_x', fmtFix(data.eta_x, 4), 'm') +
      r('\u03b2_x', fmtFix(data.beta_x, 2), 'm') +
      r('\u03b2_y', fmtFix(data.beta_y, 2), 'm') +
      r('\u03c3_E', fmtSci(data.energy_spread), '') +
      r('\u03c3_t', fmtSci(data.bunch_length), 's');
  }

  // --- Save/Load ---

  toJSON() {
    return {
      open: this.open,
      pins: this.pins,
      activePin: this.activePin,
      gridLayout: this.gridLayout,
      cells: this.cells,
      x: parseInt(this.el.style.left) || 60,
      y: parseInt(this.el.style.top) || 80,
      width: parseInt(this.el.style.width) || 560,
      height: parseInt(this.el.style.height) || 420,
    };
  }

  fromJSON(data) {
    if (!data) return;
    this.pins = data.pins || [];
    this.activePin = data.activePin || 0;
    this.gridLayout = data.gridLayout || [2, 2];
    this.cells = data.cells || [{ type: 'beam-envelope' }, { type: 'emittance' }, { type: 'current-loss' }, { type: 'summary' }];
    if (data.x != null) this.el.style.left = data.x + 'px';
    if (data.y != null) this.el.style.top = data.y + 'px';
    if (data.width != null) this.el.style.width = data.width + 'px';
    if (data.height != null) this.el.style.height = data.height + 'px';

    const layoutIdx = PROBE_GRID_LAYOUTS.findIndex(
      ([c, r]) => c === this.gridLayout[0] && r === this.gridLayout[1]
    );
    if (layoutIdx >= 0) {
      this.el.querySelector('.probe-layout-select').value = layoutIdx;
    }

    if (data.open && this.pins.length > 0) {
      this.show();
      this._renderPinLegend();
    }
  }
}
