# Research Tech Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat-list research overlay with a full-screen, pannable/zoomable tech tree organized into 8 independent category columns.

**Architecture:** The RESEARCH data in `data.js` gets a `category` field and new root nodes. A new `_renderTechTree()` method in `renderer.js` replaces `_renderResearchOverlay()`, building a DOM-based tree with SVG connectors inside a full-screen overlay. Pan/zoom is handled via CSS transforms on a container div. Game logic (`isResearchAvailable`, `startResearch`, `getEffect`) is unchanged.

**Tech Stack:** Vanilla JS, DOM nodes for cards, inline SVG for connector lines, CSS transforms for pan/zoom.

---

### Task 1: Add RESEARCH_CATEGORIES and assign categories to all RESEARCH items

**Files:**
- Modify: `data.js:2031-2457` (RESEARCH object and surrounding code)

- [ ] **Step 1: Add RESEARCH_CATEGORIES constant before RESEARCH**

Insert immediately above line 2031 (`const RESEARCH = {`):

```js
const RESEARCH_CATEGORIES = {
  beamOptics:    { id: 'beamOptics',    name: 'Beam Optics',      color: '#4ac' },
  rf:            { id: 'rf',            name: 'RF Systems',       color: '#c44' },
  vacuum:        { id: 'vacuum',        name: 'Vacuum',           color: '#999' },
  cryo:          { id: 'cryo',          name: 'Cryogenics',       color: '#48c' },
  diagnostics:   { id: 'diagnostics',   name: 'Diagnostics',      color: '#eee' },
  photonScience: { id: 'photonScience', name: 'Photon Science',   color: '#c8c' },
  data:          { id: 'data',          name: 'Data & Computing', color: '#8c8' },
  machineTypes:  { id: 'machineTypes',  name: 'Machine Types',    color: '#ca4' },
};
```

- [ ] **Step 2: Add new root nodes for trunks that lack them**

Add these entries at the top of the RESEARCH object:

```js
  // === Root: RF Systems ===
  rfFundamentals: {
    id: 'rfFundamentals',
    name: 'RF Fundamentals',
    category: 'rf',
    desc: 'Basic RF acceleration principles. Improves cavity efficiency.',
    cost: { data: 5, funding: 200 },
    duration: 15,
    effect: { energyCostMult: 0.95 },
    requires: null,
  },

  // === Root: Vacuum ===
  basicVacuum: {
    id: 'basicVacuum',
    name: 'Basic Vacuum',
    category: 'vacuum',
    desc: 'Vacuum fundamentals. Slightly improves beam quality.',
    cost: { data: 5, funding: 200 },
    duration: 15,
    effect: { qualityBoost: 0.02 },
    requires: null,
  },

  // === Root: Cryogenics ===
  cryoFundamentals: {
    id: 'cryoFundamentals',
    name: 'Cryo Fundamentals',
    category: 'cryo',
    desc: 'Basic cryogenic techniques for cooling superconducting components.',
    cost: { data: 8, funding: 400 },
    duration: 20,
    requires: null,
  },
```

- [ ] **Step 3: Add `category` field to every existing RESEARCH entry and rewire prerequisites**

Add `category` to each entry as follows. Also rewire cross-trunk deps and remove `tier` fields.

**Beam Optics category:**
- `beamOptics`: add `category: 'beamOptics'`, remove `tier: 1`
- `bunchCompression`: add `category: 'beamOptics'`, change `requires: 'beamOptics'`, remove `tier: 1`
- `scMagnets`: add `category: 'beamOptics'`, change `requires: 'beamOptics'`, remove `tier: 3`
- `beamTransport`: add `category: 'beamOptics'`, remove `tier: 3`
- `latticeDesign`: add `category: 'beamOptics'`, remove `tier: 3`
- `advancedOptics`: add `category: 'beamOptics'`, remove `tier: 4`
- `fastKickers`: add `category: 'beamOptics'`, remove `tier: 4`
- `highLuminosity`: add `category: 'beamOptics'`, remove `tier: 4`
- `particleDiscovery`: add `category: 'beamOptics'`, remove `tier: 4`

