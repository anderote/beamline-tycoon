// src/input/structure-tools.js
//
// Tool objects for the grid/structure placement families:
//
//   - FloorTool: infrastructure flooring / surfaces. Three placement styles
//     driven by the FLOORS def: click (single tile), drag-rect
//     (isDragPlacement, with live cost tooltip), and L-shaped line
//     (isLinePlacement, hallways). F toggles texture orientation on
//     orientable floors; Space places a single tile at the hover cursor.
//   - WallTool: edge-based wall drawing. Drag draws a straight run along
//     the start edge's axis. Shift-hover/click outlines a contiguous floor
//     region, or follows the straight interface between different floors;
//     Shift-drag switches back to a free straight run anywhere.
//   - DoorTool: edge-based door drawing, preferring edges that carry walls.
//   - WindowTool: edge-based window drawing, a direct mirror of DoorTool.
//     Windows never touch state.doorOccupied — placement/removal and the
//     passability map stay entirely separate from doors (see
//     docs/superpowers/specs/2026-08-13-windows-design.md).
//
// These replaced the legacy per-family floor/wall/door selection fields
// and their drawing-state webs (isDragging /
// isDrawingLine / isDrawingWall / isDrawingDoor / _shiftWallPending etc.),
// which are now tool-local. Behavior is intentionally identical to the
// legacy branches; geometry helpers (_buildLPath, _buildWallLine,
// _getNearestFloorEdge, _buildFloorBoundaryPath, ...) stay on InputHandler
// because the demolish family shares them.

import { Tool } from './Tool.js';
import { FLOOR_INTERFACE_HOVER_THRESHOLD } from './floor-wall-paths.js';
import { FLOORS, WALL_TYPES, DOOR_TYPES, WINDOW_TYPES, WALL_PAINTS } from '../data/structure.js';
import { doorOffFromFrac, findWallKey, findEdgeKey } from '../game/edge-keys.js';
import { canAffordFunding } from '../game/affordability.js';
import { isoToGrid } from '../renderer/grid.js';

export class FloorTool extends Tool {
  constructor(floorType, variant = 0) {
    super(`floor:${floorType}`, 'floor');
    this.floorType = floorType;
    this.variant = variant;
    // F-key texture override for orientable floors: null=auto, 0=horiz, 1=vert
    this.orientationOverride = null;
    this._dragging = false;
    this._dragStart = null; // { col, row }
    this._dragEnd = null;   // { col, row }
    this._drawingLine = false;
    this._lineStart = null; // { col, row }
    this._linePath = [];
  }

  _def() { return FLOORS[this.floorType]; }

  onEnter(ctx) {
    // Legacy selectInfraTool always dropped any in-flight drag preview.
    ctx.renderer.clearDragPreview();
  }

  onExit(ctx) {
    this._dragging = false;
    this._dragStart = null;
    this._dragEnd = null;
    this._drawingLine = false;
    this._lineStart = null;
    this._linePath = [];
    ctx.renderer.clearDragPreview();
    ctx.input._hideDragCostTooltip();
  }

  _showRectCost(ctx, e, c0, r0, c1, r1) {
    const infra = this._def();
    const cost = ctx.game.computeInfraRectCost(c0, r0, c1, r1, this.floorType, this.variant);
    ctx.input._showDragCostTooltip(cost.totalCost, e.clientX, e.clientY, {
      skippedNoFoundation: cost.skippedNoFoundation,
      foundationName: infra?.requiresFoundation
        ? (FLOORS[infra.requiresFoundation]?.name || infra.requiresFoundation)
        : null,
      insufficientFunding: !canAffordFunding(ctx.game, cost.totalCost),
    });
  }

