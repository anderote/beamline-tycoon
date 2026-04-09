# Beamline Component Sub-tile Sizing

Replaces the whole-tile `trackLength`/`trackWidth`/`length` system with sub-unit dimensions (`subL`/`subW`) for beamline components. Components pack tightly along the beam axis, can span tile boundaries, and their physics length is derived directly from their visual size.

## Sub-unit Grid Model

Each beamline component has `subL` (length along beam in sub-units) and `subW` (width perpendicular to beam in sub-units). 1 sub-unit = 50cm. These replace the old `trackLength`, `trackWidth`, and `length` fields.

Components pack end-to-end along the beam with no gaps. They can span tile boundaries — a 12-sub-unit RFQ starting at sub-unit 2 of a tile occupies parts of 3 tiles.

### Width rules

The source is 1 tile wide (4 sub-units). The beam exits from the center, 2 sub-units wide. Components are always centered on the beam axis.

- Beam pipe / quad / corrector / BPM: `subW: 2` — just the pipe, leaving 1 sub-unit margin on each side within the tile row for furnishings/equipment
- RFQ / small cavity: `subW: 3-4` — fills most or all of the tile width
- Cryomodule / large structures: `subW: 4-6` — can spill into adjacent tile rows
- Source: `subW: 4` — full tile width

### Length examples

| Component | subL | subW | Length | Width |
|---|---|---|---|---|
| Source | 4 | 4 | 2m | 2m |
| Beam Pipe (drift) | 4 | 2 | 2m | 1m |
| Quadrupole | 2 | 2 | 1m | 1m |
| Sextupole | 2 | 2 | 1m | 1m |
| Corrector | 1 | 2 | 0.5m | 1m |
| BPM | 1 | 2 | 0.5m | 1m |
| Screen / Wire Scanner | 1 | 2 | 0.5m | 1m |
| Dipole | 6 | 3 | 3m | 1.5m |
| RFQ | 12 | 4 | 6m | 2m |
| DTL | 16 | 4 | 8m | 2m |
| SRF Cavity | 8 | 4 | 4m | 2m |
| Cryomodule | 16 | 6 | 8m | 3m |
| Solenoid | 3 | 3 | 1.5m | 1.5m |
| Undulator | 10 | 3 | 5m | 1.5m |
| Collimator | 2 | 2 | 1m | 1m |
| Target | 2 | 3 | 1m | 1.5m |

All other components follow the same pattern — diagnostics and small elements are 1-2 subL, focusing magnets 2-3, accelerating structures 8-16.

## Packing and Tile Occupancy

Components pack tightly along the beam axis with no gaps. A component's position along the beam is determined by the sum of all preceding component lengths.

When a component spans a tile boundary, it occupies sub-units in multiple tiles. For example, a 12-sub-unit RFQ starting at sub-unit 2 of tile 3:
- Tile 3: sub-units 2-3
- Tile 4: sub-units 0-3
- Tile 5: sub-units 0-1

Width occupancy works the same way. A `subW: 6` cryomodule centered on the beam in a single tile row spills 1 sub-unit into the adjacent tile row on each side.

The existing tile occupancy system checks which sub-units within each tile are taken by beamline components. The 1-sub-unit margins on either side of a narrow beam pipe are available for furnishings and equipment placement.

## Physics Integration

### Beam position model

Each component stores `beamStart` — its position in meters from the source of its beamline, computed as the running sum of all preceding component lengths within that beamline. Physics length = `subL * 0.5` meters. The old `length` field is removed.

### 1000-point sampling

The physics sim evaluates beam state at 1000 evenly-spaced points along the total beamline length. For each sample point at position `s`:

1. Find which component contains `s` (binary search on `beamStart` values)
2. Compute fractional position within that component: `t = (s - comp.beamStart) / (comp.subL * 0.5)`
3. Apply the component's effect at that fractional position

### Component effects along their length

- **Drift:** identity transform, beam propagates freely
- **Quadrupole:** uniform gradient applied as thick-lens (integrated over actual length)
- **Dipole:** uniform bend field, curvature applied incrementally
- **RF cavities (RFQ, SRF, etc.):** energy gain distributed along length, phase advance per cell
- **Diagnostics (BPM, screen):** point-like measurement at center position

### Recomputation

The 1000-point beam state array is recomputed whenever the beamline layout changes. The designer cursor indexes into this array for envelope plots.

## Beamline Designer

The designer stackup view is unchanged — schematic blocks with equal width per component, not proportional to physical length. It is a functional block diagram.

The cursor position maps to beam position `s` in meters. Envelope plots use real meters on the x-axis with 1000 sample points. Component boundaries are drawn as vertical lines at their `beamStart` positions on the plots.

## Asset Pipeline

Component sprite dimensions are derived from the sub-unit footprint, same pattern as furnishings.

### Pixel math

A sub-unit is `TILE_W/4 × TILE_H/4` = 16×8 iso pixels. A component with `subL: 12, subW: 4` gets a floor footprint of 192×32 iso pixels plus height allowance for the 3D object.

### Catalog changes

The `tools/asset-gen/server.cjs` catalog builder parses `subL` and `subW` from component definitions and computes `spritePixelW`/`spritePixelH` per component, same as furnishings.

### Sprite orientation

Sprites are generated facing one canonical direction (NE). The renderer rotates/flips based on the beam direction at that point in the beamline.

## Data Model Migration

All entries in `COMPONENTS` (components.js):

**Remove:** `trackLength`, `trackWidth`, `length`

**Add:** `subL`, `subW`

The physics length is derived: `physicsLength = subL * 0.5` meters. No separate length field.

All references to `trackLength`, `trackWidth`, and `length` across the codebase (physics sim, renderer, input handler, designer) are updated to use `subL` and `subW`.
