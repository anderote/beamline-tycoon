# Unified Placeables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse three divergent placement code paths (beamline modules, facility equipment, zone furnishings) into a single subtile-based pipeline so every placeable uses the same snap, validation, ghost preview, commit, and delete logic.

**Architecture:** A single `PLACEABLES` registry aggregates entries from per-kind data files and wraps each in a `Placeable` subclass (`BeamlineModule`, `Furnishing`, `Equipment`). A new `src/game/placement.js` module owns the pure placement primitives (snap, footprint, collision). `Game.placePlaceable` becomes kind-agnostic — its only constraint is subtile footprint collision. `InputHandler` carries one `hoverPlaceable` and one `selectedPlaceableId`. `ThreeRenderer` exposes one `renderPlaceableGhost`. Beam pipes and pipe attachments keep their existing special paths.

**Tech Stack:** Vanilla JS modules (ES2022), Vite dev server, Three.js for 3D rendering. **No test runner exists in this project** — verification is via `npm run dev` smoke tests in the browser, plus visual inspection. The plan accepts this and uses smoke tests as the verification gate per task.

**Spec:** `docs/superpowers/specs/2026-04-10-unified-placeables-design.md`

**Working assumptions encoded by the design (do not relitigate during implementation):**
- Footprint collision is the only placement constraint. No floor, zone, tier, or max-count gates remain on `placePlaceable`. (Tier-based unlocking is still allowed at the **HUD level** — items the player hasn't unlocked don't show up in the build menu — but the placement primitive does not enforce them.)
- Every placeable uses 4-way `dir` rotation (0/1/2/3 = N/E/S/W). The `rotated` boolean is deleted everywhere.
- Footprint dimensions are in **subtiles** (`subW`, `subH`). 1 tile = 4×4 subtiles. `gridW`/`gridH` is removed from new code paths; existing entries keep them only as a temporary fallback during data normalization.
- Save migration is not required. Existing saves are wiped on first launch after this lands.
- Beam pipes and pipe attachments are **out of scope**. They keep their current code paths and do not get folded into the unified pipeline.
- Utility pipes are out of scope entirely.

---

## File Structure

**New files:**
- `src/game/Placeable.js` — base class + `BeamlineModule`, `Furnishing`, `Equipment` subclasses
- `src/game/placement.js` — pure placement primitives (snap, footprint, collision, place, remove)
- `src/data/placeables/index.js` — exports `PLACEABLES` (id → wrapped instance) by aggregating per-kind files
- `src/data/placeables/beamline-modules.js` — beamline-kind entries
- `src/data/placeables/furnishings.js` — furnishing-kind entries
- `src/data/placeables/equipment.js` — equipment-kind entries

**Modified files:**
- `src/game/Game.js` — strip kind-branching from `placePlaceable`; add `removePlaceableById`, `removePlaceablesByKind`; route registry lookups through `PLACEABLES`
- `src/input/InputHandler.js` — collapse three preview branches and three commit branches; unify selection state to `selectedPlaceableId`; unify rotation to `placementDir`
- `src/renderer3d/ThreeRenderer.js` — add `renderPlaceableGhost`; delete the three legacy ghost renderers
- `src/renderer/hud.js` — read build menu from `PLACEABLES` grouped by kind; set `selectedPlaceableId` on click; per-kind delete buttons

**Files left intact (registry shims for transition only — see Task 4):**
- `src/data/components.js` — exports `COMPONENTS` re-derived from `PLACEABLES`
- `src/data/infrastructure.js` — exports `ZONE_FURNISHINGS` re-derived from `PLACEABLES` (other exports — `INFRASTRUCTURE`, `WALL_TYPES`, `DOOR_TYPES`, `ZONES`, `ZONE_TIER_THRESHOLDS`, `FURNISHING_TIER_THRESHOLDS` — are untouched)

---

## Task Sequencing

Tasks 1–3 are additive (new files only) and can land independently. Tasks 4–13 must be sequential because each one removes a code path that the previous step depends on.

After every task: **commit** with a clear message and **smoke test** in the browser via `npm run dev`. The smoke test for additive tasks is "the game still loads without console errors." The smoke test for behavioral tasks is described per task.

---

## Task 1: Create the `Placeable` class hierarchy

**Files:**
- Create: `src/game/Placeable.js`

- [ ] **Step 1: Write the file**

```javascript
// src/game/Placeable.js
//
// Base class for any object placeable on the subtile grid.
// Subclasses add kind-specific runtime behavior; placement code only ever
// touches base-class methods.

export class Placeable {
  constructor(def) {
    Object.assign(this, def);
    if (this.subW == null || this.subH == null) {
      throw new Error(`Placeable ${def.id}: missing subW/subH`);
    }
    if (!['beamline', 'furnishing', 'equipment'].includes(this.kind)) {
      throw new Error(`Placeable ${def.id}: invalid kind ${this.kind}`);
    }
  }

  /**
   * Returns the list of (col,row,subCol,subRow) cells this placeable would
   * occupy at the given origin and direction. Origin is the dir=0 top-left
   * subtile in absolute subtile-space. Rotation pivots around the footprint
   * center; for non-square footprints, dir=1/3 swap subW and subH.
   */
  footprintCells(col, row, subCol, subRow, dir = 0) {
    const swap = dir === 1 || dir === 3;
    const w = swap ? this.subH : this.subW;
    const h = swap ? this.subW : this.subH;
    const cells = [];
    for (let dr = 0; dr < h; dr++) {
      for (let dc = 0; dc < w; dc++) {
        const sc = subCol + dc;
        const sr = subRow + dr;
        cells.push({
          col: col + Math.floor(sc / 4),
          row: row + Math.floor(sr / 4),
          subCol: ((sc % 4) + 4) % 4,
          subRow: ((sr % 4) + 4) % 4,
        });
      }
    }
    return cells;
  }

  // Lifecycle hooks — subclasses override.
  onPlaced(game, instance) {}
  onRemoved(game, instance) {}
}

export class BeamlineModule extends Placeable {
  onPlaced(game, instance) {
    // Beam graph hookup happens here in a later task.
  }
  onRemoved(game, instance) {
    // Beam graph teardown.
  }
}

export class Furnishing extends Placeable {}
export class Equipment extends Placeable {}

export const PLACEABLE_CLASS_BY_KIND = {
  beamline: BeamlineModule,
  furnishing: Furnishing,
  equipment: Equipment,
};
```

