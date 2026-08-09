// src/ui/DesignPlacer.js — Handles placing a saved design onto the isometric map.

import { COMPONENTS } from '../data/components.js';
import { FLOORS } from '../data/structure.js';
import { DIR, DIR_DELTA, turnLeft, reverseDir } from '../data/directions.js';
import { portSide } from '../beamline/junctions.js';
import { pipeCost } from '../beamline/BeamlineSystem.js';

// DIR_DELTA index -> compass side, and back. DIR_DELTA[0..3] are
// (0,-1)/(1,0)/(0,1)/(-1,0) = N/E/S/W, which is exactly the clockwise compass
// order junctions.portSide() rotates in.
const DIR_TO_COMPASS = ['N', 'E', 'S', 'W'];
function dirFromCompass(side) {
  const i = DIR_TO_COMPASS.indexOf(side);
  return i < 0 ? null : i;
}

/**
 * The junction `dir` a module must be placed at so that its `entry` port faces
 * the pipe arriving along `travelDir`.
 *
 * `dir` and travel direction are NOT the same quantity: portSide() puts a
 * dir=0 module's 'front' (its exit) on compass S while DIR_DELTA[0] points N,
 * so a module placed with dir === travelDir has its exit facing exactly
 * backwards and validateDrawPipe rejects every connecting pipe with
 * port_mismatch. Entry is on 'back' (N at dir=0), i.e. compass index dir, and
 * a pipe travelling along `travelDir` approaches from the opposite side.
 */
function junctionDirForTravel(travelDir) {
  return reverseDir(travelDir);
}

/**
 * Travel direction of the pipe leaving `type`'s exit port when the module is
 * placed at junction `dir`. Straight modules give back the incoming direction;
 * a dipole's exit sits on the yoke's open side, so this is where its 90° bend
 * actually points — the design's stored `bendDir` cannot override it, because
 * fixing the entry side fixes the rotation.
 */
