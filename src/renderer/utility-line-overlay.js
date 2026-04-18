// src/renderer/utility-line-overlay.js
//
// Minimal 2D overlay for new-system utility lines. Phase 4 stub — the 2D
// overlay system (src/renderer/overlays.js) is deeply wired into the Pixi
// pipeline and isn't trivial to extend mid-refactor. This file provides a
// draw(ctx, state, {...}) helper and a toggle flag so a future integrator
// can point an existing overlay layer here.
//
// TODO(phase-5-or-later): wire this into the overlay system's render order
// and respect state.showUtilityOverlay. Until then, callers can invoke
// drawUtilityLineOverlay() directly on any 2D context.
//
// Drawing model: polylines in grid coords. Each tile maps to an iso-pixel
// diamond via gridToIso; we project each waypoint to iso-pixel and stroke a
// polyline in the descriptor's color. No highlights, no solve-state tints —
// this is a topology view only.

import { gridToIso } from './grid.js';
import { UTILITY_TYPES } from '../utility/registry.js';

/**
 * Draw every utility line in state.utilityLines onto a 2D canvas context.
 * Intended for debug / minimap use. Respects state.showUtilityOverlay —
 * a no-op if that flag is falsy.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{utilityLines: Map|Iterable, showUtilityOverlay?: boolean}} state
 * @param {{worldToScreen?: (x:number, y:number) => {x:number, y:number}}} [opts]
 */
export function drawUtilityLineOverlay(ctx, state, opts = {}) {
  if (!state || !state.showUtilityOverlay) return;
  const lines = state.utilityLines;
  if (!lines) return;
  const iter = typeof lines.values === 'function' ? lines.values() : lines;
  const project = opts.worldToScreen || ((x, y) => ({ x, y }));

  ctx.save();
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.85;
  for (const line of iter) {
    if (!line || !Array.isArray(line.path) || line.path.length < 2) continue;
    const descriptor = UTILITY_TYPES[line.utilityType];
    ctx.strokeStyle = descriptor?.color || '#ffffff';
    ctx.beginPath();
    let first = true;
    for (const pt of line.path) {
      // col/row are in tile-anchor space. gridToIso wants integer tile-center
      // positions, so we just pass them through — it produces iso-pixel coords.
      const iso = gridToIso(pt.col, pt.row);
      const s = project(iso.x, iso.y);
      if (first) { ctx.moveTo(s.x, s.y); first = false; }
      else ctx.lineTo(s.x, s.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

export default drawUtilityLineOverlay;
