// src/input/demolish-tool.js
//
// DemolishTool: one Tool per demolish scope (demolishScopes.js remains the
// data backbone — DEMOLISH_PLACEABLE_SCOPE maps each demolishType to the
// placeable kinds it may delete; DEMOLISH_BUTTONS drives the palette).
//
//   - demolishBeamline / demolishUtility: click-on-object (raycast) delete.
//   - demolishBuilding: edge-first. Press on a wall/door/window edge starts
//     an edge-path drag (Shift+click deletes the whole connected run);
//     otherwise a tile-rect drag sweeps zones, floors, and wall/door/window
//     edges.
//   - demolishAll: catch-all — click or rect-drag levels everything.
//
// Replaced the legacy demolish-mode flag fields and
// selectDemolishTool/deselectDemolishTool. Hover UX (mesh outline + refund
// tooltip) lives in InputHandler._updateDemolishHover, shared verbatim from
// the legacy path; heavy lookup helpers (_findDeletablePlaceable,
// _findWallOrDoorAtEdge, _demolishEverythingAt, segment-path builders) stay
// on InputHandler.

import { Tool } from './Tool.js';
import { isoToGrid } from '../renderer/grid.js';
import { UTILITY_TYPES } from '../utility/registry.js';
import { DEMOLISH_PLACEABLE_SCOPE } from './demolishScopes.js';

// Beam pipes are the one demolish target that is cut by the SECTION rather
// than all-or-nothing: a press anchors a sweep at the 0.5 m sub-unit under the
// cursor, the drag widens it, and the release removes exactly that stretch —
// splitting the run in two when the cut lands in the middle. Shift-click still
// takes the whole pipe, matching the Shift-click whole-wall-run gesture below.
// The section maths lives on InputHandler (_demolishPipeSection) so the hover
// highlight and this commit path resolve the same stretch.

export class DemolishTool extends Tool {
  constructor(demolishType) {
    super(`demolish:${demolishType}`, 'demolish');
    this.demolishType = demolishType || 'demolishAll';
    this.cursor = 'crosshair';
    this._dragging = false;
    this._dragStart = null; // { col, row }
    this._dragEnd = null;   // { col, row }
    this._drawingEdges = false;
    this._edgeStart = null; // origin edge of the edge-path drag
    this._edgePath = [];    // [{ col, row, edge }]
    this._pipeSweep = null; // { pipeId, index } anchor of a pipe-section drag
    this._pressedDoorEdge = null; // catch-all click on visible raised door geometry
  }

  onExit(ctx) {
    this._dragging = false;
    this._dragStart = null;
    this._dragEnd = null;
    this._drawingEdges = false;
    this._edgeStart = null;
    this._edgePath = [];
    this._pipeSweep = null;
    this._pressedDoorEdge = null;
    ctx.renderer.clearDragPreview();
    ctx.input._hideDemolishTooltip();
  }

  onKey(e, ctx) {
    if (e.key === 'Escape') {
      // In the full demolish mode Esc restores the previous menu; a
      // context-armed demolish (mode unchanged) just disarms. (Moved here
      // from the legacy InputHandler Escape ladder — the special case is
      // this tool's own behavior now.)
      const input = ctx.input;
      if (input.activeMode === 'demolish') {
        input._restorePreviousMode();
      } else {
        input.clearTool();
        input._hidePreview();
      }
      return true;
    }
    return false;
  }

