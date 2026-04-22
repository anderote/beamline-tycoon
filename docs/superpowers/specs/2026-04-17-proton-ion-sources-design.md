# Proton Ion Sources — Design

## Goal

Split the current single particle-source component (an electron-gun visual masquerading as both electron and proton via a `particleType` paramOption toggle) into three distinct beamline components — one electron gun and two proton ion sources at different tech tiers — each with its own 3D build, parameters, infra requirements, and unlock gate. Also rename the source-category subsection from `electron` to `source` so the bucket name fits its content.

## Why

- The current `paramOptions.particleType: ['electron', 'proton']` toggle is a stub: the 3D model is unmistakably an electron gun, the descriptive text is an electron gun, and there is no gameplay differentiation between the two settings.
- The research tree already has `protonAcceleration` (cost: $3M / 60d) listing `ionSource` in its `unlocks` array — the slot is wired but the component does not exist. Filling it costs us nothing extra.
- Adding a tiered proton path (basic duoplasmatron → ECR upgrade) creates a real reason to invest in RF Power and Cooling infrastructure once the player commits to protons.

## Scope

In:
- Modes/subsection rename in `src/data/modes.js`.
- Modify existing `source` component (rename, drop particle-type toggle).
- Add two new beamline components: `ionSource` (Duoplasmatron), `ecrIonSource` (ECR).
- Add one new research entry: `ecrIonSource`.
- Add two new 3D builders to `src/renderer3d/component-builder.js`, registered in the dispatcher.

Out:
- Heavy-ion variants (Penning, RF plasma, etc.) — duoplasmatron + ECR cover the basic/advanced tier; more types can come later if and when there's a gameplay reason.
- Downstream physics changes (proton-vs-electron mass effects on optics, etc.) — particle type is currently informational; engaging with it changes scope dramatically.
- Migration of existing saves — single-user pre-release, per CLAUDE.md.
- 2D overlay sprite for `ecrIonSource` (the existing 2D path uses generic source sprites; new isometric overlays can come later if the component sees use).

## Subsection Rename

In `src/data/modes.js`, the beamline `source` category currently declares:

```
subsections: { transport, electron, utility }
```

Becomes:

```
subsections: { transport, source, utility }
```

`subsection` strings on existing components in `src/data/beamline-components.raw.js` that use `'electron'` are updated to `'source'`. Beam Pipe (`drift`) stays in `'transport'` (already moved). Bellows stays in `'utility'`.

## Component Definitions

All three live in `category: 'source', subsection: 'source'`. Stats and costs follow tycoon scaling: basic proton ≈ 2× electron-gun cost, advanced proton ≈ 6×.

### 1. `source` — Electron Gun (modified existing)

| Field | Value |
|---|---|
| `name` | `'Electron Gun'` (was `'Source'`) |
| `desc` | unchanged (already describes a thermionic gun) |
| `params` | `{ extractionVoltage: 50, cathodeTemperature: 1200 }` — `particleType` removed |
| `paramOptions` | removed |
| `subsection` | `'source'` (was `'electron'`) |
| `requiredConnections` | `['powerCable']` (unchanged) |
| `unlocked` | `true` (unchanged) |
| Footprint, ports, cost, energy, sprite | unchanged |

### 2. `ionSource` — Duoplasmatron Ion Source (new, fills existing research stub)

| Field | Value |
|---|---|
| `id` | `'ionSource'` |
| `name` | `'Duoplasmatron Ion Source'` |
| `desc` | "Classic duoplasmatron proton source — a hot filament generates a primary plasma, then a magnetic constriction squeezes it through an intermediate electrode into a dense secondary plasma at the anode aperture. Reliable, moderate current, and your workhorse first proton source. Requires cooling for the magnet and arc chamber." |
| `category` | `'source'` |
| `subsection` | `'source'` |
| `cost` | `{ funding: 400000 }` |
| `stats` | `{ beamCurrent: 50 }` |
| `energyCost` | 25 |
| Footprint | `subL: 4, subW: 4, subH: 4, gridW: 4, gridH: 4`, `geometryType: 'box'` |
| `interiorVolume` | 5 |
| `unlocked` | omitted (gated by research) |
| `isSource` | `true` |
| `spriteKey` | `'ionSource'` (matches existing 2D overlay function) |
| `spriteColor` | 0x44aacc |
| `params` | `{ particleType: 'proton', extractionVoltage: 40, arcCurrent: 5 }` |
| `paramOptions` | none |
| `placement` | `'module'` |
| `role` | `'junction'` |
| `routing` | `[]` |
| `ports` | `{ exit: { side: 'front' } }` |
| `requiredConnections` | `['powerCable', 'coolingWater']` |

Unlock: already wired in `src/data/research.js` under `protonAcceleration.unlocks` — no research changes needed for this one.

### 3. `ecrIonSource` — ECR Ion Source (new)

| Field | Value |
|---|---|
| `id` | `'ecrIonSource'` |
| `name` | `'ECR Ion Source'` |
| `desc` | "Electron Cyclotron Resonance ion source — microwave power at 2.45 GHz heats a plasma confined by mirror solenoid magnets, producing high-current proton beams suitable for high-power facilities. Demands RF waveguide injection and substantial cooling, but delivers 4× the current of a duoplasmatron." |
| `category` | `'source'` |
| `subsection` | `'source'` |
| `cost` | `{ funding: 1200000 }` |
| `stats` | `{ beamCurrent: 200 }` |
| `energyCost` | 60 |
| Footprint | `subL: 6, subW: 4, subH: 4, gridW: 4, gridH: 6`, `geometryType: 'box'` |
| `interiorVolume` | 8 |
| `unlocked` | omitted (gated by research) |
| `isSource` | `true` |
| `spriteKey` | `'ecrIonSource'` |
| `spriteColor` | 0x66ccaa |
| `params` | `{ particleType: 'proton', extractionVoltage: 40, microwavePower: 1500, magnetCurrent: 200 }` |
| `paramOptions` | none |
| `placement` | `'module'` |
| `role` | `'junction'` |
| `routing` | `[]` |
| `ports` | `{ exit: { side: 'front' } }` |
| `requiredConnections` | `['powerCable', 'coolingWater', 'rfWaveguide']` |

