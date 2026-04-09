# Isometric Beamline UI — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the grid-based DOM UI with an isometric RCT-style PixiJS renderer where players build beamlines like roller coaster tracks.

**Architecture:** New PixiJS renderer (`renderer.js`) replaces `ui.js`. New directed graph model (`beamline.js`) replaces grid-based placement. `game.js` is refactored to use the graph model. `physics.js` and `beam_physics/` are untouched. `data.js` updated for track-based components.

**Tech Stack:** PixiJS v8 (CDN), vanilla JS, Pyodide (existing)

**Spec:** `docs/superpowers/specs/2026-04-06-isometric-beamline-ui-design.md`

---

## File Structure

### New files
- `beamline.js` — Directed graph model for the beamline. Nodes are placed components with grid position + direction. Edges connect sequential segments. Handles track-laying logic, direction changes (dipoles), branching (splitters), and loop closure. Exports ordered component list for physics.
- `renderer.js` — PixiJS isometric renderer. Creates the Application, world container with zoom/pan, isometric grid, component sprites, beam visualization, construction cursor, minimap, and HUD overlays.
- `sprites.js` — Sprite asset manager. Creates placeholder isometric sprites procedurally (colored diamonds/boxes). Manages LOD switching based on zoom. Later replaced with PixelLab-generated assets.
- `input.js` — Input handler. Keyboard (WASD/arrows for pan, Tab for category cycling, Space for beam, R/G for overlays, Esc to close). Mouse (click to place/select, drag to pan, scroll to zoom). Screen-to-isometric coordinate conversion.
- `test/test-beamline.js` — Node.js tests for the beamline directed graph model.
- `test/test-iso.js` — Node.js tests for isometric coordinate math.

### Modified files
- `data.js` — Remove `w`, `h`, `GRID_COLS`, `GRID_ROWS`, `CELL_SIZE`. Add `trackLength` (tiles along path), `bendAngle` for dipoles, `spriteKey` for each component. Add `DIRECTIONS` and `CATEGORIES` constants.
- `game.js` — Remove all grid methods (`cellKey`, `isCellOccupied`, `getComponentAt`, `canPlaceAt`, `hasAdjacentComponent`, `getBorderCells`, `getAdjacentComponents`, `rebuildGrid`, `getCells`, `getCompCenter`, `rotatedSize`). Remove `calcBeamPath` (BFS). Replace `placeComponent` and `_removeComp` to delegate to `Beamline`. Add `getBeamline()` accessor. Keep: resources, research, objectives, tick loop, physics integration, save/load.
- `index.html` — Strip DOM grid, toolbar, side panel. Keep a single `<div id="game">` with a `<canvas>` element. Add PixiJS CDN script. Add DOM overlays for HUD (resource bar, stats, component palette) and overlay panels (research, goals).
- `style.css` — Complete rewrite for isometric layout. Minimal — only styles DOM overlays (HUD bar, palette, popups). PixiJS handles all in-game rendering.
- `main.js` — New initialization: create Game, create Beamline, create Renderer, wire events, start game loop and render loop.

### Unchanged files
- `physics.js` — Untouched.
- `beam_physics/` — Untouched.

---

### Task 1: Set Up PixiJS and Project Structure

**Files:**
- Modify: `index.html`
- Modify: `style.css`

- [ ] **Step 1: Rewrite index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Beamline Tycoon</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="game">
    <!-- PixiJS canvas inserted here by renderer.js -->

    <!-- Top resource bar (DOM overlay) -->
    <div id="top-bar">
      <span id="game-title">🤠 BEAMLINE TYCOON</span>
      <div id="resources">
        <span class="res" id="res-funding">💰 $500</span>
        <span class="res" id="res-energy">⚡ 100 E</span>
        <span class="res" id="res-reputation">⭐ 0 Rep</span>
        <span class="res" id="res-data">📊 0 Data</span>
      </div>
    </div>

    <!-- Bottom HUD (DOM overlay) -->
    <div id="bottom-hud">
      <div id="beam-stats">
        <span class="stat" id="stat-beam-status">● Beam: OFF</span>
        <span class="stat" id="stat-energy">Energy: 0 GeV</span>
        <span class="stat" id="stat-current">Current: -- mA</span>
        <span class="stat" id="stat-luminosity">Luminosity: 0</span>
        <span class="stat" id="stat-length">Length: 0m</span>
      </div>
      <div id="component-tabs">
        <button class="cat-tab active" data-category="source">Sources</button>
        <button class="cat-tab" data-category="magnet">Magnets</button>
        <button class="cat-tab" data-category="rf">RF/Accel</button>
        <button class="cat-tab" data-category="diagnostic">Diagnostics</button>
        <button class="cat-tab" data-category="special">Beam Optics</button>
        <span class="tab-spacer"></span>
        <button class="overlay-btn" id="btn-research">📋 Research</button>
        <button class="overlay-btn" id="btn-goals">🎯 Goals</button>
        <button class="overlay-btn" id="btn-beam-toggle">▶ START BEAM</button>
      </div>
      <div id="component-palette"></div>
    </div>

    <!-- Research overlay (hidden by default) -->
    <div id="overlay-research" class="overlay hidden">
      <div class="overlay-header">
        <span>Research</span>
        <button class="overlay-close">✕</button>
      </div>
      <div id="research-list" class="overlay-body"></div>
    </div>

    <!-- Goals overlay (hidden by default) -->
    <div id="overlay-goals" class="overlay hidden">
      <div class="overlay-header">
        <span>Goals</span>
        <button class="overlay-close">✕</button>
      </div>
      <div id="goals-list" class="overlay-body"></div>
    </div>

    <!-- Component detail popup (hidden by default) -->
    <div id="component-popup" class="popup hidden"></div>
  </div>

  <script src="https://cdn.jsdelivr.net/pyodide/v0.27.4/full/pyodide.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/pixi.js@8/dist/pixi.min.js"></script>
  <script src="data.js"></script>
  <script src="physics.js"></script>
  <script src="beamline.js"></script>
  <script src="game.js"></script>
  <script src="sprites.js"></script>
  <script src="input.js"></script>
  <script src="renderer.js"></script>
  <script src="main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Rewrite style.css**

```css
@import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');

* { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --hud-bg: rgba(20, 20, 40, 0.92);
  --hud-border: #444;
  --text: #ccc;
  --text-bright: #fff;
  --green: #4f4;
  --yellow: #ff0;
  --blue: #4af;
  --pink: #f4f;
  --red: #f44;
  --tab-active: rgba(60, 60, 80, 0.9);
  --tab-hover: rgba(50, 50, 70, 0.9);
}

body {
  font-family: 'Press Start 2P', monospace;
  background: #0a0a1a;
  color: var(--text);
  overflow: hidden;
  font-size: 10px;
  image-rendering: pixelated;
}

#game {
  position: relative;
  width: 100vw;
  height: 100vh;
}

#game canvas {
  display: block;
}

/* === TOP BAR === */
#top-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 16px;
  background: var(--hud-bg);
  border-bottom: 2px solid var(--hud-border);
}

#game-title {
  color: #f90;
  font-size: 11px;
  font-weight: bold;
}

#resources {
  display: flex;
  gap: 20px;
  font-size: 10px;
}

#res-funding { color: var(--green); }
#res-energy { color: var(--yellow); }
#res-reputation { color: var(--blue); }
#res-data { color: var(--pink); }

/* === BOTTOM HUD === */
#bottom-hud {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 10;
  background: var(--hud-bg);
  border-top: 2px solid var(--hud-border);
}

#beam-stats {
  display: flex;
  gap: 20px;
  padding: 4px 16px;
  font-size: 9px;
  border-bottom: 1px solid #333;
}

.stat { color: #aaa; }
#stat-beam-status { color: var(--red); }
#stat-beam-status.on { color: var(--green); }

#component-tabs {
  display: flex;
  padding: 4px 8px;
  gap: 4px;
  align-items: center;
}

.cat-tab {
  font-family: inherit;
  font-size: 8px;
  padding: 4px 10px;
  background: transparent;
  color: var(--text);
  border: 1px solid #555;
  border-radius: 3px;
  cursor: pointer;
}

.cat-tab:hover { background: var(--tab-hover); }
.cat-tab.active { background: var(--tab-active); border-color: var(--blue); color: var(--blue); }

.tab-spacer { flex: 1; }

.overlay-btn {
  font-family: inherit;
  font-size: 8px;
  padding: 4px 10px;
  background: transparent;
  color: #aaa;
  border: 1px solid #555;
  border-radius: 3px;
  cursor: pointer;
}

.overlay-btn:hover { background: var(--tab-hover); color: var(--text-bright); }

#btn-beam-toggle { color: var(--green); border-color: var(--green); }
#btn-beam-toggle.running { color: var(--red); border-color: var(--red); }

#component-palette {
  display: flex;
  padding: 6px 8px;
  gap: 6px;
  overflow-x: auto;
}

.palette-item {
  width: 55px;
  height: 45px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 1px solid #555;
  border-radius: 3px;
  cursor: pointer;
  background: rgba(40, 40, 50, 0.6);
  gap: 2px;
}

.palette-item:hover { border-color: var(--blue); background: rgba(40, 40, 60, 0.8); }
.palette-item.selected { border-color: var(--blue); background: rgba(40, 50, 80, 0.8); box-shadow: 0 0 6px rgba(68,170,255,0.3); }
.palette-item.locked { opacity: 0.4; cursor: not-allowed; }
.palette-item.unaffordable { opacity: 0.6; }
.palette-item .p-name { font-size: 6px; color: #aaa; }
.palette-item .p-cost { font-size: 6px; color: var(--green); }

/* === OVERLAYS === */
.overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 20;
  width: 400px;
  max-height: 70vh;
  background: var(--hud-bg);
  border: 2px solid var(--hud-border);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
}

.overlay.hidden { display: none; }

.overlay-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid #333;
  font-size: 11px;
  color: var(--text-bright);
}

.overlay-close {
  font-family: inherit;
  font-size: 10px;
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
}

.overlay-close:hover { color: var(--text-bright); }

.overlay-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

/* Research items */
.research-item {
  padding: 6px 8px;
  margin-bottom: 4px;
  border: 1px solid #333;
  border-radius: 3px;
  cursor: pointer;
  font-size: 8px;
}

.research-item:hover { background: rgba(50, 50, 70, 0.5); }
.research-item.completed { opacity: 0.5; border-color: var(--green); }
.research-item.researching { border-color: var(--yellow); }
.research-item.locked { opacity: 0.35; cursor: not-allowed; }
.research-item .r-name { font-size: 9px; margin-bottom: 2px; }
.research-item .r-cost { font-size: 7px; color: var(--blue); }
.research-item .r-desc { font-size: 7px; color: #888; margin-top: 2px; line-height: 1.6; }
.research-item .r-progress { height: 4px; background: #333; margin-top: 4px; border-radius: 2px; }
.research-item .r-progress .bar { height: 100%; background: var(--yellow); border-radius: 2px; }

/* Objective items */
.objective-item {
  padding: 6px 8px;
  margin-bottom: 4px;
  border: 1px solid #333;
  border-radius: 3px;
  font-size: 8px;
}

.objective-item.completed { border-color: var(--green); opacity: 0.6; }
.objective-item .o-name { font-size: 9px; margin-bottom: 2px; }
.objective-item .o-desc { font-size: 7px; color: #888; line-height: 1.6; }
.objective-item .o-reward { font-size: 7px; color: var(--green); margin-top: 2px; }

/* === COMPONENT POPUP === */
.popup {
  position: absolute;
  z-index: 15;
  width: 220px;
  background: var(--hud-bg);
  border: 2px solid var(--hud-border);
  border-radius: 6px;
  padding: 10px;
  font-size: 8px;
}

.popup.hidden { display: none; }
.popup .popup-title { font-size: 10px; margin-bottom: 6px; color: var(--text-bright); }
.popup .popup-row { display: flex; justify-content: space-between; padding: 2px 0; }
.popup .popup-label { color: #888; }
.popup .popup-value { color: var(--text-bright); }
.popup .popup-desc { font-size: 7px; color: #666; margin-top: 6px; line-height: 1.6; }
.popup .popup-actions { margin-top: 8px; display: flex; gap: 4px; }
.popup .popup-btn {
  font-family: inherit;
  font-size: 7px;
  padding: 3px 8px;
  background: rgba(40, 40, 60, 0.8);
  color: var(--text);
  border: 1px solid #555;
  border-radius: 3px;
  cursor: pointer;
}
.popup .popup-btn:hover { border-color: var(--blue); }
.popup .popup-btn.danger { color: var(--red); border-color: var(--red); }

/* === SCROLLBAR === */
::-webkit-scrollbar { width: 8px; }
::-webkit-scrollbar-track { background: #1a1a2e; }
::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: #444; }
```