- [ ] **Step 2: Smoke test**

Run: `npm run dev` and load the game in the browser.
Expected: No new console errors. (The file is unused at this point, so the only failure mode is a syntax error.)

- [ ] **Step 3: Commit**

```bash
git add src/game/Placeable.js
git commit -m "feat(placeables): add Placeable base class and kind subclasses"
```

---

## Task 2: Create the placement primitives module

**Files:**
- Create: `src/game/placement.js`

- [ ] **Step 1: Write the file**

```javascript
// src/game/placement.js
//
// Pure placement primitives. No game state mutation lives here except
// inside placePlaceable / removePlaceable, which take game as an argument.

import { isoToGridFloat } from '../renderer/grid.js';

/**
 * Snap a world (x,y) to the nearest subtile center, no clamping.
 * Returns the tile + sub-offset that, when used as a placeable origin
 * with subW=1,subH=1, would put a 1x1 footprint centered on the cursor.
 *
 * For larger footprints, callers shift the origin by half the footprint
 * dimensions; see snapForPlaceable.
 */
export function snapWorldToSubgrid(worldX, worldY) {
  const fc = isoToGridFloat(worldX, worldY);
  const subCenterCol = Math.round(fc.col * 4);
  const subCenterRow = Math.round(fc.row * 4);
  const col = Math.floor(subCenterCol / 4);
  const row = Math.floor(subCenterRow / 4);
  const subCol = ((subCenterCol % 4) + 4) % 4;
  const subRow = ((subCenterRow % 4) + 4) % 4;
  return { col, row, subCol, subRow };
}

/**
 * Like snapWorldToSubgrid but offsets the origin so the placeable's
 * footprint is centered on the cursor.
 */
export function snapForPlaceable(worldX, worldY, placeable, dir = 0) {
  const swap = dir === 1 || dir === 3;
  const w = swap ? placeable.subH : placeable.subW;
  const h = swap ? placeable.subW : placeable.subH;
  const fc = isoToGridFloat(worldX, worldY);
  const subCenterCol = fc.col * 4;
  const subCenterRow = fc.row * 4;
  const topLeftSubCol = Math.round(subCenterCol - w / 2);
  const topLeftSubRow = Math.round(subCenterRow - h / 2);
  const col = Math.floor(topLeftSubCol / 4);
  const row = Math.floor(topLeftSubRow / 4);
  const subCol = ((topLeftSubCol % 4) + 4) % 4;
  const subRow = ((topLeftSubRow % 4) + 4) % 4;
  return { col, row, subCol, subRow };
}

function cellKey(c) {
  return c.col + ',' + c.row + ',' + c.subCol + ',' + c.subRow;
}

/**
 * Check whether the placeable can be placed at (col,row,subCol,subRow,dir).
 * The ONLY constraint is subtile footprint collision.
 */
export function canPlace(game, placeable, col, row, subCol, subRow, dir = 0) {
  const cells = placeable.footprintCells(col, row, subCol, subRow, dir);
  const blocked = [];
  for (const c of cells) {
    if (game.state.subgridOccupied[cellKey(c)]) blocked.push(c);
  }
  return { ok: blocked.length === 0, blockedCells: blocked, cells };
}
```

Note: `snapWorldToSubgrid` is the symmetric primitive; `snapForPlaceable` matches the centering behavior the existing magnetron path uses (it pre-shifts the origin by half the footprint). Callers in `InputHandler` will use `snapForPlaceable`.

- [ ] **Step 2: Smoke test**

Run: `npm run dev`.
Expected: No console errors. File is unused.

- [ ] **Step 3: Commit**

```bash
git add src/game/placement.js
git commit -m "feat(placeables): add pure placement primitives (snap, canPlace)"
```

---

## Task 3: Create the placeables registry scaffolding (empty)

**Files:**
- Create: `src/data/placeables/index.js`
- Create: `src/data/placeables/beamline-modules.js`
- Create: `src/data/placeables/furnishings.js`
- Create: `src/data/placeables/equipment.js`

- [ ] **Step 1: Write the per-kind files (empty arrays for now)**

```javascript
// src/data/placeables/beamline-modules.js
export const BEAMLINE_MODULE_DEFS = [];
```

```javascript
// src/data/placeables/furnishings.js
export const FURNISHING_DEFS = [];
```

```javascript
// src/data/placeables/equipment.js
export const EQUIPMENT_DEFS = [];
```

- [ ] **Step 2: Write the index**

```javascript
// src/data/placeables/index.js
//
// Single source of truth for every placeable in the game.
// Aggregates per-kind def files and wraps each entry in the right
// Placeable subclass at module load.

import { PLACEABLE_CLASS_BY_KIND } from '../../game/Placeable.js';
import { BEAMLINE_MODULE_DEFS } from './beamline-modules.js';
import { FURNISHING_DEFS } from './furnishings.js';
import { EQUIPMENT_DEFS } from './equipment.js';

const ALL_DEFS = [
  ...BEAMLINE_MODULE_DEFS,
  ...FURNISHING_DEFS,
  ...EQUIPMENT_DEFS,
];

export const PLACEABLES = {};

for (const def of ALL_DEFS) {
  if (PLACEABLES[def.id]) {
    throw new Error(`Duplicate placeable id: ${def.id}`);
  }
  const Cls = PLACEABLE_CLASS_BY_KIND[def.kind];
  if (!Cls) {
    throw new Error(`Unknown placeable kind ${def.kind} for ${def.id}`);
  }
  PLACEABLES[def.id] = new Cls(def);
}

export function placeablesByKind(kind) {
  return Object.values(PLACEABLES).filter(p => p.kind === kind);
}
```

