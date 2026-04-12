# Infrastructure Textures & Decals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give infrastructure items per-category paint and hero-face decals by extending `component-builder.js`'s fallback path to honor `baseMaterial`/`faces` fields, generating 8 new tiled materials and 11 new decals, and authoring these fields onto ~28 infra raw entries.

**Architecture:** Single-path extension — `_createFallbackMesh` in `component-builder.js` gains box-branch multi-material support (6-entry array, per-face UV clamping for decals) and cylinder-branch base-material support. Infra raw entries opt in via optional `baseMaterial`/`faces` fields matching the `equipment-builder` convention. Flat-color fallback preserved for un-authored items.

**Tech Stack:** Three.js (CDN global, do NOT import), PixelLab MCP (`mcp__pixellab__create_tiles_pro`) for asset generation, plain JS modules.

**No automated tests.** Per spec, this is a purely visual change. Verification is manual in-browser. Tasks end with `git commit` and, where appropriate, explicit browser-check steps.

---

## File Structure

**Modified:**
- `src/renderer3d/materials/tiled.js` — register 8 new MATERIALS entries
- `src/renderer3d/materials/decals.js` — register 11 new DECALS entries
- `src/renderer3d/component-builder.js` — extend `_createFallbackMesh` (~line 1865) with box-branch `faces`/`baseMaterial` support and cylinder-branch `baseMaterial` support; add `_infraFaceMatCache` module-level cache
- `src/data/infrastructure.raw.js` — author `baseMaterial`/`faces` on ~28 entries (RF power, cooling, vacuum, controls/safety/ops, power)

**Created:**
- `assets/textures/materials/metal_painted_blue.png`
- `assets/textures/materials/metal_painted_red.png`
- `assets/textures/materials/metal_painted_green.png`
- `assets/textures/materials/metal_painted_yellow.png`
- `assets/textures/materials/metal_painted_gray.png`
- `assets/textures/materials/metal_corrugated.png`
- `assets/textures/materials/cryo_frost.png`
- `assets/textures/materials/hazard_stripe.png`
- `assets/textures/decals/klystron_pulsed_front.png`
- `assets/textures/decals/klystron_cw_front.png`
- `assets/textures/decals/klystron_multibeam_front.png`
- `assets/textures/decals/modulator_front.png`
- `assets/textures/decals/ssa_rack_front.png`
- `assets/textures/decals/iot_front.png`
- `assets/textures/decals/cold_box_front.png`
- `assets/textures/decals/he_compressor_front.png`
- `assets/textures/decals/chiller_front.png`
- `assets/textures/decals/bakeout_front.png`
- `assets/textures/decals/rack_ioc_front.png`
- `assets/textures/decals/pps_panel.png`
- `assets/textures/decals/mps_panel.png`
- `assets/textures/decals/power_panel_front.png`

---

## Task 1: Generate tiled material PNGs

**Files:**
- Create: 8 PNGs under `assets/textures/materials/`

Use `mcp__pixellab__create_tiles_pro` with `tileable: true`, `size: 64`, pixel-art style matching existing `metal_painted_white.png`. Each call is non-blocking; wait for job completion before the next call or run a batch and poll.

- [ ] **Step 1: Generate `metal_painted_blue.png`**

Prompt: `"seamless tileable 64x64 pixel-art texture of industrial chiller-blue painted sheet metal, subtle rivets and faint panel seams, matte finish, no text, no logos"`. Save to `assets/textures/materials/metal_painted_blue.png`.

- [ ] **Step 2: Generate `metal_painted_red.png`**

Prompt: `"seamless tileable 64x64 pixel-art texture of safety-red painted sheet metal, subtle rivets and faint panel seams, industrial matte finish, no text, no logos"`. Save to `assets/textures/materials/metal_painted_red.png`.

- [ ] **Step 3: Generate `metal_painted_green.png`**

Prompt: `"seamless tileable 64x64 pixel-art texture of electrical-equipment green painted sheet metal, subtle rivets and panel seams, matte finish, no text, no logos"`. Save to `assets/textures/materials/metal_painted_green.png`.

- [ ] **Step 4: Generate `metal_painted_yellow.png`**

Prompt: `"seamless tileable 64x64 pixel-art texture of hazard-yellow painted steel, subtle rivets and panel seams, industrial matte finish, no text, no logos"`. Save to `assets/textures/materials/metal_painted_yellow.png`.