  onMouseDown(e, ctx) {
    if (e.button !== 0) return false;
    const infra = this._def();
    if (!infra) return false;
    const world = ctx.renderer.screenToWorld(e.clientX, e.clientY);
    const grid = isoToGrid(world.x, world.y);
    if (infra.isLinePlacement) {
      this._drawingLine = true;
      this._lineStart = { col: grid.col, row: grid.row };
      this._linePath = [{ col: grid.col, row: grid.row }];
      ctx.renderer.renderLinePreview(this._linePath, this.floorType);
      return true;
    }
    if (infra.isDragPlacement) {
      this._dragging = true;
      this._dragStart = { col: grid.col, row: grid.row };
      this._dragEnd = { col: grid.col, row: grid.row };
      ctx.renderer.renderDragPreview(grid.col, grid.row, grid.col, grid.row, this.floorType);
      this._showRectCost(ctx, e, grid.col, grid.row, grid.col, grid.row);
      return true;
    }
    // Click-place floors commit on click (mouseup → onClick).
    return false;
  }

  onMouseMove(e, ctx) {
    const input = ctx.input;
    const renderer = ctx.renderer;
    const world = renderer.screenToWorld(e.clientX, e.clientY);
    const grid = isoToGrid(world.x, world.y);
    if (this._dragging && this._dragStart) {
      this._dragEnd = { col: grid.col, row: grid.row };
      renderer.renderDragPreview(
        this._dragStart.col, this._dragStart.row,
        grid.col, grid.row, this.floorType,
      );
      this._showRectCost(ctx, e, this._dragStart.col, this._dragStart.row, grid.col, grid.row);
      return true;
    }
    if (this._drawingLine) {
      this._linePath = input._buildLPath(this._lineStart || this._linePath[0], grid);
      renderer.renderLinePreview(this._linePath, this.floorType);
      const infra = this._def();
      const lineCost = ctx.game.computeInfraLineCost(this._linePath, this.floorType, this.variant);
      input._showDragCostTooltip(lineCost.totalCost, e.clientX, e.clientY, {
        skippedNoFoundation: lineCost.skippedNoFoundation,
        foundationName: infra?.requiresFoundation
          ? (FLOORS[infra.requiresFoundation]?.name || infra.requiresFoundation)
          : null,
        insufficientFunding: !canAffordFunding(ctx.game, lineCost.totalCost),
      });
      return true;
    }
    // Hover: cross cursor tinted with the floor color.
    renderer.updateHover(grid.col, grid.row);
    const infra = this._def();
    renderer.renderInfraHoverCursor(grid.col, grid.row, infra?.topColor || 0xffffff);
    input.lastMouseWorldX = world.x;
    input.lastMouseWorldY = world.y;
    input._lastScreenX = e.clientX;
    input._lastScreenY = e.clientY;
    // The legacy tooltip guard suppressed hover tooltips while an infra
    // tool was armed — keep that.
    if (input._hoverTooltipTarget) input._hideTooltip();
    return true;
  }

  // Off-canvas release / focus loss: drop the drag without committing.
  cancelGesture(ctx) { this.onExit(ctx); }

  onMouseUp(e, ctx) {
    // Only the left button commits a drag (onMouseDown guards `e.button !== 0`;
    // onMouseUp did not, so a right release mid-drag fired the commit early
    // and swallowed right-click-to-deselect).
    if (e.button !== 0) return false;
    const game = ctx.game;
    if (this._drawingLine && this._linePath.length > 0) {
      // _batchEvents: each tile can clear a decoration, and every removal
      // emits 'placeableChanged' (a full renderer decoration rebuild) —
      // coalesce the whole line into one dispatch, like the rect sweep.
      game._withUndo(() => game._batchEvents(() => {
        for (const pt of this._linePath) {
          game.placeInfraTile(pt.col, pt.row, this.floorType, this.variant);
        }
        game.emit('infrastructureChanged');
      }));
      this._drawingLine = false;
      this._lineStart = null;
      this._linePath = [];
      ctx.renderer.clearDragPreview();
      return true;
    }
    if (this._dragging && this._dragStart && this._dragEnd) {
      game._withUndo(() => game.placeInfraRect(
        this._dragStart.col, this._dragStart.row,
        this._dragEnd.col, this._dragEnd.row,
        this.floorType,
        this.variant,
        this.orientationOverride,
      ));
      this._dragging = false;
      this._dragStart = null;
      this._dragEnd = null;
      ctx.renderer.clearDragPreview();
      return true;
    }
    // Plain release falls through to _handleClick → onClick.
    return false;
  }

