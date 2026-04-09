# FODO Focus Advisor — Design Spec

**Date:** 2026-04-08
**Scope:** Beamline Designer view only

## Problem

Players struggle to design proper FODO focusing lattices. There's no guidance on where to place quadrupoles, how quad strength relates to spacing, or how beam energy affects focusing requirements. The result is beamlines that lose beam quality because focusing is wrong.

## Solution

A hybrid Python+JS focus advisor that:
1. Python computes **focus margin** and **focus urgency** per envelope snapshot (using real beta functions already computed)
2. JS renders **envelope color bands** showing focus health
3. JS places **ghost quad markers** at positions where focusing is needed

## Component Length Changes (prerequisite, already implemented)

Magnets and sources shortened to realistic proportions so FODO cells have room for payload:

| Component | Old length (tiles) | New length (tiles) | Physical (m) |
|---|---|---|---|
| quadrupole | 2 | 1 | 3 |
| sextupole | 2 | 1 | 3 |
| combinedFunction | 2 | 1 | 3 |
| protonQuad | 2 | 1 | 3 |
| source | 2 | 1 | 3 |
| dcPhotoGun | 2 | 1 | 3 |
| ncRfGun | 2 | 1 | 3 |
| srfGun | 3 | 2 | 6 |
| ionSource | 2 | 1 | 3 |
| rfCavity | 4 | 3 | 9 |
| buncher | 2 | 1 | 3 |
| collimator | 2 | 1 | 3 |
| septumMagnet | 2 | 1 | 3 |

Both `src/data/components.js` (length + trackLength) and `beam_physics/gameplay.py` (COMPONENT_DEFAULTS) updated in sync.

## Section 1: Python Focus Margin Computation

### New snapshot fields in `beam_physics/lattice.py`

Add two fields to each snapshot's `extra` dict:

**`focus_margin`** — how much room the beam has before hitting the aperture:
```
focus_margin = 1.0 - (max(sigma_x, sigma_y) / aperture_radius)
```
- 1.0 = beam tiny relative to aperture
- 0.0 = beam fills aperture
- < 0 = beam exceeds aperture

**`focus_urgency`** — how soon the beam needs focusing, accounting for divergence rate:
```
meters_to_loss = (aperture - max_sigma) / max_divergence_rate
focus_urgency = clamp(1.0 - meters_to_loss / reference_scale, 0, 1)
```

Where `reference_scale` is the max stable half-cell length at the current energy, estimated as `reference_scale = sqrt(2 * f)` with `f = p / (q * G * ℓ)` using a default quad gradient G=20 T/m and length ℓ=3m. This scales naturally with energy — higher energy beams tolerate longer cells. The divergence rate is estimated from the difference between consecutive snapshots' beam sizes divided by the s-step between them.

### Changes to `beam_physics/gameplay.py`

Pass `focus_margin` and `focus_urgency` through in the envelope array mapping (same pattern as existing `eta_x`, `eta_xp` fields).

## Section 2: Envelope Color Bands

### In `src/renderer/designer-renderer.js`

Draw filled rectangle strips behind the envelope plot, colored by `focus_margin`:

| Margin range | Color | Meaning |
|---|---|---|
| > 0.6 | Green (alpha 0.15) | Well-focused |
| 0.3–0.6 | Yellow (alpha 0.15) | Growing, will need focus soon |
| 0.0–0.3 | Orange (alpha 0.15) | Approaching aperture limit |
| ≤ 0.0 | Red (alpha 0.15) | Exceeding aperture, losing particles |

Rendered as continuous strips spanning the full vertical height of the envelope plot, drawn before (behind) the existing envelope lines. Always visible in designer view — no toggle needed.

## Section 3: Ghost Quad Markers

### Computation in `src/ui/BeamlineDesigner.js`

After physics recompute, scan the envelope for focus advisory positions:

1. Walk envelope snapshots sequentially
2. When `focus_urgency` first exceeds 0.7, record the s-position
3. Check if an existing quad is within ~1 cell length ahead — if so, skip (no ghost needed)
4. Map s-position back to a node index in `draftNodes` — ghost appears between the two nearest components
5. Determine suggested polarity by alternating from the last real quad upstream

Ghost positions update live when:
- Player adds/removes/reorders components
- Player adjusts a quad's gradient slider (stronger quad → next ghost moves further away)
- Physics recomputes for any reason

### Rendering in `src/renderer/designer-renderer.js`

- Semi-transparent quad sprite (existing sprite, alpha 0.3) at the suggested schematic position
- Small label: "F" or "D" for suggested polarity (Focus X or Focus Y)

### Interaction in `src/ui/BeamlineDesigner.js`

- Clicking a ghost marker activates insert mode at that position, with the component palette pre-filtered to focusing magnets
- Ghosts are purely advisory — no gameplay penalty for ignoring them

### Edge cases

- No ghosts before the first quad (source region uses solenoid focusing)
- No ghosts after the last element
- If no quads exist at all, show ghosts using a default assumption (normal-conducting quad at default gradient)

## Section 4: Data Flow

```
Player edits draft
  → BeamlineDesigner._recomputePhysics()
  → Python propagate() computes focus_margin + focus_urgency per snapshot
  → physics_to_game() passes them through in envelope array
  → JS receives envelope with new fields
  → designer-renderer draws envelope color bands (behind envelope lines)
  → BeamlineDesigner scans urgency array to compute ghost positions
  → designer-renderer draws ghost quad markers
  → Player clicks ghost → insert mode at that position, palette filtered to focusing
```

## Files Changed

| File | Change |
|---|---|
| `beam_physics/lattice.py` | Add focus_margin, focus_urgency to snapshot extra fields |
| `beam_physics/gameplay.py` | Pass new fields through envelope mapping |
| `src/renderer/designer-renderer.js` | Envelope color bands + ghost marker rendering |
| `src/ui/BeamlineDesigner.js` | Ghost position computation, ghost click handler |

## Files NOT Changed

- Game view / main renderer — designer only
- Physics modules — using existing beta/sigma data
- UI panels — no new controls needed
- Component data — already updated (lengths)
