# Tutorial Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent "Getting Started" checklist overlay that guides players through building their first ~5 MeV beamline with full infrastructure and data acquisition.

**Architecture:** Tutorial steps defined as data in a new `src/data/tutorial.js`. Conditions evaluated each tick against game state and network data. UI rendered as a DOM overlay in `hud.js`, positioned below the beam-stats-panel. State flag `tutorialDismissed` persisted in game state.

**Tech Stack:** Vanilla JS, DOM manipulation (matches existing HUD pattern), CSS in `style.css`.

---

## File Structure

| File | Role |
|------|------|
| `src/data/tutorial.js` | **New.** Tutorial step definitions, group definitions, and condition functions. |
| `src/game/Game.js` | Add `tutorialDismissed` to initial state and save/load serialization. |
| `src/renderer/hud.js` | Render tutorial panel, evaluate conditions each tick, manage expand/collapse/dismiss. |
| `style.css` | Tutorial panel styles. |
| `index.html` | Add tutorial panel container div. |

---

### Task 1: Tutorial Step Data

**Files:**
- Create: `src/data/tutorial.js`

- [ ] **Step 1: Create `src/data/tutorial.js` with step and group definitions**

```js
// src/data/tutorial.js — Tutorial checklist step definitions

import { COMPONENTS } from './components.js';

export const TUTORIAL_GROUPS = [
  { id: 'beamline', name: 'Beamline' },
  { id: 'infrastructure', name: 'Infrastructure' },
  { id: 'commission', name: 'Commission' },
];

export const TUTORIAL_STEPS = [
  // === Beamline ===
  {
    id: 'tut-source',
    name: 'Place an Ion Source',
    hint: 'Select Beamline \u2192 Sources and place a Source in the tunnel.',
    group: 'beamline',
    condition: (state) =>
      state.placeables.some(p => p.category === 'beamline' && COMPONENTS[p.type]?.isSource),
  },
  {
    id: 'tut-drift',
    name: 'Extend the Beam Pipe',
    hint: 'Connect beam pipe between components \u2014 the pipe path should total at least 10 m.',
    group: 'beamline',
    condition: (state) => {
      const totalSubL = (state.beamPipes || []).reduce((sum, bp) => sum + (bp.subL || 0), 0);
      return totalSubL >= 40; // 40 subtiles = 10 m (each subtile = 0.25 m)
    },
  },
  {
    id: 'tut-buncher',
    name: 'Add a Buncher',
    hint: 'Place a Buncher after the source to compress the beam into bunches.',
    group: 'beamline',
    condition: (state) =>
      state.placeables.some(p => p.category === 'beamline' && p.type === 'buncher'),
  },
  {
    id: 'tut-cavities',
    name: 'Install RF Cavities',
    hint: 'Place Pillbox Cavities to accelerate the beam. You need ~10 to reach 5 MeV.',
    group: 'beamline',
    condition: (state) => {
      const count = state.placeables.filter(
        p => p.category === 'beamline' && p.type === 'pillboxCavity'
      ).length;
      return count >= 10;
    },
  },
  {
    id: 'tut-quads',
    name: 'Focus with Quadrupoles',
    hint: 'Place at least 2 Quadrupole magnets to keep the beam focused.',
    group: 'beamline',
    condition: (state) =>
      state.placeables.filter(
        p => p.category === 'beamline' && p.type === 'quadrupole'
      ).length >= 2,
  },
  {
    id: 'tut-faraday',
    name: 'Place a Faraday Cup',
    hint: 'End your beamline with a Faraday Cup to measure the beam current.',
    group: 'beamline',
    condition: (state) =>
      state.placeables.some(p => p.category === 'beamline' && p.type === 'faradayCup'),
  },

  // === Infrastructure ===
  {
    id: 'tut-power',
    name: 'Connect Power',
    hint: 'Place a Transformer, Switchgear, and Power Panels. Run Power Cable to beamline components.',
    group: 'infrastructure',
    condition: (state, nets) => {
      if (!nets?.powerCable) return false;
      return nets.powerCable.some(
        net => net.equipment.length > 0 && net.beamlineNodes.length > 0
      );
    },
  },
  {
    id: 'tut-vacuum',
    name: 'Connect Vacuum',
    hint: 'Place a Roughing Pump and Turbo Pumps. Run Vacuum Pipe to the beamline.',
    group: 'infrastructure',
    condition: (state, nets) => {
      if (!nets?.vacuumPipe) return false;
      return nets.vacuumPipe.some(
        net => net.equipment.length > 0 && net.beamlineNodes.length > 0
      );
    },
  },
  {
    id: 'tut-rf',
    name: 'Connect RF Power',
    hint: 'Place a Magnetron or Solid-State Amp. Run RF Waveguide to your cavities.',
    group: 'infrastructure',
    condition: (state, nets) => {
      if (!nets?.rfWaveguide) return false;
      return nets.rfWaveguide.some(
        net => net.equipment.length > 0 && net.beamlineNodes.length > 0
      );
    },
  },
  {
    id: 'tut-cooling',
    name: 'Connect Cooling Water',
    hint: 'Place a Chiller and run Cooling Water lines to your Quadrupoles.',
    group: 'infrastructure',
    condition: (state, nets) => {
      if (!nets?.coolingWater) return false;
      return nets.coolingWater.some(
        net => net.equipment.length > 0 && net.beamlineNodes.length > 0
      );
    },
  },
  {
    id: 'tut-data',
    name: 'Connect Data Fiber',
    hint: 'Run Data Fiber from the Faraday Cup through a Patch Panel to a Rack/IOC.',
    group: 'infrastructure',
    condition: (state, nets) => {
      if (!nets?.dataFiber) return false;
      return nets.dataFiber.some(
        net => net.equipment.length > 0 && net.beamlineNodes.length > 0
      );
    },
  },

  // === Commission ===
  {
    id: 'tut-beam',
    name: 'First Measurement',
    hint: 'Your beam should now be running. The Faraday Cup will collect data automatically.',
    group: 'commission',
    condition: (state) => (state.totalDataCollected || 0) > 0 || state.resources.data > 0,
  },
  {
    id: 'tut-control',
    name: 'Build a Control Room',
    hint: 'Paint a Control Room zone and place an operator console or Rack/IOC inside it.',
    group: 'commission',
    condition: (state) => {
      const hasControlZone = (state.zones || []).some(z => z.type === 'controlRoom');
      if (!hasControlZone) return false;
      // Check for any equipment placed within a control room zone tile
      const zoneOcc = state.zoneOccupied || {};
      return state.placeables.some(p => {
        if (p.category !== 'equipment') return false;
        const tiles = p.tiles || [{ col: p.col, row: p.row }];
        return tiles.some(t => zoneOcc[t.col + ',' + t.row] === 'controlRoom');
      });
    },
  },
];
```