- [ ] **Step 3: Verify the page loads with PixiJS**

Open `index.html` in a browser. Verify:
- Dark background visible
- Top bar with resources visible
- Bottom HUD with tabs visible
- No console errors about missing scripts (they don't exist yet, but PixiJS should load)
- Browser console: `PIXI` object is defined

- [ ] **Step 4: Commit**

```bash
git add index.html style.css
git commit -m "feat: rewrite HTML/CSS for isometric layout with PixiJS"
```

---

### Task 2: Update Data Model

**Files:**
- Modify: `data.js`

- [ ] **Step 1: Rewrite data.js with track-based components**

Replace the entire file. Key changes: remove `GRID_COLS`, `GRID_ROWS`, `CELL_SIZE`, `w`, `h` from components. Add `trackLength`, `bendAngle`, `category` (for palette grouping), `spriteKey`.

```js
// === BEAMLINE TYCOON: GAME DATA ===

// Isometric directions: the four cardinal directions in iso space
const DIR = {
  NE: 0,  // up-right
  SE: 1,  // down-right
  SW: 2,  // down-left
  NW: 3,  // up-left
};

const DIR_NAMES = ['NE', 'SE', 'SW', 'NW'];

// Delta for each direction in grid coords (col, row)
const DIR_DELTA = [
  { dc: 1, dr: -1 },  // NE
  { dc: 1, dr: 1 },   // SE
  { dc: -1, dr: 1 },  // SW
  { dc: -1, dr: -1 }, // NW
];

function turnLeft(dir) { return (dir + 3) % 4; }
function turnRight(dir) { return (dir + 1) % 4; }
function reverseDir(dir) { return (dir + 2) % 4; }

// Isometric tile dimensions (pixels)
const TILE_W = 64;
const TILE_H = 32;

// Component palette categories
const CATEGORIES = {
  source: { name: 'Sources', color: '#4a9' },
  magnet: { name: 'Magnets', color: '#c44' },
  rf: { name: 'RF/Accel', color: '#c90' },
  diagnostic: { name: 'Diagnostics', color: '#44c' },
  special: { name: 'Beam Optics', color: '#a4a' },
};

const COMPONENTS = {
  source: {
    id: 'source',
    name: 'Source',
    desc: 'Generates a beam of particles. Every beamline needs one.',
    category: 'source',
    cost: { funding: 100 },
    stats: { beamCurrent: 1 },
    energyCost: 5,
    length: 2,
    trackLength: 2,
    maxCount: 2,
    unlocked: true,
    isSource: true,
    spriteKey: 'source',
    spriteColor: 0x44aa99,
  },
  drift: {
    id: 'drift',
    name: 'Drift Tube',
    desc: 'A straight section of beam pipe. Cheap but essential.',
    category: 'source',
    cost: { funding: 20 },
    stats: {},
    energyCost: 0,
    length: 5,
    trackLength: 1,
    unlocked: true,
    spriteKey: 'drift',
    spriteColor: 0x666666,
  },
  dipole: {
    id: 'dipole',
    name: 'Dipole',
    desc: 'Bends the beam 90°. Choose left or right when placing.',
    category: 'magnet',
    cost: { funding: 200 },
    stats: { bendAngle: 90 },
    energyCost: 8,
    length: 3,
    trackLength: 2,
    unlocked: true,
    isDipole: true,
    spriteKey: 'dipole',
    spriteColor: 0xaa44aa,
  },
  quadrupole: {
    id: 'quadrupole',
    name: 'Quad',
    desc: 'Focuses the beam to maintain tight bunches.',
    category: 'magnet',
    cost: { funding: 150 },
    stats: { focusStrength: 1 },
    energyCost: 6,
    length: 2,
    trackLength: 1,
    unlocked: true,
    spriteKey: 'quadrupole',
    spriteColor: 0xcc4444,
  },
  rfCavity: {
    id: 'rfCavity',
    name: 'RF Cavity',
    desc: 'Accelerates particles with radio-frequency fields.',
    category: 'rf',
    cost: { funding: 500 },
    stats: { energyGain: 0.5 },
    energyCost: 20,
    length: 4,
    trackLength: 3,
    unlocked: true,
    spriteKey: 'rfCavity',
    spriteColor: 0xcc9900,
  },
  detector: {
    id: 'detector',
    name: 'Detector',
    desc: 'Records particle interactions and generates research data.',
    category: 'diagnostic',
    cost: { funding: 800 },
    stats: { dataRate: 1 },
    energyCost: 15,
    length: 6,
    trackLength: 3,
    unlocked: true,
    spriteKey: 'detector',
    spriteColor: 0x4444cc,
  },
  splitter: {
    id: 'splitter',
    name: 'Splitter',
    desc: 'Splits the beam into two paths. Each carries half the current.',
    category: 'special',
    cost: { funding: 400 },
    stats: {},
    energyCost: 10,
    length: 2,
    trackLength: 2,
    unlocked: true,
    isSplitter: true,
    spriteKey: 'splitter',
    spriteColor: 0x55aa55,
  },
  undulator: {
    id: 'undulator',
    name: 'Undulator',
    desc: 'Wiggles the beam to produce synchrotron light.',
    category: 'special',
    cost: { funding: 1200 },
    stats: { photonRate: 1 },
    energyCost: 12,
    length: 5,
    trackLength: 3,
    requires: 'synchrotronLight',
    spriteKey: 'undulator',
    spriteColor: 0x6644aa,
  },
  collimator: {
    id: 'collimator',
    name: 'Collimator',
    desc: 'Cleans up the beam by removing stray particles.',
    category: 'special',
    cost: { funding: 300 },
    stats: { beamQuality: 0.2 },
    energyCost: 2,
    length: 2,
    trackLength: 1,
    requires: 'beamOptics',
    spriteKey: 'collimator',
    spriteColor: 0x777744,
  },
  target: {
    id: 'target',
    name: 'Target',
    desc: 'Smashes the beam into a target for fixed-target physics.',
    category: 'diagnostic',
    cost: { funding: 600 },
    stats: { collisionRate: 2 },
    energyCost: 0,
    length: 3,
    trackLength: 2,
    requires: 'targetPhysics',
    isEndpoint: true,
    spriteKey: 'target',
    spriteColor: 0x886644,
  },
  cryomodule: {
    id: 'cryomodule',
    name: 'Cryomod',
    desc: 'Superconducting RF cavity. Much higher energy gain.',
    category: 'rf',
    cost: { funding: 2000 },
    stats: { energyGain: 2.0 },
    energyCost: 30,
    length: 5,
    trackLength: 4,
    requires: 'superconducting',
    spriteKey: 'cryomodule',
    spriteColor: 0x4466aa,
  },
  sextupole: {
    id: 'sextupole',
    name: 'Sextupole',
    desc: 'Corrects chromatic aberrations in the beam.',
    category: 'special',
    cost: { funding: 400 },
    stats: { focusStrength: 0.5, beamQuality: 0.3 },
    energyCost: 8,
    length: 2,
    trackLength: 1,
    requires: 'advancedOptics',
    spriteKey: 'sextupole',
    spriteColor: 0x886655,
  },
};

// RESEARCH and OBJECTIVES unchanged from original
const RESEARCH = {
  beamOptics: {
    id: 'beamOptics', name: 'Beam Optics',
    desc: 'Understand how to shape and clean beams. Unlocks Collimator.',
    cost: { data: 10 }, duration: 30, unlocks: ['collimator'], requires: null,
  },
  targetPhysics: {
    id: 'targetPhysics', name: 'Target Physics',
    desc: 'Study fixed-target collisions. Unlocks Fixed Target.',
    cost: { data: 15 }, duration: 45, unlocks: ['target'], requires: null,
  },
  synchrotronLight: {
    id: 'synchrotronLight', name: 'Synchrotron Light',
    desc: 'Harness photon beams. Unlocks Undulator.',
    cost: { data: 25 }, duration: 60, unlocks: ['undulator'], requires: 'beamOptics',
  },
  advancedOptics: {
    id: 'advancedOptics', name: 'Advanced Optics',
    desc: 'Higher-order corrections. Unlocks Sextupole.',
    cost: { data: 30 }, duration: 50, unlocks: ['sextupole'], requires: 'beamOptics',
  },
  superconducting: {
    id: 'superconducting', name: 'Superconducting RF',
    desc: 'Near absolute zero cavities. Unlocks Cryomodule.',
    cost: { data: 50 }, duration: 90, unlocks: ['cryomodule'], requires: null,
  },
  highLuminosity: {
    id: 'highLuminosity', name: 'High Luminosity',
    desc: 'Squeeze beams tighter for more collisions.',
    cost: { data: 40 }, duration: 70, effect: { luminosityMult: 2 }, requires: 'advancedOptics',
  },
  dataAnalysis: {
    id: 'dataAnalysis', name: 'Data Analysis',
    desc: 'Better algorithms for detector signals.',
    cost: { data: 20 }, duration: 40, effect: { dataRateMult: 2 }, requires: null,
  },
  energyRecovery: {
    id: 'energyRecovery', name: 'Energy Recovery',
    desc: 'Recoup energy from beams. Reduces costs.',
    cost: { data: 35 }, duration: 60, effect: { energyCostMult: 0.7 }, requires: 'superconducting',
  },
  automation: {
    id: 'automation', name: 'Automation',
    desc: 'Automated tuning. Passive funding from tours.',
    cost: { data: 25 }, duration: 50, effect: { passiveFunding: 2 }, requires: 'dataAnalysis',
  },
  particleDiscovery: {
    id: 'particleDiscovery', name: 'Discovery',
    desc: 'New techniques to discover exotic particles.',
    cost: { data: 80 }, duration: 120, effect: { discoveryChance: 0.1 }, requires: 'highLuminosity',
  },
};

const OBJECTIVES = [
  { id: 'firstBeam', name: 'First Beam!', desc: 'Build a source and turn on the beam.',
    condition: (s) => s.beamOn && s.beamline.length > 0 && s.beamline.some(n => COMPONENTS[n.type]?.isSource),
    reward: { funding: 500, reputation: 1 }, tier: 1 },
  { id: 'firstData', name: 'First Light', desc: 'Collect 10 units of research data.',
    condition: (s) => s.totalDataCollected >= 10,
    reward: { funding: 300, reputation: 1 }, tier: 1 },
  { id: 'firstResearch', name: 'Knowledge Seeker', desc: 'Complete your first research project.',
    condition: (s) => s.completedResearch.length >= 1,
    reward: { funding: 500, reputation: 2 }, tier: 1 },
  { id: 'reach1gev', name: 'GeV Club', desc: 'Reach a beam energy of 1 GeV.',
    condition: (s) => s.beamEnergy >= 1,
    reward: { funding: 1000, reputation: 3 }, tier: 2 },
  { id: 'tenComponents', name: 'Growing Machine', desc: 'Install 10 components on your beamline.',
    condition: (s) => s.beamline.length >= 10,
    reward: { funding: 800, reputation: 2 }, tier: 2 },
  { id: 'collect100data', name: 'Data Hoarder', desc: 'Collect 100 units of research data.',
    condition: (s) => s.totalDataCollected >= 100,
    reward: { funding: 1500, reputation: 3 }, tier: 2 },
  { id: 'threeResearch', name: 'Research Program', desc: 'Complete 3 research projects.',
    condition: (s) => s.completedResearch.length >= 3,
    reward: { funding: 2000, reputation: 5 }, tier: 2 },
  { id: 'reach10gev', name: 'High Energy', desc: 'Reach a beam energy of 10 GeV.',
    condition: (s) => s.beamEnergy >= 10,
    reward: { funding: 5000, reputation: 10 }, tier: 3 },
  { id: 'userFacility', name: 'User Facility', desc: 'Reach 10 reputation.',
    condition: (s) => s.resources.reputation >= 10,
    reward: { funding: 3000 }, tier: 3 },
  { id: 'collect1000data', name: 'Big Data', desc: 'Collect 1,000 units of research data.',
    condition: (s) => s.totalDataCollected >= 1000,
    reward: { funding: 5000, reputation: 10 }, tier: 3 },
  { id: 'allResearch', name: 'Omniscient', desc: 'Complete all research projects.',
    condition: (s) => s.completedResearch.length >= Object.keys(RESEARCH).length,
    reward: { funding: 10000, reputation: 20 }, tier: 4 },
  { id: 'reach100gev', name: 'Frontier Energy', desc: 'Reach a beam energy of 100 GeV.',
    condition: (s) => s.beamEnergy >= 100,
    reward: { funding: 20000, reputation: 30 }, tier: 4 },
  { id: 'discovery', name: 'Nobel Prize', desc: 'Make a particle discovery.',
    condition: (s) => s.discoveries > 0,
    reward: { funding: 50000, reputation: 50 }, tier: 5 },
];
```

Note: removed `driftVert` since direction is now implicit in the track-laying system. A drift placed when heading NE goes NE; no need for separate horizontal/vertical variants.

- [ ] **Step 2: Commit**

```bash
git add data.js
git commit -m "feat: update data model for isometric track-based components"
```

---

### Task 3: Create Beamline Directed Graph

**Files:**
- Create: `beamline.js`
- Create: `test/test-beamline.js`

This is the core data model. The beamline is a directed graph of nodes. Each node has a grid position, direction, and component type. Track-laying appends nodes to the end of the current path.

- [ ] **Step 1: Write tests for the beamline model**

```js
// test/test-beamline.js
// Run: node test/test-beamline.js
// Requires data.js globals — we simulate them minimally

// Minimal stubs for data.js globals needed by beamline.js
globalThis.DIR = { NE: 0, SE: 1, SW: 2, NW: 3 };
globalThis.DIR_DELTA = [
  { dc: 1, dr: -1 }, { dc: 1, dr: 1 },
  { dc: -1, dr: 1 }, { dc: -1, dr: -1 },
];
globalThis.turnLeft = (d) => (d + 3) % 4;
globalThis.turnRight = (d) => (d + 1) % 4;
globalThis.reverseDir = (d) => (d + 2) % 4;
globalThis.COMPONENTS = {
  source: { id: 'source', trackLength: 2, isSource: true },
  drift: { id: 'drift', trackLength: 1 },
  dipole: { id: 'dipole', trackLength: 2, isDipole: true },
  quadrupole: { id: 'quadrupole', trackLength: 1 },
  rfCavity: { id: 'rfCavity', trackLength: 3 },
  splitter: { id: 'splitter', trackLength: 2, isSplitter: true },
  detector: { id: 'detector', trackLength: 3, isEndpoint: true },
};

// Load beamline.js
require('../beamline.js');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; }
  else { failed++; console.error(`FAIL: ${msg}`); }
}

// Test 1: Create beamline and place source
{
  const bl = new Beamline();
  const id = bl.placeSource(5, 5, DIR.NE);
  assert(id !== null, 'placeSource returns an id');
  assert(bl.nodes.length === 1, 'one node after placing source');
  assert(bl.nodes[0].type === 'source', 'node type is source');
  assert(bl.nodes[0].col === 5, 'source col');
  assert(bl.nodes[0].row === 5, 'source row');
  assert(bl.nodes[0].dir === DIR.NE, 'source direction');
}

// Test 2: Get build cursor after source
{
  const bl = new Beamline();
  bl.placeSource(5, 5, DIR.NE);
  const cursors = bl.getBuildCursors();
  assert(cursors.length === 1, 'one build cursor after source');
  // Source trackLength=2, so cursor should be 2 tiles NE from (5,5)
  // NE delta is (1,-1), so 2 steps: col=7, row=3
  assert(cursors[0].col === 7, 'cursor col after source');
  assert(cursors[0].row === 3, 'cursor row after source');
  assert(cursors[0].dir === DIR.NE, 'cursor dir after source');
}

// Test 3: Place drift after source
{
  const bl = new Beamline();
  bl.placeSource(5, 5, DIR.NE);
  const cursors = bl.getBuildCursors();
  const id = bl.placeAt(cursors[0], 'drift');
  assert(id !== null, 'drift placed successfully');
  assert(bl.nodes.length === 2, 'two nodes after drift');
  // Drift trackLength=1, NE from (7,3): cursor at (8,2)
  const c2 = bl.getBuildCursors();
  assert(c2.length === 1, 'one cursor after drift');
  assert(c2[0].col === 8, 'cursor col after drift');
  assert(c2[0].row === 2, 'cursor row after drift');
}

// Test 4: Dipole changes direction (turn right: NE -> SE)
{
  const bl = new Beamline();
  bl.placeSource(5, 5, DIR.NE);
  const c1 = bl.getBuildCursors();
  bl.placeAt(c1[0], 'dipole', 'right');
  const c2 = bl.getBuildCursors();
  assert(c2[0].dir === DIR.SE, 'dipole right turns NE to SE');
}

// Test 5: Dipole changes direction (turn left: NE -> NW)
{
  const bl = new Beamline();
  bl.placeSource(5, 5, DIR.NE);
  const c1 = bl.getBuildCursors();
  bl.placeAt(c1[0], 'dipole', 'left');
  const c2 = bl.getBuildCursors();
  assert(c2[0].dir === DIR.NW, 'dipole left turns NE to NW');
}

// Test 6: Splitter creates two build cursors
{
  const bl = new Beamline();
  bl.placeSource(5, 5, DIR.NE);
  const c1 = bl.getBuildCursors();
  bl.placeAt(c1[0], 'splitter');
  const c2 = bl.getBuildCursors();
  assert(c2.length === 2, 'splitter creates two cursors');
  // One continues NE, one turns (left = NW)
  const dirs = c2.map(c => c.dir).sort();
  assert(dirs.includes(DIR.NE), 'splitter has straight path');
  assert(dirs.includes(DIR.NW), 'splitter has branched path');
}

// Test 7: getOrderedComponents returns physics-ready list
{
  const bl = new Beamline();
  bl.placeSource(5, 5, DIR.NE);
  const c1 = bl.getBuildCursors();
  bl.placeAt(c1[0], 'drift');
  const c2 = bl.getBuildCursors();
  bl.placeAt(c2[0], 'quadrupole');
  const ordered = bl.getOrderedComponents();
  assert(ordered.length === 3, 'three components in order');
  assert(ordered[0].type === 'source', 'first is source');
  assert(ordered[1].type === 'drift', 'second is drift');
  assert(ordered[2].type === 'quadrupole', 'third is quadrupole');
}

// Test 8: Occupied tiles tracked correctly
{
  const bl = new Beamline();
  bl.placeSource(5, 5, DIR.NE);
  // Source at (5,5) with trackLength=2 heading NE: occupies (5,5) and (6,4)
  assert(bl.isTileOccupied(5, 5), 'source tile 1 occupied');
  assert(bl.isTileOccupied(6, 4), 'source tile 2 occupied');
  assert(!bl.isTileOccupied(7, 3), 'next tile not occupied');
}

// Test 9: Remove last node
{
  const bl = new Beamline();
  bl.placeSource(5, 5, DIR.NE);
  const c1 = bl.getBuildCursors();
  const driftId = bl.placeAt(c1[0], 'drift');
  assert(bl.nodes.length === 2, 'two nodes before remove');
  bl.removeNode(driftId);
  assert(bl.nodes.length === 1, 'one node after remove');
}

// Test 10: Cannot place on occupied tile
{
  const bl = new Beamline();
  bl.placeSource(5, 5, DIR.NE);
  const id2 = bl.placeSource(5, 5, DIR.SE);
  assert(id2 === null, 'cannot place on occupied tile');
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node test/test-beamline.js`
Expected: Error — `Beamline is not defined`

- [ ] **Step 3: Implement beamline.js**

```js
// === BEAMLINE TYCOON: DIRECTED GRAPH MODEL ===

class Beamline {
  constructor() {
    this.nodes = [];       // { id, type, col, row, dir, parentId, bendDir, tiles: [{col,row}] }
    this.occupied = {};    // "col,row" -> nodeId
    this.nextId = 1;
  }

  _makeId() {
    return `node-${this.nextId++}`;
  }

  _tileKey(col, row) {
    return `${col},${row}`;
  }

  // Calculate the tiles a component occupies starting at (col,row) heading in dir
  _calcTiles(col, row, dir, trackLength) {
    const tiles = [];
    const delta = DIR_DELTA[dir];
    for (let i = 0; i < trackLength; i++) {
      tiles.push({ col: col + delta.dc * i, row: row + delta.dr * i });
    }
    return tiles;
  }

  // Check if any of the given tiles are already occupied
  _tilesAvailable(tiles) {
    return tiles.every(t => !this.occupied[this._tileKey(t.col, t.row)]);
  }

  // Register tiles as occupied by a node
  _occupyTiles(tiles, nodeId) {
    for (const t of tiles) {
      this.occupied[this._tileKey(t.col, t.row)] = nodeId;
    }
  }

  // Free tiles occupied by a node
  _freeTiles(tiles) {
    for (const t of tiles) {
      delete this.occupied[this._tileKey(t.col, t.row)];
    }
  }

  isTileOccupied(col, row) {
    return !!this.occupied[this._tileKey(col, row)];
  }

  getNodeAt(col, row) {
    const id = this.occupied[this._tileKey(col, row)];
    if (!id) return null;
    return this.nodes.find(n => n.id === id) || null;
  }

  // Place the first source freely on the map
  placeSource(col, row, dir) {
    const template = COMPONENTS.source;
    const tiles = this._calcTiles(col, row, dir, template.trackLength);
    if (!this._tilesAvailable(tiles)) return null;

    const node = {
      id: this._makeId(),
      type: 'source',
      col, row, dir,
      parentId: null,
      bendDir: null,
      tiles,
    };

    this.nodes.push(node);
    this._occupyTiles(tiles, node.id);
    return node.id;
  }

  // Place a component at a build cursor position
  // cursor: { col, row, dir, parentId }
  // bendDir: 'left' or 'right' (only for dipoles)
  placeAt(cursor, compType, bendDir) {
    const template = COMPONENTS[compType];
    if (!template) return null;
    if (template.isSource) return null; // sources placed via placeSource

    const tiles = this._calcTiles(cursor.col, cursor.row, cursor.dir, template.trackLength);
    if (!this._tilesAvailable(tiles)) return null;

    let dir = cursor.dir;
    if (template.isDipole) {
      if (bendDir === 'left') dir = turnLeft(cursor.dir);
      else if (bendDir === 'right') dir = turnRight(cursor.dir);
      // dir is now the EXIT direction after the bend
    }

    const node = {
      id: this._makeId(),
      type: compType,
      col: cursor.col,
      row: cursor.row,
      dir,           // exit direction (post-bend for dipoles)
      entryDir: cursor.dir,  // entry direction (pre-bend)
      parentId: cursor.parentId,
      bendDir: template.isDipole ? (bendDir || 'right') : null,
      tiles,
    };

    this.nodes.push(node);
    this._occupyTiles(tiles, node.id);
    return node.id;
  }

  // Get all positions where new components can be placed
  getBuildCursors() {
    const cursors = [];
    const childIds = new Set(this.nodes.map(n => n.parentId).filter(Boolean));

    for (const node of this.nodes) {
      const template = COMPONENTS[node.type];
      if (template.isEndpoint) continue; // endpoints can't extend

      // Check if this node already has children
      const children = this.nodes.filter(n => n.parentId === node.id);

      if (template.isSplitter) {
        // Splitter can have two children: one straight, one branched (left turn)
        const straightDir = node.dir;
        const branchDir = turnLeft(node.dir);

        const hasStraight = children.some(c => c.entryDir === straightDir);
        const hasBranch = children.some(c => c.entryDir === branchDir);

        const endTile = node.tiles[node.tiles.length - 1];

        if (!hasStraight) {
          const delta = DIR_DELTA[straightDir];
          cursors.push({
            col: endTile.col + delta.dc,
            row: endTile.row + delta.dr,
            dir: straightDir,
            parentId: node.id,
          });
        }
        if (!hasBranch) {
          const delta = DIR_DELTA[branchDir];
          cursors.push({
            col: endTile.col + delta.dc,
            row: endTile.row + delta.dr,
            dir: branchDir,
            parentId: node.id,
          });
        }
      } else {
        // Normal component: one child in exit direction
        if (children.length === 0) {
          const endTile = node.tiles[node.tiles.length - 1];
          const delta = DIR_DELTA[node.dir];
          cursors.push({
            col: endTile.col + delta.dc,
            row: endTile.row + delta.dr,
            dir: node.dir,
            parentId: node.id,
          });
        }
      }
    }

    return cursors;
  }

  // Remove a node (only if it's a leaf — no children)
  removeNode(nodeId) {
    const node = this.nodes.find(n => n.id === nodeId);
    if (!node) return false;

    // Check if any other node has this as parent
    const hasChildren = this.nodes.some(n => n.parentId === nodeId);
    if (hasChildren) return false;

    this._freeTiles(node.tiles);
    this.nodes = this.nodes.filter(n => n.id !== nodeId);
    return true;
  }

  // Get ordered list of components for physics engine
  // Walks from each source down the graph
  getOrderedComponents() {
    const sources = this.nodes.filter(n => COMPONENTS[n.type]?.isSource);
    const visited = new Set();
    const ordered = [];

    const walk = (node) => {
      if (visited.has(node.id)) return;
      visited.add(node.id);
      ordered.push(node);
      // Find children
      const children = this.nodes.filter(n => n.parentId === node.id);
      for (const child of children) walk(child);
    };

    for (const src of sources) walk(src);
    return ordered;
  }

  // Get all nodes as a flat list (for rendering)
  getAllNodes() {
    return this.nodes;
  }

  // Serialize for save/load
  toJSON() {
    return { nodes: this.nodes, nextId: this.nextId };
  }

  fromJSON(data) {
    this.nodes = data.nodes || [];
    this.nextId = data.nextId || 1;
    // Rebuild occupied map
    this.occupied = {};
    for (const node of this.nodes) {
      this._occupyTiles(node.tiles, node.id);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node test/test-beamline.js`
Expected: All 10 tests pass

- [ ] **Step 5: Commit**

```bash
git add beamline.js test/test-beamline.js
git commit -m "feat: add beamline directed graph model with tests"
```

---

### Task 4: Refactor Game Engine

**Files:**
- Modify: `game.js`

Remove all grid-based logic. Game now delegates placement to a `Beamline` instance and receives ordered component lists for physics.

- [ ] **Step 1: Rewrite game.js**

```js
// === BEAMLINE TYCOON: GAME ENGINE ===

class Game {
  constructor(beamline) {
    this.beamline = beamline;

    this.state = {
      resources: { funding: 500, energy: 100, reputation: 0, data: 0 },
      beamOn: false,
      beamEnergy: 0,
      luminosity: 0,
      completedResearch: [],
      activeResearch: null,
      researchProgress: 0,
      totalDataCollected: 0,
      completedObjectives: [],
      discoveries: 0,
      tick: 0,
      log: [],
      totalLength: 0,
      totalEnergyCost: 0,
      dataRate: 0,
      beamQuality: 1,
      beamCurrent: 0,
      totalLossFraction: 0,
      discoveryChance: 0,
      photonRate: 0,
      collisionRate: 0,
      physicsEnvelope: null,
      physicsAlive: true,
    };

    this.listeners = [];
    this.tickInterval = null;
    this.TICK_MS = 1000;
  }

  on(fn) { this.listeners.push(fn); }
  emit(event, data) { this.listeners.forEach(fn => fn(event, data)); }

  log(msg, type = '') {
    this.state.log.unshift({ msg, type, tick: this.state.tick });
    if (this.state.log.length > 100) this.state.log.length = 100;
    this.emit('log', { msg, type });
  }

  // === PLACEMENT (delegates to Beamline) ===

  canAfford(costs) {
    for (const [r, a] of Object.entries(costs))
      if ((this.state.resources[r] || 0) < a) return false;
    return true;
  }

  spend(costs) {
    for (const [r, a] of Object.entries(costs)) this.state.resources[r] -= a;
  }

  isComponentUnlocked(comp) {
    if (comp.unlocked) return true;
    return comp.requires && this.state.completedResearch.includes(comp.requires);
  }

  placeSource(col, row, dir) {
    const template = COMPONENTS.source;
    if (!this.isComponentUnlocked(template)) return false;
    if (!this.canAfford(template.cost)) { this.log("Can't afford Source!", 'bad'); return false; }
    if (template.maxCount) {
      const count = this.beamline.nodes.filter(n => n.type === 'source').length;
      if (count >= template.maxCount) { this.log('Max sources reached.', 'bad'); return false; }
    }

    const id = this.beamline.placeSource(col, row, dir);
    if (!id) { this.log("Can't place there!", 'bad'); return false; }

    this.spend(template.cost);
    this.recalcBeamline();
    this.log('Built Source', 'good');
    this.emit('beamlineChanged');
    return true;
  }

  placeComponent(cursor, compType, bendDir) {
    const template = COMPONENTS[compType];
    if (!template) return false;
    if (!this.isComponentUnlocked(template)) return false;
    if (!this.canAfford(template.cost)) { this.log(`Can't afford ${template.name}!`, 'bad'); return false; }
    if (template.maxCount) {
      const count = this.beamline.nodes.filter(n => n.type === compType).length;
      if (count >= template.maxCount) { this.log(`Max ${template.name} reached.`, 'bad'); return false; }
    }

    const id = this.beamline.placeAt(cursor, compType, bendDir);
    if (!id) { this.log("Can't place there!", 'bad'); return false; }

    this.spend(template.cost);
    this.recalcBeamline();
    this.log(`Built ${template.name}`, 'good');
    this.emit('beamlineChanged');
    return true;
  }

  removeComponent(nodeId) {
    const node = this.beamline.nodes.find(n => n.id === nodeId);
    if (!node) return false;
    const template = COMPONENTS[node.type];

    if (!this.beamline.removeNode(nodeId)) {
      this.log('Can only remove end pieces!', 'bad');
      return false;
    }

    // 50% refund
    for (const [r, a] of Object.entries(template.cost))
      this.state.resources[r] += Math.floor(a * 0.5);

    this.recalcBeamline();
    this.log(`Demolished ${template.name} (50% refund)`, 'info');
    this.emit('beamlineChanged');
    return true;
  }

  // === STATS ===

  recalcBeamline() {
    const ordered = this.beamline.getOrderedComponents();

    let tLen = 0, tCost = 0, hasSrc = false;
    const ecm = this.getEffect('energyCostMult', 1);
    for (const node of ordered) {
      const t = COMPONENTS[node.type];
      if (!t) continue;
      tLen += t.length;
      tCost += t.energyCost * ecm;
      if (t.isSource) hasSrc = true;
    }
    this.state.totalLength = tLen;
    this.state.totalEnergyCost = Math.ceil(tCost);

    // Update beamline reference in state (for objectives/save)
    this.state.beamline = ordered;

    if (!hasSrc) {
      this.state.beamEnergy = 0;
      this.state.dataRate = 0;
      this.state.beamQuality = 1;
      this.state.luminosity = 0;
      this.state.physicsEnvelope = null;
      return;
    }

    const physicsBeamline = ordered.map(node => {
      const t = COMPONENTS[node.type];
      return { type: node.type, length: t.length, stats: t.stats || {} };
    });

    const researchEffects = {};
    for (const key of ['luminosityMult', 'dataRateMult', 'energyCostMult', 'discoveryChance']) {
      researchEffects[key] = this.getEffect(key, key.endsWith('Mult') ? 1 : 0);
    }

    this.runPhysics(physicsBeamline, researchEffects);
  }

  runPhysics(physicsBeamline, researchEffects) {
    if (!BeamPhysics.isReady()) {
      this._fallbackStats(physicsBeamline);
      return;
    }

    const result = BeamPhysics.compute(physicsBeamline, researchEffects);
    if (!result) {
      this._fallbackStats(physicsBeamline);
      return;
    }

    this.state.beamEnergy = result.beamEnergy;
    this.state.dataRate = result.dataRate;
    this.state.beamQuality = result.beamQuality;
    this.state.luminosity = result.luminosity || 0;
    this.state.physicsAlive = result.beamAlive;
    this.state.beamCurrent = result.beamCurrent;
    this.state.totalLossFraction = result.totalLossFraction;
    this.state.discoveryChance = result.discoveryChance || 0;
    this.state.photonRate = result.photonRate || 0;
    this.state.collisionRate = result.collisionRate || 0;
    this.state.physicsEnvelope = result.envelope || null;

    if (this.state.beamOn && !result.beamAlive) {
      this.state.beamOn = false;
      this.log('Beam TRIPPED — too much loss! Fix your optics.', 'bad');
      this.emit('beamToggled');
    }
  }

  _fallbackStats(physicsBeamline) {
    let eGain = 0, dRate = 0, bq = 1;
    for (const el of physicsBeamline) {
      const s = el.stats || {};
      if (s.energyGain) eGain += s.energyGain;
      if (s.dataRate) dRate += s.dataRate;
      if (s.beamQuality) bq += s.beamQuality;
    }
    this.state.beamEnergy = eGain;
    this.state.dataRate = dRate * bq;
    this.state.beamQuality = bq;
    this.state.luminosity = 0;
    this.state.physicsEnvelope = null;
  }

  // === BEAM CONTROL ===

  toggleBeam() {
    if (this.state.beamOn) {
      this.state.beamOn = false;
      this.log('Beam OFF', 'info');
    } else {
      if (!this.beamline.nodes.some(n => COMPONENTS[n.type]?.isSource)) {
        this.log('Need a Source!', 'bad');
        return;
      }
      if (this.state.resources.energy < this.state.totalEnergyCost) {
        this.log('Not enough energy!', 'bad');
        return;
      }
      this.state.beamOn = true;
      this.log('Beam ON!', 'good');
    }
    this.emit('beamToggled');
  }

  // === RESEARCH ===

  isResearchAvailable(id) {
    const r = RESEARCH[id];
    if (!r || this.state.completedResearch.includes(id) || this.state.activeResearch === id) return false;
    return !r.requires || this.state.completedResearch.includes(r.requires);
  }

  startResearch(id) {
    if (!this.isResearchAvailable(id)) return false;
    const r = RESEARCH[id];
    if (!this.canAfford({ data: r.cost.data })) { this.log(`Need ${r.cost.data} data`, 'bad'); return false; }
    this.spend({ data: r.cost.data });
    this.state.activeResearch = id;
    this.state.researchProgress = 0;
    this.log(`Researching: ${r.name}`, 'info');
    this.emit('researchChanged');
    return true;
  }

  getEffect(key, def) {
    let v = def;
    for (const id of this.state.completedResearch) {
      const r = RESEARCH[id];
      if (r?.effect?.[key] !== undefined)
        v = key.endsWith('Mult') ? v * r.effect[key] : v + r.effect[key];
    }
    return v;
  }

  // === GAME LOOP ===

  start() {
    if (this.tickInterval) return;
    this.tickInterval = setInterval(() => this.tick(), this.TICK_MS);
    this.log('Welcome to Beamline Tycoon! Place a Source to begin.', 'info');
    this.emit('started');
  }

  tick() {
    this.state.tick++;
    this.state.resources.funding += this.getEffect('passiveFunding', 0) + Math.floor(this.state.resources.reputation * 0.5);
    this.state.resources.energy = Math.min(this.state.resources.energy + 3, 200 + this.state.resources.reputation * 20);

    if (this.state.beamOn) {
      if (this.state.resources.energy >= this.state.totalEnergyCost) {
        this.state.resources.energy -= this.state.totalEnergyCost;
        if (this.state.dataRate > 0) {
          this.state.resources.data += this.state.dataRate;
          this.state.totalDataCollected += this.state.dataRate;
        }
        if (this.state.photonRate > 0) {
          const photonData = this.state.photonRate * 0.1 * this.state.beamQuality;
          this.state.resources.data += photonData;
          this.state.totalDataCollected += photonData;
        }
        const dc = this.state.discoveryChance || 0;
        if (dc > 0 && Math.random() < dc) {
          this.state.discoveries++;
          this.log('*** PARTICLE DISCOVERY! ***', 'reward');
          this.state.resources.reputation += 10;
          this.state.resources.funding += 5000;
        }
        if (this.state.beamQuality > 0.8 && this.state.tick % 60 === 0) {
          this.state.resources.reputation += 0.5;
        }
      } else {
        this.state.beamOn = false;
        this.log('Beam shut down: no energy!', 'bad');
        this.emit('beamToggled');
      }
    }

    if (this.state.activeResearch) {
      const r = RESEARCH[this.state.activeResearch];
      this.state.researchProgress++;
      if (this.state.researchProgress >= r.duration) {
        this.state.completedResearch.push(this.state.activeResearch);
        this.log(`Research done: ${r.name}!`, 'reward');
        if (r.unlocks) for (const c of r.unlocks) this.log(`Unlocked: ${COMPONENTS[c].name}`, 'good');
        this.state.activeResearch = null;
        this.state.researchProgress = 0;
        this.recalcBeamline();
        this.emit('researchChanged');
      }
    }

    for (const obj of OBJECTIVES) {
      if (this.state.completedObjectives.includes(obj.id)) continue;
      if (obj.condition(this.state)) {
        this.state.completedObjectives.push(obj.id);
        for (const [r, a] of Object.entries(obj.reward))
          this.state.resources[r] = (this.state.resources[r] || 0) + a;
        this.log(`Goal complete: ${obj.name}!`, 'reward');
        this.emit('objectiveCompleted', obj);
      }
    }
    this.emit('tick');
  }

  save() {
    const saveData = {
      state: this.state,
      beamline: this.beamline.toJSON(),
    };
    localStorage.setItem('beamlineTycoon', JSON.stringify(saveData));
  }

  load() {
    const raw = localStorage.getItem('beamlineTycoon');
    if (!raw) return false;
    try {
      const data = JSON.parse(raw);
      Object.assign(this.state, data.state);
      if (data.beamline) this.beamline.fromJSON(data.beamline);
      this.recalcBeamline();
      this.log('Game loaded.', 'info');
      this.emit('loaded');
      return true;
    } catch { return false; }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add game.js
git commit -m "refactor: game engine uses beamline graph instead of grid"
```

---

### Task 5: Create Isometric Coordinate Utilities and Sprite Manager

**Files:**
- Create: `sprites.js`
- Create: `test/test-iso.js`

- [ ] **Step 1: Write tests for isometric coordinate conversion**

```js
// test/test-iso.js
// Run: node test/test-iso.js

const TILE_W = 64;
const TILE_H = 32;

// Cartesian grid (col, row) to isometric screen (x, y)
function gridToIso(col, row) {
  return {
    x: (col - row) * (TILE_W / 2),
    y: (col + row) * (TILE_H / 2),
  };
}

// Isometric screen (x, y) to cartesian grid (col, row)
function isoToGrid(x, y) {
  return {
    col: Math.floor((x / (TILE_W / 2) + y / (TILE_H / 2)) / 2),
    row: Math.floor((y / (TILE_H / 2) - x / (TILE_W / 2)) / 2),
  };
}

let passed = 0, failed = 0;
function assert(cond, msg) { if (cond) passed++; else { failed++; console.error(`FAIL: ${msg}`); } }

// (0,0) -> screen origin
{
  const { x, y } = gridToIso(0, 0);
  assert(x === 0 && y === 0, 'origin maps to (0,0)');
}

// (1,0) -> right-up in iso
{
  const { x, y } = gridToIso(1, 0);
  assert(x === 32 && y === 16, '(1,0) -> (32,16)');
}

// (0,1) -> left-down in iso
{
  const { x, y } = gridToIso(0, 1);
  assert(x === -32 && y === 16, '(0,1) -> (-32,16)');
}

// Round-trip: gridToIso -> isoToGrid
{
  for (const [c, r] of [[3, 5], [0, 0], [10, 2], [7, 7]]) {
    const iso = gridToIso(c, r);
    const grid = isoToGrid(iso.x, iso.y);
    assert(grid.col === c && grid.row === r, `round-trip (${c},${r})`);
  }
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

- [ ] **Step 2: Run tests**

Run: `node test/test-iso.js`
Expected: All pass (these are standalone functions)

- [ ] **Step 3: Create sprites.js with coordinate utilities and placeholder sprite generation**

```js
// === BEAMLINE TYCOON: SPRITE MANAGER ===

// Isometric coordinate conversion
function gridToIso(col, row) {
  return {
    x: (col - row) * (TILE_W / 2),
    y: (col + row) * (TILE_H / 2),
  };
}

function isoToGrid(screenX, screenY) {
  return {
    col: Math.floor((screenX / (TILE_W / 2) + screenY / (TILE_H / 2)) / 2),
    row: Math.floor((screenY / (TILE_H / 2) - screenX / (TILE_W / 2)) / 2),
  };
}

// Generates placeholder isometric sprites as PixiJS Graphics objects
class SpriteManager {
  constructor() {
    this.textures = {};  // spriteKey -> { far, mid, close }
  }

  // Create a placeholder isometric diamond/box texture for a component
  _createPlaceholderTexture(app, color, w, h) {
    const g = new PIXI.Graphics();
    const hw = w / 2;
    const hh = h / 2;
    const depth = h * 0.6;

    // Top face (brighter)
    g.poly([0, 0, hw, -hh, w, 0, hw, hh]);
    g.fill({ color, alpha: 1 });

    // Left face (darker)
    g.poly([0, 0, hw, hh, hw, hh + depth, 0, depth]);
    g.fill({ color: this._darken(color, 0.7), alpha: 1 });

    // Right face (medium)
    g.poly([w, 0, hw, hh, hw, hh + depth, w, depth]);
    g.fill({ color: this._darken(color, 0.85), alpha: 1 });

    // Top edge highlight
    g.poly([0, 0, hw, -hh, w, 0, hw, hh]);
    g.stroke({ color: this._lighten(color, 1.3), width: 1, alpha: 0.5 });

    return app.renderer.generateTexture(g);
  }

  _darken(color, factor) {
    const r = Math.floor(((color >> 16) & 0xFF) * factor);
    const g = Math.floor(((color >> 8) & 0xFF) * factor);
    const b = Math.floor((color & 0xFF) * factor);
    return (r << 16) | (g << 8) | b;
  }

  _lighten(color, factor) {
    const r = Math.min(255, Math.floor(((color >> 16) & 0xFF) * factor));
    const g = Math.min(255, Math.floor(((color >> 8) & 0xFF) * factor));
    const b = Math.min(255, Math.floor((color & 0xFF) * factor));
    return (r << 16) | (g << 8) | b;
  }

  // Generate placeholder textures for all components
  generatePlaceholders(app) {
    for (const comp of Object.values(COMPONENTS)) {
      const baseW = TILE_W * Math.min(comp.trackLength, 2);
      const baseH = TILE_H * Math.min(comp.trackLength, 2);

      // Far: small simple diamond
      const far = this._createPlaceholderTexture(app, comp.spriteColor, TILE_W * 0.6, TILE_H * 0.6);
      // Mid: normal sized box
      const mid = this._createPlaceholderTexture(app, comp.spriteColor, baseW, baseH);
      // Close: larger detailed (same for now, will be replaced by PixelLab assets)
      const close = this._createPlaceholderTexture(app, comp.spriteColor, baseW * 1.5, baseH * 1.5);

      this.textures[comp.spriteKey] = { far, mid, close };
    }
  }

  // Get the appropriate texture for a component at a given zoom level
  getTexture(spriteKey, zoom) {
    const entry = this.textures[spriteKey];
    if (!entry) return null;
    if (zoom < 0.5) return entry.far;
    if (zoom < 1.5) return entry.mid;
    return entry.close;
  }

  // Create a sprite for a beamline node
  createNodeSprite(node, zoom) {
    const comp = COMPONENTS[node.type];
    if (!comp) return null;
    const texture = this.getTexture(comp.spriteKey, zoom);
    if (!texture) return null;

    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5, 0.7); // anchor near bottom-center for iso
    const pos = gridToIso(node.col, node.row);
    sprite.x = pos.x;
    sprite.y = pos.y;
    return sprite;
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add sprites.js test/test-iso.js
git commit -m "feat: add sprite manager with iso coordinate utils and placeholders"
```

---

### Task 6: Create Input Handler

**Files:**
- Create: `input.js`

- [ ] **Step 1: Implement input.js**

```js
// === BEAMLINE TYCOON: INPUT HANDLER ===

class InputHandler {
  constructor(renderer, game) {
    this.renderer = renderer;
    this.game = game;

    // Build mode state
    this.selectedTool = null;     // component type or null
    this.selectedCategory = 'source';
    this.dipoleBendDir = 'right'; // default bend direction for dipoles
    this.selectedNodeId = null;   // for inspecting placed components

    // Pan state
    this.isPanning = false;
    this.panStart = { x: 0, y: 0 };
    this.worldStart = { x: 0, y: 0 };

    this._bindKeyboard();
    this._bindMouse();
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      // Don't handle if an input/textarea is focused
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      switch (e.key) {
        case 'w': case 'W': case 'ArrowUp':
          this.renderer.panBy(0, -40);
          e.preventDefault();
          break;
        case 's': case 'ArrowDown':
          this.renderer.panBy(0, 40);
          e.preventDefault();
          break;
        case 'a': case 'A': case 'ArrowLeft':
          this.renderer.panBy(-40, 0);
          e.preventDefault();
          break;
        case 'd': case 'D': case 'ArrowRight':
          this.renderer.panBy(40, 0);
          e.preventDefault();
          break;
        case ' ':
          this.game.toggleBeam();
          e.preventDefault();
          break;
        case 'r': case 'R':
          this._toggleOverlay('overlay-research');
          e.preventDefault();
          break;
        case 'g': case 'G':
          this._toggleOverlay('overlay-goals');
          e.preventDefault();
          break;
        case 'Escape':
          this._closeAllOverlays();
          this.deselectTool();
          this.selectedNodeId = null;
          this.renderer.hidePopup();
          break;
        case 'Tab':
          this._cycleCategory();
          e.preventDefault();
          break;
        case 'f': case 'F':
          // Flip dipole bend direction
          this.dipoleBendDir = this.dipoleBendDir === 'right' ? 'left' : 'right';
          this.renderer.updateCursorBendDir(this.dipoleBendDir);
          break;
        case 'Delete': case 'Backspace':
          if (this.selectedNodeId) {
            this.game.removeComponent(this.selectedNodeId);
            this.selectedNodeId = null;
            this.renderer.hidePopup();
          }
          break;
      }
    });
  }

  _bindMouse() {
    const canvas = this.renderer.app.canvas;

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomDelta = e.deltaY > 0 ? -0.1 : 0.1;
      this.renderer.zoomAt(e.clientX, e.clientY, zoomDelta);
    }, { passive: false });

    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        // Middle click or Alt+click = pan
        this.isPanning = true;
        this.panStart = { x: e.clientX, y: e.clientY };
        this.worldStart = { x: this.renderer.world.x, y: this.renderer.world.y };
        canvas.style.cursor = 'grabbing';
      }
    });

    canvas.addEventListener('mousemove', (e) => {
      if (this.isPanning) {
        const dx = e.clientX - this.panStart.x;
        const dy = e.clientY - this.panStart.y;
        this.renderer.world.x = this.worldStart.x + dx;
        this.renderer.world.y = this.worldStart.y + dy;
        return;
      }

      // Update hover position for build cursor
      const worldPos = this.renderer.screenToWorld(e.clientX, e.clientY);
      const gridPos = isoToGrid(worldPos.x, worldPos.y);
      this.renderer.updateHover(gridPos.col, gridPos.row);
    });

    canvas.addEventListener('mouseup', (e) => {
      if (this.isPanning) {
        this.isPanning = false;
        canvas.style.cursor = 'default';
        return;
      }

      if (e.button === 0) {
        this._handleClick(e.clientX, e.clientY);
      } else if (e.button === 2) {
        // Right click — deselect or remove
        if (this.selectedNodeId) {
          this.game.removeComponent(this.selectedNodeId);
          this.selectedNodeId = null;
          this.renderer.hidePopup();
        } else {
          this.deselectTool();
        }
      }
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _handleClick(screenX, screenY) {
    const worldPos = this.renderer.screenToWorld(screenX, screenY);
    const gridPos = isoToGrid(worldPos.x, worldPos.y);

    // Check if clicking on a build cursor
    const cursors = this.game.beamline.getBuildCursors();

    if (this.selectedTool) {
      // Try to place at a build cursor
      const matchingCursor = cursors.find(c => c.col === gridPos.col && c.row === gridPos.row);
      if (matchingCursor) {
        const bendDir = COMPONENTS[this.selectedTool]?.isDipole ? this.dipoleBendDir : undefined;
        this.game.placeComponent(matchingCursor, this.selectedTool, bendDir);
        return;
      }

      // If no source exists and tool is source, place freely
      if (this.selectedTool === 'source' && !this.game.beamline.nodes.some(n => n.type === 'source')) {
        this.game.placeSource(gridPos.col, gridPos.row, DIR.NE);
        return;
      }
    }

    // Check if clicking on an existing component
    const node = this.game.beamline.getNodeAt(gridPos.col, gridPos.row);
    if (node) {
      this.selectedNodeId = node.id;
      this.renderer.showPopup(node, screenX, screenY);
    } else {
      this.selectedNodeId = null;
      this.renderer.hidePopup();
    }
  }

  selectTool(compType) {
    this.selectedTool = compType;
    this.selectedNodeId = null;
    this.renderer.hidePopup();
    this.renderer.setBuildMode(compType !== null);
  }

  deselectTool() {
    this.selectedTool = null;
    this.renderer.setBuildMode(false);
  }

  _toggleOverlay(id) {
    const el = document.getElementById(id);
    el.classList.toggle('hidden');
  }

  _closeAllOverlays() {
    document.querySelectorAll('.overlay').forEach(el => el.classList.add('hidden'));
  }

  _cycleCategory() {
    const cats = Object.keys(CATEGORIES);
    const idx = cats.indexOf(this.selectedCategory);
    this.selectedCategory = cats[(idx + 1) % cats.length];
    this.renderer.updatePalette(this.selectedCategory);

    // Update tab styling
    document.querySelectorAll('.cat-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.category === this.selectedCategory);
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add input.js
git commit -m "feat: add input handler with keyboard, mouse, and iso picking"
```

---

### Task 7: Create PixiJS Renderer

**Files:**
- Create: `renderer.js`

This is the largest task. The renderer creates the PixiJS application, draws the isometric grid, renders component sprites, beam visualization, construction cursors, minimap, and updates DOM HUD elements.

- [ ] **Step 1: Implement renderer.js**

```js
// === BEAMLINE TYCOON: PIXI.JS ISOMETRIC RENDERER ===

class Renderer {
  constructor(game, spriteManager) {
    this.game = game;
    this.sprites = spriteManager;
    this.app = null;
    this.world = null;         // main world container (zoom/pan target)
    this.gridLayer = null;     // isometric grid lines
    this.componentLayer = null;// placed components
    this.beamLayer = null;     // beam visualization
    this.cursorLayer = null;   // build cursors
    this.minimapLayer = null;  // minimap container

    this.zoom = 1;
    this.buildMode = false;
    this.hoverCol = 0;
    this.hoverRow = 0;
    this.dipoleBendDir = 'right';

    // Track component sprites for updates
    this.nodeSprites = {};  // nodeId -> PIXI.Sprite

    // Beam animation state
    this.beamTime = 0;
  }

  async init() {
    this.app = new PIXI.Application();
    await this.app.init({
      resizeTo: window,
      backgroundColor: 0x2d5a1e,
      antialias: false,
      resolution: 1,
    });

    document.getElementById('game').prepend(this.app.canvas);

    // World container for zoom/pan
    this.world = new PIXI.Container();
    this.world.sortableChildren = true;
    this.app.stage.addChild(this.world);

    // Center world on screen
    this.world.x = this.app.screen.width / 2;
    this.world.y = this.app.screen.height / 3;

    // Layers (render order)
    this.gridLayer = new PIXI.Container();
    this.gridLayer.zIndex = 0;
    this.world.addChild(this.gridLayer);

    this.beamLayer = new PIXI.Container();
    this.beamLayer.zIndex = 1;
    this.world.addChild(this.beamLayer);

    this.componentLayer = new PIXI.Container();
    this.componentLayer.zIndex = 2;
    this.componentLayer.sortableChildren = true;
    this.world.addChild(this.componentLayer);

    this.cursorLayer = new PIXI.Container();
    this.cursorLayer.zIndex = 3;
    this.world.addChild(this.cursorLayer);

    // Generate placeholder textures
    this.sprites.generatePlaceholders(this.app);

    // Draw initial grid
    this._drawGrid();

    // Start render loop
    this.app.ticker.add((ticker) => this._onFrame(ticker));

    // Listen to game events
    this.game.on((event) => {
      if (event === 'beamlineChanged' || event === 'loaded') {
        this._renderComponents();
        this._renderBeam();
        this._renderCursors();
        this._renderMinimap();
      }
      if (event === 'beamToggled') {
        this._renderBeam();
        this._updateBeamStatusUI();
      }
      if (event === 'tick') {
        this._updateHUD();
      }
      if (event === 'researchChanged') {
        this._renderResearchOverlay();
      }
      if (event === 'objectiveCompleted') {
        this._renderGoalsOverlay();
      }
    });

    // Bind DOM events for HUD
    this._bindHUDEvents();

    // Initial renders
    this._updateHUD();
    this._renderComponents();
    this._renderCursors();
    this._renderResearchOverlay();
    this._renderGoalsOverlay();
    this._renderPalette('source');
  }

  // === COORDINATE CONVERSION ===

  screenToWorld(screenX, screenY) {
    return {
      x: (screenX - this.world.x) / this.zoom,
      y: (screenY - this.world.y) / this.zoom,
    };
  }

  // === ZOOM / PAN ===

  zoomAt(screenX, screenY, delta) {
    const oldZoom = this.zoom;
    this.zoom = Math.max(0.2, Math.min(3, this.zoom + delta));

    // Zoom toward mouse position
    const worldX = (screenX - this.world.x) / oldZoom;
    const worldY = (screenY - this.world.y) / oldZoom;
    this.world.x = screenX - worldX * this.zoom;
    this.world.y = screenY - worldY * this.zoom;
    this.world.scale.set(this.zoom);

    // Update LOD - re-render components at new zoom level
    this._renderComponents();
  }

  panBy(dx, dy) {
    this.world.x -= dx;
    this.world.y -= dy;
  }

  // === GRID ===

  _drawGrid() {
    this.gridLayer.removeChildren();
    const g = new PIXI.Graphics();

    const gridSize = 30; // draw a 30x30 grid
    const halfW = TILE_W / 2;
    const halfH = TILE_H / 2;

    g.setStrokeStyle({ width: 0.5, color: 0x000000, alpha: 0.15 });

    for (let i = -gridSize; i <= gridSize; i++) {
      // Lines going NE-SW (constant col)
      const start = gridToIso(i, -gridSize);
      const end = gridToIso(i, gridSize);
      g.moveTo(start.x, start.y);
      g.lineTo(end.x, end.y);
      g.stroke();

      // Lines going NW-SE (constant row)
      const start2 = gridToIso(-gridSize, i);
      const end2 = gridToIso(gridSize, i);
      g.moveTo(start2.x, start2.y);
      g.lineTo(end2.x, end2.y);
      g.stroke();
    }

    this.gridLayer.addChild(g);
  }

  // === COMPONENT RENDERING ===

  _renderComponents() {
    this.componentLayer.removeChildren();
    this.nodeSprites = {};

    for (const node of this.game.beamline.getAllNodes()) {
      const comp = COMPONENTS[node.type];
      if (!comp) continue;

      const texture = this.sprites.getTexture(comp.spriteKey, this.zoom);
      if (!texture) continue;

      const sprite = new PIXI.Sprite(texture);
      sprite.anchor.set(0.5, 0.7);

      // Position at center of component's tile span
      const midIdx = Math.floor(node.tiles.length / 2);
      const midTile = node.tiles[midIdx];
      const pos = gridToIso(midTile.col, midTile.row);
      sprite.x = pos.x;
      sprite.y = pos.y;

      // Depth sort: objects further down-right render later
      sprite.zIndex = midTile.col + midTile.row;

      // Label (only at mid/close zoom)
      if (this.zoom >= 0.7) {
        const label = new PIXI.Text({
          text: comp.name,
          style: {
            fontFamily: 'Press Start 2P, monospace',
            fontSize: 7,
            fill: 0xffffff,
            align: 'center',
          },
        });
        label.anchor.set(0.5, 0);
        label.y = sprite.height * 0.3;
        sprite.addChild(label);
      }

      this.componentLayer.addChild(sprite);
      this.nodeSprites[node.id] = sprite;
    }
  }

  // === BEAM VISUALIZATION ===

  _renderBeam() {
    this.beamLayer.removeChildren();
    if (!this.game.state.beamOn) return;

    const ordered = this.game.beamline.getOrderedComponents();
    if (ordered.length < 2) return;

    const g = new PIXI.Graphics();

    // Draw beam path as glowing line between component centers
    g.setStrokeStyle({ width: 3, color: 0x00ff00, alpha: 0.6 });

    for (let i = 0; i < ordered.length - 1; i++) {
      const from = this._nodeCenter(ordered[i]);
      const to = this._nodeCenter(ordered[i + 1]);
      g.moveTo(from.x, from.y);
      g.lineTo(to.x, to.y);
      g.stroke();
    }

    // Bright core
    g.setStrokeStyle({ width: 1.5, color: 0xaaffaa, alpha: 0.9 });
    for (let i = 0; i < ordered.length - 1; i++) {
      const from = this._nodeCenter(ordered[i]);
      const to = this._nodeCenter(ordered[i + 1]);
      g.moveTo(from.x, from.y);
      g.lineTo(to.x, to.y);
      g.stroke();
    }

    this.beamLayer.addChild(g);
  }

  _nodeCenter(node) {
    const midIdx = Math.floor(node.tiles.length / 2);
    const midTile = node.tiles[midIdx];
    return gridToIso(midTile.col, midTile.row);
  }

  // Animate beam particles each frame
  _animateBeam(dt) {
    if (!this.game.state.beamOn) return;
    this.beamTime += dt;
    // Particle animation could be added here with a particle emitter
    // For now the static beam glow is sufficient for Phase 1 MVP
  }

  // === BUILD CURSORS ===

  _renderCursors() {
    this.cursorLayer.removeChildren();
    if (!this.buildMode) return;

    const cursors = this.game.beamline.getBuildCursors();

    // If no beamline exists yet and tool is source, show a hover cursor
    if (this.game.beamline.nodes.length === 0) {
      this._drawHoverCursor();
      return;
    }

    for (const cursor of cursors) {
      const pos = gridToIso(cursor.col, cursor.row);
      const g = new PIXI.Graphics();

      // Dashed diamond outline
      const hw = TILE_W / 2;
      const hh = TILE_H / 2;

      g.setStrokeStyle({ width: 2, color: 0x4488ff, alpha: 0.7 });
      g.poly([0, -hh, hw, 0, 0, hh, -hw, 0]);
      g.stroke();

      // Plus sign
      g.setStrokeStyle({ width: 2, color: 0x4488ff, alpha: 0.5 });
      g.moveTo(-6, 0); g.lineTo(6, 0); g.stroke();
      g.moveTo(0, -6); g.lineTo(0, 6); g.stroke();

      // Direction arrow
      const delta = DIR_DELTA[cursor.dir];
      const arrowX = delta.dc * 20;
      const arrowY = delta.dr * 10;
      g.setStrokeStyle({ width: 2, color: 0x4488ff, alpha: 0.4 });
      g.moveTo(0, 0); g.lineTo(arrowX, arrowY); g.stroke();

      g.x = pos.x;
      g.y = pos.y;
      this.cursorLayer.addChild(g);
    }
  }

  _drawHoverCursor() {
    const pos = gridToIso(this.hoverCol, this.hoverRow);
    const g = new PIXI.Graphics();

    const hw = TILE_W / 2;
    const hh = TILE_H / 2;

    g.setStrokeStyle({ width: 2, color: 0x44ff88, alpha: 0.6 });
    g.poly([0, -hh, hw, 0, 0, hh, -hw, 0]);
    g.stroke();

    g.x = pos.x;
    g.y = pos.y;
    this.cursorLayer.addChild(g);
  }

  // === MINIMAP ===

  _renderMinimap() {
    // Minimap is rendered as a small PixiJS container in a fixed screen position
    // For now, we skip the minimap — it will be layered on top via a second PIXI container
    // attached to app.stage (not world, so it doesn't zoom/pan)
    // TODO in a later task: full minimap with viewport indicator
  }

  // === HOVER / BUILD MODE ===

  updateHover(col, row) {
    this.hoverCol = col;
    this.hoverRow = row;
    if (this.buildMode && this.game.beamline.nodes.length === 0) {
      this._renderCursors();
    }
  }

  setBuildMode(active) {
    this.buildMode = active;
    this._renderCursors();
  }

  updateCursorBendDir(dir) {
    this.dipoleBendDir = dir;
  }

  // === POPUP ===

  showPopup(node, screenX, screenY) {
    const popup = document.getElementById('component-popup');
    const comp = COMPONENTS[node.type];
    if (!comp) return;

    const stats = Object.entries(comp.stats)
      .map(([k, v]) => `<div class="popup-row"><span class="popup-label">${k}</span><span class="popup-value">${v}</span></div>`)
      .join('');

    popup.innerHTML = `
      <div class="popup-title">${comp.name}</div>
      <div class="popup-row"><span class="popup-label">Energy cost</span><span class="popup-value">${comp.energyCost}/s</span></div>
      <div class="popup-row"><span class="popup-label">Direction</span><span class="popup-value">${DIR_NAMES[node.dir]}</span></div>
      ${stats}
      <div class="popup-desc">${comp.desc}</div>
      <div class="popup-actions">
        <button class="popup-btn danger" id="btn-remove-component">🗑 Remove</button>
      </div>
    `;

    // Position near click but keep on screen
    popup.style.left = Math.min(screenX + 10, window.innerWidth - 240) + 'px';
    popup.style.top = Math.max(screenY - 100, 10) + 'px';
    popup.classList.remove('hidden');

    document.getElementById('btn-remove-component').onclick = () => {
      this.game.removeComponent(node.id);
      this.hidePopup();
    };
  }

  hidePopup() {
    document.getElementById('component-popup').classList.add('hidden');
  }

  // === HUD UPDATES ===

  _updateHUD() {
    const r = this.game.state.resources;
    const s = this.game.state;

    document.getElementById('res-funding').textContent = `💰 $${this._fmt(Math.floor(r.funding))}`;
    document.getElementById('res-energy').textContent = `⚡ ${Math.floor(r.energy)} E`;
    document.getElementById('res-reputation').textContent = `⭐ ${Math.floor(r.reputation)} Rep`;
    document.getElementById('res-data').textContent = `📊 ${this._fmt(Math.floor(r.data))} Data`;

    const statusEl = document.getElementById('stat-beam-status');
    statusEl.textContent = s.beamOn ? '● Beam: ON' : '● Beam: OFF';
    statusEl.className = 'stat' + (s.beamOn ? ' on' : '');

    document.getElementById('stat-energy').textContent = `Energy: ${s.beamEnergy ? s.beamEnergy.toFixed(2) : '0'} GeV`;
    document.getElementById('stat-current').textContent = `Current: ${s.beamCurrent ? s.beamCurrent.toFixed(2) + ' mA' : '--'}`;
    document.getElementById('stat-luminosity').textContent = `Luminosity: ${s.luminosity ? s.luminosity.toExponential(1) : '0'}`;
    document.getElementById('stat-length').textContent = `Length: ${s.totalLength}m`;

    this._updateBeamStatusUI();

    // Auto-save every 30 ticks
    if (s.tick % 30 === 0) this.game.save();
  }

  _updateBeamStatusUI() {
    const btn = document.getElementById('btn-beam-toggle');
    if (this.game.state.beamOn) {
      btn.textContent = '⏹ STOP BEAM';
      btn.classList.add('running');
    } else {
      btn.textContent = '▶ START BEAM';
      btn.classList.remove('running');
    }
  }

  _fmt(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toString();
  }

  // === PALETTE ===

  _renderPalette(category) {
    const palette = document.getElementById('component-palette');
    palette.innerHTML = '';

    for (const comp of Object.values(COMPONENTS)) {
      if (comp.category !== category) continue;

      const unlocked = this.game.isComponentUnlocked(comp);
      const affordable = this.game.canAfford(comp.cost);

      const div = document.createElement('div');
      div.className = 'palette-item';
      if (!unlocked) div.classList.add('locked');
      else if (!affordable) div.classList.add('unaffordable');

      div.innerHTML = `
        <span class="p-name">${comp.name}</span>
        <span class="p-cost">${unlocked ? '$' + comp.cost.funding : '🔒'}</span>
      `;

      if (unlocked) {
        div.addEventListener('click', () => {
          document.querySelectorAll('.palette-item').forEach(p => p.classList.remove('selected'));
          div.classList.add('selected');
          // input handler will be set up by main.js
          if (this._onToolSelect) this._onToolSelect(comp.id);
        });
      }

      palette.appendChild(div);
    }
  }

  updatePalette(category) {
    this._renderPalette(category);
  }

  // === RESEARCH / GOALS OVERLAYS ===

  _renderResearchOverlay() {
    const list = document.getElementById('research-list');
    list.innerHTML = Object.values(RESEARCH).map(r => {
      const completed = this.game.state.completedResearch.includes(r.id);
      const active = this.game.state.activeResearch === r.id;
      const available = this.game.isResearchAvailable(r.id);
      const locked = !completed && !active && !available;
      let cls = completed ? 'completed' : active ? 'researching' : locked ? 'locked' : '';

      let progress = '';
      if (active) {
        const pct = (this.game.state.researchProgress / r.duration * 100).toFixed(0);
        progress = `<div class="r-progress"><div class="bar" style="width:${pct}%"></div></div>`;
      }

      return `<div class="research-item ${cls}" data-research="${r.id}">
        <div class="r-name">${completed ? '✓ ' : ''}${r.name}</div>
        <div class="r-cost">${completed ? 'Done' : active ? 'Researching...' : r.cost.data + ' data | ' + r.duration + 's'}</div>
        <div class="r-desc">${locked ? 'Requires: ' + r.requires : r.desc}</div>
        ${progress}
      </div>`;
    }).join('');

    list.onclick = (e) => {
      const item = e.target.closest('.research-item:not(.completed):not(.researching):not(.locked)');
      if (item) this.game.startResearch(item.dataset.research);
    };
  }

  _renderGoalsOverlay() {
    const list = document.getElementById('goals-list');
    list.innerHTML = OBJECTIVES.map(obj => {
      const done = this.game.state.completedObjectives.includes(obj.id);
      const rew = Object.entries(obj.reward).map(([k, v]) => `${k}:+${this._fmt(v)}`).join(' ');
      return `<div class="objective-item ${done ? 'completed' : ''}">
        <div class="o-name">${done ? '✓' : '□'} ${obj.name}</div>
        <div class="o-desc">${obj.desc}</div>
        <div class="o-reward">${done ? 'Claimed!' : rew}</div>
      </div>`;
    }).join('');
  }

  // === HUD DOM EVENTS ===

  _bindHUDEvents() {
    // Category tabs
    document.getElementById('component-tabs').addEventListener('click', (e) => {
      const tab = e.target.closest('.cat-tab');
      if (!tab) return;
      document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      this._renderPalette(tab.dataset.category);
    });

    // Beam toggle
    document.getElementById('btn-beam-toggle').addEventListener('click', () => {
      this.game.toggleBeam();
    });

    // Research button
    document.getElementById('btn-research').addEventListener('click', () => {
      document.getElementById('overlay-research').classList.toggle('hidden');
    });

    // Goals button
    document.getElementById('btn-goals').addEventListener('click', () => {
      document.getElementById('overlay-goals').classList.toggle('hidden');
    });

    // Overlay close buttons
    document.querySelectorAll('.overlay-close').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.closest('.overlay').classList.add('hidden');
      });
    });
  }

  // === FRAME LOOP ===

  _onFrame(ticker) {
    this._animateBeam(ticker.deltaTime);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add renderer.js
git commit -m "feat: add PixiJS isometric renderer with grid, sprites, beam, HUD"
```

---

### Task 8: Create Main Entry Point

**Files:**
- Modify: `main.js`

- [ ] **Step 1: Rewrite main.js**

```js
// === BEAMLINE TYCOON: MAIN ===

// Clear old saves from the grid-based version
const oldSave = localStorage.getItem('beamlineCowboy');
if (oldSave) localStorage.removeItem('beamlineCowboy');

(async function main() {
  // Create core objects
  const beamline = new Beamline();
  const game = new Game(beamline);
  const spriteManager = new SpriteManager();

  // Create renderer (async — initializes PixiJS)
  const renderer = new Renderer(game, spriteManager);
  await renderer.init();

  // Create input handler and wire tool selection
  const input = new InputHandler(renderer, game);
  renderer._onToolSelect = (compType) => input.selectTool(compType);

  // Load saved game (if any)
  game.load();

  // Start game loop
  game.start();

  // Initialize beam physics engine (async — game works with fallback until ready)
  BeamPhysics.init().then(() => {
    game.log('Beam physics engine loaded.', 'good');
    game.recalcBeamline();
    game.emit('beamlineChanged');
  }).catch(err => {
    game.log('Physics engine failed to load — using simplified model.', 'bad');
    console.error('BeamPhysics init error:', err);
  });
})();
```

- [ ] **Step 2: Delete ui.js**

The old `ui.js` is fully replaced by `renderer.js`. Remove it.

```bash
rm ui.js
```

- [ ] **Step 3: Verify the game loads in browser**

Open `index.html` in a browser (via a local server, e.g., `npx serve .`). Verify:
- Green isometric grid renders
- Top resource bar shows
- Bottom HUD with category tabs and beam toggle shows
- No console errors
- Clicking a component in the palette enters build mode
- Can place a source by clicking the grid
- Arrow keys / WASD pan the view
- Scroll wheel zooms
- Space toggles beam (after placing source)
- R opens research overlay, Esc closes it

- [ ] **Step 4: Commit**

```bash
git add main.js
git rm ui.js
git commit -m "feat: wire up main entry point, remove old ui.js"
```

---

### Task 9: Add Minimap

**Files:**
- Modify: `renderer.js`

- [ ] **Step 1: Add minimap rendering to renderer.js**

Add a minimap container that sits on `app.stage` (not `world`) so it stays fixed on screen. It renders a small version of the beamline with a viewport indicator.

Add to the `init()` method, after the world container setup:

```js
    // Minimap (fixed on screen, not affected by zoom/pan)
    this.minimapContainer = new PIXI.Container();
    this.minimapContainer.zIndex = 100;
    this.app.stage.addChild(this.minimapContainer);

    // Minimap background
    this.minimapBg = new PIXI.Graphics();
    this.minimapContainer.addChild(this.minimapBg);

    // Minimap content
    this.minimapContent = new PIXI.Container();
    this.minimapContainer.addChild(this.minimapContent);

    // Minimap viewport indicator
    this.minimapViewport = new PIXI.Graphics();
    this.minimapContainer.addChild(this.minimapViewport);

    this._positionMinimap();
```

Add these methods to the Renderer class:

```js
  _positionMinimap() {
    const w = 160;
    const h = 100;
    const padding = 10;

    this.minimapContainer.x = this.app.screen.width - w - padding;
    this.minimapContainer.y = 40; // below top bar

    // Background
    this.minimapBg.clear();
    this.minimapBg.roundRect(0, 0, w, h, 4);
    this.minimapBg.fill({ color: 0x0a0a1e, alpha: 0.85 });
    this.minimapBg.roundRect(0, 0, w, h, 4);
    this.minimapBg.stroke({ color: 0x444444, width: 1 });

    // Label
    const label = new PIXI.Text({
      text: 'FACILITY MAP',
      style: { fontFamily: 'monospace', fontSize: 7, fill: 0x666666 },
    });
    label.x = 4;
    label.y = 2;
    this.minimapContainer.addChild(label);
  }

  _renderMinimap() {
    this.minimapContent.removeChildren();

    const nodes = this.game.beamline.getAllNodes();
    if (nodes.length === 0) return;

    // Find bounds
    let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
    for (const n of nodes) {
      for (const t of n.tiles) {
        minC = Math.min(minC, t.col);
        maxC = Math.max(maxC, t.col);
        minR = Math.min(minR, t.row);
        maxR = Math.max(maxR, t.row);
      }
    }

    const mapW = 150;
    const mapH = 80;
    const rangeC = Math.max(maxC - minC + 1, 1);
    const rangeR = Math.max(maxR - minR + 1, 1);
    const scale = Math.min(mapW / (rangeC * 8), mapH / (rangeR * 8));

    const g = new PIXI.Graphics();

    for (const n of nodes) {
      const comp = COMPONENTS[n.type];
      if (!comp) continue;

      for (const t of n.tiles) {
        const mx = 5 + (t.col - minC) * 4 * scale;
        const my = 15 + (t.row - minR) * 4 * scale;
        g.rect(mx, my, 3 * scale, 3 * scale);
        g.fill({ color: comp.spriteColor, alpha: 0.8 });
      }
    }

    // Beam path line
    if (this.game.state.beamOn) {
      const ordered = this.game.beamline.getOrderedComponents();
      if (ordered.length >= 2) {
        g.setStrokeStyle({ width: 1, color: 0x00ff00, alpha: 0.6 });
        for (let i = 0; i < ordered.length - 1; i++) {
          const t1 = ordered[i].tiles[0];
          const t2 = ordered[i + 1].tiles[0];
          const x1 = 5 + (t1.col - minC) * 4 * scale + 1.5 * scale;
          const y1 = 15 + (t1.row - minR) * 4 * scale + 1.5 * scale;
          const x2 = 5 + (t2.col - minC) * 4 * scale + 1.5 * scale;
          const y2 = 15 + (t2.row - minR) * 4 * scale + 1.5 * scale;
          g.moveTo(x1, y1);
          g.lineTo(x2, y2);
          g.stroke();
        }
      }
    }

    this.minimapContent.addChild(g);

    // Viewport indicator
    this.minimapViewport.clear();
    // Calculate viewport bounds in minimap space
    const vpW = (this.app.screen.width / this.zoom) * scale * 0.05;
    const vpH = (this.app.screen.height / this.zoom) * scale * 0.05;
    const vpX = 5 + ((-this.world.x / this.zoom - minC * TILE_W / 2) * scale * 0.05);
    const vpY = 15 + ((-this.world.y / this.zoom - minR * TILE_H / 2) * scale * 0.05);

    this.minimapViewport.rect(
      Math.max(5, Math.min(vpX, 145)),
      Math.max(15, Math.min(vpY, 85)),
      Math.min(vpW, 60),
      Math.min(vpH, 40)
    );
    this.minimapViewport.stroke({ color: 0x4488ff, width: 1.5, alpha: 0.6 });
  }
```

- [ ] **Step 2: Commit**

```bash
git add renderer.js
git commit -m "feat: add minimap with viewport indicator"
```

---

### Task 10: Integration Testing and Polish

**Files:**
- Modify: `renderer.js` (minor fixes)
- Modify: `input.js` (minor fixes)

- [ ] **Step 1: Test the full gameplay loop in browser**

Start a local server and test in order:
1. Page loads with isometric grid, HUD, and palette
2. Select Source from palette — build cursors appear (hover cursor for first source)
3. Click on grid — source is placed, resources deducted
4. Build cursor appears at end of source (in NE direction)
5. Select Drift — click cursor — drift placed
6. Select Dipole — click cursor — dipole placed (press F to flip bend direction)
7. Continue building, verify beam pipe snakes around
8. Press Space — beam turns on, green glow between components
9. Verify resources tick (energy consumed, data collected if detector placed)
10. Press R — research overlay shows, can start research
11. Press G — goals overlay shows progress
12. Click placed component — popup shows stats and remove button
13. Scroll wheel zooms in/out, component sprites update LOD
14. WASD pans the view
15. Minimap updates with placed components
16. Refresh page — game loads from save

- [ ] **Step 2: Fix any issues found during testing**

Address any bugs found in step 1. Common issues to watch for:
- Coordinate conversion off by one (isoToGrid rounding)
- Build cursor position after dipole bends
- Z-ordering of overlapping sprites
- HUD elements not updating on tick

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete Phase 1 isometric beamline builder"
```

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Project structure + PixiJS setup | `index.html`, `style.css` |
| 2 | Track-based data model | `data.js` |
| 3 | Beamline directed graph | `beamline.js`, `test/test-beamline.js` |
| 4 | Game engine refactor | `game.js` |
| 5 | Iso math + sprite manager | `sprites.js`, `test/test-iso.js` |
| 6 | Input handler | `input.js` |
| 7 | PixiJS renderer | `renderer.js` |
| 8 | Main entry point | `main.js` |
| 9 | Minimap | `renderer.js` |
| 10 | Integration testing | All files |
