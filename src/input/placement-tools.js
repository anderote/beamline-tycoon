// src/input/placement-tools.js
//
// Tool objects for the simple placement families:
//
//   - PlaceableTool: unified-placeable placement — facility equipment,
//     zone furnishings, and decorations (incl. shift+drag line placing).
//     All three commit through game.placePlaceable via the shared
//     hoverPlaceable preview that InputHandler._updatePlaceablePreview
//     maintains, so one parametrized tool covers the whole family.
//   - ZonePaintTool: the facility zone paint brush (click or drag-rect,
//     auto-floors via placeFacilityZoneBrushRect/Tile).
//
// These replaced the legacy per-family selection fields and their manual
// cross-deselect webs. Behavior is intentionally identical to the legacy
// branches they superseded; the heavy lifting stays in shared InputHandler
// helpers (_updatePlaceablePreview, _commitHoverPlaceable,
// _updateLinePlacePreview, _finishLinePlaceDecoration) that BeamlineTool
// and MoveTool also use.

import { Tool } from './Tool.js';
import { canAffordFunding } from '../game/affordability.js';
import { ZONES } from '../data/facility.js';
import { PLACEABLES } from '../data/placeables/index.js';
import { isoToGrid } from '../renderer/grid.js';

/**
 * Placement of a unified placeable (facility equipment / furnishing /
 * decoration). `family` records which palette family armed it; `key` is the
 * PLACEABLES/COMPONENTS id; `variant` is the color/style variant index.
 * The variant belongs to the armed tool: it is written on every arm, so a
 * swatch chosen for one item can never ride along into the next one.
 */
export class PlaceableTool extends Tool {
  constructor(family, key, variant = 0) {
    super(`${family}:${key}`, 'placeable');
    this.family = family; // 'facility' | 'furnishing' | 'decoration'
    this.key = key;
    this.variant = variant | 0;
  }

  // Arms the unified placeable preview/commit path.
  get armedPlaceableId() { return this.key; }

  onEnter(ctx) {
    ctx.input.selectedPlaceableVariant = this.variant;
    // Mirroring is placement-local. A newly armed object always starts from
    // its authored utility-port layout; repeated stamps keep the M choice.
    ctx.input.placementPortsFlipped = false;
  }

  onExit(ctx) {
    const input = ctx.input;
    // Cancel a mid-gesture shift+drag line placement without committing.
    if (input.isLinePlacingDecoration) {
      input.isLinePlacingDecoration = false;
      input.linePlaceStartWorld = null;
      input.linePlaceHovers = [];
      ctx.renderer.clearDragPreview();
    }
  }

  onMouseDown(e, ctx) {
    const input = ctx.input;
    // Shift + left drag: line-place decorations (trees, shrubs, bollards).
    // Spaces copies along the drag vector at ~footprint intervals.
    if (e.button === 0 && e.shiftKey) {
      const pl = PLACEABLES[this.key];
      if (pl && pl.kind === 'decoration' && pl.mount !== 'wall') {
        const world = ctx.renderer.screenToWorld(e.clientX, e.clientY);
        input.isLinePlacingDecoration = true;
        input.linePlaceStartWorld = { x: world.x, y: world.y };
        input._updateLinePlacePreview(world.x, world.y);
        e.preventDefault?.();
        return true;
      }
    }
    // Plain press: nothing to do here — the commit runs on click (mouseup).
    return false;
  }

  onMouseMove(e, ctx) {
    const input = ctx.input;
    const renderer = ctx.renderer;
    if (input.isLinePlacingDecoration) {
      const world = renderer.screenToWorld(e.clientX, e.clientY);
      input._updateLinePlacePreview(world.x, world.y);
      return true;
    }
    // Hover: keep the shared hover bookkeeping in sync, then render the
    // unified placeable ghost (mirrors the legacy shared mousemove branch).
    const world = renderer.screenToWorld(e.clientX, e.clientY);
    const grid = isoToGrid(world.x, world.y);
    renderer.updateHover(grid.col, grid.row);
    // For stackable items, use the surface-aware raycast so hovering a desk
    // or a stacked object targets that surface instead of the floor subtile.
    let placeWorld = world;
    const selDef = PLACEABLES[this.key];
    if (selDef?.stackable && typeof renderer.screenToPlacementWorld === 'function') {
      placeWorld = renderer.screenToPlacementWorld(e.clientX, e.clientY);
    }
    input.lastMouseWorldX = placeWorld.x;
    input.lastMouseWorldY = placeWorld.y;
    input._lastScreenX = e.clientX;
    input._lastScreenY = e.clientY;
    input._updatePlaceablePreview();
    // The legacy branch still showed hover tooltips for furnishings /
    // equipment while a placeable was armed (the old tooltip guard never
    // covered armed placeables) — preserve that.
    input._checkHoverTooltip(world, grid, e.clientX, e.clientY);
    return true;
  }

  onMouseUp(e, ctx) {
    // Only the left button commits a drag. A right release mid-drag used to
    // run this commit path (onMouseDown guards `e.button !== 0`, onMouseUp
    // did not), firing the gesture early AND consuming the event so
    // right-click-to-deselect never ran.
    if (e.button !== 0) return false;
    const input = ctx.input;
    if (input.isLinePlacingDecoration) {
      input._finishLinePlaceDecoration();
      return true;
    }
    // Plain release falls through to _handleClick → onClick.
    return false;
  }

  // Off-canvas release / focus loss: drop the line-place without committing.
  cancelGesture(ctx) {
    this.onExit(ctx);
  }