  onMouseDown(e, ctx) {
    if (e.button !== 0) return false;
    const input = ctx.input;
    const game = ctx.game;
    if (this.demolishType === 'demolishBuilding') {
      // Edge-first: starting on a wall/door edge begins an edge-path drag
      // (removes walls AND doors along the path); otherwise fall through to
      // the tile-rect drag below.
      const found = input.findDemolishableEdgeAtScreen(e.clientX, e.clientY);
      if (found) {
        if (input._shiftDown) {
          // Shift-click: delete the whole connected run at once.
          const segment = found.overlayType
            ? input._buildWallOverlaySegmentPath(found.edge)
            : found.wallType
            ? input._buildWallSegmentPath(found.edge)
            : found.doorType
              ? input._buildDoorSegmentPath(found.edge)
              : input._buildWindowSegmentPath(found.edge);
          if (segment.length > 0) {
            // _batchEvents: every removeWall/removeDoor emits its own
            // 'wallsChanged', and each one costs a full WallBuilder teardown
            // + rebuild of the map's walls — coalesce the whole run into a
            // single rebuild, like the tile-rect sweep below.
            game._withUndo(() => game._batchEvents(() => {
              for (const pt of segment) {
                input._removeWallAndDoorAtEdge(pt);
              }
            }));
            ctx.renderer.clearDragPreview();
            input._suppressNextClick = true;
          }
          return true;
        }
        this._drawingEdges = true;
        this._edgeStart = found.edge;
        this._edgePath = [found.edge];
        return true;
      }
    }
    if (this.demolishType === 'demolishAll') {
      const found = input.findDemolishableEdgeAtScreen?.(e.clientX, e.clientY);
      this._pressedDoorEdge = found?.doorType ? found.edge : null;
    }
    // Beamline/equipment demolish is click-on-object; utility demolish is
    // click-on-line. Neither uses the tile-rect drag.
    if (this.demolishType === 'demolishBeamline' || this.demolishType === 'demolishUtility') {
      // ...except beam pipes, which are cut by the 0.5 m sub-unit. At that
      // granularity a click-per-section would be unusable for clearing a run,
      // so a press on a pipe anchors a sweep that onMouseUp commits in one go.
      this._pipeSweep = this._pipeSweepAnchor(e, ctx);
      return true; // commit runs on mouseup (or, with no sweep, on click)
    }
    const world = ctx.renderer.screenToWorld(e.clientX, e.clientY);
    const grid = isoToGrid(world.x, world.y);
    this._dragging = true;
    this._dragStart = { col: grid.col, row: grid.row };
    this._dragEnd = { col: grid.col, row: grid.row };
    return true;
  }

  onMouseMove(e, ctx) {
    const input = ctx.input;
    const renderer = ctx.renderer;
    if (this._dragging && this._dragStart) {
      const world = renderer.screenToWorld(e.clientX, e.clientY);
      const grid = isoToGrid(world.x, world.y);
      this._dragEnd = { col: grid.col, row: grid.row };
      renderer.renderDemolishPreview(
        this._dragStart.col, this._dragStart.row,
        grid.col, grid.row,
      );
      return true;
    }
    if (this._drawingEdges) {
      const edge = input._getNearestEdge(e.clientX, e.clientY);
      this._edgePath = input._buildWallLine(this._edgeStart, edge);
      renderer.renderDemolishPathPreview(this._edgePath);
      return true;
    }
    // Hover: outline the object under the cursor + refund tooltip.
    const world = renderer.screenToWorld(e.clientX, e.clientY);
    const grid = isoToGrid(world.x, world.y);
    renderer.updateHover(grid.col, grid.row);
    input.lastMouseWorldX = world.x;
    input.lastMouseWorldY = world.y;
    input._lastScreenX = e.clientX;
    input._lastScreenY = e.clientY;
    input._updateDemolishHover(
      world, grid, e.clientX, e.clientY, this.demolishType, this._pipeSweep,
    );
    if (input._hoverTooltipTarget) input._hideTooltip();
    return true;
  }

