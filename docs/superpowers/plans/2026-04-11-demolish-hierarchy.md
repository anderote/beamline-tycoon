# Demolish Hierarchy & Unified Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify every delete/demolish code path through a single `Game.demolishTarget()` entry, fix the demolish-mode hierarchy so it cleanly maps to user-facing object kinds, ensure hit-testing uses object visual regions (with a generous hitbox for narrow beam pipes), and add missing delete buttons to the windows that lack them.

**Architecture:** Pull the demolish scope table out of `InputHandler.js` into a new `src/input/demolishScopes.js` module so the hit-test, hover overlay, and HUD menu all read from one source. Add `Game.demolishTarget({kind, id})` that dispatches to the existing per-kind `remove*` methods so refund/log/event/undo become uniform across popup, context-window, and demolish-mode entry points. Existing raycast hit-testing and outline rendering already exist (`InputHandler._findDeletablePlaceable`, `ThreeRenderer.raycastScreen`, `_outlineObject`) — this work refactors and extends them, not rebuilds. Beam-pipe hit-test gets an explicit AABB-expansion fallback.

**Tech Stack:** Vanilla ES modules, Three.js (CDN global, never imported), Vite dev server on `:8000`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-11-demolish-hierarchy-design.md`

---

## Conventions

- **THREE is a CDN global.** Never `import THREE`.
- **Verification is visual.** This is a UI/3D refactor. Most tasks end with "run `npm run dev`, open http://localhost:8000, do X, observe Y." There are no unit tests for this work.
- **Frequent commits.** Each task ends with one commit. Don't batch.
- **Backwards-compat:** there are no in-flight saves to migrate; rename freely. The old name `demolishComponent` is replaced with `demolishBeamline` everywhere in one task.

## File structure

**New files:**

```
src/input/demolishScopes.js   # scope table + demolishRefund() util + mode metadata
```

**Modified files:**

```
src/input/InputHandler.js     # imports demolishScopes; renames demolishType values;
                              # generous beam-pipe hit-test; removes _contextDemolishType;
                              # _updateDemolishHover gains demolishWall/demolishDoor branches
src/game/Game.js              # adds demolishTarget(target)
src/renderer/overlays.js      # popup buttons call demolishTarget
src/ui/EquipmentWindow.js     # Remove button calls demolishTarget
src/ui/BeamlineWindow.js      # adds Demolish action button
src/ui/MachineWindow.js       # adds Demolish action button
src/renderer/hud.js           # demolish menu shows all 10 buttons with new labels
src/data/modes.js             # (no change required — demolish category is opaque)
```

---

## Task 1: Create `demolishScopes.js` module

Extract the scope table and refund util into one importable module so the hit test, hover overlay, HUD, and `demolishTarget` all read from a single source.

**Files:**
- Create: `src/input/demolishScopes.js`

- [ ] **Step 1: Write the module**

Create `src/input/demolishScopes.js` with this exact content:

```js
// Demolish mode definitions. Each demolish tool maps to a scope (the set
// of placeable kinds it can delete), a display label, a description, and
// a swatch color used by the HUD palette.
//
// Cascade tiers (each tier deletes its own kind plus all kinds below it):
//   demolishBeamline > demolishEquipment > demolishFurnishing > demolishDecoration
// Standalone single-kind modes do NOT cascade.

import { COMPONENTS } from '../data/components.js';
import { PLACEABLES } from '../data/placeables/index.js';

/**
 * 50% refund of a placeable/component definition's funding cost.
 * @param {object} compOrDef - placeable or component def with `cost`
 * @returns {number} integer refund amount
 */
export function demolishRefund(compOrDef) {
  if (!compOrDef) return 0;
  const cost = typeof compOrDef.cost === 'object'
    ? (compOrDef.cost.funding || 0)
    : (compOrDef.cost || 0);
  return Math.floor(cost * 0.5);
}

// Cascading placeable scopes. Each tier includes itself and every tier below.
// Order matters: top-to-bottom is decreasing scope.
export const DEMOLISH_PLACEABLE_SCOPE = {
  demolishBeamline:   new Set(['beamline', 'equipment', 'furnishing', 'decoration']),
  demolishEquipment:  new Set(['equipment', 'furnishing', 'decoration']),
  demolishFurnishing: new Set(['furnishing', 'decoration']),
  demolishDecoration: new Set(['decoration']),
  // demolishAll behaves like the top tier for placeables, plus standalone systems.
  demolishAll:        new Set(['beamline', 'equipment', 'furnishing', 'decoration']),
};

