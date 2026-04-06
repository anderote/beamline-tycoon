# Probe Diagnostics System Design

## Overview

A floating diagnostic probe window that lets the player inspect beam properties at any point on the beamline. Multiple locations can be pinned simultaneously with color-coded flags, and all plots update in real-time as the beamline is modified.

## Entry Point

The existing component popup (triggered by clicking a placed beamline element) gains a **"Probe"** button alongside the existing "Remove" button. Clicking "Probe" does two things:

1. Pins that element as a probe point (color-coded flag appears on the isometric sprite)
2. Opens the floating probe window if not already open

If the probe window is already open, clicking "Probe" on another element just adds a new pin.

## Pin System

### Behavior

- Each pinned element gets the next color from a fixed palette: red (`#f55`), blue (`#5bf`), green (`#5b5`), orange (`#fa5`), purple (`#b5f`), cyan (`#5ff`)
- Maximum 6 simultaneous pins (limited by color distinguishability)
- A small colored flag/marker renders on the isometric sprite of the pinned element
- Unpinning: click the flag on the isometric view, or click the X next to the pin in the probe window legend

### Pin Legend

The probe window header shows all active pins as colored chips: `■ Q3  ■ D2  ■ RF1`. Clicking a chip selects that pin as the "active" one for point-specific plots (phase space, beam profile, etc.).

### Plot Behavior by Type

Plots fall into two categories based on how they handle multiple pins:

**"Along beamline" plots** (x-axis is position `s`): Draw one line per pin color, with a vertical marker at each pin's position. All pins shown simultaneously.
- Beam Envelope (σx, σy vs s)
- Twiss Parameters (βx, βy, αx, αy vs s)
- Dispersion (Dx, Dy vs s)
- Current & Loss Map
- Emittance (εx, εy vs s)

**"At this point" plots** (show data at a single location): Display data for the currently selected pin (highlighted in the legend). Click a different pin chip to switch.
- Phase Space Ellipses (x vs x', y vs y')
- Transverse Beam Profile (x vs y heatmap)
- Longitudinal Phase Space (dt vs dE/E)
- Energy Distribution (dE/E histogram)
- Summary Stats Card

## Floating Window

### Layout

- **Title bar**: "Probe" label + pin legend chips + minimize (−) and close (×) buttons
- **Grid area**: Configurable grid of plot cells
- **Controls**: Layout selector (1×1, 2×1, 1×2, 2×2, 3×2) and "+ Add Plot" button in title bar

### Behavior

- Draggable by title bar
- Resizable from edges and corners
- Minimize collapses to a small floating bar showing just the title and pin count
- Close unpins all points and closes the window
- Position, size, grid layout, and selected plot types persist in game save state

### Grid Cells

- Each cell has a small dropdown/selector in its top-left corner to pick the plot type
- Empty cells show a dashed border with "+ Add Plot" — clicking opens the plot type picker
- Cells can be cleared (reverts to empty) via an X button in the cell corner
- Default starting layout: 2×2 grid with Phase Space, Beam Envelope, Summary Stats, and one empty cell

## Plot Types

### 1. Phase Space Ellipses

- **Data**: 2×2 submatrices of the 6×6 covariance matrix at the selected pin
- **Rendering**: Two ellipses side by side — (x, x') and (y, y') — drawn on Canvas 2D
- **Axes**: x/y in mm, x'/y' in mrad
- **Color**: Ellipse outline color matches selected pin color
- **Labels**: Emittance value displayed as text annotation on each ellipse

### 2. Beam Envelope

- **Data**: `physicsEnvelope[i].sigma_x` and `physicsEnvelope[i].sigma_y` for all elements
- **Rendering**: Line plot, σx solid, σy dashed. One pair of lines per pin color.
- **Axes**: Element index (or cumulative length `s`) vs beam size in mm
- **Markers**: Vertical line at each pin's position, color-matched

### 3. Twiss Parameters (Beta Functions)

- **Data**: Derived from covariance matrix — β = σ² / ε, α = -σσ' / ε
- **Rendering**: Line plot of βx, βy (and optionally αx, αy) vs position
- **Axes**: Position `s` vs beta in meters, alpha dimensionless
- **Note**: Requires exposing Twiss parameters per element from the Python physics engine

### 4. Dispersion Function

- **Data**: Dx, Dy vs position — requires propagating an off-energy reference particle or extracting from the transfer matrix
- **Rendering**: Line plot, Dx solid, Dy dashed
- **Axes**: Position `s` vs dispersion in meters
- **Note**: New physics computation needed — propagate with δp/p offset and compare to on-energy orbit

### 5. Energy Distribution

- **Data**: Energy spread σ_E (from covariance matrix element σ_55) at the selected pin
- **Rendering**: Gaussian histogram centered at reference energy, width = σ_E
- **Axes**: Energy (GeV) vs relative intensity
- **Color**: Matches selected pin color

### 6. Longitudinal Phase Space

- **Data**: (dt, dE/E) 2×2 submatrix of covariance at selected pin
- **Rendering**: Ellipse plot similar to transverse phase space
- **Axes**: dt in ps, dE/E in parts per thousand
- **Color**: Ellipse outline matches selected pin color

### 7. Transverse Beam Profile

