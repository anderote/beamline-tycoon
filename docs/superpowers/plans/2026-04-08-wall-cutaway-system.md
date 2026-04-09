# Wall Cutaway System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Sims-style wall visibility modes (up, cutaway, transparent, down) with a UI control in the lower-right of the game view.

**Architecture:** Wall graphics get stored in a registry keyed by `"col,row,edge"` so individual walls can be toggled. A room-detection flood-fill runs on hover in cutaway mode. A 4-button UI widget above the bottom HUD controls the active mode.

**Tech Stack:** PIXI.js (CDN global), vanilla JS prototype extensions on Renderer, plain HTML/CSS for UI.

---

### Task 1: Add wall graphics registry to _renderWalls

**Files:**
- Modify: `src/renderer/Renderer.js:84` (add `wallGraphics` and `wallVisibilityMode` to constructor)
- Modify: `src/renderer/infrastructure-renderer.js:89-180` (update `_renderWalls` and `_drawWallEdge`)

- [ ] **Step 1: Add state properties to Renderer constructor**

In `src/renderer/Renderer.js`, add these properties inside the constructor after `this.wallLayer = null;` (line 84):

```js
this.wallGraphics = {};        // keyed by "col,row,edge" -> PIXI.Graphics
this.wallVisibilityMode = 'up'; // 'up' | 'cutaway' | 'transparent' | 'down'
this._cutawayRoom = null;       // Set of "col,row" strings for current room
this._cutawayHoverKey = null;   // "col,row" of last hover that triggered room detection
```

- [ ] **Step 2: Update _renderWalls to populate the registry**

In `src/renderer/infrastructure-renderer.js`, replace `_renderWalls` (lines 89-98):

```js
Renderer.prototype._renderWalls = function() {
  this.wallLayer.removeChildren();
  this.wallGraphics = {};
  const walls = this.game.state.walls || [];
  const sorted = [...walls].sort((a, b) => (a.col + a.row) - (b.col + b.row));
  for (const wall of sorted) {
    const wt = WALL_TYPES[wall.type];
    if (!wt) continue;
    this._drawWallEdge(wall.col, wall.row, wall.edge, wt);
  }
  this._applyWallVisibility();
};
```

- [ ] **Step 3: Update _drawWallEdge to store graphic in registry**

In `src/renderer/infrastructure-renderer.js`, at the end of `_drawWallEdge` (before the closing `}`), replace the last two lines (`g.zIndex = isoDepth; this.wallLayer.addChild(g);`) with:

```js
  g.zIndex = isoDepth;
  this.wallLayer.addChild(g);
  this.wallGraphics[`${col},${row},${edge}`] = g;
```

- [ ] **Step 4: Verify walls still render normally**

Run the game in the browser, place some walls, confirm they render exactly as before with no visual changes.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/Renderer.js src/renderer/infrastructure-renderer.js
git commit -m "feat: add wall graphics registry for visibility mode support"
```

---

### Task 2: Implement room detection flood-fill

**Files:**
- Modify: `src/renderer/infrastructure-renderer.js` (add `_detectRoom` method)

- [ ] **Step 1: Add _detectRoom method**

Add this method to `src/renderer/infrastructure-renderer.js`, after the `_darkenWallColor` method:

```js
Renderer.prototype._detectRoom = function(startCol, startRow) {
  const wallOcc = this.game.state.wallOccupied || {};
  const room = new Set();
  const queue = [`${startCol},${startRow}`];
  room.add(queue[0]);
  const MAX_TILES = 500;

  while (queue.length > 0 && room.size < MAX_TILES) {
    const key = queue.shift();
    const [c, r] = key.split(',').map(Number);

    // East: blocked by wall at (c, r, 'e')
    const eKey = `${c + 1},${r}`;
    if (!room.has(eKey) && !wallOcc[`${c},${r},e`]) {
      room.add(eKey);
      queue.push(eKey);
    }

    // West: blocked by wall at (c-1, r, 'e')
    const wKey = `${c - 1},${r}`;
    if (!room.has(wKey) && !wallOcc[`${c - 1},${r},e`]) {
      room.add(wKey);
      queue.push(wKey);
    }

    // South: blocked by wall at (c, r, 's')
    const sKey = `${c},${r + 1}`;
    if (!room.has(sKey) && !wallOcc[`${c},${r},s`]) {
      room.add(sKey);
      queue.push(sKey);
    }

    // North: blocked by wall at (c, r-1, 's')
    const nKey = `${c},${r - 1}`;
    if (!room.has(nKey) && !wallOcc[`${c},${r - 1},s`]) {
      room.add(nKey);
      queue.push(nKey);
    }
  }

  return room;
};
```

- [ ] **Step 2: Test room detection manually**

Open the browser console. Place walls forming a small enclosed room (e.g., a 3x3 box). Then run:

```js
const r = window._renderer;
const room = r._detectRoom(1, 1);
console.log('Room tiles:', room.size, [...room]);
```

Verify the room set contains the enclosed tiles and stops at walls. Verify that hovering outside the room produces a much larger set (up to 500 cap).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/infrastructure-renderer.js
git commit -m "feat: add room detection flood-fill for wall cutaway"
```