- [ ] **Step 3: Smoke test**

Run: `npm run dev`.
Expected: No console errors. Registry is empty but loadable.

- [ ] **Step 4: Commit**

```bash
git add src/data/placeables/
git commit -m "feat(placeables): add empty PLACEABLES registry scaffolding"
```

---

## Task 4: Populate `PLACEABLES` from existing registries; make legacy exports re-derive from it

**Files:**
- Modify: `src/data/placeables/beamline-modules.js`
- Modify: `src/data/placeables/furnishings.js`
- Modify: `src/data/placeables/equipment.js`
- Modify: `src/data/components.js` — convert `COMPONENTS` export to a re-derivation from `PLACEABLES`
- Modify: `src/data/infrastructure.js` — convert `ZONE_FURNISHINGS` export the same way

**Approach:** Rather than hand-translating ~125 entries, the per-kind files import from the legacy registries, normalize each entry to the unified shape, and re-export. This keeps every existing consumer (mesh builders, beam graph code, economy code) working unchanged because `COMPONENTS[id]` and `ZONE_FURNISHINGS[id]` continue to return objects with the old shape — they're just **derived from** `PLACEABLES` instead of being the source of truth.

In a follow-up effort the per-kind files can be hand-rewritten with the unified shape directly and the legacy modules deleted. That's not part of this plan.

- [ ] **Step 1: Move the raw data into internal modules and rename the exports**

Rename `src/data/components.js` → `src/data/components.raw.js`:

```bash
git mv src/data/components.js src/data/components.raw.js
```

Inside `components.raw.js`, rename the export from `COMPONENTS` to `COMPONENTS_RAW`. The original file likely also exports `PARAM_DEFS` and possibly other names — leave those unchanged. Search for the line `export const COMPONENTS = {` and change it to `export const COMPONENTS_RAW = {`.

For `infrastructure.js`: it has many other exports (`INFRASTRUCTURE`, `WALL_TYPES`, etc.) so we don't rename the file. Instead, extract the `ZONE_FURNISHINGS` literal into a new file `src/data/zone-furnishings.raw.js`:

```javascript
// src/data/zone-furnishings.raw.js
export const ZONE_FURNISHINGS_RAW = {
  // ... cut and paste the entire ZONE_FURNISHINGS object literal from infrastructure.js
};
```

Then in `infrastructure.js`, delete the inline `export const ZONE_FURNISHINGS = { ... }` literal. Do NOT add a re-export here — the new derived `ZONE_FURNISHINGS` will be added in Step 5 below.

- [ ] **Step 2: Normalize entries in each per-kind file**

```javascript
// src/data/placeables/beamline-modules.js
import { COMPONENTS_RAW } from '../components.raw.js';

function normalize(raw) {
  // Beamline kind: COMPONENTS entries with placement === 'module'
  // OR connections to a beam pipe (anything not 'attachment' or isDrawnConnection).
  // For this plan we treat 'beamline' as: in COMPONENTS, not equipment-only.
  return {
    ...raw,
    kind: 'beamline',
    subW: raw.subW || (raw.gridW || 1) * 1, // gridW is already in tiles; subW is subtiles
    subH: raw.subL || raw.subH || (raw.gridH || 1) * 1,
  };
}

const BEAMLINE_IDS = Object.keys(COMPONENTS_RAW).filter(id => {
  const c = COMPONENTS_RAW[id];
  return c.placement === 'module' && !c.isDrawnConnection;
});

export const BEAMLINE_MODULE_DEFS = BEAMLINE_IDS.map(id => normalize(COMPONENTS_RAW[id]));
```

**IMPORTANT — units gotcha:** existing entries mix `subW`/`subL`/`subH` (subtile units) with `gridW`/`gridH` (tile units). The normalization MUST end up with `subW`/`subH` in subtiles. If an entry only has `gridW=2`, the normalized `subW` is `2 * 4 = 8`. If it has `subW=2`, normalized `subW` is `2`. Add the conversion below and verify with the magnetron entry (which has `subL: 2, subW: 2, gridW: 2, gridH: 2` — so the normalized result must be `subW: 2, subH: 2`, NOT `subW: 8, subH: 8`).

Replace the simple `subW` line above with:

```javascript
function toSubtiles(raw) {
  // Prefer explicit subtile dimensions if present.
  if (raw.subW != null && (raw.subL != null || raw.subH != null)) {
    return { subW: raw.subW, subH: raw.subL ?? raw.subH };
  }
  // Otherwise convert from grid (tile) units.
  return {
    subW: (raw.gridW ?? 1) * 4,
    subH: (raw.gridH ?? 1) * 4,
  };
}

function normalize(raw) {
  const { subW, subH } = toSubtiles(raw);
  return { ...raw, kind: 'beamline', subW, subH };
}
```

Apply the same `toSubtiles` helper in all three per-kind files. (Copy it into each file rather than importing — these files are tiny and copying keeps them self-contained.)

- [ ] **Step 3: Populate furnishings.js**

```javascript
// src/data/placeables/furnishings.js
import { ZONE_FURNISHINGS_RAW } from '../zone-furnishings.raw.js';

function toSubtiles(raw) {
  if (raw.subW != null && (raw.subL != null || raw.subH != null)) {
    return { subW: raw.subW, subH: raw.subL ?? raw.subH };
  }
  return { subW: (raw.gridW ?? 1) * 4, subH: (raw.gridH ?? 1) * 4 };
}

export const FURNISHING_DEFS = Object.values(ZONE_FURNISHINGS_RAW).map(raw => {
  const { subW, subH } = toSubtiles(raw);
  return { ...raw, kind: 'furnishing', subW, subH };
});
```