- [ ] **Step 5: Generate `metal_painted_gray.png`**

Prompt: `"seamless tileable 64x64 pixel-art texture of gray painted machine housing metal, subtle rivets and panel seams, matte finish, no text, no logos"`. Save to `assets/textures/materials/metal_painted_gray.png`.

- [ ] **Step 6: Generate `metal_corrugated.png`**

Prompt: `"seamless tileable 64x64 pixel-art texture of vertical corrugated metal paneling, brushed steel tone, deep vertical ribs, no text"`. Save to `assets/textures/materials/metal_corrugated.png`.

- [ ] **Step 7: Generate `cryo_frost.png`**

Prompt: `"seamless tileable 64x64 pixel-art texture of insulated cryogenic vessel surface, pale blue-white with faint frost crystals and subtle insulation quilting pattern, no text"`. Save to `assets/textures/materials/cryo_frost.png`.

- [ ] **Step 8: Generate `hazard_stripe.png`**

Prompt: `"seamless tileable 64x64 pixel-art texture of diagonal yellow-and-black hazard warning stripes, industrial painted metal, no text"`. Save to `assets/textures/materials/hazard_stripe.png`.

- [ ] **Step 9: Verify all 8 files exist**

Run:
```bash
ls -1 assets/textures/materials/metal_painted_blue.png \
      assets/textures/materials/metal_painted_red.png \
      assets/textures/materials/metal_painted_green.png \
      assets/textures/materials/metal_painted_yellow.png \
      assets/textures/materials/metal_painted_gray.png \
      assets/textures/materials/metal_corrugated.png \
      assets/textures/materials/cryo_frost.png \
      assets/textures/materials/hazard_stripe.png
```
Expected: all 8 paths listed with no errors.

- [ ] **Step 10: Commit**

```bash
git add assets/textures/materials/metal_painted_blue.png \
        assets/textures/materials/metal_painted_red.png \
        assets/textures/materials/metal_painted_green.png \
        assets/textures/materials/metal_painted_yellow.png \
        assets/textures/materials/metal_painted_gray.png \
        assets/textures/materials/metal_corrugated.png \
        assets/textures/materials/cryo_frost.png \
        assets/textures/materials/hazard_stripe.png
git commit -m "assets(textures): add 8 infra category paint and trim materials"
```

---

## Task 2: Register new tiled materials

**Files:**
- Modify: `src/renderer3d/materials/tiled.js` (add 8 entries to the `MATERIALS` export object)

- [ ] **Step 1: Add material entries**

Edit `src/renderer3d/materials/tiled.js`. Add these lines just after the `rack_vent_mesh` / `cable_tray` block and before the `// Tile materials extracted from...` comment:

```js
  metal_painted_blue:   makeMat('metal_painted_blue.png',   { roughness: 0.6, metalness: 0.2 }),
  metal_painted_red:    makeMat('metal_painted_red.png',    { roughness: 0.6, metalness: 0.2 }),
  metal_painted_green:  makeMat('metal_painted_green.png',  { roughness: 0.6, metalness: 0.2 }),
  metal_painted_yellow: makeMat('metal_painted_yellow.png', { roughness: 0.6, metalness: 0.2 }),
  metal_painted_gray:   makeMat('metal_painted_gray.png',   { roughness: 0.6, metalness: 0.2 }),
  metal_corrugated:     makeMat('metal_corrugated.png',     { roughness: 0.5, metalness: 0.5 }),
  cryo_frost:           makeMat('cryo_frost.png',           { roughness: 0.85, metalness: 0.05 }),
  hazard_stripe:        makeMat('hazard_stripe.png',        { roughness: 0.7, metalness: 0.15 }),
```

- [ ] **Step 2: Smoke-test in dev server**

Start dev server (whatever command the project uses — e.g. `npm run dev` or an existing script). Open the game in the browser. Open browser devtools console. Check that there are no 404s for the new PNGs and no Three.js errors. No behavior change yet — materials are registered but nothing references them.

- [ ] **Step 3: Commit**

```bash
git add src/renderer3d/materials/tiled.js
git commit -m "feat(materials): register 8 infra category paint materials"
```

---

## Task 3: Generate decal PNGs (RF power)

**Files:**
- Create: 6 PNGs under `assets/textures/decals/`

