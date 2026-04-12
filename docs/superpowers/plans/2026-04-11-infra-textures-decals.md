# Infrastructure Textures & Decals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give infrastructure items per-category paint and hero-face decals by extending `component-builder.js`'s fallback path to honor `baseMaterial`/`faces` fields, generating 8 new tiled materials and 14 new decals procedurally, and authoring these fields onto ~38 infra raw entries.

**Architecture:** Single-path renderer extension — `_createFallbackMesh` in `component-builder.js` gains box-branch multi-material support (6-entry array, per-face UV clamping for decals) and cylinder-branch base-material support. Infra raw entries opt in via optional `baseMaterial`/`faces` fields matching the `equipment-builder` convention. Flat-color fallback preserved for un-authored items.

**Asset pipeline:** Pure procedural pixel art generated via Node scripts (`pngjs`), matching the existing `tools/asset-gen/gen-materials.cjs` and `gen-rf-decals.cjs` workflow. Deterministic seeded PRNG so re-runs reproduce. Same chunky 2px palette and helper vocabulary as the existing RF lab decals (knobs, screens, LCDs, screws, venting, warning stickers). No external services, no PixelLab.

**Tech Stack:** Node + `pngjs` (asset generation), Three.js (CDN global, do NOT import) for rendering, plain JS modules.

**No automated tests.** This is a purely visual change. Verification is manual in-browser plus visual eyeballing of generated PNGs.

---

## File Structure

**Modified:**
- `tools/asset-gen/gen-materials.cjs` — add 5 new palette calls + 3 new generator functions for infra paints/trims
- `src/renderer3d/materials/tiled.js` — register 8 new MATERIALS entries
- `src/renderer3d/materials/decals.js` — register 14 new DECALS entries
- `src/renderer3d/component-builder.js` — extend `_createFallbackMesh` (~line 1865) with box-branch `faces`/`baseMaterial` support and cylinder-branch `baseMaterial` support; add `_infraFaceMatCache` module-level cache
- `src/data/infrastructure.raw.js` — author `baseMaterial`/`faces` on ~38 entries (RF power, cooling, vacuum, controls/safety/ops, power)

**Created:**
- `tools/asset-gen/gen-infra-decals.cjs` — new sibling generator for the 14 infra decal panels
- 8 PNGs under `assets/textures/materials/`
- 14 PNGs under `assets/textures/decals/`

---

## Task 1: Add 8 infra materials to `gen-materials.cjs`

**Files:**
- Modify: `tools/asset-gen/gen-materials.cjs` — add 3 new generator functions and 8 entries in the main script section

The 5 paint variants are simple `gen_solidNoise` calls with new palettes. The 3 new patterns (`metal_corrugated`, `cryo_frost`, `hazard_stripe`) need new generator functions. All output 64×64 seamless PNGs at the existing CHUNK=2 scale.

- [ ] **Step 1: Add `gen_corrugated` generator**

In `tools/asset-gen/gen-materials.cjs`, just after the `gen_mesh` function (~line 141) and before the `// ── Exterior wall variants` section, add:

```js
// Vertical corrugated paneling: regular dark/light bands every 4px column,
// brushed metal feel with tiny per-pixel jitter so it doesn't look flat.
function gen_corrugated(name, baseRGB, seed) {
  const png = makePng();
  const rand = mulberry32(seed);
  for (let y = 0; y < SIZE; y += CHUNK) {
    for (let x = 0; x < SIZE; x += CHUNK) {
      // 4px-wide vertical ribs: each rib has a bright crest then dark trough.
      const phase = (x % 8);
      let band;
      if (phase === 0) band = 18;       // crest
      else if (phase === 2) band = 6;
      else if (phase === 4) band = -10;
      else band = -22;                  // trough
      const n = (rand() - 0.5) * 6;
      setBlock(png, x, y, baseRGB[0] + band + n, baseRGB[1] + band + n, baseRGB[2] + band + n, CHUNK);
    }
  }
  writePng(png, name);
}
```

- [ ] **Step 2: Add `gen_frost` generator**

Immediately after `gen_corrugated`, add:

```js
// Cryogenic insulation: pale blue-white base with sparse white frost
// crystals and a faint diagonal quilting pattern.
function gen_frost(name, baseRGB, crystalRGB, seed) {
  const png = makePng();
  const rand = mulberry32(seed);
  for (let y = 0; y < SIZE; y += CHUNK) {
    for (let x = 0; x < SIZE; x += CHUNK) {
      // Diagonal quilting: faint ridges every 16px along (x+y)
      const quilt = ((x + y) % 16 === 0) ? 8 : 0;
      const n = (rand() - 0.5) * 10;
      setBlock(png, x, y, baseRGB[0] + quilt + n, baseRGB[1] + quilt + n, baseRGB[2] + quilt + n, CHUNK);
    }
  }
  // Frost crystals: ~25 small bright clusters
  for (let i = 0; i < 25; i++) {
    const cx = Math.floor(rand() * SIZE / CHUNK) * CHUNK;
    const cy = Math.floor(rand() * SIZE / CHUNK) * CHUNK;
    setBlock(png, cx, cy, crystalRGB[0], crystalRGB[1], crystalRGB[2], CHUNK);
    if (rand() > 0.4) setBlock(png, (cx + CHUNK) % SIZE, cy, crystalRGB[0], crystalRGB[1], crystalRGB[2], CHUNK);
    if (rand() > 0.4) setBlock(png, cx, (cy + CHUNK) % SIZE, crystalRGB[0], crystalRGB[1], crystalRGB[2], CHUNK);
  }
  writePng(png, name);
}
```

- [ ] **Step 3: Add `gen_hazardStripe` generator**

Immediately after `gen_frost`, add:

```js
// Diagonal hazard stripes: yellow/black every 8px on a 45° diagonal,
// seamless because the period divides SIZE.
function gen_hazardStripe(name, yellowRGB, blackRGB, seed) {
  const png = makePng();
  const rand = mulberry32(seed);
  const period = 16; // two 8-px stripes per period — divides 64 evenly
  for (let y = 0; y < SIZE; y += CHUNK) {
    for (let x = 0; x < SIZE; x += CHUNK) {
      const d = (x + y) % period;
      const isBlack = d < period / 2;
      const c = isBlack ? blackRGB : yellowRGB;
      const n = (rand() - 0.5) * 8;
      setBlock(png, x, y, c[0] + n, c[1] + n, c[2] + n, CHUNK);
    }
  }
  writePng(png, name);
}
```

- [ ] **Step 4: Add 8 generator calls to the main script**

At the bottom of `gen-materials.cjs`, just after the existing `gen_grid('cable_tray', ...)` line (~line 359) and before the `// Exterior wall variants` comment, add:

```js
// Infra category paints (Pass D — infra textures and decals)
gen_solidNoise('metal_painted_red',    [180, 50, 50],   18, 40);
gen_solidNoise('metal_painted_blue',   [55, 95, 145],   18, 41);
gen_solidNoise('metal_painted_green',  [70, 120, 70],   18, 42);
gen_solidNoise('metal_painted_yellow', [200, 175, 60],  18, 43);
gen_solidNoise('metal_painted_gray',   [130, 132, 138], 16, 44);

// Infra trims and patterns
gen_corrugated('metal_corrugated', [128, 132, 138], 45);
gen_frost('cryo_frost', [200, 215, 230], [240, 248, 255], 46);
gen_hazardStripe('hazard_stripe', [220, 190, 60], [25, 25, 28], 47);
```

- [ ] **Step 5: Run the script**

Run:
```bash
node tools/asset-gen/gen-materials.cjs
```
Expected: prints `wrote .../metal_painted_red.png` (and 7 more), then `done.`. No errors.