- [ ] **Step 2: Verify the module loads without errors**

Run: `npx vite build --mode development 2>&1 | tail -5`
Expected: Build succeeds (the module is not yet imported anywhere, but syntax should be valid).

---

### Task 2: Game State Integration

**Files:**
- Modify: `src/game/Game.js`

- [ ] **Step 1: Add `tutorialDismissed` to initial state**

In `Game.js`, inside the `this.state = { ... }` block (around line 97, after `designerState: null`), add:

```js
      // Tutorial
      tutorialDismissed: false,
```

- [ ] **Step 2: Verify the save/load round-trips the new field**

The existing save/load in `Game.js` serializes the entire `state` object, so `tutorialDismissed` will be persisted automatically. No additional changes needed. Verify by searching for the save method:

Run: `grep -n 'JSON.stringify\|localStorage.setItem.*beamlineTycoon' src/game/Game.js | head -5`
Expected: Shows the save path that serializes `this.state`.

---

### Task 3: HTML Container

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add the tutorial panel container after `beam-stats-panel`**

In `index.html`, after the closing `</div>` of `#beam-stats-panel` (line 87) and before the beamline-warnings div, insert:

```html
    <!-- Tutorial checklist (top-left, below beam stats) -->
    <div id="tutorial-panel" class="hidden">
      <div id="tutorial-header">
        <span id="tutorial-title">Getting Started</span>
        <span id="tutorial-progress-text"></span>
        <button id="tutorial-dismiss" title="Dismiss">&times;</button>
      </div>
      <div id="tutorial-progress-bar"><div id="tutorial-progress-fill"></div></div>
      <div id="tutorial-body"></div>
    </div>
```

---

### Task 4: Tutorial Panel Styles

**Files:**
- Modify: `style.css`

- [ ] **Step 1: Add tutorial panel CSS at the end of `style.css`**

