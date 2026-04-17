// src/input/BeamlineInputController.js
//
// All beamline-related input: junction placement ghost, pipe drawing,
// placement-on-pipe ghost. Translates cursor events into BeamlineSystem
// calls. Owned by InputHandler; InputHandler delegates beamline input
// here when the selected tool is a beamline component or pipe-drawing.

import { COMPONENTS } from '../data/components.js';
import { PLACEABLES } from '../data/placeables/index.js';
import { snapForPlaceable, canPlace } from '../game/placement.js';

export class BeamlineInputController {
  constructor({ game, renderer, inputHandler }) {
    this.game = game;
    this.renderer = renderer;
    // Back-reference so the controller can read the current placement tool
    // and direction without duplicating selection state. InputHandler owns
    // selection; the controller owns beamline-specific input interpretation.
    this.input = inputHandler;
  }

  onHover(worldX, worldY) {
    const selectedId = this.input?.selectedPlaceableId;
    if (!selectedId) return;
    const def = COMPONENTS[selectedId];
    if (!def) return;
    if (def.role === 'junction') {
      this._previewJunction(selectedId, worldX, worldY);
    } else if (def.role === 'placement') {
      // E4 will handle pipe-placement preview. For now, suppress any stale
      // ghost so hovering with a placement tool doesn't render via the
      // generic path.
      this.renderer._clearPreview?.();
    }
  }

  onMouseDown(worldX, worldY, button) {
    if (button !== 0) return false;
    const selectedId = this.input?.selectedPlaceableId;
    if (!selectedId) return false;
    const def = COMPONENTS[selectedId];
    if (!def) return false;
    if (def.role !== 'junction') return false;
    const placeable = PLACEABLES[selectedId];
    if (!placeable) return false;
    const dir = this.input.placementDir || 0;
    const snap = snapForPlaceable(worldX, worldY, placeable, dir);
    const result = canPlace(
      this.game, placeable,
      snap.col, snap.row, snap.subCol, snap.subRow, dir,
    );
    if (!result.ok) {
      // Swallow the click — generic click path is already suppressed for
      // junction tools. Invalid spot: do nothing.
      return true;
    }
    this.game._pushUndo();
    const placedId = this.game.beamline.placeJunction({
      type: selectedId,
      col: snap.col,
      row: snap.row,
      subCol: snap.subCol,
      subRow: snap.subRow,
      dir,
      params: this.input.selectedParamOverrides,
    });
    // Sources auto-advance the tool to the beam-pipe draw tool (same UX
    // the old generic path provided).
    if (placedId && def.isSource && typeof this.input.selectTool === 'function') {
      this.input.selectTool('drift');
    }
    return true;
  }

  onMouseMove(/* worldX, worldY */) {
    // no-op
  }

  onMouseUp(/* worldX, worldY, button */) {
    // no-op
    return false;
  }

  onRotate() {
    // no-op
  }

  isActive() {
    return false;
  }

  reset() {
    // no-op
  }

  // -------------------------------------------------------------------------
  // Internals.
  // -------------------------------------------------------------------------

  _previewJunction(selectedId, worldX, worldY) {
    const placeable = PLACEABLES[selectedId];
    if (!placeable) return;
    const dir = this.input.placementDir || 0;
    const snap = snapForPlaceable(worldX, worldY, placeable, dir);
    const result = canPlace(
      this.game, placeable,
      snap.col, snap.row, snap.subCol, snap.subRow, dir,
    );
    // Controller owns the ghost for junctions now, so hoverPlaceable stays
    // null — the generic click path in InputHandler is bypassed via the
    // role-based delegation guard.
    const hover = {
      id: selectedId,
      col: snap.col,
      row: snap.row,
      subCol: snap.subCol,
      subRow: snap.subRow,
      dir,
      placeY: 0,
      stackTargetId: null,
    };
    this.renderer.renderPlaceableGhost(hover, result.ok);
  }
}
