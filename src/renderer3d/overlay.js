// src/renderer3d/overlay.js — PixiJS overlay canvas (events/viewport/save bookkeeping)
// PIXI is a CDN global — do NOT import it

export class Overlay {
  constructor() {
    this.app = null;
    this.world = null;
  }

  async init() {
    this.app = new PIXI.Application();
    await this.app.init({
      backgroundAlpha: 0,
      resizeTo: window,
      antialias: false,
      resolution: 1,
    });

    const canvas = this.app.canvas;
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.zIndex = '20';
    canvas.style.pointerEvents = 'none';

    const gameEl = document.getElementById('game');
    gameEl.appendChild(canvas);

    this.world = new PIXI.Container();
    this.app.stage.addChild(this.world);
  }

  dispose() {
    this.app.destroy(true);
    this.app = null;
  }
}
