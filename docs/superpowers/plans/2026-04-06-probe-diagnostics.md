# Probe Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a floating probe window with configurable plot grid for inspecting beam properties at pinned beamline locations with real-time updates.

**Architecture:** Expand the Python physics engine to expose full covariance matrix, Twiss parameters, and cumulative position per element. Build a DOM-based floating probe window (`probe.js`) with a configurable grid of canvas-rendered plots (`probe-plots.js`). Players pin color-coded locations on the beamline and view diagnostics that update in real-time via the existing `beamlineChanged` event.

**Tech Stack:** Vanilla JS (matching existing codebase), HTML5 Canvas for plots, Python/NumPy (Pyodide) for physics.

---

### Task 1: Expand Python Snapshot with Covariance and Cumulative Position

**Files:**
- Modify: `beam_physics/beam.py:82-102` (snapshot method)
- Modify: `beam_physics/lattice.py:54-229` (propagate function — add cumulative s tracking)
- Modify: `beam_physics/gameplay.py:296-310` (envelope output — pass through new fields)

- [ ] **Step 1: Expand `BeamState.snapshot()` to include covariance matrix elements**

In `beam_physics/beam.py`, update the `snapshot` method to include the 10 covariance terms and cumulative position:

```python
def snapshot(self, element_index, element_type, cumulative_s=0.0):
    """Return a dict snapshot of the current beam state."""
    return {
        "element_index": element_index,
        "element_type": element_type,
        "beam_size_x": self.beam_size_x(),
        "beam_size_y": self.beam_size_y(),
        "energy": self.energy,
        "current": self.current,
        "emittance_x": self.emittance_x(),
        "emittance_y": self.emittance_y(),
        "norm_emittance_x": self.norm_emittance_x(),
        "norm_emittance_y": self.norm_emittance_y(),
        "beta_x": self.beta_x(),
        "beta_y": self.beta_y(),
        "alpha_x": self.alpha_x(),
        "alpha_y": self.alpha_y(),
        "energy_spread": self.energy_spread(),
        "bunch_length": self.bunch_length(),
        "alive": self.alive,
        # Covariance submatrix elements (for phase space ellipses)
        "cov_xx": float(self.sigma[0, 0]),
        "cov_xxp": float(self.sigma[0, 1]),
        "cov_xpxp": float(self.sigma[1, 1]),
        "cov_yy": float(self.sigma[2, 2]),
        "cov_yyp": float(self.sigma[2, 3]),
        "cov_ypyp": float(self.sigma[3, 3]),
        "cov_tt": float(self.sigma[4, 4]),
        "cov_tdE": float(self.sigma[4, 5]),
        "cov_dEdE": float(self.sigma[5, 5]),
        "cov_xy": float(self.sigma[0, 2]),
        # Cumulative path length
        "s": cumulative_s,
    }
```

- [ ] **Step 2: Track cumulative `s` in `propagate()` and pass to snapshot**

In `beam_physics/lattice.py`, add a `cumulative_s` variable before the loop and pass it to each snapshot call:

```python
# Before the loop (after line ~83):
cumulative_s = 0.0

# In each iteration, after element processing and before snapshot:
cumulative_s += element.get("length", 0.0)

# Update all snapshot calls to pass cumulative_s:
snapshots.append(beam.snapshot(i, etype, cumulative_s))
```

There are 3 `snapshot()` calls in `propagate()`:
1. Line 93 (source element): `beam.snapshot(i, etype, 0.0)` — source is at s=0
2. Line 180 (normal elements): `beam.snapshot(i, etype, cumulative_s)` — after adding element length
3. The source snapshot at `cumulative_s = 0.0` since source has length 0

- [ ] **Step 3: Pass through expanded fields in `gameplay.py` envelope output**

In `beam_physics/gameplay.py`, replace the envelope list comprehension (lines 298-309) to pass through all snapshot fields:

```python
# Per-element envelope for visualization
"envelope": [
    {
        "index": s["element_index"],
        "type": s["element_type"],
        "sigma_x": s["beam_size_x"],
        "sigma_y": s["beam_size_y"],
        "energy": s["energy"],
        "current": s["current"],
        "alive": s["alive"],
        # New fields for probe diagnostics
        "s": s["s"],
        "beta_x": s["beta_x"],
        "beta_y": s["beta_y"],
        "alpha_x": s["alpha_x"],
        "alpha_y": s["alpha_y"],
        "emit_x": s["emittance_x"],
        "emit_y": s["emittance_y"],
        "emit_nx": s["norm_emittance_x"],
        "emit_ny": s["norm_emittance_y"],
        "energy_spread": s["energy_spread"],
        "bunch_length": s["bunch_length"],
        "cov_xx": s["cov_xx"],
        "cov_xxp": s["cov_xxp"],
        "cov_xpxp": s["cov_xpxp"],
        "cov_yy": s["cov_yy"],
        "cov_yyp": s["cov_yyp"],
        "cov_ypyp": s["cov_ypyp"],
        "cov_tt": s["cov_tt"],
        "cov_tdE": s["cov_tdE"],
        "cov_dEdE": s["cov_dEdE"],
        "cov_xy": s["cov_xy"],
    }
    for s in physics_result["snapshots"]
],
```

- [ ] **Step 4: Verify in browser**

Open the game in a browser, open the developer console. Place a source and a few components. Run:
```javascript
console.log(JSON.stringify(game.state.physicsEnvelope[0], null, 2));
```
Expected: see all new fields (`s`, `beta_x`, `cov_xx`, etc.) populated with numeric values.

- [ ] **Step 5: Commit**

```bash
git add beam_physics/beam.py beam_physics/lattice.py beam_physics/gameplay.py
git commit -m "feat(physics): expand envelope output with covariance, Twiss, and cumulative s"
```

---

### Task 2: Add Probe Button to Component Popup

**Files:**
- Modify: `renderer.js:463-517` (showPopup method)

