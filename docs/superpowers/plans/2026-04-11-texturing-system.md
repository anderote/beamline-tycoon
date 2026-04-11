# Texturing System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace flat-shaded solid-color 3D rendering with pixel-art textures on walls, floors, beamline components, and equipment, with custom decal faces for hero equipment items (server racks, oscilloscope screens, etc.).

**Architecture:** Two parallel tracks. Beamline components keep their role-merged geometry pipeline and gain tiled materials via world-scaled UVs. Equipment items become single `BoxGeometry` boxes with 6-slot material arrays so each face can independently use a tiled material or a decal. Materials and decals live in a module-level export (`src/renderer3d/materials/`), not a runtime manifest, because the set is closed and version-controlled.

**Tech Stack:** Three.js (CDN global, never imported), Vite (bundler, dev server on `:8000`), Node.js for asset generation, `pngjs` for procedural texture generation, PixelLab API (already wired in `tools/asset-gen/server.cjs`) for decals.

**Spec:** `docs/superpowers/specs/2026-04-11-texturing-system-design.md`

---

## Conventions

- **THREE is a CDN global.** Never `import THREE`. Reference `THREE.MeshStandardMaterial` etc. directly. The HTML loads it before any module.
- **Asset URLs are plain strings.** Vite serves the `assets/` directory as static. Use string paths like `'assets/textures/materials/metal_dark.png'`, not ESM imports — this matches existing patterns in `texture-manager.js` and `infra-builder.js`.
- **Texel scale.** `TEXEL_SCALE = 32` texels per world meter. A 64×64 texture covers 2m × 2m. Defined once in `src/renderer3d/materials/index.js`.
- **Filter / wrap / colorspace.** Tiled materials: `RepeatWrapping`, `NearestFilter`, `SRGBColorSpace`, no mipmaps. Decals: `ClampToEdgeWrapping`, `NearestFilter`, `SRGBColorSpace`, no mipmaps.
- **Verification is visual.** This is a 3D rendering project. Most tasks have no unit tests — verification is "run `npm run dev`, open http://localhost:8000, look at it." Only `uv-utils.js` has true unit tests because its functions are pure and side-effect-free.
- **Commits are frequent.** Each task ends with one commit. Don't batch.

## File structure

**New files:**

```
assets/textures/materials/      # generated PNGs (committed)
  metal_dark.png
  metal_brushed.png
  metal_painted_white.png
  copper.png
  concrete_floor.png
  concrete_wall.png
  drywall_painted.png
  rubber_mat.png
  rack_vent_mesh.png
  cable_tray.png
  tile_floor_white.png

assets/textures/decals/         # PixelLab-generated PNGs (added later)

tools/asset-gen/gen-materials.cjs    # procedural texture generator

src/renderer3d/materials/
  index.js                      # MATERIALS, DECALS exports + TEXEL_SCALE
  tiled.js                      # builds tiled MeshStandardMaterial instances
  decals.js                     # builds decal MeshStandardMaterial instances

src/renderer3d/uv-utils.js      # applyTiledBoxUVs, applyTiledCylinderUVs
test/uv-utils.test.js           # unit tests for UV math
```

**Modified files:**

```
package.json                    # +pngjs devDependency
src/renderer3d/component-builder.js   # SHARED_MATERIALS sourced from MATERIALS;
                                       # _mat() gains optional texture name;
                                       # _ROLE_BUILDERS primitives get UV rewrite
src/renderer3d/equipment-builder.js   # 6-face material array per box
src/renderer3d/wall-builder.js         # tiled UVs + material from MATERIALS
src/renderer3d/infra-builder.js        # world-scaled UVs for floor tiles
src/data/infrastructure.js             # wall types gain `texture` field
src/data/placeables/equipment.js       # equipment items gain baseMaterial + faces
tools/asset-gen/server.cjs             # +/api/generate-decal endpoint
tools/asset-gen/public/index.html      # +Decals tab (dashboard)
```

---

## Task 1: Procedural texture generator script

Generate the 11 base tiled material PNGs. The script is committed; outputs are committed; the script is re-runnable to tweak palettes.

**Files:**
- Create: `tools/asset-gen/gen-materials.cjs`
- Modify: `package.json` (add `pngjs` devDep)
- Create: `assets/textures/materials/*.png` (script output, 11 files)

- [ ] **Step 1: Install pngjs**

Run from repo root:
```bash
npm install --save-dev pngjs
```

Expected: `pngjs` appears under `devDependencies` in `package.json`. No errors.

- [ ] **Step 2: Create the materials directory**

Run:
```bash
mkdir -p assets/textures/materials assets/textures/decals
```

- [ ] **Step 3: Write `tools/asset-gen/gen-materials.cjs`**

Create the file with this exact content:

```js
#!/usr/bin/env node
// Procedural pixel-art seamless texture generator.
// Outputs 64×64 PNGs to assets/textures/materials/.
// Run: node tools/asset-gen/gen-materials.cjs
//
// All textures are seamless (left/right and top/bottom edges wrap).
// Palette is intentionally muted/desaturated to match RCT2 pixel-art feel.

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const SIZE = 64;
const OUT_DIR = path.join(__dirname, '..', '..', 'assets', 'textures', 'materials');

// ── Deterministic PRNG so re-runs produce identical output ────────────
function mulberry32(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makePng() {
  return new PNG({ width: SIZE, height: SIZE, colorType: 6 });
}

function setPx(png, x, y, r, g, b, a = 255) {
  const idx = ((y % SIZE) * SIZE + (x % SIZE)) * 4;
  png.data[idx] = r;
  png.data[idx + 1] = g;
  png.data[idx + 2] = b;
  png.data[idx + 3] = a;
}

function writePng(png, name) {
  const out = path.join(OUT_DIR, name + '.png');
  fs.writeFileSync(out, PNG.sync.write(png));
  console.log('wrote', out);
}

// ── Generators ────────────────────────────────────────────────────────

function gen_solidNoise(name, baseRGB, noiseAmp, seed) {
  const png = makePng();
  const rand = mulberry32(seed);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const n = (rand() - 0.5) * noiseAmp;
      setPx(png, x, y,
        Math.max(0, Math.min(255, baseRGB[0] + n)),
        Math.max(0, Math.min(255, baseRGB[1] + n)),
        Math.max(0, Math.min(255, baseRGB[2] + n)));
    }
  }
  writePng(png, name);
}

function gen_speckled(name, baseRGB, speckleRGB, density, seed) {
  const png = makePng();
  const rand = mulberry32(seed);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (rand() < density) {
        setPx(png, x, y, speckleRGB[0], speckleRGB[1], speckleRGB[2]);
      } else {
        const n = (rand() - 0.5) * 12;
        setPx(png, x, y,
          Math.max(0, Math.min(255, baseRGB[0] + n)),
          Math.max(0, Math.min(255, baseRGB[1] + n)),
          Math.max(0, Math.min(255, baseRGB[2] + n)));
      }
    }
  }
  writePng(png, name);
}

function gen_brushed(name, baseRGB, seed) {
  const png = makePng();
  const rand = mulberry32(seed);
  // Horizontal brush lines: each row picks a brightness offset that varies
  // smoothly along X via low-frequency noise.
  const rowOffsets = new Array(SIZE);
  for (let y = 0; y < SIZE; y++) rowOffsets[y] = (rand() - 0.5) * 30;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // Horizontal grain: brightness varies slowly in x
      const grain = Math.sin(x * 0.4 + y * 0.05) * 6;
      const n = rowOffsets[y] + grain + (rand() - 0.5) * 6;
      setPx(png, x, y,
        Math.max(0, Math.min(255, baseRGB[0] + n)),
        Math.max(0, Math.min(255, baseRGB[1] + n)),
        Math.max(0, Math.min(255, baseRGB[2] + n)));
    }
  }
  writePng(png, name);
}

function gen_grid(name, bgRGB, lineRGB, cellSize, seed) {
  const png = makePng();
  const rand = mulberry32(seed);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const onLine = (x % cellSize === 0) || (y % cellSize === 0);
      if (onLine) {
        setPx(png, x, y, lineRGB[0], lineRGB[1], lineRGB[2]);
      } else {
        const n = (rand() - 0.5) * 8;
        setPx(png, x, y,
          Math.max(0, Math.min(255, bgRGB[0] + n)),
          Math.max(0, Math.min(255, bgRGB[1] + n)),
          Math.max(0, Math.min(255, bgRGB[2] + n)));
      }
    }
  }
  writePng(png, name);
}

function gen_mesh(name, holeRGB, frameRGB, holeSize, seed) {
  // Vent mesh — small dark holes on a metal frame, regular grid.
  const png = makePng();
  const rand = mulberry32(seed);
  const period = holeSize * 2;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const ix = x % period;
      const iy = y % period;
      const inHole = ix < holeSize && iy < holeSize;
      if (inHole) {
        setPx(png, x, y, holeRGB[0], holeRGB[1], holeRGB[2]);
      } else {
        const n = (rand() - 0.5) * 10;
        setPx(png, x, y,
          Math.max(0, Math.min(255, frameRGB[0] + n)),
          Math.max(0, Math.min(255, frameRGB[1] + n)),
          Math.max(0, Math.min(255, frameRGB[2] + n)));
      }
    }
  }
  writePng(png, name);
}

// ── Main ─────────────────────────────────────────────────────────────

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// Metals
gen_brushed('metal_dark',          [55, 58, 66],   1);
gen_brushed('metal_brushed',       [140, 145, 155], 2);
gen_solidNoise('metal_painted_white', [220, 222, 218], 18, 3);
gen_brushed('copper',              [180, 110, 50], 4);

// Concretes / drywall
gen_speckled('concrete_floor',     [150, 148, 142], [100, 98, 92], 0.04, 5);
gen_speckled('concrete_wall',      [180, 178, 172], [130, 128, 122], 0.03, 6);
gen_solidNoise('drywall_painted',  [232, 230, 224], 10, 7);

// Rubber
gen_solidNoise('rubber_mat',       [40, 42, 44], 14, 8);

// Tile
gen_grid('tile_floor_white',       [225, 225, 222], [180, 180, 178], 16, 9);

// Vent mesh + cable tray
gen_mesh('rack_vent_mesh',         [20, 20, 22], [90, 92, 100], 4, 10);
gen_grid('cable_tray',             [120, 120, 124], [60, 60, 64], 8, 11);

console.log('done.');
```

