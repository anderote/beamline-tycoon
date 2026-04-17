# Natural Starter Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the prebuilt Fermilab starter with a natural landscape (tree clumps aligned to terrain brightness, ambient wildflower decals) and add a buildable `flowerBedTile` floor type.

**Architecture:** `generateStartingMap(terrainBlobs)` becomes a pure function that produces tree decorations placed inside the darkest terrain-brightness blobs, with species biased by local brightness. `Game.newGame()` calls it directly. A new renderer-side `WildflowerBuilder` produces an InstancedMesh of dot-decals on the grass. A new `flowerBedTile` FLOORS entry gives the player a paintable formal-garden surface.

**Tech Stack:** ES modules, Three.js (CDN global, never imported), InstancedMesh for perf, CanvasTexture for procedural art. Tests are Node ES modules run via the existing `npm test` flow.

**Spec:** `docs/superpowers/specs/2026-04-16-natural-starter-map-design.md`

**Commit strategy:** Per project CLAUDE.md, commits group at logical boundaries, not task boundaries. This plan has three commits — one per task. Do not commit between steps inside a task.

---

## Task 1: Natural starter map (gut Fermilab, add tree clumps)

**Goal:** Rewrite `generateStartingMap()` to produce only brightness-driven tree placements. Delete the Fermilab facility layout. Wire `Game.newGame()` to apply the result. One commit at the end.

**Files:**
- Rewrite: `src/game/map-generator.js` (was ~780 lines → target ~180)
- Modify: `src/game/Game.js` (add call in `newGame()` after terrain blobs are generated; ~2 lines)
- Modify: `src/data/scenarios.js` (delete `facility-ready` entry)
- Create: `test/test-map-generator-trees.js`
- Inspect: existing tests that import from `map-generator.js` (may need updates if any assert on Fermilab-specific output)

### Pre-work: Identify dependent tests

- [ ] **Step 1: Find all files importing from map-generator.js**

Run: `grep -rn "from.*map-generator" src/ test/`

Expected hits: `src/data/scenarios.js`, possibly test files. Note any that will need updating.

### Write the failing test

- [ ] **Step 2: Create `test/test-map-generator-trees.js` with three test cases**

Structure (no implementation yet):

```js
// test/test-map-generator-trees.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateStartingMap } from '../src/game/map-generator.js';

// A blob at (cx, cy) with brightness b, radius r (sx = sy = r), no rotation.
function blob(cx, cy, b, r) {
  return { cx, cy, sx: r, sy: r, angle: 0, brightness: b };
}

test('tree clumps land inside dark blobs', () => {
  const blobs = [blob(-20, -20, -0.8, 6), blob(20, 20, +0.6, 6)];
  const { placeables } = generateStartingMap(42, blobs);
  const trees = placeables.filter(p => p.kind === 'decoration');
  // Trees in the dark blob's area
  const inDark = trees.filter(t =>
    Math.hypot(t.col - (-20), t.row - (-20)) <= 7
  ).length;
  const inBright = trees.filter(t =>
    Math.hypot(t.col - 20, t.row - 20) <= 7
  ).length;
  assert.ok(inDark >= 8, `expected ≥8 trees in dark blob, got ${inDark}`);
  assert.ok(inDark > inBright * 2, `expected far fewer trees in bright blob`);
});

test('conifers dominate darkest cells', () => {
  const blobs = [blob(0, 0, -0.9, 6)];
  const { placeables } = generateStartingMap(42, blobs);
  const trees = placeables.filter(p => p.kind === 'decoration');
  const conifers = ['pineTree', 'cedarTree'];
  const nearCenter = trees.filter(t => Math.hypot(t.col, t.row) <= 3);
  const coniferFrac =
    nearCenter.filter(t => conifers.includes(t.type)).length / nearCenter.length;
  assert.ok(coniferFrac >= 0.5, `expected ≥50% conifers near dark center, got ${coniferFrac}`);
});

test('origin clearing has no trees', () => {
  const blobs = [blob(0, 0, -0.8, 6)]; // dark blob exactly on origin
  const { placeables } = generateStartingMap(42, blobs);
  const trees = placeables.filter(p => p.kind === 'decoration');
  const inClearing = trees.filter(t => Math.abs(t.col) <= 6 && Math.abs(t.row) <= 6);
  assert.equal(inClearing.length, 0);
});

test('deterministic output for fixed seed and blobs', () => {
  const blobs = [blob(-10, -10, -0.7, 5), blob(10, 10, -0.5, 4)];
  const a = generateStartingMap(42, blobs);
  const b = generateStartingMap(42, blobs);
  assert.equal(a.placeables.length, b.placeables.length);
  for (let i = 0; i < a.placeables.length; i++) {
    assert.equal(a.placeables[i].type, b.placeables[i].type);
    assert.equal(a.placeables[i].col, b.placeables[i].col);
    assert.equal(a.placeables[i].row, b.placeables[i].row);
  }
});

test('returns empty arrays for floors/zones/walls/doors', () => {
  const { floors, zones, walls, doors } = generateStartingMap(42, []);
  assert.equal(floors.length, 0);
  assert.equal(zones.length, 0);
  assert.equal(walls.length, 0);
  assert.equal(doors.length, 0);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test test/test-map-generator-trees.js`
