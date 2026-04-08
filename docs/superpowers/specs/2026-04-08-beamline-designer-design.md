# Beamline Designer

## Overview

Rename "Beamline Controller" to "Beamline Designer" and extend it to support two modes:

1. **Edit mode** — opened from a placed beamline (existing behavior). Costs money, confirm applies changes. Adds a "Save as Design" option.
2. **Design mode** — opened from the top bar "Beamline Designer" button. Free sandbox with no cost constraints. Save/load designs to a library.

Additionally: a **Designs** library overlay for browsing saved designs, a **DesignPlacer** for stamping saved designs onto the map, and a **Menu** button replacing "New Game".

## Top Bar Changes

Current: `[resources] [beam-summary] [Research] [Goals] [New Game]`

New: `[resources] [beam-summary] [Beamline Designer] [Designs] [Research] [Goals] [Menu]`

- **Beamline Designer** — opens a blank editor (new design from scratch, design mode)
- **Designs** — opens the Designs library overlay (browse, edit, place, delete saved designs)
- **Menu** — dropdown with: New Game, Save Game, Load Game, Scenarios, Options, Guide

## Saved Designs Data Model

```javascript
// Stored in game.state.savedDesigns[]
{
  id: number,           // unique ID
  name: string,         // player-assigned name
  category: string,     // 'linac' | 'storageRing' | 'fel' | 'synchrotron' | 'collider' | 'other'
  components: [         // ordered list of component snapshots
    {
      type: string,     // component type key
      params: {},       // tuned parameters
    }
  ],
  createdAt: number,    // timestamp
  updatedAt: number,    // timestamp
}
```

Categories for organization:
- Linacs
- Storage Rings
- FEL
- Synchrotrons
- Colliders
- Other

## Designs Library Overlay

Full-screen overlay (same pattern as Research/Goals overlays).

### Layout

- Header with title "Designs" and close button
- Category tabs across the top (Linacs, Storage Rings, FEL, etc.) plus an "All" tab
- Grid of design cards, each showing:
  - Name (editable on click)
  - Component count and total length
  - Estimated cost (sum of component costs)
  - Peak beam energy (from stored physics snapshot, or "—" if not computed)
  - Mini schematic preview (reuse existing schematic drawing logic at thumbnail scale)
- Card actions: **Edit** (opens in designer), **Place** (enters placement mode), **Duplicate**, **Delete**
- "New Design" card at the start of the grid (opens blank designer)

## BeamlineDesigner (renamed ControllerView)

### Rename

All references to "Controller" / "ControllerView" / "Beamline Controller" become "Designer" / "BeamlineDesigner" / "Beamline Designer":
- `ControllerView` class → `BeamlineDesigner`
- `controller-overlay` DOM ID → `designer-overlay`
- `controller-renderer.js` → `designer-renderer.js`
- CSS classes: `ctrl-*` → `dsgn-*`
- HTML element IDs: `ctrl-*` → `dsgn-*`

### Mode Property

```javascript
this.mode = 'edit' | 'design';
```

**Edit mode** (opened from placed beamline):
- Existing behavior: draft edits, cost tracking, confirm/cancel applies to registry
- New: "Save as Design" button in the header bar
- If the beamline grows beyond existing concrete, auto-place foundation on confirm

**Design mode** (opened from top bar or Designs library):
- No `beamlineId` — not tied to a placed beamline
- No cost checks or cost display
- Header shows editable design name (text input) instead of "Beamline Controller"
- "Confirm" button replaced with "Save" (saves to library) and "Save As" (new copy)
- If editing an existing saved design, track `designId` for save-over-original
- "Close" prompts if unsaved changes exist

### Opening from Designs Library

When editing a saved design, `draftNodes` are populated from `design.components` (expanded with full node structure including default params). The designer opens in design mode with `designId` set.

### "Save as Design" Flow (from edit mode)

1. Player clicks "Save as Design"
2. Prompt for design name and category (modal or inline)
3. Snapshot current `draftNodes` (type + params only) into a new saved design
4. Confirm toast: "Design saved: {name}"

## DesignPlacer

New class that handles placing a saved design onto the isometric map.

### Activation

Triggered from the Designs library "Place" button. Closes the Designs overlay and enters placement mode.

### Behavior

1. Mouse cursor shows a transparent preview of all the design's components laid out on the grid
2. Components lay out linearly from the cursor position in the current direction
3. **F** key rotates through 4 isometric directions (NE, SE, SW, NW) — same as existing placement
4. **R** key reflects/mirrors the design (flips bend directions of dipoles)
5. Foundation concrete is auto-shown under any tile that lacks it
6. Total cost displayed near the cursor: component cost + foundation cost
7. Invalid placements highlighted in red (collisions with existing beamlines/structures)
8. **Click** to confirm placement:
   - Check funding >= total cost
   - Deduct cost
   - Place foundation concrete tiles where needed
   - Create new beamline in registry with all components
   - Recalculate beam physics
9. **Escape** cancels placement mode

### Direction & Reflection

The design is stored as a 1D ordered list. At placement time:
- Starting tile + direction determines the layout path
- Each component occupies tiles based on its `trackLength` and `trackWidth`
- Dipoles change direction based on their `bendDir`
- **Reflect** flips all dipole `bendDir` values (left↔right), mirroring the beamline shape

## Menu Button

Replace `btn-new-game` with a `btn-menu` dropdown:

```
Menu ▾
├── New Game
├── Save Game
├── Load Game
├── ─────────
├── Scenarios
├── Options
├── Guide
```

- Clicking "Menu" toggles a dropdown panel
- Clicking outside or pressing Escape closes it
- New Game: existing behavior (confirm dialog → reset)
- Save Game, Load Game, Scenarios, Options, Guide: stub handlers for now (show "Coming soon" toast)

## Auto-Foundation Placement

When confirming edits on a placed beamline (edit mode) or placing a design (DesignPlacer):

1. Compute all tiles the beamline will occupy
2. For each tile, check if foundation concrete exists in `game.state.infrastructure`
3. If not, auto-place the default foundation type (from infrastructure data)
4. Add foundation cost to the total cost shown to the player
5. Foundation tiles are placed into `game.state.infrastructure` on confirm

## File Changes

### New Files
- `src/ui/DesignLibrary.js` — Designs overlay (browse, manage saved designs)
- `src/ui/DesignPlacer.js` — Map placement mode for saved designs
- `src/renderer/design-library-renderer.js` — Card rendering, mini schematics for library

### Renamed Files
- `src/ui/ControllerView.js` → `src/ui/BeamlineDesigner.js`
- `src/renderer/controller-renderer.js` → `src/renderer/designer-renderer.js`

### Modified Files
- `index.html` — rename controller overlay IDs, add Designs overlay HTML, add Menu dropdown, update top bar buttons
- `src/main.js` — update imports, wire new buttons and classes
- `src/game/Game.js` — add `savedDesigns` to state, add save/load design methods, auto-foundation logic
- `src/data/modes.js` — no changes needed (designer uses existing beamline mode categories)
- `src/input/InputHandler.js` — handle DesignPlacer keys (F rotate, R reflect, Escape cancel), update controller references
- `src/renderer/Renderer.js` — update ControllerView references, add design preview layer for placement ghost
- `src/renderer/hud.js` — update button references, add Menu dropdown logic
- `src/renderer/overlays.js` — update ControllerView references
- `src/renderer/beamline-renderer.js` — render placement preview (transparent beamline ghost)
- CSS in `index.html` — rename ctrl-* classes, add designs overlay styles, add menu dropdown styles