- [ ] **Step 4: Populate equipment.js**

The existing codebase tags equipment via the call site (`placeFacilityEquipment` passes `category: 'equipment'`), not via a field on the def. There's no clean per-entry marker. For the registry split, treat **everything in `COMPONENTS_RAW` whose `placement` is NOT `'module'`** as equipment. If that yields zero entries (because all of COMPONENTS uses `placement: 'module'` and equipment is purely a runtime tag), leave `EQUIPMENT_DEFS = []` and rely on the kind being inferred at the placement call site.

Verify by checking `COMPONENTS_RAW` for any entries without `placement: 'module'`. If there are none, the kind split is BEAMLINE vs FURNISHING only, and "equipment" is a synonym for "beamline placed via the equipment HUD button" — in which case `EQUIPMENT_DEFS = []` is correct and the `Equipment` class is unused (delete the class export if so).

```javascript
// src/data/placeables/equipment.js
import { COMPONENTS_RAW } from '../components.raw.js';

function toSubtiles(raw) {
  if (raw.subW != null && (raw.subL != null || raw.subH != null)) {
    return { subW: raw.subW, subH: raw.subL ?? raw.subH };
  }
  return { subW: (raw.gridW ?? 1) * 4, subH: (raw.gridH ?? 1) * 4 };
}

const EQUIPMENT_IDS = Object.keys(COMPONENTS_RAW).filter(id => {
  const c = COMPONENTS_RAW[id];
  return c.placement !== 'module' && !c.isDrawnConnection && c.placement !== 'attachment';
});

export const EQUIPMENT_DEFS = EQUIPMENT_IDS.map(id => {
  const raw = COMPONENTS_RAW[id];
  const { subW, subH } = toSubtiles(raw);
  return { ...raw, kind: 'equipment', subW, subH };
});
```

- [ ] **Step 5: Re-export legacy registries from PLACEABLES**

Create a new `src/data/components.js` (the original file is now `components.raw.js`):

```javascript
// src/data/components.js
//
// LEGACY SHIM: COMPONENTS was the source of truth before the unified
// PLACEABLES registry. It now re-derives from PLACEABLES so existing
// consumers (mesh builders, beam graph, economy) keep working.
// Do NOT add new entries here. Add them to src/data/placeables/.

import { PLACEABLES } from './placeables/index.js';

export const COMPONENTS = {};
for (const p of Object.values(PLACEABLES)) {
  if (p.kind === 'beamline' || p.kind === 'equipment') {
    COMPONENTS[p.id] = p;
  }
}

// Re-export every other named export from the raw module so existing
// consumers keep working unchanged. Update this list to match whatever
// components.raw.js actually exports (PARAM_DEFS is the main one).
export { PARAM_DEFS } from './components.raw.js';
```

**Verification step:** before committing, grep for everything imported from `components.js`:

```bash
grep -rn "from '.*data/components.js'" src/
grep -rn 'from ".*data/components.js"' src/
```

For every named import that appears in those results, ensure it is re-exported from the new `components.js`. If `components.raw.js` exports things like `RF_FREQUENCIES`, `BEAM_DIRECTIONS`, etc., add `export { RF_FREQUENCIES, BEAM_DIRECTIONS } from './components.raw.js';` to cover them.

In `src/data/infrastructure.js`, add at the top (alongside the existing imports):

```javascript
import { PLACEABLES } from './placeables/index.js';

export const ZONE_FURNISHINGS = {};
for (const p of Object.values(PLACEABLES)) {
  if (p.kind === 'furnishing') {
    ZONE_FURNISHINGS[p.id] = p;
  }
}
```

This restores the `ZONE_FURNISHINGS` export that Step 1 removed, but now derived from `PLACEABLES`.

- [ ] **Step 6: Smoke test**

Run: `npm run dev`. Open the game.
Expected:
- Game loads with no console errors
- Build menu still shows all components and furnishings
- Place a magnetron — works
- Place an oscilloscope — works (still using legacy code path)
- Place an RFQ-as-equipment — works

