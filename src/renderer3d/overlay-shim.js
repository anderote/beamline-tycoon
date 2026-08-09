// src/renderer3d/overlay-shim.js — plain-DOM replacement for the old PixiJS
// overlay. Pixi's surviving jobs were tiny, and this shim covers all of them:
//   (a) an event-capture canvas layered above the Three.js canvas
//       (InputHandler binds its mouse/pointer events here),
//   (b) a viewport-size oracle (`screen.width/height`),
//   (c) `world.{x,y,scale}` pan/zoom bookkeeping that the 'view' save
//       serializer and a few legacy code paths read.
// Nothing is ever drawn on this canvas — it's a bare transparent element.

export class OverlayShim {
  constructor() {
    this.canvas = null;
    // Live viewport oracle — matches what PIXI's app.screen reported under
    // resizeTo: window. Getters mean it can never go stale on resize.
    this.screen = {
      get width() { return window.innerWidth; },
      get height() { return window.innerHeight; },
    };
    // Pan/zoom bookkeeping (was the PIXI world container's transform).
    // `scale` is a plain number; `visible` survives as an inert flag that
    // old show/hide call sites still toggle.
    this.world = { x: 0, y: 0, scale: 1, visible: true };
    this._onResize = null;
  }

  init() {
    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.zIndex = '20';
    // ThreeRenderer flips this to 'auto' so the canvas receives events.
    canvas.style.pointerEvents = 'none';

    // Keep the backing store in sync with the viewport so any code that
    // reads canvas.width/height (rather than the bounding rect) is correct.
    const sync = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    sync();
    this._onResize = sync;
    window.addEventListener('resize', this._onResize);

    document.getElementById('game').appendChild(canvas);
    this.canvas = canvas;
  }

  dispose() {
    if (this._onResize) {
      window.removeEventListener('resize', this._onResize);
      this._onResize = null;
    }
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    this.canvas = null;
  }
}