// Standalone (non-cascading) demolish modes. These each affect exactly one
// system and never touch placeables.
export const DEMOLISH_STANDALONE = new Set([
  'demolishWall',
  'demolishDoor',
  'demolishFloor',
  'demolishZone',
  'demolishUtility',
]);

// HUD palette button definitions, in display order.
export const DEMOLISH_BUTTONS = [
  // Cascade tiers
  { key: 'demolishBeamline',   name: 'Demolish Beamline',  desc: 'Beamline + everything below', color: '#c44' },
  { key: 'demolishEquipment',  name: 'Demolish Equipment', desc: 'Equipment + furnishing + decoration', color: '#a64' },
  { key: 'demolishFurnishing', name: 'Demolish Furniture', desc: 'Furniture + decoration', color: '#a48' },
  { key: 'demolishDecoration', name: 'Demolish Decoration', desc: 'Decoration only', color: '#86a' },
  // Standalone
  { key: 'demolishWall',       name: 'Demolish Walls',     desc: 'Wall segments', color: '#a86' },
  { key: 'demolishDoor',       name: 'Demolish Doors',     desc: 'Door segments', color: '#88a' },
  { key: 'demolishFloor',      name: 'Demolish Floor',     desc: 'Flooring tiles', color: '#a44' },
  { key: 'demolishZone',       name: 'Demolish Zone',      desc: 'Zone overlays', color: '#a84' },
  { key: 'demolishUtility',    name: 'Demolish Utilities', desc: 'Utility pipes / cables', color: '#c84' },
  // Sweeper
  { key: 'demolishAll',        name: 'Demolish All',       desc: 'Everything on the hovered tile', color: '#c22' },
];

/**
 * Compute the refund for a deletable target (the shape returned by
 * _findDeletablePlaceable). Used by the hover overlay and demolishTarget.
 * @param {object} found - { kind, placeable, entry?, node?, attachment?, pipeId? }
 * @param {object} game - Game instance (needed for beam pipe segment lookup)
 */
export function refundForFound(found, game) {
  if (!found) return 0;
  if (found.kind === 'beampipe') {
    const pipe = (game.state.beamPipes || []).find(p => p.id === found.pipeId);
    if (!pipe) return 0;
    const segCount = Math.max(1, (pipe.path.length - 1) || 1);
    const driftDef = COMPONENTS.drift;
    const costPerTile = driftDef ? driftDef.cost.funding : 10000;
    return Math.floor(costPerTile * segCount * 0.5);
  }
  if (found.kind === 'attachment') {
    return demolishRefund(found.placeable);
  }
  return demolishRefund(found.placeable);
}

/**
 * Display name for a deletable target.
 */
