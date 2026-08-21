// src/input/utility-line-tool.js
//
// UtilityLineTool: thin Tool wrapper around UtilityLineInputController.
// Arms one of the utility types from src/utility/registry.js; the player
// then clicks+drags between matching ports to commit a line via
// UtilityLineSystem.addLine(). All gesture + preview state lives in the
// controller (ThreeRenderer reads it from there directly).
//
// Replaces the legacy per-family utility-line selection field and its
// selector pair — arming any other tool disarms this one via the single
// activeTool slot, which kills the old "utility-line tool cleared from
// only 1 of 10 selectors" bug by construction.

import { Tool } from './Tool.js';
import { canAffordFunding } from '../game/affordability.js';
import { isoToGrid } from '../renderer/grid.js';
import { UTILITY_TYPES, utilityLineHeight } from '../utility/registry.js';

export class UtilityLineTool extends Tool {
  constructor(utilityType) {
    super(`utility:${utilityType}`, 'utility');
    this.utilityType = utilityType;
  }

  onEnter(ctx) {
    ctx.input.utilityLineController.setUtilityType(this.utilityType);
    // Show the subtile grid around the cursor now that the tool is armed.
    ctx.renderer._renderCursors?.();
  }

  onExit(ctx) {
    // setUtilityType(null) also cancels a mid-gesture draw.
    ctx.input.utilityLineController.setUtilityType(null);
    document.querySelectorAll('.palette-item.util-line-active')
      .forEach(el => el.classList.remove('util-line-active'));
    // Clear the subtile grid now that no utility tool is armed.
    ctx.renderer._clearGridOverlay?.();
    ctx.input._hideDragCostTooltip?.();
  }

  // Shift toggles run-wiring mid-drag; re-plan from the last cursor position
  // so the preview and the sink count update without waiting for a mousemove.
  onShiftChange(down, ctx) {
    const ctrl = ctx.input.utilityLineController;
    if (!ctrl.isActive()) return;
    this._replanFromLastCursor(ctx, { run: down });
  }

  // R flips which leg of the bend comes first. Both orders are legal routes
  // whenever the ports allow it, and the controller was picking one for the
  // player with no way to say otherwise — that is most of "hard to control the
  // layout of the pipes". Consumed only mid-drag, so R keeps its usual meaning
  // (rotate a placement / open research) the rest of the time.
  onRotateKey(ctx) {
    const ctrl = ctx.input.utilityLineController;
    if (!ctrl.isActive()) return false;
    ctrl.togglePreferVerticalFirst();
    this._replanFromLastCursor(ctx, {});
    return true;
  }

  // Re-run the drag geometry at the last known cursor position, so a change
  // that isn't a mouse move (modifier, bend flip) still updates the preview
  // and the cost tooltip immediately.
  _replanFromLastCursor(ctx, modifiers) {
    const ctrl = ctx.input.utilityLineController;
    const { lastMouseWorldX: mx, lastMouseWorldY: my } = ctx.input;
    if (!Number.isFinite(mx) || !Number.isFinite(my)) return;
    // The last real cursor pixel, so port picking re-runs against the same
    // projected anchors a mouse move would have used. Without it a bend flip
    // would silently drop back to the ground-plane hit test.
    const sx = ctx.input._lastScreenX;
    const sy = ctx.input._lastScreenY;
    const screen = (Number.isFinite(sx) && Number.isFinite(sy)) ? { x: sx, y: sy } : undefined;
    ctrl.onMouseMove(mx, my, modifiers, screen);
    this._updateDragTooltip(ctx, ctx.input._lastScreenX, ctx.input._lastScreenY);
  }

  // Right-click is the eraser for the utility you have armed: it takes back the
  // line under the cursor without a trip to the demolish tool, which is what
  // makes drawing cable a loop you can iterate in rather than a commitment.
  //
  // Scoped to the armed type on purpose — with six utilities stacked along the
  // same wall, "remove whatever is under the cursor" deletes the wrong one
  // often enough to be worse than useless.
  //
  // A miss returns false so the click falls through to the ordinary
  // right-click-deselects behaviour; only an actual removal is consumed.
  onRightClick(e, ctx) {
    const ctrl = ctx.input.utilityLineController;
    // Mid-drag, right-click means "abandon this line", not "delete one".
    if (ctrl.isActive()) {
      ctrl.onEscape?.();
      ctx.input._hideDragCostTooltip?.();
      return true;
    }
    const game = ctx.game;
    if (!game.utilityLineSystem) return false;
    // Mesh raycast first (exact), then a proximity test on the cursor's cable
    // plane. A powerCable is a 2 cm cylinder; requiring a pixel-accurate hit on
    // one would make the eraser feel broken at anything but maximum zoom.
    const hit = ctx.renderer.raycastUtilityLine?.(e.clientX, e.clientY);
    let lineId = (hit && hit.utilityType === this.utilityType) ? hit.lineId : null;
    if (!lineId) {
      const world = this._cableWorld(e, ctx);
      lineId = ctrl.nearestLine(world.x, world.y, 0.4)?.lineId || null;
    }
    if (!lineId) return false;
    let removed = false;
    game._withUndo(() => {
      removed = game.removeUtilityLine(lineId);
      return removed;
    });
    if (removed) {
      const label = UTILITY_TYPES[this.utilityType]?.displayName || this.utilityType;
      game.log(`Removed ${label} line`, 'info');
    }
    return removed;
  }