## Research Addition

In `src/data/research.js`, add one entry alongside `protonAcceleration`:

```
ecrIonSource: {
  id: 'ecrIonSource',
  category: 'machineTypes',
  name: 'ECR Ion Sources',
  desc: 'Develop high-current Electron Cyclotron Resonance ion sources. Microwave power at 2.45 GHz heats a magnetically confined plasma, producing proton currents several times higher than classical duoplasmatron sources. Requires integrated RF waveguide injection and active cooling of the chamber and mirror magnets.',
  cost: { data: 30, funding: 5000000 },
  duration: 70,
  unlocks: ['ecrIonSource'],
  requires: 'protonAcceleration',
}
```

Existing `protonAcceleration.unlocks` does not change — it already lists `ionSource`, which is now defined.

## 3D Builders

Two new functions in `src/renderer3d/component-builder.js`, both following the style of `_buildSource()` (lines 407–~520): `THREE.Group`, helpers `_mat`, `_addShadow`, `applyTiledCylinderUVs`, constants `BEAM_HEIGHT`, `SEGS`, `FLANGE_COLOR`. Registered in the dispatcher map at line 2056 alongside `source: _buildSource`.

### `_buildDuoplasmatron()`

Compact ion-gun visual, axis-aligned (rotation through Z, like the electron gun):

- **Body cylinder** — ~0.4 radius × ~1.0 length, dark steel-blue (`0x4a5b7a`, distinct from the gun's green-grey). Front/rear flanges using `FLANGE_COLOR`.
- **Magnet collar** — torus geometry (`THREE.TorusGeometry`) wrapping the body midpoint, dark iron (`0x222222`), oriented around the beam axis. Reads as the magnetic constriction.
- **Hot-cathode rear cap** — small disc at the rear end with emissive orange material (`emissive: 0xff6633, emissiveIntensity: 0.4`) — the only emissive element, sells the "hot filament" read.
- **Extraction electrode stack** — two thin copper rings (`copperC = 0xb87333`) at the front, each ~0.15 radius × 0.04 thickness, separated by ~0.05 gap.

Total length on beam axis: ~1.4 units, fits inside the 4-sub footprint comfortably.

### `_buildEcrIonSource()`

Larger and visibly more complex than both other sources:

- **Plasma chamber** — central cylinder ~0.5 radius × ~1.2 length, light steel (`0x8a9aab`) with end-cap flanges.
- **Mirror solenoid coils** — two large torus geometries (`THREE.TorusGeometry`), one near each end of the chamber, dark copper (`0x884422`), tube radius ~0.12, ring radius ~0.55. Mirror configuration is the visual signature of an ECR.
- **Microwave waveguide** — rectangular box (`THREE.BoxGeometry` ~0.25 × 0.25 × 0.6) entering the chamber from the rear-left side, brass-colored (`0xc8b060`). Sells the "RF in" read; aligns with the new `rfWaveguide` requirement.
- **Extraction stack** — three copper plates of decreasing radius at the front (0.25 → 0.18 → 0.12), spaced ~0.06 apart. Reads as a multi-electrode high-voltage extraction column.

Total length on beam axis: ~2.0 units, fits inside the 6-sub footprint with slack at the ends.

Both builders use only existing helpers and material types — no new shaders, no new asset files.

## Files Touched

- `src/data/modes.js` — subsection rename in beamline source category.
- `src/data/beamline-components.raw.js` — modify `source`, add `ionSource`, add `ecrIonSource`.
- `src/data/research.js` — add `ecrIonSource` research entry.
- `src/renderer3d/component-builder.js` — add `_buildDuoplasmatron`, `_buildEcrIonSource`, register in dispatcher.

## Acceptance Criteria

- Beamline mode → Sources tab shows three subsections in order: **Transport** (Beam Pipe — Z), **Source** (Electron Gun, Duoplasmatron, ECR), **Utility** (Bellows). Locked components (Duoplasmatron, ECR) are hidden until their research is complete.
- After researching `protonAcceleration`, the Duoplasmatron appears in the Source subsection and is placeable.
- After also researching `ecrIonSource` (which requires `protonAcceleration`), the ECR appears.
- Each of the three sources renders a distinct 3D model in the world (electron gun ≠ duoplasmatron ≠ ECR — visually distinguishable at default zoom).
- The existing `source` component's particle-type paramOption is gone (no toggle in the inspector); proton beams come exclusively from the dedicated proton components.
- Required-connection warnings/errors fire correctly: placing a duoplasmatron without coolingWater flags the missing connection; placing an ECR without rfWaveguide flags it.

## Out of Scope / Deferred

- Two-direction-source variants, photoinjector variants for protons, multi-charge-state heavy ions.
- Proton-specific physics differences (mass-dependent rigidity in dipoles, etc.).
- New 2D isometric sprites for ECR (existing overlay path falls back to generic source rendering).
- Save migration for facilities that have a placed `source` configured to `particleType: 'proton'` — pre-release, breakage acceptable.
