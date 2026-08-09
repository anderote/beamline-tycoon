// src/game/Placeable.js
//
// Class for any object placeable on the subtile grid. Placement code only
// ever touches these methods; kind-specific behavior lives in the defs.

export class Placeable {
  constructor(def) {
    Object.assign(this, def);
    if (this.subW == null || this.subL == null) {
      throw new Error(`Placeable ${def.id}: missing subW/subL`);
    }
    if (!['beamline', 'infrastructure', 'furnishing', 'equipment', 'decoration'].includes(this.kind)) {
      throw new Error(`Placeable ${def.id}: invalid kind ${this.kind}`);
    }
  }

  /**
   * Returns the list of (col,row,subCol,subRow) cells this placeable would
   * occupy at the given origin and direction. Origin is the dir=0 top-left
   * subtile in absolute subtile-space. Rotation pivots around the footprint
   * center; for non-square footprints, dir=1/3 swap subW and subL.
   */
  footprintCells(col, row, subCol, subRow, dir = 0) {
    const swap = dir === 1 || dir === 3;
    const w = swap ? this.subL : this.subW;
    const h = swap ? this.subW : this.subL;
    const cells = [];
    for (let dr = 0; dr < h; dr++) {
      for (let dc = 0; dc < w; dc++) {
        const sc = subCol + dc;
        const sr = subRow + dr;
        cells.push({
          col: col + Math.floor(sc / 4),
          row: row + Math.floor(sr / 4),
          subCol: ((sc % 4) + 4) % 4,
          subRow: ((sr % 4) + 4) % 4,
        });
      }
    }
    return cells;
  }

  // Lifecycle hooks — no-ops, but Game.js invokes them on place/remove.
  onPlaced(game, instance) {}
  onRemoved(game, instance) {}
}