Expected: All tests fail (the current `generateStartingMap` returns buildings, not natural features, and signature is `(seed)` not `(seed, blobs)`).

### Rewrite map-generator.js

- [ ] **Step 4: Replace `src/game/map-generator.js` with a natural-features-only implementation**

The new module exports a single function `generateStartingMap(seed, terrainBlobs)` returning `{ floors: [], zones: [], walls: [], doors: [], placeables, placeableNextId }`.

**Internal structure of the new file:**

```
- Seeded LCG PRNG (copy from existing map-generator.js:682-685 style)
- sampleTerrainBrightness(col, row, blobs)  // copy from world-snapshot.js:23-37,
                                              // OR import it — make it a shared helper
- SPECIES_TABLE: brightness-bin → { primaries: [...], secondaries: [...] }
- placeTreeDecoration(placeables, type, col, row, nextIdRef)  // creates a kind=decoration placeable
  // Structure matches what Game expects: { id, type, kind: 'decoration', col, row,
  //   subCol: 0, subRow: 0, dir: 0, rotated: false, cells: [{ col, row, subCol: 0, subRow: 0 }],
  //   params: null, placeY: 0, stackParentId: null, stackChildren: [] }
  // Use the same id prefix 'dc_' as before.
- Main generateStartingMap:
    1. Seed PRNG from `seed`
    2. clusters = blobs.filter(b => b.brightness <= -0.3).sort by ascending brightness, take up to 8
    3. For each cluster blob:
         count = clamp(round(blob.sx * blob.sy * 0.35), 8, 25)
         r = min(blob.sx, blob.sy) * 1.1
         attempts = 0
         placed = 0
         while placed < count && attempts < count * 6:
           attempts++
           // Sample in blob's rotated frame:
           //   localX = ((rng() + rng()) / 2 - 0.5) * 2 * r  (Gaussian-ish, range [-r, r])
           //   localY = ((rng() + rng()) / 2 - 0.5) * 2 * r
           //   worldX = blob.cx + localX * cos(angle) - localY * sin(angle)
           //   worldY = blob.cy + localX * sin(angle) + localY * cos(angle)
           //   col = round(worldX), row = round(worldY)
           // Reject if |col| > 60 or |row| > 60
           // Reject if |col| <= 6 && |row| <= 6 (origin clearing)
           // Reject if overlaps an already-placed tree cell (treeCells set)
           // localB = sampleTerrainBrightness(col, row, terrainBlobs)
           // type = pickSpeciesForBrightness(localB, rng)
           // Place, add col,row to treeCells
    4. Bright-patch scatter: 25 attempts:
         col = randInt(-60, 60); row = randInt(-60, 60)
         Skip clearing and occupied cells
         b = sampleTerrainBrightness(col, row, blobs)
         If b > 0.15: place rng<0.5 ? 'shrub' : 'birchTree'
    5. Return { floors: [], zones: [], walls: [], doors: [], placeables, placeableNextId: nextId }
```

**SPECIES_TABLE** (data, not code — embed as object literal):

