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
import { isoToGrid } from '../renderer/grid.js';

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
  }

  onMouseDown(e, ctx) {
    if (e.button !== 0) return false;
    const world = ctx.renderer.screenToWorld(e.clientX, e.clientY);
    // Anchors on a port when near one, otherwise starts an open-ended draw;
    // either way the controller consumes the click while armed.
    return !!ctx.input.utilityLineController.onMouseDown(world.x, world.y, 0);
  }

  onMouseMove(e, ctx) {
    const input = ctx.input;
    const renderer = ctx.renderer;
    const ctrl = input.utilityLineController;
    const world = renderer.screenToWorld(e.clientX, e.clientY);
    if (ctrl.isActive()) {
      // Mid-draw: update the Manhattan preview path.
      ctrl.onMouseMove(world.x, world.y);
      return true;
    }
    const grid = isoToGrid(world.x, world.y);
    renderer.updateHover(grid.col, grid.row);
    // Hover: highlight the nearest port that matches the utility type.
    ctrl.onHover(world.x, world.y);
    input.lastMouseWorldX = world.x;
    input.lastMouseWorldY = world.y;
    input._lastScreenX = e.clientX;
    input._lastScreenY = e.clientY;
    // Hover tooltips stayed live while the utility tool was armed.
    input._checkHoverTooltip(world, grid, e.clientX, e.clientY);
    return true;
  }

  onMouseUp(e, ctx) {
    const ctrl = ctx.input.utilityLineController;
    if (!ctrl.isActive()) return false;
    // Draw end — commit via UtilityLineSystem.addLine (undo push inside).
    const world = ctx.renderer.screenToWorld(e.clientX, e.clientY);
    ctrl.onMouseUp(world.x, world.y, e.button);
    return true;
  }
}