Decals are clamp-to-edge (not tileable). Size 64x64 is fine — the existing `scope_screen.png` is the precedent. Pass `tileable: false` or whatever `create_tiles_pro` uses to mean single-tile; otherwise use the same tool.

- [ ] **Step 1: Generate `klystron_pulsed_front.png`**

Prompt: `"64x64 pixel-art front face of a tall red pulsed klystron vacuum tube, square panel view, HV warning placard and small nameplate at the top, coaxial output on the side, industrial heavy-duty look, clamp-to-edge not tiled"`. Save to `assets/textures/decals/klystron_pulsed_front.png`.

- [ ] **Step 2: Generate `klystron_cw_front.png`**

Prompt: `"64x64 pixel-art front face of a continuous-wave klystron vacuum tube, red body with a cyan 'CW' indicator strip, HV warning placard, nameplate, industrial square panel view"`. Save to `assets/textures/decals/klystron_cw_front.png`.

- [ ] **Step 3: Generate `klystron_multibeam_front.png`**

Prompt: `"64x64 pixel-art front face of a premium multi-beam klystron, deep red body with gold trim, multiple beam ports arrayed across the face, prominent nameplate, industrial square panel"`. Save to `assets/textures/decals/klystron_multibeam_front.png`.

- [ ] **Step 4: Generate `modulator_front.png`**

Prompt: `"64x64 pixel-art front of a high-voltage modulator cabinet, red panel with analog meters, large red 'DANGER HIGH VOLTAGE' placard, ventilation louvers at bottom, industrial square view"`. Save to `assets/textures/decals/modulator_front.png`.

- [ ] **Step 5: Generate `ssa_rack_front.png`**

Prompt: `"64x64 pixel-art front of a solid-state RF amplifier rack, red metal frame holding a vertical stack of amplifier modules, each with green status LEDs, industrial square view"`. Save to `assets/textures/decals/ssa_rack_front.png`.

- [ ] **Step 6: Generate `iot_front.png`**

Prompt: `"64x64 pixel-art front of a vacuum tube RF source cabinet, red body with a prominent cylindrical tube window in the center, small control panel, industrial square view"`. Save to `assets/textures/decals/iot_front.png`.

- [ ] **Step 7: Commit**

```bash
git add assets/textures/decals/klystron_pulsed_front.png \
        assets/textures/decals/klystron_cw_front.png \
        assets/textures/decals/klystron_multibeam_front.png \
        assets/textures/decals/modulator_front.png \
        assets/textures/decals/ssa_rack_front.png \
        assets/textures/decals/iot_front.png
git commit -m "assets(decals): add 6 RF power hero-face decals"
```

---

## Task 4: Generate decal PNGs (cooling)

**Files:**
- Create: 3 PNGs under `assets/textures/decals/`

- [ ] **Step 1: Generate `cold_box_front.png`**

Prompt: `"64x64 pixel-art front panel of a cryogenic cold box, blue industrial enclosure with round temperature gauges, a simplified piping schematic diagram, frost edges, square view"`. Save to `assets/textures/decals/cold_box_front.png`.

- [ ] **Step 2: Generate `he_compressor_front.png`**

Prompt: `"64x64 pixel-art front of a large helium compressor, blue industrial body with control HMI touchscreen, ventilation grilles, warning label, square view"`. Save to `assets/textures/decals/he_compressor_front.png`.

- [ ] **Step 3: Generate `chiller_front.png`**

Prompt: `"64x64 pixel-art front of a precision water chiller control panel, blue enclosure with LCD temperature readout, two pressure gauges, pipe connections at the bottom, square view"`. Save to `assets/textures/decals/chiller_front.png`.

- [ ] **Step 4: Commit**

```bash
git add assets/textures/decals/cold_box_front.png \
        assets/textures/decals/he_compressor_front.png \
        assets/textures/decals/chiller_front.png
git commit -m "assets(decals): add 3 cooling hero-face decals"
```

---

## Task 5: Generate decal PNGs (vacuum, controls, safety, power)

**Files:**
- Create: 5 PNGs under `assets/textures/decals/`

- [ ] **Step 1: Generate `bakeout_front.png`**

Prompt: `"64x64 pixel-art front of a vacuum bakeout controller, gray industrial box with temperature dials, power switch, heater cable connections, square view"`. Save to `assets/textures/decals/bakeout_front.png`.