export function nameForFound(found) {
  if (!found) return 'Unknown';
  if (found.kind === 'beampipe') return 'Beam Pipe';
  if (found.kind === 'attachment') {
    return found.placeable?.name || found.attachment?.type || 'Attachment';
  }
  const def = found.placeable;
  return def?.name || found.entry?.type || found.node?.type || 'Unknown';
}
```

- [ ] **Step 2: Verify it loads**

Run:
```bash
node -e "import('./src/input/demolishScopes.js').then(m => console.log(Object.keys(m)))"
```

Expected (order may differ): `[ 'demolishRefund', 'DEMOLISH_PLACEABLE_SCOPE', 'DEMOLISH_STANDALONE', 'DEMOLISH_BUTTONS', 'refundForFound', 'nameForFound' ]`

If you get a "Cannot find module" error from `data/components.js` or `data/placeables/index.js`, that's fine — those imports only execute when the module is actually used by the browser; the smoke test below will catch real wiring problems. Skip to step 3.

- [ ] **Step 3: Commit**

```bash
git add src/input/demolishScopes.js
git commit -m "feat(demolish): extract scope table and refund util to dedicated module"
```

---

## Task 2: Rename `demolishComponent` → `demolishBeamline` everywhere

The legacy name `demolishComponent` is misleading (it deletes everything in the beamline tier, not just components). Replace with `demolishBeamline` so the cascade naming is consistent.

**Files:**
- Modify: `src/input/InputHandler.js` — replace all references
- Modify: `src/renderer/hud.js` — palette button definitions
- Modify: anywhere else the literal string appears

- [ ] **Step 1: Find every occurrence**

Run:
```bash
grep -rn "demolishComponent" src/ docs/
```

Note every file/line. Expected files: `src/input/InputHandler.js`, `src/renderer/hud.js`. Possibly `src/data/modes.js`. Docs may also mention it — leave docs alone for this task.

- [ ] **Step 2: Replace in source**

For each `.js` file the grep found, replace the literal string `demolishComponent` with `demolishBeamline`. Use Edit with `replace_all: true` per file. Do not touch markdown files in `docs/`.

- [ ] **Step 3: Verify no source references remain**

Run:
```bash
grep -rn "demolishComponent" src/
```

Expected: no output.

- [ ] **Step 4: Smoke test in browser**

Run:
```bash
npm run dev
```

Open http://localhost:8000. Click the Demolish tab. The "Remove Components" button still appears (label hasn't changed yet — we update it in Task 7). Click it. The HUD should not error in the console. (You'll see the button label is wrong; that's fixed in Task 7.)

Check the browser DevTools console for any reference errors. Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "refactor(demolish): rename demolishComponent to demolishBeamline"
```

---

## Task 3: Wire `InputHandler` to import from `demolishScopes.js`

Replace the inline `_demolishRefund()` and `DEMOLISH_PLACEABLE_SCOPE` declarations in `InputHandler.js` with imports from the new module. Existing `_findDeletablePlaceable()` and `_updateDemolishHover()` keep working unchanged — they just read from the imported constant.

**Files:**
- Modify: `src/input/InputHandler.js:1-31`

- [ ] **Step 1: Add the import**

In `src/input/InputHandler.js`, add this near the other imports (after the existing `import { snapForPlaceable, canPlace } from '../game/placement.js';` line):

```js
import {
  DEMOLISH_PLACEABLE_SCOPE,
  DEMOLISH_STANDALONE,
  demolishRefund,
  refundForFound,
  nameForFound,
} from './demolishScopes.js';
```

- [ ] **Step 2: Delete the inline declarations**

In `src/input/InputHandler.js`, delete the `_demolishRefund` function (lines ~16-20) and the `DEMOLISH_PLACEABLE_SCOPE` declaration (lines ~22-31). Keep the file's other top-level helpers (`_categoryColor`, `_effectLabel`).

The remaining usage sites of `_demolishRefund(...)` inside the class become `demolishRefund(...)` (same name minus the leading underscore — it's now a module import, not a top-level function). Search the file for `_demolishRefund` and rename each call site:

```bash
grep -n "_demolishRefund" src/input/InputHandler.js
```

Use Edit with `replace_all: true` to rename `_demolishRefund(` → `demolishRefund(`.

- [ ] **Step 3: Smoke test**

Run `npm run dev`, open http://localhost:8000. Place a beamline component, then enter demolish mode and hover it — the red outline + name + refund tooltip should still appear identically to before. Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/input/InputHandler.js
git commit -m "refactor(demolish): import scope table and refund util from demolishScopes"
```

---

## Task 4: Add `Game.demolishTarget(target)` unified entry point

Single delete entry point. Accepts the same `{ kind, ... }` shape returned by `_findDeletablePlaceable` and dispatches to the existing `remove*` methods. No behavior change for the methods themselves — this is the unifying wrapper.

**Files:**
- Modify: `src/game/Game.js` — add new method (place near `removePlaceable` around line 1283)

- [ ] **Step 1: Add the method**

In `src/game/Game.js`, immediately after the closing `}` of `removePlaceable()` (around line 1330, before `removePlaceablesByKind`), insert:

```js
  /**
   * Unified delete entry point. Accepts a `target` produced by
   * InputHandler._findDeletablePlaceable (or constructed by a context menu)
   * and dispatches to the right per-kind remove method. All delete code
   * paths in the UI route through this so refund/log/event/undo are uniform.
   *
   * @param {object} target - { kind, id?, entry?, node?, pipeId?, attachmentId? }
   * @returns {boolean} true if anything was removed
   */
  demolishTarget(target) {
    if (!target) return false;
    switch (target.kind) {
      case 'beamline': {
        // Two shapes: legacy registry node (target.node) or unified placeable (target.entry).
        if (target.node) return this.removeComponent(target.node.id);
        if (target.entry) return this.removePlaceable(target.entry.id);
        if (target.id) return this.removePlaceable(target.id);
        return false;
      }
      case 'beampipe':
        return this.removeBeamPipe(target.pipeId || target.id);
      case 'attachment':
        return this.removeAttachment(target.pipeId, target.attachmentId);
      case 'equipment':
      case 'furnishing':
      case 'decoration': {
        const id = target.entry?.id || target.id;
        return id ? this.removePlaceable(id) : false;
      }
      case 'machine':
        return this.removeMachine(target.id || target.machineId);
      default:
        return false;
    }
  }
