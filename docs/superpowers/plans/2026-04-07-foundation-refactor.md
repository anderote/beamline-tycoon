# Foundation Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate from global `<script>` tags to Vite + ES modules, introduce a reactive store, and break up monolith files — while keeping the game working at every step.

**Architecture:** Vite as build tool with vanilla ES modules. A lightweight custom reactive store replaces the flat `game.state` object. Monolith files (renderer.js, data.js, game.js) are mechanically split by responsibility into focused modules under `src/`.

**Tech Stack:** Vite, PixiJS 8, Pyodide (unchanged), vanilla ES modules, no framework.

---

## File Structure

After all tasks complete, the project will have this structure:

```
package.json
vite.config.js
index.html                          (updated: single module entry point)
public/
  beam_physics/                     (moved from root — Pyodide fetches these)
src/
  main.js                           (entry point)
  store.js                          (reactive state store)
  data/
    units.js                        (UNITS, formatEnergy, formatters)
    directions.js                   (DIR, DIR_NAMES, DIR_DELTA, turn*, TILE_W, TILE_H)
    modes.js                        (MODES, CATEGORIES, CONNECTION_TYPES)
    components.js                   (COMPONENTS)
    infrastructure.js               (INFRASTRUCTURE, ZONES, ZONE_TIER_THRESHOLDS, ZONE_FURNISHINGS, FURNISHING_TIER_THRESHOLDS)
    research.js                     (RESEARCH_CATEGORIES, RESEARCH_LAB_MAP, RESEARCH_SPEED_TABLE, RESEARCH)
    machines.js                     (MACHINE_TIER, MACHINE_TYPES, MACHINES)
    objectives.js                   (OBJECTIVES)
  beamline/
    Beamline.js                     (Beamline class)
    physics.js                      (BeamPhysics IIFE — Pyodide bridge)
    component-physics.js            (PARAM_DEFS, computeStats, getDefaults)
  game/
    Game.js                         (constructor, tick loop, save/load, event wiring, placement, infra, zones, connections, machines, staffing)
    economy.js                      (computeSystemStats — extracted from Game)
    research.js                     (research methods — extracted from Game)
    objectives.js                   (objective checking — extracted from Game)
  renderer/
    Renderer.js                     (PixiJS init, camera, layers, event routing, state setters)
    grid.js                         (grid drawing, coordinate math — gridToIso, isoToGrid, tileCenterIso)
    beamline-renderer.js            (component rendering, beam rendering, cursor rendering)
    infrastructure-renderer.js      (infra tiles, zones, facility equipment, connections, network overlay)
    hud.js                          (DOM updates: top bar, beam stats, palette, category tabs, mode switcher, system stats panel)
    overlays.js                     (tech tree, goals overlay, component popup, research popover)
    sprites.js                      (SpriteManager)
  input/
    InputHandler.js                 (keyboard/mouse bindings, mode switching, tool/placement dispatch)
  networks/
    networks.js                     (Networks object — network discovery and validation)
  ui/
    probe.js                        (ProbeWindow)
    probe-plots.js                  (probe chart rendering)
assets/                             (unchanged)
beam_physics/                       (Python source — stays at root for dev, copied to public/ by Vite)
test/                               (existing tests — updated imports)
```

---

### Task 1: Scaffold Vite and package.json

**Files:**
- Create: `package.json`
- Create: `vite.config.js`
- Modify: `index.html`

This task sets up Vite to serve the existing game with zero code changes. Vite can serve plain JS files — we just need it to find `index.html` and serve static assets.

- [ ] **Step 1: Create package.json**

```json
{
  "name": "beamline-tycoon",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

- [ ] **Step 2: Install Vite**

Run: `npm install --save-dev vite`

- [ ] **Step 3: Create vite.config.js**

Vite needs to serve the `beam_physics/` Python files for Pyodide to fetch them, and serve existing JS as-is during the transition period.

```js
import { defineConfig } from 'vite';

export default defineConfig({
  // Serve root as the project dir (index.html is here)
  root: '.',
  publicDir: 'public',
  server: {
    port: 8000,
  },
  build: {
    outDir: 'dist',
  },
});
```

- [ ] **Step 4: Create public/ directory and symlink beam_physics**

The `beam_physics/` Python files need to be fetchable by Pyodide. Vite's `public/` directory serves static files at the root URL.

Run: `mkdir -p public && cp -r beam_physics public/beam_physics`

- [ ] **Step 5: Verify the game loads through Vite**

Run: `npx vite --host`

Open `http://localhost:8000` in browser. Verify: game loads, grid renders, components can be placed, physics engine initializes. The existing `<script>` tags still load everything as globals.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vite.config.js public/beam_physics
git commit -m "build: scaffold Vite dev server alongside existing script tags"
```

---

### Task 2: Convert data.js to ES modules (split into 8 files)

**Files:**
- Create: `src/data/units.js`
- Create: `src/data/directions.js`
- Create: `src/data/modes.js`
- Create: `src/data/components.js`
- Create: `src/data/infrastructure.js`
- Create: `src/data/research.js`
- Create: `src/data/machines.js`
- Create: `src/data/objectives.js`
- Delete: `data.js` (after all consumers import from src/data/)

This is the easiest monolith to split since it's all constant definitions. Each new file exports its constants with `export`. A barrel file re-exports everything for easy importing during transition.

- [ ] **Step 1: Create src/data/units.js**

Extract from `data.js` lines 1-96: `formatEnergy()` function and `UNITS` constant.

```js
// src/data/units.js

export function formatEnergy(gev, suffix = '') {
  if (gev == null || !isFinite(gev)) return { val: '--', unit: '' };
  const abs = Math.abs(gev);
  const fmt = (v) => {
    const a = Math.abs(v);
    if (a >= 100) return v.toFixed(0);
    if (a >= 10) return v.toFixed(1);
    if (a >= 1) return v.toFixed(2);
    if (a >= 0.1) return v.toFixed(3);
    return v.toPrecision(3);
  };
  if (abs >= 1000)  return { val: fmt(gev / 1000), unit: `TeV${suffix}` };
  if (abs >= 1)     return { val: fmt(gev), unit: `GeV${suffix}` };
  if (abs >= 1e-4)  return { val: fmt(gev * 1e3), unit: `MeV${suffix}` };
  if (abs >= 1e-7)  return { val: fmt(gev * 1e6), unit: `keV${suffix}` };
  return { val: fmt(gev * 1e9), unit: `eV${suffix}` };
}

export const UNITS = {
  // [copy the full UNITS object from data.js lines 23-96]
};
```

Note: copy the complete UNITS object exactly as-is from data.js.

- [ ] **Step 2: Create src/data/directions.js**

Extract from `data.js` lines 98-113: direction constants and tile dimensions.

```js
// src/data/directions.js