- [ ] **Step 2: Generate `rack_ioc_front.png`**

Prompt: `"64x64 pixel-art front of a 19-inch electronics rack, several 1U blade server modules stacked, green and orange LEDs, vent slots, industrial square view"`. Save to `assets/textures/decals/rack_ioc_front.png`.

- [ ] **Step 3: Generate `pps_panel.png`**

Prompt: `"64x64 pixel-art front of a personnel protection system control panel, cream-colored face with two red key switches, a large orange search button, an indicator light strip, square view"`. Save to `assets/textures/decals/pps_panel.png`.

- [ ] **Step 4: Generate `mps_panel.png`**

Prompt: `"64x64 pixel-art front of a machine protection system panel, light gray metal face with a large red beam abort button and a column of green interlock status LEDs, square view"`. Save to `assets/textures/decals/mps_panel.png`.

- [ ] **Step 5: Generate `power_panel_front.png`**

Prompt: `"64x64 pixel-art front of an electrical breaker distribution panel, green metal door with a row of circuit breakers, yellow 'ELECTRICAL HAZARD' placard, square view"`. Save to `assets/textures/decals/power_panel_front.png`.

- [ ] **Step 6: Commit**

```bash
git add assets/textures/decals/bakeout_front.png \
        assets/textures/decals/rack_ioc_front.png \
        assets/textures/decals/pps_panel.png \
        assets/textures/decals/mps_panel.png \
        assets/textures/decals/power_panel_front.png
git commit -m "assets(decals): add 5 vacuum/controls/safety/power hero-face decals"
```

---

## Task 6: Register new decals

**Files:**
- Modify: `src/renderer3d/materials/decals.js`

- [ ] **Step 1: Add decal entries to `DECALS` export**

Edit `src/renderer3d/materials/decals.js`. Replace the `DECALS` export block with:

```js
export const DECALS = {
  scope_screen: makeDecal('scope_screen.png', { roughness: 0.35, metalness: 0.1 }),

  // RF power
  klystron_pulsed_front:     makeDecal('klystron_pulsed_front.png',     { roughness: 0.6, metalness: 0.25 }),
  klystron_cw_front:         makeDecal('klystron_cw_front.png',         { roughness: 0.6, metalness: 0.25 }),
  klystron_multibeam_front:  makeDecal('klystron_multibeam_front.png',  { roughness: 0.6, metalness: 0.25 }),
  modulator_front:           makeDecal('modulator_front.png',           { roughness: 0.6, metalness: 0.2 }),
  ssa_rack_front:            makeDecal('ssa_rack_front.png',            { roughness: 0.6, metalness: 0.2 }),
  iot_front:                 makeDecal('iot_front.png',                 { roughness: 0.6, metalness: 0.25 }),

  // Cooling
  cold_box_front:            makeDecal('cold_box_front.png',            { roughness: 0.6, metalness: 0.2 }),
  he_compressor_front:       makeDecal('he_compressor_front.png',       { roughness: 0.6, metalness: 0.2 }),
  chiller_front:             makeDecal('chiller_front.png',             { roughness: 0.6, metalness: 0.2 }),

  // Vacuum
  bakeout_front:             makeDecal('bakeout_front.png',             { roughness: 0.65, metalness: 0.2 }),

  // Controls / safety / power
  rack_ioc_front:            makeDecal('rack_ioc_front.png',            { roughness: 0.55, metalness: 0.3 }),
  pps_panel:                 makeDecal('pps_panel.png',                 { roughness: 0.6, metalness: 0.15 }),
  mps_panel:                 makeDecal('mps_panel.png',                 { roughness: 0.6, metalness: 0.15 }),
  power_panel_front:         makeDecal('power_panel_front.png',         { roughness: 0.6, metalness: 0.2 }),
};
```

- [ ] **Step 2: Smoke-test in dev server**

Reload the game in the browser. Open devtools. Verify no 404s for the new PNGs and no Three.js load errors. No visual change yet — decals are registered but nothing references them.

- [ ] **Step 3: Commit**

```bash
git add src/renderer3d/materials/decals.js
git commit -m "feat(decals): register 14 infra hero-face decals"
```

---

## Task 7: Extend `_createFallbackMesh` to support `baseMaterial` + `faces`

**Files:**
- Modify: `src/renderer3d/component-builder.js` — `_createFallbackMesh` around line 1865, plus new module-level cache and helpers