- [ ] **Step 6: Verify all 8 new files exist and are non-empty**

Run:
```bash
ls -lh assets/textures/materials/metal_painted_red.png \
       assets/textures/materials/metal_painted_blue.png \
       assets/textures/materials/metal_painted_green.png \
       assets/textures/materials/metal_painted_yellow.png \
       assets/textures/materials/metal_painted_gray.png \
       assets/textures/materials/metal_corrugated.png \
       assets/textures/materials/cryo_frost.png \
       assets/textures/materials/hazard_stripe.png
```
Expected: all 8 paths listed, each with non-zero size.

- [ ] **Step 7: Eyeball the PNGs (optional but recommended)**

Open one or two of the new PNGs in any image viewer at 4× zoom. Confirm the paint colors look right (not washed out, not oversaturated), the corrugated has visible vertical ribs, the frost has visible crystals, the hazard stripe has clean diagonal alternation. If anything looks wrong, adjust the palette/parameters in the script and re-run before continuing — re-runs are deterministic and free.

- [ ] **Step 8: Commit**

```bash
git add tools/asset-gen/gen-materials.cjs \
        assets/textures/materials/metal_painted_red.png \
        assets/textures/materials/metal_painted_blue.png \
        assets/textures/materials/metal_painted_green.png \
        assets/textures/materials/metal_painted_yellow.png \
        assets/textures/materials/metal_painted_gray.png \
        assets/textures/materials/metal_corrugated.png \
        assets/textures/materials/cryo_frost.png \
        assets/textures/materials/hazard_stripe.png
git commit -m "feat(materials): generate 8 infra paint and trim textures"
```

---

## Task 2: Register new tiled materials in `tiled.js`

**Files:**
- Modify: `src/renderer3d/materials/tiled.js`

- [ ] **Step 1: Add material entries to the `MATERIALS` export object**

Edit `src/renderer3d/materials/tiled.js`. Just after the existing `cable_tray:` line (~line 50) and before the `// Tile materials extracted from...` comment, add:

```js
  metal_painted_red:    makeMat('metal_painted_red.png',    { roughness: 0.6, metalness: 0.2 }),
  metal_painted_blue:   makeMat('metal_painted_blue.png',   { roughness: 0.6, metalness: 0.2 }),
  metal_painted_green:  makeMat('metal_painted_green.png',  { roughness: 0.6, metalness: 0.2 }),
  metal_painted_yellow: makeMat('metal_painted_yellow.png', { roughness: 0.6, metalness: 0.2 }),
  metal_painted_gray:   makeMat('metal_painted_gray.png',   { roughness: 0.6, metalness: 0.2 }),
  metal_corrugated:     makeMat('metal_corrugated.png',     { roughness: 0.5, metalness: 0.5 }),
  cryo_frost:           makeMat('cryo_frost.png',           { roughness: 0.85, metalness: 0.05 }),
  hazard_stripe:        makeMat('hazard_stripe.png',        { roughness: 0.7, metalness: 0.15 }),
```

- [ ] **Step 2: Smoke-test in dev server**

Start dev server (e.g. `npm run dev` or whichever script the project uses). Open the game in the browser. Open devtools console. Verify no 404s for the new PNGs and no Three.js load errors. No visual change yet — the materials are registered but nothing references them.

- [ ] **Step 3: Commit**

```bash
git add src/renderer3d/materials/tiled.js
git commit -m "feat(materials): register 8 infra paint and trim materials"
```

---

## Task 3: Create `gen-infra-decals.cjs` scaffold + RF power decals

**Files:**
- Create: `tools/asset-gen/gen-infra-decals.cjs`

The decal generator borrows the helper vocabulary from `gen-rf-decals.cjs` (small enough that duplication is cheaper than refactoring). All 6 RF power decals share a common pattern: tall rectangular front view of an RF source, body color from the category palette, with one or two distinctive elements (warning placard, nameplate, tube window, LED rack column, etc.).

Decal aspect ratios are chosen to match the visualSubW × visualSubH of the items they decorate. Boxes in this game are flat-shaded with NearestFilter, so the decal is sampled at ~64–128 px regardless of authored size. We use 64×64 as a good default; klystrons are taller-than-wide so use 48×64.

- [ ] **Step 1: Create the scaffold and shared helpers**

Create `tools/asset-gen/gen-infra-decals.cjs` with this content:

```js
#!/usr/bin/env node
// Procedural pixel-art front-panel decals for infrastructure items.
// Outputs PNGs to assets/textures/decals/.
// Run: node tools/asset-gen/gen-infra-decals.cjs
//
// Each decal maps to one full face of its box mesh (clamp-to-edge UVs).
// Shared style with gen-rf-decals.cjs — chunky 2px pixels, muted palette,
// deterministic seeded PRNG so re-runs reproduce identical output.

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const OUT_DIR = path.join(__dirname, '..', '..', 'assets', 'textures', 'decals');

// ── PRNG ──────────────────────────────────────────────────────────────
function mulberry32(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Drawing primitives (same shape as gen-rf-decals.cjs) ──────────────
function makePng(w, h) { return new PNG({ width: w, height: h, colorType: 6 }); }

function px(png, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const idx = (y * png.width + x) * 4;
  png.data[idx] = r & 0xff;
  png.data[idx + 1] = g & 0xff;
  png.data[idx + 2] = b & 0xff;
  png.data[idx + 3] = a;
}

function rect(png, x, y, w, h, c) {
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) px(png, x + dx, y + dy, c[0], c[1], c[2]);
}

function stroke(png, x, y, w, h, c) {
  for (let dx = 0; dx < w; dx++) { px(png, x + dx, y, c[0], c[1], c[2]); px(png, x + dx, y + h - 1, c[0], c[1], c[2]); }
  for (let dy = 0; dy < h; dy++) { px(png, x, y + dy, c[0], c[1], c[2]); px(png, x + w - 1, y + dy, c[0], c[1], c[2]); }
}

function disc(png, cx, cy, r, c) {
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++)
      if (dx * dx + dy * dy <= r * r) px(png, cx + dx, cy + dy, c[0], c[1], c[2]);
}

function screw(png, cx, cy, bodyC, slotC) {
  disc(png, cx, cy, 2, bodyC);
  px(png, cx - 1, cy, slotC[0], slotC[1], slotC[2]);
  px(png, cx, cy, slotC[0], slotC[1], slotC[2]);
  px(png, cx + 1, cy, slotC[0], slotC[1], slotC[2]);
}

// Louvered vent panel
function venting(png, x, y, w, h, darkC, lightC, slatH = 2) {
  for (let yy = 0; yy < h; yy += slatH) {
    const c = (yy / slatH) % 2 === 0 ? darkC : lightC;
    rect(png, x, y + yy, w, Math.min(slatH, h - yy), c);
  }
}

// Filled rect with light top edge + dark bottom edge for shaded depth
function shadedRect(png, x, y, w, h, baseC) {
  rect(png, x, y, w, h, baseC);
  const top = [Math.min(255, baseC[0] + 30), Math.min(255, baseC[1] + 30), Math.min(255, baseC[2] + 30)];
  const bot = [Math.max(0, baseC[0] - 35), Math.max(0, baseC[1] - 35), Math.max(0, baseC[2] - 35)];
  for (let dx = 0; dx < w; dx++) px(png, x + dx, y, top[0], top[1], top[2]);
  for (let dx = 0; dx < w; dx++) px(png, x + dx, y + h - 1, bot[0], bot[1], bot[2]);
}

// Yellow-and-black hazard placard with a small symbol slot in the middle
function warningSticker(png, x, y, w, h) {
  rect(png, x, y, w, h, [220, 190, 60]);
  stroke(png, x, y, w, h, [25, 25, 28]);
  // Inner triangle hint (just a few black pixels at the center)
  const cx = x + (w >> 1);
  const cy = y + (h >> 1);
  px(png, cx, cy - 1, 25, 25, 28);
  px(png, cx - 1, cy, 25, 25, 28); px(png, cx, cy, 25, 25, 28); px(png, cx + 1, cy, 25, 25, 28);
}

// Nameplate: small dark rectangle with a faint cream label strip
function nameplate(png, x, y, w, h) {
  rect(png, x, y, w, h, [40, 42, 48]);
  stroke(png, x, y, w, h, [80, 84, 92]);
  rect(png, x + 1, y + 1, w - 2, h - 2, [180, 175, 155]);
}

// LED column: alternating green/amber lights down a strip
function ledColumn(png, x, y, h, count) {
  const step = Math.max(2, Math.floor(h / count));
  for (let i = 0; i < count; i++) {
    const c = (i % 2 === 0) ? [80, 230, 90] : [255, 180, 50];
    rect(png, x, y + i * step, 2, 2, c);
  }
}

// Round analog gauge: dark bezel, off-white face, single tick at angle deg
function gauge(png, cx, cy, r, angleDeg) {
  disc(png, cx, cy, r, [40, 42, 48]);
  disc(png, cx, cy, r - 1, [220, 215, 200]);
  const rad = angleDeg * Math.PI / 180;
  for (let t = 1; t <= r - 2; t++) {
    px(png, Math.round(cx + Math.cos(rad) * t), Math.round(cy + Math.sin(rad) * t), 200, 30, 30);
  }
  px(png, cx, cy, 30, 30, 36);
}

function save(png, name) {
  const buf = PNG.sync.write(png);
  const out = path.join(OUT_DIR, name);
  fs.writeFileSync(out, buf);
  console.log('wrote', path.relative(path.join(__dirname, '..', '..'), out));
}

// ── Palettes ──────────────────────────────────────────────────────────
const RED_BODY      = [180, 50, 50];
const RED_HIGHLIGHT = [220, 90, 90];
const BLUE_BODY     = [55, 95, 145];
const BLUE_HIGHLIGHT= [95, 135, 185];
const GREEN_BODY    = [70, 120, 70];
const GREEN_HIGHLIGHT = [110, 160, 110];
const YELLOW_BODY   = [200, 175, 60];
const GRAY_BODY     = [130, 132, 138];
const FROST_BODY    = [200, 215, 230];
const DARK_TRIM     = [40, 42, 48];
const SCREW_BODY    = [120, 124, 132];
const SCREW_SLOT    = [40, 42, 48];

// ── RF POWER ──────────────────────────────────────────────────────────
// All RF source decals are 48×64 (taller than wide) to match the 2×4
// visual aspect of klystrons and similar tube sources.

// Pulsed klystron front: tall red body with HV warning at top, nameplate
// in middle, vent at bottom, four corner screws.
function klystronPulsedFront() {
  const w = 48, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, RED_BODY);
  // Top highlight band
  rect(png, 0, 1, w, 1, RED_HIGHLIGHT);
  // HV warning sticker top center
  warningSticker(png, 16, 4, 16, 10);
  // Nameplate middle
  nameplate(png, 8, 22, 32, 8);
  // Output coupler hint (small dark circle on the right side)
  disc(png, w - 6, 36, 3, DARK_TRIM);
  disc(png, w - 6, 36, 2, [80, 50, 30]);
  // Vent at bottom
  venting(png, 6, 48, 36, 10, DARK_TRIM, [70, 72, 78]);
  // Corner screws
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'klystron_pulsed_front.png');
}
```

- [ ] **Step 2: Add the 5 remaining RF power decal functions**

Append to `gen-infra-decals.cjs` after `klystronPulsedFront`:

```js
// CW klystron — same body but with a cyan accent strip indicating CW
// operation, and no big vent (CW runs cooler than pulsed).
function klystronCwFront() {
  const w = 48, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, RED_BODY);
  rect(png, 0, 1, w, 1, RED_HIGHLIGHT);
  // Cyan CW indicator strip across the top under the highlight
  rect(png, 4, 4, w - 8, 3, [80, 200, 220]);
  warningSticker(png, 16, 10, 16, 9);
  nameplate(png, 8, 24, 32, 8);
  // Two stacked output couplers
  disc(png, w - 6, 36, 3, DARK_TRIM); disc(png, w - 6, 36, 2, [80, 50, 30]);
  disc(png, w - 6, 46, 3, DARK_TRIM); disc(png, w - 6, 46, 2, [80, 50, 30]);
  // Cooling fins along left edge instead of vent at bottom
  for (let yy = 22; yy < 58; yy += 4) rect(png, 4, yy, 4, 2, DARK_TRIM);
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'klystron_cw_front.png');
}

// Multi-beam klystron — premium variant with gold trim and three output ports.
function klystronMultibeamFront() {
  const w = 48, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, [150, 30, 30]); // deeper red
  rect(png, 0, 1, w, 1, [200, 70, 70]);
  // Gold trim band
  rect(png, 0, 12, w, 2, [220, 180, 60]);
  rect(png, 0, h - 14, w, 2, [220, 180, 60]);
  warningSticker(png, 16, 4, 16, 7);
  nameplate(png, 6, 18, 36, 8);
  // Three output ports across the middle
  disc(png, 12, 36, 3, DARK_TRIM); disc(png, 12, 36, 2, [80, 50, 30]);
  disc(png, 24, 36, 3, DARK_TRIM); disc(png, 24, 36, 2, [80, 50, 30]);
  disc(png, 36, 36, 3, DARK_TRIM); disc(png, 36, 36, 2, [80, 50, 30]);
  venting(png, 6, 46, 36, 8, DARK_TRIM, [70, 72, 78]);
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'klystron_multibeam_front.png');
}

// Modulator — HV cabinet with two analog meters at top and a big DANGER
// placard, vent at the bottom.
function modulatorFront() {
  const w = 48, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, RED_BODY);
  rect(png, 0, 1, w, 1, RED_HIGHLIGHT);
  // Two analog meters at the top
  gauge(png, 14, 12, 5, 220);
  gauge(png, 34, 12, 5, 290);
  // DANGER placard middle
  rect(png, 6, 24, 36, 10, RED_HIGHLIGHT);
  stroke(png, 6, 24, 36, 10, DARK_TRIM);
  // Three black bars suggesting "DANGER HIGH VOLTAGE" text
  rect(png, 10, 27, 28, 1, DARK_TRIM);
  rect(png, 10, 30, 28, 1, DARK_TRIM);
  // Vent at bottom
  venting(png, 6, 40, 36, 18, DARK_TRIM, [70, 72, 78]);
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'modulator_front.png');
}

// Solid-state amplifier rack — vertical stack of amp modules with LED columns.
function ssaRackFront() {
  const w = 48, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, RED_BODY);
  rect(png, 0, 1, w, 1, RED_HIGHLIGHT);
  // 6 stacked amp modules, each a dark slot with an LED column on the right
  for (let i = 0; i < 6; i++) {
    const my = 5 + i * 9;
    rect(png, 6, my, 36, 7, DARK_TRIM);
    stroke(png, 6, my, 36, 7, [70, 72, 80]);
    // Module label strip
    rect(png, 8, my + 2, 22, 3, [180, 175, 155]);
    // LED column on the right edge of the module
    ledColumn(png, 34, my + 1, 5, 2);
  }
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'ssa_rack_front.png');
}

// IOT / TWT / magnetron tube source — generic tube cabinet with a prominent
// circular tube window in the center and a small control strip.
function iotFront() {
  const w = 48, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, RED_BODY);
  rect(png, 0, 1, w, 1, RED_HIGHLIGHT);
  warningSticker(png, 4, 4, 12, 8);
  nameplate(png, 18, 4, 26, 8);
  // Big tube window center
  disc(png, 24, 32, 12, DARK_TRIM);
  disc(png, 24, 32, 11, [60, 30, 20]);
  disc(png, 24, 32, 9, [180, 90, 40]);
  disc(png, 24, 32, 5, [240, 180, 80]);
  // Small control LEDs at bottom
  for (let i = 0; i < 4; i++) {
    const c = (i % 2 === 0) ? [80, 230, 90] : [255, 180, 50];
    rect(png, 8 + i * 8, 54, 3, 3, c);
  }
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'iot_front.png');
}
```

