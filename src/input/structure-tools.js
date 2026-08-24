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
// All four take the same pair of modifiers: Shift EXTENDS the gesture, Ctrl
// (Cmd) INVERTS it into an erase over the same geometry. See the eraseHeld
// block below.
//
// These replaced the legacy per-family floor/wall/door selection fields
// and their drawing-state webs (isDragging /
// isDrawingLine / isDrawingWall / isDrawingDoor / _shiftWallPending etc.),
// which are now tool-local. Behavior is intentionally identical to the
// legacy branches; geometry helpers (_buildLPath, _buildWallLine,
// _getNearestFloorEdge, _buildFloorBoundaryPath, ...) stay on InputHandler
// because the demolish family shares them.

import { Tool } from './Tool.js';
import {
  buildFloorTileWallPath,
  buildWallFaceRun,
  buildInteriorWallBoundary,
  FLOOR_INTERFACE_HOVER_THRESHOLD,
} from './floor-wall-paths.js';
import { FLOORS, WALL_TYPES, DOOR_TYPES, WINDOW_TYPES, WALL_PAINTS } from '../data/structure.js';
import {
  doorOffFromFrac, doorTileSpan, doorSpanPath, doorRecordCoversEdge,
  windowOffFromFrac, findWallKey, findEdgeKey,
} from '../game/edge-keys.js';
import { canAffordFunding } from '../game/affordability.js';
import { demolishRefund } from './demolishScopes.js';
import { isoToGrid } from '../renderer/grid.js';
import { edgeKey } from '../game/edge-keys.js';
import { levelOf, sameLevel, tileKey } from '../game/storeys.js';

function activeLevel(game) { return game?.activeLevel || 0; }

function floorView(game) {
  const level = activeLevel(game);
  const view = {};
  for (const tile of game.state.floors || []) {
    if (sameLevel(tile, level)) view[`${tile.col},${tile.row}`] = tile.type;
  }
  return view;
}

function wallView(game) {
  const level = activeLevel(game);
  const view = {};
  for (const wall of game.state.walls || []) {
    if (sameLevel(wall, level)) view[`${wall.col},${wall.row},${wall.edge}`] = wall.type;
  }
  return view;
}

// --- Ctrl: the erase modifier -----------------------------------------------
//
// Shift EXTENDS a structure gesture (smart region select, whole-run select).
// Ctrl is its mirror image: the same drag ERASES along exactly the path the
// tool would have drawn. Command is reserved for camera orbit. So each gesture
// below comes in a pair, place vs. remove over identical geometry, previewed
// with the demolish renderer's red instead of the placement blue and quoted
// as a refund instead of a cost.
//
// Synthesized clicks (the {clientX, clientY, button} record _handleClick hands
// to onClick) carry no modifier flags at all, which is why InputHandler tracks
// _ctrlDown for us to fall back on. Tools latch the answer into `_erasing` on
// press: releasing Ctrl halfway through a drag must not turn the rest of the
// run into a placement.
function eraseHeld(e, input) {
  return !!(e?.ctrlKey || input?._ctrlDown);
}

const EDGE_DEFS = {
  overlay: WALL_TYPES, wall: WALL_TYPES, door: DOOR_TYPES, window: WINDOW_TYPES,
};

function plural(n, noun) { return `${n} ${noun}${n === 1 ? '' : 's'}`; }

/**
 * The wall / overlay / door / window entry standing at an edge, resolved
 * through BOTH spellings of the shared edge (see edge-keys.js) — a run
 * redrawn from the far side of the line addresses the same segments under
 * the mirrored triple.
 */
function edgeEntryAt(game, kind, edge) {
  const s = game.state;
  const list = kind === 'overlay' ? s.wallOverlays
    : kind === 'wall' ? s.walls
    : kind === 'door' ? s.doors : s.windows;
  if (!list || !edge) return null;
  if (kind === 'door') {
    return list.find(entry => doorRecordCoversEdge(
      entry, DOOR_TYPES[entry.type], edge.col, edge.row, edge.edge,
    ) && sameLevel(entry, activeLevel(game))) || null;
  }
  const alias = game._edgeAlias(edge.col, edge.row, edge.edge);
  return list.find(x => sameLevel(x, activeLevel(game)) && (
    (x.col === edge.col && x.row === edge.row && x.edge === edge.edge)
    || (x.col === alias.col && x.row === alias.row && x.edge === alias.edge))) || null;
}

/**
 * Refund an erase along `path` would credit, and how many segments actually
 * hold something. Priced PER VARIANT: walls and windows are charged per
 * variant and refunded per variant, so quoting the def's base cost promises
 * the wrong money back on a Reinforced run (the same rule
 * InputHandler._updateDemolishHover follows).
 */
function edgePathRefund(game, kind, path) {
  let refund = 0, count = 0;
  const seen = new Set();
  for (const pt of path || []) {
    const entry = edgeEntryAt(game, kind, pt);
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    count++;
    refund += demolishRefund(EDGE_DEFS[kind][entry.type], entry.variant ?? 0);
  }
  return { refund, count };
}

/**
 * Refund for clearing floor tiles. Mirrors the infrastructure branch of
 * InputHandler._updateDemolishHover so Ctrl+erase and the demolish tool quote
 * the same number for the same removal.
 */
