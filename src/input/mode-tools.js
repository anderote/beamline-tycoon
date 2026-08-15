// src/input/mode-tools.js
//
// Tool objects for the pick-up-and-carry and inspection input modes:
//
//   - MoveTool ('p'): click to lift a placed object, click again to drop
//     it. Carrying arms the unified placeable preview (the carried type is
//     exposed through armedPlaceableId) so the standard ghost + R/F
//     rotation work; ESC / tool switch restores a lifted item to its
//     origin. Carried decorations keep the shift+drag line-place gesture,
//     so the legacy duplicate line-place branches in InputHandler could
//     finally be deleted.
//   - ProbeTool ('u'): click beamline nodes to pin probes; clicking a
//     utility line still opens its inspector (legacy dispatch order).
//
// These replaced the legacy move-mode/probe-mode flag fields.
// The heavyweight move helpers (_pickUpAt, _placeMovedObject,
// _updateMoveHover, _armMovePreview) stay on InputHandler — they lean on
// its raycast/subgrid lookups — and take the payload as an argument.

import { Tool } from './Tool.js';
import { PLACEABLES } from '../data/placeables/index.js';
import { isoToGrid } from '../renderer/grid.js';

export class MoveTool extends Tool {
  constructor() {
    super('move', 'move');
    this.cursor = 'grab';
    this.payload = null; // { kind: 'component'|'placeable', ... } while carrying
  }

  // While carrying, the carried type arms the unified placeable preview.
  get armedPlaceableId() {
    return this.payload?.kind === 'selectionGroup' ? null : (this.payload?.type ?? null);
  }

  onEnter(ctx) {
    ctx.input._showToast('Move mode (click to pick up, ESC to exit)');
  }

  onExit(ctx) {
    const input = ctx.input;
    // Cancel a mid-gesture line placement of the carried decoration.
    if (input.isLinePlacingDecoration) {
      input.isLinePlacingDecoration = false;
      input.linePlaceStartWorld = null;
      input.linePlaceHovers = [];
      ctx.renderer.clearDragPreview();
    }
    this._restoreCarried(ctx);
    input.hoverPlaceable = null;
    input.selectionGroupPreview = null;
    ctx.renderer._clearPreview();
    input._showToast('Move mode off');
  }

  /**
   * Put a still-carried lifted placeable back where it came from and clear
   * the carry. `_pickUpAt` removes the object from state.placeables and the
   * payload is the ONLY surviving copy, so every path that ends a carry
   * without dropping it has to come through here.
   *
   * Beamline components are never lifted (they stay in place during move),
   * so there is nothing to restore for the 'component' kind.
   */
  _restoreCarried(ctx) {
    if (this.payload && this.payload.kind === 'placeable') {
      const p = this.payload;
      ctx.game.placePlaceable({
        type: p.type,
        col: p.originCol, row: p.originRow,
        subCol: p.originSubCol, subRow: p.originSubRow,
        dir: p.originDir,
        wallMount: p.originWallMount,
        params: p.params,
        variant: p.variant,
        free: true,
        silent: true,
      });
    }
    this.payload = null;
  }

  onMouseDown(e, ctx) {
    const input = ctx.input;
    // Shift + left drag while carrying a decoration: line-place copies
    // (same gesture as PlaceableTool — carrying arms the unified preview).
    if (e.button === 0 && e.shiftKey && this.payload) {
      const pl = PLACEABLES[this.payload.type];
      if (pl && pl.kind === 'decoration' && pl.mount !== 'wall') {
        const world = ctx.renderer.screenToWorld(e.clientX, e.clientY);
        input.isLinePlacingDecoration = true;
        input.linePlaceStartWorld = { x: world.x, y: world.y };
        input._updateLinePlacePreview(world.x, world.y);
        e.preventDefault?.();
        return true;
      }
    }
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
    const world = renderer.screenToWorld(e.clientX, e.clientY);
    const grid = isoToGrid(world.x, world.y);
    renderer.updateHover(grid.col, grid.row);
    input.lastMouseWorldX = world.x;
    input.lastMouseWorldY = world.y;
    input._lastScreenX = e.clientX;
    input._lastScreenY = e.clientY;
    if (this.payload?.kind === 'selectionGroup') {
      input._updateSelectionGroupPreview(this.payload);
      input._checkHoverTooltip(world, grid, e.clientX, e.clientY);
      return true;
    }
    // Carried ghost: keep the unified preview in sync (stackable items use
    // the surface-aware raycast, mirroring the shared hover branch).
    let placeWorld = world;
    if (this.payload) {
      const selDef = PLACEABLES[this.payload.type];
      if (selDef?.stackable && typeof renderer.screenToPlacementWorld === 'function') {
        placeWorld = renderer.screenToPlacementWorld(e.clientX, e.clientY);
      }
    }
    input.lastMouseWorldX = placeWorld.x;
    input.lastMouseWorldY = placeWorld.y;
    input._updatePlaceablePreview();
    // Not carrying: outline what a click would pick up.
    if (!this.payload) {
      input._updateMoveHover(grid, e.clientX, e.clientY);
    }
    // Hover tooltips stayed live in move mode (the legacy guard never
    // covered it) — preserve that.
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
    return false;
  }