  onClick(e, ctx) {
    // Single-tile placement for click-place floors (paths etc.). Drag/line
    // floors commit in onMouseUp; their clicks are consumed as no-ops,
    // matching the legacy infra click branch.
    const infra = this._def();
    if (infra && !infra.isDragPlacement && !infra.isLinePlacement) {
      const world = ctx.renderer.screenToWorld(e.clientX, e.clientY);
      const grid = isoToGrid(world.x, world.y);
      ctx.game._withUndo(() => {
        if (ctx.game.placeInfraTile(grid.col, grid.row, this.floorType, this.variant)) {
          ctx.game.emit('infrastructureChanged');
        }
      });
    }
    return true;
  }

  onRightClick(_e, ctx) {
    // Right-click deselects (legacy deselectInfraTool behavior).
    ctx.input.clearTool();
    return true;
  }

  onKey(e, ctx) {
    const input = ctx.input;
    if (e.key === ' ') {
      // Space: place a single tile at the hover cursor (click-place floors
      // only). _withUndo commits the undo snapshot only if the placement
      // actually changed state.
      e.preventDefault();
      const infra = this._def();
      ctx.game._withUndo(() => {
        if (infra && !infra.isDragPlacement && !infra.isLinePlacement) {
          if (ctx.game.placeInfraTile(ctx.renderer.hoverCol, ctx.renderer.hoverRow, this.floorType, this.variant)) {
            ctx.game.emit('infrastructureChanged');
          }
        }
      });
      return true;
    }
    if (e.key === 'f' || e.key === 'F') {
      // Orientable floors: F toggles texture rotation instead of rotating
      // the (nonexistent) placeable ghost.
      const infra = this._def();
      if (infra?.orientable) {
        this.orientationOverride = this.orientationOverride ? 0 : 1;
        input._showToast(`Orientation: ${this.orientationOverride ? 'vertical' : 'horizontal'}`);
        return true;
      }
    }
    return false;
  }
}

export class WallPaintTool extends Tool {
  constructor(paintId) {
    super(`wallPaint:${paintId}`, 'wallPaint');
    this.paintId = paintId;
  }

  _paint(edge, ctx, paintId = this.paintId) {
    return ctx.game.paintWallFace(edge.col, edge.row, edge.edge, paintId);
  }

  onMouseMove(e, ctx) {
    const edge = ctx.input._getNearestWallEdge(e.clientX, e.clientY);
    const paint = WALL_PAINTS[this.paintId];
    ctx.renderer.renderWallEdgeHighlight(edge?.col, edge?.row, edge?.edge, paint?.color ?? 0xffffff);
    return true;
  }

  onClick(e, ctx) {
    if (e.shiftKey) {
      const world = ctx.renderer.screenToWorld(e.clientX, e.clientY);
      const grid = isoToGrid(world.x, world.y);
      const path = ctx.input._buildFloorBoundaryRegion({ col: grid.col, row: grid.row }).path;
      ctx.game.runUndoableMutation(() => ctx.game.batchEvents(() => {
        for (const edge of path) this._paint(edge, ctx);
      }));
      return true;
    }
    const edge = ctx.input._getNearestWallEdge(e.clientX, e.clientY);
    if (!edge) return false;
    ctx.game.runUndoableMutation(() => this._paint(edge, ctx));
    return true;
  }

  onRightClick(e, ctx) {
    const edge = ctx.input._getNearestWallEdge(e.clientX, e.clientY);
    if (!edge) return false;
    ctx.game.runUndoableMutation(() => this._paint(edge, ctx, null));
    return true;
  }
}