- [ ] **Step 4: Run the generator**

Run:
```bash
node tools/asset-gen/gen-materials.cjs
```

Expected: 11 lines of `wrote .../assets/textures/materials/<name>.png`, then `done.`. Check the directory:
```bash
ls assets/textures/materials/
```
Expected: 11 PNG files.

Open one or two in Preview / image viewer to confirm they look like seamless pixel-art swatches (not garbage).

- [ ] **Step 5: Commit**

```bash
git add tools/asset-gen/gen-materials.cjs assets/textures/materials/ package.json package-lock.json
git commit -m "$(cat <<'EOF'
feat(textures): procedural seamless material generator + initial 11 PNGs

Adds tools/asset-gen/gen-materials.cjs which produces 11 seamless 64×64
pixel-art textures (metals, concrete, drywall, rubber, tile, vent mesh,
cable tray) using deterministic noise/pattern generators. Outputs are
committed to assets/textures/materials/ for use by the renderer.
EOF
)"
```

---

## Task 2: Materials module

Create the module that owns `MATERIALS` (tiled), `DECALS` (initially empty), and `TEXEL_SCALE`. Three.js textures load asynchronously but assigning a `.map` synchronously is fine — Three.js re-renders when the texture finishes loading.

**Files:**
- Create: `src/renderer3d/materials/index.js`
- Create: `src/renderer3d/materials/tiled.js`
- Create: `src/renderer3d/materials/decals.js`

- [ ] **Step 1: Write `src/renderer3d/materials/tiled.js`**

```js
// src/renderer3d/materials/tiled.js
// Loads and caches tiled MeshStandardMaterial instances for base materials.
// THREE is a CDN global — do NOT import it.

const BASE = 'assets/textures/materials/';

const _loader = new THREE.TextureLoader();

function loadTiled(file) {
  const tex = _loader.load(BASE + file);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  return tex;
}

function makeMat(file, { roughness = 0.6, metalness = 0.3 } = {}) {
  return new THREE.MeshStandardMaterial({
    map: loadTiled(file),
    roughness,
    metalness,
  });
}

/**
 * Map of material name -> shared MeshStandardMaterial instance.
 * These are module-level singletons. Do NOT dispose them from builders.
 * Adding a new material: add a PNG, add an entry here.
 */
export const MATERIALS = {
  metal_dark:          makeMat('metal_dark.png',          { roughness: 0.5, metalness: 0.5 }),
  metal_brushed:       makeMat('metal_brushed.png',       { roughness: 0.4, metalness: 0.6 }),
  metal_painted_white: makeMat('metal_painted_white.png', { roughness: 0.6, metalness: 0.2 }),
  copper:              makeMat('copper.png',              { roughness: 0.4, metalness: 0.6 }),
  concrete_floor:      makeMat('concrete_floor.png',      { roughness: 0.9, metalness: 0.0 }),
  concrete_wall:       makeMat('concrete_wall.png',       { roughness: 0.9, metalness: 0.0 }),
  drywall_painted:     makeMat('drywall_painted.png',     { roughness: 0.8, metalness: 0.0 }),
  rubber_mat:          makeMat('rubber_mat.png',          { roughness: 0.95, metalness: 0.0 }),
  tile_floor_white:    makeMat('tile_floor_white.png',    { roughness: 0.5, metalness: 0.0 }),
  rack_vent_mesh:      makeMat('rack_vent_mesh.png',      { roughness: 0.7, metalness: 0.4 }),
  cable_tray:          makeMat('cable_tray.png',          { roughness: 0.7, metalness: 0.3 }),
};
```

- [ ] **Step 2: Write `src/renderer3d/materials/decals.js`**

```js
// src/renderer3d/materials/decals.js
// Loads and caches decal MeshStandardMaterial instances for hero faces.
// THREE is a CDN global — do NOT import it.
//
// Decals use ClampToEdgeWrapping (no tiling) and 0→1 face UVs. The
// authored PNG should match the target face aspect ratio.
//
// Initially empty — populated as decals are authored or generated.

const BASE = 'assets/textures/decals/';

const _loader = new THREE.TextureLoader();

function loadDecal(file) {
  const tex = _loader.load(BASE + file);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  return tex;
}

function makeDecal(file, { roughness = 0.5, metalness = 0.2 } = {}) {
  return new THREE.MeshStandardMaterial({
    map: loadDecal(file),
    roughness,
    metalness,
  });
}

/**
 * Map of decal name -> shared MeshStandardMaterial instance.
 * Populated incrementally as decals are authored. Module-level singletons.
 */
export const DECALS = {
  // Populated in Task 9 onwards. Example shape:
  // server_rack_front: makeDecal('server_rack_front.png'),
};

// Re-export so tests / future code can construct ad-hoc decal materials.
export { makeDecal };
```

- [ ] **Step 3: Write `src/renderer3d/materials/index.js`**

```js
// src/renderer3d/materials/index.js
// Public surface for the materials module.

export { MATERIALS } from './tiled.js';
export { DECALS, makeDecal } from './decals.js';

/**
 * Texture pixels per world meter. A 64×64 source texture covers a
 * (64 / TEXEL_SCALE) m × (64 / TEXEL_SCALE) m surface — currently 2m × 2m.
 * Tweak here to change global pixel density of all tiled materials.
 */
export const TEXEL_SCALE = 32;
```

- [ ] **Step 4: Sanity-check the module loads in the dev server**

Run:
```bash
npm run dev
```

In another terminal, open the browser at http://localhost:8000 (Vite will print the actual port if 8000 is taken — the project's `vite.config.js` requests `:8000`).

Open the browser devtools console and run:
```js
const m = await import('/src/renderer3d/materials/index.js');
console.log(Object.keys(m.MATERIALS), m.TEXEL_SCALE);
```
Expected: array of 11 material names, then `32`. No errors. The textures may show as missing in the console if URLs are wrong — fix and retry until the import is clean.

Stop the dev server with Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add src/renderer3d/materials/
git commit -m "$(cat <<'EOF'
feat(textures): materials module with MATERIALS and DECALS exports

Adds src/renderer3d/materials/ — a closed, module-level texture catalog.
MATERIALS exposes 11 tiled MeshStandardMaterials configured with
NearestFilter + RepeatWrapping. DECALS is the matching decal catalog,
populated later. TEXEL_SCALE constant centralizes the texels-per-meter
choice (currently 32, so a 64×64 source covers 2m×2m).

No runtime manifest — the set is closed and version-controlled, so
indirection adds nothing. Consumers import { MATERIALS } directly.
EOF
)"
```

---

## Task 3: UV utilities (TDD)

Pure functions that rewrite the UV attribute on box / cylinder geometries so each face's UV span is proportional to its world-space dimensions. The only file in the plan that gets real unit tests, because the math must be exact.

**Files:**
- Create: `src/renderer3d/uv-utils.js`
- Test: `test/uv-utils.test.js`

- [ ] **Step 1: Check the test setup that exists**

Run:
```bash
ls test/
cat package.json | grep -A 4 scripts
```
Expected: see whether a test runner exists. If `test/` is empty or the project has no `test` script, we'll use Node's built-in `node:test` runner — no install required.

- [ ] **Step 2: Write the failing tests**

Create `test/uv-utils.test.js`:

```js
// test/uv-utils.test.js
// Run: node --test test/uv-utils.test.js
//
// Tests for applyTiledBoxUVs / applyTiledCylinderUVs. Verifies that
// rewritten UVs have the correct span (world_dimension / metersPerTile)
// for each face of a box, and circumference / height for a cylinder.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Stub minimal THREE BufferGeometry / BufferAttribute so the module can
// run without a browser. The functions only need .attributes.uv with
// .array and .needsUpdate, plus geometry params we pass explicitly.
globalThis.THREE = {
  BufferAttribute: class {
    constructor(arr, itemSize) {
      this.array = arr;
      this.itemSize = itemSize;
      this.needsUpdate = false;
    }
  },
};

const { applyTiledBoxUVs, applyTiledCylinderUVs } = await import('../src/renderer3d/uv-utils.js');

