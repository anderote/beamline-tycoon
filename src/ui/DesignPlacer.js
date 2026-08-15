// src/ui/DesignPlacer.js — Handles placing a saved design onto the isometric map.

import { COMPONENTS } from '../data/components.js';
import { FLOORS } from '../data/structure.js';
import { DIR, DIR_DELTA, turnLeft, reverseDir } from '../data/directions.js';
import { portSide } from '../beamline/junctions.js';
import { pipeCost, pipeTileDist } from '../beamline/BeamlineSystem.js';
import { layoutDesign } from '../beamline/design-layout.js';
import { placementPose } from '../beamline/pipe-placements.js';
import { applyPreviewDialog } from './ApplyPreviewDialog.js';

// DIR_DELTA index -> compass side, and back. DIR_DELTA[0..3] are
// (0,-1)/(1,0)/(0,1)/(-1,0) = N/E/S/W, which is exactly the clockwise compass
// order junctions.portSide() rotates in.
const DIR_TO_COMPASS = ['N', 'E', 'S', 'W'];
function dirFromCompass(side) {
  const i = DIR_TO_COMPASS.indexOf(side);
  return i < 0 ? null : i;
}

/**
 * The name of the port an arriving pipe should land on.
 *
 * Almost every junction calls it `entry`. The two-beam endpoints do not:
 * `collisionPoint` and `blackHoleChamber` are the shape the engine already
 * supports for a collider — two counter-propagating arms terminating on
 * entryA and entryB — and neither publishes a plain `entry`. Falling back to
 * the first `entry`-prefixed port is what lets a design walk into one, and it
 * is deliberately a NAME fallback rather than a geometric one: the arm a
 * design arrives on is decided by the layout walk, not by which side happens
 * to face the pipe, and picking geometrically would silently reorder the two
 * arms of a collider.
 */
function _entryPortName(compType) {
  const ports = COMPONENTS[compType]?.ports || {};
  if (ports.entry) return 'entry';
  // Ring injection is the one three-port merger whose incoming linac port is
  // named by function rather than with the generic entry prefix.
  if (ports.linacEntry) return 'linacEntry';
  const named = Object.keys(ports).filter(k => k.startsWith('entry')).sort();
  return named[0] || 'entry';
}

/** The forward port a sequential design should leave through. */
function _exitPortName(compType) {
  const ports = COMPONENTS[compType]?.ports || {};
  if (ports.exit) return 'exit';
  if (ports.ringExit) return 'ringExit';
  const named = Object.keys(ports).filter(k => /exit/i.test(k)).sort();
  return named[0] || 'exit';
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
  const side = portSide({ type, dir }, _exitPortName(type));
  const d = side ? dirFromCompass(side) : null;
  return d === null ? fallback : d;
}

/**
 * Tile gap to leave after the module at `i` — i.e. the length of the pipe that
 * follows it in the layout.
 *
 * This used to be the literal constant 1. Pipes are now sized to whatever is
 * mounted on them (see design-layout.pipeTilesFor), because a one-tile run is
 * 4 sub-units and a single cryomodule is 16, so anything longer than half a
 * pipe simply could not be placed. Both the quote walk and the placement walk
 * read the gap from the same entry, and _buildPipePath derives the path from
 * the two modules' actual coordinates, so all three stay in step automatically.
 *
 * The trailing module has no pipe after it; the 1 it falls back to is never
 * used for anything but the final cursor advance.
 */