export class WallTool extends Tool {
  constructor(wallType, variant = 0) {
    super(`wall:${wallType}`, 'wall');
    this.wallType = wallType;
    this.variant = variant;
    this._drawing = false;
    this._start = null;      // origin edge of the drag
    this._path = [];         // [{ col, row, edge }]
    this._shiftPending = false; // Shift smart-fill armed, waiting for click or drag
    this._shiftDragStart = null;
    this._shiftStartScreen = null;
    this._smartCache = null;
  }

  onExit(ctx) {
    this._drawing = false;
    this._start = null;
    this._path = [];
    this._shiftPending = false;
    this._shiftDragStart = null;
    this._shiftStartScreen = null;
    this._smartCache = null;
    ctx.renderer.clearDragPreview();
    ctx.input._hideDragCostTooltip();
    ctx.input._hideTooltip?.();
  }

  // Off-canvas release / focus loss: drop the drag without committing.
  cancelGesture(ctx) { this.onExit(ctx); }

  /**
   * Cost of placing this wall along a path, skipping same-type edges. The
   * edge may hold its wall under either spelling (see edge-keys.js), so
   * resolve before comparing — quoting the direct key only made a run
   * redrawn from the far side of the line look like it cost full price.
   */
  _pathCost(ctx, path) {
    const wt = WALL_TYPES[this.wallType];
    if (!wt) return 0;
    const segCost = wt.variantCosts?.[this.variant] ?? wt.cost;
    const occupied = ctx.game.state.wallOccupied;
    const overlays = ctx.game.state.wallOverlayOccupied || {};
    let count = 0;
    for (const pt of path) {
      if (wt.wallOverlay) {
        if (!findWallKey(occupied, pt.col, pt.row, pt.edge)) continue;
        const overlayKey = findEdgeKey(overlays, pt.col, pt.row, pt.edge);
        if (overlayKey && overlays[overlayKey] === this.wallType) continue;
        count++;
        continue;
      }
      const key = findWallKey(occupied, pt.col, pt.row, pt.edge);
      if (key && occupied[key] === this.wallType) continue;
      count++;
    }
    return count * segCost;
  }

  _selectionNote(selection) {
    if (!selection) return null;
    if (selection.mode === 'interface') {
      const names = selection.floorTypes.map(type => FLOORS[type]?.name || type);
      return `${names[0]} ↔ ${names[1]} boundary • ${selection.path.length} segments`;
    }
    if (selection.mode === 'perimeter') {
      const name = FLOORS[selection.floorType]?.name || selection.floorType;
      return `${name} perimeter • ${selection.tileCount} tiles • ${selection.path.length} segments`;
    }
    return 'Drag to draw a free wall run';
  }

  _showCost(ctx, path, screenX, screenY, selection = null) {
    const cost = this._pathCost(ctx, path);
    ctx.input._showDragCostTooltip(cost, screenX, screenY, {
      note: this._selectionNote(selection),
      insufficientFunding: !canAffordFunding(ctx.game, cost),
    });
  }

  _smartSelection(ctx, edge) {
    // Pointermove fires far more often than the nearest tile edge changes.
    // Cache that stable selection so a large floor region is not flood-filled
    // for every pixel of mouse movement. Undo/load replaces the occupancy map,
    // which naturally invalidates the cached result.
    const occupied = ctx.game.state.infraOccupied;
    const proximity = (edge.dist ?? Infinity) <= FLOOR_INTERFACE_HOVER_THRESHOLD ? 'near' : 'inside';
    const key = `${edge.col},${edge.row},${edge.edge},${proximity}`;
    if (this._smartCache
      && this._smartCache.occupied === occupied
      && this._smartCache.key === key) {
      return this._smartCache.selection;
    }
    const selection = ctx.input._buildSmartFloorWallPath(edge);
    this._smartCache = { occupied, key, selection };
    return selection;
  }