// Helper: build a fake non-indexed BoxGeometry-shaped object with the
// 24-vertex (6 faces × 4) UV layout that THREE.BoxGeometry produces by
// default. The values themselves don't matter — applyTiledBoxUVs
// overwrites them — but the array length must be 48 (24 verts × 2).
function fakeBoxGeom() {
  return {
    attributes: {
      uv: new globalThis.THREE.BufferAttribute(new Float32Array(48), 2),
    },
  };
}

// TEXEL_SCALE = 32 → 2 meters per source-texture-tile. So a face that is
// 4m wide should have U span 4 / 2 = 2.0; a 1m face should have 0.5.

test('box: 2m cube uses [0..1] UVs on every face', () => {
  const g = fakeBoxGeom();
  applyTiledBoxUVs(g, 2, 2, 2);
  const uv = g.attributes.uv.array;
  // For a 2m cube and TEXEL_SCALE=32, every face spans exactly 1 UV unit.
  // Each face's 4 verts should occupy [0, 1] in both axes.
  for (let face = 0; face < 6; face++) {
    const off = face * 8;
    const us = [uv[off + 0], uv[off + 2], uv[off + 4], uv[off + 6]];
    const vs = [uv[off + 1], uv[off + 3], uv[off + 5], uv[off + 7]];
    assert.deepEqual(new Set(us), new Set([0, 1]));
    assert.deepEqual(new Set(vs), new Set([0, 1]));
  }
});

test('box: 4m × 1m × 2m face spans match dimensions / 2m', () => {
  const g = fakeBoxGeom();
  applyTiledBoxUVs(g, 4, 1, 2); // w=4, h=1, d=2
  const uv = g.attributes.uv.array;
  // BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z
  // +X / -X face: U spans d=2 -> 1.0, V spans h=1 -> 0.5
  for (const face of [0, 1]) {
    const off = face * 8;
    const us = [uv[off + 0], uv[off + 2], uv[off + 4], uv[off + 6]];
    const vs = [uv[off + 1], uv[off + 3], uv[off + 5], uv[off + 7]];
    assert.equal(Math.max(...us) - Math.min(...us), 1.0, '+/-X face U span');
    assert.equal(Math.max(...vs) - Math.min(...vs), 0.5, '+/-X face V span');
  }
  // +Y / -Y face: U spans w=4 -> 2.0, V spans d=2 -> 1.0
  for (const face of [2, 3]) {
    const off = face * 8;
    const us = [uv[off + 0], uv[off + 2], uv[off + 4], uv[off + 6]];
    const vs = [uv[off + 1], uv[off + 3], uv[off + 5], uv[off + 7]];
    assert.equal(Math.max(...us) - Math.min(...us), 2.0, '+/-Y face U span');
    assert.equal(Math.max(...vs) - Math.min(...vs), 1.0, '+/-Y face V span');
  }
  // +Z / -Z face: U spans w=4 -> 2.0, V spans h=1 -> 0.5
  for (const face of [4, 5]) {
    const off = face * 8;
    const us = [uv[off + 0], uv[off + 2], uv[off + 4], uv[off + 6]];
    const vs = [uv[off + 1], uv[off + 3], uv[off + 5], uv[off + 7]];
    assert.equal(Math.max(...us) - Math.min(...us), 2.0, '+/-Z face U span');
    assert.equal(Math.max(...vs) - Math.min(...vs), 0.5, '+/-Z face V span');
  }
});

test('box: needsUpdate is set after rewrite', () => {
  const g = fakeBoxGeom();
  applyTiledBoxUVs(g, 1, 1, 1);
  assert.equal(g.attributes.uv.needsUpdate, true);
});

// Cylinder: side has 32 segments × 2 rings = 64 verts, plus 2 caps.
// CylinderGeometry default UV layout for the side is: U around the
// circumference (0..1), V along the height (0..1). After rewrite,
// U should span (2π·r) / 2m and V should span (height) / 2m.
function fakeCylinderGeom(segs = 32, hasCaps = true) {
  // Side: (segs+1) × 2 verts. Top cap: (segs+2) verts. Bottom cap: (segs+2).
  const sideVerts = (segs + 1) * 2;
  const capVerts = hasCaps ? (segs + 2) * 2 : 0;
  const total = sideVerts + capVerts;
  return {
    attributes: {
      uv: new globalThis.THREE.BufferAttribute(new Float32Array(total * 2), 2),
    },
    _sideVerts: sideVerts,
    _capVerts: capVerts,
  };
}

test('cylinder: side U spans circumference / 2m, V spans height / 2m', () => {
  const r = 1;          // radius
  const h = 4;          // height
  const segs = 32;
  const g = fakeCylinderGeom(segs, false);
  applyTiledCylinderUVs(g, r, h, segs);
  const uv = g.attributes.uv.array;
  const expectedUSpan = (2 * Math.PI * r) / 2;  // ~3.14159
  const expectedVSpan = h / 2;                  // 2.0
  // Find U min/max across side verts
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (let i = 0; i < g._sideVerts; i++) {
    const u = uv[i * 2];
    const v = uv[i * 2 + 1];
    if (u < uMin) uMin = u;
    if (u > uMax) uMax = u;
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
  }
  assert.ok(Math.abs((uMax - uMin) - expectedUSpan) < 1e-5, `side U span: ${uMax - uMin} vs ${expectedUSpan}`);
  assert.ok(Math.abs((vMax - vMin) - expectedVSpan) < 1e-5, `side V span: ${vMax - vMin} vs ${expectedVSpan}`);
});
```

- [ ] **Step 3: Run tests — expect failure**

Run:
```bash
node --test test/uv-utils.test.js
```
Expected: tests fail with `Cannot find module ../src/renderer3d/uv-utils.js` or similar. That confirms the test runner is wired and we now need to write the implementation.

- [ ] **Step 4: Write `src/renderer3d/uv-utils.js`**

```js
// src/renderer3d/uv-utils.js
// Pure functions that rewrite UV attributes on Box/Cylinder geometries
// so each face's UV span is proportional to its world-space dimensions.
// THREE is a CDN global — do NOT import it.
//
// World-space → UV: u = world_dimension / METERS_PER_TILE.
// METERS_PER_TILE is derived from TEXEL_SCALE in materials/index.js
// (32 texels/m × 64 texels/tile = 2m). We don't import the constant
// here to avoid a cycle; instead it's hard-coded as 2.0. If you change
// TEXEL_SCALE, change METERS_PER_TILE here too.

const METERS_PER_TILE = 2.0;

/**
 * Rewrite the UV attribute on a non-indexed THREE.BoxGeometry so each
 * face's UVs span the face's world-space dimensions / METERS_PER_TILE.
 *
 * THREE.BoxGeometry vertex order is fixed: 6 faces in the order
 * [+X, -X, +Y, -Y, +Z, -Z], each face having 4 verts (2 triangles share
 * verts via the index buffer; for non-indexed geometry the layout is
 * still 4 unique UVs per face). Each face's default UVs are:
 *   v0: (0, 1)   v1: (1, 1)
 *   v2: (0, 0)   v3: (1, 0)
 * We replace those with (0, vSpan), (uSpan, vSpan), (0, 0), (uSpan, 0)
 * where uSpan/vSpan are computed from the face's two world dimensions.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {number} width  size along X (m)
 * @param {number} height size along Y (m)
 * @param {number} depth  size along Z (m)
 */
export function applyTiledBoxUVs(geometry, width, height, depth) {
  const uv = geometry.attributes.uv;
  if (!uv) return;
  const arr = uv.array;
  const u_w = width / METERS_PER_TILE;
  const u_h = height / METERS_PER_TILE;
  const u_d = depth / METERS_PER_TILE;
  // [uSpan, vSpan] per face, in default BoxGeometry order
  const spans = [
    [u_d, u_h],  // +X face: U=depth, V=height
    [u_d, u_h],  // -X face
    [u_w, u_d],  // +Y face: U=width, V=depth
    [u_w, u_d],  // -Y face
    [u_w, u_h],  // +Z face: U=width, V=height
    [u_w, u_h],  // -Z face
  ];
  for (let face = 0; face < 6; face++) {
    const [uSpan, vSpan] = spans[face];
    const off = face * 8;
    // Default per-face order: (0,1) (1,1) (0,0) (1,0)
    arr[off + 0] = 0;     arr[off + 1] = vSpan;
    arr[off + 2] = uSpan; arr[off + 3] = vSpan;
    arr[off + 4] = 0;     arr[off + 5] = 0;
    arr[off + 6] = uSpan; arr[off + 7] = 0;
  }
  uv.needsUpdate = true;
}

/**
 * Rewrite the UV attribute on a THREE.CylinderGeometry so the side wall
 * tiles by circumference (U) and height (V). Cap UVs are scaled
 * uniformly from their default [0..1] disk layout to a (2r/MPT)-wide
 * footprint, which is acceptable for flanges.
 *
 * THREE.CylinderGeometry default vertex layout (radialSegments = N):
 *   - Side: (N+1) × 2 verts (top ring then bottom ring), default UVs
 *     U = i / N (0..1 around circumference), V = 1 (top) / 0 (bottom).
 *   - Top cap: (N+2) verts (center + N+1 perimeter), default UVs
 *     centered around (0.5, 0.5).
 *   - Bottom cap: same.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {number} radius
 * @param {number} height
 * @param {number} radialSegments  must match the geometry's segments
 */
