# Texturing System Design

**Date:** 2026-04-11
**Status:** Draft — pending user review

## Goal

Give 3D objects, walls, and floors real pixel-art textures instead of flat-shaded solid colors, while supporting custom "decal" faces for equipment with distinctive fronts (server rack fronts, oscilloscope CRTs, VNA screens, PSU front panels, cryo fridge doors).

## Non-goals

- Realistic/PBR materials (normal maps, roughness maps, AO). Pixel-art aesthetic only.
- Dynamic per-instance material state (animated LEDs, blinking screens). Reserved for a later pass.
- Rotated tiling axes. v1 only supports local-axis-aligned tiling.
- Reprojection of RCT2 isometric tiles into flat tileable sources. Optional, deferred.

## Architecture

Two parallel tracks with no shared abstraction between them.

### Track 1 — Beamline components (`component-builder.js`)

Multi-primitive role-merged meshes. **Tiled materials only, no decals.**

- Each role (`iron`, `copper`, `pipe`, `stand`, `detail`, `accent`) has a default tiled texture map assigned to its shared `MeshStandardMaterial`.
- `SHARED_MATERIALS` is sourced from the new `MATERIALS` module (see "Runtime" below) instead of constructing solid-color materials inline.
- Component definitions in `src/data/components.raw.js` may optionally override any role's texture by name:
  ```js
  source: {
    // ...existing fields
    textures: { iron: 'metal_painted_white' }
  }
  ```
- Accent color stays driven by `getAccentMaterial(compType, colorHex)`. The accent material additionally sets `.map` to a neutral tintable base (default: `metal_painted_white`) so "map × color" preserves the accent color while giving the surface texture.
- Template merging (`_templateCache`, `_mergeGeometries`) is unchanged. UVs are baked into each primitive *before* it enters the role bucket, so merged geometry already has correct UVs.

### Track 2 — Equipment / furniture (`equipment-builder.js`)

Single `BoxGeometry` per item with a **6-slot material array** (face order: `+X, -X, +Y, -Y, +Z, -Z`). Each face is independently either a tiled base material or a decal.

Equipment definition shape:
```js
serverRack: {
  // ...existing fields
  baseMaterial: 'metal_dark',
  faces: {
    '+Z': { decal: 'server_rack_front' },   // front
    '-Z': { decal: 'server_rack_back' },    // back vents
    // +X, -X, +Y, -Y fall back to baseMaterial
  }
}
```

- Unspecified faces inherit `baseMaterial`.
- Materials and decals are **module-level singletons** — shared across all instances of the same equipment type. Per-instance materials are only constructed when per-instance state exists (reserved for later).
- No merging, no role buckets. Equipment stays as one mesh per instance.

### Walls (`wall-builder.js`)

Tiled materials via world-scaled UV rewrite. One tiled material per wall type, assigned from `MATERIALS` by name stored on the wall-type definition. Transparent cutaway mode still works: `.opacity`/`.transparent` apply over the textured material as today.

### Floors (`infra-builder.js`)

Already textured. Change: switch the existing UV remap to **world-scaled** UVs so floor pixels stay the same size regardless of zone extent. Texture source is unchanged (zone tile PNGs from `assets/tiles/`).

## UV strategy: fixed texel density

**Global constant:** `TEXEL_SCALE = 32` texels per world meter. A 64×64 source texture covers 2m × 2m of world surface. Easy to tweak later; everything derives from this.

### Box primitives

For a box of size `w × h × d`, each of the 6 faces gets UVs computed from its two world-space dimensions:

| Face | U spans | V spans |
|---|---|---|
| `+X`, `-X` | `d / 2m` | `h / 2m` |
| `+Y`, `-Y` | `w / 2m` | `d / 2m` |
| `+Z`, `-Z` | `w / 2m` | `h / 2m` |

Helper `applyTiledBoxUVs(geometry, w, h, d)` rewrites the `uv` attribute in place. Called on each `BoxGeometry` primitive in `ROLE_BUILDERS` before it enters the role bucket. The merged role geometry inherits the rewritten UVs automatically.

### Cylinder primitives

Helper `applyTiledCylinderUVs(geometry, radius, height)`:
- Side: U = circumference (`2π·r / 2m`), V = height (`height / 2m`).
- Caps: simple radial/planar fallback — acceptable for flanges.

### Decal faces

Decal faces **do not** use tiled UVs. They get the default `BoxGeometry` 0→1 UVs and `ClampToEdgeWrapping`. Decal PNGs are authored to match the target face aspect ratio — the asset-gen tool records the face aspect and passes it to PixelLab.

### Wrap and filter modes