- [ ] **Step 1: Add a "Probe" button to `showPopup()`**

In `renderer.js`, inside the `showPopup` method, after the remove button creation (line 499), add the probe button:

```javascript
// After the removeBtn.addEventListener block and actions.appendChild(removeBtn):

const probeBtn = document.createElement('button');
probeBtn.textContent = 'Probe';
probeBtn.className = 'popup-probe-btn';
probeBtn.addEventListener('click', () => {
  this.hidePopup();
  if (this.onProbeClick) this.onProbeClick(node);
});
actions.appendChild(probeBtn);
```

- [ ] **Step 2: Add CSS for the probe button**

In `style.css`, after the existing `.popup-actions button` styles (around line 648), add:

```css
.popup-probe-btn {
  background: #224466;
  color: #88ccff;
  border: 1px solid #44aaff;
}
.popup-probe-btn:hover {
  background: #335577;
}
```

- [ ] **Step 3: Verify in browser**

Click a placed component. Popup should show both "Remove (50% refund)" and "Probe" buttons. Clicking "Probe" should close the popup (probe window comes in Task 4).

- [ ] **Step 4: Commit**

```bash
git add renderer.js style.css
git commit -m "feat(ui): add Probe button to component popup"
```

---

### Task 3: Build Probe Window DOM and Floating Behavior

**Files:**
- Create: `probe.js`
- Modify: `index.html:127` (add script tag)
- Modify: `style.css` (add probe window styles)

- [ ] **Step 1: Create `probe.js` with the ProbeWindow class**