---

### Task 3: Implement _applyWallVisibility

**Files:**
- Modify: `src/renderer/infrastructure-renderer.js` (add `_applyWallVisibility` method)

- [ ] **Step 1: Add _applyWallVisibility method**

Add this after `_detectRoom` in `src/renderer/infrastructure-renderer.js`:

```js
Renderer.prototype._applyWallVisibility = function() {
  const mode = this.wallVisibilityMode;

  if (mode === 'down') {
    this.wallLayer.visible = false;
    return;
  }

  this.wallLayer.visible = true;

  if (mode === 'up') {
    for (const key in this.wallGraphics) {
      const g = this.wallGraphics[key];
      g.visible = true;
      g.alpha = 1.0;
    }
    return;
  }

  if (mode === 'transparent') {
    for (const key in this.wallGraphics) {
      const g = this.wallGraphics[key];
      g.visible = true;
      // e and s edges are near-facing in iso view
      const edge = key.split(',')[2];
      g.alpha = (edge === 'e' || edge === 's') ? 0.25 : 1.0;
    }
    return;
  }

  if (mode === 'cutaway') {
    const hoverKey = `${this.hoverCol},${this.hoverRow}`;
    if (hoverKey !== this._cutawayHoverKey) {
      this._cutawayHoverKey = hoverKey;
      this._cutawayRoom = this._detectRoom(this.hoverCol, this.hoverRow);
    }
    const room = this._cutawayRoom;
    if (!room) {
      // No room detected, show all
      for (const key in this.wallGraphics) {
        this.wallGraphics[key].visible = true;
        this.wallGraphics[key].alpha = 1.0;
      }
      return;
    }

    const walls = this.game.state.walls || [];
    for (const wall of walls) {
      const wKey = `${wall.col},${wall.row},${wall.edge}`;
      const g = this.wallGraphics[wKey];
      if (!g) continue;

      // A wall borders the room if either of its neighboring tiles is in the room
      let bordersRoom = false;
      if (wall.edge === 'e') {
        bordersRoom = room.has(`${wall.col},${wall.row}`) || room.has(`${wall.col + 1},${wall.row}`);
      } else {
        bordersRoom = room.has(`${wall.col},${wall.row}`) || room.has(`${wall.col},${wall.row + 1}`);
      }

      g.visible = !bordersRoom;
      g.alpha = 1.0;
    }
    return;
  }
};
```

- [ ] **Step 2: Test by manually setting mode in console**

Open the browser console with some walls placed:

```js
const r = window._renderer;
r.wallVisibilityMode = 'transparent';
r._applyWallVisibility();
// Walls should go ghostly

r.wallVisibilityMode = 'down';
r._applyWallVisibility();
// Walls should disappear

r.wallVisibilityMode = 'up';
r._applyWallVisibility();
// Walls should return to normal
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/infrastructure-renderer.js
git commit -m "feat: add wall visibility mode application logic"
```

---

### Task 4: Hook cutaway mode into hover updates

**Files:**
- Modify: `src/renderer/Renderer.js:343-349` (update `updateHover`)

- [ ] **Step 1: Update updateHover to trigger wall visibility in cutaway mode**

In `src/renderer/Renderer.js`, replace the `updateHover` method:

```js
  updateHover(col, row) {
    this.hoverCol = col;
    this.hoverRow = row;
    if (this.bulldozerMode || this.buildMode) {
      this._renderCursors();
    }
    if (this.wallVisibilityMode === 'cutaway') {
      this._applyWallVisibility();
    }
  }
```

- [ ] **Step 2: Test cutaway mode interactively**

In browser console:
```js
window._renderer.wallVisibilityMode = 'cutaway';
```

Then hover over tiles inside a walled room — walls around that room should hide. Hover outside — they should reappear.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/Renderer.js
git commit -m "feat: trigger wall cutaway on hover updates"
```

---

### Task 5: Add wall visibility UI control

**Files:**
- Modify: `index.html` (add `#wall-visibility-control` div)
- Modify: `style.css` (add styles)
- Modify: `src/renderer/hud.js` (bind button events)

- [ ] **Step 1: Add HTML for the wall visibility control**

In `index.html`, add this just before the `<!-- Bottom HUD (DOM overlay) -->` comment (before line 97):