| Texture kind | Wrap | Filter | Color space | Mipmaps |
|---|---|---|---|---|
| Tiled material | `RepeatWrapping` | `NearestFilter` | `SRGBColorSpace` | off |
| Decal | `ClampToEdgeWrapping` | `NearestFilter` | `SRGBColorSpace` | off |

## Texture catalog

### Tiled materials (~11 base)

Stored in `assets/textures/materials/`, authored seamless 64×64:

| Name | Use |
|---|---|
| `metal_dark` | Default iron/steel role on beamline components |
| `metal_brushed` | Alternate metal, high-quality equipment |
| `metal_painted_white` | Painted enclosures, accent tintable base |
| `copper` | Copper role (RF cavities, coils) |
| `concrete_floor` | Shielding floors, machine shop |
| `concrete_wall` | Shielding walls, exterior |
| `drywall_painted` | Interior office/control walls |
| `wood_panel` | Wood furnishings, desks |
| `rubber_mat` | Anti-static mats, safety zones |
| `rack_vent_mesh` | Server rack ventilation sides, grilles |
| `cable_tray` | Cable management runs |
| `tile_floor_white` | Cleanroom floors |

### Decals (per-equipment, variable aspect)

Stored in `assets/textures/decals/`, PixelLab-generated:

| Name | Target |
|---|---|
| `server_rack_front` | Server rack +Z face (LEDs, bezel) |
| `server_rack_back` | Server rack -Z face (vents, cables) |
| `oscilloscope_crt` | Oscilloscope cart front (waveform CRT) |
| `vna_screen` | VNA front (plot display) |
| `computer_monitor` | Workstation monitor face |
| `psu_front` | Power supply front (switches, meters) |
| `cryo_fridge_door` | Cryo fridge door (handle, label) |

More added iteratively as equipment items are introduced.

## Authoring paths

Three sources, picked per-material for best fit:

### 1. Procedural script (I write it)

`tools/asset-gen/gen-materials.cjs` — Node script using `pngjs`. Generates seamless 64×64 pixel-art textures for deterministic patterns: `metal_dark`, `metal_brushed`, `metal_painted_white`, `copper`, `concrete_floor`, `concrete_wall`, `drywall_painted`, `rack_vent_mesh`, `cable_tray`, `tile_floor_white`, `rubber_mat`.

Script is committed, re-runnable, outputs committed as PNGs. Palette and pattern parameters centralized at the top for tuning.

### 2. PixelLab

- **Tiled materials:** `wood_panel` (hard procedurally). Uses existing `server.cjs` `/api/generate` with `assetType='tile'` — prompt already includes `"seamless texture, pixel art, RCT2 style"`.
- **All decals:** New endpoint `POST /api/generate-decal` taking `{ name, prompt, width, height, targetFace }`. Outputs to `assets/textures/decals/`. Dashboard gets a "Decals" tab listing equipment items with decal slots and a generate button per slot.

### 3. RCT2 re-projection (deferred)

`assets/rct2-extracted/footpaths/` contains tarmac, crazy paving, tile, and dirt textures that could seed higher-quality concrete/tarmac alternatives. Requires un-warping from isometric diamonds to flat squares. Not on the critical path.

## Runtime: materials module

Materials and decals are **module exports, not a manifest lookup**. The set is closed and version-controlled; runtime indirection is ceremony.

```
src/renderer3d/materials/
  index.js      // re-exports MATERIALS and DECALS
  tiled.js      // imports PNGs, builds tiled MeshStandardMaterials
  decals.js     // imports PNGs, builds decal MeshStandardMaterials
```

`tiled.js` example shape:
```js
import metalDarkUrl from '../../../assets/textures/materials/metal_dark.png';
// ...more imports

const loader = new THREE.TextureLoader();
function loadTiled(url) {
  const tex = loader.load(url);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  return tex;
}

export const TILED = {
  metal_dark: new THREE.MeshStandardMaterial({
    map: loadTiled(metalDarkUrl),
    metalness: 0.4,
    roughness: 0.6,
  }),
  // ...
};
```

`decals.js` mirrors this with `ClampToEdgeWrapping`.

`index.js` re-exports `MATERIALS` (= `TILED`) and `DECALS`. Consumers:
- `component-builder.js` imports `{ MATERIALS }` and uses `MATERIALS[key]`. Synchronous.
- `equipment-builder.js` imports `{ MATERIALS, DECALS }`, builds per-face material arrays by direct lookup.
- `wall-builder.js`, `infra-builder.js` import `{ MATERIALS }`.

**`TextureManager` is unchanged.** It continues to manage sprites, zone tiles, and decorations — externally-sourced assets with manifests. Materials and decals are first-party code assets and live in their own module.

