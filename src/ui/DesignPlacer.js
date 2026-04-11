// src/ui/DesignPlacer.js — Handles placing a saved design onto the isometric map.

import { COMPONENTS } from '../data/components.js';
import { INFRASTRUCTURE } from '../data/infrastructure.js';
import { DIR, DIR_DELTA, turnLeft, turnRight } from '../data/directions.js';

export class DesignPlacer {
  constructor(game, renderer) {
    this.game = game;
    this.renderer = renderer;
    this.active = false;
    this.design = null;
    this.startCol = 0;
    this.startRow = 0;
    this.direction = DIR.SE;
    this.reflected = false;

    // Computed placement preview
    this.previewTiles = [];    // [{ col, row, type }]
    this.foundationTiles = []; // [{ col, row }]
    this.totalCost = 0;
    this.valid = true;
  }

  start(design) {
    this.design = design;
    this.active = true;
    this.direction = DIR.SE;
    this.reflected = false;
    this._recompute();
  }

  cancel() {
    this.active = false;
    this.design = null;
    this.previewTiles = [];
    this.foundationTiles = [];
    this.renderer._renderCursors();
  }

  setPosition(col, row) {
    this.startCol = col;
    this.startRow = row;
    this._recompute();
  }

  rotate() {
    this.direction = (this.direction + 1) % 4;
    this._recompute();
  }

  reflect() {
    this.reflected = !this.reflected;
    this._recompute();
  }

  _recompute() {
    if (!this.design || !this.active) return;

    this.previewTiles = [];
    this.foundationTiles = [];
    this.totalCost = 0;
    this.valid = true;

    let col = this.startCol;
    let row = this.startRow;
    let dir = this.direction;

    const concreteCost = INFRASTRUCTURE.concrete?.cost || 10;
    let componentCost = 0;
    let foundationCost = 0;

    for (const c of this.design.components) {
      const comp = COMPONENTS[c.type];
      if (!comp) continue;

      // Attachments don't occupy grid tiles — they live on pipes.
      // Still add their cost to the total.
      if (comp.placement === 'attachment') {
        componentCost += comp.cost?.funding || 0;
        continue;
      }

      // Reflect dipole bend direction
      let bendDir = c.bendDir;
      if (this.reflected && bendDir) {
        bendDir = bendDir === 'left' ? 'right' : 'left';
      }

      const delta = DIR_DELTA[dir];
      const trackLen = Math.ceil((comp.subL || 4) / 4);
      const trackW = Math.ceil((comp.subW || 2) / 4);
      const perpDir = turnLeft(dir);
      const perpDelta = DIR_DELTA[perpDir];

      const widthOffsets = [];
      for (let j = 0; j < trackW; j++) {
        widthOffsets.push(j - (trackW - 1) / 2);
      }

      // Module footprint tiles
      for (let i = 0; i < trackLen; i++) {
        for (const wOff of widthOffsets) {
          const tc = col + delta.dc * i + perpDelta.dc * wOff;
          const tr = row + delta.dr * i + perpDelta.dr * wOff;
          this.previewTiles.push({ col: tc, row: tr, type: c.type });

          // Collision check via sub-grid placeables
          const key = tc + ',' + tr;
          for (let sc = 0; sc < 4; sc++) {
            for (let sr = 0; sr < 4; sr++) {
              const k = `${tc},${tr},${sc},${sr}`;
              if (this.game.state.subgridOccupied && this.game.state.subgridOccupied[k]) {
                this.valid = false;
                break;
              }
            }
            if (!this.valid) break;
          }

          // Foundation check
          const hasFoundation = this.game.state.infraOccupied[key];
          if (!hasFoundation) {
            const alreadyPlanned = this.foundationTiles.some(f => f.col === tc && f.row === tr);
            if (!alreadyPlanned) {
              this.foundationTiles.push({ col: tc, row: tr });
              foundationCost += concreteCost;
            }
          }
        }
      }

      componentCost += comp.cost?.funding || 0;

      // Handle dipole bend: change direction for subsequent placements
      if (comp.isDipole && bendDir) {
        dir = bendDir === 'left' ? turnLeft(dir) : turnRight(dir);
      }

      // Advance cursor past this module PLUS one tile gap for the pipe
      const advDelta = DIR_DELTA[dir];
      col += advDelta.dc * (trackLen + 1);
      row += advDelta.dr * (trackLen + 1);
    }

    this.totalCost = componentCost + foundationCost;

    if (this.totalCost > this.game.state.resources.funding) {
      this.valid = false;
    }
  }