```html
    <!-- Wall visibility control (lower-right, above bottom HUD) -->
    <div id="wall-visibility-control">
      <button class="wall-vis-btn active" data-wall-mode="up" title="Walls Up">
        <svg width="16" height="16" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" fill="currentColor" opacity="0.8"/></svg>
      </button>
      <button class="wall-vis-btn" data-wall-mode="cutaway" title="Cutaway">
        <svg width="16" height="16" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" fill="currentColor" opacity="0.8"/><rect x="6" y="6" width="8" height="8" fill="#1a1a2e"/></svg>
      </button>
      <button class="wall-vis-btn" data-wall-mode="transparent" title="Walls Transparent">
        <svg width="16" height="16" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 2" opacity="0.6"/></svg>
      </button>
      <button class="wall-vis-btn" data-wall-mode="down" title="Walls Down">
        <svg width="16" height="16" viewBox="0 0 16 16"><line x1="3" y1="13" x2="13" y2="3" stroke="currentColor" stroke-width="1.5" opacity="0.5"/></svg>
      </button>
    </div>
```

- [ ] **Step 2: Add CSS styles**

In `style.css`, add these styles just before the `/* === BOTTOM HUD === */` comment:

```css
/* === WALL VISIBILITY CONTROL === */
#wall-visibility-control {
  position: absolute;
  bottom: 90px;
  right: 12px;
  z-index: 101;
  display: flex;
  gap: 2px;
  background: rgba(20, 20, 40, 0.85);
  border: 1px solid rgba(100, 100, 160, 0.3);
  border-radius: 4px;
  padding: 3px;
}

.wall-vis-btn {
  width: 24px;
  height: 24px;
  background: rgba(40, 40, 70, 0.8);
  border: 1px solid rgba(80, 80, 120, 0.4);
  border-radius: 3px;
  color: #8888aa;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: background 0.15s, border-color 0.15s;
}

.wall-vis-btn:hover {
  background: rgba(60, 60, 100, 0.8);
  border-color: rgba(120, 120, 180, 0.6);
  color: #aaaacc;
}

.wall-vis-btn.active {
  background: rgba(80, 80, 140, 0.6);
  border-color: rgba(140, 140, 200, 0.7);
  color: #ccccee;
}
```

- [ ] **Step 3: Bind button click events in hud.js**

In `src/renderer/hud.js`, add this at the end of `_bindHUDEvents` (just before the closing `};` on line 1191):

```js
  // Wall visibility mode buttons
  document.querySelectorAll('.wall-vis-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.wall-vis-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      this.wallVisibilityMode = btn.dataset.wallMode;
      this._cutawayHoverKey = null; // force room re-detection
      this._applyWallVisibility();
    });
  });
```

- [ ] **Step 4: Test the UI**

Open the game. Verify:
1. Four small buttons visible in the lower-right, just above the bottom HUD
2. Clicking each button highlights it and switches wall visibility mode
3. "Walls Up" shows all walls normally
4. "Cutaway" hides walls around the room you're hovering in
5. "Transparent" makes near-facing walls ghostly (~25% opacity)
6. "Walls Down" hides all walls

- [ ] **Step 5: Commit**

```bash
git add index.html style.css src/renderer/hud.js
git commit -m "feat: add wall visibility UI control with 4 modes"
```

---

### Task 6: Hide wall visibility control outside game view

**Files:**
- Modify: `src/renderer/hud.js` (toggle visibility on view change)

- [ ] **Step 1: Add visibility toggling based on view**

In `src/renderer/hud.js`, find where the view/mode changes are handled. Add a helper that shows/hides the control. Add this right after the wall visibility button binding code from Task 5:

```js
  // Hide wall visibility control when not in game view
  const wallVisControl = document.getElementById('wall-visibility-control');
  if (wallVisControl && this.game.viewRouter) {
    this.game.viewRouter.on((view) => {
      wallVisControl.classList.toggle('hidden', view !== 'game');
    });
  }
```

- [ ] **Step 2: Test**

Open the game, verify the wall visibility control is visible. Navigate to the Beamline Designer — the control should hide. Navigate back to game view — it should reappear.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/hud.js
git commit -m "feat: hide wall visibility control outside game view"
```

---

### Task 7: Expose renderer globally for debugging

**Files:**
- Modify: `src/main.js` (expose renderer on window)

- [ ] **Step 1: Check if renderer is already exposed**

Search `src/main.js` for `window._renderer` or similar. If it already exists, skip this task.

- [ ] **Step 2: If not exposed, add it**

After the renderer is constructed in `src/main.js`, add:

```js
window._renderer = renderer;
```

This enables the console-based testing described in earlier tasks.

- [ ] **Step 3: Commit (if changes were needed)**

```bash
git add src/main.js
git commit -m "chore: expose renderer on window for debugging"
```