export function applyTiledCylinderUVs(geometry, radius, height, radialSegments) {
  const uv = geometry.attributes.uv;
  if (!uv) return;
  const arr = uv.array;
  const circumference = 2 * Math.PI * radius;
  const uSpan = circumference / METERS_PER_TILE;
  const vSpan = height / METERS_PER_TILE;
  const N = radialSegments;
  const sideVerts = (N + 1) * 2;
  // Side: top ring first, then bottom ring (THREE convention)
  for (let i = 0; i <= N; i++) {
    const u = (i / N) * uSpan;
    arr[i * 2 + 0] = u;
    arr[i * 2 + 1] = vSpan; // top
    const j = (N + 1) + i;
    arr[j * 2 + 0] = u;
    arr[j * 2 + 1] = 0;     // bottom
  }
  // Caps: scale default [0..1] disk UVs to (2r/MPT) so cap pixels match
  // side pixel density. Default cap UVs are centered around (0.5, 0.5)
  // with radius 0.5; we map them to centered around (0, 0) with radius
  // (radius / METERS_PER_TILE), then re-center to (0, 0).
  const capScale = (2 * radius) / METERS_PER_TILE; // full diameter in UV units
  for (let i = sideVerts; i < arr.length / 2; i++) {
    const ux = arr[i * 2 + 0];
    const uy = arr[i * 2 + 1];
    arr[i * 2 + 0] = (ux - 0.5) * capScale;
    arr[i * 2 + 1] = (uy - 0.5) * capScale;
  }
  uv.needsUpdate = true;
}
```

- [ ] **Step 5: Run tests — expect pass**

Run:
```bash
node --test test/uv-utils.test.js
```
Expected: all tests pass. If they fail, fix `uv-utils.js` (not the tests — the tests pin the spec).

- [ ] **Step 6: Commit**

```bash
git add src/renderer3d/uv-utils.js test/uv-utils.test.js
git commit -m "$(cat <<'EOF'
feat(textures): UV utilities for world-scaled tiling

Adds applyTiledBoxUVs and applyTiledCylinderUVs which rewrite a
geometry's UV attribute so each face's UV span equals world dimension
divided by METERS_PER_TILE (currently 2m). This keeps texel density
constant across surfaces of different sizes — a 1m wall and a 4m wall
show the same-size pixels, the longer wall just shows more repetitions.

Pure functions, fully unit-tested. Box face order matches THREE.BoxGeometry
default ([+X, -X, +Y, -Y, +Z, -Z], 4 verts per face). Cylinder caps are
scaled to match side pixel density.
EOF
)"
```

---

## Task 4: Wall builder integration

Walls are the simplest visible surface to texture. Wire `wall-builder.js` to use materials from `MATERIALS` and apply tiled UVs to each wall slab. Each wall type maps to one material name.

**Files:**
- Modify: `src/data/infrastructure.js` (add `texture` field to wall types)
- Modify: `src/renderer3d/wall-builder.js`

- [ ] **Step 1: Inspect current wall types**

```bash
grep -n "WALL_TYPES" src/data/infrastructure.js | head
```
Note the structure. Each wall type has at least `color`, `wallHeight`, `thickness`. We're adding a new optional `texture` field.

- [ ] **Step 2: Add `texture` field to each wall type in `src/data/infrastructure.js`**

Open the file. For each entry in `WALL_TYPES`, add a `texture` key. The right material depends on the wall's purpose. Best-guess defaults (apply mechanically; the user can tune later):

| Wall purpose | texture |
|---|---|
| Exterior / shielding (concrete look, gray) | `concrete_wall` |
| Interior office / lab (drywall, light) | `drywall_painted` |
| Cleanroom / tile / machine shop interior wall | `tile_floor_white` (close enough; wall variants come later) |
| Metal partition / cubicle / fence | `metal_brushed` |
| Default fallback | `drywall_painted` |

Add `texture: '<name>'` to each entry as a new property next to `color`. If you're not sure which category a wall type belongs to, default to `drywall_painted`. Don't remove `color` — it stays as a fallback tint.

Example edit shape:
```js
shielding_wall: {
  // ...existing fields
  color: 0x9a9a8e,
  texture: 'concrete_wall',     // <-- add this
  wallHeight: 14,
  thickness: 1.5,
},
```

- [ ] **Step 3: Update `src/renderer3d/wall-builder.js` to use textured materials**

In the existing `build()` method, replace the wall material construction at lines 73-81 to look up from `MATERIALS`, apply tiled UVs to the wall geometry, and tint with the wall-type color.

First, add the imports at the top of the file (right after the existing `import { WALL_TYPES, ... }` line):
```js
import { MATERIALS } from './materials/index.js';
import { applyTiledBoxUVs } from './uv-utils.js';
```

Then replace this block:
```js
if (!matCache[matKey]) {
  matCache[matKey] = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.8,
    transparent: wallTransparent,
    opacity: wallTransparent ? 0.3 : 1.0,
    depthWrite: !wallTransparent,
  });
}
```
with:
```js
if (!matCache[matKey]) {
  const baseMat = def && def.texture ? MATERIALS[def.texture] : null;
  matCache[matKey] = new THREE.MeshStandardMaterial({
    map: baseMat ? baseMat.map : null,
    color: baseMat ? 0xffffff : color, // tint white if textured so map shows true colors
    roughness: 0.8,
    transparent: wallTransparent,
    opacity: wallTransparent ? 0.3 : 1.0,
    depthWrite: !wallTransparent,
  });
}
```

Then, immediately after the `geo` is constructed (the `new THREE.BoxGeometry(...)` line, currently lines 85-87), apply the tiled UVs. Find:
```js
const geo = isNS
  ? new THREE.BoxGeometry(length, height, thickness)
  : new THREE.BoxGeometry(thickness, height, length);
const mesh = new THREE.Mesh(geo, matCache[matKey]);
```
and change it to:
```js
const geo = isNS
  ? new THREE.BoxGeometry(length, height, thickness)
  : new THREE.BoxGeometry(thickness, height, length);
