# Isometric Beamline UI Redesign

**Date:** 2026-04-06
**Status:** Draft

## Overview

Redesign the Beamline Cowboy game from a top-down grid-based UI to an isometric RollerCoaster Tycoon-style view where players build beamlines like roller coaster tracks — placing segments one by one, bending with dipoles, and managing a growing particle physics facility.

## Visual Style

- **Isometric pixel art** in the style of RollerCoaster Tycoon Classic (mid-90s isometric sim aesthetic)
- **Fixed isometric camera angle** (no rotation), smooth continuous zoom
- **PixelLab** generates all component sprites via MCP in a consistent isometric style
- **Three levels of detail** driven by zoom:
  - **Far (facility view):** Simple colored isometric blocks, beam as thin glowing line
  - **Mid (working view):** Distinctive component shapes (coils, cavities, etc.), pulsing beam ribbon, tiny scientist figures visible
  - **Close (detail view):** Interior cutaways with scientists at consoles, flowing particles, sparking RF cavities, animated particle effects

## Layout

- **Top resource bar:** Game title + resource counters (Funding, Energy, Reputation, Research Data) — always visible
- **Main isometric viewport:** Full-screen minus HUD areas. Grass terrain with isometric diamond grid. Concrete pads rendered under beamline sections.
- **Minimap (top-right corner):** Shows full facility layout with beamline path. Blue rectangle indicates current viewport. Click to jump.
- **Bottom HUD:**
  - Beam stats row: beam on/off status, energy, current, luminosity, length
  - Category tabs: Sources, Magnets, RF/Accel, Diagnostics, Beam Optics, plus Research and Goals buttons
  - Scrollable component palette showing isometric preview thumbnails, with locked components greyed out

## Track-Laying Mechanics

The beamline is built segment by segment from a source, similar to how RCT builds roller coaster track:

- The beamline starts from a **source** component that the player freely places anywhere on the isometric grid. The source determines the initial beam direction (defaulting to NE, player can rotate before placing).
- A **construction cursor** (dashed blue isometric diamond) appears at the end of the current beamline, with a direction arrow showing where the next segment will attach.
- Each segment has a **direction** (NE, SE, SW, NW in isometric space).
- **Drifts** (beam pipe) continue straight in the current direction. They are the equivalent of straight track.
- **Dipoles** bend the beam 90° left or right (player chooses). This changes the construction direction. They are the equivalent of curved track.
- **All other components** (quadrupoles, RF cavities, detectors, undulators, etc.) continue straight and occupy 1–3 grid tiles along the current direction.
- **Splitters** fork the beamline into two independent paths, each buildable separately.
- The player can **close a loop** by routing the beam back to connect near the source (creating a storage ring), or terminate the beamline at a **target** or **detector**.
- Click a placed component to select it and see its stats in a popup detail card. Right-click or delete key to remove (partial cost refund).

## Navigation & Controls

- **Pan:** Click-drag on viewport, or arrow keys / WASD
- **Zoom:** Scroll wheel, smooth continuous
- **Minimap click:** Jump viewport to that location
- **Click empty construction cursor:** Place currently selected component from the palette
- **Click placed component:** Open popup detail card (stats, upgrade options, remove)
- **Tab:** Cycle component category tabs
- **Spacebar:** Toggle beam on/off
- **R:** Open research overlay panel
- **G:** Open goals overlay panel
- **Esc:** Close any open overlay or popup

## Rendering Technology

- **PixiJS** as the 2D WebGL renderer (falls back to Canvas)
  - Sprite-based rendering for all isometric elements
  - Built-in particle system for sparks, glow effects, beam particles
  - Container hierarchy for zoom/pan (PixiJS viewport)
  - Efficient sprite batching for large beamlines
- **PixelLab MCP** for generating isometric pixel art sprites
  - Each of the 14 component types gets sprites at 2–3 detail levels
  - Consistent RCT-style isometric perspective across all assets
  - Scientists/character sprites for facility life (Phase 3)

## Beam Visualization