export const DIR = { NE: 0, SE: 1, SW: 2, NW: 3 };
export const DIR_NAMES = ['NE', 'SE', 'SW', 'NW'];
export const DIR_DELTA = [
  { dc: 0, dr: -1 },
  { dc: 1, dr: 0 },
  { dc: 0, dr: 1 },
  { dc: -1, dr: 0 },
];
export function turnLeft(dir) { return (dir + 3) % 4; }
export function turnRight(dir) { return (dir + 1) % 4; }
export function reverseDir(dir) { return (dir + 2) % 4; }

export const TILE_W = 64;
export const TILE_H = 32;
```

- [ ] **Step 3: Create src/data/modes.js**

Extract from `data.js` lines 116-176: `MODES`, `CATEGORIES`, `CONNECTION_TYPES`.

```js
// src/data/modes.js

export const MODES = {
  // [copy full MODES object from data.js]
};

export const CATEGORIES = {};
for (const mode of Object.values(MODES)) {
  Object.assign(CATEGORIES, mode.categories);
}

export const CONNECTION_TYPES = {
  // [copy full CONNECTION_TYPES object from data.js]
};
```

- [ ] **Step 4: Create src/data/components.js**

Extract from `data.js` lines 179-2250: the entire `COMPONENTS` object.

```js
// src/data/components.js

export const COMPONENTS = {
  // [copy the entire COMPONENTS object from data.js — this is the largest section, ~2070 lines]
};
```

- [ ] **Step 5: Create src/data/infrastructure.js**

Extract from `data.js` lines 2252-2416: `INFRASTRUCTURE`, `ZONES`, `ZONE_TIER_THRESHOLDS`, `ZONE_FURNISHINGS`, `FURNISHING_TIER_THRESHOLDS`.

```js
// src/data/infrastructure.js

export const INFRASTRUCTURE = {
  // [copy from data.js]
};

export const ZONES = {
  // [copy from data.js]
};

export const ZONE_TIER_THRESHOLDS = [4, 8, 16, 20];

export const ZONE_FURNISHINGS = {
  // [copy from data.js]
};

export const FURNISHING_TIER_THRESHOLDS = [1, 3, 5];
```

- [ ] **Step 6: Create src/data/research.js**

Extract from `data.js` lines 2383-3047: `RESEARCH_CATEGORIES`, `RESEARCH_LAB_MAP`, `RESEARCH_SPEED_TABLE`, `RESEARCH`.

```js
// src/data/research.js

export const RESEARCH_CATEGORIES = {
  // [copy from data.js]
};

export const RESEARCH_LAB_MAP = {
  // [copy from data.js]
};

export const RESEARCH_SPEED_TABLE = {
  // [copy from data.js]
};

export const RESEARCH = {
  // [copy from data.js — large object, ~630 lines]
};
```

- [ ] **Step 7: Create src/data/machines.js**

Extract from `data.js` lines 3049-3374: `MACHINE_TIER`, `MACHINE_TYPES`, `MACHINES`.

```js
// src/data/machines.js

export const MACHINE_TIER = {
  // [copy from data.js]
};

export const MACHINE_TYPES = {
  // [copy from data.js]
};

export const MACHINES = {
  // [copy from data.js]
};
```

- [ ] **Step 8: Create src/data/objectives.js**

Extract from `data.js` lines 3087-end: the `OBJECTIVES` array.

```js
// src/data/objectives.js

export const OBJECTIVES = [
  // [copy from data.js]
];
```

Note: OBJECTIVES references `state` properties in its condition functions. These are lambda closures over the state object passed at check time, so they don't need imports.

- [ ] **Step 9: Verify all data exports are correct**

Create a quick smoke test. Run in browser console or as a temp script:

```js
import { COMPONENTS } from './src/data/components.js';
import { RESEARCH } from './src/data/research.js';
import { MODES } from './src/data/modes.js';
console.log('Components:', Object.keys(COMPONENTS).length);
console.log('Research:', Object.keys(RESEARCH).length);
console.log('Modes:', Object.keys(MODES).length);
```

Verify counts match the original data.js.

- [ ] **Step 10: Commit**

```bash
git add src/data/
git commit -m "refactor: split data.js into 8 ES module files under src/data/"
```

---

### Task 3: Convert leaf modules to ES modules

**Files:**
- Create: `src/beamline/Beamline.js` (from `beamline.js`)
- Create: `src/beamline/physics.js` (from `physics.js`)
- Create: `src/beamline/component-physics.js` (from `component-physics.js`)
- Create: `src/networks/networks.js` (from `networks.js`)
- Create: `src/renderer/grid.js` (from `sprites.js` — coordinate functions)
- Create: `src/renderer/sprites.js` (from `sprites.js` — SpriteManager class)
- Create: `src/ui/probe.js` (from `probe.js`)
- Create: `src/ui/probe-plots.js` (from `probe-plots.js`)

These files are already right-sized. The conversion is: add `import` for their dependencies, add `export` for their classes/functions, move to `src/`.

- [ ] **Step 1: Convert beamline.js → src/beamline/Beamline.js**

Add imports for data dependencies, export the class:

```js
// src/beamline/Beamline.js
import { DIR_DELTA, turnLeft, turnRight } from '../data/directions.js';
import { COMPONENTS } from '../data/components.js';

export class Beamline {
  // [entire existing Beamline class, unchanged]
  // Remove the `if (typeof module !== 'undefined')` block at the bottom
}
```

The class references `DIR_DELTA`, `turnLeft`, `turnRight`, `COMPONENTS`, and `PARAM_DEFS` as globals. Add imports for the first four. `PARAM_DEFS` comes from component-physics — import it too:

```js
import { PARAM_DEFS } from './component-physics.js';
```

- [ ] **Step 2: Convert physics.js → src/beamline/physics.js**

The `BeamPhysics` IIFE references `loadPyodide` which is loaded from CDN. Keep the CDN script tag in index.html for now; `loadPyodide` will be a global.

```js
// src/beamline/physics.js

export const BeamPhysics = (() => {
  // [entire existing IIFE body, unchanged]
  // The fetch() calls for beam_physics/*.py will still work because
  // they're relative URLs and Vite serves public/ at root
})();
```

- [ ] **Step 3: Convert component-physics.js → src/beamline/component-physics.js**

Remove the UMD wrapper, use plain ES exports:

```js
// src/beamline/component-physics.js

const e = 1.602176634e-19;
// [all constants, unchanged]

export const PARAM_DEFS = {
  // [unchanged]
};

export function computeStats(type, params) {
  // [unchanged]
}

export function getDefaults(type) {
  // [unchanged]
}
```

- [ ] **Step 4: Convert networks.js → src/networks/networks.js**

```js
// src/networks/networks.js
import { COMPONENTS } from '../data/components.js';
import { CONNECTION_TYPES } from '../data/modes.js';