  _showShiftHoverHint(ctx, edge, screenX, screenY) {
    const selection = this._smartSelection(ctx, edge);
    let title = 'SHIFT + drag: draw wall run';
    let detail = 'Start from any tile edge';
    if (selection.mode === 'interface') {
      const names = selection.floorTypes.map(type => FLOORS[type]?.name || type);
      title = 'Hold SHIFT: trace floor boundary';
      detail = `${names[0]} ↔ ${names[1]} • ${selection.path.length} wall segments`;
    } else if (selection.mode === 'perimeter') {
      const name = FLOORS[selection.floorType]?.name || selection.floorType;
      title = 'Hold SHIFT: outline floor area';
      detail = `${name} • ${selection.tileCount} tiles • ${selection.path.length} wall segments`;
    }
    ctx.input._setHoverTooltip?.(
      `wall-shift:${selection.mode}:${selection.floorType || selection.floorTypes?.join(':') || 'free'}:${selection.path.length}`,
      { title, detail },
      screenX,
      screenY,
    );
    return selection;
  }

  onMouseDown(e, ctx) {
    if (e.button !== 0) return false;
    const input = ctx.input;
    input._hideTooltip?.();
    if (input._shiftDown) {
      const edge = input._getNearestFloorEdge(e.clientX, e.clientY);
      const selection = this._smartSelection(ctx, edge);
      // A click commits the smart selection. Moving far enough converts this
      // into an ordinary straight wall drag starting from the raw edge.
      this._shiftPending = true;
      this._shiftDragStart = input._getNearestEdge(e.clientX, e.clientY);
      this._shiftStartScreen = { x: e.clientX, y: e.clientY };
      this._path = selection.path;
      ctx.renderer.renderWallPreview(this._path, this.wallType);
      this._showCost(ctx, this._path, e.clientX, e.clientY, selection);
      return true;
    }
    const edge = input._getNearestFloorEdge(e.clientX, e.clientY);
    this._drawing = true;
    this._start = edge;
    this._path = [edge];
    ctx.renderer.renderWallPreview(this._path, this.wallType);
    return true;
  }

  onMouseMove(e, ctx) {
    const input = ctx.input;
    const renderer = ctx.renderer;
    input._lastScreenX = e.clientX;
    input._lastScreenY = e.clientY;
    if (this._drawing) {
      const edge = input._getNearestEdge(e.clientX, e.clientY);
      this._path = input._buildWallLine(this._start, edge);
      renderer.renderWallPreview(this._path, this.wallType);
      this._showCost(ctx, this._path, e.clientX, e.clientY);
      return true;
    }
    if (this._shiftPending) {
      const dx = e.clientX - this._shiftStartScreen.x;
      const dy = e.clientY - this._shiftStartScreen.y;
      if (Math.hypot(dx, dy) >= 6) {
        // Shift-drag is deliberately the same unconstrained straight run as
        // a normal wall drag, even when it began over a floor region.
        this._drawing = true;
        this._shiftPending = false;
        this._start = this._shiftDragStart;
        this._shiftDragStart = null;
        this._shiftStartScreen = null;
        const edge = input._getNearestEdge(e.clientX, e.clientY);
        this._path = input._buildWallLine(this._start, edge);
        renderer.renderWallPreview(this._path, this.wallType);
        this._showCost(ctx, this._path, e.clientX, e.clientY);
        return true;
      }
      // Until the drag threshold is crossed, preserve the smart click
      // selection while keeping hover bookkeeping current.
      const world = renderer.screenToWorld(e.clientX, e.clientY);
      const grid = isoToGrid(world.x, world.y);
      renderer.updateHover(grid.col, grid.row);
      input.lastMouseWorldX = world.x;
      input.lastMouseWorldY = world.y;
      if (input._hoverTooltipTarget) input._hideTooltip();
      return true;
    }
    const edge = input._getNearestFloorEdge(e.clientX, e.clientY);
    if (input._shiftDown) {
      input._hideTooltip?.();
      const selection = this._smartSelection(ctx, edge);
      renderer.renderWallPreview(selection.path, this.wallType);
      this._showCost(ctx, selection.path, e.clientX, e.clientY, selection);
    } else {
      input._hideDragCostTooltip();
      renderer.renderWallEdgeHighlight(edge.col, edge.row, edge.edge);
      this._showShiftHoverHint(ctx, edge, e.clientX, e.clientY);
    }
    return true;
  }

