# Infrastructure Textures & Decals

**Date:** 2026-04-11
**Scope:** Pass D — textures/decals only. Performance characteristics, supply/demand ledger, and `params`/`energyCost` authoring are deferred.

## Goal

Give infrastructure items (power, vacuum, RF power, cooling, dataControls, ops) distinct per-category paint and hero decals so clusters of placed infra read visually. Today all infra items render as flat-colored boxes/cylinders through `component-builder.js`'s `_createFallbackMesh` path — this pass upgrades that path to support the same `baseMaterial`/`faces`/decal pipeline `equipment-builder.js` already uses.

## Non-goals

- No changes to infra `params`, `energyCost`, `stats`, or simulation
- No supply/demand or resource ledger
- No changes to beamline component rendering (role-based path untouched)
- No changes to `equipment-builder.js`
- No asset overwrites — all new filenames only

## Rendering extension

`src/renderer3d/component-builder.js`, function `_createFallbackMesh` (~line 1870), is the only path infra box/cylinder items take. It currently produces one flat-colored `MeshStandardMaterial`. Extend it:

**Box branch** — when `compDef.baseMaterial` or `compDef.faces` is set, build a 6-entry material array (`+X, -X, +Y, -Y, +Z, -Z`) mirroring `equipment-builder._faceMaterial`. Per-face UVs get clamped to 0→1 when that face has a `decal` override. Faces without overrides tile `baseMaterial`. When neither field is set, keep today's flat-color path so existing fallback consumers are untouched.

**Cylinder branch** — accept `compDef.baseMaterial` only; set the cylinder's single material to the tiled material. Caps retain `spriteColor`-based flat color. Per-face decals are not supported for cylinders (only 3 geometric faces, side UV is unrolled). LN2 dewars, pumps, cooling towers, gauges, helium recovery, NEG pumps use this route.

**Rotation** — decals live in local space. The existing `obj.rotation.y = -(direction || 0) * (Math.PI / 2)` at line 2044 rotates the whole group, so a klystron's `+X` decal stays stuck to its local front regardless of `direction`. No extra work.

**Caching** — new module-level `_infraMatCache` keyed by `${compType}|${faceKey}|${baseName}|${overrideJSON}`, mirroring `equipment-builder._equipMatCache`.

## Data model

Optional fields on infra raw entries. No field = today's flat-color behavior.

```js
pulsedKlystron: {
  geometryType: 'box',
  baseMaterial: 'metal_painted_red',
  faces: {
    '+X': { decal: 'klystron_pulsed_front' },
  },
},

ln2Dewar: {
  geometryType: 'cylinder',
  baseMaterial: 'cryo_frost',
},

chiller: {
  geometryType: 'box',
  baseMaterial: 'metal_painted_blue',
  faces: {
    '+X': { decal: 'chiller_front' },
    '+Y': { base: 'metal_corrugated' },
  },
},
```

**Face keys:** `+X/-X/+Y/-Y/+Z/-Z` — match `equipment-builder`. Convention: `+X` is local front (rotates with item); `+Y` is top; `-Y` is bottom (never decorated).

**Face override shape:**
- `{ decal: 'name' }` — pulled from `DECALS`, UVs clamped 0→1
- `{ base: 'material_name' }` — tiled override for that face only
- absent — inherits `baseMaterial`

This matches `equipment-builder` exactly so a future refactor can unify the two builders.

## New assets

### Tiled materials (8 PNGs → `assets/textures/materials/`)

Generated via `mcp__pixellab__create_tiles_pro`, 64×64 pixel-art seamless, matching existing `metal_painted_white` style.

| File | Used by | Notes |
|---|---|---|
| `metal_painted_blue.png` | cooling (chiller, cold boxes, LCW skid, water load, deionizer, emergency cooling) | Industrial chiller blue |
| `metal_painted_red.png` | rfPower sources (klystrons, IOT, SSA, TWT, magnetron, modulator) | Safety red; matches `0xcc4444` |
| `metal_painted_green.png` | power (substation, powerPanel, laserSystem) | Electrical green |
| `metal_painted_yellow.png` | ops/safety (shielding, beamDump, radWasteStorage, targetHandling) | Hazard yellow |
| `metal_painted_gray.png` | vacuum (bakeoutSystem, ion/Ti pumps, gate valves) | Matches `0x999999` |
| `metal_corrugated.png` | rack sides, chiller flanks, detail variant | Vertical ribbing |
| `cryo_frost.png` | LN2 dewar, cold boxes, helium recovery sides | Subtle frost/insulation |
| `hazard_stripe.png` | beam dump ends, rad waste doors | Diagonal yellow/black trim |

