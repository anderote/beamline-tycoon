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
//     the start edge's axis; Shift+click auto-fills the whole floor
//     boundary; Shift-hover previews that fill.
//   - DoorTool: edge-based door drawing, preferring edges that carry walls.
//
// These replaced the legacy per-family floor/wall/door selection fields
// and their drawing-state webs (isDragging /
// isDrawingLine / isDrawingWall / isDrawingDoor / _shiftWallPending etc.),
// which are now tool-local. Behavior is intentionally identical to the
// legacy branches; geometry helpers (_buildLPath, _buildWallLine,
// _getNearestFloorEdge, _buildFloorBoundaryPath, ...) stay on InputHandler
// because the demolish family shares them.

import { Tool } from './Tool.js';
import { FLOORS, WALL_TYPES } from '../data/structure.js';
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
      insufficientFunding: ctx.game.state.resources.funding < cost.totalCost,
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
        insufficientFunding: ctx.game.state.resources.funding < lineCost.totalCost,
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

  onMouseUp(e, ctx) {
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

export class WallTool extends Tool {
  constructor(wallType, variant = 0) {
    super(`wall:${wallType}`, 'wall');
    this.wallType = wallType;
    this.variant = variant;
    this._drawing = false;
    this._start = null;      // origin edge of the drag
    this._path = [];         // [{ col, row, edge }]
    this._shiftPending = false; // Shift+click boundary fill armed, waiting for release
  }

  onExit(ctx) {
    this._drawing = false;
    this._start = null;
    this._path = [];
    this._shiftPending = false;
    ctx.renderer.clearDragPreview();
    ctx.input._hideDragCostTooltip();
  }

  /** Cost of placing this wall along a path, skipping same-type edges. */
  _pathCost(ctx, path) {
    const wt = WALL_TYPES[this.wallType];
    if (!wt) return 0;
    const segCost = wt.variantCosts?.[this.variant] ?? wt.cost;
    let count = 0;
    for (const pt of path) {
      const key = `${pt.col},${pt.row},${pt.edge}`;
      if (ctx.game.state.wallOccupied[key] === this.wallType) continue;
      count++;
    }
    return count * segCost;
  }

  _showCost(ctx, path, screenX, screenY) {
    const cost = this._pathCost(ctx, path);
    ctx.input._showDragCostTooltip(cost, screenX, screenY, {
      insufficientFunding: ctx.game.state.resources.funding < cost,
    });
  }

  onMouseDown(e, ctx) {
    if (e.button !== 0) return false;
    const input = ctx.input;
    const edge = input._getNearestFloorEdge(e.clientX, e.clientY);
    if (input._shiftDown) {
      // Shift+click: auto-fill the whole floor boundary; commits on release.
      this._shiftPending = true;
      this._path = input._buildFloorBoundaryPath(edge);
      ctx.renderer.renderWallPreview(this._path, this.wallType);
      this._showCost(ctx, this._path, e.clientX, e.clientY);
      return true;
    }
    this._drawing = true;
    this._start = edge;
    this._path = [edge];
    ctx.renderer.renderWallPreview(this._path, this.wallType);
    return true;
  }

  onMouseMove(e, ctx) {
    const input = ctx.input;
    const renderer = ctx.renderer;
    if (this._drawing) {
      const edge = input._getNearestEdge(e.clientX, e.clientY);
      this._path = input._buildWallLine(this._start, edge);
      renderer.renderWallPreview(this._path, this.wallType);
      this._showCost(ctx, this._path, e.clientX, e.clientY);
      return true;
    }
    if (this._shiftPending) {
      // Boundary-fill preview stays frozen at the click; just keep the
      // hover bookkeeping in sync (tooltips stay suppressed, matching the
      // legacy guard).
      const world = renderer.screenToWorld(e.clientX, e.clientY);
      const grid = isoToGrid(world.x, world.y);
      renderer.updateHover(grid.col, grid.row);
      input.lastMouseWorldX = world.x;
      input.lastMouseWorldY = world.y;
      input._lastScreenX = e.clientX;
      input._lastScreenY = e.clientY;
      if (input._hoverTooltipTarget) input._hideTooltip();
      return true;
    }
    input._lastScreenX = e.clientX;
    input._lastScreenY = e.clientY;
    const edge = input._getNearestFloorEdge(e.clientX, e.clientY);
    if (input._shiftDown) {
      const path = input._buildFloorBoundaryPath(edge);
      renderer.renderWallPreview(path, this.wallType);
      this._showCost(ctx, path, e.clientX, e.clientY);
    } else {
      input._hideDragCostTooltip();
      renderer.renderWallEdgeHighlight(edge.col, edge.row, edge.edge);
    }
    if (input._hoverTooltipTarget) input._hideTooltip();
    return true;
  }

  onMouseUp(e, ctx) {
    const game = ctx.game;
    if (this._shiftPending && this._path.length > 0) {
      game._withUndo(() => game.placeWallPath(this._path, this.wallType, this.variant));
      this._shiftPending = false;
      this._path = [];
      ctx.renderer.clearDragPreview();
      return true;
    }
    if (this._drawing && this._path.length > 0) {
      game._withUndo(() => game.placeWallPath(this._path, this.wallType, this.variant));
      this._drawing = false;
      this._path = [];
      this._start = null;
      ctx.renderer.clearDragPreview();
      return true;
    }
    return false;
  }

  onShiftChange(down, ctx) {
    const input = ctx.input;
    const renderer = ctx.renderer;
    if (down) {
      // Show the boundary-fill preview even with a stationary cursor.
      if (this._drawing || this._shiftPending) return;
      if (input._lastScreenX == null) return;
      const edge = input._getNearestFloorEdge(input._lastScreenX, input._lastScreenY);
      const path = input._buildFloorBoundaryPath(edge);
      renderer.renderWallPreview(path, this.wallType);
      this._showCost(ctx, path, input._lastScreenX, input._lastScreenY);
      return;
    }
    // Shift released: cancel a pending boundary fill and fall back to the
    // single-edge highlight.
    if (this._shiftPending) {
      this._shiftPending = false;
      this._path = [];
    }
    if (!this._drawing) {
      renderer.clearDragPreview();
      input._hideDragCostTooltip();
      if (input._lastScreenX != null) {
        const edge = input._getNearestFloorEdge(input._lastScreenX, input._lastScreenY);
        renderer.renderWallEdgeHighlight(edge.col, edge.row, edge.edge);
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
  }

  onExit(ctx) {
    this._drawing = false;
    this._start = null;
    this._path = [];
    ctx.renderer.clearDragPreview();
    ctx.input._hideDragCostTooltip();
  }

  onMouseDown(e, ctx) {
    if (e.button !== 0) return false;
    const edge = ctx.input._getNearestWallEdge(e.clientX, e.clientY);
    this._drawing = true;
    this._start = edge;
    this._path = [edge];
    ctx.renderer.renderDoorPreview(this._path, this.doorType);
    return true;
  }

  onMouseMove(e, ctx) {
    const input = ctx.input;
    const edge = input._getNearestWallEdge(e.clientX, e.clientY);
    if (this._drawing) {
      this._path = input._buildWallLine(this._start, edge);
      ctx.renderer.renderDoorPreview(this._path, this.doorType);
      return true;
    }
    input._lastScreenX = e.clientX;
    input._lastScreenY = e.clientY;
    ctx.renderer.renderWallEdgeHighlight(edge.col, edge.row, edge.edge);
    if (input._hoverTooltipTarget) input._hideTooltip();
    return true;
  }

  onMouseUp(e, ctx) {
    if (this._drawing && this._path.length > 0) {
      ctx.game._withUndo(() => ctx.game.placeDoorPath(this._path, this.doorType, this.variant));
      this._drawing = false;
      this._start = null;
      this._path = [];
      ctx.renderer.clearDragPreview();
      return true;
    }
    return false;
  }
}