- [ ] **Step 3: Add the main runner at the bottom**

Append at the very end of the file:

```js
// ── Main ──────────────────────────────────────────────────────────────
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
klystronPulsedFront();
klystronCwFront();
klystronMultibeamFront();
modulatorFront();
ssaRackFront();
iotFront();
console.log('done.');
```

(Tasks 4 and 5 will append more decal calls before the `console.log('done.')` line.)

- [ ] **Step 4: Run the script**

```bash
node tools/asset-gen/gen-infra-decals.cjs
```
Expected: prints `wrote .../klystron_pulsed_front.png` and 5 more, then `done.`. No errors.

- [ ] **Step 5: Eyeball the 6 generated PNGs**

Open the new PNGs at 4× zoom. Confirm each is a 48×64 red panel with the elements described. They should be visually distinct from each other (you should be able to tell a klystron from a modulator from an SSA rack at a glance). If anything looks degenerate (clipped, off-center, wrong colors), tweak the function and re-run.

- [ ] **Step 6: Commit**

```bash
git add tools/asset-gen/gen-infra-decals.cjs \
        assets/textures/decals/klystron_pulsed_front.png \
        assets/textures/decals/klystron_cw_front.png \
        assets/textures/decals/klystron_multibeam_front.png \
        assets/textures/decals/modulator_front.png \
        assets/textures/decals/ssa_rack_front.png \
        assets/textures/decals/iot_front.png
git commit -m "feat(decals): generate 6 RF power infra hero-face decals"
```

---

## Task 4: Add cooling decals to `gen-infra-decals.cjs`

**Files:**
- Modify: `tools/asset-gen/gen-infra-decals.cjs`

Three cooling decals: cold box, helium compressor, chiller. All 64×64 (these items are roughly square in profile).

- [ ] **Step 1: Add `coldBoxFront`**

In `gen-infra-decals.cjs`, just before the `// ── Main ──` block, add:

```js
// ── COOLING ───────────────────────────────────────────────────────────

// Cold box — frost-blue panel with two temperature gauges and a piping
// schematic suggested by horizontal/vertical pipe segments.
function coldBoxFront() {
  const w = 64, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, FROST_BODY);
  // Frost rim on top edge
  for (let xx = 0; xx < w; xx += 2) px(png, xx, 0, 240, 248, 255);
  // Two gauges top
  gauge(png, 16, 14, 6, 240);
  gauge(png, 48, 14, 6, 300);
  // Gauge labels
  rect(png, 8, 23, 16, 2, DARK_TRIM);
  rect(png, 40, 23, 16, 2, DARK_TRIM);
  // Piping schematic in lower half: U-shape with valve circles
  rect(png, 10, 36, 44, 2, [60, 80, 110]);
  rect(png, 10, 36, 2, 18, [60, 80, 110]);
  rect(png, 52, 36, 2, 18, [60, 80, 110]);
  rect(png, 10, 52, 44, 2, [60, 80, 110]);
  disc(png, 22, 37, 2, [180, 50, 50]);
  disc(png, 42, 37, 2, [180, 50, 50]);
  // Corner screws
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'cold_box_front.png');
}
```

- [ ] **Step 2: Add `heCompressorFront`**

```js
// Helium compressor — large blue body with a control HMI screen, ventilation
// grille, warning placard.
function heCompressorFront() {
  const w = 64, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, BLUE_BODY);
  rect(png, 0, 1, w, 1, BLUE_HIGHLIGHT);
  // HMI screen top
  rect(png, 8, 6, 32, 16, DARK_TRIM);
  rect(png, 9, 7, 30, 14, [40, 58, 32]);
  // Two horizontal "data lines" inside the screen
  rect(png, 11, 11, 20, 1, [180, 240, 140]);
  rect(png, 11, 15, 26, 1, [180, 240, 140]);
  rect(png, 11, 18, 16, 1, [255, 180, 50]);
  // Warning placard top right
  warningSticker(png, 44, 6, 14, 10);
  // Ventilation grille bottom
  venting(png, 6, 28, 52, 28, DARK_TRIM, [60, 80, 110]);
  // Corner screws
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'he_compressor_front.png');
}
```

- [ ] **Step 3: Add `chillerFront`**

```js
// Chiller / LCW skid — blue control panel with LCD readout, two pressure
// gauges, two pipe stubs at the bottom.
function chillerFront() {
  const w = 64, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, BLUE_BODY);
  rect(png, 0, 1, w, 1, BLUE_HIGHLIGHT);
  // LCD temp readout top center
  rect(png, 14, 6, 36, 12, DARK_TRIM);
  rect(png, 15, 7, 34, 10, [40, 58, 32]);
  // Three "digit" segments inside LCD
  rect(png, 19, 9, 7, 6, [180, 240, 140]);
  rect(png, 28, 9, 7, 6, [180, 240, 140]);
  rect(png, 37, 9, 7, 6, [180, 240, 140]);
  // Two pressure gauges below LCD
  gauge(png, 18, 32, 6, 200);
  gauge(png, 46, 32, 6, 250);
  // Pipe stubs at bottom (cooling water in/out)
  disc(png, 18, 56, 4, [120, 124, 130]);
  disc(png, 18, 56, 3, DARK_TRIM);
  disc(png, 46, 56, 4, [120, 124, 130]);
  disc(png, 46, 56, 3, DARK_TRIM);
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'chiller_front.png');
}
```

- [ ] **Step 4: Add the 3 calls to the main runner**

In `gen-infra-decals.cjs`, locate the `// ── Main ──` block. Add three lines just before `console.log('done.');`:

```js
coldBoxFront();
heCompressorFront();
chillerFront();
```

- [ ] **Step 5: Run the script**

```bash
node tools/asset-gen/gen-infra-decals.cjs
```
Expected: prints all 9 `wrote ...` lines (6 RF + 3 cooling), then `done.`.

- [ ] **Step 6: Eyeball the 3 new PNGs**

Confirm cold box has gauges + piping, helium compressor has HMI screen + vent, chiller has LCD readout + gauges + pipe stubs. All three should read as blue/cooling at a glance.

- [ ] **Step 7: Commit**

```bash
git add tools/asset-gen/gen-infra-decals.cjs \
        assets/textures/decals/cold_box_front.png \
        assets/textures/decals/he_compressor_front.png \
        assets/textures/decals/chiller_front.png
git commit -m "feat(decals): generate 3 cooling infra hero-face decals"
```

---

## Task 5: Add vacuum, controls, safety, and power decals

**Files:**
- Modify: `tools/asset-gen/gen-infra-decals.cjs`

Five remaining decals: bakeout (vacuum), rack IOC (controls), PPS panel, MPS panel, power panel.

