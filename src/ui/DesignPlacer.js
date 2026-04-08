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

      // Calculate exit direction for dipoles
      let exitDir = dir;
      let bendDir = c.bendDir;
      if (this.reflected && bendDir) {
        bendDir = bendDir === 'left' ? 'right' : 'left';
      }
      if (comp.isDipole && bendDir) {
        exitDir = bendDir === 'left' ? turnLeft(dir) : turnRight(dir);
      }

      const delta = DIR_DELTA[exitDir];
      const trackLen = comp.trackLength || 1;
      const trackW = comp.trackWidth || 1;
      const perpDir = turnLeft(exitDir);
      const perpDelta = DIR_DELTA[perpDir];

      const widthOffsets = [];
      for (let j = 0; j < trackW; j++) {
        widthOffsets.push(j - (trackW - 1) / 2);
      }

      for (let i = 0; i < trackLen; i++) {
        for (const wOff of widthOffsets) {
          const tc = col + delta.dc * i + perpDelta.dc * wOff;
          const tr = row + delta.dr * i + perpDelta.dr * wOff;
          this.previewTiles.push({ col: tc, row: tr, type: c.type });

          const key = tc + ',' + tr;
          if (this.game.registry.isTileOccupied(tc, tr)) {
            this.valid = false;
          }

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

      col += delta.dc * trackLen;
      row += delta.dr * trackLen;
      dir = exitDir;
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
      if (this.game.state.decorationOccupied[key]) {
        this.game.removeDecoration(ft.col, ft.row);
      }
      this.game.state.infrastructure.push({ type: 'concrete', col: ft.col, row: ft.row, variant: 0 });
      this.game.state.infraOccupied[key] = 'concrete';
    }

    const machineType = this.design.category || 'linac';
    const entry = this.game.registry.createBeamline(machineType);

    let col = this.startCol;
    let row = this.startRow;
    let dir = this.direction;

    for (let idx = 0; idx < this.design.components.length; idx++) {
      const c = this.design.components[idx];
      const comp = COMPONENTS[c.type];
      if (!comp) continue;

      let bendDir = c.bendDir;
      if (this.reflected && bendDir) {
        bendDir = bendDir === 'left' ? 'right' : 'left';
      }

      let exitDir = dir;
      if (comp.isDipole && bendDir) {
        exitDir = bendDir === 'left' ? turnLeft(dir) : turnRight(dir);
      }

      let nodeId;
      if (idx === 0) {
        // First component — place as source (even if not a source type, we need a starting node)
        nodeId = entry.beamline.placeSource(col, row, exitDir);
        if (nodeId != null && c.type !== 'source') {
          const node = entry.beamline.nodes.find(n => n.id === nodeId);
          if (node) node.type = c.type;
        }
      } else {
        const cursors = entry.beamline.getBuildCursors();
        if (cursors.length > 0) {
          nodeId = entry.beamline.placeAt(cursors[0], c.type, bendDir);
        }
      }

      if (nodeId != null) {
        const node = entry.beamline.nodes.find(n => n.id === nodeId);
        if (node) {
          if (c.params) node.params = { ...c.params };
          this.game.registry.occupyTiles(entry.id, node);
        }
      }

      // Advance cursor
      const delta = DIR_DELTA[exitDir];
      const trackLen = comp.trackLength || 1;
      col += delta.dc * trackLen;
      row += delta.dr * trackLen;
      dir = exitDir;
    }

    this.game.state.resources.funding -= this.totalCost;
    this.game.editingBeamlineId = entry.id;
    this.game.selectedBeamlineId = entry.id;

    this.game.recalcBeamline(entry.id);
    this.game.emit('beamlineChanged');
    this.game.log(`Placed design "${this.design.name}" ($${this.totalCost.toLocaleString()})`, 'good');

    this.cancel();
    return true;
  }
}