  onMouseUp(e, ctx) {
    // Only the left button commits a drag. A right release mid-drag used to
    // run this commit path (onMouseDown guards `e.button !== 0`, onMouseUp
    // did not), firing the gesture early AND consuming the event so
    // right-click-to-deselect never ran.
    if (e.button !== 0) return false;
    const game = ctx.game;
    if (this._shiftPending) {
      if (this._path.length > 0) {
        game._withUndo(() => game.placeWallPath(this._path, this.wallType, this.variant));
      }
      this._shiftPending = false;
      this._shiftDragStart = null;
      this._shiftStartScreen = null;
      this._path = [];
      ctx.renderer.clearDragPreview();
      ctx.input._hideDragCostTooltip();
      return true;
    }
    if (this._drawing && this._path.length > 0) {
      game._withUndo(() => game.placeWallPath(this._path, this.wallType, this.variant));
      this._drawing = false;
      this._path = [];
      this._start = null;
      ctx.renderer.clearDragPreview();
      ctx.input._hideDragCostTooltip();
      return true;
    }
    return false;
  }

  onRightClick(e, ctx) {
    // Keep the wall tool armed so a player can quickly trim a run without
    // swapping to demolition mode. `removeWall` resolves either spelling of
    // a shared edge and also cleans up dependent doors/windows.
    const edge = ctx.input._getNearestFloorEdge(e.clientX, e.clientY);
    if (!edge) return false;
    ctx.game._withUndo(() => ctx.game.removeWall(edge.col, edge.row, edge.edge));
    return true;
  }

  onShiftChange(down, ctx) {
    const input = ctx.input;
    const renderer = ctx.renderer;
    if (down) {
      // Show the smart floor preview even with a stationary cursor.
      if (this._drawing || this._shiftPending) return;
      if (input._lastScreenX == null) return;
      input._hideTooltip?.();
      const edge = input._getNearestFloorEdge(input._lastScreenX, input._lastScreenY);
      const selection = this._smartSelection(ctx, edge);
      renderer.renderWallPreview(selection.path, this.wallType);
      this._showCost(ctx, selection.path, input._lastScreenX, input._lastScreenY, selection);
      return;
    }
    // Shift released: cancel a pending boundary fill and fall back to the
    // single-edge highlight.
    if (this._shiftPending) {
      this._shiftPending = false;
      this._shiftDragStart = null;
      this._shiftStartScreen = null;
      this._path = [];
    }
    if (!this._drawing) {
      renderer.clearDragPreview();
      input._hideDragCostTooltip();
      if (input._lastScreenX != null) {
        const edge = input._getNearestFloorEdge(input._lastScreenX, input._lastScreenY);
        renderer.renderWallEdgeHighlight(edge.col, edge.row, edge.edge);
        this._showShiftHoverHint(ctx, edge, input._lastScreenX, input._lastScreenY);
      }
    }
  }
}

export class DoorTool extends Tool {
  constructor(doorType, variant = 0) {
    super(`door:${doorType}`, 'door');
    this.doorType = doorType;
    this.variant = variant;
    this._drawing = false;
    this._start = null;
    this._path = [];
    // Subtile offset of the opening along the edge, quantized from the
    // cursor's along-edge fraction. See _offFor.
    this._off = null;
  }

  onExit(ctx) {
    this._drawing = false;
    this._start = null;
    this._path = [];
    this._off = null;
    ctx.renderer.clearDragPreview();
    ctx.input._hideDragCostTooltip();
  }

  // Off-canvas release / focus loss: drop the drag without committing.
  cancelGesture(ctx) { this.onExit(ctx); }