- [ ] **Step 1: Add `bakeoutFront`**

In `gen-infra-decals.cjs`, just before the `// ── Main ──` block, add:

```js
// ── VACUUM ────────────────────────────────────────────────────────────

// Bakeout controller — gray panel with three temperature dials and a
// power switch, plus heater cable connection ports.
function bakeoutFront() {
  const w = 64, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, GRAY_BODY);
  // Three temperature dials in a row
  gauge(png, 14, 14, 6, 200);
  gauge(png, 32, 14, 6, 260);
  gauge(png, 50, 14, 6, 320);
  // Dial labels
  rect(png, 8, 23, 12, 2, DARK_TRIM);
  rect(png, 26, 23, 12, 2, DARK_TRIM);
  rect(png, 44, 23, 12, 2, DARK_TRIM);
  // Power switch (red) middle
  rect(png, 28, 32, 8, 6, [180, 50, 50]);
  stroke(png, 28, 32, 8, 6, DARK_TRIM);
  // Heater cable connectors (4 sockets at bottom)
  for (let i = 0; i < 4; i++) {
    disc(png, 10 + i * 14, 52, 4, [120, 124, 130]);
    disc(png, 10 + i * 14, 52, 3, DARK_TRIM);
    disc(png, 10 + i * 14, 52, 1, [220, 215, 200]);
  }
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'bakeout_front.png');
}
```

- [ ] **Step 2: Add `rackIocFront`**

```js
// ── CONTROLS ──────────────────────────────────────────────────────────

// 19" rack of blade servers — six dark 1U slots stacked, each with green
// and amber LEDs and a vent slit.
function rackIocFront() {
  const w = 48, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, [60, 64, 72]);
  // Top and bottom rack rails
  rect(png, 0, 0, w, 3, [90, 94, 102]);
  rect(png, 0, h - 3, w, 3, [90, 94, 102]);
  // 6 blade slots
  for (let i = 0; i < 6; i++) {
    const sy = 5 + i * 9;
    rect(png, 4, sy, w - 8, 7, [30, 32, 38]);
    stroke(png, 4, sy, w - 8, 7, [70, 72, 80]);
    // Vent slit
    rect(png, 6, sy + 3, 16, 1, [10, 12, 16]);
    // LED pair right side
    rect(png, w - 10, sy + 2, 2, 2, [80, 230, 90]);
    rect(png, w - 6, sy + 2, 2, 2, [255, 180, 50]);
  }
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'rack_ioc_front.png');
}
```

- [ ] **Step 3: Add `ppsPanel`**

```js
// PPS — cream face with two red key switches and a big orange search button.
function ppsPanel() {
  const w = 48, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, [220, 215, 200]);
  // Two key switches near the top
  for (let i = 0; i < 2; i++) {
    const cx = 14 + i * 20;
    disc(png, cx, 14, 5, DARK_TRIM);
    disc(png, cx, 14, 4, [180, 50, 50]);
    rect(png, cx - 1, 11, 2, 4, [40, 42, 48]);
  }
  // Orange search button center
  disc(png, 24, 34, 8, DARK_TRIM);
  disc(png, 24, 34, 7, [240, 140, 30]);
  disc(png, 24, 34, 5, [255, 180, 60]);
  // Status indicator strip at the bottom (red/amber/green)
  rect(png, 6, 50, 12, 4, [240, 70, 70]);
  rect(png, 18, 50, 12, 4, [255, 180, 50]);
  rect(png, 30, 50, 12, 4, [80, 230, 90]);
  stroke(png, 6, 50, 36, 4, DARK_TRIM);
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'pps_panel.png');
}
```

- [ ] **Step 4: Add `mpsPanel`**

```js
// MPS — gray panel with a big red abort button and a column of green LEDs
// along the right edge.
function mpsPanel() {
  const w = 48, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, GRAY_BODY);
  // Big red abort button center-left
  disc(png, 18, 24, 10, DARK_TRIM);
  disc(png, 18, 24, 9, [180, 30, 30]);
  disc(png, 18, 24, 7, [240, 70, 70]);
  // Label strip below button
  rect(png, 6, 38, 24, 3, DARK_TRIM);
  // Column of green LEDs along the right edge
  for (let i = 0; i < 8; i++) {
    rect(png, 38, 8 + i * 6, 4, 4, [80, 230, 90]);
    stroke(png, 38, 8 + i * 6, 4, 4, DARK_TRIM);
  }
  // Bottom controls strip
  rect(png, 4, 50, 40, 8, [60, 64, 72]);
  for (let i = 0; i < 4; i++) rect(png, 6 + i * 10, 52, 6, 4, [110, 116, 126]);
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'mps_panel.png');
}
```

- [ ] **Step 5: Add `powerPanelFront`**

```js
// ── POWER ─────────────────────────────────────────────────────────────

// Power distribution / substation — green door with a column of breakers
// and a yellow electrical hazard placard.
function powerPanelFront() {
  const w = 48, h = 64;
  const png = makePng(w, h);
  shadedRect(png, 0, 0, w, h, GREEN_BODY);
  rect(png, 0, 1, w, 1, GREEN_HIGHLIGHT);
  // Hazard placard top
  warningSticker(png, 8, 4, 32, 10);
  // Three rows × four columns of breakers
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      const bx = 6 + col * 9;
      const by = 18 + row * 10;
      rect(png, bx, by, 7, 7, [40, 42, 48]);
      stroke(png, bx, by, 7, 7, [80, 84, 92]);
      // Toggle (alternating up/down)
      const up = ((row + col) % 2 === 0);
      rect(png, bx + 2, by + (up ? 1 : 4), 3, 2, up ? [80, 230, 90] : [240, 70, 70]);
    }
  }
  // Door handle right edge
  rect(png, w - 6, 30, 2, 8, [120, 124, 130]);
  screw(png, 3, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, 3, SCREW_BODY, SCREW_SLOT);
  screw(png, 3, h - 4, SCREW_BODY, SCREW_SLOT);
  screw(png, w - 4, h - 4, SCREW_BODY, SCREW_SLOT);
  save(png, 'power_panel_front.png');
}
```

- [ ] **Step 6: Add the 5 calls to the main runner**

In the `// ── Main ──` block, add five lines just before `console.log('done.');`:

```js
bakeoutFront();
rackIocFront();
ppsPanel();
mpsPanel();
powerPanelFront();
```

- [ ] **Step 7: Run the script**

```bash
node tools/asset-gen/gen-infra-decals.cjs
```
Expected: prints all 14 `wrote ...` lines (6 RF + 3 cooling + 1 vacuum + 1 controls + 2 safety + 1 power), then `done.`.

- [ ] **Step 8: Eyeball the 5 new PNGs**

Confirm bakeout has 3 dials + power switch + connectors, rack has 6 blade slots with LEDs, PPS has key switches + orange button, MPS has big red abort + LED column, power panel has breaker grid + hazard placard.

- [ ] **Step 9: Commit**

```bash
git add tools/asset-gen/gen-infra-decals.cjs \
        assets/textures/decals/bakeout_front.png \
        assets/textures/decals/rack_ioc_front.png \
        assets/textures/decals/pps_panel.png \
        assets/textures/decals/mps_panel.png \
        assets/textures/decals/power_panel_front.png
git commit -m "feat(decals): generate 5 vacuum/controls/safety/power decals"
```

---

## Task 6: Register new decals in `decals.js`

**Files:**
- Modify: `src/renderer3d/materials/decals.js`

- [ ] **Step 1: Replace the `DECALS` export with the expanded list**

Edit `src/renderer3d/materials/decals.js`. Replace the current `export const DECALS = { ... };` block with:

```js
export const DECALS = {
  scope_screen: makeDecal('scope_screen.png', { roughness: 0.35, metalness: 0.1 }),

  // RF power
  klystron_pulsed_front:    makeDecal('klystron_pulsed_front.png',    { roughness: 0.6, metalness: 0.25 }),
  klystron_cw_front:        makeDecal('klystron_cw_front.png',        { roughness: 0.6, metalness: 0.25 }),
  klystron_multibeam_front: makeDecal('klystron_multibeam_front.png', { roughness: 0.6, metalness: 0.25 }),
  modulator_front:          makeDecal('modulator_front.png',          { roughness: 0.6, metalness: 0.2 }),
  ssa_rack_front:           makeDecal('ssa_rack_front.png',           { roughness: 0.6, metalness: 0.2 }),
  iot_front:                makeDecal('iot_front.png',                { roughness: 0.6, metalness: 0.25 }),

  // Cooling
  cold_box_front:           makeDecal('cold_box_front.png',           { roughness: 0.6, metalness: 0.2 }),
  he_compressor_front:      makeDecal('he_compressor_front.png',      { roughness: 0.6, metalness: 0.2 }),
  chiller_front:            makeDecal('chiller_front.png',            { roughness: 0.6, metalness: 0.2 }),

  // Vacuum
  bakeout_front:            makeDecal('bakeout_front.png',            { roughness: 0.65, metalness: 0.2 }),

  // Controls / safety / power
  rack_ioc_front:           makeDecal('rack_ioc_front.png',           { roughness: 0.55, metalness: 0.3 }),
  pps_panel:                makeDecal('pps_panel.png',                { roughness: 0.6, metalness: 0.15 }),
  mps_panel:                makeDecal('mps_panel.png',                { roughness: 0.6, metalness: 0.15 }),
  power_panel_front:        makeDecal('power_panel_front.png',        { roughness: 0.6, metalness: 0.2 }),
};
```

- [ ] **Step 2: Smoke-test in dev server**

Reload the game in the browser. Open devtools. Verify no 404s for the new PNGs and no Three.js load errors. No visual change yet — decals are registered but no infra item references them.

- [ ] **Step 3: Commit**

```bash
git add src/renderer3d/materials/decals.js
git commit -m "feat(decals): register 14 infra hero-face decals"
```

---

## Task 7: Extend `_createFallbackMesh` to support `baseMaterial` + `faces`

**Files:**
- Modify: `src/renderer3d/component-builder.js`

This is the critical rendering change. It mirrors `equipment-builder._faceMaterial` and `_setFaceUVsClamped` but lives inside `component-builder.js` (no cross-builder import — those are private helpers).

- [ ] **Step 1: Add `DECALS` import**

Locate the existing `import { MATERIALS } from './materials/index.js';` line near the top of the file. Immediately after it, add:

```js
import { DECALS } from './materials/decals.js';
```

- [ ] **Step 2: Add module-level cache and helper functions**

Find an appropriate spot near the other module-level caches in the file (search for `_matCache` to find a good neighbor — likely near the top, after the imports and shared materials block). Add:

```js
// ── Infra fallback material cache ──────────────────────────────────
// Keyed by compType|faceKey|baseName|overrideJSON so identical face
// configs across instances share one MeshStandardMaterial. Mirrors
// equipment-builder's _equipMatCache.
const _infraFaceMatCache = new Map();
const _INFRA_FACE_KEYS = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];
const _INFRA_FACE_INDEX = { '+X': 0, '-X': 1, '+Y': 2, '-Y': 3, '+Z': 4, '-Z': 5 };

function _infraFaceMaterial(compType, faceKey, baseName, faceOverride, fallbackColor) {
  const cacheKey = `${compType}|${faceKey}|${baseName || ''}|${faceOverride ? JSON.stringify(faceOverride) : ''}`;
  let m = _infraFaceMatCache.get(cacheKey);
  if (m) return m;

  // Decal override: reuse the shared DECALS material. The caller is
  // responsible for rewriting this face's UVs to 0→1.
  if (faceOverride && faceOverride.decal && DECALS[faceOverride.decal]) {
    m = DECALS[faceOverride.decal];
    _infraFaceMatCache.set(cacheKey, m);
    return m;
  }

  // Per-face tiled override or inherited base material
  const perFaceBase = faceOverride && faceOverride.base;
  const resolvedBase = perFaceBase || baseName;

  let map = null;
  let color = fallbackColor;
  if (resolvedBase && MATERIALS[resolvedBase]) {
    map = MATERIALS[resolvedBase].map;
    color = 0xffffff;
  }
  m = new THREE.MeshStandardMaterial({
    map,
    color,
    roughness: 0.7,
    metalness: 0.2,
  });
  _infraFaceMatCache.set(cacheKey, m);
  return m;
}

// Rewrite a single face's UVs to span 0→1 so the full decal texture
// shows instead of being cropped by the tiled UV span from applyTiledBoxUVs.
function _setInfraFaceUVsClamped(geometry, faceKey) {
  const uv = geometry.attributes.uv;
  if (!uv) return;
  const face = _INFRA_FACE_INDEX[faceKey];
  if (face == null) return;
  const arr = uv.array;
  const off = face * 8;
  arr[off + 0] = 0; arr[off + 1] = 1;
  arr[off + 2] = 1; arr[off + 3] = 1;
  arr[off + 4] = 0; arr[off + 5] = 0;
  arr[off + 6] = 1; arr[off + 7] = 0;
  uv.needsUpdate = true;
}
```

- [ ] **Step 3: Replace the box/cylinder material construction in `_createFallbackMesh`**

Find the block in `_createFallbackMesh` that begins with the comment `// Visual dims override footprint dims when authored` (~line 1897). The current block builds `geometry`, then constructs a single `MeshStandardMaterial` and a `Mesh`. Replace that whole block (from `// Visual dims...` down to and including the `return mesh;`) with:

```js
    // Visual dims override footprint dims when authored — lets a benchtop
    // instrument occupy a full subtile slot but render at realistic scale.
    const vSubW = compDef.visualSubW ?? compDef.subW ?? 2;
    const vSubH = compDef.visualSubH ?? compDef.subH ?? 2;
    const vSubL = compDef.visualSubL ?? compDef.subL ?? 2;
    const w = vSubW * SUB_UNIT;
    const h = vSubH * SUB_UNIT;
    const l = vSubL * SUB_UNIT;

    const fallbackColor = compDef.spriteColor !== undefined ? compDef.spriteColor : 0x888888;
    const baseName = compDef.baseMaterial || null;
    const faces = compDef.faces || null;
    const hasBaseOrFaces = !!(baseName || faces);

    let geometry;
    let material;

    if (compDef.geometryType === 'cylinder') {
      const radius = Math.min(w, h) / 2;
      geometry = new THREE.CylinderGeometry(radius, radius, l, 8);
      applyTiledCylinderUVs(geometry, radius, l, 8);
      geometry.rotateZ(Math.PI / 2);

      if (baseName && MATERIALS[baseName]) {
        // Cylinders: side + caps share one tiled material. Per-face
        // decals are not supported for cylinders in this pass.
        const cacheKey = `${compDef.id}|cyl|${baseName}`;
        let m = _infraFaceMatCache.get(cacheKey);
        if (!m) {
          m = new THREE.MeshStandardMaterial({
            map: MATERIALS[baseName].map,
            color: 0xffffff,
            roughness: 0.7,
            metalness: 0.2,
          });
          _infraFaceMatCache.set(cacheKey, m);
        }
        material = m;
      } else {
        material = new THREE.MeshStandardMaterial({
          color: fallbackColor,
          roughness: 0.7,
          metalness: 0.1,
        });
      }
    } else {
      geometry = new THREE.BoxGeometry(w, h, l);
      applyTiledBoxUVs(geometry, w, h, l);

      if (hasBaseOrFaces) {
        // Clamp UVs for any face that has a decal override.
        if (faces) {
          for (const key of _INFRA_FACE_KEYS) {
            if (faces[key] && faces[key].decal) {
              _setInfraFaceUVsClamped(geometry, key);
            }
          }
        }
        // 6-entry material array, one per face.
        material = _INFRA_FACE_KEYS.map(key =>
          _infraFaceMaterial(
            compDef.id,
            key,
            baseName,
            faces ? faces[key] : null,
            fallbackColor,
          )
        );
      } else {
        // Legacy flat-color path — preserved for un-authored infra and
        // any beamline components that fall through to this branch.
        material = new THREE.MeshStandardMaterial({
          color: fallbackColor,
          roughness: 0.7,
          metalness: 0.1,
        });
      }
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
```

