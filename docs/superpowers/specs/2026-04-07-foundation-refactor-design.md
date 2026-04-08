# Foundation Refactor — Design Spec

**Date:** 2026-04-07
**Phase:** 1 of 3 (Foundation → Backend → Graphics & Gameplay)
**Goal:** Modernize the codebase so it can scale to a web-hosted game with more complexity.

## Decisions

- **Build tool:** Vite + ES modules (no framework)
- **State management:** Lightweight custom reactive store (no library)
- **Monolith strategy:** Split by responsibility, mechanical extraction (move code, don't rewrite)
- **Pyodide/Python physics:** Untouched this phase, migrate server-side in Phase 2
- **Save format:** Break backwards compatibility, fresh start
- **Vanilla JS:** No framework, keep class-based architecture

## Directory Structure

```
package.json
vite.config.js
index.html              (updated: single <script type="module"> entry)
src/
  main.js               — entry point
  store.js              — central reactive state store
  game/
    Game.js             — core game loop, tick, save/load
    economy.js          — resource management, spending, income
    research.js         — tech tree logic, unlock checks
    objectives.js       — goals, discovery tracking
  beamline/
    Beamline.js         — beamline model
    physics.js          — JS-side physics bridge + Pyodide loader
    component-physics.js
  renderer/
    Renderer.js         — PixiJS app init, world/camera, layers, render loop
    grid.js             — isometric grid drawing, coordinate math
    beamline.js         — beamline component sprites, beam animation
    infrastructure.js   — infra tiles, zones, facility equipment rendering
    hud.js              — DOM overlay updates (top bar, bottom HUD, palette)
    overlays.js         — research overlay, goals overlay, component popup
    sprites.js          — SpriteManager
  input/
    InputHandler.js     — mouse/keyboard binding, mode switching
    tools.js            — tool selection, placement logic
  networks/
    networks.js         — pipe/cable network logic
  ui/
    probe.js            — probe window
    probe-plots.js      — probe chart rendering
  data/
    components.js       — COMPONENTS definitions
    research.js         — RESEARCH_TREE data
    modes.js            — MODES, CATEGORIES
    units.js            — UNITS, formatEnergy(), formatters
beam_physics/           — UNCHANGED (Pyodide Python physics)
assets/                 — UNCHANGED
```

## State Management

Custom reactive store replacing `game.state`:

```js
function createStore(initialState) {
  let state = initialState;
  const listeners = new Map(); // slice key -> Set of callbacks

  return {
    get: (key) => state[key],
    set: (key, value) => {
      state[key] = value;
      listeners.get(key)?.forEach(fn => fn(value));
    },
    subscribe: (key, fn) => {
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(fn);
      return () => listeners.get(key).delete(fn);
    },
    getState: () => state,
  };
}
```

### State Slices

| Slice | Contents |
|-------|----------|
| `resources` | funding, reputation, data |
| `beam` | beamOn, beamEnergy, beamCurrent, quality, physics results |
| `beamline` | ordered components, totalLength, totalEnergyCost |
| `research` | completedResearch, activeResearch, researchProgress |
| `facility` | infrastructure, zones, facilityEquipment, connections, furnishings |
| `machines` | machine instances, machineGrid |
| `staff` | staff counts, staff costs |
| `objectives` | completedObjectives, discoveries, totalDataCollected |
| `ui` | activeMode, selectedTool, probeMode, log messages |

### Data Flow

- `Game` owns the store, mutates state during ticks
- `Renderer` and HUD subscribe to slices they care about
- `InputHandler` dispatches actions through `Game` methods (no direct mutation)
- Save/load serializes full store to localStorage

## Monolith Breakup

### renderer.js (3700 lines) -> 6 modules

- **Renderer.js** (~300 lines) — PixiJS app init, camera/zoom, layer creation, resize, main render loop
- **grid.js** (~400 lines) — `_renderGrid()`, `_renderCursor()`, isometric coordinate math
- **beamline.js** (~600 lines) — `_renderBeamlineComponents()`, `_renderBeam()`, beam animation, node sprites
- **infrastructure.js** (~600 lines) — `_renderInfrastructure()`, `_renderZones()`, `_renderFacility()`, `_renderConnections()`
- **hud.js** (~1200 lines) — all DOM manipulation: top bar, bottom palette, component preview
- **overlays.js** — research tree rendering, goals list, component detail popup (split from hud if needed)

### data.js (3700 lines) -> 4 modules

- **components.js** — `COMPONENTS` object
- **research.js** — `RESEARCH_TREE` and related constants
- **modes.js** — `MODES`, `CATEGORIES`, tab definitions
- **units.js** — `UNITS`, `formatEnergy()`, formatters

### game.js (2000 lines) -> 4 modules

- **Game.js** (~500 lines) — constructor, game loop, save/load, event wiring
- **economy.js** (~400 lines) — `canAfford()`, `spend()`, income/expenses, staff costs
- **research.js** (~400 lines) — research tick, unlock checks, tech tree progression
- **objectives.js** (~400 lines) — goal checking, discovery rolls, completion

### Files that move intact (already right-sized)

- `beamline.js` (296 lines) -> `src/beamline/Beamline.js`
- `networks.js` (768 lines) -> `src/networks/networks.js`
- `sprites.js` (207 lines) -> `src/renderer/sprites.js`
- `probe.js` / `probe-plots.js` -> `src/ui/`
- `component-physics.js` -> `src/beamline/component-physics.js`
- `physics.js` -> `src/beamline/physics.js`
- `input.js` -> `src/input/InputHandler.js` (split tools.js out later)

## Migration Order

Each step results in a working game. Committed separately for easy rollback.

1. **Scaffold Vite** — `package.json`, `vite.config.js`, update `index.html` to use module entry. Game loads through Vite with zero code changes.
2. **Convert to ES modules** — Add `export`/`import` file by file, leaves first (data, utils), then inward.
3. **Split `data.js`** — Extract constants into `src/data/` modules. Easiest monolith.
4. **Introduce the store** — Create `store.js`, wire `Game` to use it. Renderer subscribes. Riskiest step.
5. **Split `game.js`** — Extract economy, research, objectives as modules operating on the store.
6. **Split `renderer.js`** — Extract sub-modules one at a time.
7. **Split `input.js`** — Extract tool/placement logic.
8. **Clean up** — Remove old `<script>` tags, dead code, old save format.

## Testing

No full automated test suite exists. Verification after each step:
- Game loads without console errors
- Can place components and start beam
- Physics engine initializes
- Save/load cycle works (new format)
- Research and goals overlays function

## Out of Scope (Phase 2+)

- Backend (Supabase auth, cloud saves, leaderboards)
- Vercel deployment
- Physics migration to server-side Python
- Graphics improvements, animations, new gameplay