const CONN_TYPES = ['powerCable', 'vacuumPipe', 'rfWaveguide', 'coolingWater', 'cryoTransfer', 'dataFiber'];
const CARDINAL = [[0, -1], [0, 1], [-1, 0], [1, 0]];

export const Networks = {
  // [entire existing Networks object, unchanged]
};
```

Check for global references: `Networks` references `COMPONENTS` for equipment validation. Add that import.

- [ ] **Step 5: Convert sprites.js → src/renderer/grid.js + src/renderer/sprites.js**

The current `sprites.js` contains two things: coordinate utility functions (`gridToIso`, `isoToGrid`, `tileCenterIso`) and the `SpriteManager` class. Split them:

```js
// src/renderer/grid.js
import { TILE_W, TILE_H } from '../data/directions.js';

export function gridToIso(col, row) {
  return {
    x: (col - row) * (TILE_W / 2),
    y: (col + row) * (TILE_H / 2),
  };
}

export function isoToGrid(screenX, screenY) {
  return {
    col: Math.floor((screenX / (TILE_W / 2) + screenY / (TILE_H / 2)) / 2),
    row: Math.floor((screenY / (TILE_H / 2) - screenX / (TILE_W / 2)) / 2),
  };
}

export function tileCenterIso(col, row) {
  return gridToIso(col + 0.5, row + 0.5);
}
```

```js
// src/renderer/sprites.js

export class SpriteManager {
  // [entire existing SpriteManager class, unchanged]
  // References TILE_W, TILE_H — add import from directions
  // References COMPONENTS — add import
  // References PIXI — will be global from CDN for now
}
```

Add necessary imports to sprites.js:
```js
import { TILE_W, TILE_H } from '../data/directions.js';
import { COMPONENTS } from '../data/components.js';
```

- [ ] **Step 6: Convert probe.js → src/ui/probe.js**

```js
// src/ui/probe.js
import { COMPONENTS } from '../data/components.js';

export class ProbeWindow {
  // [entire existing class, unchanged]
}
```

- [ ] **Step 7: Convert probe-plots.js → src/ui/probe-plots.js**

```js
// src/ui/probe-plots.js

export class ProbePlots {
  // [entire existing code, unchanged — check what it exports]
}
```

Check what `probe-plots.js` actually exports/defines and match the export.

- [ ] **Step 8: Verify imports resolve correctly**

Run: `npx vite` and check browser console for import errors. At this point the game still uses the old `<script>` tags — these new modules are just sitting there. No errors means the module graph is valid.

- [ ] **Step 9: Commit**

```bash
git add src/beamline/ src/networks/ src/renderer/grid.js src/renderer/sprites.js src/ui/
git commit -m "refactor: convert leaf modules (beamline, networks, sprites, probes) to ES modules"
```

---

### Task 4: Split and convert game.js to ES modules

**Files:**
- Create: `src/store.js`
- Create: `src/game/Game.js`
- Create: `src/game/economy.js`
- Create: `src/game/research.js`
- Create: `src/game/objectives.js`

The Game class is 2000 lines. We split it by extracting method groups into standalone functions that operate on the store. The Game class remains the coordinator.

- [ ] **Step 1: Create src/store.js**

```js
// src/store.js

export function createStore(initialState) {
  let state = structuredClone(initialState);
  const listeners = new Map();

  function get(key) {
    return state[key];
  }

  function set(key, value) {
    state[key] = value;
    const fns = listeners.get(key);
    if (fns) fns.forEach(fn => fn(value));
  }

  function update(key, fn) {
    set(key, fn(state[key]));
  }

  function subscribe(key, fn) {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(fn);
    return () => listeners.get(key).delete(fn);
  }

  function getState() {
    return state;
  }

  function setState(newState) {
    state = newState;
  }

  function notify(key) {
    const fns = listeners.get(key);
    if (fns) fns.forEach(fn => fn(state[key]));
  }

  return { get, set, update, subscribe, getState, setState, notify };
}
```

- [ ] **Step 2: Create src/game/economy.js**

Extract `computeSystemStats()` from Game class (lines 1258-1567 of game.js). It's the largest single method (~310 lines) and is purely a computation that reads state and writes back `systemStats`.

```js
// src/game/economy.js
import { COMPONENTS } from '../data/components.js';
import { Networks } from '../networks/networks.js';

/**
 * Compute system-level infrastructure stats from facility equipment and beamline state.
 * Reads from state, returns the systemStats object.
 */
export function computeSystemStats(state) {
  const equip = state.facilityEquipment || [];
  const beamline = state.beamline || [];
  const nets = state.networkData;

  // [entire body of Game.computeSystemStats(), unchanged,
  //  but replace `this.state` with `state` throughout,
  //  and return the systemStats object instead of assigning to this.state.systemStats]

  return { vacuum, rfPower, cryo, cooling, power, dataControls, ops };
}
```

- [ ] **Step 3: Create src/game/research.js**

Extract research-related methods from Game class: `isResearchAvailable`, `startResearch`, `getEffect`, `getResearchSpeedMultiplier`, `_computeNodeDepth`, `_computeFinalNodes`, `_getFurnishingTier`, `getLabResearchTier`, and the research tick logic from `tick()`.

```js
// src/game/research.js
import { RESEARCH, RESEARCH_LAB_MAP, RESEARCH_SPEED_TABLE } from '../data/research.js';
import { COMPONENTS } from '../data/components.js';
import { ZONES } from '../data/infrastructure.js';
import { ZONE_TIER_THRESHOLDS, FURNISHING_TIER_THRESHOLDS, ZONE_FURNISHINGS } from '../data/infrastructure.js';
import { MACHINES } from '../data/machines.js';

// Cache for computed values
let _nodeDepthCache = {};
let _finalNodes = null;

export function resetResearchCache() {
  _nodeDepthCache = {};
  _finalNodes = null;
}

export function isResearchAvailable(id, state) {
  const r = RESEARCH[id];
  if (!r || r.hidden || state.completedResearch.includes(id) || state.activeResearch === id) return false;
  if (!r.requires) return true;
  if (Array.isArray(r.requires)) {
    return r.requires.every(req => state.completedResearch.includes(req));
  }
  return state.completedResearch.includes(r.requires);
}

export function getEffect(key, def, completedResearch) {
  let v = def;
  for (const id of completedResearch) {
    const r = RESEARCH[id];
    if (r?.effect?.[key] !== undefined)
      v = key.endsWith('Mult') ? v * r.effect[key] : v + r.effect[key];
  }
  return v;
}

export function computeNodeDepth(id) {
  if (_nodeDepthCache[id] !== undefined) return _nodeDepthCache[id];
  const r = RESEARCH[id];
  if (!r || !r.requires) return 1;
  const reqs = Array.isArray(r.requires) ? r.requires : [r.requires];
  const depth = 1 + Math.max(...reqs.map(req => computeNodeDepth(req)));
  _nodeDepthCache[id] = depth;
  return depth;
}