- [ ] **Step 4: Smoke-test regression (no authored infra yet)**

Reload the game in the browser. Enter Infra build mode. Place any infra item (e.g. a roughing pump or a chiller — neither has `baseMaterial` set yet). Confirm it renders exactly as before (flat color, no visual change). Also place a beamline drift pipe or magnet and confirm it also looks unchanged. Check the devtools console for errors.

Expected: zero visual regression because no infra raw entry has `baseMaterial` or `faces` yet, so every call takes the legacy flat-color branch.

- [ ] **Step 5: Commit**

```bash
git add src/renderer3d/component-builder.js
git commit -m "feat(component-builder): add baseMaterial/faces support to fallback mesh"
```

---

## Task 8: Author RF power infra

**Files:**
- Modify: `src/data/infrastructure.raw.js`

Add `baseMaterial: 'metal_painted_red'` and a `faces` field to each entry below. Place new fields just after `geometryType: 'box'`. Keep all existing fields intact. `+X` is the local front face.

- [ ] **Step 1: Author `pulsedKlystron`**

Locate the `pulsedKlystron:` entry. Add:
```js
    baseMaterial: 'metal_painted_red',
    faces: { '+X': { decal: 'klystron_pulsed_front' } },
```

- [ ] **Step 2: Author `cwKlystron`**
```js
    baseMaterial: 'metal_painted_red',
    faces: { '+X': { decal: 'klystron_cw_front' } },
```

- [ ] **Step 3: Author `multibeamKlystron`**
```js
    baseMaterial: 'metal_painted_red',
    faces: { '+X': { decal: 'klystron_multibeam_front' } },
```

- [ ] **Step 4: Author `modulator`**
```js
    baseMaterial: 'metal_painted_red',
    faces: { '+X': { decal: 'modulator_front' } },
```

- [ ] **Step 5: Author `solidStateAmp`**
```js
    baseMaterial: 'metal_painted_red',
    faces: { '+X': { decal: 'ssa_rack_front' } },
```

- [ ] **Step 6: Author `highPowerSSA`**
```js
    baseMaterial: 'metal_painted_red',
    faces: { '+X': { decal: 'ssa_rack_front' } },
```

- [ ] **Step 7: Author `iot`**
```js
    baseMaterial: 'metal_painted_red',
    faces: { '+X': { decal: 'iot_front' } },
```

- [ ] **Step 8: Author `twt`**
```js
    baseMaterial: 'metal_painted_red',
    faces: { '+X': { decal: 'iot_front' } },
```

- [ ] **Step 9: Author `magnetron`**
```js
    baseMaterial: 'metal_painted_red',
    faces: { '+X': { decal: 'iot_front' } },
```

- [ ] **Step 10: Visual check**

Reload the game in the browser. Enter Infra build mode → RF Power. Place one of each: pulsed klystron, CW klystron, multibeam klystron, modulator, SSA, IOT, TWT, magnetron. Confirm each shows red paint on 5 faces and its decal on one face. Rotate each through all 4 directions and confirm the decal stays on the same local face relative to the object body.

- [ ] **Step 11: Commit**

```bash
git add src/data/infrastructure.raw.js
git commit -m "feat(infra): paint RF power red and assign front-face decals"
```

---

## Task 9: Author cooling infra

**Files:**
- Modify: `src/data/infrastructure.raw.js`

Cryogenic vessels use `cryo_frost`; chilled-water plant uses `metal_painted_blue`.

- [ ] **Step 1: Author `ln2Dewar` (cylinder)**
```js
    baseMaterial: 'cryo_frost',
```
(No `faces` — cylinder.)

- [ ] **Step 2: Author `cryocooler`**
```js
    baseMaterial: 'cryo_frost',
```

- [ ] **Step 3: Author `ln2Precooler`**
```js
    baseMaterial: 'cryo_frost',
```

- [ ] **Step 4: Author `heCompressor`**
```js
    baseMaterial: 'metal_painted_blue',
    faces: { '+X': { decal: 'he_compressor_front' } },
```

- [ ] **Step 5: Author `coldBox4K`**
```js
    baseMaterial: 'cryo_frost',
    faces: { '+X': { decal: 'cold_box_front' } },
```

- [ ] **Step 6: Author `coldBox2K`**
```js
    baseMaterial: 'cryo_frost',
    faces: { '+X': { decal: 'cold_box_front' } },
```

- [ ] **Step 7: Author `cryomoduleHousing`**
```js
    baseMaterial: 'cryo_frost',
```

- [ ] **Step 8: Author `heRecovery` (cylinder)**
```js
    baseMaterial: 'cryo_frost',
```

- [ ] **Step 9: Author `waterLoad`**
```js
    baseMaterial: 'metal_painted_blue',
```

- [ ] **Step 10: Author `lcwSkid`**
```js
    baseMaterial: 'metal_painted_blue',
    faces: { '+X': { decal: 'chiller_front' } },
```

- [ ] **Step 11: Author `chiller`**
```js
    baseMaterial: 'metal_painted_blue',
    faces: {
      '+X': { decal: 'chiller_front' },
      '+Y': { base: 'metal_corrugated' },
    },
```

- [ ] **Step 12: Author `coolingTower` (cylinder)**
```js
    baseMaterial: 'metal_corrugated',
```

- [ ] **Step 13: Author `deionizer`**
```js
    baseMaterial: 'metal_painted_blue',
```

- [ ] **Step 14: Author `emergencyCooling`**
```js
    baseMaterial: 'metal_painted_blue',
```

- [ ] **Step 15: Visual check**

Reload. In Infra → Cooling, place one of each authored item. Confirm:
- `ln2Dewar` cylinder is wrapped in frost texture, not stretched.
- `coldBox4K`, `coldBox2K`, `chiller`, `lcwSkid`, `heCompressor` show their decals on the front face.
- `chiller` top face uses `metal_corrugated` (distinct from blue paint on the other faces).
- `coolingTower` is a corrugated cylinder.
- Rotate each 4-way and confirm decals stick to local front.

- [ ] **Step 16: Commit**

```bash
git add src/data/infrastructure.raw.js
git commit -m "feat(infra): paint cooling items blue/frost and assign decals"
```

---

## Task 10: Author vacuum infra

**Files:**
- Modify: `src/data/infrastructure.raw.js`

- [ ] **Step 1: Author `roughingPump`**
```js
    baseMaterial: 'metal_painted_gray',
```

- [ ] **Step 2: Author `turboPump`**
```js
    baseMaterial: 'metal_brushed',
```

- [ ] **Step 3: Author `ionPump`**
```js
    baseMaterial: 'metal_painted_gray',
```