```

- [ ] **Step 2: Smoke test**

Run `npm run dev`, place a beamline component, enter demolish mode, and click it. (Demolish mode still calls the old per-kind methods directly at this point — that's wired in Task 5. This task only adds the new method; we just want to confirm we didn't break the file's syntax.)

Open http://localhost:8000, check the browser console for parse errors. Then in the console, run:

```js
window.game.demolishTarget // should print the function
```

Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add src/game/Game.js
git commit -m "feat(game): add demolishTarget unified delete entry point"
```

---

## Task 5: Route demolish-mode clicks through `demolishTarget`

The mouse click handler in demolish mode currently has separate `if (found.kind === ...)` branches calling each `remove*` method. Replace those with a single `demolishTarget(found)` call.

**Files:**
- Modify: `src/input/InputHandler.js` — find the demolish click handler

- [ ] **Step 1: Locate the demolish click handler**

Run:
```bash
grep -n "removeBeamPipe\|removeAttachment\|removeFacilityEquipment\|removeZoneFurnishing\|removeDecoration\|removeComponent" src/input/InputHandler.js
```

Note all sites that are inside demolish-mode click handling (typically inside an `if (this.demolishMode)` block, calling the remove functions after `_findDeletablePlaceable` returns a `found`). Don't touch sites that aren't part of demolish click flow (e.g. the popup callbacks, which are handled in Task 6).

- [ ] **Step 2: Replace the per-kind dispatch**

For each demolish-click branch like:

```js
if (found.kind === 'beamline') this.game.removeComponent(found.node.id);
else if (found.kind === 'beampipe') this.game.removeBeamPipe(found.pipeId);
else if (found.kind === 'attachment') this.game.removeAttachment(found.pipeId, found.attachmentId);
else if (found.kind === 'equipment') this.game.removePlaceable(found.entry.id);
// ... etc
```

Replace the entire `if/else` chain with:

```js
this.game.demolishTarget(found);
```

If a branch passes additional context (e.g. logging), keep the log line but route the actual removal through `demolishTarget`.

- [ ] **Step 3: Smoke test**

Run `npm run dev`. Test each cascade tier:
1. Place a beamline component, a beam pipe between two components, an attachment on the pipe, an equipment item, and a decoration.
2. Enter `demolishBeamline` mode (currently labeled "Remove Components" until Task 7). Click each item — they should all delete with refund.
3. Enter `demolishEquipment` mode. The beamline component should NOT be deletable, but equipment + decoration should.

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/input/InputHandler.js
git commit -m "refactor(demolish): route demolish-mode clicks through Game.demolishTarget"
```

---

## Task 6: Route popup and EquipmentWindow delete buttons through `demolishTarget`

The component popup "Recycle" button (`overlays.js:139,167`), facility popup "Remove" button (`overlays.js:276,280`), and `EquipmentWindow` "Remove" button (`EquipmentWindow.js:33-38`) currently call `removeComponent` / `removeFacilityEquipment` directly. Route through `demolishTarget`.

**Files:**
- Modify: `src/renderer/overlays.js:167, 280`
- Modify: `src/ui/EquipmentWindow.js:34-37`

- [ ] **Step 1: Update component popup**

In `src/renderer/overlays.js`, find the line `this.game.removeComponent(node.id);` (around line 167). Replace with:

```js
this.game.demolishTarget({ kind: 'beamline', node });
```

- [ ] **Step 2: Update facility popup**

In the same file, find `this.game.removeFacilityEquipment(equip.id);` (around line 280). Replace with:

```js
this.game.demolishTarget({ kind: 'equipment', id: equip.id });
```

- [ ] **Step 3: Update EquipmentWindow**

In `src/ui/EquipmentWindow.js`, find lines 33-38:

```js
    this.ctx.setActions([
      { label: 'Remove (50% refund)', style: 'color:#f88', onClick: () => {
        this.game.removeFacilityEquipment(equip.id);
        this.ctx.close();
      }},
    ]);