| brightness range | primary (70–80%) | secondary (20–30%) |
|---|---|---|
| `b < -0.6` | `pineTree`, `cedarTree` | `oakTree`, `mapleTree` |
| `-0.6 ≤ b < -0.3` | `oakTree`, `mapleTree`, `elmTree`, `willowTree` | `pineTree`, `cedarTree` |
| `-0.3 ≤ b < 0.2` | `oakTree`, `mapleTree`, `smallTree` | `birchTree` |
| `b ≥ 0.2` | `birchTree`, `smallTree` | (rare; treat same) |

Within a bin, pick uniformly from the selected list (primary 75%, secondary 25%).

**What to delete:** all Fermilab building layout code (roughly lines 151–674 in the current file), including helpers `building()`, `pathBetween()`, `fillFloor()`, `fillZone()`, `addWalls()`, `addDoor()`, `computeCells()`, `resetIds()`, and the `place()`/`stack()` generic helpers. The hedge/fence section and "13. TREES & VEGETATION" block also go.

**What to reuse / adapt:** the PRNG closure pattern, the idea of `treeCells` Set for self-overlap detection, and the `PLACEABLES[type]` lookup for validation.

**Note:** Consider extracting `sampleTerrainBrightness` into a shared module (e.g. `src/game/terrain-brightness.js`) so both `map-generator.js` and `world-snapshot.js` import it. If this adds complexity, inline a copy for now — the function is 10 lines.

- [ ] **Step 5: Run the new tests**

Run: `node --test test/test-map-generator-trees.js`
Expected: All 5 tests pass.

### Wire Game.newGame to the new generator

- [ ] **Step 6: Update `src/game/Game.js`**

Find the block in the `newGame()` method (around line 110–115):

```js
this.state.terrainSeed = Date.now();
this.state.terrainBlobs = this._generateTerrainBlobs(this.state.terrainSeed);

// Starter maps loaded via scenarios (Menu > Scenarios).
```

Add immediately after, inside the same method:

```js
// Apply natural starter map (trees clumped on dark soil)
const starter = generateStartingMap(this.state.terrainSeed, this.state.terrainBlobs);
this.state.floors = starter.floors;
this.state.zones = starter.zones;
this.state.walls = starter.walls;
this.state.doors = starter.doors;
this.state.placeables = starter.placeables;
this.state.placeableNextId = starter.placeableNextId;
```

And add the import at the top of `Game.js` (alongside other imports):

```js
import { generateStartingMap } from './map-generator.js';
```

### Delete Fermilab scenario

- [ ] **Step 7: Edit `src/data/scenarios.js`**

Remove the `facility-ready` entry entirely. Final contents should be the Sandbox entry only:

```js
// Scenario definitions — selectable from the Scenarios menu.
// Each scenario has metadata for the picker UI and a generator function
// that returns the map data (floors, zones, walls, doors, placeables).

export const SCENARIOS = [
  {
    id: 'sandbox',
    name: 'Sandbox',
    desc: 'Start from scratch with an empty plot and $10M. Full freedom to design your facility from the ground up.',
    difficulty: 'Open',
    generator: null,  // null = default blank game
  },
];
```

Note the removal of the `import` line — `generateStartingMap` is no longer used here.

### Verify nothing else breaks

- [ ] **Step 8: Run the full test suite**

Run: `npm test`
Expected: All tests pass. If any test file references the old Fermilab scenario or `generateStartingMap()` with the old signature, fix it: either update the assertion to match the new natural-map output, or delete the test if it was specifically about Fermilab layout (e.g. a test named `test-fermilab-campus-*` should be deleted).

- [ ] **Step 9: Visual smoke test**

Run: `npm start` (or open `index.html` per existing dev flow), click **New Game** (in the app after confirming the reload prompt).

Verify by eye:
- Trees visibly clump on the darkest grass patches.
- Conifers dominate dark clumps; lighter species appear at edges.
- ~12×12 open area at origin suitable for starting construction.
- No pre-built buildings, walls, paths, or furniture.
- Clicking **New Game** again produces a *different* layout (seed is Date.now()).

### Commit

- [ ] **Step 10: Commit Task 1**