if (isNS) {
  applyTiledBoxUVs(geo, length, height, thickness);
} else {
  applyTiledBoxUVs(geo, thickness, height, length);
}
const mesh = new THREE.Mesh(geo, matCache[matKey]);
```

The "above-door" and "side-of-door" wall segments (lines 211-277) also construct `BoxGeometry` slabs that should be textured. For each `new THREE.BoxGeometry(...)` call inside the door loop that builds a wall segment (NOT the door posts/lintel — those stay solid color for now), follow the same pattern: call `applyTiledBoxUVs(geo, w, h, d)` immediately after construction. Specifically, the `aboveGeo` and `sideGeo` constructions get UV rewrites; the `postGeo` and `lintelGeo` do not.

- [ ] **Step 4: Visual verification**

Run:
```bash
npm run dev
```

Open the game in the browser. Place or look at any building with walls. Walls should now have visible pixel-art texture (concrete speckles, drywall noise, etc.) instead of flat color.

Specifically check:
1. **Texel size is consistent.** A short wall section and a long merged wall (transparent mode) should show the same-size pixels.
2. **No stretching.** Pixels should not be distorted on thin walls or wide ones.
3. **Cutaway / transparent modes still work.** Cycle wall visibility (the keybinding for this is in the existing input handler) and verify textured walls still go transparent.
4. **No console errors.** Open devtools — there should be no `Texture not loaded` or `applyTiledBoxUVs` errors.

If textures don't appear, check:
- Browser network tab — the `assets/textures/materials/*.png` files should return 200, not 404.
- The wall's `def.texture` field is set in `infrastructure.js`.
- `MATERIALS[def.texture]` is not `undefined`.

- [ ] **Step 5: Commit**

```bash
git add src/data/infrastructure.js src/renderer3d/wall-builder.js
git commit -m "$(cat <<'EOF'
feat(textures): textured walls with world-scaled tiling

Wall types gain a 'texture' field that names a material from
src/renderer3d/materials/. WallBuilder now constructs each wall
material with that texture's map and applies world-scaled UVs via
applyTiledBoxUVs so pixels stay constant size across short and long
walls. Existing transparent and cutaway modes are preserved; door
posts and lintels remain solid color for v1.
EOF
)"
```

---

## Task 5: Floor (infra) world-scaled UVs

Floors already use textures; the only change is to switch from "stretch tile across whole zone" to world-scaled UVs so floor pixels stay constant size regardless of zone extent.

**Files:**
- Modify: `src/renderer3d/infra-builder.js`

- [ ] **Step 1: Read the current floor UV remap**

```bash
grep -n -A 10 "uv" src/renderer3d/infra-builder.js | head -50
```

Find the section that remaps UVs for the textured overlay plane (around lines 70-90 per the earlier exploration). Note exactly how the current code constructs floor geometry and the UV array.

- [ ] **Step 2: Plan the change**

The existing code remaps UVs based on the diamond projection. We want to keep the diamond projection but scale the UVs by world dimensions. Whatever the current overlay's `width × depth` in world units is, the new UVs should span `width / 2m × depth / 2m` across the corners (instead of 0→1).

The simplest way: after the existing UV remap, multiply every UV component by `(zoneSize / 2)` (where `zoneSize` is the world-space size of the zone in meters).

- [ ] **Step 3: Edit `src/renderer3d/infra-builder.js`**

Add the import at the top:
```js
import { TEXEL_SCALE } from './materials/index.js';
```
(The local helper uses `METERS_PER_TILE = 64 / TEXEL_SCALE`.)

Find the place where the textured overlay plane has its UVs assigned. Add this right after the existing UV array is set on the geometry (still inside the same function):

```js
// Scale UVs by world size so texel density stays constant across zones.
// METERS_PER_TILE is the world-space side length one source-tile covers.
const METERS_PER_TILE = 64 / TEXEL_SCALE; // currently 2m
const uvAttr = geo.attributes.uv;
const uvArr = uvAttr.array;
const sx = worldWidth / METERS_PER_TILE;  // tiles across in U
const sz = worldDepth / METERS_PER_TILE;  // tiles across in V
for (let i = 0; i < uvArr.length; i += 2) {
  // Re-center to (0,0), scale, leave centered (texture wrap handles it).
  uvArr[i + 0] = (uvArr[i + 0] - 0.5) * sx + 0.5;
  uvArr[i + 1] = (uvArr[i + 1] - 0.5) * sz + 0.5;
}
uvAttr.needsUpdate = true;
```

Replace `worldWidth` and `worldDepth` with the actual variable names from the file (likely something like `tileW * cols` and `tileD * rows`). Also ensure the texture's `wrapS` and `wrapT` are `THREE.RepeatWrapping` — find where the textured overlay's material is constructed and add:
```js
if (overlayMat.map) {
  overlayMat.map.wrapS = THREE.RepeatWrapping;
  overlayMat.map.wrapT = THREE.RepeatWrapping;
  overlayMat.map.needsUpdate = true;
}
```

- [ ] **Step 4: Visual verification**

Run `npm run dev`, open the browser. Place a small zone and a large zone of the same type (e.g., two `controlRoom` zones of different sizes). The floor pixels should be the same size in both — the larger zone just shows more repetitions of the tile pattern.

Before this change, the larger zone stretched the texture; after, it tiles. Confirm the difference visually.

- [ ] **Step 5: Commit**

```bash
git add src/renderer3d/infra-builder.js
git commit -m "$(cat <<'EOF'
feat(textures): world-scaled UVs on floor zones

Floor overlay UVs now scale by zone world dimensions / METERS_PER_TILE
instead of stretching a single tile across the whole zone. Texel size
stays constant across zones of different sizes; the larger a zone, the
more tile repetitions show. Texture wrap is forced to RepeatWrapping
on the overlay material.
EOF
)"
```

---

## Task 6: Beamline component-builder defaults

Wire `SHARED_MATERIALS` to read from `MATERIALS` so role-bucket components automatically get tiled textures. Also wire `_mat()` to optionally take a texture name so legacy `_buildXxx()` builders can opt-in per-primitive. Apply UV rewrites in role builders' primitives.

**Files:**
- Modify: `src/renderer3d/component-builder.js`

- [ ] **Step 1: Add imports at the top of `component-builder.js`**

Right after the existing `import { COMPONENTS }` line, add:
```js
import { MATERIALS } from './materials/index.js';
import { applyTiledBoxUVs, applyTiledCylinderUVs } from './uv-utils.js';
```

- [ ] **Step 2: Replace `SHARED_MATERIALS` with textured versions**

Find lines 45-54 (the `SHARED_MATERIALS` declaration). Replace with:

```js
// SHARED_MATERIALS now derive their .map from MATERIALS but keep their
// own roughness/metalness and color tint. Per-role default texture:
//   iron   -> metal_dark
//   copper -> copper
//   pipe   -> metal_brushed
//   stand  -> metal_painted_white  (tinted dark gray via color)
//   detail -> metal_dark
const SHARED_MATERIALS = {
  iron:   new THREE.MeshStandardMaterial({ map: MATERIALS.metal_dark.map,          color: 0xffffff, roughness: 0.5,  metalness: 0.4 }),
  copper: new THREE.MeshStandardMaterial({ map: MATERIALS.copper.map,              color: 0xffffff, roughness: 0.4,  metalness: 0.5 }),
  pipe:   new THREE.MeshStandardMaterial({ map: MATERIALS.metal_brushed.map,       color: 0xffffff, roughness: 0.3,  metalness: 0.5 }),
  stand:  new THREE.MeshStandardMaterial({ map: MATERIALS.metal_painted_white.map, color: STAND_COLOR, roughness: 0.7, metalness: 0.1 }),
  detail: new THREE.MeshStandardMaterial({ map: MATERIALS.metal_dark.map,          color: 0xffffff, roughness: 0.7, metalness: 0.3 }),
};
```

`color: 0xffffff` ensures the texture shows true colors; `stand` keeps its dark gray tint because painted-white texture × dark gray color = textured dark gray.

- [ ] **Step 3: Wire accent materials to a tintable base texture**

Find `getAccentMaterial` (lines 67-79). Replace its body so the accent material also has a `.map`:

```js
export function getAccentMaterial(compType, colorHex) {
  const key = compType + '|' + colorHex.toString(16).padStart(6, '0');
  let m = _accentMatCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      map: MATERIALS.metal_painted_white.map,  // neutral tintable base
      color: colorHex,
      roughness: ACCENT_BASE_ROUGHNESS,
      metalness: ACCENT_BASE_METALNESS,
    });
    _accentMatCache.set(key, m);
  }
  return m;
}
```

- [ ] **Step 4: Make `_mat()` accept an optional texture name**

Find `_mat()` at lines 25-31. Replace with:

```js
function _mat(color, roughness = 0.5, metalness = 0.3, textureName = null) {
  const key = `${color}-${roughness}-${metalness}-${textureName ?? ''}`;
  if (!_matCache.has(key)) {
    const opts = { color, roughness, metalness };
    if (textureName && MATERIALS[textureName]) {
      opts.map = MATERIALS[textureName].map;
    }
    _matCache.set(key, new THREE.MeshStandardMaterial(opts));
  }
  return _matCache.get(key).clone();
}
```

Existing call sites that pass only `(color)` or `(color, r, m)` continue to work; new call sites can pass a 4th `textureName` argument.

- [ ] **Step 5: Apply UV rewrites in role builders**

Find every `new THREE.BoxGeometry(...)` and `new THREE.CylinderGeometry(...)` call inside `ROLE_BUILDERS` entries. (These are the role-bucket builders, NOT the legacy `_buildSource` / `_buildDrift` functions — those build into THREE.Group directly and are handled in Step 6.)

If `ROLE_BUILDERS` is currently empty or sparse, this step is a no-op. Run:
```bash
grep -n "ROLE_BUILDERS\[" src/renderer3d/component-builder.js
```
to find every entry. For each `BoxGeometry(w, h, d)` inside, add immediately after construction:
```js
applyTiledBoxUVs(geo, w, h, d);
```

For each `CylinderGeometry(rTop, rBot, h, segs)` (assuming `rTop === rBot` for tiled use; cones get default UVs), add:
```js
applyTiledCylinderUVs(geo, rBot, h, segs);
```

- [ ] **Step 6: Apply UV rewrites in legacy `_buildXxx` functions**

The legacy builders (`_buildSource`, `_buildDrift`, `_addBoltHoles`, `_addBeamSupport`, etc.) construct primitives directly. Each `new THREE.BoxGeometry(w, h, d)` and `new THREE.CylinderGeometry(rTop, rBot, h, segs)` should be followed by an `applyTiledBoxUVs` / `applyTiledCylinderUVs` call.

Note the trade-off: even if the primitive uses `_mat()` without a texture name (so still solid-color), having UVs in place means switching to a textured material later costs nothing. So always apply the UVs even if textures aren't used yet.

For each primitive construction in `_buildSource`, `_buildDrift`, `_addBoltHoles`, `_addBeamSupport`, and any similar `_buildXxx` helper, add the UV rewrite immediately after geometry construction. Example pattern:
```js
// Before:
const body = _addShadow(new THREE.Mesh(
  new THREE.BoxGeometry(bodyW, bodyH, bodyL),
  _mat(bodyColor, 0.6, 0.2),
));

// After:
const bodyGeo = new THREE.BoxGeometry(bodyW, bodyH, bodyL);
applyTiledBoxUVs(bodyGeo, bodyW, bodyH, bodyL);
const body = _addShadow(new THREE.Mesh(bodyGeo, _mat(bodyColor, 0.6, 0.2)));
```

This is mechanical but tedious — go through each `_buildXxx` function in order. Skim the file:
```bash
grep -n "_build\|new THREE.BoxGeometry\|new THREE.CylinderGeometry" src/renderer3d/component-builder.js
```
and rewrite each match. **Skip** `CircleGeometry` (used for bore openings — they'd need radial UV math we don't have; leave them solid).

- [ ] **Step 7: Visual verification**

Run `npm run dev`, open the browser. Place a beamline with a source, several drifts, and any other components. They should now show textured surfaces:
- The source body gets brushed-metal-style texture (whatever `_mat`'s default still produces — without textureName, primitives stay solid; the visible difference is on role-template components and on `SHARED_MATERIALS`-using accent meshes).
- Role-template components fully textured.
- Pipes have brushed metal grain.
- Stands look like painted dark metal with subtle texture.

This step does NOT yet add textures to legacy builders' colored bodies; that's deferred to a later iteration where the user picks per-primitive texture names. The infrastructure is in place.

Confirm: no console errors, no missing textures, framerate unchanged (a quick eyeball at devtools "Performance" or "FPS meter" — should be the same as before).

- [ ] **Step 8: Commit**

```bash
git add src/renderer3d/component-builder.js
git commit -m "$(cat <<'EOF'
feat(textures): wire beamline components to MATERIALS

SHARED_MATERIALS now derive their .map from the materials module so
every role-template mesh gets a tiled pixel-art texture (metal_dark,
copper, metal_brushed, metal_painted_white). Accent materials inherit
the painted-white base map and tint via color, preserving per-component
accent color while adding surface texture.

_mat() gains an optional textureName argument so legacy _buildXxx
builders can opt in per-primitive without restructuring. All Box and
Cylinder primitives get applyTiledBoxUVs/applyTiledCylinderUVs applied
at construction time so UVs are world-scaled regardless of whether the
final material has a map yet.
EOF
)"
```

---

## Task 7: Per-component texture overrides

Allow component definitions in `components.raw.js` to declare `textures: { iron: 'metal_painted_white', ... }` to override role defaults for that component type. Validate against `MATERIALS` keys.

**Files:**
- Modify: `src/renderer3d/component-builder.js`
- Modify: `src/data/components.raw.js` (add overrides to 2 components as proof)

- [ ] **Step 1: Read the relevant section of components.raw.js**

```bash
grep -n "^  [a-z_]*: {" src/data/components.raw.js | head -20
```
Note the schema for component definitions and pick two components to override as a proof of feature: a magnet (e.g., `dipole`) and an RF cavity (e.g., one from the `RF` category).

- [ ] **Step 2: Update `_instantiateRoleTemplate` to honor per-component overrides**

In `src/renderer3d/component-builder.js`, find `_instantiateRoleTemplate` (lines 143-167). Modify the loop to check the component's def for a `textures` map and override the role material accordingly.

Add a small helper above `_instantiateRoleTemplate`:

```js
// Build a per-component override material that mirrors a role material
// but swaps the .map to a different MATERIALS entry. Cached by
// (compType + '|' + role + '|' + textureName).
const _overrideRoleMatCache = new Map();

function _getOverrideRoleMaterial(compType, role, textureName) {
  const key = `${compType}|${role}|${textureName}`;
  let m = _overrideRoleMatCache.get(key);
  if (m) return m;
  const base = SHARED_MATERIALS[role];
  const tex = MATERIALS[textureName];
  if (!base || !tex) return base ?? null;
  m = new THREE.MeshStandardMaterial({
    map: tex.map,
    color: base.color.clone(),
    roughness: base.roughness,
    metalness: base.metalness,
  });
  _overrideRoleMatCache.set(key, m);
  return m;
}
```

Then in `_instantiateRoleTemplate`, replace the `mat = role === 'accent' ? ...` block:

```js
// Resolve per-role material with optional per-component override
const compDef = COMPONENTS[compType];
const overrides = (compDef && compDef.textures) || null;
for (const role of ROLES) {
  const tplMesh = template[role];
  if (!tplMesh) continue;
  let mat;
  if (role === 'accent') {
    mat = getAccentMaterial(compType, accentColorHex);
  } else if (overrides && overrides[role]) {
    mat = _getOverrideRoleMaterial(compType, role, overrides[role]);
  } else {
    mat = SHARED_MATERIALS[role];
  }
  const mesh = new THREE.Mesh(tplMesh.geometry, mat);
  // ...rest of existing loop body unchanged
}
```

- [ ] **Step 3: Add overrides to two components in `components.raw.js`**

Pick two components and add a `textures` field. Example for a dipole (override `iron` to look painted instead of dark):

```js
dipole: {
  // ...existing fields
  textures: { iron: 'metal_painted_white' },
},
```

And for an RF cavity (override `iron` to brushed):
```js
rf_cavity: {  // or whatever the actual key is
  // ...existing fields
  textures: { iron: 'metal_brushed' },
},
```

If neither of these components is currently on the role-template path (i.e. they're built by legacy `_buildXxx`), pick instead the components that ARE in `ROLE_BUILDERS` — check with:
```bash
grep -n "ROLE_BUILDERS\[" src/renderer3d/component-builder.js
```

If `ROLE_BUILDERS` is fully empty, this task's override hook is wired but visually inactive — that's fine. Document this in the commit message and leave the override system in place for when components migrate to the role pattern.

- [ ] **Step 4: Visual verification**

Run `npm run dev`. Place the two overridden components in a beamline. Confirm they show different texture appearances than other components of the same role family.

- [ ] **Step 5: Commit**

```bash
git add src/renderer3d/component-builder.js src/data/components.raw.js
git commit -m "$(cat <<'EOF'
feat(textures): per-component texture overrides via 'textures' field

Component definitions can declare textures: { iron: 'metal_painted_white' }
to override the default role material for that component type. Override
materials are cached by (compType + role + textureName) so all instances
of the same overridden component share one material. Two components
override iron as proof of feature.
EOF
)"
```

---

## Task 8: Equipment 6-face refactor

Refactor `equipment-builder.js` so each equipment box uses a 6-slot material array instead of a single material. Each face independently uses either a tiled material from `MATERIALS` or a decal from `DECALS`. v1: all faces use `baseMaterial`; decals are wired in Task 9.

**Files:**
- Modify: `src/renderer3d/equipment-builder.js`
- Modify: `src/data/placeables/equipment.js` (add `baseMaterial` to a few items)
- Modify: `src/data/placeables/furnishings.js` (same)

- [ ] **Step 1: Inspect current equipment definitions**

```bash
head -60 src/data/placeables/equipment.js
head -40 src/data/placeables/furnishings.js
```
Note the existing field shape — likely `{ subW, subH, subL, color, ... }`. We'll add an optional `baseMaterial: 'metal_dark'` and (in Task 9) `faces: { '+Z': { decal: '...' } }`.

- [ ] **Step 2: Pick reasonable default materials per equipment item**

For each equipment item, pick a `baseMaterial` from MATERIALS. Best-guess assignments:

| Item kind | baseMaterial |
|---|---|
| Server rack, control rack | `metal_dark` |
| Workstation, computer cart | `metal_painted_white` |
| Cryo fridge, refrigeration unit | `metal_painted_white` |
| Power supply unit (PSU) | `metal_dark` |
| Oscilloscope cart, scope | `metal_painted_white` |
| Workbench, table | `metal_brushed` (for v1; wood comes later via PixelLab) |
| Cabinet, locker | `metal_painted_white` |
| Default fallback | `metal_dark` |

Add `baseMaterial: '<name>'` to each entry in `equipment.js` and `furnishings.js`.

- [ ] **Step 3: Refactor `equipment-builder.js`**

Replace the entire current `build()` body with the version below. The change:
- Each box gets a 6-entry material array.
- Materials look up `MATERIALS[baseMaterial]` (or fall back to a tinted solid color).
- `applyTiledBoxUVs` is called on each geometry.
- A face-override hook (`compDef.faces`) is wired but can be empty for now.

```js
import { PLACEABLES } from '../data/placeables/index.js';
import { MATERIALS } from './materials/index.js';
import { applyTiledBoxUVs } from './uv-utils.js';

const SUB_UNIT = 0.5;

// Cache per (compType + faceKey) -> material so identical face configs share.
const _equipMatCache = new Map();

function _faceMaterial(compType, faceKey, baseName, faceOverride, fallbackColor) {
  const cacheKey = `${compType}|${faceKey}|${baseName}|${faceOverride ? JSON.stringify(faceOverride) : ''}`;
  let m = _equipMatCache.get(cacheKey);
  if (m) return m;
  let map = null;
  let color = fallbackColor;
  if (faceOverride && faceOverride.decal) {
    // Decals are looked up at draw time from DECALS module — but we don't
    // import DECALS here directly to avoid binding to a not-yet-populated
    // map. The Task 9 step replaces this branch.
    map = null;
    color = fallbackColor;
  } else if (baseName && MATERIALS[baseName]) {
    map = MATERIALS[baseName].map;
    color = 0xffffff;
  }
  m = new THREE.MeshStandardMaterial({
    map,
    color,
    roughness: 0.7,
    metalness: 0.2,
  });
  _equipMatCache.set(cacheKey, m);
  return m;
}

export class EquipmentBuilder {
  constructor() {
    /** @type {THREE.Mesh[]} */
    this._meshes = [];
  }

  build(equipmentData, furnishingData, parentGroup) {
    this.dispose(parentGroup);

    const FACE_KEYS = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];

    const placeOne = (item, isFurnishing) => {
      const compDef = PLACEABLES[item.type];
      if (!compDef && !isFurnishing) return;

      const w = (compDef?.subW || (isFurnishing ? 1 : 2)) * SUB_UNIT;
      const h = (compDef?.subH || (isFurnishing ? 1 : 2)) * SUB_UNIT;
      const l = (compDef?.subL || compDef?.subH || (isFurnishing ? 1 : 2)) * SUB_UNIT;

      const geo = new THREE.BoxGeometry(w, h, l);
      applyTiledBoxUVs(geo, w, h, l);
      // BoxGeometry has a 6-group draw range one per face, so a material
      // array works directly without setting groups manually.

      const fallbackColor = compDef?.spriteColor || compDef?.color || 0x888888;
      const baseName = compDef?.baseMaterial || null;
      const faces = compDef?.faces || {};

      const matArray = FACE_KEYS.map(key =>
        _faceMaterial(item.type, key, baseName, faces[key], fallbackColor)
      );

      const mesh = new THREE.Mesh(geo, matArray);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;

      const tileX = (item.col ?? 0) * 2;
      const tileZ = (item.row ?? 0) * 2;
      const subX = (item.subCol || 0) * SUB_UNIT;
      const subZ = (item.subRow || 0) * SUB_UNIT;
      mesh.position.set(tileX + subX + w / 2, h / 2, tileZ + subZ + l / 2);
      mesh.updateMatrix();

      parentGroup.add(mesh);
      this._meshes.push(mesh);
    };

    if (equipmentData) for (const eq of equipmentData) placeOne(eq, false);
    if (furnishingData) for (const furn of furnishingData) placeOne(furn, true);
  }

  dispose(parentGroup) {
    for (const mesh of this._meshes) {
      parentGroup.remove(mesh);
      mesh.geometry.dispose();
      // Materials are cached and shared across instances — do NOT dispose here.
    }
    this._meshes = [];
  }
}
```

Note the disposal change: materials in `_equipMatCache` are shared across all instances and across rebuilds, so we no longer dispose them per-mesh. They live for the session.

- [ ] **Step 4: Visual verification**

Run `npm run dev`. Place a few equipment items: a server rack, a workstation, a cabinet. Each should now show its `baseMaterial` texture on all 6 faces with consistent texel size. A small workstation and a tall server rack of the same `baseMaterial` should show the same-size pixels, just different repetition counts.

Confirm: framerate unchanged, no errors, equipment items visually distinct from each other (different materials → different surface looks).

- [ ] **Step 5: Commit**

```bash
git add src/renderer3d/equipment-builder.js src/data/placeables/equipment.js src/data/placeables/furnishings.js
git commit -m "$(cat <<'EOF'
feat(textures): equipment 6-face material array refactor