Existing `rack_vent_mesh.png` covers IOC rack sides.

### Decals (15 PNGs → `assets/textures/decals/`)

Generated via `mcp__pixellab__create_tiles_pro`, clamp-to-edge, one per hero face. Several items share decals where they are visually similar.

**RF Power (6):**
| Decal | Items |
|---|---|
| `klystron_pulsed_front.png` | pulsedKlystron |
| `klystron_cw_front.png` | cwKlystron |
| `klystron_multibeam_front.png` | multibeamKlystron |
| `modulator_front.png` | modulator |
| `ssa_rack_front.png` | solidStateAmp, highPowerSSA |
| `iot_front.png` | iot, twt, magnetron |

**Cooling (4):**
| Decal | Items |
|---|---|
| `cold_box_front.png` | coldBox4K, coldBox2K |
| `he_compressor_front.png` | heCompressor |
| `chiller_front.png` | chiller, lcwSkid |
**Vacuum (1):**
| Decal | Items |
|---|---|
| `bakeout_front.png` | bakeoutSystem |

**Controls/Safety (4):**
| Decal | Items |
|---|---|
| `rack_ioc_front.png` | rackIoc, timingSystem, llrfController |
| `pps_panel.png` | ppsInterlock |
| `mps_panel.png` | mps |
| `power_panel_front.png` | powerPanel, substation |

Total: **11 decal files** for 12 box items with unique fronts; several items share decals by visual similarity.

Cylinder items (ln2Dewar, piraniGauge, coldCathodeGauge, baGauge, areaMonitor, cooling towers, turbo/roughing/NEG/Ti pumps, helium recovery) get **category paint only** this pass — per-face decals on cylinders are out of scope. `ln2Dewar` uses `cryo_frost` tiled; gauges use `metal_painted_gray`; area monitor uses `metal_painted_yellow`.

Remaining ~12 box items (gate valve, circulator, rfCoupler, shielding, beamDump, radWasteStorage, targetHandling, ln2Precooler, cryomoduleHousing, cryocooler, deionizer, emergencyCooling) get category paint only — too small, structural, or visually generic for a hero decal to pay off.

## Implementation order

1. Generate 8 tiled material PNGs via `mcp__pixellab__create_tiles_pro` → `assets/textures/materials/`
2. Register new materials in `src/renderer3d/materials/index.js` and `tiled.js`
3. Generate 15 decal PNGs via `mcp__pixellab__create_tiles_pro` → `assets/textures/decals/`
4. Register new decals in `src/renderer3d/materials/decals.js`
5. Extend `_createFallbackMesh` in `src/renderer3d/component-builder.js`:
   - Box branch: `baseMaterial`/`faces` → 6-material array + per-face UV clamp for decal faces
   - Cylinder branch: `baseMaterial` → tiled side material
   - Add `_infraMatCache`
6. Author `baseMaterial`/`faces` on ~28 infra raw entries in `src/data/infrastructure.raw.js`
7. Visual verification in browser (see below)

## Verification

No unit tests — this is purely visual.

- Run dev server, enter Infra build mode
- Place one item per category (klystron, chiller, LN2 dewar, cooling tower, rack IOC, PPS, substation, bakeout system, beam dump)
- Rotate each through all 4 directions — confirm decals stay on local front face
- Confirm cylinders show tiled material on side without stretching
- Confirm items without `baseMaterial`/`faces` still render as flat-color (no regression on un-authored items)
- Confirm existing beamline components (magnets, cavities, drift pipes) are visually unchanged

## Risk notes

- `_createFallbackMesh` is also used by the ghost/preview path (see ~line 1720). The extension must keep a path that works when called with no decals (existing beamline ghosts rely on that).
- Shared decal materials across items mean dimming/selection tint must not mutate the shared material — check whether the existing dimming path clones before tinting.
- Cylinder caps stay flat-colored from `spriteColor`; authors should verify cylinder items still read correctly when `spriteColor` no longer matches the category base material.