  onClick(e, ctx) {
    // Commit at the hovered snap. Shared with the legacy beamline-module
    // path; returns false when there is no hover ghost so the click can
    // fall through to selection/inspection.
    return ctx.input._commitHoverPlaceable(e.clientX, e.clientY);
  }

  onKey(e, ctx) {
    const input = ctx.input;
    // Shift+Z / Shift+X while line-placing: adjust spacing one sub-unit.
    if (input.isLinePlacingDecoration && e.shiftKey
        && (e.key === 'z' || e.key === 'Z' || e.key === 'x' || e.key === 'X')) {
      e.preventDefault();
      input._adjustLinePlaceSpacing((e.key === 'x' || e.key === 'X') ? 1 : -1);
      return true;
    }
    return false;
  }
}

/**
 * Facility zone paint brush. Click paints one tile; drag paints a rect.
 * Both go through the auto-flooring brush (placeFacilityZoneBrushRect /
 * placeFacilityZoneBrushTile) with a live cost tooltip during the drag.
 * Drag state is tool-local so it can't cross-talk with the legacy
 * isDragging/dragStart fields still used by the infra/demolish families.
 */
export class ZonePaintTool extends Tool {
  constructor(zoneType) {
    super(`zone:${zoneType}`, 'zone');
    this.zoneType = zoneType;
    this._dragging = false;
    this._dragStart = null; // { col, row }
    this._dragEnd = null;   // { col, row }
  }

  onExit(ctx) {
    this._dragging = false;
    this._dragStart = null;
    this._dragEnd = null;
    ctx.renderer.clearDragPreview();
    ctx.input._hideDragCostTooltip();
  }

  _showCost(ctx, e, c0, r0, c1, r1) {
    const cost = ctx.game.computeFacilityBrushCost(
      c0, r0, c1, r1, this.zoneType, ctx.game.activeLevel,
    );
    ctx.input._showDragCostTooltip(cost.totalCost, e.clientX, e.clientY, {
      insufficientFunding: !canAffordFunding(ctx.game, cost.totalCost),
    });
  }

  onMouseDown(e, ctx) {
    if (e.button !== 0) return false;
    const world = ctx.renderer.screenToWorld(e.clientX, e.clientY);
    const grid = isoToGrid(world.x, world.y);
    this._dragging = true;
    this._dragStart = { col: grid.col, row: grid.row };
    this._dragEnd = { col: grid.col, row: grid.row };
    this._showCost(ctx, e, grid.col, grid.row, grid.col, grid.row);
    return true;
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
        grid.col, grid.row, this.zoneType, true,
      );
      this._showCost(ctx, e, this._dragStart.col, this._dragStart.row, grid.col, grid.row);
      return true;
    }
    // Hover: cross cursor tinted with the zone color.
    renderer.updateHover(grid.col, grid.row);
    const zone = ZONES[this.zoneType];
    renderer.renderInfraHoverCursor(grid.col, grid.row, zone?.color || 0xffffff);
    input.lastMouseWorldX = world.x;
    input.lastMouseWorldY = world.y;
    input._lastScreenX = e.clientX;
    input._lastScreenY = e.clientY;
    // Zone paint suppressed hover tooltips in the legacy guard — keep that.
    if (input._hoverTooltipTarget) input._hideTooltip();
    return true;
  }

  // Off-canvas release / focus loss: drop the rect drag without committing.
  cancelGesture(ctx) { this.onExit(ctx); }

  onMouseUp(e, ctx) {
    // Only the left button commits a drag. A right release mid-drag used to
    // run this commit path (onMouseDown guards `e.button !== 0`, onMouseUp
    // did not), firing the gesture early AND consuming the event before the
    // zone eraser could run.
    if (e.button !== 0) return false;
    if (!this._dragging || !this._dragStart || !this._dragEnd) return false;
    // _withUndo: a rect that changes nothing (all tiles already this zone,
    // insufficient funding) must not push undo or clobber redo.
    ctx.game._withUndo(() => ctx.game.placeFacilityZoneBrushRect(
      this._dragStart.col, this._dragStart.row,
      this._dragEnd.col, this._dragEnd.row,
      this.zoneType,
      ctx.game.activeLevel,
    ));
    this._dragging = false;
    this._dragStart = null;
    this._dragEnd = null;
    ctx.renderer.clearDragPreview();
    return true;
  }

  onClick(e, ctx) {
    // Single-tile fallback. Normally unreachable (mousedown starts a drag
    // and mouseup commits the rect), but kept for parity with the legacy
    // click branch in case the press was consumed elsewhere.
    const world = ctx.renderer.screenToWorld(e.clientX, e.clientY);
    const grid = isoToGrid(world.x, world.y);
    ctx.game._withUndo(() => {
      if (ctx.game.placeFacilityZoneBrushTile(
        grid.col, grid.row, this.zoneType, ctx.game.activeLevel,
      )) {
        ctx.game.emit('zonesChanged');
      }
    });
    return true;
  }

  onRightClick(e, ctx) {
    // The armed zone brush doubles as an eraser: right-click clears whichever
    // zone is under the cursor, regardless of the zone type currently selected.
    // Keep the brush armed so painting and corrections stay in one workflow.
    const world = ctx.renderer.screenToWorld(e.clientX, e.clientY);
    const grid = isoToGrid(world.x, world.y);
    ctx.game.runUndoableMutation(() => ctx.game.removeZoneTile(
      grid.col, grid.row, ctx.game.activeLevel,
    ));
    return true;
  }
}