  /**
   * Subtile offset of the opening for the edge under the cursor.
   * _getNearestWallEdge hands back a raw along-edge fraction (it can't know
   * how wide this door is); doorOffFromFrac centers the opening on the cursor
   * and clamps it inside the tile. Quantizing here rather than in
   * _getNearestWallEdge keeps the door-width knowledge on the tool, which is
   * the only place that knows which door is armed.
   */
  _offFor(edge) {
    return doorOffFromFrac(edge?.frac, DOOR_TYPES[this.doorType]);
  }

  onMouseDown(e, ctx) {
    if (e.button !== 0) return false;
    const edge = ctx.input._getNearestWallEdge(e.clientX, e.clientY);
    this._off = this._offFor(edge);
    this._drawing = true;
    this._start = edge;
    this._path = [{ ...edge, off: this._off }];
    ctx.renderer.renderDoorPreview(this._path, this.doorType);
    return true;
  }

  onMouseMove(e, ctx) {
    const input = ctx.input;
    const renderer = ctx.renderer;
    const edge = input._getNearestWallEdge(e.clientX, e.clientY);
    if (this._drawing) {
      // _buildWallLine steps in whole tiles and locks every segment to the
      // START edge's side, so a multi-tile drag shares one opening offset.
      // The offset keeps tracking the cursor only while the hovered edge is
      // the same side as the start (n/s vs e/w): `frac` runs along whichever
      // edge produced it, so a perpendicular edge's frac is meaningless here.
      if (edge && edge.edge === this._start.edge) this._off = this._offFor(edge);
      this._path = input._buildWallLine(this._start, edge)
        .map(pt => ({ ...pt, off: this._off }));
      renderer.renderDoorPreview(this._path, this.doorType);
      return true;
    }
    this._off = this._offFor(edge);
    // Every other tool keeps renderer.hoverCol/hoverRow and the last cursor
    // world position current; without it the next tool armed by hotkey
    // repaints its ghost at a stale position.
    const world = renderer.screenToWorld(e.clientX, e.clientY);
    const grid = isoToGrid(world.x, world.y);
    renderer.updateHover(grid.col, grid.row);
    input.lastMouseWorldX = world.x;
    input.lastMouseWorldY = world.y;
    input._lastScreenX = e.clientX;
    input._lastScreenY = e.clientY;
    renderer.renderWallEdgeHighlight(edge.col, edge.row, edge.edge);
    if (input._hoverTooltipTarget) input._hideTooltip();
    return true;
  }

  onMouseUp(e, ctx) {
    // Only the left button commits a drag. A right release mid-drag used to
    // run this commit path (onMouseDown guards `e.button !== 0`, onMouseUp
    // did not), firing the gesture early AND consuming the event so
    // right-click-to-deselect never ran.
    if (e.button !== 0) return false;
    if (this._drawing && this._path.length > 0) {
      // Each path point carries its own `off`; this._off is the fallback.
      ctx.game._withUndo(
        () => ctx.game.placeDoorPath(this._path, this.doorType, this.variant, this._off)
      );
      this._drawing = false;
      this._start = null;
      this._path = [];
      ctx.renderer.clearDragPreview();
      return true;
    }
    return false;
  }

  onRightClick(_e, ctx) {
    // Keep the door tool armed so a player can correct openings directly.
    // `removeDoor` is alias-aware, matching the wall-facing placement snap.
    const edge = ctx.input._getNearestWallEdge(_e.clientX, _e.clientY);
    if (!edge) return false;
    ctx.game._withUndo(() => ctx.game.removeDoor(edge.col, edge.row, edge.edge));
    return true;
  }
}

export class WindowTool extends Tool {
  constructor(windowType, variant = 0) {
    super(`window:${windowType}`, 'window');
    this.windowType = windowType;
    this.variant = variant;
    this._drawing = false;
    this._start = null;
    this._path = [];
  }

  onExit(ctx) {
    this._drawing = false;
    this._start = null;
    this._path = [];
    ctx.renderer.clearDragPreview();
    ctx.input._hideDragCostTooltip();
  }

