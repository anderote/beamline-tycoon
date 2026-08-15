// src/input/beamline-tool.js
//
// BeamlineTool: the armed state for any COMPONENTS entry selected from the
// beamline palette (or the in-designer palette via the same path). One tool
// class covers the whole family, discriminated by the component def:
//
//   - grid modules (placement 'module', no role): unified placeable ghost +
//     commit through InputHandler._updatePlaceablePreview /
//     _commitHoverPlaceable — the same shared path PlaceableTool uses.
//   - junctions (role 'junction') and on-pipe placements (role 'placement'):
//     delegate hover ghosts and commits to BeamlineInputController; Space
//     commits at the last cursor position like a click.
//   - drawn connections (isDrawnConnection — beam pipes): left-drag draws,
//     right-drag removes, pre-click hover marker via onPipeToolHover. All
//     gesture state lives in the controller.
//   - legacy attachments (placement 'attachment' with no role — infra
//     gauges/valves): gauges prefer a compatible utility run and fall back to
//     beam pipe; valves remain beam-pipe-only.
//
// This replaces the legacy beamline shadow-arming fields and selector
// methods, plus the beamline delegation guards that were spread across
// InputHandler's mousedown/mousemove/mouseup/_handleClick chains.

import { Tool } from './Tool.js';
import { COMPONENTS } from '../data/components.js';
import { PLACEABLES } from '../data/placeables/index.js';
import { isoToGrid } from '../renderer/grid.js';
import { BEAM_PIPE_Y } from '../beamline/pipe-geometry.js';

export class BeamlineTool extends Tool {
  constructor(key, paramOverrides = null) {
    super(`component:${key}`, 'beamline');
    this.key = key;
    this.paramOverrides = paramOverrides || null;
  }

  get def() { return COMPONENTS[this.key]; }

  // Arms the unified placeable preview/commit path (InputHandler reads this
  // through its `armedPlaceableId` getter).
  get armedPlaceableId() { return this.key; }

  onEnter(ctx) {
    ctx.input.selectedParamOverrides = this.paramOverrides;
    // Each newly armed component starts from its authored connector layout;
    // repeated placements with the same tool retain the player's M choice.
    ctx.input.placementPortsFlipped = false;
    ctx.renderer.setBuildMode(true, this.key);
  }

  onExit(ctx) {
    const c = ctx.input.beamlineController;
    c.reset();       // cancel a mid-gesture pipe draw / remove sweep
    c.clearHover();  // drop the pre-click pipe marker
    // The on-pipe placement hover is what the controller commits on click;
    // leaving it set past the disarm let a stale slot survive the tool.
    c._placementHover = null;
    ctx.renderer.setBuildMode(false);
  }

  // Beam pipe geometry rides on the 1 m beam axis. Picking against the floor
  // shifts the result down-screen under the dimetric camera, so the preview
  // appears detached from the cursor and from a source's visible flange.
  _pipeWorld(e, ctx) {
    const r = ctx.renderer;
    return r.screenToWorldAtHeight
      ? r.screenToWorldAtHeight(e.clientX, e.clientY, BEAM_PIPE_Y)
      : r.screenToWorld(e.clientX, e.clientY);
  }

  // Off-canvas release / focus loss: drop the in-flight draw / remove sweep
  // without committing it, so it can't fire at the next canvas click.
  cancelGesture(ctx) {
    ctx.input.beamlineController.reset();
  }

  onMouseDown(e, ctx) {
    if (e.button !== 0 && e.button !== 2) return false;
    const def = this.def;
    if (def?.isDrawnConnection) {
      // Pipe drawing starts on press (left = draw, right = remove-sweep).
      const world = this._pipeWorld(e, ctx);
      ctx.input.beamlineController.onMouseDown(
        world.x, world.y, e.button, this.key,
        { x: e.clientX, y: e.clientY },
      );
      return true;
    }
    if (def?.role === 'junction' || def?.role === 'placement') {
      // Swallow the press so no other branch interprets it as a drag;
      // the commit runs on click (mouseup) to match click semantics.
      return true;
    }
    // Grid modules / attachments: plain press falls through — commit on click.
    return false;
  }