```

Replace with:

```js
    this.ctx.setActions([
      { label: 'Demolish (50% refund)', style: 'color:#f88', onClick: () => {
        this.game.demolishTarget({ kind: 'equipment', id: equip.id });
        this.ctx.close();
      }},
    ]);
```

- [ ] **Step 4: Smoke test**

Run `npm run dev`. Test each path:
1. Place a beamline component. Click it to open the popup. Click "Recycle". Component should disappear with refund logged.
2. Place a facility equipment item. Right-click or click to open the popup. Click "Remove". Equipment should disappear.
3. Open the equipment context window (single-click on placed equipment). Click the "Demolish" action. Equipment should disappear.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/overlays.js src/ui/EquipmentWindow.js
git commit -m "refactor(demolish): popup and EquipmentWindow route through demolishTarget"
```

---

## Task 7: Add Demolish action button to `BeamlineWindow` and `MachineWindow`

These windows currently have no delete action, forcing users into demolish mode. Add a "Demolish (50% refund)" action that calls `demolishTarget`.

**Files:**
- Modify: `src/ui/BeamlineWindow.js`
- Modify: `src/ui/MachineWindow.js:67-106`

- [ ] **Step 1: Find BeamlineWindow's action setup**

Run:
```bash
grep -n "setActions\|actions" src/ui/BeamlineWindow.js | head -20
```

Find where actions are pushed (similar to `MachineWindow._updateActions`). The window operates on a single beamline node — call it via the registry.

- [ ] **Step 2: Add the BeamlineWindow demolish action**

In `BeamlineWindow.js`, locate the `setActions([...])` or `actions.push(...)` block. Append a new action at the end of the array. The exact context depends on the file's existing structure — append something equivalent to:

```js
actions.push({
  label: 'Demolish (50% refund)',
  style: 'color:#f88',
  onClick: () => {
    // Route through unified path. The window operates on a beamline node.
    this.game.demolishTarget({ kind: 'beamline', node: this.node });
    this.ctx.close();
  },
});
```

If the window stores the node under a different field (e.g. `this.beamlineNode` or `this.nodeId`), adapt the property access accordingly. Read the constructor of `BeamlineWindow` first to find the right field.

- [ ] **Step 3: Add the MachineWindow demolish action**

In `src/ui/MachineWindow.js`, find `_updateActions()` (line 67). After the Repair action (line 104) and before `this.ctx.setActions(actions)` (line 106), add:

```js
    // Demolish — 50% refund. Routes through unified delete path.
    actions.push({
      label: 'Demolish (50% refund)',
      style: 'color:#f88',
      onClick: () => {
        this.game.demolishTarget({ kind: 'machine', id: this.machineId });
        this.ctx.close();
      },
    });
```

- [ ] **Step 4: Smoke test**