If any consumer breaks because of a missing field, find the missing field on the wrapped instance and add it back via the normalization step. The wrapped `Placeable` instance should be a structural superset of the legacy entry — `Object.assign(this, def)` in the constructor means every original field is still present.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(placeables): populate PLACEABLES registry; legacy COMPONENTS/ZONE_FURNISHINGS now re-derive from it"
```

---

## Task 5: Strip kind-branching from `Game.placePlaceable`

**Files:**
- Modify: `src/game/Game.js:1177-1317`

- [ ] **Step 1: Read the current `placePlaceable`**

Read `src/game/Game.js:1177-1317` to refresh context. The function currently branches on `category` for: def lookup (1180-1186), unlock check (1190), floor check (1217-1224), tier check (1235-1242), max-count check (1244-1253), id prefix (1256), beamline param init (1278-1291), and emit calls (1313-1314).

- [ ] **Step 2: Replace with the kind-agnostic version**

Replace lines 1177-1317 with:

```javascript
placePlaceable(opts) {
  const { type, col, row, subCol, subRow, dir = 0, params } = opts;

  const placeable = PLACEABLES[type];
  if (!placeable) return false;
  const kind = placeable.kind;

  if (!this.canAfford(placeable.cost)) {
    this.log(`Can't afford ${placeable.name}!`, 'bad');
    return false;
  }

  // The ONLY placement constraint: subtile footprint collision.
  const cells = placeable.footprintCells(col, row, subCol || 0, subRow || 0, dir);
  for (const c of cells) {
    const k = c.col + ',' + c.row + ',' + c.subCol + ',' + c.subRow;
    if (this.state.subgridOccupied[k]) {
      this.log('Space occupied!', 'bad');
      return false;
    }
  }

  // Allocate id.
  const prefix = kind === 'beamline' ? 'bl_' : kind === 'furnishing' ? 'fn_' : 'eq_';
  const id = prefix + this.state.placeableNextId++;

  this.spend(placeable.cost);

  const entry = {
    id,
    type,
    category: kind,            // legacy field name kept for downstream consumers
    kind,
    col,
    row,
    subCol: subCol || 0,
    subRow: subRow || 0,
    dir,
    params: null,
    cells,
  };

  // Beamline param init (was previously inline; only kind that needs it).
  if (kind === 'beamline') {
    entry.params = {};
    if (PARAM_DEFS[type]) {
      for (const [k, pdef] of Object.entries(PARAM_DEFS[type])) {
        if (!pdef.derived) entry.params[k] = pdef.default;
      }
    }
    if (placeable.params) {
      for (const [k, v] of Object.entries(placeable.params)) {
        if (!(k in entry.params)) entry.params[k] = v;
      }
    }
    if (params) Object.assign(entry.params, params);
  }

  this.state.placeables.push(entry);
  this.state.placeableIndex[id] = this.state.placeables.length - 1;

  for (const c of cells) {
    const k = c.col + ',' + c.row + ',' + c.subCol + ',' + c.subRow;
    this.state.subgridOccupied[k] = { id, kind };
  }

  placeable.onPlaced(this, entry);

  this.log(`Built ${placeable.name}`, 'good');
  this.computeSystemStats();
  this.emit('placeableChanged');
  if (kind === 'equipment') this.emit('facilityChanged');
  if (kind === 'furnishing') this.emit('zonesChanged');
  this._syncLegacyPlaceableState();
  return id;
}
```

Add `import { PLACEABLES } from '../data/placeables/index.js';` at the top of `Game.js` if not already imported. Keep `import { PARAM_DEFS } from '../data/components.js';` (still needed).

- [ ] **Step 3: Update `removePlaceable` similarly**

Read `src/game/Game.js:1322` onward. Replace the def lookup (lines 1330-1334) with:

```javascript
const placeable = PLACEABLES[entry.type];
if (!placeable) return false;
```

And replace `entry.category` references with `entry.kind` (kept as alias). Add a call to `placeable.onRemoved(this, entry)` before the cell-clearing loop.

- [ ] **Step 4: Smoke test**

Run: `npm run dev`. In the browser:
- Place a magnetron → should still place (collision is the only check)
- Place an oscilloscope on bare ground (no zone, no floor) → **should now succeed** where previously it would have been blocked by the floor check
- Place an oscilloscope overlapping a magnetron → should be blocked
- Delete a magnetron → should still delete cleanly
- Check console: no errors

If oscilloscope-on-bare-ground is rejected by the HUD click handler before reaching `placePlaceable`, that's fine — Task 8 fixes the HUD path. The Game-level smoke test here is purely "did the kind-branching come out without breaking the magnetron path."

- [ ] **Step 5: Commit**

```bash
git add src/game/Game.js
git commit -m "refactor(placeables): strip kind-branching from Game.placePlaceable; collision is the only constraint"
```

---

## Task 6: Add `removePlaceableById` and `removePlaceablesByKind`

**Files:**
- Modify: `src/game/Game.js`

- [ ] **Step 1: Verify the existing `removePlaceable`**

It already exists at `src/game/Game.js:1322` and takes a placeable id. Rename it to `removePlaceableById` if `removePlaceable` is ambiguous with the placement-time function, or leave the name. **Decision: keep `removePlaceable(placeableId)` as-is** — it's already the correct signature and naming.

- [ ] **Step 2: Add `removePlaceablesByKind`**

Add immediately after `removePlaceable`:

```javascript
/**
 * Remove every placed instance of a given kind. Used by the
 * "delete all furnishings" / "delete all beamline" UI tools.
 */
removePlaceablesByKind(kind) {
  const ids = this.state.placeables
    .filter(p => p.kind === kind || p.category === kind)
    .map(p => p.id);
  let n = 0;
  for (const id of ids) {
    if (this.removePlaceable(id)) n++;
  }
  return n;
}
```

- [ ] **Step 3: Smoke test**

Run: `npm run dev`. Open browser devtools console and run `game.removePlaceablesByKind('furnishing')` after placing a few oscilloscopes. They should all disappear. Same for `'beamline'`.

- [ ] **Step 4: Commit**

```bash
git add src/game/Game.js
git commit -m "feat(placeables): add removePlaceablesByKind for bulk delete by kind"
```

---

## Task 7: Add `ThreeRenderer.renderPlaceableGhost`

**Files:**
- Modify: `src/renderer3d/ThreeRenderer.js`

- [ ] **Step 1: Read existing ghost renderers**

Read `src/renderer3d/ThreeRenderer.js:1111-1140` (`renderComponentGhost`), `1219-1260` (`renderEquipmentGhost`), and `1280-1320` (`renderFurnishingGhost`) to understand mesh building, transparency, and positioning.

- [ ] **Step 2: Add the unified renderer**

Add a new method, located right above `renderComponentGhost`:

```javascript
/**
 * Unified ghost renderer for any placeable. Looks up the entry in
 * PLACEABLES, builds the same 3D mesh that the committed instance will
 * use, tints it green or red based on validity.
 *
 * @param {Object} hover - { id, col, row, subCol, subRow, dir }
 * @param {boolean} valid
 */
