import { Tool } from './Tool.js';

/** Exclusive click tool used by the presentation-only effects workshop. */
export class EffectPreviewTool extends Tool {
  constructor(effectId, onExit = null) {
    super(`effect-preview:${effectId}`, 'effectPreview');
    this.effectId = effectId;
    this.cursor = 'crosshair';
    this._onExit = onExit;
  }

  onExit() {
    this._onExit?.(this.effectId);
  }

  onMouseMove() {
    return true;
  }

  onClick(event, { renderer }) {
    const point = renderer.effectPointAtScreen?.(event.clientX, event.clientY);
    if (point) renderer.previewParticleEffect?.(this.effectId, point);
    return true;
  }

  onRightClick() {
    return true;
  }

  onKey(event, { input }) {
    if (event.key !== 'Escape') return false;
    input.setTool(null);
    return true;
  }
}