  confirm() {
    if (!this.active || !this.design || !this.valid) return false;

    // Place foundation tiles
    for (const ft of this.foundationTiles) {
      const key = ft.col + ',' + ft.row;
      this.game.removeDecoration(ft.col, ft.row);
      this.game.state.infrastructure.push({ type: 'concrete', col: ft.col, row: ft.row, variant: 0 });
      this.game.state.infraOccupied[key] = 'concrete';
    }

    // Walk the design and emit modules + pipes + attachments
    let col = this.startCol;
    let row = this.startRow;
    let dir = this.direction;
    let prevModuleId = null;
    let prevModuleExitPort = null;
    const pendingAttachments = [];
    let lastPipeId = null;

    for (const c of this.design.components) {
      const comp = COMPONENTS[c.type];
      if (!comp) continue;

      // Attachment: queue for the next pipe
      if (comp.placement === 'attachment') {
        pendingAttachments.push(c);
        continue;
      }

      // Reflect dipole bend direction if the placer is reflected
      let bendDir = c.bendDir;
      if (this.reflected && bendDir) {
        bendDir = bendDir === 'left' ? 'right' : 'left';
      }

      // Place the module as a placeable
      const placeableId = this.game.placePlaceable({
        type: c.type,
        category: 'beamline',
        col,
        row,
        subCol: 0,
        subRow: 0,
        rotated: false,
        dir,
        params: c.params,
      });

      if (!placeableId) {
        this.game.log(`Design placement failed at ${c.type}`, 'bad');
        return false;
      }

      // Connect to previous module via a pipe
      if (prevModuleId) {
        const pipePath = this._buildPipePath(prevModuleId, placeableId);
        // Use default exit/entry port names (linac phase: single port per direction)
        const ok = this.game.createBeamPipe(
          prevModuleId, prevModuleExitPort || 'exit',
          placeableId, 'entry',
          pipePath,
        );
        if (ok) {
          // The most recent pipe is the last one added
          lastPipeId = this.game.state.beamPipes[this.game.state.beamPipes.length - 1]?.id || null;

          // Drain pending attachments onto this pipe at evenly-spaced positions
          if (lastPipeId && pendingAttachments.length > 0) {
            const n = pendingAttachments.length;
            pendingAttachments.forEach((att, i) => {
              const pos = (i + 1) / (n + 1); // evenly spaced in (0, 1)
              this.game.addAttachmentToPipe(lastPipeId, att.type, pos, att.params);
            });
            pendingAttachments.length = 0;
          }
        }
      } else if (pendingAttachments.length > 0) {
        // Attachments before any module — discard with a warning
        this.game.log('Attachments placed before first module discarded', 'bad');
        pendingAttachments.length = 0;
      }

      prevModuleId = placeableId;
      prevModuleExitPort = 'exit';

      // Handle dipole bend: change exit direction for subsequent placements
      if (comp.isDipole && bendDir) {
        dir = bendDir === 'left' ? turnLeft(dir) : turnRight(dir);
      }

      // Advance cursor past this module
      const delta = DIR_DELTA[dir];
      const trackLen = Math.ceil((comp.subL || 4) / 4);
      col += delta.dc * (trackLen + 1); // +1 for pipe gap
      row += delta.dr * (trackLen + 1);
    }

    // Any remaining pending attachments after the last module are discarded
    if (pendingAttachments.length > 0) {
      this.game.log(`${pendingAttachments.length} trailing attachments discarded (no pipe to attach to)`, 'bad');
    }

    this.game.state.resources.funding -= this.totalCost;
    this.game.log(`Placed design "${this.design.name}" ($${this.totalCost.toLocaleString()})`, 'good');

    this.game.recalcBeamline();
    this.game.emit('beamlineChanged');

    this.cancel();
    return true;
  }

  /**
   * Build an L-shaped straight-line path between two modules for a pipe.
   * Walks col first, then row. Returns a dense per-tile path.
   */
  _buildPipePath(fromId, toId) {
    const from = this.game.getPlaceable(fromId);
    const to = this.game.getPlaceable(toId);
    if (!from || !to) return [];

    const path = [];
    let c = from.col;
    let r = from.row;
    const endCol = to.col;
    const endRow = to.row;

    path.push({ col: c, row: r });
    while (c !== endCol) {
      c += Math.sign(endCol - c);
      path.push({ col: c, row: r });
    }
    while (r !== endRow) {
      r += Math.sign(endRow - r);
      path.push({ col: c, row: r });
    }
    return path;
  }
}
