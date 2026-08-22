// Click-drag construction tool for continuous utility carriers.  The carrier
// is stored as a specially tagged utility line: it renders in the existing
// service layer and ordinary utility draws can tap it, while its own build
// price and regular fitting pitch come from linear-manifolds.js.

import { Tool } from './Tool.js';
import { PLACEABLES } from '../data/placeables/index.js';
import { isoToGridFloat } from '../renderer/grid.js';
import { planLinearManifold } from '../utility/linear-manifolds.js';
import { UTILITY_TYPES } from '../utility/registry.js';

function toSubtile(world) {
  const g = isoToGridFloat(world.x, world.y);
  const x = Math.round(g.col * 4);
  const z = Math.round(g.row * 4);
  const col = Math.floor(x / 4), row = Math.floor(z / 4);
  return { col, row, subCol: x - col * 4, subRow: z - row * 4 };
}

function pathFor(plan) {
  return [plan.start, plan.end].map(p => ({
    col: p.col + p.subCol / 4,
    row: p.row + p.subRow / 4,
  }));
}

export class LinearManifoldTool extends Tool {
  constructor(type) {
    super(`linear-manifold:${type}`, 'linearManifold');
    this.type = type;
    this.start = null;
    this.plan = null;
  }

  get armedPlaceableId() { return this.type; }

  onEnter(ctx) {
    const def = PLACEABLES[this.type];
    ctx.input.utilityLineController.setUtilityType(def?.linearManifold?.utility || null);
    ctx.renderer._renderCursors?.();
  }

  onExit(ctx) {
    this.start = null;
    this.plan = null;
    ctx.input.utilityLineController.setUtilityType(null);
    ctx.input._hideDragCostTooltip?.();
    ctx.renderer._clearGridOverlay?.();
  }

  onMouseDown(e, ctx) {
    if (e.button !== 0) return false;
    this.start = toSubtile(ctx.renderer.screenToWorld(e.clientX, e.clientY));
    this.plan = null;
    return true;
  }

  onMouseMove(e, ctx) {
    const world = ctx.renderer.screenToWorld(e.clientX, e.clientY);
    const grid = isoToGridFloat(world.x, world.y);
    ctx.renderer.updateHover(Math.floor(grid.col), Math.floor(grid.row));
    if (!this.start) return true;
    const def = PLACEABLES[this.type];
    this.plan = planLinearManifold({ type: this.type, def, start: this.start, end: toSubtile(world) });
    const utility = this.plan.utility;
    ctx.input.utilityLineController.setExternalPreview({
      utilityType: utility,
      path: pathFor(this.plan),
      valid: this.plan.valid,
      color: UTILITY_TYPES[utility]?.color || '#ffffff',
      manifold: this.plan,
    });
    ctx.input._showDragCostTooltip?.(this.plan.cost.funding, e.clientX, e.clientY, {
      note: this.plan.valid ? `${this.plan.taps.length} tap fittings` : this.plan.reason,
    });
    return true;
  }

  onMouseUp(e, ctx) {
    if (e.button !== 0 || !this.start) return false;
    const def = PLACEABLES[this.type];
    const end = toSubtile(ctx.renderer.screenToWorld(e.clientX, e.clientY));
    const plan = planLinearManifold({ type: this.type, def, start: this.start, end });
    this.start = null;
    this.plan = null;
    ctx.input.utilityLineController.setExternalPreview(null);
    ctx.input._hideDragCostTooltip?.();
    if (!plan.valid) return true;
    const path = pathFor(plan);
    ctx.game.commitGesture({
      validate: () => !!ctx.game.utilityLineSystem,
      cost: plan.cost,
      mutate: () => ctx.game.utilityLineSystem.addLine({
        utilityType: plan.utility,
        start: null,
        end: null,
        path,
        manifold: {
          type: this.type,
          trayFamily: plan.trayFamily,
          axis: plan.axis,
          tapSpacingSubtiles: plan.tapSpacingSubtiles,
          taps: plan.taps,
        },
      }),
    });
    return true;
  }

  cancelGesture(ctx) {
    this.start = null;
    this.plan = null;
    ctx.input.utilityLineController.setExternalPreview(null);
    ctx.input._hideDragCostTooltip?.();
  }
}