function gapTilesAfter(sequence, i) {
  const next = sequence[i + 1];
  return next && next.kind === 'pipe' ? next.tiles : 1;
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
    // The same placement, expressed as poses instead of tiles, so the renderer
    // can put a translucent copy of the ACTUAL machine under the cursor rather
    // than a green rectangle. A tile list cannot do that: it carries no
    // rotation, so every module would face north, and it says nothing at all
    // about the hardware that rides the pipes (which occupies no tiles).
    //
    //   previewModules: [{ kind: 'module'|'onPipe', type, col, row, dir, subL? }]
    //     'module' — integer anchor tile + the junction `dir` confirm() will
    //                pass to placeJunction.
    //     'onPipe' — fractional pipe-space col/row and the travel-derived dir,
    //                from the SAME placementPose() the world snapshot uses for
    //                committed attachments, so the ghost and the built thing
    //                land on the same point.
    //   previewPipes: [{ from: {col,row}, to: {col,row} }] — the face-to-face
    //                runs _buildPipePath will draw between consecutive modules.
    this.previewModules = [];
    this.previewPipes = [];
    this.totalCost = 0;
    // The share of totalCost that BeamlineSystem.drawPipe charges itself.
    this.pipeQuote = 0;
    // While the cost/change confirmation is open, keep the ghost fixed on the
    // exact placement the dialog describes and refuse a second concurrent
    // confirmation click.
    this._confirmationPending = false;
    // Fix round 1: the design's total spares cost — every component in it,
    // module and on-pipe alike. Not part of totalCost (which is funding
    // only, by name and by every existing caller's expectation); charged
    // and gated on separately alongside it. See _recompute's own comment.
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
    this.previewModules = [];
    this.previewPipes = [];
    this.renderer._renderCursors();
  }

  setPosition(col, row) {
    if (this._confirmationPending) return;
    this.startCol = col;
    this.startRow = row;
    this._recompute();
  }

  rotate() {
    if (this._confirmationPending) return;
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
    if (this._confirmationPending) return;
    this.reflected = !this.reflected;
    this._recompute();
  }

  _recompute() {
    if (!this.design || !this.active) return;

    this.previewTiles = [];
    this.foundationTiles = [];
    this.previewModules = [];
    this.previewPipes = [];
    this.totalCost = 0;
    this.pipeQuote = 0;
    // Fix round 1 (staff-professions-3, task 5): every beamline component in
    // the design — module AND on-pipe placement alike — also costs spares,
    // the same as placing one by hand does (Game._placePlaceableInner,
    // BeamlineSystem.placeOnPipe). Before this, every placement in a design
    // went through with `free: true` and confirm() settled ONLY funding in
    // one lump sum at the end (see that method's own comment) — so a whole
    // beamline built through the designer paid nothing at all toward the
    // spares economy, the majority (by count and by funding) of the
    // catalogue being on-pipe components a hand-placed junction's own gate
    // never touches.
    this.valid = true;

    let col = this.startCol;
    let row = this.startRow;
    let dir = this.direction;

    const concreteCost = FLOORS.concrete?.cost || 10;
    let componentCost = 0;
    let foundationCost = 0;
    let pipeQuote = 0;

    // Sequencing (which attachment rides which pipe, what gets discarded) is
    // shared with confirm() so the quote can never describe a different
    // beamline than the one the click builds — see design-layout.js.
    const layout = layoutDesign(this.design);

    // Discarded attachments are still charged for. That is deliberate rather
    // than an oversight: confirm() charges the same total, so exempting them
    // here would show a price the player does not pay.
    for (const att of [...layout.discardedLeading, ...layout.discardedTrailing]) {
      const funding = COMPONENTS[att.type]?.cost?.funding || 0;
      componentCost += funding;
    }

    for (let i = 0; i < layout.sequence.length; i++) {
      const item = layout.sequence[i];
      if (item.kind === 'pipe') {
        // Beam pipe between this module and the previous one. drawPipe charges
        // for it at confirm time, so the quote has to include it or the price
        // the player is shown is not the price they pay.
        // Modules sit trackLen + item.tiles apart and the pipe runs face to
        // face, so the connecting run is exactly item.tiles (_buildPipePath).
        pipeQuote += pipeCost(item.tiles).funding;
        // Attachments don't occupy grid tiles — they live on pipes.
        // Still add their cost to the total.
        for (const att of item.attachments) {
          const funding = COMPONENTS[att.type]?.cost?.funding || 0;
          componentCost += funding;
        }
        continue;
      }

      const comp = COMPONENTS[item.type];
      const delta = DIR_DELTA[dir];
      const trackLen = item.trackLen;
      const trackW = item.trackW;
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
          this.previewTiles.push({ col: tc, row: tr, type: item.type });

          // On-site check. Nothing else in the placement path knows where the
          // ground ends: `valid` below checks occupancy and affordability, and
          // validateDrawPipe checks ports, straightness and pipe overlap.
          // Without this a 204-tile collider lays itself out past the edge of
          // the generated world on the starting site, which would make the
          // whole land ladder decorative — the parcels exist precisely so that
          // the machines which cannot fold have somewhere to go.
          const ext = this.game.state.mapHalfExtent;
          if (Math.abs(tc) > ext || Math.abs(tr) > ext) {
            this.valid = false;
            this.invalidReason = 'off-site';
            break;
          }

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

      {
        const funding = comp?.cost?.funding || 0;
        componentCost += funding;
      }

      // The rotation this module will actually be built at. Hoisted out of the
      // exitTravelDir() call below rather than recomputed, so the ghost preview
      // and confirm()'s placeJunction can never be shown different facings —
      // the whole point of publishing a pose instead of a tile list.
      const junctionDir = junctionDirForTravel(dir);
      this.previewModules.push({
        kind: 'module', type: item.type, col, row, dir: junctionDir,
      });

      // Outgoing direction is whatever the module's exit port actually faces
      // at the rotation it will be placed at (straight-through for most,
      // a 90° turn for a dipole).
      dir = exitTravelDir(item.type, junctionDir, dir);

      // Advance cursor past this module PLUS the gap the following pipe needs.
      const advDelta = DIR_DELTA[dir];
      const gap = gapTilesAfter(layout.sequence, i);
      const nextCol = col + advDelta.dc * (trackLen + gap);
      const nextRow = row + advDelta.dr * (trackLen + gap);

      // The connecting pipe and everything mounted on it. Reconstructed here
      // from the two modules' anchors using the SAME face-to-face arithmetic
      // _buildPipePath runs at confirm time (this module's face is trackLen -
      // 0.5 tiles along the travel direction; the next module's is 0.5 tiles
      // short of its anchor), so the preview cannot drift from what gets built.
      // On-pipe hardware occupies no grid tiles, so previewTiles has never had
      // anything to say about it — half a beamline was invisible until commit.
      const next = layout.sequence[i + 1];
      if (next && next.kind === 'pipe') {
        const from = {
          col: col + advDelta.dc * (trackLen - 0.5),
          row: row + advDelta.dr * (trackLen - 0.5),
        };
        const to = {
          col: nextCol - advDelta.dc * 0.5,
          row: nextRow - advDelta.dr * 0.5,
        };
        this.previewPipes.push({ from, to });
        for (const att of next.attachments) {
          // placementPose is what world-snapshot.buildPipeAttachments calls for
          // committed placements; feeding it the path and subL the layout sized
          // the pipe to gives the ghost the exact point the real mesh will
          // occupy, including the half-length offset that centres it.
          const pose = placementPose({ path: [from, to], subL: next.subL }, att);
          if (!pose) continue;
          this.previewModules.push({
            kind: 'onPipe', type: att.type,
            col: pose.col, row: pose.row, dir: pose.dir, subL: att.subL,
          });
        }
      }

      col = nextCol;
      row = nextRow;
    }

    this.pipeQuote = pipeQuote;
    this.totalCost = componentCost + foundationCost + pipeQuote;

    // Fix round 1: routed through Game.canAfford rather than a raw
    // `totalCost > funding` comparison (the pre-existing shape here) so
    // sandbox mode is respected for BOTH resources the same way every other
    // placement path already is — the raw comparison never called canAfford
    // at all, so a sandbox facility with funding/spares deliberately at 0
    // (see Game.setSandboxMode's own "nothing is charged" promise) would
    // have been refused a design it should be free to place.
    if (typeof this.game.canAfford === 'function') {
      if (!this.game.canAfford({ funding: this.totalCost })) {
        this.valid = false;
      }
    } else if (this.totalCost > this.game.state.resources.funding) {
      this.valid = false;
    }
  }

  /**
   * Player-facing description of the currently previewed placement. It uses
   * the already-computed ghost rather than walking the saved design again, so
   * "New" describes exactly what confirm() will build at this location.
   */
  placementSummary() {
    const grouped = new Map();
    const add = ({ type, label, count = 1, cost = 0, metres = 0 }) => {
      const key = type || `label:${label}`;
      const row = grouped.get(key) || { type, label, count: 0, cost: 0, metres: 0 };
      row.count += count;
      row.cost += cost;
      row.metres += metres;
      grouped.set(key, row);
    };

    for (const module of this.previewModules) {
      add({
        type: module.type,
        cost: COMPONENTS[module.type]?.cost?.funding || 0,
      });
    }

    if (this.previewPipes.length > 0) {
      const metres = this.previewPipes.reduce(
        (sum, pipe) => sum + pipeTileDist([pipe.from, pipe.to]) * 2,
        0,
      );
      add({
        type: 'drift',
        count: this.previewPipes.length,
        cost: this.pipeQuote,
        metres,
      });
    }

    if (this.foundationTiles.length > 0) {
      add({
        label: FLOORS.concrete?.name || 'Concrete Pad',
        count: this.foundationTiles.length,
        cost: this.foundationTiles.length * (FLOORS.concrete?.cost || 10),
      });
    }

    const adds = [...grouped.values()].map(row => ({
      ...(row.type ? { type: row.type } : {}),
      ...(row.label ? { label: row.label } : {}),
      count: row.count,
      cost: row.cost,
      ...(row.metres ? { metres: Math.round(row.metres * 100) / 100 } : {}),
    }));

    return {
      adds,
      removes: [],
      movedCount: 0,
      movedDistanceM: 0,
      danglingLineCount: 0,
      totalCost: this.totalCost,
    };
  }

  /**
   * UI command for a world click on a design ghost: preview first, then place
   * the unchanged ghost as one undoable gesture only after explicit consent.
   * The synchronous confirm() remains the mutation seam used by headless
   * coordinators and tests.
   */
  async requestConfirm() {
    if (!this.active || !this.design) return false;
    if (!this.valid) {
      return this.game.commitGesture({
        validate: () => ({ ok: false, reason: 'Invalid placement!' }),
        mutate: () => false,
      });
    }
    if (this._confirmationPending) return false;

    this._confirmationPending = true;
    const design = this.design;
    try {
      const choice = await applyPreviewDialog.open(this.placementSummary(), {
        title: `Place ${design.name || 'beamline'}?`,
        applyLabel: 'Place design',
        backLabel: 'Back to placement',
      });
      if (choice !== 'apply' || !this.active || this.design !== design) return false;

      // Funding or map occupancy may have changed while the modal was open.
      // Revalidate the frozen ghost immediately before entering the gesture.
      this._recompute();
      return this.game.commitGesture({
        validate: () => (this.valid
          ? true : { ok: false, reason: 'Placement is no longer valid!' }),
        mutate: () => this.confirm(),
      });
    } finally {
      this._confirmationPending = false;
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

    // Place foundation tiles. Through placeInfraTile, not by writing
    // state.floors/infraOccupied directly: the direct write skipped the nav
    // revision bump, and a design that lays foundation but places zero modules
    // never reached placeJunction either, so the staff nav grid stayed stale
    // against real topology. `free` because _recompute already quoted this
    // concrete into totalCost, settled once at the end of confirm().
    for (const ft of this.foundationTiles) {
      this.game.removeDecoration(ft.col, ft.row);
      if (!this.game.placeInfraTile(ft.col, ft.row, 'concrete', 0, { free: true })) {
        return fail('Design placement failed: could not lay foundation');
      }
    }

    // Walk the design and emit modules + pipes + attachments
    let col = this.startCol;
    let row = this.startRow;
    let dir = this.direction;
    let prevModuleId = null;
    let prevModuleExitPort = null;
    // The pipe entry precedes the module it feeds in the layout, but the pipe
    // itself can only be drawn once BOTH junctions exist, so its attachments
    // wait here for one iteration.
    let pendingAttachments = [];
    let lastPipeId = null;

    // Same walk as _recompute — same discards, same attachment positions.
    const layout = layoutDesign(this.design);

    for (let i = 0; i < layout.sequence.length; i++) {
      const item = layout.sequence[i];
      if (item.kind === 'pipe') {
        pendingAttachments = item.attachments;
        continue;
      }

      // Place the module as a junction via BeamlineSystem, rotated so its
      // entry port faces the incoming pipe (see junctionDirForTravel).
      const junctionDir = junctionDirForTravel(dir);
      const placeableId = this.game.beamline.placeJunction({
        type: item.type,
        col,
        row,
        subCol: 0,
        subRow: 0,
        dir: junctionDir,
        params: item.params,
        // `this.totalCost` already includes every module's cost (see
        // _recompute) and is deducted once at the end — same reason the
        // placeOnPipe call below is free. Without this the design was charged
        // twice, and the affordability gate only checked the single price, so
        // a player with less than 2x the quote went silently negative.
        free: true,
      });

      if (!placeableId) {
        return fail(`Design placement failed at ${item.type}`);
      }

      // Connect to previous module via a pipe
      if (prevModuleId) {
        const pipePath = this._buildPipePath(prevModuleId, placeableId, dir);
        // The exit side has always resolved its port name; the entry side used
        // to hardcode 'entry', which silently made every two-entry endpoint
        // unplaceable. `collisionPoint` and `blackHoleChamber` publish entryA
        // and entryB and no `entry` at all, so validateDrawPipe rejected with
        // port_mismatch at every origin on every map size — the collider and
        // the black hole factory could be designed, costed and previewed, and
        // then refused to build, with the failure reading as "couldn't
        // connect" rather than "this endpoint has no port by that name".
        const pipeId = this.game.beamline.drawPipe(
          { junctionId: prevModuleId, portName: prevModuleExitPort || 'exit' },
          { junctionId: placeableId, portName: _entryPortName(item.type) },
          pipePath,
        );
        // A design that cannot be wired up is not a design — bail rather than
        // leave the player disconnected junctions they paid full price for.
        if (!pipeId) {
          return fail(`Design placement failed: couldn't connect ${item.type}`);
        }
        lastPipeId = pipeId;

        // Drain the attachments layoutDesign assigned to this pipe, at the
        // positions it computed.
        for (const att of pendingAttachments) {
          const plId = this.game.beamline.placeOnPipe(lastPipeId, {
            type: att.type,
            position: att.position,
            // Pass the length the layout sized the pipe around rather than
            // letting placeOnPipe re-derive it from the registry: the two must
            // agree or the packing that guarantees no overlap is computed for
            // a different-sized object than the one findSlot inserts.
            subL: att.subL,
            inline: att.inline === true,
            params: att.params,
            mode: 'snap',
            // `this.totalCost` already includes every attachment's cost
            // (see _recompute) and is deducted once at the end.
            free: true,
          });
          // Never silently drop. placeOnPipe returns null when findSlot cannot
          // fit the thing (the old even-spacing put two quadrupoles at 1/3 and
          // 2/3 of a 4-sub-unit pipe, where each claims half the run, so the
          // second was rejected with 'overlap') — and this call site ignored
          // the return value, so the player was charged for hardware that
          // never appeared. testStand-sband placed 4 of its 5 attachments and
          // ebeam-sterilisation 2 of 3, silently. A design placement is one
          // all-or-nothing gesture, so a rejected placement fails the whole
          // thing back to the undo snapshot, exactly as a rejected pipe does.
          if (!plId) {
            return fail(`Design placement failed: couldn't mount ${att.type}`);
          }
        }
        pendingAttachments = [];
      } else if (layout.discardedLeading.length > 0) {
        // Attachments before any module — discard with a warning. This branch
        // only runs for the first module, which is the only one with no
        // upstream pipe.
        this.game.log('Attachments placed before first module discarded', 'bad');
      }

      prevModuleId = placeableId;
      prevModuleExitPort = _exitPortName(item.type);

      // Outgoing direction = where this module's exit port actually points at
      // the rotation it was placed at. Mirrors _recompute.
      dir = exitTravelDir(item.type, junctionDir, dir);

      // Advance cursor past this module plus the following pipe's gap. Must
      // match _recompute exactly, or the footprint that was collision-checked
      // and priced is not the one that gets built.
      const delta = DIR_DELTA[dir];
      const gap = gapTilesAfter(layout.sequence, i);
      col += delta.dc * (item.trackLen + gap);
      row += delta.dr * (item.trackLen + gap);
    }

    // Attachments after the last module (or in a design with no modules at
    // all) never got a pipe to land on.
    if (layout.discardedTrailing.length > 0) {
      this.game.log(`${layout.discardedTrailing.length} trailing attachments discarded (no pipe to attach to)`, 'bad');
    }

    // Everything above was placed free:true EXCEPT the pipes — drawPipe owns
    // its own spend — so settle the quote minus the part already paid.
    // Spares (fix round 1) were never charged anywhere else in this
    // gesture (every placeJunction/placeOnPipe call above passed
    // `free: true`), so the FULL sparesCost — not reduced by anything —
    // settles here in the same call, same as funding already did.
    this.game.chargeConstruction(this.totalCost - this.pipeQuote);
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
   *
   * The length falls out of the two modules' coordinates: the walk advanced the
   * cursor by trackLen + <the pipe's tile count>, so face to face is exactly
   * that tile count and validateDrawPipe derives the same subL the layout sized
   * the placements against. Nothing here needs to know the number.
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