**RF Systems category:**
- `cwRfSystems`: add `category: 'rf'`, change `requires: 'rfFundamentals'`, remove `tier: 2`
- `photocathodes`: add `category: 'rf'`, change `requires: 'rfFundamentals'`, remove `tier: 2`
- `digitalLlrf`: add `category: 'rf'`, remove `tier: 2`
- `rfPhotoinjectors`: add `category: 'rf'`, remove `tier: 3`
- `srfTechnology`: add `category: 'rf'`, remove `tier: 3`
- `superconducting`: add `category: 'rf'`, remove `tier: 3` (keep `hidden: true`)
- `advancedRf`: add `category: 'rf'`, remove `tier: 4`
- `highGradientRf`: add `category: 'rf'`, remove `tier: 4`
- `cwLinacDesign`: add `category: 'rf'`, change `requires: 'srfTechnology'` (remove highQSrf dep — that's cryo tree), remove `tier: 4`
- `energyRecovery`: add `category: 'rf'`, remove `tier: 3`
- `srfGunTech`: add `category: 'rf'`, remove `tier: 5`

**Vacuum category:**
- `uhvSystems`: add `category: 'vacuum'`, change `requires: 'basicVacuum'`, remove `tier: 2`

**Cryogenics category:**
- `highQSrf`: add `category: 'cryo'`, change `requires: 'cryoFundamentals'`, remove `tier: 4`. Change `desc` to mention cryo plant context.
- `cryoOptimization`: add `category: 'cryo'`, remove `tier: 5`

Note: `srfTechnology` stays in the RF tree. Its cryo-related unlocks (heCompressor, coldBox4K, transferLine, ln2Precooler) stay on it for now. The cryo tree provides the "high-Q" path (2K operation, He recovery).

**Diagnostics category:**
- `beamDiagnostics`: add `category: 'diagnostics'`, remove `tier: 1`
- `machineProtection`: add `category: 'diagnostics'`, change `requires: 'beamDiagnostics'`, remove `tier: 1`

**Photon Science category:**
- `synchrotronLight`: add `category: 'photonScience'`, change `requires: null` (was `beamOptics` — now a root), remove `tier: 2`
- `advancedUndulators`: add `category: 'photonScience'`, remove `tier: 4`
- `felPhysics`: add `category: 'photonScience'`, change `requires: 'advancedUndulators'` (was `[advancedUndulators, bunchCompression]` — remove cross-trunk dep), remove `tier: 4`
- `photonScience`: add `category: 'photonScience'`, remove `tier: 5`
- `plasmaAcceleration`: add `category: 'photonScience'`, change `requires: 'felPhysics'` (moved from machineTypes), remove `tier: 4`

**Data & Computing category:**
- `dataAnalysis`: add `category: 'data'`, remove `tier: 2`
- `automation`: add `category: 'data'`, remove `tier: 3`
- `facilitySystems`: add `category: 'data'`, change `requires: 'dataAnalysis'`, remove `tier: 2`

**Machine Types category:**
- `cyclotronTech`: add `category: 'machineTypes'`, remove `tier: 1`
- `isochronousCyclotron`: add `category: 'machineTypes'`, remove `tier: 3`
- `protonAcceleration`: add `category: 'machineTypes'`, remove `tier: 2`
- `synchrotronTech`: add `category: 'machineTypes'`, change `requires: 'protonAcceleration'` (was `srfTechnology` — remove cross-trunk dep), remove `tier: 3`
- `storageRingTech`: add `category: 'machineTypes'`, remove `tier: 4`
- `targetPhysics`: add `category: 'machineTypes'`, remove `tier: 1`
- `targetPhysicsAdv`: add `category: 'machineTypes'`, change `requires: 'targetPhysics'` (was `[targetPhysics, machineProtection]` — remove cross-trunk dep), remove `tier: 5`
- `antimatter`: add `category: 'machineTypes'`, change `requires: 'targetPhysicsAdv'` (was `[highGradientRf, targetPhysics]`), remove `tier: 5`

- [ ] **Step 4: Verify the game still loads**

Open `index.html` in browser. Check console for errors. Click Research button — the old overlay should still work (it iterates RESEARCH and doesn't use `tier`). Verify no JS errors.

- [ ] **Step 5: Commit**

```bash
git add data.js
git commit -m "feat: add research categories and rewire tree prerequisites"
```

---

### Task 2: Replace research overlay HTML with tech tree structure

**Files:**
- Modify: `index.html:100-109` (research overlay)

- [ ] **Step 1: Replace the research overlay markup**

Replace lines 100-109 in `index.html`:

```html
    <!-- Research tech tree (full-screen, hidden by default) -->
    <div id="research-overlay" class="tech-tree-overlay hidden">
      <div class="tt-header">
        <div class="tt-category-tabs" id="tt-category-tabs"></div>
        <div class="tt-active-research" id="tt-active-research"></div>
        <button class="overlay-close" data-close="research-overlay">&times;</button>
      </div>
      <div class="tt-canvas-wrapper" id="tt-canvas-wrapper">
        <svg class="tt-connectors" id="tt-connectors"></svg>
        <div class="tt-canvas" id="tt-canvas"></div>
      </div>
      <div class="tt-popover hidden" id="tt-popover"></div>
    </div>
```

- [ ] **Step 2: Verify page loads without errors**

Open in browser. The overlay is hidden by default so no visual change yet. Check console for no errors.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: replace research overlay HTML with tech tree structure"
```

---

### Task 3: Add tech tree CSS styles

**Files:**
- Modify: `style.css:503-568` (replace old research styles)

- [ ] **Step 1: Replace the research item CSS with tech tree styles**

Replace the entire `/* === RESEARCH ITEMS === */` block (lines 503-568) with:

```css
/* === TECH TREE OVERLAY === */
.tech-tree-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 300;
  background: rgba(10, 10, 25, 0.97);
  display: flex;
  flex-direction: column;
}

.tech-tree-overlay.hidden {
  display: none;
}

.tt-header {
  display: flex;
  align-items: center;
  padding: 6px 12px;
  border-bottom: 1px solid rgba(80, 80, 120, 0.3);
  background: rgba(15, 15, 35, 0.95);
  gap: 12px;
  flex-shrink: 0;
}

.tt-category-tabs {
  display: flex;
  gap: 4px;
  flex: 1;
  overflow-x: auto;
}

.tt-cat-tab {
  font-family: 'Press Start 2P', monospace;
  font-size: 7px;
  padding: 4px 8px;
  border: 1px solid rgba(80, 80, 120, 0.3);
  border-radius: 3px;
  background: rgba(30, 30, 60, 0.6);
  color: #8888aa;
  cursor: pointer;
  white-space: nowrap;
}

.tt-cat-tab:hover {
  background: rgba(40, 40, 80, 0.7);
  color: #aaaacc;
}

.tt-cat-tab.active {
  border-color: var(--cat-color, #4488cc);
  color: var(--cat-color, #4488cc);
  background: rgba(40, 40, 80, 0.8);
}

.tt-active-research {
  font-family: 'Press Start 2P', monospace;
  font-size: 7px;
  color: #ddaa22;
  white-space: nowrap;
}

/* Canvas area — pan/zoom container */
.tt-canvas-wrapper {
  flex: 1;
  overflow: hidden;
  position: relative;
  cursor: grab;
}

.tt-canvas-wrapper:active {
  cursor: grabbing;
}

.tt-canvas {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
}

.tt-connectors {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  overflow: visible;
}

/* Node cards */
.tt-node {
  position: absolute;
  width: 150px;
  padding: 6px 8px;
  border: 1px solid rgba(80, 80, 120, 0.4);
  border-radius: 4px;
  background: rgba(25, 25, 50, 0.9);
  color: #8888aa;
  font-family: 'Press Start 2P', monospace;
  cursor: default;
  user-select: none;
  transition: border-color 0.2s, opacity 0.2s;
}

.tt-node.locked {
  opacity: 0.35;
  border-color: rgba(60, 60, 80, 0.3);
}

.tt-node.available {
  border-color: rgba(60, 200, 100, 0.6);
  color: #aaccaa;
  cursor: pointer;
  box-shadow: 0 0 8px rgba(60, 200, 100, 0.15);
}

.tt-node.available:hover {
  border-color: rgba(80, 220, 120, 0.8);
  background: rgba(30, 40, 60, 0.95);
  box-shadow: 0 0 12px rgba(60, 200, 100, 0.25);
}

.tt-node.researching {
  border-color: rgba(220, 180, 40, 0.6);
  color: #ddcc88;
  box-shadow: 0 0 8px rgba(220, 180, 40, 0.15);
  animation: tt-pulse 2s ease-in-out infinite;
}

@keyframes tt-pulse {
  0%, 100% { box-shadow: 0 0 8px rgba(220, 180, 40, 0.15); }
  50% { box-shadow: 0 0 14px rgba(220, 180, 40, 0.3); }
}

.tt-node.completed {
  border-color: rgba(60, 160, 80, 0.5);
  background: rgba(20, 40, 30, 0.9);
  color: #88bb88;
}

.tt-node-name {
  font-size: 7px;
  color: inherit;
  margin-bottom: 3px;
}

.tt-node-type {
  font-size: 6px;
  margin-bottom: 2px;
}

.tt-node-type.unlock {
  color: #6699cc;
}

.tt-node-type.boost {
  color: #cc9944;
}

.tt-node-progress {
  margin-top: 4px;
  height: 3px;
  background: rgba(20, 20, 40, 0.8);
  border-radius: 2px;
  overflow: hidden;
}

.tt-node-progress .bar {
  height: 100%;
  background: #ddaa22;
  border-radius: 2px;
  transition: width 0.3s;
}

.tt-node .tt-check {
  font-size: 7px;
  color: #66bb66;
  float: right;
}

/* Column headers */
.tt-column-header {
  position: absolute;
  font-family: 'Press Start 2P', monospace;
  font-size: 8px;
  text-align: center;
  width: 150px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(80, 80, 120, 0.2);
}

/* Popover for research confirmation */
.tt-popover {
  position: fixed;
  z-index: 310;
  width: 220px;
  padding: 10px 12px;
  background: rgba(20, 20, 45, 0.98);
  border: 1px solid rgba(100, 100, 160, 0.5);
  border-radius: 4px;
  font-family: 'Press Start 2P', monospace;
  color: #aaaacc;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
}

.tt-popover.hidden {
  display: none;
}

.tt-popover-name {
  font-size: 8px;
  color: #ccddff;
  margin-bottom: 6px;
}

.tt-popover-desc {
  font-size: 6px;
  color: #7777aa;
  line-height: 1.8;
  margin-bottom: 6px;
}

.tt-popover-unlocks {
  font-size: 6px;
  color: #6699cc;
  margin-bottom: 4px;
}

.tt-popover-cost {
  font-size: 6px;
  color: #4488ff;
  margin-bottom: 8px;
}

.tt-popover-buttons {
  display: flex;
  gap: 6px;
}

.tt-popover-buttons button {
  font-family: 'Press Start 2P', monospace;
  font-size: 7px;
  padding: 4px 10px;
  border: 1px solid rgba(80, 80, 120, 0.4);
  border-radius: 3px;
  cursor: pointer;
}

.tt-btn-research {
  background: rgba(40, 100, 60, 0.8);
  color: #88dd88;
  border-color: rgba(60, 160, 80, 0.5);
}

.tt-btn-research:hover {
  background: rgba(50, 120, 70, 0.9);
}

.tt-btn-cancel {
  background: rgba(60, 40, 40, 0.8);
  color: #cc8888;
  border-color: rgba(120, 60, 60, 0.4);
}

.tt-btn-cancel:hover {
  background: rgba(80, 50, 50, 0.9);
}

/* SVG connector lines */
.tt-connector {
  fill: none;
  stroke-width: 2;
}

.tt-connector.locked {
  stroke: rgba(60, 60, 80, 0.25);
  stroke-dasharray: 4 3;
}

.tt-connector.available {
  stroke: rgba(60, 200, 100, 0.4);
}

.tt-connector.completed {
  stroke: rgba(60, 160, 80, 0.5);
}
```

- [ ] **Step 2: Verify styles don't break other overlays**

Open in browser. The goals overlay should still look fine (it uses `.overlay` class, not `.tech-tree-overlay`). The research overlay is now `.tech-tree-overlay`.

- [ ] **Step 3: Commit**

```bash
git add style.css
git commit -m "feat: add tech tree CSS styles, replace old research styles"
```

---

### Task 4: Build the tech tree layout engine

**Files:**
- Modify: `renderer.js:1929-1999` (replace `_renderResearchOverlay` and add tree layout/rendering methods)

- [ ] **Step 1: Add the tree layout helper method**

Replace the `_renderResearchOverlay()` method (lines 1929-1999) with the following methods:

```js
  // --- Tech tree ---

  _buildTreeLayout() {
    const NODE_W = 150;
    const NODE_H = 55;
    const H_GAP = 50;
    const V_GAP = 50;
    const COL_GAP = 60;
    const HEADER_H = 30;

    const categories = Object.keys(RESEARCH_CATEGORIES);
    const layout = {}; // researchId -> { x, y, col }
    let colX = 40;

    for (const cat of categories) {
      const items = Object.entries(RESEARCH).filter(
        ([, r]) => r.category === cat && !r.hidden
      );
      if (items.length === 0) { continue; }

      // Build adjacency: parent -> children
      const children = {};
      const roots = [];
      for (const [id, r] of items) {
        children[id] = [];
        const reqs = r.requires
          ? (Array.isArray(r.requires) ? r.requires : [r.requires])
          : [];
        // Only count requirements within the same category
        const inCatReqs = reqs.filter(req => RESEARCH[req]?.category === cat);
        if (inCatReqs.length === 0) {
          roots.push(id);
        }
      }
      for (const [id, r] of items) {
        const reqs = r.requires
          ? (Array.isArray(r.requires) ? r.requires : [r.requires])
          : [];
        for (const req of reqs) {
          if (RESEARCH[req]?.category === cat && children[req]) {
            children[req].push(id);
          }
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
          }
          queue.push(child);
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

      // Store column header position
      layout['__header_' + cat] = {
        x: colX + colWidth / 2 - NODE_W / 2,
        y: 0,
        col: cat,
        isHeader: true,
        colWidth: colWidth,
      };

      colX += colWidth + COL_GAP;
    }

    this._treeLayout = layout;
    this._treeCanvasWidth = colX;
    const maxY = Math.max(...Object.values(layout).map(l => l.y)) + NODE_H + 80;
    this._treeCanvasHeight = Math.max(maxY, 400);
  }
```

- [ ] **Step 2: Add the render method**

Add immediately after `_buildTreeLayout`:

```js
  _renderTechTree() {
    const canvas = document.getElementById('tt-canvas');
    const svg = document.getElementById('tt-connectors');
    const tabsEl = document.getElementById('tt-category-tabs');
    const activeEl = document.getElementById('tt-active-research');
    if (!canvas || !svg || !tabsEl) return;

    // Rebuild layout if needed
    if (!this._treeLayout) this._buildTreeLayout();
    const layout = this._treeLayout;

    const NODE_W = 150;
    const NODE_H = 55;

    // Set canvas size
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
          if (k.endsWith('Mult')) return `${Math.round((1 - v) * 100)}% ${k.replace('Mult', '')} reduction`;
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

      // Click handler for available nodes
      if (available && !completed && !isActive) {
        node.addEventListener('click', (e) => {
          e.stopPropagation();
          this._showResearchPopover(id, node);
        });
      }

      canvas.appendChild(node);
    }
  }
```

- [ ] **Step 3: Add popover and scroll-to-category helpers**

Add immediately after `_renderTechTree`:

```js
  _showResearchPopover(id, nodeEl) {
    const r = RESEARCH[id];
    const popover = document.getElementById('tt-popover');
    if (!popover) return;

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
        if (k.endsWith('Mult')) return `${Math.round((1 - v) * 100)}% ${k.replace('Mult', '')} reduction`;
        return `+${v} ${k}`;
      });
      unlocksText += (unlocksText ? '\n' : '') + 'Effect: ' + effects.join(', ');
    }

    popover.innerHTML = `
      <div class="tt-popover-name">${r.name}</div>
      <div class="tt-popover-desc">${r.desc}</div>
      ${unlocksText ? `<div class="tt-popover-unlocks">${unlocksText}</div>` : ''}
      <div class="tt-popover-cost">Cost: ${costs} | ${r.duration}s</div>
      <div class="tt-popover-buttons">
        <button class="tt-btn-research" id="tt-btn-start">Research</button>
        <button class="tt-btn-cancel" id="tt-btn-close">Cancel</button>
      </div>
    `;

    // Position popover near the node
    const rect = nodeEl.getBoundingClientRect();
    popover.style.left = (rect.right + 8) + 'px';
    popover.style.top = rect.top + 'px';

    // Keep popover on screen
    popover.classList.remove('hidden');
    const popRect = popover.getBoundingClientRect();
    if (popRect.right > window.innerWidth) {
      popover.style.left = (rect.left - popRect.width - 8) + 'px';
    }
    if (popRect.bottom > window.innerHeight) {
      popover.style.top = (window.innerHeight - popRect.height - 8) + 'px';
    }

    document.getElementById('tt-btn-start').addEventListener('click', () => {
      this.game.startResearch(id);
      popover.classList.add('hidden');
    });
    document.getElementById('tt-btn-close').addEventListener('click', () => {
      popover.classList.add('hidden');
    });
  }

  _scrollToCategory(catId) {
    const hKey = '__header_' + catId;
    const pos = this._treeLayout?.[hKey];
    if (!pos) return;

    const wrapper = document.getElementById('tt-canvas-wrapper');
    if (!wrapper) return;

    const wrapperW = wrapper.clientWidth;
    const targetX = pos.x + 75 - wrapperW / 2; // center the column

    // Update pan position
    this._treePanX = -targetX * this._treeZoom;
    this._treePanY = 0;
    this._applyTreeTransform();
  }

  _applyTreeTransform() {
    const canvas = document.getElementById('tt-canvas');
    const svg = document.getElementById('tt-connectors');
    if (!canvas || !svg) return;
    const tx = `translate(${this._treePanX}px, ${this._treePanY}px) scale(${this._treeZoom})`;
    canvas.style.transform = tx;
    svg.style.transform = tx;
    svg.style.transformOrigin = '0 0';
  }
