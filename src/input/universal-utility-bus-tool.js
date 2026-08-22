// Click-drag construction tool for the utility-neutral multi-service wire tray.

import { Tool } from './Tool.js';
import { COMPONENTS } from '../data/components.js';
import { isoToGridFloat } from '../renderer/grid.js';
import { planLinearManifold } from '../utility/linear-manifolds.js';
import { canBuildUniversalBus } from '../utility/universal-bus-clearance.js';

function toSubtile(world) {
  const grid = isoToGridFloat(world.x, world.y);
  const x = Math.round(grid.col * 4), z = Math.round(grid.row * 4);
  const col = Math.floor(x / 4), row = Math.floor(z / 4);
  return { col, row, subCol: x - col * 4, subRow: z - row * 4 };
}

function pathFor(plan) {
  return [plan.start, plan.end].map(point => ({
    col: point.col + point.subCol / 4,
    row: point.row + point.subRow / 4,
  }));
}

function planFor(def, start, end) {
  return planLinearManifold({
    type: def.id,
    def: { linearManifold: { ...def.universalUtilityBus, utility: 'powerCable' } },
    start,
    end,
  });
}

export class UniversalUtilityBusTool extends Tool {
  constructor(type = 'universalUtilityBus') {
    super(`universal-utility-bus:${type}`, 'universalUtilityBus');
    this.type = type;
    this.start = null;
  }

  onEnter(ctx) { ctx.renderer._renderCursors?.(); }

  onExit(ctx) { this.cancelGesture(ctx); ctx.renderer._clearGridOverlay?.(); }

  onMouseDown(e, ctx) {
    if (e.button !== 0) return false;
    this.start = toSubtile(ctx.renderer.screenToWorld(e.clientX, e.clientY));
    return true;
  }

  onMouseMove(e, ctx) {
    const world = ctx.renderer.screenToWorld(e.clientX, e.clientY);
    const grid = isoToGridFloat(world.x, world.y);
    ctx.renderer.updateHover(Math.floor(grid.col), Math.floor(grid.row));
    if (!this.start) return true;
    const plan = planFor(COMPONENTS[this.type], this.start, toSubtile(world));
    const path = pathFor(plan);
    const clear = plan.valid && canBuildUniversalBus(ctx.game.state, path).ok;
    ctx.input.utilityLineController.setExternalPreview({
      utilityType: 'powerCable', path, valid: clear, rack: true,
    });
    ctx.input._showDragCostTooltip?.(plan.cost.funding, e.clientX, e.clientY, {
      note: clear
        ? `${plan.taps.length} utility access points`
        : (plan.valid ? 'service corridor blocked' : plan.reason),
    });
    return true;
  }

  onMouseUp(e, ctx) {
    if (e.button !== 0 || !this.start) return false;
    const plan = planFor(
      COMPONENTS[this.type], this.start,
      toSubtile(ctx.renderer.screenToWorld(e.clientX, e.clientY)),
    );
    this.start = null;
    ctx.input.utilityLineController.setExternalPreview(null);
    ctx.input._hideDragCostTooltip?.();
    const path = pathFor(plan);
    if (!plan.valid || !canBuildUniversalBus(ctx.game.state, path).ok) return true;
    ctx.game.commitGesture({
      validate: () => !!ctx.game.utilityBusSystem,
      cost: plan.cost,
      mutate: () => ctx.game.utilityBusSystem.addBus({
        path, taps: plan.taps, costFunding: plan.cost.funding,
      }),
    });
    return true;
  }

  cancelGesture(ctx) {
    this.start = null;
    ctx.input.utilityLineController.setExternalPreview(null);
    ctx.input._hideDragCostTooltip?.();
  }
}
