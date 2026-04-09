# Wall Cutaway System Design

## Overview

Sims-style wall visibility system with four modes, controlled via a UI widget in the lower-right of the game view. Allows players to see inside rooms by cutting away, transparenting, or hiding walls.

## Wall Visibility Modes

### Mode 1: Walls Up (default)
All walls fully opaque. Current behavior, no changes needed.

### Mode 2: Cutaway
- Flood-fill from the hovered tile to detect the enclosed "room" (set of tiles bounded by wall edges)
- All walls bordering that room become hidden
- Walls restore when the cursor moves to a different room or leaves the area
- Room detection is cached — only recomputed when `hoverCol`/`hoverRow` changes

### Mode 3: Walls Transparent
- All near-facing walls (both `e` and `s` edges) rendered at ~25% opacity
- Far-facing walls remain fully opaque
- This is a global effect, not cursor-dependent

### Mode 4: Walls Down
- All walls hidden entirely (`wallLayer.visible = false`)

## Room Detection Algorithm

Used only in Cutaway mode.

1. Start from `(hoverCol, hoverRow)`
2. BFS/flood-fill to adjacent tiles in 4 directions (N, S, E, W)
3. A tile transition is blocked if a wall edge exists between the two tiles:
   - Moving east from `(c, r)` → blocked by wall at `(c, r, 'e')`
   - Moving west from `(c, r)` → blocked by wall at `(c-1, r, 'e')`
   - Moving south from `(c, r)` → blocked by wall at `(c, r, 's')`
   - Moving north from `(c, r)` → blocked by wall at `(c, r-1, 's')`
4. Limit flood-fill to a reasonable max (e.g., 500 tiles) to avoid runaway fills in open areas
5. Result: a `Set` of `"col,row"` strings representing tiles in the current room

### Wall-to-Room Matching

A wall at `(col, row, edge)` borders the detected room if:
- `edge === 'e'`: the room contains `(col, row)` or `(col+1, row)`
- `edge === 's'`: the room contains `(col, row)` or `(col, row+1)`

If either neighboring tile is in the room set, that wall is hidden.

## Rendering Changes

### Wall Graphic Registry

Currently `_drawWallEdge` creates a `PIXI.Graphics` and adds it to `wallLayer` with no back-reference. Change to:

- Add `this.wallGraphics = {}` — keyed by `"col,row,edge"`
- `_drawWallEdge` stores each graphic in this map
- `_renderWalls` clears the map when re-rendering

### Alpha Support

- `_drawWallEdge` accepts an optional `alpha` parameter (default 1.0)
- In transparent mode, near-facing walls (`e` and `s` edges) are drawn with `alpha: 0.25`
- In cutaway mode, room-bordering walls get `visible = false`

### Wall Visibility Update

New method `_updateWallVisibility()`:
- Called on hover change (cutaway mode) or mode switch
- Reads current `wallVisibilityMode` and applies:
  - **Walls Up**: all wall graphics `visible = true`, `alpha = 1.0`
  - **Cutaway**: compute room, hide room walls, show others
  - **Transparent**: `e`/`s` edges get `alpha = 0.25`, others stay `1.0`
  - **Walls Down**: `wallLayer.visible = false`

### Performance

- Room detection only runs when hover tile changes (debounced by checking previous hover coords)
- Wall graphics are updated in-place (visibility/alpha toggle), not re-created
- `_renderWalls` is only called on actual wall data changes, not on visibility mode changes

## UI Control

### Position & Layout

- A horizontal row of 4 small square buttons (24x24px each, 2px gap)
- Positioned in the lower-right corner, just above `#bottom-hud`
- Fixed position via CSS, part of a new `#wall-visibility-control` div
- Only visible when `ViewRouter.isGame` is true

### Button Design

Each button contains a simple icon representing its mode:
1. **Walls Up**: solid wall outline (filled rectangle)
2. **Cutaway**: wall with a bite taken out / cursor symbol
3. **Transparent**: dashed/ghosted wall outline
4. **Walls Down**: empty / no-wall icon

Active mode gets a highlight border/background. Buttons use the same visual style as existing HUD controls.

### HTML

```html
<div id="wall-visibility-control">
  <button class="wall-vis-btn active" data-wall-mode="up" title="Walls Up"></button>
  <button class="wall-vis-btn" data-wall-mode="cutaway" title="Cutaway"></button>
  <button class="wall-vis-btn" data-wall-mode="transparent" title="Walls Transparent"></button>
  <button class="wall-vis-btn" data-wall-mode="down" title="Walls Down"></button>
</div>
```

### State

- `renderer.wallVisibilityMode` — one of `'up'`, `'cutaway'`, `'transparent'`, `'down'`
- Defaults to `'up'`
- Mode persists until changed (not reset on view switch)

## Integration Points

### InputHandler
- On mousemove: if mode is `cutaway`, call `renderer._updateWallVisibility()` after updating hover coords
- No new keybindings needed (UI-driven)

### Renderer
- `_renderWalls()`: rebuild wall graphics registry, apply current visibility mode
- `_updateWallVisibility()`: new method, applies mode logic without re-rendering walls
- `updateHover()`: trigger visibility update when in cutaway mode

### Game State
- No changes to `game.state.walls` or `game.state.wallOccupied` — this is purely a rendering/display feature

## Files to Modify

1. `index.html` — add `#wall-visibility-control` div
2. `style.css` — styles for the wall visibility buttons
3. `src/renderer/Renderer.js` — add `wallVisibilityMode`, `wallGraphics`, `_cutawayRoom` state
4. `src/renderer/infrastructure-renderer.js` — modify `_renderWalls`, `_drawWallEdge`, add `_updateWallVisibility`, `_detectRoom`
5. `src/renderer/hud.js` — bind wall visibility button events
6. `src/input/InputHandler.js` — trigger cutaway update on hover (if not already covered by `updateHover`)