- **Far zoom:** Thin glowing green line following the beamline path
- **Mid zoom:** Pulsing ribbon that flows through beam pipes, changing intensity based on beam current
- **Close zoom:** Individual particle dots flowing through pipes, speeding up through RF cavities, spreading through drifts. PixiJS particle emitter for effects.

## Architecture

### What stays

- **`game.js`** — Core game loop, resource management, research tree, objective tracking, event emitter system. Minor updates to replace grid placement calls with path-based ones.
- **`physics.js` and `beam_physics/`** — Entirely untouched. The physics engine takes an ordered list of components and propagates beam state through transfer matrices. It has no knowledge of spatial layout.
- **`data.js`** — Component definitions, research tree, objectives. Updated to replace grid sizes (w/h) with `track_length` (tiles along path), add `bend_angle` for dipoles, add sprite asset references.

### What's replaced

- **`ui.js`** (563 lines) — Fully replaced by `renderer.js`, a new PixiJS-based isometric renderer. The current DOM grid rendering, canvas overlay beam drawing, toolbar building, and tab management all get rebuilt for the isometric view.

### What's new

- **`renderer.js`** — PixiJS isometric renderer. Handles: grid rendering, component sprite placement, beam visualization, zoom/pan, minimap, HUD overlay, popup cards, construction cursor.
- **`beamline.js`** — Replaces the grid-based placement model. Models the beamline as a directed graph: nodes are components with grid position + direction, edges connect sequential segments. Dipoles create direction-changing edges. Splitters create branching edges. Provides the ordered component list that `physics.js` consumes.
- **`sprites.js`** — Sprite asset manager. Loads PixelLab-generated sprite sheets, manages LOD switching based on zoom level, provides sprite factories for each component type.
- **`input.js`** — Input handler for keyboard (WASD, arrow keys, hotkeys) and mouse (click, drag, scroll) events. Translates screen coordinates to isometric grid coordinates.

### Data flow

1. Player places component via input → `input.js` translates to grid position
2. `beamline.js` validates placement and updates the directed graph
3. `game.js` receives placement event, deducts resources, triggers `recalcBeamline()`
4. `game.js` gets ordered component list from `beamline.js`, passes to `physics.js`
5. `physics.js` runs beam propagation via Pyodide, returns results
6. `game.js` updates state (energy, luminosity, etc.), emits events
7. `renderer.js` listens for events, updates sprites, beam glow, HUD values

## Phase Breakdown

### Phase 1 — Core Isometric Beamline Builder

- PixiJS isometric renderer with smooth zoom and pan
- Isometric grid with grass terrain rendering
- Track-laying system: place components segment by segment, dipoles bend direction
- PixelLab-generated isometric sprites for all 14 component types (far + mid detail levels)
- Beam visualization: glowing line (far), pulsing ribbon (mid)
- Bottom HUD with resource bar, category tabs, scrollable component palette
- Minimap with viewport indicator and click-to-jump
- Keyboard navigation (arrows/WASD) and mouse interaction (click, drag, scroll)
- All existing gameplay preserved: resources, research tree, objectives, beam physics
- Construction cursor with direction indicator
- Component detail popup cards on click
- Splitter support for branching beamlines
- Loop closure detection for storage rings

### Phase 2 — Buildings & Enclosures

- Accelerator tunnel/hall structures that visually enclose beamline sections
- Functional buildings: control rooms (boost research speed), power stations (reduce energy cost)
- Decorative elements: concrete pads, roads, fences, landscaping, trees
- Close-up detail sprites with interior cutaway views
- Building placement on the isometric grid (separate from beamline track)

### Phase 3 — Scientists & Facility Life

- Scientist character sprites with walking path AI between buildings and beamline components
- Scientist types (operators, researchers, engineers) with gameplay effects
- Visitor center building (reputation generation)
- Animated component interiors with scientists at consoles when zoomed in close
- Full particle effects: sparks bouncing off RF cavities, beam glow pulses, radiation shimmer on undulators
