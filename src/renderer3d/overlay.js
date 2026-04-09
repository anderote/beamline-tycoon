// src/renderer3d/overlay.js — PixiJS overlay canvas for grid lines, labels, and cursors
// PIXI is a CDN global — do NOT import it

import { gridToIso } from '../renderer/grid.js';

export class Overlay {
  constructor() {
    this.app = null;
    this.world = null;
    this.gridLayer = null;
    this.labelLayer = null;
    this.cursorLayer = null;
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

    this.gridLayer = new PIXI.Container();
    this.world.addChild(this.gridLayer);

    this.labelLayer = new PIXI.Container();
    this.world.addChild(this.labelLayer);

    this.cursorLayer = new PIXI.Container();
    this.world.addChild(this.cursorLayer);
  }

  /**
   * Draw the isometric grid into gridLayer.
   * @param {Set<string>} infraSet - "col,row" strings for all infrastructure tiles
   * @param {Set<string>} noGridSet - "col,row" strings for tiles that suppress grid (e.g. labFloor)
   */
  drawGrid(infraSet, noGridSet) {
    this.gridLayer.removeChildren();

    const g = new PIXI.Graphics();
    const range = 30;

    for (let i = -range; i <= range; i++) {
      // Column lines — line at col=i borders tiles (i-1, j) and (i, j)
      for (let j = -range; j < range; j++) {
        const k1 = `${i - 1},${j}`;
        const k2 = `${i},${j}`;
        // Skip if both sides are noGrid tiles
        if (noGridSet.has(k1) && noGridSet.has(k2)) continue;

        const start = gridToIso(i, j);
        const end = gridToIso(i, j + 1);
        g.moveTo(start.x, start.y);
        g.lineTo(end.x, end.y);

        // Interior flooring gets light gray visible grid lines
        // Grass/outside gets faint white grid lines
        if (infraSet.has(k1) || infraSet.has(k2)) {
          g.stroke({ color: 0xcccccc, width: 1, alpha: 0.15 });
        } else {
          g.stroke({ color: 0xffffff, width: 1, alpha: 0.04 });
        }
      }

      // Row lines — line at row=i borders tiles (j, i-1) and (j, i)
      for (let j = -range; j < range; j++) {
        const k1 = `${j},${i - 1}`;
        const k2 = `${j},${i}`;
        if (noGridSet.has(k1) && noGridSet.has(k2)) continue;

        const rStart = gridToIso(j, i);
        const rEnd = gridToIso(j + 1, i);
        g.moveTo(rStart.x, rStart.y);
        g.lineTo(rEnd.x, rEnd.y);

        if (infraSet.has(k1) || infraSet.has(k2)) {
          g.stroke({ color: 0xcccccc, width: 1, alpha: 0.15 });
        } else {
          g.stroke({ color: 0xffffff, width: 1, alpha: 0.04 });
        }
      }
    }

    this.gridLayer.addChild(g);
  }

  clearLabels() {
    this.labelLayer.removeChildren();
  }

  clearCursors() {
    this.cursorLayer.removeChildren();
  }

  dispose() {
    this.app.destroy(true);
    this.app = null;
  }
}