```javascript
// === PROBE DIAGNOSTICS WINDOW ===

const PROBE_COLORS = ['#ff5555', '#55bbff', '#55bb55', '#ffaa55', '#bb55ff', '#55ffff'];
const PROBE_GRID_LAYOUTS = [[1,1],[2,1],[1,2],[2,2],[3,2]];
const PROBE_PLOT_TYPES = [
  { id: 'phase-space', name: 'Phase Space' },
  { id: 'beam-envelope', name: 'Beam Envelope' },
  { id: 'twiss', name: 'Twiss Parameters' },
  { id: 'dispersion', name: 'Dispersion' },
  { id: 'energy-dist', name: 'Energy Distribution' },
  { id: 'longitudinal', name: 'Longitudinal PS' },
  { id: 'beam-profile', name: 'Beam Profile' },
  { id: 'current-loss', name: 'Current & Loss' },
  { id: 'emittance', name: 'Emittance' },
  { id: 'summary', name: 'Summary Stats' },
];

class ProbeWindow {
  constructor(game) {
    this.game = game;
    this.pins = [];       // { nodeId, elementIndex, color }
    this.activePin = 0;
    this.gridLayout = [2, 2]; // [cols, rows]
    this.cells = [
      { type: 'phase-space' },
      { type: 'beam-envelope' },
      { type: 'summary' },
      { type: null },
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
              `<option value="${i}"${i === 3 ? ' selected' : ''}>${c}×${r}</option>`
            ).join('')}
          </select>
          <button class="probe-minimize" title="Minimize">−</button>
          <button class="probe-close" title="Close">×</button>
        </span>
      </div>
      <div class="probe-grid"></div>
    `;

    document.getElementById('game').appendChild(win);
    this.el = win;

    // Default position
    win.style.left = '60px';
    win.style.top = '80px';
    win.style.width = '560px';
    win.style.height = '420px';

    // Resize handle
    const handle = document.createElement('div');
    handle.className = 'probe-resize-handle';
    win.appendChild(handle);
  }

  _bindEvents() {
    // Drag by titlebar
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

    // Resize by handle
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
        this._renderGrid();
      }
    });

    document.addEventListener('mouseup', () => {
      this._dragging = false;
      this._resizing = false;
    });

    // Close button
    this.el.querySelector('.probe-close').addEventListener('click', () => this.close());

    // Minimize button
    this.el.querySelector('.probe-minimize').addEventListener('click', () => this.toggleMinimize());

    // Layout selector
    this.el.querySelector('.probe-layout-select').addEventListener('change', (e) => {
      const [cols, rows] = PROBE_GRID_LAYOUTS[e.target.value];
      this.gridLayout = [cols, rows];
      const total = cols * rows;
      // Resize cells array
      while (this.cells.length < total) this.cells.push({ type: null });
      this.cells.length = total;
      this._renderGrid();
    });

    // Listen for beamline changes
    this.game.on('beamlineChanged', () => {
      if (this.open) this.updatePlots();
    });
  }

  // --- Pin management ---

  addPin(node) {
    // Check if already pinned
    const existing = this.pins.findIndex(p => p.nodeId === node.id);
    if (existing >= 0) {
      this.activePin = existing;
      this._renderPinLegend();
      return;
    }
    if (this.pins.length >= 6) return; // max pins

    // Find element index in physicsEnvelope
    const ordered = this.game.state.beamline;
    const elemIdx = ordered.findIndex(n => n.id === node.id);

    this.pins.push({
      nodeId: node.id,
      elementIndex: elemIdx,
      color: PROBE_COLORS[this.pins.length],
      label: node.type,
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
      chip.innerHTML = `<span class="pin-color" style="background:${pin.color}"></span>${pin.label}<button class="pin-remove" data-idx="${i}">×</button>`;
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
        const plotInfo = PROBE_PLOT_TYPES.find(p => p.id === cellData.type);
        cell.innerHTML = `
          <div class="probe-cell-header">
            <select class="probe-cell-select" data-cell="${i}">
              <option value="">-- Select --</option>
              ${PROBE_PLOT_TYPES.map(p =>
                `<option value="${p.id}"${p.id === cellData.type ? ' selected' : ''}>${p.name}</option>`
              ).join('')}
            </select>
            <button class="probe-cell-clear" data-cell="${i}">×</button>
          </div>
          <canvas class="probe-canvas" data-cell="${i}" data-type="${cellData.type}"></canvas>
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

    // Bind cell select/clear events
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

    // Size canvases to fit their cells
    requestAnimationFrame(() => this._sizeCanvases());
  }

  _sizeCanvases() {
    this.el.querySelectorAll('.probe-canvas').forEach(canvas => {
      const rect = canvas.parentElement.getBoundingClientRect();
      const headerH = canvas.parentElement.querySelector('.probe-cell-header')?.offsetHeight || 0;
      canvas.width = Math.floor(rect.width - 4);
      canvas.height = Math.floor(rect.height - headerH - 4);
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
      if (!type) return;
      ProbePlots.draw(canvas, type, envelope, this.pins, this.activePin);
    });

    // Update summary cards (DOM-based, not canvas)
    this.el.querySelectorAll('.probe-cell').forEach(cell => {
      const canvas = cell.querySelector('.probe-canvas');
      if (canvas && canvas.dataset.type === 'summary') {
        this._renderSummaryCard(cell, canvas, envelope);
      }
    });
  }

  _renderSummaryCard(cell, canvas, envelope) {
    const pin = this.pins[this.activePin];
    if (!pin) return;
    const data = envelope[pin.elementIndex];
    if (!data) return;

    // Hide canvas, show DOM summary instead
    canvas.style.display = 'none';
    let card = cell.querySelector('.probe-summary-card');
    if (!card) {
      card = document.createElement('div');
      card.className = 'probe-summary-card';
      cell.appendChild(card);
    }
    card.style.borderTopColor = pin.color;
    card.innerHTML = `
      <div class="ps-row"><span>Energy</span><span>${data.energy?.toFixed(3) ?? '--'} GeV</span></div>
      <div class="ps-row"><span>Current</span><span>${data.current?.toFixed(2) ?? '--'} mA</span></div>
      <div class="ps-row"><span>σ_x</span><span>${(data.sigma_x * 1000)?.toFixed(3) ?? '--'} mm</span></div>
      <div class="ps-row"><span>σ_y</span><span>${(data.sigma_y * 1000)?.toFixed(3) ?? '--'} mm</span></div>
      <div class="ps-row"><span>ε_x</span><span>${data.emit_x?.toExponential(2) ?? '--'} m·rad</span></div>
      <div class="ps-row"><span>ε_y</span><span>${data.emit_y?.toExponential(2) ?? '--'} m·rad</span></div>
      <div class="ps-row"><span>ε_nx</span><span>${data.emit_nx?.toExponential(2) ?? '--'} m·rad</span></div>
      <div class="ps-row"><span>ε_ny</span><span>${data.emit_ny?.toExponential(2) ?? '--'} m·rad</span></div>
      <div class="ps-row"><span>β_x</span><span>${data.beta_x?.toFixed(2) ?? '--'} m</span></div>
      <div class="ps-row"><span>β_y</span><span>${data.beta_y?.toFixed(2) ?? '--'} m</span></div>
      <div class="ps-row"><span>α_x</span><span>${data.alpha_x?.toFixed(3) ?? '--'}</span></div>
      <div class="ps-row"><span>α_y</span><span>${data.alpha_y?.toFixed(3) ?? '--'}</span></div>
      <div class="ps-row"><span>σ_E</span><span>${data.energy_spread?.toExponential(2) ?? '--'}</span></div>
      <div class="ps-row"><span>σ_t</span><span>${data.bunch_length?.toExponential(2) ?? '--'} s</span></div>
    `;
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
    this.cells = data.cells || [{ type: 'phase-space' }, { type: 'beam-envelope' }, { type: 'summary' }, { type: null }];
    if (data.x != null) this.el.style.left = data.x + 'px';
    if (data.y != null) this.el.style.top = data.y + 'px';
    if (data.width != null) this.el.style.width = data.width + 'px';
    if (data.height != null) this.el.style.height = data.height + 'px';

    // Update layout selector
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
```

- [ ] **Step 2: Add probe window styles to `style.css`**

Append to `style.css`:

```css
/* === PROBE WINDOW === */
#probe-window {
  position: absolute;
  z-index: 200;
  background: rgba(10, 10, 30, 0.95);
  border: 1px solid #334;
  border-radius: 6px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.7);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
#probe-window.hidden { display: none; }
#probe-window.minimized .probe-grid,
#probe-window.minimized .probe-resize-handle { display: none; }
#probe-window.minimized { height: auto !important; }

.probe-titlebar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: rgba(20, 20, 50, 0.9);
  border-bottom: 1px solid #334;
  cursor: move;
  user-select: none;
  flex-shrink: 0;
}
.probe-title {
  font-size: 10px;
  color: #88aacc;
  font-weight: bold;
}
.probe-pins {
  display: flex;
  gap: 4px;
  flex: 1;
  overflow-x: auto;
}
.probe-pin-chip {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border: 1px solid;
  border-radius: 3px;
  font-size: 8px;
  color: #ccc;
  cursor: pointer;
  white-space: nowrap;
}
.probe-pin-chip.active {
  background: rgba(255, 255, 255, 0.1);
}
.pin-color {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 1px;
}
.pin-remove {
  background: none;
  border: none;
  color: #888;
  font-size: 10px;
  cursor: pointer;
  padding: 0 2px;
  font-family: inherit;
}
.pin-remove:hover { color: #ff5555; }

.probe-controls {
  display: flex;
  gap: 4px;
  align-items: center;
}
.probe-layout-select {
  background: #1a1a2e;
  color: #88aacc;
  border: 1px solid #334;
  border-radius: 3px;
  font-size: 8px;
  font-family: inherit;
  padding: 2px 4px;
  cursor: pointer;
}
.probe-minimize, .probe-close {
  background: none;
  border: 1px solid #334;
  color: #888;
  font-size: 12px;
  width: 20px;
  height: 20px;
  border-radius: 3px;
  cursor: pointer;
  font-family: inherit;
  display: flex;
  align-items: center;
  justify-content: center;
}
.probe-minimize:hover, .probe-close:hover { color: #fff; border-color: #556; }
.probe-close:hover { color: #ff5555; }

.probe-grid {
  display: grid;
  flex: 1;
  gap: 2px;
  padding: 4px;
  overflow: hidden;
}
.probe-cell {
  background: rgba(5, 5, 20, 0.6);
  border: 1px solid #223;
  border-radius: 3px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}
.probe-cell.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  border-style: dashed;
  border-color: #334;
}
.probe-cell-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 2px 4px;
  background: rgba(20, 20, 50, 0.5);
  flex-shrink: 0;
}
.probe-cell-select {
  background: transparent;
  color: #88aacc;
  border: none;
  font-size: 8px;
  font-family: inherit;
  cursor: pointer;
}
.probe-cell-select.add-plot {
  color: #556;
  font-size: 9px;
}
.probe-cell-clear {
  background: none;
  border: none;
  color: #556;
  cursor: pointer;
  font-size: 10px;
  font-family: inherit;
}
.probe-cell-clear:hover { color: #ff5555; }

.probe-canvas {
  display: block;
  flex: 1;
  width: 100%;
}

.probe-resize-handle {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 16px;
  height: 16px;
  cursor: nwse-resize;
}

/* Summary stats card */
.probe-summary-card {
  padding: 6px;
  overflow-y: auto;
  flex: 1;
  border-top: 2px solid #888;
  font-size: 8px;
}
.ps-row {
  display: flex;
  justify-content: space-between;
  padding: 2px 0;
  border-bottom: 1px solid rgba(50, 50, 80, 0.3);
  color: #aab;
}
.ps-row span:first-child {
  color: #88aacc;
}
.ps-row span:last-child {
  font-family: 'Courier New', monospace;
}
```

- [ ] **Step 3: Add `probe.js` script tag to `index.html`**

In `index.html`, add the script tag after `renderer.js` (line 136) and before `main.js`:

```html
<script src="probe.js"></script>
```

- [ ] **Step 4: Verify in browser**

Open the game. Check that no JS errors appear in console. The probe window should be hidden (no probe button click yet).

- [ ] **Step 5: Commit**

```bash
git add probe.js style.css index.html
git commit -m "feat(probe): add floating probe window with grid layout and pin system"
```

---

### Task 4: Build Plot Renderers

**Files:**
- Create: `probe-plots.js`
- Modify: `index.html` (add script tag before `probe.js`)

- [ ] **Step 1: Create `probe-plots.js` with all 9 canvas-based plot renderers**

This file provides a single `ProbePlots.draw()` entry point that dispatches to the appropriate renderer.

```javascript
// === PROBE PLOT RENDERERS ===

const ProbePlots = (() => {
  const PAD = { top: 18, right: 10, bottom: 20, left: 46 };

  function draw(canvas, type, envelope, pins, activePin) {
    const ctx = canvas.getContext('2d');
    if (!ctx || canvas.width < 10 || canvas.height < 10) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(5, 5, 20, 0.6)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!envelope || envelope.length < 2) {
      _drawMessage(ctx, canvas, 'No beam data');
      return;
    }

    const renderers = {
      'phase-space': _drawPhaseSpace,
      'beam-envelope': _drawBeamEnvelope,
      'twiss': _drawTwiss,
      'dispersion': _drawDispersion,
      'energy-dist': _drawEnergyDist,
      'longitudinal': _drawLongitudinal,
      'beam-profile': _drawBeamProfile,
      'current-loss': _drawCurrentLoss,
      'emittance': _drawEmittance,
    };

    const fn = renderers[type];
    if (fn) fn(ctx, canvas, envelope, pins, activePin);
    else _drawMessage(ctx, canvas, 'Unknown: ' + type);
  }

  function _drawMessage(ctx, canvas, msg) {
    ctx.fillStyle = 'rgba(100, 100, 150, 0.5)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(msg, canvas.width / 2, canvas.height / 2);
  }

  // --- Shared utilities ---

  function _plotArea(canvas) {
    return {
      x: PAD.left,
      y: PAD.top,
      w: canvas.width - PAD.left - PAD.right,
      h: canvas.height - PAD.top - PAD.bottom,
    };
  }

  function _autoRange(values) {
    let min = Infinity, max = -Infinity;
    for (const v of values) {
      if (v != null && isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (!isFinite(min)) { min = 0; max = 1; }
    if (min === max) { min -= 0.5; max += 0.5; }
    const pad = (max - min) * 0.08;
    return [min - pad, max + pad];
  }

  function _drawAxes(ctx, area, xLabel, yLabel, yMin, yMax) {
    // Grid lines
    ctx.strokeStyle = 'rgba(60, 60, 100, 0.3)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 3; i++) {
      const y = area.y + area.h - (i / 3) * area.h;
      ctx.beginPath();
      ctx.moveTo(area.x, y);
      ctx.lineTo(area.x + area.w, y);
      ctx.stroke();
      const val = yMin + (i / 3) * (yMax - yMin);
      ctx.fillStyle = 'rgba(120, 120, 160, 0.7)';
      ctx.font = '9px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(val.toPrecision(3), area.x - 3, y + 3);
    }
    // Axis lines
    ctx.strokeStyle = 'rgba(80, 80, 130, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(area.x, area.y);
    ctx.lineTo(area.x, area.y + area.h);
    ctx.lineTo(area.x + area.w, area.y + area.h);
    ctx.stroke();
    // Labels
    ctx.fillStyle = 'rgba(140, 140, 180, 0.7)';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    if (xLabel) ctx.fillText(xLabel, area.x + area.w / 2, area.y + area.h + 14);
    if (yLabel) {
      ctx.save();
      ctx.translate(8, area.y + area.h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(yLabel, 0, 0);
      ctx.restore();
    }
  }

  function _drawLineSeries(ctx, area, data, key, color, xMin, xMax, yMin, yMax, dashed) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    if (dashed) ctx.setLineDash([4, 3]);
    else ctx.setLineDash([]);
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < data.length; i++) {
      const xVal = data[i].s != null ? data[i].s : i;
      const v = data[i][key];
      if (v == null || !isFinite(v)) continue;
      const x = area.x + ((xVal - xMin) / (xMax - xMin)) * area.w;
      const y = area.y + area.h - ((v - yMin) / (yMax - yMin)) * area.h;
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function _drawPinMarkers(ctx, area, envelope, pins, xMin, xMax) {
    for (const pin of pins) {
      const d = envelope[pin.elementIndex];
      if (!d) continue;
      const xVal = d.s != null ? d.s : pin.elementIndex;
      const x = area.x + ((xVal - xMin) / (xMax - xMin)) * area.w;
      ctx.strokeStyle = pin.color;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, area.y);
      ctx.lineTo(x, area.y + area.h);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function _xRange(envelope) {
    const vals = envelope.map(d => d.s != null ? d.s : d.index);
    return _autoRange(vals);
  }

  function _drawLegend(ctx, area, items) {
    ctx.font = '8px monospace';
    let lx = area.x + 4;
    for (const item of items) {
      ctx.fillStyle = item.color;
      ctx.fillRect(lx, area.y - 11, 8, 6);
      ctx.fillStyle = 'rgba(180, 180, 220, 0.8)';
      ctx.textAlign = 'left';
      ctx.fillText(item.label, lx + 11, area.y - 5);
      lx += ctx.measureText(item.label).width + 24;
    }
  }

  // --- "Along beamline" plots ---

  function _drawBeamEnvelope(ctx, canvas, envelope, pins) {
    const area = _plotArea(canvas);
    const [xMin, xMax] = _xRange(envelope);
    const allVals = envelope.flatMap(d => [d.sigma_x, d.sigma_y].filter(v => v != null));
    const [yMin, yMax] = _autoRange(allVals.map(v => v * 1000)); // convert to mm

    // Temporarily scale data for drawing
    const scaled = envelope.map(d => ({
      ...d,
      sigma_x_mm: (d.sigma_x || 0) * 1000,
      sigma_y_mm: (d.sigma_y || 0) * 1000,
    }));

    _drawAxes(ctx, area, 's (m)', 'mm', yMin, yMax);
    _drawLineSeries(ctx, area, scaled, 'sigma_x_mm', '#44aaff', xMin, xMax, yMin, yMax, false);
    _drawLineSeries(ctx, area, scaled, 'sigma_y_mm', '#ff6644', xMin, xMax, yMin, yMax, true);
    _drawPinMarkers(ctx, area, envelope, pins, xMin, xMax);
    _drawLegend(ctx, area, [
      { color: '#44aaff', label: 'σ_x' },
      { color: '#ff6644', label: 'σ_y' },
    ]);
  }

  function _drawTwiss(ctx, canvas, envelope, pins) {
    const area = _plotArea(canvas);
    const [xMin, xMax] = _xRange(envelope);
    const allVals = envelope.flatMap(d => [d.beta_x, d.beta_y].filter(v => v != null && isFinite(v)));
    const [yMin, yMax] = _autoRange(allVals);

    _drawAxes(ctx, area, 's (m)', 'β (m)', yMin, yMax);
    _drawLineSeries(ctx, area, envelope, 'beta_x', '#44aaff', xMin, xMax, yMin, yMax, false);
    _drawLineSeries(ctx, area, envelope, 'beta_y', '#ff6644', xMin, xMax, yMin, yMax, true);
    _drawPinMarkers(ctx, area, envelope, pins, xMin, xMax);
    _drawLegend(ctx, area, [
      { color: '#44aaff', label: 'β_x' },
      { color: '#ff6644', label: 'β_y' },
    ]);
  }

  function _drawDispersion(ctx, canvas, envelope, pins) {
    const area = _plotArea(canvas);
    const [xMin, xMax] = _xRange(envelope);
    // Dispersion approximated from covariance: D_x ≈ cov(x, dE/E) / var(dE/E)
    // We don't have cross-plane cov terms, so use cov_xx proxy: show a placeholder message for now
    // or compute from sigma matrix if we add cov_xdE later.
    // For now, show beta_x vs alpha_x as a stand-in, or message.
    _drawAxes(ctx, area, 's (m)', 'D (m)', 0, 1);
    _drawMessage(ctx, canvas, 'Dispersion: needs cov(x,δ) — coming soon');
    _drawPinMarkers(ctx, area, envelope, pins, xMin, xMax);
  }

  function _drawCurrentLoss(ctx, canvas, envelope, pins) {
    const area = _plotArea(canvas);
    const [xMin, xMax] = _xRange(envelope);
    const allVals = envelope.map(d => d.current).filter(v => v != null);
    const [yMin, yMax] = _autoRange(allVals);

    _drawAxes(ctx, area, 's (m)', 'mA', yMin, yMax);

    // Shade loss regions in red
    for (let i = 1; i < envelope.length; i++) {
      const prev = envelope[i - 1];
      const curr = envelope[i];
      if (prev.current != null && curr.current != null && curr.current < prev.current - 0.001) {
        const xVal0 = prev.s != null ? prev.s : i - 1;
        const xVal1 = curr.s != null ? curr.s : i;
        const x0 = area.x + ((xVal0 - xMin) / (xMax - xMin)) * area.w;
        const x1 = area.x + ((xVal1 - xMin) / (xMax - xMin)) * area.w;
        ctx.fillStyle = 'rgba(255, 50, 50, 0.15)';
        ctx.fillRect(x0, area.y, x1 - x0, area.h);
      }
    }

    _drawLineSeries(ctx, area, envelope, 'current', '#ddaa44', xMin, xMax, yMin, yMax, false);
    _drawPinMarkers(ctx, area, envelope, pins, xMin, xMax);
    _drawLegend(ctx, area, [{ color: '#ddaa44', label: 'Current' }]);
  }

  function _drawEmittance(ctx, canvas, envelope, pins) {
    const area = _plotArea(canvas);
    const [xMin, xMax] = _xRange(envelope);
    const allVals = envelope.flatMap(d => [d.emit_x, d.emit_y].filter(v => v != null && isFinite(v)));
    const [yMin, yMax] = _autoRange(allVals);

    _drawAxes(ctx, area, 's (m)', 'ε (m·rad)', yMin, yMax);
    _drawLineSeries(ctx, area, envelope, 'emit_x', '#44aaff', xMin, xMax, yMin, yMax, false);
    _drawLineSeries(ctx, area, envelope, 'emit_y', '#ff6644', xMin, xMax, yMin, yMax, true);
    _drawPinMarkers(ctx, area, envelope, pins, xMin, xMax);
    _drawLegend(ctx, area, [
      { color: '#44aaff', label: 'ε_x' },
      { color: '#ff6644', label: 'ε_y' },
    ]);
  }

  // --- "At this point" plots ---

  function _drawPhaseSpace(ctx, canvas, envelope, pins, activePin) {
    const pin = pins[activePin];
    if (!pin) { _drawMessage(ctx, canvas, 'No pin selected'); return; }
    const d = envelope[pin.elementIndex];
    if (!d) { _drawMessage(ctx, canvas, 'No data at pin'); return; }

    const w = canvas.width, h = canvas.height;
    const halfW = Math.floor((w - 20) / 2);

    // Left: x-x' ellipse
    _drawEllipse(ctx, 10, PAD.top, halfW - 5, h - PAD.top - PAD.bottom,
      d.cov_xx, d.cov_xxp, d.cov_xpxp, pin.color,
      'x (m)', "x' (rad)", d.emit_x);

    // Right: y-y' ellipse
    _drawEllipse(ctx, halfW + 15, PAD.top, halfW - 5, h - PAD.top - PAD.bottom,
      d.cov_yy, d.cov_yyp, d.cov_ypyp, pin.color,
      'y (m)', "y' (rad)", d.emit_y);
  }

  function _drawEllipse(ctx, ox, oy, w, h, s11, s12, s22, color, xLabel, yLabel, emittance) {
    if (!s11 || !s22) return;

    // Eigenvalue decomposition for ellipse orientation
    const trace = s11 + s22;
    const det = s11 * s22 - s12 * s12;
    const disc = Math.sqrt(Math.max((trace * trace / 4) - det, 0));
    const lam1 = trace / 2 + disc;
    const lam2 = Math.max(trace / 2 - disc, 1e-30);
    const angle = Math.atan2(2 * s12, s11 - s22) / 2;

    // Scale to fill plot area
    const maxR = Math.sqrt(lam1) * 3;
    const scale = Math.min(w, h) / 2 / maxR;
    const cx = ox + w / 2;
    const cy = oy + h / 2;

    // Draw ellipse
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-angle);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, Math.sqrt(lam1) * scale, Math.sqrt(lam2) * scale, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Fill with transparency
    ctx.fillStyle = color.replace(')', ', 0.1)').replace('rgb', 'rgba');
    ctx.fill();
    ctx.restore();

    // Axis crosshairs
    ctx.strokeStyle = 'rgba(60, 60, 100, 0.4)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(ox, cy); ctx.lineTo(ox + w, cy);
    ctx.moveTo(cx, oy); ctx.lineTo(cx, oy + h);
    ctx.stroke();

    // Labels
    ctx.fillStyle = 'rgba(140, 140, 180, 0.7)';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(xLabel, cx, oy + h + 12);
    if (emittance != null) {
      ctx.fillStyle = color;
      ctx.fillText('ε=' + emittance.toExponential(2), cx, oy - 3);
    }
  }

  function _drawBeamProfile(ctx, canvas, envelope, pins, activePin) {
    const pin = pins[activePin];
    if (!pin) { _drawMessage(ctx, canvas, 'No pin selected'); return; }
    const d = envelope[pin.elementIndex];
    if (!d || !d.cov_xx || !d.cov_yy) { _drawMessage(ctx, canvas, 'No data at pin'); return; }

    const area = _plotArea(canvas);
    const sx = Math.sqrt(d.cov_xx);
    const sy = Math.sqrt(d.cov_yy);
    const rxy = d.cov_xy || 0;

    // Draw 2D Gaussian heatmap
    const imgW = Math.floor(area.w);
    const imgH = Math.floor(area.h);
    if (imgW <= 0 || imgH <= 0) return;
    const imgData = ctx.createImageData(imgW, imgH);
    const rangeX = sx * 4;
    const rangeY = sy * 4;
    const det = d.cov_xx * d.cov_yy - rxy * rxy;
    const invDet = 1 / Math.max(det, 1e-30);

    for (let py = 0; py < imgH; py++) {
      const y = (py / imgH - 0.5) * 2 * rangeY;
      for (let px = 0; px < imgW; px++) {
        const x = (px / imgW - 0.5) * 2 * rangeX;
        const exponent = -0.5 * invDet * (d.cov_yy * x * x - 2 * rxy * x * y + d.cov_xx * y * y);
        const intensity = Math.exp(exponent);
        const idx = (py * imgW + px) * 4;
        // Hot colormap: black -> red -> yellow -> white
        const t = Math.min(intensity, 1);
        imgData.data[idx] = Math.floor(Math.min(t * 3, 1) * 255);
        imgData.data[idx + 1] = Math.floor(Math.max(0, Math.min((t - 0.33) * 3, 1)) * 255);
        imgData.data[idx + 2] = Math.floor(Math.max(0, Math.min((t - 0.66) * 3, 1)) * 255);
        imgData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, area.x, area.y);

    // Axis labels
    ctx.fillStyle = 'rgba(140, 140, 180, 0.7)';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('x (m)', area.x + area.w / 2, area.y + area.h + 14);
    ctx.fillText(`σx=${sx.toExponential(1)} σy=${sy.toExponential(1)}`, area.x + area.w / 2, area.y - 3);
  }

  function _drawEnergyDist(ctx, canvas, envelope, pins, activePin) {
    const pin = pins[activePin];
    if (!pin) { _drawMessage(ctx, canvas, 'No pin selected'); return; }
    const d = envelope[pin.elementIndex];
    if (!d) { _drawMessage(ctx, canvas, 'No data at pin'); return; }

    const area = _plotArea(canvas);
    const sigma = d.energy_spread || 0.001;
    const center = d.energy || 0;
    const nBins = 60;

    // Draw Gaussian histogram
    const xMin = center - 4 * sigma;
    const xMax = center + 4 * sigma;
    const binW = area.w / nBins;
    let maxVal = 0;
    const vals = [];
    for (let i = 0; i < nBins; i++) {
      const x = xMin + (i + 0.5) * (xMax - xMin) / nBins;
      const v = Math.exp(-0.5 * ((x - center) / sigma) ** 2);
      vals.push(v);
      if (v > maxVal) maxVal = v;
    }

    _drawAxes(ctx, area, 'E (GeV)', 'Intensity', 0, 1.1);

    ctx.fillStyle = pin.color.replace(')', ', 0.4)').replace('#', 'rgba(');
    // Convert hex to rgba for fill
    const r = parseInt(pin.color.slice(1, 3), 16) || parseInt(pin.color[1] + pin.color[1], 16);
    const g = parseInt(pin.color.slice(2, 4), 16) || parseInt(pin.color[2] + pin.color[2], 16);
    const b = parseInt(pin.color.slice(3, 5), 16) || parseInt(pin.color[3] + pin.color[3], 16);
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.4)`;
    ctx.strokeStyle = pin.color;
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.moveTo(area.x, area.y + area.h);
    for (let i = 0; i < nBins; i++) {
      const x = area.x + i * binW;
      const y = area.y + area.h - (vals[i] / maxVal) * area.h;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(area.x + area.w, area.y + area.h);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = pin.color;
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`σ_E=${sigma.toExponential(2)}`, area.x + area.w / 2, area.y - 3);
  }

  function _drawLongitudinal(ctx, canvas, envelope, pins, activePin) {
    const pin = pins[activePin];
    if (!pin) { _drawMessage(ctx, canvas, 'No pin selected'); return; }
    const d = envelope[pin.elementIndex];
    if (!d) { _drawMessage(ctx, canvas, 'No data at pin'); return; }

    const area = _plotArea(canvas);
    const s44 = d.cov_tt || 1e-24;
    const s45 = d.cov_tdE || 0;
    const s55 = d.cov_dEdE || 1e-10;

    // Draw ellipse in (dt, dE/E) space
    const cx = area.x + area.w / 2;
    const cy = area.y + area.h / 2;

    const trace = s44 + s55;
    const det = s44 * s55 - s45 * s45;
    const disc = Math.sqrt(Math.max((trace * trace / 4) - det, 0));
    const lam1 = trace / 2 + disc;
    const lam2 = Math.max(trace / 2 - disc, 1e-30);
    const angle = Math.atan2(2 * s45, s44 - s55) / 2;

    const maxR = Math.sqrt(lam1) * 3;
    const scale = Math.min(area.w, area.h) / 2 / maxR;

    // Crosshairs
    ctx.strokeStyle = 'rgba(60, 60, 100, 0.4)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(area.x, cy); ctx.lineTo(area.x + area.w, cy);
    ctx.moveTo(cx, area.y); ctx.lineTo(cx, area.y + area.h);
    ctx.stroke();

    // Ellipse
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-angle);
    ctx.strokeStyle = pin.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, Math.sqrt(lam1) * scale, Math.sqrt(lam2) * scale, 0, 0, Math.PI * 2);
    ctx.stroke();
    const hexToRgb = (hex) => {
      const s = hex.length === 4
        ? hex[1]+hex[1]+hex[2]+hex[2]+hex[3]+hex[3]
        : hex.slice(1);
      const n = parseInt(s, 16);
      return `${(n>>16)&255}, ${(n>>8)&255}, ${n&255}`;
    };
    ctx.fillStyle = `rgba(${hexToRgb(pin.color)}, 0.1)`;
    ctx.fill();
    ctx.restore();

    // Labels
    ctx.fillStyle = 'rgba(140, 140, 180, 0.7)';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('dt (s)', area.x + area.w / 2, area.y + area.h + 14);
    ctx.fillText(`σt=${Math.sqrt(s44).toExponential(1)} σE=${Math.sqrt(s55).toExponential(1)}`,
      area.x + area.w / 2, area.y - 3);
  }

  return { draw };
})();
```

- [ ] **Step 2: Add `probe-plots.js` script tag to `index.html`**

In `index.html`, add the script tag after `renderer.js` and before `probe.js`:

```html
<script src="probe-plots.js"></script>
<script src="probe.js"></script>
```

- [ ] **Step 3: Verify in browser**

Open dev console, check no errors. `ProbePlots` should be defined: `typeof ProbePlots` → `"object"`.

- [ ] **Step 4: Commit**

```bash
git add probe-plots.js index.html
git commit -m "feat(probe): add canvas plot renderers for all 9 diagnostic plot types"
```

---

### Task 5: Wire Everything Together in `main.js`

**Files:**
- Modify: `main.js` (wire ProbeWindow to game and renderer)
- Modify: `renderer.js:463-512` (connect probe button callback)
- Modify: `game.js:847-853` (save probe state)
- Modify: `game.js:855-888` (load probe state)

- [ ] **Step 1: Read current `main.js` to understand initialization flow**

Read `main.js` to see how game, renderer, and input are wired together.

- [ ] **Step 2: Initialize ProbeWindow in `main.js`**

After the renderer and game are set up, add:

```javascript
const probeWindow = new ProbeWindow(game);