renderPlaceableGhost(hover, valid) {
  this._clearPreview();
  this._renderGridAroundCursor(hover.col, hover.row);

  const placeable = PLACEABLES[hover.id];
  if (!placeable) return;

  // Build mesh via the existing component builder. The builder takes a
  // legacy-shaped def, and PLACEABLES instances structurally extend that
  // shape (Object.assign in the Placeable constructor preserves all
  // original fields), so this works uniformly across kinds.
  const obj = this.componentBuilder._createObject(placeable);
  if (!obj) return;

  obj.traverse(child => {
    if (child.isMesh) {
      child.material = child.material.clone();
      child.material.transparent = true;
      child.material.opacity = 0.4;
      child.material.depthWrite = false;
      child.material.color.setHex(valid ? 0x44ff44 : 0xff4444);
      child.castShadow = false;
      child.receiveShadow = false;
    }
  });

  // Position: subtile-aware. Each subtile is 0.5m, each tile is 2m
  // (matching existing renderComponentGhost positioning math).
  const SUB_UNIT = 0.5;
  const tileX = hover.col * 2;
  const tileZ = hover.row * 2;
  const subOffsetX = hover.subCol * SUB_UNIT;
  const subOffsetZ = hover.subRow * SUB_UNIT;

  // Center the footprint on the origin subtile.
  const swap = hover.dir === 1 || hover.dir === 3;
  const w = (swap ? placeable.subH : placeable.subW) * SUB_UNIT;
  const l = (swap ? placeable.subW : placeable.subH) * SUB_UNIT;

  obj.position.set(tileX + subOffsetX + w / 2, 0, tileZ + subOffsetZ + l / 2);
  obj.rotation.y = -(hover.dir || 0) * (Math.PI / 2);

  this.previewGroup.add(obj);
}
```

Add `import { PLACEABLES } from '../data/placeables/index.js';` at the top of the file if not present.

**Note on positioning math:** The existing `renderComponentGhost` uses centering logic that's slightly different from the above (it uses `_createObject` and an internal positioning helper). If the unified ghost renders at the wrong position during the smoke test, **read** how `renderComponentGhost` does final positioning at lines ~1125-1140 and copy that exact logic into `renderPlaceableGhost`. Don't rewrite the positioning math from scratch — match the magnetron path that's known to work.

- [ ] **Step 3: Smoke test**

The new method is unused at this point. Run `npm run dev` — expect no errors. The visual test happens in Task 9 when InputHandler starts calling it.

- [ ] **Step 4: Commit**

```bash
git add src/renderer3d/ThreeRenderer.js
git commit -m "feat(placeables): add unified renderPlaceableGhost"
```

---

## Task 8: Unify selection state and rotation in `InputHandler`

**Files:**
- Modify: `src/input/InputHandler.js`

This task introduces the unified state but does NOT yet remove the legacy state. Both coexist briefly so the game keeps working. Task 9 removes the legacy state.

- [ ] **Step 1: Add unified state fields**

In the `InputHandler` constructor, add:

```javascript
this.selectedPlaceableId = null;  // unified selection (Task 9 makes it the only one)
this.hoverPlaceable = null;        // { id, col, row, subCol, subRow, dir } | null
// this.placementDir already exists and is reused.
```

- [ ] **Step 2: Add a setter that keeps legacy state in sync**

Add a method:

```javascript
selectPlaceable(id) {
  this.selectedPlaceableId = id;
  // Mirror into legacy fields so existing code paths still fire.
  // Removed in Task 9.
  const p = PLACEABLES[id];
  if (!p) {
    this.selectedTool = null;
    this.selectedFurnishingTool = null;
    this.selectedFacilityTool = null;
    return;
  }
  this.selectedTool = (p.kind === 'beamline') ? id : null;
  this.selectedFurnishingTool = (p.kind === 'furnishing') ? id : null;
  this.selectedFacilityTool = (p.kind === 'equipment') ? id : null;
}
```

Add `import { PLACEABLES } from '../data/placeables/index.js';` at the top.

- [ ] **Step 3: Make rotation unified**

Find the keyboard handler for `R` (likely around the same area as the Delete handler at line 1035). It currently increments `placementDir` for beamline and toggles `furnishingRotated` for furnishings. Replace both with: always increment `placementDir = (placementDir + 1) % 4`. Set `furnishingRotated = (placementDir % 2 === 1)` as a temporary bridge so the legacy furnishing path still mirrors the right state until Task 9 removes it.

- [ ] **Step 4: Smoke test**

Run `npm run dev`. Verify:
- Game loads, no console errors
- Existing build menu still works (it still sets the legacy state via its existing handlers)
- R key still rotates placement preview for beamline modules

- [ ] **Step 5: Commit**

```bash
git add src/input/InputHandler.js
git commit -m "feat(placeables): add unified selection state alongside legacy"
```

---

## Task 9: Collapse the three preview branches into one

**Files:**
- Modify: `src/input/InputHandler.js:1322-1366`

- [ ] **Step 1: Read the current preview block**

Read `src/input/InputHandler.js:1300-1380` to see the full mouse-move handler context.

- [ ] **Step 2: Replace the three preview branches**

Find the block that contains the equipment preview (line ~1322), beamline preview (line ~1331), and furnishing preview (line ~1345). Replace the entire three-branch block with a single unified branch:

```javascript
// Unified placeable preview. Replaces the previous three branches
// (equipment, beamline, furnishing).
if (this.selectedPlaceableId) {
  const placeable = PLACEABLES[this.selectedPlaceableId];
  if (placeable) {
    const snap = snapForPlaceable(world.x, world.y, placeable, this.placementDir);
    this.hoverPlaceable = {
      id: this.selectedPlaceableId,
      col: snap.col,
      row: snap.row,
      subCol: snap.subCol,
      subRow: snap.subRow,
      dir: this.placementDir,
    };
    const { ok } = canPlace(
      this.game,
      placeable,
      snap.col, snap.row, snap.subCol, snap.subRow,
      this.placementDir,
    );
    this.renderer.renderPlaceableGhost(this.hoverPlaceable, ok);
  }
} else {
  this.hoverPlaceable = null;
}
```

Add at the top of the file:

```javascript
import { snapForPlaceable, canPlace } from '../game/placement.js';
```

- [ ] **Step 3: Replace the three commit branches at lines 832-849**

Find the click handler block at `src/input/InputHandler.js:832-849`. Replace all three commit branches (beamline at 832, equipment at 847, furnishing at 849) with a single commit:

```javascript
if (this.hoverPlaceable) {
  this.game.placePlaceable({
    type: this.hoverPlaceable.id,
    col: this.hoverPlaceable.col,
    row: this.hoverPlaceable.row,
    subCol: this.hoverPlaceable.subCol,
    subRow: this.hoverPlaceable.subRow,
    dir: this.hoverPlaceable.dir,
    params: this.selectedParamOverrides,
  });
}
```

Note: this drops the `category` field from the call. `Game.placePlaceable` (after Task 5) infers kind from the registry entry.

- [ ] **Step 4: Smoke test**

Run `npm run dev`. The HUD click handlers still set the legacy `selectedTool` / `selectedFurnishingTool` / `selectedFacilityTool` fields. Until Task 10 wires the HUD to call `selectPlaceable`, the unified preview path won't trigger. To smoke test now:

In browser devtools, after selecting any item from the build menu, manually run:
```js
inputHandler.selectPlaceable('magnetron')
```
Then move the mouse over the map. Expect to see the unified ghost. Click. Expect a magnetron to be placed.

Try:
```js
inputHandler.selectPlaceable('oscilloscope')
```
Same expectations.

If the ghost appears at a wrong position, see the positioning note in Task 7 step 2.

- [ ] **Step 5: Commit**

```bash
git add src/input/InputHandler.js
git commit -m "refactor(placeables): collapse three preview/commit branches into unified path"
```

---

## Task 10: Wire HUD to use `selectPlaceable`; add per-kind delete

**Files:**
- Modify: `src/renderer/hud.js:787-900` (build menu click handlers)
- Modify: `src/renderer/hud.js` (add per-kind delete buttons)

- [ ] **Step 1: Read current HUD build menu**

Read `src/renderer/hud.js:780-910`. The COMPONENTS listing is at line ~893, the ZONE_FURNISHINGS listing at ~787. Each has its own click handler that sets one of the legacy selection fields.

- [ ] **Step 2: Replace click handlers**

In every click handler that currently does one of:
- `inputHandler.selectedTool = key`
- `inputHandler.selectedFurnishingTool = key`
- `inputHandler.selectedFacilityTool = key`

Replace with:
```javascript
inputHandler.selectPlaceable(key);
```

- [ ] **Step 3: Add per-kind delete buttons**

Find where the demolish/delete UI is rendered in `hud.js` (likely a tool palette or top bar). Add three buttons:

```javascript
// Per-kind bulk delete buttons.
const bulkDeleteRow = document.createElement('div');
bulkDeleteRow.className = 'bulk-delete-row';
for (const kind of ['beamline', 'furnishing', 'equipment']) {
  const btn = document.createElement('button');
  btn.textContent = `Delete all ${kind}`;
  btn.onclick = () => {
    if (confirm(`Delete all ${kind} placeables? This cannot be undone.`)) {
      const n = game.removePlaceablesByKind(kind);
      game.log(`Removed ${n} ${kind} placeables`, 'good');
    }
  };
  bulkDeleteRow.appendChild(btn);
}
// Append bulkDeleteRow to the appropriate parent panel.
```

Place this in whatever section of the HUD makes sense — the existing "demolish" or "tools" panel is a reasonable home. If unsure, put it in the same panel as the existing context-demolish toggle.

- [ ] **Step 4: Smoke test**

Run `npm run dev`:
- Click magnetron in build menu → ghost appears, click to place → succeeds
- Click oscilloscope → ghost appears, click on bare ground (no floor) → **succeeds** (this is the new behavior)
- Click oscilloscope and place several → click "Delete all furnishing" button → all oscilloscopes vanish
- Place a magnetron, click "Delete all beamline" → magnetron vanishes
- R key rotates the ghost for all kinds

- [ ] **Step 5: Commit**

```bash
git add src/renderer/hud.js
git commit -m "feat(placeables): wire HUD to unified selection; add per-kind bulk delete"
```

---

## Task 11: Unify the click-to-delete tool

**Files:**
- Modify: `src/input/InputHandler.js` (around line 2577 — `_toggleContextDemolish` and related)

- [ ] **Step 1: Read current delete logic**

Read `src/input/InputHandler.js:2570-2620` and any code paths it dispatches into. The existing `_toggleContextDemolish` detects type (floor/zone/furnishing/wall/door/beamline/connection) and routes to a kind-specific delete tool.

- [ ] **Step 2: Add a unified placeable delete path**

Inside `_toggleContextDemolish` (or wherever the demolish click handler runs), find the branches that handle furnishing-deletion, equipment-deletion, and beamline-component-deletion. Replace all three with a single subgrid hover-probe:

```javascript
// Unified placeable delete: look up whatever instance occupies the
// subtile under the cursor and remove it. Floor/wall/door/connection
// branches are unchanged.
const snap = snapWorldToSubgrid(world.x, world.y);
const cellKey = snap.col + ',' + snap.row + ',' + snap.subCol + ',' + snap.subRow;
const occ = this.game.state.subgridOccupied[cellKey];
if (occ) {
  this.game.removePlaceable(occ.id);
  return;
}
```

Add `import { snapWorldToSubgrid } from '../game/placement.js';` if not already imported (Task 9 imported `snapForPlaceable` and `canPlace`; add this one too).

- [ ] **Step 3: Smoke test**

Run `npm run dev`:
- Place a magnetron, an oscilloscope, and an equipment item
- Press Delete or Backspace on each → each one removes correctly
- The walls, doors, and floor demolish behavior should be unchanged

- [ ] **Step 4: Commit**

```bash
git add src/input/InputHandler.js
git commit -m "refactor(placeables): unify click-to-delete via subgrid hover-probe"
```

---

## Task 12: Delete dead code

**Files:**
- Modify: `src/input/InputHandler.js`
- Modify: `src/game/Game.js`
- Modify: `src/renderer3d/ThreeRenderer.js`

- [ ] **Step 1: Delete legacy selection fields and rotation state in InputHandler**

Remove from the constructor and from `selectPlaceable`:
- `this.selectedTool` (search for all reads/writes — must all be gone)
- `this.selectedFurnishingTool`
- `this.selectedFacilityTool`
- `this.furnishingRotated`
- `this.hoverCompSnap`
- `this.hoverFurnishing*`
- `this.hoverSubCol`, `this.hoverSubRow` (if only used by furnishing path)

For each: grep the file for the field name. If any reads remain that aren't in the dead branches, leave the field and add a TODO comment — those reads belong to a path that wasn't fully migrated.

Delete `_computeModuleSubSnap` (line 609) — replaced by `snapForPlaceable`.

Simplify `selectPlaceable` to drop the legacy mirror:

```javascript
selectPlaceable(id) {
  this.selectedPlaceableId = id;
}
```

- [ ] **Step 2: Delete legacy ghost renderers in ThreeRenderer**

Delete:
- `renderComponentGhost` (line 1111)
- `renderEquipmentGhost` (line 1219)
- `renderFurnishingGhost` (line 1280)

Grep the codebase first: `grep -rn 'renderComponentGhost\|renderEquipmentGhost\|renderFurnishingGhost' src/` to confirm there are no remaining callers. If any exist, they're leftover from Tasks 9-11 — fix them to call `renderPlaceableGhost` instead.

- [ ] **Step 3: Delete legacy placement wrappers in Game.js**

Delete:
- `placeFacilityEquipment` (line 1135)
- `removeFacilityEquipment` (line 1147)
- `placeZoneFurnishing` (line 1153)
- `removeZoneFurnishing` (line 1165)

Grep for callers: `grep -rn 'placeFacilityEquipment\|placeZoneFurnishing\|removeFacilityEquipment\|removeZoneFurnishing' src/`. Replace any remaining callers with the unified `placePlaceable` / `removePlaceable`.

- [ ] **Step 4: Smoke test**

Run `npm run dev`:
- Full smoke checklist (see Task 13)
- Console must be clean

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(placeables): delete legacy ghost renderers, wrappers, and selection state"
```