  onMouseMove(e, ctx) {
    const input = ctx.input;
    const renderer = ctx.renderer;
    const c = input.beamlineController;
    const def = this.def;
    const ground = renderer.screenToWorld(e.clientX, e.clientY);
    const world = def?.isDrawnConnection ? this._pipeWorld(e, ctx) : ground;
    if (c.isActive()) {
      // Mid pipe-draw: extend the preview path.
      c.onMouseMove(world.x, world.y, { x: e.clientX, y: e.clientY });
      return true;
    }
    const grid = isoToGrid(ground.x, ground.y);
    renderer.updateHover(grid.col, grid.row);
    if (def?.isDrawnConnection) {
      // Pre-click hover marker for the pipe-draw tool.
      c.onPipeToolHover(world.x, world.y, { x: e.clientX, y: e.clientY });
    }
    // For stackable items, use the surface-aware raycast (mirrors the shared
    // hover branch; beamline comps are normally not stackable).
    let placeWorld = world;
    const pl = PLACEABLES[this.key];
    if (pl?.stackable && typeof renderer.screenToPlacementWorld === 'function') {
      placeWorld = renderer.screenToPlacementWorld(e.clientX, e.clientY);
    }
    input.lastMouseWorldX = placeWorld.x;
    input.lastMouseWorldY = placeWorld.y;
    input._lastScreenX = e.clientX;
    input._lastScreenY = e.clientY;
    // Legacy attachments (placement:'attachment', no role — infra gauges and
    // valves) get the pipe-projected ghost instead of the unified one; running
    // both drew a full ghost that the attachment preview immediately erased.
    if (def?.placement === 'attachment' && !def.role) {
      input._updateAttachmentPreview(this.key, world.x, world.y);
    } else {
      // Unified ghost — routes junction/placement hover to the controller,
      // skips drawn connections, renders the module ghost otherwise.
      input._updatePlaceablePreview();
    }
    // Hover tooltips were suppressed while a beamline tool was armed.
    if (input._hoverTooltipTarget) input._hideTooltip();
    return true;
  }

  onMouseUp(e, ctx) {
    const c = ctx.input.beamlineController;
    if (c.isActive()) {
      // Pipe draw / remove-sweep commit. Undo pushes happen inside the
      // controller's commit paths.
      const world = this._pipeWorld(e, ctx);
      c.onMouseUp(world.x, world.y, e.button, { x: e.clientX, y: e.clientY });
      return true;
    }
    // Plain release falls through to _handleClick → onClick / onRightClick.
    return false;
  }

  onClick(e, ctx) {
    const input = ctx.input;
    const game = ctx.game;
    const def = this.def;
    const world = ctx.renderer.screenToWorld(e.clientX, e.clientY);
    // Junctions and pipe placements route through BeamlineInputController.
    // When it consumes the click, skip the generic commit below (which would
    // fall back to the subgrid placeable commit — wrong for pipe-bound
    // placements).
    if ((def?.role === 'junction' || def?.role === 'placement')
        && input.beamlineController.onMouseDown(world.x, world.y, 0, this.key)) {
      return true;
    }
    // Infrastructure gauges can mount on a drawn vacuum run or a beam pipe;
    // valves remain beam-pipe-only.
    if (def?.placement === 'attachment' && !def.role) {
      const hit = input._resolveAttachmentTarget(this.key, world.x, world.y);
      if (!hit) {
        const mount = def.utilityMount ? 'a vacuum line or beam pipe' : 'a beam pipe';
        const message = `${def?.name || 'Attachment'} must be placed on ${mount}.`;
        if (typeof input._showPlacementFailure === 'function') input._showPlacementFailure(message);
        else game.log(message, 'bad');
        return true;
      }
      if (hit.collidesWithModule || hit.collidesWithAttachment) {
        const message = hit.collidesWithAttachment
          ? `${def?.name || 'Attachment'} is too close to another line-mounted instrument.`
          : `${def?.name || 'Attachment'} is blocked by a placed module or equipment.`;
        if (typeof input._showPlacementFailure === 'function') input._showPlacementFailure(message);
        else game.log(message, 'bad');
        return true;
      }
      // Geometry is the validate step; addAttachmentToPipe prices itself and
      // can still refuse (affordability), so the snapshot is conditional on
      // the mutation, not on the click.
      game.commitGesture({
        mutate: () => hit.kind === 'utilityLine'
          ? game.addUtilityAttachment(
            hit.line.id, this.key, hit.proj.position, input.selectedParamOverrides,
          )
          : game.addAttachmentToPipe(
            hit.pipe.id, this.key, hit.proj.position, input.selectedParamOverrides,
          ),
      });
      return true;
    }
    // Grid modules: unified placeable commit (also opens an existing node's
    // window when the click lands on one). Returns false when no ghost is
    // armed so the click can fall through to node selection.
    return input._commitHoverPlaceable(e.clientX, e.clientY);
  }

  onRightClick(_e, ctx) {
    // Drawn connections never reach here (right-press starts a remove-sweep
    // that consumes the release). For every other beamline tool, right-click
    // disarms. (The legacy deselect only half-cleared — the ghost stayed
    // armed through the placeable field; that exclusivity bug dies here.)
    ctx.input.clearTool();
    ctx.input._hidePreview();
    return true;
  }

  onKey(e, ctx) {
    const input = ctx.input;
    const def = this.def;
    // Space commits junctions/placements at the last known cursor position,
    // honoring placementMode (snap/insert/replace) identically to a click.
    // Undo push happens inside the controller's commit paths. Grid modules
    // fall through to the generic Space branch (hoverPlaceable commit).
    if (e.key === ' ' && def && (def.role === 'junction' || def.role === 'placement')) {
      e.preventDefault();
      const wx = input.lastMouseWorldX ?? 0;
      const wy = input.lastMouseWorldY ?? 0;
      input.beamlineController.onMouseDown(wx, wy, 0, this.key);
      return true;
    }
    return false;
  }
}