export function computeFinalNodes() {
  if (_finalNodes) return _finalNodes;
  const referenced = new Set();
  for (const r of Object.values(RESEARCH)) {
    if (r.requires) {
      const reqs = Array.isArray(r.requires) ? r.requires : [r.requires];
      for (const req of reqs) referenced.add(req);
    }
  }
  _finalNodes = new Set();
  for (const [id, r] of Object.entries(RESEARCH)) {
    if (!r.hidden && !referenced.has(id)) _finalNodes.add(id);
  }
  return _finalNodes;
}

export function getFurnishingTier(zoneType, zoneFurnishings) {
  let count = 0;
  for (const f of zoneFurnishings || []) {
    const def = ZONE_FURNISHINGS[f.type];
    if (def && def.zoneType === zoneType) count++;
  }
  let tier = 0;
  for (let t = FURNISHING_TIER_THRESHOLDS.length - 1; t >= 0; t--) {
    if (count >= FURNISHING_TIER_THRESHOLDS[t]) { tier = t + 1; break; }
  }
  return tier;
}

export function getLabResearchTier(labType, state) {
  const conn = state.zoneConnectivity?.[labType];
  const tileTier = conn ? conn.tier : 0;
  const furnTier = getFurnishingTier(labType, state.zoneFurnishings);
  return Math.min(tileTier, furnTier);
}

export function getResearchSpeedMultiplier(id, state) {
  const r = RESEARCH[id];
  if (!r) return null;
  const labType = RESEARCH_LAB_MAP[r.category];
  if (!labType) return 1;
  const tier = getLabResearchTier(labType, state);
  const depth = computeNodeDepth(id);
  const isFinal = computeFinalNodes().has(id);

  let row;
  if (isFinal) row = 'final';
  else if (depth >= 5) row = 'late';
  else if (depth >= 3) row = 'mid';
  else row = 'early';

  return RESEARCH_SPEED_TABLE[row][tier];
}

export function startResearch(id, state, log) {
  if (!isResearchAvailable(id, state)) return false;
  const r = RESEARCH[id];
  const speedMult = getResearchSpeedMultiplier(id, state);
  if (speedMult === null) {
    const labType = RESEARCH_LAB_MAP[r.category];
    const labName = ZONES[labType]?.name || labType;
    const isFinal = computeFinalNodes().has(id);
    const minTier = isFinal ? 2 : 1;
    log(`Requires ${labName} (Tier ${minTier}+) to begin`, 'bad');
    return false;
  }
  const costs = {};
  if (r.cost.data) costs.data = r.cost.data;
  if (r.cost.funding) costs.funding = r.cost.funding;
  if (r.cost.reputation) {
    if ((state.resources.reputation || 0) < r.cost.reputation) {
      log(`Need ${r.cost.reputation} reputation`, 'bad');
      return false;
    }
  }
  for (const [res, amt] of Object.entries(costs)) {
    if ((state.resources[res] || 0) < amt) {
      log(`Can't afford research`, 'bad');
      return false;
    }
  }
  for (const [res, amt] of Object.entries(costs)) {
    state.resources[res] -= amt;
  }
  state.activeResearch = id;
  state.researchProgress = 0;
  log(`Researching: ${r.name}`, 'info');
  return true;
}

/**
 * Advance research progress for one tick.
 * Returns { completed: bool, researchId, research } if research completes this tick.
 */
export function tickResearch(state, log) {
  if (!state.activeResearch) return null;
  const r = RESEARCH[state.activeResearch];
  const sciBonus = 1 + state.staff.scientists * 0.05;
  const bqFactor = state.beamOn ? (0.5 + 0.5 * state.beamQuality) : 0.5;
  const speedMult = getResearchSpeedMultiplier(state.activeResearch, state) || 1;
  state.researchProgress += (1 / speedMult) * sciBonus * bqFactor;
  if (state.researchProgress >= r.duration) {
    const id = state.activeResearch;
    state.completedResearch.push(id);
    log(`Research done: ${r.name}!`, 'reward');
    if (r.unlocks) {
      for (const c of r.unlocks) {
        if (COMPONENTS[c]) log(`Unlocked: ${COMPONENTS[c].name}`, 'good');
      }
    }
    if (r.unlocksMachines && MACHINES) {
      for (const m of r.unlocksMachines) {
        if (MACHINES[m]) log(`Unlocked machine: ${MACHINES[m].name}`, 'good');
      }
    }
    state.activeResearch = null;
    state.researchProgress = 0;
    return { completed: true, researchId: id, research: r };
  }
  return null;
}
```

- [ ] **Step 4: Create src/game/objectives.js**

Extract objective checking from the tick loop:

```js
// src/game/objectives.js
import { OBJECTIVES } from '../data/objectives.js';

/**
 * Check all objectives against current state.
 * Returns array of newly completed objectives.
 */
export function checkObjectives(state, log) {
  const completed = [];
  for (const obj of OBJECTIVES) {
    if (state.completedObjectives.includes(obj.id)) continue;
    try {
      if (obj.condition(state)) {
        state.completedObjectives.push(obj.id);
        for (const [r, a] of Object.entries(obj.reward))
          state.resources[r] = (state.resources[r] || 0) + a;
        log(`Goal complete: ${obj.name}!`, 'reward');
        completed.push(obj);
      }
    } catch { /* objective condition may reference undefined state */ }
  }
  return completed;
}
```

- [ ] **Step 5: Create src/game/Game.js**

The main Game class, now importing from the extracted modules. It keeps placement, infrastructure, zone, connection, machine, staffing, beam control, wear/repair, save/load, and the tick loop — but delegates to the extracted functions.

```js
// src/game/Game.js
import { createStore } from '../store.js';
import { COMPONENTS } from '../data/components.js';
import { INFRASTRUCTURE, ZONES, ZONE_TIER_THRESHOLDS, ZONE_FURNISHINGS } from '../data/infrastructure.js';
import { CONNECTION_TYPES } from '../data/modes.js';
import { MACHINES } from '../data/machines.js';
import { PARAM_DEFS } from '../beamline/component-physics.js';
import { BeamPhysics } from '../beamline/physics.js';
import { Networks } from '../networks/networks.js';
import { computeSystemStats } from './economy.js';
import * as research from './research.js';
import { checkObjectives } from './objectives.js';