// Wire Probe button in popup to probe window
renderer.onProbeClick = (node) => probeWindow.addPin(node);

// Load probe state if saved
if (game.state.probe) {
  probeWindow.fromJSON(game.state.probe);
}
```

- [ ] **Step 3: Add probe state to game save**

In `game.js`, the `save()` method at line 847. Modify to include probe state. Since the ProbeWindow is external to Game, we need to let main.js hook into save. The simplest approach: store probe state on `game.state.probe` before saving.

In `main.js`, after creating probeWindow, add a save hook:

```javascript
const origSave = game.save.bind(game);
game.save = function() {
  this.state.probe = probeWindow.toJSON();
  origSave();
};
```

- [ ] **Step 4: Verify full flow in browser**

1. Place a source and some components
2. Click a component → popup shows with "Probe" button
3. Click "Probe" → floating probe window opens with color-coded pin
4. Click another component → "Probe" → second pin appears with different color
5. Modify beamline → plots update in real-time
6. Drag window, resize, change grid layout
7. Refresh page → probe state should restore from save

- [ ] **Step 5: Commit**

```bash
git add main.js renderer.js game.js
git commit -m "feat(probe): wire probe window to game events, popup, and save/load"
```

---

### Task 6: Render Pin Flags on Isometric View

**Files:**
- Modify: `renderer.js` (add pin flag rendering in component render pass)

- [ ] **Step 1: Add a method to render pin flags on the beamline**

In `renderer.js`, add a `_renderProbeFlags()` method that draws small colored flags on pinned components. This should be called during the component render pass.

```javascript
_renderProbeFlags(pins) {
  // Remove old flags
  if (this._flagLayer) this._flagLayer.removeChildren();
  else {
    this._flagLayer = new PIXI.Container();
    this.app.stage.addChild(this._flagLayer);
  }

  if (!pins || pins.length === 0) return;

  const ordered = this.game.state.beamline;
  for (const pin of pins) {
    const node = ordered.find(n => n.id === pin.nodeId);
    if (!node) continue;
    const pos = tileCenterIso(node.col, node.row);

    // Small flag triangle
    const g = new PIXI.Graphics();
    // Flag pole
    g.moveTo(pos.x + 8, pos.y - 20);
    g.lineTo(pos.x + 8, pos.y - 4);
    g.stroke({ color: 0xaaaaaa, width: 1 });
    // Flag body
    const flagColor = parseInt(pin.color.replace('#', '0x'));
    g.poly([
      pos.x + 8, pos.y - 20,
      pos.x + 20, pos.y - 16,
      pos.x + 8, pos.y - 12,
    ]);
    g.fill({ color: flagColor, alpha: 0.9 });

    this._flagLayer.addChild(g);
  }
}
```

- [ ] **Step 2: Call `_renderProbeFlags` during render updates**

Hook into the `beamlineChanged` event handler in the renderer to call `_renderProbeFlags`. The renderer needs access to the probe window's pin list. Add to `main.js`:

```javascript
game.on('beamlineChanged', () => {
  renderer._renderProbeFlags(probeWindow.pins);
});
// Also re-render flags when pins change
const origAddPin = probeWindow.addPin.bind(probeWindow);
probeWindow.addPin = function(node) {
  origAddPin(node);
  renderer._renderProbeFlags(this.pins);
};
const origRemovePin = probeWindow.removePin.bind(probeWindow);
probeWindow.removePin = function(index) {
  origRemovePin(index);
  renderer._renderProbeFlags(this.pins);
};
```

- [ ] **Step 3: Verify in browser**

Pin a component → small colored flag appears on its isometric tile. Pin a second → different color flag. Remove pin → flag disappears.

- [ ] **Step 4: Commit**

```bash
git add renderer.js main.js
git commit -m "feat(probe): render color-coded pin flags on isometric beamline view"
```

---

### Task 7: Polish and Edge Cases

**Files:**
- Modify: `probe.js` (handle edge cases)
- Modify: `probe-plots.js` (handle missing data gracefully)

- [ ] **Step 1: Handle beamline modifications that invalidate pins**

When a component is removed, its pin should be cleaned up. In `probe.js`, add to `_bindEvents()`:

```javascript
this.game.on('beamlineChanged', () => {
  // Re-resolve element indices after beamline changes
  const ordered = this.game.state.beamline;
  this.pins = this.pins.filter(pin => {
    const idx = ordered.findIndex(n => n.id === pin.nodeId);
    if (idx < 0) return false; // component was removed
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
```

**Important:** This replaces the simpler `beamlineChanged` listener from Task 3 Step 1 `_bindEvents()`. Remove the old one and use this expanded version.

- [ ] **Step 2: Prevent probe window from intercepting game input**

Add `mousedown` stopPropagation on the probe window so dragging/clicking inside it doesn't trigger game input:

```javascript
// In _buildDOM(), after creating the window element:
win.addEventListener('mousedown', (e) => e.stopPropagation());
win.addEventListener('wheel', (e) => e.stopPropagation());
```

- [ ] **Step 3: Handle canvas resize on window resize**

Add a ResizeObserver to re-size canvases when the probe window is resized:

```javascript
// In _bindEvents(), after resize handle setup:
const resizeObs = new ResizeObserver(() => {
  if (this.open) this._sizeCanvases();
});
resizeObs.observe(this.el);
```

- [ ] **Step 4: Verify edge cases in browser**

1. Remove a pinned component → pin should disappear, window closes if last pin
2. Drag/click inside probe window → game view should NOT pan or respond
3. Resize probe window → plots should re-scale cleanly
4. Toggle beam off → plots should show last known data (not crash)

- [ ] **Step 5: Commit**

```bash
git add probe.js probe-plots.js
git commit -m "fix(probe): handle pin invalidation, input isolation, and resize"
```