  /**
   * If this press landed on a beam pipe, the `{ pipeId, index }` anchor for a
   * section sweep; otherwise null. Reuses the demolish scope's own lookup so
   * the press can only anchor on a pipe the tool is actually allowed to cut,
   * and so a press that lands on a module or an on-pipe component (both of
   * which win the raycast) falls through to the ordinary click-delete.
   */
  _pipeSweepAnchor(e, ctx) {
    const input = ctx.input;
    // demolishAll is the "level everything here" tool and stays all-or-nothing
    // on pipes; only the beamline tool cuts by the section.
    if (this.demolishType !== 'demolishBeamline') return null;
    const scope = DEMOLISH_PLACEABLE_SCOPE[this.demolishType];
    if (!scope) return null;
    const world = ctx.renderer.screenToWorld(e.clientX, e.clientY);
    const grid = isoToGrid(world.x, world.y);
    const found = input._findDeletablePlaceable(
      { x: world.x, y: world.y }, grid, e.clientX, e.clientY, scope,
    );
    if (!found || found.kind !== 'beampipe') return null;
    const pipe = (ctx.game.state.beamPipes || []).find(p => p.id === found.pipeId);
    const section = pipe && input._demolishPipeSection(pipe, world);
    if (!section) return null;
    return { pipeId: pipe.id, index: section.fromSub };
  }

  /**
   * Commit the pipe section under (or swept to) the cursor. Returns true if a
   * sweep was in flight, whether or not the cut succeeded — the gesture is
   * consumed either way, so the follow-up click must not also fire.
   */
  _commitPipeSweep(e, ctx) {
    const sweep = this._pipeSweep;
    if (!sweep) return false;
    this._pipeSweep = null;

    const input = ctx.input;
    const game = ctx.game;
    const world = ctx.renderer.screenToWorld(e.clientX, e.clientY);
    const pipe = (game.state.beamPipes || []).find(p => p.id === sweep.pipeId);
    const section = pipe && input._demolishPipeSection(pipe, world, sweep);
    if (section) {
      // _withUndo so one gesture is one undo step, however many sub-units it
      // swept over.
      game._withUndo(() => game.demolishTarget({
        kind: section.wholePipe ? 'beampipe' : 'beampipeSection',
        pipeId: section.pipeId,
        fromSub: section.fromSub,
        toSub: section.toSub,
      }));
      ctx.renderer.clearDragPreview();
    }
    return true;
  }

  // Off-canvas release / focus loss: drop the sweep without executing it.
  cancelGesture(ctx) { this.onExit(ctx); }