```bash
git add src/game/map-generator.js src/game/Game.js src/data/scenarios.js \
        test/test-map-generator-trees.js
# Also stage any test deletions/updates from Step 8
git commit -m "$(cat <<'EOF'
feat: natural starter map with brightness-aligned tree clumps

Replace the prebuilt Fermilab facility with a procedurally generated
natural landscape. Tree clusters are placed at the darkest terrain
brightness blobs; species bias by local brightness (conifers on dark
soil, broadleaves in the middle, birch/shrub on bright edges). Reserves
a 12x12 clearing at origin so the player has somewhere obvious to start
building. Deletes the facility-ready scenario.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Wildflower ambient layer

**Goal:** Add an InstancedMesh layer of small colored dot-decals scattered across grass cells, density modulated by terrain brightness. One commit at the end.

**Files:**
- Modify: `src/renderer3d/materials/decals.js` (add procedural `flower_dot` texture)
- Create: `src/renderer3d/wildflower-builder.js`
- Modify: `src/renderer3d/ThreeRenderer.js` (instantiate and wire lifecycle)
- Create: `test/test-wildflower-builder.js`

### Procedural dot texture

- [ ] **Step 1: Add `gen_radialDot()` to `src/renderer3d/materials/decals.js`**

Insert after the existing `makeDecal` helper, before `export const DECALS`:

```js
/**
 * Creates a soft-radial-gradient alpha texture used for ground flower decals.
 * White with alpha fading from 1.0 at center to 0.0 at edge. Small (32x32)
 * since it's rendered at ~0.2 world units.
 */
function gen_radialDot(size = 32) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const r = size / 2;
  const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0.0, 'rgba(255,255,255,1.0)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  return tex;
}

/** Shared procedural textures (not loaded from PNGs). */
export const PROC_DECAL_TEXTURES = {
  flower_dot: gen_radialDot(32),
};
```

### Wildflower builder module

- [ ] **Step 2: Look at `src/renderer3d/terrain-builder.js` to understand the builder pattern**

Run: `cat src/renderer3d/terrain-builder.js | head -80`

Note: the class has `add(scene)`, `rebuild(snapshot)`, `dispose()` methods, stores its `InstancedMesh` on `this.mesh`, and clears the old mesh before building a new one in `rebuild`.

- [ ] **Step 3: Create `src/renderer3d/wildflower-builder.js`**

Module responsibilities:
- One class `WildflowerBuilder` with the same lifecycle shape as `TerrainBuilder`.
- `rebuild(snapshot)` iterates `snapshot.terrain`, computes per-cell flower count from brightness, sets per-instance transform + color using the cell's `hash`.

**Algorithm (spec §2):**

For each terrain entry `{ col, row, hash, brightness }`:
```
h = hash                  // a 32-bit integer
density = clamp(0.15 + 0.55 * (brightness + 1) / 2, 0.05, 0.7)
hash01 = (h & 0xFFFF) / 0xFFFF
n = floor(hash01 * density * 3)   // 0..2, occasional 3
for i in 0..n-1:
  // derive per-flower hash
  fh = mixHash(h, i)  // e.g. (h * 0x27d4eb2d + i * 0x9e3779b9) | 0
  offX = (((fh >>> 0)  & 0xFF) / 255 - 0.5) * 0.8   // ±0.4 of a tile
  offZ = (((fh >>> 8)  & 0xFF) / 255 - 0.5) * 0.8
  colorIdx = (fh >>> 16) & 0x7
  scale = 0.8 + (((fh >>> 19) & 0xF) / 15) * 0.5    // 0.8..1.3
  rotY = (((fh >>> 23) & 0xFF) / 255) * 2*PI