  // Off-canvas release / focus loss: drop the drag without committing.
  cancelGesture(ctx) { this.onExit(ctx); }

  // Keep the ghost honest before the click: this mirrors Game.placeWindow's
  // wall/height/funding gates, including the free same-type repaint case.
  _previewStatus(game, edge) {
    const def = WINDOW_TYPES[this.windowType];
    if (!def || !edge) return { valid: false, reason: 'Unknown window type' };
    const key = `${edge.col},${edge.row},${edge.edge}`;
    const alias = game._edgeAlias(edge.col, edge.row, edge.edge);
    const aliasKey = `${alias.col},${alias.row},${alias.edge}`;
    const wallType = game.state.wallOccupied[key] || game.state.wallOccupied[aliasKey];
    if (!wallType) return { valid: false, reason: 'Requires an existing wall' };
    const wall = WALL_TYPES[wallType];
    if (!wall || wall.wallHeight < def.sillHeight + def.openingHeight + 1) {
      return { valid: false, reason: `${wall?.name || 'Wall'} is too short` };
    }
    const heldType = game.state.windowOccupied[key] || game.state.windowOccupied[aliasKey];
    if (heldType === this.windowType) return { valid: true, reason: null };
    const cost = def.variantCosts?.[this.variant] ?? def.cost;
    if (!canAffordFunding(game, cost)) return { valid: false, reason: 'Insufficient funding' };
    return { valid: true, reason: null };
  }

  _renderPreview(ctx, path) {
    const previewPath = path.map(edge => ({
      ...edge,
      variant: this.variant,
      ...this._previewStatus(ctx.game, edge),
    }));
    ctx.renderer.renderWindowPreview(previewPath, this.windowType);
  }

  onMouseDown(e, ctx) {
    if (e.button !== 0) return false;
    const edge = ctx.input._getNearestWallEdge(e.clientX, e.clientY);
    this._drawing = true;
    this._start = edge;
    this._path = [edge];
    this._renderPreview(ctx, this._path);
    return true;
  }

  onMouseMove(e, ctx) {
    const input = ctx.input;
    const renderer = ctx.renderer;
    const edge = input._getNearestWallEdge(e.clientX, e.clientY);
    if (this._drawing) {
      this._path = input._buildWallLine(this._start, edge);
      this._renderPreview(ctx, this._path);
      return true;
    }
    // Every other tool keeps renderer.hoverCol/hoverRow and the last cursor
    // world position current; without it the next tool armed by hotkey
    // repaints its ghost at a stale position.
    const world = renderer.screenToWorld(e.clientX, e.clientY);
    const grid = isoToGrid(world.x, world.y);
    renderer.updateHover(grid.col, grid.row);
    input.lastMouseWorldX = world.x;
    input.lastMouseWorldY = world.y;
    input._lastScreenX = e.clientX;
    input._lastScreenY = e.clientY;
    // Unlike the old tiny crosshair, hovering a window tool renders the
    // actual framed opening snapped to the nearest real wall.
    this._renderPreview(ctx, [edge]);
    if (input._hoverTooltipTarget) input._hideTooltip();
    return true;
  }

  onMouseUp(e, ctx) {
    // Only the left button commits a drag. A right release mid-drag used to
    // run this commit path (onMouseDown guards `e.button !== 0`, onMouseUp
    // did not), firing the gesture early AND consuming the event so
    // right-click-to-deselect never ran.
    if (e.button !== 0) return false;
    if (this._drawing && this._path.length > 0) {
      ctx.game._withUndo(() => ctx.game.placeWindowPath(this._path, this.windowType, this.variant));
      this._drawing = false;
      this._start = null;
      this._path = [];
      ctx.renderer.clearDragPreview();
      return true;
    }
    return false;
  }

  onRightClick(_e, ctx) {
    // Right-click deselects, like every sibling structure tool.
    ctx.input.clearTool();
    return true;
  }
}