Each equipment and furnishing box now uses a 6-entry MeshStandardMaterial
array (one per face) instead of a single material. Each face looks up
its material via MATERIALS[baseMaterial] from the placeable definition,
with a face-override hook (compDef.faces['+Z'] = { decal: ... }) wired
for the next task. World-scaled UVs via applyTiledBoxUVs keep texel
size constant across box sizes.

Materials are cached by (compType + face + base + override) so all
instances of the same equipment type share one material array. Disposal
no longer destroys materials — they're owned by the session-level cache.
EOF
)"
```

---

## Task 9: First decals

Author or PixelLab-generate 2-3 decals for hero equipment items. Wire them through `DECALS` and via the `faces` override on equipment definitions.

**Files:**
- Create: `assets/textures/decals/server_rack_front.png` (PixelLab or hand)
- Create: `assets/textures/decals/oscilloscope_crt.png`
- Create: `assets/textures/decals/psu_front.png`
- Modify: `src/renderer3d/materials/decals.js`
- Modify: `src/renderer3d/equipment-builder.js`
- Modify: `src/data/placeables/equipment.js`

- [ ] **Step 1: Generate or hand-author the 3 decals**

Two routes:

**Route A — Hand-author placeholders.** Quickest. Open Aseprite (or similar) and draw three pixel-art images. Suggested sizes (match the target face aspect):
- `server_rack_front.png`: 64×128 (tall, narrow). Black bezel with horizontal LED strips, rack-mount unit dividers.
- `oscilloscope_crt.png`: 96×64. Dark green CRT face with a bright sine waveform across the middle.
- `psu_front.png`: 96×64. Beige/gray panel with a power switch, two analog meters, and labels.

Save into `assets/textures/decals/`.

**Route B — PixelLab via existing asset-gen.** Run the asset-gen server, use the existing `/api/generate` endpoint with `assetType='tile'` and `description='oscilloscope CRT screen showing a sine wave waveform, dark green phosphor, retro lab equipment'` (etc.). Save the outputs as the three filenames above. (The dedicated decal endpoint is built in Task 10; for v1 we just hand-place 3 PNGs.)

Either way, end with three real PNGs in `assets/textures/decals/`.

- [ ] **Step 2: Wire the decals into `decals.js`**

Edit `src/renderer3d/materials/decals.js`. Replace the empty `DECALS` export:

```js
export const DECALS = {
  server_rack_front: makeDecal('server_rack_front.png'),
  oscilloscope_crt:  makeDecal('oscilloscope_crt.png'),
  psu_front:         makeDecal('psu_front.png'),
};
```

- [ ] **Step 3: Wire decal materials into `equipment-builder.js`**

In `equipment-builder.js`, replace the `_faceMaterial` decal branch (currently a stub) with a real lookup. Add the import:

```js
import { MATERIALS } from './materials/index.js';
import { DECALS } from './materials/decals.js';
```

(The `MATERIALS` import is already there; add `DECALS`.)

Then update the decal branch in `_faceMaterial`:
```js
if (faceOverride && faceOverride.decal && DECALS[faceOverride.decal]) {
  // Reuse the singleton DECALS material directly — it's already
  // configured with map, wrap, filter, colorspace.
  return DECALS[faceOverride.decal];
}
```

This means when a face declares a decal, the cache returns the shared DECALS singleton instead of constructing a new material. Update the function to early-return on this branch (before the cache key construction) so the cache doesn't shadow the singleton:

```js
function _faceMaterial(compType, faceKey, baseName, faceOverride, fallbackColor) {
  // Decal: shared singleton, no cache needed.
  if (faceOverride && faceOverride.decal && DECALS[faceOverride.decal]) {
    return DECALS[faceOverride.decal];
  }

  const cacheKey = `${compType}|${faceKey}|${baseName}|${faceOverride ? JSON.stringify(faceOverride) : ''}`;
  let m = _equipMatCache.get(cacheKey);
  if (m) return m;

  let map = null;
  let color = fallbackColor;
  if (baseName && MATERIALS[baseName]) {
    map = MATERIALS[baseName].map;
    color = 0xffffff;
  }
  m = new THREE.MeshStandardMaterial({
    map, color, roughness: 0.7, metalness: 0.2,
  });
  _equipMatCache.set(cacheKey, m);
  return m;
}
```

- [ ] **Step 4: Add `faces` overrides to three equipment definitions**

In `src/data/placeables/equipment.js`, find the server rack, oscilloscope, and PSU entries (or whatever the closest items are — pick three that have a clear "front face"). Add a `faces` field to each:

```js
serverRack: {
  // ...existing fields
  baseMaterial: 'metal_dark',
  faces: { '+Z': { decal: 'server_rack_front' } },
},

