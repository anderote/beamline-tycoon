// src/input/UtilityLineInputController.js
//
// Input controller for drawing utility lines between ports on placeables.
// Parallel to BeamlineInputController but scoped to the utility-line system:
//   - Stores the current utility type (e.g. 'powerCable').
//   - Snaps start/end to ports whose spec.utility matches the current type.
//   - Paths are Manhattan (one 90° bend max) from start port to end port.
//   - Commit on mouse-up calls UtilityLineSystem.addLine().
//
// Coordinate conventions:
//   - All mouse handlers receive (worldX, worldY) in iso-pixel space (same as
//     InputHandler's `screenToWorld` result).
//   - portWorldPosition returns 3D world-meter coords {x, z}; we convert to
//     tile-integer path coords via (x/2, z/2) since 1 tile = 2 world meters.
//   - For hit-test we convert iso-pixel cursor → fractional tile via
//     isoToGridFloat, then → 3D-world via (col*2, row*2) to match port worlds.

import { COMPONENTS } from '../data/components.js';
import { availablePorts, portWorldPosition } from '../utility/ports.js';
import { buildManhattanPath } from '../utility/line-geometry.js';
import { UTILITY_TYPES } from '../utility/registry.js';
import { isoToGridFloat } from '../renderer/grid.js';

// Snap tolerance between cursor and a port's world position, in world meters.
// 0.6 is roughly 30% of a tile — generous enough that small cursor jitter
// still snaps, but tight enough that two nearby ports don't collide.
const PORT_SNAP_RADIUS_WORLD = 0.6;

function snapQ(v) { return Math.round(v * 4) / 4; }
function snapPath(path) {
  return path.map(p => ({ col: snapQ(p.col), row: snapQ(p.row) }));
}

export class UtilityLineInputController {
  constructor({ game, renderer, inputHandler }) {
    this.game = game;
    this.renderer = renderer;
    this.input = inputHandler;

    this._utilityType = null;
    this._drawing = false;
    this._drawStart = null;  // {placeableId, portName, worldPos: {x, z}}
    this._drawPath = [];     // tile-coord path for preview
    this._preferVerticalFirst = false;
  }

  setUtilityType(type) {
    this._utilityType = type || null;
    this._cancelDraw();
    if (this.input) this.input.utilityHoverPort = null;
  }

  isActive() {
    return this._drawing;
  }

  onHover(worldX, worldY) {
    if (!this._utilityType || this._drawing) return;
    // Expose hover port for the renderer (glowing-sphere highlight).
    this.input.utilityHoverPort = this._snapToNearestPort(worldX, worldY);
  }

  onMouseDown(worldX, worldY, button) {
    if (!this._utilityType || button !== 0) return false;
    const snap = this._snapToNearestPort(worldX, worldY);
    if (!snap) return false;
    this._drawing = true;
    this._drawStart = snap;
    this._drawPath = [];
    this.input.utilityHoverPort = null;
    this.input.utilityPreview = {
      utilityType: this._utilityType,
      path: [],
      color: UTILITY_TYPES[this._utilityType]?.color || '#ffffff',
    };
    return true;
  }

  onMouseMove(worldX, worldY) {
    if (!this._drawing) return;
    const startTile = this._worldToTile(this._drawStart.worldPos);
    const cursorTile = this._isoFloatToTile(worldX, worldY);
    const path = buildManhattanPath(startTile, cursorTile, {
      preferVerticalFirst: this._preferVerticalFirst,
    }) || [];
    this._drawPath = snapPath(path);
    this.input.utilityPreview = {
      utilityType: this._utilityType,
      path: this._drawPath,
      color: UTILITY_TYPES[this._utilityType]?.color || '#ffffff',
    };
  }

  onMouseUp(worldX, worldY, button) {
    if (!this._drawing || button !== 0) {
      this._cancelDraw();
      return !!this._drawing;
    }
    const endSnap = this._snapToNearestPort(worldX, worldY);
    if (endSnap && this._drawStart && endSnap.placeableId !== this._drawStart.placeableId) {
      const startTile = this._worldToTile(this._drawStart.worldPos);
      const endTile = this._worldToTile(endSnap.worldPos);
      const rawPath = buildManhattanPath(startTile, endTile, {
        preferVerticalFirst: this._preferVerticalFirst,
      });
      if (rawPath) {
        const path = snapPath(rawPath);
        this.game.utilityLineSystem.addLine({
          utilityType: this._utilityType,
          start: { placeableId: this._drawStart.placeableId, portName: this._drawStart.portName },
          end:   { placeableId: endSnap.placeableId,         portName: endSnap.portName         },
          path,
        });
      }
    }
    this._cancelDraw();
    return true;
  }

  onEscape() { this._cancelDraw(); }

  _cancelDraw() {
    this._drawing = false;
    this._drawStart = null;
    this._drawPath = [];
    if (this.input) this.input.utilityPreview = null;
  }

  _snapToNearestPort(worldX, worldY) {
    const state = this.game.state;
    const lines = state.utilityLines;
    const cursorWorld = this._isoFloatToWorld(worldX, worldY);
    let best = null;
    let bestDist = PORT_SNAP_RADIUS_WORLD;
    for (const placeable of state.placeables || []) {
      const def = COMPONENTS[placeable.type];
      if (!def || !def.ports) continue;
      const availableNames = availablePorts(placeable, def, this._utilityType, lines);
      for (const name of availableNames) {
        const pos = portWorldPosition(placeable, def, name);
        if (!pos) continue;
        const dx = pos.x - cursorWorld.x;
        const dz = pos.z - cursorWorld.z;
        const d = Math.hypot(dx, dz);
        if (d < bestDist) {
          bestDist = d;
          best = { placeableId: placeable.id, portName: name, worldPos: pos };
        }
      }
    }
    return best;
  }

  // 3D-world {x, z} from the placeable's portWorldPosition → tile coord.
  // 1 tile = 2 world meters, and path coords use (col = worldX/2, row = worldZ/2)
  // which matches the buildUtilityRouting convention (`col * TILE_W = col * 2`).
  _worldToTile(pos) {
    return { col: pos.x / 2, row: pos.z / 2 };
  }

  // Iso-pixel cursor (InputHandler's screenToWorld output) → fractional tile
  // coords. isoToGridFloat returns (col, row) where 0.5 = tile center; the
  // pipe coord system uses "0 = tile center" but utility lines reference tile
  // anchor (0 = tile corner), so we DON'T subtract 0.5 — unlike snapPipePoint.
  _isoFloatToTile(worldX, worldY) {
    return isoToGridFloat(worldX, worldY);
  }

  // Iso-pixel cursor → 3D world {x, z}. Via fractional tile × 2.
  _isoFloatToWorld(worldX, worldY) {
    const fc = isoToGridFloat(worldX, worldY);
    return { x: fc.col * 2, z: fc.row * 2 };
  }
}

export default UtilityLineInputController;