- **Data**: σx, σy, and xy correlation from covariance matrix at selected pin
- **Rendering**: 2D Gaussian heatmap on Canvas — evaluate `exp(-0.5 * r^T Σ^{-1} r)` on a pixel grid
- **Axes**: x in mm, y in mm
- **Color map**: Intensity-based (e.g., viridis or hot colormap)
- **Annotation**: σx and σy values as text overlay

### 8. Current & Loss Map

- **Data**: `physicsEnvelope[i].current` for all elements
- **Rendering**: Line plot of current vs position. Regions where current drops are shaded red.
- **Axes**: Position `s` vs current in mA
- **Markers**: Vertical lines at pin positions, color-matched
- **Enhancement over global version**: Shade loss regions and annotate loss mechanism if available (aperture, scattering, etc.)

### 9. Emittance Along Beamline

- **Data**: Geometric emittance εx, εy per element (derived from covariance), and normalized emittance (ε_n = βγ · ε)
- **Rendering**: Line plot, geometric solid, normalized dashed
- **Axes**: Position `s` vs emittance in mm·mrad (geometric) or μm (normalized)
- **Markers**: Vertical lines at pin positions

### 10. Summary Stats Card

- **Data**: All beam parameters at the selected pin's element
- **Rendering**: DOM-based numeric readout (not canvas), styled as an instrument panel
- **Fields displayed**:
  - Energy (GeV)
  - Current (mA)
  - σx, σy (mm)
  - εx, εy geometric (mm·mrad)
  - εx, εy normalized (μm)
  - Energy spread σ_E (%)
  - Bunch length σ_t (ps)
  - βx, βy (m)
  - αx, αy
- **Color**: Header bar matches selected pin color

## Physics Engine Changes

The current Python physics engine computes the full 6×6 covariance matrix per element but only exposes `sigma_x`, `sigma_y`, `energy`, and `current` in the envelope array returned to JavaScript. To support all plot types, the envelope output must be expanded.

### New per-element fields in `physicsEnvelope`

```python
{
    # Existing
    "sigma_x": float,       # mm
    "sigma_y": float,       # mm
    "energy": float,        # GeV
    "current": float,       # mA
    "element_index": int,
    "element_type": str,
    "alive": bool,

    # New — covariance submatrices
    "cov_xx": float,        # <x²>
    "cov_xxp": float,       # <x·x'>
    "cov_xpxp": float,      # <x'²>
    "cov_yy": float,        # <y²>
    "cov_yyp": float,       # <y·y'>
    "cov_ypyp": float,      # <y'²>
    "cov_tt": float,        # <t²>  (bunch length squared)
    "cov_tdE": float,       # <t·dE/E>
    "cov_dEdE": float,      # <(dE/E)²>
    "cov_xy": float,        # <x·y> (coupling term)

    # New — derived Twiss parameters
    "beta_x": float,        # m
    "beta_y": float,        # m
    "alpha_x": float,       # dimensionless
    "alpha_y": float,       # dimensionless
    "emit_x": float,        # geometric emittance, mm·mrad
    "emit_y": float,        # geometric emittance, mm·mrad
    "emit_nx": float,       # normalized emittance, μm
    "emit_ny": float,       # normalized emittance, μm
    "energy_spread": float, # σ_{dE/E}
    "bunch_length": float,  # σ_t in ps

    # New — dispersion (if computable)
    "disp_x": float,        # m
    "disp_y": float,        # m

    # New — cumulative path length
    "s": float              # cumulative position in meters
}
```

### Dispersion Computation

Dispersion requires either:
- **Option A**: Propagate the 6×6 matrix and extract dispersion from the (x, dE/E) correlation: D_x = σ_{x,δ} / σ_{δ,δ}
- **Option B**: Propagate an off-energy reference particle (δp/p = 0.001) alongside the on-energy one, dispersion = Δx / δp

Option A is preferred since we already have the full covariance matrix.

## Real-Time Update Flow

```
Player modifies beamline (add/remove/move component)
  → game.recalcBeamline()
    → BeamPhysics.compute() returns expanded envelope
      → game.state.physicsEnvelope updated
        → game emits 'beamlineChanged' event
          → ProbeWindow listens, re-renders all visible plot cells
```

No polling. Same event-driven mechanism the existing global diagnostics panel uses. The probe window subscribes to `beamlineChanged` and redraws only the plots currently visible in the grid.

## Game State Persistence

The probe window state is saved as part of the game save:

```javascript
state.probe = {
    open: true,
    x: 400, y: 200,           // window position
    width: 600, height: 400,   // window size
    gridLayout: [2, 2],        // columns, rows
    cells: [                   // plot assignments per cell
        { type: "phase-space" },
        { type: "beam-envelope" },
        { type: "summary-card" },
        { type: null }         // empty cell
    ],
    pins: [
        { elementId: "q3", color: "#f55" },
        { elementId: "d2", color: "#5bf" }
    ],
    activePin: 0               // index into pins array
};
```

## Module Structure

- **`probe.js`** — ProbeWindow class: floating window DOM, grid management, pin state, event wiring
- **`probe-plots.js`** — Individual plot renderers: one function per plot type, each takes a canvas context + data + pin colors and draws
- Changes to **`renderer.js`** — Render pin flags on isometric sprites
- Changes to **`game.js`** — Store/restore probe state, expose expanded envelope data
- Changes to **`beam_physics/gameplay.py`** — Expand envelope output with covariance, Twiss, dispersion, cumulative s