Append these styles. The panel sits below `#beam-stats-panel` (which is `top: 42px; left: 10px;`). We position it further down. The font and color scheme match the existing HUD.

```css
/* === TUTORIAL CHECKLIST === */
#tutorial-panel {
  position: absolute;
  top: 42px;
  right: 10px;
  z-index: 95;
  width: 280px;
  background: rgba(10, 10, 30, 0.85);
  border: 1px solid rgba(100, 100, 160, 0.3);
  border-radius: 6px;
  font-family: 'Press Start 2P', monospace;
  font-size: 8px;
  color: #ccc;
  pointer-events: auto;
  max-height: calc(100vh - 120px);
  overflow-y: auto;
}
#tutorial-panel.minimized #tutorial-body {
  display: none;
}
#tutorial-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  cursor: pointer;
  user-select: none;
}
#tutorial-title {
  color: #aaccff;
  flex: 1;
}
#tutorial-progress-text {
  color: #888;
  white-space: nowrap;
}
#tutorial-dismiss {
  background: none;
  border: none;
  color: #888;
  font-size: 12px;
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
}
#tutorial-dismiss:hover {
  color: #fff;
}
#tutorial-progress-bar {
  height: 3px;
  background: rgba(255, 255, 255, 0.1);
  margin: 0 8px 4px;
  border-radius: 2px;
  overflow: hidden;
}
#tutorial-progress-fill {
  height: 100%;
  background: #4a9;
  width: 0%;
  transition: width 0.3s ease;
}
#tutorial-body {
  padding: 0 8px 8px;
}
.tut-group {
  margin-bottom: 6px;
}
.tut-group-name {
  color: #89a;
  font-size: 7px;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 3px;
  padding: 2px 0;
  border-bottom: 1px solid rgba(100, 100, 160, 0.2);
}
.tut-step {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 3px 0;
  line-height: 1.5;
}
.tut-check {
  flex-shrink: 0;
  width: 10px;
  color: #555;
}
.tut-step.completed .tut-check {
  color: #4a9;
}
.tut-step.completed .tut-name {
  color: #666;
  text-decoration: line-through;
}
.tut-name {
  color: #ccc;
}
.tut-hint {
  display: block;
  color: #8ab;
  font-size: 7px;
  margin-top: 2px;
  line-height: 1.4;
}
.tut-step:not(.next) .tut-hint {
  display: none;
}
.tut-step.completed.flash .tut-check {
  animation: tut-flash 0.4s ease;
}
@keyframes tut-flash {
  0% { color: #fff; transform: scale(1.3); }
  100% { color: #4a9; transform: scale(1); }
}
#tutorial-panel.all-done #tutorial-title {
  color: #4a9;
}
```

---

### Task 5: HUD Rendering Logic

**Files:**
- Modify: `src/renderer/hud.js`

This is the main task. We add tutorial rendering to the existing HUD update cycle.

- [ ] **Step 1: Import tutorial data at the top of `hud.js`**

At the top of `hud.js` (after the existing imports, around line 14), add:

```js
import { TUTORIAL_STEPS, TUTORIAL_GROUPS } from '../data/tutorial.js';
```

- [ ] **Step 2: Add the tutorial panel initialization and update functions**

After the existing `Renderer.prototype._updateHUD` function (which ends around line 173 with `this._refreshSystemStatsValues();`), add a new method. Find the exact end of `_updateHUD` and add after it:

```js
// === TUTORIAL CHECKLIST ===

Renderer.prototype._initTutorialPanel = function() {
  const panel = document.getElementById('tutorial-panel');
  if (!panel || this._tutorialInited) return;
  this._tutorialInited = true;
  this._tutorialMinimized = false;
  this._tutorialPrevCompleted = new Set();

  // Toggle minimize on header click
  const header = document.getElementById('tutorial-header');
  header.addEventListener('click', (e) => {
    if (e.target.id === 'tutorial-dismiss') return;
    this._tutorialMinimized = !this._tutorialMinimized;
    panel.classList.toggle('minimized', this._tutorialMinimized);
  });

  // Dismiss button
  document.getElementById('tutorial-dismiss').addEventListener('click', (e) => {
    e.stopPropagation();
    this.game.state.tutorialDismissed = true;
    panel.classList.add('hidden');
  });

  // Build the static group/step DOM structure
  const body = document.getElementById('tutorial-body');
  body.innerHTML = '';
  for (const group of TUTORIAL_GROUPS) {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'tut-group';
    groupDiv.innerHTML = `<div class="tut-group-name">${group.name}</div>`;

    for (const step of TUTORIAL_STEPS.filter(s => s.group === group.id)) {
      const stepDiv = document.createElement('div');
      stepDiv.className = 'tut-step';
      stepDiv.id = `tut-${step.id}`;
      stepDiv.innerHTML =
        `<span class="tut-check">\u25cb</span>` +
        `<span class="tut-name">${step.name}<span class="tut-hint">${step.hint}</span></span>`;
      groupDiv.appendChild(stepDiv);
    }

    body.appendChild(groupDiv);
  }
};

Renderer.prototype._updateTutorialPanel = function() {
  const panel = document.getElementById('tutorial-panel');
  if (!panel) return;

  const state = this.game.state;
  if (state.tutorialDismissed) {
    panel.classList.add('hidden');
    return;
  }

  this._initTutorialPanel();
  panel.classList.remove('hidden');

  const nets = state.networkData;
  let completedCount = 0;
  let firstIncomplete = null;

  for (const step of TUTORIAL_STEPS) {
    const el = document.getElementById(`tut-${step.id}`);
    if (!el) continue;

    let done = false;
    try { done = step.condition(state, nets); } catch (_) {}

    const check = el.querySelector('.tut-check');
    if (done) {
      completedCount++;
      if (!el.classList.contains('completed')) {
        el.classList.add('completed');
        check.textContent = '\u2713';
        // Flash animation for newly completed
        if (this._tutorialPrevCompleted && !this._tutorialPrevCompleted.has(step.id)) {
          el.classList.add('flash');
          setTimeout(() => el.classList.remove('flash'), 500);
        }
      }
      el.classList.remove('next');
    } else {
      el.classList.remove('completed');
      check.textContent = '\u25cb';
      if (!firstIncomplete) {
        firstIncomplete = step;
        el.classList.add('next');
      } else {
        el.classList.remove('next');
      }
    }
  }

  // Track what was completed for flash detection
  this._tutorialPrevCompleted = new Set(
    TUTORIAL_STEPS.filter((s) => {
      try { return s.condition(state, nets); } catch (_) { return false; }
    }).map(s => s.id)
  );

  // Update progress
  const total = TUTORIAL_STEPS.length;
  const pct = Math.round((completedCount / total) * 100);
  const progressText = document.getElementById('tutorial-progress-text');
  const progressFill = document.getElementById('tutorial-progress-fill');
  if (progressText) progressText.textContent = `${completedCount}/${total}`;
  if (progressFill) progressFill.style.width = `${pct}%`;

  // All done state
  if (completedCount === total) {
    panel.classList.add('all-done');
    const title = document.getElementById('tutorial-title');
    if (title) title.textContent = 'All Done!';
  } else {
    panel.classList.remove('all-done');
    const title = document.getElementById('tutorial-title');
    if (title) title.textContent = 'Getting Started';
  }
};
```

- [ ] **Step 3: Call `_updateTutorialPanel()` from `_updateHUD()`**

At the end of the `_updateHUD` method, just before the closing `};`, add:

```js
  this._updateTutorialPanel();
```

This goes right after the existing `this._refreshSystemStatsValues();` call.

---

### Task 6: Commit

- [ ] **Step 1: Commit all changes**

```bash
git add src/data/tutorial.js src/game/Game.js src/renderer/hud.js style.css index.html
git commit -m "feat: add tutorial checklist overlay for guided first beamline"
```

---

### Task 7: Manual Testing

- [ ] **Step 1: Start the dev server and verify the tutorial panel renders**

Run: `npx vite` (or however the dev server starts)

Verify in browser:
1. Tutorial panel visible top-right with "Getting Started" header, 0/13 progress
2. Three groups visible: Beamline, Infrastructure, Commission
3. First step "Place an Ion Source" shows its hint text
4. Clicking the header minimizes/expands the panel
5. Clicking the x dismisses the panel (persists on reload)
6. Clearing localStorage brings it back

- [ ] **Step 2: Test step completion**

1. Place a source — verify "Place an Ion Source" checks off with flash animation
2. Place some beam pipe — verify "Extend the Beam Pipe" checks off
3. Continue through a few more steps to validate conditions work
4. Check that progress bar fills and counter updates

- [ ] **Step 3: Fix any issues found during testing**

Address any rendering, positioning, or condition-checking bugs discovered.
