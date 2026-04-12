# Beamline Diagnostics 3D Models

**Date:** 2026-04-11
**Scope:** Distinctive 3D models for the four starter diagnostics (BPM, ICT, Screen/YAG, Wire Scanner), footprint resizing for visual variety, role-based materials with per-beamline accent recolor.

## Goal

Replace the generic fallback rendering for the four diagnostic components with hybrid-style 3D models that read as real beamline instrumentation at a glance. Follow the template pattern established by `magnet-3d-models`: role-bucketed meshes, shared materials, per-beamline accent color via `getAccentMaterial`. Resize footprints so size reinforces function — tiny clip-on sensors vs. bulkier actuator-driven devices.

## Non-goals

- No new diagnostic types. Roster stays at the four already defined in `src/data/beamline-components.raw.js:451-530`.
- No gameplay / physics changes. `stats`, `beamQuality`, `energyCost`, `requiredConnections`, `cost`, `unlocked` all untouched.
- No custom pixel textures authored for diagnostics — they use existing `SHARED_MATERIALS` (iron, copper, pipe, stand, detail) plus `getAccentMaterial`.
- Endpoints (Faraday Cup, Beam Stop) are not diagnostics and are out of scope.
- No `InstancedMesh` rewrite — template-and-tint pattern, matching magnets.

## Data changes (`src/data/beamline-components.raw.js`)

Resize footprints of the four diagnostics. Heights (`subH`) unchanged.

| Component | Current `subW × subL` | New `subW × subL` | Rationale |
|---|---|---|---|
| `bpm` | 2 × 1 | **1 × 1** | Button-block clip-on, smallest device |
| `ict` | 2 × 1 | **1 × 1** | Toroidal ring wrapping the pipe |
| `screen` | 2 × 1 | **2 × 1** | Cross chamber + vertical actuator needs room |
| `wireScanner` | 2 × 1 | **3 × 1** | Horizontal side-arm actuator housing |

Legacy `gridW`/`gridH` fields updated in lockstep so any residual code path that reads them stays consistent.

All four remain `placement: 'attachment'`, `unlocked: true`. No category/subsection changes.

## Visual silhouettes

All coordinates in component-local space. Beam axis runs along +Z at `BEAM_HEIGHT = 1.0 m`. Beam pipe radius `PIPE_R = 0.08 m`. Origin at the footprint's floor-level min corner; component length along Z matches `subL × 0.5 m`.

### BPM — 1×1, pipe-mounted, no stand
Accent: **electronics green** (~`0x3a8a4a`).

- Straight beam pipe segment spanning the full 0.5 m length (shared helper).
- Low cylindrical **button block** centered on the pipe: outer R ≈ 0.12 m, length ≈ 0.3 m, role `accent` (green paint).
- **4 button feedthroughs** — short cylinders (R ≈ 0.02 m, L ≈ 0.05 m) protruding at 45° angles (NE/NW/SE/SW in the beam's transverse plane) from the block. Role `detail`.
- One thin **coax tail** (R ≈ 0.015 m, L ≈ 0.1 m) exiting the top of the block. Role `detail`.
- No floor stand. No CF flanges (pipe passes straight through).

### ICT — 1×1, pipe-mounted, no stand
Accent: **copper/bronze** (~`0xb87333`) — though this device uses the shared `copper` role material directly, so the accent slot is unused or set to match.

- Straight beam pipe segment (shared helper).
- **Toroidal ring** centered on the pipe: major R ≈ 0.14 m, minor R ≈ 0.04 m, 16-segment torus. Role `copper`.
- Thin **signal tail** (coax) exiting the top of the torus (R ≈ 0.015 m, L ≈ 0.12 m). Role `detail`.
- No floor stand. No flanges.
- Visually distinct from BPM because it's a *ring wrapping the pipe*, not a *block hugging the pipe*.

### Screen / YAG — 2×1, short stand to floor
Accent: **amber/yellow on actuator** (~`0xd9a21b`).

- Straight beam pipe segment spanning 1.0 m (shared helper).
- **6-way cross chamber** centered on the pipe at the midpoint: short fat cylinder (R ≈ 0.18 m, L ≈ 0.35 m) with the beam passing through end-to-end. Role `pipe`.
- **Vertical pneumatic actuator cylinder** rising from the top of the chamber: R ≈ 0.07 m, H ≈ 0.55 m, sitting directly above the chamber center. Role `accent` (amber).
- **Camera viewport flange** — small cylinder (R ≈ 0.06 m, L ≈ 0.1 m) on the +X side of the chamber. Role `detail`.
- **Short floor stand** — a single rectangular post from floor to chamber underside, centered under the chamber. Role `stand`.
- **CF flanges** at both ends where the cross chamber meets the beam pipe. Role `detail` (shared `FLANGE_COLOR`).

### Wire Scanner — 3×1, short stand to floor
Accent: **safety orange on side-arm** (~`0xe06a2a`).

- Straight beam pipe segment spanning 1.5 m (shared helper).
- **Cross chamber** centered on the pipe at the midpoint: R ≈ 0.16 m, L ≈ 0.3 m, role `pipe`.
- **Horizontal side-arm actuator housing** extending ~1.0 m in the +X direction from the chamber: box geometry ~`0.15 × 0.12 × 1.0` m, role `accent` (orange).
- **Stepper motor block** at the far end of the side-arm: box ~`0.18 × 0.18 × 0.18` m, role `iron`.
- **Short floor stand** under the chamber (same pattern as Screen).
- CF flanges at both chamber ends, role `detail`.

## Architecture

### New file: `src/renderer3d/builders/diagnostic-builder.js`

Keeps `component-builder.js` from growing beyond its already-large 2085-line size.

Exports:
- `buildBPM(def, ctx)` → role-bucketed mesh list
- `buildICT(def, ctx)` → role-bucketed mesh list
- `buildScreen(def, ctx)` → role-bucketed mesh list
- `buildWireScanner(def, ctx)` → role-bucketed mesh list

Each builder follows the same return shape as the existing magnet builders, so the shared merge/tint pipeline in `component-builder.js` can process them without special cases.

### Shared helper

A single helper `buildBeamPipeSegment(subLSubtiles)` inside `diagnostic-builder.js`:
- Returns a straight cylinder of radius `PIPE_R`, length `subLSubtiles × 0.5`, centered at `BEAM_HEIGHT`, aligned along +Z, role `pipe`.
- All four diagnostic builders call this first so the pipe visual is identical across devices. When diagnostics sit end-to-end with other components, the pipe reads as continuous.

### Dispatch registration

In `component-builder.js`, extend the existing component-type → builder dispatch map with the four new entries. Generic fallback no longer fires for these IDs.

## Testing / verification

- Place all four diagnostics on a single beamline in-game and confirm:
  1. Each has a distinctive silhouette recognizable without labels.
  2. Beam pipe reads continuously through every diagnostic (no radius or height mismatch with neighboring drift tubes).
  3. Per-beamline accent recolor works — placing the same device on two beamlines with different accent colors shows both colors correctly.
  4. BPM and ICT have no floor stand; Screen and Wire Scanner do.
  5. Footprints match the new `subW × subL` values (hover outline, demolish outline, placement collision all respect the new size).
- No regression in the existing magnet / drift / RF builders.
- Thumbnails in the build menu render the new models (same lighting path as magnets).

## Open questions

None blocking. Any future additions (insertion-device diagnostics, halo monitors, streak cameras) are separate specs.