**Failure mode:** if an import path is wrong the build fails loudly. No graceful `null` fallback — that's appropriate for first-party assets tracked in git.

## Sharing and draw-call discipline

- Tiled materials are module-level singletons. A beamline of 30 components draws in ~6 batches (five roles + accent), same as today. Adding `.map` to shared materials costs zero extra draw calls.
- Decal materials are also module-level singletons shared across instances. 20 server racks share 1 `server_rack_front` material and batch together.
- Per-instance materials are never constructed in v1. When per-instance state is needed later (animated LEDs), a builder can opt-in to cloning the decal material; this is the only escape valve and is explicitly out of scope now.
- Accent materials continue to be keyed by `(componentType, colorHex)` per the existing `_accentMatCache`.

## Disposal

Unchanged rules, following commit `b7128008`:
- Shared module-level materials (`MATERIALS`, `DECALS`) are **never disposed** by builders.
- Template cache materials and accent cache materials are owned by `component-builder.js` and disposed only on full scene teardown.
- Per-placement dim clones (`userData._dimMat`) continue to be disposed in `_disposeWrapper()`.

## Files touched

| File | Change |
|---|---|
| `assets/textures/materials/*.png` | New — procedurally generated |
| `assets/textures/decals/*.png` | New — PixelLab-generated |
| `tools/asset-gen/gen-materials.cjs` | New — `pngjs` procedural generator |
| `tools/asset-gen/server.cjs` | New `POST /api/generate-decal` endpoint |
| `tools/asset-gen/public/` (dashboard) | New "Decals" tab |
| `src/renderer3d/materials/index.js` | New — re-exports `MATERIALS`, `DECALS` |
| `src/renderer3d/materials/tiled.js` | New — imports PNGs, builds tiled materials |
| `src/renderer3d/materials/decals.js` | New — imports PNGs, builds decal materials |
| `src/renderer3d/uv-utils.js` | New — `applyTiledBoxUVs`, `applyTiledCylinderUVs` |
| `src/renderer3d/component-builder.js` | `SHARED_MATERIALS` from `MATERIALS`; `ROLE_BUILDERS` primitives call `applyTiledBoxUVs`/`applyTiledCylinderUVs` before merge; `textures` field override support |
| `src/renderer3d/equipment-builder.js` | Per-box 6-entry material array; per-face `MATERIALS`/`DECALS` lookup; `baseMaterial` + `faces` def fields |
| `src/renderer3d/wall-builder.js` | Tiled UVs + material lookup from `MATERIALS` |
| `src/renderer3d/infra-builder.js` | Switch floor UVs to world-scaled |
| `src/data/components.raw.js` | Optional `textures` field per component |
| Equipment definitions (location TBD during impl) | `baseMaterial` + `faces` fields |

## Rollout order

Each step is independently testable and leaves the game renderable.

1. **Procedural materials script** — write `gen-materials.cjs`, generate the ~11 PNGs, commit outputs.
2. **`materials/` module** — `MATERIALS` and `DECALS` exports, with decals empty initially. Import-clean check.
3. **UV utils + walls** — `uv-utils.js` + wire `wall-builder.js`. Walls become the first visibly textured surface.
4. **Floors** — world-scaled UVs in `infra-builder.js`. Floor zones stop stretching at different zoom/zone sizes.
5. **Beamline components (defaults only)** — apply UV utils in `ROLE_BUILDERS`; `SHARED_MATERIALS` sourced from `MATERIALS`. All components get default textures, no per-component overrides yet.
6. **Per-component texture overrides** — add `textures` field support, apply to 2–3 components as proof.
7. **Equipment 6-face refactor** — single `BoxGeometry` with material array in `equipment-builder.js`; all faces use `baseMaterial` only (no decals yet).
8. **Decals v1** — hand-author or PixelLab-generate 2–3 decals; wire through equipment defs. First custom faces visible.
9. **Asset-gen decal endpoint + Decals dashboard tab** — productionize decal authoring.
10. **Fill out decal library** — iteratively generate remaining decals.

Deferred (not blocking): RCT2 isometric re-projection, per-instance animated decals.

## Open questions

None remaining from brainstorming. All decisions locked:

- Aesthetic: pure pixel art, `NearestFilter`, `SRGBColorSpace`.
- Texel density: 32 texels/meter (`TEXEL_SCALE = 32`).
- Architecture: two-track (beamline role-merged + equipment single-box multi-material).
- Authoring: procedural script for tiled base materials, PixelLab for wood and all decals.
- Runtime: module exports, not manifests.
- Draw calls: all materials module-level singletons; per-instance reserved for future.