oscilloscope: {
  // ...existing fields
  baseMaterial: 'metal_painted_white',
  faces: { '+Z': { decal: 'oscilloscope_crt' } },
},

psuRack: {
  // ...existing fields
  baseMaterial: 'metal_dark',
  faces: { '+Z': { decal: 'psu_front' } },
},
```

The `+Z` face is the BoxGeometry "front" in our coordinate system (`+Z` = south, but visually "front-facing" depends on how the equipment item is rotated by the renderer; if the front face is wrong, try `-Z` instead — visual feedback in Step 5 will tell you).

If the entries don't exist with those exact names, use whatever entries are closest. The point is to demonstrate three decals in-game.

- [ ] **Step 5: Visual verification**

Run `npm run dev`. Place the three equipment items in a build. Each should now show its decal on the front face (CRT screen, server rack panel, PSU front) and the tiled `baseMaterial` on the other 5 faces.

Check:
1. Decals show on the right face. If not, swap `+Z` for `-Z` in the faces field.
2. Decal pixels are crisp (NearestFilter working).
3. Decal does not tile — it fits the face exactly (ClampToEdgeWrapping working).
4. Other 5 faces still show the base material with consistent texel density.
5. No console errors.

- [ ] **Step 6: Commit**

```bash
git add assets/textures/decals/ src/renderer3d/materials/decals.js src/renderer3d/equipment-builder.js src/data/placeables/equipment.js
git commit -m "$(cat <<'EOF'
feat(textures): first decals — server rack front, CRT, PSU panel

Adds three hero face decals (server_rack_front, oscilloscope_crt,
psu_front) to assets/textures/decals/, registers them in the DECALS
module export, and wires three equipment items to use them via the
faces: { '+Z': { decal: '<name>' } } override field.