---

## Task 13: Final smoke test and verification

**Files:** (none — verification only)

This task is the gate before declaring the migration complete. It is intentionally a checklist, not code.

- [ ] **Step 1: Browser smoke test**

Run `npm run dev`. In a fresh browser load (cleared local storage), run the following checks. Each must pass.

**Placement (footprint collision is the only constraint):**
- [ ] Place a magnetron on bare ground (no floor) — succeeds
- [ ] Place an oscilloscope on bare ground — succeeds
- [ ] Place a magnetron, then try to place another magnetron overlapping it — rejected with "Space occupied!"
- [ ] Place a magnetron, then try to place an oscilloscope overlapping its subtiles — rejected
- [ ] Place an oscilloscope, then a magnetron next to it (no overlap) — both succeed
- [ ] Place an equipment-kind item — succeeds
- [ ] Place an equipment-kind item overlapping a magnetron — rejected

**Rotation:**
- [ ] Select a non-square beamline module (e.g. RFQ if it's non-square; or any with `subW != subH`). Press R four times. The ghost rotates through all four orientations.
- [ ] Same for an oscilloscope (or any furnishing with non-square footprint, if any).
- [ ] Same for an equipment item.
- [ ] After R rotates the footprint, collision detection still works (rotated long-axis blocks placement that would overlap).

**Delete (single-click):**
- [ ] Click-delete on a magnetron — removes
- [ ] Click-delete on an oscilloscope — removes
- [ ] Click-delete on equipment — removes

**Delete (bulk by kind):**
- [ ] Place 3 magnetrons, 2 oscilloscopes, 1 equipment item
- [ ] "Delete all furnishing" → only oscilloscopes vanish
- [ ] "Delete all beamline" → only magnetrons vanish
- [ ] "Delete all equipment" → only equipment vanishes

**Beam pipes (regression check):**
- [ ] Draw a beam pipe between two magnetrons — works as before
- [ ] Place a pipe attachment (something with `placement: 'attachment'`) onto a pipe — works as before
- [ ] Beam pipe rendering, flanges, support stands — unchanged

**Console:**
- [ ] No errors during any of the above
- [ ] No deprecation warnings about removed legacy fields

- [ ] **Step 2: Codebase grep verification**

Run these greps. Each should return zero results (or only results inside `components.raw.js` / `zone-furnishings.raw.js`, which is fine):

```bash
grep -rn 'placeZoneFurnishing\|placeFacilityEquipment\|removeFacilityEquipment\|removeZoneFurnishing' src/
grep -rn 'renderComponentGhost\|renderEquipmentGhost\|renderFurnishingGhost' src/
grep -rn '_computeModuleSubSnap' src/
grep -rn 'selectedFurnishingTool\|selectedFacilityTool\|furnishingRotated' src/
grep -rn 'hoverCompSnap\|hoverFurnishing' src/
```

If any of these return code-path hits (not raw-data files, not comments), file a follow-up task — the migration is incomplete.

- [ ] **Step 3: Final commit (if grep cleanup found stragglers)**

```bash
git add -A
git commit -m "chore(placeables): clean up final stragglers from unification"
```

---

## Out of scope (do not implement in this plan)

- Beam pipe drawing UX changes
- Pipe attachment snap behavior changes
- Utility pipes
- HUD/menu visual redesign beyond the bulk-delete buttons in Task 10
- Cost rebalancing
- Save migration
- Hand-rewriting the per-kind data files to drop the `components.raw.js` / `zone-furnishings.raw.js` shim layer (this is a follow-up that becomes safe once everything in this plan ships)
- Tier-based unlocking enforcement at the placement layer (HUD-level filtering still works; Game.placePlaceable no longer checks tiers)
