# Beamline Controller View — Design Spec

## Overview

A full-screen 2D "controller" view for inspecting and editing a beamline. Shows the beamline as a left-to-right schematic using existing pixel-art schematic drawers, with synchronized beam dynamics plots below, and the existing component palette at the bottom. All edits happen on a draft copy with live physics updates; changes are only committed (and funding deducted) when the player confirms.

## View Structure

The controller is a full-screen DOM overlay (`#controller-overlay`) divided into three horizontal bands:

### Top Third — Beamline Schematic (~33%)

A wide `<canvas>` element rendering all components left-to-right along the beam axis.

- Each component is drawn using the existing `Renderer.prototype._schematicDrawers` pixel-art renderers (the same graphics shown in component popups and the preview panel).
- Components are spaced proportionally to their `length` property.
- Beam dashes (the green dashed line) connect components, matching the existing schematic style.
- Clicking a component selects it (highlighted border/glow). The selected component is the focus for "at-a-point" plots and editing actions.
- A vertical cursor line on the schematic indicates the selected component position.

### Middle Third — Dynamics Plots (~33%)

Three plot panels arranged side-by-side, each a `<canvas>` with a dropdown selector to choose plot type.

**Along-s plots** (share the schematic's horizontal axis, pan/zoom in sync):
- Beam Envelope (σ_x, σ_y vs s)
- Current & Loss
- Emittance
- Energy & Dispersion
- Peak Current

**At-a-point plots** (render data for the selected component, no horizontal panning):
- Phase Space
- Longitudinal Phase Space

All plots reuse the existing `ProbePlots` renderers. Default layout: two along-s plots + one at-a-point plot. The player can change any panel's plot type via its dropdown.

### Bottom Third — Component Palette & Draft Bar (~33%)

Reuses the existing `#bottom-hud` unchanged:
- Mode switcher (Beamline/Facility tabs relevant to the beamline)
- Category tabs (Sources, Focusing, RF, Diagnostics, etc.)
- Component palette grid

Plus a **draft status bar** above the palette showing:
- Change summary: e.g. "+2 added, 1 removed, 1 replaced"
- Cost delta: net funding cost (green = saving, red = spending)
- **Confirm** button — applies all draft changes, deducts funding, updates isometric map
- **Cancel** button — discards draft, returns to isometric view

## Draft Mode

When the controller opens, it creates a **draft copy** of the beamline's ordered node list. All edits operate on this draft:

- **Replace**: Select a component in the schematic, then click a palette item. The selected component is swapped for the new type in the draft.
- **Insert**: An "Insert Before" / "Insert After" action (button or key) creates a placement marker in the schematic. Clicking a palette item fills it.
- **Remove**: Delete key or remove button removes the selected component from the draft.
- **Reorder**: Drag components in the schematic strip to rearrange order.

Each edit immediately recalculates physics on the draft (calls `BeamPhysics` with the draft lattice) and updates all plots and the schematic live.

### Cost Tracking

The draft status bar continuously shows:
- Items added and their total cost
- Items removed and their refund value (if any)
- Net cost delta

No funding is deducted until Confirm. On Cancel, no changes are applied.

### Exit with Unsaved Changes

If the player exits (Esc, close button, `C` key) with pending draft changes, show a confirmation prompt: "Discard unsaved changes?"

## Pan, Zoom & Navigation

### Shared Viewport

The schematic canvas and all "along-s" plot canvases share a single horizontal viewport state (`viewX`, `viewZoom`). Panning or zooming in any one of them updates all synced canvases together, so component positions in the schematic align vertically with their data points in the plots.

"At-a-point" plots are not synced — they always render data for the currently selected component.

### Controls

| Input | Action |
|-------|--------|
| **A / D** | Pan view left / right |
| **W / S** | Pan view up / down (if content overflows vertically) |
| **Left / Right arrow** | Select previous / next component in beamline |
| **Up / Down arrow** | Move focus across rows (schematic → plots → palette) |
| **Mousewheel / pinch** | Zoom in/out, centered on cursor |
| **Click-drag** (on schematic or along-s plots) | Pan horizontally |
| **Click** (on component in schematic) | Select that component |
| **Delete** | Remove selected component from draft |
| **Esc** or **C** | Exit controller view |

### Zoom Limits

- Minimum zoom: fits the entire beamline in the viewport
- Maximum zoom: shows individual component schematic detail (roughly 1 component filling half the view)

On open, the view auto-fits to show the full beamline.

## Entry & Exit

### Entry Points

1. **BeamlineWindow action**: A "Controller" button added to the BeamlineWindow actions row (alongside Start/Stop Beam, Edit, Rename).
2. **Keyboard shortcut**: `C` key opens the controller for the currently selected beamline. Only available when a beamline is selected (`game.selectedBeamlineId` is set).

### Exit Points

- `Esc` key
- `C` key (toggle)
- Close button (×) in the overlay's top corner
- Confirm button (exits after applying changes)
- Cancel button (exits after discarding changes)

### On Confirm

1. Apply draft node list to the real beamline
2. Deduct net funding cost
3. Recalculate physics on the real beamline
4. Close overlay
5. Emit `beamlineChanged` event so the isometric renderer updates

### On Cancel / Exit without changes

1. Discard draft
2. Close overlay
3. No state changes

## Technical Implementation Notes

### Schematic Rendering

- Create an offscreen canvas per component using `drawSchematic()`, then composite them left-to-right onto the main schematic canvas at positions determined by cumulative `length`.
- The schematic canvas handles its own pan/zoom transform (translate + scale on the 2D context).
- Selection highlight: draw a colored border/glow around the selected component's region.

### Plot Rendering

- Each plot panel is a `<canvas>` element with a `<select>` dropdown overlay for choosing plot type.
- Along-s plots receive the shared viewport transform so their x-axis matches the schematic.
- Reuse `ProbePlots.draw()` for rendering, passing the draft's physics envelope.

### Draft Physics

- On each draft edit, build a temporary lattice description from the draft node list and call `BeamPhysics.simulate()` (or equivalent) to get an updated envelope.
- Store the draft envelope separately from the real beamline's `physicsEnvelope`.
- Throttle recalculation if edits are rapid (debounce ~200ms).

### Existing Code Reuse

| Existing module | Reused for |
|----------------|------------|
| `_schematicDrawers` (overlays.js) | Drawing each component in the schematic strip |
| `drawSchematic()` (overlays.js) | Rendering individual component canvases |
| `ProbePlots` (probe-plots.js) | All dynamics plot rendering |
| `#bottom-hud` (index.html) | Component palette, category tabs, mode switcher |
| `COMPONENTS` (components.js) | Component data, costs, categories |
| `BeamPhysics` (physics.js) | Draft lattice simulation |
| `Beamline.getOrderedComponents()` | Getting the component sequence |

### New Files

- `src/ui/ControllerView.js` — main controller overlay class (DOM setup, draft state, event handling)
- `src/renderer/controller-renderer.js` — schematic canvas rendering, pan/zoom, synchronized viewport
- CSS additions to `style.css` for controller overlay layout