  onMouseUp(e, ctx) {
    // Only the left button commits a drag. A right release mid-drag used to
    // run this commit path (onMouseDown guards `e.button !== 0`, onMouseUp
    // did not), firing the gesture early AND consuming the event so
    // right-click-to-deselect never ran.
    if (e.button !== 0) return false;
    const input = ctx.input;
    const game = ctx.game;
    // Pipe-section sweep end. Runs before the branches below because it is the
    // only gesture demolishBeamline starts, and it must consume the release so
    // onClick's whole-object delete path never also fires.
    if (this._pipeSweep) {
      this._commitPipeSweep(e, ctx);
      input._suppressNextClick = true;
      return true;
    }
    // Edge-path end — clears walls AND doors along the path.
    if (this._drawingEdges) {
      if (this._edgePath.length > 0) {
        // Batched for the same reason as the shift-click whole-run delete:
        // one wall rebuild for the drag, not one per edge.
        game._withUndo(() => game._batchEvents(() => {
          for (const pt of this._edgePath) {
            input._removeWallAndDoorAtEdge(pt);
          }
        }));
      }
      this._drawingEdges = false;
      this._edgeStart = null;
      this._edgePath = [];
      ctx.renderer.clearDragPreview();
      return true;
    }
    // Tile-rect drag end. _withUndo skips the undo push when the sweep hits
    // nothing; _batchEvents coalesces the per-tile emits so the renderer
    // rebuilds once for the whole rect instead of once per removed tile.
    if (this._dragging && this._dragStart && this._dragEnd) {
      const minCol = Math.min(this._dragStart.col, this._dragEnd.col);
      const maxCol = Math.max(this._dragStart.col, this._dragEnd.col);
      const minRow = Math.min(this._dragStart.row, this._dragEnd.row);
      const maxRow = Math.max(this._dragStart.row, this._dragEnd.row);
      // Release position, for the single-tile object pick below.
      const world = ctx.renderer.screenToWorld(e.clientX, e.clientY);

      game._withUndo(() => game._batchEvents(() => {
        if (this.demolishType === 'demolishBuilding') {
          // Rect sweep for building elements: zones, floors, and any
          // wall/door segments stored on the swept tiles' edges.
          game.removeZoneRect(
            this._dragStart.col, this._dragStart.row,
            this._dragEnd.col, this._dragEnd.row,
          );
          game.removeInfraRect(
            this._dragStart.col, this._dragStart.row,
            this._dragEnd.col, this._dragEnd.row,
          );
          for (let c = minCol; c <= maxCol; c++) {
            for (let r = minRow; r <= maxRow; r++) {
              for (const edge of ['n', 's', 'e', 'w']) {
                input._removeWallAndDoorAtEdge({ col: c, row: r, edge });
              }
            }
          }
        } else if (this.demolishType === 'demolishAll') {
          // A single-tile release is a CLICK, and a click means "delete the
          // thing I am pointing at". Take the object under the cursor and stop
          // — deleting a bench should not also tear up the floor it stands on,
          // the zone it is in and the walls around it, which is what levelling
          // the tile did. Only a click on bare ground levels the tile.
          //
          // A rect drag is unchanged: sweeping an area IS the "level it all"
          // gesture, and the palette card says so.
          const singleTile = minCol === maxCol && minRow === maxRow;
          const pressedDoorEdge = singleTile ? this._pressedDoorEdge : null;
          const found = singleTile && !pressedDoorEdge
            ? input._findDeletablePlaceable(
              { x: world.x, y: world.y }, { col: minCol, row: minRow },
              e.clientX, e.clientY, DEMOLISH_PLACEABLE_SCOPE.demolishAll)
            : null;
          if (pressedDoorEdge) {
            input._removeWallAndDoorAtEdge(pressedDoorEdge);
          } else if (found) {
            game.demolishTarget(found);
          } else {
            for (let c = minCol; c <= maxCol; c++) {
              for (let r = minRow; r <= maxRow; r++) {
                input._demolishEverythingAt(c, r);
              }
            }
          }
        }
      }));
      this._dragging = false;
      this._dragStart = null;
      this._dragEnd = null;
      this._pressedDoorEdge = null;
      ctx.renderer.clearDragPreview();
      return true;
    }
    return false;
  }