function exitTravelDir(type, dir, fallback) {
  const side = portSide({ type, dir }, 'exit');
  const d = side ? dirFromCompass(side) : null;
  return d === null ? fallback : d;
}

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
    // The share of totalCost that BeamlineSystem.drawPipe charges itself.
    this.pipeQuote = 0;
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

  /**
   * NOTE: currently inert. It used to flip each dipole's stored `bendDir`, but
   * a dipole's exit sits on a fixed side of its yoke, so once the entry port is
   * aligned with the incoming pipe the rotation — and therefore the bend
   * direction — is fully determined (see exitTravelDir). Mirroring a design
   * needs a mirrored dipole component, not a flag.
   */
  reflect() {
    this.reflected = !this.reflected;
    this._recompute();
  }

  _recompute() {
    if (!this.design || !this.active) return;

    this.previewTiles = [];
    this.foundationTiles = [];
    this.totalCost = 0;
    this.pipeQuote = 0;
    this.valid = true;

    let col = this.startCol;
    let row = this.startRow;
    let dir = this.direction;

    const concreteCost = FLOORS.concrete?.cost || 10;
    let componentCost = 0;
    let foundationCost = 0;
    let pipeQuote = 0;
    let placedAny = false;

    for (const c of this.design.components) {
      const comp = COMPONENTS[c.type];
      if (!comp) continue;

      // Attachments don't occupy grid tiles — they live on pipes.
      // Still add their cost to the total.
      if (comp.placement === 'attachment') {
        componentCost += comp.cost?.funding || 0;
        continue;
      }

      const delta = DIR_DELTA[dir];
      const trackLen = Math.ceil((comp.subL || 4) / 4);
      const trackW = Math.ceil((comp.subW || 2) / 4);
      const perpDir = turnLeft(dir);
      const perpDelta = DIR_DELTA[perpDir];

      // Integer offsets only. `j - (trackW - 1) / 2` produced ±0.5 for
      // even-width modules, so the collision probe looked up subgrid keys like
      // "12,10.5,0,0" that can never exist — detection failed open — and
      // confirm() then poured concrete at fractional coordinates that no
      // demolish tool can target.
      const widthOffsets = [];
      for (let j = 0; j < trackW; j++) {
        widthOffsets.push(j - Math.floor((trackW - 1) / 2));
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
      // Beam pipe between this module and the previous one. drawPipe charges
      // for it at confirm time, so the quote has to include it or the price
      // the player is shown is not the price they pay.
      // Modules sit trackLen + 1 tiles apart and the pipe runs face to face,
      // so every connecting run is exactly one tile (see _buildPipePath).
      if (placedAny) pipeQuote += pipeCost(1).funding;
      placedAny = true;

      // Outgoing direction is whatever the module's exit port actually faces
      // at the rotation it will be placed at (straight-through for most,
      // a 90° turn for a dipole).
      dir = exitTravelDir(c.type, junctionDirForTravel(dir), dir);

      // Advance cursor past this module PLUS one tile gap for the pipe
      const advDelta = DIR_DELTA[dir];
      col += advDelta.dc * (trackLen + 1);
      row += advDelta.dr * (trackLen + 1);
    }

    this.pipeQuote = pipeQuote;
    this.totalCost = componentCost + foundationCost + pipeQuote;

    if (this.totalCost > this.game.state.resources.funding) {
      this.valid = false;
    }
  }

  confirm() {
    if (!this.active || !this.design || !this.valid) return false;

    // A design placement is one gesture and must be all-or-nothing. It writes
    // floors, junctions, pipes, placements and funding, so a module rejected
    // half way through used to leave orphan modules and concrete standing with
    // no undo entry to recover from — and, because `valid` was untouched, the
    // next click re-entered here and dropped another partial copy.
    const rollbackPoint = this.game._makeUndoEntry();
    const fail = (msg) => {
      this.game.restoreSnapshot(rollbackPoint);
      this.game.log(msg, 'bad');
      this.cancel();
      return false;
    };

    // Place foundation tiles
    for (const ft of this.foundationTiles) {
      const key = ft.col + ',' + ft.row;
      this.game.removeDecoration(ft.col, ft.row);
      this.game.state.floors.push({ type: 'concrete', col: ft.col, row: ft.row, variant: 0 });
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

      // Place the module as a junction via BeamlineSystem, rotated so its
      // entry port faces the incoming pipe (see junctionDirForTravel).
      const junctionDir = junctionDirForTravel(dir);
      const placeableId = this.game.beamline.placeJunction({
        type: c.type,
        col,
        row,
        subCol: 0,
        subRow: 0,
        dir: junctionDir,
        params: c.params,
        // `this.totalCost` already includes every module's cost (see
        // _recompute) and is deducted once at the end — same reason the
        // placeOnPipe call below is free. Without this the design was charged
        // twice, and the affordability gate only checked the single price, so
        // a player with less than 2x the quote went silently negative.
        free: true,
      });

      if (!placeableId) {
        return fail(`Design placement failed at ${c.type}`);
      }

      // Connect to previous module via a pipe
      if (prevModuleId) {
        const pipePath = this._buildPipePath(prevModuleId, placeableId, dir);
        // Use default exit/entry port names (linac phase: single port per direction)
        const pipeId = this.game.beamline.drawPipe(
          { junctionId: prevModuleId, portName: prevModuleExitPort || 'exit' },
          { junctionId: placeableId, portName: 'entry' },
          pipePath,
        );
        // A design that cannot be wired up is not a design — bail rather than
        // leave the player disconnected junctions they paid full price for.
        if (!pipeId) {
          return fail(`Design placement failed: couldn't connect ${c.type}`);
        }
        lastPipeId = pipeId;

        // Drain pending attachments onto this pipe at evenly-spaced positions
        if (pendingAttachments.length > 0) {
          const n = pendingAttachments.length;
          pendingAttachments.forEach((att, i) => {
            const pos = (i + 1) / (n + 1); // evenly spaced in (0, 1)
            this.game.beamline.placeOnPipe(lastPipeId, {
              type: att.type,
              position: pos,
              params: att.params,
              mode: 'snap',
              // `this.totalCost` already includes every attachment's cost
              // (see _recompute) and is deducted once at the end.
              free: true,
            });
          });
          pendingAttachments.length = 0;
        }
      } else if (pendingAttachments.length > 0) {
        // Attachments before any module — discard with a warning
        this.game.log('Attachments placed before first module discarded', 'bad');
        pendingAttachments.length = 0;
      }

      prevModuleId = placeableId;
      prevModuleExitPort = 'exit';

      // Outgoing direction = where this module's exit port actually points at
      // the rotation it was placed at. Mirrors _recompute.
      dir = exitTravelDir(c.type, junctionDir, dir);

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

    // Everything above was placed free:true EXCEPT the pipes — drawPipe owns
    // its own spend — so settle the quote minus the part already paid.
    this.game.state.resources.funding -= (this.totalCost - this.pipeQuote);
    this.game.log(`Placed design "${this.design.name}" ($${this.totalCost.toLocaleString()})`, 'good');

    this.game.recalcBeamline();
    this.game.emit('beamlineChanged');

    this.cancel();
    return true;
  }

  /**
   * Straight path for the pipe connecting `fromId`'s exit face to `toId`'s
   * entry face, along `travelDir`.
   *
   * It runs face-to-face, not anchor-to-anchor: an anchor-to-anchor path ends
   * ON the next module's tile and the following pipe starts there, so from the
   * third module onward validateDrawPipe rejected every pipe as `overlap`.
   * Modules are laid out trackLen + 1 tiles apart, so the gap is always
   * exactly one tile.
   */
  _buildPipePath(fromId, toId, travelDir) {
    const from = this.game.getPlaceable(fromId);
    const to = this.game.getPlaceable(toId);
    if (!from || !to) return [];
    const d = DIR_DELTA[travelDir];
    const fromLen = Math.ceil((COMPONENTS[from.type]?.subL || 4) / 4);
    return [
      { col: from.col + d.dc * (fromLen - 0.5), row: from.row + d.dr * (fromLen - 0.5) },
      { col: to.col - d.dc * 0.5, row: to.row - d.dr * 0.5 },
    ];
  }
}