  // Off-canvas release / focus loss: drop the in-flight line draw.
  cancelGesture(ctx) {
    ctx.input.utilityLineController.onEscape?.();
    ctx.input._hideDragCostTooltip?.();
  }

  // Where the cursor lands ON THE PLANE THIS UTILITY RUNS AT. Picking against
  // the ground while drawing at height offsets every line a fixed distance
  // up-screen from the mouse, and the offset differs per utility now that a
  // power cord lies on the floor and a vacuum pipe rides at working height.
  // The floor-level pick is still the right one for tile hover and hover
  // tooltips, which are about what is under the cursor on the ground — hence
  // two conversions, not one.
  _cableWorld(e, ctx) {
    const r = ctx.renderer;
    const ctrl = ctx.input.utilityLineController;
    const height = ctrl?.isActive?.()
      ? ctrl.drawHeight : utilityLineHeight(this.utilityType);
    return r.screenToWorldAtHeight
      ? r.screenToWorldAtHeight(e.clientX, e.clientY, height)
      : r.screenToWorld(e.clientX, e.clientY);
  }

  onMouseDown(e, ctx) {
    if (e.button !== 0) return false;
    const world = this._cableWorld(e, ctx);
    // Anchors on a port when near one, otherwise starts an open-ended draw;
    // either way the controller consumes the click while armed. Shift arms
    // run-wiring: the drag sweeps a corridor and wires every compatible sink.
    return !!ctx.input.utilityLineController.onMouseDown(
      world.x, world.y, 0, { run: e.shiftKey }, { x: e.clientX, y: e.clientY });
  }

  onMouseMove(e, ctx) {
    const input = ctx.input;
    const renderer = ctx.renderer;
    const ctrl = input.utilityLineController;
    const world = this._cableWorld(e, ctx);
    if (ctrl.isActive()) {
      // Mid-draw: update the Manhattan preview path.
      ctrl.onMouseMove(world.x, world.y, { run: e.shiftKey }, { x: e.clientX, y: e.clientY });
      input.lastMouseWorldX = world.x;
      input.lastMouseWorldY = world.y;
      input._lastScreenX = e.clientX;
      input._lastScreenY = e.clientY;
      this._updateDragTooltip(ctx, e.clientX, e.clientY);
      return true;
    }
    const ground = renderer.screenToWorld(e.clientX, e.clientY);
    const grid = isoToGrid(ground.x, ground.y);
    renderer.updateHover(grid.col, grid.row);
    // Hover: highlight the nearest port that matches the utility type.
    ctrl.onHover(world.x, world.y, { x: e.clientX, y: e.clientY });
    input.lastMouseWorldX = world.x;
    input.lastMouseWorldY = world.y;
    input._lastScreenX = e.clientX;
    input._lastScreenY = e.clientY;
    // Hover tooltips stayed live while the utility tool was armed. They read
    // the ground pick — they are about the thing under the cursor, not about
    // the cable plane.
    input._checkHoverTooltip(ground, grid, e.clientX, e.clientY);
    return true;
  }

  onMouseUp(e, ctx) {
    const ctrl = ctx.input.utilityLineController;
    if (!ctrl.isActive()) return false;
    // Draw end — commits through Game.commitGesture (one undo entry, whether
    // that is a single line or a whole run).
    const world = this._cableWorld(e, ctx);
    ctrl.onMouseUp(world.x, world.y, e.button, { run: e.shiftKey }, { x: e.clientX, y: e.clientY });
    ctx.input._hideDragCostTooltip?.();
    return true;
  }

  // Live cost readout while drawing. Run-wiring adds the payoff (how many
  // sinks the drag will wire); a single line shows its price alone — lines are
  // charged per sub-unit either way, so a silent single-line drag would spend
  // money the player never saw coming.
  _updateDragTooltip(ctx, screenX, screenY) {
    const ctrl = ctx.input.utilityLineController;
    const plan = ctrl.runPlan;
    const cost = ctrl.dragCost;
    // A refusal outranks the price: a drag that will be thrown away has to say
    // so BEFORE the release, or the gesture just silently does nothing. (The
    // commit logs the same reason, but nothing in the game renders the log.)
    const reject = ctrl.dragReject;
    if (screenX != null && reject && (!plan || plan.stubs.length === 0)) {
      ctx.input._showDragCostTooltip?.(0, screenX, screenY, {
        note: `can't place: ${reject}`,
      });
      return;
    }
    if (screenX == null || ((!plan || plan.stubs.length === 0) && cost <= 0)) {
      ctx.input._hideDragCostTooltip?.();
      return;
    }
    let note = null;
    if (plan && plan.stubs.length > 0) {
      const n = plan.stubs.length;
      note = `wire ${n} component${n === 1 ? '' : 's'}`;
      if (plan.skipped > 0) note += ` · ${plan.skipped} unreachable`;
    }
    ctx.input._showDragCostTooltip?.(cost, screenX, screenY, {
      note,
      insufficientFunding: cost > 0 && !canAffordFunding(ctx.game, cost),
    });
  }
}