  onClick(e, ctx) {
    const input = ctx.input;
    const game = ctx.game;
    const renderer = ctx.renderer;
    const screenX = e.clientX, screenY = e.clientY;
    const world = renderer.screenToWorld(screenX, screenY);
    const grid = isoToGrid(world.x, world.y);
    const col = grid.col, row = grid.row;
    const key = col + ',' + row;
    const dt = this.demolishType;
    // _withUndo: a miss-click (nothing deletable under the cursor) must not
    // push an identical snapshot or clobber the redo stack.
    return game._withUndo(() => {
      // Unified placeable delete path. Any demolish mode with a scope routes
      // through _findDeletablePlaceable for consistent hover UX and click
      // behavior. Mode-specific non-placeable branches (utility lines, zones,
      // floors, walls, doors) still fall through below.
      const scope = DEMOLISH_PLACEABLE_SCOPE[dt];
      if (scope) {
        const found = input._findDeletablePlaceable({ x: world.x, y: world.y }, grid, screenX, screenY, scope);
        if (found) {
          game.demolishTarget(found);
          return true;
        }
        // "Clicked nothing deletable" is a no-op for placeables; let the
        // click fall through to the non-placeable tile branches below.
      }
      // Utility lines are click-on-line (raycast). The catch-all also removes
      // a hovered line before sweeping the tile.
      if (dt === 'demolishUtility' || dt === 'demolishAll') {
        const objectHit = renderer.raycastScreen?.(screenX, screenY);
        const objectInfo = objectHit ? renderer.identifyHit?.(objectHit) : null;
        if (objectInfo?.group === 'utilityAttachment') {
          if (game.demolishTarget({
            kind: 'utilityAttachment',
            lineId: objectInfo.lineId,
            attachmentId: objectInfo.attachmentId,
          })) return true;
        }
        const hit = renderer.raycastUtilityLine?.(screenX, screenY);
        if (hit && hit.lineId && game.utilityLineSystem) {
          if (game.removeUtilityLine(hit.lineId)) {
            const descriptor = UTILITY_TYPES[hit.utilityType];
            game.log(`Removed ${descriptor?.displayName || hit.utilityType} line`, 'info');
            if (dt === 'demolishUtility') return true;
          }
        }
      }
      if (dt === 'demolishBuilding') {
        // Edge-first: a wall or door under the cursor wins over the tile.
        const found = input.findDemolishableEdgeAtScreen(screenX, screenY);
        if (found) {
          if (found.overlayType || found.wallType) {
            // Route through the shared helper (matches the shift-click and
            // drag-commit siblings below) rather than calling
            // game.removeWall directly. The helper keeps the edge families
            // together while each mutator resolves aliases itself; crucially,
            // it calls removeWall only once so copper peels without taking
            // the host wall in the same click.
            input._removeWallAndDoorAtEdge(found.edge);
          } else if (found.doorType) {
            game.removeDoor(found.edge.col, found.edge.row, found.edge.edge);
          } else {
            game.removeWindow(found.edge.col, found.edge.row, found.edge.edge);
          }
          return true;
        }
        if (game.state.zoneOccupied[key]) {
          game.removeZoneTile(col, row);
        }
        if (game.state.infraOccupied[key]) {
          game.removeInfraTile(col, row);
        }
      } else if (dt === 'demolishAll') {
        const found = input.findDemolishableEdgeAtScreen?.(screenX, screenY);
        if (found?.doorType) input._removeWallAndDoorAtEdge(found.edge);
        else input._demolishEverythingAt(col, row);
      }
      return true;
    });
  }

  onRightClick(_e, ctx) {
    // Right-click deselects (legacy deselectDemolishTool behavior).
    ctx.input.clearTool();
    ctx.input._hidePreview();
    return true;
  }

  onShiftChange(down, ctx) {
    // Switch the hover preview between single-edge highlight and
    // whole-segment preview without waiting for a mousemove.
    const input = ctx.input;
    if (this._dragging || this._drawingEdges) return;
    if (input._lastScreenX == null) return;
    if (this.demolishType === 'demolishBeamline') {
      // Shift widens a pipe-section highlight to the whole run. Refresh now
      // rather than leaving the old section outlined until the next mousemove.
      const world = ctx.renderer.screenToWorld(input._lastScreenX, input._lastScreenY);
      input._updateDemolishHover(
        world, isoToGrid(world.x, world.y),
        input._lastScreenX, input._lastScreenY, this.demolishType, this._pipeSweep,
      );
      return;
    }
    if (this.demolishType !== 'demolishBuilding') return;
    const found = input.findDemolishableEdgeAtScreen(
      input._lastScreenX, input._lastScreenY,
    );
    if (!found) return;
    const { edge, overlayType, wallType, doorType } = found;
    if (down) {
      const path = overlayType
        ? input._buildWallOverlaySegmentPath(edge)
        : wallType
        ? input._buildWallSegmentPath(edge)
        : doorType
          ? input._buildDoorSegmentPath(edge)
          : input._buildWindowSegmentPath(edge);
      if (path.length > 0) {
        ctx.renderer.renderDemolishPathPreview(path);
        return;
      }
    }
    ctx.renderer.renderWallEdgeHighlight(edge.col, edge.row, edge.edge, 0xff4444);
  }
}