Run `npm run dev`.
1. Place a beamline component, click it to open `BeamlineWindow`. Confirm a "Demolish" action button appears in the actions row. Click it. The component should disappear with refund and the window should close.
2. Place a machine, click it to open `MachineWindow`. Confirm a "Demolish" action appears. Click it. The machine should disappear and the window should close.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/ui/BeamlineWindow.js src/ui/MachineWindow.js
git commit -m "feat(ui): add Demolish action to BeamlineWindow and MachineWindow"
```

---

## Task 8: Generous beam-pipe hit-test

Beam pipes are long and narrow, so the existing raycast-only hit-test is finicky. Add a fallback: if the raycast didn't hit a pipe (or hit one but only barely), check whether the cursor world position is within an expanded AABB of any pipe segment, and prefer that pipe.

**Files:**
- Modify: `src/input/InputHandler.js` — `_findDeletablePlaceable`

- [ ] **Step 1: Inspect the pipe data shape**

Run:
```bash
grep -n "beamPipes\.push\|beamPipes:" src/game/Game.js | head
```

Then read the surrounding code to confirm the pipe shape. Expected: each pipe has `id`, `path` (an array of `{col, row}` waypoints), and `attachments`. The path defines connected segments.

- [ ] **Step 2: Add the helper**

In `src/input/InputHandler.js`, near `_placeableAtWorldPos` (around line 2285), add:

```js
  /**
   * Generous beam-pipe hit test. Beam pipes are narrow, so the raycast may
   * miss them when the cursor is just to the side. Returns the first pipe
   * whose path has any segment within `pad` world units of (worldX, worldZ).
   * @param {number} worldX
   * @param {number} worldZ
   * @param {number} pad - perpendicular padding in world units (default 0.5 = ~quarter tile)
   * @returns {object|null} the pipe entry, or null
   */
  _beamPipeNearWorldPos(worldX, worldZ, pad = 0.5) {
    const pipes = this.game.state.beamPipes || [];
    for (const pipe of pipes) {
      if (!pipe.path || pipe.path.length < 2) continue;
      for (let i = 0; i < pipe.path.length - 1; i++) {
        const a = pipe.path[i];
        const b = pipe.path[i + 1];
        // Convert tile coords to world coords (2 world units per tile, tile center).
        const ax = a.col * 2 + 1, az = a.row * 2 + 1;
        const bx = b.col * 2 + 1, bz = b.row * 2 + 1;
        // Distance from point (worldX,worldZ) to segment (a,b).
        const dx = bx - ax, dz = bz - az;
        const len2 = dx * dx + dz * dz;
        if (len2 === 0) continue;
        let t = ((worldX - ax) * dx + (worldZ - az) * dz) / len2;
        t = Math.max(0, Math.min(1, t));
        const px = ax + t * dx, pz = az + t * dz;
        const ddx = worldX - px, ddz = worldZ - pz;
        if (ddx * ddx + ddz * ddz <= pad * pad) {
          return pipe;
        }
      }
    }
    return null;
  }
```

- [ ] **Step 3: Use the helper as a fallback in `_findDeletablePlaceable`**

In `_findDeletablePlaceable` (around line 2168), at the very end of the function (just before `return null`), insert:

```js
    // --- 4. Generous beam-pipe fallback ---
    // Beam pipes are long and narrow; if nothing else matched but the cursor
    // is close to a pipe segment, prefer that pipe. Only when 'beamline' is in scope.
    if (scope.has('beamline') && world && typeof world.x === 'number') {
      const pipe = this._beamPipeNearWorldPos(world.x, world.y, 0.5);
      if (pipe) {
        return { kind: 'beampipe', pipeId: pipe.id, rootObj: null };
      }
    }
```

(Note: in this codebase the cursor world position is passed as `world.x, world.y` where `y` is the world Z axis — confirm by reading the call site of `_findDeletablePlaceable` around line 240. Adjust if the field is named differently.)

- [ ] **Step 4: Smoke test**

Run `npm run dev`. Place two beamline components and a beam pipe between them. Enter `demolishBeamline` mode. Hover the cursor *near* but not directly on the pipe (a few pixels off the line). The pipe should now highlight and show its tooltip. Click — it should delete.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/input/InputHandler.js
git commit -m "feat(demolish): generous beam-pipe hit-test with segment-distance fallback"
```

---

## Task 9: Update HUD demolish menu to show all 10 buttons

The current menu (`hud.js:867-902`) lists 7 buttons and is missing `demolishEquipment`, `demolishDoor`, and `demolishDecoration`. Replace the inline `demolishTools` array with the imported `DEMOLISH_BUTTONS` from `demolishScopes.js`.

**Files:**
- Modify: `src/renderer/hud.js:867-902`

- [ ] **Step 1: Add the import**

At the top of `src/renderer/hud.js`, add (next to other imports):

```js
import { DEMOLISH_BUTTONS } from '../input/demolishScopes.js';
```

- [ ] **Step 2: Replace the inline tool list**

In `hud.js`, find the block around line 868 that defines `const demolishTools = [...]`. Delete that array literal and replace with:

```js
    const demolishTools = DEMOLISH_BUTTONS;
```

The rest of the loop (lines ~878-901) is unchanged — it iterates `demolishTools` and creates DOM elements from `{key, name, desc, color}`, which is exactly the shape the new module exports.

- [ ] **Step 3: Smoke test**

Run `npm run dev`, click the Demolish tab. Expected: 10 buttons in this order:
1. Demolish Beamline
2. Demolish Equipment
3. Demolish Furniture
4. Demolish Decoration
5. Demolish Walls
6. Demolish Doors
7. Demolish Floor
8. Demolish Zone
9. Demolish Utilities
10. Demolish All

Click each button — each should highlight as the active tool and the cursor should switch to crosshair.

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/hud.js
git commit -m "feat(hud): show all 10 demolish modes in palette from shared button list"
```

---

## Task 10: Add hover handling for `demolishEquipment`, `demolishDecoration`, `demolishDoor`

The `_updateDemolishHover` function in `InputHandler.js` already handles `demolishBeamline`, `demolishFurnishing`, `demolishWall` (for the placeable scopes that overlap), `demolishZone`, `demolishFloor`, and `demolishConnection`. The new modes `demolishEquipment` and `demolishDecoration` are scopes in the placeable table so they automatically work for placeables — confirm. `demolishDoor` is standalone and needs an edge-style hover branch.

**Files:**
- Modify: `src/input/InputHandler.js` — `_updateDemolishHover` (around line 230)

- [ ] **Step 1: Verify placeable-scope modes work automatically**

`_updateDemolishHover` (line 238) reads `DEMOLISH_PLACEABLE_SCOPE[dt]`. Since Task 1 added `demolishEquipment`, `demolishDecoration` (renamed from old name), and `demolishBeamline` to that table, hovering in those modes already routes through `_findDeletablePlaceable` with the right scope. No code change needed for them — but verify in step 3.

- [ ] **Step 2: Add `demolishDoor` branch**

In `_updateDemolishHover` (around line 309, in the same area as the floor and connection branches), after the floor branch and before the `if (!found)` cleanup, add:

```js
    // Doors — edge-based hover. Doors live on tile edges in state.doorOccupied
    // keyed by 'col,row,edge'. Highlight the matched edge.
    if (!found && (dt === 'demolishDoor' || dt === 'demolishAll')) {
      for (const edge of ['e', 's', 'w', 'n']) {
        const ekey = col + ',' + row + ',' + edge;
        if (this.game.state.doorOccupied?.[ekey]) {
          // Reuse the existing tile preview as a coarse highlight; refining
          // to a per-edge stroke is a follow-up if it looks too vague.
          this.renderer.renderDemolishPreview(col, row, col, row);
          const doorType = this.game.state.doorOccupied[ekey];
          const def = DOOR_TYPES[doorType];
          this._showDemolishTooltip(def?.name || 'Door', demolishRefund(def), screenX, screenY);
          found = true;
          break;
        }
      }
    }
```

(`DOOR_TYPES` is already imported at the top of `InputHandler.js` from `../data/infrastructure.js` — confirm with `grep DOOR_TYPES src/input/InputHandler.js`.)

- [ ] **Step 3: Smoke test**

Run `npm run dev`.
1. Place a beamline component and an equipment item next to it.
2. Enter `demolishEquipment` mode. Hover the equipment — should show red outline + name + refund. Hover the beamline component — should NOT highlight (out of scope).
3. Enter `demolishDecoration` mode. Place a decoration. Hover it — should highlight. Hover equipment — should NOT highlight.
4. Place a wall and a door. Enter `demolishDoor` mode. Hover the tile next to the door — should show the door name and refund.
5. Click each highlighted target — `demolishTarget` should remove it (this part already works from Task 5).

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/input/InputHandler.js
git commit -m "feat(demolish): hover handling for equipment, decoration, and door modes"
```

---

## Task 11: Remove `_contextDemolishType` auto-selection

The auto-selection logic at `InputHandler.js:2562-2580` tries to pick a demolish mode from the active build tab. With the explicit 10-button menu, this is no longer needed and adds noise.

**Files:**
- Modify: `src/input/InputHandler.js` — find and delete `_contextDemolishType`