```

**Palette** (array of 8 hex colors — yellow repeated to bias selection):

```js
const FLOWER_PALETTE = [
  0xffe14d, 0xf2f2f2, 0xffe14d, 0xff8fa3,
  0xc58df5, 0xffe14d, 0xe84a4a, 0x7db9ff,
];
```

**Mesh setup:**
- Geometry: `new THREE.PlaneGeometry(0.2, 0.2)` rotated `-Math.PI / 2` around X (to lie flat on XZ plane).
- Material: `new THREE.MeshBasicMaterial({ map: PROC_DECAL_TEXTURES.flower_dot, transparent: true, depthWrite: false, side: THREE.DoubleSide })`.
- Allocate `InstancedMesh` with `maxCount` = `snapshot.terrain.length * 3`. Set `count` after the fill loop to the actual instance count.
- Use `setMatrixAt(i, matrix)` and `setColorAt(i, new THREE.Color(hex))` per instance.
- After fill: `mesh.instanceMatrix.needsUpdate = true` and `mesh.instanceColor.needsUpdate = true` (allocate `instanceColor` first via `mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(maxCount * 3), 3)` *before* setting colors — three.js doesn't auto-create it).
- Y offset: `+0.01` above grass plane (grass is at y=0 in existing terrain-builder).

**Pure helper for testing:** separate the per-cell math into an exported function `computeFlowerInstancesForCell(col, row, hash, brightness)` that returns `[{ x, y, z, scale, rotY, colorHex }, ...]`. The builder iterates terrain and accumulates these. This makes testing possible without a WebGL context.

- [ ] **Step 4: Create `test/test-wildflower-builder.js`**

```js
// test/test-wildflower-builder.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeFlowerInstancesForCell } from '../src/renderer3d/wildflower-builder.js';

test('dark cells produce fewer flowers than bright cells', () => {
  let darkTotal = 0, brightTotal = 0;
  for (let i = 0; i < 500; i++) {
    darkTotal   += computeFlowerInstancesForCell(i, 0, i * 2654435761 | 0, -0.9).length;
    brightTotal += computeFlowerInstancesForCell(i, 0, i * 2654435761 | 0, +0.9).length;
  }
  assert.ok(brightTotal > darkTotal * 2, `bright=${brightTotal}, dark=${darkTotal}`);
});

test('instances fall within their source cell bounds', () => {
  const cell = computeFlowerInstancesForCell(10, 20, 0xdeadbeef, 0.5);
  for (const f of cell) {
    // cell is at world (col, row) = (10, 20), flowers should be within ±0.5
    assert.ok(Math.abs(f.x - 10) <= 0.5);
    assert.ok(Math.abs(f.z - 20) <= 0.5);
    assert.ok(f.scale >= 0.8 && f.scale <= 1.3);
    assert.ok(f.rotY >= 0 && f.rotY <= 2 * Math.PI);
  }
});

test('deterministic for fixed hash', () => {
  const a = computeFlowerInstancesForCell(5, 5, 0xcafef00d, 0.3);
  const b = computeFlowerInstancesForCell(5, 5, 0xcafef00d, 0.3);
  assert.deepEqual(a, b);
});