```

- [ ] **Step 4: Commit**

```bash
git add renderer.js
git commit -m "feat: add tech tree layout engine and rendering methods"
```

---

### Task 5: Wire up pan/zoom and overlay toggle

**Files:**
- Modify: `renderer.js` (the `_bindHUDEvents` method around line 2091, and constructor/init area)

- [ ] **Step 1: Initialize pan/zoom state**

In the `Renderer` constructor (around line 24), add these fields after the existing property declarations:

```js
    // Tech tree pan/zoom state
    this._treePanX = 0;
    this._treePanY = 0;
    this._treeZoom = 1;
    this._treeDragging = false;
    this._treeDragStartX = 0;
    this._treeDragStartY = 0;
    this._treeLayout = null;
```

- [ ] **Step 2: Replace the research button handler in `_bindHUDEvents`**

Find the research button handler (around line 2091-2100) and replace:

```js
    // Research button
    const resBtn = document.getElementById('btn-research');
    if (resBtn) {
      resBtn.addEventListener('click', () => {
        const overlay = document.getElementById('research-overlay');
        if (overlay) {
          overlay.classList.toggle('hidden');
          if (!overlay.classList.contains('hidden')) {
            this._renderResearchOverlay();
```

Replace with:

```js
    // Research button — opens tech tree
    const resBtn = document.getElementById('btn-research');
    if (resBtn) {
      resBtn.addEventListener('click', () => {
        const overlay = document.getElementById('research-overlay');
        if (overlay) {
          overlay.classList.toggle('hidden');
          if (!overlay.classList.contains('hidden')) {
            this._treeLayout = null; // force relayout
            this._renderTechTree();
```

- [ ] **Step 3: Add pan/zoom event binding**

Add a new method `_bindTreeEvents()` and call it from the constructor's init path (right after `_bindHUDEvents` is called). Find where `_bindHUDEvents()` is called and add `this._bindTreeEvents()` after it.

```js
  _bindTreeEvents() {
    const wrapper = document.getElementById('tt-canvas-wrapper');
    if (!wrapper) return;

    // Pan — mousedown/move/up
    wrapper.addEventListener('mousedown', (e) => {
      if (e.target.closest('.tt-node') || e.target.closest('.tt-popover')) return;
      this._treeDragging = true;
      this._treeDragStartX = e.clientX - this._treePanX;
      this._treeDragStartY = e.clientY - this._treePanY;
      // Close popover on background click
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

    // Zoom — scroll wheel
    wrapper.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomSpeed = 0.001;
      const oldZoom = this._treeZoom;
      this._treeZoom = Math.max(0.4, Math.min(1.8, this._treeZoom - e.deltaY * zoomSpeed));

      // Zoom toward cursor position
      const rect = wrapper.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const scale = this._treeZoom / oldZoom;
      this._treePanX = cx - scale * (cx - this._treePanX);
      this._treePanY = cy - scale * (cy - this._treePanY);

      this._applyTreeTransform();
    }, { passive: false });

    // Close on Escape
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const overlay = document.getElementById('research-overlay');
        if (overlay && !overlay.classList.contains('hidden')) {
          overlay.classList.add('hidden');
          e.stopPropagation();
        }
      }
    });
  }
```

- [ ] **Step 4: Update the `researchChanged` event handler**

Find the event handler that calls `_renderResearchOverlay` (around line 168-169 in renderer.js):

```js
        case 'researchChanged':
          this._renderResearchOverlay();
```

Replace with:

```js
        case 'researchChanged':
          this._renderTechTree();
```

- [ ] **Step 5: Also update the init call**

Find line 182 where `_renderResearchOverlay` is called during init:

```js
    this._renderResearchOverlay();
```

Replace with:

```js
    this._renderTechTree();
```

- [ ] **Step 6: Verify the full tech tree works**

Open in browser. Click Research. You should see:
- Full-screen dark overlay
- 8 category columns with headers
- Nodes in correct tree structure
- Locked nodes are dimmed, available ones glow green
- Click an available node → popover appears
- Click Research in popover → research starts
- Drag to pan, scroll to zoom
- Category tabs scroll to column
- Escape closes overlay

- [ ] **Step 7: Commit**

```bash
git add renderer.js
git commit -m "feat: wire up tech tree pan/zoom, overlay toggle, and event handlers"
```

---

### Task 6: Handle the cryomodule requires migration

**Files:**
- Modify: `data.js` (cryomodule component `requires` field)

- [ ] **Step 1: Update cryomodule requires to accept both old and new research**

The cryomodule component currently requires `'superconducting'` (the hidden legacy node). The `srfTechnology` node also unlocks `cryomodule`. Update the component to require `srfTechnology` instead:

Find in `data.js` the cryomodule component (around line 399-413):

```js
    requires: 'superconducting',
```

Change to:

```js
    requires: 'srfTechnology',
```

- [ ] **Step 2: Verify the cryomodule is still unlockable**

Start a new game or use an existing save. Research `rfFundamentals` → `cwRfSystems` → `srfTechnology`. Cryomodule should appear in the palette.

- [ ] **Step 3: Commit**

```bash
git add data.js
git commit -m "fix: update cryomodule requires to srfTechnology"
```

---

### Task 7: Handle tick-based re-render for progress bars

**Files:**
- Modify: `renderer.js` (tick handler or game event)

- [ ] **Step 1: Add periodic tech tree refresh during active research**

The tech tree needs to update the progress bar each tick. Find the game tick event handler in the renderer. In the existing `_onGameEvent` or wherever tick events are handled, add a lightweight update for the active research progress.

Add this method:

```js
  _updateTreeProgress() {
    const overlay = document.getElementById('research-overlay');
    if (!overlay || overlay.classList.contains('hidden')) return;
    if (!this.game.state.activeResearch) return;

    const r = RESEARCH[this.game.state.activeResearch];
    if (!r) return;
    const pct = Math.min(100, (this.game.state.researchProgress / r.duration) * 100);

    // Update progress bar on the node
    const node = document.querySelector(`.tt-node[data-research-id="${this.game.state.activeResearch}"]`);
    if (node) {
      let bar = node.querySelector('.tt-node-progress .bar');
      if (bar) bar.style.width = pct + '%';
    }

    // Update header indicator
    const activeEl = document.getElementById('tt-active-research');
    if (activeEl) {
      activeEl.textContent = `Researching: ${r.name} (${Math.round(pct)}%)`;
    }
  }
```

Then find where the renderer handles tick events (look for `case 'tick'` or similar in the event handler), and add:

```js
    this._updateTreeProgress();
```

If there's no tick event in the renderer, add the call inside the `researchChanged` event case (which already triggers `_renderTechTree`). The full re-render on `researchChanged` handles completion; this lightweight method handles the per-tick progress bar.

Alternatively, if the renderer has a `render()` or `update()` loop that runs each frame/tick, add `this._updateTreeProgress()` there.

- [ ] **Step 2: Verify progress bar animates**

Start researching something, open the tech tree. The progress bar on the active node should fill gradually. The header should show "Researching: X (Y%)".

- [ ] **Step 3: Commit**

```bash
git add renderer.js
git commit -m "feat: add per-tick progress bar updates for tech tree"
```

---

### Task 8: Final cleanup and edge cases

**Files:**
- Modify: `renderer.js`, `data.js`

- [ ] **Step 1: Remove the old `_renderResearchOverlay` method if any remnants exist**

Search renderer.js for any remaining references to `_renderResearchOverlay`. Remove them.

- [ ] **Step 2: Ensure sextupole research mapping is correct**

The sextupole component currently `requires: 'advancedOptics'`, but the spec's beam optics tree has `beamOptics` unlocking collimator and the `advancedOptics` node unlocking sextupole + octupole. Check that `advancedOptics` has `unlocks: ['sextupole', 'octupole']` in the RESEARCH data (it should from Task 1). Verify `beamOptics` has `unlocks: ['collimator']` (currently has `['collimator', 'sextupole']` — remove sextupole from beamOptics unlocks since it moves to advancedOptics).

In data.js, find the `beamOptics` research entry and change:

```js
    unlocks: ['collimator', 'sextupole'],
```

to:

```js
    unlocks: ['collimator'],
```

- [ ] **Step 3: Verify complete flow end-to-end**

1. Open game, click Research
2. See all 8 category columns
3. All root nodes should be available (green)
4. Click a root node → popover → Research → node starts animating
5. Wait for completion → child nodes become available
6. Pan by dragging, zoom with scroll wheel
7. Category tabs jump to correct column
8. Escape closes overlay
9. Open again — state is preserved

- [ ] **Step 4: Commit**

```bash
git add renderer.js data.js
git commit -m "fix: cleanup old research overlay refs, correct sextupole gating"
```