- [ ] **Step 1: Find call sites**

Run:
```bash
grep -n "_contextDemolishType" src/input/InputHandler.js
```

Note every call site (probably a small number — likely just one in a keyboard shortcut handler or the demolish-mode entry helper).

- [ ] **Step 2: Remove the calls**

For each call site, replace `this._contextDemolishType()` with `'demolishBeamline'` (the new default top tier) — or wherever the value is used as a fallback, hardcode `'demolishBeamline'`. Read the surrounding code to make sure replacing it with a static default makes sense.

- [ ] **Step 3: Delete the function**

Delete the `_contextDemolishType` method body in `InputHandler.js` (around lines 2562-2580).

- [ ] **Step 4: Verify nothing references it**

Run:
```bash
grep -n "_contextDemolishType" src/
```

Expected: no output.

- [ ] **Step 5: Smoke test**

Run `npm run dev`. Press the demolish-mode keyboard shortcut (if any) and confirm it enters `demolishBeamline` by default. Switch through every demolish button manually and confirm each works. Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/input/InputHandler.js
git commit -m "refactor(demolish): drop _contextDemolishType auto-selection"
```

---

## Task 12: Final visual verification + spec close-out

End-to-end test against the spec's success criteria.

- [ ] **Step 1: Run the dev server**

```bash
npm run dev
```

Open http://localhost:8000.

- [ ] **Step 2: Test cascade exclusivity**

Place one of each: beamline component, beam pipe, attachment, equipment, machine, furnishing, decoration.

For each cascade tier, switch to that demolish mode and confirm the *exact* set of objects highlights on hover:

| Mode | Should highlight | Should NOT highlight |
|---|---|---|
| `demolishBeamline` | beamline, pipe, attachment, equipment, machine, furnishing, decoration | (nothing) |
| `demolishEquipment` | equipment, furnishing, decoration | beamline, pipe, attachment, machine |
| `demolishFurnishing` | furnishing, decoration | everything else |
| `demolishDecoration` | decoration | everything else |

If `demolishBeamline` doesn't highlight machines, check that `Game.demolishTarget` and `_findDeletablePlaceable` agree on the `'machine'` kind (the existing `_findDeletablePlaceable` may not return a `machine` kind — if so, file a follow-up issue but don't extend scope here).

- [ ] **Step 3: Test unified delete consistency**

Place a beamline component. Delete it three different ways across three different fresh placements:
1. Via the popup "Recycle" button.
2. Via the `BeamlineWindow` "Demolish" action.
3. Via `demolishBeamline` mode click.

Open DevTools, watch the game log. All three should produce identical log lines (e.g. `Removed Drift (50% refund)`) and identical refund amounts.

- [ ] **Step 4: Test generous beam-pipe hitbox**

Place two components and a beam pipe. In `demolishBeamline` mode, hover the cursor *just to the side* of the pipe — within ~half a tile. The pipe should still highlight and the tooltip should appear.

- [ ] **Step 5: Test floor / wall / door / zone / utility standalone modes**

Each standalone mode should affect only its own kind. Place a floor tile, a wall, a door, a zone, and a utility connection. Test each demolish mode in turn — only the matching item should delete.

- [ ] **Step 6: Test `demolishAll`**

Place a complex tile (floor + zone + furnishing + utility). Enter `demolishAll`. Click the tile. Everything should be removed in one click.

- [ ] **Step 7: Stop dev server and commit any remaining work**

If steps 2-6 all pass, no code changes are required. If any failed, fix and commit per task.

```bash
git status
# If clean, this task is done.
```

---

## Self-review

After completing all tasks above, the spec's success criteria should be met:

- [x] Deleting via popup, context window, or demolish mode produces identical state (Task 4-7).
- [x] Hover shows red outline + white name + green refund (existing `_outlineObject` + `_showDemolishTooltip`, used by all modes after Task 10).
- [x] Beam pipes hit by clicking near, not just on, the pipe (Task 8).
- [x] Floors and walls get tile/edge highlighting in their demolish modes (existing tile preview + Task 10 door branch).
- [x] All 4 cascade tiers + 5 standalone modes + `demolishAll` reachable from menu (Task 9).
- [x] No code path bypasses `demolishTarget` (Task 5, 6, 7).
