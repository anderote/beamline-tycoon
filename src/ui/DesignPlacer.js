// src/ui/DesignPlacer.js — Handles placing a saved design onto the isometric map.

import { COMPONENTS } from '../data/components.js';
import { FLOORS } from '../data/structure.js';
import { DIR } from '../data/directions.js';
import { pipeCost, pipeTileDist } from '../beamline/BeamlineSystem.js';
import { layoutDesign } from '../beamline/design-layout.js';
import { planDesignPlacementGeometry } from '../beamline/design-placement-geometry.js';
import { placementPose } from '../beamline/pipe-placements.js';
import { applyPreviewDialog } from './ApplyPreviewDialog.js';

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
    //     'module' — sub-grid anchor + the junction `dir` confirm() will pass
    //                to placeJunction.
    //     'onPipe' — fractional pipe-space col/row and the travel-derived dir,
    //                from the SAME placementPose() the world snapshot uses for
    //                committed attachments, so the ghost and the built thing
    //                land on the same point.
    //   previewPipes: [{ from: {col,row}, to: {col,row} }] — exact port-to-port
    //                runs the placement geometry will draw between modules.
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
   * direction — is fully determined by its beam ports. Mirroring a design
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

    const concreteCost = FLOORS.concrete?.cost || 10;
    let componentCost = 0;
    let foundationCost = 0;
    let pipeQuote = 0;

    // Sequencing (which attachment rides which pipe, what gets discarded) is
    // shared with confirm() so the quote can never describe a different
    // beamline than the one the click builds — see design-layout.js.
    const layout = layoutDesign(this.design);
    const geometry = planDesignPlacementGeometry(layout, {
      startCol: this.startCol,
      startRow: this.startRow,
      direction: this.direction,
    });
    if (!geometry.ok) {
      this.valid = false;
      this.invalidReason = geometry.reason;
      return;
    }

    // Discarded attachments are still charged for. That is deliberate rather
    // than an oversight: confirm() charges the same total, so exempting them
    // here would show a price the player does not pay.
    for (const att of [...layout.discardedLeading, ...layout.discardedTrailing]) {
      const funding = COMPONENTS[att.type]?.cost?.funding || 0;
      componentCost += funding;
    }

    const plannedSubgrid = new Set();
    const plannedFoundation = new Set();
    for (const item of geometry.sequence) {
      if (item.kind === 'pipe') {
        // Beam pipe between this module and the previous one. drawPipe charges
        // for it at confirm time, so the quote has to include it or the price
        // the player is shown is not the price they pay.
        // Placement geometry gives the pipe exactly item.tiles between the
        // authoritative module ports.
        pipeQuote += pipeCost(item.tiles).funding;
        // Attachments don't occupy grid tiles — they live on pipes.
        // Still add their cost to the total.
        for (const att of item.attachments) {
          const funding = COMPONENTS[att.type]?.cost?.funding || 0;
          componentCost += funding;
        }
        this.previewPipes.push({ from: item.path[0], to: item.path[1] });
        for (const att of item.attachments) {
          const pose = placementPose({ path: item.path, subL: item.subL }, att);
          if (!pose) continue;
          this.previewModules.push({
            kind: 'onPipe', type: att.type,
            col: pose.col, row: pose.row, dir: pose.dir, subL: att.subL,
          });
        }
        continue;
      }

      const comp = COMPONENTS[item.type];
      const pose = item.pose;
      const cells = comp?.footprintCells?.(
        pose.col, pose.row, pose.subCol, pose.subRow, pose.dir,
      ) || [];
      const moduleTiles = new Set();

      for (const cell of cells) {
        const cellKey = `${cell.col},${cell.row},${cell.subCol},${cell.subRow}`;
        const tileKey = `${cell.col},${cell.row}`;
        moduleTiles.add(tileKey);

        const ext = this.game.state.mapHalfExtent;
        if (Math.abs(cell.col) > ext || Math.abs(cell.row) > ext) {
          this.valid = false;
          this.invalidReason = 'off-site';
        }
        if (this.game.state.subgridOccupied?.[cellKey] || plannedSubgrid.has(cellKey)) {
          this.valid = false;
          this.invalidReason = 'occupied';
        }
        plannedSubgrid.add(cellKey);
      }

      for (const key of moduleTiles) {
        const [tc, tr] = key.split(',').map(Number);
        this.previewTiles.push({ col: tc, row: tr, type: item.type });
        if (!this.game.state.infraOccupied[key] && !plannedFoundation.has(key)) {
          plannedFoundation.add(key);
          this.foundationTiles.push({ col: tc, row: tr });
          foundationCost += concreteCost;
        }
      }

      componentCost += comp?.cost?.funding || 0;
      this.previewModules.push({ kind: 'module', ...pose });
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
        freeConstruction: this.game.isConstructionFree?.() ?? this.game.sandboxMode === true,
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

    // Walk the design and emit modules + exact port-to-port pipes + attachments.
    let prevModuleId = null;
    let prevModuleExitPort = null;
    // The pipe entry precedes the module it feeds in the layout, but the pipe
    // itself can only be drawn once BOTH junctions exist, so its attachments
    // wait here for one iteration.
    let pendingPipe = null;
    let lastPipeId = null;

    // Same geometry coordinator as _recompute — the committed sub-grid anchors
    // and pipe endpoints are exactly the poses the ghost collision-checked.
    const layout = layoutDesign(this.design);
    const geometry = planDesignPlacementGeometry(layout, {
      startCol: this.startCol,
      startRow: this.startRow,
      direction: this.direction,
    });
    if (!geometry.ok) return fail(`Design placement failed: ${geometry.reason}`);

    for (const item of geometry.sequence) {
      if (item.kind === 'pipe') {
        pendingPipe = item;
        continue;
      }

      const pose = item.pose;
      const placeableId = this.game.beamline.placeJunction({
        type: item.type,
        col: pose.col,
        row: pose.row,
        subCol: pose.subCol,
        subRow: pose.subRow,
        dir: pose.dir,
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
        if (!pendingPipe?.path) {
          return fail(`Design placement failed: no pipe geometry for ${item.type}`);
        }
        const pipeId = this.game.beamline.drawPipe(
          { junctionId: prevModuleId, portName: prevModuleExitPort || 'exit' },
          { junctionId: placeableId, portName: item.entryPort },
          pendingPipe.path,
        );
        // A design that cannot be wired up is not a design — bail rather than
        // leave the player disconnected junctions they paid full price for.
        if (!pipeId) {
          return fail(`Design placement failed: couldn't connect ${item.type}`);
        }
        lastPipeId = pipeId;

        // Drain the attachments layoutDesign assigned to this pipe, at the
        // positions it computed.
        for (const att of pendingPipe.attachments) {
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
        pendingPipe = null;
      } else if (layout.discardedLeading.length > 0) {
        // Attachments before any module — discard with a warning. This branch
        // only runs for the first module, which is the only one with no
        // upstream pipe.
        this.game.log('Attachments placed before first module discarded', 'bad');
      }

      prevModuleId = placeableId;
      prevModuleExitPort = item.exitPort;
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

}