export class Game {
  constructor(beamline) {
    this.beamline = beamline;
    this.state = {
      // [exact same initial state object as current game.js constructor]
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

  // Delegate to research module
  isResearchAvailable(id) { return research.isResearchAvailable(id, this.state); }
  startResearch(id) {
    const result = research.startResearch(id, this.state, this.log.bind(this));
    if (result) this.emit('researchChanged');
    return result;
  }
  getEffect(key, def) { return research.getEffect(key, def, this.state.completedResearch); }
  getResearchSpeedMultiplier(id) { return research.getResearchSpeedMultiplier(id, this.state); }
  getLabResearchTier(labType) { return research.getLabResearchTier(labType, this.state); }

  // Delegate to economy module
  computeSystemStats() {
    this.state.systemStats = computeSystemStats(this.state);
  }

  // [All other methods stay in Game class: canAfford, spend, isComponentUnlocked,
  //  placeSource, placeComponent, removeComponent, placeInfraTile, placeInfraRect,
  //  removeInfraTile, placeZoneTile, placeZoneRect, removeZone*, recomputeZoneConnectivity,
  //  getZoneTierForCategory, placeFacilityEquipment, removeFacilityEquipment,
  //  placeZoneFurnishing, removeZoneFurnishing, placeConnection, removeConnection,
  //  getConnectionsAt, hasValidConnection, _traceConnectionToSource, _getEquipmentConnectionType,
  //  recalcBeamline, runPhysics, _fallbackStats, setMachineType, isMachineTypeUnlocked,
  //  toggleBeam, _applyWear, _autoRepair, getComponentHealth, hireStaff, fireStaff,
  //  canPlaceMachine, isMachineUnlocked, placeMachine, removeMachine, getMachineAt,
  //  upgradeMachine, setMachineMode, toggleMachine, getMachinePerformance,
  //  checkInjectorLinks, _tickMachines, repairMachine, save, load, start, tick]

  tick() {
    this.state.tick++;

    // Revenue
    const passiveIncome = this.getEffect('passiveFunding', 0);
    const repIncome = Math.floor(this.state.resources.reputation * 0.5);
    this.state.resources.funding += passiveIncome + repIncome;

    // Staffing costs
    const staffCost = Object.entries(this.state.staff).reduce((sum, [type, count]) => {
      return sum + count * (this.state.staffCosts[type] || 0);
    }, 0);
    this.state.resources.funding -= staffCost;

    if (this.state.beamOn) {
      if (this.state.infraCanRun) {
        // [beam-on logic unchanged]
      }
    } else {
      this.state.continuousBeamTicks = 0;
    }

    // Uptime
    if (this.state.tick > 0) {
      this.state.uptimeFraction = this.state.beamOnTicks / this.state.tick;
    }

    // Auto-repair
    if (this.state.staff.technicians > 0 && this.state.tick % 5 === 0) {
      this._autoRepair();
    }

    // Research — delegate to module
    const researchResult = research.tickResearch(this.state, this.log.bind(this));
    if (researchResult?.completed) {
      this.recalcBeamline();
      this.emit('researchChanged');
    }

    // Budget crisis
    if (this.state.resources.funding < -1000 && this.state.tick % 30 === 0) {
      this.log('BUDGET CRISIS! Operating at a loss.', 'bad');
    }

    // Objectives — delegate to module
    const completedObj = checkObjectives(this.state, this.log.bind(this));
    for (const obj of completedObj) {
      this.emit('objectiveCompleted', obj);
    }

    // Machines
    this._tickMachines();

    // System stats
    this.computeSystemStats();

    // Auto-save
    if (this.state.tick % 30 === 0) this.save();

    this.emit('tick');
  }

  // [save() and load() — update to remove old format migration, fresh save format]
}
```

Note: The Game.js file will still be large (~800 lines) because it retains all placement/infrastructure/zone/connection/machine methods. This is acceptable — further decomposition would require splitting the Game class itself, which is a deeper refactor for a future phase.

- [ ] **Step 6: Verify Game module imports resolve**

Run: `npx vite` and check console. The Game module and its dependencies should load without errors. The game won't work yet through modules (still using old script tags), but import resolution should be clean.

- [ ] **Step 7: Commit**

```bash
git add src/store.js src/game/
git commit -m "refactor: split game.js into Game + economy/research/objectives modules with store"
```

---

### Task 5: Split and convert renderer.js to ES modules

**Files:**
- Create: `src/renderer/Renderer.js`
- Create: `src/renderer/beamline-renderer.js`
- Create: `src/renderer/infrastructure-renderer.js`
- Create: `src/renderer/hud.js`
- Create: `src/renderer/overlays.js`

The renderer is the largest file (3700 lines). We split it into focused modules. The `Renderer` class stays as the coordinator, but rendering methods are extracted into standalone functions or mixin-style modules.

**Strategy:** Rather than breaking the Renderer class into multiple classes (which would require complex inter-object communication), we extract groups of methods into separate files but keep them as methods on the Renderer prototype. Each file adds methods to `Renderer.prototype`. This preserves the existing `this` context while splitting the file.

- [ ] **Step 1: Create src/renderer/Renderer.js (core)**

The core Renderer class with constructor, init(), coordinate conversion, camera controls, grid drawing, and event routing. Plus the state setter methods and utility methods.

```js
// src/renderer/Renderer.js
import { MODES, CATEGORIES, CONNECTION_TYPES } from '../data/modes.js';
import { COMPONENTS } from '../data/components.js';
import { gridToIso, isoToGrid, tileCenterIso } from './grid.js';

// Utility functions used across renderer modules
export function _darkenPort(color, factor) {
  const r = Math.floor(((color >> 16) & 0xff) * factor);
  const g = Math.floor(((color >> 8) & 0xff) * factor);
  const b = Math.floor((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

export function getModeForCategory(catKey) {
  for (const [modeKey, mode] of Object.entries(MODES)) {
    if (mode.categories[catKey]) return modeKey;
  }
  return null;
}

export function isFacilityCategory(catKey) {
  return getModeForCategory(catKey) === 'facility';
}

export class Renderer {
  constructor(game, spriteManager) {
    // [entire constructor, unchanged]
  }

  async init() {
    // [lines 95-239: PixiJS app init, layer creation, event routing, HUD binding]
    // Import and call methods from other modules via this.*
  }

  // Coordinate conversion
  screenToWorld(screenX, screenY) { /* unchanged */ }

  // Camera controls
  zoomAt(screenX, screenY, delta) { /* unchanged */ }
  panBy(dx, dy) { /* unchanged */ }

  // Grid drawing
  _drawGrid() { /* unchanged */ }

  // State setters
  updateHover(col, row) { /* unchanged */ }
  setBuildMode(active, toolType) { /* unchanged */ }
  setBulldozerMode(active) { /* unchanged */ }
  setProbeMode(active) { /* unchanged */ }
  updateCursorBendDir(dir) { /* unchanged */ }

  // Utility
  _nodeCenter(node) { /* unchanged */ }
  _fmt(n) { /* unchanged */ }

  // Placeholder methods — implemented in other files via prototype extension
  // (listed here for documentation; actual implementations are added by imports)
}

// Import prototype extensions
import './beamline-renderer.js';
import './infrastructure-renderer.js';
import './hud.js';
import './overlays.js';
```

- [ ] **Step 2: Create src/renderer/beamline-renderer.js**

Extract component rendering, beam rendering, and cursor rendering methods:

```js
// src/renderer/beamline-renderer.js
import { Renderer } from './Renderer.js';
import { COMPONENTS } from '../data/components.js';
import { CONNECTION_TYPES } from '../data/modes.js';
import { gridToIso, tileCenterIso } from './grid.js';

// _renderComponents (lines 303-419)
Renderer.prototype._renderComponents = function() {
  // [exact code from renderer.js _renderComponents method]
};

// _updateWarningsPanel (lines 421-446)
Renderer.prototype._updateWarningsPanel = function(warnings) {
  // [exact code]
};

// _renderBeam (lines 450-485)
Renderer.prototype._renderBeam = function() {
  // [exact code]
};

// _renderCursors (lines 487-530)
Renderer.prototype._renderCursors = function() {
  // [exact code]
};

// _drawDiamond, _drawBulldozerCursor, _drawCursorMarker (lines 532-876)
Renderer.prototype._drawDiamond = function(col, row, color, alpha) { /* exact code */ };
Renderer.prototype._drawBulldozerCursor = function(col, row) { /* exact code */ };
Renderer.prototype._drawCursorMarker = function(cursor, isHovered) { /* exact code */ };

// _renderProbeFlags (lines 1546-1578)
Renderer.prototype._renderProbeFlags = function(pins) { /* exact code */ };
```

- [ ] **Step 3: Create src/renderer/infrastructure-renderer.js**

Extract infrastructure, zone, facility, and connection rendering:

```js
// src/renderer/infrastructure-renderer.js
import { Renderer } from './Renderer.js';
import { COMPONENTS } from '../data/components.js';
import { INFRASTRUCTURE, ZONES, ZONE_FURNISHINGS } from '../data/infrastructure.js';
import { CONNECTION_TYPES } from '../data/modes.js';
import { gridToIso, isoToGrid, tileCenterIso } from './grid.js';
import { _darkenPort } from './Renderer.js';

// _renderInfrastructure, _drawInfraTile (lines 1580-1640)
Renderer.prototype._renderInfrastructure = function() { /* exact code */ };
Renderer.prototype._drawInfraTile = function(col, row, infra, hasRight, hasBelow) { /* exact code */ };

// _renderZones, _drawZoneTile, _drawZoneLabels (lines 1642-1802)
Renderer.prototype._renderZones = function() { /* exact code */ };
Renderer.prototype._drawZoneTile = function(col, row, zone, active) { /* exact code */ };
Renderer.prototype._drawZoneLabels = function(zones, connectivity) { /* exact code */ };

// _renderZoneFurnishings (lines 1773-1802)
Renderer.prototype._renderZoneFurnishings = function() { /* exact code */ };

// _renderFacilityEquipment (lines 1803-1834)
Renderer.prototype._renderFacilityEquipment = function() { /* exact code */ };

// _renderConnections, _hasConnection (lines 1835-2089)
Renderer.prototype._renderConnections = function() { /* exact code */ };
Renderer.prototype._hasConnection = function(col, row, connType) { /* exact code */ };

// Drag/line/demolish preview methods
Renderer.prototype.renderDragPreview = function(startCol, startRow, endCol, endRow, type, isZone) { /* exact code */ };
Renderer.prototype.renderLinePreview = function(path, infraType) { /* exact code */ };
Renderer.prototype.renderDemolishPreview = function(startCol, startRow, endCol, endRow) { /* exact code */ };
Renderer.prototype.clearDragPreview = function() { /* exact code */ };

// Network overlay
Renderer.prototype._drawIsoBoxOutline = function(col, row, color, lineWidth) { /* exact code */ };
Renderer.prototype._showNetworkPanel = function(connType, network) { /* exact code */ };
Renderer.prototype.clearNetworkOverlay = function() { /* exact code */ };
Renderer.prototype.showNetworkOverlay = function(connType) { /* exact code */ };
```

- [ ] **Step 4: Create src/renderer/hud.js**

Extract DOM HUD updates, palette rendering, category tabs, mode switcher, system stats:

```js
// src/renderer/hud.js
import { Renderer } from './Renderer.js';
import { COMPONENTS } from '../data/components.js';
import { MODES, CATEGORIES, CONNECTION_TYPES } from '../data/modes.js';
import { INFRASTRUCTURE, ZONES, ZONE_FURNISHINGS } from '../data/infrastructure.js';
import { MACHINES, MACHINE_TYPES } from '../data/machines.js';
import { formatEnergy, UNITS } from '../data/units.js';
import { getModeForCategory, isFacilityCategory } from './Renderer.js';

// Pixel font (lines 25-48 of original)
const _PX_FONT = { /* exact copy */ };
function _pxText(ctx, x, y, str, color) { /* exact copy */ }

// _updateHUD (lines 2092-2131)
Renderer.prototype._updateHUD = function() { /* exact code */ };

// _updateBeamButton (lines 2133-2159)
Renderer.prototype._updateBeamButton = function() { /* exact code */ };

// _generateCategoryTabs (lines 2161-2215)
Renderer.prototype._generateCategoryTabs = function() { /* exact code */ };

// _renderMachineTypeSelector (lines 2216-2281)
Renderer.prototype._renderMachineTypeSelector = function() { /* exact code */ };

// _refreshPalette, _renderPalette, _createPaletteItem (lines 2282-2670)
Renderer.prototype._refreshPalette = function() { /* exact code */ };
Renderer.prototype.updatePalette = function(category) { /* exact code - this is the public alias */ };
Renderer.prototype._renderPalette = function(tabCategory) { /* exact code */ };
Renderer.prototype._createPaletteItem = function(key, comp, idx) { /* exact code */ };

// _showPalettePreview, _hidePalettePreview (lines 2671-2747)
Renderer.prototype._showPalettePreview = function(comp) { /* exact code */ };
Renderer.prototype._hidePalettePreview = function() { /* exact code */ };

// System stats panel methods (lines 3393-3730)
Renderer.prototype._updateSystemStatsVisibility = function() { /* exact code */ };
Renderer.prototype._updateSystemStatsContent = function(category) { /* exact code */ };
Renderer.prototype._refreshSystemStatsValues = function() { /* exact code */ };
Renderer.prototype._sstat = function(label, value, unit, quality) { /* exact code */ };
Renderer.prototype._ssep = function() { /* exact code */ };
Renderer.prototype._detailRow = function(label, value, unit) { /* exact code */ };
Renderer.prototype._fmtPressure = function(p) { /* exact code */ };
Renderer.prototype._superscript = function(n) { /* exact code */ };
Renderer.prototype._qualityColor = function(q) { /* exact code */ };
Renderer.prototype._marginColor = function(m) { /* exact code */ };
Renderer.prototype._renderVacuumStats = function(d, summary, detail) { /* exact code */ };
Renderer.prototype._renderRfPowerStats = function(d, summary, detail) { /* exact code */ };
Renderer.prototype._renderCryoStats = function(d, summary, detail, append) { /* exact code */ };
Renderer.prototype._renderCoolingStats = function(d, summary, detail) { /* exact code */ };
Renderer.prototype._renderPowerStats = function(d, summary, detail) { /* exact code */ };
Renderer.prototype._renderDataControlsStats = function(d, summary, detail) { /* exact code */ };
Renderer.prototype._renderOpsStats = function(d, summary, detail) { /* exact code */ };

// _bindHUDEvents (lines 3270-3351)
Renderer.prototype._bindHUDEvents = function() { /* exact code */ };
```

- [ ] **Step 5: Create src/renderer/overlays.js**

Extract tech tree, goals overlay, component popup, and research popover:

```js
// src/renderer/overlays.js
import { Renderer } from './Renderer.js';
import { RESEARCH, RESEARCH_CATEGORIES } from '../data/research.js';
import { COMPONENTS } from '../data/components.js';
import { OBJECTIVES } from '../data/objectives.js';
import { formatEnergy, UNITS } from '../data/units.js';
import { PARAM_DEFS } from '../beamline/component-physics.js';

// Component popup methods: _paramLabel, _fmtParam, _wirePopupSliders, showPopup, hidePopup
// (lines 878-1438)
Renderer.prototype._paramLabel = function(key) { /* exact code */ };
Renderer.prototype._fmtParam = function(val) { /* exact code */ };
Renderer.prototype._wirePopupSliders = function(node, paramDefs, body) { /* exact code */ };
Renderer.prototype.showPopup = function(node) { /* exact code */ };
Renderer.prototype.hidePopup = function() { /* exact code */ };

// Tech tree methods (lines 2748-3183)
Renderer.prototype._buildTreeLayout = function() { /* exact code */ };
Renderer.prototype._renderTechTree = function() { /* exact code */ };
Renderer.prototype._showResearchPopover = function(id, nodeEl) { /* exact code */ };
Renderer.prototype._scrollToCategory = function(catId) { /* exact code */ };
Renderer.prototype._applyTreeTransform = function() { /* exact code */ };
Renderer.prototype._updateTreeProgress = function() { /* exact code */ };
Renderer.prototype._bindTreeEvents = function() { /* exact code */ };

// Goals overlay (lines 3236-3266)
Renderer.prototype._renderGoalsOverlay = function() { /* exact code */ };
```

- [ ] **Step 6: Verify renderer modules**

Run: `npx vite` — check browser console for import errors. The prototype extension pattern means all methods are available on the Renderer instance as before.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/
git commit -m "refactor: split renderer.js into 5 ES modules (core, beamline, infra, hud, overlays)"
```

---

### Task 6: Convert input.js to ES module

**Files:**
- Create: `src/input/InputHandler.js` (from `input.js`)

The input handler is 1096 lines but cohesive — it's all event binding and dispatch. We convert it to an ES module without splitting further.

- [ ] **Step 1: Create src/input/InputHandler.js**

```js
// src/input/InputHandler.js
import { COMPONENTS } from '../data/components.js';
import { INFRASTRUCTURE } from '../data/infrastructure.js';
import { MODES } from '../data/modes.js';
import { DIR } from '../data/directions.js';
import { isoToGrid } from '../renderer/grid.js';

export class InputHandler {
  // [entire existing InputHandler class, unchanged]
  // Replace global references:
  //   COMPONENTS -> imported
  //   INFRASTRUCTURE -> imported
  //   MODES -> imported
  //   DIR -> imported
  //   isoToGrid -> imported
}
```

- [ ] **Step 2: Commit**

```bash
git add src/input/
git commit -m "refactor: convert input.js to ES module"
```

---

### Task 7: Create src/main.js entry point and wire everything together

**Files:**
- Create: `src/main.js`
- Modify: `index.html` (switch from script tags to single module entry)

This is the critical integration step. We replace all `<script>` tags with a single module entry point that imports everything.

- [ ] **Step 1: Create src/main.js**

```js
// src/main.js — Beamline Tycoon entry point

import { Beamline } from './beamline/Beamline.js';
import { BeamPhysics } from './beamline/physics.js';
import { Game } from './game/Game.js';
import { SpriteManager } from './renderer/sprites.js';
import { Renderer } from './renderer/Renderer.js';
import { InputHandler } from './input/InputHandler.js';
import { ProbeWindow } from './ui/probe.js';
import { MODES } from './data/modes.js';

// Make data available globally for Pyodide bridge and any remaining global refs
import { COMPONENTS } from './data/components.js';
import { PARAM_DEFS } from './beamline/component-physics.js';
import { MACHINES } from './data/machines.js';
import { Networks } from './networks/networks.js';
window.COMPONENTS = COMPONENTS;
window.PARAM_DEFS = PARAM_DEFS;
window.MACHINES = MACHINES;
window.Networks = Networks;

// Clear old saves
localStorage.removeItem('beamlineCowboy');

(async function main() {
  const beamline = new Beamline();
  const game = new Game(beamline);
  const spriteManager = new SpriteManager();

  const renderer = new Renderer(game, spriteManager);
  await renderer.init();

  await spriteManager.loadTileSprites();
  renderer._renderInfrastructure();
  renderer._renderZones();

  const input = new InputHandler(renderer, game);
  renderer._onToolSelect = (compType) => input.selectTool(compType);
  renderer._onInfraSelect = (infraType) => input.selectInfraTool(infraType);
  renderer._onFacilitySelect = (compType) => input.selectFacilityTool(compType);
  renderer._onConnSelect = (connType) => input.selectConnTool(connType);
  renderer._onZoneSelect = (zoneType) => input.selectZoneTool(zoneType);
  renderer._onFurnishingSelect = (furnType) => input.selectFurnishingTool(furnType);
  renderer._onDemolishSelect = (demolishType) => input.selectDemolishTool(demolishType);
  renderer._onPaletteClick = (idx) => input._syncPaletteClick(idx);
  renderer._onTabSelect = (category) => { input.selectedCategory = category; input.paletteIndex = -1; input._hidePreview(); };

  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      if (MODES[mode]?.disabled) return;
      input.setActiveMode(mode);
    });
  });

  const probeWindow = new ProbeWindow(game);
  renderer.onProbeClick = (node) => probeWindow.addPin(node);

  const origSave = game.save.bind(game);
  game.save = function() {
    this.state.probe = probeWindow.toJSON();
    origSave();
  };

  game.on((event) => {
    if (event === 'beamlineChanged') {
      renderer._renderProbeFlags(probeWindow.pins);
    }
  });

  game.load();

  if (game.state.probe) {
    probeWindow.fromJSON(game.state.probe);
  }

  document.getElementById('btn-new-game').addEventListener('click', () => {
    if (confirm('Start a new game? All progress will be lost.')) {
      localStorage.removeItem('beamlineTycoon');
      location.reload();
    }
  });

  game.start();

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

- [ ] **Step 2: Update index.html**

Replace all `<script>` tags with the single module entry point. Keep the Pyodide and PixiJS CDN scripts (they set globals that our modules reference).

```html
  <!-- CDN dependencies (set globals) -->
  <script src="https://cdn.jsdelivr.net/pyodide/v0.27.4/full/pyodide.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/pixi.js@8/dist/pixi.min.js"></script>

  <!-- Module entry point -->
  <script type="module" src="/src/main.js"></script>
```

Remove all the old script tags:
```html
  <!-- DELETE these lines: -->
  <script src="data.js"></script>
  <script src="component-physics.js"></script>
  <script src="physics.js"></script>
  <script src="beamline.js"></script>
  <script src="networks.js"></script>
  <script src="game.js"></script>
  <script src="sprites.js"></script>
  <script src="input.js"></script>
  <script src="renderer.js"></script>
  <script src="probe-plots.js"></script>
  <script src="probe.js"></script>
  <script src="main.js"></script>
```

- [ ] **Step 3: Test the full game through modules**

Run: `npx vite`

Verify in browser:
1. Game loads without console errors
2. Grid renders
3. Can place a source component
4. Can place additional beamline components
5. Can toggle beam on/off
6. Physics engine loads (check for "Beam physics engine loaded" log)
7. Can open research overlay (R key)
8. Can open goals overlay (G key)
9. Infrastructure mode works (place concrete, zones)
10. Facility mode works (place equipment)
11. Connection drawing works
12. Probe mode works (P key)

- [ ] **Step 4: Fix any import resolution issues**

Likely issues:
- Circular imports between renderer modules (prototype extension pattern avoids this)
- Missing global references (check console for `X is not defined` errors)
- PIXI global reference — PixiJS CDN sets `window.PIXI`, modules can access it directly
- `loadPyodide` global — same, CDN sets it

For any `X is not defined` errors, add the missing import to the relevant module.

- [ ] **Step 5: Commit**

```bash
git add src/main.js index.html
git commit -m "feat: switch to ES module entry point, remove old script tags"
```

---

### Task 8: Clean up old files and update tests

**Files:**
- Delete: `data.js`, `game.js`, `renderer.js`, `input.js`, `beamline.js`, `physics.js`, `component-physics.js`, `networks.js`, `sprites.js`, `probe.js`, `probe-plots.js`, `main.js`
- Modify: `test/test-beamline.js`
- Modify: `test/test-component-physics.js`
- Modify: `test/test-networks.js`
- Modify: `test/test-machines.js`

- [ ] **Step 1: Verify no code references old files**

Run: `grep -r 'src="data.js\|src="game.js\|src="renderer.js\|src="input.js\|src="beamline.js\|src="physics.js\|src="component-physics.js\|src="networks.js\|src="sprites.js\|src="probe.js\|src="probe-plots.js\|src="main.js"' index.html`

Expected: no matches (all old script tags removed in Task 7).

- [ ] **Step 2: Delete old root-level JS files**

```bash
git rm data.js game.js renderer.js input.js beamline.js physics.js component-physics.js networks.js sprites.js probe.js probe-plots.js main.js
```

- [ ] **Step 3: Update test files to use ES imports**

The tests currently use `require()` (Node.js CommonJS). Update them to either:
- Use dynamic `import()` with a test runner that supports ESM, or
- Add a simple Vite-based test setup

For the simplest path, update test files to use ES imports and run them with `node --experimental-vm-modules`:

```js
// test/test-beamline.js
import { Beamline } from '../src/beamline/Beamline.js';
import { COMPONENTS } from '../src/data/components.js';
import { DIR } from '../src/data/directions.js';
import { PARAM_DEFS } from '../src/beamline/component-physics.js';

// Make globals available for Beamline (it references COMPONENTS internally)
globalThis.COMPONENTS = COMPONENTS;
globalThis.PARAM_DEFS = PARAM_DEFS;

// [rest of test unchanged]
```

Similarly update `test-component-physics.js`, `test-networks.js`, `test-machines.js`.

- [ ] **Step 4: Run tests**

```bash
node --experimental-vm-modules test/test-beamline.js
node --experimental-vm-modules test/test-component-physics.js
node --experimental-vm-modules test/test-networks.js
```

Expected: all tests pass.

- [ ] **Step 5: Update server.py or remove it**

The Python dev server is no longer needed for serving the game (Vite does that). But it's still useful for the tile-save API. Update `vite.config.js` to proxy the API endpoint:

```js
// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    port: 8000,
    proxy: {
      '/api': 'http://localhost:8001',
    },
  },
  build: {
    outDir: 'dist',
  },
});
```

Update `server.py` to run on port 8001 for the tile API only. Or keep it as-is for when you need the asset dashboard.

- [ ] **Step 6: Add .gitignore entries**

```
node_modules/
dist/
```

- [ ] **Step 7: Final smoke test**

Run: `npx vite`

Full test checklist:
1. Game loads, grid renders
2. Place source → place components → start beam
3. Physics engine loads
4. Research overlay works
5. Goals overlay works
6. Infrastructure + zones work
7. Facility equipment works
8. Connection drawing works
9. Probe mode works
10. Save/load works (new game, place stuff, refresh — state persists)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: remove old root-level JS files, update tests to ES modules, add Vite proxy config"
```

---

### Task 9: Production build verification

**Files:**
- Modify: `vite.config.js` (if needed for build)

- [ ] **Step 1: Run production build**

```bash
npm run build
```

Expected: Vite bundles everything into `dist/` with hashed filenames. Check for build errors.

- [ ] **Step 2: Preview production build**

```bash
npm run preview
```

Open in browser, run the same smoke test checklist from Task 8 Step 7.

- [ ] **Step 3: Fix any build issues**

Common issues:
- Pyodide CDN script needs to be kept as external (it's in index.html, not imported)
- PixiJS CDN script same
- Public assets (beam_physics Python files) need to be in `public/`
- CSS needs to be imported or kept as `<link>` in index.html

- [ ] **Step 4: Commit any build fixes**

```bash
git add -A
git commit -m "build: verify and fix production build"
```

---

## Summary

| Task | What | Risk |
|------|------|------|
| 1 | Scaffold Vite | Low — additive, no code changes |
| 2 | Split data.js | Low — pure constants, easy to verify |
| 3 | Convert leaf modules | Low — small files, clear dependencies |
| 4 | Split game.js | Medium — extracting methods, need careful testing |
| 5 | Split renderer.js | Medium — largest file, prototype extension pattern |
| 6 | Convert input.js | Low — single file conversion |
| 7 | Wire entry point | High — the integration moment, most likely to surface bugs |
| 8 | Clean up old files | Low — just deletion after verification |
| 9 | Production build | Low — Vite handles it, just verify |