- [ ] **Step 4: Author `negPump`**
```js
    baseMaterial: 'metal_brushed',
```

- [ ] **Step 5: Author `tiSubPump`**
```js
    baseMaterial: 'metal_brushed',
```

- [ ] **Step 6: Author `piraniGauge`**
```js
    baseMaterial: 'metal_painted_gray',
```

- [ ] **Step 7: Author `coldCathodeGauge`**
```js
    baseMaterial: 'metal_painted_gray',
```

- [ ] **Step 8: Author `baGauge`**
```js
    baseMaterial: 'metal_painted_gray',
```

- [ ] **Step 9: Author `gateValve`**
```js
    baseMaterial: 'metal_painted_gray',
```

- [ ] **Step 10: Author `bakeoutSystem` (box, gets decal)**
```js
    baseMaterial: 'metal_painted_gray',
    faces: { '+X': { decal: 'bakeout_front' } },
```

- [ ] **Step 11: Visual check**

Reload. In Infra → Vacuum, place a gate valve, roughing pump, bakeout system, and each of the three gauges. Confirm gray paint reads on all of them; bakeout system has its decal on the front; cylinders (turbo pump, pirani gauge, etc.) wrap correctly without stretching.

- [ ] **Step 12: Commit**

```bash
git add src/data/infrastructure.raw.js
git commit -m "feat(infra): paint vacuum items gray/brushed and add bakeout decal"
```

---

## Task 11: Author controls, safety, ops, and power infra

**Files:**
- Modify: `src/data/infrastructure.raw.js`

- [ ] **Step 1: Author `rackIoc`**
```js
    baseMaterial: 'rack_vent_mesh',
    faces: { '+X': { decal: 'rack_ioc_front' } },
```

- [ ] **Step 2: Author `timingSystem`**
```js
    baseMaterial: 'rack_vent_mesh',
    faces: { '+X': { decal: 'rack_ioc_front' } },
```

- [ ] **Step 3: Author `llrfController`**
```js
    baseMaterial: 'rack_vent_mesh',
    faces: { '+X': { decal: 'rack_ioc_front' } },
```

- [ ] **Step 4: Author `ppsInterlock`**
```js
    baseMaterial: 'metal_painted_white',
    faces: { '+X': { decal: 'pps_panel' } },
```

- [ ] **Step 5: Author `mps`**
```js
    baseMaterial: 'metal_painted_white',
    faces: { '+X': { decal: 'mps_panel' } },
```

- [ ] **Step 6: Author `areaMonitor` (cylinder)**
```js
    baseMaterial: 'metal_painted_yellow',
```

- [ ] **Step 7: Author `shielding`**
```js
    baseMaterial: 'concrete_wall',
```

- [ ] **Step 8: Author `targetHandling`**
```js
    baseMaterial: 'metal_painted_yellow',
```

- [ ] **Step 9: Author `beamDump`**
```js
    baseMaterial: 'metal_painted_yellow',
    faces: {
      '+X': { base: 'hazard_stripe' },
      '-X': { base: 'hazard_stripe' },
    },
```

- [ ] **Step 10: Author `radWasteStorage`**
```js
    baseMaterial: 'concrete_wall',
    faces: {
      '+X': { base: 'hazard_stripe' },
    },
```

- [ ] **Step 11: Author `laserSystem`**
```js
    baseMaterial: 'metal_painted_green',
```

- [ ] **Step 12: Author `powerPanel`**
```js
    baseMaterial: 'metal_painted_green',
    faces: { '+X': { decal: 'power_panel_front' } },
```

- [ ] **Step 13: Author `substation`**
```js
    baseMaterial: 'metal_painted_green',
    faces: { '+X': { decal: 'power_panel_front' } },
```

- [ ] **Step 14: Author `rfCoupler`**
```js
    baseMaterial: 'copper',
```

- [ ] **Step 15: Author `circulator`**
```js
    baseMaterial: 'metal_brushed',
```

- [ ] **Step 16: Visual check**

Reload. In Infra, place one of each: rack IOC, PPS interlock, MPS, area monitor, shielding wall, beam dump, rad waste storage, substation, power panel. Confirm:
- Racks use vent-mesh sides with the rack IOC decal front.
- PPS/MPS panels show their decal on the front.
- Shielding + rad waste show concrete; rad waste door (`+X`) shows the hazard stripe.
- Beam dump ends (`+X`, `-X`) show hazard stripes; other faces are yellow.
- Substation and power panel show green paint + breaker-panel decal on front.
- Rotate each 4-way; decals and per-face overrides stay on the local faces.

- [ ] **Step 17: Commit**

```bash
git add src/data/infrastructure.raw.js
git commit -m "feat(infra): paint controls/safety/power and assign remaining decals"
```

---

## Task 12: Final verification pass

**Files:** none (manual browser verification)

- [ ] **Step 1: Full-category walkthrough**

Start a fresh game or load a save. Enter Infra build mode and walk through every category tab: Power, Vacuum, RF Power, Cooling, Data/Controls, Ops. Place at least one item per subsection. Confirm no items are still flat gray/default-colored unexpectedly (any item that *should* have paint but doesn't is a missed entry).

- [ ] **Step 2: Rotation stress test**

Pick 3 items that carry decals (one from each of RF power, cooling, controls), rotate each through all 4 directions using the rotation hotkey. Confirm decals rotate with the object — they should stay on the same local face of the body, not jump to different sides in world space.

- [ ] **Step 3: Ghost / preview regression**

Hover a placement ghost for a decal-bearing item. Confirm the ghost preview still renders (it goes through `_createFallbackMesh` via the ghost path). It may be wireframe-tinted — that's expected. Confirm no console errors.

- [ ] **Step 4: Beamline component regression**

Enter Beamline build mode. Place a drift pipe, a magnet, and an RF cavity. Confirm each renders identically to before this plan (they should not go through the new code path since they use role builders or detail builders, not `_createFallbackMesh`'s fallback branch). Confirm no console errors.

- [ ] **Step 5: Dimming / selection regression**

Select a decal-bearing infra item (e.g. a klystron). Confirm the dimming/tint behavior still works without mutating the shared decal material (other klystrons should not be affected). If dimming mutates the shared material in place, you'll see decals on every klystron flicker — if that happens, note it in the PR description rather than fixing in this pass, since selection handling is out of scope.

- [ ] **Step 6: Done**

No commit needed if no issues found. If anything regressed, fix in a follow-up commit before merging.

---

## Self-review notes

- **Spec coverage:** Sections 1–7 of the spec all addressed. Section 1 (rendering extension) → Task 7. Section 2 (palette) → Tasks 1–2. Section 3 (decals) → Tasks 3–6. Section 4 (data model) → Tasks 8–11. Section 5 (implementation order) → task ordering matches. Section 6 (testing) → Task 12. Section 7 (out of scope) → preserved; no simulation/params changes.
- **Cylinders:** spec says cylinders get `baseMaterial` only; Task 7 Step 3 cylinder branch implements this exactly.
- **Legacy fallback preserved:** Task 7 Step 3 keeps a non-authored flat-color path; Task 7 Step 4 verifies beamline components still render unchanged.
- **Face-key convention:** `+X` front everywhere, matching `equipment-builder` and the spec's "+X is local front."
- **Asset totals:** 8 materials (Task 1) + 14 decals (Task 3: 6 RF, Task 4: 3 cooling, Task 5: 5 vacuum/controls/safety/power → 14). Matches spec.
- **Asset pipeline:** Pure procedural via Node + pngjs, matching the existing `gen-materials.cjs` and `gen-rf-decals.cjs` workflow. No external services. Re-runs are deterministic (seeded PRNG).