function floorTilesRefund(game, tiles) {
  let refund = 0, count = 0;
  for (const t of tiles || []) {
    const type = game.state.infraOccupied[tileKey(t.col, t.row, activeLevel(game))];
    if (!type) continue;
    count++;
    refund += Math.floor((FLOORS[type]?.cost || 0) * 0.5);
  }
  return { refund, count };
}

/** Red name + green refund beside the cursor — demolish mode's own tooltip. */
function showEraseTooltip(ctx, screenX, screenY, label, refund) {
  ctx.input._hideDragCostTooltip?.();
  ctx.input._showDemolishTooltip?.(label, refund, screenX, screenY);
}

/** Hover quote for one edge: what stands there, and what it pays back. */
function showEdgeEraseHover(ctx, kind, edge, screenX, screenY, emptyLabel) {
  const entry = edgeEntryAt(ctx.game, kind, edge);
  const def = entry ? EDGE_DEFS[kind][entry.type] : null;
  showEraseTooltip(ctx, screenX, screenY, def?.name || emptyLabel,
    entry ? demolishRefund(def, entry.variant ?? 0) : 0);
}

/** Drag quote for an edge run: how many segments go, and for how much. */
function showEdgePathEraseQuote(ctx, kind, path, screenX, screenY, noun) {
  const { refund, count } = edgePathRefund(ctx.game, kind, path);
  showEraseTooltip(ctx, screenX, screenY, `Clear ${plural(count, noun)}`, refund);
}

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
    // Ctrl latched at gesture start: this drag clears the rect / L path
    // instead of laying it.
    this._erasing = false;
  }

  _def() { return FLOORS[this.floorType]; }

  _roofRegion(ctx, screenX, screenY) {
    const world = ctx.renderer.screenToWorld(screenX, screenY);
    const grid = isoToGrid(world.x, world.y);
    return ctx.game.roofRegionAt(grid.col, grid.row, activeLevel(ctx.game));
  }

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
    this._erasing = false;
    ctx.renderer.clearDragPreview();
    ctx.input._hideDragCostTooltip();
    ctx.input._hideDemolishTooltip?.();
  }

  _showRectCost(ctx, screenX, screenY, c0, r0, c1, r1) {
    const infra = this._def();
    const cost = ctx.game.computeInfraRectCost(
      c0, r0, c1, r1, this.floorType, this.variant, activeLevel(ctx.game),
    );
    ctx.input._showDragCostTooltip(cost.totalCost, screenX, screenY, {
      skippedNoFoundation: cost.skippedNoFoundation,
      foundationName: infra?.requiresFoundation
        ? (FLOORS[infra.requiresFoundation]?.name || infra.requiresFoundation)
        : null,
      insufficientFunding: !canAffordFunding(ctx.game, cost.totalCost),
    });
  }

  _rectTiles(c0, r0, c1, r1) {
    const tiles = [];
    for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) {
      for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) tiles.push({ col: c, row: r });
    }
    return tiles;
  }

  /** Rect drag preview: blue fill + cost, or demolish red + refund. */
  _previewRect(ctx, screenX, screenY) {
    const { col: c0, row: r0 } = this._dragStart;
    const { col: c1, row: r1 } = this._dragEnd;
    if (this._erasing) {
      ctx.renderer.renderDemolishPreview(c0, r0, c1, r1);
      const { refund, count } = floorTilesRefund(ctx.game, this._rectTiles(c0, r0, c1, r1));
      showEraseTooltip(ctx, screenX, screenY, `Clear ${plural(count, 'floor tile')}`, refund);
      return;
    }
    ctx.renderer.renderDragPreview(c0, r0, c1, r1, this.floorType);
    this._showRectCost(ctx, screenX, screenY, c0, r0, c1, r1);
  }

  _previewRoof(ctx, screenX, screenY, erase = eraseHeld(null, ctx.input)) {
    const region = this._roofRegion(ctx, screenX, screenY);
    const profile = ctx.game.roofProfileForRegion?.(region);
    const level = activeLevel(ctx.game);
    if (erase) {
      const keys = new Set(region.map(tile => tileKey(tile.col, tile.row, level)));
      const roofs = (ctx.game.state.roofs || []).filter(tile =>
        sameLevel(tile, level) && keys.has(tileKey(tile.col, tile.row, level)),
      );
      ctx.renderer.renderRoofPreview?.(roofs, this._def(), profile, true);
      const refund = roofs.reduce((sum, tile) => {
        const def = FLOORS[tile.type] || FLOORS.roof;
        return sum + (def.variantCosts?.[tile.variant ?? 0] ?? def.cost ?? 0);
      }, 0);
      showEraseTooltip(ctx, screenX, screenY, `Clear ${plural(roofs.length, 'roof tile')}`, refund);
      return;
    }
    ctx.input._hideDemolishTooltip?.();
    ctx.renderer.renderRoofPreview?.(region, this._def(), profile);
    const newTiles = region.filter(tile => !(ctx.game.state.roofs || []).some(
      r => r.col === tile.col && r.row === tile.row && sameLevel(r, level),
    )).length;
    ctx.input._showDragCostTooltip((this._def()?.cost || 0) * newTiles, screenX, screenY, {
      note: region.length ? `${region.length} enclosed tiles` : 'Walls must fully enclose the room',
      insufficientFunding: !canAffordFunding(ctx.game, (this._def()?.cost || 0) * newTiles),
    });
  }

  /**
   * L-path (hallway) preview. `screenX == null` renders the strip without
   * touching the tooltip — the press itself has never quoted a price.
   */
  _previewLine(ctx, screenX = null, screenY = null) {
    ctx.renderer.renderLinePreview(this._linePath, this.floorType, this._erasing);
    if (screenX == null) return;
    if (this._erasing) {
      const { refund, count } = floorTilesRefund(ctx.game, this._linePath);
      showEraseTooltip(ctx, screenX, screenY, `Clear ${plural(count, 'floor tile')}`, refund);
      return;
    }
    const infra = this._def();
    const lineCost = ctx.game.computeInfraLineCost(
      this._linePath, this.floorType, this.variant, activeLevel(ctx.game),
    );
    ctx.input._showDragCostTooltip(lineCost.totalCost, screenX, screenY, {
      skippedNoFoundation: lineCost.skippedNoFoundation,
      foundationName: infra?.requiresFoundation
        ? (FLOORS[infra.requiresFoundation]?.name || infra.requiresFoundation)
        : null,
      insufficientFunding: !canAffordFunding(ctx.game, lineCost.totalCost),
    });
  }

  /** Hover under Ctrl: the tile this click would clear, and its refund. */
  _previewEraseHover(ctx, grid, screenX, screenY) {
    ctx.renderer.renderDemolishTileOutline(grid.col, grid.row);
    const type = ctx.game.state.infraOccupied[tileKey(grid.col, grid.row, activeLevel(ctx.game))];
    const { refund } = floorTilesRefund(ctx.game, [grid]);
    showEraseTooltip(ctx, screenX, screenY,
      type ? (FLOORS[type]?.name || type) : 'No flooring here', refund);
  }

  onMouseDown(e, ctx) {
    if (e.button !== 0) return false;
    const infra = this._def();
    if (!infra) return false;
    const world = ctx.renderer.screenToWorld(e.clientX, e.clientY);
    const grid = isoToGrid(world.x, world.y);
    this._erasing = eraseHeld(e, ctx.input);
    if (infra.isLinePlacement) {
      this._drawingLine = true;
      this._lineStart = { col: grid.col, row: grid.row };
      this._linePath = [{ col: grid.col, row: grid.row }];
      this._previewLine(ctx);
      return true;
    }
    if (infra.isDragPlacement) {
      this._dragging = true;
      this._dragStart = { col: grid.col, row: grid.row };
      this._dragEnd = { col: grid.col, row: grid.row };
      this._previewRect(ctx, e.clientX, e.clientY);
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
    if (this._def()?.isRoofPlacement && !this._dragging && !this._drawingLine) {
      this._previewRoof(ctx, e.clientX, e.clientY);
      input._lastScreenX = e.clientX;
      input._lastScreenY = e.clientY;
      return true;
    }
    if (this._dragging && this._dragStart) {
      this._dragEnd = { col: grid.col, row: grid.row };
      this._previewRect(ctx, e.clientX, e.clientY);
      return true;
    }
    if (this._drawingLine) {
      this._linePath = input._buildLPath(this._lineStart || this._linePath[0], grid);
      this._previewLine(ctx, e.clientX, e.clientY);
      return true;
    }
    // Hover: cross cursor tinted with the floor color — or, under Ctrl, the
    // red outline of the tile this click would clear.
    renderer.updateHover(grid.col, grid.row);
    this._erasing = eraseHeld(e, input);
    if (this._erasing) {
      this._previewEraseHover(ctx, grid, e.clientX, e.clientY);
    } else {
      input._hideDemolishTooltip?.();
      const infra = this._def();
      renderer.renderInfraHoverCursor(grid.col, grid.row, infra?.topColor || 0xffffff);
    }
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
      // The erase arm batches for the same reason: removeInfraTile emits
      // 'infrastructureChanged' (and 'zonesChanged' for hallways) per tile.
      game._withUndo(() => game._batchEvents(() => {
        for (const pt of this._linePath) {
          if (this._erasing) game.removeInfraTile(pt.col, pt.row, activeLevel(game));
          else game.placeInfraTile(pt.col, pt.row, this.floorType, this.variant, {
            level: activeLevel(game),
          });
        }
        game.emit('infrastructureChanged');
      }));
      this._drawingLine = false;
      this._lineStart = null;
      this._linePath = [];
      ctx.renderer.clearDragPreview();
      ctx.input._hideDemolishTooltip?.();
      return true;
    }
    if (this._dragging && this._dragStart && this._dragEnd) {
      // removeInfraRect batches its own per-tile emits, exactly as
      // placeInfraRect does.
      game._withUndo(() => (this._erasing
        ? game.removeInfraRect(
          this._dragStart.col, this._dragStart.row,
          this._dragEnd.col, this._dragEnd.row,
          activeLevel(game),
        )
        : game.placeInfraRect(
          this._dragStart.col, this._dragStart.row,
          this._dragEnd.col, this._dragEnd.row,
          this.floorType,
          this.variant,
          this.orientationOverride,
          activeLevel(game),
        )));
      this._dragging = false;
      this._dragStart = null;
      this._dragEnd = null;
      ctx.renderer.clearDragPreview();
      ctx.input._hideDemolishTooltip?.();
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
    if (infra?.isRoofPlacement) {
      const world = ctx.renderer.screenToWorld(e.clientX, e.clientY);
      const grid = isoToGrid(world.x, world.y);
      const erase = eraseHeld(e, ctx.input);
      ctx.game._withUndo(() => {
        if (erase) ctx.game.removeRoofRegion(grid.col, grid.row, activeLevel(ctx.game));
        else ctx.game.placeRoofRegion(
          grid.col, grid.row, this.floorType, this.variant, activeLevel(ctx.game),
        );
      });
      ctx.renderer.clearDragPreview();
      ctx.input._hideDragCostTooltip();
      return true;
    }
    if (infra && !infra.isDragPlacement && !infra.isLinePlacement) {
      const world = ctx.renderer.screenToWorld(e.clientX, e.clientY);
      const grid = isoToGrid(world.x, world.y);
      // Ctrl+click is the single-tile erase. The synthesized click record
      // carries no modifier flags, so this reads InputHandler._ctrlDown.
      const erase = eraseHeld(e, ctx.input);
      ctx.game._withUndo(() => {
        if (erase) {
          // removeInfraTile emits 'infrastructureChanged' itself.
          ctx.game.removeInfraTile(grid.col, grid.row, activeLevel(ctx.game));
        } else if (ctx.game.placeInfraTile(
          grid.col, grid.row, this.floorType, this.variant, { level: activeLevel(ctx.game) },
        )) {
          ctx.game.emit('infrastructureChanged');
        }
      });
    }
    return true;
  }

  onRightClick(_e, ctx) {
    // Right-click deselects (legacy deselectInfraTool behavior). InputHandler
    // withholds this event while Ctrl is held — on macOS a Ctrl+left-click
    // also arrives as a right-click, and disarming the tool mid-erase-drag
    // would strand the gesture.
    ctx.input.clearTool();
    return true;
  }

  onCtrlChange(down, ctx) {
    // A gesture in flight keeps the intent it was pressed with; only the
    // hover cursor has to flip under a stationary pointer.
    if (this._dragging || this._drawingLine) return;
    const input = ctx.input;
    if (input._lastScreenX == null) return;
    this._erasing = down;
    if (this._def()?.isRoofPlacement) {
      this._previewRoof(ctx, input._lastScreenX, input._lastScreenY, down);
      return;
    }
    const world = ctx.renderer.screenToWorld(input._lastScreenX, input._lastScreenY);
    const grid = isoToGrid(world.x, world.y);
    if (down) {
      this._previewEraseHover(ctx, grid, input._lastScreenX, input._lastScreenY);
      return;
    }
    input._hideDemolishTooltip?.();
    ctx.renderer.renderInfraHoverCursor(grid.col, grid.row, this._def()?.topColor || 0xffffff);
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
          if (ctx.game.placeInfraTile(
            ctx.renderer.hoverCol, ctx.renderer.hoverRow, this.floorType, this.variant,
            { level: activeLevel(ctx.game) },
          )) {
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
    this._selectionCache = null;
    this._ctrlClickPending = false;
  }

  _paint(edge, ctx, paintId = this.paintId) {
    return ctx.game.paintWallFace(
      edge.col, edge.row, edge.edge, paintId, activeLevel(ctx.game),
    );
  }

  _selectionAt(screenX, screenY, ctx, expanded = false) {
    const world = ctx.renderer.screenToWorld(screenX, screenY);
    const tile = isoToGrid(world.x, world.y);
    const infraOccupied = floorView(ctx.game);
    const wallOccupied = wallView(ctx.game);
    const cacheKey = `${tile.col},${tile.row}:${expanded ? 'interior' : 'tile'}`;
    if (this._selectionCache?.infraOccupied === infraOccupied
      && this._selectionCache?.wallOccupied === wallOccupied
      && this._selectionCache?.key === cacheKey) {
      return this._selectionCache.selection;
    }
    const hasFloor = !!infraOccupied[`${tile.col},${tile.row}`];
    const path = expanded
      ? buildInteriorWallBoundary(
          infraOccupied,
          wallOccupied,
          tile,
        ).path
      : (hasFloor ? buildFloorTileWallPath(tile) : []);
    const selection = { tile, path };
    this._selectionCache = { infraOccupied, wallOccupied, key: cacheKey, selection };
    return selection;
  }

  _runSelectionAt(screenX, screenY, ctx) {
    const world = ctx.renderer.screenToWorld(screenX, screenY);
    const tile = isoToGrid(world.x, world.y);
    const edge = ctx.input._getNearestWallEdge?.(screenX, screenY);
    return { tile, path: buildWallFaceRun(wallView(ctx.game), edge) };
  }

  _existingWallFaces(path, ctx) {
    const occupied = ctx.game.state.wallOccupied;
    const level = activeLevel(ctx.game);
    return path.filter(edge => findWallKey(occupied, edge.col, edge.row, edge.edge, level));
  }

  _renderPreview(screenX, screenY, ctx, mode = 'tile') {
    const selection = mode === 'run'
      ? this._runSelectionAt(screenX, screenY, ctx)
      : this._selectionAt(screenX, screenY, ctx, mode === 'interior');
    const path = this._existingWallFaces(selection.path, ctx);
    const paint = WALL_PAINTS[this.paintId];
    ctx.renderer.renderWallPaintPreview(
      selection.tile.col,
      selection.tile.row,
      path,
      paint?.color ?? 0xffffff,
    );
  }

  onMouseMove(e, ctx) {
    const mode = e.ctrlKey || ctx.input._ctrlDown
      ? 'run' : (e.shiftKey || ctx.input._shiftDown ? 'interior' : 'tile');
    this._renderPreview(e.clientX, e.clientY, ctx, mode);
    return true;
  }

  onClick(e, ctx) {
    this._commitPaint(e, ctx);
    return true;
  }

  _commitPaint(e, ctx) {
    const run = e.ctrlKey || ctx.input._ctrlDown;
    const shift = e.shiftKey || ctx.input._shiftDown;
    const { path } = run
      ? this._runSelectionAt(e.clientX, e.clientY, ctx)
      : this._selectionAt(e.clientX, e.clientY, ctx, shift);
    ctx.game.runUndoableMutation(() => ctx.game.batchEvents(() => {
      for (const edge of path) this._paint(edge, ctx);
    }));
  }

  onMouseDown(e, ctx) {
    if (e.button !== 0 || !(e.ctrlKey || ctx.input._ctrlDown)) return false;
    this._ctrlClickPending = true;
    return true;
  }

  onMouseUp(e, ctx) {
    if (!this._ctrlClickPending) return false;
    this._ctrlClickPending = false;
    this._commitPaint(e, ctx);
    return true;
  }

  onRightClick(e, ctx) {
    const { path } = this._selectionAt(
      e.clientX,
      e.clientY,
      ctx,
      e.shiftKey || ctx.input._shiftDown,
    );
    ctx.game.runUndoableMutation(() => ctx.game.batchEvents(() => {
      for (const edge of path) this._paint(edge, ctx, null);
    }));
    return true;
  }

  onShiftChange(down, ctx) {
    const input = ctx.input;
    if (input._lastScreenX == null) return;
    this._renderPreview(input._lastScreenX, input._lastScreenY, ctx,
      down ? 'interior' : 'tile');
  }

  onCtrlChange(down, ctx) {
    const input = ctx.input;
    if (input._lastScreenX == null) return;
    this._renderPreview(input._lastScreenX, input._lastScreenY, ctx,
      down ? 'run' : (input._shiftDown ? 'interior' : 'tile'));
  }

  onExit(ctx) {
    this._selectionCache = null;
    this._ctrlClickPending = false;
    ctx.renderer.clearDragPreview();
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
    // Ctrl: this gesture clears the run (or the smart selection, with
    // Shift also held) instead of drawing it.
    this._erasing = false;
  }

  onExit(ctx) {
    this._drawing = false;
    this._start = null;
    this._path = [];
    this._shiftPending = false;
    this._shiftDragStart = null;
    this._shiftStartScreen = null;
    this._smartCache = null;
    this._erasing = false;
    ctx.renderer.clearDragPreview();
    ctx.input._hideDragCostTooltip();
    ctx.input._hideTooltip?.();
    ctx.input._hideDemolishTooltip?.();
  }

  /**
   * 'overlay' for a wall type that layers onto an existing wall (copper
   * cladding and friends), 'wall' otherwise. Erase must undo what THIS tool
   * places: an overlay tool peels its own layer and leaves the host standing,
   * where removeWall would take both.
   */
  _eraseKind() { return WALL_TYPES[this.wallType]?.wallOverlay ? 'overlay' : 'wall'; }

  _eraseNoun() { return this._eraseKind() === 'overlay' ? 'wall layer' : 'wall segment'; }

  /** Commit an erase along `path`, mirroring placeWallPath's undo/batching. */
  _commitErase(ctx, path) {
    const game = ctx.game;
    const overlay = this._eraseKind() === 'overlay';
    // _batchEvents for the same reason the demolish edge-drag does it: each
    // removal emits 'wallsChanged', and every one of those is a full
    // WallBuilder teardown + rebuild of every wall on the map.
    game._withUndo(() => game._batchEvents(() => {
      for (const pt of path) {
        if (overlay) game._removeWallOverlay(pt.col, pt.row, pt.edge, activeLevel(game));
        else game.removeWall(pt.col, pt.row, pt.edge, activeLevel(game));
      }
    }));
  }

  /**
   * Paint the gesture's path: placement ghost + cost, or demolish red +
   * refund. `screenX == null` renders without touching the tooltip (the
   * press itself has never quoted a price).
   */
  _preview(ctx, path, screenX = null, screenY = null, selection = null) {
    if (this._erasing) {
      ctx.renderer.renderDemolishPathPreview(path);
      if (screenX != null) {
        showEdgePathEraseQuote(ctx, this._eraseKind(), path, screenX, screenY, this._eraseNoun());
      }
      return;
    }
    ctx.renderer.renderWallPreview(path, this.wallType);
    if (screenX != null) this._showCost(ctx, path, screenX, screenY, selection);
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
        if (!findWallKey(occupied, pt.col, pt.row, pt.edge, activeLevel(ctx.game))) continue;
        const overlayKey = findEdgeKey(
          overlays, pt.col, pt.row, pt.edge, activeLevel(ctx.game),
        );
        if (overlayKey && overlays[overlayKey] === this.wallType) continue;
        count++;
        continue;
      }
      const key = findWallKey(occupied, pt.col, pt.row, pt.edge, activeLevel(ctx.game));
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
    const occupied = floorView(ctx.game);
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
      // The erase modifier has no palette affordance of its own, and the
      // resting hover is the only moment there is room to name it.
      { title, detail: `${detail} · CTRL: erase` },
      screenX,
      screenY,
    );
    return selection;
  }

  onMouseDown(e, ctx) {
    if (e.button !== 0) return false;
    const input = ctx.input;
    input._hideTooltip?.();
    this._erasing = eraseHeld(e, input);
    if (input._shiftDown) {
      const edge = input._getNearestFloorEdge(e.clientX, e.clientY);
      const selection = this._smartSelection(ctx, edge);
      // A click commits the smart selection — with Ctrl also held, it clears
      // that whole boundary instead. Moving far enough converts this into an
      // ordinary straight wall drag starting from the raw edge.
      this._shiftPending = true;
      this._shiftDragStart = input._getNearestEdge(e.clientX, e.clientY);
      this._shiftStartScreen = { x: e.clientX, y: e.clientY };
      this._path = selection.path;
      this._preview(ctx, this._path, e.clientX, e.clientY, selection);
      return true;
    }
    const edge = input._getNearestFloorEdge(e.clientX, e.clientY);
    this._drawing = true;
    this._start = edge;
    this._path = [edge];
    this._preview(ctx, this._path);
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
      this._preview(ctx, this._path, e.clientX, e.clientY);
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
        this._preview(ctx, this._path, e.clientX, e.clientY);
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
    this._erasing = eraseHeld(e, input);
    if (input._shiftDown) {
      input._hideTooltip?.();
      const selection = this._smartSelection(ctx, edge);
      this._preview(ctx, selection.path, e.clientX, e.clientY, selection);
    } else if (this._erasing) {
      // The shift hover hint advertises drawing; under Ctrl this edge is
      // about to be cleared, so quote the refund instead.
      input._hideTooltip?.();
      renderer.renderDemolishEdgeOutline(edge.col, edge.row, edge.edge);
      showEdgeEraseHover(ctx, this._eraseKind(), edge, e.clientX, e.clientY,
        this._eraseKind() === 'overlay' ? 'No wall layer here' : 'No wall here');
    } else {
      input._hideDragCostTooltip();
      input._hideDemolishTooltip?.();
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
        if (this._erasing) this._commitErase(ctx, this._path);
        else game._withUndo(() => game.placeWallPath(
          this._path, this.wallType, this.variant, activeLevel(game),
        ));
      }
      this._shiftPending = false;
      this._shiftDragStart = null;
      this._shiftStartScreen = null;
      this._path = [];
      ctx.renderer.clearDragPreview();
      ctx.input._hideDragCostTooltip();
      ctx.input._hideDemolishTooltip?.();
      return true;
    }
    if (this._drawing && this._path.length > 0) {
      if (this._erasing) this._commitErase(ctx, this._path);
      else game._withUndo(() => game.placeWallPath(
        this._path, this.wallType, this.variant, activeLevel(game),
      ));
      this._drawing = false;
      this._path = [];
      this._start = null;
      ctx.renderer.clearDragPreview();
      ctx.input._hideDragCostTooltip();
      ctx.input._hideDemolishTooltip?.();
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
    ctx.game._withUndo(() => ctx.game.removeWall(
      edge.col, edge.row, edge.edge, activeLevel(ctx.game),
    ));
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
      this._preview(ctx, selection.path, input._lastScreenX, input._lastScreenY, selection);
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
        if (this._erasing) {
          renderer.renderDemolishEdgeOutline(edge.col, edge.row, edge.edge);
          showEdgeEraseHover(ctx, this._eraseKind(), edge,
            input._lastScreenX, input._lastScreenY,
            this._eraseKind() === 'overlay' ? 'No wall layer here' : 'No wall here');
          return;
        }
        renderer.renderWallEdgeHighlight(edge.col, edge.row, edge.edge);
        this._showShiftHoverHint(ctx, edge, input._lastScreenX, input._lastScreenY);
      }
    }
  }

  onCtrlChange(down, ctx) {
    // A gesture in flight keeps the intent it was pressed with; only the
    // hover preview flips under a stationary cursor. Shift still decides
    // WHAT is previewed (smart selection vs. single edge) — Ctrl only
    // decides whether that geometry is drawn or cleared.
    const input = ctx.input;
    const renderer = ctx.renderer;
    if (this._drawing || this._shiftPending) return;
    if (input._lastScreenX == null) return;
    this._erasing = down;
    const edge = input._getNearestFloorEdge(input._lastScreenX, input._lastScreenY);
    if (input._shiftDown) {
      input._hideTooltip?.();
      const selection = this._smartSelection(ctx, edge);
      this._preview(ctx, selection.path, input._lastScreenX, input._lastScreenY, selection);
      return;
    }
    if (down) {
      input._hideTooltip?.();
      renderer.renderDemolishEdgeOutline(edge.col, edge.row, edge.edge);
      showEdgeEraseHover(ctx, this._eraseKind(), edge,
        input._lastScreenX, input._lastScreenY,
        this._eraseKind() === 'overlay' ? 'No wall layer here' : 'No wall here');
      return;
    }
    input._hideDemolishTooltip?.();
    renderer.renderWallEdgeHighlight(edge.col, edge.row, edge.edge);
    this._showShiftHoverHint(ctx, edge, input._lastScreenX, input._lastScreenY);
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
    // Ctrl: this drag clears the doors along the run instead of hanging
    // them.
    this._erasing = false;
  }

  onExit(ctx) {
    this._drawing = false;
    this._start = null;
    this._path = [];
    this._off = null;
    this._erasing = false;
    ctx.renderer.clearDragPreview();
    ctx.input._hideDragCostTooltip();
    ctx.input._hideDemolishTooltip?.();
  }

  // Off-canvas release / focus loss: drop the drag without committing.
  cancelGesture(ctx) { this.onExit(ctx); }

  /**
   * Subtile offset of the opening for the edge under the cursor.
   * _getNearestWallEdge hands back a raw along-edge fraction (it can't know
   * how wide this door is); doorOffFromFrac selects the cursor's tile half.
   * Quantizing here rather than in
   * _getNearestWallEdge keeps the door-width knowledge on the tool, which is
   * the only place that knows which door is armed.
   */
  _offFor(edge) {
    return doorOffFromFrac(edge?.frac, DOOR_TYPES[this.doorType]);
  }

  _pathFor(input, start, end) {
    const span = doorTileSpan(DOOR_TYPES[this.doorType]);
    if (span === 1) return input._buildWallLine(start, end);
    const horizontal = start.edge === 'n' || start.edge === 's';
    const delta = horizontal ? (end?.col ?? start.col) - start.col : (end?.row ?? start.row) - start.row;
    return doorSpanPath(start, span, delta < 0 ? -1 : 1);
  }

  /** Placement ghost + no quote, or demolish red + refund. */
  _preview(ctx, path, screenX = null, screenY = null) {
    if (this._erasing) {
      ctx.renderer.renderDemolishPathPreview(path);
      if (screenX != null) {
        showEdgePathEraseQuote(ctx, 'door', path, screenX, screenY, 'door');
      }
      return;
    }
    ctx.renderer.renderDoorPreview(path, this.doorType);
  }

  onMouseDown(e, ctx) {
    if (e.button !== 0) return false;
    const edge = ctx.input._getNearestWallEdge(e.clientX, e.clientY);
    this._off = this._offFor(edge);
    this._erasing = eraseHeld(e, ctx.input);
    this._drawing = true;
    this._start = edge;
    this._path = this._pathFor(ctx.input, edge, edge)
      .map(pt => ({ ...pt, off: this._off }));
    this._preview(ctx, this._path);
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
      this._path = this._pathFor(input, this._start, edge)
        .map(pt => ({ ...pt, off: this._off }));
      this._preview(ctx, this._path, e.clientX, e.clientY);
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
    this._erasing = eraseHeld(e, input);
    if (this._erasing) {
      this._previewEraseHover(ctx, edge, e.clientX, e.clientY);
    } else {
      input._hideDemolishTooltip?.();
      renderer.renderWallEdgeHighlight(edge.col, edge.row, edge.edge);
    }
    if (input._hoverTooltipTarget) input._hideTooltip();
    return true;
  }

  _previewEraseHover(ctx, edge, screenX, screenY) {
    ctx.renderer.renderDemolishEdgeOutline(edge.col, edge.row, edge.edge);
    showEdgeEraseHover(ctx, 'door', edge, screenX, screenY, 'No door here');
  }

  onMouseUp(e, ctx) {
    // Only the left button commits a drag. A right release mid-drag used to
    // run this commit path (onMouseDown guards `e.button !== 0`, onMouseUp
    // did not), firing the gesture early AND consuming the event so
    // right-click-to-deselect never ran.
    if (e.button !== 0) return false;
    if (this._drawing && this._path.length > 0) {
      if (this._erasing) {
        // Batched like placeDoorPath: each removeDoor emits 'wallsChanged',
        // and every one of those rebuilds the map's walls.
        ctx.game._withUndo(() => ctx.game._batchEvents(() => {
          for (const pt of this._path) {
            ctx.game.removeDoor(pt.col, pt.row, pt.edge, activeLevel(ctx.game));
          }
        }));
      } else {
        // Each path point carries its own `off`; this._off is the fallback.
        ctx.game._withUndo(
          () => ctx.game.placeDoorPath(
            this._path, this.doorType, this.variant, this._off, activeLevel(ctx.game),
          )
        );
      }
      this._drawing = false;
      this._start = null;
      this._path = [];
      ctx.renderer.clearDragPreview();
      ctx.input._hideDemolishTooltip?.();
      return true;
    }
    return false;
  }

  onRightClick(_e, ctx) {
    // Keep the door tool armed so a player can correct openings directly.
    // `removeDoor` is alias-aware, matching the wall-facing placement snap.
    // (InputHandler withholds this while Ctrl is held — see the macOS
    // Ctrl+left-click collision there.)
    const edge = ctx.input._getNearestWallEdge(_e.clientX, _e.clientY);
    if (!edge) return false;
    ctx.game._withUndo(() => ctx.game.removeDoor(
      edge.col, edge.row, edge.edge, activeLevel(ctx.game),
    ));
    return true;
  }

  onCtrlChange(down, ctx) {
    const input = ctx.input;
    if (this._drawing) return;
    if (input._lastScreenX == null) return;
    this._erasing = down;
    const edge = input._getNearestWallEdge(input._lastScreenX, input._lastScreenY);
    if (!edge) return;
    if (down) {
      this._previewEraseHover(ctx, edge, input._lastScreenX, input._lastScreenY);
      return;
    }
    input._hideDemolishTooltip?.();
    ctx.renderer.renderWallEdgeHighlight(edge.col, edge.row, edge.edge);
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
    this._off = null;
    // Ctrl: this drag clears the windows along the run.
    this._erasing = false;
  }

  onExit(ctx) {
    this._drawing = false;
    this._start = null;
    this._path = [];
    this._off = null;
    this._erasing = false;
    ctx.renderer.clearDragPreview();
    ctx.input._hideDragCostTooltip();
    ctx.input._hideDemolishTooltip?.();
  }

  // Off-canvas release / focus loss: drop the drag without committing.
  cancelGesture(ctx) { this.onExit(ctx); }

  _offFor(edge) {
    return windowOffFromFrac(edge?.frac, WINDOW_TYPES[this.windowType]);
  }

  // Keep the ghost honest before the click: this mirrors Game.placeWindow's
  // wall/height/funding gates, including the free same-type repaint case.
  _previewStatus(game, edge) {
    const def = WINDOW_TYPES[this.windowType];
    if (!def || !edge) return { valid: false, reason: 'Unknown window type' };
    const level = activeLevel(game);
    const key = edgeKey(edge.col, edge.row, edge.edge, level);
    const alias = game._edgeAlias(edge.col, edge.row, edge.edge);
    const aliasKey = edgeKey(alias.col, alias.row, alias.edge, level);
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

  _renderPreview(ctx, path, screenX = null, screenY = null) {
    if (this._erasing) {
      ctx.renderer.renderDemolishPathPreview(path);
      if (screenX != null) {
        showEdgePathEraseQuote(ctx, 'window', path, screenX, screenY, 'window');
      }
      return;
    }
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
    this._off = this._offFor(edge);
    this._erasing = eraseHeld(e, ctx.input);
    this._drawing = true;
    this._start = edge;
    this._path = [{ ...edge, off: this._off }];
    this._renderPreview(ctx, this._path);
    return true;
  }

  onMouseMove(e, ctx) {
    const input = ctx.input;
    const renderer = ctx.renderer;
    const edge = input._getNearestWallEdge(e.clientX, e.clientY);
    if (this._drawing) {
      if (edge && edge.edge === this._start.edge) this._off = this._offFor(edge);
      this._path = input._buildWallLine(this._start, edge)
        .map(pt => ({ ...pt, off: this._off }));
      this._renderPreview(ctx, this._path, e.clientX, e.clientY);
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
    this._off = this._offFor(edge);
    this._erasing = eraseHeld(e, input);
    if (this._erasing) {
      this._previewEraseHover(ctx, edge, e.clientX, e.clientY);
    } else {
      input._hideDemolishTooltip?.();
      // Unlike the old tiny crosshair, hovering a window tool renders the
      // actual framed opening snapped to the nearest real wall.
      this._renderPreview(ctx, [{ ...edge, off: this._off }]);
    }
    if (input._hoverTooltipTarget) input._hideTooltip();
    return true;
  }

  _previewEraseHover(ctx, edge, screenX, screenY) {
    ctx.renderer.renderDemolishEdgeOutline(edge.col, edge.row, edge.edge);
    showEdgeEraseHover(ctx, 'window', edge, screenX, screenY, 'No window here');
  }

  /**
   * Windows are the one edge family whose mutator is NOT alias-aware:
   * placeWindow accepts a wall found under either representation but stores
   * the window under the key it was handed, so a run redrawn from the far
   * side addresses the mirrored triple. Try the other spelling before
   * giving up (the same belt _removeWallAndDoorAtEdge's comment describes).
   */
  _removeWindowAt(game, pt) {
    const level = activeLevel(game);
    if (game.removeWindow(pt.col, pt.row, pt.edge, level)) return true;
    const alias = game._edgeAlias(pt.col, pt.row, pt.edge);
    return game.removeWindow(alias.col, alias.row, alias.edge, level);
  }

  onMouseUp(e, ctx) {
    // Only the left button commits a drag. A right release mid-drag used to
    // run this commit path (onMouseDown guards `e.button !== 0`, onMouseUp
    // did not), firing the gesture early AND consuming the event so
    // right-click-to-deselect never ran.
    if (e.button !== 0) return false;
    if (this._drawing && this._path.length > 0) {
      if (this._erasing) {
        // Batched like placeWindowPath: each removeWindow emits its own
        // renderer rebuild otherwise.
        ctx.game._withUndo(() => ctx.game._batchEvents(() => {
          for (const pt of this._path) this._removeWindowAt(ctx.game, pt);
        }));
      } else {
        ctx.game._withUndo(
          () => ctx.game.placeWindowPath(
            this._path, this.windowType, this.variant, this._off, activeLevel(ctx.game),
          )
        );
      }
      this._drawing = false;
      this._start = null;
      this._path = [];
      ctx.renderer.clearDragPreview();
      ctx.input._hideDemolishTooltip?.();
      return true;
    }
    return false;
  }

  onRightClick(_e, ctx) {
    // Right-click deselects, like every sibling structure tool. (InputHandler
    // withholds this while Ctrl is held — see the macOS Ctrl+left-click
    // collision there.)
    ctx.input.clearTool();
    return true;
  }

  onCtrlChange(down, ctx) {
    const input = ctx.input;
    if (this._drawing) return;
    if (input._lastScreenX == null) return;
    this._erasing = down;
    const edge = input._getNearestWallEdge(input._lastScreenX, input._lastScreenY);
    if (!edge) return;
    if (down) {
      this._previewEraseHover(ctx, edge, input._lastScreenX, input._lastScreenY);
      return;
    }
    input._hideDemolishTooltip?.();
    this._off = this._offFor(edge);
    this._renderPreview(ctx, [{ ...edge, off: this._off }]);
  }
}