  onClick(e, ctx) {
    const input = ctx.input;
    const world = ctx.renderer.screenToWorld(e.clientX, e.clientY);
    const grid = isoToGrid(world.x, world.y);
    if (this.payload) {
      if (this.payload.kind === 'selectionGroup') {
        const placed = input._placeSelectionGroup(this.payload);
        if (placed && this.payload.operation === 'move') {
          this.payload = null;
          input.selectionGroupPreview = null;
          ctx.renderer._clearPreview();
          ctx.renderer.canvas.style.cursor = 'grab';
        } else if (placed) {
          // Copy stays armed so several identical groups can be stamped. The
          // just-used destination now previews as blocked until the cursor
          // moves elsewhere.
          input._updateSelectionGroupPreview(this.payload);
        }
        return true;
      }
      // Carrying — try to drop. Stay in move mode on success so the user
      // can keep clicking to move more things.
      if (input._placeMovedObject(this.payload, grid.col, grid.row)) {
        this.payload = null;
        input.hoverPlaceable = null;
        ctx.renderer._clearPreview();
        ctx.renderer.canvas.style.cursor = 'grab';
      }
      return true;
    }
    // Not carrying — try to pick up.
    const picked = input._pickUpAt(grid.col, grid.row, e.clientX, e.clientY);
    if (picked) {
      this.payload = picked;
      input.selectedPlaceableVariant = picked.variant ?? 0;
      input._armMovePreview(picked.type, picked.dir);
      ctx.renderer.canvas.style.cursor = 'grabbing';
    }
    return true;
  }

  /**
   * End the carry without dropping it. Which half runs depends on `reason`:
   *
   * - 'stateReplaced' (undo/redo): the lift that put the object in `payload`
   *   was itself captured as an undo snapshot, so the restore puts it back in
   *   the world. Keep carrying it and the next drop mints a free duplicate —
   *   so drop the carry WITHOUT re-placing it.
   * - 'abort' (window blur, tab hide, pointercancel, mouseup off-canvas —
   *   i.e. clicking any HUD chrome mid-carry): nothing touches game state, so
   *   dropping the payload silently deleted the object, unrefunded and with
   *   no toast. Restore it, exactly as onExit does.
   */
  cancelGesture(ctx, reason) {
    if (!this.payload) return;
    if (reason === 'stateReplaced') this.payload = null;
    else this._restoreCarried(ctx);
    ctx.input.hoverPlaceable = null;
    ctx.input.selectionGroupPreview = null;
    ctx.input.isLinePlacingDecoration = false;
    ctx.renderer._clearPreview?.();
    ctx.renderer.canvas.style.cursor = 'grab';
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

export class ProbeTool extends Tool {
  constructor() {
    super('probe', 'probe');
  }

  onEnter(ctx) {
    ctx.renderer.setProbeMode(true);
  }

  onExit(ctx) {
    ctx.renderer.setProbeMode(false);
  }

  // No onMouseMove: hover falls through to the generic branch (cursor
  // update + hover tooltips), matching the legacy probe-mode behavior.

  onClick(e, ctx) {
    const input = ctx.input;
    const renderer = ctx.renderer;
    // Utility-line click-to-inspect ran before the probe branch in the
    // legacy dispatch order — preserve it.
    if (typeof renderer.raycastUtilityLine === 'function') {
      const hit = renderer.raycastUtilityLine(e.clientX, e.clientY);
      if (hit && hit.lineId && input._openUtilityInspectorForLine(hit.lineId)) {
        return true;
      }
    }
    const world = renderer.screenToWorld(e.clientX, e.clientY);
    const grid = isoToGrid(world.x, world.y);
    const node = input._getNodeAtGrid(grid.col, grid.row);
    if (node && renderer.onProbeClick) {
      renderer.onProbeClick(node);
    }
    return true;
  }
}