Decal materials are module-level singletons shared across all instances
of the same equipment type. Decal lookup short-circuits the per-comp
cache and returns the singleton directly.
EOF
)"
```

---

## Task 10: Asset-gen decal endpoint and Decals dashboard tab

Productionize decal generation: add a POST endpoint to `tools/asset-gen/server.cjs` that drives PixelLab with the right parameters for face decals (clamped, no tiling, target aspect ratio), and add a Decals tab to the dashboard listing equipment items with decal slots.

**Files:**
- Modify: `tools/asset-gen/server.cjs`
- Modify: `tools/asset-gen/public/index.html` (and any associated JS)

- [ ] **Step 1: Read the existing tile generation endpoint**

```bash
grep -n "assetType === 'tile'\|/api/generate" tools/asset-gen/server.cjs | head
```
Note the structure. The new endpoint mirrors it but writes to `assets/textures/decals/` and uses different prompt scaffolding.

- [ ] **Step 2: Add the decal endpoint to `server.cjs`**

Find the existing `/api/generate` handler. Below it, add a new handler for `/api/generate-decal`:

```js
// ── Generate decal (face texture for equipment) ──
if (url.pathname === '/api/generate-decal' && req.method === 'POST') {
  const body = await readBody(req);
  const { name, prompt, width, height, equipmentType } = JSON.parse(body);

  const DECALS_DIR = path.join(__dirname, '..', '..', 'assets', 'textures', 'decals');
  if (!fs.existsSync(DECALS_DIR)) fs.mkdirSync(DECALS_DIR, { recursive: true });

  const payload = {
    description: `${prompt}, pixel art, RollerCoaster Tycoon 2 style, front face of laboratory equipment, no perspective, flat front view`,
    image_size: { width: width || 64, height: height || 64 },
    view: 'side',
    outline: 'selective outline',
    shading: 'medium shading',
    detail: 'high detail',
  };

  const result = await pixelabPost('/v2/generate-image-pixflux', payload);
  const objectId = result.image_id || result.id || result.object_id;

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    objectId,
    status: 'queued',
    name,
    targetPath: `assets/textures/decals/${name}.png`,
    equipmentType,
  }));
  return;
}
```

If PixelLab's actual API differs (the endpoint name, payload shape), look at the existing `/api/generate` handler in the same file for the working pattern and copy that. The point is: a new endpoint that takes a decal name, prompt, and dimensions and produces a PNG in the right directory.

You'll likely also need a polling endpoint to check status and download the result. The existing tile flow has one; mirror it for decals.

- [ ] **Step 3: Add a Decals tab to the dashboard**

Find `tools/asset-gen/public/index.html` (or wherever the dashboard UI lives — `ls tools/asset-gen/public/` first if uncertain). Add a new tab called "Decals" alongside the existing "Components" / "Tiles" tabs.

The Decals tab should:
1. Read the equipment definitions (probably by fetching `/api/equipment` — add this endpoint to `server.cjs` if it doesn't exist; it should return the contents of `src/data/placeables/equipment.js` parsed as JSON)
2. List all equipment items that have a `faces` field
3. For each face slot in each item, show: current decal preview (if exists in `assets/textures/decals/`), prompt input, "Generate" button
4. Clicking "Generate" calls `POST /api/generate-decal` with `{ name, prompt, width, height, equipmentType }`
5. Polls until complete, then auto-refreshes the preview

This step is the largest UI work in the plan. If the existing dashboard is heavy and changing it is risky, an acceptable smaller scope is: just add a single "Generate Decal" form with manual fields (name, prompt, width, height) and skip the per-equipment listing. The user can grow it later.

- [ ] **Step 4: Smoke-test the new endpoint**

Start the asset-gen server:
```bash
npm run assets
```

In another terminal, hit the new endpoint:
```bash
curl -X POST http://localhost:8001/api/generate-decal \
  -H 'Content-Type: application/json' \
  -d '{"name":"test_decal","prompt":"a glowing red emergency button","width":64,"height":64,"equipmentType":"safety"}'
```

Expected: a JSON response with `objectId`, `status: 'queued'`, and `targetPath`. After PixelLab finishes (poll the existing status endpoint), `assets/textures/decals/test_decal.png` should exist.

Delete the test file:
```bash
rm assets/textures/decals/test_decal.png
```

- [ ] **Step 5: Commit**

```bash
git add tools/asset-gen/server.cjs tools/asset-gen/public/
git commit -m "$(cat <<'EOF'
feat(asset-gen): decal generation endpoint and dashboard tab

Adds POST /api/generate-decal which drives PixelLab to produce a
flat-front face texture and writes the result to
assets/textures/decals/<name>.png. The dashboard gains a Decals tab
that lists equipment items with face decal slots and provides a
generate button per slot. Mirrors the existing tile generation flow.
EOF
)"
```

---

## Task 11: Fill out the decal library

Iteratively generate the rest of the decals using the new endpoint. Each new decal involves: PixelLab generation, registration in `decals.js`, wiring into the relevant equipment definition's `faces` field.

**Files:**
- Create: `assets/textures/decals/*.png` (multiple)
- Modify: `src/renderer3d/materials/decals.js`
- Modify: `src/data/placeables/equipment.js`

- [ ] **Step 1: List the equipment items that need decals**

```bash
grep -n "spriteColor\|color: 0x" src/data/placeables/equipment.js | head -30
```
Identify which items have a clear "front face" (display, control panel, door): VNA, computer monitor, cryo fridge, control rack, electrical distribution panel, etc. List ~7 candidates.

- [ ] **Step 2: Generate one decal at a time**

For each candidate, use the dashboard Decals tab (or `curl` directly) to call `/api/generate-decal` with a descriptive prompt. Examples:

| Decal name | Prompt |
|---|---|
| `vna_screen` | "VNA vector network analyzer screen showing two phase plots, blue background, white traces, retro lab equipment" |
| `computer_monitor` | "CRT computer monitor showing green-on-black terminal text, retro lab workstation" |
| `cryo_fridge_door` | "Stainless steel refrigerator door, large handle, biohazard label, science lab" |
| `control_rack_front` | "control system rack front, red emergency button, status LEDs, brushed metal" |

Iterate until each output looks acceptable. If a generation is bad, regenerate with a tweaked prompt.

- [ ] **Step 3: Register each new decal in `decals.js`**

After each successful generation, add a line to `DECALS` in `src/renderer3d/materials/decals.js`:
```js
vna_screen:        makeDecal('vna_screen.png'),
computer_monitor:  makeDecal('computer_monitor.png'),
cryo_fridge_door:  makeDecal('cryo_fridge_door.png'),
// ...etc
```

- [ ] **Step 4: Wire each decal into the equipment definition**

For each new decal, edit the matching entry in `equipment.js`:
```js
vna: {
  // ...
  baseMaterial: 'metal_painted_white',
  faces: { '+Z': { decal: 'vna_screen' } },
},
```

- [ ] **Step 5: Visual verification (run after every 2-3 additions)**

Run `npm run dev` and visually confirm each new decal renders on the right equipment item. Iterate prompts on bad decals.

- [ ] **Step 6: Commit in batches**

After adding 2-3 decals at a time, commit:

```bash
git add assets/textures/decals/ src/renderer3d/materials/decals.js src/data/placeables/equipment.js
git commit -m "$(cat <<'EOF'
feat(textures): decals for VNA, monitor, cryo fridge

Adds three more hero face decals generated via PixelLab and wires
them into the corresponding equipment definitions.
EOF
)"
```

Repeat until the decal library covers all hero equipment items.

---

## Self-Review

After writing the plan, I checked it against the spec:

**Spec coverage:**
- Two-track architecture (beamline role-merged + equipment single-box) → Tasks 6, 7, 8, 9
- Fixed texel density / world-scaled UVs → Task 3 (utility) + Tasks 4, 5, 6, 8 (consumers)
- Texture catalog (~11 tiled, decals) → Task 1 (procedural script + 11 PNGs), Task 9 (initial decals)
- Authoring split (procedural + PixelLab + RCT2) → Task 1 (procedural) + Task 10 (PixelLab endpoint). RCT2 is deferred per spec.
- Materials as module exports (no manifest) → Task 2
- Wall integration → Task 4
- Floor integration → Task 5
- Per-component overrides → Task 7
- Asset-gen decal flow → Task 10

All spec sections covered.

**Placeholder scan:** No "TBD"/"TODO"/"implement later". One soft spot: Task 8 Step 2 lists "best-guess defaults" for equipment baseMaterial assignments — these are explicit suggestions to apply, not placeholders. Task 11 Step 1 says "identify candidates" because the decal library is genuinely iterative, but each candidate gets concrete generation/registration steps.

**Type consistency:** `MATERIALS`, `DECALS`, `TEXEL_SCALE`, `applyTiledBoxUVs`, `applyTiledCylinderUVs`, `_faceMaterial`, `getAccentMaterial`, `_getOverrideRoleMaterial` — used consistently across all tasks.

**Risk areas flagged:**
- Task 6 Step 5: `ROLE_BUILDERS` may be sparse/empty in the current codebase. If so, the role-template UV rewrite is a no-op for v1, but the legacy `_buildXxx` UV rewrite in Step 6 still happens. Documented in the task.
- Task 7 Step 3: per-component overrides are visible only on role-template components. If those don't exist yet, the system is wired but visually inactive.
- Task 9 Step 4: decal face direction (`+Z` vs `-Z`) is empirical — the task instructs to swap if visually wrong.
- Task 10 Step 2: PixelLab endpoint shape may differ from the assumed `/v2/generate-image-pixflux` — task instructs to mirror the existing `/api/generate` handler if so.