This is the critical rendering change. It mirrors `equipment-builder._faceMaterial` and `_setFaceUVsClamped` but lives inside `component-builder.js` (no cross-builder import — those are private helpers).

- [ ] **Step 1: Add imports, constants, helpers, and cache near the top of `component-builder.js`**

Locate the existing `import { MATERIALS } from './materials/index.js';` line near the top of the file. Immediately after it, add:

```js
import { DECALS } from './materials/decals.js';
```

Then, near the other module-level caches (search for `_matCache` to find a good neighbor), add:

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

  // Per-face tiled override
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

- [ ] **Step 2: Replace the box/cylinder material construction in `_createFallbackMesh`**

In `src/renderer3d/component-builder.js`, find the block beginning around line 1897 that starts `// Visual dims override footprint dims when authored`. The current block builds `geometry` then constructs a single `MeshStandardMaterial` and a `Mesh`. Replace that whole block (from `// Visual dims...` down to and including the `return mesh;`) with:

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

- [ ] **Step 3: Smoke-test regression (no authored infra yet)**

Reload the game in the browser. Enter Infra build mode. Place any infra item (e.g. a roughing pump or a chiller — neither has `baseMaterial` set yet). Confirm it renders exactly as before (flat color, no visual change). Also place a beamline drift pipe or magnet and confirm it also looks unchanged. Check the devtools console for errors.

Expected: zero visual regression because no infra raw entry has `baseMaterial` or `faces` yet, so every call takes the legacy flat-color branch.

- [ ] **Step 4: Commit**

```bash
git add src/renderer3d/component-builder.js
git commit -m "feat(component-builder): add baseMaterial/faces support to fallback mesh"
```

---

## Task 8: Author RF power infra

**Files:**
- Modify: `src/data/infrastructure.raw.js` — entries for `magnetron`, `solidStateAmp`, `twt`, `pulsedKlystron`, `cwKlystron`, `modulator`, `iot`, `multibeamKlystron`, `highPowerSSA`

Add `baseMaterial: 'metal_painted_red'` to each entry listed below, and add a `faces` field where a decal is assigned. Keep all existing fields. `+X` is the local front face.

- [ ] **Step 1: Author `pulsedKlystron`**

In `src/data/infrastructure.raw.js`, locate the `pulsedKlystron:` entry. Add these two fields anywhere inside the object literal (conventionally just after `geometryType: 'box'`):

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

Reload the game in the browser. Enter Infra build mode → RF Power. Place one of each: pulsed klystron, CW klystron, multibeam klystron, modulator, SSA, IOT, TWT. Confirm each shows red paint on 5 faces and its decal on one face. Rotate each through all 4 directions (using the rotate control) and confirm the decal stays on the same local face relative to the object body — not stuck in world space.

- [ ] **Step 11: Commit**

```bash
git add src/data/infrastructure.raw.js
git commit -m "feat(infra): paint RF power items red and assign front-face decals"
```

---

## Task 9: Author cooling infra

**Files:**
- Modify: `src/data/infrastructure.raw.js` — entries for `ln2Dewar`, `cryocooler`, `ln2Precooler`, `heCompressor`, `coldBox4K`, `coldBox2K`, `cryomoduleHousing`, `heRecovery`, `waterLoad`, `lcwSkid`, `chiller`, `coolingTower`, `deionizer`, `emergencyCooling`

Cooling split: `cryo_frost` for cryogenic vessels, `metal_painted_blue` for chilled-water plant.

- [ ] **Step 1: Author `ln2Dewar` (cylinder)**

