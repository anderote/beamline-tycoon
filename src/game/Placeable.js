// src/game/Placeable.js
//
// Base class for any object placeable on the subtile grid.
// Subclasses add kind-specific runtime behavior; placement code only ever
// touches base-class methods.

export class Placeable {
  constructor(def) {
    Object.assign(this, def);
    if (this.subW == null || this.subH == null) {
      throw new Error(`Placeable ${def.id}: missing subW/subH`);
    }
    if (!['beamline', 'furnishing', 'equipment', 'decoration'].includes(this.kind)) {
      throw new Error(`Placeable ${def.id}: invalid kind ${this.kind}`);
    }
  }

  /**
   * Returns the list of (col,row,subCol,subRow) cells this placeable would
   * occupy at the given origin and direction. Origin is the dir=0 top-left
   * subtile in absolute subtile-space. Rotation pivots around the footprint
   * center; for non-square footprints, dir=1/3 swap subW and subH.
   */
  footprintCells(col, row, subCol, subRow, dir = 0) {
    const swap = dir === 1 || dir === 3;
    const w = swap ? this.subH : this.subW;
    const h = swap ? this.subW : this.subH;
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

  // Lifecycle hooks — subclasses override.
  onPlaced(game, instance) {}
  onRemoved(game, instance) {}
}

export class BeamlineModule extends Placeable {
  onPlaced(game, instance) {
    // Beam graph hookup happens here in a later task.
  }
  onRemoved(game, instance) {
    // Beam graph teardown.
  }
}

export class Furnishing extends Placeable {}
export class Equipment extends Placeable {}
export class Decoration extends Placeable {}

export const PLACEABLE_CLASS_BY_KIND = {
  beamline: BeamlineModule,
  furnishing: Furnishing,
  equipment: Equipment,
  decoration: Decoration,
};