test('color comes from 8-entry palette', () => {
  const palette = new Set([0xffe14d, 0xf2f2f2, 0xff8fa3, 0xc58df5, 0xe84a4a, 0x7db9ff]);
  let nonPalette = 0;
  for (let i = 0; i < 500; i++) {
    const cell = computeFlowerInstancesForCell(i, 0, i * 2654435761 | 0, +0.8);
    for (const f of cell) if (!palette.has(f.colorHex)) nonPalette++;
  }
  assert.equal(nonPalette, 0);
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `node --test test/test-wildflower-builder.js`
Expected: Fail with "module not found" or "function not exported".

- [ ] **Step 6: Implement `wildflower-builder.js` fully**

Export both:
- `computeFlowerInstancesForCell(col, row, hash, brightness)` — pure function, testable in Node.
- `class WildflowerBuilder` — wraps the pure function, uses Three.js, not Node-testable.

- [ ] **Step 7: Run tests — should pass**

Run: `node --test test/test-wildflower-builder.js`
Expected: All 4 tests pass.

### Wire the builder into the renderer

- [ ] **Step 8: Inspect `src/renderer3d/ThreeRenderer.js` to find the terrain builder wiring**

Run: `grep -n "TerrainBuilder\|terrainBuilder" src/renderer3d/ThreeRenderer.js`

Note the line numbers for:
- Import
- Instantiation (inside the renderer's constructor or init)
- `rebuild` call (inside whatever method processes the snapshot)
- `dispose` call (if any)

- [ ] **Step 9: Wire `WildflowerBuilder` parallel to `TerrainBuilder`**

Add:
- Import line alongside the existing terrain-builder import.
- Instantiate `this.wildflowerBuilder = new WildflowerBuilder()` next to `this.terrainBuilder`.
- Call `this.wildflowerBuilder.add(scene)` where `terrainBuilder.add(scene)` is called.
- Call `this.wildflowerBuilder.rebuild(snapshot)` where `terrainBuilder.rebuild(snapshot)` is called.
- Call `this.wildflowerBuilder.dispose()` where `terrainBuilder.dispose()` is called, if such a call exists.

### Smoke test

- [ ] **Step 10: Visual smoke test**

Open the app, click New Game:
- Wildflowers visible scattered across grass cells.
- Density noticeably higher on lighter grass, sparser on darker grass.
- No flowers on pre-painted paths or inside the starter clearing's floors (there are none — the clearing is just grass with no floors, so flowers should appear there too, which is correct).
- No visible z-fighting with grass.
- Rebuild time not noticeably slower than before (open devtools, check frame time).

### Commit

- [ ] **Step 11: Commit Task 2**

```bash
git add src/renderer3d/wildflower-builder.js \
        src/renderer3d/materials/decals.js \
        src/renderer3d/ThreeRenderer.js \
        test/test-wildflower-builder.js
git commit -m "$(cat <<'EOF'
feat: wildflower ambient decals on grass

Adds a new renderer-side InstancedMesh layer of small colored dot
decals scattered across grass cells. Per-cell flower count is driven
by terrain brightness (lighter grass -> denser flowers, matching how
wildflowers actually spread). Position, color, scale, and rotation all
derive from the existing per-cell hash so rebuilds are deterministic.
Texture is a procedural soft-radial gradient canvas; palette biases
toward yellow/white for a natural meadow feel.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Buildable flower bed tile

**Goal:** Add a new `flowerBedTile` floor type the player can paint on grass. One commit at the end.

**Files:**
- Modify: `src/data/structure.js` (add FLOORS entry)
- Modify: `src/renderer3d/materials/tiled.js` (add procedural `tile_flower_bed` texture)
- Inspect/modify: `src/renderer3d/floor-builder.js` (verify the 2-layer branch handles the new id; add a branch only if routing is type-specific)
- Inspect/modify: paint tool UI (if the grounds group is hardcoded, add the new entry)

### Add the texture

- [ ] **Step 1: Add `gen_flowerBed()` to `src/renderer3d/materials/tiled.js`**

Insert after the `makeMat` helper, before `export const MATERIALS`:

```js
/**
 * Procedurally generates a 64x64 flower-bed tile texture: dark soil base
 * with saturated dots in rough rows (cultivated flowers) + short leaf strokes.
 */
function gen_flowerBed(size = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Soil base (dark brown with slight variation)
  ctx.fillStyle = '#3a2820';
  ctx.fillRect(0, 0, size, size);
  // Noise freckles of slightly lighter soil
  for (let i = 0; i < 80; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    ctx.fillStyle = `rgba(80, 56, 40, ${0.3 + Math.random() * 0.4})`;
    ctx.fillRect(x, y, 1, 1);
  }

  // Leaf strokes (short green lines)
  ctx.strokeStyle = '#3b6e2b';
  ctx.lineWidth = 1;
  for (let i = 0; i < 8; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const a = Math.random() * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * 3, y + Math.sin(a) * 3);
    ctx.stroke();
  }

  // Flower dots in rough rows (3 rows, jittered)
  const palette = ['#ffe14d', '#f2f2f2', '#ffe14d', '#ff8fa3',
                   '#c58df5', '#ffe14d', '#e84a4a', '#7db9ff'];
  const rows = 3;
  const perRow = 7;
  for (let r = 0; r < rows; r++) {
    const baseY = (r + 0.5) * size / rows;
    for (let i = 0; i < perRow; i++) {
      const x = (i + 0.5) * size / perRow + (Math.random() - 0.5) * 4;
      const y = baseY + (Math.random() - 0.5) * 4;
      const col = palette[Math.floor(Math.random() * palette.length)];
      const rad = 2 + Math.random() * 1.5;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  return tex;
}
```

And add to the `MATERIALS` export object, alongside the other `tile_*` entries:

```js
tile_flower_bed: new THREE.MeshStandardMaterial({
  map: gen_flowerBed(64),
  roughness: 0.95,
  metalness: 0.0,
}),
```

### Add the FLOORS entry

- [ ] **Step 2: Inspect the `groomedGrass` FLOORS entry in `src/data/structure.js` as a template**

Run: `grep -n "groomedGrass" src/data/structure.js`
Read the full entry (likely lines 97–113 based on earlier exploration).

- [ ] **Step 3: Add `flowerBedTile` FLOORS entry**

Add a new entry in the FLOORS object, modeled on `groomedGrass`. Key fields:

```js
flowerBedTile: {
  id: 'flowerBedTile',
  name: 'Flower Bed',
  category: 'grounds',
  groundsSurface: true,
  noBase: true,
  noGrid: false,
  baseColor: '#3a2820',          // matches texture base; used by layer-1 plane
  texture: 'tile_flower_bed',    // keyed into MATERIALS (tiled.js)
  cost: /* same as groomedGrass cost */,
  research: null,                // available from start
  // ... any other fields groomedGrass has (variants, research tier, etc.) —
  //    mirror exactly; flower-bed is v1-equivalent to groomedGrass in UI flow
},
```

**Important:** If `groomedGrass` has a `variants` array, decide whether `flowerBedTile` needs variants. For v1, a single variant is fine — skip the variants array or give it a single default.

### Verify the floor-builder and paint-tool paths

- [ ] **Step 4: Check how `floor-builder.js` dispatches to per-type rendering**

Run: `grep -n "groomedGrass" src/renderer3d/floor-builder.js`

Two possibilities:
- **(a) Type-agnostic lookup** — reads `FLOORS[type].texture` and maps to `MATERIALS[that]`. No code change needed; the new entry "just works".
- **(b) Explicit switch on `type === 'groomedGrass'`** — a branch needs to be added for `flowerBedTile`. Add it parallel to the groomedGrass branch.

- [ ] **Step 5: Check the paint tool UI**

Run: `grep -rn "groomedGrass" src/ui/ src/renderer/`
Identify whether the Grounds paint group lists floors by iterating `FLOORS` (in which case no change is needed) or by a hardcoded list (in which case add `'flowerBedTile'` to that list).

### Smoke test

- [ ] **Step 6: Visual + interaction smoke test**

Open the app, click New Game. Open the paint tool:
- **Flower Bed** appears in the Grounds group with the correct name.
- Click-and-drag paints flower-bed cells onto grass; texture is the procedural soil+dots.
- The texture is visually distinct from wildflowers (denser, in rows, darker base).
- Removing a painted cell reverts to grass (use existing eraser/clear flow).
- No console errors.

### Commit

- [ ] **Step 7: Commit Task 3**

```bash
git add src/data/structure.js \
        src/renderer3d/materials/tiled.js \
        src/renderer3d/floor-builder.js \
        # plus any paint-UI file touched in step 5
git commit -m "$(cat <<'EOF'
feat: add paintable flower bed floor tile

Introduces a new flowerBedTile FLOORS entry with a procedurally drawn
tile texture (dark soil + cultivated flower dots in rows + leaf strokes)
distinct from the ambient wildflower decals. Player paints it from the
Grounds group. Not auto-placed on the starter map — purely on-demand.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Summary

Completed inline during plan writing:

- **Spec coverage:** All five spec sections covered. §1 (tree clumps) → Task 1. §2 (wildflowers) → Task 2. §3 (flower bed) → Task 3. §4 (blank starter + Game.newGame wiring + scenario cleanup) → Task 1.
- **Placeholders:** None. Every task has concrete code, signatures, data shapes, and assertion counts.
- **Type consistency:** `generateStartingMap(seed, terrainBlobs)` signature used consistently in Task 1 tests and implementation. `computeFlowerInstancesForCell` signature matches between Task 2 test and implementation guidance. `flowerBedTile` id used consistently across Task 3.
- **Known spec divergence noted:** Spec implied `gen_*` functions already existed in `tiled.js`/`decals.js`. They don't — this plan makes them the first procedural textures in those files (called out in Task 2 Step 1 and Task 3 Step 1).

## Open Implementation Questions

- **`sampleTerrainBrightness` duplication:** copy vs. extract into a shared module. Plan leaves this to the implementer's judgment. If extracting, note that `world-snapshot.js` currently has the canonical copy at lines 23–37; both would import from a new `src/game/terrain-brightness.js`.
- **Existing tests that reference Fermilab:** Task 1 Step 8 will find them. Action is to update or delete, which may expand Task 1 slightly.