```js
    baseMaterial: 'cryo_frost',
```
(No `faces` — it's a cylinder.)

- [ ] **Step 2: Author `cryocooler` (box)**

```js
    baseMaterial: 'cryo_frost',
```

- [ ] **Step 3: Author `ln2Precooler` (box)**

```js
    baseMaterial: 'cryo_frost',
```

- [ ] **Step 4: Author `heCompressor` (box)**

```js
    baseMaterial: 'metal_painted_blue',
    faces: { '+X': { decal: 'he_compressor_front' } },
```

- [ ] **Step 5: Author `coldBox4K` (box)**

```js
    baseMaterial: 'cryo_frost',
    faces: { '+X': { decal: 'cold_box_front' } },
```

- [ ] **Step 6: Author `coldBox2K` (box)**

```js
    baseMaterial: 'cryo_frost',
    faces: { '+X': { decal: 'cold_box_front' } },
```

- [ ] **Step 7: Author `cryomoduleHousing` (box)**

```js
    baseMaterial: 'cryo_frost',
```

- [ ] **Step 8: Author `heRecovery` (cylinder)**

```js
    baseMaterial: 'cryo_frost',
```

- [ ] **Step 9: Author `waterLoad` (box)**

```js
    baseMaterial: 'metal_painted_blue',
```

- [ ] **Step 10: Author `lcwSkid` (box)**

```js
    baseMaterial: 'metal_painted_blue',
    faces: { '+X': { decal: 'chiller_front' } },
```

- [ ] **Step 11: Author `chiller` (box)**

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

- [ ] **Step 13: Author `deionizer` (box)**

```js
    baseMaterial: 'metal_painted_blue',
```

- [ ] **Step 14: Author `emergencyCooling` (box)**

```js
    baseMaterial: 'metal_painted_blue',
```

- [ ] **Step 15: Visual check**

Reload the game. In Infra → Cooling, place one of each authored item. Confirm:
- `ln2Dewar` is a cylinder wrapped in frost texture, not stretched.
- `coldBox4K`, `coldBox2K`, `chiller`, `lcwSkid`, `heCompressor` show their decals on the front face.
- `chiller` top face uses `metal_corrugated` (distinct from the blue paint on the other faces).
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
- Modify: `src/data/infrastructure.raw.js` — entries for `roughingPump`, `turboPump`, `ionPump`, `negPump`, `tiSubPump`, `piraniGauge`, `coldCathodeGauge`, `baGauge`, `gateValve`, `bakeoutSystem`

Most vacuum items are small cylinders/boxes; only `bakeoutSystem` gets a decal.

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

Reload. In Infra → Vacuum, place a gate valve, roughing pump, bakeout system, and each of the three gauges. Confirm: gray paint reads on all of them; bakeout system has its decal on the front; cylinders (turbo pump, pirani gauge, etc.) wrap correctly without stretching.

- [ ] **Step 12: Commit**

```bash
git add src/data/infrastructure.raw.js
git commit -m "feat(infra): paint vacuum items gray/brushed and add bakeout decal"
```

---

## Task 11: Author controls, safety, ops, and power infra

**Files:**
- Modify: `src/data/infrastructure.raw.js` — entries for `rackIoc`, `ppsInterlock`, `shielding`, `targetHandling`, `beamDump`, `radWasteStorage`, `mps`, `areaMonitor`, `timingSystem`, `laserSystem`, `powerPanel`, `substation`, `llrfController`, `rfCoupler`, `circulator`

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

Select a decal-bearing infra item (e.g. a klystron). Confirm the dimming/tint behavior still works without mutating the shared decal material (other klystrons should not be affected). If dimming mutates the shared material in place, you'll see decals on every klystron flicker — if that happens, open a follow-up to clone before tinting. Note any such behavior in the PR description rather than fixing in this pass, since selection handling is out of scope.

- [ ] **Step 6: If all checks pass, merge/PR as usual**

No commit needed if no issues found. If the dimming regression shows up in Step 5, create a short follow-up note in `docs/superpowers/` describing what was observed (don't fix in this plan — scope is textures/decals only).

---

## Self-review notes

- **Spec coverage:** Sections 1–7 of the spec are all addressed. Section 1 (rendering extension) → Task 7. Section 2 (palette) → Tasks 1–2. Section 3 (decals) → Tasks 3–6. Section 4 (data model) → Tasks 8–11. Section 5 (implementation order) → task ordering matches. Section 6 (testing) → Task 12. Section 7 (out of scope) → preserved; no simulation/params changes.
- **Cylinders:** spec says cylinders get `baseMaterial` only; plan Task 7 Step 2 cylinder branch implements this exactly.
- **Legacy fallback preserved:** Task 7 Step 2 keeps a non-authored flat-color path; Task 7 Step 3 verifies beamline components still render unchanged.
- **Face-key convention:** `+X` front everywhere, matching `equipment-builder` and the spec's "+X is local front."
- **Asset totals:** 8 materials (Task 1) + 14 decals (Task 3: 6 RF, Task 4: 3 cooling, Task 5: 5 vacuum/controls/safety/power → 14). Spec updated to match.
